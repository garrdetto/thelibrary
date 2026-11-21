import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PulseRow } from './pulse-feed.js'

/**
 * The Axiom Score: 0 to 100, built only from what Axiom's Pulse feed and the bridge extension report. Every measure is
 * turned into 0-100 by ranking it against every coin seen over the last few hours (lower-is-better measures are flipped),
 * then the measures are averaged with the weights in `axiom-score-weights.json`, which the strategy lab re-tunes.
 */

export type AxiomMeasure =
  | 'mcapChange30s' | 'mcapChange1m' | 'mcapChange5m' | 'calm'
  | 'viewers' | 'viewersChange1m' | 'holdersPerMin' | 'txPerMin' | 'buyShare1m' | 'buyVolumeShare' | 'volumeToMcap'
  | 'top10' | 'dev' | 'snipers' | 'insiders' | 'bundlers' | 'fresh' | 'proTraders' | 'kols' | 'devCreated' | 'devMigrated'
  | 'socials' | 'dexPaid'

export type AxiomScorePart = { measure: AxiomMeasure; value: number; scaled: number; weight: number }
export type AxiomScore = { score: number; parts: AxiomScorePart[]; reference: number }

type Sample = {
  t: number
  marketCap: number | null
  viewers: number | null
  holders: number | null
  txns: number | null
  buys: number | null
  sells: number | null
}

type Static = {
  t: number
  volume: number | null
  buyVolume: number | null
  marketCap: number | null
  top10: number | null
  dev: number | null
  snipers: number | null
  insiders: number | null
  bundlers: number | null
  fresh: number | null
  proTraders: number | null
  kols: number | null
  devCreated: number | null
  devMigrated: number | null
  socials: number
  dexPaid: number
}

const lowerIsBetter = new Set<AxiomMeasure>(['top10', 'dev', 'snipers', 'insiders', 'bundlers', 'fresh', 'devCreated'])
const historyMs = 6 * 60_000
const referenceMs = 3 * 60 * 60_000
const referenceCap = 4_000
const referenceEveryMs = 10_000

export const defaultWeights: Record<AxiomMeasure, number> = {
  mcapChange30s: 4, mcapChange1m: 6, mcapChange5m: 5, calm: 8,
  viewers: 6, viewersChange1m: 6, holdersPerMin: 7, txPerMin: 5, buyShare1m: 7, buyVolumeShare: 5, volumeToMcap: 4,
  top10: 4, dev: 3, snipers: 4, insiders: 4, bundlers: 5, fresh: 3, proTraders: 3, kols: 3, devCreated: 2, devMigrated: 2,
  socials: 2, dexPaid: 2,
}

function loadWeights(): Record<AxiomMeasure, number> {
  try {
    const path = fileURLToPath(new URL('./axiom-score-weights.json', import.meta.url))
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { weights?: Record<string, unknown> }
    const weights = { ...defaultWeights }
    for (const key of Object.keys(defaultWeights) as AxiomMeasure[]) {
      const value = parsed.weights?.[key]
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) weights[key] = value
    }
    return weights
  } catch {
    return { ...defaultWeights }
  }
}

export const axiomWeights = loadWeights()

const histories = new Map<string, Sample[]>()
const statics = new Map<string, Static>()
const reference = new Map<AxiomMeasure, Array<{ t: number; value: number }>>()
const sortedCache = new Map<AxiomMeasure, { at: number; values: number[] }>()
const lastReferenceAt = new Map<string, number>()

const num = (value: unknown) => {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(parsed) ? parsed : null
}

/** Remembers one Pulse row: its figures for the coin's own history, and (every 10 s per coin) its measures for the reference ranks. */
export function noteAxiomRow(mint: string, row: PulseRow, usdPerSol: number, now: number) {
  const toUsd = (value: unknown) => { const parsed = num(value); return parsed === null ? null : parsed * usdPerSol }
  const marketCap = toUsd(row.marketCap)
  const sample: Sample = { t: now, marketCap, viewers: num(row.userCount), holders: num(row.numHolders), txns: num(row.numTxns), buys: num(row.numBuys), sells: num(row.numSells) }
  const history = histories.get(mint) ?? []
  history.push(sample)
  while (history.length && now - history[0].t > historyMs) history.shift()
  histories.set(mint, history)
  statics.set(mint, {
    t: now,
    volume: toUsd(row.volume),
    buyVolume: toUsd(row.buyVolume),
    marketCap,
    top10: num(row.top10HoldersPercent),
    dev: row.devSold ? 0 : num(row.devHoldsPercent),
    snipers: num(row.snipersHoldPercent),
    insiders: num(row.insidersHoldPercent),
    bundlers: num(row.bundlersHoldPercent),
    fresh: num(row.freshWalletsHoldPercent),
    proTraders: num(row.proTradersHoldPercent),
    kols: num(row.kolCount),
    devCreated: num(row.devCreationCount),
    devMigrated: num(row.devMigrationCount),
    socials: [row.twitter, row.telegram, row.website].filter(link => typeof link === 'string' && link.trim()).length,
    dexPaid: row.dexPaid ? 1 : 0,
  })
  if (now - (lastReferenceAt.get(mint) ?? Number.NEGATIVE_INFINITY) >= referenceEveryMs) {
    lastReferenceAt.set(mint, now)
    for (const [measure, value] of Object.entries(axiomMeasures(mint, now)) as Array<[AxiomMeasure, number]>) {
      const list = reference.get(measure) ?? []
      list.push({ t: now, value: forRanking(measure, value) })
      while (list.length && (now - list[0].t > referenceMs || list.length > referenceCap)) list.shift()
      reference.set(measure, list)
    }
  }
}

/** Forgets coins not seen for a while, so memory stays flat. */
export function pruneAxiomScore(now: number) {
  for (const [mint, entry] of statics) {
    if (now - entry.t <= historyMs) continue
    statics.delete(mint)
    histories.delete(mint)
    lastReferenceAt.delete(mint)
  }
}

function at(history: Sample[], target: number, field: keyof Omit<Sample, 't'>) {
  let best: Sample | null = null
  for (const sample of history) {
    if (sample[field] === null || sample.t > target) continue
    if (!best || sample.t > best.t) best = sample
  }
  return best && target - best.t <= 20_000 ? best : null
}

const change = (now: number | null, then: number | null) => now !== null && then !== null && then > 0 ? (now / then - 1) * 100 : null

/** The coin's raw measures right now (percent changes, per-minute rates, shares, counts). Measures Axiom has not given are left out. */
export function axiomMeasures(mint: string, now: number): Partial<Record<AxiomMeasure, number>> {
  const history = histories.get(mint)
  const fixed = statics.get(mint)
  if (!history?.length || !fixed) return {}
  const last = history[history.length - 1]
  const out: Partial<Record<AxiomMeasure, number>> = {}
  const put = (measure: AxiomMeasure, value: number | null) => { if (value !== null && Number.isFinite(value)) out[measure] = value }
  const mcapThen = (seconds: number) => at(history, now - seconds * 1000, 'marketCap')?.marketCap ?? null
  const change30s = change(last.marketCap, mcapThen(30))
  put('mcapChange30s', change30s)
  put('mcapChange1m', change(last.marketCap, mcapThen(60)))
  put('mcapChange5m', change(last.marketCap, mcapThen(300)))
  if (change30s !== null) put('calm', change30s <= 10 ? 100 : Math.max(0, 100 - (change30s - 10) * 5))
  put('viewers', last.viewers)
  put('viewersChange1m', change(last.viewers, at(history, now - 60_000, 'viewers')?.viewers ?? null))
  const minuteAgo = at(history, now - 60_000, 'holders')
  if (minuteAgo && last.holders !== null && minuteAgo.holders !== null) put('holdersPerMin', (last.holders - minuteAgo.holders) * 60_000 / Math.max(1, now - minuteAgo.t))
  const txAgo = at(history, now - 60_000, 'txns')
  if (txAgo && last.txns !== null && txAgo.txns !== null) put('txPerMin', (last.txns - txAgo.txns) * 60_000 / Math.max(1, now - txAgo.t))
  const flowAgo = at(history, now - 60_000, 'buys')
  if (flowAgo && last.buys !== null && last.sells !== null && flowAgo.buys !== null && flowAgo.sells !== null) {
    const buys = last.buys - flowAgo.buys
    const sells = last.sells - flowAgo.sells
    if (buys + sells > 0) put('buyShare1m', buys / (buys + sells) * 100)
  }
  if (fixed.volume && fixed.buyVolume !== null) put('buyVolumeShare', fixed.buyVolume / fixed.volume * 100)
  if (fixed.volume !== null && fixed.marketCap) put('volumeToMcap', fixed.volume / fixed.marketCap)
  put('top10', fixed.top10)
  put('dev', fixed.dev)
  put('snipers', fixed.snipers)
  put('insiders', fixed.insiders)
  put('bundlers', fixed.bundlers)
  put('fresh', fixed.fresh)
  put('proTraders', fixed.proTraders)
  put('kols', fixed.kols)
  put('devCreated', fixed.devCreated)
  put('devMigrated', fixed.devMigrated)
  put('socials', fixed.socials)
  put('dexPaid', fixed.dexPaid)
  return out
}

const absolute = new Set<AxiomMeasure>(['calm', 'buyShare1m', 'buyVolumeShare'])
const holderShares = new Set<AxiomMeasure>(['top10', 'dev', 'snipers', 'insiders', 'bundlers', 'fresh', 'proTraders'])

/** Holder shares to the nearest 0.1%: Axiom reports many as tiny non-zero values (0.00004%), which ranked as worse than the pile of exact zeros. */
export const forRanking = (measure: AxiomMeasure, value: number) => holderShares.has(measure) ? Math.round(value * 10) / 10 : value
const clamp = (value: number) => Math.max(0, Math.min(100, value))

/**
 * A measure on the 0-100 scale. Shares that are already 0-100 (calm, buy share, buy volume share) are used as they are;
 * every other measure is its rank among recent coins (ties share the middle of their run), flipped when lower is better.
 * Until 50 coins have been seen, holder shares use 100 minus the share and the rest sit at 50.
 */
export function scaleMeasure(measure: AxiomMeasure, raw: number, now: number) {
  if (absolute.has(measure)) return clamp(raw)
  const value = forRanking(measure, raw)
  const list = reference.get(measure) ?? []
  let cached = sortedCache.get(measure)
  if (!cached || now - cached.at > 5_000) {
    cached = { at: now, values: list.map(entry => entry.value).sort((first, second) => first - second) }
    sortedCache.set(measure, cached)
  }
  const values = cached.values
  if (values.length < 50) return lowerIsBetter.has(measure) && measure !== 'devCreated' ? 100 - clamp(value) : 50
  let below = 0
  let equal = 0
  for (const item of values) { if (item < value) below += 1; else if (item === value) equal += 1 }
  const rank = (below + equal / 2) / values.length * 100
  return lowerIsBetter.has(measure) ? 100 - rank : rank
}

/** The Axiom Score for a coin, with every part shown, or null when Axiom has not reported it yet. */
export function axiomScore(mint: string, now = Date.now(), weights: Record<AxiomMeasure, number> = axiomWeights): AxiomScore | null {
  const measures = axiomMeasures(mint, now)
  const parts: AxiomScorePart[] = []
  let total = 0
  let weightSum = 0
  for (const [measure, value] of Object.entries(measures) as Array<[AxiomMeasure, number]>) {
    const weight = weights[measure] ?? 0
    if (!weight) continue
    const scaled = scaleMeasure(measure, value, now)
    parts.push({ measure, value: Math.round(value * 100) / 100, scaled: Math.round(scaled), weight })
    total += scaled * weight
    weightSum += weight
  }
  if (!weightSum) return null
  return { score: Math.round(total / weightSum), parts, reference: reference.get('viewers')?.length ?? 0 }
}

export function resetAxiomScoreForTests() {
  histories.clear()
  statics.clear()
  reference.clear()
  sortedCache.clear()
  lastReferenceAt.clear()
}
