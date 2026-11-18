import type { RadarEarlyStart, RadarScoreCheck } from '../../src/lib/axiom-radar-types.js'

/**
 * The pattern that fires, every part at once. It is the minute before Jojo left its $20-26K range on its way to $91K:
 * six minutes old, 600 watching a $25K coin, 5-minute volume over twice its market cap, trades up 45% in a minute and
 * viewers up 9% in 30 seconds, while the price was still within 30% of its 3-minute low.
 */
export const earlyRules = {
  maxAgeMinutes: 15,
  minMarketCap: 10_000,
  minViewers: 100,
  viewersPerThousand: 8,
  turnover: 1,
  tradesRise: 15,
  viewersRise: 5,
  maxStretch: 35,
  minMinuteChange: -5,
  fadingDrop: 5,
  lowWindowMs: 3 * 60_000,
}

/** Points lost from the early-start reading while trading is fading or the price is falling. */
export const earlyCuts = { fading: 15, falling: 15 }

export type EarlyPoint = { t: number; price: number }

export type EarlyInput = {
  ageMinutes: number | null
  marketCap: number | null
  viewers: number | null
  /** Viewers about 30 seconds ago. */
  viewersBefore: number | null
  volume5m: number | null
  /** 5-minute volume as it stood a minute ago. */
  volumeBefore: number | null
  trades5m: number | null
  /** 5-minute trades as they stood a minute ago. */
  tradesBefore: number | null
  /** How far the price is above its 3-minute low, in percent. */
  stretchPct: number | null
  /** Price change over the last minute, in percent. */
  minuteChange: number | null
  /** The gate that zeroes the runner score, if one failed. */
  blockedBy?: string | null
}

const round1 = (value: number) => Math.round(value * 10) / 10
const signed = (value: number) => `${value > 0 ? '+' : ''}${round1(value)}%`
const money = (value: number) => value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `$${(value / 1_000).toFixed(1)}K` : `$${Math.round(value)}`
const change = (now: number | null, before: number | null) => now !== null && before !== null && before > 0 ? ((now - before) / before) * 100 : null

function tier(value: number | null, steps: Array<[number, number]>) {
  if (value === null) return 0
  for (const [limit, points] of steps) if (value >= limit) return points
  return 0
}

function sign(label: string, reading: string, points: number, max: number, known: boolean): RadarScoreCheck {
  return { label, reading, points, max, status: !known ? 'unknown' : points >= max ? 'earned' : points > 0 ? 'partial' : 'missed' }
}

/**
 * How far the latest price sits above the lowest price of the last 3 minutes, in percent. The low is the lowest middle
 * value of three readings in a row, so a single stray reading cannot set it.
 */
export function stretchAboveLow(points: EarlyPoint[], now: number, price: number | null, windowMs = earlyRules.lowWindowMs) {
  if (price === null || !(price > 0)) return null
  const recent = points.filter(point => point.price > 0 && now - point.t <= windowMs && point.t <= now).map(point => point.price)
  if (recent.length < 3) return null
  let low = Infinity
  for (let index = 2; index < recent.length; index++) {
    const three = [recent[index - 2], recent[index - 1], recent[index]].sort((first, second) => first - second)
    low = Math.min(low, three[1])
  }
  if (!Number.isFinite(low) || low <= 0) return null
  return Math.max(0, round1((price / low - 1) * 100))
}

/** Trading that has slowed: 5-minute trades or volume at least 5% under where they stood a minute ago. */
export function fadingReason(input: Pick<EarlyInput, 'trades5m' | 'tradesBefore' | 'volume5m' | 'volumeBefore'>) {
  const trades = change(input.trades5m, input.tradesBefore)
  const volume = change(input.volume5m, input.volumeBefore)
  if (trades !== null && trades <= -earlyRules.fadingDrop) return `5-minute trades down ${Math.round(-trades)}% from a minute ago`
  if (volume !== null && volume <= -earlyRules.fadingDrop) return `5-minute volume down ${Math.round(-volume)}% from a minute ago`
  return null
}

/**
 * The early-start reading out of 100, from signs that show before the price moves: crowd for the coin's size 25, trading
 * for its size 20, trades picking up 15, viewers picking up 15, age 15, price still near its 3-minute low 10. Fading
 * trading and a falling price each take 15 off. `firing` needs every part of `earlyRules` at once and no failed gate.
 */
export function earlyStart(input: EarlyInput): RadarEarlyStart {
  const { ageMinutes, marketCap, viewers } = input
  const perThousand = viewers !== null && marketCap !== null && marketCap > 0 ? viewers / (marketCap / 1_000) : null
  const turnover = input.volume5m !== null && marketCap !== null && marketCap > 0 ? input.volume5m / marketCap : null
  const tradesRise = change(input.trades5m, input.tradesBefore)
  const viewersRise = change(viewers, input.viewersBefore)
  const stretch = input.stretchPct
  const crowdPoints = tier(perThousand, [[20, 25], [10, 20], [earlyRules.viewersPerThousand, 16], [5, 10], [2, 4]])
  const turnoverPoints = tier(turnover, [[2, 20], [earlyRules.turnover, 16], [0.5, 10], [0.3, 5]])
  const tradePoints = tier(tradesRise, [[40, 15], [earlyRules.tradesRise, 12], [5, 6]])
  const viewerPoints = tier(viewersRise, [[15, 15], [earlyRules.viewersRise, 12], [2, 5]])
  const agePoints = ageMinutes === null ? 0 : ageMinutes <= 5 ? 15 : ageMinutes <= earlyRules.maxAgeMinutes ? 12 : ageMinutes <= 30 ? 6 : ageMinutes <= 60 ? 3 : 0
  const lowPoints = stretch === null ? 0 : stretch <= 15 ? 10 : stretch <= earlyRules.maxStretch ? 6 : 0
  const signs = [
    sign('Watching per $1K of market cap: 20+ 25, 10+ 20, 8+ 16, 5+ 10, 2+ 4', perThousand === null ? 'not read yet' : `${(viewers as number).toLocaleString('en-US')} watching a ${money(marketCap as number)} coin (${round1(perThousand)} per $1K)`, crowdPoints, 25, perThousand !== null),
    sign('5-minute volume against market cap: 2x 20, 1x 16, 0.5x 10, 0.3x 5', turnover === null ? 'not read yet' : `${money(input.volume5m as number)} in 5m on a ${money(marketCap as number)} coin (${round1(turnover)}x)`, turnoverPoints, 20, turnover !== null),
    sign('Trades against a minute ago: +40% 15, +15% 12, +5% 6', tradesRise === null ? 'not read yet' : `${signed(tradesRise)} (${Math.round(input.trades5m as number).toLocaleString('en-US')} trades in 5m)`, tradePoints, 15, tradesRise !== null),
    sign('Viewers against 30 seconds ago: +15% 15, +5% 12, +2% 5', viewersRise === null ? 'not read yet' : signed(viewersRise), viewerPoints, 15, viewersRise !== null),
    sign('Age: 5 min or less 15, 15 min 12, 30 min 6, an hour 3', ageMinutes === null ? 'not read yet' : `${Math.round(ageMinutes)} min old`, agePoints, 15, ageMinutes !== null),
    sign('Above its 3-minute low: within 15% 10, within 35% 6', stretch === null ? 'not read yet' : `${round1(stretch)}% above it`, lowPoints, 10, stretch !== null),
  ]
  const fading = fadingReason(input)
  const falling = input.minuteChange !== null && input.minuteChange < earlyRules.minMinuteChange
  const earned = signs.reduce((total, item) => total + item.points, 0)
  const score = Math.max(0, Math.min(100, earned - (fading ? earlyCuts.fading : 0) - (falling ? earlyCuts.falling : 0)))
  const needs: Array<[boolean, string]> = [
    [ageMinutes !== null && ageMinutes <= earlyRules.maxAgeMinutes, `${earlyRules.maxAgeMinutes} minutes old or less`],
    [marketCap !== null && marketCap >= earlyRules.minMarketCap, `${money(earlyRules.minMarketCap)} market cap or more`],
    [viewers !== null && viewers >= earlyRules.minViewers, `${earlyRules.minViewers}+ watching`],
    [perThousand !== null && perThousand >= earlyRules.viewersPerThousand, `${earlyRules.viewersPerThousand}+ watching per $1K of market cap`],
    [turnover !== null && turnover >= earlyRules.turnover, '5-minute volume at least its market cap'],
    [tradesRise !== null && tradesRise >= earlyRules.tradesRise, `trades up ${earlyRules.tradesRise}% in a minute`],
    [viewersRise !== null && viewersRise >= earlyRules.viewersRise, `viewers up ${earlyRules.viewersRise}% in 30 seconds`],
    [stretch !== null && stretch <= earlyRules.maxStretch, `price within ${earlyRules.maxStretch}% of its 3-minute low`],
    [!falling, 'price not falling over the last minute'],
  ]
  const missing = needs.filter(([met]) => !met).map(([, label]) => label)
  const blockedBy = input.blockedBy ?? null
  return { score, firing: missing.length === 0 && blockedBy === null, signs, stretchPct: stretch, fading, blockedBy, missing }
}

/** The same reading once the runner score's gates are known: a failed gate stops it firing. */
export function withEarlyGate(early: RadarEarlyStart, blockedBy: string | null): RadarEarlyStart {
  return { ...early, blockedBy, firing: early.missing.length === 0 && blockedBy === null }
}
