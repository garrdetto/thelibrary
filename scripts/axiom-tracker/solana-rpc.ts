import { fetchJson, sleep } from './runtime.js'

export const publicNode = 'https://api.mainnet-beta.solana.com'

export function rpcUrl() {
  const custom = process.env.SOLANA_RPC_URL?.trim()
  if (custom) return custom
  const key = process.env.HELIUS_API_KEY?.trim()
  return key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : publicNode
}

export const onPublicNode = () => rpcUrl() === publicNode

/**
 * The free public node limits each address to about 40 calls of one method per 10 seconds and rate-limits wallet-history
 * bursts much sooner, so every Solana call in the tracker goes through these gaps. `background` callers (wallet profits)
 * take wallet histories at most every 3 seconds so the fresh-wallet checks keep most of that budget.
 */
const publicGaps: Record<string, number> = { getSignaturesForAddress: 1_100, getTransaction: 450, getAccountInfo: 300 }
const privateGaps: Record<string, number> = { getSignaturesForAddress: 150, getTransaction: 60, getAccountInfo: 60 }
const backgroundHistoryGapMs = 3_000
const limitPauseMs = 30_000

const lastCall = new Map<string, number>()
let lastBackgroundHistory = 0
let pausedUntil = 0

export const solanaPausedUntil = () => pausedUntil

/** Waits until this method may be called again. */
export async function paceSolana(method: string, background = false) {
  for (;;) {
    const now = Date.now()
    const gap = (onPublicNode() ? publicGaps : privateGaps)[method] ?? (onPublicNode() ? 300 : 60)
    let ready = Math.max(pausedUntil, (lastCall.get(method) ?? 0) + gap)
    if (background && method === 'getSignaturesForAddress' && onPublicNode()) ready = Math.max(ready, lastBackgroundHistory + backgroundHistoryGapMs)
    if (ready <= now) {
      lastCall.set(method, now)
      if (background && method === 'getSignaturesForAddress') lastBackgroundHistory = now
      return
    }
    await sleep(ready - now)
  }
}

/** Every caller stops for 30 seconds after the node says too many requests. */
export function noteSolanaLimit(message: string) {
  if (/429|rate|too many/i.test(message)) pausedUntil = Math.max(pausedUntil, Date.now() + limitPauseMs)
}

export async function solanaRpc<T>(method: string, params: unknown[], background = false): Promise<T> {
  await paceSolana(method, background)
  try {
    const response = await fetchJson<{ result?: T; error?: { message?: string } }>(rpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      retries: 0,
      timeoutMs: 20_000,
    })
    if (response.error) throw new Error(response.error.message ?? `${method} failed`)
    return response.result as T
  } catch (error) {
    noteSolanaLimit(error instanceof Error ? error.message : String(error))
    throw error
  }
}
