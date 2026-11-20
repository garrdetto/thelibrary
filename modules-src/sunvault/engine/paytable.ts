export const REELS = 5
export const ROWS = 3
export const CELLS = REELS * ROWS
export const LINE_COUNT = 25

export const Sym = {
  Ten: 0,
  Jack: 1,
  Queen: 2,
  King: 3,
  Ace: 4,
  Scarab: 5,
  Ankh: 6,
  Mask: 7,
  Pharaoh: 8,
  Explorer: 9,
  Wild: 10,
  Scatter: 11,
  Coin: 12,
  Sphinx: 13,
} as const

export type Sym = (typeof Sym)[keyof typeof Sym]

export const SYMBOL_COUNT = 14

export interface SymbolInfo {
  id: Sym
  key: string
  name: string
  kind: 'low' | 'high' | 'wild' | 'scatter' | 'coin' | 'collector'
}

export const SYMBOLS: readonly SymbolInfo[] = [
  { id: Sym.Ten, key: 'ten', name: '10', kind: 'low' },
  { id: Sym.Jack, key: 'jack', name: 'J', kind: 'low' },
  { id: Sym.Queen, key: 'queen', name: 'Q', kind: 'low' },
  { id: Sym.King, key: 'king', name: 'K', kind: 'low' },
  { id: Sym.Ace, key: 'ace', name: 'A', kind: 'low' },
  { id: Sym.Scarab, key: 'scarab', name: 'Scarab', kind: 'high' },
  { id: Sym.Ankh, key: 'ankh', name: 'Ankh', kind: 'high' },
  { id: Sym.Mask, key: 'mask', name: 'Golden Mask', kind: 'high' },
  { id: Sym.Pharaoh, key: 'pharaoh', name: 'Sun Queen', kind: 'high' },
  { id: Sym.Explorer, key: 'explorer', name: 'Explorer', kind: 'high' },
  { id: Sym.Wild, key: 'wild', name: 'Pyramid Wild', kind: 'wild' },
  { id: Sym.Scatter, key: 'scatter', name: 'Temple Scatter', kind: 'scatter' },
  { id: Sym.Coin, key: 'coin', name: 'Sun Coin', kind: 'coin' },
  { id: Sym.Sphinx, key: 'sphinx', name: 'Sphinx Collector', kind: 'collector' },
]

export const LINE_PAYS: Readonly<Partial<Record<Sym, readonly [number, number, number]>>> = {
  [Sym.Ten]: [10, 30, 100],
  [Sym.Jack]: [10, 30, 120],
  [Sym.Queen]: [10, 40, 150],
  [Sym.King]: [20, 50, 200],
  [Sym.Ace]: [20, 60, 250],
  [Sym.Scarab]: [30, 80, 300],
  [Sym.Ankh]: [40, 100, 400],
  [Sym.Mask]: [50, 150, 600],
  [Sym.Pharaoh]: [60, 200, 800],
  [Sym.Explorer]: [80, 300, 1000],
}

export const SCATTER_PAYS: Readonly<Record<number, number>> = { 3: 2, 4: 10, 5: 50 }
export const FREE_SPINS_AWARD = 6
export const RESPIN_TRIGGER = 6
export const RESPINS = 3

export const PAYLINES: readonly (readonly [number, number, number, number, number])[] = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 0, 1],
  [1, 2, 1, 2, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2], [1, 1, 0, 1, 1], [1, 1, 2, 1, 1],
  [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 2, 0, 2, 0], [2, 0, 2, 0, 2], [0, 0, 2, 0, 0],
  [2, 2, 0, 2, 2], [1, 0, 2, 0, 1], [1, 2, 0, 2, 1], [0, 2, 2, 2, 0], [2, 0, 0, 0, 2],
]

export type JackpotTier = 'mini' | 'minor' | 'major' | 'grand'
export const JACKPOT_TIERS: readonly JackpotTier[] = ['grand', 'major', 'minor', 'mini']
export const JACKPOT_MULTIPLIERS: Readonly<Record<JackpotTier, number>> = { mini: 10, minor: 50, major: 250, grand: 2000 }

export type CoinPrize = { kind: 'cash'; multiple: number } | { kind: 'jackpot'; tier: Exclude<JackpotTier, 'grand'> }

export interface WeightedTable<T> {
  items: readonly T[]
  weights: readonly number[]
}

const cash = (multiple: number): CoinPrize => ({ kind: 'cash', multiple })
const jackpot = (tier: Exclude<JackpotTier, 'grand'>): CoinPrize => ({ kind: 'jackpot', tier })

export const REEL_COIN_PRIZES: WeightedTable<CoinPrize> = {
  items: [cash(0.5), cash(1), cash(2), cash(3), cash(5), cash(10), jackpot('mini'), jackpot('minor')],
  weights: [600, 270, 90, 28, 15, 7, 5, 1],
}

export const RESPIN_COIN_PRIZES: WeightedTable<CoinPrize> = {
  items: [cash(0.5), cash(1), cash(2), cash(3), cash(5), cash(10), jackpot('mini'), jackpot('minor'), jackpot('major')],
  weights: [760, 600, 340, 140, 90, 40, 24, 5, 1],
}

export const EXPANSION_SIZES: WeightedTable<1 | 2 | 3> = { items: [1, 2, 3], weights: [70, 22, 8] }

export const PICK_ODDS = 1 / 900
export const PICK_TIERS: WeightedTable<JackpotTier> = { items: ['mini', 'minor', 'major', 'grand'], weights: [750, 200, 45, 5] }
export const PICK_TILES = 9

export type HaywireKind = 'wilds' | 'coins' | 'double'
export const HAYWIRE_ODDS = 1 / 100
export const HAYWIRE_EFFECTS: WeightedTable<HaywireKind> = { items: ['wilds', 'coins', 'double'], weights: [25, 35, 40] }
export const HAYWIRE_NAMES: Readonly<Record<HaywireKind, string>> = { wilds: 'Wild Surge', coins: 'Coin Storm', double: 'Double Trouble' }
export const HAYWIRE_WILD_COUNTS: WeightedTable<number> = { items: [3, 4, 5], weights: [75, 20, 5] }
export const HAYWIRE_COIN_COUNTS: WeightedTable<number> = { items: [3, 4, 5], weights: [50, 32, 18] }
export const HAYWIRE_COIN_PRIZES: WeightedTable<CoinPrize> = {
  items: [cash(0.5), cash(1), cash(2), cash(3)],
  weights: [550, 300, 110, 40],
}
export const HAYWIRE_MULTIPLIERS: WeightedTable<number> = { items: [2, 3, 5], weights: [75, 20, 5] }

export const RESPIN_CELL_ODDS = { coin: 0.05, sphinx: 0.006 }
export const ZONE_MULTIPLIERS = [1, 2, 3] as const

export type StripCounts = Readonly<Record<Sym, number>>

const counts = (low: [number, number, number, number, number], high: [number, number, number, number, number], wild: number, scatter: number, coin: number, sphinx: number): StripCounts => ({
  [Sym.Ten]: low[0], [Sym.Jack]: low[1], [Sym.Queen]: low[2], [Sym.King]: low[3], [Sym.Ace]: low[4],
  [Sym.Scarab]: high[0], [Sym.Ankh]: high[1], [Sym.Mask]: high[2], [Sym.Pharaoh]: high[3], [Sym.Explorer]: high[4],
  [Sym.Wild]: wild, [Sym.Scatter]: scatter, [Sym.Coin]: coin, [Sym.Sphinx]: sphinx,
})

export const BASE_STRIP_COUNTS: readonly StripCounts[] = [
  counts([9, 9, 8, 8, 7], [5, 5, 4, 3, 3], 0, 5, 10, 0),
  counts([9, 9, 8, 8, 7], [5, 5, 4, 3, 3], 3, 0, 10, 0),
  counts([9, 9, 8, 8, 7], [5, 5, 4, 3, 3], 3, 5, 10, 0),
  counts([9, 9, 8, 8, 7], [5, 5, 4, 3, 3], 3, 0, 10, 0),
  counts([9, 9, 8, 8, 7], [5, 5, 4, 3, 3], 0, 5, 10, 2),
]

export const FREE_STRIP_COUNTS: readonly StripCounts[] = [
  counts([8, 8, 8, 7, 7], [5, 5, 5, 4, 4], 0, 3, 9, 0),
  counts([8, 8, 8, 7, 7], [5, 5, 5, 4, 4], 4, 0, 9, 0),
  counts([8, 8, 8, 7, 7], [5, 5, 5, 4, 4], 4, 3, 9, 3),
  counts([8, 8, 8, 7, 7], [5, 5, 5, 4, 4], 4, 0, 9, 3),
  counts([8, 8, 8, 7, 7], [5, 5, 5, 4, 4], 0, 3, 9, 4),
]

function buildStrip(stripCounts: StripCounts, salt: number): Sym[] {
  let seed = (0x5157 + salt * 7919) >>> 0
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
    const target = symbol === Sym.Scatter || symbol === Sym.Sphinx ? special : regular
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
export const FREE_STRIPS: readonly (readonly Sym[])[] = FREE_STRIP_COUNTS.map((stripCounts, reel) => buildStrip(stripCounts, reel + 11))

export const BET_LEVELS_CENTS: readonly number[] = [20, 50, 100, 150, 200, 250, 300, 400, 500]
export const DEFAULT_BET_CENTS = 100
export const STARTING_BALANCE_CENTS = 100000

export interface ZoneRect {
  reel: number
  row: number
  width: number
  height: number
}

export const ZONE_RECTS: readonly ZoneRect[] = [
  { reel: 4, row: 1, width: 1, height: 1 },
  { reel: 3, row: 1, width: 2, height: 2 },
  { reel: 2, row: 0, width: 3, height: 3 },
]

export function expansionRect(reel: number, row: number, size: number): ZoneRect {
  const reelStart = Math.min(Math.max(0, reel - (size - 1)), REELS - size)
  const rowStart = Math.min(Math.max(0, row - Math.floor((size - 1) / 2)), ROWS - size)
  return { reel: reelStart, row: rowStart, width: size, height: size }
}

export function zoneContains(level: number, reel: number, row: number): boolean {
  const rect = ZONE_RECTS[Math.max(0, Math.min(ZONE_RECTS.length - 1, level))]
  return reel >= rect.reel && reel < rect.reel + rect.width && row >= rect.row && row < rect.row + rect.height
}
