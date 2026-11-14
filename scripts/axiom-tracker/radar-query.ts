import type { RadarComponentStatus, RadarHistoryPoint, RadarModelState, RadarPaperTrade, RadarPayload, RadarSocials, RadarToken, RadarTokenDetail, RadarWallet, RadarWalletEntry, RadarWeights } from '../../src/lib/axiom-radar-types.js'
import type { RadarSettings } from '../../src/lib/axiom-radar-settings.js'
import { marketTicks, tickAt, type MarketTick } from './live-market.js'
import { assessQuality } from './pulse-cards.js'
import { radarSettings } from './settings-store.js'
import { trackerState } from './state.js'
import type { TrackerDatabase } from './db.js'
import { defaultWeights, radarThresholds, safetyLevel, scoreSetup, viewerDeltas } from './model.js'

const detailWindowMs = 6 * 60 * 60 * 1000
const activeWindowMs = 90_000
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
  const counts = new Map<string, number>()
  if (!mints.length) return counts
  const minHits = radarSettings().wallets.minRunnerHits
  const list = JSON.stringify(mints)
  const buyers = database.prepare(`
    SELECT we.mint, COUNT(*) AS count FROM wallet_entries we
    JOIN smart_wallets sw ON sw.wallet = we.wallet
    WHERE sw.runner_hits >= ? AND we.mint IN (SELECT value FROM json_each(?))
    GROUP BY we.mint
  `).all(minHits, list) as Array<{ mint: string; count: number }>
  const holders = database.prepare(`
    SELECT h.mint, COUNT(*) AS count FROM holders h
    WHERE h.mint IN (SELECT value FROM json_each(?))
      AND (SELECT COUNT(*) FROM holders other JOIN good_coins g ON g.mint = other.mint WHERE other.wallet = h.wallet AND other.mint <> h.mint) >= ?
    GROUP BY h.mint
  `).all(list, minHits) as Array<{ mint: string; count: number }>
  for (const row of [...buyers, ...holders]) counts.set(row.mint, (counts.get(row.mint) ?? 0) + row.count)
  return counts
}

function toHistory(rows: SnapshotRow[]): RadarHistoryPoint[] {
  return rows.map(row => ({ t: row.timestamp, viewers: row.viewers, marketCap: row.market_cap, priceUsd: row.price_usd }))
}

function percentChange(current: number | null, previous: number | null) {
  return current !== null && previous !== null && previous > 0 ? Math.round(((current - previous) / previous) * 10_000) / 100 : null
}

function viewerGainPerMinute(ticks: MarketTick[], viewers: number | null, now: number) {
  if (viewers === null) return null
  const minuteAgo = tickAt(ticks, now - 60_000, 8_000, 'viewers')
  if (minuteAgo !== null) return viewers - minuteAgo
  const earliest = ticks.find(tick => tick.viewers !== null && now - tick.t <= 60_000)
  if (!earliest || earliest.viewers === null || now - earliest.t < 20_000) return null
  return Math.round(((viewers - earliest.viewers) * 60_000) / (now - earliest.t))
}

function liveFigures(mint: string, now: number) {
  const ticks = marketTicks.get(mint) ?? []
  const latest = ticks.at(-1)
  const price = latest?.price ?? null
  const viewer = trackerState.viewers.get(mint)
  const viewers = viewer && now - viewer.at < 60_000 ? viewer.count : null
  const card = trackerState.pulseCards.get(mint)
  const pulse = card && now - card.seenAt < 120_000 ? card : null
  const minuteAgo = tickAt(ticks, now - 60_000, 8_000, 'viewers')
  const fiveMinutesAgo = tickAt(ticks, now - 300_000, 25_000, 'viewers')
  const holdersBefore = tickAt(ticks, now - 300_000, 40_000, 'holders')
  return {
    price,
    viewers,
    pulse,
    market: trackerState.market.get(mint) ?? null,
    priceChange: {
      s30: percentChange(price, tickAt(ticks, now - 30_000, 4_000, 'price')),
      m1: percentChange(price, tickAt(ticks, now - 60_000, 6_000, 'price')),
      m5: percentChange(price, tickAt(ticks, now - 300_000, 20_000, 'price')),
      m10: percentChange(price, tickAt(ticks, now - 600_000, 30_000, 'price')),
    },
    liquidityChange1m: percentChange(latest?.liquidity ?? null, tickAt(ticks, now - 60_000, 6_000, 'liquidity')),
    viewersPerMin: viewerGainPerMinute(ticks, viewers, now),
    viewersDelta1m: viewers !== null && minuteAgo !== null ? viewers - minuteAgo : null,
    viewersDelta5m: viewers !== null && fiveMinutesAgo !== null ? viewers - fiveMinutesAgo : null,
    holdersChange5m: pulse?.holders !== null && pulse?.holders !== undefined && holdersBefore !== null ? pulse.holders - holdersBefore : null,
  }
}

const sparkPrice = (price: number) => Number(price.toPrecision(6))

/** Price series for chart previews: `fast` is one point a second for the last minute, `slow` one every 5 seconds for 10 minutes. */
function sparkSeries(ticks: MarketTick[], now: number) {
  const fast: number[] = []
  const slow: number[] = []
  let bucket = -1
  for (const tick of ticks) {
    if (tick.price === null) continue
    if (now - tick.t <= 60_000) fast.push(sparkPrice(tick.price))
    const current = Math.floor(tick.t / 5_000)
    if (current === bucket) slow[slow.length - 1] = sparkPrice(tick.price)
    else { slow.push(sparkPrice(tick.price)); bucket = current }
  }
  return { fast: fast.slice(-60), slow: slow.slice(-120) }
}

type BuiltToken = { token: RadarToken; liquidityChange1m: number | null }

const surgeLevels = { 1: { gain: 8, percent: 15, sigma: 2 }, 2: { gain: 5, percent: 10, sigma: 1.5 }, 3: { gain: 3, percent: 6, sigma: 1 } } as const

function classify(token: RadarToken, settings: RadarSettings, liquidityChange1m: number | null) {
  const alerts: string[] = []
  if (liquidityChange1m !== null && liquidityChange1m <= -30) alerts.push(`Liquidity fell ${Math.abs(liquidityChange1m).toFixed(0)}% in 1m`)
  if (token.priceChange.s30 !== null && token.priceChange.s30 <= -20) alerts.push(`Price dumped ${Math.abs(token.priceChange.s30).toFixed(0)}% in 30s`)
  if (token.safety.mintAuthority) alerts.push('Mint authority still enabled')
  if (token.safety.freezeAuthority) alerts.push('Freeze authority still enabled')
  const redFlags = token.quality.checks.filter(check => check.status === 'fail').map(check => check.label)
  const buyRules = settings.buy
  const buyChecks: Array<[boolean, string]> = [
    [token.score >= buyRules.minScore, `Score ${token.score} (need ${buyRules.minScore})`],
    [(token.priceChange.m1 ?? -Infinity) >= buyRules.minGain1mPercent, `Up ${token.priceChange.m1?.toFixed(1)}% in 1m`],
    [(token.priceChange.m5 ?? -Infinity) >= buyRules.minGain5mPercent, `Up ${token.priceChange.m5?.toFixed(1)}% in 5m`],
    [(token.viewers ?? 0) >= buyRules.minViewers, `${token.viewers ?? 0} watching on Axiom`],
  ]
  if (buyRules.requireSafe) buyChecks.push([redFlags.length === 0 && token.safety.level !== 'risky', 'No red flags'])
  if (!alerts.length && buyChecks.every(([passed]) => passed)) {
    const reasons = buyChecks.map(([, reason]) => reason)
    if (token.viewerSurge) reasons.push('Gaining viewers quickly')
    return { signal: 'buy' as const, reasons, alerts }
  }
  const watchReasons: string[] = []
  if (token.viewerSurge) watchReasons.push(`Gaining viewers quickly (+${token.viewersPerMin}/min)`)
  if (token.score >= settings.watch.minScore) watchReasons.push(`Score ${token.score}`)
  if ((token.priceChange.m5 ?? -Infinity) >= settings.watch.minGain5mPercent) watchReasons.push(`Up ${token.priceChange.m5?.toFixed(1)}% in 5m`)
  if (token.runnerWallets > 0) watchReasons.push(`${token.runnerWallets} smart holder${token.runnerWallets === 1 ? '' : 's'}`)
  if (!watchReasons.length) return { signal: null, reasons: [] as string[], alerts }
  if (redFlags.length) watchReasons.push(`Red flags: ${redFlags.join(', ')}`)
  if (alerts.length) watchReasons.push('Has warnings: check before buying')
  return { signal: 'watch' as const, reasons: watchReasons, alerts }
}

function finalize(entries: BuiltToken[], settings: RadarSettings) {
  const level = surgeLevels[settings.surgeSensitivity]
  const gains = entries.map(entry => entry.token.viewersPerMin).filter((gain): gain is number => gain !== null)
  const mean = gains.length ? gains.reduce((total, gain) => total + gain, 0) / gains.length : 0
  const deviation = gains.length ? Math.sqrt(gains.reduce((total, gain) => total + (gain - mean) ** 2, 0) / gains.length) : 0
  for (const { token, liquidityChange1m } of entries) {
    const gain = token.viewersPerMin
    if (gain !== null && gain >= level.gain) {
      const before = Math.max(1, (token.viewers ?? 0) - gain)
      const outlier = gains.length >= 5 && gain >= mean + level.sigma * deviation && gain >= level.gain * 2
      token.viewerSurge = (gain / before) * 100 >= level.percent || outlier
    }
    const verdict = classify(token, settings, liquidityChange1m)
    token.signal = verdict.signal
    token.signalReasons = verdict.reasons
    token.alerts = verdict.alerts
  }
  const tokens = entries.map(entry => entry.token)
  tokens.filter(token => token.viewers !== null).sort((first, second) => (second.viewers ?? 0) - (first.viewers ?? 0)).forEach((token, index) => { token.viewerRank = index + 1 })
  return tokens
}

function buildToken(token: TokenRow, snapshots: SnapshotRow[], fallback: SnapshotRow | undefined, runners: number, weights: RadarWeights, now: number, settings: RadarSettings): BuiltToken {
  const latest = snapshots.at(-1) ?? fallback
  const live = liveFigures(token.mint, now)
  const stored = viewerDeltas(snapshots, now)
  const viewers = live.viewers ?? stored.viewers
  const delta1m = live.viewers !== null ? live.viewersDelta1m : stored.delta1m
  const delta5m = live.viewers !== null ? live.viewersDelta5m ?? stored.delta5m : stored.delta5m
  const pct5m = delta5m !== null && viewers !== null && viewers - delta5m > 0 ? Math.round((delta5m / (viewers - delta5m)) * 1000) / 10 : stored.pct5m
  const safety = { rugScore: token.rug_score, mintAuthority: flag(token.mint_auth), freezeAuthority: flag(token.freeze_auth), top10Pct: token.top10_pct }
  const buys = live.market?.buys5m ?? latest?.buys_5m ?? null
  const sells = live.market?.sells5m ?? latest?.sells_5m ?? null
  const marketCap = live.market?.marketCap ?? latest?.market_cap ?? null
  const quality = assessQuality({ pulse: live.pulse, marketCap, rugTop10Pct: token.top10_pct, mintAuthority: safety.mintAuthority, freezeAuthority: safety.freezeAuthority })
  const { score, factors } = scoreSetup({ ...safety, viewers, viewersDelta5m: delta5m, viewersPerMin: live.viewersPerMin, quality: quality.score, runnerWallets: runners, buys5m: buys, sells5m: sells }, weights)
  const transactions = (buys ?? 0) + (sells ?? 0)
  const built: RadarToken = {
    mint: token.mint,
    pairAddress: token.pair_address,
    symbol: token.symbol,
    name: token.name,
    imageUrl: token.image_url,
    pairCreatedAt: token.pair_created_at,
    ageMinutes: Math.max(0, Math.round((now - token.pair_created_at) / 60_000)),
    socials: parseSocials(token.socials_json),
    isBoosted: token.is_boosted === 1,
    viewers,
    viewersDelta1m: delta1m,
    viewersDelta5m: delta5m,
    viewersPct5m: pct5m,
    history: toHistory(snapshots.filter(row => row.timestamp >= now - 15 * 60_000)),
    runnerWallets: runners,
    priceUsd: live.price ?? latest?.price_usd ?? null,
    marketCap,
    liquidityUsd: live.market?.liquidityUsd ?? latest?.liquidity_usd ?? null,
    volume5m: live.market?.volume5m ?? latest?.volume_5m ?? null,
    buys5m: buys,
    sells5m: sells,
    buyRatio: transactions ? (buys ?? 0) / transactions : null,
    safety: { level: safetyLevel(safety), ...safety },
    score,
    factors,
    lastSnapshotAt: live.market?.readAt ?? latest?.timestamp ?? null,
    priceChange: live.priceChange,
    spark: sparkSeries(marketTicks.get(token.mint) ?? [], now),
    viewersPerMin: live.viewersPerMin,
    viewerSurge: false,
    holdersChange5m: live.holdersChange5m,
    pulse: live.pulse,
    quality,
    viewerRank: null,
    signal: null,
    signalReasons: [],
    alerts: [],
    pinned: settings.pinned.includes(token.mint),
    onPulse: trackerState.pulse.has(token.mint),
  }
  return { token: built, liquidityChange1m: live.liquidityChange1m }
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
  const tokens = database.prepare('SELECT * FROM tokens WHERE last_seen_at >= ?').all(now - activeWindowMs) as TokenRow[]
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
  const fallbacks = latestSnapshots(database, mints.filter(mint => !byMint.has(mint)))
  const runners = runnerCounts(database, mints)
  const settings = radarSettings()
  const entries = tokens.map(token => buildToken(token, byMint.get(token.mint) ?? [], fallbacks.get(token.mint), runners.get(token.mint) ?? 0, weights, now, settings))
  return finalize(entries, settings).sort((first, second) => Number(second.pinned) - Number(first.pinned) || (second.viewers ?? -1) - (first.viewers ?? -1) || second.score - first.score)
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

function smartWallets(database: TrackerDatabase, minRunnerHits: number): RadarWallet[] {
  const holders = database.prepare(`
    SELECT h.wallet, COUNT(*) AS runnerHits, MAX(h.updated_at) AS updatedAt FROM holders h
    JOIN good_coins g ON g.mint = h.mint GROUP BY h.wallet HAVING COUNT(*) >= ?
    ORDER BY runnerHits DESC, updatedAt DESC LIMIT 40
  `).all(minRunnerHits) as Array<{ wallet: string; runnerHits: number; updatedAt: number }>
  const holdings = database.prepare(`
    SELECT h.mint, COALESCE(t.symbol, g.symbol, '???') AS symbol, h.pct, g.mint IS NOT NULL AS good, h.updated_at AS timestamp FROM holders h
    LEFT JOIN tokens t ON t.mint = h.mint LEFT JOIN good_coins g ON g.mint = h.mint
    WHERE h.wallet = ? ORDER BY good DESC, h.updated_at DESC LIMIT 8
  `)
  const buyers = database.prepare('SELECT wallet, runner_hits AS runnerHits, updated_at AS updatedAt FROM smart_wallets WHERE runner_hits >= ? ORDER BY runner_hits DESC, updated_at DESC LIMIT 20').all(minRunnerHits) as Array<{ wallet: string; runnerHits: number; updatedAt: number }>
  const entries = database.prepare(`
    SELECT we.mint, COALESCE(t.symbol, '???') AS symbol, we.timestamp FROM wallet_entries we
    LEFT JOIN tokens t ON t.mint = we.mint WHERE we.wallet = ? ORDER BY we.timestamp DESC LIMIT 8
  `)
  return [
    ...holders.map(wallet => ({ ...wallet, source: 'holder' as const, entries: (holdings.all(wallet.wallet) as Array<{ mint: string; symbol: string; pct: number | null; good: number; timestamp: number }>).map(entry => ({ ...entry, good: entry.good === 1 })) })),
    ...buyers.map(wallet => ({ ...wallet, source: 'early-buyer' as const, entries: (entries.all(wallet.wallet) as Array<{ mint: string; symbol: string; timestamp: number }>).map(entry => ({ ...entry, pct: null, good: false })) })),
  ]
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
    WHERE sw.runner_hits >= ? AND we.timestamp >= ?
  `).get(radarSettings().wallets.minRunnerHits, now - 60 * 60_000) as { count: number }).count
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
    settings: radarSettings(),
    wallets: smartWallets(database, radarSettings().wallets.minRunnerHits),
    walletTracking: process.env.HELIUS_API_KEY?.trim() ? 'on' : 'no-key',
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
  const settings = radarSettings()
  const all = database.prepare('SELECT mint, viewers, price_usd, market_cap, liquidity_usd, volume_5m, buys_5m, sells_5m, timestamp FROM snapshots WHERE mint = ? AND timestamp >= ? ORDER BY timestamp ASC').all(mint, now - detailWindowMs) as SnapshotRow[]
  const recent = all.filter(row => row.timestamp >= now - historyWindowMs)
  const runners = runnerCounts(database, [mint]).get(mint) ?? 0
  const buyers = database.prepare(`
    SELECT we.wallet, sw.runner_hits AS runnerHits, we.entry_mcap AS entryMcap, we.timestamp FROM wallet_entries we
    JOIN smart_wallets sw ON sw.wallet = we.wallet WHERE we.mint = ? ORDER BY we.timestamp ASC
  `).all(mint) as RadarWalletEntry[]
  const holders = database.prepare(`
    SELECT * FROM (
      SELECT h.wallet, (SELECT COUNT(*) FROM holders other JOIN good_coins g ON g.mint = other.mint WHERE other.wallet = h.wallet AND other.mint <> h.mint) AS runnerHits,
        NULL AS entryMcap, h.pct, h.updated_at AS timestamp FROM holders h WHERE h.mint = ?
    ) WHERE runnerHits >= ? ORDER BY runnerHits DESC LIMIT 20
  `).all(mint, settings.wallets.minRunnerHits) as RadarWalletEntry[]
  const [built] = finalize([buildToken(token, recent, all.at(-1), runners, model.weights, now, settings)], settings)
  return {
    token: built,
    history: toHistory(downsample(all, 360)),
    live: (marketTicks.get(mint) ?? []).map(tick => ({ t: tick.t, price: tick.price, viewers: tick.viewers })),
    entries: [...holders, ...buyers],
  }
}

export { radarThresholds }
