import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { bestPairByMint, fetchPairsForMints } from './dexscreener.js'
import { poolShare, sharedAccounts } from './research-verdict.js'
import { createLogger, errorMessage, sleep } from './runtime.js'
import { associatedTokenAccount, token2022Program, tokenProgram } from './solana-address.js'
import { onPublicNode, solanaPausedUntil, solanaRpc } from './solana-rpc.js'

const logger = createLogger('wallet-pnl')

const solMint = 'So11111111111111111111111111111111111111112'
/** A token move with less SOL than this attached is a transfer, not a trade (fees and account rent stay under it). */
const tradeSol = 0.005
/** Wallets with more trades than this on one coin are bots; their history is skipped. */
const maximumTrades = 60
/** A coin's result counts only when transfers moved at most this share of the tokens; otherwise the profit is somewhere else. */
const movedShareLimit = 0.2
const pastsPerWallet = 8
const queueEveryMs = 60_000
const retryErrorsMs = 60 * 60_000
const solPriceEveryMs = 5 * 60_000

export const walletPnlSchema = `
CREATE TABLE IF NOT EXISTS wallet_pnl (
  wallet TEXT NOT NULL,
  mint TEXT NOT NULL,
  status TEXT NOT NULL,
  buy_sol REAL,
  sell_sol REAL,
  left_tokens REAL,
  profit_sol REAL,
  trades INTEGER,
  first_at INTEGER,
  last_at INTEGER,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (wallet, mint)
);
CREATE INDEX IF NOT EXISTS wallet_pnl_wallet ON wallet_pnl (wallet);
`

export type TradeKind = 'buy' | 'sell' | 'moved-in' | 'moved-out'
export type Trade = { at: number; sol: number; tokens: number; kind: TradeKind }
export type PairResult = { status: 'priced' | 'moved' | 'empty' | 'busy'; buySol: number; sellSol: number; leftTokens: number; profitSol: number | null; trades: number; firstAt: number | null; lastAt: number | null }

type TokenBalance = { owner?: string; mint?: string; uiTokenAmount?: { uiAmount?: number | null } }
export type ParsedTransaction = {
  blockTime?: number | null
  meta?: { err?: unknown; preBalances?: number[]; postBalances?: number[]; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null
  transaction?: { message?: { accountKeys?: Array<{ pubkey?: string } | string> } }
}

const amountOf = (balances: TokenBalance[] | undefined, owner: string, mint: string) =>
  (balances ?? []).filter(balance => balance.owner === owner && balance.mint === mint).reduce((total, balance) => total + (balance.uiTokenAmount?.uiAmount ?? 0), 0)

/** One transaction from the wallet's side: SOL in or out (wrapped SOL included) and the coin's tokens in or out. */
export function readTrade(transaction: ParsedTransaction, wallet: string, mint: string): Trade | null {
  const meta = transaction.meta
  if (!meta || meta.err) return null
  const keys = (transaction.transaction?.message?.accountKeys ?? []).map(key => typeof key === 'string' ? key : key.pubkey ?? '')
  const index = keys.indexOf(wallet)
  const lamports = index >= 0 ? (meta.postBalances?.[index] ?? 0) - (meta.preBalances?.[index] ?? 0) : 0
  const sol = lamports / 1e9 + amountOf(meta.postTokenBalances, wallet, solMint) - amountOf(meta.preTokenBalances, wallet, solMint)
  const tokens = amountOf(meta.postTokenBalances, wallet, mint) - amountOf(meta.preTokenBalances, wallet, mint)
  if (Math.abs(tokens) < 1e-9) return null
  const kind: TradeKind = tokens > 0 ? (sol <= -tradeSol ? 'buy' : 'moved-in') : (sol >= tradeSol ? 'sell' : 'moved-out')
  return { at: (transaction.blockTime ?? 0) * 1000, sol, tokens, kind }
}

/** Buy-in, sale proceeds and profit for one wallet on one coin. `priceSol` values whatever it still holds. */
export function summarize(trades: Trade[], priceSol: number | null): PairResult {
  let buySol = 0
  let sellSol = 0
  let traded = 0
  let moved = 0
  let left = 0
  for (const trade of trades) {
    left += trade.tokens
    if (trade.kind === 'buy') buySol -= trade.sol
    if (trade.kind === 'sell') sellSol += trade.sol
    if (trade.kind === 'buy' || trade.kind === 'sell') traded += Math.abs(trade.tokens)
    else moved += Math.abs(trade.tokens)
  }
  const stamps = trades.map(trade => trade.at).filter(Boolean)
  const base = { buySol, sellSol, leftTokens: Math.max(0, left), trades: trades.length, firstAt: stamps.length ? Math.min(...stamps) : null, lastAt: stamps.length ? Math.max(...stamps) : null }
  if (!trades.length) return { ...base, status: 'empty', profitSol: null }
  if (buySol <= 0 || moved > movedShareLimit * (traded + moved)) return { ...base, status: 'moved', profitSol: null }
  return { ...base, status: 'priced', profitSol: sellSol + Math.max(0, left) * (priceSol ?? 0) - buySol }
}

const mintPrograms = new Map<string, string>()

async function programOf(mint: string) {
  const known = mintPrograms.get(mint)
  if (known) return known
  const account = await solanaRpc<{ value?: { owner?: string } | null }>('getAccountInfo', [mint, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }], true)
  const program = account?.value?.owner === token2022Program ? token2022Program : tokenProgram
  mintPrograms.set(mint, program)
  return program
}

/** Reads every trade one wallet made in one coin from the wallet's token account for it, even after that account was closed. */
export async function fetchPair(wallet: string, mint: string, priceSol: number | null): Promise<PairResult> {
  const account = associatedTokenAccount(wallet, mint, await programOf(mint))
  const signatures = await solanaRpc<Array<{ signature: string; err: unknown }>>('getSignaturesForAddress', [account, { limit: maximumTrades + 1 }], true)
  if ((signatures ?? []).length > maximumTrades) return { status: 'busy', buySol: 0, sellSol: 0, leftTokens: 0, profitSol: null, trades: signatures.length, firstAt: null, lastAt: null }
  const trades: Trade[] = []
  for (const entry of (signatures ?? []).filter(item => !item.err)) {
    const transaction = await solanaRpc<ParsedTransaction | null>('getTransaction', [entry.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }], true)
    const trade = transaction ? readTrade(transaction, wallet, mint) : null
    if (trade) trades.push(trade)
  }
  return summarize(trades.sort((first, second) => first.at - second.at), priceSol)
}

export type WalletCoinProfit = { mint: string; buySol: number; profitSol: number }
export type WalletProfit = { coins: WalletCoinProfit[]; checked: number }

/** Every wallet's priced coins, and how many of its coins were looked at. */
export function loadWalletProfits(database: TrackerDatabase) {
  database.exec(walletPnlSchema)
  const profits = new Map<string, WalletProfit>()
  for (const row of database.prepare('SELECT wallet, mint, status, buy_sol, profit_sol FROM wallet_pnl').iterate() as Iterable<{ wallet: string; mint: string; status: string; buy_sol: number | null; profit_sol: number | null }>) {
    if (row.status === 'error') continue
    const entry = profits.get(row.wallet) ?? { coins: [], checked: 0 }
    entry.checked += 1
    if (row.status === 'priced' && row.buy_sol && row.profit_sol !== null) entry.coins.push({ mint: row.mint, buySol: row.buy_sol, profitSol: row.profit_sol })
    profits.set(row.wallet, entry)
  }
  return profits
}

let solUsd: number | null = null
export const solPriceUsd = () => solUsd

type QueueItem = { wallet: string; mint: string }

/**
 * Looks up what the wallets holding today's coins made on the coins they held before: total buy-in, sale proceeds and profit
 * per coin, in SOL. Biggest holders of live coins go first, and each wallet's most recent finished coins. Results for
 * finished coins never change, so each pair is read once (failures are retried after an hour).
 */
export function startWalletPnl(database: TrackerDatabase, signal: AbortSignal, walletBook: () => { pasts: Map<string, Array<{ mint: string; at: number }>> } | null) {
  database.exec(walletPnlSchema)
  const save = database.prepare('INSERT OR REPLACE INTO wallet_pnl (wallet, mint, status, buy_sol, sell_sol, left_tokens, profit_sol, trades, first_at, last_at, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const done = database.prepare('SELECT status, checked_at FROM wallet_pnl WHERE wallet = ? AND mint = ?')
  const lastPrice = database.prepare('SELECT last_price FROM coin_lifecycles WHERE mint = ?')
  let queue: QueueItem[] = []
  let queuedAt = 0
  let solCheckedAt = 0
  let lastHeartbeat = 0
  let priced = 0
  let read = 0
  let failed = 0

  const buildQueue = (now: number) => {
    const book = walletBook()
    if (!book) return []
    const holders = database.prepare(`
      SELECT h.wallet, MAX(h.pct) AS pct FROM holders h JOIN tokens t ON t.mint = h.mint
      WHERE t.last_seen_at >= ? AND h.pct >= 0.3 AND h.pct < ? GROUP BY h.wallet ORDER BY pct DESC LIMIT 600
    `).all(now - 90_000, poolShare) as Array<{ wallet: string }>
    const items: QueueItem[] = []
    for (const { wallet } of holders) {
      if (sharedAccounts.has(wallet)) continue
      const pasts = (book.pasts.get(wallet) ?? []).slice().sort((first, second) => second.at - first.at).slice(0, pastsPerWallet)
      for (const past of pasts) {
        const row = done.get(wallet, past.mint) as { status: string; checked_at: number } | undefined
        if (row && (row.status !== 'error' || now - row.checked_at < retryErrorsMs)) continue
        items.push({ wallet, mint: past.mint })
      }
    }
    return items
  }

  const refreshSolPrice = async (now: number) => {
    solCheckedAt = now
    try {
      const price = Number(bestPairByMint(await fetchPairsForMints([solMint])).get(solMint)?.priceUsd)
      if (Number.isFinite(price) && price > 0) solUsd = price
    } catch (error) {
      logger.warn('Could not read the SOL price', { error: errorMessage(error) })
    }
  }

  logger.info('Reading what holders made on their earlier coins', { node: onPublicNode() ? 'public (slow)' : 'private' })
  return (async () => {
    while (!signal.aborted) {
      const now = Date.now()
      if (now - solCheckedAt >= solPriceEveryMs) await refreshSolPrice(now)
      if (now - queuedAt >= queueEveryMs || !queue.length) {
        if (now - queuedAt >= 10_000) {
          queue = buildQueue(now)
          queuedAt = now
        }
      }
      const item = now >= solanaPausedUntil() ? queue.shift() : undefined
      if (item) {
        try {
          const usd = (lastPrice.get(item.mint) as { last_price: number } | undefined)?.last_price ?? null
          const result = await fetchPair(item.wallet, item.mint, usd !== null && solUsd ? usd / solUsd : null)
          save.run(item.wallet, item.mint, result.status, result.buySol, result.sellSol, result.leftTokens, result.profitSol, result.trades, result.firstAt, result.lastAt, Date.now())
          read += 1
          if (result.status === 'priced') priced += 1
        } catch (error) {
          failed += 1
          save.run(item.wallet, item.mint, 'error', null, null, null, null, null, null, null, Date.now())
          if (failed === 1) logger.warn('Could not read a wallet\'s trades', { wallet: item.wallet, mint: item.mint, error: errorMessage(error) })
        }
      } else {
        await sleep(1_000, signal)
      }
      if (now - lastHeartbeat >= 15_000) {
        const total = (database.prepare("SELECT COUNT(*) AS count FROM wallet_pnl WHERE status = 'priced'").get() as { count: number }).count
        recordHeartbeat(database, 'wallet-pnl', now < solanaPausedUntil() ? 'waiting' : 'ok', `${total} wallet-coin profits known; last 15 s read ${read} (${priced} priced${failed ? `, ${failed} failed` : ''}), ${queue.length} queued${onPublicNode() ? ' on the public node' : ''}`)
        lastHeartbeat = now
        read = 0
        priced = 0
        failed = 0
      }
    }
  })()
}
