/** The single authority for match state in every mode: players, hole order, strokes, ball positions, penalties, turn order and placements. The online host is the only peer that calls the mutators. */
import { SHOT_KINDS, tuning, type ClubId, type LieKind, type RoundMode, type ShotKind } from '../tuning'
import type { ShotParams, ShotResult } from './BallFlight'
import { courseFor } from './Course'
import { hashSeed, stringSeed } from './Random'
import { horizontalDistance, type Vec3 } from './Vector'
import { windForSeed, type WindState } from './Wind'

export interface PlayerSeat {
  id: string
  name: string
}

export interface PlayerState extends PlayerSeat {
  /** Strokes on each hole of the match, penalties included; null until the hole is played. */
  strokes: (number | null)[]
  ball: Vec3
  lie: LieKind
  teeShot: boolean
  holed: boolean
  pickedUp: boolean
  /** Closest-to-the-pin results per hole in metres; null for a penalty or a hole not yet played. */
  pinDistances: (number | null)[]
  holeInOne: boolean
}

export interface MatchState {
  mode: RoundMode
  holes: number[]
  windSeeds: number[]
  matchSeed: number
  holeIndex: number
  players: PlayerState[]
  current: string | null
  finished: boolean
  shotNumber: number
}

export interface SwingInput {
  yaw: number
  club: ClubId
  power: number
  curve: number
  spin: number
  push?: number
  shot?: ShotKind
}

export type MatchEvent =
  | { type: 'penalty'; playerId: string; reason: 'water' | 'out'; strokes: number }
  | { type: 'holed'; playerId: string; strokes: number; par: number; holeInOne: boolean }
  | { type: 'pickedUp'; playerId: string; strokes: number }
  | { type: 'pin'; playerId: string; hole: number; metres: number | null; holeInOne: boolean }
  | { type: 'holeComplete'; hole: number }
  | { type: 'turn'; playerId: string }
  | { type: 'finished' }

export interface MatchUpdate {
  state: MatchState
  events: MatchEvent[]
}

export interface Placement {
  id: string
  name: string
  place: number
  total: number
}

export interface MatchOptions {
  mode: RoundMode
  holes: readonly number[]
  windSeeds: readonly number[]
  matchSeed: number
  players: readonly PlayerSeat[]
}

function teeState(seat: PlayerSeat, holeCount: number, holeIndexInCourse: number, mode: RoundMode): PlayerState {
  return {
    id: seat.id,
    name: seat.name,
    strokes: Array.from({ length: holeCount }, () => null),
    ball: courseFor(holeIndexInCourse).teeFor(mode),
    lie: 'tee',
    teeShot: true,
    holed: false,
    pickedUp: false,
    pinDistances: Array.from({ length: holeCount }, () => null),
    holeInOne: false,
  }
}

/** Hole indices for a match: all nine for solo and closest-to-the-pin, a seeded draw of three distinct holes online. */
export function pickHoles(mode: RoundMode, seed: number): number[] {
  const all = tuning.holes.map((_, index) => index)
  if (mode !== 'online') return all
  const pool = [...all]
  const chosen: number[] = []
  for (let draw = 0; draw < tuning.match.onlineHoleCount && pool.length; draw++) {
    const pick = hashSeed(seed, draw) % pool.length
    chosen.push(pool.splice(pick, 1)[0])
  }
  return chosen.sort((a, b) => a - b)
}

export function windSeedsFor(holes: readonly number[], seed: number): number[] {
  return holes.map((hole, index) => hashSeed(seed, hole, index, 0x77))
}

export function createMatch(options: MatchOptions): MatchState {
  const first = options.holes[0]
  const players = options.players.slice(0, tuning.match.maxPlayers).map((seat) => teeState(seat, options.holes.length, first, options.mode))
  return {
    mode: options.mode,
    holes: [...options.holes],
    windSeeds: [...options.windSeeds],
    matchSeed: options.matchSeed >>> 0,
    holeIndex: 0,
    players,
    current: players[0]?.id ?? null,
    finished: players.length === 0,
    shotNumber: 0,
  }
}

export function currentCourseHole(state: MatchState): number {
  return state.holes[Math.min(state.holeIndex, state.holes.length - 1)]
}

export function currentWind(state: MatchState): WindState {
  return windForSeed(state.windSeeds[Math.min(state.holeIndex, state.windSeeds.length - 1)] ?? 0)
}

export function playerById(state: MatchState, playerId: string): PlayerState | undefined {
  return state.players.find((player) => player.id === playerId)
}

export function strokesThisHole(player: PlayerState, holeIndex: number): number {
  return player.strokes[holeIndex] ?? 0
}

export function totalStrokes(player: PlayerState): number {
  return player.strokes.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

export function parThrough(state: MatchState, holeCount: number): number {
  return state.holes.slice(0, holeCount).reduce((sum, hole) => sum + tuning.holes[hole].par, 0)
}

function active(state: MatchState, player: PlayerState): boolean {
  if (player.holed || player.pickedUp) return false
  if (state.mode === 'pin') return player.strokes[state.holeIndex] === null
  return true
}

/**
 * Whose turn it is: among players still playing the hole, the one farthest from the pin (horizontal distance).
 * Ties, including everyone on the tee, fall back to roster order. Returns null when the hole is complete.
 */
export function nextPlayer(state: MatchState): string | null {
  const pin = courseFor(currentCourseHole(state)).pinPosition()
  let best: PlayerState | null = null
  let bestDistance = -1
  for (const player of state.players) {
    if (!active(state, player)) continue
    const distance = horizontalDistance(player.ball, pin)
    if (distance > bestDistance + 1e-6) {
      best = player
      bestDistance = distance
    }
  }
  return best?.id ?? null
}

/** Shared seed for a stroke: the same on every peer because it mixes only match data. */
export function shotSeed(state: MatchState, playerId: string): number {
  const player = playerById(state, playerId)
  return hashSeed(state.matchSeed, state.holeIndex, stringSeed(playerId), player ? strokesThisHole(player, state.holeIndex) : 0, state.shotNumber)
}

/** Why a player may not shoot right now, or null when the shot is legal. Used by the host to validate guest shots. */
export function shotRejection(state: MatchState, playerId: string): string | null {
  if (state.finished) return 'The match is over.'
  if (state.current !== playerId) return 'It is not your turn.'
  const player = playerById(state, playerId)
  if (!player) return 'You are not in this match.'
  if (!active(state, player)) return 'You have finished this hole.'
  return null
}

/** Full flight parameters for a swing, taking the origin, lie, tee flag and wind from the authoritative state. */
export function shotParamsFor(state: MatchState, playerId: string, swing: SwingInput): ShotParams {
  const player = playerById(state, playerId)
  if (!player) throw new Error(`Unknown player ${playerId}`)
  const clamp = (value: number, min: number, max: number) => (Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0)
  const club = tuning.clubs.some((entry) => entry.id === swing.club) ? swing.club : 'driver'
  const putting = player.lie === 'green' || club === 'putter'
  return {
    hole: currentCourseHole(state),
    origin: player.ball,
    yaw: Number.isFinite(swing.yaw) ? swing.yaw : 0,
    club: player.lie === 'green' ? 'putter' : club,
    power: clamp(swing.power, 0, 1),
    curve: clamp(swing.curve, -1, 1),
    spin: clamp(swing.spin, -1, 1),
    push: clamp(swing.push ?? 0, -1, 1),
    shot: !putting && swing.shot && SHOT_KINDS.includes(swing.shot) ? swing.shot : 'full',
    lie: player.lie,
    teeShot: player.teeShot,
    wind: currentWind(state).vector,
  }
}

function withPlayer(state: MatchState, playerId: string, update: (player: PlayerState) => PlayerState): MatchState {
  return { ...state, players: state.players.map((player) => (player.id === playerId ? update(player) : player)) }
}

function holeComplete(state: MatchState): boolean {
  return state.players.every((player) => !active(state, player))
}

function resetForHole(state: MatchState, holeIndex: number): MatchState {
  const course = courseFor(state.holes[holeIndex])
  return {
    ...state,
    holeIndex,
    players: state.players.map((player) => ({ ...player, ball: course.teeFor(state.mode), lie: 'tee', teeShot: true, holed: false, pickedUp: false })),
  }
}

/**
 * Applies a finished shot to the state. One stroke always counts; water adds its penalty and moves the ball to the
 * drop zone; out of bounds adds its penalty and leaves the ball where the stroke was played (stroke and distance).
 * Closest-to-the-pin records the horizontal rest distance and ends the player's hole after one shot. A player who
 * reaches the stroke limit picks up. When everyone is done the hole advances (or the match finishes), and the next
 * player is chosen by distance to the pin.
 */
export function applyShot(state: MatchState, playerId: string, result: ShotResult): MatchUpdate {
  const events: MatchEvent[] = []
  const holeIndex = state.holeIndex
  const hole = tuning.holes[currentCourseHole(state)]
  const pin = courseFor(currentCourseHole(state)).pinPosition()
  let next = withPlayer({ ...state, shotNumber: state.shotNumber + 1 }, playerId, (player) => {
    const strokes = strokesThisHole(player, holeIndex) + 1 + result.penalty
    const holed = result.outcome === 'holed'
    const updated: PlayerState = {
      ...player,
      strokes: player.strokes.map((value, index) => (index === holeIndex ? strokes : value)),
      ball: result.next,
      lie: result.nextLie,
      teeShot: result.outcome === 'out' ? player.teeShot : false,
      holed,
    }
    if (result.outcome === 'water' || result.outcome === 'out') events.push({ type: 'penalty', playerId, reason: result.outcome, strokes })
    if (state.mode === 'pin') {
      const metres = result.outcome === 'holed' ? 0 : result.outcome === 'rest' ? horizontalDistance(result.rest, pin) : null
      events.push({ type: 'pin', playerId, hole: currentCourseHole(state), metres, holeInOne: holed })
      return { ...updated, pinDistances: player.pinDistances.map((value, index) => (index === holeIndex ? metres : value)), holeInOne: player.holeInOne || holed }
    }
    if (holed) {
      events.push({ type: 'holed', playerId, strokes, par: hole.par, holeInOne: strokes === 1 })
      return { ...updated, holeInOne: player.holeInOne || strokes === 1 }
    }
    if (strokes >= tuning.match.maxStrokesPerHole) {
      events.push({ type: 'pickedUp', playerId, strokes: tuning.match.maxStrokesPerHole })
      return { ...updated, pickedUp: true, strokes: updated.strokes.map((value, index) => (index === holeIndex ? tuning.match.maxStrokesPerHole : value)) }
    }
    return updated
  })
  if (holeComplete(next)) {
    events.push({ type: 'holeComplete', hole: holeIndex })
    if (holeIndex + 1 >= next.holes.length) {
      next = { ...next, finished: true, current: null }
      events.push({ type: 'finished' })
      return { state: next, events }
    }
    next = resetForHole(next, holeIndex + 1)
  }
  const current = nextPlayer(next)
  next = { ...next, current }
  if (current) events.push({ type: 'turn', playerId: current })
  return { state: next, events }
}

/** Removes a player who left an online match; if it was their turn, play passes on. Their scores stay out of placements. */
export function removePlayer(state: MatchState, playerId: string): MatchUpdate {
  const remaining: MatchState = { ...state, players: state.players.filter((player) => player.id !== playerId) }
  if (!remaining.players.length) return { state: { ...remaining, finished: true, current: null }, events: [{ type: 'finished' }] }
  if (state.current !== playerId) return { state: remaining, events: [] }
  if (holeComplete(remaining)) {
    if (remaining.holeIndex + 1 >= remaining.holes.length) return { state: { ...remaining, finished: true, current: null }, events: [{ type: 'holeComplete', hole: remaining.holeIndex }, { type: 'finished' }] }
    const advanced = resetForHole(remaining, remaining.holeIndex + 1)
    const current = nextPlayer(advanced)
    return { state: { ...advanced, current }, events: [{ type: 'holeComplete', hole: remaining.holeIndex }, ...(current ? [{ type: 'turn' as const, playerId: current }] : [])] }
  }
  const current = nextPlayer(remaining)
  return { state: { ...remaining, current }, events: current ? [{ type: 'turn', playerId: current }] : [] }
}

/** Standard competition ranking by total strokes (1, 2, 2, 4): equal totals share a place. */
export function placements(state: MatchState): Placement[] {
  const rows = state.players.map((player) => ({ id: player.id, name: player.name, total: totalStrokes(player) })).sort((a, b) => a.total - b.total)
  return rows.map((row) => ({ ...row, place: rows.findIndex((other) => other.total === row.total) + 1 }))
}

/** Label for a hole score relative to par (eagle, birdie, par, bogey …). */
export function scoreLabel(strokes: number, par: number): string {
  if (strokes === 1) return tuning.scoreNames.ace ?? tuning.scoreNames['-2']
  const diff = strokes - par
  return tuning.scoreNames[String(diff)] ?? (diff > 0 ? `+${diff}` : String(diff))
}
