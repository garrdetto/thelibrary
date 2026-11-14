import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { openTrackerDatabase, recordHeartbeat, type TrackerDatabase } from './db.js'
import { buildRadarPayload, buildTokenDetail } from './radar-query.js'
import { createLogger, errorMessage, isMainModule, solanaAddressPattern } from './runtime.js'

const logger = createLogger('api-server')
const streamIntervalMs = 3_000

function tokenMatches(header: string | undefined, token: string) {
  const presented = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '')
  const expected = Buffer.from(token)
  return presented.length === expected.length && timingSafeEqual(presented, expected)
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' })
  response.end(JSON.stringify(body))
}

function handle(database: TrackerDatabase, token: string, request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', 'http://tracker.local')
  if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed.' })
  if (url.pathname === '/health') return sendJson(response, 200, { ok: true })
  if (!tokenMatches(request.headers.authorization, token)) return sendJson(response, 401, { error: 'Unauthorized.' })

  if (url.pathname === '/api/admin/axiom/stream') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    response.write('retry: 2000\n\n')
    const send = () => {
      try { response.write(`data: ${JSON.stringify(buildRadarPayload(database))}\n\n`) } catch (error) { logger.warn('Stream payload failed', { error: errorMessage(error) }) }
    }
    send()
    const timer = setInterval(send, streamIntervalMs)
    request.on('close', () => clearInterval(timer))
    return
  }

  if (url.pathname === '/api/admin/axiom/data') {
    const mint = url.searchParams.get('mint')
    if (mint === null) return sendJson(response, 200, buildRadarPayload(database))
    if (!solanaAddressPattern.test(mint)) return sendJson(response, 400, { error: 'Invalid token address.' })
    const detail = buildTokenDetail(database, mint)
    return detail ? sendJson(response, 200, detail) : sendJson(response, 404, { error: 'Token not tracked.' })
  }
  return sendJson(response, 404, { error: 'Not found.' })
}

export function startApiServer(database: TrackerDatabase, signal: AbortSignal) {
  const token = process.env.AXIOM_RADAR_TOKEN?.trim() ?? ''
  const port = Number(process.env.AXIOM_API_PORT) || 8790
  const host = process.env.AXIOM_API_HOST?.trim() || '127.0.0.1'
  if (token.length < 24) {
    logger.warn('AXIOM_RADAR_TOKEN is missing or shorter than 24 characters; the radar API is disabled')
    recordHeartbeat(database, 'api-server', 'disabled', 'AXIOM_RADAR_TOKEN missing')
    return Promise.resolve()
  }
  const server = createServer((request, response) => {
    try { handle(database, token, request, response) } catch (error) {
      logger.error('Request failed', { error: errorMessage(error) })
      if (!response.headersSent) sendJson(response, 503, { error: 'Axiom Radar is temporarily unavailable.' })
      else response.end()
    }
  })
  return new Promise<void>(resolve => {
    server.on('error', error => {
      logger.error('Radar API server error', { error: errorMessage(error) })
      recordHeartbeat(database, 'api-server', 'error', errorMessage(error))
    })
    server.listen(port, host, () => {
      logger.info('Radar API listening', { url: `http://${host}:${port}` })
      recordHeartbeat(database, 'api-server', 'ok', `listening on ${host}:${port}`)
    })
    signal.addEventListener('abort', () => {
      server.closeAllConnections()
      server.close(() => resolve())
    }, { once: true })
  })
}

if (isMainModule(import.meta.url)) {
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())
  void startApiServer(openTrackerDatabase(), controller.signal)
}
