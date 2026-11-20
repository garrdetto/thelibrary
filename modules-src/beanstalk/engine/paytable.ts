export const REELS = 5
export const ROWS = 4
export const CELLS = REELS * ROWS

export const Sym = {
  Ten: 0,
  Jack: 1,
  Queen: 2,
  King: 3,
  Ace: 4,
  Bean: 5,
  Axe: 6,
  Harp: 7,
  Hen: 8,
  Giant: 9,
  Seed: 10,
  Vine: 11,
  Castle: 12,
} as const

export type Sym = (typeof Sym)[keyof typeof Sym]

export const SYMBOL_COUNT = 13

export interface SymbolInfo {
  id: Sym
  key: string
  name: string
  kind: 'low' | 'high' | 'wild' | 'scatter'
}

export const SYMBOLS: readonly SymbolInfo[] = [
  { id: Sym.Ten, key: 'ten', name: '10', kind: 'low' },
  { id: Sym.Jack, key: 'jack', name: 'J', kind: 'low' },
  { id: Sym.Queen, key: 'queen', name: 'Q', kind: 'low' },
  { id: Sym.King, key: 'king', name: 'K', kind: 'low' },
  { id: Sym.Ace, key: 'ace', name: 'A', kind: 'low' },
  { id: Sym.Bean, key: 'bean', name: 'Magic Beans', kind: 'high' },
  { id: Sym.Axe, key: 'axe', name: 'Woodcutter’s Axe', kind: 'high' },
  { id: Sym.Harp, key: 'harp', name: 'Singing Harp', kind: 'high' },
  { id: Sym.Hen, key: 'hen', name: 'Golden Hen', kind: 'high' },
  { id: Sym.Giant, key: 'giant', name: 'Cloud Giant', kind: 'high' },
  { id: Sym.Seed, key: 'seed', name: 'Sprout Wild', kind: 'wild' },
  { id: Sym.Vine, key: 'vine', name: 'Vine Wild', kind: 'wild' },
  { id: Sym.Castle, key: 'castle', name: 'Cloud Castle', kind: 'scatter' },
]

export const WAY_PAYS: Readonly<Partial<Record<Sym, readonly [number, number, number]>>> = {
  [Sym.Ten]: [2, 5, 15],
  [Sym.Jack]: [2, 5, 15],
  [Sym.Queen]: [2, 6, 20],
  [Sym.King]: [3, 8, 25],
  [Sym.Ace]: [3, 8, 25],
  [Sym.Bean]: [5, 15, 50],
  [Sym.Axe]: [6, 20, 60],
  [Sym.Harp]: [8, 25, 80],
  [Sym.Hen]: [10, 30, 120],
  [Sym.Giant]: [15, 50, 200],
}

export const BET_UNITS = 122

export function wayWin(pay: number, ways: number, bet: number): number {
  return Math.max(1, Math.round(pay * ways * (bet / BET_UNITS)))
}

export const SCATTER_PAYS: Readonly<Record<number, number>> = { 3: 2, 4: 10, 5: 50 }
export const FREE_SPINS_AWARD = 5
export const MIN_WAY = 3

export interface WeightedTable<T> {
  items: readonly T[]
  weights: readonly number[]
}

export const SEED_MULTIPLIERS: WeightedTable<number> = { items: [1, 2, 3], weights: [82, 14, 4] }
export const FREE_SEED_MULTIPLIERS: WeightedTable<number> = { items: [1, 2, 3], weights: [62, 28, 10] }
export const CLIMB_HEIGHTS: WeightedTable<number> = { items: [0, 1, 2, 3], weights: [34, 30, 24, 12] }
export const SPREAD_CHANCE = 0.2
export const SPREAD_FALLOFF = 0.55
export const SPREAD_LEFT_SHARE = 0.4
export const MAX_GROWTH = 12

export type HaywireKind = 'overgrowth' | 'stalk' | 'double'
export const HAYWIRE_ODDS = 1 / 75
export const HAYWIRE_KINDS: WeightedTable<HaywireKind> = { items: ['overgrowth', 'stalk', 'double'], weights: [45, 30, 25] }
export const HAYWIRE_MULTIPLIERS: WeightedTable<number> = { items: [2, 3, 5], weights: [70, 24, 6] }
export const HAYWIRE_SPREAD_BOOST = 2.6
export const HAYWIRE_NAMES: Readonly<Record<HaywireKind, string>> = { overgrowth: 'Overgrowth', stalk: 'Giant Stalk', double: 'Bean Burst' }

export type StripCounts = Readonly<Record<Sym, number>>

const counts = (low: [number, number, number, number, number], high: [number, number, number, number, number], seed: number, castle: number): StripCounts => ({
  [Sym.Ten]: low[0], [Sym.Jack]: low[1], [Sym.Queen]: low[2], [Sym.King]: low[3], [Sym.Ace]: low[4],
  [Sym.Bean]: high[0], [Sym.Axe]: high[1], [Sym.Harp]: high[2], [Sym.Hen]: high[3], [Sym.Giant]: high[4],
  [Sym.Seed]: seed, [Sym.Vine]: 0, [Sym.Castle]: castle,
})

export const BASE_STRIP_COUNTS: readonly StripCounts[] = [
  counts([10, 10, 9, 9, 8], [6, 5, 5, 4, 3], 0, 3),
  counts([10, 10, 9, 9, 8], [6, 5, 5, 4, 3], 2, 0),
  counts([10, 10, 9, 9, 8], [6, 5, 5, 4, 3], 2, 3),
  counts([10, 10, 9, 9, 8], [6, 5, 5, 4, 3], 2, 0),
  counts([10, 10, 9, 9, 8], [6, 5, 5, 4, 3], 2, 3),
]

export const FREE_STRIP_COUNTS: readonly StripCounts[] = [
  counts([10, 10, 9, 9, 8], [6, 5, 5, 4, 4], 1, 0),
  counts([10, 10, 9, 9, 8], [6, 5, 5, 4, 4], 2, 0),
  counts([10, 10, 9, 9, 8], [6, 5, 5, 4, 4], 2, 0),
  counts([10, 10, 9, 9, 8], [6, 5, 5, 4, 4], 2, 0),
  counts([10, 10, 9, 9, 8], [6, 5, 5, 4, 4], 2, 0),
]

function buildStrip(stripCounts: StripCounts, salt: number): Sym[] {
  let seed = (0xbea5 + salt * 7919) >>> 0
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const shuffle = (items: Sym[]) => {
    for (let index = items.length - 1; index > 0; index--) {
      const swap = Math.floor(rand() * (index + 1))
      ;[items[index], items[swap]] = [items[swap], items[index]]
    }
    return items
  }
  const regular: Sym[] = []
  const special: Sym[] = []
  for (let symbol = 0; symbol < SYMBOL_COUNT; symbol++) {
    const target = symbol === Sym.Castle || symbol === Sym.Seed ? special : regular
    for (let copy = 0; copy < stripCounts[symbol as Sym]; copy++) target.push(symbol as Sym)
  }
  shuffle(regular)
  shuffle(special)
  const length = regular.length + special.length
  const strip: Sym[] = []
  let placed = 0
  for (let index = 0; index < length; index++) {
    const due = special.length > 0 && placed < special.length && index >= Math.floor((placed * length) / special.length + length / (special.length * 2))
    strip.push(due ? special[placed++] : (regular.pop() as Sym))
  }
  while (placed < special.length) strip.push(special[placed++])
  return strip
}

export const BASE_STRIPS: readonly (readonly Sym[])[] = BASE_STRIP_COUNTS.map((stripCounts, reel) => buildStrip(stripCounts, reel + 1))
export const FREE_STRIPS: readonly (readonly Sym[])[] = FREE_STRIP_COUNTS.map((stripCounts, reel) => buildStrip(stripCounts, reel + 21))

export const BET_LEVELS_CENTS: readonly number[] = [25, 50, 100, 150, 200, 250, 300, 400, 500]
export const DEFAULT_BET_CENTS = 100
export const STARTING_BALANCE_CENTS = 100000

export function isWild(symbol: Sym): boolean {
  return symbol === Sym.Seed || symbol === Sym.Vine
}

export function isPaying(symbol: Sym): boolean {
  return symbol <= Sym.Giant
}
