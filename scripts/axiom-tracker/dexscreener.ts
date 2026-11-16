import { chunk, errorMessage, fetchJson, sleep } from './runtime.js'
import { geckoAnswered, geckoCalled, geckoLimited, geckoReady } from './gecko-limit.js'

const dexScreenerApi = 'https://api.dexscreener.com'

export type DexPair = {
  chainId: string
  dexId?: string
  pairAddress: string
  baseToken: { address: string; name?: string; symbol?: string }
  quoteToken?: { address: string; symbol?: string }
  priceUsd?: string
  txns?: { m5?: { buys?: number; sells?: number } }
  volume?: { m5?: number; h1?: number }
  priceChange?: { m5?: number; h1?: number }
  liquidity?: { usd?: number }
  marketCap?: number
  fdv?: number
  pairCreatedAt?: number
  info?: { imageUrl?: string; websites?: Array<{ url?: string; label?: string }>; socials?: Array<{ type?: string; url?: string }> }
  boosts?: { active?: number }
}

type TokenListing = { chainId?: string; tokenAddress?: string }

export type MarketReading = {
  mint: string
  pairAddress: string
  priceUsd: number | null
  marketCap: number | null
  liquidityUsd: number | null
  volume5m: number
  buys5m: number
  sells5m: number
  pairCreatedAt: number | null
  /** DexScreener's own 5-minute price change in percent. */
  change5m?: number | null
  readAt: number
}

async function listingMints(path: string) {
  const listings = await fetchJson<TokenListing[]>(`${dexScreenerApi}${path}`)
  return Array.isArray(listings) ? listings.filter(item => item.chainId === 'solana' && item.tokenAddress).map(item => item.tokenAddress as string) : []
}

async function searchMints(query: string) {
  const result = await fetchJson<{ pairs?: DexPair[] }>(`${dexScreenerApi}/latest/dex/search?q=${encodeURIComponent(query)}`)
  return (result.pairs ?? []).filter(pair => pair.chainId === 'solana').map(pair => pair.baseToken.address)
}

type GeckoPools = { data?: Array<{ relationships?: { base_token?: { data?: { id?: string } } } }> }

/** One GeckoTerminal list a cycle at most, and none while its shared request budget says wait. */
async function geckoMints(path: string) {
  if (!geckoReady()) return []
  geckoCalled()
  try {
    const result = await fetchJson<GeckoPools>(`https://api.geckoterminal.com/api/v2/networks/solana/${path}`, { retries: 0 })
    geckoAnswered()
    return (result.data ?? []).map(pool => pool.relationships?.base_token?.data?.id?.replace(/^solana_/, '')).filter((mint): mint is string => Boolean(mint))
  } catch (error) {
    if (/429/.test(errorMessage(error))) geckoLimited()
    throw error
  }
}

let geckoPage = 0

export async function fetchDiscoverySources() {
  const sources = await Promise.allSettled([
    listingMints('/token-profiles/latest/v1'),
    listingMints('/token-boosts/latest/v1'),
    listingMints('/token-boosts/top/v1'),
    listingMints('/community-takeovers/latest/v1'),
    searchMints('pump'),
    searchMints('SOL'),
    searchMints('pumpswap'),
    searchMints('raydium'),
    geckoMints(geckoPage % 2 ? 'trending_pools?duration=1h' : `new_pools?page=${(Math.floor(geckoPage / 2) % 5) + 1}`),
  ])
  geckoPage += 1
  const mints = new Set<string>()
  const boosted = new Set<string>()
  sources.forEach((source, index) => {
    if (source.status !== 'fulfilled') return
    for (const mint of source.value) {
      mints.add(mint)
      if (index === 1 || index === 2) boosted.add(mint)
    }
  })
  const failures = sources.filter(source => source.status === 'rejected').length
  return { mints: [...mints], boosted, failures }
}

/** DexScreener allows 300 token lookups a minute; every caller waits its turn here so polling every few seconds stays under it. */
export const tokenLookupGapMs = 250
const tokenLookupCoolDownMs = 10_000
let nextTokenLookupAt = 0
const recentPairs = new Map<string, { pair: DexPair; at: number }>()

async function tokenLookupTurn() {
  const now = Date.now()
  const at = Math.max(now, nextTokenLookupAt)
  nextTokenLookupAt = at + tokenLookupGapMs
  if (at > now) await sleep(at - now)
}

/** One DexScreener token lookup (up to 30 mints), paced with every other lookup and remembered for `recentPairsFor`. */
export async function fetchTokenPairs(mints: string[], options?: { retries?: number; timeoutMs?: number }) {
  await tokenLookupTurn()
  let result: DexPair[]
  try {
    result = await fetchJson<DexPair[]>(`${dexScreenerApi}/tokens/v1/solana/${mints.join(',')}`, options)
  } catch (error) {
    if (/429/.test(errorMessage(error))) nextTokenLookupAt = Math.max(nextTokenLookupAt, Date.now() + tokenLookupCoolDownMs)
    throw error
  }
  const pairs = Array.isArray(result) ? result : []
  const now = Date.now()
  for (const [mint, pair] of bestPairByMint(pairs)) recentPairs.set(mint, { pair, at: now })
  for (const [mint, entry] of recentPairs) if (now - entry.at > 10 * 60_000) recentPairs.delete(mint)
  return pairs
}

/** Pairs another loop read in the last `maxAgeMs`, so the same coin is not looked up twice within a few seconds. */
export function recentPairsFor(mints: string[], maxAgeMs: number, now = Date.now()) {
  const found = new Map<string, DexPair>()
  for (const mint of mints) {
    const entry = recentPairs.get(mint)
    if (entry && now - entry.at <= maxAgeMs) found.set(mint, entry.pair)
  }
  return found
}

export async function fetchPairsForMints(mints: string[], reuseWithinMs = 0) {
  const unique = [...new Set(mints)]
  const reused = reuseWithinMs > 0 ? recentPairsFor(unique, reuseWithinMs) : new Map<string, DexPair>()
  const pairs: DexPair[] = [...reused.values()]
  for (const group of chunk(unique.filter(mint => !reused.has(mint)), 30)) pairs.push(...await fetchTokenPairs(group))
  return pairs
}

export function bestPairByMint(pairs: DexPair[]) {
  const best = new Map<string, DexPair>()
  for (const pair of pairs) {
    if (pair.chainId !== 'solana' || !pair.baseToken?.address) continue
    const current = best.get(pair.baseToken.address)
    if (!current || (pair.liquidity?.usd ?? 0) > (current.liquidity?.usd ?? 0)) best.set(pair.baseToken.address, pair)
  }
  return best
}

export function readMarket(pair: DexPair, readAt = Date.now()): MarketReading {
  const price = Number(pair.priceUsd)
  return {
    mint: pair.baseToken.address,
    pairAddress: pair.pairAddress,
    priceUsd: Number.isFinite(price) && price > 0 ? price : null,
    marketCap: pair.marketCap ?? pair.fdv ?? null,
    liquidityUsd: pair.liquidity?.usd ?? null,
    volume5m: pair.volume?.m5 ?? 0,
    buys5m: pair.txns?.m5?.buys ?? 0,
    sells5m: pair.txns?.m5?.sells ?? 0,
    pairCreatedAt: pair.pairCreatedAt ?? null,
    change5m: typeof pair.priceChange?.m5 === 'number' && Number.isFinite(pair.priceChange.m5) ? pair.priceChange.m5 : null,
    readAt,
  }
}

export function socialsOf(pair: DexPair) {
  const socials = pair.info?.socials ?? []
  const find = (type: string) => socials.find(item => item.type?.toLowerCase() === type)?.url ?? null
  return { twitter: find('twitter') ?? find('x'), telegram: find('telegram'), website: pair.info?.websites?.[0]?.url ?? null }
}

export async function fetchMarketsForMints(mints: string[], reuseWithinMs = 0) {
  const best = bestPairByMint(await fetchPairsForMints(mints, reuseWithinMs))
  const now = Date.now()
  return new Map([...best].map(([mint, pair]) => [mint, readMarket(pair, now)]))
}
