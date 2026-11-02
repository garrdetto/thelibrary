import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { applyCommand, stepPark, createPark, deserializePark, serializePark, guestDetail, rideCommentsDetail, applyDynamic, decodeGuests, SIM_STEP } from '../../../server/park/index.mjs'
import type { ParkState, Command, CommandResult } from '../../../server/park/index.mjs'

export type Player = { id: string; name: string; park: number; host: boolean }
export type ChatLine = { id: number; from: string; text: string; system?: boolean }
export type RoomInfo = { id: string; name: string; mode: 'coop' | 'versus'; scenario: string; host: string; players: Player[]; started: boolean; max: number }
export type RideComment = { t: number; text: string; mood: 'pos' | 'mix' | 'neg'; who: string }
export type RideComments = { id: number; now: number; comments: RideComment[]; counts: { pos: number; mix: number; neg: number } }
export type GuestInfo = { id: number; park: number; happy: number; energy: number; hunger: number; thirst: number; toilet: number; nausea: number; cash: number; spent: number; rides: number; items: string[]; thoughts: string[]; state: string; kid: boolean; inPark: number; minI: number; maxI: number; tolerance: number; ride: number; type?: 'kid' | 'thrill' | 'casual'; warm?: number }

export interface ParkSession {
  state: ParkState
  park: number
  online: boolean
  isHost: boolean
  players: Player[]
  chat: ChatLine[]
  command(cmd: Command): Promise<CommandResult>
  guest(id: number): Promise<GuestInfo | null>
  rideComments(id: number): Promise<RideComments | null>
  tick(now: number): void
  exportSave(): Promise<unknown>
  sendChat(text: string): void
  subscribe(fn: () => void): () => void
  dispose(): void
  error?: string
}

abstract class BaseSession {
  listeners = new Set<() => void>()
  players: Player[] = []
  chat: ChatLine[] = []
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  emit() { for (const fn of this.listeners) fn() }
}

export class LocalSession extends BaseSession implements ParkSession {
  state: ParkState
  park = 0
  online = false
  isHost = true
  private last = 0
  private acc = 0
  private notifyAt = 0

  constructor(state: ParkState) { super(); this.state = state }

  static fresh(scenario: string) { return new LocalSession(createPark(scenario)) }
  static load(data: unknown) { return new LocalSession(deserializePark(data)) }

  async command(cmd: Command) {
    const result = applyCommand(this.state, cmd, this.park)
    this.emit()
    return result
  }

  async guest(id: number) { return guestDetail(this.state, id) as GuestInfo | null }

  async rideComments(id: number) { return rideCommentsDetail(this.state, id) as RideComments | null }

  tick(now: number) {
    const dt = this.last ? Math.min(0.25, (now - this.last) / 1000) : 0
    this.last = now
    this.acc += dt * this.state.speed
    let steps = 0
    while (this.acc >= SIM_STEP && steps < 12) { stepPark(this.state, SIM_STEP); this.acc -= SIM_STEP; steps++ }
    if (steps >= 12) this.acc = 0
    if (now - this.notifyAt > 250) { this.notifyAt = now; this.emit() }
  }

  async exportSave() { return serializePark(this.state) }
  sendChat() {}
  dispose() { this.listeners.clear() }
}

export class ViewSession extends LocalSession {
  owner: string
  savedAt: string
  constructor(state: ParkState, owner: string, savedAt: string) { super(state); this.owner = owner; this.savedAt = savedAt }
  async command(_cmd: Command): Promise<CommandResult> {
    return { ok: false, error: 'This park is view only.' }
  }
  tick(_now: number) {}
  async exportSave(): Promise<unknown> { throw new Error('This park is view only.') }
}

export const parkServerUrl = () => (import.meta.env.VITE_POOL_SERVER_URL || 'https://thelibrary-production.up.railway.app').replace(/\/$/, '')

export class Lobby {
  socket: Socket
  rooms: RoomInfo[] = []
  status: 'connecting' | 'connected' | 'closed' = 'connecting'
  error = ''
  listeners = new Set<() => void>()
  me = ''

  constructor(ticket: string) {
    this.socket = io(`${parkServerUrl()}/park`, { auth: { ticket }, reconnection: false, timeout: 10000, transports: ['websocket', 'polling'] })
    this.socket.on('connect', () => { this.status = 'connected'; this.me = this.socket.id ?? ''; this.emit() })
    this.socket.on('connect_error', (err: Error) => { this.status = 'closed'; this.error = err.message || 'Unable to reach the park server.'; this.emit() })
    this.socket.on('disconnect', () => { this.status = 'closed'; if (!this.error) this.error = 'Disconnected from the park server.'; this.emit() })
    this.socket.on('rooms', (rooms: RoomInfo[]) => { this.rooms = rooms; this.emit() })
  }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  emit() { for (const fn of this.listeners) fn() }

  request<T>(event: string, payload: unknown, timeout = 12000): Promise<T> {
    return new Promise((resolve, reject) => {
      this.socket.timeout(timeout).emit(event, payload, (err: Error | null, result: T & { error?: string }) => {
        if (err) reject(new Error('The park server did not respond. Try again.'))
        else if (result?.error) reject(new Error(result.error))
        else resolve(result)
      })
    })
  }

  close() { this.socket.disconnect(); this.listeners.clear() }
}

type InitPayload = { full: unknown; park: number; players: Player[]; host: boolean; chat: ChatLine[] }

export class NetSession extends BaseSession implements ParkSession {
  state: ParkState
  park: number
  online = true
  isHost: boolean
  lobby: Lobby
  error?: string
  private lastNews = 0
  private notifyAt = 0
  private resyncing = false

  constructor(lobby: Lobby, init: InitPayload) {
    super()
    this.lobby = lobby
    this.state = deserializePark(init.full)
    this.park = init.park
    this.players = init.players
    this.isHost = init.host
    this.chat = init.chat ?? []
    const s = lobby.socket
    s.on('init', (payload: InitPayload) => { this.state = deserializePark(payload.full); this.park = payload.park; this.players = payload.players; this.isHost = payload.host; this.resyncing = false; this.emit() })
    s.on('cmd', (msg: { cmd: Command; park: number; nextId: number; structVersion: number }) => this.applyRemote(msg))
    s.on('dyn', (dyn: { guests?: ArrayBuffer } & Record<string, unknown>) => {
      if (this.resyncing) return
      applyDynamic(this.state, dyn)
      if (dyn.guests) this.state.guests = decodeGuests(dyn.guests, this.state.guests)
      if ((dyn.nextId as number) !== this.state.nextId || (dyn.structVersion as number) !== this.state.structVersion) this.resync()
    })
    s.on('players', (players: Player[]) => { this.players = players; this.isHost = players.some(p => p.id === s.id && p.host); this.emit() })
    s.on('chat', (line: ChatLine) => { this.chat = [...this.chat.slice(-60), line]; this.emit() })
    s.on('room-closed', (message: string) => { this.error = message; this.emit() })
    s.on('disconnect', () => { this.error = 'You were disconnected from the multiplayer park.'; this.emit() })
  }

  private applyRemote(msg: { cmd: Command; park: number; nextId: number; structVersion: number }) {
    if (this.resyncing) return
    const p = this.state.parks[msg.park]
    if (!p) return this.resync()
    const cash = p.cash
    p.cash = 1e12
    const result = applyCommand(this.state, msg.cmd, msg.park)
    const spent = 1e12 - p.cash
    p.cash = cash - spent
    if (!result.ok || this.state.nextId !== msg.nextId || this.state.structVersion !== msg.structVersion) this.resync()
    this.emit()
  }

  private resync() {
    if (this.resyncing) return
    this.resyncing = true
    this.lobby.socket.emit('resync')
  }

  async command(cmd: Command): Promise<CommandResult> {
    try { return await this.lobby.request<CommandResult>('command', cmd, 8000) }
    catch (error) { return { ok: false, error: (error as Error).message } }
  }

  async guest(id: number) {
    try { return (await this.lobby.request<{ guest: GuestInfo | null }>('guest', { id }, 5000)).guest }
    catch { return null }
  }

  async rideComments(id: number) {
    try { return (await this.lobby.request<{ comments: RideComments | null }>('ride-comments', { id }, 5000)).comments }
    catch { return null }
  }

  tick(now: number) {
    if (now - this.notifyAt > 250) { this.notifyAt = now; this.emit() }
    void this.lastNews
  }

  async exportSave() { return (await this.lobby.request<{ data: unknown }>('export', {}, 20000)).data }
  sendChat(text: string) { this.lobby.socket.emit('chat', { text }) }
  dispose() { this.lobby.socket.emit('leave-room'); this.listeners.clear() }
}

export async function compressSave(data: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  const buffer = new Uint8Array(await new Response(stream).arrayBuffer())
  let binary = ''
  for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000))
  return btoa(binary)
}

export async function decompressSave(base64: string): Promise<unknown> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text())
}
