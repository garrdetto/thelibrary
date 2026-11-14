import { radarFeatureKeys, radarFeatureLabels, type RadarFactor, type RadarFeatureKey, type RadarSafetyLevel, type RadarWeights } from '../../src/lib/axiom-radar-types.js'

export const radarThresholds = {
  paperTradeScore: 75,
  alertScore: 85,
  winReturn: 0.15,
  recalibrateEvery: 10,
  surgeDelta5m: 25,
}

export const defaultWeights: RadarWeights = { viewerVelocity: 1, activeViewers: 1, runnerWallets: 1, buyPressure: 1, safety: 1 }

export type SafetyInput = { rugScore: number | null; mintAuthority: boolean | null; freezeAuthority: boolean | null; top10Pct: number | null }

export type ScoreInput = SafetyInput & {
  viewers: number | null
  viewersDelta5m: number | null
  viewersPerMin?: number | null
  quality?: number | null
  runnerWallets: number
  buys5m: number | null
  sells5m: number | null
}

const clamp = (value: number, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value))

export function safetyFactor(input: SafetyInput) {
  if (input.rugScore === null && input.mintAuthority === null && input.freezeAuthority === null && input.top10Pct === null) return null
  let factor = 1
  if (input.rugScore !== null) factor -= clamp(input.rugScore / 100) * 0.5
  if (input.mintAuthority) factor -= 0.25
  if (input.freezeAuthority) factor -= 0.25
  if (input.top10Pct !== null && input.top10Pct > 30) factor -= clamp((input.top10Pct - 30) / 50) * 0.3
  return clamp(factor)
}

export function safetyLevel(input: SafetyInput): RadarSafetyLevel {
  const factor = safetyFactor(input)
  if (factor === null) return 'unknown'
  if (factor >= 0.75 && !input.mintAuthority && !input.freezeAuthority) return 'safe'
  if (factor >= 0.45) return 'caution'
  return 'risky'
}

function viewerVelocity(input: ScoreInput) {
  const viewers = input.viewers ?? 0
  const parts: number[] = []
  if (input.viewersDelta5m !== null) {
    const before = Math.max(1, viewers - Math.max(0, input.viewersDelta5m))
    parts.push(0.5 * clamp(input.viewersDelta5m / 60) + 0.5 * clamp(input.viewersDelta5m / before / 0.5))
  }
  if (input.viewersPerMin !== null && input.viewersPerMin !== undefined) {
    const before = Math.max(1, viewers - Math.max(0, input.viewersPerMin))
    parts.push(0.5 * clamp(input.viewersPerMin / 15) + 0.5 * clamp(input.viewersPerMin / before / 0.15))
  }
  return parts.length ? Math.max(...parts) : null
}

function combinedSafety(input: ScoreInput) {
  const rug = safetyFactor(input)
  const quality = input.quality === null || input.quality === undefined ? null : clamp(input.quality / 100)
  if (rug === null) return quality
  return quality === null ? rug : (rug + quality) / 2
}

export function featureVector(input: ScoreInput): Record<RadarFeatureKey, number | null> {
  const transactions = (input.buys5m ?? 0) + (input.sells5m ?? 0)
  return {
    viewerVelocity: viewerVelocity(input),
    activeViewers: input.viewers === null ? null : clamp(Math.log10(1 + input.viewers) / Math.log10(501)),
    runnerWallets: clamp(input.runnerWallets / 3),
    buyPressure: transactions ? clamp(((input.buys5m ?? 0) / transactions - 0.45) / 0.3) : null,
    safety: combinedSafety(input),
  }
}

export function scoreSetup(input: ScoreInput, weights: RadarWeights) {
  const features = featureVector(input)
  const available = radarFeatureKeys.filter(key => features[key] !== null)
  const totalWeight = available.reduce((total, key) => total + weights[key], 0)
  const factors: RadarFactor[] = radarFeatureKeys.map(key => {
    const value = features[key]
    const contribution = value === null || totalWeight <= 0 ? 0 : (value * weights[key] / totalWeight) * 100
    return { key, label: radarFeatureLabels[key], value: value ?? 0, weight: weights[key], contribution: Math.round(contribution * 10) / 10, available: value !== null }
  })
  const score = Math.round(factors.reduce((total, factor) => total + factor.contribution, 0))
  return { score: clamp(score, 0, 100), factors, features }
}

export function viewerDeltas(points: Array<{ timestamp: number; viewers: number | null }>, now: number) {
  const withViewers = points.filter(point => point.viewers !== null) as Array<{ timestamp: number; viewers: number }>
  const latest = withViewers.at(-1)
  if (!latest || now - latest.timestamp > 90_000) return { viewers: latest && now - latest.timestamp <= 180_000 ? latest.viewers : null, delta1m: null, delta5m: null, pct5m: null }
  const nearest = (target: number, tolerance: number) => {
    let best: { timestamp: number; viewers: number } | null = null
    for (const point of withViewers) {
      const distance = Math.abs(point.timestamp - target)
      if (distance <= tolerance && (!best || distance < Math.abs(best.timestamp - target))) best = point
    }
    return best
  }
  const oneMinute = nearest(latest.timestamp - 60_000, 30_000)
  const fiveMinutes = nearest(latest.timestamp - 300_000, 90_000)
  return {
    viewers: latest.viewers,
    delta1m: oneMinute ? latest.viewers - oneMinute.viewers : null,
    delta5m: fiveMinutes ? latest.viewers - fiveMinutes.viewers : null,
    pct5m: fiveMinutes && fiveMinutes.viewers > 0 ? Math.round(((latest.viewers - fiveMinutes.viewers) / fiveMinutes.viewers) * 1000) / 10 : null,
  }
}

export type TrainingSample = { features: Partial<Record<RadarFeatureKey, number | null>>; win: boolean }

export function recalibrateWeights(current: RadarWeights, samples: TrainingSample[]): RadarWeights {
  const wins = samples.filter(sample => sample.win)
  const losses = samples.filter(sample => !sample.win)
  if (!wins.length || !losses.length) return current
  const mean = (group: TrainingSample[], key: RadarFeatureKey) => {
    const values = group.map(sample => sample.features[key]).filter((value): value is number => typeof value === 'number')
    return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null
  }
  const next = { ...current }
  for (const key of radarFeatureKeys) {
    const winMean = mean(wins, key)
    const lossMean = mean(losses, key)
    if (winMean === null || lossMean === null) continue
    next[key] = clamp(current[key] * Math.exp(0.8 * (winMean - lossMean)), 0.2, 3)
  }
  const total = radarFeatureKeys.reduce((sum, key) => sum + next[key], 0)
  for (const key of radarFeatureKeys) next[key] = Math.round((next[key] / total) * radarFeatureKeys.length * 1000) / 1000
  return next
}
