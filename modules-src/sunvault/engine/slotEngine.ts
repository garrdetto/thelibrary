import {
  BASE_STRIPS,
  CELLS,
  EXPANSION_SIZES,
  JACKPOT_TIERS,
  PICK_ODDS,
  PICK_TIERS,
  PICK_TILES,
  expansionRect,
  FREE_SPINS_AWARD,
  FREE_STRIPS,
  JACKPOT_MULTIPLIERS,
  LINE_PAYS,
  PAYLINES,
  REEL_COIN_PRIZES,
  REELS,
  RESPIN_CELL_ODDS,
  RESPIN_COIN_PRIZES,
  RESPIN_TRIGGER,
  RESPINS,
  ROWS,
  SCATTER_PAYS,
  STARTING_BALANCE_CENTS,
  Sym,
  ZONE_MULTIPLIERS,
  ZONE_RECTS,
  zoneContains,
  type CoinPrize,
  type JackpotTier,
  type WeightedTable,
  type ZoneRect,
} from './paytable'
import { createRng, cryptoSeed, type Rng } from './rng'

export type Mode = 'base' | 'free' | 'respin'
export type CellRef = readonly [reel: number, row: number]
export type ForceOutcome = 'respin' | 'collect' | 'bigwin' | 'free' | 'grand' | 'pick'

export interface Cell {
  sym: Sym
  prize: CoinPrize | null
  value: number
}

export type Grid = Cell[][]

export interface LineWin {
  line: number
  symbol: Sym
  count: number
  win: number
  cells: CellRef[]
}

export interface ScatterResult {
  count: number
  cells: CellRef[]
  win: number
}

export interface CollectEvent {
  collector: CellRef
  sources: CellRef[]
  base: number
  multiplier: number
  amount: number
  inZone: boolean
  size: number
  rect: ZoneRect
}

export interface JackpotPick {
  tier: JackpotTier
  order: JackpotTier[]
  picks: number
  amount: number
}

export interface JackpotAward {
  tier: JackpotTier
  amount: number
  cell: CellRef | null
}

export interface RespinStep {
  respinsLeft: number
  reset: boolean
  filled: number
  newCells: CellRef[]
  held: boolean[][]
}

export interface FeatureEnd {
  kind: 'free' | 'respin'
  total: number
  grand: boolean
  closesFree: number | null
}

export interface Anticipation {
  reel: number
  reason: 'scatter' | 'coin'
}

export interface Stats {
  spins: number
  wagered: number
  won: number
  hits: number
  freeTriggers: number
  respinTriggers: number
  collects: number
  biggestWin: number
  jackpots: Record<JackpotTier, number>
}

export interface EngineSnapshot {
  mode: Mode
  balance: number
  bet: number
  freeSpinsLeft: number
  freeSpinsTotal: number
  freeTotal: number
  zoneLevel: number
  respinsLeft: number
  respinTotal: number
  pendingFreeSpins: number
  featureWin: number
  stats: Stats
}

export interface SpinResult {
  id: number
  mode: Mode
  bet: number
  grid: Grid
  heldBefore: boolean[][] | null
  lineWins: LineWin[]
  scatter: ScatterResult
  collects: CollectEvent[]
  jackpots: JackpotAward[]
  stepWin: number
  pick: JackpotPick | null
  anticipation: Anticipation | null
  trigger: 'free' | 'respin' | 'retrigger' | null
  freeSpinsAwarded: number
  zoneBefore: number
  zoneAfter: number
  respin: RespinStep | null
  featureEnd: FeatureEnd | null
  forced: ForceOutcome | null
  state: EngineSnapshot
}

export class SpinError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpinError'
  }
}

export interface EngineOptions {
  seed?: number | readonly number[]
  balance?: number
}

const emptyStats = (): Stats => ({
  spins: 0,
  wagered: 0,
  won: 0,
  hits: 0,
  freeTriggers: 0,
  respinTriggers: 0,
  collects: 0,
  biggestWin: 0,
  jackpots: { mini: 0, minor: 0, major: 0, grand: 0 },
})

export function prizeValue(prize: CoinPrize, bet: number): number {
  return prize.kind === 'cash' ? Math.round(prize.multiple * bet) : JACKPOT_MULTIPLIERS[prize.tier] * bet
}

export function isPaying(symbol: Sym): boolean {
  return symbol <= Sym.Explorer
}

export function evaluateLines(grid: Grid, bet: number): LineWin[] {
  const lineBet = bet / PAYLINES.length
  const wins: LineWin[] = []
  PAYLINES.forEach((rows, line) => {
    let symbol: Sym | null = null
    let count = 0
    for (let reel = 0; reel < REELS; reel++) {
      const here = grid[reel][rows[reel]].sym
      if (here === Sym.Wild) {
        count++
        continue
      }
      if (!isPaying(here)) break
      if (symbol === null) {
        symbol = here
        count++
        continue
      }
      if (here !== symbol) break
      count++
    }
    if (symbol === null || count < 3) return
    const pays = LINE_PAYS[symbol]
    if (!pays) return
    const win = Math.round(pays[count - 3] * lineBet)
    const cells: CellRef[] = []
    for (let reel = 0; reel < count; reel++) cells.push([reel, rows[reel]])
    wins.push({ line, symbol, count, win, cells })
  })
  return wins
}

export function findCells(grid: Grid, symbol: Sym): CellRef[] {
  const cells: CellRef[] = []
  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) if (grid[reel][row].sym === symbol) cells.push([reel, row])
  }
  return cells
}

export function evaluateScatter(grid: Grid, bet: number): ScatterResult {
  const cells = findCells(grid, Sym.Scatter)
  const multiple = SCATTER_PAYS[Math.min(cells.length, 5)] ?? 0
  return { count: cells.length, cells, win: multiple * bet }
}

export function anticipationFor(grid: Grid): Anticipation | null {
  let scatters = 0
  let coins = 0
  for (let reel = 0; reel < REELS - 1; reel++) {
    for (let row = 0; row < ROWS; row++) {
      if (grid[reel][row].sym === Sym.Scatter) scatters++
      if (grid[reel][row].sym === Sym.Coin) coins++
    }
  }
  if (scatters >= 2) return { reel: REELS - 1, reason: 'scatter' }
  if (coins >= 5) return { reel: REELS - 1, reason: 'coin' }
  return null
}

export function stripsFor(mode: Mode): readonly (readonly Sym[])[] {
  return mode === 'free' ? FREE_STRIPS : BASE_STRIPS
}

const cloneGrid = (grid: Grid): Grid => grid.map((reel) => reel.map((cell) => ({ ...cell })))
const blankHeld = (): boolean[][] => Array.from({ length: REELS }, () => Array<boolean>(ROWS).fill(false))

export class SlotEngine {
  private rng: Rng
  private mode: Mode = 'base'
  private balance: number
  private bet = 0
  private freeSpinsLeft = 0
  private freeSpinsTotal = 0
  private freeTotal = 0
  private zoneLevel = 0
  private respinsLeft = 0
  private respinGrid: Grid | null = null
  private held: boolean[][] = blankHeld()
  private respinReturn: Mode = 'base'
  private pendingFreeSpins = 0
  private featureWin = 0
  private forceFill = false
  private forceExpand = false
  private counter = 0
  private stats: Stats = emptyStats()

  constructor(options: EngineOptions = {}) {
    this.rng = createRng(options.seed ?? cryptoSeed())
    this.balance = options.balance ?? STARTING_BALANCE_CENTS
  }

  snapshot(): EngineSnapshot {
    return {
      mode: this.mode,
      balance: this.balance,
      bet: this.bet,
      freeSpinsLeft: this.freeSpinsLeft,
      freeSpinsTotal: this.freeSpinsTotal,
      freeTotal: this.freeTotal,
      zoneLevel: this.zoneLevel,
      respinsLeft: this.respinsLeft,
      respinTotal: this.respinGrid ? this.respinValue(this.respinGrid) : 0,
      pendingFreeSpins: this.pendingFreeSpins,
      featureWin: this.featureWin,
      stats: { ...this.stats, jackpots: { ...this.stats.jackpots } },
    }
  }

  get inFeature(): boolean {
    return this.mode !== 'base'
  }

  canSpin(bet: number): boolean {
    return this.mode !== 'base' || this.balance >= bet
  }

  addCredits(amount: number): EngineSnapshot {
    this.balance += Math.max(0, Math.round(amount))
    return this.snapshot()
  }

  resetStats(): EngineSnapshot {
    this.stats = emptyStats()
    return this.snapshot()
  }

  spin(bet: number, force: ForceOutcome | null = null): SpinResult {
    if (this.mode === 'respin') return this.playRespin(force)
    if (this.mode === 'free') return this.playReelSpin('free', this.bet, force)
    if (!Number.isInteger(bet) || bet <= 0) throw new SpinError('Bet must be a positive whole number of cents.')
    if (this.balance < bet) throw new SpinError('Not enough credits for this bet.')
    this.balance -= bet
    this.bet = bet
    this.featureWin = 0
    this.stats.spins++
    this.stats.wagered += bet
    return this.playReelSpin('base', bet, force)
  }

  private drawReels(mode: Mode, bet: number): Grid {
    const strips = stripsFor(mode)
    const grid: Grid = []
    for (let reel = 0; reel < REELS; reel++) {
      const strip = strips[reel]
      const stop = this.rng.int(strip.length)
      const column: Cell[] = []
      for (let row = 0; row < ROWS; row++) {
        const sym = strip[(stop + row) % strip.length]
        column.push(this.makeCell(sym, bet, REEL_COIN_PRIZES))
      }
      grid.push(column)
    }
    return grid
  }

  private makeCell(sym: Sym, bet: number, table: WeightedTable<CoinPrize>): Cell {
    if (sym !== Sym.Coin) return { sym, prize: null, value: 0 }
    const prize = this.rng.pick(table.items, table.weights)
    return { sym, prize, value: prizeValue(prize, bet) }
  }

  private randomCells(count: number, exclude: (reel: number, row: number) => boolean): CellRef[] {
    const pool: CellRef[] = []
    for (let reel = 0; reel < REELS; reel++) for (let row = 0; row < ROWS; row++) if (!exclude(reel, row)) pool.push([reel, row])
    for (let index = pool.length - 1; index > 0; index--) {
      const swap = this.rng.int(index + 1)
      ;[pool[index], pool[swap]] = [pool[swap], pool[index]]
    }
    return pool.slice(0, count)
  }

  private applyForce(grid: Grid, force: ForceOutcome, mode: Mode, bet: number): void {
    const coin = (reel: number, row: number) => {
      grid[reel][row] = this.makeCell(Sym.Coin, bet, REEL_COIN_PRIZES)
    }
    const clear = (reel: number, row: number, keep: Sym[] = []) => {
      const sym = grid[reel][row].sym
      if (keep.includes(sym)) return
      if (sym === Sym.Coin || sym === Sym.Sphinx || sym === Sym.Scatter) grid[reel][row] = { sym: Sym.Ten + this.rng.int(5) as Sym, prize: null, value: 0 }
    }
    if (force === 'pick') return
    if (force === 'free') {
      for (const reel of [0, 2, 4]) grid[reel][this.rng.int(ROWS)] = { sym: Sym.Scatter, prize: null, value: 0 }
      return
    }
    if (force === 'bigwin') {
      for (let reel = 0; reel < 3; reel++) for (let row = 0; row < ROWS; row++) grid[reel][row] = { sym: Sym.Explorer, prize: null, value: 0 }
      grid[3][1] = { sym: Sym.Wild, prize: null, value: 0 }
      grid[3][0] = { sym: Sym.Explorer, prize: null, value: 0 }
      return
    }
    if (force === 'collect') {
      for (let reel = 0; reel < REELS; reel++) for (let row = 0; row < ROWS; row++) clear(reel, row)
      const sphinxRow = mode === 'free' ? ZONE_RECTS[this.zoneLevel].row : this.rng.int(ROWS)
      grid[4][sphinxRow] = { sym: Sym.Sphinx, prize: null, value: 0 }
      for (const [reel, row] of this.randomCells(3 + this.rng.int(2), (reel, row) => reel === 4 && row === sphinxRow)) coin(reel, row)
      return
    }
    const target = force === 'grand' ? CELLS - 1 : RESPIN_TRIGGER + this.rng.int(2)
    for (let reel = 0; reel < REELS; reel++) for (let row = 0; row < ROWS; row++) clear(reel, row)
    for (const [reel, row] of this.randomCells(target, () => false)) coin(reel, row)
    if (force === 'grand') this.forceFill = true
  }

  private collectsFor(mode: Mode, grid: Grid): CollectEvent[] {
    const coins = findCells(grid, Sym.Coin)
    if (coins.length === 0) return []
    const base = coins.reduce((sum, [reel, row]) => sum + grid[reel][row].value, 0)
    return findCells(grid, Sym.Sphinx).map((collector) => {
      const inZone = mode === 'free' && zoneContains(this.zoneLevel, collector[0], collector[1])
      let size: number = this.rng.pick(EXPANSION_SIZES.items, EXPANSION_SIZES.weights)
      if (this.forceExpand) size = 3
      let rect = expansionRect(collector[0], collector[1], size)
      if (inZone && this.zoneLevel + 1 >= size) {
        size = this.zoneLevel + 1
        rect = { ...ZONE_RECTS[this.zoneLevel] }
      }
      const multiplier = ZONE_MULTIPLIERS[size - 1]
      return { collector, sources: coins, base, multiplier, amount: base * multiplier, inZone, size, rect }
    })
  }

  private jackpotsFromCollects(grid: Grid, collects: CollectEvent[]): JackpotAward[] {
    const awards: JackpotAward[] = []
    for (const event of collects) {
      for (const cell of event.sources) {
        const prize = grid[cell[0]][cell[1]].prize
        if (prize?.kind === 'jackpot') awards.push({ tier: prize.tier, amount: grid[cell[0]][cell[1]].value * event.multiplier, cell })
      }
    }
    return awards
  }

  private playReelSpin(mode: 'base' | 'free', bet: number, force: ForceOutcome | null): SpinResult {
    const grid = this.drawReels(mode, bet)
    if (force) this.applyForce(grid, force, mode, bet)
    const zoneBefore = this.zoneLevel
    const lineWins = evaluateLines(grid, bet)
    const scatter = evaluateScatter(grid, bet)
    const coinCount = findCells(grid, Sym.Coin).length
    const respinTriggered = coinCount >= RESPIN_TRIGGER
    this.forceExpand = force === 'collect'
    const collects = respinTriggered ? [] : this.collectsFor(mode, grid)
    this.forceExpand = false
    const jackpots = this.jackpotsFromCollects(grid, collects)
    const lineTotal = lineWins.reduce((sum, win) => sum + win.win, 0)
    const collectTotal = collects.reduce((sum, event) => sum + event.amount, 0)
    const pick = mode === 'base' && (force === 'pick' || this.rng.next() < PICK_ODDS) ? this.drawPick(bet) : null
    if (pick) jackpots.push({ tier: pick.tier, amount: pick.amount, cell: null })
    const stepWin = lineTotal + scatter.win + collectTotal + (pick?.amount ?? 0)

    let trigger: SpinResult['trigger'] = null
    let freeSpinsAwarded = 0
    let featureEnd: FeatureEnd | null = null
    if (scatter.count >= 3) {
      freeSpinsAwarded = FREE_SPINS_AWARD
      trigger = mode === 'free' ? 'retrigger' : 'free'
    }

    this.credit(stepWin)
    for (const award of jackpots) this.stats.jackpots[award.tier]++
    if (collects.length > 0) this.stats.collects++

    if (mode === 'free') {
      this.freeTotal += stepWin
      this.freeSpinsLeft--
      if (collects.length > 0) this.zoneLevel = Math.min(ZONE_RECTS.length - 1, this.zoneLevel + 1)
      if (freeSpinsAwarded > 0) {
        this.freeSpinsLeft += freeSpinsAwarded
        this.freeSpinsTotal += freeSpinsAwarded
      }
    } else if (freeSpinsAwarded > 0) {
      this.stats.freeTriggers++
    }

    if (respinTriggered) {
      trigger = 'respin'
      this.startRespins(mode, grid, bet, freeSpinsAwarded)
    } else if (mode === 'base' && freeSpinsAwarded > 0) {
      this.enterFree(freeSpinsAwarded)
    } else if (mode === 'free' && this.freeSpinsLeft <= 0) {
      featureEnd = { kind: 'free', total: this.freeTotal, grand: false, closesFree: null }
      this.mode = 'base'
      this.zoneLevel = 0
    }

    if (mode === 'base' && (stepWin > 0 || trigger)) this.stats.hits++
    this.trackBiggest()

    return {
      id: ++this.counter,
      mode,
      bet,
      grid: cloneGrid(grid),
      heldBefore: null,
      lineWins,
      scatter,
      collects,
      jackpots,
      stepWin,
      pick,
      anticipation: anticipationFor(grid),
      trigger,
      freeSpinsAwarded,
      zoneBefore,
      zoneAfter: this.zoneLevel,
      respin: respinTriggered ? { respinsLeft: this.respinsLeft, reset: true, filled: coinCount + findCells(grid, Sym.Sphinx).length, newCells: [], held: this.held.map((reel) => [...reel]) } : null,
      featureEnd,
      forced: force,
      state: this.snapshot(),
    }
  }

  private drawPick(bet: number): JackpotPick {
    const tier = this.rng.pick(PICK_TIERS.items, PICK_TIERS.weights)
    const pool: JackpotTier[] = []
    for (const candidate of JACKPOT_TIERS) for (let copy = 0; copy < (candidate === tier ? 3 : 2); copy++) pool.push(candidate)
    for (let index = pool.length - 1; index > 0; index--) {
      const swap = this.rng.int(index + 1)
      ;[pool[index], pool[swap]] = [pool[swap], pool[index]]
    }
    let seen = 0
    let picks = PICK_TILES
    for (let index = 0; index < pool.length; index++) {
      if (pool[index] !== tier) continue
      seen++
      if (seen === 3) {
        picks = index + 1
        break
      }
    }
    return { tier, order: pool, picks, amount: JACKPOT_MULTIPLIERS[tier] * bet }
  }

  private enterFree(spins: number): void {
    this.mode = 'free'
    this.freeSpinsLeft = spins
    this.freeSpinsTotal = spins
    this.freeTotal = 0
    this.zoneLevel = 0
  }

  private startRespins(from: 'base' | 'free', grid: Grid, bet: number, freeSpinsAwarded: number): void {
    this.stats.respinTriggers++
    this.respinReturn = from
    this.pendingFreeSpins = from === 'base' ? freeSpinsAwarded : 0
    this.held = blankHeld()
    const respinGrid: Grid = cloneGrid(grid)
    for (let reel = 0; reel < REELS; reel++) {
      for (let row = 0; row < ROWS; row++) {
        const sym = respinGrid[reel][row].sym
        if (sym === Sym.Coin || sym === Sym.Sphinx) this.held[reel][row] = true
        else respinGrid[reel][row] = { sym: Sym.Ten, prize: null, value: 0 }
      }
    }
    const coinTotal = this.coinTotal(respinGrid)
    for (const [reel, row] of findCells(respinGrid, Sym.Sphinx)) respinGrid[reel][row].value = coinTotal
    this.respinGrid = respinGrid
    this.respinsLeft = RESPINS
    this.bet = bet
    this.mode = 'respin'
  }

  private coinTotal(grid: Grid): number {
    let total = 0
    for (let reel = 0; reel < REELS; reel++) for (let row = 0; row < ROWS; row++) if (grid[reel][row].sym === Sym.Coin) total += grid[reel][row].value
    return total
  }

  private respinValue(grid: Grid): number {
    let total = 0
    for (let reel = 0; reel < REELS; reel++) {
      for (let row = 0; row < ROWS; row++) {
        const cell = grid[reel][row]
        if (cell.sym === Sym.Coin || cell.sym === Sym.Sphinx) total += cell.value
      }
    }
    return total
  }

  private heldCount(): number {
    return this.held.reduce((sum, reel) => sum + reel.filter(Boolean).length, 0)
  }

  private playRespin(force: ForceOutcome | null): SpinResult {
    const grid = this.respinGrid
    if (!grid) throw new SpinError('Vault Respins are not active.')
    const heldBefore = this.held.map((reel) => [...reel])
    const bet = this.bet
    const newCells: CellRef[] = []
    const fill = this.forceFill || force === 'grand'
    this.forceFill = false
    for (let reel = 0; reel < REELS; reel++) {
      for (let row = 0; row < ROWS; row++) {
        if (this.held[reel][row]) continue
        const roll = this.rng.next()
        let sym: Sym | null = null
        if (fill || roll < RESPIN_CELL_ODDS.coin) sym = Sym.Coin
        else if (roll < RESPIN_CELL_ODDS.coin + RESPIN_CELL_ODDS.sphinx) sym = Sym.Sphinx
        if (sym === null) {
          grid[reel][row] = { sym: (Sym.Ten + this.rng.int(10)) as Sym, prize: null, value: 0 }
          continue
        }
        grid[reel][row] = this.makeCell(sym, bet, RESPIN_COIN_PRIZES)
        this.held[reel][row] = true
        newCells.push([reel, row])
      }
    }
    const collects: CollectEvent[] = []
    const newSphinx = newCells.filter(([reel, row]) => grid[reel][row].sym === Sym.Sphinx)
    if (newSphinx.length > 0) {
      const coins = findCells(grid, Sym.Coin)
      const base = this.coinTotal(grid)
      for (const collector of newSphinx) {
        grid[collector[0]][collector[1]].value = base
        if (coins.length > 0) collects.push({ collector, sources: coins, base, multiplier: 1, amount: base, inZone: false, size: 1, rect: { reel: collector[0], row: collector[1], width: 1, height: 1 } })
      }
    }
    const reset = newCells.length > 0
    this.respinsLeft = reset ? RESPINS : this.respinsLeft - 1
    const filled = this.heldCount()
    const full = filled === CELLS

    let stepWin = 0
    let featureEnd: FeatureEnd | null = null
    const jackpots: JackpotAward[] = []
    if (full || this.respinsLeft <= 0) {
      for (let reel = 0; reel < REELS; reel++) {
        for (let row = 0; row < ROWS; row++) {
          const prize = grid[reel][row].prize
          if (grid[reel][row].sym === Sym.Coin && prize?.kind === 'jackpot') jackpots.push({ tier: prize.tier, amount: grid[reel][row].value, cell: [reel, row] })
        }
      }
      stepWin = this.respinValue(grid)
      if (full) {
        const grand = JACKPOT_MULTIPLIERS.grand * bet
        jackpots.push({ tier: 'grand', amount: grand, cell: null })
        stepWin += grand
      }
      for (const award of jackpots) this.stats.jackpots[award.tier]++
      this.credit(stepWin)
      const closesFree = this.finishRespins(stepWin)
      featureEnd = { kind: 'respin', total: stepWin, grand: full, closesFree }
    }
    this.trackBiggest()

    const snapshotGrid = cloneGrid(grid)
    return {
      id: ++this.counter,
      mode: 'respin',
      bet,
      grid: snapshotGrid,
      heldBefore,
      lineWins: [],
      scatter: { count: 0, cells: [], win: 0 },
      collects,
      jackpots,
      stepWin,
      pick: null,
      anticipation: null,
      trigger: null,
      freeSpinsAwarded: 0,
      zoneBefore: this.zoneLevel,
      zoneAfter: this.zoneLevel,
      respin: { respinsLeft: Math.max(0, this.respinsLeft), reset, filled, newCells, held: heldBefore.map((reel, r) => reel.map((wasHeld, row) => wasHeld || newCells.some(([nr, nrow]) => nr === r && nrow === row))) },
      featureEnd,
      forced: force,
      state: this.snapshot(),
    }
  }

  private finishRespins(total: number): number | null {
    this.respinGrid = null
    this.held = blankHeld()
    this.respinsLeft = 0
    if (this.respinReturn === 'free') {
      this.freeTotal += total
      if (this.freeSpinsLeft > 0) {
        this.mode = 'free'
        return null
      }
      this.mode = 'base'
      this.zoneLevel = 0
      return this.freeTotal
    }
    if (this.pendingFreeSpins > 0) {
      this.enterFree(this.pendingFreeSpins)
      this.pendingFreeSpins = 0
      return null
    }
    this.mode = 'base'
    return null
  }

  private credit(amount: number): void {
    if (amount <= 0) return
    this.balance += amount
    this.featureWin += amount
    this.stats.won += amount
  }

  private trackBiggest(): void {
    if (this.mode === 'base' && this.featureWin > this.stats.biggestWin) this.stats.biggestWin = this.featureWin
  }
}
