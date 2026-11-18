import { openTrackerDatabase, recordHeartbeat, type TrackerDatabase } from './db.js'
import { chunk, createLogger, errorMessage, fetchJson, isMainModule, sleep, isSolanaAddress } from './runtime.js'
import { activeCandidates, trackerState, type JupiterReading } from './state.js'

const logger = createLogger('jupiter')
const jupiterApi = 'https://lite-api.jup.ag/tokens/v2'
const refreshMs = 5_000
const holderHistoryMs = 6 * 60_000
const readingTtlMs = 60_000
const perRequest = 100
const requestGapMs = 1_200
const moverListMs = 5_000

let requestChain: Promise<unknown> = Promise.resolve()
let lastRequestAt = 0

/** Jupiter's free feed allows about one request a second, so every call waits its turn. */
function jupiterFetch<T>(path: string, timeoutMs: number): Promise<T> {
  const run = requestChain.then(async () => {
    const wait = lastRequestAt + requestGapMs - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequestAt = Date.now()
    return fetchJson<T>(`${jupiterApi}/${path}`, { retries: 0, timeoutMs })
  })
  requestChain = run.catch(() => undefined)
  return run
}

type JupiterStats = { holderChange?: number; numBuys?: number; numSells?: number; numTraders?: number; numNetBuyers?: number; numOrganicBuyers?: number; buyVolume?: number; sellVolume?: number; buyOrganicVolume?: number; sellOrganicVolume?: number }
type JupiterToken = {
  id?: string
  holderCount?: number
  organicScore?: number
  launchpad?: string | null
  graduatedPool?: string | null
  twitter?: string | null
  telegram?: string | null
  website?: string | null
  stats5m?: JupiterStats
  audit?: { topHoldersPercentage?: number; devBalancePercentage?: number; devMigrations?: number; devMints?: number }
}

const holderHistory = new Map<string, Array<{ t: number; holders: number }>>()
const moverList = { at: 0, mints: [] as string[], loading: false }
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : null
const link = (value: unknown) => typeof value === 'string' && /^https?:\/\//i.test(value.trim()) ? value.trim().slice(0, 300) : null

function holdersPerMinute(mint: string, holders: number | null, now: number) {
  if (holders === null) return null
  const history = holderHistory.get(mint) ?? []
  history.push({ t: now, holders })
  while (history.length && now - history[0].t > holderHistoryMs) history.shift()
  holderHistory.set(mint, history)
  const earliest = history.find(point => now - point.t <= 300_000)
  if (!earliest || now - earliest.t < 45_000) return null
  return Math.round(((holders - earliest.holders) / ((now - earliest.t) / 60_000)) * 10) / 10
}

/** Jupiter reports the creator's balance, which on some pools is the pool itself; a dev share larger than the whole top 10 is that case and is ignored. */
function devShare(dev: number | null, top10: number | null) {
  if (dev === null) return null
  return top10 !== null && dev > top10 + 1 ? null : dev
}

function toReading(token: JupiterToken, now: number): JupiterReading {
  const holders = finite(token.holderCount)
  const top10Pct = finite(token.audit?.topHoldersPercentage)
  return {
    holders,
    holdersPerMin: holdersPerMinute(token.id as string, holders, now),
    holderChange5mPct: finite(token.stats5m?.holderChange),
    top10Pct,
    devPct: devShare(finite(token.audit?.devBalancePercentage), top10Pct),
    devMigrations: finite(token.audit?.devMigrations),
    devMints: finite(token.audit?.devMints),
    buys5m: finite(token.stats5m?.numBuys),
    sells5m: finite(token.stats5m?.numSells),
    traders5m: finite(token.stats5m?.numTraders),
    netBuyers5m: finite(token.stats5m?.numNetBuyers),
    organicScore: finite(token.organicScore),
    launchpad: typeof token.launchpad === 'string' ? token.launchpad : null,
    organicBuyers5m: finite(token.stats5m?.numOrganicBuyers),
    buyVolume5m: finite(token.stats5m?.buyOrganicVolume) ?? finite(token.stats5m?.buyVolume),
    sellVolume5m: finite(token.stats5m?.sellOrganicVolume) ?? finite(token.stats5m?.sellVolume),
    twitter: link(token.twitter),
    telegram: link(token.telegram),
    website: link(token.website),
    graduated: typeof token.graduatedPool === 'string' && token.graduatedPool ? true : token.launchpad ? false : null,
    readAt: now,
  }
}

export async function refreshJupiter(mints: string[], now = Date.now()) {
  const groups: JupiterToken[][] = []
  for (const group of chunk(mints, perRequest)) groups.push(await jupiterFetch<JupiterToken[]>(`search?query=${group.join(',')}`, 6_000))
  let read = 0
  for (const token of groups.flatMap(group => Array.isArray(group) ? group : [])) {
    if (typeof token.id !== 'string' || !mints.includes(token.id)) continue
    trackerState.jupiter.set(token.id, toReading(token, now))
    read += 1
  }
  for (const [mint, reading] of trackerState.jupiter) if (now - reading.readAt > 10 * 60_000) trackerState.jupiter.delete(mint)
  for (const mint of holderHistory.keys()) if (!trackerState.jupiter.has(mint)) holderHistory.delete(mint)
  return read
}

/** The reading for a coin while it is fresh enough to score with. */
export function jupiterReading(mint: string, now: number) {
  const reading = trackerState.jupiter.get(mint)
  return reading && now - reading.readAt < readingTtlMs ? reading : null
}

async function refreshMoverMints() {
  const mints = new Set<string>()
  for (const path of ['toptrending/5m', 'toptraded/5m', 'toporganicscore/5m']) {
    try {
      const list = await jupiterFetch<JupiterToken[]>(`${path}?limit=50`, 8_000)
      for (const token of Array.isArray(list) ? list : []) if (isSolanaAddress(token.id)) mints.add(token.id)
    } catch (error) {
      logger.debug('Jupiter mover list failed', { path, error: errorMessage(error) })
    }
  }
  if (mints.size) moverList.mints = [...mints]
}

/**
 * Coins Jupiter lists as trending or most traded over the last 5 minutes, to widen what the radar watches without the Pulse tab.
 * Returns the newest lists at once and refreshes them in the background, so discovery never waits on Jupiter's request queue.
 */
export async function jupiterMoverMints(now = Date.now()) {
  if (!moverList.loading && now - moverList.at >= moverListMs) {
    moverList.at = now
    moverList.loading = true
    void refreshMoverMints().finally(() => { moverList.loading = false; moverList.at = Date.now() })
  }
  return moverList.mints
}

/** Reads holder counts, holder growth, top-holder and dev shares and who is trading for every tracked coin, every few seconds, from Jupiter's public token feed. */
export function startJupiter(database: TrackerDatabase, signal: AbortSignal) {
  logger.info('Reading holder growth and trader counts from Jupiter', { intervalMs: refreshMs })
  const saveLinks = database.prepare('UPDATE tokens SET links_json = ?, graduated = ? WHERE mint = ?')
  const saved = new Map<string, string>()
  const remember = (mints: string[]) => {
    database.transaction(() => {
      for (const mint of mints) {
        const reading = trackerState.jupiter.get(mint)
        if (!reading) continue
        const links = JSON.stringify({ twitter: reading.twitter, telegram: reading.telegram, website: reading.website })
        const key = `${links}|${reading.graduated}`
        if (saved.get(mint) === key) continue
        saveLinks.run(links, reading.graduated === null ? null : reading.graduated ? 1 : 0, mint)
        saved.set(mint, key)
      }
    })()
    if (saved.size > 2_000) saved.clear()
  }
  return (async () => {
    let failures = 0
    let lastHeartbeat = 0
    while (!signal.aborted) {
      const started = Date.now()
      try {
        const mints = activeCandidates(database).map(candidate => candidate.mint)
        const read = mints.length ? await refreshJupiter(mints, started) : 0
        if (read) remember(mints)
        failures = 0
        if (started - lastHeartbeat >= 15_000) {
          recordHeartbeat(database, 'jupiter', 'ok', `${read} of ${mints.length} coins read`)
          lastHeartbeat = started
        }
      } catch (error) {
        failures += 1
        if (failures === 1 || failures % 20 === 0) {
          logger.warn('Jupiter read failed', { error: errorMessage(error), failures })
          recordHeartbeat(database, 'jupiter', 'waiting', 'Jupiter did not answer; holder growth falls back to the other sources')
        }
      }
      const wait = failures ? Math.min(60_000, refreshMs * 2 ** Math.min(failures, 4)) : refreshMs - (Date.now() - started)
      await sleep(Math.max(500, wait), signal)
    }
  })()
}

if (isMainModule(import.meta.url)) {
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())
  void startJupiter(openTrackerDatabase(), controller.signal)
}
