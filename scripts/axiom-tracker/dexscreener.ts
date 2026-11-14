import { chunk, fetchJson } from './runtime.js'

const dexScreenerApi = 'https://api.dexscreener.com'

export type DexPair = {
  chainId: string
  dexId?: string
  pairAddress: string
  baseToken: { address: string; name?: string; symbol?: string }
  quoteToken?: { address: string; symbol?: string }
  priceUsd?: string
  txns?: { m5?: { buys?: number; sells?: number } }
  volume?: { m5?: number }
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

async function geckoMints(path: string) {
  const result = await fetchJson<GeckoPools>(`https://api.geckoterminal.com/api/v2/networks/solana/${path}`, { retries: 1 })
  return (result.data ?? []).map(pool => pool.relationships?.base_token?.data?.id?.replace(/^solana_/, '')).filter((mint): mint is string => Boolean(mint))
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
    geckoMints(`new_pools?page=${(geckoPage % 5) + 1}`),
    geckoMints('trending_pools?duration=1h'),
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

export async function fetchPairsForMints(mints: string[]) {
  const pairs: DexPair[] = []
  for (const group of chunk([...new Set(mints)], 30)) {
    const result = await fetchJson<DexPair[]>(`${dexScreenerApi}/tokens/v1/solana/${group.join(',')}`)
    if (Array.isArray(result)) pairs.push(...result)
  }
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
    readAt,
  }
}

export function socialsOf(pair: DexPair) {
  const socials = pair.info?.socials ?? []
  const find = (type: string) => socials.find(item => item.type?.toLowerCase() === type)?.url ?? null
  return { twitter: find('twitter') ?? find('x'), telegram: find('telegram'), website: pair.info?.websites?.[0]?.url ?? null }
}

export async function fetchMarketsForMints(mints: string[]) {
  const best = bestPairByMint(await fetchPairsForMints(mints))
  const now = Date.now()
  return new Map([...best].map(([mint, pair]) => [mint, readMarket(pair, now)]))
}
