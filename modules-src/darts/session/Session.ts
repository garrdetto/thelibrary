/** Match sessions behind one interface: LocalSession runs the rules in the page (solo, against the computer, pass-and-play, teams and tournament legs) with its own seeded release error, timed turn changes and computer turns; OnlineSession forwards throws to the DartsRoom over the socket and replays what the room decides. */
import { config } from '../config'
import { cpuThrow } from '../shared/Cpu'
import type { Announcement, DartThrow, FlightParams, GameState, MatchConfig, RoomPlayerView, ThrowIntent } from '../shared/interfaces'
import { launch, simulate, type SpreadLevel } from '../shared/Physics'
import { applyThrow, createMatch, currentPlayer, nextTurn, type SeatSpec } from '../shared/Rules'
import { createRng, randomSeed } from '../shared/Rng'
import type { DartsSocket } from '../net/Socket'

/** Every person at the oche throws with the same steadiness, here and in online rooms; only the computer has levels. */
export const HUMAN_LEVEL: SpreadLevel = 'normal'

export interface SessionEvents {
  /** A dart was released: animate `flight`, then show `state` when it lands. */
  dart(playerId: string, dart: DartThrow, flight: FlightParams, state: GameState, announcements: Announcement[]): void
  turnSwitch(state: GameState, announcements: Announcement[]): void
  gameOver(state: GameState, announcements: Announcement[]): void
  state(state: GameState): void
}

export interface Session {
  readonly kind: 'local' | 'online'
  state: GameState | null
  /** True when the dart in hand belongs to someone at this screen and nothing is in the air. */
  canThrow(): boolean
  throw(intent: ThrowIntent): void
  rematch(): void
  dispose(): void
}

export class LocalSession implements Session {
  readonly kind = 'local'
  state: GameState
  private busyUntil = 0
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly rng = createRng(randomSeed())
  private disposed = false
  private paused = false
  private held: (() => void)[] = []

  constructor(
    private readonly matchConfig: MatchConfig,
    private readonly seats: SeatSpec[],
    private readonly events: SessionEvents,
  ) {
    this.state = createMatch('local', matchConfig, seats)
    this.events.state(this.state)
    this.scheduleCpu()
  }

  canThrow(): boolean {
    return this.state.status === 'playing' && !currentPlayer(this.state).cpu && performance.now() >= this.busyUntil
  }

  throw(intent: ThrowIntent): void {
    if (!this.canThrow()) return
    this.release(intent, HUMAN_LEVEL)
  }

  private release(intent: ThrowIntent, level: SpreadLevel): void {
    const player = currentPlayer(this.state)
    const flight = launch(intent, level, this.rng)
    const impact = simulate(flight, undefined, undefined, this.state.config.board === 'spider' ? 'spider' : 'steel')
    const result = applyThrow(this.state, player.id, impact.dart)
    this.state = result.state
    const flightMs = impact.seconds * 1000 + 120
    this.busyUntil = performance.now() + flightMs
    this.events.dart(player.id, impact.dart, flight, result.state, result.announcements)
    if (result.state.status === 'finished') {
      this.later(flightMs + 400, () => this.events.gameOver(this.state, []))
      return
    }
    if (result.turnOver) {
      const pause = result.state.status === 'legOver' ? config.timing.legPauseMs : config.timing.turnPauseMs
      this.busyUntil = performance.now() + flightMs + pause
      this.later(flightMs + pause, () => {
        const next = nextTurn(this.state)
        this.state = next.state
        this.events.turnSwitch(next.state, next.announcements)
        this.scheduleCpu()
      })
      return
    }
    this.scheduleCpu(flightMs)
  }

  private scheduleCpu(extra = 0): void {
    const player = currentPlayer(this.state)
    if (this.state.status !== 'playing' || !player.cpu) return
    this.later(extra + config.timing.cpuThinkMs, () => {
      if (this.state.status !== 'playing' || currentPlayer(this.state).id !== player.id) return
      const choice = cpuThrow(this.state, player, this.rng)
      this.release(choice.intent, player.cpuLevel)
    })
  }

  private later(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      if (this.disposed) return
      if (this.paused) this.held.push(run)
      else run()
    }, ms)
    this.timers.add(timer)
  }

  /** Holds turn changes and computer throws until resume(). */
  pause(): void {
    this.paused = true
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    const runs = this.held
    this.held = []
    for (const run of runs) if (!this.disposed) run()
  }

  rematch(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    this.held = []
    this.paused = false
    this.busyUntil = 0
    this.state = createMatch('local', this.matchConfig, this.seats)
    this.events.turnSwitch(this.state, [])
    this.scheduleCpu()
  }

  dispose(): void {
    this.disposed = true
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
  }
}

export interface OnlineEvents extends SessionEvents {
  room(code: string, you: string, players: RoomPlayerView[], config: MatchConfig): void
  error(message: string): void
  restartVotes(requested: string[], needed: number, by: string | null): void
}

export class OnlineSession implements Session {
  readonly kind = 'online'
  state: GameState | null = null
  players: RoomPlayerView[] = []
  restartVotes: string[] = []
  private pending = false
  private pendingTimer: ReturnType<typeof setTimeout> | null = null
  private busyUntil = 0
  private readonly off: (() => void)[] = []

  constructor(
    readonly socket: DartsSocket,
    private readonly events: OnlineEvents,
  ) {
    this.off.push(
      socket.on('ROOM_STATE', (message) => {
        this.players = message.players
        if (message.state) {
          const restarted = !!this.state && message.state.version < this.state.version
          this.state = message.state
          this.pending = false
          if (restarted) {
            this.restartVotes = []
            this.events.restartVotes([], 0, null)
            this.events.turnSwitch(message.state, [])
          } else this.events.state(message.state)
        } else this.state = null
        this.events.room(message.code, message.you, message.players, message.config)
      }),
      socket.on('RESTART_VOTES', (message) => {
        this.restartVotes = message.requested
        this.events.restartVotes(message.requested, message.needed, message.by)
      }),
      socket.on('PLAYERS', (message) => {
        this.players = message.players
        this.events.room(socket.code, socket.you, message.players, this.state?.config ?? ({} as MatchConfig))
      }),
      socket.on('THROW_MADE', (message) => {
        this.pending = false
        this.state = message.state
        this.busyUntil = performance.now() + 200
        this.events.dart(message.playerId, message.dart, message.flight, message.state, message.announcements)
      }),
      socket.on('TURN_SWITCH', (message) => {
        this.pending = false
        this.state = message.state
        this.events.turnSwitch(message.state, message.announcements)
      }),
      socket.on('GAME_OVER', (message) => {
        this.pending = false
        this.state = message.state
        this.events.gameOver(message.state, message.announcements)
      }),
      socket.on('ERROR', (message) => {
        this.pending = false
        this.events.error(message.message)
      }),
    )
  }

  get host(): boolean {
    return this.players.some((player) => player.id === this.socket.you && player.host)
  }

  canThrow(): boolean {
    const state = this.state
    return !!state && state.status === 'playing' && state.currentTurnPlayerId === this.socket.you && !this.pending && performance.now() >= this.busyUntil
  }

  throw(intent: ThrowIntent): void {
    if (!this.canThrow() || !this.state) return
    this.pending = true
    this.socket.throwDart(intent, this.state.version)
    if (this.pendingTimer) clearTimeout(this.pendingTimer)
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      this.pending = false
    }, 4000)
  }

  start(): void {
    this.socket.startMatch()
  }

  rematch(): void {
    this.socket.rematch()
  }

  requestRestart(): void {
    this.socket.requestRestart()
  }

  dispose(): void {
    if (this.pendingTimer) clearTimeout(this.pendingTimer)
    this.pendingTimer = null
    for (const off of this.off) off()
    this.socket.leave()
  }
}
