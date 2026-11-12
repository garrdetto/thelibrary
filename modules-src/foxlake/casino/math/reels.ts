/**
 * Reel strips, stops and ways wins: the base of every machine, with no
 * drawing in it. A grid is `grid[reel][row]`, row 0 at the top.
 */
import { pick, seededRng, type Rng } from './rng'

export type SymbolId = string

export interface Paytable {
  /** Credits per way, in bet multiples, for 3, 4 and 5 of a kind left to right (index = count - 3; 3-reel games use index 0). */
  [symbol: SymbolId]: readonly number[]
}

export interface WaysWin {
  symbol: SymbolId
  /** How many reels in a row from the left the symbol (or a wild) reached. */
  count: number
  /** Ways: the product of matching cells on each of those reels. */
  ways: number
  /** Multiplier from wilds (free-spin wild multipliers), 1 when none. */
  multiplier: number
  /** Credits won. */
  pay: number
  /** Every cell that took part, for the win animation. */
  cells: [number, number][]
}

/**
 * A reel strip built from symbol weights: each symbol appears `weight` times,
 * spread around the reel by a seeded shuffle that avoids putting the same
 * symbol twice in a row where it can. Built the same way on the server and in
 * the browser, so a stop index means the same symbols everywhere.
 */
export function buildStrip(weights: Readonly<Record<SymbolId, number>>, seed: number): SymbolId[] {
  const bag: SymbolId[] = []
  for (const [sym, n] of Object.entries(weights)) for (let i = 0; i < n; i++) bag.push(sym)
  const rng = seededRng(seed)
  for (let i = bag.length - 1; i > 0; i--) {
    const j = pick(rng, i + 1)
    const t = bag[i]
    bag[i] = bag[j]
    bag[j] = t
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < bag.length; i++) {
      const next = (i + 1) % bag.length
      if (bag[i] !== bag[next]) continue
      for (let k = 2; k < bag.length; k++) {
        const j = (i + k) % bag.length
        if (bag[j] !== bag[i] && bag[(j + 1) % bag.length] !== bag[i] && bag[(j - 1 + bag.length) % bag.length] !== bag[i]) {
          const t = bag[next]
          bag[next] = bag[j]
          bag[j] = t
          break
        }
      }
    }
  }
  return bag
}

/** The rows a reel shows when it stops at `stop` (the top row is `stop`). */
export function windowAt(strip: readonly SymbolId[], stop: number, rows: number): SymbolId[] {
  const out: SymbolId[] = []
  for (let r = 0; r < rows; r++) out.push(strip[(stop + r) % strip.length])
  return out
}

export function spinStops(strips: readonly (readonly SymbolId[])[], rng: Rng): number[] {
  return strips.map((s) => pick(rng, s.length))
}

export function gridAt(strips: readonly (readonly SymbolId[])[], stops: readonly number[], rows: number): SymbolId[][] {
  return strips.map((s, i) => windowAt(s, stops[i], rows))
}

export interface WaysRules {
  wild: SymbolId | null
  /** Symbols that never pay as ways (scatters, coins, mystery). */
  nonPaying: ReadonlySet<SymbolId>
  paytable: Paytable
  /** Minimum reels in a row for a win (3 on 5-reel games). */
  minCount: number
  /** Multiplier shown on a wild cell (free spins); wilds on the winning ways multiply together. */
  wildMultiplier?: (reel: number, row: number) => number
  /** Symbols that count as another symbol (gold heads, upgraded animals). */
  substitute?: (sym: SymbolId) => SymbolId
}

/**
 * Left-to-right ways wins: for each paying symbol, reels from the left that
 * show it (or a wild) at least once; ways = product of matching cells; pays
 * the paytable entry for that many reels times ways times the bet. A symbol
 * pays once, at its longest run. Wild multipliers on a way multiply together,
 * summed across ways the way physical machines evaluate them (each way's
 * multiplier is the product of the wild multipliers on it).
 */
export function evaluateWays(grid: readonly (readonly SymbolId[])[], bet: number, rules: WaysRules): WaysWin[] {
  const sub = rules.substitute ?? ((s: SymbolId) => s)
  const wins: WaysWin[] = []
  const symbols = new Set<SymbolId>()
  for (const cell of grid[0]) {
    const s = sub(cell)
    if (s === rules.wild) continue
    if (!rules.nonPaying.has(s) && rules.paytable[s]) symbols.add(s)
  }
  if (rules.wild && grid[0].some((c) => sub(c) === rules.wild)) for (const s of Object.keys(rules.paytable)) if (!rules.nonPaying.has(s)) symbols.add(s)
  for (const sym of symbols) {
    let count = 0
    let waysWeighted = 1
    let ways = 1
    const cells: [number, number][] = []
    for (let r = 0; r < grid.length; r++) {
      let n = 0
      let weightedN = 0
      for (let row = 0; row < grid[r].length; row++) {
        const s = sub(grid[r][row])
        if (s === sym || (rules.wild !== null && s === rules.wild)) {
          n++
          weightedN += s === rules.wild && rules.wildMultiplier ? rules.wildMultiplier(r, row) : 1
          cells.push([r, row])
        }
      }
      if (!n) break
      count++
      ways *= n
      waysWeighted *= weightedN
    }
    const table = rules.paytable[sym]
    if (count < rules.minCount || !table) continue
    const pays = table[count - rules.minCount] ?? 0
    if (pays <= 0) continue
    const keep = cells.filter(([r]) => r < count)
    const multiplier = ways ? waysWeighted / ways : 1
    wins.push({ symbol: sym, count, ways, multiplier, pay: round(pays * waysWeighted * bet), cells: keep })
  }
  return wins
}

/** Cells holding `sym` anywhere on the grid. */
export function cellsOf(grid: readonly (readonly SymbolId[])[], sym: SymbolId): [number, number][] {
  const out: [number, number][] = []
  grid.forEach((col, r) => col.forEach((s, row) => { if (s === sym) out.push([r, row]) }))
  return out
}

export function round(n: number): number {
  return Math.round(n * 100) / 100
}
