import { z } from 'zod'
import type { Env } from '../env.js'
import { json, parseStored, readJson, readText, requireSameOrigin } from '../http.js'
import { currentUser } from '../auth.js'
import { readBotState, writeBotState } from '../axiom-bot-store.js'
import { tokenMatches } from './axiom-radar.js'
import { hostActions, hostOnlineWindowMs, pendingCommand, pulseFeeding, shownCommand, type HostCommand, type HostComponent, type HostReport, type HostView } from '../../lib/axiom-host.js'

const finite = z.number().finite()
const text = (max: number) => z.string().transform(value => value.slice(0, max))

const reportInput = z.object({
  at: finite,
  host: text(80),
  daemon: z.boolean(),
  probeAnswered: z.boolean(),
  apps: z.array(z.object({ name: text(60), status: text(30), uptimeMs: finite, restarts: finite, memoryMb: finite.nullable() })).max(20),
  lastAction: z.object({ at: finite, reason: text(200), outcome: text(400) }).nullable(),
})

const syncInput = z.object({
  report: reportInput.optional(),
  result: z.object({ id: z.string().max(40), status: z.enum(['running', 'done', 'failed']), output: text(1_500).nullable() }).optional(),
}).strict()

const commandInput = z.object({ action: z.enum(hostActions) }).strict()

async function storedCommand(env: Env) {
  return parseStored<HostCommand | null>((await readBotState(env, 'host-command'))?.value, null)
}

async function feedStatus(env: Env) {
  const row = await env.DB.prepare("SELECT json_extract(value, '$.components') AS components, json_array_length(json_extract(value, '$.tokens')) AS coins, updated_at FROM axiom_radar_state WHERE key = 'payload'")
    .first<{ components: string | null; coins: number | null; updated_at: number }>()
    .catch(error => { if (String(error).includes('no such table')) return null; throw error })
  return { at: row?.updated_at ?? null, coins: row?.coins ?? 0, components: parseStored<HostComponent[]>(row?.components, []) }
}

async function sync(request: Request, env: Env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  if (!await tokenMatches(request, env)) return json({ error: 'Unauthorized.' }, 401)
  const parsed = syncInput.safeParse(JSON.parse(await readText(request, 40_000)))
  if (!parsed.success) return json({ error: 'The tracker PC update could not be read.' }, 400)
  const now = Date.now()
  const { report, result } = parsed.data
  if (report) await writeBotState(env, 'host-report', JSON.stringify(report), now)
  let command = await storedCommand(env)
  if (result && command && command.id === result.id && command.status !== 'done' && command.status !== 'failed') {
    command = { ...command, status: result.status, output: result.output, startedAt: command.startedAt ?? now, finishedAt: result.status === 'running' ? null : now }
    await writeBotState(env, 'host-command', JSON.stringify(command), now)
  }
  return json({ ok: true, now, command: pendingCommand(command, now) })
}

async function view(env: Env): Promise<HostView> {
  const [row, command, feed] = await Promise.all([readBotState(env, 'host-report'), storedCommand(env), feedStatus(env)])
  const now = Date.now()
  return {
    now,
    online: Boolean(row && now - row.updated_at < hostOnlineWindowMs),
    reportedAt: row?.updated_at ?? null,
    report: parseStored<HostReport | null>(row?.value, null),
    command: shownCommand(command, now),
    feed,
  }
}

async function queue(request: Request, env: Env) {
  requireSameOrigin(request)
  const parsed = commandInput.safeParse(await readJson(request, 1_000))
  if (!parsed.success) return json({ error: 'That tracker command could not be read.' }, 400)
  const now = Date.now()
  const feed = await feedStatus(env)
  const command: HostCommand = {
    id: crypto.randomUUID(),
    action: parsed.data.action,
    openPulse: parsed.data.action === 'open-pulse' || (parsed.data.action === 'start' && !pulseFeeding(feed.components, now)),
    requestedAt: now,
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    output: null,
  }
  await writeBotState(env, 'host-command', JSON.stringify(command), now)
  return json(await view(env))
}

/**
 * Remote control of the Axiom tracker's PC.
 * POST `/api/admin/axiom/host/sync` (server-to-server, `Authorization: Bearer AXIOM_RADAR_TOKEN`): the watchdog on that PC sends what PM2
 * reports and the outcome of the command it ran, and receives the command waiting for it, if any.
 * GET `/api/admin/axiom/host` and POST `/api/admin/axiom/host/command` `{ action: 'start' | 'restart' | 'open-pulse' }` are owner only.
 */
export async function axiomHost(request: Request, env: Env) {
  const path = new URL(request.url).pathname
  if (path.endsWith('/sync')) return sync(request, env)
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return json({ error: 'This request is not allowed.' }, 403)
  const user = await currentUser(request, env)
  if (!user?.isOwner) return json({ error: 'Only the owner can control the tracker.' }, 403)
  if (path.endsWith('/command')) return request.method === 'POST' ? queue(request, env) : json({ error: 'Method not allowed.' }, 405)
  return request.method === 'GET' ? json(await view(env)) : json({ error: 'Method not allowed.' }, 405)
}
