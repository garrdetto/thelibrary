import type { Env } from './env.js'
import { NOTICE_PLACES, saveWithKnockouts } from './score-notices.js'
import { AVERAGE_MIN_DARTS, BOARD_NAMES, MODE_NAMES, RECORD_LIMITS, averageValue, maxAverageTotal } from '../../modules-src/darts/shared/Records'
import type { AverageMode, RecordMode } from '../../modules-src/darts/shared/Records'
import type { BoardKind } from '../../modules-src/darts/shared/interfaces'

export type DartsScorer = { id: string; username: string }

let tableReady: Promise<unknown> | null = null

/** D1 tables for the Darts record book (migration 0031, also created on first use): every saved leg and match once (`darts_legs`, `darts_matches`, keyed `<user>:<run>` so a resend never counts twice), each player's best per board and format with how many times they hit it (`darts_bests`), and their running dart and point/mark totals (`darts_averages`). */
export function ensureDartsTables(env: Env) {
  tableReady ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS darts_legs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      board TEXT NOT NULL,
      mode TEXT NOT NULL,
      value INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS darts_bests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      board TEXT NOT NULL,
      mode TEXT NOT NULL,
      value INTEGER NOT NULL,
      times INTEGER NOT NULL,
      set_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS darts_bests_board_idx ON darts_bests (board, mode, value)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS darts_matches (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      board TEXT NOT NULL,
      mode TEXT NOT NULL,
      darts INTEGER NOT NULL,
      total INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS darts_averages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      board TEXT NOT NULL,
      mode TEXT NOT NULL,
      darts INTEGER NOT NULL,
      total INTEGER NOT NULL,
      matches INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS darts_averages_board_idx ON darts_averages (board, mode)'),
  ]).catch(error => {
    tableReady = null
    throw error
  })
  return tableReady
}

function bestOrder(mode: RecordMode) {
  return RECORD_LIMITS[mode].order === 'asc' ? 'ASC' : 'DESC'
}

/** Saves one finished leg. A new best resets the count to one; matching the best adds one to it. */
export async function saveDartsLeg(env: Env, user: DartsScorer, board: BoardKind, mode: RecordMode, value: number, run: string) {
  const limits = RECORD_LIMITS[mode]
  if (!Number.isInteger(value) || value < limits.min || value > limits.max) return false
  await ensureDartsTables(env)
  const now = Date.now()
  const logged = await env.DB.prepare('INSERT INTO darts_legs (id, user_id, board, mode, value, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
    .bind(`${user.id}:${run}`, user.id, board, mode, value, now).run()
  if (!logged.meta.changes) return false
  const better = limits.order === 'asc' ? '<' : '>'
  const order = bestOrder(mode)
  await saveWithKnockouts(env, {
    game: 'darts',
    detail: `${MODE_NAMES[mode]} · ${BOARD_NAMES[board]}`,
    scorer: user,
    top: () => env.DB.prepare(`SELECT id, user_id FROM darts_bests WHERE board = ? AND mode = ? ORDER BY value ${order}, times DESC, set_at ASC, id ASC LIMIT ${NOTICE_PLACES}`).bind(board, mode),
  }, () => env.DB.prepare(`INSERT INTO darts_bests (id, user_id, username, board, mode, value, times, set_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      times = CASE WHEN excluded.value ${better} darts_bests.value THEN 1 WHEN excluded.value = darts_bests.value THEN darts_bests.times + 1 ELSE darts_bests.times END,
      set_at = CASE WHEN excluded.value ${better} darts_bests.value THEN excluded.set_at ELSE darts_bests.set_at END,
      value = CASE WHEN excluded.value ${better} darts_bests.value THEN excluded.value ELSE darts_bests.value END,
      username = excluded.username,
      updated_at = excluded.updated_at`)
    .bind(`${user.id}:${board}:${mode}`, user.id, user.username, board, mode, value, now, now).run())
  return true
}

/** Adds one finished match's darts and points (or marks) to a player's all-time average. */
export async function saveDartsAverage(env: Env, user: DartsScorer, board: BoardKind, mode: AverageMode, darts: number, total: number, run: string) {
  if (!Number.isInteger(darts) || !Number.isInteger(total) || darts < 1 || darts > 5000 || total < 0 || total > maxAverageTotal(mode, darts)) return false
  await ensureDartsTables(env)
  const now = Date.now()
  const logged = await env.DB.prepare('INSERT INTO darts_matches (id, user_id, board, mode, darts, total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
    .bind(`${user.id}:${run}`, user.id, board, mode, darts, total, now).run()
  if (!logged.meta.changes) return false
  await env.DB.prepare(`INSERT INTO darts_averages (id, user_id, username, board, mode, darts, total, matches, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET darts = darts_averages.darts + excluded.darts, total = darts_averages.total + excluded.total,
      matches = darts_averages.matches + 1, username = excluded.username, updated_at = excluded.updated_at`)
    .bind(`${user.id}:${board}:${mode}`, user.id, user.username, board, mode, darts, total, now).run()
  return true
}

type BestRow = { username: string; value: number; times: number; set_at: number }
type AverageRow = { username: string; darts: number; total: number; matches: number }

/** The record book for one board and format: everyone's best (ties broken by how many times they've done it, then who did it first), the top five all-time averages, and the signed-in player's own best and average. */
export async function dartsBoard(env: Env, board: BoardKind, mode: RecordMode, userId: string | null) {
  await ensureDartsTables(env)
  const order = bestOrder(mode)
  const averageMode = mode === 'countup' ? null : mode
  const [bests, averages, mine, myAverage] = await Promise.all([
    env.DB.prepare(`SELECT COALESCE(u.username, b.username) AS username, b.value, b.times, b.set_at FROM darts_bests b
      LEFT JOIN users u ON u.id = b.user_id
      WHERE b.board = ? AND b.mode = ? ORDER BY b.value ${order}, b.times DESC, b.set_at ASC, b.id ASC LIMIT 10`).bind(board, mode).all<BestRow>(),
    averageMode
      ? env.DB.prepare(`SELECT COALESCE(u.username, a.username) AS username, a.darts, a.total, a.matches FROM darts_averages a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE a.board = ? AND a.mode = ? AND a.darts >= ?
        ORDER BY (CAST(a.total AS REAL) / a.darts) DESC, a.darts DESC LIMIT 5`).bind(board, averageMode, AVERAGE_MIN_DARTS).all<AverageRow>()
      : Promise.resolve({ results: [] as AverageRow[] }),
    userId ? env.DB.prepare('SELECT value, times FROM darts_bests WHERE id = ?').bind(`${userId}:${board}:${mode}`).first<{ value: number; times: number }>() : Promise.resolve(null),
    userId && averageMode ? env.DB.prepare('SELECT darts, total, matches FROM darts_averages WHERE id = ?').bind(`${userId}:${board}:${averageMode}`).first<{ darts: number; total: number; matches: number }>() : Promise.resolve(null),
  ])
  return {
    board,
    mode,
    records: bests.results.map(row => ({ username: row.username, value: row.value, times: row.times, date: new Date(row.set_at).toISOString() })),
    averages: averages.results.map(row => ({ username: row.username, darts: row.darts, total: row.total, matches: row.matches, average: averageMode ? Number(averageValue(averageMode, row.darts, row.total).toFixed(2)) : 0 })),
    you: userId ? { best: mine?.value ?? null, times: mine?.times ?? 0, darts: myAverage?.darts ?? 0, total: myAverage?.total ?? 0, matches: myAverage?.matches ?? 0 } : null,
    signedIn: Boolean(userId),
  }
}

/** All-time totals for a few named players in one board and format (the in-match All-Time Averages panel). */
export async function dartsPlayerAverages(env: Env, board: BoardKind, mode: AverageMode, usernames: string[]) {
  await ensureDartsTables(env)
  const names = [...new Set(usernames.map(name => name.toLowerCase()))].slice(0, 4)
  if (!names.length) return {}
  const rows = await env.DB.prepare(`SELECT u.username AS username, a.darts, a.total, a.matches FROM darts_averages a
    JOIN users u ON u.id = a.user_id
    WHERE a.board = ? AND a.mode = ? AND u.username IN (${names.map(() => '?').join(', ')})`).bind(board, mode, ...names).all<AverageRow>()
  return Object.fromEntries(rows.results.map(row => [row.username, { darts: row.darts, total: row.total, matches: row.matches }]))
}

export async function resetDartsRecords(env: Env, board: BoardKind, mode: RecordMode) {
  await ensureDartsTables(env)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM darts_bests WHERE board = ? AND mode = ?').bind(board, mode),
    env.DB.prepare('DELETE FROM darts_legs WHERE board = ? AND mode = ?').bind(board, mode),
    env.DB.prepare('DELETE FROM darts_averages WHERE board = ? AND mode = ?').bind(board, mode),
    env.DB.prepare('DELETE FROM darts_matches WHERE board = ? AND mode = ?').bind(board, mode),
  ])
}
