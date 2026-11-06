export const TAU = Math.PI * 2
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const mod = (a: number, n: number): number => ((a % n) + n) % n
export const smooth = (t: number): number => t * t * (3 - 2 * t)
export const wrapA = (a: number): number => {
  while (a > Math.PI) a -= TAU
  while (a < -Math.PI) a += TAU
  return a
}

/** The classic module's mulberry32 generator, bit for bit. */
export function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
