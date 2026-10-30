import { z } from 'zod'
import type { Env } from '../env'
import { json, readJson, requireSameOrigin } from '../http'
import { currentUser, requireUser } from '../auth'
import { canResetRecords } from '../records'
import { scoredModules } from '../../lib/module-scores'
import type { ScoredModuleId } from '../../lib/module-scores'

const moduleIds = z.enum(Object.keys(scoredModules) as [ScoredModuleId, ...ScoredModuleId[]])

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('score'), module: moduleIds, value: z.number().int(), run: z.string().uuid() })
    .refine(input => input.value >= scoredModules[input.module].min && input.value <= scoredModules[input.module].max),
  z.object({ action: z.literal('reset-records'), module: moduleIds, password: z.string().min(1).max(128).optional() }),
])

function leaderboardQuery(module: ScoredModuleId) {
  const direction = scoredModules[module].order === 'asc' ? 'ASC' : 'DESC'
  return `SELECT COALESCE(u.username, s.username) AS username, s.value, s.created_at FROM module_scores s
  LEFT JOIN users u ON u.id = s.user_id
  WHERE s.module = ? ORDER BY s.value ${direction}, s.created_at ASC, s.id ASC LIMIT 10`
}

export async function moduleScores(request: Request, env: Env) {
  if (request.method === 'GET') {
    const module = moduleIds.parse(new URL(request.url).searchParams.get('module'))
    const user = await currentUser(request, env)
    const aggregate = scoredModules[module].order === 'asc' ? 'MIN' : 'MAX'
    const [rows, personal] = await Promise.all([
      env.DB.prepare(leaderboardQuery(module)).bind(module).all<{ username: string; value: number; created_at: number }>(),
      user ? env.DB.prepare(`SELECT ${aggregate}(value) AS best FROM module_scores WHERE module = ? AND user_id = ?`).bind(module, user.id).first<{ best: number | null }>() : Promise.resolve(null),
    ])
    return json({ module, records: rows.results.map(row => ({ username: row.username, value: row.value, date: new Date(row.created_at).toISOString() })), personalBest: personal?.best ?? null, signedIn: Boolean(user) })
  }
  requireSameOrigin(request)
  const user = await requireUser(request, env, 'Sign in to save your scores to the leaderboard.')
  const input = actions.parse(await readJson(request, 500))
  if (input.action === 'reset-records') {
    if (!await canResetRecords(user, input.password)) return json({ error: 'Only the administrator can reset records.' }, 403)
    await env.DB.prepare('DELETE FROM module_scores WHERE module = ?').bind(input.module).run()
    return json({ reset: true })
  }
  await env.DB.prepare('INSERT INTO module_scores (id, user_id, username, module, value, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
    .bind(`${user.id}:${input.run}`, user.id, user.username, input.module, input.value, Date.now()).run()
  return json({ saved: true })
}
