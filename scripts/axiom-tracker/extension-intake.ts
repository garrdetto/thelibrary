import { mkdirSync, writeFileSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import { resolve } from 'node:path'
import { z } from 'zod'
import { extractViewerCounts, parseFrame } from './axiom-collector.js'
import { openTrackerDatabase, recordHeartbeat, type TrackerDatabase } from './db.js'
import { createLogger, errorMessage, isMainModule, isSolanaAddress, trackerConfig } from './runtime.js'
import { activeCandidates, trackerState } from './state.js'
import { buildRadarPayload, buildTokenDetail } from './radar-query.js'
import { compactPayload } from './site-publisher.js'
import { parsePulseCard } from './pulse-cards.js'
import { notePulseFlow, pulseIdentity } from './pulse-market.js'
import { applyPulseFeed, pulseFeedSchema, pulseFeedSeen } from './pulse-feed.js'
import { watchlistResult, watchlistStatus } from './watchlist.js'
import { needsPageRead, pageStatsFreshMs, pageStatsKeptMs, parsePageStats } from './page-stats.js'
import { capturedApiSchema, capturedStreamSchema, capturedTabsSchema, captureNote, notePollStats, pollNote, pollStatsSchema, storeCapture } from './axiom-capture.js'
import { applyAxiomLists, applyDiscoverPage, axiomListNote, axiomListsSchema, discoverNote, discoverPageSchema, discoverProbeSchema, noteDiscoverProbe } from './axiom-lists.js'

const logger = createLogger('extension-intake')
const bodyLimit = 8_000_000
const gunzipAsync = promisify(gunzip)
const bridgeKey = process.env.AXIOM_BRIDGE_KEY?.trim() ?? ''
const remoteBridge = bridgeKey.length >= 24
const listenHost = process.env.AXIOM_LISTEN_HOST?.trim() || (remoteBridge ? '0.0.0.0' : '127.0.0.1')
const loopbackOnly = ['127.0.0.1', 'localhost', '::1'].includes(listenHost)
const listenPort = Number(process.env.AXIOM_EXTENSION_PORT) || (remoteBridge ? Number(process.env.PORT) || 0 : 0) || trackerConfig.extensionPort
const timingWindow = 60

const watchlistReport = z.object({
  mint: z.string().refine(isSolanaAddress, 'Not a Solana address'),
  pairAddress: z.string().refine(isSolanaAddress, 'Not a Solana address'),
  symbol: z.string().max(40),
  action: z.enum(['add', 'remove']),
  ok: z.boolean(),
  reason: z.string().max(200).optional(),
}).strict()

const report = z.object({
  url: z.string().max(500),
  pairAddress: z.string().refine(isSolanaAddress, 'Not a Solana address').nullable(),
  pageViewers: z.number().int().min(0).max(1_000_000).nullable(),
  frames: z.array(z.string().max(60_000)).max(200),
  cards: z.array(z.object({
    viewers: z.number().int().min(0).max(1_000_000),
    pairAddress: z.string().refine(isSolanaAddress, 'Not a Solana address').nullable(),
    mint: z.string().refine(isSolanaAddress, 'Not a Solana address').nullable(),
    short: z.object({ prefix: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{3,8}$/), suffix: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{3,8}$/) }).nullable(),
    lines: z.array(z.string().max(60)).max(60).optional(),
    icons: z.array(z.string().max(80)).max(40).optional(),
  }).strict()).max(300).default([]),
  stats: z.record(z.string().max(40), z.number().min(0).max(100)).refine(value => Object.keys(value).length <= 60).optional(),
  pulse: pulseFeedSchema.optional(),
  lists: axiomListsSchema.optional(),
  probe: discoverProbeSchema.optional(),
  digest: z.string().max(80_000).optional(),
  discover: discoverPageSchema.optional(),
  api: z.array(capturedApiSchema).max(30).optional(),
  streams: z.array(capturedStreamSchema).max(400).optional(),
  tabs: capturedTabsSchema.optional(),
  poll: pollStatsSchema.optional(),
}).strict()

export type ExtensionReport = z.input<typeof report>

const siteOrigins = new Set([(process.env.AXIOM_SITE_ORIGIN?.trim() || 'https://thelibrary.garrdetto.workers.dev').replace(/\/$/, ''), 'http://localhost:3000'])
const liveIntervalMs = 1_000
const coinPageVisits = new Map<string, number>()
const coinRevisitMs = 4 * 60_000
const visitListSize = 40

function localHost(request: IncomingMessage) {
  if (!loopbackOnly) return false
  const host = (request.headers.host ?? '').split(':')[0]
  return host === '127.0.0.1' || host === 'localhost'
}

/** True when the given key is the tracker's `AXIOM_BRIDGE_KEY`; always false while no key of 24+ characters is set. */
export function bridgeKeyMatches(given: string, key = remoteBridge ? bridgeKey : '') {
  if (!key || !given) return false
  const first = Buffer.from(given)
  const second = Buffer.from(key)
  return first.length === second.length && timingSafeEqual(first, second)
}

function requestKey(request: IncomingMessage, url: URL) {
  const header = request.headers.authorization ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : url.searchParams.get('key') ?? ''
}

function trustedOrigin(request: IncomingMessage, url: URL) {
  if (bridgeKeyMatches(requestKey(request, url))) return true
  return (request.headers.origin ?? '').startsWith('chrome-extension://') && localHost(request)
}

function liveOrigin(request: IncomingMessage, url: URL) {
  const origin = request.headers.origin ?? ''
  if (bridgeKeyMatches(requestKey(request, url))) return siteOrigins.has(origin) ? origin : ''
  return localHost(request) && siteOrigins.has(origin) ? origin : null
}

function liveHeaders(origin: string) {
  return { ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}), 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', Vary: 'Origin', 'Cache-Control': 'no-store' }
}

/** Median and 95th percentile of the kept timings, in whole milliseconds. */
export function timingSummary(samples: number[]) {
  if (!samples.length) return null
  const sorted = [...samples].sort((first, second) => first - second)
  const at = (share: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))])
  return { median: at(0.5), p95: at(0.95), count: sorted.length }
}

function serveLive(database: TrackerDatabase, request: IncomingMessage, response: ServerResponse, origin: string, url: URL) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, liveHeaders(origin))
    response.end()
    return
  }
  if (url.pathname === '/live/stream') {
    response.writeHead(200, { ...liveHeaders(origin), 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' })
    response.write('retry: 1000\n\n')
    const push = () => {
      try { response.write(`data: ${JSON.stringify({ ...compactPayload(buildRadarPayload(database)), source: 'local' })}\n\n`) } catch (error) { logger.warn('Live stream payload failed', { error: errorMessage(error) }) }
    }
    push()
    const timer = setInterval(push, liveIntervalMs)
    request.on('close', () => clearInterval(timer))
    return
  }
  if (url.pathname === '/live/data') {
    const mint = url.searchParams.get('mint')
    const body = mint === null ? { ...compactPayload(buildRadarPayload(database)), source: 'local' } : isSolanaAddress(mint) ? buildTokenDetail(database, mint) : null
    response.writeHead(body ? 200 : 404, { ...liveHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(body ?? { error: 'Not found.' }))
    return
  }
  response.writeHead(404, liveHeaders(origin))
  response.end()
}

async function readBody(request: IncomingMessage) {
  const raw = await readRawBody(request)
  if (!/\bgzip\b/i.test(String(request.headers['content-encoding'] ?? ''))) return raw.toString('utf8')
  return (await gunzipAsync(raw, { maxOutputLength: bodyLimit })).toString('utf8')
}

function readRawBody(request: IncomingMessage) {
  return new Promise<Buffer>((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > bodyLimit) { reject(new Error('Body too large')); request.destroy(); return }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

export function applyExtensionReport(database: TrackerDatabase, input: ExtensionReport, now = Date.now()) {
  const candidates = activeCandidates(database)
  const resolveMint = (value: string) => {
    for (const candidate of candidates) {
      if (value === candidate.mint || value === candidate.pairAddress || value.includes(candidate.pairAddress) || value.includes(candidate.mint)) return candidate.mint
    }
    return null
  }
  const pageMint = input.pairAddress ? resolveMint(input.pairAddress) : null
  if (pageMint && input.stats) {
    const stats = parsePageStats(input.stats, now)
    if (stats) trackerState.pageStats.set(pageMint, stats)
  }
  if (input.pulse) applyPulseFeed(input.pulse, now)
  if (input.lists) applyAxiomLists(input.lists, now)
  if (input.discover) {
    const { status, changed } = applyDiscoverPage(input.discover, (input.cards ?? []).map(card => ({ mint: card.mint, viewers: card.viewers })), now)
    if (changed) logger.info('Discover tab read', { tab: status.text, list: status.list, how: status.how, coins: status.coins, tabs: status.tabs.map(tab => tab.text).join(', ') })
  } else if (input.probe && noteDiscoverProbe(input.probe, now)) logger.info('Discover tab seen', input.probe)
  const pulsePage = !/^https:\/\/axiom\.trade\/discover/.test(input.url)
  const counts = new Map<string, number>()
  if (pageMint && input.pageViewers !== null) counts.set(pageMint, input.pageViewers)
  for (const text of input.frames) {
    const frame = parseFrame(text)
    if (!frame) continue
    const fallback = pageMint && input.pairAddress && text.includes(input.pairAddress) ? pageMint : null
    for (const [mint, count] of extractViewerCounts(frame, resolveMint, fallback)) counts.set(mint, Math.max(count, counts.get(mint) ?? 0))
  }
  for (const card of input.cards ?? []) {
    if (card.mint && pulsePage) {
      if (card.lines?.length && !(input.pulse && input.pulse.rows.some(row => (row as { tokenAddress?: unknown } | null)?.tokenAddress === card.mint))) {
        const metrics = parsePulseCard(card.lines, card.viewers, now)
        trackerState.pulseCards.set(card.mint, metrics)
        notePulseFlow(card.mint, metrics)
        const identity = pulseIdentity(card.lines, card.pairAddress, now)
        if (identity) trackerState.pulseNames.set(card.mint, { ...identity, pairAddress: identity.pairAddress ?? trackerState.pulseNames.get(card.mint)?.pairAddress ?? null })
      }
      trackerState.pulse.set(card.mint, now)
      trackerState.viewers.set(card.mint, { count: card.viewers, at: now, source: 'extension' })
    }
    let mint = (card.pairAddress && resolveMint(card.pairAddress)) || (card.mint && resolveMint(card.mint)) || null
    if (!mint && card.short) {
      const { prefix, suffix } = card.short
      const matches = candidates.filter(candidate => (candidate.mint.startsWith(prefix) && candidate.mint.endsWith(suffix)) || (candidate.pairAddress.startsWith(prefix) && candidate.pairAddress.endsWith(suffix)))
      if (matches.length === 1) mint = matches[0].mint
    }
    if (mint) counts.set(mint, card.viewers)
  }
  for (const [mint, count] of counts) trackerState.viewers.set(mint, { count, at: now, source: mint === pageMint && !input.cards?.length ? 'page' : 'extension' })
  return counts.size
}

const discoverDigests = new Map<string, { url: string; at: number; digest: unknown }>()
let digestWrittenAt = 0

/**
 * Keeps the layout report each Discover tab sends (labels, counts, one row and the field names of the data it receives)
 * and writes the latest from every tab to `data/axiom-discover-digest.json`, at most every 10 seconds.
 */
export function keepDiscoverDigest(url: string, text: string, now: number, write = true) {
  let digest: unknown
  try { digest = JSON.parse(text) } catch { return null }
  const page = digest as { labels?: unknown; feeds?: unknown }
  const selected = Array.isArray(page.labels) ? page.labels.filter((label): label is string => typeof label === 'string' && label.includes('*')).join(',') : ''
  const feeds = Array.isArray(page.feeds) ? page.feeds.map(feed => String((feed as { key?: unknown } | null)?.key ?? '')).join(',') : ''
  const key = `${url}|${selected}|${feeds}`.slice(0, 600)
  discoverDigests.set(key, { url, at: now, digest })
  while (discoverDigests.size > 6) discoverDigests.delete([...discoverDigests.entries()].sort((first, second) => first[1].at - second[1].at)[0][0])
  const snapshot = { at: now, tabs: [...discoverDigests.values()].sort((first, second) => second.at - first.at) }
  if (write && now - digestWrittenAt >= 10_000) {
    digestWrittenAt = now
    mkdirSync(resolve('data'), { recursive: true })
    writeFileSync(resolve('data/axiom-discover-digest.json'), JSON.stringify(snapshot, null, 1))
  }
  return snapshot
}

/** Says how many coin pages gave holder figures lately and whether Axiom shows a fresh-wallet figure on them. */
function pageStatsNote(now = Date.now()) {
  const recent = [...trackerState.pageStats.values()].filter(stats => now - stats.seenAt <= pageStatsFreshMs)
  if (!recent.length) return ''
  const withFresh = recent.filter(stats => stats.fresh !== null).length
  return `, holder figures from ${recent.length} coin page${recent.length === 1 ? '' : 's'} (${withFresh ? `fresh wallets on ${withFresh}` : 'no fresh-wallet figure shown'})`
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

export function startExtensionIntake(database: TrackerDatabase, signal: AbortSignal) {
  let reports = 0
  let lastReportAt = 0
  let lastPulseCards = 0
  let lastPulseAt = 0
  const roundTrips: number[] = []
  const handling: number[] = []
  const keepTiming = (list: number[], value: number) => {
    if (!Number.isFinite(value) || value < 0 || value > 120_000) return
    list.push(value)
    if (list.length > timingWindow) list.shift()
  }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { ok: true })
      const site = liveOrigin(request, url)
      if (site !== null && url.pathname.startsWith('/live/')) return serveLive(database, request, response, site, url)
      if (!trustedOrigin(request, url)) return send(response, 403, { error: 'Only the Axiom Radar extension may send reports.' })
      if (request.method === 'GET' && url.pathname === '/extension/status') {
        const now = Date.now()
        const tracked = activeCandidates(database).map(candidate => ({ mint: candidate.mint, pairAddress: candidate.pairAddress, symbol: candidate.symbol }))
        const missing = tracked.filter(candidate => {
          const viewer = trackerState.viewers.get(candidate.mint)
          return !viewer || (viewer.source === 'page' ? now - viewer.at > 60_000 : now - viewer.at > 20_000)
        })
        const readAt = (mint: string) => trackerState.pageStats.get(mint)?.seenAt ?? 0
        const onPulse = (mint: string) => now - (trackerState.pulseCards.get(mint)?.seenAt ?? 0) < 120_000
        const stale = tracked.filter(candidate => needsPageRead(trackerState.pageStats.get(candidate.mint), onPulse(candidate.mint), now)).sort((first, second) => readAt(first.mint) - readAt(second.mint))
        for (const [mint, stats] of trackerState.pageStats) if (now - stats.seenAt > pageStatsKeptMs) trackerState.pageStats.delete(mint)
        let watchlist: ReturnType<typeof watchlistStatus> | null = null
        try { watchlist = watchlistStatus(database, now) } catch (error) { logger.warn('Watchlist plan failed', { error: errorMessage(error) }) }
        for (const [address, at] of coinPageVisits) if (now - at > 60 * 60_000) coinPageVisits.delete(address)
        const visitedAt = (candidate: { mint: string; pairAddress: string | null }) => Math.max(coinPageVisits.get(candidate.mint) ?? 0, candidate.pairAddress ? coinPageVisits.get(candidate.pairAddress) ?? 0 : 0)
        const visit = tracked.slice(0, visitListSize).filter(candidate => candidate.pairAddress && now - visitedAt(candidate) > coinRevisitMs).sort((first, second) => visitedAt(first) - visitedAt(second))
        return send(response, 200, { ok: true, tracked, missing, stale, visit, watchlist })
      }
      if (request.method === 'POST' && url.pathname === '/extension/watchlist') {
        const parsed = watchlistReport.safeParse(JSON.parse(await readBody(request)))
        if (!parsed.success) return send(response, 400, { error: 'Watchlist result could not be read.' })
        watchlistResult(database, parsed.data)
        logger.info(parsed.data.ok ? (parsed.data.action === 'add' ? 'Starred on the Axiom watchlist' : 'Taken off the Axiom watchlist') : 'Axiom watchlist star click failed', { symbol: parsed.data.symbol, mint: parsed.data.mint, detail: parsed.data.reason })
        return send(response, 200, { ok: true })
      }
      if (request.method === 'POST' && url.pathname === '/extension/sample') {
        const body = await readBody(request)
        const samplePath = resolve('data/axiom-bridge-sample.json')
        mkdirSync(resolve('data'), { recursive: true })
        writeFileSync(samplePath, body)
        logger.info('Saved diagnostic sample from the extension', { samplePath, bytes: body.length })
        return send(response, 200, { ok: true })
      }
      if (request.method !== 'POST' || url.pathname !== '/extension/report') return send(response, 404, { error: 'Not found.' })
      if (request.headers['x-bridge-rtt'] !== undefined) keepTiming(roundTrips, Number(request.headers['x-bridge-rtt']))
      const parsed = report.safeParse(JSON.parse(await readBody(request)))
      const handleStart = performance.now()
      if (!parsed.success) return send(response, 400, { error: 'Report could not be read.' })
      const matched = applyExtensionReport(database, parsed.data)
      if (parsed.data.pairAddress) coinPageVisits.set(parsed.data.pairAddress, Date.now())
      if (parsed.data.digest) {
        try { keepDiscoverDigest(parsed.data.url, parsed.data.digest, Date.now()) } catch (error) { logger.warn('Keeping the Discover layout report failed', { error: errorMessage(error) }) }
      }
      if (parsed.data.poll) notePollStats(parsed.data.poll)
      try { storeCapture(database, parsed.data) } catch (error) { logger.warn('Storing captured Axiom data failed', { error: errorMessage(error) }) }
      if (process.env.AXIOM_DEBUG_CARDS === '1') {
        mkdirSync(resolve('data'), { recursive: true })
        writeFileSync(resolve('data/axiom-last-cards.json'), JSON.stringify({ at: Date.now(), url: parsed.data.url, matched, cards: parsed.data.cards }, null, 1))
      }
      reports += 1
      lastReportAt = Date.now()
      keepTiming(handling, performance.now() - handleStart)
      if (parsed.data.cards.length) { lastPulseCards = parsed.data.cards.length; lastPulseAt = lastReportAt }
      return send(response, 200, { ok: true, matched })
    } catch (error) {
      logger.warn('Extension report failed', { error: errorMessage(error) })
      if (!response.headersSent) send(response, 400, { error: 'Report could not be read.' })
    }
  })
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 66_000
  const timingNote = () => {
    const trip = timingSummary(roundTrips)
    const handled = timingSummary(handling)
    const parts = [
      ...(trip ? [`bridge round trip ${trip.median} ms (slowest 5% ${trip.p95} ms)`] : []),
      ...(handled ? [`reports handled in ${handled.median} ms (slowest 5% ${handled.p95} ms)`] : []),
    ]
    return parts.length ? `; ${parts.join(', ')}` : ''
  }
  const heartbeat = setInterval(() => {
    const lists = axiomListNote(Date.now())
    recordHeartbeat(database, 'extension-intake', Date.now() - lastReportAt < 90_000 ? 'ok' : 'waiting', (!reports ? 'Open Axiom Pulse in Chrome with the extension installed' : Date.now() - pulseFeedSeen.at < 15_000 ? `Reading all ${pulseFeedSeen.count} coins in the Pulse columns${pulseFeedSeen.skipped ? ` (${pulseFeedSeen.skipped} unreadable)` : ''}${lists}${pageStatsNote()}` : Date.now() - lastPulseAt < 15_000 ? `Reading ${lastPulseCards} Pulse cards (update the bridge to 1.7 for every coin in the columns)${lists}${pageStatsNote()}` : lists ? `Reading Discover${lists}; no Pulse cards in the last 15s${pageStatsNote()}` : `No Pulse cards in the last 15s: keep the Axiom Pulse tab visible${pageStatsNote()}`) + timingNote())
    const discover = discoverNote(Date.now())
    recordHeartbeat(database, 'axiom-lists', discover ? 'ok' : 'waiting', discover ?? 'No Discover tab seen in the last 30s (bridge 1.12+ reads the Top and Surge tabs of open Discover pages)')
    const polling = pollNote()
    recordHeartbeat(database, 'pulse-poller', polling.includes(' ok, ') && !/ 0 of /.test(polling) ? 'ok' : 'waiting', polling)
    const captured = captureNote()
    recordHeartbeat(database, 'axiom-capture', captured ? 'ok' : 'waiting', captured ? captured.replace(/^; (.)/, (_, first: string) => first.toUpperCase()) : 'Nothing captured from Axiom pages in the last 15s (bridge 1.9+ captures API answers and socket messages on coin pages)')
  }, 15_000)
  return new Promise<void>(resolve => {
    server.on('error', error => {
      logger.error('Extension intake server error', { error: errorMessage(error) })
      recordHeartbeat(database, 'extension-intake', 'error', errorMessage(error))
    })
    if (bridgeKey && !remoteBridge) logger.warn('AXIOM_BRIDGE_KEY is shorter than 24 characters, so it is ignored and only this computer can send reports')
    server.listen(listenPort, listenHost, () => {
      logger.info('Waiting for the Chrome extension', { url: `http://${listenHost}:${listenPort}`, remote: remoteBridge })
      recordHeartbeat(database, 'extension-intake', 'waiting', 'Open Axiom tabs in Chrome with the extension installed')
    })
    signal.addEventListener('abort', () => {
      clearInterval(heartbeat)
      server.closeAllConnections()
      server.close(() => resolve())
    }, { once: true })
  })
}

if (isMainModule(import.meta.url)) {
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())
  void startExtensionIntake(openTrackerDatabase(), controller.signal)
}
