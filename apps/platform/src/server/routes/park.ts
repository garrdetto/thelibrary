import { z } from 'zod'
import type { Env } from '../env'
import { json, parseStored, readJson, requireSameOrigin } from '../http'
import { currentUser, requireUser } from '../auth'
import { canResetRecords } from '../records'
import { issueTicket, redeemTicket } from './account'

const TICKET_PREFIX = 'park:'
const slot = z.number().int().min(0).max(6)
const scenario = z.string().regex(/^[a-zA-Z]{1,32}$/)
const summary = z.object({ cash: z.number(), guests: z.number().int().min(0).max(100000), rating: z.number().min(0).max(1000), date: z.string().max(40), mode: z.enum(['solo', 'coop', 'versus']) }).strict()

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ticket') }),
  z.object({ action: z.literal('save'), slot, name: z.string().trim().min(1).max(40), scenario, data: z.string().regex(/^[A-Za-z0-9+/=]+$/).min(16).max(1_000_000), summary }),
  z.object({ action: z.literal('delete'), slot }),
  z.object({ action: z.literal('score'), scenario, value: z.number().int().min(-1_000_000_000).max(10_000_000_000) }),
  z.object({ action: z.literal('reset-scores'), scenario, password: z.string().min(1).max(128).optional() }),
])

async function scoreboard(env: Env, map: string, userId: string | null) {
  const [rows, mine] = await Promise.all([
    env.DB.prepare('SELECT username, value, updated_at FROM park_scores WHERE scenario = ? ORDER BY value DESC, updated_at ASC LIMIT 10').bind(map).all<{ username: string; value: number; updated_at: number }>(),
    userId ? env.DB.prepare('SELECT value FROM park_scores WHERE scenario = ? AND user_id = ?').bind(map, userId).first<{ value: number }>() : Promise.resolve(null),
  ])
  return { scenario: map, records: rows.results.map(row => ({ username: row.username, value: row.value, date: new Date(row.updated_at).toISOString() })), personalBest: mine?.value ?? null, signedIn: Boolean(userId) }
}

export async function park(request: Request, env: Env) {
  const url = new URL(request.url)
  if (request.method === 'POST' && url.searchParams.get('action') === 'redeem') {
    const ticket = await redeemTicket(request, env, TICKET_PREFIX)
    return json({ id: ticket.user_id, username: ticket.username })
  }
  if (request.method === 'GET' && url.searchParams.has('scores')) {
    const user = await currentUser(request, env)
    return json(await scoreboard(env, scenario.parse(url.searchParams.get('scores')), user?.id ?? null))
  }
  const user = await requireUser(request, env, 'Sign in with your account to save parks and play online.')
  if (request.method === 'GET') {
    if (url.searchParams.has('saves')) {
      const rows = await env.DB.prepare('SELECT slot, name, scenario, summary, updated_at FROM park_saves WHERE user_id = ? ORDER BY slot').bind(user.id).all<{ slot: number; name: string; scenario: string; summary: string; updated_at: number }>()
      return json({ saves: rows.results.map(row => ({ slot: row.slot, name: row.name, scenario: row.scenario, summary: parseStored(row.summary, {}), updated: new Date(row.updated_at).toISOString() })) })
    }
    const wanted = slot.parse(Number(url.searchParams.get('slot')))
    const row = await env.DB.prepare('SELECT name, data FROM park_saves WHERE user_id = ? AND slot = ?').bind(user.id, wanted).first<{ name: string; data: string }>()
    if (!row) return json({ error: 'That save slot is empty.' }, 404)
    return json({ name: row.name, data: row.data })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const input = actions.parse(await readJson(request, 1_050_000))
  if (input.action === 'ticket') return json({ ticket: await issueTicket(env, user.id, user.username, TICKET_PREFIX) })
  if (input.action === 'delete') {
    await env.DB.prepare('DELETE FROM park_saves WHERE user_id = ? AND slot = ?').bind(user.id, input.slot).run()
    return json({ deleted: true })
  }
  if (input.action === 'score') {
    await env.DB.prepare('INSERT INTO park_scores (user_id, scenario, username, value, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, scenario) DO UPDATE SET username = excluded.username, updated_at = CASE WHEN excluded.value > park_scores.value THEN excluded.updated_at ELSE park_scores.updated_at END, value = MAX(park_scores.value, excluded.value)')
      .bind(user.id, input.scenario, user.username, input.value, Date.now()).run()
    return json(await scoreboard(env, input.scenario, user.id))
  }
  if (input.action === 'reset-scores') {
    if (!await canResetRecords(user, input.password)) return json({ error: 'Only the administrator can reset records.' }, 403)
    await env.DB.prepare('DELETE FROM park_scores WHERE scenario = ?').bind(input.scenario).run()
    return json({ reset: true })
  }
  await env.DB.prepare('INSERT INTO park_saves (user_id, slot, name, scenario, summary, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, slot) DO UPDATE SET name = excluded.name, scenario = excluded.scenario, summary = excluded.summary, data = excluded.data, updated_at = excluded.updated_at')
    .bind(user.id, input.slot, input.name, input.scenario, JSON.stringify(input.summary), input.data, Date.now()).run()
  return json({ saved: true })
}
