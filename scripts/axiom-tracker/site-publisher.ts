import { liveFiguresOf, type RadarHistoryPoint, type RadarLiveFigures, type RadarPayload, type RadarTokenDetail } from '../../src/lib/axiom-radar-types.js'
import { openTrackerDatabase, recordHeartbeat, type TrackerDatabase } from './db.js'
import { buildRadarPayload, buildTokenDetail } from './radar-query.js'
import { abandonIfHung, createLogger, errorMessage, isMainModule, sleep } from './runtime.js'
import { applyRadarSettings } from './settings-store.js'

const logger = createLogger('site-publisher')
const watchingIntervalMs = 1_000
const watchingPayloadMs = 3_000
const idleIntervalMs = 20_000
const watchingDetailsMs = 15_000
const idleDetailsMs = 120_000
const maxBodyBytes = 1_800_000
/** The site's ingest takes at most 160 coins; the list is already ordered pinned, then most watched. */
export const siteTokenLimit = 160
const sendLimitMs = 30_000

function thin<T>(items: T[], limit: number) {
  if (items.length <= limit) return items
  const step = items.length / limit
  return Array.from({ length: limit }, (_, index) => items[Math.min(items.length - 1, Math.round(index * step))])
}

export function compactPayload(payload: RadarPayload): RadarPayload {
  return { ...payload, tokens: payload.tokens.slice(0, siteTokenLimit).map(token => ({ ...token, history: thin<RadarHistoryPoint>(token.history, 45) })) }
}

const byteSize = (text: string) => Buffer.byteLength(text, 'utf8')

/** The first body, from fullest to leanest, that fits under the site's upload limit (measured in bytes, as the site measures it). */
export function fitBody(candidates: Array<() => unknown>, limit = maxBodyBytes) {
  for (const candidate of candidates) {
    const body = JSON.stringify(candidate())
    if (byteSize(body) <= limit) return body
  }
  return null
}

/** The payload with shorter histories and without the per-coin score trail, for when every Pulse coin will not fit otherwise. */
export function slimPayload(payload: RadarPayload, ledgersFor = Infinity): RadarPayload {
  const keep = new Set([...payload.tokens].sort((first, second) => second.score - first.score).slice(0, ledgersFor).map(token => token.mint))
  return { ...payload, tokens: payload.tokens.map(token => ({ ...token, ...(keep.has(token.mint) ? {} : { scoreLedger: undefined, spark: { fast: [], slow: [] } }), history: thin<RadarHistoryPoint>(token.history, 15), scoreTrail: token.scoreTrail ? { points: token.scoreTrail.points.slice(-30), changes: token.scoreTrail.changes.slice(-3) } : token.scoreTrail })) }
}

function slimLive(live: { at: number; tokens: Record<string, RadarLiveFigures> } | undefined) {
  if (!live) return live
  return { at: live.at, tokens: Object.fromEntries(Object.entries(live.tokens).map(([mint, figures]) => [mint, { ...figures, scoreLedger: undefined, scoreTrail: undefined }])) }
}

function collectDetails(database: TrackerDatabase, payload: RadarPayload, historyLimit: number) {
  const details: Record<string, RadarTokenDetail> = {}
  for (const token of payload.tokens) {
    const detail = buildTokenDetail(database, token.mint)
    if (detail) details[token.mint] = { ...detail, history: thin(detail.history, historyLimit), live: thin(detail.live, 90), token: { ...detail.token, history: thin(detail.token.history, 45), spark: { fast: [], slow: [] } } }
  }
  return details
}

function send(endpoint: string, token: string, body: string) {
  return abandonIfHung('site upload', sendLimitMs, async () => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body, signal: AbortSignal.timeout(15_000) })
    return { response, result: await response.json().catch(() => ({})) as { watching?: boolean; error?: string; settings?: unknown } }
  })
}

export function startSitePublisher(database: TrackerDatabase, signal: AbortSignal) {
  const token = process.env.AXIOM_RADAR_TOKEN?.trim() ?? ''
  const origin = (process.env.AXIOM_SITE_ORIGIN?.trim() || 'https://thelibrary.garrdetto.workers.dev').replace(/\/$/, '')
  if (token.length < 24) {
    logger.warn('AXIOM_RADAR_TOKEN is missing or shorter than 24 characters; nothing is sent to the site')
    recordHeartbeat(database, 'site-publisher', 'disabled', 'AXIOM_RADAR_TOKEN missing')
    return Promise.resolve()
  }
  const endpoint = `${origin}/api/admin/axiom/ingest`
  logger.info('Publishing radar updates to the site', { endpoint })
  return (async () => {
    let watching = false
    let lastDetailsAt = 0
    let lastPayloadAt = 0
    let liveSupported = true
    let liveRetryAt = 0
    let failures = 0
    while (!signal.aborted) {
      const started = Date.now()
      try {
        const full = buildRadarPayload(database)
        if (!liveSupported && started >= liveRetryAt) liveSupported = true
        const live = watching && liveSupported ? { at: full.generatedAt, tokens: Object.fromEntries(full.tokens.map(token => [token.mint, liveFiguresOf(token)])) } : undefined
        const payloadDue = !live || started - lastPayloadAt >= watchingPayloadMs
        const payload = compactPayload(full)
        const detailsDue = payloadDue && started - lastDetailsAt >= (watching ? watchingDetailsMs : idleDetailsMs)
        const body = fitBody(!payloadDue ? [() => ({ live }), () => ({ live: slimLive(live) })] : [
          ...(detailsDue ? [() => ({ payload, live, details: collectDetails(database, payload, 180) }), () => ({ payload, live, details: collectDetails(database, payload, 60) })] : []),
          () => ({ payload, live }),
          () => ({ payload }),
          () => ({ payload: slimPayload(payload) }),
          () => ({ payload: slimPayload(payload, 40) }),
        ])
        if (!body) throw new Error('The radar update is larger than the site accepts even after trimming')
        const { response, result } = await send(endpoint, token, body)
        if (result.settings) applyRadarSettings(result.settings)
        if (response.status === 400 && live) {
          liveSupported = false
          liveRetryAt = started + 10 * 60_000
          logger.info('The site does not take per-second updates yet; sending every 3 seconds until it is redeployed')
          continue
        }
        if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
        if (detailsDue && body.includes('"details"')) lastDetailsAt = started
        if (payloadDue) lastPayloadAt = started
        if (Boolean(result.watching) !== watching) logger.info(result.watching ? 'An admin is watching; sending viewers every second' : 'Nobody is watching; sending every 20 seconds')
        watching = Boolean(result.watching)
        failures = 0
        recordHeartbeat(database, 'site-publisher', 'ok', `${payload.tokens.length} coins sent${watching ? ', admin watching' : ''}`)
      } catch (error) {
        failures += 1
        recordHeartbeat(database, 'site-publisher', 'error', errorMessage(error))
        if (failures === 1 || failures % 10 === 0) logger.warn('Could not send the radar update to the site', { error: errorMessage(error), failures })
      }
      const interval = failures ? Math.min(60_000, 5_000 * failures) : !watching ? idleIntervalMs : liveSupported ? watchingIntervalMs : watchingPayloadMs
      await sleep(Math.max(250, interval - (Date.now() - started)), signal)
    }
  })()
}

if (isMainModule(import.meta.url)) {
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())
  void startSitePublisher(openTrackerDatabase(), controller.signal)
}
