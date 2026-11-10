export type SpeciesKind = 'fish' | 'game'
export type SpeciesId = 'muskie' | 'walleye' | 'pike' | 'smallmouth' | 'perch' | 'whitetail' | 'blackbear'
export type Habitat = 'deep' | 'weeds' | 'rocks' | 'forest' | 'marsh'

export interface RecordEntry {
  holder: string
  value: number
  year: number
  place: string
}

export interface SpeciesTemplate {
  id: SpeciesId
  name: string
  kind: SpeciesKind
  model: string
  unit: 'lb' | 'in'
  measure: string
  /** Smallest animal that ever appears. */
  min: number
  /** The everyday animal: the most common size. */
  avg: number
  /** Top of the everyday range; the same as `trophyAt`. */
  max: number
  habitats: Habitat[]
  weight: number
  trophyAt: number
  fight: number
  facts: string
}

export type RecordMetric = 'weight' | 'length' | 'score' | 'spread' | 'points' | 'dressed' | 'skull'
export type Measures = Partial<Record<RecordMetric, number>>

/**
 * Size classes, rarest last. `record` beats the all-time #1, `near-record` is within a few
 * percent of the book's top three, `trophy` is a big buck or a wall-hanger fish.
 */
export type SizeClass = 'small' | 'average' | 'good' | 'trophy' | 'near-record' | 'record'

export interface Specimen {
  species: SpeciesId
  value: number
  weightLb: number
  lengthIn: number
  legendary: boolean
  recordTier: 0 | 1 | 2 | 3
  trophyPoints: number
  serial: number
  sizeClass: SizeClass
  measures: Measures
}

/**
 * Odds for every new fish and game animal. A new all-time record is 0.01%, a near-record
 * 0.05% and a trophy 2%; everything else is an everyday animal around the species average.
 * Inside each class sizes fall away exponentially, so the smaller end is always the commoner.
 */
export const RARITY = { record: 0.0001, nearRecord: 0.0005, trophy: 0.02 } as const
/** Chance that a new animal is record-class (near-record or record). */
export const LEGENDARY_CHANCE = RARITY.record + RARITY.nearRecord
/** Share of everyday animals that come out at or below the average. */
export const BELOW_AVERAGE_SHARE = 0.6
/** A near-record starts this far under the book's #3. */
export const NEAR_RECORD_FRACTION = 0.95

export const SPECIES: SpeciesTemplate[] = [
  { id: 'muskie', name: 'Muskellunge', kind: 'fish', model: 'fish-muskie', unit: 'lb', measure: 'Weight', min: 6, avg: 14, max: 30, habitats: ['deep', 'weeds'], weight: 0.08, trophyAt: 30, fight: 1.0, facts: 'Wisconsin\'s state fish. An ambush hunter of weed edges and deep breaks; the "fish of ten thousand casts".' },
  { id: 'walleye', name: 'Walleye', kind: 'fish', model: 'fish-walleye', unit: 'lb', measure: 'Weight', min: 0.8, avg: 2.2, max: 8, habitats: ['deep', 'rocks'], weight: 0.3, trophyAt: 8, fight: 0.45, facts: 'A reflective layer behind the eye lets walleye feed in low light, so dusk and dawn on rock and gravel are best.' },
  { id: 'pike', name: 'Northern Pike', kind: 'fish', model: 'fish-pike', unit: 'lb', measure: 'Weight', min: 1.5, avg: 4.5, max: 14, habitats: ['weeds', 'marsh'], weight: 0.22, trophyAt: 14, fight: 0.7, facts: 'Pike spawn in flooded marsh as soon as the ice goes out and patrol the weed beds all summer.' },
  { id: 'smallmouth', name: 'Smallmouth Bass', kind: 'fish', model: 'fish-smallmouth', unit: 'lb', measure: 'Weight', min: 0.7, avg: 1.9, max: 5, habitats: ['rocks'], weight: 0.18, trophyAt: 5, fight: 0.6, facts: 'Bronze-sided bass of clear, rocky water; they hold where crayfish hide among boulders.' },
  { id: 'perch', name: 'Yellow Perch', kind: 'fish', model: 'fish-perch', unit: 'lb', measure: 'Weight', min: 0.15, avg: 0.45, max: 1.2, habitats: ['weeds', 'marsh', 'deep'], weight: 0.22, trophyAt: 1.2, fight: 0.25, facts: 'Perch school by size; find one and you have found a dozen. A key food for walleye and pike.' },
  { id: 'whitetail', name: 'White-tailed Deer', kind: 'game', model: 'deer', unit: 'in', measure: 'Antler score', min: 75, avg: 115, max: 160, habitats: ['forest', 'marsh'], weight: 0.75, trophyAt: 160, fight: 0, facts: 'Antlers grow and drop every year. The score adds beam length, tine length, inside spread and circumferences in inches.' },
  { id: 'blackbear', name: 'Black Bear', kind: 'game', model: 'bear', unit: 'lb', measure: 'Weight', min: 120, avg: 210, max: 400, habitats: ['forest'], weight: 0.25, trophyAt: 400, fight: 0, facts: 'Northern Wisconsin holds one of the densest black bear populations in the country. Record bears are ranked by skull size, length plus width.' },
]

export const SPECIES_BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s])) as Record<SpeciesId, SpeciesTemplate>

export const RECORD_BOOK_SEED: Record<SpeciesId, [RecordEntry, RecordEntry, RecordEntry]> = {
  muskie: [{ holder: 'A. Lindqvist', value: 69.7, year: 1949, place: 'Flowage country' }, { holder: 'C. Haugen', value: 67.5, year: 1949, place: 'Lac Courte' }, { holder: 'R. Pelto', value: 65.2, year: 1952, place: 'Tomahawk chain' }],
  walleye: [{ holder: 'T. Brekke', value: 18.0, year: 1933, place: 'High Lake' }, { holder: 'J. Mrozek', value: 17.4, year: 1961, place: 'Lake Winnebago' }, { holder: 'D. Olsen', value: 16.8, year: 1988, place: 'Green Bay' }],
  pike: [{ holder: 'H. Nygaard', value: 38.0, year: 1952, place: 'Lake Puckaway' }, { holder: 'E. Kowalski', value: 36.2, year: 1971, place: 'Chippewa River' }, { holder: 'M. Ruud', value: 34.5, year: 1997, place: 'Willow Flowage' }],
  smallmouth: [{ holder: 'L. Strand', value: 9.1, year: 1950, place: 'Indian Lake' }, { holder: 'W. Janke', value: 8.7, year: 1989, place: 'Door peninsula' }, { holder: 'S. Aho', value: 8.4, year: 2004, place: 'Menominee River' }],
  perch: [{ holder: 'P. Wendt', value: 3.3, year: 1954, place: 'Lake Winnebago' }, { holder: 'K. Laine', value: 3.1, year: 1976, place: 'Lake Michigan' }, { holder: 'B. Halvorsen', value: 2.9, year: 2011, place: 'Big Green' }],
  whitetail: [{ holder: 'J. Brandvold', value: 206.1, year: 1914, place: 'Burnett County' }, { holder: 'G. Thiel', value: 201.6, year: 1999, place: 'Buffalo County' }, { holder: 'N. Sorensen', value: 197.4, year: 1965, place: 'Bayfield County' }],
  blackbear: [{ holder: 'F. Kallio', value: 790, year: 1963, place: 'Iron County' }, { holder: 'O. Wiita', value: 745, year: 1985, place: 'Sawyer County' }, { holder: 'A. Dahl', value: 712, year: 2009, place: 'Price County' }],
}

export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function fishLengthIn(species: SpeciesId, weightLb: number): number {
  const shape: Record<string, number> = { muskie: 3500, walleye: 2700, pike: 3300, smallmouth: 1600, perch: 1350 }
  return Math.cbrt(weightLb * (shape[species] ?? 2500))
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 0..1, falling away exponentially: small results are common, results near 1 are rare. */
export function decay(u: number, k: number): number {
  return -Math.log(1 - u * (1 - Math.exp(-k))) / k
}

/** Bottom of the near-record window: just under the book's #3. */
export function nearRecordAt(speciesId: SpeciesId): number {
  return RECORD_BOOK_SEED[speciesId][2].value * NEAR_RECORD_FRACTION
}

/** Which size class a measured value falls in. Shared by the client, online guests and the server. */
export function classify(speciesId: SpeciesId, value: number): SizeClass {
  const t = SPECIES_BY_ID[speciesId]
  if (value > RECORD_BOOK_SEED[speciesId][0].value) return 'record'
  if (value >= nearRecordAt(speciesId)) return 'near-record'
  if (value >= t.trophyAt) return 'trophy'
  if (value >= t.avg + (t.trophyAt - t.avg) * 0.25) return 'good'
  if (value >= t.avg - (t.avg - t.min) * 0.35) return 'average'
  return 'small'
}

export const SIZE_CLASS_LABEL: Record<SizeClass, string> = {
  small: 'Small',
  average: 'Average',
  good: 'Above average',
  trophy: 'Trophy',
  'near-record': 'Near record',
  record: 'New state record',
}

function hashKey(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const quarter = (v: number) => Math.round(v * 4) / 4
const eighth = (v: number) => Math.round(v * 8) / 8
const sixteenth = (v: number) => Math.round(v * 16) / 16

/**
 * Every record-book measurement of an animal, worked out from its main value alone so the
 * shooter, online guests and the server all get the same rack, spread and length.
 */
export function measure(speciesId: SpeciesId, value: number): Measures {
  const t = SPECIES_BY_ID[speciesId]
  const r = mulberry32(hashKey(`${speciesId}:${Math.round(value * 100)}`))
  if (t.kind === 'fish') {
    const length = fishLengthIn(speciesId, value) * (0.97 + r() * 0.06)
    return { weight: value, length: quarter(length) }
  }
  if (speciesId === 'whitetail') {
    const points = Math.max(3, Math.min(16, Math.round(4 + (value - 60) / 18 + (r() - 0.5) * 2.4)))
    const spread = Math.max(8, 7 + 0.064 * value + (r() - 0.5) * 2.4)
    const heavy = r() < 0.03 ? r() * 60 : 0
    const dressed = 110 + Math.max(0, value - 85) * 0.9 + r() * 45 + heavy
    return { score: value, points, spread: eighth(spread), dressed: Math.round(dressed) }
  }
  const skull = Math.min(23.9, 15.5 + (value - 140) / 650 * 7.4 + (r() - 0.5) * 1.0)
  return { weight: value, skull: sixteenth(Math.max(14, skull)) }
}

export class LootTableManager {
  readonly records: Record<SpeciesId, RecordEntry[]>
  private serial = 0

  constructor(private readonly rng: Rng = Math.random) {
    this.records = Object.fromEntries(Object.entries(RECORD_BOOK_SEED).map(([id, list]) => [id, list.map((e) => ({ ...e }))])) as Record<SpeciesId, RecordEntry[]>
  }

  pickSpecies(kind: SpeciesKind, habitat: Habitat, bias: Record<string, number> = {}): SpeciesTemplate {
    const pool = SPECIES.filter((s) => s.kind === kind)
    const weights = pool.map((s) => s.weight * (s.habitats.includes(habitat) ? 1 : 0.25) * (bias[s.id] ?? 1))
    const total = weights.reduce((a, b) => a + b, 0)
    let roll = this.rng() * total
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i]
      if (roll <= 0) return pool[i]
    }
    return pool[pool.length - 1]
  }

  /** Roll which size class a new animal is, using `RARITY`. Bait can shift the trophy odds only. */
  rollClass(trophyOdds = 1): 'everyday' | 'trophy' | 'near-record' | 'record' {
    const u = this.rng()
    if (u < RARITY.record) return 'record'
    if (u < RARITY.record + RARITY.nearRecord) return 'near-record'
    if (u < RARITY.record + RARITY.nearRecord + RARITY.trophy * trophyOdds) return 'trophy'
    return 'everyday'
  }

  /**
   * The everyday animal: most come out right around the average, a little more often a bit
   * smaller, and the bigger ones thin out exponentially toward the trophy line.
   */
  baselineValue(template: SpeciesTemplate): number {
    const { min, avg, trophyAt } = template
    if (this.rng() < BELOW_AVERAGE_SHARE) return avg - (avg - min) * Math.pow(this.rng(), 1.8)
    return avg + (trophyAt - avg) * decay(this.rng(), 4.5) * 0.999
  }

  /** A trophy: from the trophy line up toward the near-record window, smaller ones commoner. */
  trophyValue(template: SpeciesTemplate): number {
    const top = nearRecordAt(template.id)
    return template.trophyAt + (top - template.trophyAt) * decay(this.rng(), 4) * 0.999
  }

  /** Within a few percent of the book's top three, never past the all-time #1. */
  nearRecordValue(template: SpeciesTemplate): number {
    const book = RECORD_BOOK_SEED[template.id]
    const low = nearRecordAt(template.id)
    return Math.min(low + (book[0].value - low) * decay(this.rng(), 3), book[0].value)
  }

  /** A new all-time record: past the #1 by up to 3%. */
  recordValue(template: SpeciesTemplate): number {
    const top = RECORD_BOOK_SEED[template.id][0].value
    return Math.max(top * (1.001 + 0.029 * decay(this.rng(), 3)), round1(top + 0.1))
  }

  createSpecimen(speciesId: SpeciesId, trophyOdds = 1): Specimen {
    const template = SPECIES_BY_ID[speciesId]
    const rolled = this.rollClass(trophyOdds)
    let value = rolled === 'record' ? this.recordValue(template)
      : rolled === 'near-record' ? this.nearRecordValue(template)
        : rolled === 'trophy' ? this.trophyValue(template)
          : this.baselineValue(template)
    value = round1(Math.max(template.min, value))
    const top = RECORD_BOOK_SEED[speciesId][0].value
    if (rolled === 'record') value = Math.max(value, round1(top + 0.1))
    else if (value > top) value = top
    if (rolled === 'trophy') value = Math.max(value, template.trophyAt)
    const sizeClass = classify(speciesId, value)
    const legendary = sizeClass === 'record' || sizeClass === 'near-record'
    const measures = measure(speciesId, value)
    const weightLb = template.unit === 'lb' ? value : measures.dressed ?? 150
    const lengthIn = measures.length ?? 0
    const recordTier = this.placement(speciesId, value)
    return { species: speciesId, value, weightLb, lengthIn, legendary, recordTier, trophyPoints: this.trophyPoints(speciesId, value), serial: ++this.serial, sizeClass, measures }
  }

  placement(speciesId: SpeciesId, value: number): 0 | 1 | 2 | 3 {
    const book = this.records[speciesId]
    for (let i = 0; i < 3; i++) if (value > book[i].value) return (i + 1) as 1 | 2 | 3
    return 0
  }

  trophyPoints(speciesId: SpeciesId, value: number): number {
    const template = SPECIES_BY_ID[speciesId]
    const top = this.records[speciesId][0].value
    const span = Math.max(1e-6, top - template.min)
    return Math.max(1, Math.round(1000 * Math.pow(Math.max(0, value - template.min) / span, 1.6)))
  }

  isTrophy(specimen: Specimen): boolean {
    return specimen.legendary || specimen.value >= SPECIES_BY_ID[specimen.species].trophyAt
  }

  claim(specimen: Specimen, holder: string, place: string, year = new Date().getFullYear()): 0 | 1 | 2 | 3 {
    const tier = this.placement(specimen.species, specimen.value)
    if (!tier) return 0
    const book = this.records[specimen.species]
    book.splice(tier - 1, 0, { holder, value: specimen.value, year, place })
    book.length = 3
    return tier
  }
}

export function formatValue(speciesId: SpeciesId, value: number): string {
  const t = SPECIES_BY_ID[speciesId]
  if (t.unit === 'in') return `${value.toFixed(1)}″`
  const lb = Math.floor(value)
  const oz = Math.round((value - lb) * 16)
  return oz === 16 ? `${lb + 1} lb` : oz ? `${lb} lb ${oz} oz` : `${lb} lb`
}
