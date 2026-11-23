export type Rng = () => number

export function seededRng(seed: number): Rng {
  let state = seed >>> 0 || 0x9e3779b9
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function chunkSeed(seed: number, index: number): number {
  return (Math.imul(seed ^ 0x85ebca6b, 31) + Math.imul(index + 1, 0x27d4eb2d)) >>> 0
}
