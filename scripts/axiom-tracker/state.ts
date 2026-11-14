import type { TrackerDatabase } from './db.js'
import type { RadarPulseMetrics } from '../../src/lib/axiom-radar-types.js'
import type { MarketReading } from './dexscreener.js'
import { trackerConfig } from './runtime.js'

export type ActiveCandidate = { mint: string; pairAddress: string; symbol: string; momentum: number }

export type JupiterReading = {
  holders: number | null
  holdersPerMin: number | null
  holderChange5mPct: number | null
  top10Pct: number | null
  devPct: number | null
  devMigrations: number | null
  devMints: number | null
  buys5m: number | null
  sells5m: number | null
  traders5m: number | null
  netBuyers5m: number | null
  organicScore: number | null
  launchpad: string | null
  readAt: number
}

export const botClimbHoldMs = 30 * 60_000

export const trackerState = {
  jupiter: new Map<string, JupiterReading>(),
  botClimbs: new Map<string, { until: number; reason: string }>(),
  active: [] as ActiveCandidate[],
  market: new Map<string, MarketReading>(),
  viewers: new Map<string, { count: number; at: number; source: 'websocket' | 'page' | 'extension' }>(),
  watchlist: new Map<string, number>(),
  pulse: new Map<string, number>(),
  pulseCards: new Map<string, RadarPulseMetrics>(),
  holderCounts: new Map<string, { count: number; at: number }>(),
}

/** A coin caught in a manufactured climb stays flagged for half an hour, so a gap in the readings does not bring it back. */
export function activeBotClimb(mint: string, now: number) {
  const entry = trackerState.botClimbs.get(mint)
  if (!entry) return null
  if (entry.until > now) return entry
  trackerState.botClimbs.delete(mint)
  return null
}

export function activeCandidates(database: TrackerDatabase): ActiveCandidate[] {
  if (trackerState.active.length) return trackerState.active
  const now = Date.now()
  const rows = database.prepare(`
    SELECT t.mint, t.pair_address AS pairAddress, t.symbol,
      COALESCE((SELECT s.volume_5m FROM snapshots s WHERE s.mint = t.mint ORDER BY s.timestamp DESC LIMIT 1), 0) AS momentum
    FROM tokens t
    WHERE t.last_seen_at >= ?
    ORDER BY momentum DESC
    LIMIT ?
  `).all(now - 5 * 60_000, trackerConfig.maxCandidates) as ActiveCandidate[]
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

export const viewerFreshnessMs = { live: 60_000, page: 180_000 }

export function freshViewerCount(mint: string, now: number, liveWindowMs = viewerFreshnessMs.live) {
  const viewer = trackerState.viewers.get(mint)
  if (!viewer) return null
  return now - viewer.at < (viewer.source === 'page' ? viewerFreshnessMs.page : liveWindowMs) ? viewer.count : null
}
