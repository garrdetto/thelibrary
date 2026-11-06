/** Seeded random streams. The sim never calls Math.random; every roll comes from one of these so a seed plus the input log replays a contest bit for bit. */

export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  static fromString(text: string): Rng {
    return new Rng(stringSeed(text))
  }

  get seed(): number {
    return this.state
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1))
  }

  chance(probability: number): boolean {
    return this.next() < probability
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }

  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0
    for (const item of items) total += Math.max(0, weight(item))
    let roll = this.next() * total
    for (const item of items) {
      roll -= Math.max(0, weight(item))
      if (roll < 0) return item
    }
    return items[items.length - 1]
  }

  /** Standard normal by Box–Muller, one value per call so the stream position never depends on a cached spare. */
  normal(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12)
    const v = this.next()
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  fork(salt: number): Rng {
    return new Rng(hashSeed(this.state, salt))
  }
}

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

export function stringSeed(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}
