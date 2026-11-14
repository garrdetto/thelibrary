import type { Env } from './env.js'

export type RadarStateKey = 'payload' | 'details' | 'viewed' | 'settings'

let tableReady: Promise<unknown> | null = null
function ensureRadarTable(env: Env) {
  tableReady ??= env.DB.prepare('CREATE TABLE IF NOT EXISTS axiom_radar_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL)').run().catch(error => {
    tableReady = null
    throw error
  })
  return tableReady
}

/** One row of D1 `axiom_radar_state`, or null when it (or the table) does not exist yet. */
export async function readRadarState(env: Env, key: RadarStateKey) {
  return env.DB.prepare('SELECT value, updated_at FROM axiom_radar_state WHERE key = ?').bind(key).first<{ value: string; updated_at: number }>()
    .catch(error => { if (String(error).includes('no such table')) return null; throw error })
}

export async function writeRadarState(env: Env, key: RadarStateKey, value: string, now = Date.now()) {
  await ensureRadarTable(env)
  await env.DB.prepare('INSERT INTO axiom_radar_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, value, now).run()
}

/** Records that an administrator is watching, at most once every 10 seconds. */
export async function markRadarViewed(env: Env, now = Date.now()) {
  await ensureRadarTable(env)
  await env.DB.prepare("INSERT INTO axiom_radar_state (key, value, updated_at) VALUES ('viewed', '1', ?) ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at WHERE axiom_radar_state.updated_at < ?")
    .bind(now, now - 10_000).run()
}
