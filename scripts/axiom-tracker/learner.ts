import type { RadarLearnerSummary, RadarOutlook, RadarOutlookPhase } from '../../src/lib/axiom-radar-learner.js'
import type { RadarToken } from '../../src/lib/axiom-radar-types.js'
import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { learnerState } from './learner-state.js'
import { chanceOf, holdoutAccuracy, median, nearestRows, splitInsights, topReasons, trainClassifier, vectorOf, type Classifier, type FeatureValues } from './logistic.js'
import { buildRadarTokens, loadModelState } from './radar-query.js'
import { createLogger, runLoop } from './runtime.js'
import { loadWinnersModel, runWinnersCycle } from './winners.js'

const logger = createLogger('learner')
const cycleMs = 15_000
const trainEveryMs = 5 * 60_000
const featureDelayMs = 60_000
const rugDrop = 0.25
const liquidityPull = 0.35
const runnerMultiple = 2
const closeAfterRugMs = 5 * 60_000
const closeAfterMissingMs = 20 * 60_000
const maxWatchMs = 4 * 60 * 60_000
const minimumSamples = 20
const earlyAgeMinutes = 30
const survivalMinutes = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240]

const learnerSchema = `
CREATE TABLE IF NOT EXISTS coin_lifecycles (
  mint TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  launched_at INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  first_price REAL NOT NULL,
  features_json TEXT,
  peak_price REAL NOT NULL,
  peak_at INTEGER NOT NULL,
  max_liquidity REAL,
  last_price REAL NOT NULL,
  last_at INTEGER NOT NULL,
  rugged_at INTEGER,
  rug_kind TEXT,
  outcome TEXT NOT NULL DEFAULT 'open',
  closed_at INTEGER,
  first_mcap REAL,
  peak_mcap REAL,
  peak_mcap_at INTEGER,
  last_mcap REAL
);
CREATE INDEX IF NOT EXISTS coin_lifecycles_outcome ON coin_lifecycles (outcome);
`

export const lifecycleSpecs = [
  { key: 'ageAtSight', label: 'Age when first seen (minutes)', log: true },
  { key: 'viewers', label: 'Viewers', log: true },
  { key: 'viewerGrowth', label: 'Viewer growth per minute', log: false },
  { key: 'holders', label: 'Holders', log: true },
  { key: 'holderGrowth', label: 'Holder growth in 5m', log: false },
  { key: 'buyRatio', label: 'Buy share of trades', log: false },
  { key: 'buys5m', label: 'Buys in 5m', log: true },
  { key: 'volume5m', label: '5m volume ($)', log: true },
  { key: 'liquidity', label: 'Liquidity ($)', log: true },
  { key: 'marketCap', label: 'Market cap ($)', log: true },
  { key: 'priceMove5m', label: '5m price move (%)', log: false },
  { key: 'top10', label: 'Top 10 holding (%)', log: false },
  { key: 'dev', label: 'Dev holding (%)', log: false },
  { key: 'snipers', label: 'Snipers (%)', log: false },
  { key: 'insiders', label: 'Insiders (%)', log: false },
  { key: 'bundlers', label: 'Bundlers (%)', log: false },
  { key: 'smartWallets', label: 'Smart wallets in', log: true },
  { key: 'quality', label: 'Holder quality score', log: false },
] as const

export type LifecycleRow = {
  mint: string
  symbol: string
  launched_at: number
  first_seen_at: number
  first_price: number
  features_json: string | null
  peak_price: number
  peak_at: number
  max_liquidity: number | null
  last_price: number
  last_at: number
  rugged_at: number | null
  rug_kind: string | null
  outcome: string
  closed_at: number | null
  first_mcap: number | null
  peak_mcap: number | null
  peak_mcap_at: number | null
  last_mcap: number | null
  traits_json: string | null
  holders_peak: number | null
}
type Sample = { values: FeatureValues; runner: boolean; rugged: boolean; lifeMinutes: number | null; peakMinutes: number; peakMultiple: number }
type Model = { classifier: Classifier; samples: Sample[]; holdout: ReturnType<typeof holdoutAccuracy> }
type HistoryRow = { mint: string; viewers: number | null; price_usd: number | null; market_cap: number | null; liquidity_usd: number | null; volume_5m: number | null; buys_5m: number | null; sells_5m: number | null; timestamp: number }

export function readFeatures(token: RadarToken): FeatureValues {
  return {
    ageAtSight: token.ageMinutes,
    viewers: token.viewers,
    viewerGrowth: token.viewersPerMin,
    holders: token.holderTraits?.holders ?? token.pulse?.holders ?? null,
    holderGrowth: token.holdersChange5m,
    buyRatio: token.buyRatio,
    buys5m: token.buys5m,
    volume5m: token.volume5m,
    liquidity: token.liquidityUsd,
    marketCap: token.marketCap,
    priceMove5m: token.priceChange.m5,
    top10: token.holderTraits?.top10 ?? token.pulse?.top10Pct ?? token.safety.top10Pct,
    dev: token.holderTraits?.dev ?? null,
    snipers: token.holderTraits?.snipers ?? null,
    insiders: token.holderTraits?.insiders ?? null,
    bundlers: token.holderTraits?.bundlers ?? null,
    smartWallets: token.runnerWallets,
    quality: token.quality.score,
  }
}

export const lifecycleStart = (row: Pick<LifecycleRow, 'launched_at' | 'first_seen_at'>) => row.launched_at > 0 ? Math.min(row.launched_at, row.first_seen_at) : row.first_seen_at

function loadModel(database: TrackerDatabase): Model {
  const rows = database.prepare("SELECT * FROM coin_lifecycles WHERE outcome != 'open' AND features_json IS NOT NULL ORDER BY closed_at ASC").all() as LifecycleRow[]
  const samples: Sample[] = rows.map(row => ({
    values: JSON.parse(row.features_json ?? '{}') as FeatureValues,
    runner: row.peak_price >= row.first_price * runnerMultiple,
    rugged: row.outcome === 'rug',
    lifeMinutes: row.rugged_at ? Math.max(0, (row.rugged_at - lifecycleStart(row)) / 60_000) : null,
    peakMinutes: Math.max(0, (row.peak_at - lifecycleStart(row)) / 60_000),
    peakMultiple: row.first_price > 0 ? row.peak_price / row.first_price : 1,
  }))
  const values = samples.map(sample => sample.values)
  const labels = samples.map(sample => sample.runner)
  return { classifier: trainClassifier(lifecycleSpecs, values, labels, minimumSamples), samples, holdout: holdoutAccuracy(lifecycleSpecs, values, labels, minimumSamples) }
}

function survivalCurve(database: TrackerDatabase, now: number) {
  const rows = database.prepare('SELECT launched_at, first_seen_at, rugged_at, outcome, closed_at, last_at FROM coin_lifecycles').all() as Array<Pick<LifecycleRow, 'launched_at' | 'first_seen_at' | 'rugged_at' | 'outcome' | 'closed_at' | 'last_at'>>
  if (rows.length < 5) return []
  const lives = rows.map(row => ({ minutes: Math.max(0, ((row.rugged_at ?? (row.outcome === 'open' ? now : row.closed_at ?? row.last_at)) - lifecycleStart(row)) / 60_000), event: row.rugged_at !== null })).sort((first, second) => first.minutes - second.minutes)
  const curve: Array<{ minutes: number; alivePct: number }> = []
  let alive = 1
  let index = 0
  for (const mark of survivalMinutes) {
    while (index < lives.length && lives[index].minutes <= mark) {
      if (lives[index].event) alive *= 1 - 1 / (lives.length - index)
      index += 1
    }
    curve.push({ minutes: mark, alivePct: Math.round(alive * 1000) / 10 })
  }
  return curve
}

function phaseFor(age: number, life: number | null): RadarOutlookPhase | null {
  if (life === null || life <= 0) return null
  const ratio = age / life
  return ratio < 0.5 ? 'early' : ratio < 0.85 ? 'running' : ratio < 1.15 ? 'late' : 'overdue'
}

function outlookFor(model: Model, token: RadarToken, fallbackLife: number | null): RadarOutlook {
  const vector = vectorOf(model.classifier, lifecycleSpecs, readFeatures(token))
  const crashed = nearestRows(model.classifier, vector, row => model.samples[row].lifeMinutes !== null)
  const similar = nearestRows(model.classifier, vector, () => true)
  const life = crashed.length >= 5 ? median(crashed.map(row => model.samples[row].lifeMinutes as number)) : fallbackLife
  const peak = similar.length >= 5 ? median(similar.map(row => model.samples[row].peakMultiple)) : null
  return {
    runnerChance: model.classifier.ready ? chanceOf(model.classifier, vector) : null,
    expectedLifeMinutes: life === null ? null : Math.round(life),
    minutesLeft: life === null ? null : Math.round(life - token.ageMinutes),
    expectedPeakMultiple: peak === null ? null : Math.round(peak * 10) / 10,
    phase: phaseFor(token.ageMinutes, life),
    similar: crashed.length,
    reasons: topReasons(model.classifier, lifecycleSpecs, vector),
  }
}

function crashKind(price: number, peak: number, liquidity: number | null, maxLiquidity: number | null) {
  if (maxLiquidity !== null && maxLiquidity > 2_000 && liquidity !== null && liquidity <= maxLiquidity * liquidityPull && price <= peak * 0.7) return 'liquidity pulled'
  return price <= peak * rugDrop ? 'dumped' : null
}

function backfill(database: TrackerDatabase) {
  const existing = (database.prepare('SELECT COUNT(*) AS count FROM coin_lifecycles').get() as { count: number }).count
  if (existing) return 0
  const tokens = new Map((database.prepare('SELECT mint, symbol, pair_created_at FROM tokens').all() as Array<{ mint: string; symbol: string; pair_created_at: number }>).map(token => [token.mint, token]))
  const insert = database.prepare(`INSERT OR IGNORE INTO coin_lifecycles (mint, symbol, launched_at, first_seen_at, first_price, features_json, peak_price, peak_at, max_liquidity, last_price, last_at, rugged_at, rug_kind, first_mcap, peak_mcap, peak_mcap_at, last_mcap)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const history = database.prepare('SELECT mint, viewers, price_usd, market_cap, liquidity_usd, volume_5m, buys_5m, sells_5m, timestamp FROM snapshots WHERE mint = ? AND price_usd > 0 ORDER BY timestamp ASC')
  let group: HistoryRow[] = []
  let added = 0
  const flush = () => {
    const token = group.length >= 6 ? tokens.get(group[0].mint) : undefined
    if (!token) return
    const first = group[0]
    let peak = first.price_usd as number
    let peakAt = first.timestamp
    let maxLiquidity: number | null = null
    let ruggedAt: number | null = null
    let rugKind: string | null = null
    let features: FeatureValues | null = null
    let previousPrice = first.price_usd as number
    let previousMcap: number | null = null
    let firstMcap: number | null = null
    let peakMcap: number | null = null
    let peakMcapAt: number | null = null
    for (const row of group) {
      const price = row.price_usd as number
      const held = Math.min(price, previousPrice)
      previousPrice = price
      if (ruggedAt !== null && row.timestamp - ruggedAt >= closeAfterRugMs) {
        if (row.market_cap !== null && row.market_cap > 0) {
          const laterMcap = Math.min(row.market_cap, previousMcap ?? row.market_cap)
          previousMcap = row.market_cap
          if (laterMcap > (peakMcap ?? 0)) { peakMcap = laterMcap; peakMcapAt = row.timestamp }
        }
        continue
      }
      if (held > peak) { peak = held; peakAt = row.timestamp; ruggedAt = null; rugKind = null }
      if (row.market_cap !== null && row.market_cap > 0) {
        firstMcap ??= row.market_cap
        const heldMcap = Math.min(row.market_cap, previousMcap ?? row.market_cap)
        previousMcap = row.market_cap
        if (heldMcap > (peakMcap ?? 0)) { peakMcap = heldMcap; peakMcapAt = row.timestamp }
      }
      maxLiquidity = Math.max(maxLiquidity ?? 0, row.liquidity_usd ?? 0) || null
      if (!features && row.timestamp - first.timestamp >= featureDelayMs) {
        const trades = (row.buys_5m ?? 0) + (row.sells_5m ?? 0)
        features = { ageAtSight: token.pair_created_at > 0 ? Math.max(0, (first.timestamp - token.pair_created_at) / 60_000) : null, viewers: row.viewers, buyRatio: trades ? (row.buys_5m ?? 0) / trades : null, buys5m: row.buys_5m, volume5m: row.volume_5m, liquidity: row.liquidity_usd, marketCap: row.market_cap, priceMove5m: ((price / (first.price_usd as number)) - 1) * 100 }
      }
      if (ruggedAt === null) {
        const kind = crashKind(price, peak, row.liquidity_usd, maxLiquidity)
        if (kind) { ruggedAt = row.timestamp; rugKind = kind }
      }
    }
    const last = group[group.length - 1]
    insert.run(token.mint, token.symbol, token.pair_created_at || first.timestamp, first.timestamp, first.price_usd, features ? JSON.stringify(features) : null, peak, peakAt, maxLiquidity, last.price_usd, last.timestamp, ruggedAt, rugKind, firstMcap, peakMcap, peakMcapAt, previousMcap)
    added += 1
  }
  database.transaction(() => {
    for (const mint of tokens.keys()) {
      group = history.all(mint) as HistoryRow[]
      flush()
    }
  })()
  return added
}

function trackLifecycles(database: TrackerDatabase, tokens: RadarToken[], now: number) {
  const find = database.prepare('SELECT * FROM coin_lifecycles WHERE mint = ?')
  const insert = database.prepare(`INSERT INTO coin_lifecycles (mint, symbol, launched_at, first_seen_at, first_price, peak_price, peak_at, max_liquidity, last_price, last_at, first_mcap, peak_mcap, peak_mcap_at, last_mcap)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (mint) DO NOTHING`)
  const update = database.prepare(`UPDATE coin_lifecycles SET peak_price = ?, peak_at = ?, max_liquidity = ?, last_price = ?, last_at = ?,
    features_json = COALESCE(features_json, ?), rugged_at = ?, rug_kind = ?,
    first_mcap = COALESCE(first_mcap, ?), peak_mcap = ?, peak_mcap_at = ?, last_mcap = ? WHERE mint = ?`)
  const close = database.prepare('UPDATE coin_lifecycles SET outcome = ?, closed_at = ?, rugged_at = COALESCE(rugged_at, ?), rug_kind = COALESCE(rug_kind, ?) WHERE mint = ?')
  const grow = database.prepare('UPDATE coin_lifecycles SET peak_mcap_at = CASE WHEN ? > COALESCE(peak_mcap, 0) THEN ? ELSE peak_mcap_at END, peak_mcap = MAX(COALESCE(peak_mcap, 0), ?), last_mcap = ? WHERE mint = ?')
  const traits = database.prepare('UPDATE coin_lifecycles SET traits_json = ?, holders_peak = ? WHERE mint = ?')
  let closed = 0
  database.transaction(() => {
    for (const token of tokens) {
      const price = token.priceUsd
      if (!price || price <= 0) continue
      const row = find.get(token.mint) as LifecycleRow | undefined
      if (row && token.holderTraits) {
        const seen = token.holderTraits
        const known = row.traits_json ? JSON.parse(row.traits_json) as Record<string, number | null> : {}
        const worst = (key: string, value: number | null) => value === null ? known[key] ?? null : Math.max(known[key] ?? 0, value)
        const next = { top10: worst('top10', seen.top10), dev: worst('dev', seen.dev), snipers: worst('snipers', seen.snipers), insiders: worst('insiders', seen.insiders), bundlers: worst('bundlers', seen.bundlers), linked: worst('linked', seen.linked) }
        const holdersPeak = Math.max(row.holders_peak ?? 0, seen.holders ?? 0) || null
        const encoded = JSON.stringify(next)
        if (encoded !== row.traits_json || holdersPeak !== row.holders_peak) traits.run(encoded, holdersPeak, token.mint)
      }
      if (!row) {
        insert.run(token.mint, token.symbol, token.pairCreatedAt || now, now, price, price, now, token.liquidityUsd, price, now, token.marketCap, token.marketCap, now, token.marketCap)
        continue
      }
      if (row.outcome !== 'open') {
        const laterMcap = token.marketCap === null ? null : Math.min(token.marketCap, row.last_mcap ?? token.marketCap)
        if (laterMcap !== null) grow.run(laterMcap, now, laterMcap, token.marketCap, token.mint)
        continue
      }
      const held = Math.min(price, row.last_price)
      const peak = Math.max(row.peak_price, held)
      const heldMcap = token.marketCap === null ? null : Math.min(token.marketCap, row.last_mcap ?? token.marketCap)
      const peakMcap = Math.max(row.peak_mcap ?? 0, heldMcap ?? 0) || null
      const maxLiquidity = Math.max(row.max_liquidity ?? 0, token.liquidityUsd ?? 0) || null
      const capture = row.features_json === null && now - row.first_seen_at >= featureDelayMs ? JSON.stringify(readFeatures(token)) : null
      const recovered = row.rugged_at !== null && held > row.peak_price
      const kind = row.rugged_at === null ? crashKind(price, peak, token.liquidityUsd, maxLiquidity) : null
      if (kind) logger.info('Coin crashed', { mint: token.mint, symbol: token.symbol, kind, minutesAlive: Math.round((now - lifecycleStart(row)) / 60_000) })
      update.run(peak, held > row.peak_price ? now : row.peak_at, maxLiquidity, price, now, capture, recovered ? null : row.rugged_at ?? (kind ? now : null), recovered ? null : row.rug_kind ?? kind, token.marketCap, peakMcap, peakMcap !== null && peakMcap > (row.peak_mcap ?? 0) ? now : row.peak_mcap_at, token.marketCap ?? row.last_mcap, token.mint)
    }
    const live = new Set(tokens.map(token => token.mint))
    for (const [mint, reading] of learnerState.followed) {
      if (live.has(mint) || now - reading.at > 60_000) continue
      const row = find.get(mint) as LifecycleRow | undefined
      if (!row || row.outcome !== 'open' || reading.at <= row.last_at) continue
      const held = Math.min(reading.price, row.last_price)
      const peak = Math.max(row.peak_price, held)
      const heldMcap = reading.marketCap === null ? null : Math.min(reading.marketCap, row.last_mcap ?? reading.marketCap)
      const peakMcap = Math.max(row.peak_mcap ?? 0, heldMcap ?? 0) || null
      const maxLiquidity = Math.max(row.max_liquidity ?? 0, reading.liquidity ?? 0) || null
      const recovered = row.rugged_at !== null && held > row.peak_price
      const kind = row.rugged_at === null ? crashKind(reading.price, peak, reading.liquidity, maxLiquidity) : null
      if (kind) logger.info('Coin crashed after leaving the radar', { mint, symbol: row.symbol, kind, minutesAlive: Math.round((now - lifecycleStart(row)) / 60_000) })
      update.run(peak, held > row.peak_price ? reading.at : row.peak_at, maxLiquidity, reading.price, reading.at, null, recovered ? null : row.rugged_at ?? (kind ? reading.at : null), recovered ? null : row.rug_kind ?? kind, reading.marketCap, peakMcap, peakMcap !== null && peakMcap > (row.peak_mcap ?? 0) ? reading.at : row.peak_mcap_at, reading.marketCap ?? row.last_mcap, mint)
    }
    for (const row of database.prepare("SELECT * FROM coin_lifecycles WHERE outcome = 'open'").all() as LifecycleRow[]) {
      if (row.rugged_at !== null && now - row.rugged_at >= closeAfterRugMs) { close.run('rug', now, null, null, row.mint); closed += 1 }
      else if (now - row.last_at >= closeAfterMissingMs) {
        const crashed = row.rugged_at !== null || row.last_price <= row.peak_price * 0.4
        close.run(crashed ? 'rug' : 'faded', now, crashed ? row.last_at : null, crashed ? 'dropped off the radar' : null, row.mint)
        closed += 1
      } else if (now - row.first_seen_at >= maxWatchMs) { close.run('survived', now, null, null, row.mint); closed += 1 }
    }
  })()
  return closed
}

export function runLearnerCycle(database: TrackerDatabase, model: Model, now = Date.now()) {
  const tokens = buildRadarTokens(database, loadModelState(database).weights, now)
  const closed = trackLifecycles(database, tokens, now)
  const lives = model.samples.map(sample => sample.lifeMinutes).filter((value): value is number => value !== null)
  const fallbackLife = median(lives)
  learnerState.predictions = new Map(tokens.map(token => [token.mint, outlookFor(model, token, fallbackLife)]))
  const runners = model.samples.filter(sample => sample.runner)
  const watching = (database.prepare("SELECT COUNT(*) AS count FROM coin_lifecycles WHERE outcome = 'open'").get() as { count: number }).count
  const summary: RadarLearnerSummary = {
    ready: model.classifier.ready,
    samples: model.samples.length,
    needed: minimumSamples,
    runners: runners.length,
    rugs: model.samples.filter(sample => sample.rugged).length,
    watching,
    runnerRate: model.samples.length ? runners.length / model.samples.length : null,
    holdoutAccuracy: model.holdout?.accuracy ?? null,
    flaggedHitRate: model.holdout?.flaggedHitRate ?? null,
    medianLifeMinutes: fallbackLife === null ? null : Math.round(fallbackLife),
    medianTimeToPeakMinutes: runners.length ? Math.round(median(runners.map(sample => sample.peakMinutes)) ?? 0) : null,
    survival: survivalCurve(database, now),
    insights: splitInsights(lifecycleSpecs, model.samples.map(sample => sample.values), model.samples.map(sample => sample.runner), 'became runners'),
    earlyPicks: tokens
      .filter(token => token.ageMinutes <= earlyAgeMinutes && token.alerts.length === 0 && !token.holderRisk?.blocked && token.priceUsd !== null)
      .map(token => ({ mint: token.mint, rank: learnerState.predictions.get(token.mint)?.runnerChance ?? token.score / 100 }))
      .sort((first, second) => second.rank - first.rank)
      .slice(0, 6)
      .map(entry => entry.mint),
    updatedAt: now,
  }
  learnerState.summary = summary
  return { closed, summary, tokens }
}

export function prepareLearner(database: TrackerDatabase) {
  database.exec(learnerSchema)
  const columns = new Set((database.prepare('PRAGMA table_info(coin_lifecycles)').all() as Array<{ name: string }>).map(column => column.name))
  if (!columns.has('traits_json')) database.exec('ALTER TABLE coin_lifecycles ADD COLUMN traits_json TEXT')
  if (!columns.has('holders_peak')) database.exec('ALTER TABLE coin_lifecycles ADD COLUMN holders_peak INTEGER')
  const added = backfill(database)
  if (added) logger.info('Learned from stored history', { coins: added })
  return loadModel(database)
}

export function startLearner(database: TrackerDatabase, signal: AbortSignal) {
  let model = prepareLearner(database)
  let winners = loadWinnersModel(database)
  let trainedAt = Date.now()
  return runLoop('learner', cycleMs, async () => {
    const now = Date.now()
    const { closed, summary, tokens } = runLearnerCycle(database, model, now)
    runWinnersCycle(database, winners, tokens, now)
    if (closed > 0 || now - trainedAt >= trainEveryMs) {
      model = loadModel(database)
      winners = loadWinnersModel(database)
      trainedAt = now
      if (closed) logger.info('Learner retrained', { samples: model.samples.length, ready: model.classifier.ready, closed })
    }
    recordHeartbeat(database, 'learner', 'ok', `${summary.samples} coins learned, ${summary.watching} being watched${summary.ready ? '' : `, needs ${minimumSamples}`}`)
  }, logger, signal)
}
