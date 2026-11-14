import { radarFeatureKeys, type RadarWeights } from '../../src/lib/axiom-radar-types.js'
import { openTrackerDatabase, recordHeartbeat, type TrackerDatabase } from './db.js'
import { fetchMarketsForMints } from './dexscreener.js'
import { radarThresholds, recalibrateWeights, type TrainingSample } from './model.js'
import { buildRadarTokens, loadModelState } from './radar-query.js'
import { createLogger, errorMessage, isMainModule, runLoop, trackerConfig } from './runtime.js'
import { trackerState } from './state.js'

const logger = createLogger('scoring')
const checkpoints = [
  { column: 'price_5m', offsetMs: 5 * 60_000 },
  { column: 'price_15m', offsetMs: 15 * 60_000 },
  { column: 'price_30m', offsetMs: 30 * 60_000 },
] as const

type OpenTrade = { id: number; mint: string; symbol: string; entry_price: number; price_5m: number | null; price_15m: number | null; price_30m: number | null; created_at: number }

function openPaperTrades(database: TrackerDatabase, weights: RadarWeights, now: number) {
  const tokens = buildRadarTokens(database, weights, now)
  const insert = database.prepare(`
    INSERT INTO paper_trades (mint, symbol, entry_price, entry_mcap, setup_score, reasons_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?) ON CONFLICT (mint) DO NOTHING
  `)
  let opened = 0
  for (const token of tokens) {
    if (token.score < radarThresholds.paperTradeScore || !token.priceUsd || !token.lastSnapshotAt || now - token.lastSnapshotAt > 60_000) continue
    const features = Object.fromEntries(token.factors.map(factor => [factor.key, factor.available ? factor.value : null]))
    const reasons = { score: token.score, features, factors: token.factors, viewers: token.viewers, viewersDelta5m: token.viewersDelta5m, runnerWallets: token.runnerWallets, buyRatio: token.buyRatio, weights }
    const result = insert.run(token.mint, token.symbol, token.priceUsd, token.marketCap, token.score, JSON.stringify(reasons), now)
    if (result.changes) {
      opened += 1
      logger.info('Opened paper trade', { mint: token.mint, symbol: token.symbol, score: token.score, entryPrice: token.priceUsd })
    }
  }
  return { tokens, opened }
}

function snapshotPriceNear(database: TrackerDatabase, mint: string, target: number) {
  const row = database.prepare('SELECT price_usd FROM snapshots WHERE mint = ? AND timestamp >= ? AND timestamp <= ? AND price_usd IS NOT NULL ORDER BY timestamp ASC LIMIT 1').get(mint, target, target + 2 * 60_000) as { price_usd: number } | undefined
  return row?.price_usd ?? null
}

function lastKnownPrice(database: TrackerDatabase, mint: string) {
  const row = database.prepare('SELECT price_usd FROM snapshots WHERE mint = ? AND price_usd IS NOT NULL ORDER BY timestamp DESC LIMIT 1').get(mint) as { price_usd: number } | undefined
  return row?.price_usd ?? null
}

async function evaluatePaperTrades(database: TrackerDatabase, now: number) {
  const pending = database.prepare('SELECT id, mint, symbol, entry_price, price_5m, price_15m, price_30m, created_at FROM paper_trades WHERE price_30m IS NULL AND created_at <= ?').all(now - checkpoints[0].offsetMs) as OpenTrade[]
  if (!pending.length) return 0
  const needLive = new Set<string>()
  for (const trade of pending) {
    for (const checkpoint of checkpoints) {
      const due = trade.created_at + checkpoint.offsetMs
      if (trade[checkpoint.column] === null && now >= due && snapshotPriceNear(database, trade.mint, due) === null && !trackerState.market.has(trade.mint)) needLive.add(trade.mint)
    }
  }
  let live = new Map<string, { priceUsd: number | null }>()
  if (needLive.size) {
    try { live = await fetchMarketsForMints([...needLive]) } catch (error) { logger.warn('Live price lookup failed for paper trades', { error: errorMessage(error) }) }
  }
  let updated = 0
  for (const trade of pending) {
    const changes: Record<string, number | string> = {}
    for (const checkpoint of checkpoints) {
      const due = trade.created_at + checkpoint.offsetMs
      if (trade[checkpoint.column] !== null) continue
      if (now < due) break
      let price = snapshotPriceNear(database, trade.mint, due)
      if (price === null) price = trackerState.market.get(trade.mint)?.priceUsd ?? null
      if (price === null) price = live.get(trade.mint)?.priceUsd ?? null
      if (price === null && now - due > 10 * 60_000) price = lastKnownPrice(database, trade.mint) ?? 0
      if (price === null) break
      changes[checkpoint.column] = price
      if (checkpoint.column === 'price_15m') changes.status = price / trade.entry_price - 1 >= radarThresholds.winReturn ? 'win' : 'loss'
    }
    const columns = Object.keys(changes)
    if (!columns.length) continue
    database.prepare(`UPDATE paper_trades SET ${columns.map(column => `${column} = @${column}`).join(', ')} WHERE id = @id`).run({ ...changes, id: trade.id })
    updated += 1
    if (changes.status) logger.info('Paper trade decided', { mint: trade.mint, symbol: trade.symbol, status: changes.status, return15m: Number(changes.price_15m) / trade.entry_price - 1 })
  }
  return updated
}

function maybeRecalibrate(database: TrackerDatabase) {
  const model = loadModelState(database)
  const completed = database.prepare("SELECT reasons_json, status FROM paper_trades WHERE status IN ('win', 'loss') ORDER BY created_at DESC LIMIT 200").all() as Array<{ reasons_json: string; status: string }>
  const total = (database.prepare("SELECT COUNT(*) AS count FROM paper_trades WHERE status IN ('win', 'loss')").get() as { count: number }).count
  if (total - model.sampleCount < radarThresholds.recalibrateEvery) return false
  const samples: TrainingSample[] = completed.map(row => {
    let features: TrainingSample['features'] = {}
    try { features = (JSON.parse(row.reasons_json) as { features?: TrainingSample['features'] }).features ?? {} } catch { }
    return { features, win: row.status === 'win' }
  })
  const weights = recalibrateWeights(model.weights, samples)
  const winRate = samples.filter(sample => sample.win).length / samples.length
  database.prepare('INSERT INTO model_weights (w_viewer_velocity, w_active_viewers, w_runner_wallets, w_buy_pressure, w_safety, win_rate, sample_count, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(weights.viewerVelocity, weights.activeViewers, weights.runnerWallets, weights.buyPressure, weights.safety, winRate, total, Date.now())
  logger.info('Recalibrated model weights', { sampleCount: total, winRate, weights: Object.fromEntries(radarFeatureKeys.map(key => [key, weights[key]])) })
  return true
}

export async function runScoringCycle(database: TrackerDatabase) {
  const now = Date.now()
  const model = loadModelState(database)
  const { tokens, opened } = openPaperTrades(database, model.weights, now)
  const evaluated = await evaluatePaperTrades(database, now)
  const recalibrated = maybeRecalibrate(database)
  const top = tokens[0]
  recordHeartbeat(database, 'scoring', 'ok', `${tokens.length} scored${top ? `, top ${top.symbol} ${top.score}` : ''}`)
  if (opened || evaluated || recalibrated) logger.info('Scoring cycle', { scored: tokens.length, opened, evaluated, recalibrated })
}

export function startScoring(database: TrackerDatabase, signal: AbortSignal) {
  logger.info('Starting setup scoring and paper trading', { intervalMs: trackerConfig.scoringIntervalMs, threshold: radarThresholds.paperTradeScore })
  return runLoop('scoring', trackerConfig.scoringIntervalMs, () => runScoringCycle(database), logger, signal)
}

if (isMainModule(import.meta.url)) {
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())
  void startScoring(openTrackerDatabase(), controller.signal)
}
