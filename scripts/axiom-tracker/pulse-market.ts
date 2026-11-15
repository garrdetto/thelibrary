import type { RadarPulseMetrics } from '../../src/lib/axiom-radar-types.js'
import type { DexPair, MarketReading } from './dexscreener.js'
import { trackerState } from './state.js'

const shortAddress = /^[1-9A-HJ-NP-Za-km-z]{3,8}\.\.\.[1-9A-HJ-NP-Za-km-z]{3,8}$/
const agePattern = /^(\d+)(s|m|h|d|w|mo|y)$/
const ageUnits: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, mo: 2_592_000_000, y: 31_536_000_000 }
/** Pulse cards refresh about once a second while the tab is open; older figures fall back to DexScreener. */
export const pulseFreshMs = 5_000
const pumpSupply = 1_000_000_000
const flowKeepMs = 6 * 60_000
const flowWindowMs = 5 * 60_000

export type PulseIdentity = { symbol: string; name: string; pairAddress: string | null; createdAt: number | null; seenAt: number }

/** The ticker and name on a Pulse card (the two lines after the shortened address) and its age line as a launch time. */
export function pulseIdentity(lines: string[], pairAddress: string | null, seenAt: number): PulseIdentity | null {
  const clean = lines.map(line => line.trim()).filter(Boolean)
  const at = clean.findIndex(line => shortAddress.test(line))
  if (at < 0 || !clean[at + 1]) return null
  const age = clean.slice(at + 1).find(line => agePattern.test(line))?.match(agePattern)
  const symbol = clean[at + 1].slice(0, 24)
  const name = (clean[at + 2] && !agePattern.test(clean[at + 2]) && !/%$/.test(clean[at + 2]) ? clean[at + 2] : symbol).slice(0, 80)
  return { symbol, name, pairAddress, createdAt: age ? seenAt - Number(age[1]) * ageUnits[age[2]] : null, seenAt }
}

type FlowPoint = { t: number; volume: number; txns: number }
const flows = new Map<string, FlowPoint[]>()

/** Keeps the card's running volume and transaction totals so a five-minute figure can be taken from them. */
export function notePulseFlow(mint: string, card: RadarPulseMetrics) {
  if (card.volume === null && card.txCount === null) return
  const points = flows.get(mint) ?? []
  points.push({ t: card.seenAt, volume: card.volume ?? points.at(-1)?.volume ?? 0, txns: card.txCount ?? points.at(-1)?.txns ?? 0 })
  while (points.length && card.seenAt - points[0].t > flowKeepMs) points.shift()
  flows.set(mint, points)
  if (flows.size > 1_000) for (const [key, list] of flows) if (card.seenAt - (list.at(-1)?.t ?? 0) > flowKeepMs) flows.delete(key)
}

/**
 * Five-minute volume and transactions from the card's running totals. With under five minutes of readings the change is
 * scaled up to five minutes; a coin younger than five minutes uses its whole total.
 */
export function pulseFlow5m(mint: string, now: number, createdAt: number | null) {
  const points = (flows.get(mint) ?? []).filter(point => now - point.t <= flowKeepMs)
  const latest = points.at(-1)
  if (!latest) return null
  if (createdAt !== null && now - createdAt <= flowWindowMs) return { volume: latest.volume, txns: latest.txns }
  const first = points.find(point => latest.t - point.t <= flowWindowMs) ?? points[0]
  const span = latest.t - first.t
  if (span < 30_000) return null
  const scale = Math.max(1, flowWindowMs / span)
  return { volume: Math.max(0, (latest.volume - first.volume) * scale), txns: Math.max(0, Math.round((latest.txns - first.txns) * scale)) }
}

/**
 * A market reading that follows Axiom's own card, which updates every second, instead of DexScreener's cached figures.
 * With a DexScreener reading the price moves with the card's market cap; without one the price comes from the market cap
 * over pump.fun's billion-token supply and the volume from the card's running totals.
 */
export function withPulseMarket(mint: string, market: MarketReading | null, now: number): MarketReading | null {
  const card = trackerState.pulseCards.get(mint)
  if (!card || now - card.seenAt > pulseFreshMs || !card.marketCap || card.marketCap <= 0) return market
  if (market && market.marketCap && market.marketCap > 0 && market.priceUsd) {
    const ratio = card.marketCap / market.marketCap
    if (ratio < 0.2 || ratio > 5) return market
    return { ...market, priceUsd: market.priceUsd * ratio, marketCap: card.marketCap, readAt: card.seenAt }
  }
  const identity = trackerState.pulseNames.get(mint)
  const flow = pulseFlow5m(mint, now, identity?.createdAt ?? null)
  const half = flow ? Math.round(flow.txns / 2) : market?.buys5m ?? 0
  return {
    mint,
    pairAddress: market?.pairAddress ?? identity?.pairAddress ?? mint,
    priceUsd: card.marketCap / pumpSupply,
    marketCap: card.marketCap,
    liquidityUsd: market?.liquidityUsd ?? null,
    volume5m: flow ? flow.volume : market?.volume5m ?? 0,
    buys5m: half,
    sells5m: flow ? flow.txns - half : market?.sells5m ?? 0,
    pairCreatedAt: market?.pairCreatedAt ?? identity?.createdAt ?? null,
    readAt: card.seenAt,
  }
}

/** Points the tracked coin's market reading at its Pulse card when the card is fresh. */
export function applyPulseMarket(mint: string, now: number) {
  const updated = withPulseMarket(mint, trackerState.market.get(mint) ?? null, now)
  if (updated) trackerState.market.set(mint, updated)
}

/** A stand-in DexScreener pair for a Pulse coin DexScreener has not listed yet, so the radar can follow it from its card. */
export function pairFromPulse(mint: string, now: number): DexPair | null {
  const card = trackerState.pulseCards.get(mint)
  const identity = trackerState.pulseNames.get(mint)
  if (!card || !identity || now - card.seenAt > 60_000 || !card.marketCap) return null
  const market = withPulseMarket(mint, null, card.seenAt)
  return {
    chainId: 'solana',
    dexId: 'pumpfun',
    pairAddress: identity.pairAddress ?? mint,
    baseToken: { address: mint, name: identity.name, symbol: identity.symbol },
    priceUsd: String(card.marketCap / pumpSupply),
    txns: { m5: { buys: market?.buys5m ?? 0, sells: market?.sells5m ?? 0 } },
    volume: { m5: market?.volume5m ?? 0 },
    marketCap: card.marketCap,
    pairCreatedAt: identity.createdAt ?? undefined,
  }
}
