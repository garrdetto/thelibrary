/** Client WebSocket manager for online rooms on `/api/darts` (the DartsRoom Durable Object). Opens the socket for ROOM_CREATE or ROOM_JOIN, sends THROW_MADE / GAME_START / REMATCH, hands every server event (ROOM_STATE, THROW_MADE, TURN_SWITCH, GAME_OVER, PLAYERS, ERROR) to typed listeners, keeps the line alive with pings and rejoins the same seat after a drop. */
import type { ClientMessage, MatchConfig, ServerMessage, ThrowIntent } from '../shared/interfaces'
import { isRoomCode } from '../shared/Room'

export type SocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

type AnyHandler = (message: ServerMessage) => void

const GUEST_KEY = 'tl-darts-guest'
const PING_MS = 20_000
const RETRY_MS = [1000, 2000, 4000, 8000, 15000]

function guestKey(): string {
  try {
    const saved = localStorage.getItem(GUEST_KEY)
    if (saved && /^[A-Za-z0-9]{12,64}$/.test(saved)) return saved
  } catch {
    /* storage unavailable */
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const key = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
  try {
    localStorage.setItem(GUEST_KEY, key)
  } catch {
    /* storage unavailable */
  }
  return key
}

export async function roomInfo(code: string): Promise<{ open: boolean; full: boolean; started: boolean } | null> {
  if (!isRoomCode(code)) return null
  try {
    const response = await fetch(`/api/darts?room=${code}`, { credentials: 'same-origin' })
    if (!response.ok) return null
    return (await response.json()) as { open: boolean; full: boolean; started: boolean }
  } catch {
    return null
  }
}

export class DartsSocket {
  status: SocketStatus = 'idle'
  code = ''
  you = ''
  private socket: WebSocket | null = null
  private handlers = new Map<ServerMessage['type'], Set<AnyHandler>>()
  private statusListeners = new Set<(status: SocketStatus) => void>()
  private ping: ReturnType<typeof setInterval> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private first: ClientMessage | null = null
  private closedByUs = false

  on<K extends ServerMessage['type']>(type: K, handler: (message: Extract<ServerMessage, { type: K }>) => void): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    const wrapped = handler as AnyHandler
    set.add(wrapped)
    return () => set.delete(wrapped)
  }

  onStatus(listener: (status: SocketStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  /** ROOM_CREATE: asks the server for a fresh room code and opens it with this match setup. */
  createRoom(config: MatchConfig): void {
    this.open('create', '', { type: 'ROOM_CREATE', config })
  }

  /** ROOM_JOIN: takes a seat in an existing room. */
  joinRoom(code: string): void {
    this.open('join', code.toUpperCase(), { type: 'ROOM_JOIN' })
  }

  startMatch(): void {
    this.send({ type: 'GAME_START' })
  }

  throwDart(intent: ThrowIntent, version: number): void {
    this.send({ type: 'THROW_MADE', intent, version })
  }

  rematch(): void {
    this.send({ type: 'REMATCH' })
  }

  /** RESTART_REQUEST: votes to restart the match in progress; the room restarts once every connected player has asked. */
  requestRestart(): void {
    this.send({ type: 'RESTART_REQUEST' })
  }

  leave(): void {
    this.closedByUs = true
    this.stopTimers()
    try { this.socket?.close(1000, 'left') } catch { /* closed */ }
    this.socket = null
    this.code = ''
    this.setStatus('closed')
  }

  private open(mode: 'create' | 'join', code: string, first: ClientMessage): void {
    this.leave()
    this.closedByUs = false
    this.first = first
    this.attempts = 0
    this.connect(mode, code)
  }

  private connect(mode: 'create' | 'join', code: string): void {
    this.setStatus(this.attempts ? 'reconnecting' : 'connecting')
    const params = new URLSearchParams({ mode, guest: guestKey() })
    if (code) params.set('code', code)
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/darts?${params}`
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch {
      this.emit({ type: 'ERROR', message: 'Online rooms are not available in this browser.' })
      this.setStatus('closed')
      return
    }
    this.socket = socket
    let opened = false
    socket.addEventListener('open', () => {
      opened = true
      this.attempts = 0
      this.setStatus('open')
      if (this.first) socket.send(JSON.stringify(this.first))
      this.stopTimers()
      this.ping = setInterval(() => this.send({ type: 'PING', at: Date.now() }), PING_MS)
    })
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      let message: ServerMessage
      try { message = JSON.parse(event.data) as ServerMessage } catch { return }
      if (message.type === 'ROOM_STATE') {
        this.code = message.code
        this.you = message.you
        this.first = { type: 'ROOM_JOIN' }
      }
      this.emit(message)
    })
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return
      this.socket = null
      this.stopTimers()
      if (this.closedByUs) return
      if (!opened && !this.code) {
        this.emit({ type: 'ERROR', message: mode === 'join' ? 'Could not join that room. Check the code, or the room may be full or already playing.' : 'Could not open a room right now. Please try again.' })
        this.setStatus('closed')
        return
      }
      if (event.code === 4001 || event.code === 4004 || this.attempts >= RETRY_MS.length) {
        if (event.code !== 4001) this.emit({ type: 'ERROR', message: 'The connection to the room was lost.' })
        this.setStatus('closed')
        return
      }
      const wait = RETRY_MS[this.attempts++]
      this.setStatus('reconnecting')
      this.retry = setTimeout(() => this.connect('join', this.code || code), wait)
    })
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private emit(message: ServerMessage): void {
    const set = this.handlers.get(message.type)
    if (set) for (const handler of set) handler(message)
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }

  private stopTimers(): void {
    if (this.ping) clearInterval(this.ping)
    if (this.retry) clearTimeout(this.retry)
    this.ping = null
    this.retry = null
  }
}
