import type { RadarComponentStatus, RadarHistoryPoint, RadarModelState, RadarPaperTrade, RadarPayload, RadarSocials, RadarToken, RadarTokenDetail, RadarWalletEntry, RadarWeights } from '../../src/lib/axiom-radar-types.js'
import type { TrackerDatabase } from './db.js'
import { defaultWeights, radarThresholds, safetyLevel, scoreSetup, viewerDeltas } from './model.js'

const maxPairAgeMs = 5 * 60 * 60 * 1000
const activeWindowMs = 5 * 60_000
const historyWindowMs = 16 * 60_000

type TokenRow = {
  mint: string
  pair_address: string
  symbol: string
  name: string
  image_url: string | null
  pair_created_at: number
  socials_json: string
  rug_score: number | null
  mint_auth: number | null
  freeze_auth: number | null
  top10_pct: number | null
  is_boosted: number
}

type SnapshotRow = {
  mint: string
  viewers: number | null
  price_usd: number | null
  market_cap: number | null
  liquidity_usd: number | null
  volume_5m: number | null
  buys_5m: number | null
  sells_5m: number | null
  timestamp: number
}

type WeightsRow = {
  w_viewer_velocity: number
  w_active_viewers: number
  w_runner_wallets: number
  w_buy_pressure: number
  w_safety: number
  win_rate: number | null
  sample_count: number
  updated_at: number
}

type PaperRow = {
  id: number
  mint: string
  symbol: string
  entry_price: number
  entry_mcap: number | null
  setup_score: number
  price_5m: number | null
  price_15m: number | null
  price_30m: number | null
  status: 'open' | 'win' | 'loss'
  created_at: number
}

const flag = (value: number | null) => value === null ? null : value === 1

function weightsFromRow(row: WeightsRow | undefined): RadarWeights {
  if (!row) return { ...defaultWeights }
  return { viewerVelocity: row.w_viewer_velocity, activeViewers: row.w_active_viewers, runnerWallets: row.w_runner_wallets, buyPressure: row.w_buy_pressure, safety: row.w_safety }
}

function parseSocials(value: string): RadarSocials {
  try {
    const parsed = JSON.parse(value) as Partial<RadarSocials>
    return { twitter: parsed.twitter ?? null, telegram: parsed.telegram ?? null, website: parsed.website ?? null }
  } catch {
    return { twitter: null, telegram: null, website: null }
  }
}

export function loadModelState(database: TrackerDatabase): RadarModelState {
  const rows = database.prepare('SELECT * FROM model_weights ORDER BY id DESC LIMIT 40').all() as WeightsRow[]
  const latest = rows[0]
  return {
    weights: weightsFromRow(latest),
    winRate: latest?.win_rate ?? null,
    sampleCount: latest?.sample_count ?? 0,
    updatedAt: latest?.updated_at ?? null,
    history: rows.slice().reverse().map(row => ({ updatedAt: row.updated_at, winRate: row.win_rate, sampleCount: row.sample_count, ...weightsFromRow(row) })),
  }
}

function runnerCounts(database: TrackerDatabase, mints: string[]) {
  if (!mints.length) return new Map<string, number>()
  const rows = database.prepare(`
    SELECT we.mint, COUNT(*) AS count FROM wallet_entries we
    JOIN smart_wallets sw ON sw.wallet = we.wallet
    WHERE sw.runner_hits >= 2 AND we.mint IN (SELECT value FROM json_each(?))
    GROUP BY we.mint
  `).all(JSON.stringify(mints)) as Array<{ mint: string; count: number }>
  return new Map(rows.map(row => [row.mint, row.count]))
}

function toHistory(rows: SnapshotRow[]): RadarHistoryPoint[] {
  return rows.map(row => ({ t: row.timestamp, viewers: row.viewers, marketCap: row.market_cap, priceUsd: row.price_usd }))
}

function buildToken(token: TokenRow, snapshots: SnapshotRow[], fallback: SnapshotRow | undefined, runners: number, weights: RadarWeights, now: number): RadarToken {
  const latest = snapshots.at(-1) ?? fallback
  const deltas = viewerDeltas(snapshots, now)
  const safety = { rugScore: token.rug_score, mintAuthority: flag(token.mint_auth), freezeAuthority: flag(token.freeze_auth), top10Pct: token.top10_pct }
  const buys = latest?.buys_5m ?? null
  const sells = latest?.sells_5m ?? null
  const { score, factors } = scoreSetup({ ...safety, viewers: deltas.viewers, viewersDelta5m: deltas.delta5m, runnerWallets: runners, buys5m: buys, sells5m: sells }, weights)
  const transactions = (buys ?? 0) + (sells ?? 0)
  return {
    mint: token.mint,
    pairAddress: token.pair_address,
    symbol: token.symbol,
    name: token.name,
    imageUrl: token.image_url,
    pairCreatedAt: token.pair_created_at,
    ageMinutes: Math.max(0, Math.round((now - token.pair_created_at) / 60_000)),
    socials: parseSocials(token.socials_json),
    isBoosted: token.is_boosted === 1,
    viewers: deltas.viewers,
    viewersDelta1m: deltas.delta1m,
    viewersDelta5m: deltas.delta5m,
    viewersPct5m: deltas.pct5m,
    history: toHistory(snapshots.filter(row => row.timestamp >= now - 15 * 60_000)),
    runnerWallets: runners,
    priceUsd: latest?.price_usd ?? null,
    marketCap: latest?.market_cap ?? null,
    liquidityUsd: latest?.liquidity_usd ?? null,
    volume5m: latest?.volume_5m ?? null,
    buys5m: buys,
    sells5m: sells,
    buyRatio: transactions ? (buys ?? 0) / transactions : null,
    safety: { level: safetyLevel(safety), ...safety },
    score,
    factors,
    lastSnapshotAt: latest?.timestamp ?? null,
  }
}

function latestSnapshots(database: TrackerDatabase, mints: string[]) {
  if (!mints.length) return new Map<string, SnapshotRow>()
  const rows = database.prepare(`
    SELECT s.* FROM snapshots s
    JOIN (SELECT mint, MAX(timestamp) AS latest FROM snapshots WHERE mint IN (SELECT value FROM json_each(?)) GROUP BY mint) m
      ON m.mint = s.mint AND m.latest = s.timestamp
  `).all(JSON.stringify(mints)) as SnapshotRow[]
  return new Map(rows.map(row => [row.mint, row]))
}

export function buildRadarTokens(database: TrackerDatabase, weights: RadarWeights, now = Date.now()): RadarToken[] {
  const tokens = database.prepare('SELECT * FROM tokens WHERE pair_created_at >= ? AND last_seen_at >= ?').all(now - maxPairAgeMs, now - activeWindowMs) as TokenRow[]
  if (!tokens.length) return []
  const mints = tokens.map(token => token.mint)
  const snapshotRows = database.prepare(`
    SELECT mint, viewers, price_usd, market_cap, liquidity_usd, volume_5m, buys_5m, sells_5m, timestamp FROM snapshots
    WHERE timestamp >= ? AND mint IN (SELECT value FROM json_each(?)) ORDER BY timestamp ASC
  `).all(now - historyWindowMs, JSON.stringify(mints)) as SnapshotRow[]
  const byMint = new Map<string, SnapshotRow[]>()
  for (const row of snapshotRows) {
    const list = byMint.get(row.mint) ?? []
    list.push(row)
    byMint.set(row.mint, list)
  }
  const missing = mints.filter(mint => !byMint.has(mint))
  const fallbacks = latestSnapshots(database, missing)
  const runners = runnerCounts(database, mints)
  return tokens
    .map(token => buildToken(token, byMint.get(token.mint) ?? [], fallbacks.get(token.mint), runners.get(token.mint) ?? 0, weights, now))
    .sort((first, second) => second.score - first.score || (second.volume5m ?? 0) - (first.volume5m ?? 0))
}

const returnOf = (price: number | null, entry: number) => price === null || entry <= 0 ? null : price / entry - 1

function paperTrades(database: TrackerDatabase) {
  const rows = database.prepare('SELECT id, mint, symbol, entry_price, entry_mcap, setup_score, price_5m, price_15m, price_30m, status, created_at FROM paper_trades ORDER BY created_at DESC LIMIT 200').all() as PaperRow[]
  const trades: RadarPaperTrade[] = rows.map(row => ({
    id: row.id,
    mint: row.mint,
    symbol: row.symbol,
    entryPrice: row.entry_price,
    entryMcap: row.entry_mcap,
    setupScore: row.setup_score,
    return5m: returnOf(row.price_5m, row.entry_price),
    return15m: returnOf(row.price_15m, row.entry_price),
    return30m: returnOf(row.price_30m, row.entry_price),
    status: row.status,
    createdAt: row.created_at,
  }))
  const completed = trades.filter(trade => trade.status !== 'open')
  const wins = completed.filter(trade => trade.status === 'win').length
  const returns = completed.map(trade => trade.return15m).filter((value): value is number => value !== null)
  let cumulative = 0
  const pnl = completed.slice().sort((first, second) => first.createdAt - second.createdAt).map(trade => {
    cumulative += (trade.return15m ?? 0) * 100
    return { t: trade.createdAt, cumulative: Math.round(cumulative * 10) / 10, symbol: trade.symbol }
  })
  return {
    trades: trades.slice(0, 100),
    stats: {
      open: trades.filter(trade => trade.status === 'open').length,
      wins,
      losses: completed.length - wins,
      winRate: completed.length ? wins / completed.length : null,
      averageReturn15m: returns.length ? returns.reduce((total, value) => total + value, 0) / returns.length : null,
    },
    pnl,
  }
}

function componentStatuses(database: TrackerDatabase) {
  return database.prepare('SELECT component, status, detail, updated_at AS updatedAt FROM worker_heartbeat ORDER BY component').all() as RadarComponentStatus[]
}

export function buildRadarPayload(database: TrackerDatabase, now = Date.now()): RadarPayload {
  const model = loadModelState(database)
  const tokens = buildRadarTokens(database, model.weights, now)
  const components = componentStatuses(database)
  const workerSeenAt = components.length ? Math.max(...components.map(component => component.updatedAt)) : null
  const status = workerSeenAt && now - workerSeenAt < 30_000 ? 'live' : workerSeenAt && now - workerSeenAt < 5 * 60_000 ? 'stale' : 'offline'
  const surge = tokens.filter(token => token.viewersDelta5m !== null).sort((first, second) => (second.viewersDelta5m ?? 0) - (first.viewersDelta5m ?? 0))[0]
  const runnerSignals = (database.prepare(`
    SELECT COUNT(*) AS count FROM wallet_entries we JOIN smart_wallets sw ON sw.wallet = we.wallet
    WHERE sw.runner_hits >= 2 AND we.timestamp >= ?
  `).get(now - 60 * 60_000) as { count: number }).count
  const paper = paperTrades(database)
  return {
    status,
    message: status === 'offline' ? 'The Axiom tracker worker has not reported in. Start it with `pnpm axiom:worker` or `pm2 start ecosystem.axiom.config.js`.' : status === 'stale' ? 'The worker last reported more than 30 seconds ago.' : null,
    generatedAt: now,
    workerSeenAt,
    components,
    tokens,
    kpis: {
      tracked: tokens.length,
      fastestSurge: surge && (surge.viewersDelta5m ?? 0) > 0 ? { symbol: surge.symbol, mint: surge.mint, delta: surge.viewersDelta5m ?? 0 } : null,
      runnerSignals,
      winRate: paper.stats.winRate,
      completedTrades: paper.stats.wins + paper.stats.losses,
    },
    model,
    paper,
  }
}

function downsample<T>(items: T[], limit: number) {
  if (items.length <= limit) return items
  const step = items.length / limit
  return Array.from({ length: limit }, (_, index) => items[Math.min(items.length - 1, Math.round(index * step))])
}

export function buildTokenDetail(database: TrackerDatabase, mint: string, now = Date.now()): RadarTokenDetail | null {
  const token = database.prepare('SELECT * FROM tokens WHERE mint = ?').get(mint) as TokenRow | undefined
  if (!token) return null
  const model = loadModelState(database)
  const all = database.prepare('SELECT mint, viewers, price_usd, market_cap, liquidity_usd, volume_5m, buys_5m, sells_5m, timestamp FROM snapshots WHERE mint = ? AND timestamp >= ? ORDER BY timestamp ASC').all(mint, now - maxPairAgeMs - 60 * 60_000) as SnapshotRow[]
  const recent = all.filter(row => row.timestamp >= now - historyWindowMs)
  const runners = runnerCounts(database, [mint]).get(mint) ?? 0
  const entries = database.prepare(`
    SELECT we.wallet, sw.runner_hits AS runnerHits, we.entry_mcap AS entryMcap, we.timestamp FROM wallet_entries we
    JOIN smart_wallets sw ON sw.wallet = we.wallet WHERE we.mint = ? ORDER BY we.timestamp ASC
  `).all(mint) as RadarWalletEntry[]
  return {
    token: buildToken(token, recent, all.at(-1), runners, model.weights, now),
    history: toHistory(downsample(all, 360)),
    entries,
  }
}

export { radarThresholds }
