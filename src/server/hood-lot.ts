import { z } from 'zod'
import type { Env } from './env.js'
import { addTownRequest, loadLot, saveLot, townRequests } from './hood.js'
import { Room } from '../../modules-src/hood/shared/Room'
import type { LotState, SimRecord } from '../../modules-src/hood/shared/Lot'
import { sanitizeLook } from '../../modules-src/hood/shared/Look'
import { sanitizeNeeds } from '../../modules-src/hood/shared/Needs'
import { STATE_HZ, TICK_HZ, type Command } from '../../modules-src/hood/shared/Protocol'
import { isLotIndex, isStreetIndex } from '../../modules-src/hood/shared/Street'
import { FEATURE_KINDS } from '../../modules-src/hood/shared/Style'
import { JOB_IDS, SERVICE_KINDS } from '../../modules-src/hood/shared/Jobs'

type DurableState = { blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> }
type ServerSocket = WebSocket & { accept(): void }

declare const WebSocketPair: { new (): { 0: WebSocket; 1: ServerSocket } }

export interface HoodIdentity {
  key: string
  name: string
  street: number
  lot: number
  sim?: string
  home?: { street: number; lot: number } | null
}

const int = z.number().int()
const coord = int.min(0).max(24)
const simId = z.string().min(1).max(16)
const peer = z.string().regex(/^[A-Z0-9]{5}$/)
const buildOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('wall'), x0: coord, z0: coord, x1: coord, z1: coord }),
  z.object({ op: z.literal('room'), x0: coord, z0: coord, x1: coord, z1: coord, floor: int.min(0).max(16) }),
  z.object({ op: z.literal('unwall'), x0: coord, z0: coord, x1: coord, z1: coord }),
  z.object({ op: z.literal('door'), x: coord, z: coord, v: z.union([z.literal(0), z.literal(1)]) }),
  z.object({ op: z.literal('window'), x: coord, z: coord, v: z.union([z.literal(0), z.literal(1)]) }),
  z.object({ op: z.literal('unopen'), x: coord, z: coord, v: z.union([z.literal(0), z.literal(1)]) }),
  z.object({ op: z.literal('floor'), x0: coord, z0: coord, x1: coord, z1: coord, floor: int.min(-1).max(16) }),
  z.object({ op: z.literal('buy'), def: z.string().max(32), x: coord, z: coord, r: int.min(0).max(3) }),
  z.object({ op: z.literal('move'), id: int.min(1), x: coord, z: coord, r: int.min(0).max(3) }),
  z.object({ op: z.literal('sell'), id: int.min(1) }),
  z.object({ op: z.literal('style'), patch: z.record(z.string().max(20), z.union([z.string().max(20), z.number(), z.boolean()])) }),
  z.object({ op: z.literal('feature'), kind: z.enum(FEATURE_KINDS), x: coord, z: coord, v: z.union([z.literal(0), z.literal(1)]).optional(), x2: coord.optional(), z2: coord.optional(), style: z.string().max(20), color: int.min(0).max(64), width: int.min(1).max(3).optional() }),
  z.object({ op: z.literal('unfeature'), id: int.min(1) }),
])
const command = z.discriminatedUnion('t', [
  z.object({ t: z.literal('go'), sim: simId, x: coord, z: coord }),
  z.object({ t: z.literal('use'), sim: simId, obj: int.min(1), act: z.string().max(16) }),
  z.object({ t: z.literal('chat'), sim: simId, target: simId }),
  z.object({ t: z.literal('cancel'), sim: simId }),
  z.object({ t: z.literal('knock'), sim: simId }),
  z.object({ t: z.literal('answer'), id: peer, allow: z.boolean(), always: z.boolean().optional() }),
  z.object({ t: z.literal('askLeave'), id: peer }),
  z.object({ t: z.literal('sendHome'), id: peer, block: z.boolean().optional() }),
  z.object({ t: z.literal('forget'), list: z.enum(['alwaysLetIn', 'blocked']), index: int.min(0).max(64) }),
  z.object({ t: z.literal('speed'), speed: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ t: z.literal('build'), op: buildOp }),
  z.object({ t: z.literal('settings'), yardOpen: z.boolean().optional(), guestsUseFridgeBeds: z.boolean().optional() }),
  z.object({ t: z.literal('job'), sim: simId, job: z.enum(JOB_IDS).nullable() }),
  z.object({ t: z.literal('work'), sim: simId }),
  z.object({ t: z.literal('task'), sim: simId, task: z.string().min(1).max(80) }),
  z.object({ t: z.literal('clockOut'), sim: simId }),
  z.object({ t: z.literal('order'), kind: z.enum(SERVICE_KINDS), sim: simId.optional() }),
])
const homecoming = z.object({ simId, needs: z.record(z.string(), z.number()), minutes: z.number().min(0).max(100_000) })

function parseIdentity(header: string | null): HoodIdentity | null {
  try {
    const v = JSON.parse(header ?? '') as HoodIdentity
    if (typeof v.key !== 'string' || typeof v.name !== 'string' || !isStreetIndex(v.street) || !isLotIndex(v.lot)) return null
    const home = v.home && isStreetIndex(v.home.street) && isLotIndex(v.home.lot) ? { street: v.home.street, lot: v.home.lot } : null
    return { key: v.key, name: v.name.slice(0, 40), street: v.street, lot: v.lot, sim: typeof v.sim === 'string' ? v.sim.slice(0, 12) : undefined, home }
  } catch {
    return null
  }
}

export function hoodLotStub(env: Env, street: number, lot: number) {
  if (!env.HOOD_LOT) return null
  return env.HOOD_LOT.get(env.HOOD_LOT.idFromName(`${street}:${lot}`))
}

interface Connection {
  socket: ServerSocket
  identity: HoodIdentity
  tokens: number
  refilled: number
}

/**
 * One lot on the street. It loads the lot from D1 when someone arrives, runs the shared Room as the authority for everyone there,
 * and saves back to D1. Visiting Sims are borrowed from their home lot's object and handed back when they leave.
 */
export class HoodLot {
  private room: Room | null = null
  private state: LotState | null = null
  private loading: Promise<Room | null> | null = null
  private readonly connections = new Map<string, Connection>()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastTick = 0
  private ticks = 0
  private dirty = false
  private lastSave = 0
  private saving: Promise<void> | null = null
  private lastRequests = 0

  constructor(_state: DurableState, private readonly env: Env) {}

  private async open(street: number, lot: number): Promise<Room | null> {
    if (this.room && this.state && this.state.street === street && this.state.lot === lot) return this.room
    this.loading ??= (async () => {
      const state = await loadLot(this.env, street, lot)
      if (!state) return null
      this.state = state
      this.room = new Room(state, {
        dirty: () => { this.dirty = true },
        presence: () => { this.dirty = true; void this.save(true) },
        visitorLeft: (key, sim, minutes) => { void this.sendHome(key, sim, minutes) },
        requested: request => { void addTownRequest(this.env, street, request).catch(() => undefined) },
        important: () => { this.dirty = true; void this.save(true) },
      }, undefined, (street * 31 + lot + 1) * 7919)
      await this.refreshRequests()
      return this.room
    })().finally(() => { this.loading = null })
    return this.loading
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const street = Number(url.searchParams.get('street'))
    const lot = Number(url.searchParams.get('lot'))
    if (url.pathname === '/depart' || url.pathname === '/return') {
      if (!isStreetIndex(street) || !isLotIndex(lot)) return Response.json({ error: 'bad lot' }, { status: 400 })
      const room = await this.open(street, lot)
      if (!room) return Response.json({ sim: null })
      const body = await request.json().catch(() => null)
      if (url.pathname === '/depart') {
        const sim = room.depart(typeof (body as { simId?: unknown })?.simId === 'string' ? (body as { simId: string }).simId : undefined)
        await this.save(true)
        return Response.json({ sim })
      }
      const parsed = homecoming.safeParse(body)
      if (!parsed.success) return Response.json({ ok: false }, { status: 400 })
      const ok = room.homecoming(parsed.data.simId, sanitizeNeeds(parsed.data.needs), parsed.data.minutes)
      await this.save(true)
      return Response.json({ ok })
    }

    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 426 })
    const identity = parseIdentity(request.headers.get('x-hood-identity'))
    if (!identity) return new Response('Missing identity.', { status: 400 })
    const room = await this.open(identity.street, identity.lot)
    if (!room || !this.state) return new Response('That lot is for sale.', { status: 404 })

    let visiting: SimRecord | null = null
    const isOwner = identity.key === `member:${this.state.ownerId}`
    if (!isOwner && identity.home && (identity.home.street !== identity.street || identity.home.lot !== identity.lot)) visiting = await this.borrow(identity)

    const pair = new WebSocketPair()
    const client = pair[0]
    const socket = pair[1]
    socket.accept()
    const send = (message: unknown) => { try { socket.send(JSON.stringify(message)) } catch { /* closed */ } }
    const close = () => { try { socket.close(1000, 'bye') } catch { /* closed */ } }
    const joined = room.join({ key: identity.key, name: identity.name, sim: visiting, send, close })
    if ('error' in joined) {
      if (visiting) void this.sendHome(identity.key, visiting, 0, identity)
      send({ t: 'bye', text: joined.error })
      close()
      return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket })
    }
    const connection: Connection = { socket, identity, tokens: 40, refilled: Date.now() }
    this.connections.set(joined.id, connection)
    this.ensureTimer()

    socket.addEventListener('message', event => this.onMessage(joined.id, connection, event.data))
    const closed = () => {
      if (this.connections.get(joined.id) !== connection) return
      this.connections.delete(joined.id)
      room.leave(joined.id)
      if (!this.connections.size) this.stopTimer()
      void this.save(true)
    }
    socket.addEventListener('close', closed)
    socket.addEventListener('error', closed)
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket })
  }

  private homes = new Map<string, { street: number; lot: number }>()

  private async borrow(identity: HoodIdentity): Promise<SimRecord | null> {
    const home = identity.home
    if (!home) return null
    const stub = hoodLotStub(this.env, home.street, home.lot)
    if (!stub) return null
    try {
      const response = await stub.fetch(new Request(`https://hood-lot/depart?street=${home.street}&lot=${home.lot}`, { method: 'POST', body: JSON.stringify({ simId: identity.sim }) }))
      const body = await response.json() as { sim?: SimRecord | null }
      if (!body.sim) return null
      this.homes.set(identity.key, home)
      return { ...body.sim, look: sanitizeLook(body.sim.look), needs: sanitizeNeeds(body.sim.needs) }
    } catch {
      return null
    }
  }

  private async sendHome(key: string, sim: SimRecord, minutes: number, identity?: HoodIdentity): Promise<void> {
    const home = identity?.home ?? this.homes.get(key)
    this.homes.delete(key)
    if (!home || sim.id === 'guest') return
    const stub = hoodLotStub(this.env, home.street, home.lot)
    if (!stub) return
    try {
      await stub.fetch(new Request(`https://hood-lot/return?street=${home.street}&lot=${home.lot}`, { method: 'POST', body: JSON.stringify({ simId: sim.id, needs: sim.needs, minutes }) }))
    } catch { /* the home lot hands the Sim back when its owner next comes home */ }
  }

  private onMessage(id: string, connection: Connection, data: unknown): void {
    if (typeof data !== 'string' || data.length > 2000 || !this.room) return
    const now = Date.now()
    connection.tokens = Math.min(40, connection.tokens + ((now - connection.refilled) / 1000) * 12)
    connection.refilled = now
    if (connection.tokens < 1) return
    connection.tokens -= 1
    let raw: unknown
    try { raw = JSON.parse(data) } catch { return }
    const parsed = command.safeParse(raw)
    if (!parsed.success) return
    this.room.command(id, parsed.data as Command)
  }

  private async refreshRequests(): Promise<void> {
    if (!this.room || !this.state) return
    this.lastRequests = Date.now()
    try {
      const list = await townRequests(this.env, this.state.street)
      const mine = this.room.requests.filter(r => !list.some(o => o.at === r.at && o.lot === r.lot && o.kind === r.kind))
      this.room.setRequests([...list, ...mine])
    } catch { /* the town view catches up on the next refresh */ }
  }

  private ensureTimer(): void {
    if (this.timer) return
    this.lastTick = Date.now()
    this.timer = setInterval(() => this.step(), 1000 / TICK_HZ)
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private step(): void {
    const room = this.room
    if (!room) return
    const now = Date.now()
    const seconds = Math.min(0.5, (now - this.lastTick) / 1000)
    this.lastTick = now
    room.tick(seconds)
    if (++this.ticks % Math.round(TICK_HZ / STATE_HZ) === 0) room.broadcastState()
    if (room.ownerHome) this.dirty = true
    if (this.dirty && now - this.lastSave > 30_000) void this.save(false)
    if (now - this.lastRequests > 20_000) void this.refreshRequests()
  }

  private async save(force: boolean): Promise<void> {
    if (!this.state || !this.room) return
    if (!force && !this.dirty) return
    if (this.saving) { await this.saving; if (!this.dirty) return }
    this.dirty = false
    this.lastSave = Date.now()
    const room = this.room
    this.saving = saveLot(this.env, this.state, room.ownerHome, room.visitorCount())
      .catch(() => { this.dirty = true })
      .finally(() => { this.saving = null })
    await this.saving
  }
}
