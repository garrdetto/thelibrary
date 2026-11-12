import type { Env } from './env.js'

const WORLD_NAME = 'fox-lake'

export type WalletResult = { ok: true; balance: number } | { ok: false; reason: 'refused' | 'unavailable' | 'missing' }

/** Whose Fox Lake money: a signed-in member, or a guest by this browser's Fox Plains guest key. */
export type WalletOwner = { member: { id: string; username: string } } | { guest: string }

/**
 * A player's Fox Lake money: the town job pay, the lake country's bounties and shop, and the casino all use the one
 * balance Fox Lake's own world (the `FoxLakeWorld` Durable Object) holds. Classic Fox Plains and standalone Rack &
 * Reel keep their own money. Applies `delta` (0 reads it); a debit that would overdraw is refused, a guest who never
 * joined the town is `missing`, and `unavailable` means the world could not be reached.
 */
export async function adjustFoxLakeWallet(env: Env, owner: WalletOwner, delta: number): Promise<WalletResult> {
  if (!env.FOX_LAKE_WORLD) return { ok: false, reason: 'unavailable' }
  const key = 'member' in owner ? `member:${owner.member.id}` : `guest:${owner.guest}`
  const name = 'member' in owner ? owner.member.username : `Guest-${owner.guest.slice(0, 5)}`
  try {
    const stub = env.FOX_LAKE_WORLD.get(env.FOX_LAKE_WORLD.idFromName(WORLD_NAME))
    const res = await stub.fetch(new Request('https://maple-world.internal/wallet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, name, delta }),
    }))
    if (res.status === 409) return { ok: false, reason: 'refused' }
    if (res.status === 404) return { ok: false, reason: 'missing' }
    if (!res.ok) return { ok: false, reason: 'unavailable' }
    const data = (await res.json()) as { balance?: unknown }
    return typeof data.balance === 'number' && Number.isFinite(data.balance) ? { ok: true, balance: data.balance } : { ok: false, reason: 'unavailable' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/** A signed-in member's Fox Lake money (see `adjustFoxLakeWallet`). */
export function adjustSharedWallet(env: Env, user: { id: string; username: string }, delta: number): Promise<WalletResult> {
  return adjustFoxLakeWallet(env, { member: user }, delta)
}
