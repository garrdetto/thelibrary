/** Eight-player knockout tournaments: quarter-finals, semi-finals and a final, every match one against one and best of three legs. The game rotation picks the format of leg 1, 2 and 3 of every match for the whole tournament. Pure and renderer-free; the page plays or simulates each leg and feeds the winner back with `recordTournamentLeg`. */
import type { BoardKind, CpuLevel, MatchConfig, ModeConfig } from './interfaces'
import type { Rng } from './Rng'

export const TOURNAMENT_SIZE = 8
export const TOURNAMENT_LEGS = 3
export const LEGS_TO_WIN = 2
export const ROUND_NAMES = ['Quarter-finals', 'Semi-finals', 'Final'] as const

export const ROTATION_MODES = ['501', '301', 'cricket', 'countup'] as const
export type RotationMode = (typeof ROTATION_MODES)[number]
export const ROTATION_NAMES: Record<RotationMode, string> = { '501': '501', '301': '301', cricket: 'Cricket', countup: 'Count Up' }

export interface Entrant {
  id: string
  name: string
  cpu: boolean
  cpuLevel: CpuLevel
}

export interface TournamentRules {
  board: BoardKind
  /** Format of leg 1, leg 2 and the deciding leg 3 of every match. */
  rotation: RotationMode[]
  doubleIn: boolean
  doubleOut: boolean
  doubleBull: boolean
  cricketScoring: boolean
  cricketRounds: number
  countupRounds: number
}

export interface TournamentLeg {
  mode: RotationMode
  winnerId: string
}

export interface TournamentMatch {
  id: string
  round: number
  slot: number
  a: string | null
  b: string | null
  legs: TournamentLeg[]
  winnerId: string | null
}

export interface Tournament {
  rules: TournamentRules
  entrants: Entrant[]
  matches: TournamentMatch[]
  championId: string | null
}

export function isRotationMode(value: unknown): value is RotationMode {
  return (ROTATION_MODES as readonly unknown[]).includes(value)
}

/** Builds the bracket: entrants in the given order (shuffled first with `rng` for a random draw) meet 1 v 2, 3 v 4, 5 v 6 and 7 v 8. */
export function createTournament(rules: TournamentRules, entrants: readonly Entrant[], rng?: Rng): Tournament {
  if (entrants.length !== TOURNAMENT_SIZE) throw new Error('A tournament needs eight players.')
  const rotation = Array.from({ length: TOURNAMENT_LEGS }, (_, i) => (isRotationMode(rules.rotation[i]) ? rules.rotation[i] : '501'))
  const order = entrants.map((entrant) => ({ ...entrant }))
  if (rng) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
  }
  const matches: TournamentMatch[] = []
  let size = TOURNAMENT_SIZE / 2
  for (let round = 0; size >= 1; round++, size /= 2) {
    for (let slot = 0; slot < size; slot++) {
      const first = round === 0 ? order[slot * 2].id : null
      const second = round === 0 ? order[slot * 2 + 1].id : null
      matches.push({ id: `r${round}m${slot}`, round, slot, a: first, b: second, legs: [], winnerId: null })
    }
  }
  return { rules: { ...rules, rotation }, entrants: order, matches, championId: null }
}

export function entrantOf(tournament: Tournament, id: string | null): Entrant | null {
  return tournament.entrants.find((entrant) => entrant.id === id) ?? null
}

/** The next match to play, in bracket order, or null once there's a champion. */
export function nextTournamentMatch(tournament: Tournament): TournamentMatch | null {
  return tournament.matches.find((match) => !match.winnerId && match.a && match.b) ?? null
}

export function legsWon(match: TournamentMatch, id: string | null): number {
  return match.legs.filter((leg) => leg.winnerId === id).length
}

/** The format of a match's next leg from the rotation. */
export function nextLegMode(tournament: Tournament, match: TournamentMatch): RotationMode {
  return tournament.rules.rotation[Math.min(match.legs.length, TOURNAMENT_LEGS - 1)]
}

export function rulesFor(mode: RotationMode, rules: Omit<TournamentRules, 'rotation'>): ModeConfig {
  if (mode === 'cricket') return { mode: 'cricket', scoring: rules.cricketScoring, roundLimit: rules.cricketRounds }
  if (mode === 'countup') return { mode: 'countup', rounds: rules.countupRounds }
  return { mode: 'x01', start: mode === '301' ? 301 : 501, doubleIn: rules.doubleIn, doubleOut: rules.doubleOut, doubleBull: rules.board === 'spider' && rules.doubleBull }
}

/** One leg of a tournament match, played as its own single-leg match. */
export function legConfig(tournament: Tournament, match: TournamentMatch): MatchConfig {
  return { rules: rulesFor(nextLegMode(tournament, match), tournament.rules), legsPerSet: 1, setsToWin: 1, board: tournament.rules.board }
}

/** Who throws first in a match's next leg: the first-named player in legs 1 and 3, the other in leg 2. */
export function legOrder(match: TournamentMatch): [string, string] {
  const a = match.a ?? ''
  const b = match.b ?? ''
  return match.legs.length % 2 === 0 ? [a, b] : [b, a]
}

/** Records the winner of a match's next leg. When someone reaches two legs they win the match and move into the next round (or win the tournament). Returns a new tournament; the input is never changed. */
export function recordTournamentLeg(input: Tournament, matchId: string, winnerId: string): Tournament {
  const tournament: Tournament = JSON.parse(JSON.stringify(input)) as Tournament
  const match = tournament.matches.find((item) => item.id === matchId)
  if (!match || match.winnerId || (winnerId !== match.a && winnerId !== match.b)) return input
  match.legs.push({ mode: nextLegMode(tournament, match), winnerId })
  if (legsWon(match, winnerId) < LEGS_TO_WIN) return tournament
  match.winnerId = winnerId
  const next = tournament.matches.find((item) => item.round === match.round + 1 && item.slot === Math.floor(match.slot / 2))
  if (!next) tournament.championId = winnerId
  else if (match.slot % 2 === 0) next.a = winnerId
  else next.b = winnerId
  return tournament
}

export function rotationLabel(tournament: Tournament): string {
  return tournament.rules.rotation.map((mode, i) => `Leg ${i + 1}: ${ROTATION_NAMES[mode]}`).join(' · ')
}
