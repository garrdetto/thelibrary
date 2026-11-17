import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { learnerState } from './learner-state.js'
import { readTopHolders, refreshMintFacts, type ChainHolders } from './chain-holders.js'
import { createLogger, errorMessage, sleep } from './runtime.js'
import { onPublicNode } from './solana-rpc.js'
import { radarSettings } from './settings-store.js'
import { activeCandidates, trackerState } from './state.js'

const logger = createLogger('holder-refresh')
const tickMs = 250
const maxInFlight = 3
const mintFactsEveryMs = 5_000
const importantEveryMs = 4_000
const othersEveryMs = 5_000
const onPulseEveryMs = 5_000
const pauseAfterLimitMs = 30_000

/** Stores one on-chain top-holder read: the top 10 share and the top 20 wallets. */
export function saveHolders(database: TrackerDatabase, mint: string, reading: ChainHolders, now = Date.now()) {
  database.prepare('UPDATE tokens SET top10_pct = COALESCE(?, top10_pct), traits_checked_at = ? WHERE mint = ?').run(reading.top10Pct, now, mint)
  if (!reading.holders.length) return
  database.transaction(() => {
    database.prepare('DELETE FROM holders WHERE mint = ?').run(mint)
    const insert = database.prepare('INSERT OR REPLACE INTO holders (mint, wallet, pct, updated_at) VALUES (?, ?, ?, ?)')
    for (const holder of reading.holders) insert.run(mint, holder.wallet, holder.pct, now)
  })()
}

/**
 * Reads every tracked coin's mint and freeze authority from the Solana node every 5 seconds (one request), and its top holders
 * on a rotation: about every 4 seconds for the coins being recommended and every 5 for the rest, as fast as the node allows.
 * The free public node refuses top-holder lookups, so those need `HELIUS_API_KEY` or `SOLANA_RPC_URL`; authorities work either way.
 */
export function startHolderRefresh(database: TrackerDatabase, signal: AbortSignal) {
  const checkedAt = new Map<string, number>()
  const inFlight = new Set<string>()
  const saveAuthority = database.prepare('UPDATE tokens SET mint_auth = ?, freeze_auth = ? WHERE mint = ?')
  const holdersAvailable = !onPublicNode()
  let pausedUntil = 0
  let factsPausedUntil = 0
  let factsAt = 0
  let factsLoading = false
  let lastHeartbeat = 0
  let done = 0
  let failed = 0
  const limited = (what: 'facts' | 'holders') => (error: unknown) => {
    failed += 1
    if (!/429|rate|too many/i.test(errorMessage(error))) return
    if (what === 'facts') factsPausedUntil = Date.now() + pauseAfterLimitMs
    else pausedUntil = Date.now() + pauseAfterLimitMs
    logger.warn(`The Solana node asked for fewer requests; pausing ${what === 'facts' ? 'authority' : 'top-holder'} reads for 30 seconds`)
  }
  if (!holdersAvailable) logger.warn('No HELIUS_API_KEY or SOLANA_RPC_URL: the public Solana node refuses top-holder lookups, so only mint and freeze authority are read')
  return (async () => {
    while (!signal.aborted) {
      const now = Date.now()
      const candidates = activeCandidates(database)
      if (now >= factsPausedUntil && !factsLoading && now - factsAt >= mintFactsEveryMs && candidates.length) {
        factsLoading = true
        factsAt = now
        void refreshMintFacts(candidates.map(candidate => candidate.mint))
          .then(found => database.transaction(() => { for (const [mint, facts] of found) saveAuthority.run(facts.mintAuthority ? 1 : 0, facts.freezeAuthority ? 1 : 0, mint) })())
          .catch(limited('facts'))
          .finally(() => { factsLoading = false })
      }
      if (holdersAvailable && now >= pausedUntil && inFlight.size < maxInFlight) {
        const important = new Set<string>([...(learnerState.explosions?.candidates ?? []), ...(learnerState.winners?.candidates ?? []), ...(learnerState.summary?.earlyPicks ?? []), ...radarSettings().pinned])
        let pick: string | null = null
        let worst = 0
        for (const candidate of candidates) {
          if (inFlight.has(candidate.mint)) continue
          const card = trackerState.pulseCards.get(candidate.mint)
          const target = card && now - card.seenAt < 10_000 ? onPulseEveryMs : important.has(candidate.mint) ? importantEveryMs : othersEveryMs
          const overdue = (now - (checkedAt.get(candidate.mint) ?? 0)) / target
          if (overdue >= 1 && overdue > worst) { worst = overdue; pick = candidate.mint }
        }
        if (pick) {
          const mint = pick
          inFlight.add(mint)
          checkedAt.set(mint, now)
          void readTopHolders(mint)
            .then(reading => { saveHolders(database, mint, reading); done += 1 })
            .catch(limited('holders'))
            .finally(() => inFlight.delete(mint))
        }
      }
      if (now - lastHeartbeat >= 15_000) {
        const perMinute = Math.round(done * (60_000 / Math.max(1, now - lastHeartbeat || 15_000)))
        const detail = !holdersAvailable ? 'Mint and freeze authority every 5s; top-holder wallets need a HELIUS_API_KEY or SOLANA_RPC_URL (the public node refuses them)'
          : now < pausedUntil ? 'The Solana node asked for a pause' : `${perMinute} on-chain holder reads a minute${failed ? `, ${failed} failed` : ''}`
        recordHeartbeat(database, 'holder-refresh', holdersAvailable && now < pausedUntil ? 'waiting' : 'ok', detail)
        lastHeartbeat = now
        done = 0
        failed = 0
        for (const mint of checkedAt.keys()) if (now - (checkedAt.get(mint) ?? 0) > 10 * 60_000) checkedAt.delete(mint)
      }
      await sleep(tickMs, signal)
    }
  })()
}
