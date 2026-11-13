import { z } from 'zod'
import type { Env } from './env.js'
import type { ClientMessage, GameState, MatchConfig, RoomPlayerView, ServerMessage } from '../../modules-src/darts/shared/interfaces'
import { launch, simulate } from '../../modules-src/darts/shared/Physics'
import { applyThrow, createMatch, DEFAULT_RULES, forfeitTurn, nextTurn, normalizeConfig, removePlayer } from '../../modules-src/darts/shared/Rules'
import { createRng } from '../../modules-src/darts/shared/Rng'
import { LEG_PAUSE_MS, RECONNECT_MS, ROOM_SEATS, TURN_PAUSE_MS, TURN_TIMEOUT_MS } from '../../modules-src/darts/shared/Room'
import { boardOf, countsForAverages, legJustEnded, legResults, matchAverages } from '../../modules-src/darts/shared/Records'
import { saveDartsAverage, saveDartsLeg } from './darts-records.js'
import { readDartsSettings } from './darts-settings.js'
import { applyMeterSettings, DEFAULT_SETTINGS } from '../../modules-src/darts/shared/Settings'
import type { MeterSettings } from '../../modules-src/darts/shared/Settings'

type ServerSocket = WebSocket & { accept(): void }

declare const WebSocketPair: { new (): { 0: WebSocket; 1: ServerSocket } }

export type DartsIdentity = { key: string; name: string; member: boolean }

interface Seat extends DartsIdentity {
  id: string
  socket: ServerSocket | null
  joined: boolean
  away: ReturnType<typeof setTimeout> | null
  tokens: number
  refilled: number
}

const finite = z.number().finite()
const configSchema = z.object({
  rules: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('x01'), start: z.union([z.literal(301), z.literal(501), z.literal(701)]), doubleIn: z.boolean(), doubleOut: z.boolean(), doubleBull: z.boolean().optional() }),
    z.object({ mode: z.literal('cricket'), scoring: z.boolean(), roundLimit: z.number().int().min(5).max(50) }),
    z.object({ mode: z.literal('countup'), rounds: z.number().int().min(1).max(20) }),
  ]),
  legsPerSet: z.number().int().min(1).max(11),
  setsToWin: z.number().int().min(1).max(7),
  board: z.enum(['steel', 'spider']).optional(),
})
const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ROOM_CREATE'), config: configSchema }),
  z.object({ type: z.literal('ROOM_JOIN') }),
  z.object({ type: z.literal('GAME_START') }),
  z.object({ type: z.literal('THROW_MADE'), version: z.number().int().min(0), intent: z.object({ aimX: finite, aimY: finite, speed: finite, yaw: finite, wobble: finite, cross: finite.optional() }) }),
  z.object({ type: z.literal('REMATCH') }),
  z.object({ type: z.literal('RESTART_REQUEST') }),
  z.object({ type: z.literal('PING'), at: finite }),
])
const identitySchema = z.object({ key: z.string().min(3).max(90), name: z.string().min(1).max(40), member: z.boolean() })

const RESTART_VOTE_MS = 30_000

function randomSeed(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0]
}

function seatId(): string {
  const bytes = new Uint8Array(5)
  crypto.getRandomValues(bytes)
  return `p${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function send(socket: ServerSocket | null, message: ServerMessage): void {
  if (!socket) return
  try { socket.send(JSON.stringify(message)) } catch { /* closed */ }
}

function identityFrom(request: Request): DartsIdentity | null {
  try {
    const parsed = identitySchema.safeParse(JSON.parse(request.headers.get('x-darts-identity') ?? ''))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * One Oche Darts online room. Up to four seats; the first seat hosts and picks the format with ROOM_CREATE, others take seats with ROOM_JOIN. The room is the authority: a THROW_MADE carries only the thrower's intent, the room rolls the release error from its own random source, flies the dart with the shared physics, scores it with the shared rules and broadcasts the dart, its flight and the new state. Turns change on the room's clock (TURN_SWITCH), a silent thrower loses the rest of the turn after TURN_TIMEOUT_MS, a dropped seat is held for RECONNECT_MS, and GAME_OVER ends the match. Signed-in players' finished legs go to the Darts record book and finished matches to their all-time averages (`darts-records.ts`), saved here so the page can't send them.
 */
export class DartsRoom {
  private code = ''
  private config: MatchConfig = { rules: DEFAULT_RULES.x01, legsPerSet: 1, setsToWin: 1 }
  private seats: Seat[] = []
  private state: GameState | null = null
  private turnTimer: ReturnType<typeof setTimeout> | null = null
  private pauseTimer: ReturnType<typeof setTimeout> | null = null
  private restartVotes = new Set<string>()
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  /** The admin's meter tuning, read when the room opens, so every throw here lands where the players' meters said. */
  private meter: MeterSettings = DEFAULT_SETTINGS.meter
  private meterLoaded = false

  constructor(_state: unknown, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/info') {
      return Response.json({ open: this.seats.length > 0, full: this.seats.length >= ROOM_SEATS, started: !!this.state && this.state.status !== 'finished' })
    }
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 426 })
    const identity = identityFrom(request)
    if (!identity) return new Response('Missing identity.', { status: 400 })
    const mode = url.searchParams.get('mode')
    const code = url.searchParams.get('code') ?? ''
    if (!this.meterLoaded || (mode === 'create' && !this.seats.length)) {
      this.meter = await readDartsSettings(this.env).then(({ settings }) => settings.meter, () => DEFAULT_SETTINGS.meter)
      this.meterLoaded = true
    }
    let seat = this.seats.find((item) => item.key === identity.key)
    if (!seat) {
      if (mode === 'create') {
        if (this.seats.length) return new Response('Room in use.', { status: 409 })
        this.reset(code)
      } else {
        if (!this.seats.length) return new Response('No room with that code.', { status: 404 })
        if (this.seats.length >= ROOM_SEATS) return new Response('That room is full.', { status: 409 })
        if (this.state && this.state.status !== 'finished') return new Response('That match has already started.', { status: 409 })
      }
      seat = { ...identity, id: seatId(), socket: null, joined: false, away: null, tokens: 20, refilled: Date.now() }
      this.seats.push(seat)
    }
    const pair = new WebSocketPair()
    const socket = pair[1]
    socket.accept()
    if (seat.socket) {
      try { seat.socket.close(4001, 'replaced') } catch { /* closed */ }
    }
    const current = seat
    current.socket = socket
    current.name = identity.name
    if (current.away) clearTimeout(current.away)
    current.away = null
    socket.addEventListener('message', (event) => this.onMessage(current, socket, event.data))
    const closed = () => {
      if (current.socket !== socket) return
      current.socket = null
      this.markConnection(current)
      this.holdSeat(current)
    }
    socket.addEventListener('close', closed)
    socket.addEventListener('error', closed)
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit & { webSocket: WebSocket })
  }

  private reset(code: string): void {
    this.code = code
    this.seats = []
    this.state = null
    this.config = { rules: DEFAULT_RULES.x01, legsPerSet: 1, setsToWin: 1 }
    this.clearTimers()
  }

  private players(): RoomPlayerView[] {
    return this.seats.filter((seat) => seat.joined).map((seat, index) => ({ id: seat.id, name: seat.name, seat: index, connected: !!seat.socket, member: seat.member, host: index === 0 }))
  }

  private roomState(seat: Seat): ServerMessage {
    return { type: 'ROOM_STATE', code: this.code, you: seat.id, players: this.players(), state: this.state, config: this.config }
  }

  private broadcast(message: ServerMessage): void {
    for (const seat of this.seats) if (seat.joined) send(seat.socket, message)
  }

  private allow(seat: Seat): boolean {
    const now = Date.now()
    seat.tokens = Math.min(20, seat.tokens + ((now - seat.refilled) / 1000) * 6)
    seat.refilled = now
    if (seat.tokens < 1) return false
    seat.tokens -= 1
    return true
  }

  private onMessage(seat: Seat, socket: ServerSocket, data: unknown): void {
    if (seat.socket !== socket || typeof data !== 'string' || data.length > 2000 || !this.allow(seat)) return
    let raw: unknown
    try { raw = JSON.parse(data) } catch { return }
    const parsed = clientMessage.safeParse(raw)
    if (!parsed.success) return
    const message = parsed.data as ClientMessage
    switch (message.type) {
      case 'PING':
        send(socket, { type: 'PONG', at: message.at })
        return
      case 'ROOM_CREATE':
        if (!seat.joined && this.seats[0] === seat) this.config = normalizeConfig(message.config)
        this.join(seat)
        return
      case 'ROOM_JOIN':
        this.join(seat)
        return
      case 'GAME_START':
        if (this.isHost(seat) && (!this.state || this.state.status === 'finished')) this.begin()
        return
      case 'REMATCH':
        if (this.isHost(seat) && this.state?.status === 'finished') this.begin()
        return
      case 'RESTART_REQUEST':
        this.requestRestart(seat)
        return
      case 'THROW_MADE':
        this.throwDart(seat, message.intent, message.version)
        return
    }
  }

  private restartVoters(): string[] {
    const state = this.state
    if (!state) return []
    return state.players.filter((player) => this.seats.some((seat) => seat.id === player.id && seat.joined && seat.socket)).map((player) => player.id)
  }

  private requestRestart(seat: Seat): void {
    const state = this.state
    if (!state || state.status === 'finished' || !state.players.some((player) => player.id === seat.id)) return
    this.restartVotes.add(seat.id)
    const voters = this.restartVoters()
    if (voters.length >= 2 && voters.every((id) => this.restartVotes.has(id))) {
      this.begin()
      return
    }
    this.broadcast({ type: 'RESTART_VOTES', requested: [...this.restartVotes], needed: voters.length, by: seat.id })
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.restartVotes.size) return
      this.restartVotes.clear()
      this.broadcast({ type: 'RESTART_VOTES', requested: [], needed: this.restartVoters().length, by: null })
    }, RESTART_VOTE_MS)
  }

  private isHost(seat: Seat): boolean {
    return this.seats.find((item) => item.joined) === seat
  }

  private join(seat: Seat): void {
    const fresh = !seat.joined
    seat.joined = true
    if (this.state) this.markConnection(seat)
    send(seat.socket, this.roomState(seat))
    if (fresh) this.broadcast({ type: 'PLAYERS', players: this.players() })
  }

  private markConnection(seat: Seat): void {
    if (this.state) {
      const player = this.state.players.find((item) => item.id === seat.id)
      if (player) player.connectionStatus = seat.socket ? 'connected' : 'away'
    }
    this.broadcast({ type: 'PLAYERS', players: this.players() })
  }

  private holdSeat(seat: Seat): void {
    if (seat.away) clearTimeout(seat.away)
    seat.away = setTimeout(() => {
      seat.away = null
      if (seat.socket || !this.seats.includes(seat)) return
      this.seats = this.seats.filter((item) => item !== seat)
      if (!this.seats.length) {
        this.reset('')
        return
      }
      if (this.state && this.state.status !== 'finished') {
        this.state = removePlayer(this.state, seat.id)
        if (this.state.status === 'finished' && this.state.winnerId) {
          this.clearTimers()
          this.broadcast({ type: 'GAME_OVER', winnerId: this.state.winnerId, state: this.state, announcements: [{ kind: 'matchWon', text: 'Opponent left: you win', playerId: this.state.winnerId }] })
        } else {
          this.broadcast({ type: 'TURN_SWITCH', state: this.state, announcements: [] })
          this.armTurnTimer()
        }
      }
      this.broadcast({ type: 'PLAYERS', players: this.players() })
    }, RECONNECT_MS)
  }

  private begin(): void {
    const ready = this.seats.filter((seat) => seat.joined && seat.socket)
    if (ready.length < 2) {
      for (const seat of ready) send(seat.socket, { type: 'ERROR', message: 'Wait for at least one more player.' })
      return
    }
    this.seats = this.seats.filter((seat) => !seat.joined || seat.socket)
    this.clearTimers()
    this.state = createMatch(this.code, this.config, ready.map((seat) => ({ id: seat.id, name: seat.name, connectionStatus: 'connected' })))
    for (const seat of this.seats) if (seat.joined) send(seat.socket, this.roomState(seat))
    this.armTurnTimer()
  }

  private throwDart(seat: Seat, intent: { aimX: number; aimY: number; speed: number; yaw: number; wobble: number; cross?: number }, version: number): void {
    const state = this.state
    if (!state || state.status !== 'playing' || state.currentTurnPlayerId !== seat.id || state.version !== version) return
    applyMeterSettings(this.meter)
    const flight = launch(intent, 'normal', createRng(randomSeed()))
    const impact = simulate(flight, undefined, undefined, boardOf(state.config))
    const result = applyThrow(state, seat.id, impact.dart)
    this.state = result.state
    if (result.turnOver) this.record(result.state)
    this.broadcast({ type: 'THROW_MADE', playerId: seat.id, dart: impact.dart, flight, state: result.state, announcements: result.announcements })
    const flightMs = Math.round(impact.seconds * 1000)
    if (result.state.status === 'finished') {
      this.clearTimers()
      const winnerId = result.state.winnerId ?? seat.id
      this.pauseTimer = setTimeout(() => {
        this.pauseTimer = null
        if (this.state) this.broadcast({ type: 'GAME_OVER', winnerId, state: this.state, announcements: [] })
      }, flightMs + 400)
      return
    }
    if (result.turnOver) {
      if (this.turnTimer) clearTimeout(this.turnTimer)
      this.turnTimer = null
      this.schedulePause(flightMs + (result.state.status === 'legOver' ? LEG_PAUSE_MS : TURN_PAUSE_MS))
      return
    }
    this.armTurnTimer()
  }

  /** Saves the record-book legs and, at the end of the match, the averages of every signed-in player in it. */
  private record(state: GameState): void {
    if (!legJustEnded(state)) return
    const board = boardOf(state.config)
    const member = (playerId: string) => {
      const seat = this.seats.find((item) => item.id === playerId)
      return seat?.member && seat.key.startsWith('member:') ? { id: seat.key.slice('member:'.length), username: seat.name } : null
    }
    const saves: Promise<unknown>[] = []
    for (const leg of legResults(state)) {
      const user = member(leg.playerId)
      if (user) saves.push(saveDartsLeg(this.env, user, board, leg.mode, leg.value, crypto.randomUUID()))
    }
    if (state.status === 'finished' && countsForAverages(state)) {
      for (const average of matchAverages(state)) {
        const user = member(average.playerId)
        if (user && average.darts > 0) saves.push(saveDartsAverage(this.env, user, board, average.mode, average.darts, average.total, crypto.randomUUID()))
      }
    }
    for (const save of saves) save.catch((error) => console.error('Darts: could not save a result', error))
  }

  private schedulePause(ms: number): void {
    if (this.pauseTimer) clearTimeout(this.pauseTimer)
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null
      if (!this.state) return
      const next = nextTurn(this.state)
      this.state = next.state
      this.broadcast({ type: 'TURN_SWITCH', state: next.state, announcements: next.announcements })
      this.armTurnTimer()
    }, ms)
  }

  private armTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer)
    this.turnTimer = null
    const state = this.state
    if (!state || state.status !== 'playing') return
    const playerId = state.currentTurnPlayerId
    const version = state.version
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null
      if (!this.state || this.state.status !== 'playing' || this.state.currentTurnPlayerId !== playerId || this.state.version !== version) return
      const result = forfeitTurn(this.state, playerId)
      this.state = result.state
      if (result.turnOver) this.record(result.state)
      const name = result.state.players.find((player) => player.id === playerId)?.name ?? 'Player'
      this.broadcast({ type: 'TURN_SWITCH', state: result.state, announcements: [{ kind: 'miss', text: `${name} ran out of time`, playerId }, ...result.announcements] })
      if (result.state.status === 'finished' && result.state.winnerId) {
        this.broadcast({ type: 'GAME_OVER', winnerId: result.state.winnerId, state: result.state, announcements: [] })
        return
      }
      this.schedulePause(TURN_PAUSE_MS)
    }, TURN_TIMEOUT_MS)
  }

  private clearTimers(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer)
    if (this.pauseTimer) clearTimeout(this.pauseTimer)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.turnTimer = null
    this.pauseTimer = null
    this.restartTimer = null
    this.restartVotes.clear()
  }
}

export function dartsRoomStub(env: Env, code: string) {
  if (!env.DARTS_ROOM) return null
  return env.DARTS_ROOM.get(env.DARTS_ROOM.idFromName(`room:${code}`))
}
