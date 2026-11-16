import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { fetchMarketsForMints } from './dexscreener.js'
import { learnerState } from './learner-state.js'
import { createLogger, runLoop } from './runtime.js'
import { activeCandidates } from './state.js'

const logger = createLogger('follow-up')
const cycleMs = 5_000
const maxFollowed = 150

export function startFollowUp(database: TrackerDatabase, signal: AbortSignal) {
  const insert = database.prepare('INSERT INTO snapshots (mint, viewers, price_usd, market_cap, liquidity_usd, volume_5m, buys_5m, sells_5m, timestamp) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)')
  return runLoop('follow-up', cycleMs, async () => {
    const tracked = new Set(activeCandidates(database).map(candidate => candidate.mint))
    const open = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'coin_lifecycles'").get()
      ? (database.prepare("SELECT mint FROM coin_lifecycles WHERE outcome = 'open' ORDER BY first_seen_at DESC LIMIT ?").all(maxFollowed + tracked.size) as Array<{ mint: string }>).map(row => row.mint)
      : []
    const mints = open.filter(mint => !tracked.has(mint)).slice(0, maxFollowed)
    if (!mints.length) {
      recordHeartbeat(database, 'follow-up', 'ok', 'No coins to follow after the radar')
      return
    }
    const markets = await fetchMarketsForMints(mints, cycleMs)
    const now = Date.now()
    let saved = 0
    database.transaction(() => {
      for (const [mint, market] of markets) {
        if (!market.priceUsd || market.priceUsd <= 0) continue
        insert.run(mint, market.priceUsd, market.marketCap, market.liquidityUsd, market.volume5m, market.buys5m, market.sells5m, now)
        learnerState.followed.set(mint, { price: market.priceUsd, liquidity: market.liquidityUsd, marketCap: market.marketCap, at: now })
        saved += 1
      }
    })()
    for (const [mint, reading] of learnerState.followed) if (now - reading.at > 10 * 60_000) learnerState.followed.delete(mint)
    recordHeartbeat(database, 'follow-up', 'ok', `Following ${saved} coins after they left the radar`)
  }, logger, signal)
}
