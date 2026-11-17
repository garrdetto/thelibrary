import type { RadarWalletHolder, RadarWalletScore } from '../../src/lib/axiom-radar-types.js'
import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { poolShare, sharedAccounts } from './research-verdict.js'
import { createLogger, runLoop } from './runtime.js'
import { loadWalletProfits, solPriceUsd, type WalletCoinProfit, type WalletProfit } from './wallet-pnl.js'

const logger = createLogger('wallet-score')

/** Holdings under this share of supply, or under `tinyUsd`, say nothing about a wallet: anyone can buy a few dollars of everything. */
export const minimumStakePct = 0.3
export const tinyUsd = 100
/** A stake of this share of supply counts in full; smaller stakes count in proportion. */
export const fullStakePct = 2
/** A holder with this many dollars in the coin is a whale; when the market cap is unknown, one with this share of supply. */
export const whaleUsd = 1_000
export const whalePct = 2
/** How many past coins a wallet needs before its record counts in full, and how hard an unknown wallet is pulled toward the average. */
const fullRecordCoins = 3
const priorCoins = 3
const goodLift = 0.5
const badLift = -0.3
const scoreSpread = 2
const rebuildMs = 2 * 60_000

/** The same bar the winners study uses: grew at least 3x, to at least $50k, starting under $1M. */
const winMultiple = 3
const winPeakMcap = 50_000
const winStartLimit = 1_000_000
const winMultipleLimit = 1_000

export type WalletSighting = { wallet: string; mint: string; pct: number; at: number }
export type CoinResult = { mint: string; win: boolean; closed: boolean; peakAt: number; knownAt: number }
export type WalletPast = { mint: string; win: boolean; weight: number; at: number }
export type WalletBook = { pasts: Map<string, WalletPast[]>; profits: Map<string, WalletProfit>; baseRate: number; builtAt: number; wallets: number; coins: number }

type LifecycleRow = { mint: string; first_mcap: number | null; peak_mcap: number | null; peak_mcap_at: number | null; outcome: string; closed_at: number | null }

export function coinResult(row: LifecycleRow): CoinResult | null {
  if (!row.first_mcap || !row.peak_mcap) return null
  const multiple = row.peak_mcap / row.first_mcap
  const win = row.first_mcap < winStartLimit && row.peak_mcap >= winPeakMcap && multiple >= winMultiple && multiple <= winMultipleLimit
  const closed = row.outcome !== 'open'
  if (!win && !closed) return null
  const peakAt = row.peak_mcap_at ?? row.closed_at ?? 0
  return { mint: row.mint, win, closed, peakAt, knownAt: win ? peakAt : row.closed_at ?? peakAt }
}

const stakeWeight = (pct: number) => Math.min(1, pct / fullStakePct)
const countable = (wallet: string, pct: number | null): pct is number => pct !== null && Number.isFinite(pct) && pct >= minimumStakePct && pct < poolShare && !sharedAccounts.has(wallet)

/**
 * What each wallet did before: every coin it held a real stake in, and whether that coin went on to win. A win counts only
 * when the wallet already held before the peak, so buyers who arrived at the top earn nothing for it. Coins that ended
 * without winning (rugged, faded or flat) count against the wallet.
 */
export function buildWalletBook(sightings: WalletSighting[], results: CoinResult[], now: number, profits = new Map<string, WalletProfit>()): WalletBook {
  const known = new Map(results.filter(result => result.knownAt <= now).map(result => [result.mint, result]))
  const earliest = new Map<string, WalletSighting>()
  for (const sighting of sightings) {
    if (!countable(sighting.wallet, sighting.pct) || !known.has(sighting.mint)) continue
    const key = `${sighting.wallet}|${sighting.mint}`
    const previous = earliest.get(key)
    if (!previous || sighting.at < previous.at) earliest.set(key, sighting)
  }
  const pasts = new Map<string, WalletPast[]>()
  for (const sighting of earliest.values()) {
    const result = known.get(sighting.mint) as CoinResult
    if (result.win && sighting.at > result.peakAt) continue
    if (!result.win && !result.closed) continue
    const list = pasts.get(sighting.wallet) ?? []
    list.push({ mint: sighting.mint, win: result.win, weight: stakeWeight(sighting.pct), at: sighting.at })
    pasts.set(sighting.wallet, list)
  }
  const decided = [...known.values()].filter(result => result.win || result.closed)
  const wins = decided.filter(result => result.win).length
  const baseRate = decided.length >= 50 ? Math.min(0.3, Math.max(0.02, wins / decided.length)) : 0.06
  return { pasts, profits, baseRate, builtAt: now, wallets: pasts.size, coins: decided.length }
}

/**
 * How much a wallet's own trades say about it: the return on everything it put into its earlier coins and the size of its
 * total profit (10 SOL counts about half, 100 SOL in full), trusted more the more coins were priced.
 */
export function profitLift(coins: WalletCoinProfit[]) {
  const buy = coins.reduce((sum, coin) => sum + coin.buySol, 0)
  if (!coins.length || buy <= 0) return 0
  const profit = coins.reduce((sum, coin) => sum + coin.profitSol, 0)
  const returnLift = Math.max(-1.5, Math.min(1.5, Math.log(1 + Math.max(-0.95, profit / buy))))
  const sizeLift = Math.sign(profit) * Math.min(1, Math.log10(1 + Math.abs(profit)) / 2)
  return (returnLift + sizeLift) / 2 * (coins.length / (coins.length + 2))
}

type HolderRow = { wallet: string; pct: number | null; updated_at?: number }

const round2 = (value: number) => Math.round(value * 100) / 100
const money = (value: number) => value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `$${(value / 1_000).toFixed(1)}k` : `$${Math.round(value)}`

/**
 * The Wallet Score: 0 to 100, 50 when nobody holding has a record yet. Each holder with a real stake moves it by how much
 * better or worse than average the coins it held before did, scaled by the size of its stake and how many coins it has
 * been seen in. Tiny holders are left out. On the tracker's history, coins scoring 88+ grew 3x about 26% of the time
 * against 5.6% for all coins, and coins under 27 about 3%.
 */
export function scoreWallets(holders: HolderRow[], marketCap: number | null, book: WalletBook, mint: string, now: number): RadarWalletScore {
  let total = 0
  let counted = 0
  let known = 0
  let ignored = 0
  let whales = 0
  let goodWhales = 0
  let badWhales = 0
  let smartUsd = 0
  let smartPct = 0
  let bestEarner: { profitSol: number; buyInSol: number; coins: number } | null = null
  const rows: RadarWalletHolder[] = []
  const base = book.baseRate
  for (const holder of holders) {
    if (holder.pct === null || holder.pct >= poolShare || sharedAccounts.has(holder.wallet)) continue
    const usd = marketCap && marketCap > 0 ? holder.pct / 100 * marketCap : null
    if (holder.pct < minimumStakePct || (usd !== null && usd < tinyUsd)) {
      ignored += 1
      continue
    }
    counted += 1
    const whale = usd !== null ? usd >= whaleUsd : holder.pct >= whalePct
    if (whale) whales += 1
    const past = (book.pasts.get(holder.wallet) ?? []).filter(entry => entry.mint !== mint)
    const winsWeighted = past.reduce((sum, entry) => sum + (entry.win ? entry.weight : 0), 0)
    const seen = past.reduce((sum, entry) => sum + entry.weight, 0)
    const wins = past.filter(entry => entry.win).length
    const losses = past.length - wins
    const priced = (book.profits.get(holder.wallet)?.coins ?? []).filter(coin => coin.mint !== mint)
    const buyInSol = priced.reduce((sum, coin) => sum + coin.buySol, 0)
    const profitSol = priced.reduce((sum, coin) => sum + coin.profitSol, 0)
    let verdict: RadarWalletHolder['verdict'] = 'new'
    if (seen >= 0.5 || priced.length) {
      known += 1
      const rate = (winsWeighted + base * priorCoins) / (seen + priorCoins)
      const lift = (seen >= 0.5 ? Math.log(rate / base) * Math.min(1, seen / fullRecordCoins) : 0) + profitLift(priced)
      total += lift * stakeWeight(holder.pct)
      if (lift > goodLift) {
        verdict = 'good'
        goodWhales += 1
        smartPct += holder.pct
        if (usd !== null) smartUsd += usd
      } else if (lift < badLift) {
        verdict = 'bad'
        badWhales += 1
      } else verdict = 'mixed'
    }
    if (priced.length && (!bestEarner || profitSol > bestEarner.profitSol)) bestEarner = { profitSol, buyInSol, coins: priced.length }
    rows.push({ wallet: holder.wallet, pct: Math.round(holder.pct * 100) / 100, usd: usd === null ? null : Math.round(usd), wins, losses, verdict, whale, pricedCoins: priced.length, buyInSol: priced.length ? round2(buyInSol) : null, profitSol: priced.length ? round2(profitSol) : null })
  }
  const score = Math.round(50 + 50 * Math.tanh(total / scoreSpread))
  const order = { good: 0, bad: 1, mixed: 2, new: 3 }
  rows.sort((first, second) => order[first.verdict] - order[second.verdict] || second.pct - first.pct)
  const parts: string[] = []
  if (goodWhales) parts.push(`${goodWhales === 1 ? '1 holder with a winning record holds' : `${goodWhales} holders with winning records hold`} ${smartPct.toFixed(1)}%${smartUsd ? ` (${money(smartUsd)})` : ''}`)
  if (badWhales) parts.push(`${badWhales} tied to coins that died`)
  if (!parts.length) parts.push(known ? `${known} holder${known === 1 ? ' has' : 's have'} a mixed record` : counted ? `none of the ${counted} holder${counted === 1 ? '' : 's'} with a real stake has a record yet` : 'no holder with a real stake yet')
  if (bestEarner) {
    const outcome = Math.abs(bestEarner.profitSol) < 0.05 ? 'broke even' : `${bestEarner.profitSol > 0 ? 'made' : 'lost'} ${Math.abs(bestEarner.profitSol).toFixed(1)} SOL`
    parts.push(`its best trader ${outcome} on ${bestEarner.coins} earlier coin${bestEarner.coins === 1 ? '' : 's'} (put in ${bestEarner.buyInSol.toFixed(1)} SOL)`)
  }
  if (whales) parts.push(`${whales} whale${whales === 1 ? '' : 's'}`)
  if (ignored) parts.push(`${ignored} tiny holder${ignored === 1 ? '' : 's'} ignored`)
  const checkedAt = holders.reduce((latest, holder) => Math.max(latest, holder.updated_at ?? 0), 0)
  return {
    score,
    holders: counted,
    known,
    whales,
    goodWhales,
    badWhales,
    smartUsd: smartUsd ? Math.round(smartUsd) : null,
    smartPct: Math.round(smartPct * 10) / 10,
    bestProfitSol: bestEarner ? round2(bestEarner.profitSol) : null,
    solUsd: solPriceUsd(),
    ignored,
    top: rows.slice(0, 3),
    summary: parts.join('; '),
    checkedAt: checkedAt || null,
    at: now,
  }
}

let book: WalletBook | null = null

export function walletBook() {
  return book
}

export function loadWalletBook(database: TrackerDatabase, now = Date.now()) {
  const results = (database.prepare('SELECT mint, first_mcap, peak_mcap, peak_mcap_at, outcome, closed_at FROM coin_lifecycles').all() as LifecycleRow[])
    .map(coinResult).filter((result): result is CoinResult => result !== null)
  const sightings: WalletSighting[] = []
  const hasBursts = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'radar_burst_wallets'").get())
  if (hasBursts) {
    for (const row of database.prepare('SELECT w.wallet, w.mint, w.pct, b.started_at AS at FROM radar_burst_wallets w JOIN radar_bursts b ON b.id = w.burst_id WHERE w.pct IS NOT NULL').iterate() as Iterable<WalletSighting>) sightings.push(row)
  }
  for (const row of database.prepare('SELECT wallet, mint, pct, updated_at AS at FROM holders WHERE pct IS NOT NULL').iterate() as Iterable<WalletSighting>) sightings.push(row)
  book = buildWalletBook(sightings, results, now, loadWalletProfits(database))
  return book
}

/** The Wallet Score of one coin from its latest top holders, or null before any holders are read or the book is built. */
export function walletScoreFor(database: TrackerDatabase, mint: string, marketCap: number | null, now: number): RadarWalletScore | null {
  if (!book) return null
  const holders = database.prepare('SELECT wallet, pct, updated_at FROM holders WHERE mint = ?').all(mint) as HolderRow[]
  if (!holders.length) return null
  return scoreWallets(holders, marketCap, book, mint, now)
}

/** Rebuilds the wallet records every two minutes: they come from finished coins, which change far slower than prices. */
export function startWalletScores(database: TrackerDatabase, signal: AbortSignal) {
  return runLoop('wallet-score', rebuildMs, async () => {
    const started = Date.now()
    const built = loadWalletBook(database, started)
    recordHeartbeat(database, 'wallet-score', 'ok', `${built.wallets} wallets with a record from ${built.coins} finished coins, ${built.profits.size} with trades read (${Date.now() - started} ms)`)
  }, logger, signal)
}
