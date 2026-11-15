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

const statLabels: Array<[StatKey, RegExp, RegExp]> = [
  ['top10', /^top\s*10\s*h/i, /top\s*10/i],
  ['fresh', /^fresh\s*wallets?$/i, /fresh|new\s+wallet/i],
  ['dev', /^dev\s*h/i, /\bdev\b/i],
  ['snipers', /^snipers?\s*h/i, /snip/i],
  ['insiders', /^insiders?$/i, /insid/i],
  ['bundlers', /^bundlers?$/i, /bundl/i],
]

export const pageStatsLiveMs = 2 * 60_000
export const pageStatsFreshMs = 8 * 60_000
export const pageStatsKeptMs = 30 * 60_000

/**
 * Reads the holder figures Axiom shows in the Token Info box on a coin's own page ("Top 10 H.", "Dev H.", "Snipers H.", "Insiders",
 * "Bundlers", "Fresh Wallets"). Axiom's own wording wins; a looser match is the fallback if Axiom renames a label, so a wallet
 * in the holders table that happens to share a word never takes the place of the real figure.
 */
export function parsePageStats(stats: Record<string, number>, seenAt: number): PageStats | null {
  const result: PageStats = { top10: null, dev: null, snipers: null, insiders: null, bundlers: null, fresh: null, labels: [], seenAt }
  const entries = Object.entries(stats).filter(([, value]) => Number.isFinite(value) && value >= 0 && value <= 100)
  const used = new Set<string>()
  for (const [key, exact, loose] of statLabels) {
    const match = entries.find(([label]) => !used.has(label) && exact.test(label)) ?? entries.find(([label]) => !used.has(label) && loose.test(label))
    if (!match) continue
    used.add(match[0])
    result[key] = match[1]
    result.labels.push(match[0])
  }
  return result.labels.length >= 2 ? result : null
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
