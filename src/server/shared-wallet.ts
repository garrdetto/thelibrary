import type { Env } from './env.js'

const WORLD_NAME = 'maple-street'

export type WalletResult = { ok: true; balance: number } | { ok: false; reason: 'refused' | 'unavailable' }

/**
 * The one wallet a signed-in member shares across Fox Plains, Fox Lake and Rack & Reel. Fox Plains' shared world
 * (the `MapleStreetWorld` Durable Object) holds the balance; this applies `delta` there (0 reads it). A debit that
 * would overdraw is refused. `unavailable` means the world could not be reached (no binding, or it failed).
 */
export async function adjustSharedWallet(env: Env, user: { id: string; username: string }, delta: number): Promise<WalletResult> {
  if (!env.MAPLE_WORLD) return { ok: false, reason: 'unavailable' }
  try {
    const stub = env.MAPLE_WORLD.get(env.MAPLE_WORLD.idFromName(WORLD_NAME))
    const res = await stub.fetch(new Request('https://maple-world.internal/wallet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: `member:${user.id}`, name: user.username, delta }),
    }))
    if (res.status === 409) return { ok: false, reason: 'refused' }
    if (!res.ok) return { ok: false, reason: 'unavailable' }
    const data = (await res.json()) as { balance?: unknown }
    return typeof data.balance === 'number' && Number.isFinite(data.balance) ? { ok: true, balance: data.balance } : { ok: false, reason: 'unavailable' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}
