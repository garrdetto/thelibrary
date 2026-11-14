import type { Env } from './env.js'

export type BotStateKey = 'bot-settings' | 'bot-report' | 'bot-command'

let tableReady: Promise<unknown> | null = null
function ensureTable(env: Env) {
  tableReady ??= env.DB.prepare('CREATE TABLE IF NOT EXISTS axiom_radar_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL)').run().catch(error => {
    tableReady = null
    throw error
  })
  return tableReady
}

/** One of the paper-trading bot's rows in D1 `axiom_radar_state`, or null when it (or the table) does not exist yet. */
export async function readBotState(env: Env, key: BotStateKey) {
  return env.DB.prepare('SELECT value, updated_at FROM axiom_radar_state WHERE key = ?').bind(key).first<{ value: string; updated_at: number }>()
    .catch(error => { if (String(error).includes('no such table')) return null; throw error })
}

export async function writeBotState(env: Env, key: BotStateKey, value: string, now = Date.now()) {
  await ensureTable(env)
  await env.DB.prepare('INSERT INTO axiom_radar_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, value, now).run()
}
