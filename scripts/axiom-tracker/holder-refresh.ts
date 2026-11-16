import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { learnerState } from './learner-state.js'
import { assessToken, type RugAssessment } from './rugcheck.js'
import { createLogger, errorMessage, sleep } from './runtime.js'
import { radarSettings } from './settings-store.js'
import { activeCandidates, trackerState } from './state.js'

const logger = createLogger('holder-refresh')
const tickMs = 250
const maxInFlight = 4
const importantEveryMs = 4_000
const othersEveryMs = 5_000
const onPulseEveryMs = 5_000
const pauseAfterLimitMs = 30_000

const flag = (value: boolean | null) => value === null ? null : value ? 1 : 0

/** Stores one RugCheck re-check: the coin's risk and holder numbers, and its top holders. */
export function saveAssessment(database: TrackerDatabase, mint: string, assessment: RugAssessment, now = Date.now()) {
  database.prepare(`UPDATE tokens SET rug_score = COALESCE(?, rug_score), mint_auth = COALESCE(?, mint_auth), freeze_auth = COALESCE(?, freeze_auth), top10_pct = COALESCE(?, top10_pct),
    holders_total = COALESCE(?, holders_total), dev_pct = COALESCE(?, dev_pct), insider_pct = COALESCE(?, insider_pct), rugged = COALESCE(?, rugged), traits_checked_at = ? WHERE mint = ?`)
    .run(assessment.rugScore, flag(assessment.mintAuthority), flag(assessment.freezeAuthority), assessment.top10Pct, assessment.totalHolders, assessment.devPct, assessment.linkedPct, flag(assessment.rugged), now, mint)
  if (assessment.totalHolders !== null) trackerState.holderCounts.set(mint, { count: assessment.totalHolders, at: now })
  if (!assessment.holders.length) return
  database.transaction(() => {
    database.prepare('DELETE FROM holders WHERE mint = ?').run(mint)
    const insert = database.prepare('INSERT OR REPLACE INTO holders (mint, wallet, pct, updated_at) VALUES (?, ?, ?, ?)')
    for (const holder of assessment.holders) insert.run(mint, holder.wallet, holder.pct, now)
  })()
}

/** Re-checks every tracked coin's holder numbers on a rotation: about every 4 seconds for the coins being recommended, every 7 or so for the rest, and every minute for coins the Pulse cards already cover each second. */
export function startHolderRefresh(database: TrackerDatabase, signal: AbortSignal) {
  const checkedAt = new Map<string, number>()
  const inFlight = new Set<string>()
  let pausedUntil = 0
  let lastHeartbeat = 0
  let done = 0
  let failed = 0
  return (async () => {
    while (!signal.aborted) {
      const now = Date.now()
      if (now >= pausedUntil && inFlight.size < maxInFlight) {
        const important = new Set<string>([...(learnerState.explosions?.candidates ?? []), ...(learnerState.winners?.candidates ?? []), ...(learnerState.summary?.earlyPicks ?? []), ...radarSettings().pinned])
        let pick: string | null = null
        let worst = 0
        for (const candidate of activeCandidates(database)) {
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
          void assessToken(mint, { timeoutMs: 8_000 })
            .then(assessment => { saveAssessment(database, mint, assessment); done += 1 })
            .catch(error => {
              failed += 1
              const message = errorMessage(error)
              if (/429|rate/i.test(message)) {
                pausedUntil = Date.now() + pauseAfterLimitMs
                logger.warn('RugCheck asked for fewer requests; pausing holder re-checks for 30 seconds')
              }
            })
            .finally(() => inFlight.delete(mint))
        }
      }
      if (now - lastHeartbeat >= 15_000) {
        const perMinute = Math.round(done * (60_000 / Math.max(1, now - lastHeartbeat || 15_000)))
        recordHeartbeat(database, 'holder-refresh', now < pausedUntil ? 'waiting' : 'ok', now < pausedUntil ? 'RugCheck asked for a pause' : `${perMinute} holder re-checks a minute${failed ? `, ${failed} failed` : ''}`)
        lastHeartbeat = now
        done = 0
        failed = 0
        for (const mint of checkedAt.keys()) if (now - (checkedAt.get(mint) ?? 0) > 10 * 60_000) checkedAt.delete(mint)
      }
      await sleep(tickMs, signal)
    }
  })()
}
