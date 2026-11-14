import { z } from 'zod'
import type { Env } from '../env.js'
import { json, readJson, readText, requireSameOrigin } from '../http.js'
import { currentUser } from '../auth.js'
import { markRadarViewed, readRadarState, writeRadarState } from '../axiom-radar-store.js'
import { emptyRadarPayload, type RadarPayload } from '../../lib/axiom-radar-types.js'
import { normalizeRadarSettings, type RadarSettings } from '../../lib/axiom-radar-settings.js'

const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const mintQuery = z.string().regex(mintPattern)
const ingestLimit = 1_900_000
const liveWindowMs = 75_000
const offlineAfterMs = 5 * 60_000
const watchingWindowMs = 30_000
const streamIntervalMs = 3_000
const streamWindowMs = 55_000

const ingestInput = z.object({
  payload: z.object({
    status: z.enum(['live', 'stale', 'offline']),
    generatedAt: z.number(),
    tokens: z.array(z.object({ mint: z.string().regex(mintPattern) }).passthrough()).max(160),
    kpis: z.object({}).passthrough(),
    model: z.object({}).passthrough(),
    paper: z.object({}).passthrough(),
    components: z.array(z.object({}).passthrough()).max(30),
  }).passthrough(),
  details: z.record(z.string().regex(mintPattern), z.object({}).passthrough()).optional(),
}).strict()

async function tokenMatches(request: Request, env: Env) {
  const expected = env.AXIOM_RADAR_TOKEN?.trim()
  const header = request.headers.get('authorization') ?? ''
  if (!expected || expected.length < 24 || !header.startsWith('Bearer ')) return false
  const encoder = new TextEncoder()
  const [presented, wanted] = await Promise.all([header.slice(7), expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))))
  const left = new Uint8Array(presented)
  const right = new Uint8Array(wanted)
  let difference = 0
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index]
  return difference === 0
}

async function ingest(request: Request, env: Env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  if (!await tokenMatches(request, env)) return json({ error: 'Unauthorized.' }, 401)
  const parsed = ingestInput.safeParse(JSON.parse(await readText(request, ingestLimit)))
  if (!parsed.success) return json({ error: 'The radar update could not be read.' }, 400)
  const now = Date.now()
  await writeRadarState(env, 'payload', JSON.stringify(parsed.data.payload), now)
  if (parsed.data.details) await writeRadarState(env, 'details', JSON.stringify(parsed.data.details), now)
  const [viewed, settings] = await Promise.all([readRadarState(env, 'viewed'), savedSettings(env)])
  return json({ ok: true, watching: Boolean(viewed && now - viewed.updated_at < watchingWindowMs), settings })
}

async function savedSettings(env: Env): Promise<RadarSettings | null> {
  const row = await readRadarState(env, 'settings')
  if (!row) return null
  try { return normalizeRadarSettings(JSON.parse(row.value)) } catch { return null }
}

const requirementInput = z.object({ enabled: z.boolean(), value: z.number().finite() }).strict()
const settingsInput = z.object({
  maxAgeHours: requirementInput,
  minViewers: requirementInput,
  minVolume5m: requirementInput,
  minTxns5m: requirementInput,
  minLiquidity: requirementInput,
  minBuyPercent: requirementInput,
  safeOnly: z.boolean(),
  pulseBypassesMarket: z.boolean(),
  maxCoins: z.number().finite(),
  buy: z.object({ minScore: z.number().finite(), minGain1mPercent: z.number().finite(), minGain5mPercent: z.number().finite(), minViewers: z.number().finite(), requireSafe: z.boolean() }).strict(),
  watch: z.object({ minScore: z.number().finite(), minGain5mPercent: z.number().finite() }).strict(),
  surgeSensitivity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  wallets: z.object({ minRunnerHits: z.number().finite() }).strict(),
  pinned: z.array(z.string().regex(mintPattern)).max(50),
  updatedAt: z.number().nullable().optional(),
}).strict()

async function saveSettings(request: Request, env: Env) {
  requireSameOrigin(request)
  const parsed = settingsInput.safeParse(await readJson(request, 20_000))
  if (!parsed.success) return json({ error: 'Those radar settings could not be read.' }, 400)
  const now = Date.now()
  const settings = normalizeRadarSettings({ ...parsed.data, updatedAt: now })
  await writeRadarState(env, 'settings', JSON.stringify(settings), now)
  return json({ settings })
}

async function currentPayload(env: Env): Promise<RadarPayload> {
  const row = await readRadarState(env, 'payload')
  if (!row) return emptyRadarPayload('The tracker has not sent any data yet. Start it with `pnpm axiom:worker` or `pm2 start ecosystem.axiom.config.js` on your machine.')
  let payload: RadarPayload
  try { payload = JSON.parse(row.value) as RadarPayload } catch { return emptyRadarPayload('The last tracker update could not be read.') }
  const age = Date.now() - row.updated_at
  if (age < liveWindowMs) return payload
  const status = age < offlineAfterMs ? 'stale' : 'offline'
  const minutes = Math.max(1, Math.round(age / 60_000))
  return { ...payload, status, message: `The tracker last reported ${minutes} minute${minutes === 1 ? '' : 's'} ago. Check that the worker is running.` }
}

function stream(request: Request, env: Env) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const until = Date.now() + streamWindowMs
      controller.enqueue(encoder.encode('retry: 1500\n\n'))
      try {
        while (!request.signal.aborted) {
          await markRadarViewed(env)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...await currentPayload(env), savedSettings: await savedSettings(env), source: 'relay' })}\n\n`))
          if (Date.now() + streamIntervalMs > until) break
          await new Promise(resolve => setTimeout(resolve, streamIntervalMs))
        }
      } catch (error) {
        console.error('Axiom Radar stream failed', error)
      }
      controller.close()
    },
  })
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store, no-transform', 'X-Content-Type-Options': 'nosniff' } })
}

/**
 * POST `/api/admin/axiom/ingest` (server-to-server, `Authorization: Bearer AXIOM_RADAR_TOKEN`): the self-hosted tracker
 * pushes its latest payload (and per-token details) into D1 `axiom_radar_state`; the reply says whether an admin is watching.
 * GET `/api/admin/axiom/data` (admin) returns the payload, or `?mint=` token detail; `/api/admin/axiom/stream` sends it as SSE.
 */
export async function axiomRadar(request: Request, env: Env) {
  const url = new URL(request.url)
  if (url.pathname.endsWith('/ingest')) return ingest(request, env)
  if (request.method !== 'GET' && !(request.method === 'PUT' && url.pathname.endsWith('/settings'))) return json({ error: 'Method not allowed.' }, 405)
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return json({ error: 'This request is not allowed.' }, 403)
  const user = await currentUser(request, env)
  if (!user?.isAdmin) return json({ error: 'Administrator access required.' }, 403)

  if (url.pathname.endsWith('/settings')) {
    if (request.method === 'PUT') return saveSettings(request, env)
    return json({ settings: await savedSettings(env) })
  }
  if (url.pathname.endsWith('/stream')) return stream(request, env)
  await markRadarViewed(env)
  const mint = url.searchParams.get('mint')
  if (mint === null) return json({ ...await currentPayload(env), savedSettings: await savedSettings(env), source: 'relay' })
  if (!mintQuery.safeParse(mint).success) return json({ error: 'Invalid token address.' }, 400)
  const row = await readRadarState(env, 'details')
  let details: Record<string, unknown> = {}
  try { details = row ? JSON.parse(row.value) as Record<string, unknown> : {} } catch { details = {} }
  return details[mint] ? json(details[mint]) : json({ error: 'Details for this token have not arrived yet. Try again in a few seconds.' }, 404)
}
