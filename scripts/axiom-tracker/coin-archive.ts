import { gunzipSync, gzipSync } from 'node:zlib'
import { initializeTrackerSchema, recordHeartbeat, type TrackerDatabase } from './db.js'
import { markResearchReset } from './research-meta.js'
import { createLogger, runLoop } from './runtime.js'
import { assignTiers, believableMultiple, buildLadder, classifyCoin, dataWeight, outcomeScore, tierCount, type CoinClass, type FeatureValues, type TierLadder } from './coin-tiers.js'
import { buySighting, minimumStakePct } from './wallet-score.js'

const logger = createLogger('coin-archive')
const cycleMs = 10 * 60_000
const rankEveryMs = 24 * 60 * 60_000
/** A coin the learner never priced is archived once it has not been seen for this long. */
const unpricedAfterMs = 2 * 60 * 60_000
const batchSize = 400
/** How many of the best coins keep every raw row. */
export const fullCoins = 50
/** The database is kept under this many megabytes of live data by dropping the raw rows of coins already archived, oldest first. */
const capBytes = (Number(process.env.AXIOM_DB_CAP_MB) || 300) * 1024 * 1024
const shapePoints = 24
/** A lifecycle row (first-minute features, peak, liquidity and outcome) counts as this many readings when the raw chart is gone. */
const lifecycleReadings = 20
const skipFull = new Set<CoinClass>(['garbage', 'steady_rug'])

export const archiveTables = ['coin_archive', 'coin_archive_full', 'coin_tiers', 'wallet_archive'] as const

const archiveSchema = `
CREATE TABLE IF NOT EXISTS coin_archive (
  mint TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  launched_at INTEGER,
  first_seen_at INTEGER,
  closed_at INTEGER,
  outcome TEXT NOT NULL,
  rug_kind TEXT,
  class TEXT NOT NULL,
  first_mcap REAL,
  peak_mcap REAL,
  peak_mcap_at INTEGER,
  last_mcap REAL,
  peak_multiple REAL,
  minutes_to_peak REAL,
  life_minutes REAL,
  max_liquidity REAL,
  peak_volume_5m REAL,
  peak_viewers INTEGER,
  holders_peak INTEGER,
  unique_buyers INTEGER,
  buy_usd REAL,
  sell_usd REAL,
  up_share REAL,
  volume_to_mcap REAL,
  data_points INTEGER NOT NULL,
  data_minutes REAL NOT NULL,
  data_weight REAL NOT NULL,
  outcome_score REAL NOT NULL,
  tier INTEGER,
  features_json TEXT NOT NULL,
  traits_json TEXT,
  shape_json TEXT,
  raw_dropped INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS coin_archive_score ON coin_archive (outcome_score);
CREATE INDEX IF NOT EXISTS coin_archive_archived ON coin_archive (archived_at);

CREATE TABLE IF NOT EXISTS coin_archive_full (
  mint TEXT PRIMARY KEY,
  outcome_score REAL NOT NULL,
  saved_at INTEGER NOT NULL,
  data BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS coin_tiers (
  tier INTEGER PRIMARY KEY,
  coins INTEGER NOT NULL,
  weight REAL NOT NULL,
  min_score REAL NOT NULL,
  max_score REAL NOT NULL,
  profile_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_archive (
  wallet TEXT NOT NULL,
  mint TEXT NOT NULL,
  pct REAL NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (wallet, mint)
);
CREATE INDEX IF NOT EXISTS wallet_archive_mint ON wallet_archive (mint);
`

export const archiveState: { ladder: TierLadder | null; coins: number; full: number; rankedAt: number } = { ladder: null, coins: 0, full: 0, rankedAt: 0 }

type Lifecycle = { mint: string; symbol: string; launched_at: number; first_seen_at: number; first_price: number; features_json: string | null; peak_price: number; peak_at: number; max_liquidity: number | null; last_price: number; last_at: number; rugged_at: number | null; rug_kind: string | null; outcome: string; closed_at: number | null; first_mcap: number | null; peak_mcap: number | null; peak_mcap_at: number | null; last_mcap: number | null; traits_json: string | null; holders_peak: number | null }
type Snapshot = { viewers: number | null; price_usd: number | null; market_cap: number | null; liquidity_usd: number | null; volume_5m: number | null; buys_5m: number | null; sells_5m: number | null; timestamp: number }
type Reading = { t: number; score: number | null; wallet_score: number | null; pro_traders: number | null; holders_per_min: number | null; holders: number | null }
type TokenRow = { mint: string; symbol: string; pair_created_at: number; last_seen_at: number }

export type CoinSummary = {
  mint: string; symbol: string; launchedAt: number | null; firstSeenAt: number | null; closedAt: number | null; outcome: string; rugKind: string | null; cls: CoinClass
  firstMcap: number | null; peakMcap: number | null; peakMcapAt: number | null; lastMcap: number | null; peakMultiple: number; minutesToPeak: number | null; lifeMinutes: number
  maxLiquidity: number | null; peakVolume5m: number | null; peakViewers: number | null; holdersPeak: number | null; uniqueBuyers: number | null; buyUsd: number | null; sellUsd: number | null
  upShare: number | null; volumeToMcap: number | null; dataPoints: number; dataMinutes: number; dataWeight: number; outcomeScore: number
  features: FeatureValues; traits: string | null; shape: Record<string, number[]> | null
}

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value)
const highest = (values: Array<number | null>) => values.reduce<number | null>((best, value) => finite(value) ? Math.max(best ?? value, value) : best, null)
const round = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places
const median = (values: number[]) => {
  if (!values.length) return null
  const sorted = [...values].sort((first, second) => first - second)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function tableExists(database: TrackerDatabase, name: string) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
}

export function prepareArchive(database: TrackerDatabase) {
  database.exec(archiveSchema)
}

/** Share of up moves among the price changes from first sight to the peak: near 1 for a staircase, near 0.5 for a real market. */
export function upShareOf(prices: number[]) {
  let up = 0
  let moves = 0
  for (let index = 1; index < prices.length; index++) {
    if (prices[index] === prices[index - 1]) continue
    moves += 1
    if (prices[index] > prices[index - 1]) up += 1
  }
  return moves >= 5 ? round(up / moves, 3) : null
}

/** The coin's chart squeezed to `points` evenly spaced moments: minutes since first sight, then price, market cap, viewers, liquidity and 5m volume. */
export function shapeOf(snapshots: Snapshot[], points = shapePoints) {
  if (snapshots.length < 2) return null
  const start = snapshots[0].timestamp
  const span = snapshots[snapshots.length - 1].timestamp - start
  const shape: Record<string, number[]> = { minutes: [], price: [], mcap: [], viewers: [], liquidity: [], volume: [] }
  let cursor = 0
  for (let step = 0; step < points; step++) {
    const at = start + span * step / (points - 1)
    while (cursor < snapshots.length - 1 && snapshots[cursor + 1].timestamp <= at) cursor += 1
    const row = snapshots[cursor]
    shape.minutes.push(round((row.timestamp - start) / 60_000, 2))
    shape.price.push(row.price_usd ?? 0)
    shape.mcap.push(Math.round(row.market_cap ?? 0))
    shape.viewers.push(row.viewers ?? 0)
    shape.liquidity.push(Math.round(row.liquidity_usd ?? 0))
    shape.volume.push(Math.round(row.volume_5m ?? 0))
  }
  return shape
}

/** Builds one coin's permanent summary from its lifecycle, chart, readings and trades; null when nothing was ever recorded for it. */
export function summarizeCoin(database: TrackerDatabase, mint: string, now: number): CoinSummary | null {
  const lifecycle = tableExists(database, 'coin_lifecycles') ? database.prepare('SELECT * FROM coin_lifecycles WHERE mint = ?').get(mint) as Lifecycle | undefined : undefined
  const token = database.prepare('SELECT mint, symbol, pair_created_at, last_seen_at FROM tokens WHERE mint = ?').get(mint) as TokenRow | undefined
  const snapshots = database.prepare('SELECT viewers, price_usd, market_cap, liquidity_usd, volume_5m, buys_5m, sells_5m, timestamp FROM snapshots WHERE mint = ? ORDER BY timestamp ASC').all(mint) as Snapshot[]
  if (!lifecycle && !token && snapshots.length === 0) return null
  const readings = tableExists(database, 'coin_readings') ? database.prepare('SELECT t, score, wallet_score, pro_traders, holders_per_min, holders FROM coin_readings WHERE mint = ? ORDER BY t ASC').all(mint) as Reading[] : []
  const trades = tableExists(database, 'coin_trades')
    ? database.prepare("SELECT COUNT(DISTINCT CASE WHEN kind = 'buy' THEN wallet END) AS buyers, SUM(CASE WHEN kind = 'buy' THEN usd ELSE 0 END) AS buys, SUM(CASE WHEN kind = 'sell' THEN usd ELSE 0 END) AS sells, COUNT(*) AS count FROM coin_trades WHERE mint = ?").get(mint) as { buyers: number; buys: number | null; sells: number | null; count: number }
    : { buyers: 0, buys: null, sells: null, count: 0 }

  const mcaps = snapshots.map(row => row.market_cap)
  const firstSeenAt = lifecycle?.first_seen_at ?? snapshots[0]?.timestamp ?? token?.last_seen_at ?? null
  const lastAt = lifecycle?.last_at ?? snapshots[snapshots.length - 1]?.timestamp ?? token?.last_seen_at ?? firstSeenAt ?? now
  const firstMcap = lifecycle?.first_mcap ?? mcaps.find(finite) ?? null
  const peakMcap = highest([lifecycle?.peak_mcap ?? null, ...mcaps])
  const peakIndex = snapshots.reduce((best, row, index) => finite(row.market_cap) && row.market_cap > (snapshots[best]?.market_cap ?? -1) ? index : best, 0)
  const peakMcapAt = lifecycle?.peak_mcap_at ?? snapshots[peakIndex]?.timestamp ?? null
  const lastMcap = lifecycle?.last_mcap ?? [...mcaps].reverse().find(finite) ?? null
  const maxLiquidity = highest([lifecycle?.max_liquidity ?? null, ...snapshots.map(row => row.liquidity_usd)])
  const peakVolume5m = highest(snapshots.map(row => row.volume_5m))
  const start = lifecycle ? (lifecycle.launched_at > 0 ? Math.min(lifecycle.launched_at, lifecycle.first_seen_at) : lifecycle.first_seen_at) : (token?.pair_created_at || firstSeenAt || now)
  const end = lifecycle?.rugged_at ?? lifecycle?.closed_at ?? lastAt
  const lifeMinutes = Math.max(0, (end - start) / 60_000)
  const rising = snapshots.slice(0, peakIndex + 1)
  const upShare = upShareOf(rising.map(row => row.price_usd).filter(finite))
  const volumeToMcap = median(rising.flatMap(row => finite(row.volume_5m) && finite(row.market_cap) && row.market_cap > 0 ? [row.volume_5m / row.market_cap] : []))
  const lifecycleEvidence = lifecycle?.features_json ? lifecycleReadings : 0
  const dataPoints = snapshots.length + readings.length + lifecycleEvidence
  const chartMinutes = snapshots.length > 1 ? (snapshots[snapshots.length - 1].timestamp - snapshots[0].timestamp) / 60_000 : 0
  const dataMinutes = Math.max(chartMinutes, lifecycle ? Math.max(0, lifecycle.last_at - lifecycle.first_seen_at) / 60_000 : 0)
  const outcome = lifecycle?.outcome ?? 'unpriced'
  const peakMultiple = finite(firstMcap) && finite(peakMcap) && firstMcap > 0 ? peakMcap / firstMcap : 1
  const cls = classifyCoin({ points: dataPoints, hasLifecycle: Boolean(lifecycle), maxLiquidity, peakVolume5m, outcome, multiple: peakMultiple > believableMultiple ? 1 : peakMultiple, upShare, volumeToMcap })
  const early = readings.find(row => firstSeenAt !== null && row.t >= firstSeenAt + 60_000) ?? readings[0]
  const learned = lifecycle?.features_json ? JSON.parse(lifecycle.features_json) as FeatureValues : {}
  const features: FeatureValues = { ...learned, score: early?.score ?? null, walletScore: early?.wallet_score ?? null, proTraders: early?.pro_traders ?? null, holdersPerMin: early?.holders_per_min ?? null }
  return {
    mint,
    symbol: lifecycle?.symbol ?? token?.symbol ?? '???',
    launchedAt: lifecycle?.launched_at ?? token?.pair_created_at ?? null,
    firstSeenAt,
    closedAt: lifecycle?.closed_at ?? lastAt,
    outcome,
    rugKind: lifecycle?.rug_kind ?? null,
    cls,
    firstMcap,
    peakMcap,
    peakMcapAt,
    lastMcap,
    peakMultiple: round(peakMultiple, 3),
    minutesToPeak: peakMcapAt !== null && firstSeenAt !== null ? round(Math.max(0, peakMcapAt - firstSeenAt) / 60_000, 2) : null,
    lifeMinutes: round(lifeMinutes, 2),
    maxLiquidity,
    peakVolume5m,
    peakViewers: highest(snapshots.map(row => row.viewers)),
    holdersPeak: highest([lifecycle?.holders_peak ?? null, ...readings.map(row => row.holders)]),
    uniqueBuyers: trades.count ? trades.buyers : null,
    buyUsd: trades.count ? round(trades.buys ?? 0, 2) : null,
    sellUsd: trades.count ? round(trades.sells ?? 0, 2) : null,
    upShare,
    volumeToMcap: volumeToMcap === null ? null : round(volumeToMcap, 4),
    dataPoints,
    dataMinutes: round(dataMinutes, 2),
    dataWeight: dataWeight(dataPoints, dataMinutes),
    outcomeScore: outcomeScore({ firstMcap, peakMcap, lastMcap, maxLiquidity, peakVolume5m, lifeMinutes, cls }),
    features,
    traits: lifecycle?.traits_json ?? null,
    shape: shapeOf(snapshots),
  }
}

/** Every raw row the tracker holds for one coin, gzipped: kept only for the best `fullCoins` coins. */
export function fullRecord(database: TrackerDatabase, mint: string) {
  const hasMint = (table: string) => tableExists(database, table) && (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(column => column.name === 'mint')
  const rows = (table: string) => hasMint(table) ? database.prepare(`SELECT * FROM ${table} WHERE mint = ?`).all(mint) : []
  const token = database.prepare('SELECT * FROM tokens WHERE mint = ?').get(mint) as { pair_address?: string } | undefined
  const record = {
    token: token ?? null,
    lifecycle: tableExists(database, 'coin_lifecycles') ? database.prepare('SELECT * FROM coin_lifecycles WHERE mint = ?').get(mint) ?? null : null,
    snapshots: rows('snapshots'),
    readings: rows('coin_readings'),
    trades: rows('coin_trades'),
    holders: rows('holders'),
    alerts: rows('runner_alerts'),
    earlyStarts: rows('early_starts'),
    bursts: rows('radar_bursts'),
    burstWallets: rows('radar_burst_wallets'),
    walletProfits: rows('wallet_pnl'),
    capture: token?.pair_address && tableExists(database, 'axiom_capture') ? database.prepare('SELECT * FROM axiom_capture WHERE pair = ?').all(token.pair_address) : [],
  }
  return gzipSync(JSON.stringify(record))
}

export function readFullRecord(data: Buffer) {
  return JSON.parse(gunzipSync(data).toString('utf8')) as Record<string, unknown>
}

/** Wallets that held a real stake (or bought $150+) in a coin, kept per coin so wallet records survive the raw holder rows. */
function archiveWallets(database: TrackerDatabase, mint: string) {
  const insert = database.prepare('INSERT INTO wallet_archive (wallet, mint, pct, at) VALUES (?, ?, ?, ?) ON CONFLICT (wallet, mint) DO UPDATE SET pct = MAX(wallet_archive.pct, excluded.pct), at = MIN(wallet_archive.at, excluded.at)')
  let saved = 0
  for (const row of database.prepare('SELECT wallet, pct, updated_at AS at FROM holders WHERE mint = ? AND pct >= ?').all(mint, minimumStakePct) as Array<{ wallet: string; pct: number; at: number }>) { insert.run(row.wallet, mint, row.pct, row.at); saved += 1 }
  if (tableExists(database, 'radar_burst_wallets') && tableExists(database, 'radar_bursts')) {
    for (const row of database.prepare('SELECT w.wallet, w.pct, b.started_at AS at FROM radar_burst_wallets w JOIN radar_bursts b ON b.id = w.burst_id WHERE w.mint = ? AND w.pct >= ?').all(mint, minimumStakePct) as Array<{ wallet: string; pct: number; at: number }>) { insert.run(row.wallet, mint, row.pct, row.at); saved += 1 }
  }
  if (tableExists(database, 'coin_trades')) {
    for (const row of database.prepare("SELECT wallet, SUM(usd) AS usd, MIN(at) AS at FROM coin_trades WHERE mint = ? AND kind = 'buy' GROUP BY wallet").all(mint) as Array<{ wallet: string; usd: number; at: number }>) {
      const sighting = buySighting({ wallet: row.wallet, mint, usd: row.usd, at: row.at })
      if (sighting) { insert.run(sighting.wallet, mint, sighting.pct, sighting.at); saved += 1 }
    }
  }
  return saved
}

function pendingMints(database: TrackerDatabase, now: number, everything: boolean, limit: number) {
  const mints = new Set<string>()
  if (tableExists(database, 'coin_lifecycles')) {
    const closed = everything ? '' : "AND l.outcome != 'open'"
    for (const row of database.prepare(`SELECT l.mint FROM coin_lifecycles l LEFT JOIN coin_archive a ON a.mint = l.mint WHERE a.mint IS NULL ${closed} LIMIT ?`).all(limit) as Array<{ mint: string }>) mints.add(row.mint)
  }
  if (mints.size < limit) {
    const lifecycles = tableExists(database, 'coin_lifecycles') ? 'LEFT JOIN coin_lifecycles l ON l.mint = t.mint' : ''
    const unpriced = tableExists(database, 'coin_lifecycles') ? 'AND l.mint IS NULL' : ''
    for (const row of database.prepare(`SELECT t.mint FROM tokens t ${lifecycles} LEFT JOIN coin_archive a ON a.mint = t.mint WHERE a.mint IS NULL ${unpriced} AND t.last_seen_at < ? LIMIT ?`).all(everything ? now + 1 : now - unpricedAfterMs, limit - mints.size) as Array<{ mint: string }>) mints.add(row.mint)
  }
  return [...mints]
}

function fullCutoff(database: TrackerDatabase) {
  const row = database.prepare('SELECT outcome_score FROM coin_archive_full ORDER BY outcome_score DESC LIMIT 1 OFFSET ?').get(fullCoins - 1) as { outcome_score: number } | undefined
  return row?.outcome_score ?? -1
}

/** Summarizes finished coins (or, with `everything`, every coin the tracker holds) into the archive. Returns how many were added. */
export function archiveCoins(database: TrackerDatabase, now: number, options: { everything?: boolean; limit?: number } = {}) {
  prepareArchive(database)
  const insert = database.prepare(`INSERT OR REPLACE INTO coin_archive (mint, symbol, launched_at, first_seen_at, closed_at, outcome, rug_kind, class, first_mcap, peak_mcap, peak_mcap_at, last_mcap, peak_multiple, minutes_to_peak, life_minutes,
    max_liquidity, peak_volume_5m, peak_viewers, holders_peak, unique_buyers, buy_usd, sell_usd, up_share, volume_to_mcap, data_points, data_minutes, data_weight, outcome_score, tier, features_json, traits_json, shape_json, raw_dropped, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, ?)`)
  const saveFull = database.prepare('INSERT OR REPLACE INTO coin_archive_full (mint, outcome_score, saved_at, data) VALUES (?, ?, ?, ?)')
  let added = 0
  let garbage = 0
  for (;;) {
    const mints = pendingMints(database, now, Boolean(options.everything), options.limit ?? batchSize)
    if (mints.length === 0) break
    database.transaction(() => {
      for (const mint of mints) {
        const summary = summarizeCoin(database, mint, now)
        if (!summary) {
          insert.run(mint, '???', null, null, now, 'empty', null, 'garbage', null, null, null, null, 1, null, 0, null, null, null, null, null, null, null, null, null, 0, 0, 0, 0, '{}', null, null, now)
          garbage += 1
          continue
        }
        insert.run(mint, summary.symbol, summary.launchedAt, summary.firstSeenAt, summary.closedAt, summary.outcome, summary.rugKind, summary.cls, summary.firstMcap, summary.peakMcap, summary.peakMcapAt, summary.lastMcap, summary.peakMultiple, summary.minutesToPeak, summary.lifeMinutes,
          summary.maxLiquidity, summary.peakVolume5m, summary.peakViewers, summary.holdersPeak, summary.uniqueBuyers, summary.buyUsd, summary.sellUsd, summary.upShare, summary.volumeToMcap, summary.dataPoints, summary.dataMinutes, summary.dataWeight, summary.outcomeScore,
          JSON.stringify(summary.features), summary.traits, summary.shape ? JSON.stringify(summary.shape) : null, now)
        archiveWallets(database, mint)
        if (skipFull.has(summary.cls)) garbage += 1
        else if (summary.outcomeScore > fullCutoff(database)) saveFull.run(mint, summary.outcomeScore, now, fullRecord(database, mint))
        added += 1
      }
      database.prepare('DELETE FROM coin_archive_full WHERE mint NOT IN (SELECT mint FROM coin_archive_full ORDER BY outcome_score DESC LIMIT ?)').run(fullCoins)
    })()
    if (mints.length < (options.limit ?? batchSize)) break
  }
  return { added, garbage }
}

/** Re-ranks every archived coin into its tier and rebuilds the 20 tier profiles the live match uses. */
export function rankTiers(database: TrackerDatabase, now: number) {
  prepareArchive(database)
  const rows = database.prepare('SELECT mint, outcome_score AS score, data_weight AS weight, features_json, tier FROM coin_archive').all() as Array<{ mint: string; score: number; weight: number; features_json: string; tier: number | null }>
  const tiers = assignTiers(rows)
  const update = database.prepare('UPDATE coin_archive SET tier = ? WHERE mint = ?')
  const ranked = rows.map(row => ({ tier: tiers.get(row.mint) ?? tierCount, score: row.score, weight: row.weight, features: JSON.parse(row.features_json) as FeatureValues }))
  const ladder = buildLadder(ranked)
  database.transaction(() => {
    for (const row of rows) {
      const tier = tiers.get(row.mint) ?? tierCount
      if (tier !== row.tier) update.run(tier, row.mint)
    }
    database.exec('DELETE FROM coin_tiers')
    const insert = database.prepare('INSERT INTO coin_tiers (tier, coins, weight, min_score, max_score, profile_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const profile of ladder.profiles) insert.run(profile.tier, profile.coins, profile.weight, profile.minScore, profile.maxScore, JSON.stringify(profile.stats), now)
  })()
  archiveState.ladder = ladder
  archiveState.coins = rows.length
  archiveState.full = (database.prepare('SELECT COUNT(*) AS count FROM coin_archive_full').get() as { count: number }).count
  archiveState.rankedAt = now
  return ladder
}

export function usedBytes(database: TrackerDatabase) {
  const pageSize = Number(database.pragma('page_size', { simple: true }))
  const pages = Number(database.pragma('page_count', { simple: true }))
  const free = Number(database.pragma('freelist_count', { simple: true }))
  return (pages - free) * pageSize
}

/** Drops the raw chart, readings and trades of archived coins, oldest first, until the database holds under `cap` bytes. Their summaries stay. */
export function enforceSizeCap(database: TrackerDatabase, cap = capBytes) {
  let coins = 0
  const select = database.prepare('SELECT mint FROM coin_archive WHERE raw_dropped = 0 ORDER BY archived_at ASC LIMIT 100')
  const mark = database.prepare('UPDATE coin_archive SET raw_dropped = 1 WHERE mint = ?')
  const drops = ['snapshots', 'coin_readings', 'coin_trades'].filter(table => tableExists(database, table)).map(table => database.prepare(`DELETE FROM ${table} WHERE mint = ?`))
  while (usedBytes(database) > cap) {
    const mints = select.all() as Array<{ mint: string }>
    if (mints.length === 0) break
    database.transaction(() => {
      for (const { mint } of mints) {
        for (const drop of drops) drop.run(mint)
        mark.run(mint)
      }
    })()
    coins += mints.length
  }
  return coins
}

function describe() {
  const ready = archiveState.ladder && archiveState.coins >= 200 ? '20 tiers ready' : `tiers need 200 coins`
  return `${archiveState.coins} coins archived, ${archiveState.full} kept in full, ${ready}`
}

export function startCoinArchive(database: TrackerDatabase, signal: AbortSignal) {
  prepareArchive(database)
  rankTiers(database, Date.now())
  recordHeartbeat(database, 'coin-archive', 'ok', describe())
  return runLoop('coin-archive', cycleMs, async () => {
    const now = Date.now()
    const { added, garbage } = archiveCoins(database, now)
    if (added > 0 || now - archiveState.rankedAt >= rankEveryMs) rankTiers(database, now)
    const trimmed = enforceSizeCap(database)
    if (added || trimmed) logger.info('Archived finished coins', { added, garbage, trimmed })
    recordHeartbeat(database, 'coin-archive', 'ok', `${describe()}${trimmed ? `; dropped raw rows of ${trimmed} archived coins to stay under the size cap` : ''}`)
  }, logger, signal)
}

/** Tables the fresh start never clears: settings, bookkeeping and the archive itself. */
const keptTables = new Set<string>(['worker_heartbeat', 'tracker_migrations', 'research_meta', 'axiom_watchlist', 'sqlite_sequence', ...archiveTables])

/**
 * Archives every coin the tracker holds (finished or not), ranks the tiers, then empties every working table so tracking starts
 * from fresh coins. The archive, settings and heartbeats stay. Run only while the tracker is stopped.
 */
export function freshStart(database: TrackerDatabase, now = Date.now()) {
  const archived = archiveCoins(database, now, { everything: true })
  const ladder = rankTiers(database, now)
  const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(row => row.name).filter(name => !keptTables.has(name))
  const cleared: Record<string, number> = {}
  database.transaction(() => {
    for (const table of tables) cleared[table] = database.prepare(`DELETE FROM "${table}"`).run().changes
  })()
  initializeTrackerSchema(database)
  markResearchReset(database, now)
  return { archived, tiers: ladder.profiles.length, coins: ladder.coins, full: archiveState.full, cleared }
}
