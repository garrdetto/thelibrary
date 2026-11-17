import type { TrackerDatabase } from './db.js'
import { recordTrades, recordWalletStats, type CoinTrade, type WalletCoinStat } from './coin-trades.js'
import type { PageStats } from './page-stats.js'
import { solanaAddressPattern } from './runtime.js'
import { isWalletAddress } from './solana-rpc.js'
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

type Row = Record<string, unknown>
export type HolderRow = { wallet: string; pct: number | null }

const walletKey = /wallet|owner|holder|address|maker|trader|user|account/i
const notWalletKey = /token|mint|pair|pool|fund|creator|dev/i
const isAddress = (value: unknown): value is string => typeof value === 'string' && solanaAddressPattern.test(value)

/** Every array of objects in an answer, up to four levels down. */
function objectLists(body: unknown, depth = 0, found: Row[][] = []): Row[][] {
  if (depth > 4 || !body || typeof body !== 'object') return found
  if (Array.isArray(body)) {
    const rows = body.filter((item): item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    if (rows.length) found.push(rows)
    for (const item of rows.slice(0, 3)) objectLists(item, depth + 1, found)
    return found
  }
  for (const value of Object.values(body as Row)) objectLists(value, depth + 1, found)
  return found
}

function walletOf(row: Row) {
  for (const [key, value] of Object.entries(row)) if (walletKey.test(key) && !notWalletKey.test(key) && isAddress(value)) return value
  return null
}

function numberAt(row: Row, matches: (key: string) => boolean) {
  for (const [key, value] of Object.entries(row)) {
    const number = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(value) ? Number(value) : NaN
    if (Number.isFinite(number) && matches(key)) return number
  }
  return null
}

const pctKey = (key: string) => /percent|pct|share|ratio/i.test(key) && !/change|price|sol|usd|bought|sold|buy|sell|pnl|profit/i.test(key)
const moneyKey = (words: RegExp) => (key: string) => words.test(key) && /usd/i.test(key) && !/price|count|tx|num/i.test(key)
const boughtKey = moneyKey(/buy|bought|invest|spent|cost/i)
const soldKey = moneyKey(/sell|sold/i)
const profitKey = (key: string) => /pnl|profit/i.test(key) && !/percent|pct|ratio|sol|native|unrealized/i.test(key)
const firstKey = (key: string) => /first.*(buy|at|time)|first(buy|trade)/i.test(key)

/** The biggest list in an answer whose rows each name a wallet and carry a figure `pick` finds. */
function bestList<T>(body: unknown, pick: (row: Row, wallet: string) => T | null) {
  let best: T[] = []
  for (const rows of objectLists(body)) {
    const picked: T[] = []
    for (const row of rows.slice(0, 500)) {
      const wallet = walletOf(row)
      const value = wallet ? pick(row, wallet) : null
      if (value) picked.push(value)
    }
    if (picked.length > best.length) best = picked
  }
  return best
}

/** The holders list in an Axiom answer: each wallet with its share of the supply, in percent. */
export function holdersFrom(body: unknown): HolderRow[] {
  const rows = bestList(body, (row, wallet) => {
    const pct = numberAt(row, pctKey)
    return pct === null ? null : { wallet, pct }
  })
  if (rows.length < 3) return []
  const total = rows.reduce((sum, row) => sum + row.pct, 0)
  const fraction = total <= 1.0001 && rows.every(row => row.pct <= 1)
  return rows.map(row => ({ wallet: row.wallet, pct: Math.max(0, Math.min(100, row.pct * (fraction ? 100 : 1))) }))
}

/** The top traders list in an Axiom answer: what each wallet put in, took out and made on the coin, in dollars. */
export function tradersFrom(body: unknown, mint: string, now: number): WalletCoinStat[] {
  const rows = bestList(body, (row, wallet): WalletCoinStat | null => {
    const boughtUsd = numberAt(row, boughtKey)
    const soldUsd = numberAt(row, soldKey)
    let profitUsd = numberAt(row, key => profitKey(key) && /usd/i.test(key)) ?? numberAt(row, profitKey)
    if (profitUsd === null && boughtUsd !== null && soldUsd !== null) profitUsd = soldUsd - boughtUsd
    if (boughtUsd === null && soldUsd === null && profitUsd === null) return null
    const first = Object.entries(row).find(([key]) => firstKey(key))?.[1]
    const firstAt = typeof first === 'number' ? (first < 1e12 ? first * 1000 : first) : typeof first === 'string' ? Date.parse(first) : NaN
    return { wallet, mint, source: 'axiom-top-traders', boughtUsd, soldUsd, profitUsd, holdingPct: numberAt(row, pctKey), firstAt: Number.isFinite(firstAt) ? firstAt : null, at: now }
  })
  return rows.length >= 3 ? rows : []
}

export function mintForPair(database: TrackerDatabase, pair: string) {
  const row = database.prepare('SELECT mint FROM tokens WHERE pair_address = ? OR mint = ? LIMIT 1').get(pair, pair) as { mint: string } | undefined
  return row?.mint ?? null
}

/** Replaces a coin's holders with this list, leaving out the pair, the pool and the bonding curve (off-curve or over 25%). */
export function saveHolderList(database: TrackerDatabase, mint: string, pair: string | null, rows: HolderRow[], now = Date.now()) {
  const kept = rows.filter(row => row.wallet !== pair && row.wallet !== mint && (row.pct ?? 0) <= 25 && isWalletAddress(row.wallet)).slice(0, 150)
  if (kept.length < 3) return 0
  database.transaction(() => {
    database.prepare('DELETE FROM holders WHERE mint = ?').run(mint)
    const insert = database.prepare('INSERT OR REPLACE INTO holders (mint, wallet, pct, updated_at) VALUES (?, ?, ?, ?)')
    for (const row of kept) insert.run(mint, row.wallet, row.pct, now)
  })()
  return kept.length
}

/** Records what one captured answer says: new trades, holder figures, a holders list and top-trader rows. */
export function readAxiomAnswer(database: TrackerDatabase, path: string, pair: string | null, body: unknown, now = Date.now()) {
  let trades = 0
  let holders = false
  let holderList = 0
  let traderRows = 0
  const found = tradesFrom(path, body)
  if (found.length) trades = recordTrades(database, found)
  const mint = pair ? mintForPair(database, pair) : null
  if (path === '/token-info-v2' && mint) {
    const stats = holderStatsFrom(body, now)
    if (stats) {
      trackerState.pageStats.set(mint, stats)
      holders = true
    }
  }
  if (mint && /holder/i.test(path)) holderList = saveHolderList(database, mint, pair, holdersFrom(body), now)
  if (mint && /top-?trader/i.test(path)) {
    const stats = tradersFrom(body, mint, now)
    if (stats.length) recordWalletStats(database, stats)
    traderRows = stats.length
  }
  return { trades, holders, holderList, traderRows }
}
