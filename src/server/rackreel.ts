import type { Env } from './env.js'
import { parseStored } from './http.js'
import { defaultProfile, normalizeProfile } from '../../modules-src/rackreel/shared/Economy'
import type { Profile } from '../../modules-src/rackreel/shared/Economy'
import { BOARD_LIMIT, BOARD_SIZE, CATEGORY_BY_ID, categoryValues, speciesName } from '../../modules-src/rackreel/shared/Records'
import { classify, measure } from '../../modules-src/rackreel/systems/LootTableManager'
import { NOTICE_PLACES, saveWithKnockouts } from './score-notices.js'
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

/**
 * Saves `profile` only if nobody else saved since `updatedAt` (the shared-wallet move must happen once).
 * Returns false when another request got there first.
 */
export async function saveRackreelProfileIfUnchanged(env: Env, userId: string, profile: Profile, updatedAt: number, now: number): Promise<boolean> {
  const result = await env.DB.prepare('UPDATE rackreel_profiles SET data = ?, updated_at = ? WHERE user_id = ? AND updated_at = ?')
    .bind(JSON.stringify(profile), now, userId, updatedAt).run()
  return (result.meta?.changes ?? 0) > 0
}

let recordsReady: Promise<unknown> | null = null

/** Every placing catch, one row per category, like the site's other record books. */
export function ensureRackreelRecords(env: Env) {
  recordsReady ??= env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS rackreel_records (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL, category TEXT NOT NULL, value REAL NOT NULL, detail TEXT, created_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS rackreel_records_category ON rackreel_records (category, value DESC, created_at ASC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS rackreel_records_user ON rackreel_records (category, user_id)'),
  ]).catch((error) => {
    recordsReady = null
    throw error
  })
  return recordsReady
}

const ORDER = 'ORDER BY r.value DESC, r.created_at ASC, r.id ASC'

/** The top three of every category, for the in-game book and catch card. */
export async function loadRecordBoard(env: Env): Promise<RecordBoard> {
  await ensureRackreelRecords(env)
  const { results } = await env.DB.prepare(
    `SELECT category, username, value, created_at FROM (SELECT r.category, COALESCE(u.username, r.username) AS username, r.value, r.created_at, ROW_NUMBER() OVER (PARTITION BY r.category ${ORDER}) AS rn FROM rackreel_records r LEFT JOIN users u ON u.id = r.user_id) WHERE rn <= ? ORDER BY category, rn`,
  ).bind(BOARD_SIZE).all<{ category: string; username: string; value: number; created_at: number }>()
  const board: RecordBoard = {}
  for (const row of results ?? []) {
    if (!CATEGORY_BY_ID[row.category]) continue
    ;(board[row.category] ??= []).push({ username: row.username, value: row.value, at: row.created_at })
  }
  return board
}

/** One category's top 20 for the site's record board, with the signed-in player's best. */
export async function loadCategoryBoard(env: Env, category: string, userId: string | null) {
  await ensureRackreelRecords(env)
  const [rows, personal] = await Promise.all([
    env.DB.prepare(`SELECT COALESCE(u.username, r.username) AS username, r.value, r.detail, r.created_at FROM rackreel_records r LEFT JOIN users u ON u.id = r.user_id WHERE r.category = ? ${ORDER} LIMIT ${BOARD_LIMIT}`)
      .bind(category).all<{ username: string; value: number; detail: string | null; created_at: number }>(),
    userId ? env.DB.prepare('SELECT MAX(value) AS best FROM rackreel_records WHERE category = ? AND user_id = ?').bind(category, userId).first<{ best: number | null }>() : Promise.resolve(null),
  ])
  return {
    category,
    records: rows.results.map((row) => ({ username: row.username, value: row.value, detail: parseStored<Record<string, unknown> | null>(row.detail, null), date: new Date(row.created_at).toISOString() })),
    personalBest: personal?.best ?? null,
    signedIn: Boolean(userId),
  }
}

/**
 * Enters an accepted catch or tag on every category where it reaches the top 20. Measurements
 * are worked out here from species, size and the animal's seed, never taken from the browser.
 * Each write goes through `saveWithKnockouts`, so players pushed out of a top three get the
 * site's usual notice.
 */
export async function saveRecords(env: Env, user: { id: string; username: string }, species: SpeciesId, value: number, seed: number, now: number): Promise<{ board: RecordBoard; placed: Record<string, number> }> {
  await ensureRackreelRecords(env)
  const measures = measure(species, value, seed)
  const catchId = crypto.randomUUID()
  const placed: Record<string, number> = {}
  for (const [category, v] of Object.entries(categoryValues(species, value, seed, measures))) {
    const cutoff = await env.DB.prepare(`SELECT value FROM rackreel_records r WHERE category = ? ${ORDER} LIMIT 1 OFFSET ${BOARD_LIMIT - 1}`).bind(category).first<{ value: number }>()
    if (cutoff && v <= cutoff.value) continue
    const c = CATEGORY_BY_ID[category]
    const detail = JSON.stringify({ size: classify(species, value), m: measures })
    await saveWithKnockouts(env, {
      game: 'rackreel',
      detail: `${speciesName(c.species)} · ${c.label.toLowerCase()}`,
      scorer: user,
      top: () => env.DB.prepare(`SELECT r.id, r.user_id FROM rackreel_records r WHERE r.category = ? ${ORDER} LIMIT ${NOTICE_PLACES}`).bind(category),
    }, () => env.DB.prepare('INSERT INTO rackreel_records (id, user_id, username, category, value, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(`${user.id}:${catchId}:${category}`, user.id, user.username, category, v, detail, now).run())
    const better = await env.DB.prepare('SELECT COUNT(*) AS n FROM rackreel_records WHERE category = ? AND value > ?').bind(category, v).first<{ n: number }>()
    const rank = (better?.n ?? 0) + 1
    if (rank <= BOARD_SIZE) placed[category] = rank
  }
  return { board: await loadRecordBoard(env), placed }
}

export async function resetRecordBoard(env: Env, category?: string) {
  await ensureRackreelRecords(env)
  if (category) await env.DB.prepare('DELETE FROM rackreel_records WHERE category = ?').bind(category).run()
  else await env.DB.prepare('DELETE FROM rackreel_records').run()
}
