export interface Rng {
  next(): number
  int(maxExclusive: number): number
  pick<T>(items: readonly T[], weights: readonly number[]): T
  state(): readonly number[]
}

function splitMix(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x9e3779b9) >>> 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0
    return (z ^ (z >>> 16)) >>> 0
  }
}

export function createRng(seed: number | readonly number[]): Rng {
  let a: number, b: number, c: number, d: number
  if (typeof seed === 'number') {
    const mix = splitMix(seed)
    a = mix(); b = mix(); c = mix(); d = mix()
  } else {
    [a, b, c, d] = [seed[0] >>> 0, seed[1] >>> 0, seed[2] >>> 0, seed[3] >>> 0]
  }
  if ((a | b | c | d) === 0) a = 1

  const nextUint = (): number => {
    const result = Math.imul(rotl(Math.imul(b, 5) >>> 0, 7), 9) >>> 0
    const t = (b << 9) >>> 0
    c ^= a; d ^= b; b ^= c; a ^= d
    c = (c ^ t) >>> 0
    d = rotl(d, 11)
    return result
  }

  const next = (): number => nextUint() / 4294967296

  const int = (maxExclusive: number): number => {
    if (maxExclusive <= 0) return 0
    const limit = Math.floor(4294967296 / maxExclusive) * maxExclusive
    let value = nextUint()
    while (value >= limit) value = nextUint()
    return value % maxExclusive
  }

  const pick = <T,>(items: readonly T[], weights: readonly number[]): T => {
    let total = 0
    for (const weight of weights) total += weight
    let roll = int(total)
    for (let index = 0; index < items.length; index++) {
      roll -= weights[index]
      if (roll < 0) return items[index]
    }
    return items[items.length - 1]
  }

  return { next, int, pick, state: () => [a >>> 0, b >>> 0, c >>> 0, d >>> 0] }
}

function rotl(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0
}

export function cryptoSeed(): number {
  const buffer = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buffer)
  return buffer[0]
}
