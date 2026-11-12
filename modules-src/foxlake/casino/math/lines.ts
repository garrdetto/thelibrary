/** Fixed-line pays for 5 x 3 games (the link and collector machines). */
import { round, type Paytable, type SymbolId } from './reels'

/** The usual 25 line shapes on a 5 x 3 grid (row per reel, 0 = top); the first 20 serve 20-line games. */
export const LINES_25: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 0, 1],
  [1, 2, 1, 2, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2], [1, 1, 0, 1, 1], [1, 1, 2, 1, 1],
  [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 2, 0, 2, 0], [2, 0, 2, 0, 2], [0, 0, 2, 0, 0],
  [2, 2, 0, 2, 2], [1, 0, 2, 0, 1], [1, 2, 0, 2, 1], [0, 2, 2, 2, 0], [2, 0, 0, 0, 2],
]

export interface LineWin {
  symbol: SymbolId
  line: number
  count: number
  pay: number
  cells: [number, number][]
}

/** Left-to-right line wins; wilds substitute; a line pays its best symbol once. `lineBet` is the bet per line. */
export function evaluateLines(grid: readonly (readonly SymbolId[])[], lines: readonly (readonly number[])[], lineBet: number, paytable: Paytable, wild: SymbolId | null, nonPaying: ReadonlySet<SymbolId>): LineWin[] {
  const wins: LineWin[] = []
  lines.forEach((shape, li) => {
    const cells = shape.map((row, r) => grid[r][row])
    let best: LineWin | null = null
    const candidates = new Set<SymbolId>()
    for (const c of cells) if (c !== wild && !nonPaying.has(c)) candidates.add(c)
    if (wild && paytable[wild]) candidates.add(wild)
    for (const sym of candidates) {
      let count = 0
      for (const c of cells) {
        if (c === sym || (wild !== null && c === wild && !nonPaying.has(sym))) count++
        else break
      }
      const table = paytable[sym]
      if (!table || count < 3) continue
      const pay = round((table[count - 3] ?? 0) * lineBet)
      if (pay > 0 && (!best || pay > best.pay)) best = { symbol: sym, line: li, count, pay, cells: shape.slice(0, count).map((row, r) => [r, row] as [number, number]) }
    }
    if (best) wins.push(best)
  })
  return wins
}
