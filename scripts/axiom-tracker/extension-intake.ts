import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { z } from 'zod'
import { extractViewerCounts, parseFrame } from './axiom-collector.js'
import { openTrackerDatabase, recordHeartbeat, type TrackerDatabase } from './db.js'
import { createLogger, errorMessage, isMainModule, solanaAddressPattern, trackerConfig } from './runtime.js'
import { activeCandidates, trackerState } from './state.js'

const logger = createLogger('extension-intake')
const bodyLimit = 2_000_000

const report = z.object({
  url: z.string().max(500),
  pairAddress: z.string().regex(solanaAddressPattern).nullable(),
  pageViewers: z.number().int().min(0).max(1_000_000).nullable(),
  frames: z.array(z.string().max(60_000)).max(200),
}).strict()

export type ExtensionReport = z.infer<typeof report>

function trustedOrigin(request: IncomingMessage) {
  const origin = request.headers.origin ?? ''
  const host = (request.headers.host ?? '').split(':')[0]
  return origin.startsWith('chrome-extension://') && (host === '127.0.0.1' || host === 'localhost')
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
  for (const [mint, count] of counts) trackerState.viewers.set(mint, { count, at: now, source: 'extension' })
  return counts.size
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

export function startExtensionIntake(database: TrackerDatabase, signal: AbortSignal) {
  if (trackerConfig.collector !== 'extension') return Promise.resolve()
  let reports = 0
  let lastReportAt = 0
  const server = createServer(async (request, response) => {
    try {
      if (!trustedOrigin(request)) return send(response, 403, { error: 'Only the Axiom Radar extension may send reports.' })
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/extension/status') {
        return send(response, 200, { ok: true, tracked: activeCandidates(database).map(candidate => ({ mint: candidate.mint, pairAddress: candidate.pairAddress, symbol: candidate.symbol })) })
      }
      if (request.method !== 'POST' || url.pathname !== '/extension/report') return send(response, 404, { error: 'Not found.' })
      const parsed = report.safeParse(JSON.parse(await readBody(request)))
      if (!parsed.success) return send(response, 400, { error: 'Report could not be read.' })
      const matched = applyExtensionReport(database, parsed.data)
      reports += 1
      lastReportAt = Date.now()
      return send(response, 200, { ok: true, matched })
    } catch (error) {
      logger.warn('Extension report failed', { error: errorMessage(error) })
      if (!response.headersSent) send(response, 400, { error: 'Report could not be read.' })
    }
  })
  const heartbeat = setInterval(() => {
    recordHeartbeat(database, 'extension-intake', Date.now() - lastReportAt < 90_000 ? 'ok' : 'waiting', reports ? `${reports} reports` : 'Open Axiom tabs in Chrome with the extension installed')
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
