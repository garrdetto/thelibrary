/** Random numbers for the casino. The server spins with `cryptoRng`; tests and simulations with `seededRng`. */
export interface Rng {
  /** A float in [0, 1). */
  next(): number
}

/** An integer in [0, n). */
export function pick(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.floor(rng.next() * n))
}

/** An index chosen by weight. */
export function weighted(rng: Rng, weights: readonly number[]): number {
  let total = 0
  for (const w of weights) total += w
  let r = rng.next() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r < 0) return i
  }
  return weights.length - 1
}

/** Mulberry32: fast, repeatable, good enough for strips and simulations. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

/** Cryptographic randomness (Workers, browsers and Node all have `crypto.getRandomValues`). */
export function cryptoRng(): Rng {
  const buf = new Uint32Array(64)
  let i = buf.length
  return {
    next() {
      if (i >= buf.length) {
        crypto.getRandomValues(buf)
        i = 0
      }
      return buf[i++] / 4294967296
    },
  }
}
