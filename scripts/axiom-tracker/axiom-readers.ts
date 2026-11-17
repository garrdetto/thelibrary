import type { TrackerDatabase } from './db.js'
import { recordTrades, type CoinTrade } from './coin-trades.js'
import type { PageStats } from './page-stats.js'
import { solanaAddressPattern } from './runtime.js'
import { trackerState } from './state.js'

/**
 * Turns the Axiom answers the bridge captures into the tracker's own records: every swap in a coin's trades feed, sniper list
 * and tracked-trader feed into `coin_trades` (source `axiom-trades`), and the exact holder shares from `/token-info-v2` into
 * the coin's page figures, the same figures the bridge used to read off the page.
 */

type AxiomTrade = {
  signature?: unknown
  createdAt?: unknown
  type?: unknown
  tokenAddress?: unknown
  walletAddress?: unknown
  transactionPriceUsd?: unknown
  amountToken?: unknown
}

type HolderStats = {
  top10HoldersPercent?: unknown
  devHoldsPercent?: unknown
  snipersHoldPercent?: unknown
  insidersHoldPercent?: unknown
  bundlersHoldPercent?: unknown
  freshWalletsHoldPercent?: unknown
  proTradersHoldPercent?: unknown
}

export const tradePaths = new Set(['/transactions-feed', '/transactions-from-traders', '/sniper-transactions'])

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
const share = (value: unknown) => {
  const number = finite(value)
  return number === null ? null : Math.max(0, Math.min(100, number))
}

function tradeRows(path: string, body: unknown): AxiomTrade[] {
  if (Array.isArray(body)) return body as AxiomTrade[]
  if (path === '/sniper-transactions' && body && typeof body === 'object') {
    const lists = body as { instant?: unknown; early?: unknown }
    return [...(Array.isArray(lists.instant) ? lists.instant : []), ...(Array.isArray(lists.early) ? lists.early : [])] as AxiomTrade[]
  }
  return []
}

/** The buys and sells in one Axiom trades answer; liquidity adds and removes are left out. */
export function tradesFrom(path: string, body: unknown): CoinTrade[] {
  if (!tradePaths.has(path)) return []
  const trades: CoinTrade[] = []
  for (const row of tradeRows(path, body)) {
    if (!row || typeof row !== 'object') continue
    const kind = row.type === 'buy' || row.type === 'sell' ? row.type : null
    const mint = typeof row.tokenAddress === 'string' && solanaAddressPattern.test(row.tokenAddress) ? row.tokenAddress : null
    const wallet = typeof row.walletAddress === 'string' && solanaAddressPattern.test(row.walletAddress) ? row.walletAddress : null
    const at = typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : NaN
    const tokens = finite(row.amountToken)
    const priceUsd = finite(row.transactionPriceUsd)
    if (!kind || !mint || !wallet || !Number.isFinite(at) || typeof row.signature !== 'string' || !row.signature) continue
    trades.push({ tx: row.signature, mint, wallet, kind, usd: tokens !== null && priceUsd !== null ? Math.round(tokens * priceUsd * 100) / 100 : 0, tokens, priceUsd, at, source: 'axiom-trades' })
  }
  return trades
}

/** Axiom's exact holder shares for a coin, in the shape the page figures use. */
export function holderStatsFrom(body: unknown, seenAt: number): PageStats | null {
  const stats = (body as { holderStats?: HolderStats } | null)?.holderStats
  if (!stats || typeof stats !== 'object') return null
  const result: PageStats = {
    top10: share(stats.top10HoldersPercent),
    dev: share(stats.devHoldsPercent),
    snipers: share(stats.snipersHoldPercent),
    insiders: share(stats.insidersHoldPercent),
    bundlers: share(stats.bundlersHoldPercent),
    fresh: share(stats.freshWalletsHoldPercent),
    proTraders: share(stats.proTradersHoldPercent),
    labels: ['axiom token-info-v2'],
    seenAt,
  }
  const known = [result.top10, result.dev, result.snipers, result.insiders, result.bundlers, result.fresh, result.proTraders].filter(value => value !== null).length
  return known >= 2 ? result : null
}

/** Records what one captured answer says. Returns how many new trades it added and whether it gave holder figures. */
export function readAxiomAnswer(database: TrackerDatabase, path: string, pair: string | null, body: unknown, now = Date.now()) {
  let trades = 0
  let holders = false
  const found = tradesFrom(path, body)
  if (found.length) trades = recordTrades(database, found)
  if (path === '/token-info-v2' && pair) {
    const stats = holderStatsFrom(body, now)
    const row = database.prepare('SELECT mint FROM tokens WHERE pair_address = ? OR mint = ? LIMIT 1').get(pair, pair) as { mint: string } | undefined
    if (stats && row) {
      trackerState.pageStats.set(row.mint, stats)
      holders = true
    }
  }
  return { trades, holders }
}
