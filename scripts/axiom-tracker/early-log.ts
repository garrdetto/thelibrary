import type { RadarEarlyRecord, RadarEarlySummary, RadarToken } from '../../src/lib/axiom-radar-types.js'
import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { earlyState } from './early-state.js'
import { buildRadarTokens, loadModelState, recentRadarTokens } from './radar-query.js'
import { createLogger, errorMessage, sleep } from './runtime.js'

const logger = createLogger('early-starts')

export const earlyLogRules = {
  winGain: 0.5,
  lossDrop: 0.35,
  followMs: 15 * 60_000,
  goneAfterMs: 3 * 60_000,
  refireMs: 30 * 60_000,
  cycleMs: 1_000,
  readingEveryMs: 1_000,
  readingMaxAgeMinutes: 24 * 60,
  keepReadingsMs: 24 * 60 * 60_000,
  keepStartsMs: 14 * 24 * 60 * 60_000,
  summaryWindowMs: 7 * 24 * 60 * 60_000,
}

const earlySchema = `
CREATE TABLE IF NOT EXISTS early_starts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  pair_address TEXT,
  fired_at INTEGER NOT NULL,
  price REAL NOT NULL,
  market_cap REAL,
  score INTEGER NOT NULL,
  runner_score INTEGER,
  readings_json TEXT NOT NULL,
  blocked_by TEXT,
  peak_15m REAL,
  low_15m REAL,
  end_15m REAL,
  hit_win_at INTEGER,
  hit_loss_at INTEGER,
  last_price REAL,
  last_at INTEGER,
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS early_starts_mint ON early_starts (mint, fired_at);
CREATE INDEX IF NOT EXISTS early_starts_time ON early_starts (fired_at);
CREATE TABLE IF NOT EXISTS coin_readings (
  mint TEXT NOT NULL,
  t INTEGER NOT NULL,
  age_minutes REAL,
  price REAL,
  market_cap REAL,
  viewers INTEGER,
  score INTEGER,
  early INTEGER,
  firing INTEGER,
  holders INTEGER,
  holders_per_min REAL,
  pro_traders REAL,
  wallet_score INTEGER,
  top10 REAL,
  bundlers REAL,
  insiders REAL,
  snipers REAL,
  fresh REAL,
  dev REAL,
  PRIMARY KEY (mint, t)
);
CREATE INDEX IF NOT EXISTS coin_readings_time ON coin_readings (t);
`

export type EarlyRow = {
  id: number
  mint: string
  symbol: string
  pair_address: string | null
  fired_at: number
  price: number
  market_cap: number | null
  score: number
  runner_score: number | null
  blocked_by: string | null
  peak_15m: number | null
  low_15m: number | null
  end_15m: number | null
  hit_win_at: number | null
  hit_loss_at: number | null
  last_price: number | null
  last_at: number | null
  closed_at: number | null
}

const round3 = (value: number) => Math.round(value * 1000) / 1000

/**
 * Moves one early start forward with a new price: its best and worst multiple within 15 minutes and whichever came first,
 * +50% (a win) or -35% (a loss). A level counts once two readings in a row agree, so one stray price cannot decide it. It
 * closes at 15 minutes with the multiple it ended on; a coin whose price stops arriving for 3 minutes has been dropped
 * by the tracker, which is a loss unless it had already won.
 */
export function advanceEarly(row: EarlyRow, price: number | null, now: number, previous: number | null = price): EarlyRow {
  if (row.closed_at !== null) return row
  const next = { ...row }
  const age = now - row.fired_at
  if (price !== null && price > 0 && row.price > 0) {
    const before = previous !== null && previous > 0 ? previous : price
    const upper = round3(Math.min(price, before) / row.price)
    const lower = round3(Math.max(price, before) / row.price)
    if (age <= earlyLogRules.followMs) {
      next.peak_15m = Math.max(row.peak_15m ?? 1, upper)
      next.low_15m = Math.min(row.low_15m ?? 1, lower)
      if (next.hit_win_at === null && next.hit_loss_at === null) {
        if (upper >= 1 + earlyLogRules.winGain) next.hit_win_at = now
        else if (lower <= 1 - earlyLogRules.lossDrop) next.hit_loss_at = now
      }
    }
    next.last_price = price
    next.last_at = now
    if (age >= earlyLogRules.followMs) {
      next.end_15m = round3(price / row.price)
      next.closed_at = now
    }
    return next
  }
  if ((next.last_at ?? row.fired_at) < now - earlyLogRules.goneAfterMs) {
    if (next.hit_win_at === null && next.hit_loss_at === null) next.hit_loss_at = now
    next.closed_at = now
  }
  return next
}

/** How an early start ended: +50% before -35% wins, -35% first (or the coin vanishing) loses, neither by 15 minutes is flat. */
export function earlyResult(row: Pick<EarlyRow, 'hit_win_at' | 'hit_loss_at' | 'closed_at'>): 'win' | 'loss' | 'flat' | null {
  if (row.hit_win_at !== null) return 'win'
  if (row.hit_loss_at !== null) return 'loss'
  return row.closed_at !== null ? 'flat' : null
}

function toRecord(row: EarlyRow): RadarEarlyRecord {
  return { id: row.id, mint: row.mint, symbol: row.symbol, pairAddress: row.pair_address, firedAt: row.fired_at, price: row.price, marketCap: row.market_cap, score: row.score, runnerScore: row.runner_score, peak15m: row.peak_15m, low15m: row.low_15m, end15m: row.end_15m, result: earlyResult(row), blockedBy: row.blocked_by }
}

export function summarizeEarly(rows: EarlyRow[], now: number): RadarEarlySummary {
  const ordered = rows.slice().sort((first, second) => second.fired_at - first.fired_at)
  const open = ordered.filter(row => row.blocked_by === null)
  const blocked = ordered.filter(row => row.blocked_by !== null)
  const results = open.map(earlyResult)
  const blockedResults = blocked.map(earlyResult)
  const peaks = open.filter(row => row.closed_at !== null && row.peak_15m !== null).map(row => row.peak_15m as number).sort((first, second) => first - second)
  return {
    fired: open.length,
    decided: results.filter(result => result !== null).length,
    wins: results.filter(result => result === 'win').length,
    losses: results.filter(result => result === 'loss').length,
    flat: results.filter(result => result === 'flat').length,
    medianPeak: peaks.length ? peaks[Math.floor(peaks.length / 2)] : null,
    blocked: { fired: blocked.length, decided: blockedResults.filter(result => result !== null).length, wins: blockedResults.filter(result => result === 'win').length },
    recent: ordered.slice(0, 30).map(toRecord),
    updatedAt: now,
  }
}

function readingsOf(token: RadarToken) {
  const traits = token.holderTraits
  return {
    ageMinutes: token.ageMinutes,
    marketCap: token.marketCap,
    liquidity: token.liquidityUsd,
    viewers: token.viewers,
    volume5m: token.volume5m,
    buys5m: token.buys5m,
    sells5m: token.sells5m,
    stretchPct: token.early?.stretchPct ?? null,
    holders: traits?.holders ?? null,
    holdersPerMin: token.holdersPerMin,
    proTraders: traits?.proTraders ?? null,
    top10: traits?.top10 ?? null,
    bundlers: traits?.bundlers ?? null,
    insiders: traits?.insiders ?? null,
    snipers: traits?.snipers ?? null,
    fresh: traits?.fresh ?? null,
    dev: traits?.dev ?? null,
    walletScore: token.wallets?.score ?? null,
    signs: (token.early?.signs ?? []).map(sign => ({ points: sign.points, max: sign.max, reading: sign.reading })),
  }
}

/**
 * Every 2 seconds: records each coin whose early-start pattern is complete (once per coin per 30 minutes, noting the gate
 * that was failing if one held it at 0), follows it for 15 minutes, and keeps a 1-second reading of every tracked coin under a day old (score, early-start reading, holders, holder
 * growth, pro traders, wallet score, holder shares) so those readings can be tested against what the coin did next. It
 * only keeps records: nothing here buys or tells the paper bot to.
 */
export function startEarlyLog(database: TrackerDatabase, signal: AbortSignal) {
  database.exec(earlySchema)
  const insert = database.prepare(`INSERT INTO early_starts (mint, symbol, pair_address, fired_at, price, market_cap, score, runner_score, readings_json, blocked_by, peak_15m, low_15m, last_price, last_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`)
  const update = database.prepare('UPDATE early_starts SET peak_15m = ?, low_15m = ?, end_15m = ?, hit_win_at = ?, hit_loss_at = ?, last_price = ?, last_at = ?, closed_at = ? WHERE id = ?')
  const reading = database.prepare(`INSERT OR REPLACE INTO coin_readings (mint, t, age_minutes, price, market_cap, viewers, score, early, firing, holders, holders_per_min, pro_traders, wallet_score, top10, bundlers, insiders, snipers, fresh, dev)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const lastFired = new Map<string, number>()
  for (const row of database.prepare('SELECT mint, MAX(fired_at) AS at FROM early_starts WHERE fired_at >= ? GROUP BY mint').all(Date.now() - earlyLogRules.refireMs) as Array<{ mint: string; at: number }>) lastFired.set(row.mint, row.at)
  const lastReading = new Map<string, number>()
  const previousPrice = new Map<number, number>()
  let dirty = true
  let lastSummaryAt = 0
  let lastHeartbeat = 0
  let lastPruneAt = 0

  const summarize = (now: number) => {
    earlyState.summary = summarizeEarly(database.prepare('SELECT * FROM early_starts WHERE fired_at >= ?').all(now - earlyLogRules.summaryWindowMs) as EarlyRow[], now)
    lastSummaryAt = now
    dirty = false
  }

  const cycle = (now: number) => {
    const tokens = recentRadarTokens(now) ?? buildRadarTokens(database, loadModelState(database).weights, now)
    const byMint = new Map(tokens.map(token => [token.mint, token]))
    const open = database.prepare('SELECT * FROM early_starts WHERE closed_at IS NULL').all() as EarlyRow[]
    database.transaction(() => {
      for (const row of open) {
        const price = byMint.get(row.mint)?.priceUsd ?? null
        const next = advanceEarly(row, price, now, previousPrice.get(row.id) ?? price)
        if (price !== null) previousPrice.set(row.id, price)
        if (next.closed_at !== null) previousPrice.delete(row.id)
        if (next.hit_win_at !== row.hit_win_at || next.hit_loss_at !== row.hit_loss_at || next.closed_at !== row.closed_at) dirty = true
        update.run(next.peak_15m, next.low_15m, next.end_15m, next.hit_win_at, next.hit_loss_at, next.last_price, next.last_at, next.closed_at, row.id)
      }
      for (const token of tokens) {
        if (token.early && token.early.missing.length === 0 && token.priceUsd && now - (lastFired.get(token.mint) ?? 0) >= earlyLogRules.refireMs) {
          insert.run(token.mint, token.symbol, token.pairAddress, now, token.priceUsd, token.marketCap, token.early.score, token.score, JSON.stringify(readingsOf(token)), token.early.blockedBy, token.priceUsd, now)
          lastFired.set(token.mint, now)
          logger.info('Early start', { mint: token.mint, symbol: token.symbol, early: token.early.score, score: token.score, marketCap: token.marketCap, blockedBy: token.early.blockedBy })
          dirty = true
        }
        if (token.ageMinutes <= earlyLogRules.readingMaxAgeMinutes && token.priceUsd && now - (lastReading.get(token.mint) ?? 0) >= earlyLogRules.readingEveryMs) {
          const traits = token.holderTraits
          reading.run(token.mint, now, token.ageMinutes, token.priceUsd, token.marketCap, token.viewers, token.score, token.early?.score ?? null, token.early?.firing ? 1 : 0, traits?.holders ?? null, token.holdersPerMin, traits?.proTraders ?? null, token.wallets?.score ?? null, traits?.top10 ?? null, traits?.bundlers ?? null, traits?.insiders ?? null, traits?.snipers ?? null, traits?.fresh ?? null, traits?.dev ?? null)
          lastReading.set(token.mint, now)
        }
      }
    })()
    if (now - lastPruneAt >= 60 * 60_000) {
      database.prepare('DELETE FROM coin_readings WHERE t < ?').run(now - earlyLogRules.keepReadingsMs)
      database.prepare('DELETE FROM early_starts WHERE fired_at < ?').run(now - earlyLogRules.keepStartsMs)
      for (const [mint, at] of lastReading) if (now - at > 10 * 60_000) lastReading.delete(mint)
      for (const [mint, at] of lastFired) if (now - at > earlyLogRules.refireMs) lastFired.delete(mint)
      lastPruneAt = now
    }
    if (dirty || now - lastSummaryAt >= 30_000) summarize(now)
    if (now - lastHeartbeat >= 15_000) {
      const summary = earlyState.summary
      recordHeartbeat(database, 'early-starts', 'ok', `${open.length} being followed${summary ? `, ${summary.fired} fired in 7 days (${summary.blocked.fired} more held by a gate), ${summary.wins} of ${summary.decided} decided reached +50% before -35%` : ''}`)
      lastHeartbeat = now
    }
  }

  logger.info('Logging early starts and young-coin readings')
  return (async () => {
    while (!signal.aborted) {
      const started = Date.now()
      try {
        cycle(started)
      } catch (error) {
        logger.warn('Early start cycle failed', { error: errorMessage(error) })
      }
      await sleep(Math.max(200, earlyLogRules.cycleMs - (Date.now() - started)), signal)
    }
  })()
}
