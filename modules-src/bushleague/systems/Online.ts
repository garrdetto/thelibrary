/** The page's end of an online matchup: one WebSocket to /api/bushleague, the authoritative input records in order, and quiet reconnection (a dropped page rejoins its seat with the room code and catches up from the full log). */
import type { Contest, ContestSetup } from '../sim'
import type { Side } from '../sim/types'
import { RECONNECT_SECONDS, digestOf, sameDigest, type ClientMessage, type InputRecord, type MatchMode, type MatchOptions, type PlayerView, type ServerMessage, type StateDigest } from '../shared/Online'

export type FinalMessage = Extract<ServerMessage, { t: 'final' }>

/** What the Director reads during an online contest: the server's records, and where to send this page's own decisions. */
export interface IntentFeed {
  readonly side: Side
  next<K extends InputRecord['kind']>(kind: K, index: number): Extract<InputRecord, { kind: K }> | null
  send(message: ClientMessage): void
  applied(index: number, contest: Contest): void
  waitingFor(): string
}

export interface OnlineEvents {
  lobby(title: string, text: string, players: PlayerView[], code: string | null): void
  start(setup: ContestSetup, link: OnlineLink, players: PlayerView[], resumed: boolean): void
  players(players: PlayerView[]): void
  final(message: FinalMessage, players: PlayerView[]): void
  rematch(sides: Side[]): void
  notice(text: string): void
  ended(text: string): void
}

export interface ConnectOptions {
  mode: MatchMode
  team: string
  code?: string
  options?: MatchOptions
}

function guestKey(): string {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (value) => value.toString(16).padStart(2, '0')).join('')
  try {
    const saved = localStorage.getItem('tl-bushleague-guest')
    if (saved && /^[a-f0-9]{24}$/.test(saved)) return saved
    const key = make()
    localStorage.setItem('tl-bushleague-guest', key)
    return key
  } catch {
    return make()
  }
}

export class OnlineLink implements IntentFeed {
  side: Side = 1
  code: string | null = null
  ranked = false
  setup: ContestSetup | null = null
  players: PlayerView[] = []
  finalMessage: FinalMessage | null = null
  private records: InputRecord[] = []
  private digests: StateDigest[] = []
  private socket: WebSocket | null = null
  private closedByUs = false
  private lostAt = 0
  private retryTimer = 0
  private desynced = false
  private readonly guest = guestKey()

  constructor(private readonly events: OnlineEvents, private readonly options: ConnectOptions) {}

  get active(): boolean {
    return !this.closedByUs
  }

  connect(): void {
    const params = new URLSearchParams({ mode: this.code ? 'join' : this.options.mode, team: this.options.team, guest: this.guest })
    if (this.code ?? this.options.code) params.set('code', (this.code ?? this.options.code)!)
    const options = this.options.options
    if (options) {
      params.set('innings', String(options.innings))
      params.set('dh', options.dh ? '1' : '0')
      params.set('runner', options.autoRunner ? '1' : '0')
      params.set('mercy', options.mercy ? '1' : '0')
    }
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/bushleague?${params}`
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch {
      this.lost()
      return
    }
    this.socket = socket
    let opened = false
    socket.addEventListener('open', () => {
      opened = true
      this.lostAt = 0
    })
    socket.addEventListener('message', (event) => this.receive(event.data))
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return
      this.socket = null
      if (this.closedByUs || event.reason === 'matched') return
      if (event.code === 4001) return this.stop('This matchup is open in another tab.')
      if (!opened && !this.setup && !this.code) return this.stop(this.options.mode === 'queue' ? 'Ranked matchups need you signed in to the library.' : this.options.mode === 'join' ? 'Could not join that room. Check the code with your opponent.' : 'Could not open a room right now.')
      this.lost()
    })
  }

  private lost(): void {
    if (this.closedByUs) return
    if (!this.setup && this.options.mode === 'queue' && !this.code) return this.stop('Lost the connection while finding an opponent.')
    if (!this.lostAt) this.lostAt = Date.now()
    if (Date.now() - this.lostAt > RECONNECT_SECONDS * 1000) return this.stop('The connection to the matchup was lost.')
    this.events.notice('Connection lost. Rejoining…')
    clearTimeout(this.retryTimer)
    this.retryTimer = window.setTimeout(() => this.connect(), 2000)
  }

  private stop(text: string): void {
    this.close()
    this.events.ended(text)
  }

  close(): void {
    this.closedByUs = true
    clearTimeout(this.retryTimer)
    try { this.socket?.close(1000, 'bye') } catch { /* closed */ }
    this.socket = null
  }

  /** Sends a decision; it is kept until its record comes back, so a page that drops and rejoins sends it again. */
  send(message: ClientMessage): void {
    if (message.t === 'pre' || message.t === 'pitch' || message.t === 'swing') this.pending = { message, index: this.records.length }
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private pending: { message: ClientMessage; index: number } | null = null

  next<K extends InputRecord['kind']>(kind: K, index: number): Extract<InputRecord, { kind: K }> | null {
    const record = this.records[index]
    return record && record.kind === kind ? (record as Extract<InputRecord, { kind: K }>) : null
  }

  /** After the page applies record `index`, its contest must match the server's: a mismatch means this browser's maths drifted, which the final result (from the server) will override. */
  applied(index: number, contest: Contest): void {
    const digest = this.digests[index]
    if (!digest || this.desynced || sameDigest(digest, digestOf(contest))) return
    this.desynced = true
    console.warn('Bush League: this page drifted from the server at record', index)
    this.events.notice('This screen fell out of step with the server; the official result comes from the server.')
  }

  waitingFor(): string {
    const other = this.players.find((player) => player.side !== this.side)
    if (other && !other.connected) return `${other.name} lost connection. Holding their seat…`
    return `Waiting for ${other?.name ?? 'your opponent'}…`
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') return
    let message: ServerMessage
    try {
      message = JSON.parse(data) as ServerMessage
    } catch {
      return
    }
    switch (message.t) {
      case 'queue':
        this.events.lobby('Finding an opponent', message.waiting > 1 ? `${message.waiting} in line.` : 'You are first in line. The first pitch comes as soon as someone else joins.', [], null)
        return
      case 'matched':
        this.code = message.code
        this.connect()
        return
      case 'welcome': {
        this.code = message.code
        this.side = message.side
        this.ranked = message.ranked
        this.players = message.players
        if (!message.setup) {
          this.events.lobby(this.ranked ? 'Opponent found' : `Room ${message.code}`, this.ranked ? 'Waiting for both players to take the field…' : 'Send this code to your opponent, or invite them from the chat. The first pitch comes when they join.', message.players, this.ranked ? null : message.code)
          return
        }
        const resumed = !!this.setup && this.setup.seed === message.setup.seed
        this.setup = message.setup
        this.records = [...message.log]
        this.digests = []
        if (!resumed) this.events.start(message.setup, this, message.players, false)
        else {
          this.events.players(message.players)
          if (this.pending?.index === this.records.length) this.send(this.pending.message)
        }
        return
      }
      case 'players':
        this.players = message.players
        this.events.players(message.players)
        return
      case 'start':
        this.setup = message.setup
        this.players = message.players
        this.pending = null
        this.records = []
        this.digests = []
        this.finalMessage = null
        this.desynced = false
        this.events.start(message.setup, this, message.players, false)
        return
      case 'rec':
        if (message.i < this.records.length) return
        if (message.i > this.records.length) {
          try { this.socket?.close(4000, 'resync') } catch { /* closed */ }
          return
        }
        this.records.push(message.record)
        this.digests[message.i] = message.digest
        if (this.pending && message.i >= this.pending.index) this.pending = null
        return
      case 'final':
        this.finalMessage = message
        this.events.final(message, this.players)
        return
      case 'rematch':
        this.events.rematch(message.sides)
        return
      case 'notice':
        this.events.notice(message.text)
        return
    }
  }
}

export async function onlineStatus(): Promise<{ signedIn: boolean; ratings: { username: string; rating: number; wins: number; losses: number }[]; mine: { rating: number; wins: number; losses: number } | null }> {
  const response = await fetch('/api/bushleague?board=ratings', { credentials: 'same-origin' })
  if (!response.ok) throw new Error('ratings unavailable')
  return response.json()
}
