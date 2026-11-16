import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { createLogger, errorMessage, fetchJson, sleep } from './runtime.js'
import { activeCandidates } from './state.js'

const logger = createLogger('dex-paid')
const ordersApi = 'https://api.dexscreener.com/orders/v1/solana'
const requestGapMs = 2_000
const recheckUnpaidMs = 5_000
const pauseAfterLimitMs = 60_000

type Orders = { orders?: Array<{ type?: string; status?: string }>; boosts?: unknown[] }

/** True when DexScreener has an approved paid token profile (DexPaid) for the coin. */
export function isDexPaid(orders: Orders) {
  return (orders.orders ?? []).some(order => order.type === 'tokenProfile' && order.status === 'approved')
}

/**
 * Checks each tracked coin's DexScreener orders for a paid token profile, one coin every 2 seconds (the orders feed allows
 * about 60 a minute). Unpaid coins are re-checked every 2 minutes; a paid profile is kept and not checked again.
 */
export function startDexPaid(database: TrackerDatabase, signal: AbortSignal) {
  const checkedAt = new Map<string, number>()
  const paidOf = database.prepare('SELECT dex_paid FROM tokens WHERE mint = ?')
  const save = database.prepare('UPDATE tokens SET dex_paid = ?, dex_paid_checked_at = ? WHERE mint = ?')
  let pausedUntil = 0
  let lastHeartbeat = 0
  let checked = 0
  let paid = 0
  logger.info('Checking DexScreener for paid token profiles')
  return (async () => {
    while (!signal.aborted) {
      const now = Date.now()
      const due = now < pausedUntil ? null : activeCandidates(database).find(candidate => {
        if ((paidOf.get(candidate.mint) as { dex_paid: number | null } | undefined)?.dex_paid === 1) return false
        return now - (checkedAt.get(candidate.mint) ?? 0) >= recheckUnpaidMs
      })
      if (due) {
        checkedAt.set(due.mint, now)
        try {
          const orders = await fetchJson<Orders>(`${ordersApi}/${due.mint}`, { retries: 0, timeoutMs: 6_000 })
          const isPaid = isDexPaid(orders)
          save.run(isPaid ? 1 : 0, now, due.mint)
          checked += 1
          if (isPaid) paid += 1
        } catch (error) {
          if (/429/.test(errorMessage(error))) {
            pausedUntil = Date.now() + pauseAfterLimitMs
            logger.warn('DexScreener asked for fewer order checks; pausing for a minute')
          }
        }
      }
      if (now - lastHeartbeat >= 15_000) {
        recordHeartbeat(database, 'dex-paid', now < pausedUntil ? 'waiting' : 'ok', now < pausedUntil ? 'DexScreener asked for a pause' : `${checked} coins checked, ${paid} DexPaid`)
        lastHeartbeat = now
        checked = 0
        paid = 0
        for (const [mint, at] of checkedAt) if (now - at > 30 * 60_000) checkedAt.delete(mint)
      }
      await sleep(requestGapMs, signal)
    }
  })()
}
