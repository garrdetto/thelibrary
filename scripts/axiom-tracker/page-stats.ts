export type PageStats = {
  top10: number | null
  dev: number | null
  snipers: number | null
  insiders: number | null
  bundlers: number | null
  fresh: number | null
  labels: string[]
  seenAt: number
}

type StatKey = 'top10' | 'dev' | 'snipers' | 'insiders' | 'bundlers' | 'fresh'

const statLabels: Array<[StatKey, RegExp]> = [
  ['top10', /top\s*10/i],
  ['fresh', /fresh|new\s+wallet/i],
  ['dev', /\bdev\b/i],
  ['snipers', /snip/i],
  ['insiders', /insid/i],
  ['bundlers', /bundl/i],
]

export const pageStatsLiveMs = 2 * 60_000
export const pageStatsFreshMs = 8 * 60_000
export const pageStatsKeptMs = 30 * 60_000

/**
 * Reads the holder figures Axiom shows on a coin's own page. The extension sends every percentage that sits above a short
 * label; the labels are matched loosely because Axiom abbreviates them ("Top 10 H.", "Dev H.", "Snipers H.").
 */
export function parsePageStats(stats: Record<string, number>, seenAt: number): PageStats | null {
  const result: PageStats = { top10: null, dev: null, snipers: null, insiders: null, bundlers: null, fresh: null, labels: [], seenAt }
  let matched = 0
  for (const [label, value] of Object.entries(stats)) {
    if (!Number.isFinite(value) || value < 0 || value > 100) continue
    const key = statLabels.find(([, pattern]) => pattern.test(label))?.[0]
    if (!key || result[key] !== null) continue
    result[key] = value
    result.labels.push(label)
    matched += 1
  }
  return matched >= 2 ? result : null
}

/**
 * How far to trust a page reading by its age: `live` (two minutes) stands on its own like a Pulse card, `recent` (eight minutes,
 * about one round of the background tab) is weighed against the other sources, and `kept` (half an hour) fills in figures nothing else reports.
 */
export function pageStatsAt(stats: PageStats | undefined, now: number) {
  if (!stats || now - stats.seenAt > pageStatsKeptMs) return { live: null, recent: null, kept: null }
  const age = now - stats.seenAt
  return { live: age <= pageStatsLiveMs ? stats : null, recent: age <= pageStatsFreshMs ? stats : null, kept: stats }
}
