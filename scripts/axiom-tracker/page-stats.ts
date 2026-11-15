export type PageStats = {
  top10: number | null
  dev: number | null
  snipers: number | null
  insiders: number | null
  bundlers: number | null
  fresh: number | null
  proTraders: number | null
  labels: string[]
  seenAt: number
}

type StatKey = 'top10' | 'dev' | 'snipers' | 'insiders' | 'bundlers' | 'fresh' | 'proTraders'

const statLabels: Array<[StatKey, RegExp, RegExp]> = [
  ['top10', /^top\s*10\s*h/i, /top\s*10/i],
  ['fresh', /^fresh\s*wallets?$/i, /fresh|new\s+wallet/i],
  ['dev', /^dev\s*h/i, /\bdev\b/i],
  ['snipers', /^snipers?\s*h/i, /snip/i],
  ['insiders', /^insiders?$/i, /insid/i],
  ['bundlers', /^bundlers?$/i, /bundl/i],
  ['proTraders', /^pro\s*traders?\s*hold/i, /pro\s*trader/i],
]

export const pageStatsLiveMs = 2 * 60_000
export const pageStatsFreshMs = 8 * 60_000
export const pageStatsKeptMs = 30 * 60_000
export const pageRevisitMs = 4 * 60_000
export const pageRevisitOnPulseMs = 20 * 60_000

/**
 * Whether the bridge's background tab should open this coin's Axiom page for its holder figures. A coin that is not on Pulse
 * has nothing else from Axiom, so it is read every four minutes; a coin on Pulse already sends its card every second and
 * only needs the page for the fresh-wallet figure, every twenty.
 */
export function needsPageRead(stats: PageStats | undefined, onPulse: boolean, now: number) {
  return now - (stats?.seenAt ?? 0) > (onPulse ? pageRevisitOnPulseMs : pageRevisitMs)
}

/**
 * Reads the holder figures Axiom shows in the Token Info box on a coin's own page ("Top 10 H.", "Dev H.", "Snipers H.", "Insiders",
 * "Bundlers", "Fresh Wallets", "Pro Traders Holding"). Axiom's own wording wins; a looser match is the fallback if Axiom renames a label, so a wallet
 * in the holders table that happens to share a word never takes the place of the real figure.
 */
export function parsePageStats(stats: Record<string, number>, seenAt: number): PageStats | null {
  const result: PageStats = { top10: null, dev: null, snipers: null, insiders: null, bundlers: null, fresh: null, proTraders: null, labels: [], seenAt }
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
