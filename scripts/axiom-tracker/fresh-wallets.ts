import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { learnerState } from './learner-state.js'
import { poolShare, sharedAccounts } from './research-verdict.js'
import { createLogger, errorMessage, fetchJson, sleep } from './runtime.js'
import { noteSolanaLimit, paceSolana, rpcUrl } from './solana-rpc.js'
import { radarSettings } from './settings-store.js'
import { activeCandidates } from './state.js'

const logger = createLogger('fresh-wallets')

/** A wallet is fresh when its whole history is short (under `pageSize` transactions) and began less than this long before the coin launched, or after it. */
export const freshWindowMs = 24 * 60 * 60_000
export const minimumFreshHolders = 5
const holdersPerCoin = 20
const pageSize = 250
const importantEveryMs = 5_000
const othersEveryMs = 5_000
const winnerRetryMs = 10 * 60_000
const pauseAfterLimitMs = 30_000
const idleMs = 1_000

const freshSchema = `
CREATE TABLE IF NOT EXISTS wallet_starts (
  wallet TEXT PRIMARY KEY,
  oldest_at INTEGER,
  complete INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);
`

export type WalletStart = { oldestAt: number | null; complete: boolean }
export type HolderShare = { wallet: string; pct: number | null }

/** True when the wallet is fresh for a coin launched at `launchedAt`, false when it is older or has a long history, null when unknown. */
export function walletFreshness(start: WalletStart | undefined, launchedAt: number): boolean | null {
  if (!start) return null
  if (!start.complete) return false
  if (start.oldestAt === null) return null
  return start.oldestAt >= launchedAt - freshWindowMs
}

/** The share of supply the fresh wallets among a coin's top holders own, or null when too few holders could be checked. */
export function freshShare(holders: HolderShare[], starts: Map<string, WalletStart>, launchedAt: number): number | null {
  let decided = 0
  let fresh = 0
  for (const holder of holders) {
    const verdict = walletFreshness(starts.get(holder.wallet), launchedAt)
    if (verdict === null) continue
    decided += 1
    if (verdict) fresh += holder.pct ?? 0
  }
  return decided >= minimumFreshHolders ? Math.round(fresh * 100) / 100 : null
}

type SignaturePage = { result?: Array<{ signature: string; blockTime: number | null }>; error?: { message?: string } }

async function paced<T>(work: () => Promise<T>) {
  await paceSolana('getSignaturesForAddress')
  try {
    return await work()
  } catch (error) {
    noteSolanaLimit(errorMessage(error))
    throw error
  }
}

/** Reads up to `pageSize` of a wallet's latest transactions: a shorter history is complete and shows when the wallet began. */
async function lookUpWallet(wallet: string): Promise<WalletStart> {
  const response = await paced(() => fetchJson<SignaturePage>(rpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [wallet, { limit: pageSize }] }),
    retries: 0,
    timeoutMs: 20_000,
  }))
  if (response.error || !response.result) throw new Error(response.error?.message ?? 'Wallet history was not returned')
  let oldestAt: number | null = null
  for (const entry of response.result) if (entry.blockTime) oldestAt = Math.min(oldestAt ?? Infinity, entry.blockTime * 1_000)
  return { oldestAt, complete: response.result.length < pageSize }
}

const isWinnerRow = `l.first_mcap > 0 AND l.first_mcap < 1000000 AND l.peak_mcap >= 50000 AND l.peak_mcap >= l.first_mcap * 3 AND l.peak_mcap <= l.first_mcap * 1000`

/**
 * Checks how much of each coin the fresh wallets hold, from the age of its top holders' wallets. The coins being recommended
 * are re-checked about every 45 seconds and the rest every 3 minutes; wallets are remembered, so a re-check only looks up
 * holders it has not seen. Coins that grew but were never checked are filled in from their saved holders when nothing live is due.
 */
export function startFreshWallets(database: TrackerDatabase, signal: AbortSignal) {
  database.exec(freshSchema)
  const cachedStart = database.prepare('SELECT oldest_at, complete, checked_at FROM wallet_starts WHERE wallet = ?')
  const saveStart = database.prepare('INSERT OR REPLACE INTO wallet_starts (wallet, oldest_at, complete, checked_at) VALUES (?, ?, ?, ?)')
  const liveHolders = database.prepare('SELECT wallet, pct FROM holders WHERE mint = ? AND (pct IS NULL OR pct < ?) ORDER BY pct DESC')
  const winnerTable = () => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'winner_wallets'").get())
  const launchOf = database.prepare('SELECT pair_created_at FROM tokens WHERE mint = ?')
  const saveShare = database.prepare('UPDATE tokens SET fresh_pct = COALESCE(?, fresh_pct), fresh_checked_at = ? WHERE mint = ?')
  const checkedAt = new Map<string, number>()
  let pausedUntil = 0
  let lastHeartbeat = 0
  let coins = 0
  let lookups = 0
  let failed = 0

  const holdersFor = (mint: string) => {
    let rows = liveHolders.all(mint, poolShare) as HolderShare[]
    if (rows.length < minimumFreshHolders && winnerTable()) rows = database.prepare('SELECT wallet, pct FROM winner_wallets WHERE mint = ? AND (pct IS NULL OR pct < ?) ORDER BY pct DESC').all(mint, poolShare) as HolderShare[]
    return rows.filter(holder => !sharedAccounts.has(holder.wallet)).slice(0, holdersPerCoin)
  }

  const nextCoin = (now: number) => {
    const important = new Set<string>([...(learnerState.explosions?.candidates ?? []), ...(learnerState.winners?.candidates ?? []), ...(learnerState.summary?.earlyPicks ?? []), ...radarSettings().pinned])
    let pick: string | null = null
    let worst = 0
    for (const candidate of activeCandidates(database)) {
      const target = important.has(candidate.mint) ? importantEveryMs : othersEveryMs
      const overdue = (now - (checkedAt.get(candidate.mint) ?? 0)) / target
      if (overdue >= 1 && overdue > worst) { worst = overdue; pick = candidate.mint }
    }
    if (pick) return pick
    const unchecked = database.prepare(`SELECT l.mint FROM coin_lifecycles l JOIN tokens t ON t.mint = l.mint WHERE t.fresh_pct IS NULL AND ${isWinnerRow} ORDER BY l.peak_mcap DESC LIMIT 50`).all() as Array<{ mint: string }>
    return unchecked.find(row => now - (checkedAt.get(row.mint) ?? 0) >= winnerRetryMs)?.mint ?? null
  }

  const checkCoin = async (mint: string, now: number) => {
    const launchedAt = (launchOf.get(mint) as { pair_created_at: number } | undefined)?.pair_created_at ?? now
    const holders = holdersFor(mint)
    const starts = new Map<string, WalletStart>()
    for (const holder of holders) {
      if (signal.aborted) return
      const cached = cachedStart.get(holder.wallet) as { oldest_at: number | null; complete: number } | undefined
      if (cached) { starts.set(holder.wallet, { oldestAt: cached.oldest_at, complete: cached.complete === 1 }); continue }
      const start = await lookUpWallet(holder.wallet)
      lookups += 1
      saveStart.run(holder.wallet, start.oldestAt, start.complete ? 1 : 0, Date.now())
      starts.set(holder.wallet, start)
    }
    saveShare.run(freshShare(holders, starts, launchedAt), Date.now(), mint)
    coins += 1
  }

  logger.info('Checking fresh wallets among top holders')
  return (async () => {
    while (!signal.aborted) {
      const now = Date.now()
      const mint = now >= pausedUntil ? nextCoin(now) : null
      if (mint) {
        checkedAt.set(mint, now)
        try {
          await checkCoin(mint, now)
        } catch (error) {
          failed += 1
          const message = errorMessage(error)
          if (/429|rate|too many/i.test(message)) {
            pausedUntil = Date.now() + pauseAfterLimitMs
            logger.warn('The Solana node asked for fewer requests; pausing fresh-wallet checks for 30 seconds')
          }
        }
      } else {
        await sleep(idleMs, signal)
      }
      if (now - lastHeartbeat >= 15_000) {
        recordHeartbeat(database, 'fresh-wallets', now < pausedUntil ? 'waiting' : 'ok', now < pausedUntil ? 'The Solana node asked for a pause' : `${coins} coins and ${lookups} wallets checked${failed ? `, ${failed} failed` : ''}`)
        lastHeartbeat = now
        coins = 0
        lookups = 0
        failed = 0
        for (const key of checkedAt.keys()) if (now - (checkedAt.get(key) ?? 0) > 30 * 60_000) checkedAt.delete(key)
      }
    }
  })()
}
