/** Seeded random numbers and seed hashing, so every shot, lie and wind roll replays identically on every client. */

export type RandomSource = () => number

/** Mulberry32: a 32-bit generator returning uniform values in [0, 1). The same seed always yields the same sequence. */
export function createRandom(seed: number): RandomSource {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Mixes any number of integers into one 32-bit seed (FNV-1a over their bytes followed by a final avalanche). */
export function hashSeed(...parts: readonly number[]): number {
  let hash = 0x811c9dc5
  for (const part of parts) {
    let value = Math.floor(part) >>> 0
    for (let byte = 0; byte < 4; byte++) {
      hash ^= value & 0xff
      hash = Math.imul(hash, 0x01000193) >>> 0
      value >>>= 8
    }
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b) >>> 0
  hash ^= hash >>> 13
  return hash >>> 0
}

/** Seed derived from a string (room code or player id), for mixing into hashSeed. */
export function stringSeed(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

export function randomBetween(random: RandomSource, min: number, max: number): number {
  return min + (max - min) * random()
}
