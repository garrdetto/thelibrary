import { openTrackerDatabase, recordHeartbeat, type TrackerDatabase } from './db.js'
import { bestPairByMint, fetchPairsForMints, socialsOf } from './dexscreener.js'
import { chunk, createLogger, errorMessage, fetchJson, isMainModule, runLoop, solanaAddressPattern, trackerConfig } from './runtime.js'
import { latestMarket, trackerState } from './state.js'
import { radarSettings } from './settings-store.js'

const logger = createLogger('wallet-tracker')
const heliusApi = process.env.HELIUS_API_BASE ?? 'https://api.helius.xyz'
const ignoredMints = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
])
const earlyBuyerLimit = 40
const earlySignatureLimit = 150
const signaturePageLimit = 8
const runnerScansPerCycle = 2
const walletsPerSwapCycle = 10

type SignatureInfo = { signature: string; err: unknown; blockTime: number | null }
type TokenTransfer = { fromUserAccount?: string; toUserAccount?: string; mint?: string; tokenAmount?: number }
type EnhancedTransaction = { signature: string; timestamp?: number; type?: string; feePayer?: string; tokenTransfers?: TokenTransfer[]; transactionError?: unknown }
type RunnerCandidate = { mint: string; pair_address: string; first_price: number | null; latest_price: number | null; latest_mcap: number | null }

function heliusKey() {
  return process.env.HELIUS_API_KEY?.trim() || null
}

function rpcUrl(key: string) {
  return process.env.SOLANA_RPC_URL?.trim() || `https://mainnet.helius-rpc.com/?api-key=${key}`
}

async function rpc<T>(key: string, method: string, params: unknown[]) {
  const result = await fetchJson<{ result?: T; error?: { message?: string } }>(rpcUrl(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    timeoutMs: 20_000,
  })
  if (result.error) throw new Error(result.error.message ?? `RPC ${method} failed`)
  return result.result as T
}

async function parseTransactions(key: string, signatures: string[]) {
  const parsed: EnhancedTransaction[] = []
  for (const group of chunk(signatures, 100)) {
    const result = await fetchJson<EnhancedTransaction[]>(`${heliusApi}/v0/transactions?api-key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: group }),
      timeoutMs: 30_000,
    })
    if (Array.isArray(result)) parsed.push(...result)
  }
  return parsed
}

export async function earliestSignatures(key: string, address: string) {
  const collected: SignatureInfo[] = []
  let before: string | undefined
  for (let page = 0; page < signaturePageLimit; page++) {
    const batch = await rpc<SignatureInfo[]>(key, 'getSignaturesForAddress', [address, { limit: 1000, ...(before ? { before } : {}) }])
    if (!batch?.length) break
    collected.push(...batch)
    before = batch.at(-1)?.signature
    if (batch.length < 1000) break
  }
  return collected.reverse().filter(item => !item.err).slice(0, earlySignatureLimit).map(item => item.signature)
}

export function earlyBuyersFrom(transactions: EnhancedTransaction[], mint: string, excluded: Set<string>) {
  const buyers: string[] = []
  const ordered = transactions.slice().sort((first, second) => (first.timestamp ?? 0) - (second.timestamp ?? 0))
  for (const transaction of ordered) {
    if (transaction.transactionError) continue
    for (const transfer of transaction.tokenTransfers ?? []) {
      const buyer = transfer.toUserAccount
      if (transfer.mint !== mint || !buyer || excluded.has(buyer) || buyer === transfer.fromUserAccount) continue
      if (transaction.feePayer !== buyer || buyers.includes(buyer)) continue
      buyers.push(buyer)
      if (buyers.length >= earlyBuyerLimit) return buyers
    }
  }
  return buyers
}

function runnerCandidates(database: TrackerDatabase) {
  return database.prepare(`
    SELECT t.mint, t.pair_address,
      (SELECT s.price_usd FROM snapshots s WHERE s.mint = t.mint AND s.price_usd IS NOT NULL ORDER BY s.timestamp ASC LIMIT 1) AS first_price,
      (SELECT s.price_usd FROM snapshots s WHERE s.mint = t.mint AND s.price_usd IS NOT NULL ORDER BY s.timestamp DESC LIMIT 1) AS latest_price,
      (SELECT s.market_cap FROM snapshots s WHERE s.mint = t.mint ORDER BY s.timestamp DESC LIMIT 1) AS latest_mcap
    FROM tokens t
    WHERE t.last_seen_at >= ? AND NOT EXISTS (SELECT 1 FROM runner_scans r WHERE r.mint = t.mint)
  `).all(Date.now() - 24 * 60 * 60_000) as RunnerCandidate[]
}

async function scanRunners(database: TrackerDatabase, key: string) {
  const runners = runnerCandidates(database).filter(candidate =>
    (candidate.latest_mcap ?? 0) >= trackerConfig.runnerMarketCap
    || (candidate.first_price && candidate.latest_price && candidate.latest_price >= candidate.first_price * trackerConfig.runnerMultiple),
  ).slice(0, runnerScansPerCycle)
  for (const runner of runners) {
    const signatures = await earliestSignatures(key, runner.mint)
    const buyers = earlyBuyersFrom(await parseTransactions(key, signatures), runner.mint, new Set([runner.pair_address, runner.mint]))
    const now = Date.now()
    const upsert = database.prepare(`
      INSERT INTO smart_wallets (wallet, runner_hits, last_hit_mint, updated_at) VALUES (?, 1, ?, ?)
      ON CONFLICT (wallet) DO UPDATE SET runner_hits = smart_wallets.runner_hits + 1, last_hit_mint = excluded.last_hit_mint, updated_at = excluded.updated_at
    `)
    database.transaction(() => {
      for (const buyer of buyers) upsert.run(buyer, runner.mint, now)
      database.prepare('INSERT OR REPLACE INTO runner_scans (mint, buyers_found, scanned_at) VALUES (?, ?, ?)').run(runner.mint, buyers.length, now)
    })()
    logger.info('Recorded early buyers of runner', { mint: runner.mint, signatures: signatures.length, buyers: buyers.length })
  }
  return runners.length
}

async function ensureYoungTokens(database: TrackerDatabase, mints: string[]) {
  const known = new Map<string, number>()
  const lookup = database.prepare('SELECT pair_created_at FROM tokens WHERE mint = ?')
  const unknown: string[] = []
  for (const mint of mints) {
    const row = lookup.get(mint) as { pair_created_at: number } | undefined
    if (row) known.set(mint, row.pair_created_at)
    else unknown.push(mint)
  }
  if (!unknown.length) return known
  const best = bestPairByMint(await fetchPairsForMints(unknown))
  const now = Date.now()
  const insert = database.prepare(`
    INSERT INTO tokens (mint, pair_address, symbol, name, image_url, pair_created_at, socials_json, is_boosted, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT (mint) DO NOTHING
  `)
  for (const [mint, pair] of best) {
    if (!pair.pairCreatedAt) continue
    insert.run(mint, pair.pairAddress, (pair.baseToken.symbol ?? '???').slice(0, 24), (pair.baseToken.name ?? 'Unknown').slice(0, 80), pair.info?.imageUrl ?? null, pair.pairCreatedAt, JSON.stringify(socialsOf(pair)), now)
    known.set(mint, pair.pairCreatedAt)
    if (!trackerState.market.has(mint)) trackerState.watchlist.set(mint, now)
  }
  return known
}

let walletCursor = 0
const lastSwapSeen = new Map<string, number>()

async function monitorSmartWallets(database: TrackerDatabase, key: string) {
  const wallets = (database.prepare('SELECT wallet FROM smart_wallets WHERE runner_hits >= ? ORDER BY runner_hits DESC, updated_at DESC LIMIT 200').all(radarSettings().wallets.minRunnerHits) as Array<{ wallet: string }>).map(row => row.wallet)
  if (!wallets.length) return { checked: 0, entries: 0 }
  const batch = Array.from({ length: Math.min(walletsPerSwapCycle, wallets.length) }, (_, index) => wallets[(walletCursor + index) % wallets.length])
  walletCursor = (walletCursor + batch.length) % wallets.length
  const buys: Array<{ wallet: string; mint: string; timestamp: number }> = []
  for (const wallet of batch) {
    try {
      const transactions = await fetchJson<EnhancedTransaction[]>(`${heliusApi}/v0/addresses/${wallet}/transactions?api-key=${key}&type=SWAP&limit=25`, { timeoutMs: 20_000 })
      const since = lastSwapSeen.get(wallet) ?? Date.now() - 30 * 60_000
      let newest = since
      for (const transaction of Array.isArray(transactions) ? transactions : []) {
        const timestamp = (transaction.timestamp ?? 0) * 1000
        if (timestamp <= since || transaction.transactionError) continue
        newest = Math.max(newest, timestamp)
        for (const transfer of transaction.tokenTransfers ?? []) {
          if (transfer.toUserAccount === wallet && transfer.mint && !ignoredMints.has(transfer.mint) && solanaAddressPattern.test(transfer.mint)) buys.push({ wallet, mint: transfer.mint, timestamp })
        }
      }
      lastSwapSeen.set(wallet, newest)
    } catch (error) {
      logger.warn('Smart wallet swap lookup failed', { wallet, error: errorMessage(error) })
    }
  }
  if (!buys.length) return { checked: batch.length, entries: 0 }
  const ages = await ensureYoungTokens(database, [...new Set(buys.map(buy => buy.mint))])
  const insert = database.prepare('INSERT OR IGNORE INTO wallet_entries (mint, wallet, entry_mcap, timestamp) VALUES (?, ?, ?, ?)')
  let entries = 0
  for (const buy of buys) {
    const createdAt = ages.get(buy.mint)
    if (!createdAt || buy.timestamp < createdAt - 60_000) continue
    const result = insert.run(buy.mint, buy.wallet, latestMarket(database, buy.mint)?.marketCap ?? null, buy.timestamp)
    if (result.changes) {
      entries += 1
      logger.info('Runner wallet entered young token', { wallet: buy.wallet, mint: buy.mint })
    }
  }
  return { checked: batch.length, entries }
}

export function startWalletTracker(database: TrackerDatabase, signal: AbortSignal) {
  const key = heliusKey()
  if (!key) {
    logger.warn('HELIUS_API_KEY is not set; runner wallet tracking is disabled')
    recordHeartbeat(database, 'wallet-tracker', 'disabled', 'HELIUS_API_KEY missing')
    return Promise.resolve()
  }
  logger.info('Starting runner wallet tracker', { runnerMarketCap: trackerConfig.runnerMarketCap, runnerMultiple: trackerConfig.runnerMultiple })
  const scans = runLoop('runner-scan', trackerConfig.runnerScanIntervalMs, async () => {
    const scanned = await scanRunners(database, key)
    const wallets = (database.prepare('SELECT COUNT(*) AS count FROM smart_wallets WHERE runner_hits >= ?').get(radarSettings().wallets.minRunnerHits) as { count: number }).count
    recordHeartbeat(database, 'wallet-tracker', 'ok', `${wallets} runner wallets${scanned ? `, scanned ${scanned}` : ''}`)
  }, logger, signal)
  const swaps = runLoop('smart-wallet-swaps', trackerConfig.walletSwapIntervalMs, async () => {
    const result = await monitorSmartWallets(database, key)
    if (result.entries) logger.info('Smart wallet cycle', result)
  }, logger, signal)
  return Promise.all([scans, swaps]).then(() => undefined)
}

if (isMainModule(import.meta.url)) {
  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())
  void startWalletTracker(openTrackerDatabase(), controller.signal)
}
