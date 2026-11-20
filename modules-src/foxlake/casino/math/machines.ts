/**
 * The ten machines' rules and maths (no drawing, no Babylon): five game
 * styles, each in two original themes. A spin resolves completely here: the
 * base spin, then whatever feature it starts, every step recorded so the
 * screen can replay it. The server runs this with a cryptographic RNG; the
 * same code plays solo-town spins in the browser.
 *
 * Styles (rules researched from the real cabinets; themes, names, symbols and
 * art are this game's own):
 * - link: 5x3 on 25 lines. Six or more orbs start Hold & Spin: they lock, every
 *   other cell respins, 3 respins reset by each new orb; orbs show bet
 *   multiples or MINI / MINOR / MAJOR; filling all 15 cells wins the GRAND.
 *   Three scatters give 8 free games (orbs land more often; Hold & Spin can
 *   start inside them; three more scatters add 8).
 * - house: 5x3, 243 ways, wild on reels 2-4. Six or more hard hats give 6 free
 *   games: each hat frames its cell in straw, a hat on a frame upgrades it to
 *   stick then brick (a hat on brick upgrades another frame, else frames an
 *   empty cell, else pays 10x), three hats add a game. Then the storm blows the
 *   houses down tier by tier; each reveals a prize or a jackpot.
 * - gold: 5x4, 1,024 ways, wild on reels 2-4. 3/4/5 coin scatters pay and give
 *   8/15/20 free games, where every wild carries 2x or 3x (multiplied
 *   together on a way), gold heads (pay as the top animal) fill a 15-step
 *   meter that turns the other animals into the top animal at 4, 7, 13 and 15
 *   heads, and 2/3/4/5 scatters add 5/8/15/20 games (to 180).
 * - goldwheel: gold, plus random base-game conversions of 1-4 animals, and the
 *   scatter trigger spins a wheel up to five times first: credits, +1 to +3
 *   heads (pre-filling the meter) or a jackpot, each spin upgrading the wheel,
 *   until Start Free Games (every wedge on the fifth spin).
 * - collect: 5x3 on 20 lines. Blue, green and pink gems fill three meters
 *   (kept between spins). Green: Cash Collect on a 5x5 board, a 2x2 collector
 *   zone and 5 spins; coins in the zone and green gems anywhere are collected,
 *   and gems grow the zone to 3x3 (+3 spins), 4x4 (+2) and 5x5 (+1). Pink: 6
 *   free games without the royals. Blue (the wild): a 15-tile jackpot pick,
 *   first jackpot revealed three times wins.
 * - dollaz (Mo' Dollaz): 5x3 on 20 lines. A money bag on reel 1 with any cash
 *   bill on reels 2-5 starts Cash Collect (any bill may also start it at
 *   random): the bills are paid and copied onto a 5x5 board, a 2x2 collector
 *   zone collects the coins that land inside it and then moves to every new
 *   bill and collects it; 5, 9 and 12 bills grow it to 3x3 (+3 spins), 4x4
 *   (+2) and 5x5 (+1, no more bills). Three scatters give 8 free games without
 *   the royals (Cash Collect can start inside them). Any wild may start a
 *   15-tile jackpot pick. Bills, scatters and wilds fill three meters that
 *   guarantee their feature when full.
 */
import { cellsOf, evaluateWays, gridAt, buildStrip, round, spinStops, type Paytable, type SymbolId, type WaysWin } from './reels'
import { evaluateLines, LINES_25, type LineWin } from './lines'
import { pick, weighted, type Rng } from './rng'

export type Family = 'link' | 'house' | 'gold' | 'goldwheel' | 'collect' | 'dollaz'
export type Jackpot = 'MINI' | 'MINOR' | 'MAXI' | 'MAJOR' | 'GRAND'
export type Win = (WaysWin | LineWin) & { scatter?: boolean }

export interface MachineDef {
  id: string
  name: string
  family: Family
  rows: number
  /** Credits a spin covers (what the cabinets show as the bet in credits). */
  credits: number
  strips: SymbolId[][]
  freeStrips: SymbolId[][]
  paytable: Paytable
  /** Jackpots in bet multiples. */
  jackpots: Partial<Record<Jackpot, number>>
  /** Multiplies every award so the machine returns its target share over time (see tests/casino.test.ts). */
  scale: number
  /** Symbols each collector meter needs to fill (default METER_FULL each). */
  meterFull?: { green: number; pink: number; blue: number }
}

export interface SpinStep {
  stops: number[]
  grid: SymbolId[][]
  wins: Win[]
  win: number
  /** Reels that stop slowly because a feature is one symbol away. */
  anticipation: boolean[]
  /** gold: wild multipliers by cell "reel,row". */
  wildX?: Record<string, number>
  /** gold: gold heads on this spin, the meter after it, and the animals converted so far. */
  heads?: number
  meter?: number
  converted?: SymbolId[]
  /** goldwheel base: animals turned into the top animal for this spin. */
  morph?: SymbolId[]
  /** link: orb values on this grid by cell "reel,row". */
  orbs?: Record<string, OrbValue>
  /** house: frames after this free game (cell -> tier 1..3) and any 10x pays. */
  frames?: Record<string, number>
  hatPays?: number
  /** Free games left after this one (free games only). */
  left?: number
  /** Feature that started inside this free game (link: Hold & Spin). */
  inner?: Feature
}

export type OrbValue = { credits: number } | { jackpot: Jackpot; credits: number }

export interface HoldSpinStep {
  landed: { cell: string; orb: OrbValue }[]
  left: number
}

export type Feature =
  | { kind: 'holdspin'; start: Record<string, OrbValue>; steps: HoldSpinStep[]; grand: boolean; win: number }
  | { kind: 'freegames'; awarded: number; spins: SpinStep[]; win: number; wheel?: WheelSpin[]; startHeads?: number }
  | { kind: 'houses'; awarded: number; spins: SpinStep[]; reveals: { cell: string; tier: number; credits: number; jackpot?: Jackpot }[]; win: number }
  | { kind: 'cashcollect'; steps: CollectStep[]; win: number; start?: CollectCell[]; zone?: { reel: number; row: number; size: number } }
  | { kind: 'jackpotpick'; tiles: Jackpot[]; won: Jackpot; win: number }
  | { kind: 'chain'; parts: Feature[]; win: number }

export interface WheelSpin {
  wedges: WheelWedge[]
  landed: number
}
export type WheelWedge = { kind: 'credits'; credits: number } | { kind: 'heads'; heads: number } | { kind: 'jackpot'; jackpot: Jackpot; credits: number } | { kind: 'start' }

export interface CollectCell {
  cell: string
  credits: number
  jackpot?: Jackpot
}

export interface CollectStep {
  /** Collector zone after this spin: top-left cell and size. */
  zone: { reel: number; row: number; size: number }
  coins: (CollectCell & { collected: boolean })[]
  gems: CollectCell[]
  gemsTotal: number
  left: number
  collected: number
  /** dollaz: where the zone moved this spin (one entry per bill it went to collect). */
  path?: { reel: number; row: number; size: number }[]
}

/** Kept between spins per player and machine (the collector machines' meters). */
export interface MachineState {
  meters?: { green: number; pink: number; blue: number }
}

export interface SpinResult {
  machine: string
  bet: number
  base: SpinStep
  feature: Feature | null
  /** Collector meters after the spin. */
  state: MachineState
  totalWin: number
}

export const METER_FULL = 40

/** Machines whose gem meters are kept between spins. */
export function hasMeters(def: MachineDef): boolean {
  return def.family === 'collect' || def.family === 'dollaz'
}

export function meterFull(def: MachineDef): { green: number; pink: number; blue: number } {
  return def.meterFull ?? { green: METER_FULL, pink: METER_FULL, blue: METER_FULL }
}

/** Meter level 1 to 5 for display (5 = about to fill). */
export function meterLevel(value: number, full: number): number {
  return Math.max(1, Math.min(5, 1 + Math.floor((Math.max(0, value) / Math.max(1, full)) * 5)))
}

function strips(weights: Record<SymbolId, number>[], seed: number): SymbolId[][] {
  return weights.map((w, i) => buildStrip(w, seed * 31 + i))
}

/** Per-reel weights from a base table, with extra or zero weights on chosen reels. */
function reelWeights(base: Record<SymbolId, number>, perReel: (reel: number) => Record<SymbolId, number> = () => ({})): Record<SymbolId, number>[] {
  return [0, 1, 2, 3, 4].map((r) => {
    const w = { ...base, ...perReel(r) }
    for (const k of Object.keys(w)) if (w[k] <= 0) delete w[k]
    return w
  })
}

// ------------------------------------------------------------------ definitions

function linkMachine(id: string, name: string, seed: number, scale: number): MachineDef {
  const base = { '9': 9, '10': 9, J: 8, Q: 8, K: 7, A: 7, h1: 3, h2: 4, h3: 5, h4: 5, W: 2, O: 13, S: 2 }
  return {
    id, name, family: 'link', rows: 3, credits: 50, scale,
    strips: strips(reelWeights(base, (r) => ({ W: r === 0 ? 0 : 2 })), seed),
    freeStrips: strips(reelWeights({ ...base, O: 13 }, (r) => ({ W: r === 0 ? 0 : 3 })), seed + 1),
    paytable: { '9': [5, 10, 50], '10': [5, 10, 50], J: [5, 15, 75], Q: [5, 15, 75], K: [10, 25, 100], A: [10, 25, 100], h4: [15, 40, 150], h3: [20, 50, 200], h2: [25, 75, 300], h1: [40, 120, 500], W: [40, 120, 500] },
    jackpots: { MINI: 20, MINOR: 50, MAJOR: 500, GRAND: 2500 },
  }
}

function houseMachine(id: string, name: string, seed: number, scale: number): MachineDef {
  const base = { '10': 9, J: 9, Q: 8, K: 8, A: 7, h1: 3, h2: 4, h3: 5, p1: 5, p2: 6, W: 2, H: 10 }
  return {
    id, name, family: 'house', rows: 3, credits: 75, scale,
    strips: strips(reelWeights(base, (r) => ({ W: r >= 1 && r <= 3 ? 3 : 0 })), seed),
    freeStrips: strips(reelWeights({ ...base, H: 11 }, (r) => ({ W: r >= 1 && r <= 3 ? 3 : 0 })), seed + 1),
    paytable: { '10': [10, 20, 50], J: [10, 20, 50], Q: [10, 25, 60], K: [15, 30, 80], A: [15, 30, 80], p2: [20, 40, 100], p1: [25, 50, 120], h3: [30, 80, 200], h2: [40, 100, 250], h1: [50, 120, 400] },
    jackpots: { MINI: 10, MINOR: 30, MAJOR: 250, GRAND: 2500 },
  }
}

function goldMachine(id: string, name: string, family: 'gold' | 'goldwheel', seed: number, scale: number): MachineDef {
  const base = { '9': 10, '10': 10, J: 9, Q: 9, K: 8, A: 8, h1: 3, h2: 4, h3: 4, h4: 5, h5: 5, W: 2, C: 2 }
  return {
    id, name, family, rows: 4, credits: family === 'gold' ? 60 : 75, scale,
    strips: strips(reelWeights(base, (r) => ({ W: r >= 1 && r <= 3 ? 2 : 0, C: r === 0 || r === 4 ? 1 : 2 })), seed),
    freeStrips: strips(reelWeights({ ...base, G: 3 }, (r) => ({ W: r >= 1 && r <= 3 ? 2 : 0, C: r === 0 || r === 4 ? 1 : 2 })), seed + 1),
    paytable: { '9': [1, 3, 8], '10': [1, 3, 8], J: [1, 4, 10], Q: [1, 4, 10], K: [2, 5, 12], A: [2, 5, 12], h5: [3, 8, 20], h4: [4, 10, 25], h3: [5, 12, 30], h2: [6, 15, 40], h1: [8, 25, 60] },
    jackpots: family === 'goldwheel' ? { MINI: 15, MINOR: 40, MAJOR: 300, GRAND: 2000 } : {},
  }
}

function collectMachine(id: string, name: string, seed: number, scale: number): MachineDef {
  const base = { '10': 9, J: 9, Q: 8, K: 8, A: 7, h1: 3, h2: 4, h3: 5, h4: 5, B: 1, N: 1, P: 2, O: 4, M: 0 }
  return {
    id, name, family: 'collect', rows: 3, credits: 50, scale,
    strips: strips(reelWeights(base, (r) => ({ M: r === 0 ? 1 : 0, N: r === 0 ? 0 : 1, P: r === 0 || r === 4 ? 1 : 2 })), seed),
    freeStrips: strips(reelWeights({ h1: 4, h2: 5, h3: 6, h4: 6, B: 1, P: 2, O: 5 }), seed + 1),
    paytable: { '10': [5, 10, 50], J: [5, 10, 50], Q: [5, 15, 75], K: [10, 20, 100], A: [10, 20, 100], h4: [15, 40, 150], h3: [20, 50, 200], h2: [30, 75, 300], h1: [50, 150, 750], B: [50, 150, 750] },
    jackpots: { MINI: 10, MINOR: 25, MAXI: 100, MAJOR: 500, GRAND: 2500 },
  }
}

export const MO_DOLLAZ_ID = 'mo-dollaz'

function dollazMachine(id: string, name: string, seed: number, scale: number): MachineDef {
  const base = { J: 8, Q: 8, K: 7, A: 7, h5: 5, h4: 5, h3: 4, h2: 4, h1: 3, W: 2, S: 2 }
  const free = { h5: 10, h4: 10, h3: 8, h2: 8, h1: 6, W: 4, S: 3 }
  return {
    id, name, family: 'dollaz', rows: 3, credits: 50, scale,
    strips: strips(reelWeights(base, (r): Record<SymbolId, number> => (r === 0 ? { M: 1, N: 0, W: 2, S: 1, J: 11, Q: 11, K: 10, A: 10 } : { M: 0, N: 1, W: 3, S: r === 4 ? 1 : 2 })), seed),
    freeStrips: strips(reelWeights(free, (r) => ({ M: r === 0 ? 1 : 0, N: r === 0 ? 0 : 1 })), seed + 1),
    paytable: { J: [4, 10, 40], Q: [4, 10, 40], K: [5, 12, 50], A: [5, 12, 50], h5: [6, 20, 60], h4: [6, 20, 60], h3: [8, 25, 80], h2: [10, 30, 100], h1: [12, 40, 150], W: [15, 50, 200] },
    jackpots: { MINI: 20, MINOR: 60, MAXI: 100, MAJOR: 200, GRAND: 2000 },
    meterFull: { green: 150, pink: 250, blue: 300 },
  }
}

export const MACHINES: MachineDef[] = [
  linkMachine('northern-lights-link', 'Northern Lights Link', 11, 0.83),
  linkMachine('gold-pan-link', 'Gold Pan Link', 13, 1.0),
  houseMachine('lodge-builders', 'Lodge Builders', 17, 2.06),
  houseMachine('hay-day-barns', 'Hay Day Barns', 19, 2.26),
  goldMachine('moose-gold', 'Moose Gold', 'gold', 23, 4.81),
  goldMachine('mustang-gold', 'Mustang Gold', 'gold', 29, 6.17),
  goldMachine('moose-gold-revolution', 'Moose Gold Revolution', 'goldwheel', 31, 3.98),
  goldMachine('mustang-gold-revolution', 'Mustang Gold Revolution', 'goldwheel', 37, 4.3),
  collectMachine('bigfoot-bucks', 'Bigfoot Bucks', 41, 1.5),
  collectMachine('lake-monster-loot', 'Lake Monster Loot', 43, 1.46),
  dollazMachine(MO_DOLLAZ_ID, "Mo' Dollaz", 47, 1.035),
]

export const MACHINE_BY_ID: Record<string, MachineDef> = Object.fromEntries(MACHINES.map((m) => [m.id, m]))

// ------------------------------------------------------------------ helpers

const key = (r: number, row: number) => `${r},${row}`

function spinOn(def: MachineDef, reelStrips: SymbolId[][], rng: Rng): { stops: number[]; grid: SymbolId[][] } {
  const stops = spinStops(reelStrips, rng)
  return { stops, grid: gridAt(reelStrips, stops, def.rows) }
}

/** Reels after the one where `sym` has already reached `need - 1` on earlier reels stop slowly. */
function anticipate(grid: SymbolId[][], syms: ReadonlySet<SymbolId>, need: number): boolean[] {
  let seen = 0
  return grid.map((col) => {
    const slow = seen >= need - 1
    for (const s of col) if (syms.has(s)) seen++
    return slow
  })
}

function award(def: MachineDef, bet: number, x: number): number {
  return round(x * bet * def.scale)
}

function jackpotCredits(def: MachineDef, bet: number, j: Jackpot): number {
  return award(def, bet, def.jackpots[j] ?? 0)
}

// ------------------------------------------------------------------ link

const ORB_X = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 8, 10, 15, 25]
const ORB_W = [18, 22, 14, 12, 8, 7, 5, 4, 2.5, 1.5, 0.8, 0.4]

function rollOrb(def: MachineDef, bet: number, rng: Rng): OrbValue {
  const r = rng.next()
  if (r < 0.004) return { jackpot: 'MAJOR', credits: jackpotCredits(def, bet, 'MAJOR') }
  if (r < 0.02) return { jackpot: 'MINOR', credits: jackpotCredits(def, bet, 'MINOR') }
  if (r < 0.06) return { jackpot: 'MINI', credits: jackpotCredits(def, bet, 'MINI') }
  return { credits: award(def, bet, ORB_X[weighted(rng, ORB_W)]) }
}

function holdAndSpin(def: MachineDef, bet: number, rng: Rng, start: Record<string, OrbValue>): Feature {
  const locked: Record<string, OrbValue> = { ...start }
  const cells = 5 * def.rows
  const steps: HoldSpinStep[] = []
  let left = 3
  while (left > 0 && Object.keys(locked).length < cells) {
    const landed: HoldSpinStep['landed'] = []
    for (let r = 0; r < 5; r++) for (let row = 0; row < def.rows; row++) {
      const k = key(r, row)
      if (locked[k]) continue
      if (rng.next() < 0.085) {
        const orb = rollOrb(def, bet, rng)
        locked[k] = orb
        landed.push({ cell: k, orb })
      }
    }
    left = landed.length ? 3 : left - 1
    steps.push({ landed, left })
  }
  const grand = Object.keys(locked).length >= cells
  let win = 0
  for (const v of Object.values(locked)) win += v.credits
  if (grand) win += jackpotCredits(def, bet, 'GRAND')
  return { kind: 'holdspin', start, steps, grand, win: round(win) }
}

function linkSpin(def: MachineDef, bet: number, rng: Rng, reelStrips: SymbolId[][]): SpinStep {
  const { stops, grid } = spinOn(def, reelStrips, rng)
  const nonPaying = new Set(['O', 'S'])
  const wins: Win[] = evaluateLines(grid, LINES_25, (bet / 25) * def.scale, def.paytable, 'W', nonPaying)
  const orbs: Record<string, OrbValue> = {}
  for (const [r, row] of cellsOf(grid, 'O')) orbs[key(r, row)] = rollOrb(def, bet, rng)
  const win = round(wins.reduce((a, w) => a + w.pay, 0))
  const both = anticipate(grid, new Set(['S']), 3).map((s, i) => s || anticipate(grid, new Set(['O']), 6)[i])
  return { stops, grid, wins, win, anticipation: both, orbs }
}

function playLink(def: MachineDef, bet: number, rng: Rng): { base: SpinStep; feature: Feature | null } {
  const base = linkSpin(def, bet, rng, def.strips)
  const orbCount = Object.keys(base.orbs!).length
  if (orbCount >= 6) return { base, feature: holdAndSpin(def, bet, rng, base.orbs!) }
  if (cellsOf(base.grid, 'S').length >= 3) {
    const spins: SpinStep[] = []
    let left = 8
    let awarded = 8
    let win = 0
    while (left > 0 && spins.length < 100) {
      left--
      const s = linkSpin(def, bet, rng, def.freeStrips)
      if (cellsOf(s.grid, 'S').length >= 3) {
        left += 8
        awarded += 8
      }
      if (Object.keys(s.orbs!).length >= 6) {
        s.inner = holdAndSpin(def, bet, rng, s.orbs!)
        s.win = round(s.win + s.inner.win)
      }
      s.left = left
      win += s.win
      spins.push(s)
    }
    return { base, feature: { kind: 'freegames', awarded, spins, win: round(win) } }
  }
  return { base, feature: null }
}

// ------------------------------------------------------------------ house

const WAYS_243 = { minCount: 3 }

function houseSpin(def: MachineDef, bet: number, rng: Rng, reelStrips: SymbolId[][]): SpinStep {
  const { stops, grid } = spinOn(def, reelStrips, rng)
  const wins = evaluateWays(grid, (bet / def.credits) * def.scale, { wild: 'W', nonPaying: new Set(['H']), paytable: def.paytable, ...WAYS_243 })
  return { stops, grid, wins, win: round(wins.reduce((a, w) => a + w.pay, 0)), anticipation: anticipate(grid, new Set(['H']), 6) }
}

function houseReveal(def: MachineDef, bet: number, tier: number, rng: Rng): { credits: number; jackpot?: Jackpot } {
  const r = rng.next()
  if (tier === 1) return { credits: award(def, bet, 0.5 + pick(rng, 4) * 0.5) }
  if (tier === 2) {
    if (r < 0.04) return { jackpot: 'MINOR', credits: jackpotCredits(def, bet, 'MINOR') }
    if (r < 0.14) return { jackpot: 'MINI', credits: jackpotCredits(def, bet, 'MINI') * (r < 0.07 ? 2 : 1) }
    return { credits: award(def, bet, [2, 3, 4, 5, 6, 8][pick(rng, 6)]) }
  }
  if (r < 0.0015) return { jackpot: 'GRAND', credits: jackpotCredits(def, bet, 'GRAND') }
  if (r < 0.008) return { jackpot: 'MAJOR', credits: jackpotCredits(def, bet, 'MAJOR') }
  if (r < 0.05) return { jackpot: 'MINOR', credits: jackpotCredits(def, bet, 'MINOR') }
  if (r < 0.14) return { jackpot: 'MINI', credits: jackpotCredits(def, bet, 'MINI') * (r < 0.13 ? 2 : 1) }
  return { credits: award(def, bet, [4, 5, 6, 8, 10, 15, 25, 50, 100][weighted(rng, [20, 18, 16, 14, 10, 8, 6, 3, 1])]) }
}

function playHouse(def: MachineDef, bet: number, rng: Rng): { base: SpinStep; feature: Feature | null } {
  const base = houseSpin(def, bet, rng, def.strips)
  const hats = cellsOf(base.grid, 'H')
  if (hats.length < 6) return { base, feature: null }
  const frames: Record<string, number> = {}
  for (const [r, row] of hats) frames[key(r, row)] = 1
  let left = 6
  let awarded = 6
  let win = 0
  const spins: SpinStep[] = []
  const all: string[] = []
  for (let r = 0; r < 5; r++) for (let row = 0; row < def.rows; row++) all.push(key(r, row))
  while (left > 0) {
    left--
    const s = houseSpin(def, bet, rng, def.freeStrips)
    let hatPays = 0
    const landed = cellsOf(s.grid, 'H')
    for (const [r, row] of landed) {
      const k = key(r, row)
      const tier = frames[k] ?? 0
      if (tier < 3) frames[k] = tier + 1
      else {
        const up = all.filter((c) => frames[c] && frames[c] < 3)
        const empty = all.filter((c) => !frames[c])
        if (up.length) frames[up[pick(rng, up.length)]]++
        else if (empty.length) frames[empty[pick(rng, empty.length)]] = 1
        else hatPays += award(def, bet, 10)
      }
    }
    if (landed.length >= 3) {
      left++
      awarded++
    }
    s.frames = { ...frames }
    s.hatPays = round(hatPays)
    s.win = round(s.win + hatPays)
    s.left = left
    win += s.win
    spins.push(s)
  }
  const reveals: { cell: string; tier: number; credits: number; jackpot?: Jackpot }[] = []
  for (const tier of [1, 2, 3]) for (const c of all) if (frames[c] === tier) {
    const prize = houseReveal(def, bet, tier, rng)
    reveals.push({ cell: c, tier, ...prize })
    win += prize.credits
  }
  return { base, feature: { kind: 'houses', awarded, spins, reveals, win: round(win) } }
}

// ------------------------------------------------------------------ gold

const CONVERT_AT: [number, SymbolId][] = [[4, 'h2'], [7, 'h3'], [13, 'h4'], [15, 'h5']]
const SCATTER_PAY: Record<number, number> = { 3: 2, 4: 10, 5: 20 }
const FREE_FOR: Record<number, number> = { 3: 8, 4: 15, 5: 20 }
const RETRIGGER: Record<number, number> = { 2: 5, 3: 8, 4: 15, 5: 20 }
const MAX_FREE = 180

function goldSpin(def: MachineDef, bet: number, rng: Rng, reelStrips: SymbolId[][], free: boolean, converted: ReadonlySet<SymbolId>, morph: ReadonlySet<SymbolId>): SpinStep {
  const { stops, grid } = spinOn(def, reelStrips, rng)
  const wildX: Record<string, number> = {}
  if (free) for (const [r, row] of cellsOf(grid, 'W')) wildX[key(r, row)] = rng.next() < 0.5 ? 2 : 3
  const lineBet = (bet / def.credits) * def.scale
  const wins: Win[] = evaluateWays(grid, lineBet, {
    wild: 'W', nonPaying: new Set(['C']), paytable: def.paytable, minCount: 3,
    wildMultiplier: free ? (r, row) => wildX[key(r, row)] ?? 1 : undefined,
    substitute: (s) => (s === 'G' || converted.has(s) || morph.has(s) ? 'h1' : s),
  })
  const scatters = cellsOf(grid, 'C')
  if (scatters.length >= 3) {
    const pay = award(def, bet, SCATTER_PAY[Math.min(5, scatters.length)])
    wins.push({ symbol: 'C', count: scatters.length, ways: 1, multiplier: 1, pay, cells: scatters, scatter: true })
  }
  return { stops, grid, wins, win: round(wins.reduce((a, w) => a + w.pay, 0)), anticipation: anticipate(grid, new Set(['C']), 3), wildX: free ? wildX : undefined }
}

function freeGold(def: MachineDef, bet: number, rng: Rng, awarded0: number, startHeads: number): { spins: SpinStep[]; awarded: number; win: number } {
  let meter = Math.min(15, startHeads)
  const converted = new Set<SymbolId>()
  const convert = () => { for (const [at, sym] of CONVERT_AT) if (meter >= at) converted.add(sym) }
  convert()
  let left = awarded0
  let awarded = awarded0
  let win = 0
  const spins: SpinStep[] = []
  while (left > 0) {
    left--
    const s = goldSpin(def, bet, rng, def.freeStrips, true, converted, new Set())
    const heads = cellsOf(s.grid, 'G').length
    meter = Math.min(15, meter + heads)
    convert()
    const sc = cellsOf(s.grid, 'C').length
    if (sc >= 2) {
      const add = Math.min(RETRIGGER[Math.min(5, sc)], MAX_FREE - awarded)
      left += add
      awarded += add
    }
    s.heads = heads
    s.meter = meter
    s.converted = [...converted]
    s.left = left
    win += s.win
    spins.push(s)
  }
  return { spins, awarded, win: round(win) }
}

function wheelWedges(def: MachineDef, bet: number, level: number, rng: Rng, last: boolean): WheelWedge[] {
  if (last) return Array.from({ length: 12 }, () => ({ kind: 'start' }) as WheelWedge)
  const out: WheelWedge[] = []
  const credit = [[1, 2, 3], [2, 4, 5], [4, 6, 8], [6, 10, 15]][Math.min(3, level)]
  for (let i = 0; i < 12; i++) {
    const r = i % 6
    if (r === 0) out.push({ kind: 'start' })
    else if (r === 1 || r === 4) out.push({ kind: 'heads', heads: Math.min(3, 1 + Math.floor(level / 2) + (r === 4 ? 1 : 0)) })
    else if (r === 3 && i < 6) {
      const j: Jackpot = level >= 3 ? 'MAJOR' : level >= 1 ? 'MINOR' : 'MINI'
      out.push({ kind: 'jackpot', jackpot: j, credits: jackpotCredits(def, bet, j) })
    } else if (r === 3) out.push({ kind: 'jackpot', jackpot: 'GRAND', credits: jackpotCredits(def, bet, 'GRAND') })
    else out.push({ kind: 'credits', credits: award(def, bet, credit[pick(rng, 3)]) })
  }
  return out
}

const WEDGE_WEIGHT = (w: WheelWedge) => (w.kind === 'start' ? 3 : w.kind === 'heads' ? 2.5 : w.kind === 'credits' ? 3 : w.jackpot === 'GRAND' ? 0.02 : w.jackpot === 'MAJOR' ? 0.15 : 0.6)

function playGold(def: MachineDef, bet: number, rng: Rng): { base: SpinStep; feature: Feature | null } {
  const morph = new Set<SymbolId>()
  if (def.family === 'goldwheel' && rng.next() < 0.07) {
    const pool = ['h2', 'h3', 'h4', 'h5']
    const n = 1 + pick(rng, 4)
    while (morph.size < n) morph.add(pool[pick(rng, pool.length)])
  }
  const base = goldSpin(def, bet, rng, def.strips, false, new Set(), morph)
  if (morph.size) base.morph = [...morph]
  const sc = cellsOf(base.grid, 'C').length
  if (sc < 3) return { base, feature: null }
  const awarded0 = FREE_FOR[Math.min(5, sc)]
  if (def.family === 'gold') {
    const f = freeGold(def, bet, rng, awarded0, 0)
    return { base, feature: { kind: 'freegames', awarded: f.awarded, spins: f.spins, win: f.win } }
  }
  const wheel: WheelSpin[] = []
  let heads = 0
  let wheelWin = 0
  for (let level = 0; level < 5; level++) {
    const wedges = wheelWedges(def, bet, level, rng, level === 4)
    const landed = weighted(rng, wedges.map(WEDGE_WEIGHT))
    wheel.push({ wedges, landed })
    const w = wedges[landed]
    if (w.kind === 'start') break
    if (w.kind === 'heads') heads = Math.min(15, heads + w.heads)
    else wheelWin += w.credits
  }
  const f = freeGold(def, bet, rng, awarded0, heads)
  return { base, feature: { kind: 'freegames', awarded: f.awarded, spins: f.spins, win: round(f.win + wheelWin), wheel, startHeads: heads } }
}

// ------------------------------------------------------------------ collect

function collectSpin(def: MachineDef, bet: number, rng: Rng, reelStrips: SymbolId[][]): SpinStep {
  const { stops, grid } = spinOn(def, reelStrips, rng)
  const wins: Win[] = evaluateLines(grid, LINES_25.slice(0, 20), (bet / 20) * def.scale, def.paytable, 'B', new Set(['N', 'P', 'O', 'M']))
  const orbs: Record<string, OrbValue> = {}
  for (const [r, row] of cellsOf(grid, 'O')) orbs[key(r, row)] = { credits: award(def, bet, ORB_X[weighted(rng, ORB_W)]) }
  return { stops, grid, wins, win: round(wins.reduce((a, w) => a + w.pay, 0)), anticipation: anticipate(grid, new Set(['P']), 3), orbs }
}

function cashCollect(def: MachineDef, bet: number, rng: Rng): Feature {
  const zone = { reel: 1 + pick(rng, 2), row: 1 + pick(rng, 2), size: 2 }
  let left = 5
  let gemsTotal = 0
  let collected = 0
  const steps: CollectStep[] = []
  const grow = [[5, 3, 3], [9, 4, 2], [12, 5, 1]]
  while (left > 0) {
    left--
    const coins: CollectStep['coins'] = []
    const gems: CollectStep['gems'] = []
    for (let r = 0; r < 5; r++) for (let row = 0; row < 5; row++) {
      const x = rng.next()
      if (x < 0.035) gems.push({ cell: key(r, row), credits: award(def, bet, ORB_X[weighted(rng, ORB_W)]) })
      else if (x < 0.2) {
        const inZone = r >= zone.reel && r < zone.reel + zone.size && row >= zone.row && row < zone.row + zone.size
        const credits = award(def, bet, ORB_X[weighted(rng, ORB_W)] * 0.6)
        coins.push({ cell: key(r, row), credits, collected: inZone })
        if (inZone) collected += credits
      }
    }
    for (const g of gems) collected += g.credits
    const before = gemsTotal
    gemsTotal += gems.length
    for (const [need, size, add] of grow) if (before < need && gemsTotal >= need) {
      zone.size = size
      zone.reel = Math.max(0, Math.min(5 - size, zone.reel - 1))
      zone.row = Math.max(0, Math.min(5 - size, zone.row - 1))
      left += add
    }
    steps.push({ zone: { ...zone }, coins, gems, gemsTotal, left, collected: round(collected) })
  }
  return { kind: 'cashcollect', steps, win: round(collected) }
}

const PICK_TIERS: Jackpot[] = ['MINI', 'MINOR', 'MAXI', 'MAJOR', 'GRAND']
const PICK_WEIGHTS = [50, 28, 14, 6, 2]

function jackpotPick(def: MachineDef, bet: number, rng: Rng, weights: readonly number[] = PICK_WEIGHTS): Feature {
  const tiles: Jackpot[] = []
  const counts: Record<string, number> = {}
  let won: Jackpot | null = null
  while (!won) {
    let j = PICK_TIERS[weighted(rng, weights)]
    if ((counts[j] ?? 0) === 2 && tiles.length < 4 && rng.next() < 0.5) j = PICK_TIERS[weighted(rng, weights)]
    tiles.push(j)
    counts[j] = (counts[j] ?? 0) + 1
    if (counts[j] === 3) won = j
  }
  return { kind: 'jackpotpick', tiles, won, win: jackpotCredits(def, bet, won) }
}

function playCollect(def: MachineDef, bet: number, rng: Rng, state: MachineState): { base: SpinStep; feature: Feature | null; state: MachineState } {
  const meters = { green: 0, pink: 0, blue: 0, ...state.meters }
  const base = collectSpin(def, bet, rng, def.strips)
  const green = cellsOf(base.grid, 'N').length
  const pink = cellsOf(base.grid, 'P').length
  const blue = cellsOf(base.grid, 'B').length
  meters.green += green
  meters.pink += pink
  meters.blue += blue
  const collectorOnFirst = base.grid[0].includes('M')
  let feature: Feature | null = null
  if (meters.blue >= METER_FULL || (blue > 0 && rng.next() < 0.002)) {
    feature = jackpotPick(def, bet, rng)
    meters.blue = 0
  } else if (meters.green >= METER_FULL || (green > 0 && collectorOnFirst && rng.next() < 0.5) || (green > 0 && rng.next() < 0.005)) {
    feature = cashCollect(def, bet, rng)
    meters.green = 0
  } else if (pink >= 3 || meters.pink >= METER_FULL || (pink > 0 && rng.next() < 0.004)) {
    meters.pink = 0
    const spins: SpinStep[] = []
    let left = 6
    let awarded = 6
    let win = 0
    while (left > 0 && spins.length < 60) {
      left--
      const s = collectSpin(def, bet, rng, def.freeStrips)
      if (cellsOf(s.grid, 'P').length >= 3) {
        left += 3
        awarded += 3
      }
      s.left = left
      win += s.win
      spins.push(s)
    }
    feature = { kind: 'freegames', awarded, spins, win: round(win) }
  }
  for (const k of ['green', 'pink', 'blue'] as const) meters[k] = Math.min(METER_FULL, meters[k])
  return { base, feature, state: { meters } }
}

// ------------------------------------------------------------------ dollaz

/** Cash values in bet multiples (50 to 5,000 credits on a 50-credit bet). */
export const DOLLAZ_X = [1, 2, 3, 4, 5, 6, 10, 15, 20, 30, 40, 50, 100]
const DOLLAZ_W = [30, 22, 13, 9, 7, 5, 4, 3, 2, 1.4, 0.9, 0.5, 0.2]
const DOLLAZ_SCATTER: Record<number, number> = { 3: 1, 4: 10, 5: 50 }
const DOLLAZ_FREE = 8
const DOLLAZ_MAX_FREE = 80
const DOLLAZ_PICK = [56, 27, 11, 5.4, 0.6]
const DOLLAZ_GROW: [number, number, number][] = [[5, 3, 3], [9, 4, 2], [12, 5, 1]]
const DOLLAZ_HEAT = [28, 60, 12]
const DOLLAZ_BILL_CHANCE = [0, 0.03, 0.085]
const DOLLAZ_COIN_CHANCE = 0.11
const DOLLAZ_RANDOM = { collect: 0.004, free: 0.003, wild: 0.002 }

function rollCash(def: MachineDef, bet: number, rng: Rng): OrbValue {
  const r = rng.next()
  if (r < 0.004) return { jackpot: 'MINOR', credits: jackpotCredits(def, bet, 'MINOR') }
  if (r < 0.02) return { jackpot: 'MINI', credits: jackpotCredits(def, bet, 'MINI') }
  return { credits: award(def, bet, DOLLAZ_X[weighted(rng, DOLLAZ_W)]) }
}

function cashCell(cell: string, value: OrbValue): CollectCell {
  return 'jackpot' in value ? { cell, credits: value.credits, jackpot: value.jackpot } : { cell, credits: value.credits }
}

function dollazSpin(def: MachineDef, bet: number, rng: Rng, reelStrips: SymbolId[][]): SpinStep {
  const { stops, grid } = spinOn(def, reelStrips, rng)
  const wins: Win[] = evaluateLines(grid, LINES_25.slice(0, 20), (bet / 20) * def.scale, def.paytable, 'W', new Set(['S', 'M', 'N']))
  const scatters = cellsOf(grid, 'S')
  if (scatters.length >= 3) wins.push({ symbol: 'S', count: scatters.length, ways: 1, multiplier: 1, pay: award(def, bet, DOLLAZ_SCATTER[Math.min(5, scatters.length)]), cells: scatters, scatter: true })
  const orbs: Record<string, OrbValue> = {}
  for (const [r, row] of cellsOf(grid, 'N')) orbs[key(r, row)] = rollCash(def, bet, rng)
  return { stops, grid, wins, win: round(wins.reduce((a, w) => a + w.pay, 0)), anticipation: anticipate(grid, new Set(['S']), 3), orbs }
}

function zoneAround(reel: number, row: number, size: number): { reel: number; row: number; size: number } {
  const offset = Math.floor((size - 1) / 2)
  return { reel: Math.max(0, Math.min(5 - size, reel - offset)), row: Math.max(0, Math.min(5 - size, row - offset)), size }
}

const cellOf = (k: string): [number, number] => k.split(',').map(Number) as [number, number]

/** Cash Collect on a 5x5 board; the base reels show as its bottom three rows. */
export function dollazCollect(def: MachineDef, bet: number, rng: Rng, bills: Record<string, OrbValue>): Feature & { kind: 'cashcollect' } {
  const start = Object.entries(bills)
    .map(([k, v]) => {
      const [r, row] = cellOf(k)
      return cashCell(key(r, row + 2), v)
    })
    .sort((a, b) => cellOf(a.cell)[0] - cellOf(b.cell)[0] || cellOf(a.cell)[1] - cellOf(b.cell)[1])
  let collected = start.reduce((a, c) => a + c.credits, 0)
  let gemsTotal = 0
  let left = 5
  let zone = start.length ? zoneAround(...cellOf(start[start.length - 1].cell), 2) : zoneAround(2, 3, 2)
  const grow = (count: number) => {
    const before = gemsTotal
    gemsTotal += count
    for (const [need, size, add] of DOLLAZ_GROW) if (before < need && gemsTotal >= need) {
      zone = zoneAround(zone.reel + Math.floor(zone.size / 2), zone.row + Math.floor(zone.size / 2), size)
      left += add
    }
  }
  grow(start.length)
  const zone0 = { ...zone }
  const steps: CollectStep[] = []
  while (left > 0 && steps.length < 40) {
    left--
    const billChance = zone.size >= 5 ? 0 : DOLLAZ_BILL_CHANCE[weighted(rng, DOLLAZ_HEAT)]
    const area = { ...zone }
    const inZone = (r: number, row: number) => r >= area.reel && r < area.reel + area.size && row >= area.row && row < area.row + area.size
    const coins: CollectStep['coins'] = []
    const gems: CollectStep['gems'] = []
    for (let r = 0; r < 5; r++) for (let row = 0; row < 5; row++) {
      const x = rng.next()
      const inside = inZone(r, row)
      if (x < billChance) {
        if (!inside) gems.push(cashCell(key(r, row), rollCash(def, bet, rng)))
      } else if (x < billChance + DOLLAZ_COIN_CHANCE) {
        const coin = cashCell(key(r, row), rollCash(def, bet, rng))
        coins.push({ ...coin, collected: inside })
        if (inside) collected += coin.credits
      }
    }
    const path: { reel: number; row: number; size: number }[] = []
    for (const gem of gems) {
      collected += gem.credits
      zone = zoneAround(...cellOf(gem.cell), zone.size)
      path.push({ ...zone })
    }
    grow(gems.length)
    steps.push({ zone: { ...zone }, coins, gems, gemsTotal, left, collected: round(collected), path })
  }
  return { kind: 'cashcollect', steps, win: round(collected), start, zone: zone0 }
}

function dollazFree(def: MachineDef, bet: number, rng: Rng, bonus: number): Feature {
  const spins: SpinStep[] = []
  let left = DOLLAZ_FREE
  let awarded = DOLLAZ_FREE
  let win = bonus
  while (left > 0 && spins.length < DOLLAZ_MAX_FREE) {
    left--
    const s = dollazSpin(def, bet, rng, def.freeStrips)
    if (cellsOf(s.grid, 'S').length >= 3) {
      const add = Math.min(DOLLAZ_FREE, DOLLAZ_MAX_FREE - awarded)
      left += add
      awarded += add
    }
    if (s.grid[0].includes('M') && Object.keys(s.orbs ?? {}).length) {
      const inner = dollazCollect(def, bet, rng, s.orbs!)
      s.inner = inner
      s.win = round(s.win + inner.win)
    }
    s.left = left
    win += s.win
    spins.push(s)
  }
  return { kind: 'freegames', awarded, spins, win: round(win) }
}

function playDollaz(def: MachineDef, bet: number, rng: Rng, state: MachineState): { base: SpinStep; feature: Feature | null; state: MachineState } {
  const full = meterFull(def)
  const meters = { green: 0, pink: 0, blue: 0, ...state.meters }
  const base = dollazSpin(def, bet, rng, def.strips)
  const bills = Object.keys(base.orbs ?? {}).length
  const scatters = cellsOf(base.grid, 'S').length
  const wilds = cellsOf(base.grid, 'W').length
  meters.green += bills
  meters.pink += scatters
  meters.blue += wilds
  const parts: Feature[] = []
  if (meters.blue >= full.blue || (wilds > 0 && rng.next() < 1 - (1 - DOLLAZ_RANDOM.wild) ** wilds)) {
    parts.push(jackpotPick(def, bet, rng, DOLLAZ_PICK))
    meters.blue = 0
  }
  const collector = base.grid[0].includes('M')
  if (bills > 0 && (collector || meters.green >= full.green || rng.next() < DOLLAZ_RANDOM.collect)) {
    parts.push(dollazCollect(def, bet, rng, base.orbs!))
    meters.green = 0
  }
  if (scatters >= 3 || meters.pink >= full.pink || (scatters > 0 && rng.next() < DOLLAZ_RANDOM.free)) {
    parts.push(dollazFree(def, bet, rng, scatters >= 3 ? 0 : award(def, bet, 1)))
    meters.pink = 0
  }
  for (const k of ['green', 'pink', 'blue'] as const) meters[k] = Math.min(full[k], meters[k])
  const win = round(parts.reduce((a, f) => a + f.win, 0))
  const feature: Feature | null = parts.length === 0 ? null : parts.length === 1 ? parts[0] : { kind: 'chain', parts, win }
  return { base, feature, state: { meters } }
}

// ------------------------------------------------------------------ entry

export function playSpin(def: MachineDef, bet: number, rng: Rng, state: MachineState = {}): SpinResult {
  let out: { base: SpinStep; feature: Feature | null; state?: MachineState }
  if (def.family === 'link') out = playLink(def, bet, rng)
  else if (def.family === 'house') out = playHouse(def, bet, rng)
  else if (def.family === 'collect') out = playCollect(def, bet, rng, state)
  else if (def.family === 'dollaz') out = playDollaz(def, bet, rng, state)
  else out = playGold(def, bet, rng)
  const totalWin = round(out.base.win + (out.feature?.win ?? 0))
  return { machine: def.id, bet, base: out.base, feature: out.feature, state: out.state ?? state, totalWin }
}
