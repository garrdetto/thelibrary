import type { RadarClimb, RadarClimber, RadarClimberMilestone } from '../../src/lib/axiom-radar-learner.js'
import type { RadarToken } from '../../src/lib/axiom-radar-types.js'
import type { TrackerDatabase } from './db.js'
import { readFullRecord } from './coin-archive.js'

/** What makes a steady climber: an hour or more of mostly rising price, with real volume and liquidity, ending at $200K or more. */
export const climberRules = {
  bucketMs: 5 * 60_000,
  minimumPeakMcap: 200_000,
  maximumPeakMcap: 50_000_000,
  minimumMinutes: 60,
  minimumGain: 1.8,
  minimumUpShare: 0.55,
  maximumDrawdown: 0.4,
  minimumAverageVolume5m: 5_000,
  minimumLiquidity: 30_000,
  liveWindowMs: 4 * 60 * 60_000,
  liveRisingMs: 15 * 60_000,
  scanEveryMs: 3 * 60_000,
  milestoneMinutes: [0, 15, 30, 60, 120] as const,
  walletLimit: 40,
}

export type ClimbPoint = { t: number; mcap: number; liquidity: number | null; volume5m: number | null; buys5m: number | null; sells5m: number | null; viewers: number | null }
type ReadingPoint = { t: number; holders: number | null; top10: number | null; bundlers: number | null; insiders: number | null; snipers: number | null; fresh: number | null; dev: number | null; proTraders: number | null; walletScore: number | null; score: number | null }
type TradePoint = { wallet: string; kind: string; usd: number; at: number }
export type Climb = { startAt: number; peakAt: number; startMcap: number; peakMcap: number; minutes: number; gain: number; upShare: number; drawdown: number; averageVolume5m: number | null; maxLiquidity: number | null; points: ClimbPoint[] }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const numberOr = (value: unknown) => finite(value) ? value : null
const round = (value: number | null, places = 0) => value === null ? null : Math.round(value * 10 ** places) / 10 ** places

const schema = `
CREATE TABLE IF NOT EXISTS steady_climbers (
  mint TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  pair_address TEXT,
  launched_at INTEGER,
  first_seen_at INTEGER,
  start_at INTEGER NOT NULL,
  peak_at INTEGER NOT NULL,
  start_mcap REAL NOT NULL,
  peak_mcap REAL NOT NULL,
  minutes REAL NOT NULL,
  gain REAL NOT NULL,
  up_share REAL NOT NULL,
  drawdown REAL NOT NULL,
  average_volume_5m REAL,
  max_liquidity REAL,
  holders_peak INTEGER,
  outcome TEXT,
  features_json TEXT,
  milestones_json TEXT NOT NULL,
  shape_json TEXT NOT NULL,
  wallets_json TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`

export function prepareClimbers(database: TrackerDatabase) {
  database.exec(schema)
}

/** Closing value of every 5-minute window, in time order. */
function buckets(points: ClimbPoint[], size = climberRules.bucketMs) {
  const byWindow = new Map<number, ClimbPoint>()
  for (const point of points) if (finite(point.mcap) && point.mcap > 0) byWindow.set(Math.floor(point.t / size), point)
  return [...byWindow.keys()].sort((first, second) => first - second).map(key => byWindow.get(key) as ClimbPoint)
}

/**
 * The run that ends at the highest point of the chart: the earliest low it can start from without ever falling more than
 * `maximumDrawdown` below its own running high on the way up. Null when there is no rise to speak of.
 */
export function findClimb(points: ClimbPoint[]): Climb | null {
  const closes = buckets(points)
  if (closes.length < 3) return null
  let peak = 0
  for (let index = 1; index < closes.length; index++) if (closes[index].mcap > closes[peak].mcap) peak = index
  let start: number | null = null
  for (let candidate = peak; candidate >= 0; candidate--) {
    let high = 0
    let drawdown = 0
    let low = Infinity
    for (let index = candidate; index <= peak; index++) {
      high = Math.max(high, closes[index].mcap)
      drawdown = Math.max(drawdown, 1 - closes[index].mcap / high)
      low = Math.min(low, closes[index].mcap)
    }
    if (drawdown > climberRules.maximumDrawdown) break
    if (closes[candidate].mcap <= low) start = candidate
  }
  if (start === null || start === peak) return null
  const run = closes.slice(start, peak + 1)
  let high = 0
  let drawdown = 0
  for (const point of run) {
    high = Math.max(high, point.mcap)
    drawdown = Math.max(drawdown, 1 - point.mcap / high)
  }
  const rises = run.slice(1).filter((point, index) => point.mcap > run[index].mcap).length
  const raw = points.filter(point => point.t >= run[0].t && point.t <= run[run.length - 1].t)
  const volumes = raw.map(point => point.volume5m).filter(finite)
  const liquidity = raw.map(point => point.liquidity).filter(finite)
  return {
    startAt: run[0].t,
    peakAt: run[run.length - 1].t,
    startMcap: run[0].mcap,
    peakMcap: run[run.length - 1].mcap,
    minutes: (run[run.length - 1].t - run[0].t) / 60_000,
    gain: run[run.length - 1].mcap / run[0].mcap,
    upShare: rises / (run.length - 1),
    drawdown,
    averageVolume5m: volumes.length ? volumes.reduce((total, value) => total + value, 0) / volumes.length : null,
    maxLiquidity: liquidity.length ? Math.max(...liquidity) : null,
    points: raw,
  }
}

/** Every reason a climb falls short of a steady climber; empty when it is one. */
export function climberMisses(climb: Climb, peakMcap = climb.peakMcap) {
  const misses: string[] = []
  if (peakMcap < climberRules.minimumPeakMcap) misses.push('peak under $200K')
  if (peakMcap > climberRules.maximumPeakMcap) misses.push('peak over $50M')
  if (climb.minutes < climberRules.minimumMinutes) misses.push('rose for under an hour')
  if (climb.gain < climberRules.minimumGain) misses.push('gained under 1.8x')
  if (climb.upShare < climberRules.minimumUpShare) misses.push('not rising most of the time')
  if ((climb.averageVolume5m ?? 0) < climberRules.minimumAverageVolume5m) misses.push('low volume')
  if ((climb.maxLiquidity ?? 0) < climberRules.minimumLiquidity) misses.push('low liquidity')
  return misses
}

const isClimber = (climb: Climb, peakMcap?: number) => climberMisses(climb, peakMcap).length === 0

/** The last row at or before a moment (the first row when none is that early). */
function atOrBefore<T extends { t: number }>(rows: T[], at: number) {
  let best: T | null = null
  for (const row of rows) if (row.t <= at) best = row
  return best ?? rows[0] ?? null
}

function nearest<T extends { t: number }>(rows: T[], at: number, within = 10 * 60_000) {
  let best: T | null = null
  for (const row of rows) if (Math.abs(row.t - at) <= within && (!best || Math.abs(row.t - at) < Math.abs(best.t - at))) best = row
  return best
}

/** A mark with no reading this close to it is left empty (the tracker was not running then). */
const gapMs = 15 * 60_000

/** The coin's numbers at the start of its climb, 15, 30, 60 and 120 minutes in, and at its peak. */
export function milestonesOf(climb: Climb, readings: ReadingPoint[]): RadarClimberMilestone[] {
  const marks: Array<{ label: string; at: number }> = climberRules.milestoneMinutes.filter(minutes => minutes <= climb.minutes).map(minutes => ({ label: minutes === 0 ? 'start' : `${minutes}m`, at: climb.startAt + minutes * 60_000 }))
  marks.push({ label: 'peak', at: climb.peakAt })
  return marks.map(({ label, at }) => {
    const found = label === 'peak' ? climb.points[climb.points.length - 1] : atOrBefore(climb.points, at) as ClimbPoint
    const point: ClimbPoint = Math.abs(at - found.t) <= gapMs ? found : { t: at, mcap: NaN, liquidity: null, volume5m: null, buys5m: null, sells5m: null, viewers: null }
    const reading = nearest(readings, at, gapMs)
    const trades = (point.buys5m ?? 0) + (point.sells5m ?? 0)
    return {
      label,
      minutes: Math.round((at - climb.startAt) / 60_000),
      marketCap: finite(point.mcap) ? round(point.mcap) : null,
      liquidity: round(point.liquidity),
      volume5m: round(point.volume5m),
      buys5m: point.buys5m,
      buyRatio: trades > 0 ? round((point.buys5m ?? 0) / trades, 2) : null,
      viewers: point.viewers,
      holders: reading?.holders ?? null,
      top10: round(reading?.top10 ?? null, 1),
      bundlers: round(reading?.bundlers ?? null, 1),
      insiders: round(reading?.insiders ?? null, 1),
      snipers: round(reading?.snipers ?? null, 1),
      fresh: round(reading?.fresh ?? null, 1),
      dev: round(reading?.dev ?? null, 1),
      proTraders: round(reading?.proTraders ?? null, 1),
      walletScore: reading?.walletScore ?? null,
      score: reading?.score ?? null,
    }
  })
}

/** Price curve of the climb as 24 points of market cap, start to peak. */
function shapeOfClimb(climb: Climb, count = 24) {
  const span = climb.peakAt - climb.startAt
  return Array.from({ length: count }, (_, index) => round(atOrBefore(climb.points, climb.startAt + (span * index) / (count - 1))?.mcap ?? null))
}

/** The wallets that bought before the peak, biggest buyers first, with what they put in and when they first bought. */
export function buyersOf(trades: TradePoint[], peakAt: number, limit = climberRules.walletLimit) {
  const byWallet = new Map<string, { wallet: string; boughtUsd: number; soldUsd: number; firstBuyAt: number }>()
  for (const trade of trades) {
    if (!trade.wallet || !finite(trade.usd)) continue
    const entry = byWallet.get(trade.wallet) ?? { wallet: trade.wallet, boughtUsd: 0, soldUsd: 0, firstBuyAt: Infinity }
    if (trade.kind === 'buy' && trade.at <= peakAt) {
      entry.boughtUsd += trade.usd
      entry.firstBuyAt = Math.min(entry.firstBuyAt, trade.at)
    } else if (trade.kind === 'sell') entry.soldUsd += trade.usd
    byWallet.set(trade.wallet, entry)
  }
  return [...byWallet.values()].filter(entry => entry.boughtUsd > 0).sort((first, second) => second.boughtUsd - first.boughtUsd).slice(0, limit)
    .map(entry => ({ wallet: entry.wallet, boughtUsd: Math.round(entry.boughtUsd), soldUsd: Math.round(entry.soldUsd), firstBuyAt: entry.firstBuyAt }))
}

type History = { points: ClimbPoint[]; readings: ReadingPoint[]; trades: TradePoint[] }

const pointOf = (row: Record<string, unknown>): ClimbPoint => ({ t: Number(row.timestamp), mcap: Number(row.market_cap), liquidity: numberOr(row.liquidity_usd), volume5m: numberOr(row.volume_5m), buys5m: numberOr(row.buys_5m), sells5m: numberOr(row.sells_5m), viewers: numberOr(row.viewers) })
const readingOf = (row: Record<string, unknown>): ReadingPoint => ({ t: Number(row.t), holders: numberOr(row.holders), top10: numberOr(row.top10), bundlers: numberOr(row.bundlers), insiders: numberOr(row.insiders), snipers: numberOr(row.snipers), fresh: numberOr(row.fresh), dev: numberOr(row.dev), proTraders: numberOr(row.pro_traders), walletScore: numberOr(row.wallet_score), score: numberOr(row.score) })
const tradeOf = (row: Record<string, unknown>): TradePoint => ({ wallet: String(row.wallet ?? ''), kind: String(row.kind ?? ''), usd: Number(row.usd), at: Number(row.at) })

const tableExists = (database: TrackerDatabase, table: string) => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))

/** The coin's chart, readings and trades from the live tables, or from its archived full record once the raw rows are gone. */
export function historyOf(database: TrackerDatabase, mint: string, since = 0): History {
  const live = (database.prepare('SELECT * FROM snapshots WHERE mint = ? AND timestamp >= ? AND market_cap > 0 ORDER BY timestamp ASC').all(mint, since) as Array<Record<string, unknown>>).map(pointOf)
  const readings = tableExists(database, 'coin_readings') ? (database.prepare('SELECT * FROM coin_readings WHERE mint = ? AND t >= ? ORDER BY t ASC').all(mint, since) as Array<Record<string, unknown>>).map(readingOf) : []
  const trades = tableExists(database, 'coin_trades') ? (database.prepare('SELECT wallet, kind, usd, at FROM coin_trades WHERE mint = ? ORDER BY at ASC').all(mint) as Array<Record<string, unknown>>).map(tradeOf) : []
  if (live.length >= 12 || since > 0 || !tableExists(database, 'coin_archive_full')) return { points: live, readings, trades }
  const archived = database.prepare('SELECT data FROM coin_archive_full WHERE mint = ?').get(mint) as { data: Buffer } | undefined
  if (!archived) return { points: live, readings, trades }
  const record = readFullRecord(archived.data)
  const rows = (key: string) => Array.isArray(record[key]) ? record[key] as Array<Record<string, unknown>> : []
  const points = rows('snapshots').map(pointOf).filter(point => finite(point.t) && finite(point.mcap) && point.mcap > 0).sort((first, second) => first.t - second.t)
  return {
    points: points.length > live.length ? points : live,
    readings: readings.length ? readings : rows('readings').map(readingOf).sort((first, second) => first.t - second.t),
    trades: trades.length ? trades : rows('trades').map(tradeOf),
  }
}

type CandidateRow = { mint: string; symbol: string; launched_at: number; first_seen_at: number; peak_mcap: number; features_json: string | null; holders_peak: number | null; outcome: string; last_at: number; pair_address: string | null; updated_at: number | null }

const scannedAt = new Map<string, number>()

/** Finds and saves every steady climber the tracker has data for. Saved rows are permanent; a climber still running is refreshed as it climbs. */
export function recordClimbers(database: TrackerDatabase, now = Date.now()) {
  prepareClimbers(database)
  const candidates = database.prepare(`SELECT l.mint, l.symbol, l.launched_at, l.first_seen_at, l.peak_mcap, l.features_json, l.holders_peak, l.outcome, l.last_at, t.pair_address, c.updated_at
    FROM coin_lifecycles l LEFT JOIN tokens t ON t.mint = l.mint LEFT JOIN steady_climbers c ON c.mint = l.mint
    WHERE l.peak_mcap >= ? AND l.peak_mcap <= ? AND (c.mint IS NULL OR l.last_at > c.updated_at)`).all(climberRules.minimumPeakMcap, climberRules.maximumPeakMcap) as CandidateRow[]
  const save = database.prepare(`INSERT INTO steady_climbers (mint, symbol, pair_address, launched_at, first_seen_at, start_at, peak_at, start_mcap, peak_mcap, minutes, gain, up_share, drawdown, average_volume_5m, max_liquidity, holders_peak, outcome, features_json, milestones_json, shape_json, wallets_json, saved_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (mint) DO UPDATE SET symbol = excluded.symbol, pair_address = COALESCE(excluded.pair_address, steady_climbers.pair_address), start_at = excluded.start_at, peak_at = excluded.peak_at, start_mcap = excluded.start_mcap,
      peak_mcap = excluded.peak_mcap, minutes = excluded.minutes, gain = excluded.gain, up_share = excluded.up_share, drawdown = excluded.drawdown, average_volume_5m = excluded.average_volume_5m, max_liquidity = excluded.max_liquidity,
      holders_peak = excluded.holders_peak, outcome = excluded.outcome, milestones_json = excluded.milestones_json, shape_json = excluded.shape_json,
      wallets_json = CASE WHEN excluded.wallets_json = '[]' THEN steady_climbers.wallets_json ELSE excluded.wallets_json END, updated_at = excluded.updated_at
    WHERE excluded.peak_mcap >= steady_climbers.peak_mcap * 0.98`)
  const touch = database.prepare('UPDATE steady_climbers SET outcome = ?, updated_at = ? WHERE mint = ?')
  let saved = 0
  for (const row of candidates) {
    if (scannedAt.get(row.mint) === row.last_at) continue
    scannedAt.set(row.mint, row.last_at)
    const history = historyOf(database, row.mint)
    const climb = findClimb(history.points)
    if (!climb || !isClimber(climb)) {
      if (row.updated_at !== null) touch.run(row.outcome, now, row.mint)
      continue
    }
    save.run(row.mint, row.symbol, row.pair_address, row.launched_at, row.first_seen_at, climb.startAt, climb.peakAt, climb.startMcap, climb.peakMcap, climb.minutes, climb.gain, climb.upShare, climb.drawdown, climb.averageVolume5m, climb.maxLiquidity,
      row.holders_peak, row.outcome, row.features_json, JSON.stringify(milestonesOf(climb, history.readings)), JSON.stringify(shapeOfClimb(climb)), JSON.stringify(buyersOf(history.trades, climb.peakAt)), now, now)
    saved += 1
  }
  return saved
}

type ClimberRow = { mint: string; symbol: string; pair_address: string | null; start_at: number; peak_at: number; start_mcap: number; peak_mcap: number; minutes: number; gain: number; up_share: number; average_volume_5m: number | null; max_liquidity: number | null; holders_peak: number | null; outcome: string | null; milestones_json: string; shape_json: string; wallets_json: string }

const parse = <T>(json: string, fallback: T) => {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

export function loadClimbers(database: TrackerDatabase): RadarClimber[] {
  prepareClimbers(database)
  return (database.prepare('SELECT * FROM steady_climbers ORDER BY peak_mcap DESC').all() as ClimberRow[]).map(row => {
    const wallets = parse<Array<{ wallet: string }>>(row.wallets_json, [])
    return {
      mint: row.mint,
      symbol: row.symbol,
      pairAddress: row.pair_address,
      startAt: row.start_at,
      peakAt: row.peak_at,
      startMcap: Math.round(row.start_mcap),
      peakMcap: Math.round(row.peak_mcap),
      minutes: Math.round(row.minutes),
      gain: Math.round(row.gain * 10) / 10,
      upShare: Math.round(row.up_share * 100) / 100,
      averageVolume5m: round(row.average_volume_5m),
      maxLiquidity: round(row.max_liquidity),
      holdersPeak: row.holders_peak,
      outcome: row.outcome,
      wallets: wallets.length,
      milestones: parse<RadarClimberMilestone[]>(row.milestones_json, []),
      shape: parse<Array<number | null>>(row.shape_json, []),
    }
  })
}

/** Wallets that bought into a saved climber before its peak. */
export function climberWallets(database: TrackerDatabase) {
  prepareClimbers(database)
  const wallets = new Map<string, Set<string>>()
  for (const row of database.prepare('SELECT mint, wallets_json FROM steady_climbers').all() as Array<{ mint: string; wallets_json: string }>) {
    for (const entry of parse<Array<{ wallet: string }>>(row.wallets_json, [])) {
      const coins = wallets.get(entry.wallet) ?? new Set<string>()
      coins.add(row.mint)
      wallets.set(entry.wallet, coins)
    }
  }
  return wallets
}

/** How a live coin's chart is climbing right now, from the last four hours of snapshots. */
export function liveClimb(database: TrackerDatabase, mint: string, now = Date.now()): RadarClimb | null {
  const climb = findClimb(historyOf(database, mint, now - climberRules.liveWindowMs).points)
  if (!climb) return null
  return { minutes: Math.round(climb.minutes), gain: Math.round(climb.gain * 100) / 100, upShare: Math.round(climb.upShare * 100) / 100, rising: now - climb.peakAt <= climberRules.liveRisingMs, averageVolume5m: round(climb.averageVolume5m), maxLiquidity: round(climb.maxLiquidity) }
}

const median = (values: number[]) => {
  if (!values.length) return null
  const sorted = [...values].sort((first, second) => first - second)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** The typical saved climber 30 minutes into its climb (or its start when no climber has a 30-minute mark yet). */
export function climberBaseline(climbers: RadarClimber[]) {
  const at = (climber: RadarClimber) => climber.milestones.find(mark => mark.label === '30m') ?? climber.milestones[0]
  const pick = (key: 'liquidity' | 'volume5m' | 'holders') => median(climbers.map(at).map(mark => mark?.[key]).filter(finite))
  return { liquidity: pick('liquidity'), volume5m: pick('volume5m'), holders: pick('holders') }
}

/**
 * How closely a live coin looks like the saved climbers did on their way up, 0 to 1: rising now, climbing 30+ minutes, mostly up,
 * and volume, liquidity and holders at least half of the typical climber's 30 minutes in.
 */
export function climberLikeness(token: RadarToken, climb: RadarClimb | null, baseline: ReturnType<typeof climberBaseline>) {
  const holders = token.holderTraits?.holders ?? token.pulse?.holders ?? null
  const checks = [
    Boolean(climb?.rising),
    (climb?.minutes ?? 0) >= 30,
    (climb?.upShare ?? 0) >= climberRules.minimumUpShare,
    baseline.volume5m === null ? (token.volume5m ?? 0) >= climberRules.minimumAverageVolume5m : (token.volume5m ?? 0) >= baseline.volume5m * 0.5,
    baseline.liquidity === null ? (token.liquidityUsd ?? 0) >= climberRules.minimumLiquidity : (token.liquidityUsd ?? 0) >= baseline.liquidity * 0.5,
    baseline.holders === null || holders === null ? holders !== null : holders >= baseline.holders * 0.5,
  ]
  return checks.filter(Boolean).length / checks.length
}
