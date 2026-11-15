import type { RadarRunnerAlert, RadarToken } from '../../src/lib/axiom-radar-types.js'
import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { learnerState, withLearning } from './learner-state.js'
import { buildRadarTokens, loadModelState } from './radar-query.js'
import { alertThresholds, learnedEdge, patternLabels, runnerState, type PatternStat } from './runner-state.js'
import { createLogger, errorMessage, sleep } from './runtime.js'

const logger = createLogger('runner-alerts')

export const learningRules = {
  dumpDrop: 0.3,
  falsePositiveWindowMs: 10 * 60_000,
  runnerMultiple: 2,
  winGain: 0.5,
  closeAfterMs: 4 * 60 * 60_000,
  goneAfterMs: 30 * 60_000,
  rolling: 20,
  minimumRolling: 10,
  lowWinRate: 0.4,
  realertMs: 60 * 60_000,
  patternMinimum: 5,
}

const runnerSchema = `
CREATE TABLE IF NOT EXISTS runner_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  pair_address TEXT,
  alerted_at INTEGER NOT NULL,
  price REAL NOT NULL,
  score INTEGER NOT NULL,
  threshold INTEGER NOT NULL,
  tags_json TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  thesis_json TEXT NOT NULL,
  edge TEXT,
  peak_15m REAL,
  peak_1h REAL,
  peak_4h REAL,
  low_10m REAL,
  dumped_at INTEGER,
  hit_win_at INTEGER,
  hit_loss_at INTEGER,
  outcome TEXT NOT NULL DEFAULT 'open',
  last_price REAL,
  last_at INTEGER,
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS runner_alerts_mint ON runner_alerts (mint, alerted_at);
CREATE INDEX IF NOT EXISTS runner_alerts_time ON runner_alerts (alerted_at);
`

export type AlertRow = {
  id: number
  mint: string
  symbol: string
  name: string | null
  pair_address: string | null
  alerted_at: number
  price: number
  score: number
  threshold: number
  tags_json: string
  stats_json: string
  thesis_json: string
  edge: string | null
  peak_15m: number | null
  peak_1h: number | null
  peak_4h: number | null
  low_10m: number | null
  dumped_at: number | null
  hit_win_at: number | null
  hit_loss_at: number | null
  outcome: 'open' | 'false-positive' | 'runner' | 'neither'
  last_price: number | null
  last_at: number | null
  closed_at: number | null
}

const peak = (current: number | null, multiple: number) => Math.round(Math.max(current ?? 0, multiple) * 1000) / 1000

/**
 * Moves one alert forward with a new price: its best multiple within 15 minutes, 1 hour and 4 hours, its worst within
 * 10 minutes, when it dumped (30% under the alert price), and its outcome. A dump within 10 minutes is a false positive;
 * reaching 2x within 4 hours is a runner. It closes after 4 hours, or 30 minutes after its price stops arriving.
 */
export function advanceAlert(row: AlertRow, price: number | null, now: number): AlertRow {
  const next = { ...row }
  const age = now - row.alerted_at
  if (price !== null && price > 0 && row.price > 0) {
    const multiple = price / row.price
    if (age <= 15 * 60_000) next.peak_15m = peak(row.peak_15m, multiple)
    if (age <= 60 * 60_000) next.peak_1h = peak(row.peak_1h, multiple)
    if (age <= learningRules.closeAfterMs) next.peak_4h = peak(row.peak_4h, multiple)
    if (age <= learningRules.falsePositiveWindowMs) next.low_10m = Math.round(Math.min(row.low_10m ?? Infinity, multiple) * 1000) / 1000
    if (multiple <= 1 - learningRules.dumpDrop && next.dumped_at === null) next.dumped_at = now
    if (multiple >= 1 + learningRules.winGain && next.hit_win_at === null) next.hit_win_at = now
    if (multiple <= 1 - learningRules.dumpDrop && next.hit_loss_at === null) next.hit_loss_at = now
    next.last_price = price
    next.last_at = now
    if (next.outcome === 'open' || next.outcome === 'false-positive') {
      if ((next.peak_4h ?? 0) >= learningRules.runnerMultiple) next.outcome = 'runner'
      else if (next.outcome === 'open' && next.dumped_at !== null && next.dumped_at - row.alerted_at <= learningRules.falsePositiveWindowMs) next.outcome = 'false-positive'
    }
  }
  const gone = (next.last_at ?? row.alerted_at) < now - learningRules.goneAfterMs
  if (next.closed_at === null && (age >= learningRules.closeAfterMs || gone)) {
    next.closed_at = now
    if (next.outcome === 'open') next.outcome = 'neither'
  }
  return next
}

/** Win or loss for the rolling rate: +50% before -30% wins; -30% first, or closing without either, loses. */
export function alertResult(row: Pick<AlertRow, 'hit_win_at' | 'hit_loss_at' | 'closed_at'>): 'win' | 'loss' | null {
  if (row.hit_win_at !== null && (row.hit_loss_at === null || row.hit_win_at <= row.hit_loss_at)) return 'win'
  if (row.hit_loss_at !== null) return 'loss'
  return row.closed_at !== null ? 'loss' : null
}

/** The alert threshold: 75, raised to 80 while the last 20 decided alerts win under 40% of the time (needs 10 to judge). */
export function thresholdFor(rows: Array<Pick<AlertRow, 'hit_win_at' | 'hit_loss_at' | 'closed_at' | 'alerted_at'>>) {
  const decided = rows.slice().sort((first, second) => second.alerted_at - first.alerted_at).map(alertResult).filter((result): result is 'win' | 'loss' => result !== null).slice(0, learningRules.rolling)
  const winRate = decided.length ? decided.filter(result => result === 'win').length / decided.length : null
  const raised = decided.length >= learningRules.minimumRolling && winRate !== null && winRate < learningRules.lowWinRate
  return { threshold: raised ? alertThresholds.raised : alertThresholds.normal, winRate, decided: decided.length }
}

/**
 * Per-pattern lessons from decided alerts: a pattern behind at least 3 false positives that make up half its alerts costs
 * 10 points; one behind 3 runners in half its alerts earns 10, or 5 for 2 runners in 30%. A pattern needs 5 alerts first.
 */
export function patternStats(rows: Array<Pick<AlertRow, 'tags_json' | 'outcome'>>): Map<string, PatternStat> {
  const stats = new Map<string, PatternStat>()
  for (const row of rows) {
    if (row.outcome === 'open') continue
    let tags: string[] = []
    try { tags = JSON.parse(row.tags_json) as string[] } catch { tags = [] }
    for (const tag of new Set(tags)) {
      const stat = stats.get(tag) ?? { tag, label: patternLabels[tag] ?? tag, count: 0, falsePositives: 0, runners: 0, points: 0 }
      stat.count += 1
      if (row.outcome === 'false-positive') stat.falsePositives += 1
      if (row.outcome === 'runner') stat.runners += 1
      stats.set(tag, stat)
    }
  }
  for (const stat of stats.values()) {
    if (stat.count < learningRules.patternMinimum) continue
    const fpRate = stat.falsePositives / stat.count
    const runRate = stat.runners / stat.count
    if (stat.falsePositives >= 3 && fpRate >= 0.5) stat.points = -10
    else if (stat.runners >= 3 && runRate >= 0.5) stat.points = 10
    else if (stat.runners >= 2 && runRate >= 0.3) stat.points = 5
  }
  return stats
}

function toAlert(row: AlertRow): RadarRunnerAlert {
  const parse = <T>(json: string, fallback: T) => { try { return JSON.parse(json) as T } catch { return fallback } }
  return {
    id: row.id,
    mint: row.mint,
    symbol: row.symbol,
    name: row.name,
    pairAddress: row.pair_address,
    alertedAt: row.alerted_at,
    price: row.price,
    score: row.score,
    threshold: row.threshold,
    stats: parse(row.stats_json, { marketCap: null, liquidity: null, holders: null, top10: null, bundlers: null, dev: null }),
    thesis: parse(row.thesis_json, [] as string[]),
    edge: row.edge,
    peak15m: row.peak_15m,
    peak1h: row.peak_1h,
    peak4h: row.peak_4h,
    low10m: row.low_10m,
    dumpedAfterMinutes: row.dumped_at === null ? null : Math.max(0, Math.round((row.dumped_at - row.alerted_at) / 60_000)),
    outcome: row.outcome,
    result: alertResult(row),
  }
}

function statsOf(token: RadarToken) {
  return { marketCap: token.marketCap, liquidity: token.liquidityUsd, holders: token.holderTraits?.holders ?? null, top10: token.holderTraits?.top10 ?? null, bundlers: token.holderTraits?.bundlers ?? null, dev: token.holderTraits?.dev ?? null }
}

/**
 * Every second: alerts coins whose runner score reaches the current threshold (once an hour per coin), follows every open
 * alert's price for 4 hours, and re-learns the pattern weights and the threshold whenever an outcome changes.
 */
export function startRunnerAlerts(database: TrackerDatabase, signal: AbortSignal) {
  database.exec(runnerSchema)
  const insert = database.prepare(`INSERT INTO runner_alerts (mint, symbol, name, pair_address, alerted_at, price, score, threshold, tags_json, stats_json, thesis_json, edge, peak_15m, peak_1h, peak_4h, low_10m, last_price, last_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, ?, ?)`)
  const update = database.prepare(`UPDATE runner_alerts SET peak_15m = ?, peak_1h = ?, peak_4h = ?, low_10m = ?, dumped_at = ?, hit_win_at = ?, hit_loss_at = ?, outcome = ?, last_price = ?, last_at = ?, closed_at = ? WHERE id = ?`)
  const lastAlert = database.prepare('SELECT MAX(alerted_at) AS at FROM runner_alerts WHERE mint = ?')
  let lastLearnAt = 0
  let lastHeartbeat = 0
  let dirty = true

  const learn = (now: number) => {
    const recent = database.prepare('SELECT * FROM runner_alerts WHERE alerted_at >= ? ORDER BY alerted_at DESC').all(now - 14 * 24 * 60 * 60_000) as AlertRow[]
    runnerState.patterns = patternStats(recent)
    const rolling = thresholdFor(recent)
    if (rolling.threshold !== runnerState.threshold) logger.info(rolling.threshold > alertThresholds.normal ? 'Alert win rate fell under 40%; raising the alert threshold' : 'Alert win rate recovered; alert threshold back to normal', { threshold: rolling.threshold, winRate: rolling.winRate })
    runnerState.threshold = rolling.threshold
    runnerState.summary = {
      threshold: rolling.threshold,
      normalThreshold: alertThresholds.normal,
      rollingWinRate: rolling.winRate,
      rollingDecided: rolling.decided,
      alerts: recent.slice(0, 40).map(toAlert),
      patterns: [...runnerState.patterns.values()].sort((first, second) => Math.abs(second.points) - Math.abs(first.points) || second.count - first.count).slice(0, 24),
      updatedAt: now,
    }
    lastLearnAt = now
    dirty = false
  }

  const cycle = (now: number) => {
    const tokens = buildRadarTokens(database, loadModelState(database).weights, now).map(withLearning)
    const prices = new Map<string, number | null>(tokens.map(token => [token.mint, token.priceUsd]))
    for (const [mint, reading] of learnerState.followed) if (!prices.has(mint) && now - reading.at < 60_000) prices.set(mint, reading.price)
    const open = database.prepare('SELECT * FROM runner_alerts WHERE closed_at IS NULL').all() as AlertRow[]
    database.transaction(() => {
      for (const row of open) {
        const next = advanceAlert(row, prices.get(row.mint) ?? null, now)
        if (next.outcome !== row.outcome || next.closed_at !== row.closed_at || next.hit_win_at !== row.hit_win_at || next.hit_loss_at !== row.hit_loss_at) dirty = true
        update.run(next.peak_15m, next.peak_1h, next.peak_4h, next.low_10m, next.dumped_at, next.hit_win_at, next.hit_loss_at, next.outcome, next.last_price, next.last_at, next.closed_at, row.id)
      }
      for (const token of tokens) {
        if (token.score < runnerState.threshold || !token.priceUsd || token.holderRisk?.blocked) continue
        const previous = (lastAlert.get(token.mint) as { at: number | null }).at
        if (previous !== null && now - previous < learningRules.realertMs) continue
        const tags = token.runnerTags ?? []
        insert.run(token.mint, token.symbol, token.name, token.pairAddress, now, token.priceUsd, token.score, runnerState.threshold, JSON.stringify(tags), JSON.stringify(statsOf(token)), JSON.stringify(token.runnerThesis ?? []), learnedEdge(tags), token.priceUsd, now)
        logger.info('Runner alert', { mint: token.mint, symbol: token.symbol, score: token.score, threshold: runnerState.threshold })
        dirty = true
      }
    })()
    if (dirty || now - lastLearnAt >= 60_000) learn(now)
    if (now - lastHeartbeat >= 15_000) {
      const summary = runnerState.summary
      recordHeartbeat(database, 'runner-alerts', 'ok', `threshold ${runnerState.threshold}, ${open.length} alerts being followed${summary?.rollingWinRate !== null && summary?.rollingWinRate !== undefined ? `, ${Math.round(summary.rollingWinRate * 100)}% of the last ${summary.rollingDecided} won` : ''}`)
      lastHeartbeat = now
    }
  }

  logger.info('Scoring runners and following alerts every second')
  return (async () => {
    while (!signal.aborted) {
      const started = Date.now()
      try {
        cycle(started)
      } catch (error) {
        logger.warn('Runner alert cycle failed', { error: errorMessage(error) })
      }
      await sleep(Math.max(200, 1_000 - (Date.now() - started)), signal)
    }
  })()
}
