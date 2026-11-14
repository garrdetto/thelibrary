import type { TrackerDatabase } from './db.js'
import type { MarketReading } from './dexscreener.js'
import { trackerConfig } from './runtime.js'

export type ActiveCandidate = { mint: string; pairAddress: string; symbol: string; momentum: number }

export const trackerState = {
  active: [] as ActiveCandidate[],
  market: new Map<string, MarketReading>(),
  viewers: new Map<string, { count: number; at: number; source: 'websocket' | 'page' | 'extension' }>(),
  watchlist: new Map<string, number>(),
}

export function activeCandidates(database: TrackerDatabase): ActiveCandidate[] {
  if (trackerState.active.length) return trackerState.active
  const now = Date.now()
  const rows = database.prepare(`
    SELECT t.mint, t.pair_address AS pairAddress, t.symbol,
      COALESCE((SELECT s.volume_5m FROM snapshots s WHERE s.mint = t.mint ORDER BY s.timestamp DESC LIMIT 1), 0) AS momentum
    FROM tokens t
    WHERE t.pair_created_at >= ? AND t.last_seen_at >= ?
    ORDER BY momentum DESC
    LIMIT ?
  `).all(now - trackerConfig.maxPairAgeMs, now - 5 * 60_000, trackerConfig.maxCandidates) as ActiveCandidate[]
  return rows
}

export function latestMarket(database: TrackerDatabase, mint: string): MarketReading | null {
  const cached = trackerState.market.get(mint)
  if (cached) return cached
  const row = database.prepare(`
    SELECT s.mint, t.pair_address AS pairAddress, s.price_usd AS priceUsd, s.market_cap AS marketCap, s.liquidity_usd AS liquidityUsd,
      s.volume_5m AS volume5m, s.buys_5m AS buys5m, s.sells_5m AS sells5m, t.pair_created_at AS pairCreatedAt, s.timestamp AS readAt
    FROM snapshots s JOIN tokens t ON t.mint = s.mint
    WHERE s.mint = ? ORDER BY s.timestamp DESC LIMIT 1
  `).get(mint) as MarketReading | undefined
  return row ?? null
}
