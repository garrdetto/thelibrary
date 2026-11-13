import type { Env } from './env.js'
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../modules-src/darts/shared/Settings'
import type { DartsSettings } from '../../modules-src/darts/shared/Settings'

export const DARTS_SETTINGS_KEY = 'darts-settings'

let tableReady: Promise<unknown> | null = null
export function ensureSettingsTable(env: Env) {
  tableReady ??= env.DB.prepare('CREATE TABLE IF NOT EXISTS library_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL)').run().catch(error => {
    tableReady = null
    throw error
  })
  return tableReady
}

/** The live Darts settings from D1 `library_settings` (key `darts-settings`), merged over the defaults; the defaults when nothing is saved or the table is missing. */
export async function readDartsSettings(env: Env): Promise<{ settings: DartsSettings; updatedAt: number | null }> {
  const row = await env.DB.prepare('SELECT value, updated_at FROM library_settings WHERE key = ?').bind(DARTS_SETTINGS_KEY).first<{ value: string; updated_at: number }>()
    .catch(error => { if (String(error).includes('no such table')) return null; throw error })
  if (!row) return { settings: sanitizeSettings(null), updatedAt: null }
  let parsed: unknown = null
  try { parsed = JSON.parse(row.value) } catch { parsed = null }
  return { settings: sanitizeSettings(parsed), updatedAt: row.updated_at }
}

export async function saveDartsSettings(env: Env, settings: DartsSettings): Promise<number> {
  const now = Date.now()
  await ensureSettingsTable(env)
  await env.DB.prepare('INSERT INTO library_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(DARTS_SETTINGS_KEY, JSON.stringify(settings), now).run()
  return now
}

export async function resetDartsSettings(env: Env): Promise<DartsSettings> {
  await ensureSettingsTable(env)
  await env.DB.prepare('DELETE FROM library_settings WHERE key = ?').bind(DARTS_SETTINGS_KEY).run()
  return sanitizeSettings(DEFAULT_SETTINGS)
}
