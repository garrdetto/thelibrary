import { z } from 'zod'
import type { Env } from '../env'
import { json, parseStored, readJson, requireSameOrigin } from '../http'
import { currentUser, requireUser } from '../auth'
import { canResetRecords } from '../records'
import { issueTicket, redeemTicket } from './account'

const TICKET_PREFIX = 'park:'
const slot = z.number().int().min(0).max(6)
const scenario = z.string().regex(/^[a-zA-Z]{1,32}$/)
const summary = z.object({ cash: z.number(), netWorth: z.number().int().min(-1_000_000_000).max(10_000_000_000), guests: z.number().int().min(0).max(100000), rating: z.number().min(0).max(1000), date: z.string().max(40), mode: z.enum(['solo', 'coop', 'versus']) }).strict()

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ticket') }),
  z.object({ action: z.literal('save'), slot, name: z.string().trim().min(1).max(40), scenario, data: z.string().regex(/^[A-Za-z0-9+/=]+$/).min(16).max(1_000_000), summary }),
  z.object({ action: z.literal('delete'), slot }),
  z.object({ action: z.literal('reset-scores'), scenario, password: z.string().min(1).max(128).optional() }),
])

async function savedNetWorth(env: Env, row: { user_id: string; slot: number; summary: string }) {
  const savedSummary = parseStored<Record<string, unknown>>(row.summary, {})
  if (typeof savedSummary.netWorth === 'number' && Number.isFinite(savedSummary.netWorth)) return Math.round(savedSummary.netWorth)
  const saved = await env.DB.prepare('SELECT data FROM park_saves WHERE user_id = ? AND slot = ?').bind(row.user_id, row.slot).first<{ data: string }>()
  if (!saved) return null
  try {
    const bytes = Uint8Array.from(atob(saved.data), character => character.charCodeAt(0))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    const data = await new Response(stream).json() as { parks?: { cash?: unknown; loan?: unknown }[] }
    const park = data.parks?.[0]
    if (typeof park?.cash !== 'number' || typeof park.loan !== 'number') throw new Error('Saved park finances are missing.')
    return Math.round(park.cash - park.loan)
  } catch (error) {
    console.error('Unable to read a saved park for its leaderboard value.', error)
    return null
  }
}

async function scoreboard(env: Env, map: string, userId: string | null) {
  const reset = await env.DB.prepare('SELECT reset_at FROM park_scoreboard_resets WHERE scenario = ?').bind(map).first<{ reset_at: number }>()
  const rows = await env.DB.prepare(`SELECT s.user_id, s.slot, s.summary, s.updated_at, u.username
    FROM park_saves s JOIN users u ON u.id = s.user_id
    WHERE s.scenario = ? AND s.updated_at > ? AND json_extract(s.summary, '$.mode') = 'solo'
    ORDER BY s.updated_at DESC, s.slot ASC`).bind(map, reset?.reset_at ?? 0)
    .all<{ user_id: string; slot: number; summary: string; updated_at: number; username: string }>()
  const latestParks = new Map<string, (typeof rows.results)[number]>()
  for (const row of rows.results) if (!latestParks.has(row.user_id)) latestParks.set(row.user_id, row)
  const currentParks = new Map<string, { username: string; value: number; updated_at: number }>()
  const savedValues = await Promise.all([...latestParks.values()].map(async row => ({ row, value: await savedNetWorth(env, row) })))
  for (const { row, value } of savedValues) {
    if (value === null) continue
    currentParks.set(row.user_id, { username: row.username, value, updated_at: row.updated_at })
  }
  const records = [...currentParks.values()].sort((a, b) => b.value - a.value || b.updated_at - a.updated_at)
  return {
    scenario: map,
    records: records.slice(0, 10).map(row => ({ username: row.username, value: row.value, date: new Date(row.updated_at).toISOString() })),
    personalBest: userId ? currentParks.get(userId)?.value ?? null : null,
    signedIn: Boolean(userId),
  }
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
  if (input.action === 'reset-scores') {
    if (!await canResetRecords(user, input.password)) return json({ error: 'Only the administrator can reset records.' }, 403)
    await env.DB.prepare('INSERT INTO park_scoreboard_resets (scenario, reset_at) VALUES (?, ?) ON CONFLICT(scenario) DO UPDATE SET reset_at = excluded.reset_at').bind(input.scenario, Date.now()).run()
    return json({ reset: true })
  }
  await env.DB.prepare('INSERT INTO park_saves (user_id, slot, name, scenario, summary, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, slot) DO UPDATE SET name = excluded.name, scenario = excluded.scenario, summary = excluded.summary, data = excluded.data, updated_at = excluded.updated_at')
    .bind(user.id, input.slot, input.name, input.scenario, JSON.stringify(input.summary), input.data, Date.now()).run()
  return json({ saved: true })
}
