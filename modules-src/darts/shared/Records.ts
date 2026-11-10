/** Record book and all-time averages: which results count, per board and format. Renderer-free, shared by the page, the DartsRoom (which saves online results itself) and the `/api/darts-records` route that validates them. */
import type { BoardKind, GameState, MatchConfig, ModeConfig } from './interfaces'
import { CRICKET_TARGETS } from './Rules'

export const BOARD_KINDS = ['steel', 'spider'] as const satisfies readonly BoardKind[]
export const RECORD_MODES = ['501', '301', 'cricket', 'countup'] as const
export type RecordMode = (typeof RECORD_MODES)[number]
export const AVERAGE_MODES = ['501', '301', 'cricket'] as const
export type AverageMode = (typeof AVERAGE_MODES)[number]

export const BOARD_NAMES: Record<BoardKind, string> = { steel: 'Steel Tip', spider: 'Soft Tip' }
export const MODE_NAMES: Record<RecordMode, string> = { '501': '501', '301': '301', cricket: 'Cricket', countup: 'Count Up' }
/** Count Up records only count the standard eight rounds (24 darts). */
export const COUNTUP_RECORD_ROUNDS = 8
/** A player needs this many darts in a format before their average joins the top five. */
export const AVERAGE_MIN_DARTS = 30

/** Lowest and highest value a record can hold: fewest darts for 501, 301 and Cricket (the perfect legs), the most points for Count Up. */
export const RECORD_LIMITS: Record<RecordMode, { min: number; max: number; order: 'asc' | 'desc' }> = {
  '501': { min: 9, max: 999, order: 'asc' },
  '301': { min: 6, max: 999, order: 'asc' },
  cricket: { min: 8, max: 999, order: 'asc' },
  countup: { min: 0, max: COUNTUP_RECORD_ROUNDS * 3 * 60, order: 'desc' },
}

export function isBoardKind(value: unknown): value is BoardKind {
  return value === 'steel' || value === 'spider'
}

export function isRecordMode(value: unknown): value is RecordMode {
  return (RECORD_MODES as readonly unknown[]).includes(value)
}

export function isAverageMode(value: unknown): value is AverageMode {
  return (AVERAGE_MODES as readonly unknown[]).includes(value)
}

export function boardOf(config: MatchConfig): BoardKind {
  return config.board === 'spider' ? 'spider' : 'steel'
}

/** The record format a match's rules play, or null when they can't go on the record book: 701, Count Up that isn't eight rounds, Cricket without points, and on the steel-tip board 301/501 without double out (soft tip may finish on any bed). */
export function recordMode(config: MatchConfig): RecordMode | null {
  const rules: ModeConfig = config.rules
  if (rules.mode === 'countup') return rules.rounds === COUNTUP_RECORD_ROUNDS ? 'countup' : null
  if (rules.mode === 'cricket') return rules.scoring ? 'cricket' : null
  if (rules.start === 701) return null
  if (boardOf(config) === 'steel' && !rules.doubleOut) return null
  return rules.start === 301 ? '301' : '501'
}

/** The format an average is kept in: points per dart for 301 and 501, marks per round for Cricket. */
export function averageMode(config: MatchConfig): AverageMode | null {
  const mode = recordMode(config)
  return mode && isAverageMode(mode) ? mode : null
}

export function averageUnit(mode: AverageMode): 'PPD' | 'MPR' {
  return mode === 'cricket' ? 'MPR' : 'PPD'
}

/** Points per dart (301/501) or marks per round of three darts (Cricket) from totals; 0 with no darts. */
export function averageValue(mode: AverageMode, darts: number, total: number): number {
  if (darts <= 0) return 0
  return mode === 'cricket' ? (total / darts) * 3 : total / darts
}

export function formatAverage(mode: AverageMode, darts: number, total: number): string {
  return averageValue(mode, darts, total).toFixed(2)
}

/** Highest total a player could have from `darts` darts: 60 points or 3 marks a dart. */
export function maxAverageTotal(mode: AverageMode, darts: number): number {
  return darts * (mode === 'cricket' ? 3 : 60)
}

export interface LegResult {
  playerId: string
  mode: RecordMode
  value: number
}

/** True straight after the throw that finished a leg (won, tied, or the match over). */
export function legJustEnded(state: GameState): boolean {
  return (state.status === 'legOver' || state.status === 'finished') && state.history.length > 0
}

function legTurns(state: GameState) {
  return state.history.filter((turn) => turn.set === state.sets.current && turn.leg === state.legs.current)
}

/**
 * The record-book results of the leg that just ended (call it on the state right after the finishing throw, before `nextTurn`): for 301 and 501
 * the darts the winner took to check out, for Cricket the darts the winner took to close every number (a leg won on points at the round limit
 * doesn't count), and for Count Up every player's total. Empty when the rules aren't a record format.
 */
export function legResults(state: GameState): LegResult[] {
  const mode = recordMode(state.config)
  if (!mode || state.config.teamPlay || !legJustEnded(state)) return []
  const turns = legTurns(state)
  const dartsOf = (playerId: string) => turns.filter((turn) => turn.playerId === playerId).reduce((sum, turn) => sum + turn.throws.length, 0)
  if (mode === 'countup') {
    return state.players.map((player) => ({
      playerId: player.id,
      mode,
      value: turns.filter((turn) => turn.playerId === player.id).reduce((sum, turn) => sum + turn.scored, 0),
    }))
  }
  const winnerId = state.legWinnerId ?? state.winnerId
  const winner = state.players.find((player) => player.id === winnerId)
  if (!winner) return []
  if (mode === 'cricket' && !CRICKET_TARGETS.every((target) => winner.marks[target] >= 3)) return []
  if (mode !== 'cricket' && winner.score !== 0) return []
  const value = dartsOf(winner.id)
  const limits = RECORD_LIMITS[mode]
  return value >= limits.min && value <= limits.max ? [{ playerId: winner.id, mode, value }] : []
}

export interface MatchAverage {
  playerId: string
  mode: AverageMode
  darts: number
  total: number
}

/** Each player's darts and points (301/501) or marks (Cricket) so far this match. */
export function matchAverages(state: GameState): MatchAverage[] {
  const mode = averageMode(state.config)
  if (!mode) return []
  return state.players.map((player) => ({ playerId: player.id, mode, darts: player.stats.darts, total: mode === 'cricket' ? player.stats.marks : player.stats.points }))
}

/**
 * Whether a match's darts go into the all-time averages: real against real (two or more people at the oche) or real against the hardest
 * computer (`pro`). Solo practice, the easier computers and team matches only show the averages.
 */
export function countsForAverages(state: GameState): boolean {
  if (state.config.teamPlay) return false
  const humans = state.players.filter((player) => !player.cpu).length
  if (humans >= 2) return true
  return humans === 1 && state.players.some((player) => player.cpu && player.cpuLevel === 'pro')
}
