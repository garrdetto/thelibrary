/**
 * Renderer-free bookkeeping for the performance overlay (`core/PerfOverlay.ts`): which mode the address asks for, and whether
 * resource counts (textures, meshes, materials, geometries) keep climbing while the player plays, which is what a leak looks like.
 */

export type PerfMode = 'off' | 'overlay' | 'log'

/** `?perf=1` (or `?perf`) shows the overlay; `?perf=log` also prints a table to the console every few seconds. */
export function perfModeFromSearch(search: string): PerfMode {
  const params = new URLSearchParams(search)
  if (!params.has('perf')) return 'off'
  const value = (params.get('perf') ?? '').toLowerCase()
  if (value === '0' || value === 'off' || value === 'false') return 'off'
  return value === 'log' ? 'log' : 'overlay'
}

export interface ResourceCounts {
  textures: number
  meshes: number
  materials: number
  geometries: number
}

export const RESOURCE_KEYS: readonly (keyof ResourceCounts)[] = ['textures', 'meshes', 'materials', 'geometries']

/** Seconds after the first frame before the baseline is taken, so loading and the first spawns aren't counted as growth. */
export const SETTLE_SECONDS = 20
/** A count is reported as growing once it has risen this many times in a row across samples, each above its previous high. */
export const GROWTH_STREAK = 6

/**
 * Tracks resource counts over time. `sample` is called every couple of seconds; `growing` lists the counts that have set a new
 * high on the last `GROWTH_STREAK` samples in a row (a steady climb), which a scene that streams things in and out never does.
 */
export class ResourceTrend {
  baseline: ResourceCounts | null = null
  private high: ResourceCounts | null = null
  private streak: Record<keyof ResourceCounts, number> = { textures: 0, meshes: 0, materials: 0, geometries: 0 }

  sample(now: ResourceCounts, elapsedSeconds: number): void {
    if (elapsedSeconds < SETTLE_SECONDS) return
    if (!this.baseline || !this.high) {
      this.baseline = { ...now }
      this.high = { ...now }
      return
    }
    for (const key of RESOURCE_KEYS) {
      if (now[key] > this.high[key]) {
        this.high[key] = now[key]
        this.streak[key]++
      } else {
        this.streak[key] = 0
      }
    }
  }

  /** How far each count is from the baseline (0 before the baseline is taken). */
  delta(now: ResourceCounts): ResourceCounts {
    const base = this.baseline
    return {
      textures: base ? now.textures - base.textures : 0,
      meshes: base ? now.meshes - base.meshes : 0,
      materials: base ? now.materials - base.materials : 0,
      geometries: base ? now.geometries - base.geometries : 0,
    }
  }

  growing(): (keyof ResourceCounts)[] {
    return RESOURCE_KEYS.filter((key) => this.streak[key] >= GROWTH_STREAK)
  }
}
