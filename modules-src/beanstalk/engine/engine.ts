import { createRng, cryptoSeed, type Rng } from '../../sunvault/engine/rng'
import {
  BASE_STRIPS,
  CLIMB_HEIGHTS,
  FREE_SEED_MULTIPLIERS,
  FREE_SPINS_AWARD,
  FREE_STRIPS,
  HAYWIRE_KINDS,
  HAYWIRE_MULTIPLIERS,
  HAYWIRE_ODDS,
  HAYWIRE_SPREAD_BOOST,
  MAX_GROWTH,
  MIN_WAY,
  REELS,
  ROWS,
  SCATTER_PAYS,
  SEED_MULTIPLIERS,
  SPREAD_CHANCE,
  SPREAD_FALLOFF,
  SPREAD_LEFT_SHARE,
  STARTING_BALANCE_CENTS,
  Sym,
  WAY_PAYS,
  isPaying,
  isWild,
  wayWin,
  type HaywireKind,
} from './paytable'

export type Mode = 'base' | 'free'
export type CellRef = readonly [reel: number, row: number]
export type ForceOutcome = 'free' | 'grow' | 'bigwin' | 'haywire'

export interface Cell {
  sym: Sym
  mult: number
}

export type Grid = Cell[][]

export interface GrowStep {
  from: CellRef
  to: CellRef
  kind: 'climb' | 'spread'
}

export interface WayWin {
  symbol: Sym
  count: number
  ways: number
  win: number
  cells: CellRef[]
}

export interface ScatterResult {
  count: number
  cells: CellRef[]
  win: number
}

export interface Haywire {
  kind: HaywireKind
  cells: CellRef[]
  multiplier: number
  planted: { cell: CellRef; mult: number }[]
}

export interface FeatureEnd {
  total: number
}

export interface Stats {
  spins: number
  wagered: number
  won: number
  hits: number
  freeTriggers: number
  haywires: number
  biggestWin: number
  vines: number
}

export interface EngineSnapshot {
  mode: Mode
  balance: number
  bet: number
  freeSpinsLeft: number
  freeSpinsTotal: number
  freeTotal: number
  featureWin: number
  sticky: boolean[][]
  stats: Stats
}

export interface SpinResult {
  id: number
  mode: Mode
  bet: number
  landed: Grid
  held: boolean[][] | null
  haywire: Haywire | null
  growth: GrowStep[]
  grid: Grid
  ways: WayWin[]
  scatter: ScatterResult
  multiplier: number
  stepWin: number
  trigger: 'free' | null
  freeSpinsAwarded: number
  featureEnd: FeatureEnd | null
  forced: ForceOutcome | null
  state: EngineSnapshot
}

export interface EngineState {
  version: 1
  rng: number[]
  mode: Mode
  balance: number
  bet: number
  freeSpinsLeft: number
  freeSpinsTotal: number
  freeTotal: number
  featureWin: number
  sticky: (Cell | null)[][]
  counter: number
  stats: Stats
}

export interface EngineOptions {
  seed?: number | readonly number[]
  balance?: number
}

export class SpinError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpinError'
  }
}

const emptyStats = (): Stats => ({ spins: 0, wagered: 0, won: 0, hits: 0, freeTriggers: 0, haywires: 0, biggestWin: 0, vines: 0 })
const blankSticky = (): (Cell | null)[][] => Array.from({ length: REELS }, () => Array<Cell | null>(ROWS).fill(null))
const cloneGrid = (grid: Grid): Grid => grid.map((reel) => reel.map((cell) => ({ ...cell })))
const plain = (sym: Sym): Cell => ({ sym, mult: 1 })

export function stripsFor(mode: Mode): readonly (readonly Sym[])[] {
  return mode === 'free' ? FREE_STRIPS : BASE_STRIPS
}

export function findCells(grid: Grid, test: (sym: Sym) => boolean): CellRef[] {
  const cells: CellRef[] = []
  for (let reel = 0; reel < REELS; reel++) for (let row = 0; row < ROWS; row++) if (test(grid[reel][row].sym)) cells.push([reel, row])
  return cells
}

export function evaluateWays(grid: Grid, bet: number): WayWin[] {
  const wins: WayWin[] = []
  for (let symbol = Sym.Ten as number; symbol <= Sym.Giant; symbol++) {
    const pays = WAY_PAYS[symbol as Sym]
    if (!pays) continue
    let total = 1
    let wildOnly = 1
    let count = 0
    let real = false
    for (let reel = 0; reel < REELS; reel++) {
      let weight = 0
      let wildWeight = 0
      for (let row = 0; row < ROWS; row++) {
        const cell = grid[reel][row]
        if (cell.sym === symbol) {
          weight += 1
          real = true
        } else if (isWild(cell.sym)) {
          weight += cell.mult
          wildWeight += cell.mult
        }
      }
      if (weight === 0) break
      total *= weight
      wildOnly *= wildWeight
      count++
    }
    if (count < MIN_WAY) continue
    const ways = symbol === Sym.Giant ? total : total - wildOnly
    if (ways <= 0 || (!real && symbol !== Sym.Giant)) continue
    const cells: CellRef[] = []
    for (let reel = 0; reel < count; reel++) for (let row = 0; row < ROWS; row++) if (grid[reel][row].sym === symbol || isWild(grid[reel][row].sym)) cells.push([reel, row])
    wins.push({ symbol: symbol as Sym, count, ways, win: wayWin(pays[count - MIN_WAY], ways, bet), cells })
  }
  return wins
}

export function evaluateScatter(grid: Grid, bet: number): ScatterResult {
  const cells = findCells(grid, (sym) => sym === Sym.Castle)
  const multiple = SCATTER_PAYS[Math.min(cells.length, 5)] ?? 0
  return { count: cells.length, cells, win: multiple * bet }
}

export class BeanstalkEngine {
  private rng: Rng
  private mode: Mode = 'base'
  private balance: number
  private bet = 0
  private freeSpinsLeft = 0
  private freeSpinsTotal = 0
  private freeTotal = 0
  private featureWin = 0
  private sticky: (Cell | null)[][] = blankSticky()
  private counter = 0
  private stats: Stats = emptyStats()

  constructor(options: EngineOptions = {}) {
    this.rng = createRng(options.seed ?? cryptoSeed())
    this.balance = options.balance ?? STARTING_BALANCE_CENTS
  }

  toState(): EngineState {
    return {
      version: 1,
      rng: [...this.rng.state()],
      mode: this.mode,
      balance: this.balance,
      bet: this.bet,
      freeSpinsLeft: this.freeSpinsLeft,
      freeSpinsTotal: this.freeSpinsTotal,
      freeTotal: this.freeTotal,
      featureWin: this.featureWin,
      sticky: this.sticky.map((reel) => reel.map((cell) => (cell ? { ...cell } : null))),
      counter: this.counter,
      stats: { ...this.stats },
    }
  }

  static fromState(state: EngineState): BeanstalkEngine {
    const engine = new BeanstalkEngine({ seed: state.rng, balance: state.balance })
    engine.mode = state.mode
    engine.bet = state.bet
    engine.freeSpinsLeft = state.freeSpinsLeft
    engine.freeSpinsTotal = state.freeSpinsTotal
    engine.freeTotal = state.freeTotal
    engine.featureWin = state.featureWin
    engine.sticky = blankSticky().map((reel, r) => reel.map((_, row) => {
      const cell = state.sticky?.[r]?.[row]
      return cell ? { ...cell } : null
    }))
    engine.counter = state.counter
    engine.stats = { ...emptyStats(), ...state.stats }
    return engine
  }

  snapshot(): EngineSnapshot {
    return {
      mode: this.mode,
      balance: this.balance,
      bet: this.bet,
      freeSpinsLeft: this.freeSpinsLeft,
      freeSpinsTotal: this.freeSpinsTotal,
      freeTotal: this.freeTotal,
      featureWin: this.featureWin,
      sticky: this.sticky.map((reel) => reel.map((cell) => cell !== null)),
      stats: { ...this.stats },
    }
  }

  stickyGrid(): (Cell | null)[][] {
    return this.sticky.map((reel) => reel.map((cell) => (cell ? { ...cell } : null)))
  }

  get inFeature(): boolean {
    return this.mode !== 'base'
  }

  canSpin(bet: number): boolean {
    return this.mode !== 'base' || this.balance >= bet
  }

  setBalance(amount: number): void {
    this.balance = Math.max(0, Math.round(amount))
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
    if (this.mode === 'free') return this.play('free', this.bet, force)
    if (!Number.isInteger(bet) || bet <= 0) throw new SpinError('Bet must be a positive whole number of cents.')
    if (this.balance < bet) throw new SpinError('Not enough credits for this bet.')
    this.balance -= bet
    this.bet = bet
    this.featureWin = 0
    this.stats.spins++
    this.stats.wagered += bet
    return this.play('base', bet, force)
  }

  private seedCell(mode: Mode): Cell {
    const table = mode === 'free' ? FREE_SEED_MULTIPLIERS : SEED_MULTIPLIERS
    return { sym: Sym.Seed, mult: this.rng.pick(table.items, table.weights) }
  }

  private drawReels(mode: Mode): Grid {
    const strips = stripsFor(mode)
    const grid: Grid = []
    for (let reel = 0; reel < REELS; reel++) {
      const strip = strips[reel]
      const stop = this.rng.int(strip.length)
      const column: Cell[] = []
      for (let row = 0; row < ROWS; row++) {
        const sym = strip[(stop + row) % strip.length]
        column.push(sym === Sym.Seed ? this.seedCell(mode) : plain(sym))
      }
      grid.push(column)
    }
    return grid
  }

  private randomCells(count: number, allow: (reel: number, row: number) => boolean): CellRef[] {
    const pool: CellRef[] = []
    for (let reel = 0; reel < REELS; reel++) for (let row = 0; row < ROWS; row++) if (allow(reel, row)) pool.push([reel, row])
    for (let index = pool.length - 1; index > 0; index--) {
      const swap = this.rng.int(index + 1)
      ;[pool[index], pool[swap]] = [pool[swap], pool[index]]
    }
    return pool.slice(0, count)
  }

  private applyForce(grid: Grid, force: ForceOutcome, mode: Mode): Map<string, number> {
    const climbs = new Map<string, number>()
    if (force === 'free' && mode === 'base') {
      for (const reel of [0, 2, 4]) grid[reel][this.rng.int(ROWS)] = plain(Sym.Castle)
    } else if (force === 'bigwin') {
      for (let reel = 0; reel < 3; reel++) for (let row = 0; row < ROWS; row++) grid[reel][row] = plain(Sym.Giant)
      grid[3][ROWS - 1] = { sym: Sym.Seed, mult: 2 }
      grid[3][0] = plain(Sym.Giant)
    } else if (force === 'grow') {
      grid[2][ROWS - 1] = { sym: Sym.Seed, mult: 3 }
      climbs.set('2:' + (ROWS - 1), ROWS - 1)
    }
    return climbs
  }

  private rollHaywire(grid: Grid, held: boolean[][] | null, climbs: Map<string, number>): Haywire {
    const kind = this.rng.pick(HAYWIRE_KINDS.items, HAYWIRE_KINDS.weights)
    const haywire: Haywire = { kind, cells: [], multiplier: 1, planted: [] }
    const open = (reel: number, row: number) => !held?.[reel][row] && grid[reel][row].sym !== Sym.Castle && !isWild(grid[reel][row].sym)
    if (kind === 'double') {
      haywire.multiplier = this.rng.pick(HAYWIRE_MULTIPLIERS.items, HAYWIRE_MULTIPLIERS.weights)
      return haywire
    }
    if (kind === 'overgrowth') {
      for (const cell of this.randomCells(2 + this.rng.int(2), (reel, row) => reel >= 1 && open(reel, row))) {
        const mult = this.rng.pick(SEED_MULTIPLIERS.items, SEED_MULTIPLIERS.weights)
        grid[cell[0]][cell[1]] = { sym: Sym.Seed, mult }
        haywire.planted.push({ cell, mult })
        haywire.cells.push(cell)
      }
      return haywire
    }
    const reel = 1 + this.rng.int(3)
    const cell: CellRef = [reel, ROWS - 1]
    grid[reel][ROWS - 1] = { sym: Sym.Seed, mult: 2 }
    haywire.planted.push({ cell, mult: 2 })
    for (let row = 0; row < ROWS; row++) haywire.cells.push([reel, row])
    climbs.set(`${reel}:${ROWS - 1}`, ROWS - 1)
    return haywire
  }

  private grow(grid: Grid, held: boolean[][] | null, climbs: Map<string, number>, boost: number): GrowStep[] {
    const steps: GrowStep[] = []
    const seeds = findCells(grid, (sym) => sym === Sym.Seed).filter(([reel, row]) => !held?.[reel][row])
    const free = (reel: number, row: number) => reel >= 0 && reel < REELS && row >= 0 && row < ROWS && grid[reel][row].sym !== Sym.Castle && !isWild(grid[reel][row].sym)
    for (const seed of seeds) {
      const stalk: { cell: CellRef; gen: number }[] = [{ cell: seed, gen: 0 }]
      const forced = climbs.get(`${seed[0]}:${seed[1]}`)
      const height = forced ?? this.rng.pick(CLIMB_HEIGHTS.items, CLIMB_HEIGHTS.weights)
      let previous: CellRef = seed
      for (let step = 1; step <= height && (forced !== undefined || steps.length < MAX_GROWTH); step++) {
        const row = seed[1] - step
        if (row < 0) break
        const target = grid[seed[0]][row]
        const here: CellRef = [seed[0], row]
        if (target.sym === Sym.Castle) {
          if (forced === undefined) break
          previous = here
          continue
        }
        if (!isWild(target.sym)) {
          grid[seed[0]][row] = plain(Sym.Vine)
          steps.push({ from: previous, to: here, kind: 'climb' })
          stalk.push({ cell: here, gen: 0 })
        }
        previous = here
      }
      for (let index = 0; index < stalk.length && steps.length < MAX_GROWTH; index++) {
        const { cell, gen } = stalk[index]
        const chance = Math.min(0.95, SPREAD_CHANCE * boost * SPREAD_FALLOFF ** gen)
        const right: CellRef = [cell[0] + 1, cell[1]]
        const left: CellRef = [cell[0] - 1, cell[1]]
        if (this.rng.next() < chance && free(right[0], right[1]) && steps.length < MAX_GROWTH) {
          grid[right[0]][right[1]] = plain(Sym.Vine)
          steps.push({ from: cell, to: right, kind: 'spread' })
          stalk.push({ cell: right, gen: gen + 1 })
        }
        if (this.rng.next() < chance * SPREAD_LEFT_SHARE && free(left[0], left[1]) && steps.length < MAX_GROWTH) {
          grid[left[0]][left[1]] = plain(Sym.Vine)
          steps.push({ from: cell, to: left, kind: 'spread' })
          stalk.push({ cell: left, gen: gen + 1 })
        }
      }
    }
    return steps
  }

  private play(mode: Mode, bet: number, force: ForceOutcome | null): SpinResult {
    const grid = this.drawReels(mode)
    let held: boolean[][] | null = null
    if (mode === 'free') {
      held = this.sticky.map((reel) => reel.map((cell) => cell !== null))
      for (let reel = 0; reel < REELS; reel++) for (let row = 0; row < ROWS; row++) {
        const cell = this.sticky[reel][row]
        if (cell) grid[reel][row] = { ...cell }
      }
    }
    const climbs = force ? this.applyForce(grid, force, mode) : new Map<string, number>()
    const landed = cloneGrid(grid)
    const rolls = mode === 'base' && (force === 'haywire' || (!force && this.rng.next() < HAYWIRE_ODDS))
    const haywire = rolls ? this.rollHaywire(grid, held, climbs) : null
    const boost = (haywire?.kind === 'overgrowth' ? HAYWIRE_SPREAD_BOOST : 1) * (force === 'grow' ? 3 : 1)
    const growth = this.grow(grid, held, climbs, boost)
    const ways = evaluateWays(grid, bet)
    const scatter = evaluateScatter(grid, bet)
    const multiplier = haywire?.multiplier ?? 1
    const stepWin = (ways.reduce((sum, win) => sum + win.win, 0) + scatter.win) * multiplier

    this.credit(stepWin)
    this.stats.vines += growth.length
    if (haywire) this.stats.haywires++

    let trigger: SpinResult['trigger'] = null
    let freeSpinsAwarded = 0
    let featureEnd: FeatureEnd | null = null
    if (mode === 'base') {
      if (scatter.count >= 3) {
        trigger = 'free'
        freeSpinsAwarded = FREE_SPINS_AWARD
        this.stats.freeTriggers++
        this.mode = 'free'
        this.freeSpinsLeft = FREE_SPINS_AWARD
        this.freeSpinsTotal = FREE_SPINS_AWARD
        this.freeTotal = 0
        this.sticky = blankSticky()
      }
      if (stepWin > 0 || trigger) this.stats.hits++
    } else {
      this.freeTotal += stepWin
      this.freeSpinsLeft--
      for (let reel = 0; reel < REELS; reel++) for (let row = 0; row < ROWS; row++) if (isWild(grid[reel][row].sym)) this.sticky[reel][row] = { ...grid[reel][row] }
      if (this.freeSpinsLeft <= 0) {
        featureEnd = { total: this.freeTotal }
        this.mode = 'base'
        this.sticky = blankSticky()
      }
    }
    if (this.mode === 'base' && this.featureWin > this.stats.biggestWin) this.stats.biggestWin = this.featureWin

    return {
      id: ++this.counter,
      mode,
      bet,
      landed,
      held,
      haywire,
      growth,
      grid: cloneGrid(grid),
      ways,
      scatter,
      multiplier,
      stepWin,
      trigger,
      freeSpinsAwarded,
      featureEnd,
      forced: force,
      state: this.snapshot(),
    }
  }

  private credit(amount: number): void {
    if (amount <= 0) return
    this.balance += amount
    this.featureWin += amount
    this.stats.won += amount
  }
}

export { isPaying, isWild }
