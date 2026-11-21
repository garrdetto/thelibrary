import { DOLLAZ_X, MACHINE_BY_ID, MO_DOLLAZ_ID, meterFull, meterLevel, playSpin, type Feature, type Jackpot, type SpinResult } from '../../foxlake/casino/math/machines'
import { cryptoRng, type Rng } from '../../foxlake/casino/math/rng'

export const DOLLAZ = MACHINE_BY_ID[MO_DOLLAZ_ID]
export const METER_FULL = meterFull(DOLLAZ)
export const BET_LEVELS_CENTS: readonly number[] = [25, 50, 100, 150, 200, 250, 300, 400, 500]
export const MAX_BET_CENTS = 500
export const DEFAULT_BET_INDEX = 2
export const STARTING_BALANCE_CENTS = 100000
export const JACKPOT_ORDER: readonly Jackpot[] = ['GRAND', 'MAJOR', 'MAXI', 'MINOR', 'MINI']
export const CASH_MULTIPLES = DOLLAZ_X

export type ForceOutcome = 'collect' | 'free' | 'pick' | 'bigwin'
export type Meters = { green: number; pink: number; blue: number }

export interface Stats {
  spins: number
  wagered: number
  won: number
  hits: number
  collects: number
  frees: number
  picks: number
  biggestWin: number
}

export interface GameSnapshot {
  balance: number
  meters: Meters
  stats: Stats
}

export interface GameState {
  version: 1
  balance: number
  meters: Meters
  stats: Stats
}

export interface Round {
  id: number
  /** Bet in cents. */
  bet: number
  /** The machine's result, in dollars (the shared casino maths works in dollars). */
  result: SpinResult
  /** Total won this round, in cents. */
  win: number
  forced: ForceOutcome | null
  state: GameSnapshot
}

export class SpinError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpinError'
  }
}

export const cents = (dollars: number): number => Math.round(dollars * 100)
export const emptyMeters = (): Meters => ({ green: 0, pink: 0, blue: 0 })
const emptyStats = (): Stats => ({ spins: 0, wagered: 0, won: 0, hits: 0, collects: 0, frees: 0, picks: 0, biggestWin: 0 })

export function jackpotCents(jackpot: Jackpot, bet: number): number {
  return Math.round((DOLLAZ.jackpots[jackpot] ?? 0) * DOLLAZ.scale * bet)
}

export function meterLevels(meters: Meters): Meters {
  return { green: meterLevel(meters.green, METER_FULL.green), pink: meterLevel(meters.pink, METER_FULL.pink), blue: meterLevel(meters.blue, METER_FULL.blue) }
}

export function featureKinds(feature: Feature | null): Feature['kind'][] {
  if (!feature) return []
  return feature.kind === 'chain' ? feature.parts.flatMap((part) => featureKinds(part)) : [feature.kind]
}

const FORCE_KIND: Record<Exclude<ForceOutcome, 'bigwin'>, Feature['kind']> = { collect: 'cashcollect', free: 'freegames', pick: 'jackpotpick' }

function matches(result: SpinResult, force: ForceOutcome, dollars: number): boolean {
  if (force === 'bigwin') return result.totalWin >= dollars * 20
  return featureKinds(result.feature).includes(FORCE_KIND[force])
}

/** Spins the maths until the outcome shows the forced feature (developer panel and admin only; forced rounds are never ranked). */
export function forcedSpin(dollars: number, rng: Rng, meters: Meters, force: ForceOutcome): SpinResult {
  for (let attempt = 0; attempt < 400000; attempt++) {
    const result = playSpin(DOLLAZ, dollars, rng, { meters })
    if (matches(result, force, dollars)) return result
  }
  return playSpin(DOLLAZ, dollars, rng, { meters })
}

function sane(meters: Partial<Meters> | undefined): Meters {
  const out = emptyMeters()
  for (const key of ['green', 'pink', 'blue'] as const) {
    const value = Number(meters?.[key])
    out[key] = Number.isFinite(value) ? Math.max(0, Math.min(METER_FULL[key], Math.floor(value))) : 0
  }
  return out
}

export class DollazGame {
  private balance: number
  private meters: Meters
  private stats: Stats
  private counter = 0

  constructor(options: { balance?: number; meters?: Partial<Meters>; stats?: Partial<Stats> } = {}) {
    this.balance = Math.max(0, Math.round(options.balance ?? STARTING_BALANCE_CENTS))
    this.meters = sane(options.meters)
    this.stats = { ...emptyStats(), ...options.stats }
  }

  static fromState(state: Partial<GameState> | null | undefined): DollazGame {
    return new DollazGame({ balance: state?.balance ?? 0, meters: state?.meters, stats: state?.stats })
  }

  toState(): GameState {
    return { version: 1, balance: this.balance, meters: { ...this.meters }, stats: { ...this.stats } }
  }

  snapshot(): GameSnapshot {
    return { balance: this.balance, meters: { ...this.meters }, stats: { ...this.stats } }
  }

  canSpin(bet: number): boolean {
    return this.balance >= bet
  }

  setBalance(amount: number): void {
    this.balance = Math.max(0, Math.round(amount))
  }

  addCredits(amount: number): GameSnapshot {
    this.balance += Math.max(0, Math.round(amount))
    return this.snapshot()
  }

  resetStats(): GameSnapshot {
    this.stats = emptyStats()
    return this.snapshot()
  }

  spin(bet: number, force: ForceOutcome | null = null, rng: Rng = cryptoRng()): Round {
    if (!Number.isInteger(bet) || bet <= 0) throw new SpinError('Bet must be a positive whole number of cents.')
    if (bet > MAX_BET_CENTS) throw new SpinError('The most you can bet on a spin is $5.')
    if (this.balance < bet) throw new SpinError('Not enough credits for this bet.')
    this.balance -= bet
    const dollars = bet / 100
    const result = force ? forcedSpin(dollars, rng, this.meters, force) : playSpin(DOLLAZ, dollars, rng, { meters: this.meters })
    this.meters = sane(result.state.meters)
    const win = cents(result.totalWin)
    this.balance += win
    const kinds = featureKinds(result.feature)
    this.stats.spins++
    this.stats.wagered += bet
    this.stats.won += win
    if (win > 0) this.stats.hits++
    if (kinds.includes('cashcollect')) this.stats.collects++
    if (kinds.includes('freegames')) this.stats.frees++
    if (kinds.includes('jackpotpick')) this.stats.picks++
    if (win > this.stats.biggestWin) this.stats.biggestWin = win
    return { id: ++this.counter, bet, result, win, forced: force, state: this.snapshot() }
  }
}
