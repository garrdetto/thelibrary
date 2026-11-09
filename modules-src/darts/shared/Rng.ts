/** Seeded random numbers (mulberry32) and Gaussian samples (Box–Muller), so a seed reproduces every dart exactly on the page, in tests and in the room. */

export type Rng = () => number

export function createRng(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A standard normal sample (mean 0, variance 1). */
export function gaussian(rng: Rng): number {
  let u = rng()
  while (u <= Number.EPSILON) u = rng()
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function randomSeed(): number {
  try {
    const buffer = new Uint32Array(1)
    crypto.getRandomValues(buffer)
    return buffer[0]
  } catch {
    return Math.floor(Math.random() * 4294967296)
  }
}
