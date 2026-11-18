import type { RadarTierMatch } from '../../src/lib/axiom-radar-learner.js'

/** Peaks further than this above first sight come from bad price readings, not real runs, and are scored as no rise at all. */
export const believableMultiple = 1_000

/** Every archived coin is ranked by its outcome into this many tiers of equal size: tier 1 holds the best results, the last tier the worst. */
export const tierCount = 20
/** A live coin's risk is its chance of landing in this many of the bottom tiers. */
export const riskTiers = 5
/** No tier match is shown until this many coins are archived. */
export const minimumArchive = 200
/** Features a tier profile needs readings for before a live coin can be matched on it. */
const minimumFeatures = 4
const minimumReadings = 3
/** How many matching features count as independent evidence; more than this would make every match look certain. */
const evidenceCap = 8

export type CoinClass = 'garbage' | 'steady_rug' | 'rug' | 'normal' | 'runner'
export type FeatureValues = Record<string, number | null | undefined>

/** The early picture compared across tiers: the learner's first-minute features plus the tracker's own readings. `log` features are compared on a log scale. */
export const tierFeatures: ReadonlyArray<{ key: string; log: boolean }> = [
  { key: 'ageAtSight', log: true },
  { key: 'viewers', log: true },
  { key: 'viewerGrowth', log: false },
  { key: 'holders', log: true },
  { key: 'holderGrowth', log: false },
  { key: 'buyRatio', log: false },
  { key: 'buys5m', log: true },
  { key: 'volume5m', log: true },
  { key: 'liquidity', log: true },
  { key: 'marketCap', log: true },
  { key: 'priceMove5m', log: false },
  { key: 'top10', log: false },
  { key: 'dev', log: false },
  { key: 'snipers', log: false },
  { key: 'insiders', log: false },
  { key: 'bundlers', log: false },
  { key: 'smartWallets', log: true },
  { key: 'quality', log: false },
  { key: 'score', log: false },
  { key: 'walletScore', log: false },
  { key: 'proTraders', log: false },
  { key: 'holdersPerMin', log: false },
]

export type FeatureStat = { mean: number; sd: number; n: number }
export type TierProfile = { tier: number; coins: number; weight: number; minScore: number; maxScore: number; stats: Record<string, FeatureStat> }
export type TierLadder = { profiles: TierProfile[]; spread: Record<string, number>; coins: number }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)
const scaled = (value: number, log: boolean) => log ? Math.sign(value) * Math.log1p(Math.abs(value)) : value

/**
 * How much a coin's summary can be trusted, from 0 to 1: more readings and a longer stretch of watching both count.
 * A coin seen a handful of times for a minute weighs almost nothing; 120+ readings over 20+ minutes weigh in full.
 */
export function dataWeight(points: number, minutes: number) {
  if (points <= 0 || minutes < 0) return 0
  return Math.round((1 - Math.exp(-points / 40)) * Math.min(1, Math.sqrt(minutes / 20)) * 1000) / 1000
}

export type ClassInput = { points: number; hasLifecycle: boolean; maxLiquidity: number | null; peakVolume5m: number | null; outcome: string; multiple: number; upShare: number | null; volumeToMcap: number | null }

/**
 * Garbage never had the liquidity or volume to trade, or (with no lifecycle to go on) too few readings to judge. A steady-rise rug climbed in small, mostly upward steps on thin volume
 * for its market cap (a bot walking the price up) and was then pulled. Both are kept in the archive but rank at the bottom.
 */
export function classifyCoin(input: ClassInput): CoinClass {
  if ((!input.hasLifecycle && input.points < 6) || (input.maxLiquidity ?? 0) < 6_000 || (input.peakVolume5m !== null && input.peakVolume5m < 1_000)) return 'garbage'
  const rugged = input.outcome === 'rug'
  if (rugged && input.multiple >= 1.3 && (input.upShare ?? 0) >= 0.7 && input.volumeToMcap !== null && input.volumeToMcap < 0.05) return 'steady_rug'
  if (rugged) return 'rug'
  if (input.multiple >= 3) return 'runner'
  return 'normal'
}

export type OutcomeInput = { firstMcap: number | null; peakMcap: number | null; lastMcap: number | null; maxLiquidity: number | null; peakVolume5m: number | null; lifeMinutes: number; cls: CoinClass }

const classFactor: Record<CoinClass, number> = { runner: 1, normal: 1, rug: 0.5, steady_rug: 0.15, garbage: 0.1 }

/**
 * One 0-100 number for how a coin turned out, used to rank it into its tier. Most of it is how far it rose from first sight
 * (20x or more counts in full), then how much of that rise it kept, then whether real liquidity and volume backed it for long enough.
 * Rugs keep half, steady-rise rugs and garbage almost nothing.
 */
export function outcomeScore(input: OutcomeInput) {
  const raw = finite(input.firstMcap) && finite(input.peakMcap) && input.firstMcap > 0 ? input.peakMcap / input.firstMcap : 1
  const multiple = raw > believableMultiple ? 1 : raw
  const rise = clamp(Math.log(Math.max(1, multiple)) / Math.log(20), 0, 1)
  const kept = raw <= believableMultiple && finite(input.peakMcap) && finite(input.lastMcap) && input.peakMcap > 0 ? clamp(input.lastMcap / input.peakMcap, 0, 1) : 0
  const backed = (clamp(Math.sqrt((input.maxLiquidity ?? 0) / 40_000), 0, 1) + clamp(Math.sqrt((input.peakVolume5m ?? 0) / 20_000), 0, 1)) / 2
  const lasted = clamp(input.lifeMinutes / 120, 0, 1)
  const score = 100 * (0.6 * rise + 0.2 * rise * kept + 0.2 * backed * Math.sqrt(lasted) * (0.4 + 0.6 * rise))
  return Math.round(score * classFactor[input.cls] * 100) / 100
}

/**
 * Ranks coins best first and splits them into `tierCount` tiers that each hold an equal share of the total data weight, so a coin
 * counts toward its tier in proportion to how much data backs it and thinly seen coins crowd together at the bottom instead of
 * filling whole tiers. Without weights every coin counts once. Ties keep a stable order by mint.
 */
export function assignTiers(rows: Array<{ mint: string; score: number; weight?: number }>) {
  const ordered = [...rows].sort((first, second) => second.score - first.score || (first.mint < second.mint ? -1 : 1))
  const weights = ordered.map(row => Math.max(0, row.weight ?? 1))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const tiers = new Map<string, number>()
  let before = 0
  ordered.forEach((row, index) => {
    const position = total > 0 ? (before + weights[index] / 2) / total : (index + 0.5) / ordered.length
    tiers.set(row.mint, Math.min(tierCount, Math.floor(position * tierCount) + 1))
    before += weights[index]
  })
  return tiers
}

function weightedStat(values: Array<{ value: number; weight: number }>): FeatureStat | null {
  const total = values.reduce((sum, entry) => sum + entry.weight, 0)
  if (values.length === 0 || total <= 0) return null
  const mean = values.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / total
  const variance = values.reduce((sum, entry) => sum + entry.weight * (entry.value - mean) ** 2, 0) / total
  return { mean, sd: Math.sqrt(variance), n: values.length }
}

/** Each tier's weighted average and spread of every early feature; coins pull on their tier in proportion to their data weight. */
export function buildLadder(rows: Array<{ tier: number; score: number; weight: number; features: FeatureValues }>): TierLadder {
  const profiles: TierProfile[] = []
  const spread: Record<string, number> = {}
  for (const feature of tierFeatures) {
    const all = rows.flatMap(row => finite(row.features[feature.key]) && row.weight > 0 ? [{ value: scaled(row.features[feature.key] as number, feature.log), weight: row.weight }] : [])
    const stat = weightedStat(all)
    if (stat && stat.sd > 0) spread[feature.key] = stat.sd
  }
  for (let tier = 1; tier <= tierCount; tier++) {
    const members = rows.filter(row => row.tier === tier)
    if (members.length === 0) continue
    const stats: Record<string, FeatureStat> = {}
    for (const feature of tierFeatures) {
      const stat = weightedStat(members.flatMap(row => finite(row.features[feature.key]) && row.weight > 0 ? [{ value: scaled(row.features[feature.key] as number, feature.log), weight: row.weight }] : []))
      if (stat) stats[feature.key] = stat
    }
    const scores = members.map(row => row.score)
    profiles.push({ tier, coins: members.length, weight: Math.round(members.reduce((sum, row) => sum + row.weight, 0) * 100) / 100, minScore: Math.min(...scores), maxScore: Math.max(...scores), stats })
  }
  return { profiles, spread, coins: rows.length }
}

/**
 * Compares a live coin's early picture with every tier profile and turns the distances into a chance for each tier.
 * The expected tier is the chance-weighted average, risk is the chance of the bottom `riskTiers`, and the score maps tier 1 to 100 and the last tier to 0.
 */
export function matchTier(features: FeatureValues, ladder: TierLadder | null): RadarTierMatch | null {
  if (!ladder || ladder.coins < minimumArchive || ladder.profiles.length < tierCount) return null
  const logLikelihoods: Array<{ tier: number; value: number }> = []
  for (const profile of ladder.profiles) {
    let total = 0
    let used = 0
    for (const feature of tierFeatures) {
      const raw = features[feature.key]
      const stat = profile.stats[feature.key]
      const overall = ladder.spread[feature.key]
      if (!finite(raw) || !stat || stat.n < minimumReadings || !overall) continue
      const sd = Math.max(stat.sd, overall * 0.25, 1e-6)
      total += ((scaled(raw, feature.log) - stat.mean) / sd) ** 2
      used += 1
    }
    if (used < minimumFeatures) return null
    logLikelihoods.push({ tier: profile.tier, value: -0.5 * (total / used) * Math.min(used, evidenceCap) })
  }
  const best = Math.max(...logLikelihoods.map(entry => entry.value))
  const weights = logLikelihoods.map(entry => ({ tier: entry.tier, weight: Math.exp(entry.value - best) }))
  const sum = weights.reduce((total, entry) => total + entry.weight, 0)
  const chances = weights.map(entry => ({ tier: entry.tier, chance: entry.weight / sum }))
  const expected = chances.reduce((total, entry) => total + entry.tier * entry.chance, 0)
  const risk = chances.filter(entry => entry.tier > tierCount - riskTiers).reduce((total, entry) => total + entry.chance, 0)
  const likeliest = chances.reduce((top, entry) => entry.chance > top.chance ? entry : top)
  return {
    tier: likeliest.tier,
    expectedTier: Math.round(expected * 10) / 10,
    risk: Math.round(risk * 100) / 100,
    score: Math.round(100 * (tierCount - expected) / (tierCount - 1)),
    coins: ladder.coins,
  }
}
