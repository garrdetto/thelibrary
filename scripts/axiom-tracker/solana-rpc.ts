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
const publicGaps: Record<string, number> = { getSignaturesForAddress: 1_100, getTransaction: 450, getAccountInfo: 300, getMultipleAccounts: 300, getTokenLargestAccounts: 1_000 }
const privateGaps: Record<string, number> = { getSignaturesForAddress: 150, getTransaction: 60, getAccountInfo: 60, getMultipleAccounts: 60, getTokenLargestAccounts: 100 }
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

const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const fieldPrime = 2n ** 255n - 19n

function modPow(base: bigint, exponent: bigint, modulus: bigint) {
  let result = 1n
  let value = ((base % modulus) + modulus) % modulus
  let power = exponent
  while (power > 0n) {
    if (power & 1n) result = (result * value) % modulus
    value = (value * value) % modulus
    power >>= 1n
  }
  return result
}

const curveD = ((-121665n * modPow(121666n, fieldPrime - 2n, fieldPrime)) % fieldPrime + fieldPrime) % fieldPrime

function base58Bytes(address: string) {
  let value = 0n
  for (const character of address) {
    const digit = base58Alphabet.indexOf(character)
    if (digit < 0) return null
    value = value * 58n + BigInt(digit)
  }
  const bytes: number[] = []
  while (value > 0n) { bytes.unshift(Number(value & 255n)); value >>= 8n }
  for (const character of address) { if (character !== '1') break; bytes.unshift(0) }
  return bytes.length === 32 ? bytes : null
}

/** True when the text decodes to a 32-byte Solana address. The node rejects a whole batch request if any address in it is not one. */
export function isSolanaAddress(address: string) {
  return base58Bytes(address) !== null
}

/**
 * True when the address is a point on the ed25519 curve, so a person's keypair can sign for it. Pools, bonding curves and
 * other program accounts are derived off the curve, which is how they are told apart from wallets.
 */
export function isWalletAddress(address: string) {
  const bytes = base58Bytes(address)
  if (!bytes) return false
  let y = 0n
  for (let index = 31; index >= 0; index -= 1) y = (y << 8n) | BigInt(index === 31 ? bytes[index] & 0x7f : bytes[index])
  if (y >= fieldPrime) return false
  const ySquared = (y * y) % fieldPrime
  const numerator = (ySquared - 1n + fieldPrime) % fieldPrime
  const denominator = (curveD * ySquared + 1n) % fieldPrime
  const xSquared = (numerator * modPow(denominator, fieldPrime - 2n, fieldPrime)) % fieldPrime
  return xSquared === 0n || modPow(xSquared, (fieldPrime - 1n) / 2n, fieldPrime) === 1n
}
