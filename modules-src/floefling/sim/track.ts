import { CHUNK_LENGTH, TRACK_START } from './constants'
import { chunkSeed, seededRng } from './rng'

export type BouncerKind = 'seal' | 'walrus' | 'snowman'

export type TrackElement =
  | { kind: 'slick'; id: number; x0: number; x1: number }
  | { kind: 'bouncer'; id: number; type: BouncerKind; x: number; radius: number; top: number; boost: number }
  | { kind: 'hole'; id: number; x: number; radius: number }
  | { kind: 'bank'; id: number; x0: number; x1: number; height: number }

export const BOUNCERS: Record<BouncerKind, { radius: number; top: number; boost: number }> = {
  seal: { radius: 1.1, top: 0.85, boost: 10 },
  walrus: { radius: 1.5, top: 1.35, boost: 12.5 },
  snowman: { radius: 0.9, top: 1.9, boost: 15 },
}

export class Track {
  readonly seed: number
  readonly elements: TrackElement[] = []
  private chunks = 0
  private nextId = 1

  constructor(seed: number) {
    this.seed = seed >>> 0
  }

  get generatedTo(): number {
    return TRACK_START + this.chunks * CHUNK_LENGTH
  }

  ensure(x: number): void {
    while (this.generatedTo < x) this.addChunk()
  }

  inRange(x0: number, x1: number): TrackElement[] {
    this.ensure(x1)
    return this.elements.filter(e => elementEnd(e) >= x0 && elementStart(e) <= x1)
  }

  surfaceAt(x: number): 'ice' | 'snow' {
    this.ensure(x + 1)
    for (const e of this.elements) if (e.kind === 'slick' && x >= e.x0 && x <= e.x1) return 'ice'
    return 'snow'
  }

  private addChunk(): void {
    const index = this.chunks
    const start = this.generatedTo
    const rng = seededRng(chunkSeed(this.seed, index))
    const taken: Array<[number, number]> = []
    const fits = (a: number, b: number) => a >= start && b <= start + CHUNK_LENGTH && taken.every(([c, d]) => b + 6 < c || a - 6 > d)
    const place = (length: number): number | null => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const a = start + rng() * (CHUNK_LENGTH - length)
        if (fits(a, a + length)) { taken.push([a, a + length]); return a }
      }
      return null
    }
    const slickCount = rng() < 0.35 ? 2 : rng() < 0.7 ? 1 : 0
    for (let i = 0; i < slickCount; i++) {
      const length = 14 + rng() * 26
      const a = place(length)
      if (a !== null) this.elements.push({ kind: 'slick', id: this.nextId++, x0: a, x1: a + length })
    }
    if (rng() < 0.6) {
      const roll = rng()
      const type: BouncerKind = roll < 0.45 ? 'seal' : roll < 0.75 ? 'walrus' : 'snowman'
      const spec = BOUNCERS[type]
      const a = place(spec.radius * 2)
      if (a !== null) this.elements.push({ kind: 'bouncer', id: this.nextId++, type, x: a + spec.radius, ...spec })
    }
    if (index > 0 && rng() < 0.45) {
      if (rng() < 0.5) {
        const radius = 1.3 + rng() * 0.6
        const a = place(radius * 2)
        if (a !== null) this.elements.push({ kind: 'hole', id: this.nextId++, x: a + radius, radius })
      } else {
        const length = 2.5 + rng() * 2
        const a = place(length)
        if (a !== null) this.elements.push({ kind: 'bank', id: this.nextId++, x0: a, x1: a + length, height: 1.2 + rng() * 0.7 })
      }
    }
    this.elements.sort((p, q) => elementStart(p) - elementStart(q))
    this.chunks++
  }
}

export function elementStart(e: TrackElement): number {
  return e.kind === 'slick' || e.kind === 'bank' ? e.x0 : e.x - e.radius
}

export function elementEnd(e: TrackElement): number {
  return e.kind === 'slick' || e.kind === 'bank' ? e.x1 : e.x + e.radius
}
