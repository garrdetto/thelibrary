import type { RadarExplode, RadarExplosionSummary } from '../../src/lib/axiom-radar-learner.js'
import type { RadarToken } from '../../src/lib/axiom-radar-types.js'
import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { learnerState } from './learner-state.js'
import { marketTicks, type MarketTick } from './live-market.js'
import { chanceOf, holdoutAccuracy, median, splitInsights, topReasons, trainClassifier, vectorOf, type Classifier, type FeatureValues } from './logistic.js'
import { buildRadarTokens, loadModelState } from './radar-query.js'
import { researchResetAt } from './research-meta.js'
import { createLogger, runLoop } from './runtime.js'

const logger = createLogger('explosions')
const cycleMs = 2_000
const trainEveryMs = 3 * 60_000
const viewerJump = 20
const viewerWindowMs = 30_000
const buyJump = 30
const buyWindowMs = 60_000
const followMs = 10 * 60_000
const cooldownMs = 15 * 60_000
const explodeViewers = 100
const explodePrice = 2
const minimumSamples = 20
const poolShare = 15
const sharedAccounts = new Set(['5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL', 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM'])

const burstSchema = `
CREATE TABLE IF NOT EXISTS radar_bursts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  start_viewers INTEGER,
  gain INTEGER NOT NULL,
  seconds REAL NOT NULL,
  start_price REAL,
  features_json TEXT NOT NULL,
  peak_viewers INTEGER,
  reached_at INTEGER,
  peak_price REAL,
  outcome TEXT NOT NULL DEFAULT 'open',
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS radar_bursts_mint ON radar_bursts (mint, started_at);
CREATE INDEX IF NOT EXISTS radar_bursts_outcome ON radar_bursts (outcome);
CREATE TABLE IF NOT EXISTS radar_burst_wallets (
  burst_id INTEGER NOT NULL,
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  pct REAL,
  PRIMARY KEY (burst_id, wallet)
);
CREATE INDEX IF NOT EXISTS radar_burst_wallets_wallet ON radar_burst_wallets (wallet);
`

const specs = [
  { key: 'startViewers', label: 'Viewers before the jump', log: true },
  { key: 'viewerGain', label: 'Viewers gained in the jump', log: true },
  { key: 'viewerSpeed', label: 'Viewers gained per second', log: false },
  { key: 'buys5m', label: 'Buys in 5m', log: true },
  { key: 'buysJump', label: 'Extra buys in the last minute', log: true },
  { key: 'buyRatio', label: 'Buy share of trades', log: false },
  { key: 'ageMinutes', label: 'Coin age (minutes)', log: true },
  { key: 'marketCap', label: 'Market cap ($)', log: true },
  { key: 'liquidity', label: 'Liquidity ($)', log: true },
  { key: 'volume5m', label: '5m volume ($)', log: true },
  { key: 'holders', label: 'Holders', log: true },
  { key: 'top10', label: 'Top 10 holding (%)', log: false },
  { key: 'dev', label: 'Dev holding (%)', log: false },
  { key: 'snipers', label: 'Snipers (%)', log: false },
  { key: 'insiders', label: 'Insiders (%)', log: false },
  { key: 'bundlers', label: 'Bundlers (%)', log: false },
  { key: 'smartWallets', label: 'Smart wallets in', log: true },
  { key: 'explosiveWallets', label: 'Wallets seen early in past explosions', log: true },
] as const

type BurstRow = { id: number; mint: string; symbol: string; kind: string; started_at: number; start_viewers: number | null; gain: number; seconds: number; start_price: number | null; features_json: string; peak_viewers: number | null; reached_at: number | null; peak_price: number | null; outcome: string; closed_at: number | null }
type Jump = { viewerGain: number; viewerSeconds: number; startViewers: number | null; buysJump: number }
type Model = { classifier: Classifier; rows: FeatureValues[]; labels: boolean[]; holdout: ReturnType<typeof holdoutAccuracy>; walletCoins: Map<string, Set<string>> }
type HistoryRow = { mint: string; viewers: number | null; price_usd: number | null; market_cap: number | null; liquidity_usd: number | null; volume_5m: number | null; buys_5m: number | null; sells_5m: number | null; timestamp: number }

const viewerTarget = (startViewers: number | null) => Math.max(explodeViewers, (startViewers ?? 0) * 2)
const exploded = (row: Pick<BurstRow, 'start_viewers' | 'peak_viewers' | 'start_price' | 'peak_price'>) =>
  (row.peak_viewers ?? 0) >= viewerTarget(row.start_viewers) || (row.start_price !== null && row.start_price > 0 && (row.peak_price ?? 0) >= row.start_price * explodePrice)

function jumpFrom(ticks: MarketTick[], now: number): Jump {
  let latest: MarketTick | null = null
  let low: MarketTick | null = null
  let buysNow: number | null = null
  let buysBefore: number | null = null
  for (let index = ticks.length - 1; index >= 0; index--) {
    const tick = ticks[index]
    const age = now - tick.t
    if (age > buyWindowMs + 15_000) break
    if (tick.buys !== null) {
      if (buysNow === null && age <= 10_000) buysNow = tick.buys
      if (age >= buyWindowMs - 10_000) buysBefore = tick.buys
    }
    if (tick.viewers === null || age > viewerWindowMs) continue
    if (!latest) { if (age <= 6_000) latest = tick; continue }
    if (!low || tick.viewers <= (low.viewers as number)) low = tick
  }
  const viewerGain = latest && low ? Math.max(0, (latest.viewers as number) - (low.viewers as number)) : 0
  return {
    viewerGain,
    viewerSeconds: latest && low ? Math.max(1, (latest.t - low.t) / 1000) : viewerWindowMs / 1000,
    startViewers: low?.viewers ?? latest?.viewers ?? null,
    buysJump: buysNow !== null && buysBefore !== null ? Math.max(0, buysNow - buysBefore) : 0,
  }
}

function featuresOf(token: RadarToken, jump: Jump, explosiveWallets: number): FeatureValues {
  return {
    startViewers: jump.startViewers ?? token.viewers,
    viewerGain: jump.viewerGain,
    viewerSpeed: jump.viewerGain / jump.viewerSeconds,
    buys5m: token.buys5m,
    buysJump: jump.buysJump,
    buyRatio: token.buyRatio,
    ageMinutes: token.ageMinutes,
    marketCap: token.marketCap,
    liquidity: token.liquidityUsd,
    volume5m: token.volume5m,
    holders: token.pulse?.holders ?? null,
    top10: token.pulse?.top10Pct ?? token.safety.top10Pct,
    dev: token.pulse ? (token.pulse.devSold ? 0 : token.pulse.devPct) : null,
    snipers: token.pulse?.snipersPct ?? null,
    insiders: token.pulse?.insidersPct ?? null,
    bundlers: token.pulse?.bundlersPct ?? null,
    smartWallets: token.runnerWallets,
    explosiveWallets,
  }
}

function loadModel(database: TrackerDatabase): Model {
  const closed = database.prepare("SELECT features_json, outcome FROM radar_bursts WHERE outcome != 'open' ORDER BY started_at ASC").all() as Array<{ features_json: string; outcome: string }>
  const rows = closed.map(row => JSON.parse(row.features_json) as FeatureValues)
  const labels = closed.map(row => row.outcome === 'exploded')
  const walletCoins = new Map<string, Set<string>>()
  const early = database.prepare("SELECT w.wallet, w.mint FROM radar_burst_wallets w JOIN radar_bursts b ON b.id = w.burst_id WHERE b.outcome = 'exploded' AND (w.pct IS NULL OR w.pct < ?)").all(poolShare) as Array<{ wallet: string; mint: string }>
  for (const { wallet, mint } of early) {
    if (sharedAccounts.has(wallet)) continue
    const coins = walletCoins.get(wallet) ?? new Set<string>()
    coins.add(mint)
    walletCoins.set(wallet, coins)
  }
  return { classifier: trainClassifier(specs, rows, labels, minimumSamples), rows, labels, holdout: holdoutAccuracy(specs, rows, labels, minimumSamples), walletCoins }
}

function saveWallets(database: TrackerDatabase, burstId: number, mint: string) {
  database.prepare('INSERT OR IGNORE INTO radar_burst_wallets (burst_id, mint, wallet, pct) SELECT ?, mint, wallet, pct FROM holders WHERE mint = ?').run(burstId, mint)
}

function backfill(database: TrackerDatabase) {
  if ((database.prepare('SELECT COUNT(*) AS count FROM radar_bursts').get() as { count: number }).count || researchResetAt(database)) return 0
  const tokens = new Map((database.prepare('SELECT mint, symbol, pair_created_at FROM tokens').all() as Array<{ mint: string; symbol: string; pair_created_at: number }>).map(token => [token.mint, token]))
  const insert = database.prepare(`INSERT INTO radar_bursts (mint, symbol, kind, started_at, start_viewers, gain, seconds, start_price, features_json, peak_viewers, reached_at, peak_price, outcome, closed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const history = database.prepare('SELECT mint, viewers, price_usd, market_cap, liquidity_usd, volume_5m, buys_5m, sells_5m, timestamp FROM snapshots WHERE mint = ? ORDER BY timestamp ASC')
  const newest = (database.prepare('SELECT MAX(timestamp) AS latest FROM snapshots').get() as { latest: number | null }).latest ?? 0
  let group: HistoryRow[] = []
  let added = 0
  const flush = () => {
    const token = group.length ? tokens.get(group[0].mint) : undefined
    if (!token) return
    let lastBurstAt = 0
    for (let index = 1; index < group.length; index++) {
      const row = group[index]
      if (row.timestamp - lastBurstAt < cooldownMs) continue
      let low: HistoryRow | null = null
      let buysBefore: number | null = null
      for (let back = index - 1; back >= 0 && row.timestamp - group[back].timestamp <= buyWindowMs + 15_000; back--) {
        const earlier = group[back]
        const age = row.timestamp - earlier.timestamp
        if (earlier.viewers !== null && age <= viewerWindowMs + 5_000 && (!low || earlier.viewers <= (low.viewers as number))) low = earlier
        if (earlier.buys_5m !== null && age >= buyWindowMs - 15_000) buysBefore = earlier.buys_5m
      }
      const viewerGain = row.viewers !== null && low ? row.viewers - (low.viewers as number) : 0
      const buysJump = row.buys_5m !== null && buysBefore !== null ? row.buys_5m - buysBefore : 0
      const byViewers = viewerGain >= viewerJump
      const byBuys = buysJump >= buyJump && buysBefore !== null && buysJump >= buysBefore * 0.5
      if (!byViewers && !byBuys) continue
      lastBurstAt = row.timestamp
      let peakViewers = row.viewers
      let peakPrice = row.price_usd
      let reachedAt: number | null = null
      const startViewers = byViewers && low ? low.viewers : row.viewers
      let end = row.timestamp
      for (let ahead = index + 1; ahead < group.length && group[ahead].timestamp - row.timestamp <= followMs; ahead++) {
        const later = group[ahead]
        end = later.timestamp
        if (later.viewers !== null && later.viewers > (peakViewers ?? -1)) peakViewers = later.viewers
        if (later.price_usd !== null && later.price_usd > (peakPrice ?? 0)) peakPrice = later.price_usd
        if (reachedAt === null && later.viewers !== null && later.viewers >= viewerTarget(startViewers)) reachedAt = later.timestamp
      }
      if (end - row.timestamp < followMs - 30_000 && newest - end < followMs) continue
      const trades = (row.buys_5m ?? 0) + (row.sells_5m ?? 0)
      const seconds = byViewers && low ? Math.max(1, (row.timestamp - low.timestamp) / 1000) : buyWindowMs / 1000
      const features: FeatureValues = { startViewers, viewerGain: Math.max(0, viewerGain), viewerSpeed: Math.max(0, viewerGain) / seconds, buys5m: row.buys_5m, buysJump: Math.max(0, buysJump), buyRatio: trades ? (row.buys_5m ?? 0) / trades : null, ageMinutes: token.pair_created_at > 0 ? Math.max(0, (row.timestamp - token.pair_created_at) / 60_000) : null, marketCap: row.market_cap, liquidity: row.liquidity_usd, volume5m: row.volume_5m }
      const outcome = exploded({ start_viewers: startViewers, peak_viewers: peakViewers, start_price: row.price_usd, peak_price: peakPrice }) ? 'exploded' : 'fizzled'
      const result = insert.run(token.mint, token.symbol, byViewers ? 'viewers' : 'buys', row.timestamp, startViewers, byViewers ? viewerGain : buysJump, seconds, row.price_usd, JSON.stringify(features), peakViewers, reachedAt, peakPrice, outcome, end)
      saveWallets(database, Number(result.lastInsertRowid), token.mint)
      added += 1
    }
  }
  database.transaction(() => {
    for (const mint of tokens.keys()) {
      group = history.all(mint) as HistoryRow[]
      flush()
    }
  })()
  return added
}

function explosiveWalletCount(model: Model, holders: string[], mint: string) {
  let count = 0
  for (const wallet of holders) {
    const coins = model.walletCoins.get(wallet)
    if (coins && (coins.size > 1 || !coins.has(mint))) count += 1
  }
  return count
}

function heuristicChance(jump: Jump, token: RadarToken, wallets: number) {
  const value = Math.min(1, jump.viewerGain / 40) * 0.45 + Math.min(1, Math.max(0, token.viewersPerMin ?? 0) / 60) * 0.2 + Math.min(1, jump.buysJump / 60) * 0.2 + Math.min(1, wallets / 3) * 0.15
  return Math.round(value * 100) / 100
}

function summarize(database: TrackerDatabase, model: Model, candidates: string[], now: number): RadarExplosionSummary {
  const done = database.prepare("SELECT b.*, t.pair_address FROM radar_bursts b LEFT JOIN tokens t ON t.mint = b.mint WHERE b.outcome = 'exploded' ORDER BY b.started_at DESC").all() as Array<BurstRow & { pair_address: string | null }>
  const multiples = done.filter(row => row.start_price && row.peak_price).map(row => (row.peak_price as number) / (row.start_price as number))
  const symbols = new Map((database.prepare('SELECT DISTINCT b.mint, b.symbol, t.pair_address FROM radar_bursts b LEFT JOIN tokens t ON t.mint = b.mint').all() as Array<{ mint: string; symbol: string; pair_address: string | null }>).map(row => [row.mint, row]))
  const wallets = [...model.walletCoins].filter(([, coins]) => coins.size >= 2).sort((first, second) => second[1].size - first[1].size).slice(0, 25)
    .map(([wallet, coins]) => ({ wallet, hits: coins.size, coins: [...coins].slice(0, 6).map(mint => ({ mint, symbol: symbols.get(mint)?.symbol ?? '???', pairAddress: symbols.get(mint)?.pair_address ?? null })) }))
  return {
    ready: model.classifier.ready,
    bursts: model.rows.length,
    exploded: model.labels.filter(Boolean).length,
    needed: minimumSamples,
    explodeRate: model.rows.length ? model.labels.filter(Boolean).length / model.rows.length : null,
    holdoutAccuracy: model.holdout?.accuracy ?? null,
    flaggedHitRate: model.holdout?.flaggedHitRate ?? null,
    medianSecondsTo100: median(done.filter(row => row.reached_at !== null).map(row => ((row.reached_at as number) - row.started_at) / 1000)),
    medianPriceMultiple: median(multiples),
    insights: splitInsights(specs, model.rows, model.labels, 'exploded'),
    candidates,
    wallets,
    recent: done.slice(0, 15).map(row => ({ mint: row.mint, symbol: row.symbol, pairAddress: row.pair_address, startedAt: row.started_at, startViewers: row.start_viewers ?? 0, gain: row.gain, peakViewers: row.peak_viewers ?? 0, secondsTo100: row.reached_at === null ? null : Math.round((row.reached_at - row.started_at) / 1000), priceMultiple: row.start_price && row.peak_price ? Math.round((row.peak_price / row.start_price) * 10) / 10 : null })),
    updatedAt: now,
  }
}

export function prepareExplosions(database: TrackerDatabase) {
  database.exec(burstSchema)
  const added = backfill(database)
  if (added) logger.info('Studied past viewer and buy jumps', { jumps: added })
  return loadModel(database)
}

export function runExplosionCycle(database: TrackerDatabase, model: Model, holderCache: Map<string, { at: number; wallets: string[] }>, now = Date.now()) {
  const tokens = buildRadarTokens(database, loadModelState(database).weights, now)
  const open = new Map((database.prepare("SELECT * FROM radar_bursts WHERE outcome = 'open'").all() as BurstRow[]).map(row => [row.mint, row]))
  const recent = database.prepare('SELECT 1 FROM radar_bursts WHERE mint = ? AND started_at >= ? LIMIT 1')
  const holdersOf = database.prepare('SELECT wallet FROM holders WHERE mint = ? AND (pct IS NULL OR pct < ?)')
  const insert = database.prepare('INSERT INTO radar_bursts (mint, symbol, kind, started_at, start_viewers, gain, seconds, start_price, features_json, peak_viewers, peak_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const update = database.prepare('UPDATE radar_bursts SET peak_viewers = ?, peak_price = ?, reached_at = COALESCE(reached_at, ?) WHERE id = ?')
  const close = database.prepare('UPDATE radar_bursts SET outcome = ?, closed_at = ? WHERE id = ?')
  const predictions = new Map<string, RadarExplode>()
  let closed = 0
  for (const token of tokens) {
    const jump = jumpFrom(marketTicks.get(token.mint) ?? [], now)
    let cached = holderCache.get(token.mint)
    if (!cached || now - cached.at > 60_000) {
      cached = { at: now, wallets: (holdersOf.all(token.mint, poolShare) as Array<{ wallet: string }>).map(row => row.wallet) }
      holderCache.set(token.mint, cached)
    }
    const earlyWallets = explosiveWalletCount(model, cached.wallets, token.mint)
    let burst = open.get(token.mint)
    const byViewers = jump.viewerGain >= viewerJump
    const byBuys = jump.buysJump >= buyJump && (token.buys5m ?? 0) > 0 && jump.buysJump >= ((token.buys5m ?? 0) - jump.buysJump) * 0.5
    if (!burst && (byViewers || byBuys) && !recent.get(token.mint, now - cooldownMs)) {
      const features = featuresOf(token, jump, earlyWallets)
      const result = insert.run(token.mint, token.symbol, byViewers ? 'viewers' : 'buys', now, jump.startViewers ?? token.viewers, byViewers ? jump.viewerGain : jump.buysJump, byViewers ? jump.viewerSeconds : buyWindowMs / 1000, token.priceUsd, JSON.stringify(features), token.viewers, token.priceUsd)
      saveWallets(database, Number(result.lastInsertRowid), token.mint)
      burst = { id: Number(result.lastInsertRowid), mint: token.mint, symbol: token.symbol, kind: byViewers ? 'viewers' : 'buys', started_at: now, start_viewers: jump.startViewers ?? token.viewers, gain: byViewers ? jump.viewerGain : jump.buysJump, seconds: jump.viewerSeconds, start_price: token.priceUsd, features_json: JSON.stringify(features), peak_viewers: token.viewers, reached_at: null, peak_price: token.priceUsd, outcome: 'open', closed_at: null }
      logger.info(byViewers ? 'Viewer jump' : 'Buy jump', { mint: token.mint, symbol: token.symbol, gain: burst.gain, seconds: Math.round(burst.seconds), viewers: token.viewers })
    }
    if (burst) {
      const peakViewers = Math.max(burst.peak_viewers ?? 0, token.viewers ?? 0) || null
      const peakPrice = Math.max(burst.peak_price ?? 0, token.priceUsd ?? 0) || null
      const reached = burst.reached_at === null && (token.viewers ?? 0) >= viewerTarget(burst.start_viewers) ? now : null
      update.run(peakViewers, peakPrice, reached, burst.id)
      burst = { ...burst, peak_viewers: peakViewers, peak_price: peakPrice, reached_at: burst.reached_at ?? reached }
      open.set(token.mint, burst)
    }
    const interesting = burst !== undefined || jump.viewerGain >= viewerJump / 2 || jump.buysJump >= buyJump / 2 || (token.viewersPerMin ?? 0) >= 10 || earlyWallets > 0
    if (!interesting) continue
    const values = burst ? JSON.parse(burst.features_json) as FeatureValues : featuresOf(token, jump, earlyWallets)
    const vector = vectorOf(model.classifier, specs, values)
    const done = burst ? exploded(burst) : false
    predictions.set(token.mint, {
      chance: done ? 1 : model.classifier.ready ? chanceOf(model.classifier, vector) : heuristicChance(jump, token, earlyWallets),
      learned: model.classifier.ready,
      burstStartedAt: burst?.started_at ?? null,
      startViewers: burst?.start_viewers ?? jump.startViewers,
      gain: burst?.kind === 'viewers' ? burst.gain : jump.viewerGain,
      seconds: burst?.kind === 'viewers' ? burst.seconds : jump.viewerSeconds,
      peakViewers: burst?.peak_viewers ?? token.viewers,
      earlyWallets,
      reasons: topReasons(model.classifier, specs, vector),
    })
  }
  for (const burst of open.values()) {
    if (now - burst.started_at < followMs) continue
    close.run(exploded(burst) ? 'exploded' : 'fizzled', now, burst.id)
    closed += 1
  }
  learnerState.explode = predictions
  const candidates = tokens
    .filter(token => predictions.has(token.mint) && token.alerts.length === 0 && !token.holderRisk?.blocked)
    .sort((first, second) => (predictions.get(second.mint)?.chance ?? 0) - (predictions.get(first.mint)?.chance ?? 0))
    .slice(0, 12)
    .map(token => token.mint)
  return { closed, candidates, watching: open.size }
}

export function startExplosions(database: TrackerDatabase, signal: AbortSignal) {
  let model = prepareExplosions(database)
  let trainedAt = Date.now()
  let summarizedAt = 0
  const holderCache = new Map<string, { at: number; wallets: string[] }>()
  return runLoop('explosions', cycleMs, async () => {
    const now = Date.now()
    const { closed, candidates, watching } = runExplosionCycle(database, model, holderCache, now)
    if (closed > 0 || now - trainedAt >= trainEveryMs) {
      model = loadModel(database)
      trainedAt = now
      summarizedAt = 0
    }
    if (now - summarizedAt >= 5_000) {
      learnerState.explosions = summarize(database, model, candidates, now)
      summarizedAt = now
      recordHeartbeat(database, 'explosions', 'ok', `${model.rows.length} jumps studied, ${model.labels.filter(Boolean).length} exploded, ${watching} live`)
    } else if (learnerState.explosions) {
      learnerState.explosions = { ...learnerState.explosions, candidates }
    }
  }, logger, signal)
}

export { loadModel as loadExplosionModel, summarize as summarizeExplosions }
