import { z } from 'zod'
import type { Env } from '../env'
import { binary, json, parseStored, readJson, requireSameOrigin } from '../http'
import { currentUser, requireUser } from '../auth'
import { canResetRecords } from '../records'
import { base64ToBytes } from '../gemini'
import { issueTicket, redeemTicket } from './account'
import { decodeSave, ensureParkSaves, isScoredPark, parkInSave, upsertParkSave } from '../park-saves'

const TICKET_PREFIX = 'park:'
const SHOT_MIME = new Set(['image/jpeg', 'image/webp', 'image/png'])
const scenario = z.string().regex(/^[a-zA-Z]{1,32}$/)
const parkId = z.string().regex(/^[a-f0-9-]{32,36}$/i)
const saveData = z.string().regex(/^[A-Za-z0-9+/=]+$/).min(16).max(1_000_000)
const money = z.number().int().min(-1_000_000_000).max(10_000_000_000)
const summary = z.object({ cash: z.number(), netWorth: money.optional(), companyValue: money.optional(), guests: z.number().int().min(0).max(100000), rating: z.number().min(0).max(1000), date: z.string().max(40), mode: z.enum(['solo', 'coop', 'versus']) }).strict()

const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ticket') }),
  z.object({ action: z.literal('save'), parkId: parkId.optional(), slot: z.number().int().optional(), name: z.string().trim().min(1).max(40), scenario, data: saveData, summary }),
  z.object({ action: z.literal('delete'), parkId }),
  z.object({ action: z.literal('score'), parkId, scenario, value: money, parkName: z.string().trim().min(1).max(40), data: saveData.optional() }),
  z.object({ action: z.literal('shot'), parkId, scenario, mime: z.string().refine(value => SHOT_MIME.has(value)), image: z.string().regex(/^[A-Za-z0-9+/=]+$/).min(64).max(2_000_000) }),
  z.object({ action: z.literal('reset-scores'), scenario, password: z.string().min(1).max(128).optional() }),
])

const shotKey = (id: string) => `park-shot/${id.toLowerCase()}`

let tablesReady: Promise<void> | null = null

async function createScoreTables(env: Env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS park_scoreboard_resets (scenario TEXT PRIMARY KEY NOT NULL, reset_at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS park_scores_by_park (park_id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, scenario TEXT NOT NULL, username TEXT NOT NULL, park_name TEXT NOT NULL, value INTEGER NOT NULL, updated_at INTEGER NOT NULL, saved_at INTEGER, snapshot TEXT, shot_at INTEGER)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS park_scores_by_park_scenario_value_idx ON park_scores_by_park (scenario, value DESC, saved_at DESC)'),
  ])
  const columns = await env.DB.prepare("SELECT name FROM pragma_table_info('park_scores_by_park')").all<{ name: string }>()
  if (!columns.results.some(column => column.name === 'shot_at')) {
    try { await env.DB.prepare('ALTER TABLE park_scores_by_park ADD COLUMN shot_at INTEGER').run() }
    catch (error) { if (!String(error).includes('duplicate column')) throw error }
  }
}

function ensureScoreTables(env: Env) {
  tablesReady ??= createScoreTables(env).catch(error => { tablesReady = null; throw error })
  return tablesReady
}

async function scoreboardResetAt(env: Env, map: string) {
  const reset = await env.DB.prepare('SELECT reset_at FROM park_scoreboard_resets WHERE scenario = ?').bind(map).first<{ reset_at: number }>()
  return reset?.reset_at ?? 0
}

type ScoreRow = { park_id: string; username: string; park_name: string; value: number; updated_at: number; saved_at: number | null; shot_at: number | null; explorable: number }

async function scoreboard(env: Env, map: string, userId: string | null) {
  const resetAt = await scoreboardResetAt(env, map)
  const rows = await env.DB.prepare('SELECT park_id, username, park_name, value, updated_at, saved_at, shot_at, snapshot IS NOT NULL AS explorable FROM park_scores_by_park WHERE scenario = ? AND updated_at > ? ORDER BY value DESC, saved_at DESC LIMIT 10').bind(map, resetAt).all<ScoreRow>()
  return {
    scenario: map,
    records: rows.results.map(row => ({
      parkId: row.park_id,
      username: row.username,
      parkName: row.park_name,
      value: row.value,
      date: new Date(row.updated_at).toISOString(),
      savedAt: new Date(row.saved_at ?? row.updated_at).toISOString(),
      shot: row.shot_at ? `/api/park?shot=${encodeURIComponent(row.park_id)}&v=${row.shot_at}` : null,
      viewable: Boolean(row.explorable),
    })),
    signedIn: Boolean(userId),
  }
}

export async function park(request: Request, env: Env) {
  const url = new URL(request.url)
  if (request.method === 'POST' && url.searchParams.get('action') === 'redeem') {
    const ticket = await redeemTicket(request, env, TICKET_PREFIX)
    return json({ id: ticket.user_id, username: ticket.username })
  }
  if (request.method === 'GET' && url.searchParams.has('shot')) {
    const id = parkId.parse(url.searchParams.get('shot'))
    const stored = await env.FILES.getWithMetadata<{ mime?: string }>(shotKey(id), 'arrayBuffer')
    if (!stored.value) return json({ error: 'That park has no screenshot yet.' }, 404)
    return binary(stored.value, stored.metadata?.mime && SHOT_MIME.has(stored.metadata.mime) ? stored.metadata.mime : 'image/jpeg')
  }
  if (request.method === 'GET' && url.searchParams.has('scores')) {
    await ensureScoreTables(env)
    await ensureParkSaves(env)
    const user = await currentUser(request, env)
    return json(await scoreboard(env, scenario.parse(url.searchParams.get('scores')), user?.id ?? null))
  }
  if (request.method === 'GET' && url.searchParams.has('view')) {
    await ensureScoreTables(env)
    await ensureParkSaves(env)
    const map = scenario.parse(url.searchParams.get('view'))
    const id = parkId.parse(url.searchParams.get('park'))
    const resetAt = await scoreboardResetAt(env, map)
    const row = await env.DB.prepare('SELECT username, park_name, updated_at, saved_at, snapshot FROM park_scores_by_park WHERE park_id = ? AND scenario = ? AND updated_at > ?').bind(id, map, resetAt).first<{ username: string; park_name: string; saved_at: number | null; updated_at: number; snapshot: string | null }>()
    if (!row?.snapshot) return json({ error: 'That park has no viewable save yet.' }, 404)
    return json({ username: row.username, parkName: row.park_name, scenario: map, savedAt: new Date(row.saved_at ?? row.updated_at).toISOString(), data: row.snapshot })
  }
  const user = await requireUser(request, env, 'Sign in with your account to save parks and play online.')
  if (request.method === 'GET') {
    await ensureScoreTables(env)
    await ensureParkSaves(env)
    if (url.searchParams.has('saves')) {
      const rows = await env.DB.prepare('SELECT park_id, name, scenario, summary, updated_at FROM park_saves_by_park WHERE user_id = ? ORDER BY updated_at DESC').bind(user.id).all<{ park_id: string; name: string; scenario: string; summary: string; updated_at: number }>()
      return json({ saves: rows.results.map(row => ({ parkId: row.park_id, name: row.name, scenario: row.scenario, summary: parseStored(row.summary, {}), updated: new Date(row.updated_at).toISOString() })) })
    }
    const wanted = parkId.parse(url.searchParams.get('load')).toLowerCase()
    const row = await env.DB.prepare('SELECT name, data FROM park_saves_by_park WHERE user_id = ? AND park_id = ?').bind(user.id, wanted).first<{ name: string; data: string }>()
    if (!row) return json({ error: 'That park is not saved to your account.' }, 404)
    return json({ name: row.name, data: row.data })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const input = actions.parse(await readJson(request, 2_100_000))
  if (input.action === 'ticket') return json({ ticket: await issueTicket(env, user.id, user.username, TICKET_PREFIX) })
  if (input.action === 'delete') {
    await ensureScoreTables(env)
    await ensureParkSaves(env)
    const id = input.parkId.toLowerCase()
    const scored = await env.DB.prepare('SELECT shot_at FROM park_scores_by_park WHERE park_id = ? AND user_id = ?').bind(id, user.id).first<{ shot_at: number | null }>()
    await env.DB.batch([
      env.DB.prepare('DELETE FROM park_saves_by_park WHERE user_id = ? AND park_id = ?').bind(user.id, id),
      env.DB.prepare('DELETE FROM park_scores_by_park WHERE park_id = ? AND user_id = ?').bind(id, user.id),
    ])
    if (scored) await env.FILES.delete(shotKey(id))
    return json({ deleted: true })
  }
  if (input.action === 'score') {
    await ensureScoreTables(env)
    const resetAt = await scoreboardResetAt(env, input.scenario)
    const savedAt = Math.max(Date.now(), resetAt + 1)
    await env.DB.prepare(`INSERT INTO park_scores_by_park (park_id, user_id, scenario, username, park_name, value, updated_at, saved_at, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(park_id) DO UPDATE SET username = excluded.username, park_name = excluded.park_name,
        value = excluded.value,
        updated_at = excluded.updated_at, saved_at = excluded.saved_at,
        snapshot = COALESCE(excluded.snapshot, park_scores_by_park.snapshot)
      WHERE park_scores_by_park.user_id = excluded.user_id AND park_scores_by_park.scenario = excluded.scenario`)
      .bind(input.parkId.toLowerCase(), user.id, input.scenario, user.username, input.parkName, input.value, savedAt, savedAt, input.data ?? null).run()
    return json(await scoreboard(env, input.scenario, user.id))
  }
  if (input.action === 'shot') {
    await ensureScoreTables(env)
    const id = input.parkId.toLowerCase()
    const owned = await env.DB.prepare('SELECT 1 AS present FROM park_scores_by_park WHERE park_id = ? AND user_id = ? AND scenario = ?').bind(id, user.id, input.scenario).first<{ present: number }>()
    if (!owned) return json({ error: 'Save this park before adding its screenshot.' }, 404)
    const bytes = base64ToBytes(input.image)
    if (bytes.byteLength > 1_500_000) return json({ error: 'That screenshot is too large.' }, 413)
    await env.FILES.put(shotKey(id), bytes, { metadata: { mime: input.mime } })
    await env.DB.prepare('UPDATE park_scores_by_park SET shot_at = ? WHERE park_id = ? AND user_id = ?').bind(Date.now(), id, user.id).run()
    return json(await scoreboard(env, input.scenario, user.id))
  }
  if (input.action === 'reset-scores') {
    if (!await canResetRecords(user, input.password)) return json({ error: 'Only the administrator can reset records.' }, 403)
    await ensureScoreTables(env)
    await env.DB.prepare('INSERT INTO park_scoreboard_resets (scenario, reset_at) VALUES (?, ?) ON CONFLICT(scenario) DO UPDATE SET reset_at = excluded.reset_at').bind(input.scenario, Date.now()).run()
    return json({ reset: true })
  }
  await ensureScoreTables(env)
  await ensureParkSaves(env)
  const saved = parkInSave(await decodeSave(input.data), input.parkId, input.name)
  await upsertParkSave(env, user.id, { ...saved, summary: { ...saved.summary, ...input.summary } }, input.data, Date.now()).run()
  return json({ saved: true, parkId: saved.parkId, scored: isScoredPark(saved) })
}
