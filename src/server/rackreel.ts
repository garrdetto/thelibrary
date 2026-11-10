import type { D1PreparedStatement, Env } from './env.js'
import { parseStored } from './http.js'
import { defaultProfile, normalizeProfile } from '../../modules-src/rackreel/shared/Economy'
import type { Profile } from '../../modules-src/rackreel/shared/Economy'
import { BOARD_SIZE, CATEGORY_BY_ID, categoryValues, placeOn } from '../../modules-src/rackreel/shared/Records'
import type { RecordBoard } from '../../modules-src/rackreel/shared/Records'
import type { SpeciesId } from '../../modules-src/rackreel/systems/LootTableManager'

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

let recordsReady: Promise<unknown> | null = null

/** High scores: one row per placing result, pruned to the top three of each category. */
export function ensureRackreelRecords(env: Env) {
  recordsReady ??= env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS rackreel_records (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, username TEXT NOT NULL, category TEXT NOT NULL, value REAL NOT NULL, created_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS rackreel_records_category ON rackreel_records (category, value DESC, created_at ASC)'),
  ]).catch((error) => {
    recordsReady = null
    throw error
  })
  return recordsReady
}

export async function loadRecordBoard(env: Env): Promise<RecordBoard> {
  await ensureRackreelRecords(env)
  const { results } = await env.DB.prepare(
    'SELECT category, username, value, created_at FROM (SELECT category, username, value, created_at, ROW_NUMBER() OVER (PARTITION BY category ORDER BY value DESC, created_at ASC) AS rn FROM rackreel_records) WHERE rn <= ? ORDER BY category, rn',
  ).bind(BOARD_SIZE).all<{ category: string; username: string; value: number; created_at: number }>()
  const board: RecordBoard = {}
  for (const row of results ?? []) {
    if (!CATEGORY_BY_ID[row.category]) continue
    ;(board[row.category] ??= []).push({ username: row.username, value: row.value, at: row.created_at })
  }
  return board
}

/**
 * Enters an accepted catch or tag on every category it qualifies for. The measurements are
 * worked out here from the species and size, never taken from the browser.
 */
export async function saveRecords(env: Env, userId: string, username: string, species: SpeciesId, value: number, now: number): Promise<{ board: RecordBoard; placed: Record<string, number> }> {
  const board = await loadRecordBoard(env)
  const placed: Record<string, number> = {}
  const writes: D1PreparedStatement[] = []
  for (const [category, v] of Object.entries(categoryValues(species, value))) {
    const rank = placeOn(board, category, { username, value: v, at: now })
    if (!rank) continue
    placed[category] = rank
    writes.push(env.DB.prepare('INSERT INTO rackreel_records (user_id, username, category, value, created_at) VALUES (?, ?, ?, ?, ?)').bind(userId, username, category, v, now))
    writes.push(env.DB.prepare('DELETE FROM rackreel_records WHERE category = ? AND id NOT IN (SELECT id FROM rackreel_records WHERE category = ? ORDER BY value DESC, created_at ASC LIMIT ?)').bind(category, category, BOARD_SIZE))
  }
  if (writes.length) await env.DB.batch(writes)
  return { board, placed }
}

export async function resetRecordBoard(env: Env) {
  await ensureRackreelRecords(env)
  await env.DB.prepare('DELETE FROM rackreel_records').run()
}
