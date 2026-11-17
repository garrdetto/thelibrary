import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { coinTradesKeepMs, ensureCoinTrades, pruneCoinTrades, recordTrades, type CoinTrade } from './coin-trades.js'
import { geckoAnswered, geckoCalled, geckoLimited, geckoReady } from './gecko-limit.js'
import { createLogger, errorMessage, fetchJson, HttpError, sleep } from './runtime.js'

const logger = createLogger('flip-traders')

const geckoPools = 'https://api.geckoterminal.com/api/v2/networks/solana/pools'
/** Trades under this many dollars are left out: they say nothing about a wallet and push real trades out of the 300 returned. */
export const minimumTradeUsd = 25
/** A position counts as flipped once at least this share of what was bought has been sold. */
export const flippedShare = 0.5
/** A flip closed within this long of the first buy is a quick flip. */
export const quickFlipMinutes = 30
/** The flip sampler takes a GeckoTerminal call at most this often, so discovery and chart backfill keep most of the budget. */
const sampleGapMs = 12_000
const coinGapMs = 75_000
const emptyBackoffMs = 10 * 60_000

type GeckoTrade = {
  attributes?: {
    tx_hash?: string
    tx_from_address?: string
    kind?: string
    block_timestamp?: string
    from_token_address?: string
    to_token_address?: string
    from_token_amount?: string
    to_token_amount?: string
    price_from_in_usd?: string
    price_to_in_usd?: string
    volume_in_usd?: string
    is_anomalous?: boolean
  }
}

const numberOf = (value: string | undefined) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** One pool's latest trades, as swaps of this coin. */
export function readGeckoTrades(rows: GeckoTrade[], mint: string): CoinTrade[] {
  const trades: CoinTrade[] = []
  for (const row of rows) {
    const trade = row.attributes
    if (!trade?.tx_hash || !trade.tx_from_address || trade.is_anomalous) continue
    const kind = trade.kind === 'buy' ? 'buy' : trade.kind === 'sell' ? 'sell' : null
    const usd = numberOf(trade.volume_in_usd)
    const at = Date.parse(trade.block_timestamp ?? '')
    if (!kind || usd === null || usd < minimumTradeUsd || !Number.isFinite(at)) continue
    const tokens = kind === 'buy'
      ? (trade.to_token_address === mint ? numberOf(trade.to_token_amount) : null)
      : (trade.from_token_address === mint ? numberOf(trade.from_token_amount) : null)
    const priceUsd = kind === 'buy' ? numberOf(trade.price_to_in_usd) : numberOf(trade.price_from_in_usd)
    if (tokens === null || tokens <= 0) continue
    trades.push({ tx: trade.tx_hash, mint, wallet: trade.tx_from_address, kind, usd, tokens, priceUsd, at, source: 'gecko' })
  }
  return trades
}

export type PairTotals = { buyUsd: number; buyTokens: number; sellUsd: number; sellTokens: number; firstBuyAt: number; lastSellAt: number | null }
export type Flip = { mint: string; buyUsd: number; profitUsd: number; holdMinutes: number | null; quick: boolean; source: 'trades' | 'stats' }

/**
 * One wallet's round trip in one coin from its observed trades, at its average buy price. Sells before its first seen buy
 * are left out (they were bought where nobody was watching). Null until it has sold at least half of what it bought.
 */
export function flipOf(mint: string, totals: PairTotals): Flip | null {
  if (totals.buyTokens <= 0 || totals.buyUsd <= 0 || totals.sellTokens <= 0) return null
  const matched = Math.min(totals.sellTokens, totals.buyTokens)
  if (matched / totals.buyTokens < flippedShare) return null
  const soldValue = totals.sellUsd * (matched / totals.sellTokens)
  const costOfSold = totals.buyUsd / totals.buyTokens * matched
  const profitUsd = soldValue - costOfSold
  const holdMinutes = totals.lastSellAt === null ? null : Math.max(0, (totals.lastSellAt - totals.firstBuyAt) / 60_000)
  return { mint, buyUsd: costOfSold, profitUsd, holdMinutes, quick: profitUsd > 0 && holdMinutes !== null && holdMinutes <= quickFlipMinutes, source: 'trades' }
}

export type FlipRecord = { flips: Flip[]; wins: number; quick: number; buyUsd: number; profitUsd: number }

export function flipRecord(flips: Flip[]): FlipRecord {
  return {
    flips,
    wins: flips.filter(flip => flip.profitUsd > 0).length,
    quick: flips.filter(flip => flip.quick).length,
    buyUsd: flips.reduce((sum, flip) => sum + flip.buyUsd, 0),
    profitUsd: flips.reduce((sum, flip) => sum + flip.profitUsd, 0),
  }
}

/**
 * How much a wallet's flips say about it: return on what it put in, size of its total profit ($1k counts about half,
 * $10k in full) and how often it wins, trusted more the more flips were seen. About -1.5 to +1.5.
 */
export function flipLift(record: FlipRecord | undefined, excludeMint?: string) {
  const flips = (record?.flips ?? []).filter(flip => flip.mint !== excludeMint)
  const buy = flips.reduce((sum, flip) => sum + flip.buyUsd, 0)
  if (!flips.length || buy <= 0) return 0
  const profit = flips.reduce((sum, flip) => sum + flip.profitUsd, 0)
  const wins = flips.filter(flip => flip.profitUsd > 0).length
  const returnLift = Math.max(-1.5, Math.min(1.5, Math.log(1 + Math.max(-0.95, profit / buy))))
  const sizeLift = Math.sign(profit) * Math.min(1, Math.log10(1 + Math.abs(profit) / 100) / 2)
  const winLift = (wins / flips.length - 0.5) * 2
  return (returnLift + sizeLift + winLift) / 3 * (flips.length / (flips.length + 2))
}

/**
 * Every wallet's flips over the last week: round trips from the trades seen, plus any totals a source reported for a
 * wallet in a coin (those replace the trade estimate for that coin).
 */
export function loadFlipBook(database: TrackerDatabase, now = Date.now()) {
  ensureCoinTrades(database)
  const since = now - coinTradesKeepMs
  const byWallet = new Map<string, Map<string, Flip>>()
  const trades = database.prepare('SELECT wallet, mint, kind, usd, tokens, at FROM coin_trades WHERE at >= ? ORDER BY wallet, mint, at').all(since) as Array<{ wallet: string; mint: string; kind: string; usd: number; tokens: number | null; at: number }>
  let current: { wallet: string; mint: string; totals: PairTotals | null } | null = null
  const finish = () => {
    const totals = current?.totals
    if (!current || !totals || totals.sellTokens <= 0) return
    const flip = flipOf(current.mint, totals)
    if (!flip) return
    const flips = byWallet.get(current.wallet) ?? new Map<string, Flip>()
    flips.set(current.mint, flip)
    byWallet.set(current.wallet, flips)
  }
  for (const trade of trades) {
    if (!current || current.wallet !== trade.wallet || current.mint !== trade.mint) {
      finish()
      current = { wallet: trade.wallet, mint: trade.mint, totals: null }
    }
    if (trade.kind === 'buy' && !current.totals) current.totals = { buyUsd: 0, buyTokens: 0, sellUsd: 0, sellTokens: 0, firstBuyAt: trade.at, lastSellAt: null }
    const totals = current.totals
    if (!totals || trade.tokens === null) continue
    if (trade.kind === 'buy') {
      totals.buyUsd += trade.usd
      totals.buyTokens += trade.tokens
    } else if (trade.kind === 'sell') {
      totals.sellUsd += trade.usd
      totals.sellTokens += trade.tokens
      totals.lastSellAt = trade.at
    }
  }
  finish()
  const stats = database.prepare('SELECT wallet, mint, bought_usd, profit_usd, first_at, at FROM wallet_coin_stats WHERE at >= ? AND bought_usd > 0 AND profit_usd IS NOT NULL').iterate(since) as Iterable<{ wallet: string; mint: string; bought_usd: number; profit_usd: number; first_at: number | null; at: number }>
  for (const row of stats) {
    const flips = byWallet.get(row.wallet) ?? new Map<string, Flip>()
    flips.set(row.mint, { mint: row.mint, buyUsd: row.bought_usd, profitUsd: row.profit_usd, holdMinutes: null, quick: false, source: 'stats' })
    byWallet.set(row.wallet, flips)
  }
  const book = new Map<string, FlipRecord>()
  for (const [wallet, flips] of byWallet) book.set(wallet, flipRecord([...flips.values()]))
  return book
}

export type RecentBuyer = { wallet: string; usd: number; at: number }

/** Wallets that bought this coin in the last `windowMs`, with how much. */
export function recentBuyers(database: TrackerDatabase, mint: string, now: number, windowMs = 10 * 60_000): RecentBuyer[] {
  ensureCoinTrades(database)
  return database.prepare("SELECT wallet, SUM(usd) AS usd, MAX(at) AS at FROM coin_trades WHERE mint = ? AND kind = 'buy' AND at >= ? GROUP BY wallet").all(mint, now - windowMs) as RecentBuyer[]
}

type Candidate = { mint: string; pair_address: string; volume: number | null }

/**
 * Reads the latest trades of the busiest coins being tracked from GeckoTerminal, so the tracker sees which wallets buy
 * early and sell into the run. A coin is read at most every 75 seconds; a pool GeckoTerminal does not list (coins still
 * on the bonding curve) is skipped for 10 minutes.
 */
export function startFlipTraders(database: TrackerDatabase, signal: AbortSignal) {
  ensureCoinTrades(database)
  const readAt = new Map<string, number>()
  const emptyUntil = new Map<string, number>()
  let lastSampleAt = 0
  let lastHeartbeat = 0
  let lastPrune = 0
  let reads = 0
  let added = 0
  let failed = 0

  const nextCoin = (now: number) => {
    const candidates = database.prepare(`
      SELECT t.mint, t.pair_address, (SELECT s.volume_5m FROM snapshots s WHERE s.mint = t.mint ORDER BY s.timestamp DESC LIMIT 1) AS volume
      FROM tokens t WHERE t.last_seen_at >= ? AND t.pair_address IS NOT NULL AND t.pair_address != ''
    `).all(now - 90_000) as Candidate[]
    return candidates
      .filter(coin => now - (readAt.get(coin.mint) ?? 0) >= coinGapMs && now >= (emptyUntil.get(coin.mint) ?? 0))
      .sort((first, second) => (second.volume ?? 0) - (first.volume ?? 0))[0] ?? null
  }

  logger.info('Reading pool trades to find quick-flip wallets')
  return (async () => {
    while (!signal.aborted) {
      const now = Date.now()
      const coin = now - lastSampleAt >= sampleGapMs && geckoReady(now) ? nextCoin(now) : null
      if (coin) {
        lastSampleAt = now
        readAt.set(coin.mint, now)
        geckoCalled(now)
        try {
          const response = await fetchJson<{ data?: GeckoTrade[] }>(`${geckoPools}/${coin.pair_address}/trades?trade_volume_in_usd_greater_than=${minimumTradeUsd}`, { retries: 0, timeoutMs: 15_000 })
          geckoAnswered()
          const trades = readGeckoTrades(response.data ?? [], coin.mint)
          if (!trades.length) emptyUntil.set(coin.mint, now + emptyBackoffMs)
          added += recordTrades(database, trades)
          reads += 1
        } catch (error) {
          failed += 1
          if (error instanceof HttpError && error.status === 429) geckoLimited()
          else if (error instanceof HttpError && error.status === 404) emptyUntil.set(coin.mint, now + emptyBackoffMs)
          else if (failed === 1) logger.warn('Could not read pool trades', { mint: coin.mint, error: errorMessage(error) })
        }
      } else {
        await sleep(1_000, signal)
      }
      if (now - lastPrune >= 60 * 60_000) {
        pruneCoinTrades(database, now)
        lastPrune = now
      }
      if (now - lastHeartbeat >= 30_000) {
        const total = (database.prepare('SELECT COUNT(*) AS count FROM coin_trades WHERE at >= ?').get(now - 60 * 60_000) as { count: number }).count
        recordHeartbeat(database, 'flip-traders', 'ok', `${reads} pools read, ${added} new trades in the last 30 s${failed ? `, ${failed} failed` : ''}; ${total} trades in the last hour`)
        lastHeartbeat = now
        reads = 0
        added = 0
        failed = 0
      }
    }
  })()
}
