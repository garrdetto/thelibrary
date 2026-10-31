/** PeerJS room-code rooms: host with retry on taken ids, join, broadcast, guest rejoin, tl-host/tl-room hub bridge and ?room= auto-join. */
import Peer, { type DataConnection } from 'peerjs'
import type { NetConfig } from '../config'
import { HubBridge } from './HubBridge'
import type { RoomFormat } from './RoomFormats'

export type RoomStatus = 'idle' | 'opening' | 'open' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface PeerRoomHandlers<M> {
  message?(message: M, from: string): void
  join?(peerId: string): void
  leave?(peerId: string): void
  status?(status: RoomStatus, detail?: string): void
}

export class PeerRoom<M> {
  code = ''
  isHost = false
  status: RoomStatus = 'idle'
  private peer: Peer | null = null
  private hostConnection: DataConnection | null = null
  private readonly guests = new Map<string, DataConnection>()
  private rejoinTimer = 0
  private unbridge: (() => void) | null = null

  constructor(
    readonly format: RoomFormat,
    private readonly config: NetConfig,
    private readonly handlers: PeerRoomHandlers<M> = {},
  ) {}

  get open(): boolean {
    return this.status === 'open' || this.status === 'connected'
  }

  get peers(): string[] {
    return this.isHost ? [...this.guests.keys()] : this.hostConnection ? [this.hostConnection.peer] : []
  }

  newCode(): string {
    const { alphabet, length } = this.format
    return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  }

  normalize(raw: string): string {
    const allowed = new Set(this.format.alphabet)
    return [...raw.toUpperCase()].filter((character) => allowed.has(character)).join('').slice(0, this.format.length)
  }

  peerId(code: string): string {
    return this.format.prefix + (this.format.wireCase === 'lower' ? code.toLowerCase() : code.toUpperCase())
  }

  host(): Promise<string> {
    this.close()
    this.isHost = true
    return new Promise((resolve, reject) => {
      let attempts = 0
      const attempt = () => {
        attempts++
        this.code = this.newCode()
        this.setStatus('opening')
        const peer = new Peer(this.peerId(this.code), { debug: 0 })
        this.peer = peer
        peer.on('open', () => {
          this.setStatus('open')
          HubBridge.post({ type: 'tl-room', code: this.code })
          resolve(this.code)
        })
        peer.on('connection', (connection) => this.acceptGuest(connection))
        peer.on('error', (error) => {
          if (error.type === 'unavailable-id' && attempts < this.config.hostAttempts) {
            peer.destroy()
            attempt()
            return
          }
          this.setStatus('error', error.type)
          reject(error)
        })
      }
      attempt()
    })
  }

  join(rawCode: string): Promise<void> {
    this.close()
    this.isHost = false
    this.code = this.normalize(rawCode)
    if (this.code.length !== this.format.length) return Promise.reject(new Error(`Room codes are ${this.format.length} characters`))
    this.setStatus('connecting')
    const peer = new Peer({ debug: 0 })
    this.peer = peer
    return new Promise((resolve, reject) => {
      peer.on('open', () => {
        this.connectToHost()
        resolve()
      })
      peer.on('error', (error) => {
        this.setStatus('error', error.type)
        reject(error)
      })
    })
  }

  send(message: M): void {
    if (this.isHost) for (const connection of this.guests.values()) this.write(connection, message)
    else if (this.hostConnection) this.write(this.hostConnection, message)
  }

  sendTo(peerId: string, message: M): void {
    const connection = this.isHost ? this.guests.get(peerId) : this.hostConnection
    if (connection) this.write(connection, message)
  }

  bridgeHub(onHostRequest?: () => void | Promise<unknown>): void {
    this.unbridge?.()
    this.unbridge = HubBridge.on('tl-host', () => {
      if (this.isHost && this.open && this.code) {
        HubBridge.post({ type: 'tl-room', code: this.code })
        return
      }
      Promise.resolve(onHostRequest ? onHostRequest() : this.host()).catch(() => undefined)
    })
  }

  autoJoinFromQuery(): string | null {
    const raw = new URLSearchParams(location.search).get('room')
    if (!raw) return null
    const code = this.normalize(raw)
    if (code.length !== this.format.length) return null
    void this.join(code).catch(() => undefined)
    return code
  }

  close(): void {
    window.clearInterval(this.rejoinTimer)
    this.rejoinTimer = 0
    for (const connection of this.guests.values()) connection.close()
    this.guests.clear()
    this.hostConnection?.close()
    this.hostConnection = null
    this.peer?.destroy()
    this.peer = null
    if (this.status !== 'idle') this.setStatus('idle')
  }

  dispose(): void {
    this.unbridge?.()
    this.unbridge = null
    this.close()
  }

  private acceptGuest(connection: DataConnection): void {
    if (this.guests.size >= this.config.maxPeers) {
      connection.on('open', () => connection.close())
      return
    }
    connection.on('open', () => {
      this.guests.set(connection.peer, connection)
      this.handlers.join?.(connection.peer)
    })
    connection.on('data', (data) => this.handlers.message?.(data as M, connection.peer))
    connection.on('close', () => {
      if (this.guests.get(connection.peer) !== connection) return
      this.guests.delete(connection.peer)
      this.handlers.leave?.(connection.peer)
    })
  }

  private connectToHost(): void {
    if (!this.peer || this.peer.destroyed) return
    const connection = this.peer.connect(this.peerId(this.code), { reliable: true, serialization: 'json' })
    this.hostConnection = connection
    connection.on('open', () => {
      window.clearInterval(this.rejoinTimer)
      this.rejoinTimer = 0
      this.setStatus('connected')
      this.handlers.join?.(connection.peer)
    })
    connection.on('data', (data) => this.handlers.message?.(data as M, connection.peer))
    connection.on('close', () => {
      if (this.hostConnection !== connection) return
      this.setStatus('disconnected')
      this.handlers.leave?.(connection.peer)
      if (!this.rejoinTimer) this.rejoinTimer = window.setInterval(() => this.connectToHost(), this.config.rejoinSeconds * 1000)
    })
  }

  private write(connection: DataConnection, message: M): void {
    if (!connection.open) return
    try {
      connection.send(message)
    } catch {
      return
    }
  }

  private setStatus(status: RoomStatus, detail?: string): void {
    this.status = status
    this.handlers.status?.(status, detail)
  }
}
