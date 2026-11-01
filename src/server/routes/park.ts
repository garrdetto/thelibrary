import { z } from 'zod'
import type { Env } from '../env'
import { json, parseStored, readJson, requireSameOrigin } from '../http'
import { currentUser, requireUser } from '../auth'
import { canResetRecords } from '../records'
import { issueTicket, redeemTicket } from './account'

const TICKET_PREFIX = 'park:'
const slot = z.number().int().min(0).max(6)
const scenario = z.string().regex(/^[a-zA-Z]{1,32}$/)
const saveData = z.string().regex(/^[A-Za-z0-9+/=]+$/).min(16).max(1_000_000)
const playerName = z.string().regex(/^[a-zA-Z0-9_-]{3,20}$/).transform(v => v.toLowerCase())
const summary = z.object({ cash: z.number(), netWorth: z.number().int().min(-1_000_000_000).max(10_000_000_000).optional(), guests: z.number().int().min(0).max(100000), rating: z.number().min(0).max(1000), date: z.string().max(40), mode: z.enum(['solo', 'coop', 'versus']) }).strict()

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ticket') }),
  z.object({ action: z.literal('save'), slot, name: z.string().trim().min(1).max(40), scenario, data: saveData, summary }),
  z.object({ action: z.literal('delete'), slot }),
  z.object({ action: z.literal('score'), parkId: z.string().regex(/^[a-f0-9-]{32,36}$/i), scenario, value: z.number().int().min(-1_000_000_000).max(10_000_000_000), parkName: z.string().trim().min(1).max(40), data: saveData.optional() }),
  z.object({ action: z.literal('reset-scores'), scenario, password: z.string().min(1).max(128).optional() }),
])

type ParkScoreSchema = { columns: Set<string>; hasResetTable: boolean; hasParkScoresTable: boolean }

async function parkScoreSchema(env: Env): Promise<ParkScoreSchema> {
  const [columns, resetTable, parkScoresTable] = await Promise.all([
    env.DB.prepare("SELECT name FROM pragma_table_info('park_scores')").all<{ name: string }>(),
    env.DB.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").bind('park_scoreboard_resets').first<{ present: number }>(),
    env.DB.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").bind('park_scores_by_park').first<{ present: number }>(),
  ])
  return { columns: new Set(columns.results.map(column => column.name)), hasResetTable: Boolean(resetTable), hasParkScoresTable: Boolean(parkScoresTable) }
}

async function scoreboardResetAt(env: Env, schema: ParkScoreSchema, map: string) {
  if (!schema.hasResetTable) return 0
  const reset = await env.DB.prepare('SELECT reset_at FROM park_scoreboard_resets WHERE scenario = ?').bind(map).first<{ reset_at: number }>()
  return reset?.reset_at ?? 0
}

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

async function scoreboard(env: Env, map: string, userId: string | null, schema: ParkScoreSchema) {
  if (!schema.columns.size) throw new Error('The park leaderboard table has not been installed.')
  const resetAt = await scoreboardResetAt(env, schema, map)
  if (schema.hasParkScoresTable) {
    const rows = await env.DB.prepare('SELECT park_id, username, park_name, value, updated_at, saved_at, snapshot IS NOT NULL AS viewable FROM park_scores_by_park WHERE scenario = ? AND updated_at > ? ORDER BY value DESC, saved_at DESC LIMIT 10').bind(map, resetAt).all<{ park_id: string; username: string; park_name: string; value: number; updated_at: number; saved_at: number; viewable: number }>()
    return {
      scenario: map,
      records: rows.results.map(row => ({ parkId: row.park_id, username: row.username, parkName: row.park_name, value: row.value, date: new Date(row.updated_at).toISOString(), savedAt: new Date(row.saved_at ?? row.updated_at).toISOString(), viewable: Boolean(row.viewable) })),
      signedIn: Boolean(userId),
    }
  }
  const parkName = schema.columns.has('park_name') ? 'park_name' : 'NULL AS park_name'
  const savedAt = schema.columns.has('saved_at') ? 'saved_at' : 'NULL AS saved_at'
  const rows = await env.DB.prepare(`SELECT username, ${parkName}, value, updated_at, ${savedAt} FROM park_scores WHERE scenario = ? AND updated_at > ? ORDER BY value DESC, updated_at DESC LIMIT 10`).bind(map, resetAt).all<{ username: string; park_name: string | null; value: number; updated_at: number; saved_at: number | null }>()
  return { scenario: map, records: rows.results.map(row => ({ parkId: null, username: row.username, parkName: row.park_name ?? 'Unnamed park', value: row.value, date: new Date(row.updated_at).toISOString(), savedAt: new Date(row.saved_at ?? row.updated_at).toISOString(), viewable: false })), signedIn: Boolean(userId) }
}

export async function park(request: Request, env: Env) {
  const url = new URL(request.url)
  if (request.method === 'POST' && url.searchParams.get('action') === 'redeem') {
    const ticket = await redeemTicket(request, env, TICKET_PREFIX)
    return json({ id: ticket.user_id, username: ticket.username })
  }
  if (request.method === 'GET' && url.searchParams.has('scores')) {
    const user = await currentUser(request, env)
    return json(await scoreboard(env, scenario.parse(url.searchParams.get('scores')), user?.id ?? null, await parkScoreSchema(env)))
  }
  if (request.method === 'GET' && url.searchParams.has('view')) {
    const map = scenario.parse(url.searchParams.get('view'))
    const schema = await parkScoreSchema(env)
    if (url.searchParams.has('park')) {
      if (!schema.hasParkScoresTable) return json({ error: 'Park viewing is unavailable until the leaderboard database update is applied.' }, 503)
      const parkId = z.string().regex(/^[a-f0-9-]{32,36}$/i).parse(url.searchParams.get('park'))
      const resetAt = await scoreboardResetAt(env, schema, map)
      const row = await env.DB.prepare('SELECT username, park_name, updated_at, saved_at, snapshot FROM park_scores_by_park WHERE park_id = ? AND scenario = ? AND updated_at > ?').bind(parkId, map, resetAt).first<{ username: string; park_name: string; saved_at: number | null; updated_at: number; snapshot: string | null }>()
      if (!row?.snapshot) return json({ error: 'That park has no viewable save yet.' }, 404)
      return json({ username: row.username, parkName: row.park_name, scenario: map, savedAt: new Date(row.saved_at ?? row.updated_at).toISOString(), data: row.snapshot })
    }
    const player = playerName.parse(url.searchParams.get('player'))
    if (!schema.columns.has('snapshot')) return json({ error: 'Park viewing is unavailable until the leaderboard database update is applied.' }, 503)
    const resetAt = await scoreboardResetAt(env, schema, map)
    const parkName = schema.columns.has('park_name') ? 'park_name' : 'NULL AS park_name'
    const savedAt = schema.columns.has('saved_at') ? 'saved_at' : 'NULL AS saved_at'
    const row = await env.DB.prepare(`SELECT username, ${parkName}, ${savedAt}, updated_at, snapshot FROM park_scores WHERE scenario = ? AND lower(username) = ? AND updated_at > ?`).bind(map, player, resetAt).first<{ username: string; park_name: string | null; saved_at: number | null; updated_at: number; snapshot: string | null }>()
    if (!row?.snapshot) return json({ error: 'That park has no viewable save yet.' }, 404)
    return json({ username: row.username, parkName: row.park_name ?? 'Unnamed park', scenario: map, savedAt: new Date(row.saved_at ?? row.updated_at).toISOString(), data: row.snapshot })
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
    const schema = await parkScoreSchema(env)
    if (!schema.columns.size) return json({ error: 'The park leaderboard database has not been installed.' }, 503)
    const resetAt = await scoreboardResetAt(env, schema, input.scenario)
    const savedAt = Math.max(Date.now(), resetAt + 1)
    if (schema.hasParkScoresTable) {
      await env.DB.prepare(`INSERT INTO park_scores_by_park (park_id, user_id, scenario, username, park_name, value, updated_at, saved_at, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(park_id) DO UPDATE SET username = excluded.username, park_name = excluded.park_name,
          value = excluded.value,
          updated_at = excluded.updated_at, saved_at = excluded.saved_at,
          snapshot = COALESCE(excluded.snapshot, park_scores_by_park.snapshot)
        WHERE park_scores_by_park.user_id = excluded.user_id AND park_scores_by_park.scenario = excluded.scenario`)
        .bind(input.parkId, user.id, input.scenario, user.username, input.parkName, input.value, savedAt, savedAt, input.data ?? null).run()
    } else if (['park_name', 'saved_at', 'snapshot'].every(column => schema.columns.has(column))) {
      await env.DB.prepare(`INSERT INTO park_scores (user_id, scenario, username, park_name, value, updated_at, saved_at, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, scenario) DO UPDATE SET username = excluded.username, park_name = excluded.park_name,
          value = excluded.value,
          updated_at = excluded.updated_at, saved_at = excluded.saved_at,
          snapshot = COALESCE(excluded.snapshot, park_scores.snapshot)`)
        .bind(user.id, input.scenario, user.username, input.parkName, input.value, savedAt, savedAt, input.data ?? null).run()
    } else {
      await env.DB.prepare(`INSERT INTO park_scores (user_id, scenario, username, value, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, scenario) DO UPDATE SET username = excluded.username,
          value = excluded.value,
          updated_at = excluded.updated_at
        `)
        .bind(user.id, input.scenario, user.username, input.value, savedAt).run()
    }
    return json(await scoreboard(env, input.scenario, user.id, schema))
  }
  if (input.action === 'reset-scores') {
    if (!await canResetRecords(user, input.password)) return json({ error: 'Only the administrator can reset records.' }, 403)
    const schema = await parkScoreSchema(env)
    if (!schema.hasResetTable) return json({ error: 'Leaderboard resets are unavailable until the database update is applied.' }, 503)
    await env.DB.prepare('INSERT INTO park_scoreboard_resets (scenario, reset_at) VALUES (?, ?) ON CONFLICT(scenario) DO UPDATE SET reset_at = excluded.reset_at').bind(input.scenario, Date.now()).run()
    return json({ reset: true })
  }
  await env.DB.prepare('INSERT INTO park_saves (user_id, slot, name, scenario, summary, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, slot) DO UPDATE SET name = excluded.name, scenario = excluded.scenario, summary = excluded.summary, data = excluded.data, updated_at = excluded.updated_at')
    .bind(user.id, input.slot, input.name, input.scenario, JSON.stringify(input.summary), input.data, Date.now()).run()
  return json({ saved: true })
}
