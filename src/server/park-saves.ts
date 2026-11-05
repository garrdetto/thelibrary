import type { Env } from './env'
import { HttpError } from './http'
import { MILLION_RATING, MILLION_VALUE, MONTHS, SCENARIOS, companyValue } from '../../server/park/index.mjs'

type SavedPark = { id: number; parkId?: string; name?: string; cash?: number; loan?: number; guestsIn?: number; rating?: number; millionAt?: unknown }

export type MillionDash = { seconds: number; day: number; month: number; year: number; value: number; rating: number; approx: boolean }
type SavedState = { scenario?: string; mode?: string; time?: { month?: number; year?: number }; parks?: SavedPark[]; entities?: Record<string, unknown> }

export type ParkSaveSummary = { cash: number; netWorth?: number; companyValue?: number; guests: number; rating: number; date: string; mode: string }

export type ParkInSave = {
  parkId: string
  index: number
  name: string
  scenario: string
  mode: string
  value: number
  summary: ParkSaveSummary
  millionAt: MillionDash | null
}

const PARK_ID = /^[a-f0-9-]{32,36}$/i

// The Million Dollar Dash moment the sim stored in the park (checkMillionDash).
// Anything that does not meet both thresholds is ignored.
function millionDash(raw: unknown): MillionDash | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : NaN
  const seconds = n(m.seconds), value = n(m.value), rating = n(m.rating)
  if (!(seconds >= 0) || seconds > 1e9 || !(value >= MILLION_VALUE) || !(rating >= MILLION_RATING)) return null
  const int = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n(v)) ? n(v) : lo)))
  return { seconds: Math.round(seconds * 100) / 100, day: int(m.day, 0, 30), month: int(m.month, 0, 7), year: int(m.year, 1, 999), value: Math.round(value), rating: Math.min(999, Math.round(rating)), approx: m.approx === true }
}

export async function decodeSave(base64: string): Promise<SavedState> {
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return JSON.parse(await new Response(stream).text()) as SavedState
  } catch {
    throw new HttpError(400, 'That park file could not be read.')
  }
}

export function parkInSave(state: SavedState, wanted?: string, nameHint?: string): ParkInSave {
  const parks = Array.isArray(state.parks) ? state.parks : []
  const valid = parks.filter(p => typeof p?.parkId === 'string' && PARK_ID.test(p.parkId))
  const found = wanted
    ? valid.find(p => p.parkId!.toLowerCase() === wanted.toLowerCase())
    : valid.find(p => nameHint && p.name && nameHint.includes(p.name)) ?? valid[0]
  if (!found) throw new HttpError(400, wanted ? 'That park is not in this save.' : 'This save has no park to keep.')
  const index = parks.indexOf(found)
  let value = Math.round((found.cash ?? 0) - (found.loan ?? 0))
  try { value = companyValue(state as never, index) } catch { /* fall back to net worth */ }
  const month = state.time?.month ?? 0, year = state.time?.year ?? 1
  return {
    parkId: found.parkId!.toLowerCase(),
    index,
    name: String(found.name ?? 'Unnamed park').slice(0, 40) || 'Unnamed park',
    scenario: String(state.scenario ?? ''),
    mode: String(state.mode ?? 'solo'),
    value,
    millionAt: millionDash(found.millionAt),
    summary: {
      cash: Math.round(found.cash ?? 0),
      netWorth: Math.round((found.cash ?? 0) - (found.loan ?? 0)),
      companyValue: value,
      guests: Math.max(0, Math.round(found.guestsIn ?? 0)),
      rating: Math.round(found.rating ?? 0),
      date: `${MONTHS[month] ?? MONTHS[0]}, year ${year}`,
      mode: String(state.mode ?? 'solo'),
    },
  }
}

export function isScoredPark(park: Pick<ParkInSave, 'mode' | 'scenario'>) {
  return park.mode === 'solo' && park.scenario !== 'sandbox' && Boolean(SCENARIOS[park.scenario]) && !SCENARIOS[park.scenario].versus
}

let savesReady: Promise<void> | null = null

export function ensureParkSaves(env: Env) {
  savesReady ??= prepareParkSaves(env).catch(error => { savesReady = null; throw error })
  return savesReady
}

const MIGRATION = 'one-save-per-park'

async function prepareParkSaves(env: Env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS park_saves_by_park (user_id TEXT NOT NULL, park_id TEXT NOT NULL, name TEXT NOT NULL, scenario TEXT NOT NULL, summary TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, park_id))'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS park_migrations (name TEXT PRIMARY KEY NOT NULL, done_at INTEGER NOT NULL)'),
  ])
  const done = await env.DB.prepare('SELECT 1 AS present FROM park_migrations WHERE name = ?').bind(MIGRATION).first<{ present: number }>()
  if (done) return
  await absorbSlotSaves(env)
  await absorbLeaderboardSnapshots(env)
  await absorbLegacyScores(env)
  await env.DB.prepare('INSERT OR IGNORE INTO park_migrations (name, done_at) VALUES (?, ?)').bind(MIGRATION, Date.now()).run()
}

export function upsertParkSave(env: Env, userId: string, park: ParkInSave, data: string, updatedAt: number) {
  return env.DB.prepare(`INSERT INTO park_saves_by_park (user_id, park_id, name, scenario, summary, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, park_id) DO UPDATE SET name = excluded.name, scenario = excluded.scenario, summary = excluded.summary, data = excluded.data, updated_at = excluded.updated_at
    WHERE excluded.updated_at >= park_saves_by_park.updated_at`)
    .bind(userId, park.parkId, park.name, park.scenario, JSON.stringify(park.summary), data, updatedAt)
}

async function absorbSlotSaves(env: Env) {
  const exists = await env.DB.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'park_saves'").first<{ present: number }>()
  if (!exists) return
  const rows = await env.DB.prepare('SELECT user_id, slot, name FROM park_saves ORDER BY updated_at').all<{ user_id: string; slot: number; name: string }>()
  for (const row of rows.results) {
    const full = await env.DB.prepare('SELECT data, updated_at FROM park_saves WHERE user_id = ? AND slot = ?').bind(row.user_id, row.slot).first<{ data: string; updated_at: number }>()
    if (!full) continue
    try {
      const park = parkInSave(await decodeSave(full.data), undefined, row.name)
      await upsertParkSave(env, row.user_id, park, full.data, full.updated_at).run()
      if (isScoredPark(park)) await addLeaderboardEntry(env, row.user_id, park, full.data, full.updated_at)
    } catch (error) {
      console.error('Unable to move a slot save to its park.', row.user_id, row.slot, error)
    }
  }
}

async function addLeaderboardEntry(env: Env, userId: string, park: ParkInSave, data: string, savedAt: number) {
  const user = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(userId).first<{ username: string }>()
  if (!user) return
  await env.DB.prepare(`INSERT OR IGNORE INTO park_scores_by_park (park_id, user_id, scenario, username, park_name, value, updated_at, saved_at, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(park.parkId, userId, park.scenario, user.username, park.name, park.value, savedAt, savedAt, data).run()
}

async function absorbLeaderboardSnapshots(env: Env) {
  const rows = await env.DB.prepare(`SELECT s.park_id, s.user_id, s.saved_at, s.updated_at FROM park_scores_by_park s
    WHERE s.snapshot IS NOT NULL AND NOT EXISTS (SELECT 1 FROM park_saves_by_park p WHERE p.user_id = s.user_id AND p.park_id = s.park_id)`).all<{ park_id: string; user_id: string; saved_at: number | null; updated_at: number }>()
  for (const row of rows.results) {
    const full = await env.DB.prepare('SELECT snapshot FROM park_scores_by_park WHERE park_id = ?').bind(row.park_id).first<{ snapshot: string }>()
    if (!full?.snapshot) continue
    try {
      const park = parkInSave(await decodeSave(full.snapshot), row.park_id)
      await env.DB.prepare(`INSERT OR IGNORE INTO park_saves_by_park (user_id, park_id, name, scenario, summary, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(row.user_id, park.parkId, park.name, park.scenario, JSON.stringify(park.summary), full.snapshot, row.saved_at ?? row.updated_at).run()
    } catch (error) {
      console.error('Unable to restore a park save from the leaderboard.', row.park_id, error)
    }
  }
}

async function absorbLegacyScores(env: Env) {
  const exists = await env.DB.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'park_scores'").first<{ present: number }>()
  if (!exists) return
  const rows = await env.DB.prepare(`SELECT o.user_id, o.scenario, o.username, o.value, o.updated_at FROM park_scores o
    WHERE NOT EXISTS (SELECT 1 FROM park_scores_by_park n WHERE n.user_id = o.user_id AND n.scenario = o.scenario AND abs(COALESCE(n.saved_at, n.updated_at) - o.updated_at) <= 10000)`)
    .all<{ user_id: string; scenario: string; username: string; value: number; updated_at: number }>()
  for (const row of rows.results) {
    const id = await legacyParkId(row.user_id, row.scenario)
    await env.DB.prepare(`INSERT OR IGNORE INTO park_scores_by_park (park_id, user_id, scenario, username, park_name, value, updated_at, saved_at, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
      .bind(id, row.user_id, row.scenario, row.username, 'Unnamed park', row.value, row.updated_at, row.updated_at).run()
  }
}

async function legacyParkId(userId: string, scenario: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`legacy-park:${userId}:${scenario}`)))
  return [...digest.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('')
}
