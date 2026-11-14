import { openTrackerDatabase, recordHeartbeat, type TrackerDatabase } from './db.js'
import { bestPairByMint, fetchDiscoverySources, fetchPairsForMints, readMarket, socialsOf, type DexPair } from './dexscreener.js'
import { assessToken } from './rugcheck.js'
import { createLogger, errorMessage, isMainModule, runLoop, trackerConfig } from './runtime.js'
import { trackerState, type ActiveCandidate } from './state.js'
import { radarSettings } from './settings-store.js'
import { safetyLevel } from './model.js'
import type { RadarSettings } from '../../src/lib/axiom-radar-settings.js'

const logger = createLogger('discovery')
const watchlistLimit = 400
const watchlistTtlMs = 6 * 60 * 60_000
const pulseWindowMs = 3 * 60_000
const enrichmentsPerCycle = 5
const enrichmentRefreshMs = 30 * 60_000
const enrichedAt = new Map<string, number>()

export function passesMarketRequirements(pair: DexPair, settings: RadarSettings) {
  const buys = pair.txns?.m5?.buys ?? 0
  const sells = pair.txns?.m5?.sells ?? 0
  const transactions = buys + sells
  if (settings.minVolume5m.enabled && (pair.volume?.m5 ?? 0) < settings.minVolume5m.value) return false
  if (settings.minTxns5m.enabled && transactions < settings.minTxns5m.value) return false
  if (settings.minLiquidity.enabled && (pair.liquidity?.usd ?? 0) < settings.minLiquidity.value) return false
  if (settings.minBuyPercent.enabled && (!transactions || (buys / transactions) * 100 <= settings.minBuyPercent.value)) return false
  return true
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
      if (assessment.holders.length) {
        database.transaction(() => {
          database.prepare('DELETE FROM holders WHERE mint = ?').run(candidate.mint)
          const insert = database.prepare('INSERT OR REPLACE INTO holders (mint, wallet, pct, updated_at) VALUES (?, ?, ?, ?)')
          for (const holder of assessment.holders) insert.run(candidate.mint, holder.wallet, holder.pct, now)
        })()
      }
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
  for (const [mint, seenAt] of trackerState.pulse) {
    if (now - seenAt > pulseWindowMs) trackerState.pulse.delete(mint)
    else if (!trackerState.watchlist.has(mint)) trackerState.watchlist.set(mint, now)
  }
  const settings = radarSettings()
  const pinned = new Set(settings.pinned)
  for (const mint of pinned) if (!trackerState.watchlist.has(mint)) trackerState.watchlist.set(mint, now)
  for (const [mint, firstSeen] of trackerState.watchlist) if (now - firstSeen > watchlistTtlMs && !pinned.has(mint) && !trackerState.pulse.has(mint)) trackerState.watchlist.delete(mint)
  const watched = [...new Set([...pinned, ...trackerState.pulse.keys(), ...[...trackerState.watchlist.entries()].sort((first, second) => second[1] - first[1]).map(([mint]) => mint)])].slice(0, watchlistLimit)

  const best = bestPairByMint(await fetchPairsForMints(watched))
  const maxAgeMs = settings.maxAgeHours.enabled ? settings.maxAgeHours.value * 3_600_000 : Number.POSITIVE_INFINITY
  const safety = database.prepare('SELECT mint, rug_score, mint_auth, freeze_auth, top10_pct FROM tokens WHERE mint IN (SELECT value FROM json_each(?))').all(JSON.stringify([...best.keys()])) as Array<{ mint: string; rug_score: number | null; mint_auth: number | null; freeze_auth: number | null; top10_pct: number | null }>
  const safetyByMint = new Map(safety.map(row => [row.mint, row]))
  const eligible: DexPair[] = []
  for (const [mint, pair] of best) {
    if (pinned.has(mint)) { eligible.push(pair); continue }
    if (pair.pairCreatedAt && now - pair.pairCreatedAt > maxAgeMs) continue
    const onPulse = trackerState.pulse.has(mint)
    if (!(onPulse && settings.pulseBypassesMarket) && !passesMarketRequirements(pair, settings)) continue
    const viewers = trackerState.viewers.get(mint)
    if (settings.minViewers.enabled && (!viewers || now - viewers.at > 60_000 || viewers.count < settings.minViewers.value)) continue
    if (settings.safeOnly) {
      const row = safetyByMint.get(mint)
      const level = row ? safetyLevel({ rugScore: row.rug_score, mintAuthority: row.mint_auth === null ? null : row.mint_auth === 1, freezeAuthority: row.freeze_auth === null ? null : row.freeze_auth === 1, top10Pct: row.top10_pct }) : 'unknown'
      if (level !== 'safe' && level !== 'unknown') continue
    }
    eligible.push(pair)
  }
  const viewerCount = (mint: string) => {
    const viewer = trackerState.viewers.get(mint)
    return viewer && now - viewer.at < 60_000 ? viewer.count : -1
  }
  const ranked = eligible
    .map(pair => ({ pair, momentum: momentumOf(pair, now) }))
    .sort((first, second) => Number(pinned.has(second.pair.baseToken.address)) - Number(pinned.has(first.pair.baseToken.address)) || viewerCount(second.pair.baseToken.address) - viewerCount(first.pair.baseToken.address) || second.momentum - first.momentum)
    .slice(0, settings.maxCoins)
  const fromPulse = ranked.filter(entry => trackerState.pulse.has(entry.pair.baseToken.address))

  upsertTokens(database, ranked.map(entry => entry.pair), sources.boosted, now)
  trackerState.active = ranked.map(({ pair, momentum }) => ({ mint: pair.baseToken.address, pairAddress: pair.pairAddress, symbol: pair.baseToken.symbol ?? '???', momentum }))
  for (const { pair } of ranked) trackerState.market.set(pair.baseToken.address, readMarket(pair, now))
  for (const mint of trackerState.market.keys()) if (!ranked.some(entry => entry.pair.baseToken.address === mint)) trackerState.market.delete(mint)

  const enriched = await enrichCandidates(database, trackerState.active)
  recordHeartbeat(database, 'discovery', 'ok', `${trackerState.active.length} tracked of ${best.size} coins checked`)
  logger.info('Discovery cycle complete', { sourced: sources.mints.length, watched: watched.length, checked: best.size, eligible: eligible.length, fromPulse: fromPulse.length, onPulse: trackerState.pulse.size, active: trackerState.active.length, enriched, sourceFailures: sources.failures })
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
