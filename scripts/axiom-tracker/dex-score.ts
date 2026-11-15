import type { RadarDexCheck, RadarDexMoves, RadarDexScore } from '../../src/lib/axiom-radar-types.js'

/**
 * Price movement windows for the DexScreener score. Each change is read against the size of a strong move for that window
 * (2% in 5 seconds is as strong as 30% in 5 minutes) and held to -1..+1, so one spike cannot carry it; the longer windows weigh more.
 */
export const dexWindows = [
  { key: 's5', label: '5s', weight: 0.1, strong: 2 },
  { key: 's30', label: '30s', weight: 0.2, strong: 6 },
  { key: 'm1', label: '1m', weight: 0.3, strong: 10 },
  { key: 'm5', label: '5m', weight: 0.4, strong: 30 },
] as const

export const dexPoints = { movement: 50, volume: 20, liquidity: 15, buyers: 15, falling: 20 } as const
/** Holder percentages over the hard limits keep the DexScreener score at or under this. */
export const dexHolderCap = 20
/** Share of the volume, liquidity and buyer points a coin keeps when it is not rising; the rest comes with the move. */
export const dexFlatShare = 0.25

export type DexScoreInput = {
  moves: RadarDexMoves
  liquidity: number | null
  marketCap: number | null
  volume5m: number | null
  buys5m: number | null
  sells5m: number | null
  botClimb: boolean
  authorityOn: boolean
  holderBlocked: string | null
  severeSelling: boolean
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const logScale = (value: number | null, zero: number, full: number) => value === null || value <= zero ? 0 : clamp01(Math.log10(value / zero) / Math.log10(full / zero))
const signed = (value: number) => `${value > 0 ? '+' : ''}${Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)}%`
const money = (value: number) => value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(2)}M` : value >= 1_000 ? `$${(value / 1_000).toFixed(1)}K` : `$${Math.round(value)}`

/** The weighted move from -1 (falling hard in every window) to +1, over the windows that have a reading. */
export function dexMovement(moves: RadarDexMoves) {
  let weighted = 0
  let weights = 0
  const readings: string[] = []
  for (const window of dexWindows) {
    const value = moves[window.key]
    if (value === null || !Number.isFinite(value)) continue
    weighted += window.weight * Math.max(-1, Math.min(1, value / window.strong))
    weights += window.weight
    readings.push(`${window.label} ${signed(value)}`)
  }
  return weights ? { signal: weighted / weights, readings, coverage: weights } : null
}

/**
 * The DexScreener score out of 100, from market data alone (no Axiom tab needed): weighted price movement over 5s, 30s, 1m
 * and 5m (50, scaled by how much liquidity and volume stand behind the move), 5-minute volume and turnover (20), liquidity
 * depth against market cap (15) and buy pressure (15), those three counting in full only while the coin rises, less up to 20 for a coin falling across the windows. A bot climb, mint
 * or freeze authority or a severe holder sell-off make it 0, and holder percentages over the hard limits hold it at 20.
 */
export function scoreDex(input: DexScoreInput): RadarDexScore {
  const movement = dexMovement(input.moves)
  const liquidityDepth = logScale(input.liquidity, 2_000, 100_000)
  const volumeDepth = logScale(input.volume5m, 500, 50_000)
  const backing = 0.35 + 0.65 * (liquidityDepth + volumeDepth) / 2
  const rising = movement ? Math.max(0, movement.signal) : 0
  const movementEarned = Math.round(dexPoints.movement * rising * backing * 10) / 10
  const fallingCost = movement && movement.signal < 0 ? Math.round(dexPoints.falling * -movement.signal) : 0

  const turnover = input.volume5m !== null && input.liquidity ? input.volume5m / input.liquidity : null
  const turnoverPoints = turnover === null ? 0 : turnover >= 0.5 ? 8 : turnover >= 0.2 ? 5 : turnover >= 0.05 ? 2 : 0
  const volumeEarned = Math.round((volumeDepth * 12 + turnoverPoints) * 10) / 10

  const liquidityShare = input.liquidity !== null && input.marketCap ? input.liquidity / input.marketCap : null
  const thin = liquidityShare !== null && liquidityShare < 0.05
  const liquidityEarned = Math.round(liquidityDepth * dexPoints.liquidity * (thin ? 0.5 : 1) * 10) / 10

  const transactions = (input.buys5m ?? 0) + (input.sells5m ?? 0)
  const buyShare = transactions ? (input.buys5m ?? 0) / transactions : null
  const shareEarned = buyShare === null ? 0 : clamp01((buyShare - 0.5) / 0.25) * 10
  const activityEarned = logScale(transactions || null, 5, 300) * 5
  const buyersEarned = Math.round((shareEarned + activityEarned) * 10) / 10

  const checks: RadarDexCheck[] = [
    { label: `Movement, weighted 5s 10%, 30s 20%, 1m 30%, 5m 40%, times liquidity and volume backing (${Math.round(backing * 100)}%)`, reading: movement ? `${movement.readings.join(', ')} (${movement.signal >= 0 ? '+' : ''}${Math.round(movement.signal * 100)}% of a strong move)` : 'no price readings yet', points: movementEarned, max: dexPoints.movement },
    { label: '5-minute volume ($500 to $50K) and turnover of the pool (50%+ 8, 20%+ 5, 5%+ 2)', reading: input.volume5m === null ? 'not read yet' : `${money(input.volume5m)}${turnover === null ? '' : `, ${Math.round(turnover * 100)}% of liquidity`}`, points: volumeEarned, max: dexPoints.volume },
    { label: 'Liquidity depth ($2K to $100K), halved when under 5% of market cap', reading: input.liquidity === null ? 'not read yet' : `${money(input.liquidity)}${liquidityShare === null ? '' : `, ${Math.round(liquidityShare * 1000) / 10}% of market cap`}`, points: liquidityEarned, max: dexPoints.liquidity },
    { label: 'Buy pressure: buy share over 50% (10) and 5-minute trades (5)', reading: buyShare === null ? 'no trades read yet' : `${Math.round(buyShare * 100)}% buys of ${transactions} trades`, points: buyersEarned, max: dexPoints.buyers },
  ]
  const support = dexFlatShare + (1 - dexFlatShare) * rising
  const supportEarned = Math.round((volumeEarned + liquidityEarned + buyersEarned) * support * 10) / 10
  checks.push({ label: `Volume, liquidity and buyers count in full only while rising (${Math.round(dexFlatShare * 100)}% when flat)`, reading: `${Math.round(support * 100)}% counted`, points: Math.round((supportEarned - volumeEarned - liquidityEarned - buyersEarned) * 10) / 10, max: 0 })
  if (fallingCost) checks.push({ label: `Falling across the windows: up to -${dexPoints.falling}`, reading: movement?.readings.join(', ') ?? '', points: -fallingCost, max: 0 })

  const cuts: string[] = []
  let score = Math.max(0, Math.min(100, Math.round(movementEarned + supportEarned - fallingCost)))
  if (fallingCost) cuts.push(`Falling: -${fallingCost}`)
  const zeroed = input.botClimb ? 'Bot-driven climb' : input.authorityOn ? 'Mint or freeze authority on' : input.severeSelling ? 'Holders selling hard' : null
  if (zeroed) {
    cuts.push(`${zeroed}: scored 0`)
    score = 0
  } else if (input.holderBlocked && score > dexHolderCap) {
    cuts.push(`${input.holderBlocked}: held to ${dexHolderCap}`)
    score = dexHolderCap
  }
  return { score, moves: input.moves, signal: movement ? Math.round(movement.signal * 100) / 100 : null, checks, cuts }
}
