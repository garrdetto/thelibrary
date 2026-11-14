import { openTrackerDatabase, recordHeartbeat, type TrackerDatabase } from './db.js'
import { bestPairByMint, fetchDiscoverySources, fetchPairsForMints, readMarket, socialsOf, type DexPair } from './dexscreener.js'
import { assessToken } from './rugcheck.js'
import { createLogger, errorMessage, isMainModule, runLoop, trackerConfig } from './runtime.js'
import { trackerState, type ActiveCandidate } from './state.js'

const logger = createLogger('discovery')
const watchlistLimit = 300
const enrichmentsPerCycle = 4
const enrichmentRefreshMs = 30 * 60_000
const enrichedAt = new Map<string, number>()

export function passesLaunchFilter(pair: DexPair, now = Date.now()) {
  const buys = pair.txns?.m5?.buys ?? 0
  const sells = pair.txns?.m5?.sells ?? 0
  const transactions = buys + sells
  return Boolean(pair.pairCreatedAt && pair.pairCreatedAt >= now - trackerConfig.maxPairAgeMs)
    && (pair.volume?.m5 ?? 0) >= trackerConfig.minVolume5m
    && transactions >= trackerConfig.minTxns5m
    && (pair.liquidity?.usd ?? 0) >= trackerConfig.minLiquidityUsd
    && buys / transactions > trackerConfig.minBuyRatio
}

export function momentumOf(pair: DexPair, now = Date.now()) {
  const buys = pair.txns?.m5?.buys ?? 0
  const sells = pair.txns?.m5?.sells ?? 0
  const transactions = Math.max(1, buys + sells)
  const volumeScore = Math.log10(1 + (pair.volume?.m5 ?? 0) / trackerConfig.minVolume5m)
  const activityScore = Math.log10(1 + transactions / trackerConfig.minTxns5m)
  const pressureScore = buys / transactions - 0.5
  const freshness = 1 - Math.min(1, (now - (pair.pairCreatedAt ?? now)) / trackerConfig.maxPairAgeMs)
  return Math.round((volumeScore * 45 + activityScore * 30 + pressureScore * 40 + freshness * 10) * 100) / 100
}

function upsertTokens(database: TrackerDatabase, pairs: DexPair[], boosted: Set<string>, now: number) {
  const statement = database.prepare(`
    INSERT INTO tokens (mint, pair_address, symbol, name, image_url, pair_created_at, socials_json, is_boosted, last_seen_at)
    VALUES (@mint, @pairAddress, @symbol, @name, @imageUrl, @pairCreatedAt, @socials, @boosted, @now)
    ON CONFLICT (mint) DO UPDATE SET pair_address = excluded.pair_address, symbol = excluded.symbol, name = excluded.name,
      image_url = COALESCE(excluded.image_url, tokens.image_url), socials_json = excluded.socials_json,
      is_boosted = MAX(tokens.is_boosted, excluded.is_boosted), last_seen_at = excluded.last_seen_at
  `)
  database.transaction(() => {
    for (const pair of pairs) {
      statement.run({
        mint: pair.baseToken.address,
        pairAddress: pair.pairAddress,
        symbol: (pair.baseToken.symbol ?? '???').slice(0, 24),
        name: (pair.baseToken.name ?? pair.baseToken.symbol ?? 'Unknown').slice(0, 80),
        imageUrl: pair.info?.imageUrl ?? null,
        pairCreatedAt: pair.pairCreatedAt ?? now,
        socials: JSON.stringify(socialsOf(pair)),
        boosted: boosted.has(pair.baseToken.address) || (pair.boosts?.active ?? 0) > 0 ? 1 : 0,
        now,
      })
    }
  })()
}

async function enrichCandidates(database: TrackerDatabase, candidates: ActiveCandidate[]) {
  const now = Date.now()
  const due = candidates.filter(candidate => now - (enrichedAt.get(candidate.mint) ?? 0) > enrichmentRefreshMs).slice(0, enrichmentsPerCycle)
  const update = database.prepare('UPDATE tokens SET rug_score = ?, mint_auth = ?, freeze_auth = ?, top10_pct = ? WHERE mint = ?')
  for (const candidate of due) {
    enrichedAt.set(candidate.mint, now)
    try {
      const assessment = await assessToken(candidate.mint)
      const flag = (value: boolean | null) => value === null ? null : value ? 1 : 0
      update.run(assessment.rugScore, flag(assessment.mintAuthority), flag(assessment.freezeAuthority), assessment.top10Pct, candidate.mint)
    } catch (error) {
      enrichedAt.set(candidate.mint, now - enrichmentRefreshMs + 2 * 60_000)
      logger.warn('RugCheck enrichment failed', { mint: candidate.mint, error: errorMessage(error) })
    }
  }
  return due.length
}

export async function runDiscoveryCycle(database: TrackerDatabase) {
  const now = Date.now()
  const sources = await fetchDiscoverySources()
  for (const mint of sources.mints) if (!trackerState.watchlist.has(mint)) trackerState.watchlist.set(mint, now)
  for (const candidate of trackerState.active) trackerState.watchlist.set(candidate.mint, trackerState.watchlist.get(candidate.mint) ?? now)
  for (const [mint, firstSeen] of trackerState.watchlist) if (now - firstSeen > trackerConfig.maxPairAgeMs) trackerState.watchlist.delete(mint)
  const watched = [...trackerState.watchlist.entries()].sort((first, second) => second[1] - first[1]).slice(0, watchlistLimit).map(([mint]) => mint)

  const best = bestPairByMint(await fetchPairsForMints(watched))
  const young: DexPair[] = []
  for (const [mint, pair] of best) {
    if (!pair.pairCreatedAt || pair.pairCreatedAt < now - trackerConfig.maxPairAgeMs) trackerState.watchlist.delete(mint)
    else young.push(pair)
  }
  const qualified = young.filter(pair => passesLaunchFilter(pair, now))
  const ranked = qualified.map(pair => ({ pair, momentum: momentumOf(pair, now) })).sort((first, second) => second.momentum - first.momentum).slice(0, trackerConfig.maxCandidates)

  upsertTokens(database, ranked.map(entry => entry.pair), sources.boosted, now)
  trackerState.active = ranked.map(({ pair, momentum }) => ({ mint: pair.baseToken.address, pairAddress: pair.pairAddress, symbol: pair.baseToken.symbol ?? '???', momentum }))
  for (const { pair } of ranked) trackerState.market.set(pair.baseToken.address, readMarket(pair, now))
  for (const mint of trackerState.market.keys()) if (!ranked.some(entry => entry.pair.baseToken.address === mint)) trackerState.market.delete(mint)

  const enriched = await enrichCandidates(database, trackerState.active)
  recordHeartbeat(database, 'discovery', 'ok', `${trackerState.active.length} active of ${young.length} young pairs`)
  logger.info('Discovery cycle complete', { sourced: sources.mints.length, watched: watched.length, young: young.length, qualified: qualified.length, active: trackerState.active.length, enriched, sourceFailures: sources.failures })
}

export function startDiscovery(database: TrackerDatabase, signal: AbortSignal) {
  logger.info('Starting DexScreener discovery', { intervalMs: trackerConfig.discoveryIntervalMs })
  return runLoop('discovery', trackerConfig.discoveryIntervalMs, () => runDiscoveryCycle(database), logger, signal)
}

if (isMainModule(import.meta.url)) {
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())
  void startDiscovery(openTrackerDatabase(), controller.signal)
}
