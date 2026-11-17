import type { RadarRunnerSummary } from '../../src/lib/axiom-radar-types.js'

export const alertThresholds = { normal: 75, raised: 80 }

export type PatternStat = { tag: string; label: string; count: number; falsePositives: number; runners: number; points: number }

export const patternLabels: Record<string, string> = {
  'top10-under-15': 'Top 10 under 15%',
  'bundles-under-5': 'Bundles under 5%',
  'snipers-out': 'Snipers out, floor held',
  'dev-zero': 'Dev holds none',
  'wave-recovery': 'Recovered from a pullback',
  'holders-100': '100+ holders',
  'fees-paid': 'Fees over 0.75 SOL',
  'buy-pressure': 'Organic buys outpace sells',
  'sweet-spot-early': '$12K-$45K before graduating',
  'sweet-spot-graduated': '$60K-$250K after graduating',
  'dex-paid': 'DexPaid',
  'x-account': 'X account',
  'x-community': 'X community',
  'x-tweet': 'Linked tweet',
  telegram: 'Telegram',
  website: 'Website',
  'smart-money': 'Smart wallets in',
  staircase: 'Staircase chart',
  'deep-liquidity': 'Deep liquidity',
  'early-start': 'Early-start pattern',
  'moving-up': 'Moving up',
  'viewers-surging': 'Viewers surging',
  'holders-growing': 'Holders growing',
  'mcap-growing': 'Market cap growing',
}

/**
 * Tags that only say the coin is in motion right now. Nearly every alert carries them, so they say nothing about which
 * alerts fail: when alerts were being raised late they all picked up the full penalty and held running coins under the
 * alert line. They are counted but never earn or cost points.
 */
export const motionTags = new Set(['moving-up', 'mcap-growing', 'viewers-surging', 'holders-growing'])
/** Alerts raised with the price more than this far above its 3-minute low were late; the lessons come from the others. */
export const onTimeStretch = 35
/** A pattern only costs points when it fails this much more often than alerts do overall. */
export const penaltyMargin = 0.1

/** What the alert history has taught, shared by the score (read every second) and the learning loop (which writes it). */
export const runnerState: { threshold: number; patterns: Map<string, PatternStat>; summary: RadarRunnerSummary | null } = {
  threshold: alertThresholds.normal,
  patterns: new Map(),
  summary: null,
}

export function learnedFor(tags: string[]) {
  return tags.map(tag => runnerState.patterns.get(tag)).filter((stat): stat is PatternStat => Boolean(stat && stat.points !== 0)).map(stat => ({ tag: stat.tag, label: stat.label, points: stat.points }))
}

/** A short note when a coin matches a pattern that has paid off before. */
export function learnedEdge(tags: string[]) {
  const best = tags.map(tag => runnerState.patterns.get(tag)).filter((stat): stat is PatternStat => Boolean(stat && stat.points > 0)).sort((first, second) => second.runners / second.count - first.runners / first.count)[0]
  return best ? `Matches the ${best.label.toLowerCase()} pattern: ${Math.round((best.runners / best.count) * 100)}% of ${best.count} past alerts with it went 2x` : null
}
