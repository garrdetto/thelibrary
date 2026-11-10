export type SpeciesKind = 'fish' | 'game'
export type SpeciesId = 'muskie' | 'walleye' | 'pike' | 'smallmouth' | 'perch' | 'carp' | 'whitetail' | 'blackbear'
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
  min: number
  max: number
  skew: number
  habitats: Habitat[]
  weight: number
  trophyAt: number
  fight: number
  facts: string
  /** Hard ceiling on the measured value (record-class specimens included). */
  cap?: number
}

export interface Specimen {
  species: SpeciesId
  value: number
  weightLb: number
  lengthIn: number
  legendary: boolean
  recordTier: 0 | 1 | 2 | 3
  trophyPoints: number
  serial: number
}

export const LEGENDARY_CHANCE = 0.04

const TIER_ODDS: [1 | 2 | 3, number][] = [[1, 0.2], [2, 0.3], [3, 0.5]]

export const SPECIES: SpeciesTemplate[] = [
  { id: 'muskie', name: 'Muskellunge', kind: 'fish', model: 'fish-muskie', unit: 'lb', measure: 'Weight', min: 6, max: 38, skew: 2.4, habitats: ['deep', 'weeds'], weight: 0.08, trophyAt: 30, fight: 1.0, facts: 'Wisconsin\'s state fish. An ambush hunter of weed edges and deep breaks; the "fish of ten thousand casts".' },
  { id: 'walleye', name: 'Walleye', kind: 'fish', model: 'fish-walleye', unit: 'lb', measure: 'Weight', min: 0.8, max: 9, skew: 2.2, habitats: ['deep', 'rocks'], weight: 0.3, trophyAt: 8, fight: 0.45, facts: 'A reflective layer behind the eye lets walleye feed in low light, so dusk and dawn on rock and gravel are best.' },
  { id: 'pike', name: 'Northern Pike', kind: 'fish', model: 'fish-pike', unit: 'lb', measure: 'Weight', min: 1.5, max: 16, skew: 2.3, habitats: ['weeds', 'marsh'], weight: 0.22, trophyAt: 14, fight: 0.7, facts: 'Pike spawn in flooded marsh as soon as the ice goes out and patrol the weed beds all summer.' },
  { id: 'smallmouth', name: 'Smallmouth Bass', kind: 'fish', model: 'fish-smallmouth', unit: 'lb', measure: 'Weight', min: 0.7, max: 5.5, skew: 2.0, habitats: ['rocks'], weight: 0.18, trophyAt: 5, fight: 0.6, facts: 'Bronze-sided bass of clear, rocky water; they hold where crayfish hide among boulders.' },
  { id: 'perch', name: 'Yellow Perch', kind: 'fish', model: 'fish-perch', unit: 'lb', measure: 'Weight', min: 0.15, max: 1.3, skew: 2.0, habitats: ['weeds', 'marsh', 'deep'], weight: 0.22, trophyAt: 1.2, fight: 0.25, facts: 'Perch school by size; find one and you have found a dozen. A key food for walleye and pike.' },
  { id: 'carp', name: 'Common Carp', kind: 'fish', model: 'fish-carp', unit: 'in', measure: 'Length', min: 10, max: 28.5, cap: 30, skew: 2.6, habitats: ['marsh', 'weeds'], weight: 0, trophyAt: 28, fight: 0.8, facts: 'An invasive rough fish that roots up weed beds and muddies the water. Bowfishers take them at night on the shallow flats, which helps the native fish.' },
  { id: 'whitetail', name: 'White-tailed Deer', kind: 'game', model: 'deer', unit: 'in', measure: 'Gross score', min: 85, max: 165, skew: 2.1, habitats: ['forest', 'marsh'], weight: 0.75, trophyAt: 160, fight: 0, facts: 'Antlers grow and drop every year. Gross score adds beam length, tine length and circumferences in inches.' },
  { id: 'blackbear', name: 'Black Bear', kind: 'game', model: 'bear', unit: 'lb', measure: 'Weight', min: 140, max: 420, skew: 2.2, habitats: ['forest'], weight: 0.25, trophyAt: 450, fight: 0, facts: 'Northern Wisconsin holds one of the densest black bear populations in the country; males fatten hard on acorns in fall.' },
]

export const SPECIES_BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s])) as Record<SpeciesId, SpeciesTemplate>

export const RECORD_BOOK_SEED: Record<SpeciesId, [RecordEntry, RecordEntry, RecordEntry]> = {
  muskie: [{ holder: 'A. Lindqvist', value: 69.7, year: 1949, place: 'Flowage country' }, { holder: 'C. Haugen', value: 67.5, year: 1949, place: 'Lac Courte' }, { holder: 'R. Pelto', value: 65.2, year: 1952, place: 'Tomahawk chain' }],
  walleye: [{ holder: 'T. Brekke', value: 18.0, year: 1933, place: 'High Lake' }, { holder: 'J. Mrozek', value: 17.4, year: 1961, place: 'Lake Winnebago' }, { holder: 'D. Olsen', value: 16.8, year: 1988, place: 'Green Bay' }],
  pike: [{ holder: 'H. Nygaard', value: 38.0, year: 1952, place: 'Lake Puckaway' }, { holder: 'E. Kowalski', value: 36.2, year: 1971, place: 'Chippewa River' }, { holder: 'M. Ruud', value: 34.5, year: 1997, place: 'Willow Flowage' }],
  smallmouth: [{ holder: 'L. Strand', value: 9.1, year: 1950, place: 'Indian Lake' }, { holder: 'W. Janke', value: 8.7, year: 1989, place: 'Door peninsula' }, { holder: 'S. Aho', value: 8.4, year: 2004, place: 'Menominee River' }],
  perch: [{ holder: 'P. Wendt', value: 3.3, year: 1954, place: 'Lake Winnebago' }, { holder: 'K. Laine', value: 3.1, year: 1976, place: 'Lake Michigan' }, { holder: 'B. Halvorsen', value: 2.9, year: 2011, place: 'Big Green' }],
  carp: [{ holder: 'D. Vang', value: 30.0, year: 2016, place: 'Lake Koshkonong' }, { holder: 'R. Szymanski', value: 29.6, year: 2009, place: 'Petenwell Flowage' }, { holder: 'L. Kiefer', value: 29.2, year: 1994, place: 'Lake Poygan' }],
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
  const shape: Record<string, number> = { muskie: 3500, walleye: 2700, pike: 3300, smallmouth: 1600, perch: 1350, carp: 1800 }
  return Math.cbrt(weightLb * (shape[species] ?? 2500))
}

/** Weight of a fish measured by length (carp): the length-weight curve, give or take 8 %. */
export function fishWeightLb(species: SpeciesId, lengthIn: number, rng: Rng = Math.random): number {
  const shape: Record<string, number> = { carp: 1800 }
  return round1(Math.max(0.3, (lengthIn ** 3 / (shape[species] ?? 2500)) * (0.92 + rng() * 0.16)))
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export class LootTableManager {
  readonly records: Record<SpeciesId, RecordEntry[]>
  private serial = 0

  constructor(private readonly rng: Rng = Math.random) {
    this.records = Object.fromEntries(Object.entries(RECORD_BOOK_SEED).map(([id, list]) => [id, list.map((e) => ({ ...e }))])) as Record<SpeciesId, RecordEntry[]>
  }

  pickSpecies(kind: SpeciesKind, habitat: Habitat, bias: Record<string, number> = {}): SpeciesTemplate {
    const pool = SPECIES.filter((s) => s.kind === kind && s.weight > 0)
    const weights = pool.map((s) => s.weight * (s.habitats.includes(habitat) ? 1 : 0.25) * (bias[s.id] ?? 1))
    const total = weights.reduce((a, b) => a + b, 0)
    let roll = this.rng() * total
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i]
      if (roll <= 0) return pool[i]
    }
    return pool[pool.length - 1]
  }

  baselineValue(template: SpeciesTemplate): number {
    const u = this.rng()
    const shaped = Math.pow(u, template.skew)
    const jitter = (this.rng() - 0.5) * 0.04 * (template.max - template.min)
    return Math.max(template.min, template.min + (template.max - template.min) * shaped + jitter)
  }

  legendaryValue(template: SpeciesTemplate, tier: 1 | 2 | 3): number {
    const book = this.records[template.id]
    const low = book[tier - 1].value
    const high = tier === 1 ? book[0].value * 1.035 : book[tier - 2].value
    return low + (high - low) * (0.05 + this.rng() * 0.9)
  }

  rollTier(): 1 | 2 | 3 {
    let roll = this.rng()
    for (const [tier, odds] of TIER_ODDS) {
      roll -= odds
      if (roll <= 0) return tier
    }
    return 3
  }

  createSpecimen(speciesId: SpeciesId): Specimen {
    const template = SPECIES_BY_ID[speciesId]
    let value = this.baselineValue(template)
    let legendary = false
    let tier: 1 | 2 | 3 = 3
    if (this.rng() < LEGENDARY_CHANCE) {
      tier = this.rollTier()
      value = this.legendaryValue(template, tier)
      legendary = true
    }
    value = round1(value)
    if (legendary) value = Math.max(value, round1(this.records[speciesId][tier - 1].value + 0.1))
    if (template.cap !== undefined) value = Math.min(value, template.cap)
    const lengthMeasured = template.kind === 'fish' && template.unit === 'in'
    const weightLb = template.unit === 'lb' ? value : lengthMeasured ? fishWeightLb(template.id, value, this.rng) : round1(130 + (value - 85) * 1.15 + this.rng() * 30)
    const lengthIn = lengthMeasured ? value : template.kind === 'fish' ? round1(fishLengthIn(template.id, weightLb)) : 0
    const recordTier = this.placement(speciesId, value)
    return { species: speciesId, value, weightLb, lengthIn, legendary, recordTier, trophyPoints: this.trophyPoints(speciesId, value), serial: ++this.serial }
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

/** Pounds and ounces, e.g. "7 lb 9 oz". */
export function formatPounds(value: number): string {
  const lb = Math.floor(value)
  const oz = Math.round((value - lb) * 16)
  return oz === 16 ? `${lb + 1} lb` : oz ? `${lb} lb ${oz} oz` : `${lb} lb`
}

export function formatValue(speciesId: SpeciesId, value: number): string {
  const t = SPECIES_BY_ID[speciesId]
  if (t.unit === 'in') return `${value.toFixed(1)}″`
  const lb = Math.floor(value)
  const oz = Math.round((value - lb) * 16)
  return oz === 16 ? `${lb + 1} lb` : oz ? `${lb} lb ${oz} oz` : `${lb} lb`
}
