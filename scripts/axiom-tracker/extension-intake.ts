import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { z } from 'zod'
import { extractViewerCounts, parseFrame } from './axiom-collector.js'
import { openTrackerDatabase, recordHeartbeat, type TrackerDatabase } from './db.js'
import { createLogger, errorMessage, isMainModule, solanaAddressPattern, trackerConfig } from './runtime.js'
import { activeCandidates, trackerState } from './state.js'
import { buildRadarPayload, buildTokenDetail } from './radar-query.js'
import { compactPayload } from './site-publisher.js'
import { parsePulseCard } from './pulse-cards.js'

const logger = createLogger('extension-intake')
const bodyLimit = 2_000_000

const report = z.object({
  url: z.string().max(500),
  pairAddress: z.string().regex(solanaAddressPattern).nullable(),
  pageViewers: z.number().int().min(0).max(1_000_000).nullable(),
  frames: z.array(z.string().max(60_000)).max(200),
  cards: z.array(z.object({
    viewers: z.number().int().min(0).max(1_000_000),
    pairAddress: z.string().regex(solanaAddressPattern).nullable(),
    mint: z.string().regex(solanaAddressPattern).nullable(),
    short: z.object({ prefix: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{3,8}$/), suffix: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{3,8}$/) }).nullable(),
    lines: z.array(z.string().max(60)).max(60).optional(),
    icons: z.array(z.string().max(80)).max(40).optional(),
  }).strict()).max(300).default([]),
}).strict()

export type ExtensionReport = z.input<typeof report>

const siteOrigins = new Set([(process.env.AXIOM_SITE_ORIGIN?.trim() || 'https://thelibrary.garrdetto.workers.dev').replace(/\/$/, ''), 'http://localhost:3000'])
const liveIntervalMs = 1_000

function localHost(request: IncomingMessage) {
  const host = (request.headers.host ?? '').split(':')[0]
  return host === '127.0.0.1' || host === 'localhost'
}

function trustedOrigin(request: IncomingMessage) {
  return (request.headers.origin ?? '').startsWith('chrome-extension://') && localHost(request)
}

function siteOrigin(request: IncomingMessage) {
  const origin = request.headers.origin ?? ''
  return localHost(request) && siteOrigins.has(origin) ? origin : null
}

function liveHeaders(origin: string) {
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin', 'Cache-Control': 'no-store' }
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
    const body = mint === null ? { ...compactPayload(buildRadarPayload(database)), source: 'local' } : solanaAddressPattern.test(mint) ? buildTokenDetail(database, mint) : null
    response.writeHead(body ? 200 : 404, { ...liveHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(body ?? { error: 'Not found.' }))
    return
  }
  response.writeHead(404, liveHeaders(origin))
  response.end()
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > bodyLimit) { reject(new Error('Body too large')); request.destroy(); return }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
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
  const counts = new Map<string, number>()
  if (pageMint && input.pageViewers !== null) counts.set(pageMint, input.pageViewers)
  for (const text of input.frames) {
    const frame = parseFrame(text)
    if (!frame) continue
    const fallback = pageMint && input.pairAddress && text.includes(input.pairAddress) ? pageMint : null
    for (const [mint, count] of extractViewerCounts(frame, resolveMint, fallback)) counts.set(mint, Math.max(count, counts.get(mint) ?? 0))
  }
  for (const card of input.cards ?? []) {
    if (card.mint) {
      if (card.lines?.length) trackerState.pulseCards.set(card.mint, parsePulseCard(card.lines, card.viewers, now))
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
  for (const [mint, count] of counts) trackerState.viewers.set(mint, { count, at: now, source: 'extension' })
  return counts.size
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
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const site = siteOrigin(request)
      if (site && url.pathname.startsWith('/live/')) return serveLive(database, request, response, site, url)
      if (!trustedOrigin(request)) return send(response, 403, { error: 'Only the Axiom Radar extension may send reports.' })
      if (request.method === 'GET' && url.pathname === '/extension/status') {
        return send(response, 200, { ok: true, tracked: activeCandidates(database).map(candidate => ({ mint: candidate.mint, pairAddress: candidate.pairAddress, symbol: candidate.symbol })) })
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
      const parsed = report.safeParse(JSON.parse(await readBody(request)))
      if (!parsed.success) return send(response, 400, { error: 'Report could not be read.' })
      const matched = applyExtensionReport(database, parsed.data)
      if (process.env.AXIOM_DEBUG_CARDS === '1') {
        mkdirSync(resolve('data'), { recursive: true })
        writeFileSync(resolve('data/axiom-last-cards.json'), JSON.stringify({ at: Date.now(), url: parsed.data.url, matched, cards: parsed.data.cards }, null, 1))
      }
      reports += 1
      lastReportAt = Date.now()
      if (parsed.data.cards.length) { lastPulseCards = parsed.data.cards.length; lastPulseAt = lastReportAt }
      return send(response, 200, { ok: true, matched })
    } catch (error) {
      logger.warn('Extension report failed', { error: errorMessage(error) })
      if (!response.headersSent) send(response, 400, { error: 'Report could not be read.' })
    }
  })
  const heartbeat = setInterval(() => {
    recordHeartbeat(database, 'extension-intake', Date.now() - lastReportAt < 90_000 ? 'ok' : 'waiting', !reports ? 'Open Axiom Pulse in Chrome with the extension installed' : Date.now() - lastPulseAt < 15_000 ? `Reading ${lastPulseCards} Pulse cards` : 'No Pulse cards in the last 15s: keep the Axiom Pulse tab visible')
  }, 15_000)
  return new Promise<void>(resolve => {
    server.on('error', error => {
      logger.error('Extension intake server error', { error: errorMessage(error) })
      recordHeartbeat(database, 'extension-intake', 'error', errorMessage(error))
    })
    server.listen(trackerConfig.extensionPort, '127.0.0.1', () => {
      logger.info('Waiting for the Chrome extension', { url: `http://127.0.0.1:${trackerConfig.extensionPort}` })
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
