import type { RadarHistoryPoint, RadarPayload, RadarTokenDetail } from '../../src/lib/axiom-radar-types.js'
import { openTrackerDatabase, recordHeartbeat, type TrackerDatabase } from './db.js'
import { buildRadarPayload, buildTokenDetail } from './radar-query.js'
import { createLogger, errorMessage, isMainModule, sleep } from './runtime.js'
import { applyRadarSettings } from './settings-store.js'

const logger = createLogger('site-publisher')
const watchingIntervalMs = 3_000
const idleIntervalMs = 20_000
const watchingDetailsMs = 15_000
const idleDetailsMs = 120_000
const maxBodyBytes = 1_800_000

function thin<T>(items: T[], limit: number) {
  if (items.length <= limit) return items
  const step = items.length / limit
  return Array.from({ length: limit }, (_, index) => items[Math.min(items.length - 1, Math.round(index * step))])
}

export function compactPayload(payload: RadarPayload): RadarPayload {
  return { ...payload, tokens: payload.tokens.map(token => ({ ...token, history: thin<RadarHistoryPoint>(token.history, 45) })) }
}

function collectDetails(database: TrackerDatabase, payload: RadarPayload, historyLimit: number) {
  const details: Record<string, RadarTokenDetail> = {}
  for (const token of payload.tokens) {
    const detail = buildTokenDetail(database, token.mint)
    if (detail) details[token.mint] = { ...detail, history: thin(detail.history, historyLimit), live: thin(detail.live, 90), token: { ...detail.token, history: thin(detail.token.history, 45), spark: { fast: [], slow: [] } } }
  }
  return details
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
    let failures = 0
    while (!signal.aborted) {
      const started = Date.now()
      try {
        const payload = compactPayload(buildRadarPayload(database))
        const detailsDue = started - lastDetailsAt >= (watching ? watchingDetailsMs : idleDetailsMs)
        let body = JSON.stringify(detailsDue ? { payload, details: collectDetails(database, payload, 180) } : { payload })
        if (body.length > maxBodyBytes && detailsDue) body = JSON.stringify({ payload, details: collectDetails(database, payload, 60) })
        if (body.length > maxBodyBytes) body = JSON.stringify({ payload })
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body, signal: AbortSignal.timeout(15_000) })
        const result = await response.json().catch(() => ({})) as { watching?: boolean; error?: string; settings?: unknown }
        if (result.settings) applyRadarSettings(result.settings)
        if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
        if (detailsDue && body.includes('"details"')) lastDetailsAt = started
        if (Boolean(result.watching) !== watching) logger.info(result.watching ? 'An admin is watching; sending every 3 seconds' : 'Nobody is watching; sending every 20 seconds')
        watching = Boolean(result.watching)
        failures = 0
        recordHeartbeat(database, 'site-publisher', 'ok', `${payload.tokens.length} coins sent${watching ? ', admin watching' : ''}`)
      } catch (error) {
        failures += 1
        recordHeartbeat(database, 'site-publisher', 'error', errorMessage(error))
        if (failures === 1 || failures % 10 === 0) logger.warn('Could not send the radar update to the site', { error: errorMessage(error), failures })
      }
      const interval = failures ? Math.min(60_000, 5_000 * failures) : watching ? watchingIntervalMs : idleIntervalMs
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
