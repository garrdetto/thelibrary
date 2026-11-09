import { z } from 'zod'
import type { Env } from '../env.js'
import { json, parseStored, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { canResetRecords } from '../records.js'
import { NOTICE_PLACES, saveWithKnockouts } from '../score-notices.js'
import { fairwayBoardLimits, fairwayBoards } from '../../lib/fairway.js'
import type { FairwayBoard } from '../../lib/fairway.js'

const boardIds = z.enum(fairwayBoards)
const boardNames: Record<FairwayBoard, string> = { round: 'Round', pin: 'Closest to the pin', match: 'Online match' }
const detailSchema = z.record(z.string().max(40), z.unknown()).refine(detail => JSON.stringify(detail).length <= 2000)

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('record'), board: boardIds, value: z.number().int(), run: z.string().uuid(), detail: detailSchema.optional() })
    .refine(input => input.value >= fairwayBoardLimits[input.board].min && input.value <= fairwayBoardLimits[input.board].max),
  z.object({ action: z.literal('reset-records'), board: boardIds, password: z.string().min(1).max(128).optional() }),
])

let tableReady: Promise<unknown> | null = null

function ensureTable(env: Env) {
  tableReady ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS fairway_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      board TEXT NOT NULL CHECK(board IN ('round','pin','match')),
      value INTEGER NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS fairway_records_board_value_idx ON fairway_records (board, value)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS fairway_records_board_user_idx ON fairway_records (board, user_id)'),
  ]).catch(error => {
    tableReady = null
    throw error
  })
  return tableReady
}

type RecordRow = { username: string; value: number; detail: string | null; created_at: number }

async function board(env: Env, id: FairwayBoard, userId: string | null) {
  const [rows, personal] = await Promise.all([
    env.DB.prepare(`SELECT COALESCE(u.username, r.username) AS username, r.value, r.detail, r.created_at FROM fairway_records r
      LEFT JOIN users u ON u.id = r.user_id
      WHERE r.board = ? ORDER BY r.value ASC, r.created_at ASC, r.id ASC LIMIT 20`).bind(id).all<RecordRow>(),
    userId ? env.DB.prepare('SELECT MIN(value) AS best FROM fairway_records WHERE board = ? AND user_id = ?').bind(id, userId).first<{ best: number | null }>() : Promise.resolve(null),
  ])
  return {
    board: id,
    records: rows.results.map(row => ({ username: row.username, value: row.value, detail: parseStored<Record<string, unknown> | null>(row.detail, null), date: new Date(row.created_at).toISOString() })),
    personalBest: personal?.best ?? null,
    signedIn: Boolean(userId),
  }
}

export async function fairway(request: Request, env: Env) {
  await ensureTable(env)
  if (request.method === 'GET') {
    const id = boardIds.parse(new URL(request.url).searchParams.get('board') ?? 'round')
    const user = await currentUser(request, env)
    return json(await board(env, id, user?.id ?? null))
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to save your results to the record book.')
  const input = actions.parse(await readJson(request, 3000))
  if (input.action === 'reset-records') {
    if (!await canResetRecords(user, input.password)) return json({ error: 'Only the administrator can reset records.' }, 403)
    await env.DB.prepare('DELETE FROM fairway_records WHERE board = ?').bind(input.board).run()
    return json({ reset: true })
  }
  await saveWithKnockouts(env, {
    game: 'fairway',
    detail: boardNames[input.board],
    scorer: user,
    top: () => env.DB.prepare(`SELECT id, user_id FROM fairway_records WHERE board = ? ORDER BY value ASC, created_at ASC, id ASC LIMIT ${NOTICE_PLACES}`).bind(input.board),
  }, () => env.DB.prepare('INSERT INTO fairway_records (id, user_id, username, board, value, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
    .bind(`${user.id}:${input.run}`, user.id, user.username, input.board, input.value, input.detail ? JSON.stringify(input.detail) : null, Date.now()).run())
  return json({ saved: true })
}
