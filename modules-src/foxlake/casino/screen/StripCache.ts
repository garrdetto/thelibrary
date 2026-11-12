/**
 * The reel strip textures (sharp, and the motion-blurred copy used while spinning) are a few megabytes each and take
 * tens of milliseconds to draw, and every machine's strips never change. They are kept here by machine and reel, so
 * sitting back down at a machine (or its free games starting) reuses them; the least recently used ones not on screen
 * are disposed once more than `KEEP` reel sets are held.
 */
import type { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'

const KEEP = 4

interface Entry { textures: DynamicTexture[]; users: number }

const entries = new Map<string, Entry>()

/** The textures for `key`, made by `make` the first time; release them with `releaseStrips`. */
export function acquireStrips(key: string, make: () => DynamicTexture[]): DynamicTexture[] {
  let e = entries.get(key)
  if (e) entries.delete(key)
  else e = { textures: make(), users: 0 }
  e.users++
  entries.set(key, e)
  return e.textures
}

export function releaseStrips(key: string): void {
  const e = entries.get(key)
  if (!e) return
  e.users = Math.max(0, e.users - 1)
  for (const [k, old] of entries) {
    if (entries.size <= KEEP) break
    if (old.users > 0) continue
    for (const t of old.textures) t.dispose()
    entries.delete(k)
  }
}
