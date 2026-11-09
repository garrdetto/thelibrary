import { z } from 'zod'
import type { Env } from '../env.js'
import { json, readJson, requireSameOrigin } from '../http.js'
import { currentUser, requireUser } from '../auth.js'
import { ensureNoticeTable, gameTitle } from '../score-notices.js'

const actions = z.object({ action: z.literal('clear'), game: z.string().min(1).max(40).optional() })

export async function scoreNotices(request: Request, env: Env) {
  if (request.method === 'GET') {
    const user = await currentUser(request, env)
    if (!user) return json({ signedIn: false, notices: [] })
    await ensureNoticeTable(env)
    const rows = await env.DB.prepare('SELECT game, detail, by_username, place, created_at FROM score_notices WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
      .bind(user.id).all<{ game: string; detail: string | null; by_username: string; place: number; created_at: number }>()
    return json({
      signedIn: true,
      notices: rows.results.map(row => ({ game: row.game, title: gameTitle(row.game), detail: row.detail, by: row.by_username, place: row.place, date: new Date(row.created_at).toISOString() })),
    })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to manage your notifications.')
  const input = actions.parse(await readJson(request, 500))
  await ensureNoticeTable(env)
  if (input.game) await env.DB.prepare('DELETE FROM score_notices WHERE user_id = ? AND game = ?').bind(user.id, input.game).run()
  else await env.DB.prepare('DELETE FROM score_notices WHERE user_id = ?').bind(user.id).run()
  return json({ cleared: true })
}
