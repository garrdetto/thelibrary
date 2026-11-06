import { z } from 'zod'
import type { Env } from './env.js'
import { ratingOf, recordMatch } from './bushleague.js'
import type { ContestSetup } from '../../modules-src/bushleague/sim'
import type { Side } from '../../modules-src/bushleague/sim/types'
import { MatchCore, RATING_START, RECONNECT_SECONDS, digestOf, distinctTeam, isTeamId, onlineSetup, roomCode } from '../../modules-src/bushleague/shared/Online'
import type { InputRecord, MatchOptions, PlayerView, ServerMessage } from '../../modules-src/bushleague/shared/Online'

type ServerSocket = WebSocket & { accept(): void }

declare const WebSocketPair: { new (): { 0: WebSocket; 1: ServerSocket } }

export type MatchIdentity = { key: string; name: string; member: boolean; userId?: string }
export type MatchJoin = { mode: 'create' | 'join'; team: string; options: MatchOptions }

interface Seat extends MatchIdentity {
  side: Side
  team: string
  rating: number | null
  socket: ServerSocket | null
  tokens: number
  refilled: number
  away: ReturnType<typeof setTimeout> | null
}

interface Waiting extends MatchIdentity {
  team: string
  socket: ServerSocket
}

const RANKED_OPTIONS: MatchOptions = { innings: 3, dh: true, autoRunner: true, mercy: false }
const pitchTypes = ['FF', 'SI', 'FC', 'SL', 'SW', 'CU', 'CH', 'FS', 'KN'] as const
const whole = z.number().finite()
const clientMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('pre'), steal: z.array(z.number().int().min(1).max(2)).max(2) }),
  z.object({ t: z.literal('pitch'), intent: z.object({ type: z.enum(pitchTypes), targetX: whole, targetY: whole, effort: whole, accuracy: whole }) }),
  z.object({ t: z.literal('swing'), intent: z.object({ action: z.enum(['take', 'swing']), type: z.enum(['contact', 'power', 'bunt']), timing: whole, aimX: whole, aimY: whole }) }),
  z.object({ t: z.literal('rematch') }),
  z.object({ t: z.literal('concede') }),
])
const optionsSchema = z.object({ innings: z.union([z.literal(3), z.literal(6), z.literal(9)]), dh: z.boolean(), autoRunner: z.boolean(), mercy: z.boolean() })
const identitySchema = z.object({ key: z.string().min(3).max(90), name: z.string().min(1).max(40), member: z.boolean(), userId: z.string().max(80).optional() })
const joinSchema = z.object({ mode: z.enum(['create', 'join']), team: z.string().refine(isTeamId), options: optionsSchema })
const arrangeSchema = z.object({ code: z.string(), seats: z.array(identitySchema.extend({ team: z.string().refine(isTeamId), side: z.union([z.literal(0), z.literal(1)]) })).length(2) })

function header<T>(request: Request, name: string, schema: z.ZodType<T>): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(request.headers.get(name) ?? ''))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function randomUnit(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0] / 4294967296
}

function accept(): { client: WebSocket; socket: ServerSocket } {
  const pair = new WebSocketPair()
  pair[1].accept()
  return { client: pair[0], socket: pair[1] }
}

function upgraded(client: WebSocket): Response {
  return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket })
}

function send(socket: ServerSocket | null, message: ServerMessage): void {
  if (!socket) return
  try { socket.send(JSON.stringify(message)) } catch { /* closed */ }
}

/**
 * One Bush League online room, or (for the instance named `queue`) the ranked matchmaking line. A room seats two players, runs the authoritative MatchCore, relays each input record with a state digest, holds a disconnected player's seat for RECONNECT_SECONDS (their decisions wait, then the seat forfeits), and writes the result and Elo through D1 when the contest ends. Contest state lives only in memory; the stored record is the result.
 */
export class BushLeagueMatch {
  private code = ''
  private ranked = false
  private options: MatchOptions = RANKED_OPTIONS
  private seats: Seat[] = []
  private core: MatchCore | null = null
  private finished = false
  private matchId = ''
  private rematchVotes = new Set<Side>()
  private timer: ReturnType<typeof setInterval> | null = null
  private waiting: Waiting[] = []

  constructor(_state: unknown, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/arrange' && request.method === 'POST') return this.arrange(request)
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 426 })
    const identity = header(request, 'x-bl-identity', identitySchema)
    if (!identity) return new Response('Missing identity.', { status: 400 })
    if (path === '/queue') {
      const team = new URL(request.url).searchParams.get('team') ?? ''
      if (!identity.member || !isTeamId(team)) return new Response('Sign in to play ranked.', { status: 403 })
      return this.enqueue(identity, team)
    }
    const join = header(request, 'x-bl-join', joinSchema)
    const code = new URL(request.url).searchParams.get('code') ?? ''
    if (!join) return new Response('Missing join.', { status: 400 })
    return this.seat(identity, join, code)
  }

  private async enqueue(identity: MatchIdentity, team: string): Promise<Response> {
    const { client, socket } = accept()
    for (const entry of this.waiting.filter((item) => item.key === identity.key)) {
      send(entry.socket, { t: 'notice', text: 'You joined the line from another tab.' })
      try { entry.socket.close(4001, 'replaced') } catch { /* closed */ }
    }
    this.waiting = this.waiting.filter((item) => item.key !== identity.key)
    const rival = this.waiting.shift()
    const entry: Waiting = { ...identity, team, socket }
    if (rival) {
      const code = roomCode(randomUnit)
      const homeFirst = randomUnit() < 0.5
      const [home, away] = homeFirst ? [entry, rival] : [rival, entry]
      const seats = [
        { key: away.key, name: away.name, member: away.member, userId: away.userId, team: away.team, side: 0 },
        { key: home.key, name: home.name, member: home.member, userId: home.userId, team: home.team, side: 1 },
      ]
      const stub = this.env.BUSHLEAGUE_MATCH!.get(this.env.BUSHLEAGUE_MATCH!.idFromName(`room:${code}`))
      const arranged = await stub.fetch(new Request('https://bushleague-match/arrange', { method: 'POST', body: JSON.stringify({ code, seats }) }))
      if (arranged.ok) {
        for (const item of [entry, rival]) {
          send(item.socket, { t: 'matched', code })
          try { item.socket.close(1000, 'matched') } catch { /* closed */ }
        }
        return upgraded(client)
      }
      this.waiting.unshift(rival)
    }
    this.waiting.push(entry)
    send(socket, { t: 'queue', waiting: this.waiting.length })
    const leave = () => {
      this.waiting = this.waiting.filter((item) => item.socket !== socket)
    }
    socket.addEventListener('close', leave)
    socket.addEventListener('error', leave)
    return upgraded(client)
  }

  private async arrange(request: Request): Promise<Response> {
    const parsed = arrangeSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success || this.seats.length) return new Response('Room in use.', { status: 409 })
    this.code = parsed.data.code
    this.ranked = true
    this.options = RANKED_OPTIONS
    const ratings = await Promise.all(parsed.data.seats.map((seat) => (seat.userId ? ratingOf(this.env, seat.userId).catch(() => RATING_START) : Promise.resolve(null))))
    this.seats = parsed.data.seats.map((seat, index) => ({ ...seat, rating: ratings[index], socket: null, tokens: 20, refilled: Date.now(), away: null }))
    this.seats[1].team = distinctTeam(this.seats[1].team, this.seats[0].team)
    for (const seat of this.seats) this.holdSeat(seat)
    return Response.json({ ok: true })
  }

  private async seat(identity: MatchIdentity, join: MatchJoin, code: string): Promise<Response> {
    let seat = this.seats.find((item) => item.key === identity.key)
    if (!seat && join.mode === 'create') {
      if (this.seats.length) return new Response('Room in use.', { status: 409 })
      this.reset(code)
      this.options = join.options
      seat = this.newSeat(identity, 1, join.team, null)
    } else if (!seat) {
      if (!this.seats.length) return new Response('No room with that code.', { status: 404 })
      if (this.ranked || this.seats.length >= 2) return new Response('That room is full.', { status: 409 })
      seat = this.newSeat(identity, 0, distinctTeam(join.team, this.seats[0].team), null)
    }
    const { client, socket } = accept()
    if (seat.socket) {
      send(seat.socket, { t: 'notice', text: 'This matchup was opened in another tab.' })
      try { seat.socket.close(4001, 'replaced') } catch { /* closed */ }
    }
    const current = seat
    current.socket = socket
    current.name = identity.name
    if (current.away) clearTimeout(current.away)
    current.away = null
    this.core?.resume(current.side, Date.now())
    send(socket, { t: 'welcome', code: this.code, side: current.side, ranked: this.ranked, players: this.players(), setup: this.core?.setup ?? null, log: this.core ? [...this.core.contest.log] : [] })
    this.broadcast({ t: 'players', players: this.players() }, current)
    socket.addEventListener('message', (event) => {
      void this.onMessage(current, socket, event.data).catch(() => undefined)
    })
    const closed = () => {
      if (current.socket !== socket) return
      current.socket = null
      this.core?.pause(current.side)
      this.broadcast({ t: 'players', players: this.players() })
      this.holdSeat(current)
    }
    socket.addEventListener('close', closed)
    socket.addEventListener('error', closed)
    if (!this.core && this.seats.length === 2 && this.seats.every((item) => item.socket)) this.begin()
    return upgraded(client)
  }

  private reset(code: string): void {
    this.code = code
    this.ranked = false
    this.seats = []
    this.core = null
    this.finished = false
    this.rematchVotes.clear()
  }

  private newSeat(identity: MatchIdentity, side: Side, team: string, rating: number | null): Seat {
    const seat: Seat = { ...identity, side, team, rating, socket: null, tokens: 20, refilled: Date.now(), away: null }
    this.seats.push(seat)
    this.seats.sort((a, b) => a.side - b.side)
    return seat
  }

  /** A seat whose player is gone keeps its place for a while; then it forfeits a running contest, or frees the seat before first pitch. */
  private holdSeat(seat: Seat): void {
    if (seat.away) clearTimeout(seat.away)
    seat.away = setTimeout(() => {
      seat.away = null
      if (seat.socket || !this.seats.includes(seat)) return
      if (this.core && !this.finished) {
        void this.finish(seat.side === 0 ? 1 : 0, 'forfeit')
        return
      }
      if (!this.core || this.finished) {
        this.seats = this.seats.filter((item) => item !== seat)
        if (this.ranked || !this.seats.length) this.seats = []
        if (!this.seats.length) this.stopTimer()
        else this.broadcast({ t: 'players', players: this.players() })
      }
    }, RECONNECT_SECONDS * 1000)
  }

  private players(): PlayerView[] {
    return this.seats.map((seat) => ({ name: seat.name, side: seat.side, team: seat.team, connected: !!seat.socket, member: seat.member, rating: this.ranked ? seat.rating : null }))
  }

  private begin(): void {
    const seed = Math.floor(randomUnit() * 1_000_000_000)
    const setup: ContestSetup = onlineSetup(seed, this.seats[0].team, this.seats[1].team, this.options)
    this.seats[1].team = setup.home
    this.core = new MatchCore(setup, Date.now())
    this.finished = false
    this.rematchVotes.clear()
    this.matchId = `${this.code}:${seed}`
    this.broadcast({ t: 'start', setup, players: this.players() })
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000)
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    const core = this.core
    if (!core || this.finished) return
    const record = core.tick(Date.now())
    if (record) this.relay(record)
  }

  private relay(record: InputRecord): void {
    const core = this.core!
    this.broadcast({ t: 'rec', i: core.contest.log.length - 1, record, digest: digestOf(core.contest) })
    if (core.final && core.winner !== null) void this.finish(core.winner, 'final')
  }

  private allow(seat: Seat): boolean {
    const now = Date.now()
    seat.tokens = Math.min(20, seat.tokens + ((now - seat.refilled) / 1000) * 8)
    seat.refilled = now
    if (seat.tokens < 1) return false
    seat.tokens -= 1
    return true
  }

  private async onMessage(seat: Seat, socket: ServerSocket, data: unknown): Promise<void> {
    if (seat.socket !== socket || typeof data !== 'string' || data.length > 2000 || !this.allow(seat)) return
    let raw: unknown
    try { raw = JSON.parse(data) } catch { return }
    const parsed = clientMessage.safeParse(raw)
    if (!parsed.success) return
    const message = parsed.data
    if (message.t === 'concede') {
      if (this.core && !this.finished) await this.finish(seat.side === 0 ? 1 : 0, 'concede')
      return
    }
    if (message.t === 'rematch') {
      if (!this.finished || this.ranked) return
      this.rematchVotes.add(seat.side)
      this.broadcast({ t: 'rematch', sides: [...this.rematchVotes] })
      if (this.rematchVotes.size === 2 && this.seats.every((item) => item.socket)) this.begin()
      return
    }
    const core = this.core
    if (!core || this.finished) return
    const record = core.apply(seat.side, message, Date.now())
    if (record) this.relay(record)
  }

  private async finish(winner: Side, reason: 'final' | 'forfeit' | 'concede'): Promise<void> {
    if (this.finished || !this.core) return
    this.finished = true
    const contest = this.core.contest
    const score: [number, number] = [contest.score[0], contest.score[1]]
    let ratings: Awaited<ReturnType<typeof recordMatch>> = [null, null]
    try {
      ratings = await recordMatch(this.env, {
        id: this.matchId,
        seats: [{ userId: this.seats[0]?.userId, name: this.seats[0]?.name ?? '', team: contest.setup.away }, { userId: this.seats[1]?.userId, name: this.seats[1]?.name ?? '', team: contest.setup.home }],
        score,
        winner,
        reason,
        ranked: this.ranked,
        innings: contest.setup.innings,
      })
    } catch (error) {
      console.error('Bush League result not stored', error)
    }
    for (const seat of this.seats) {
      const change = ratings[seat.side]
      if (change) seat.rating = change.after
    }
    this.broadcast({ t: 'final', winner, reason, score, ratings })
  }

  private broadcast(message: ServerMessage, except?: Seat): void {
    for (const seat of this.seats) if (seat !== except) send(seat.socket, message)
  }
}

export function matchStub(env: Env, name: string) {
  if (!env.BUSHLEAGUE_MATCH) return null
  return env.BUSHLEAGUE_MATCH.get(env.BUSHLEAGUE_MATCH.idFromName(name))
}
