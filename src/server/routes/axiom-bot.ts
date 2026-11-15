import { z } from 'zod'
import type { Env } from '../env.js'
import { json, parseStored, readJson, readText, requireSameOrigin } from '../http.js'
import { currentUser } from '../auth.js'
import { markRadarViewed, readRadarState } from '../axiom-radar-store.js'
import { mergeBotState, readBotState, writeBotState } from '../axiom-bot-store.js'
import { tokenMatches } from './axiom-radar.js'
import { cleanBotPatch, defaultBotValues, normalizeBotValues, type BotCommand, type BotReport, type BotSettings, type BotView } from '../../lib/axiom-bot.js'

const syncLimit = 400_000
const onlineWindowMs = 60_000
const futureStampMs = 60_000

const finite = z.number().finite()
const maybe = finite.nullable()
const text = (max: number) => z.string().max(max)
const dialValues = z.record(z.string().max(60), z.union([finite, z.boolean(), text(40)]))

const reportInput = z.object({
  version: text(20),
  at: finite,
  startedAt: finite,
  status: z.enum(['running', 'paused', 'holding']),
  note: text(300).nullable(),
  feed: z.object({ ageSeconds: maybe, live: z.boolean(), coins: finite }),
  account: z.object({
    startingCash: finite, cash: finite, positionsValue: finite, equity: finite, exposure: finite, exposureLimit: finite, unrealizedPnl: finite,
    totalPnl: finite, totalPnlPct: finite, peakEquity: finite, drawdownPct: finite, dayPnl: finite, dayPnlPct: finite,
  }),
  stats: z.object({
    trades: finite, wins: finite, losses: finite, winRate: maybe, realizedPnl: finite, averageReturnPct: maybe, bestPct: maybe, worstPct: maybe,
    profitFactor: maybe, averageHoldMinutes: maybe, feesPaid: finite, realizedPnlSol: finite.optional(), feesPaidSol: finite.optional(),
  }),
  accountSol: z.object({
    startingCash: finite, cash: finite, positionsValue: finite, equity: finite, exposure: finite, exposureLimit: finite, unrealizedPnl: finite,
    totalPnl: finite, peakEquity: finite, dayPnl: finite,
  }).optional(),
  solUsd: maybe.optional(),
  fees: z.object({ mode: text(20), source: text(80), prioritySol: finite, bribeSol: finite, totalSol: finite }).optional(),
  positions: z.array(z.object({
    id: finite, mint: text(60), symbol: text(40), pairAddress: text(60).nullable(), openedAt: finite, entryPrice: finite, price: finite, costUsd: finite,
    valueUsd: finite, pnlUsd: finite, pnlPct: finite, gainPct: finite, peakGainPct: finite, openPct: finite, stopPrice: maybe, targetDone: z.boolean(), score: finite, advice: text(20).nullable().optional(),
    costSol: finite.optional(), valueSol: finite.optional(), pnlSol: finite.optional(),
  })).max(60),
  trades: z.array(z.object({
    id: finite, mint: text(60), symbol: text(40), pairAddress: text(60).nullable(), openedAt: finite, closedAt: maybe, costUsd: finite, proceedsUsd: finite,
    pnlUsd: finite, pnlPct: finite, reason: text(200).nullable(), score: finite, holdMinutes: finite,
    costSol: finite.optional(), proceedsSol: finite.optional(), pnlSol: finite.optional(),
  })).max(80),
  equity: z.array(z.object({ t: finite, equity: finite, sol: finite.optional() })).max(200),
  events: z.array(z.object({ id: finite, t: finite, kind: text(20), text: text(400) })).max(60),
  candidates: z.array(z.object({ mint: text(60), symbol: text(40), score: finite, reason: text(200) })).max(20),
  strength: finite,
  settingsStamp: finite,
})

const syncInput = z.object({
  have: finite.optional(),
  fast: z.boolean().optional(),
  settingsStamp: finite.optional(),
  settings: z.object({ values: dialValues, updatedAt: finite }).strict().optional(),
  report: reportInput.optional(),
}).strict()

const settingsInput = z.object({ values: dialValues }).strict()
const commandInput = z.object({ action: z.enum(['flatten', 'reset']) }).strict()

async function savedSettings(env: Env): Promise<BotSettings> {
  const row = await readBotState(env, 'bot-settings')
  const stored = parseStored<Partial<BotSettings> | null>(row?.value, null)
  if (!stored) return { values: defaultBotValues, updatedAt: null }
  return { values: normalizeBotValues(stored.values), updatedAt: typeof stored.updatedAt === 'number' ? stored.updatedAt : null }
}

async function savedCommand(env: Env): Promise<BotCommand> {
  const stored = parseStored<Partial<BotCommand>>((await readBotState(env, 'bot-command'))?.value, {})
  return { flatten: typeof stored.flatten === 'number' ? stored.flatten : 0, reset: typeof stored.reset === 'number' ? stored.reset : 0 }
}

async function sync(request: Request, env: Env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  if (!await tokenMatches(request, env)) return json({ error: 'Unauthorized.' }, 401)
  const parsed = syncInput.safeParse(JSON.parse(await readText(request, syncLimit)))
  if (!parsed.success) return json({ error: 'The bot update could not be read.' }, 400)
  const input = parsed.data
  const now = Date.now()
  if (input.fast) await markRadarViewed(env, now)
  let settings = await savedSettings(env)
  if (input.settings && input.settings.updatedAt > (settings.updatedAt ?? 0)) {
    settings = { values: normalizeBotValues(input.settings.values), updatedAt: Math.min(input.settings.updatedAt, now + futureStampMs) }
    await writeBotState(env, 'bot-settings', JSON.stringify(settings), now)
  }
  if (input.report) await writeBotState(env, 'bot-report', JSON.stringify(input.report), now)
  const [row, command] = await Promise.all([readRadarState(env, 'payload'), savedCommand(env)])
  const newer = settings.updatedAt !== null && settings.updatedAt > (input.settingsStamp ?? 0)
  const head = JSON.stringify({ ok: true, now, payloadAt: row?.updated_at ?? null, settings: newer ? settings : null, command })
  const payload = row && row.updated_at !== input.have ? row.value : 'null'
  return new Response(`${head.slice(0, -1)},"payload":${payload}}`, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}

async function view(env: Env): Promise<BotView> {
  const [settings, row, command] = await Promise.all([savedSettings(env), readBotState(env, 'bot-report'), savedCommand(env)])
  const now = Date.now()
  return {
    settings,
    report: parseStored<BotReport | null>(row?.value, null),
    reportedAt: row?.updated_at ?? null,
    online: Boolean(row && now - row.updated_at < onlineWindowMs),
    command,
    now,
  }
}

async function saveSettings(request: Request, env: Env) {
  requireSameOrigin(request)
  const parsed = settingsInput.safeParse(await readJson(request, 20_000))
  if (!parsed.success) return json({ error: 'Those bot settings could not be read.' }, 400)
  const now = Date.now()
  await mergeBotState(env, 'bot-settings', JSON.stringify({ values: cleanBotPatch(parsed.data.values), updatedAt: now }), now)
  return json({ settings: await savedSettings(env) })
}

async function sendCommand(request: Request, env: Env) {
  requireSameOrigin(request)
  const parsed = commandInput.safeParse(await readJson(request, 1_000))
  if (!parsed.success) return json({ error: 'That bot command could not be read.' }, 400)
  const now = Date.now()
  const command = { ...await savedCommand(env), [parsed.data.action]: now }
  await writeBotState(env, 'bot-command', JSON.stringify(command), now)
  return json({ command })
}

/**
 * The Axiom paper-trading bot (`scripts/axiom-paper-bot`, Python, on the owner's machine).
 * POST `/api/admin/axiom/bot/sync` (server-to-server, `Authorization: Bearer AXIOM_RADAR_TOKEN`): the bot sends its report and any dials
 * changed in its settings file, and receives the latest Radar payload, dials saved on the page and pending commands.
 * GET `/api/admin/axiom/bot` (admin) returns the dials and the bot's last report; PUT `/bot/settings` merges the dials it is sent into the saved ones;
 * POST `/bot/command` `{ action: 'flatten' | 'reset' }` asks the bot to close every position or start the account again.
 */
export async function axiomBot(request: Request, env: Env) {
  const path = new URL(request.url).pathname
  if (path.endsWith('/sync')) return sync(request, env)
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return json({ error: 'This request is not allowed.' }, 403)
  const user = await currentUser(request, env)
  if (!user?.isAdmin) return json({ error: 'Administrator access required.' }, 403)
  if (path.endsWith('/settings')) return request.method === 'PUT' ? saveSettings(request, env) : json({ error: 'Method not allowed.' }, 405)
  if (path.endsWith('/command')) return request.method === 'POST' ? sendCommand(request, env) : json({ error: 'Method not allowed.' }, 405)
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405)
  return json(await view(env))
}
