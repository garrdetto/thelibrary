/** The page's line to a lot: a WebSocket to the lot's Durable Object, or the same Room running in the page for the practice lot. */
import { newLotState } from '../../shared/Lot'
import { defaultLook } from '../../shared/Look'
import { STATE_HZ, TICK_HZ, type Command, type ServerMessage } from '../../shared/Protocol'
import { Room } from '../../shared/Room'

export interface LotLink {
  send(command: Command): void
  close(): void
  onMessage: (message: ServerMessage) => void
  onClosed: (reason: string) => void
}

function guestKey(): string {
  const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), b => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('')
  try {
    const saved = localStorage.getItem('tl-hood-guest')
    if (saved && /^[A-Za-z0-9]{12,64}$/.test(saved)) return saved
    const key = fresh()
    localStorage.setItem('tl-hood-guest', key)
    return key
  } catch {
    return fresh()
  }
}

export class SocketLink implements LotLink {
  onMessage: (message: ServerMessage) => void = () => undefined
  onClosed: (reason: string) => void = () => undefined
  private socket: WebSocket
  private closedByUs = false
  private said = ''

  constructor(street: number, lot: number, options: { signedIn: boolean; sim?: string }) {
    const params = new URLSearchParams({ street: String(street), lot: String(lot) })
    if (options.sim) params.set('sim', options.sim)
    if (!options.signedIn) params.set('guest', guestKey())
    this.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/hood?${params}`)
    this.socket.addEventListener('message', event => {
      let message: ServerMessage
      try { message = JSON.parse(String(event.data)) as ServerMessage } catch { return }
      if (message.t === 'bye') this.said = message.text
      this.onMessage(message)
    })
    this.socket.addEventListener('close', () => {
      if (!this.closedByUs) this.onClosed(this.said || 'The connection to the lot dropped.')
    })
  }

  send(command: Command): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(command))
  }

  close(): void {
    this.closedByUs = true
    try { this.socket.close(1000, 'leaving') } catch { /* already closed */ }
  }
}

/** The practice lot: a starter house with two residents, run entirely in the page and never saved. */
export class LocalLink implements LotLink {
  onMessage: (message: ServerMessage) => void = () => undefined
  onClosed: (reason: string) => void = () => undefined
  private readonly room: Room
  private readonly memberId: string
  private timer = 0
  private ticks = 0

  constructor() {
    const state = newLotState(0, 0, 'local', 'You', 'The Practice House', [
      { name: 'Robin', look: { ...defaultLook(), hair: 3, hairStyle: 'long', top: 2, bottom: 5, skin: 2, body: 'feminine' } },
      { name: 'Sam', look: { ...defaultLook(), hair: 0, hairStyle: 'short', top: 3, bottom: 5, skin: 4, build: 'broad' } },
    ])
    this.room = new Room(state, {}, 'member:local', 42)
    const joined = this.room.join({ key: 'member:local', name: 'You', send: m => queueMicrotask(() => this.onMessage(m)), close: () => undefined })
    this.memberId = 'id' in joined ? joined.id : ''
    let last = performance.now()
    this.timer = window.setInterval(() => {
      const now = performance.now()
      this.room.tick(Math.min(0.5, (now - last) / 1000))
      last = now
      if (++this.ticks % Math.round(TICK_HZ / STATE_HZ) === 0) this.room.broadcastState()
    }, 1000 / TICK_HZ)
  }

  send(command: Command): void {
    this.room.command(this.memberId, JSON.parse(JSON.stringify(command)) as Command)
  }

  close(): void {
    clearInterval(this.timer)
  }
}
