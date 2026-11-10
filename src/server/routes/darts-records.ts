import { z } from 'zod'
import type { Env } from '../env.js'
import { json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { canResetRecords } from '../records.js'
import { dartsBoard, dartsPlayerAverages, resetDartsRecords, saveDartsAverage, saveDartsLeg } from '../darts-records.js'
import { AVERAGE_MODES, BOARD_KINDS, RECORD_MODES } from '../../../modules-src/darts/shared/Records'

const boards = z.enum(BOARD_KINDS)
const modes = z.enum(RECORD_MODES)
const averageModes = z.enum(AVERAGE_MODES)
const username = z.string().regex(/^[A-Za-z0-9_-]{3,20}$/)

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('leg'), board: boards, mode: modes, value: z.number().int().min(0).max(999_999), run: z.string().uuid() }),
  z.object({ action: z.literal('average'), board: boards, mode: averageModes, darts: z.number().int().min(1).max(5000), total: z.number().int().min(0).max(300_000), run: z.string().uuid() }),
  z.object({ action: z.literal('reset-records'), board: boards, mode: modes, password: z.string().min(1).max(128).optional() }),
])

/** `/api/darts-records`: the Darts record book per board (`steel`, `spider`) and format (`501`, `301`, `cricket`, `countup`). GET `?board=&mode=` (public) returns the best of every player (ties by how many times they did it) and the top five all-time averages; adding `&players=a,b` returns those players' all-time totals instead. POST (signed in, same-origin) `leg` saves a finished leg and `average` a finished match from the page (online rooms save their own results from the DartsRoom); `reset-records` is admin only. */
export async function dartsRecords(request: Request, env: Env) {
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams
    const board = boards.parse(params.get('board') ?? 'steel')
    const players = params.get('players')
    if (players !== null) {
      const mode = averageModes.parse(params.get('mode'))
      const names = players.split(',').map(name => name.trim()).filter(name => username.safeParse(name).success)
      return json({ board, mode, players: await dartsPlayerAverages(env, board, mode, names) }, 200, { 'cache-control': 'no-store' })
    }
    const mode = modes.parse(params.get('mode') ?? '501')
    const user = await currentUser(request, env)
    return json({ ...await dartsBoard(env, board, mode, user?.id ?? null), username: user?.username ?? null }, 200, { 'cache-control': 'no-store' })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to save your darts to the record book.')
  const input = actions.parse(await readJson(request, 1000))
  if (input.action === 'reset-records') {
    if (!await canResetRecords(user, input.password)) return json({ error: 'Only the administrator can reset records.' }, 403)
    await resetDartsRecords(env, input.board, input.mode)
    return json({ reset: true })
  }
  if (input.action === 'leg') return json({ saved: await saveDartsLeg(env, user, input.board, input.mode, input.value, input.run) })
  return json({ saved: await saveDartsAverage(env, user, input.board, input.mode, input.darts, input.total, input.run) })
}
