import type { Env } from './env.js'
import { parseStored } from './http.js'
import { defaultProfile, normalizeProfile } from '../../modules-src/rackreel/shared/Economy'
import type { Profile } from '../../modules-src/rackreel/shared/Economy'

let tablesReady: Promise<unknown> | null = null

export function ensureRackreelTables(env: Env) {
  tablesReady ??= env.DB.prepare('CREATE TABLE IF NOT EXISTS rackreel_profiles (user_id TEXT PRIMARY KEY, username TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL)').run().catch((error) => {
    tablesReady = null
    throw error
  })
  return tablesReady
}

export async function loadRackreelProfile(env: Env, userId: string, username: string): Promise<{ profile: Profile; updatedAt: number }> {
  const row = await env.DB.prepare('SELECT data, updated_at FROM rackreel_profiles WHERE user_id = ?').bind(userId).first<{ data: string; updated_at: number }>()
  if (!row) {
    const profile = defaultProfile()
    const updatedAt = Date.now()
    await saveRackreelProfile(env, userId, username, profile, updatedAt)
    return { profile, updatedAt }
  }
  return { profile: normalizeProfile(parseStored(row.data, {})), updatedAt: row.updated_at }
}

export async function saveRackreelProfile(env: Env, userId: string, username: string, profile: Profile, updatedAt = Date.now()) {
  await env.DB.prepare('INSERT INTO rackreel_profiles (user_id, username, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, data = excluded.data, updated_at = excluded.updated_at')
    .bind(userId, username, JSON.stringify(profile), updatedAt).run()
}
