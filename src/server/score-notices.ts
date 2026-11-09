import type { D1PreparedStatement, Env } from './env.js'
import { learningModules } from '../lib/modules.js'

export const NOTICE_PLACES = 3

export type BoardEntry = { id: string; user_id: string }

export type KnockoutBoard = {
  game: string
  detail?: string
  scorer: { id: string; username: string }
  top: () => D1PreparedStatement
}

const extraTitles: Record<string, string> = { wpm: 'Words Per Minute', memory: 'Memory Match', simon: 'Echo Sequence', mathrush: 'Math Rush' }

export function gameTitle(game: string) {
  return learningModules.find(item => item.id === game)?.title ?? extraTitles[game] ?? game
}

let tableReady: Promise<unknown> | null = null

export function ensureNoticeTable(env: Env) {
  tableReady ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS score_notices (
      user_id TEXT NOT NULL,
      game TEXT NOT NULL,
      detail TEXT,
      by_username TEXT NOT NULL,
      place INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, game)
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS score_notices_user_idx ON score_notices (user_id, created_at)'),
  ]).catch(error => {
    tableReady = null
    throw error
  })
  return tableReady
}

async function topEntries(board: KnockoutBoard) {
  return (await board.top().all<BoardEntry>()).results.slice(0, NOTICE_PLACES)
}

export async function saveWithKnockouts<T>(env: Env, board: KnockoutBoard, write: () => Promise<T>): Promise<T> {
  const before = await topEntries(board).catch(() => null)
  const result = await write()
  if (!before?.length) return result
  try {
    const after = await topEntries(board)
    const rank = new Map(after.map((entry, index) => [entry.id, index]))
    const knocked = new Map<string, number>()
    before.forEach((entry, index) => {
      if (entry.user_id === board.scorer.id || knocked.has(entry.user_id)) return
      if ((rank.get(entry.id) ?? Infinity) > index) knocked.set(entry.user_id, index + 1)
    })
    if (!knocked.size) return result
    await ensureNoticeTable(env)
    const now = Date.now()
    await env.DB.batch([...knocked].map(([userId, place]) => env.DB.prepare(`INSERT INTO score_notices (user_id, game, detail, by_username, place, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, game) DO UPDATE SET detail = excluded.detail, by_username = excluded.by_username, place = excluded.place, created_at = excluded.created_at`)
      .bind(userId, board.game, board.detail ?? null, board.scorer.username, place, now)))
  } catch (error) {
    console.error('score notices', board.game, error)
  }
  return result
}
