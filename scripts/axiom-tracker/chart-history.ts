import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { createLogger, errorMessage, fetchJson, sleep } from './runtime.js'
import type { PricePoint } from './runner-score.js'
import { activeCandidates } from './state.js'

const logger = createLogger('chart-history')
const geckoPools = 'https://api.geckoterminal.com/api/v2/networks/solana/pools'
const requestGapMs = 3_500
const refreshMs = 3 * 60_000
const ownHistoryEnoughMs = 20 * 60_000
const candleLimit = 60
const pauseAfterLimitMs = 90_000
const forgetAfterMs = 30 * 60_000

type Ohlcv = { data?: { attributes?: { ohlcv_list?: Array<[number, number, number, number, number, number]> } } }

const candles = new Map<string, { at: number; points: PricePoint[] }>()

/** Minute closes from GeckoTerminal's OHLCV list (newest first, times in seconds at the minute's start), oldest first, stamped at the minute's end. */
export function minuteClosesFrom(list: Array<[number, number, number, number, number, number]>): PricePoint[] {
  return list
    .filter(row => Array.isArray(row) && Number.isFinite(row[0]) && Number.isFinite(row[4]) && row[4] > 0)
    .map(row => ({ t: row[0] * 1000 + 59_999, price: row[4] }))
    .sort((first, second) => first.t - second.t)
}

/** The coin's chart before the radar started following it, so rules that read price history do not depend on how long it has been tracked. */
export function chartHistory(mint: string): PricePoint[] {
  return candles.get(mint)?.points ?? []
}

/** Joins the coin's earlier minute candles onto the radar's own price series, keeping only candles from before the series starts. */
export function withChartHistory(history: PricePoint[], series: PricePoint[]): PricePoint[] {
  const startedAt = series[0]?.t ?? Infinity
  const earlier = history.filter(point => point.t < startedAt - 1_000)
  return earlier.length ? [...earlier, ...series] : series
}

/**
 * Fetches the last hour of one-minute candles from GeckoTerminal for coins the radar has followed for under 20 minutes, one
 * coin every 3.5 seconds (GeckoTerminal allows about 30 requests a minute, shared with discovery), each refreshed every 3 minutes.
 * After 20 minutes the radar's own price history covers what the rules read.
 */
export function startChartHistory(database: TrackerDatabase, signal: AbortSignal) {
  const trackedSince = database.prepare('SELECT MIN(timestamp) AS since FROM snapshots WHERE mint = ?')
  let pausedUntil = 0
  let lastHeartbeat = 0
  let fetched = 0
  let missing = 0
  logger.info('Backfilling minute candles for coins the radar just started following')
  return (async () => {
    while (!signal.aborted) {
      const now = Date.now()
      const due = now < pausedUntil ? null : activeCandidates(database)
        .filter(candidate => {
          const since = (trackedSince.get(candidate.mint) as { since: number | null } | undefined)?.since ?? now
          if (now - since >= ownHistoryEnoughMs) return false
          return now - (candles.get(candidate.mint)?.at ?? 0) >= refreshMs
        })
        .sort((first, second) => (candles.get(first.mint)?.at ?? 0) - (candles.get(second.mint)?.at ?? 0))[0]
      if (due) {
        candles.set(due.mint, { at: now, points: candles.get(due.mint)?.points ?? [] })
        try {
          const result = await fetchJson<Ohlcv>(`${geckoPools}/${due.pairAddress}/ohlcv/minute?aggregate=1&limit=${candleLimit}&currency=usd`, { retries: 0, timeoutMs: 8_000 })
          const points = minuteClosesFrom(result.data?.attributes?.ohlcv_list ?? [])
          candles.set(due.mint, { at: now, points })
          if (points.length) fetched += 1
          else missing += 1
        } catch (error) {
          const message = errorMessage(error)
          if (/429/.test(message)) {
            pausedUntil = Date.now() + pauseAfterLimitMs
            logger.warn('GeckoTerminal asked for fewer requests; pausing chart backfill')
          } else if (/404/.test(message)) missing += 1
        }
      }
      if (now - lastHeartbeat >= 15_000) {
        recordHeartbeat(database, 'chart-history', now < pausedUntil ? 'waiting' : 'ok', now < pausedUntil ? 'GeckoTerminal asked for a pause' : `${fetched} charts backfilled, ${missing} not on GeckoTerminal yet`)
        lastHeartbeat = now
        fetched = 0
        missing = 0
        for (const [mint, entry] of candles) if (now - entry.at > forgetAfterMs) candles.delete(mint)
      }
      await sleep(requestGapMs, signal)
    }
  })()
}
