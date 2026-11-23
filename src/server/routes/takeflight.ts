import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, clientIp, json, parseStored, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser, sha256 } from '../auth.js'
import { applyFlight, defaultCareer, hoursTotal, joinAirline, leaveAirline, levelFor, normalizeCareer, pilotClassOf, pilotRating } from '../../../modules-src/takeflight/shared/Career'
import type { CareerProfile } from '../../../modules-src/takeflight/shared/Career'
import { AIRLINE_IDS } from '../../../modules-src/takeflight/shared/Airlines'
import type { AirlineId } from '../../../modules-src/takeflight/shared/Airlines'
import { AIRPORTS } from '../../../modules-src/takeflight/shared/Airports'
import { readRecord } from '../../../modules-src/takeflight/shared/FlightRecord'
import { HANGAR_CLASSES, hangarEntry } from '../../../modules-src/takeflight/shared/Hangar'
import { verifyRecord } from '../../../modules-src/takeflight/shared/Verify'

const BODY_LIMIT = 16 * 1024
const RECORD_LIMIT = 8 * 1024 * 1024
const CLOCK_SLACK_SECONDS = 90
const HOUR_MS = 3600000
const USER_FLIGHTS_PER_HOUR = 30
const NETWORK_FLIGHTS_PER_HOUR = 90
const BOARD_SIZE = 20
const DAY_MS = 86400000

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('join'), airline: z.enum(AIRLINE_IDS as unknown as [string, ...string[]]) }),
  z.object({ action: z.literal('leave') }),
])

const boardQuery = z.object({
  board: z.enum(['level', 'rating', 'hours', 'landing', 'airport', 'weekly', 'airline']),
  airport: z.string().max(40).optional(),
  airline: z.enum(AIRLINE_IDS as unknown as [string, ...string[]]).optional(),
})

let tablesReady: Promise<unknown> | null = null

function ensureTables(env: Env) {
  tablesReady ??= (async () => {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS takeflight_careers (user_id TEXT PRIMARY KEY, username TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL)').run()
    await env.DB.batch([
      env.DB.prepare('CREATE TABLE IF NOT EXISTS takeflight_standings (user_id TEXT PRIMARY KEY, username TEXT NOT NULL, xp INTEGER NOT NULL, rating REAL, seconds REAL NOT NULL, airline TEXT, airline_earned INTEGER NOT NULL, updated_at INTEGER NOT NULL)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS takeflight_standings_xp ON takeflight_standings (xp)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS takeflight_standings_airline ON takeflight_standings (airline, airline_earned)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS takeflight_flights (user_id TEXT NOT NULL, flight TEXT NOT NULL, username TEXT NOT NULL, aircraft TEXT NOT NULL, airport TEXT NOT NULL, landing_airport TEXT, total REAL NOT NULL, landing_score REAL, landing_sink REAL, seconds REAL NOT NULL, week INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, flight))'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS takeflight_flights_week ON takeflight_flights (week, total)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS takeflight_flights_landing ON takeflight_flights (landing_airport, landing_score)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS takeflight_flights_user ON takeflight_flights (user_id, updated_at)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS takeflight_rate (key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL)'),
    ])
  })().catch((error) => {
    tablesReady = null
    throw error
  })
  return tablesReady
}

async function loadCareer(env: Env, userId: string, username: string): Promise<{ profile: CareerProfile; updatedAt: number }> {
  const row = await env.DB.prepare('SELECT data, updated_at FROM takeflight_careers WHERE user_id = ?').bind(userId).first<{ data: string; updated_at: number }>()
  if (row) return { profile: normalizeCareer(parseStored(row.data, {})), updatedAt: row.updated_at }
  const profile = defaultCareer()
  await env.DB.prepare('INSERT OR IGNORE INTO takeflight_careers (user_id, username, data, updated_at) VALUES (?, ?, ?, ?)').bind(userId, username, JSON.stringify(profile), 0).run()
  return { profile, updatedAt: 0 }
}

async function saveCareer(env: Env, user: { id: string; username: string }, profile: CareerProfile, loadedAt: number, now: number) {
  const saved = await env.DB.prepare('UPDATE takeflight_careers SET username = ?, data = ?, updated_at = ? WHERE user_id = ? AND updated_at = ?')
    .bind(user.username, JSON.stringify(profile), Math.max(now, loadedAt + 1), user.id, loadedAt).run()
  if ((saved.meta?.changes ?? 0) === 0) throw new HttpError(409, 'Your career changed in another window. Try again.')
  await env.DB.prepare(`INSERT INTO takeflight_standings (user_id, username, xp, rating, seconds, airline, airline_earned, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, xp = excluded.xp, rating = excluded.rating, seconds = excluded.seconds, airline = excluded.airline, airline_earned = excluded.airline_earned, updated_at = excluded.updated_at`)
    .bind(user.id, user.username, profile.xp, pilotRating(profile), hoursTotal(profile) * 3600, profile.airline?.id ?? null, profile.airline?.earned ?? 0, now).run()
}

/** Counts an attempt against an hourly allowance; false when the allowance is used up. */
async function allow(env: Env, key: string, limit: number, now: number): Promise<boolean> {
  const bucket = Math.floor(now / HOUR_MS)
  const row = await env.DB.prepare('SELECT bucket, count FROM takeflight_rate WHERE key = ?').bind(key).first<{ bucket: number; count: number }>()
  const count = row && row.bucket === bucket ? row.count : 0
  if (count >= limit) return false
  await env.DB.prepare('INSERT INTO takeflight_rate (key, bucket, count) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET bucket = excluded.bucket, count = excluded.count').bind(key, bucket, count + 1).run()
  return true
}

const weekOf = (now: number) => Math.floor((Math.floor(now / DAY_MS) + 3) / 7)

/** A flight: the page sends its compressed record; the Worker re-flies it and applies the verified summary. */
async function submitFlight(request: Request, env: Env, user: { id: string; username: string }) {
  if (Number(request.headers.get('content-length')) > RECORD_LIMIT) throw new HttpError(413, 'That flight record is too large.')
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.length > RECORD_LIMIT) throw new HttpError(413, 'That flight record is too large.')
  const now = Date.now()
  if (!(await allow(env, `u:${user.id}`, USER_FLIGHTS_PER_HOUR, now)) || !(await allow(env, `n:${await sha256(clientIp(request))}`, NETWORK_FLIGHTS_PER_HOUR, now))) {
    throw new HttpError(429, 'Too many flights saved in the last hour. Try again later.')
  }
  let record
  try {
    record = await readRecord(bytes)
  } catch {
    throw new HttpError(400, 'That flight record could not be read.')
  }
  const verified = verifyRecord(record)
  if (!verified.ok) throw new HttpError(400, `The flight could not be verified: ${verified.error}`)
  const entry = hangarEntry(verified.summary.aircraft)
  if (!entry) throw new HttpError(400, 'Unknown aircraft.')
  const previous = await env.DB.prepare('SELECT seconds FROM takeflight_flights WHERE user_id = ? AND flight = ?').bind(user.id, verified.flight).first<{ seconds: number }>()
  const flownBefore = previous?.seconds ?? 0
  if (previous && verified.score.seconds <= flownBefore) throw new HttpError(409, 'That flight is already saved.')
  const summary = previous
    ? { ...verified.summary, seconds: verified.score.seconds - flownBefore, resumed: true, job: null, route: null, checkride: null }
    : verified.summary
  const loaded = await loadCareer(env, user.id, user.username)
  if (loaded.profile.lastAt > 0 && summary.seconds > (now - loaded.profile.lastAt) / 1000 + CLOCK_SLACK_SECONDS) throw new HttpError(400, 'That flight is longer than the time since your last one.')
  const result = applyFlight(loaded.profile, summary, { now, pilotClass: pilotClassOf(entry.category), family: entry.family, classes: HANGAR_CLASSES, payload: entry.payload })
  await saveCareer(env, user, result.profile, loaded.updatedAt, now)
  const landing = verified.score.landing
  const landed = landing !== null && landing.surface === 'runway' && verified.score.crashed === null
  const landingScore = landed ? verified.score.categories.find((c) => c.id === 'landing')?.score ?? null : null
  const sink = landed && landing.bounces === 0 ? landing.sinkFpm : null
  await env.DB.prepare(`INSERT INTO takeflight_flights (user_id, flight, username, aircraft, airport, landing_airport, total, landing_score, landing_sink, seconds, week, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, flight) DO UPDATE SET username = excluded.username, landing_airport = excluded.landing_airport, total = excluded.total, landing_score = excluded.landing_score, landing_sink = excluded.landing_sink, seconds = excluded.seconds, updated_at = excluded.updated_at`)
    .bind(user.id, verified.flight, user.username, summary.aircraft, summary.airport, landed ? landing.airport ?? null : null, verified.score.total, landingScore, sink, verified.score.seconds, weekOf(now), now, now).run()
  return json({ ok: true, result, verified: { total: verified.score.total, seconds: verified.score.seconds } })
}

interface BoardRow {
  username: string
  value: number
}

async function board(env: Env, url: URL, viewer: { id: string; username: string } | null) {
  const query = boardQuery.parse({ board: url.searchParams.get('board'), airport: url.searchParams.get('airport') ?? undefined, airline: url.searchParams.get('airline') ?? undefined })
  const now = Date.now()
  let sql: string
  let binds: unknown[] = []
  let order: 'asc' | 'desc' = 'desc'
  let mine: string
  let mineBinds: unknown[] = []
  switch (query.board) {
    case 'level':
    case 'hours':
    case 'rating': {
      const column = query.board === 'level' ? 'xp' : query.board === 'hours' ? 'seconds' : 'rating'
      sql = `SELECT username, ${column} AS value FROM takeflight_standings WHERE ${column} IS NOT NULL AND ${column} > 0 ORDER BY ${column} DESC LIMIT ${BOARD_SIZE}`
      mine = `SELECT ${column} AS value FROM takeflight_standings WHERE user_id = ? AND ${column} IS NOT NULL AND ${column} > 0`
      break
    }
    case 'airline':
      if (!query.airline) throw new HttpError(400, 'Choose an airline.')
      sql = `SELECT username, airline_earned AS value FROM takeflight_standings WHERE airline = ? AND airline_earned > 0 ORDER BY airline_earned DESC LIMIT ${BOARD_SIZE}`
      binds = [query.airline]
      mine = 'SELECT airline_earned AS value FROM takeflight_standings WHERE user_id = ? AND airline = ? AND airline_earned > 0'
      mineBinds = [query.airline]
      break
    case 'landing':
      order = 'asc'
      sql = `SELECT MAX(username) AS username, MIN(landing_sink) AS value FROM takeflight_flights WHERE landing_sink IS NOT NULL GROUP BY user_id ORDER BY value ASC LIMIT ${BOARD_SIZE}`
      mine = 'SELECT MIN(landing_sink) AS value FROM takeflight_flights WHERE user_id = ? AND landing_sink IS NOT NULL'
      break
    case 'airport':
      if (!query.airport || !AIRPORTS.some((a) => a.id === query.airport)) throw new HttpError(400, 'Choose an airport.')
      sql = `SELECT MAX(username) AS username, MAX(landing_score) AS value FROM takeflight_flights WHERE landing_airport = ? AND landing_score IS NOT NULL GROUP BY user_id ORDER BY value DESC LIMIT ${BOARD_SIZE}`
      binds = [query.airport]
      mine = 'SELECT MAX(landing_score) AS value FROM takeflight_flights WHERE user_id = ? AND landing_airport = ? AND landing_score IS NOT NULL'
      mineBinds = [query.airport]
      break
    case 'weekly':
      sql = `SELECT MAX(username) AS username, MAX(total) AS value FROM takeflight_flights WHERE week = ? GROUP BY user_id ORDER BY value DESC LIMIT ${BOARD_SIZE}`
      binds = [weekOf(now)]
      mine = 'SELECT MAX(total) AS value FROM takeflight_flights WHERE user_id = ? AND week = ?'
      mineBinds = [weekOf(now)]
      break
  }
  const rows = (await env.DB.prepare(sql).bind(...binds).all<BoardRow>()).results ?? []
  const shown = (value: number) => (query.board === 'level' ? levelFor(value) : value)
  const entries = rows.map((row, index) => ({ rank: index + 1, name: row.username, value: shown(row.value) }))
  let you: { value: number; rank: number } | null = null
  if (viewer) {
    const own = await env.DB.prepare(mine).bind(viewer.id, ...mineBinds).first<{ value: number | null }>()
    const value = own?.value
    if (typeof value === 'number') {
      const listed = rows.findIndex((row) => row.username === viewer.username)
      const ahead = listed >= 0 ? listed : rows.filter((row) => (order === 'asc' ? row.value < value : row.value > value)).length
      you = { value: shown(value), rank: ahead + 1 }
    }
  }
  return json({ board: query.board, order, entries, you })
}

/**
 * Take Flight careers and leaderboards. GET returns the signed-in pilot's career (or `signedIn: false`; guests keep theirs in
 * the browser), or with `board=` a leaderboard. POST with a flight record (application/octet-stream) re-flies it with the
 * shared simulation, rejects it unless it reproduces its score, and applies the summary built from the re-flown score; at most
 * 30 flights an hour per pilot and 90 per network. POST `join` and `leave` change the pilot's airline.
 */
export async function takeflight(request: Request, env: Env) {
  await ensureTables(env)
  const url = new URL(request.url)
  if (request.method === 'GET') {
    const user = await currentUser(request, env)
    if (url.searchParams.has('board')) return board(env, url, user)
    if (!user) return json({ signedIn: false })
    const { profile } = await loadCareer(env, user.id, user.username)
    return json({ signedIn: true, username: user.username, profile })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to save your career.')
  if ((request.headers.get('content-type') ?? '').startsWith('application/octet-stream')) return submitFlight(request, env, user)
  const input = actions.parse(await readJson(request, BODY_LIMIT))
  const now = Date.now()
  const loaded = await loadCareer(env, user.id, user.username)
  let profile: CareerProfile
  if (input.action === 'join') {
    const joined = joinAirline(loaded.profile, input.airline as AirlineId, now)
    if (joined.error) throw new HttpError(400, joined.error)
    profile = joined.profile
  } else {
    profile = leaveAirline(loaded.profile)
  }
  await saveCareer(env, user, profile, loaded.updatedAt, now)
  return json({ ok: true, profile })
}
