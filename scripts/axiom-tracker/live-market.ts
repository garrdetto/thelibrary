import type { TrackerDatabase } from './db.js'
import { bestPairByMint, readMarket, type DexPair } from './dexscreener.js'
import { chunk, createLogger, errorMessage, fetchJson, sleep } from './runtime.js'
import { activeCandidates, trackerState } from './state.js'

const logger = createLogger('live-market')
const tickIntervalMs = 1_000
const tickHistoryMs = 11 * 60_000

export type MarketTick = { t: number; price: number | null; viewers: number | null; liquidity: number | null; marketCap: number | null; holders: number | null }

export const marketTicks = new Map<string, MarketTick[]>()

function recordTicks(now: number) {
  for (const candidate of trackerState.active) {
    const market = trackerState.market.get(candidate.mint)
    if (!market) continue
    const viewer = trackerState.viewers.get(candidate.mint)
    const ticks = marketTicks.get(candidate.mint) ?? []
    const card = trackerState.pulseCards.get(candidate.mint)
    ticks.push({ t: now, price: market.priceUsd, viewers: viewer && now - viewer.at < 30_000 ? viewer.count : null, liquidity: market.liquidityUsd, marketCap: market.marketCap, holders: card && now - card.seenAt < 60_000 ? card.holders : null })
    while (ticks.length && now - ticks[0].t > tickHistoryMs) ticks.shift()
    marketTicks.set(candidate.mint, ticks)
  }
  if (trackerState.active.length) for (const mint of marketTicks.keys()) if (!trackerState.active.some(candidate => candidate.mint === mint)) marketTicks.delete(mint)
}

export function tickAt(ticks: MarketTick[], target: number, tolerance: number, field: 'price' | 'viewers' | 'liquidity' | 'holders') {
  let best: MarketTick | null = null
  for (const tick of ticks) {
    if (tick[field] === null) continue
    const distance = Math.abs(tick.t - target)
    if (distance <= tolerance && (!best || distance < Math.abs(best.t - target))) best = tick
  }
  return best?.[field] ?? null
}

async function fetchMarketsFast(mints: string[]) {
  const groups = await Promise.all(chunk(mints, 30).map(group => fetchJson<DexPair[]>(`https://api.dexscreener.com/tokens/v1/solana/${group.join(',')}`, { retries: 0, timeoutMs: 4_000 })))
  const now = Date.now()
  return new Map([...bestPairByMint(groups.flatMap(group => Array.isArray(group) ? group : []))].map(([mint, pair]) => [mint, readMarket(pair, now)]))
}

export function startLiveMarket(database: TrackerDatabase, signal: AbortSignal) {
  logger.info('Refreshing prices every second for tracked coins')
  const now = Date.now()
  const rows = database.prepare('SELECT mint, price_usd, viewers, liquidity_usd, market_cap, timestamp FROM snapshots WHERE timestamp >= ? ORDER BY timestamp ASC').all(now - tickHistoryMs) as Array<{ mint: string; price_usd: number | null; viewers: number | null; liquidity_usd: number | null; market_cap: number | null; timestamp: number }>
  for (const row of rows) {
    const ticks = marketTicks.get(row.mint) ?? []
    ticks.push({ t: row.timestamp, price: row.price_usd, viewers: row.viewers, liquidity: row.liquidity_usd, marketCap: row.market_cap, holders: null })
    marketTicks.set(row.mint, ticks)
  }
  const ticker = setInterval(() => recordTicks(Date.now()), tickIntervalMs)
  signal.addEventListener('abort', () => clearInterval(ticker), { once: true })
  return (async () => {
    let failures = 0
    while (!signal.aborted) {
      const started = Date.now()
      try {
        const mints = activeCandidates(database).map(candidate => candidate.mint)
        if (mints.length) {
          const markets = await fetchMarketsFast(mints)
          for (const [mint, market] of markets) trackerState.market.set(mint, market)
        }
        failures = 0
      } catch (error) {
        failures += 1
        if (failures === 1 || failures % 30 === 0) logger.warn('Price refresh failed', { error: errorMessage(error), failures })
      }
      const interval = Math.max(tickIntervalMs, Math.ceil(trackerState.active.length / 30) * 400)
      const wait = failures ? Math.min(15_000, 1_000 * 2 ** Math.min(failures, 4)) : interval - (Date.now() - started)
      await sleep(Math.max(100, wait), signal)
    }
  })()
}
