import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { BrowserContext, Page, WebSocket } from 'playwright'
import { openTrackerDatabase, recordHeartbeat, type TrackerDatabase } from './db.js'
import { createLogger, errorMessage, isMainModule, runLoop, sleep, trackerConfig } from './runtime.js'
import { activeCandidates, latestMarket, trackerState, type ActiveCandidate } from './state.js'

const logger = createLogger('axiom-collector')
const axiomOrigin = 'https://axiom.trade'
const sessionDirectory = resolve(process.env.AXIOM_SESSION_DIR ?? 'axiom-session')
const debugLogPath = resolve('data/axiom-ws-debug.log')
const viewerFreshnessMs = 60_000
const slotDwellMs = 30_000
const silentSlotReloadMs = 45_000
const viewerKeyPattern = /^(viewers?|viewer_?count|viewers_?count|live_?viewers|watchers?|watching|watch_?count|active_?(users|viewers)|online(_?count)?|users_?online|user_?count|concurrent)$/i
const addressKeyPattern = /^(mint|token_?address|tokenAddress|token|pair_?address|pairAddress|pair|address|ca|room|channel|topic)$/i

type Slot = {
  page: Page
  candidate: ActiveCandidate | null
  assignedAt: number
  lastFrameAt: number
  backoffUntil: number
  failures: number
}

function writeDebugFrame(source: string, payload: string) {
  if (!trackerConfig.debugWebSockets) return
  try {
    mkdirSync(dirname(debugLogPath), { recursive: true })
    try { if (statSync(debugLogPath).size > 5 * 1024 * 1024) renameSync(debugLogPath, `${debugLogPath}.1`) } catch { }
    appendFileSync(debugLogPath, `${new Date().toISOString()} ${source} ${payload.slice(0, 800)}\n`)
  } catch { }
}

function parseFrame(payload: string | Buffer): unknown {
  const text = typeof payload === 'string' ? payload : payload.toString('utf8')
  if (!text || text.length > 2_000_000) return null
  const trimmed = text.replace(/^\d+/, '').trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try { return JSON.parse(trimmed) } catch { return null }
}

function numericViewerValue(value: unknown) {
  const number = typeof value === 'string' ? Number(value) : value
  return typeof number === 'number' && Number.isInteger(number) && number >= 0 && number < 1_000_000 ? number : null
}

export function extractViewerCounts(frame: unknown, resolveMint: (value: string) => string | null, fallbackMint: string | null) {
  const found = new Map<string, number>()
  let visited = 0
  const walk = (node: unknown, inheritedMint: string | null, depth: number) => {
    if (visited++ > 4000 || depth > 8 || node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      let arrayMint = inheritedMint
      for (const item of node) if (typeof item === 'string') arrayMint = resolveMint(item) ?? arrayMint
      for (const item of node) walk(item, arrayMint, depth + 1)
      return
    }
    const record = node as Record<string, unknown>
    let mint = inheritedMint
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string' && addressKeyPattern.test(key)) mint = resolveMint(value) ?? mint
    }
    for (const [key, value] of Object.entries(record)) {
      if (!viewerKeyPattern.test(key)) continue
      const count = numericViewerValue(value)
      const target = mint ?? fallbackMint
      if (count !== null && target) found.set(target, Math.max(count, found.get(target) ?? 0))
    }
    for (const value of Object.values(record)) if (value && typeof value === 'object') walk(value, mint, depth + 1)
  }
  walk(frame, null, 0)
  return found
}

function parseCompactNumber(text: string) {
  const match = text.trim().match(/^([\d.,]+)\s*([kKmM])?$/)
  if (!match) return null
  const base = Number(match[1].replace(/,/g, ''))
  if (!Number.isFinite(base)) return null
  const multiplier = match[2]?.toLowerCase() === 'k' ? 1_000 : match[2]?.toLowerCase() === 'm' ? 1_000_000 : 1
  return Math.round(base * multiplier)
}

export function writeSnapshots(database: TrackerDatabase) {
  const now = Date.now()
  const candidates = activeCandidates(database)
  const insert = database.prepare('INSERT INTO snapshots (mint, viewers, price_usd, market_cap, liquidity_usd, volume_5m, buys_5m, sells_5m, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  let withViewers = 0
  database.transaction(() => {
    for (const candidate of candidates) {
      const market = latestMarket(database, candidate.mint)
      if (!market) continue
      const viewer = trackerState.viewers.get(candidate.mint)
      const viewers = viewer && now - viewer.at <= viewerFreshnessMs ? viewer.count : null
      if (viewers !== null) withViewers += 1
      insert.run(candidate.mint, viewers, market.priceUsd, market.marketCap, market.liquidityUsd, market.volume5m, market.buys5m, market.sells5m, now)
    }
  })()
  return { written: candidates.length, withViewers }
}

async function launchContext(headless: boolean, viewport: { width: number; height: number } | null) {
  const { chromium } = await import('playwright')
  mkdirSync(sessionDirectory, { recursive: true })
  const preferred = process.env.AXIOM_BROWSER_CHANNEL?.trim()
  const channels = preferred ? [preferred] : ['bundled', 'chrome', 'msedge']
  let lastError: unknown = null
  for (const channel of channels) {
    try {
      const context = await chromium.launchPersistentContext(sessionDirectory, { headless, viewport, ...(channel === 'bundled' || channel === 'chromium' ? {} : { channel }) })
      if (channel !== channels[0]) logger.warn('Using a fallback browser; set AXIOM_BROWSER_CHANNEL so login and collection share it', { channel })
      return context
    } catch (error) {
      lastError = error
      logger.warn('Browser launch failed', { channel, error: errorMessage(error).split(/\r?\n/)[0] })
    }
  }
  throw lastError
}

export async function runLogin() {
  logger.info('Opening Axiom for one-time login. Sign in, then close the browser window to save the session.', { sessionDirectory })
  const context = await launchContext(false, null)
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(axiomOrigin, { waitUntil: 'domcontentloaded' }).catch(error => logger.warn('Initial navigation failed', { error: errorMessage(error) }))
  await new Promise<void>(resolveClose => context.on('close', () => resolveClose()))
  logger.info('Browser closed. Axiom session saved.', { sessionDirectory })
}

export function startAxiomCollector(database: TrackerDatabase, signal: AbortSignal) {
  let context: BrowserContext | null = null
  let slots: Slot[] = []
  let pulsePage: Page | null = null
  let launchFailures = 0
  let nextLaunchAt = 0
  let lastViewerAt = 0
  let warnedNoViewers = false
  let challengeSeenAt = 0
  let warnedChallengeAt = 0
  let rotation = 0
  const startedAt = Date.now()

  let candidateIndex: ActiveCandidate[] = []
  const resolveMint = (value: string) => {
    for (const candidate of candidateIndex) {
      if (value === candidate.mint || value === candidate.pairAddress || value.includes(candidate.pairAddress) || value.includes(candidate.mint)) return candidate.mint
    }
    return null
  }

  const handleFrame = (source: string, payload: string | Buffer, slot: Slot | null) => {
    if (slot) slot.lastFrameAt = Date.now()
    const text = typeof payload === 'string' ? payload : payload.toString('utf8')
    writeDebugFrame(source, text)
    const frame = parseFrame(text)
    if (!frame) return
    const fallback = slot?.candidate && (text.includes(slot.candidate.pairAddress) || text.includes(slot.candidate.mint)) ? slot.candidate.mint : null
    const counts = extractViewerCounts(frame, resolveMint, fallback)
    const now = Date.now()
    for (const [mint, count] of counts) {
      trackerState.viewers.set(mint, { count, at: now, source: 'websocket' })
      lastViewerAt = now
    }
  }

  const attachSocketListeners = (page: Page, slot: Slot | null) => {
    page.on('websocket', (socket: WebSocket) => {
      logger.debug('WebSocket opened', { url: socket.url() })
      if (socket.url().includes('challenges.cloudflare.com')) challengeSeenAt = Date.now()
      socket.on('framereceived', frame => handleFrame(socket.url(), frame.payload, slot))
      socket.on('socketerror', error => logger.warn('WebSocket error', { url: socket.url(), error }))
      socket.on('close', () => {
        logger.debug('WebSocket closed', { url: socket.url() })
        if (slot) slot.lastFrameAt = 0
      })
    })
    page.on('response', response => {
      if (response.status() === 429 && slot) {
        slot.failures += 1
        slot.backoffUntil = Date.now() + Math.min(5 * 60_000, 15_000 * 2 ** slot.failures)
        logger.warn('Axiom rate limited a page; backing off', { url: response.url(), backoffMs: slot.backoffUntil - Date.now() })
      }
    })
  }

  const closeContext = async () => {
    const closing = context
    context = null
    slots = []
    pulsePage = null
    await closing?.close().catch(() => undefined)
  }

  const launch = async () => {
    const launched = await launchContext(trackerConfig.headless, { width: 1440, height: 900 })
    launched.on('close', () => {
      if (context === launched) {
        logger.warn('Browser context closed unexpectedly; will relaunch')
        context = null
        slots = []
        pulsePage = null
      }
    })
    context = launched
    pulsePage = launched.pages()[0] ?? await launched.newPage()
    attachSocketListeners(pulsePage, null)
    await pulsePage.goto(`${axiomOrigin}/pulse`, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(error => logger.warn('Pulse page navigation failed', { error: errorMessage(error) }))
    if (/\/(login|signin|auth)/i.test(pulsePage.url())) logger.warn('Axiom redirected to a login page. Run `pnpm axiom:login` to save a session.')
    for (let index = 0; index < trackerConfig.axiomPages; index++) {
      const page = await launched.newPage()
      const slot: Slot = { page, candidate: null, assignedAt: 0, lastFrameAt: 0, backoffUntil: 0, failures: 0 }
      attachSocketListeners(page, slot)
      slots.push(slot)
    }
    launchFailures = 0
    logger.info('Axiom browser ready', { pages: slots.length, headless: trackerConfig.headless })
  }

  const scrapeVisibleViewers = async (slot: Slot) => {
    if (!slot.candidate) return
    try {
      const label = await slot.page.evaluate(() => {
        const text = document.body?.innerText ?? ''
        const match = text.match(/([\d.,]+\s*[kKmM]?)\s*(viewers?|watching|online)\b/i) ?? text.match(/\b(viewers?|watching)\s*[:·]?\s*([\d.,]+\s*[kKmM]?)/i)
        if (!match) return null
        return /\d/.test(match[1]) ? match[1] : match[2]
      })
      const count = label ? parseCompactNumber(label) : null
      const existing = trackerState.viewers.get(slot.candidate.mint)
      if (count !== null && (!existing || existing.source === 'page' || Date.now() - existing.at > 20_000)) {
        trackerState.viewers.set(slot.candidate.mint, { count, at: Date.now(), source: 'page' })
        lastViewerAt = Date.now()
      }
    } catch { }
  }

  const assignSlots = async () => {
    const candidates = activeCandidates(database)
    if (!candidates.length) return
    const now = Date.now()
    const assigned = new Set(slots.map(slot => slot.candidate?.mint).filter(Boolean))
    const stillActive = new Set(candidates.map(candidate => candidate.mint))
    const queue = candidates.filter(candidate => !assigned.has(candidate.mint))
    for (const slot of slots) {
      if (now < slot.backoffUntil) continue
      const expired = !slot.candidate || !stillActive.has(slot.candidate.mint) || now - slot.assignedAt > slotDwellMs
      const silent = slot.candidate && now - slot.assignedAt > silentSlotReloadMs && now - slot.lastFrameAt > silentSlotReloadMs
      if (expired && queue.length) {
        const next = queue[rotation++ % queue.length]
        queue.splice(queue.indexOf(next), 1)
        slot.candidate = next
        slot.assignedAt = now
        try {
          await slot.page.goto(`${axiomOrigin}/meme/${next.pairAddress}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          slot.failures = 0
        } catch (error) {
          slot.failures += 1
          slot.backoffUntil = now + Math.min(5 * 60_000, 10_000 * 2 ** slot.failures)
          logger.warn('Token page navigation failed', { mint: next.mint, error: errorMessage(error), failures: slot.failures })
        }
      } else if (silent) {
        slot.assignedAt = now
        await slot.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(error => {
          slot.failures += 1
          slot.backoffUntil = now + Math.min(5 * 60_000, 10_000 * 2 ** slot.failures)
          logger.warn('Silent page reload failed', { error: errorMessage(error) })
        })
      }
      await scrapeVisibleViewers(slot)
    }
  }

  const cycle = async () => {
    const now = Date.now()
    candidateIndex = activeCandidates(database)
    if (!context && now >= nextLaunchAt) {
      try {
        await launch()
      } catch (error) {
        launchFailures += 1
        nextLaunchAt = now + Math.min(10 * 60_000, 30_000 * 2 ** Math.min(launchFailures, 5))
        logger.error('Could not launch Chromium; writing market-only snapshots', { error: errorMessage(error), retryInMs: nextLaunchAt - now, hint: 'Run `npx playwright install chromium` and `pnpm axiom:login`.' })
        await closeContext()
      }
    }
    if (context) {
      await assignSlots()
      const titles = await Promise.all([pulsePage, ...slots.map(slot => slot.page)].map(page => page?.title().catch(() => '') ?? ''))
      if (titles.some(title => /just a moment|attention required|verify you are human/i.test(title))) challengeSeenAt = now
    }
    const result = writeSnapshots(database)
    if (!warnedNoViewers && context && now - startedAt > 120_000 && now - lastViewerAt > 120_000) {
      warnedNoViewers = true
      logger.warn('No viewer counts captured for 2 minutes. Check the Axiom session (`pnpm axiom:login`) or set AXIOM_DEBUG_WS=1 to inspect frames in data/axiom-ws-debug.log.')
    }
    if (now - lastViewerAt < 60_000) warnedNoViewers = false
    const challenged = now - challengeSeenAt < 120_000 && now - lastViewerAt > 60_000
    if (challenged && now - warnedChallengeAt > 10 * 60_000) {
      warnedChallengeAt = now
      logger.warn('Axiom served a Cloudflare challenge to the collector browser, so no viewer data is arriving. Refresh the session with `pnpm axiom:login`, or run the collector in a visible window with AXIOM_HEADLESS=0. Snapshots continue with market data only.')
    }
    const collectorStatus = !context ? 'market-only' : now - lastViewerAt < 60_000 ? 'ok' : challenged ? 'cloudflare-challenge' : 'no-viewers'
    recordHeartbeat(database, 'axiom-collector', collectorStatus, `${result.written} snapshots, ${result.withViewers} with viewers`)
    logger.debug('Snapshot cycle', result)
  }

  signal.addEventListener('abort', () => { void closeContext() }, { once: true })
  logger.info('Starting Axiom collector', { sessionDirectory, pages: trackerConfig.axiomPages, intervalMs: trackerConfig.snapshotIntervalMs })
  return runLoop('axiom-collector', trackerConfig.snapshotIntervalMs, cycle, logger, signal).finally(closeContext)
}

if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--login')) {
    runLogin().then(() => process.exit(0), error => {
      logger.error('Login session failed', { error: errorMessage(error) })
      process.exit(1)
    })
  } else {
    const controller = new AbortController()
    process.once('SIGINT', () => controller.abort())
    process.once('SIGTERM', () => controller.abort())
    void startAxiomCollector(openTrackerDatabase(), controller.signal).then(() => sleep(250))
  }
}
