import { chunk } from './runtime.js'
import { sharedAccounts } from './research-verdict.js'
import { isSolanaAddress, isWalletAddress, solanaRpc } from './solana-rpc.js'

/** Larger single holdings are pools or curves even when the address check cannot tell. */
const largestWalletPct = 25
const ownerCacheLimit = 50_000

export type MintFacts = { mintAuthority: boolean; freezeAuthority: boolean; supply: number; at: number }
export type ChainHolders = { top10Pct: number | null; holders: Array<{ wallet: string; pct: number }> }

type ParsedAccount = { data?: { parsed?: { info?: Record<string, unknown> } } } | null
type LargestAccount = { address: string; amount: string }

const mintFacts = new Map<string, MintFacts>()
const ownerOfAccount = new Map<string, string>()

function readMint(account: ParsedAccount, at: number): MintFacts | null {
  const info = account?.data?.parsed?.info
  if (!info) return null
  const supply = Number(info.supply)
  return { mintAuthority: Boolean(info.mintAuthority), freezeAuthority: Boolean(info.freezeAuthority), supply: Number.isFinite(supply) ? supply : 0, at }
}

/** Reads mint and freeze authority and supply for many coins at once from the Solana node (one request per 100 coins). Ids that are not Solana addresses are skipped, since one would fail the whole batch. */
export async function refreshMintFacts(mints: string[]) {
  const found = new Map<string, MintFacts>()
  for (const group of chunk([...new Set(mints)].filter(isSolanaAddress), 100)) {
    const result = await solanaRpc<{ value: ParsedAccount[] }>('getMultipleAccounts', [group, { encoding: 'jsonParsed' }])
    const at = Date.now()
    group.forEach((mint, index) => {
      const facts = readMint(result.value?.[index] ?? null, at)
      if (facts) { mintFacts.set(mint, facts); found.set(mint, facts) }
    })
  }
  return found
}

export function knownMintFacts(mint: string) {
  return mintFacts.get(mint) ?? null
}

async function ownersOf(accounts: string[]) {
  const missing = accounts.filter(account => !ownerOfAccount.has(account))
  if (missing.length) {
    const result = await solanaRpc<{ value: ParsedAccount[] }>('getMultipleAccounts', [missing, { encoding: 'jsonParsed' }])
    missing.forEach((account, index) => {
      const owner = result.value?.[index]?.data?.parsed?.info?.owner
      if (typeof owner === 'string') ownerOfAccount.set(account, owner)
    })
    if (ownerOfAccount.size > ownerCacheLimit) for (const key of [...ownerOfAccount.keys()].slice(0, ownerOfAccount.size - ownerCacheLimit)) ownerOfAccount.delete(key)
  }
  return ownerOfAccount
}

/**
 * The coin's top 20 holders from the Solana node, with pools, bonding curves and exchange accounts left out, and the share
 * of supply the 10 largest of the rest hold. A token account's owner never changes, so owners are looked up only once.
 */
export async function readTopHolders(mint: string): Promise<ChainHolders> {
  let facts = mintFacts.get(mint)
  if (!facts) facts = (await refreshMintFacts([mint])).get(mint)
  if (!facts?.supply) return { top10Pct: null, holders: [] }
  const largest = await solanaRpc<{ value: LargestAccount[] }>('getTokenLargestAccounts', [mint])
  const accounts = (largest.value ?? []).filter(account => Number(account.amount) > 0)
  const owners = await ownersOf(accounts.map(account => account.address))
  const totals = new Map<string, number>()
  for (const account of accounts) {
    const owner = owners.get(account.address)
    if (!owner || sharedAccounts.has(owner) || !isWalletAddress(owner)) continue
    totals.set(owner, (totals.get(owner) ?? 0) + (Number(account.amount) / facts.supply) * 100)
  }
  const holders = [...totals]
    .map(([wallet, pct]) => ({ wallet, pct: Math.round(pct * 100) / 100 }))
    .filter(holder => holder.pct <= largestWalletPct)
    .sort((first, second) => second.pct - first.pct)
    .slice(0, 20)
  const top10Pct = holders.length ? Math.round(holders.slice(0, 10).reduce((total, holder) => total + holder.pct, 0) * 100) / 100 : null
  return { top10Pct, holders }
}
