import { z } from 'zod'
import type { Env } from '../env.js'
import { HttpError, json, parseStored, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { CHECKRIDES, applyFlight, defaultCareer, normalizeCareer, pilotClassOf } from '../../../modules-src/takeflight/shared/Career'
import type { CareerProfile, FlightSummary } from '../../../modules-src/takeflight/shared/Career'
import { HANGAR_CLASSES, hangarEntry } from '../../../modules-src/takeflight/shared/Hangar'
import { START_KINDS } from '../../../modules-src/takeflight/sim/Starts'
import { WEATHER_KINDS } from '../../../modules-src/takeflight/shared/Weather'

const BODY_LIMIT = 16 * 1024
const MAX_SEGMENT_SECONDS = 4 * 60 * 60
const CLOCK_SLACK_SECONDS = 90

const unit = z.number().finite().min(0).max(1)
const percent = z.number().finite().min(0).max(100)
const categoryScores = z.object({ landing: percent, approach: percent, smoothness: percent, procedure: percent, operations: percent }).partial()

const summarySchema = z.object({
  aircraft: z.string().min(1).max(40),
  airport: z.string().min(1).max(40),
  start: z.enum(START_KINDS as unknown as [string, ...string[]]),
  wind: z.enum(['calm', 'light', 'crosswind', 'gusty']),
  weather: z.enum(WEATHER_KINDS as unknown as [string, ...string[]]).default('clear'),
  time: z.enum(['morning', 'noon', 'evening', 'night']),
  seconds: z.number().finite().min(0).max(MAX_SEGMENT_SECONDS),
  resumed: z.boolean(),
  total: percent,
  crashed: z.boolean(),
  assists: z.object({ autoTrim: z.boolean(), stallProtection: z.boolean(), landingGuidance: z.boolean() }),
  instrumentsOnly: z.boolean(),
  engineFailure: z.boolean().optional(),
  categories: categoryScores,
  metrics: z.record(z.string().max(40), unit).refine((value) => Object.keys(value).length <= 64, 'Too many metrics'),
  landing: z.object({
    tick: z.number().int().min(0),
    airport: z.string().max(40).optional(),
    sinkFpm: z.number().finite().min(-5000).max(20000),
    g: z.number().finite().min(-10).max(20),
    centreline: z.number().finite().min(-2000).max(2000),
    fromAim: z.number().finite().min(-20000).max(20000),
    bounces: z.number().int().min(0).max(50),
    onRunway: z.boolean(),
  }).nullable(),
  checkride: z.enum(CHECKRIDES as unknown as [string, ...string[]]).nullable(),
  job: z.string().regex(/^d\d{1,6}-\d$/).nullable().optional(),
})

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('flight'), summary: summarySchema }),
])

let tableReady: Promise<unknown> | null = null

function ensureTable(env: Env) {
  tableReady ??= env.DB.prepare('CREATE TABLE IF NOT EXISTS takeflight_careers (user_id TEXT PRIMARY KEY, username TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL)').run().catch((error) => {
    tableReady = null
    throw error
  })
  return tableReady
}

async function loadCareer(env: Env, userId: string, username: string): Promise<{ profile: CareerProfile; updatedAt: number }> {
  const row = await env.DB.prepare('SELECT data, updated_at FROM takeflight_careers WHERE user_id = ?').bind(userId).first<{ data: string; updated_at: number }>()
  if (row) return { profile: normalizeCareer(parseStored(row.data, {})), updatedAt: row.updated_at }
  const profile = defaultCareer()
  await env.DB.prepare('INSERT OR IGNORE INTO takeflight_careers (user_id, username, data, updated_at) VALUES (?, ?, ?, ?)').bind(userId, username, JSON.stringify(profile), 0).run()
  return { profile, updatedAt: 0 }
}

/**
 * Take Flight careers. GET returns the signed-in pilot's career (or `signedIn: false`, and guests keep theirs in the browser).
 * POST `flight` adds one flight summary through the shared `applyFlight` rules and saves; the Worker recomputes XP, level,
 * licences and checkride results itself rather than trusting the page's numbers.
 */
export async function takeflight(request: Request, env: Env) {
  await ensureTable(env)
  if (request.method === 'GET') {
    const user = await currentUser(request, env)
    if (!user) return json({ signedIn: false })
    const { profile } = await loadCareer(env, user.id, user.username)
    return json({ signedIn: true, username: user.username, profile })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to save your career.')
  const input = actions.parse(await readJson(request, BODY_LIMIT))
  const summary = input.summary as FlightSummary
  const entry = hangarEntry(summary.aircraft)
  if (!entry) throw new HttpError(400, 'Unknown aircraft.')
  const now = Date.now()
  const loaded = await loadCareer(env, user.id, user.username)
  if (loaded.profile.lastAt > 0 && summary.seconds > (now - loaded.profile.lastAt) / 1000 + CLOCK_SLACK_SECONDS) throw new HttpError(400, 'That flight is longer than the time since your last one.')
  const result = applyFlight(loaded.profile, summary, { now, pilotClass: pilotClassOf(entry.category), family: entry.family, classes: HANGAR_CLASSES, payload: entry.payload })
  const saved = await env.DB.prepare('UPDATE takeflight_careers SET username = ?, data = ?, updated_at = ? WHERE user_id = ? AND updated_at = ?')
    .bind(user.username, JSON.stringify(result.profile), Math.max(now, loaded.updatedAt + 1), user.id, loaded.updatedAt).run()
  if ((saved.meta?.changes ?? 0) === 0) throw new HttpError(409, 'Your career changed in another window. Try again.')
  return json({ ok: true, result })
}
