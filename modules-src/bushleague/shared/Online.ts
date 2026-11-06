/** Online matchups: the wire protocol, Elo, and the authoritative match core the BushLeagueMatch Durable Object runs. Renderer-free and deterministic apart from the clock the caller passes in, so node tests drive it directly. The server owns the contest; both pages replay its input records with the same sim, so only intents travel and every pitch resolves identically everywhere. */
import { Contest, TEAMS, type ContestSetup, type InputRecord, type PitchIntent, type SwingIntent } from '../sim'
import type { Side } from '../sim/types'

export type { InputRecord }

/** Online contests use one fixed difficulty for both sides: Pro pitch speed and contact cursor, no batting assist. */
export const ONLINE_PACE = 1.6
export const ONLINE_PCI = 1.15
/** Seconds the pitch clip takes before release on every page (config.timing.windup). */
export const ONLINE_WINDUP = 1.05
export const PRE_SECONDS = 30
export const PITCH_SECONDS = 45
export const SWING_GRACE_SECONDS = 20
export const RECONNECT_SECONDS = 90
export const RATING_START = 1200
export const RATING_K = 32
export const ROOM_CODE_LENGTH = 6
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export type MatchMode = 'queue' | 'create' | 'join'

export interface PlayerView {
  name: string
  side: Side
  team: string
  connected: boolean
  member: boolean
  rating: number | null
}

export interface RatingChange {
  before: number
  after: number
}

export interface StateDigest {
  inning: number
  half: 'top' | 'bottom'
  outs: number
  balls: number
  strikes: number
  score: [number, number]
  bases: number
}

export type ClientMessage =
  | { t: 'pre'; steal: number[] }
  | { t: 'pitch'; intent: PitchIntent }
  | { t: 'swing'; intent: SwingIntent }
  | { t: 'rematch' }
  | { t: 'concede' }

export type ServerMessage =
  | { t: 'welcome'; code: string; side: Side; ranked: boolean; players: PlayerView[]; setup: ContestSetup | null; log: InputRecord[] }
  | { t: 'players'; players: PlayerView[] }
  | { t: 'start'; setup: ContestSetup; players: PlayerView[] }
  | { t: 'rec'; i: number; record: InputRecord; digest: StateDigest }
  | { t: 'final'; winner: Side; reason: 'final' | 'forfeit' | 'concede'; score: [number, number]; ratings: [RatingChange | null, RatingChange | null] }
  | { t: 'rematch'; sides: Side[] }
  | { t: 'notice'; text: string }
  | { t: 'queue'; waiting: number }
  | { t: 'matched'; code: string }

export function roomCode(random: () => number): string {
  let code = ''
  for (let index = 0; index < ROOM_CODE_LENGTH; index++) code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length) % ROOM_ALPHABET.length]
  return code
}

export function isRoomCode(value: string): boolean {
  return value.length === ROOM_CODE_LENGTH && [...value].every((letter) => ROOM_ALPHABET.includes(letter))
}

export function isTeamId(value: string): boolean {
  return TEAMS.some((team) => team.id === value)
}

/** Picks a different club when both players chose the same one. */
export function distinctTeam(team: string, taken: string): string {
  if (team !== taken) return team
  const index = TEAMS.findIndex((item) => item.id === team)
  return TEAMS[(index + 1) % TEAMS.length].id
}

/** Standard Elo: `score` is 1 for a win, 0 for a loss. Returns the new ratings for both players, rounded. */
export function elo(rating: number, opponent: number, score: 0 | 1, k = RATING_K): [number, number] {
  const expected = 1 / (1 + 10 ** ((opponent - rating) / 400))
  const change = Math.round(k * (score - expected))
  return [rating + change, opponent - change]
}

export function digestOf(contest: Contest): StateDigest {
  return {
    inning: contest.inning,
    half: contest.half,
    outs: contest.outs,
    balls: contest.balls,
    strikes: contest.strikes,
    score: [contest.score[0], contest.score[1]],
    bases: (contest.bases[1] ? 1 : 0) | (contest.bases[2] ? 2 : 0) | (contest.bases[3] ? 4 : 0),
  }
}

export function sameDigest(a: StateDigest, b: StateDigest): boolean {
  return a.inning === b.inning && a.half === b.half && a.outs === b.outs && a.balls === b.balls && a.strikes === b.strikes && a.score[0] === b.score[0] && a.score[1] === b.score[1] && a.bases === b.bases
}

export interface MatchOptions {
  innings: 3 | 6 | 9
  dh: boolean
  autoRunner: boolean
  mercy: boolean
}

export function onlineSetup(seed: number, away: string, home: string, options: MatchOptions): ContestSetup {
  return { seed, away, home: distinctTeam(home, away), innings: options.innings, dh: options.dh, autoRunner: options.autoRunner, mercy: options.mercy, aiSkill: [0, 0], pciScale: [ONLINE_PCI, ONLINE_PCI] }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)))

/**
 * The authoritative contest. The side that owns the current decision sends its intent; anything that would be an AI choice (pitching changes, the defense's pickoffs) comes from the sim's own suggestion, and an owner that stays silent past the deadline gets the safe default (no steal, the AI pitch, a take).
 * Timing is measured on each batter's own playback of the pitch, so latency never moves the swing; a swing that arrives before the pitch could have reached the plate on screen is held until it could have, so nobody can act on a pitch faster than they could see it.
 */
export class MatchCore {
  readonly contest: Contest
  deadline = 0
  private earliestSwing = 0
  private heldSwing: SwingIntent | null = null
  private paused = new Set<Side>()
  winner: Side | null = null

  constructor(readonly setup: ContestSetup, now: number) {
    this.contest = new Contest(setup)
    this.arm(now)
  }

  get final(): boolean {
    return this.contest.phase === 'final'
  }

  /** Which side owns the current decision. */
  get owner(): Side {
    return this.contest.phase === 'pitch' ? this.contest.fieldingSide : this.contest.battingSide
  }

  pause(side: Side): void {
    this.paused.add(side)
  }

  resume(side: Side, now: number): void {
    this.paused.delete(side)
    if (this.owner === side) this.deadline = Math.max(this.deadline, now + this.window() * 1000)
  }

  private window(): number {
    const contest = this.contest
    if (contest.phase === 'pre') return PRE_SECONDS
    if (contest.phase === 'pitch') return PITCH_SECONDS
    return ONLINE_WINDUP + (contest.lastPitch?.flightTime ?? 0.5) * ONLINE_PACE + SWING_GRACE_SECONDS
  }

  private arm(now: number): void {
    this.deadline = now + this.window() * 1000
    const flight = this.contest.lastPitch?.flightTime ?? 0.4
    this.earliestSwing = this.contest.phase === 'swing' ? now + (ONLINE_WINDUP + flight * ONLINE_PACE) * 900 : 0
  }

  /** Applies a player's message. Returns the new record, or null when it is not theirs to send or is malformed. */
  apply(side: Side, message: ClientMessage, now: number): InputRecord | null {
    const contest = this.contest
    if (this.final || side !== this.owner) return null
    if (message.t === 'pre' && contest.phase === 'pre') return this.pre(message.steal, now)
    if (message.t === 'pitch' && contest.phase === 'pitch') {
      const repertoire = contest.pitcher.pitching?.repertoire ?? []
      if (!repertoire.some((item) => item.type === message.intent.type)) return null
      const intent: PitchIntent = { type: message.intent.type, targetX: clamp(message.intent.targetX, -1500, 1500), targetY: clamp(message.intent.targetY, -200, 2200), effort: clamp(message.intent.effort, 40, 100), accuracy: clamp(message.intent.accuracy, -100, 100) }
      contest.preparePitch(intent)
      return this.recorded(now)
    }
    if (message.t === 'swing' && contest.phase === 'swing') {
      const swing = message.intent
      const intent: SwingIntent = swing.action === 'take' ? { action: 'take', type: 'contact', timing: 0, aimX: 0, aimY: 0 } : { action: 'swing', type: swing.type, timing: clamp(swing.timing, -3000, 3000), aimX: clamp(swing.aimX, -1500, 1500), aimY: clamp(swing.aimY, -200, 2200) }
      if (now < this.earliestSwing) {
        this.heldSwing ??= intent
        return null
      }
      return this.swing(intent, now)
    }
    return null
  }

  private swing(intent: SwingIntent, now: number): InputRecord {
    this.heldSwing = null
    this.contest.resolveSwing(intent)
    return this.recorded(now)
  }

  private pre(steal: readonly number[], now: number): InputRecord {
    const contest = this.contest
    const intent = contest.suggestPrePitch()
    intent.steal = [2, 1].filter((base) => steal.includes(base) && !!contest.bases[base] && !contest.bases[base + 1])
    intent.pinchHit = null
    contest.prePitch(intent)
    return this.recorded(now)
  }

  /** Called on a timer: a swing that came in before the pitch could reach the plate on screen lands once it could have; past the deadline the owner's choice is made for them, unless they are disconnected and the room is waiting for them. */
  tick(now: number): InputRecord | null {
    if (this.final) return null
    const contest = this.contest
    if (this.heldSwing && contest.phase === 'swing' && now >= this.earliestSwing) return this.swing(this.heldSwing, now)
    if (now < this.deadline || this.paused.has(this.owner)) return null
    if (contest.phase === 'pre') return this.pre([], now)
    if (contest.phase === 'pitch') {
      contest.preparePitch(null)
      return this.recorded(now)
    }
    return this.swing({ action: 'take', type: 'contact', timing: 0, aimX: 0, aimY: 0 }, now)
  }

  private recorded(now: number): InputRecord {
    if (this.final) this.winner = this.contest.winner
    else this.arm(now)
    return this.contest.log[this.contest.log.length - 1]
  }
}
