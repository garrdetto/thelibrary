/** Every type the darts module shares between the page, the tests and the DartsRoom Durable Object: players, match state, throws, mode settings and the wire protocol. Renderer-free. */

export type GameMode = 'x01' | 'cricket' | 'countup'
export type MatchStatus = 'lobby' | 'playing' | 'turnEnd' | 'legOver' | 'finished'
export type ConnectionStatus = 'local' | 'cpu' | 'connected' | 'away'
export type Multiplier = 0 | 1 | 2 | 3
export type Ring = 'innerBull' | 'outerBull' | 'triple' | 'double' | 'singleInner' | 'singleOuter' | 'miss'
export type CricketTarget = 15 | 16 | 17 | 18 | 19 | 20 | 25
export type Vec3 = readonly [x: number, y: number, z: number]

/** One dart on the board. `coordinates` are metres in board space (x right, y up, z out of the face); `radius` is millimetres from the bull and `angle` degrees clockwise from straight up. */
export interface DartThrow {
  coordinates: Vec3
  sector: number
  multiplier: Multiplier
  ring: Ring
  scoreValue: number
  angle: number
  radius: number
}

export interface PlayerStats {
  darts: number
  points: number
  /** Three-dart average for x01 and Count Up; marks per round for Cricket. */
  average: number
  /** Cricket marks that counted: each one that closed a number or scored points. */
  marks: number
  tons: number
  oneEighties: number
  highestTurn: number
  doublesHit: number
  doublesTried: number
  checkouts: number
  bestCheckout: number
  bulls: number
  legsWon: number
}

export interface Player {
  id: string
  name: string
  /** x01: points remaining; Cricket: points scored; Count Up: running total. */
  score: number
  currentRoundThrows: DartThrow[]
  connectionStatus: ConnectionStatus
  stats: PlayerStats
  /** Cricket marks per target, 0–3 (3 = closed). */
  marks: Record<CricketTarget, number>
  /** x01 with double-in: whether this player has opened the leg. */
  opened: boolean
  /** Score at the start of the current turn, restored on a bust. */
  turnStartScore: number
  /** True for the computer opponent; its `cpuLevel` sets its spread. */
  cpu: boolean
  cpuLevel: CpuLevel
  /** Team play: the team index (0–3) this player or side belongs to; teammates share a flight colour and win legs together. */
  team?: number
  teamName?: string
  /** Shared-score teams: the people taking turns on this side's score; `cpu`, `cpuLevel` and `thrower` follow whoever is up. */
  members?: TeamMember[]
  /** Shared-score teams: turns this side has finished, which picks the next member up. */
  turnsTaken?: number
  thrower?: string
}

/** One person on a shared-score team. */
export interface TeamMember {
  name: string
  cpu: boolean
  cpuLevel: CpuLevel
}

/** How a team match is scored: `stacked` (teammates take turns on one shared score) or `regular` (each plays their own score; legs are won for the team). */
export type TeamPlay = 'stacked' | 'regular'

export type CpuLevel = 'pub' | 'league' | 'county' | 'pro'

export interface X01Config {
  mode: 'x01'
  start: 301 | 501 | 701
  doubleIn: boolean
  doubleOut: boolean
  /** Soft-tip Double Bull: the whole bullseye (outer bull included) scores 50 and counts as a double. */
  doubleBull?: boolean
}

export interface CricketConfig {
  mode: 'cricket'
  /** Score points on targets you have closed while any opponent has not. */
  scoring: boolean
  /** The leg ends after this many rounds; most points (then most marks) wins. */
  roundLimit: number
}

export interface CountUpConfig {
  mode: 'countup'
  rounds: number
}

export type ModeConfig = X01Config | CricketConfig | CountUpConfig

/** The board a match is played on: `steel` (steel-tip bristle) or `spider` (soft tip). Records and averages are kept per board, because soft-tip rules differ. */
export type BoardKind = 'steel' | 'spider'

export interface MatchConfig {
  rules: ModeConfig
  legsPerSet: number
  setsToWin: number
  board?: BoardKind
  /** Present for team matches (local only); team legs never go on the record book. */
  teamPlay?: TeamPlay
}

export interface LegScore {
  current: number
  won: Record<string, number>
}

export interface TurnRecord {
  playerId: string
  set: number
  leg: number
  round: number
  throws: DartThrow[]
  scored: number
  bust: boolean
  scoreAfter: number
}

export interface GameState {
  roomId: string
  gameMode: GameMode
  config: MatchConfig
  status: MatchStatus
  players: Player[]
  currentTurnPlayerId: string
  /** Index into `players` of whoever threw first this leg; it moves on each leg. */
  legStarter: number
  round: number
  legs: LegScore
  sets: LegScore
  /** The turns of the leg being played (cleared when the next leg starts). */
  history: TurnRecord[]
  winnerId: string | null
  legWinnerId: string | null
  /** Bumped on every accepted throw; clients ignore stale snapshots. */
  version: number
}

export type AnnouncementKind =
  | 'score'
  | 'bust'
  | 'ton'
  | 'oneEighty'
  | 'lowTon'
  | 'hatTrick'
  | 'highTon'
  | 'bull'
  | 'innerBull'
  | 'triple'
  | 'double'
  | 'opened'
  | 'notOpened'
  | 'closed'
  | 'checkout'
  | 'legWon'
  | 'setWon'
  | 'matchWon'
  | 'miss'

export interface Announcement {
  kind: AnnouncementKind
  text: string
  playerId: string
}

/** What a released dart was asked to do: the aim point on the board face (metres from the bull), the launch speed and an optional sideways yaw, plus how steady the release was (0 perfectly smooth, 1 very shaky). */
export interface ThrowIntent {
  aimX: number
  aimY: number
  speed: number
  yaw: number
  wobble: number
  /** Cross meter (test option) only: where the horizontal meter stopped, as a fraction of the ideal speed off its middle (negative left, positive right). */
  cross?: number
}

/** Everything needed to replay one dart's flight on any screen: the release point and the velocity after human error. */
export interface FlightParams {
  origin: Vec3
  velocity: Vec3
}

export interface RoomPlayerView {
  id: string
  name: string
  seat: number
  connected: boolean
  member: boolean
  host: boolean
}

export type ClientMessage =
  | { type: 'ROOM_CREATE'; config: MatchConfig }
  | { type: 'ROOM_JOIN' }
  | { type: 'GAME_START' }
  | { type: 'THROW_MADE'; intent: ThrowIntent; version: number }
  | { type: 'REMATCH' }
  | { type: 'RESTART_REQUEST' }
  | { type: 'PING'; at: number }

export type ServerMessage =
  | { type: 'ROOM_STATE'; code: string; you: string; players: RoomPlayerView[]; state: GameState | null; config: MatchConfig }
  | { type: 'THROW_MADE'; playerId: string; dart: DartThrow; flight: FlightParams; state: GameState; announcements: Announcement[] }
  | { type: 'TURN_SWITCH'; state: GameState; announcements: Announcement[] }
  | { type: 'GAME_OVER'; winnerId: string; state: GameState; announcements: Announcement[] }
  | { type: 'PLAYERS'; players: RoomPlayerView[] }
  | { type: 'RESTART_VOTES'; requested: string[]; needed: number; by: string | null }
  | { type: 'ERROR'; message: string }
  | { type: 'PONG'; at: number }
