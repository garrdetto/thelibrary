import { z } from 'zod'
import type { Env } from './env.js'
import { loadProfile } from './angler.js'
import { LAKES, isLakeId, landingOf } from '../../modules-src/angler/shared/Lakes'
import type { LakeId } from '../../modules-src/angler/shared/Lakes'
import { boatKinds } from '../../modules-src/angler/shared/Boats'
import { isSpeciesId } from '../../modules-src/angler/shared/Species'
import { defaultProfile, lakeOpen } from '../../modules-src/angler/shared/Profile'
import type { AnglerProfile } from '../../modules-src/angler/shared/Profile'
import { equip } from '../../modules-src/angler/shared/Shop'
import { BOATS_PER_INSTANCE, CREW_SIZE, INSTANCE_CAPACITY, PHASES, POSITION_HZ, freeSeat, instanceName, peerCode } from '../../modules-src/angler/shared/Online'
import type { Gear, PeerView, Position, ServerMessage } from '../../modules-src/angler/shared/Online'

type DurableState = { blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> }
type ServerSocket = WebSocket & { accept(): void }

declare const WebSocketPair: { new (): { 0: WebSocket; 1: ServerSocket } }

export type LakeIdentity = { key: string; name: string; member: boolean; userId?: string; lake: LakeId; instance: number; crew: boolean }

interface Peer extends PeerView {
  key: string
  userId?: string
  socket: ServerSocket
  tokens: number
  refilled: number
  gearAt: number
  dirty: boolean
}

const finite = z.number().finite()
const peerId = z.string().regex(/^[A-Z0-9]{4}$/)
const fishSchema = z.object({ species: z.string().max(20).refine(isSpeciesId), length: z.number().min(1).max(130) })
const clientMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('gear'), gear: z.object({ boat: z.enum(boatKinds), paint: z.unknown(), look: z.unknown() }).optional() }),
  z.object({ t: z.literal('p'), d: z.tuple([finite.min(-4000).max(4000), finite.min(-4000).max(4000), finite.min(-100).max(100), finite.min(-40).max(40), z.number().int().min(0).max(1)]) }),
  z.object({ t: z.literal('f'), phase: z.enum(PHASES), fish: fishSchema.optional() }),
  z.object({ t: z.literal('board'), boat: peerId }),
  z.object({ t: z.literal('leave') }),
  z.object({ t: z.literal('lock'), locked: z.boolean() }),
  z.object({ t: z.literal('kick'), id: peerId }),
])

const catchSchema = z.object({ key: z.string().max(80), species: z.string().max(20).refine(isSpeciesId), weight: z.number().min(0).max(1000), length: z.number().min(0).max(200), tier: z.string().max(20), delay: z.number().int().min(0).max(120_000).optional() })

function gearOf(profile: AnglerProfile): Gear {
  return { boat: profile.boat, paint: profile.paint[profile.boat], look: profile.look }
}

/** Guests own only the starter gear, so whatever they send is checked against a fresh profile. */
function guestGear(input: { boat: string; paint: unknown; look: unknown } | undefined): Gear {
  const profile = defaultProfile()
  if (input) {
    equip(profile, { boat: input.boat })
    equip(profile, { paint: { kind: profile.boat, paint: input.paint } })
    equip(profile, { look: input.look })
  }
  return gearOf(profile)
}

function parseIdentity(header: string | null): LakeIdentity | null {
  try {
    const v = JSON.parse(header ?? '') as LakeIdentity
    if (typeof v.key !== 'string' || typeof v.name !== 'string' || !isLakeId(v.lake) || !Number.isInteger(v.instance)) return null
    return { key: v.key, name: v.name, member: Boolean(v.member), userId: typeof v.userId === 'string' ? v.userId : undefined, lake: v.lake, instance: v.instance, crew: Boolean(v.crew) }
  } catch {
    return null
  }
}

function view(p: Peer): PeerView {
  return { id: p.id, name: p.name, member: p.member, gear: p.gear, pos: p.pos, phase: p.phase, ...(p.fish ? { fish: p.fish } : {}), boat: p.boat, seat: p.seat, locked: p.locked }
}

/** One instance of a lake: up to 16 boats (40 connections with invited crew), positions relayed four times a second, crews of up to four on one boat, and lake-wide catch news pushed by /api/angler. Nothing here is stored: catches, credits and records stay with the REST API. */
export class AnglerLake {
  private readonly peers = new Map<string, Peer>()
  private readonly byKey = new Map<string, string>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(_state: DurableState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/status') return Response.json(this.status())
    if (path === '/catch' && request.method === 'POST') {
      const parsed = catchSchema.safeParse(await request.json().catch(() => null))
      if (parsed.success) {
        const c = parsed.data
        const peer = this.peerByKey(c.key)
        if (peer) setTimeout(() => {
          if (this.peers.get(peer.id) === peer) this.broadcast({ t: 'catch', id: peer.id, name: peer.name, species: c.species, weight: c.weight, length: c.length, tier: c.tier })
        }, c.delay ?? 0)
      }
      return Response.json({ ok: true })
    }
    if (path === '/crew' && request.method === 'POST') {
      const body = await request.json().catch(() => null) as { key?: unknown } | null
      const peer = typeof body?.key === 'string' ? this.peerByKey(body.key) : undefined
      return Response.json({ crew: peer ? this.crewOf(peer.boat).length : 0 })
    }
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 426 })
    const identity = parseIdentity(request.headers.get('x-angler-identity'))
    if (!identity) return new Response('Missing identity.', { status: 400 })

    const existing = this.peerByKey(identity.key)
    const boats = [...this.peers.values()].filter(p => p.boat === p.id && p !== existing).length
    const total = this.peers.size - (existing ? 1 : 0)
    if (total >= INSTANCE_CAPACITY || (!identity.crew && boats >= BOATS_PER_INSTANCE)) return new Response('This lake is full.', { status: 409 })

    let gear: Gear = guestGear(undefined)
    if (identity.member && identity.userId) {
      const profile = await loadProfile(this.env, identity.userId, identity.name)
      if (!lakeOpen(profile, identity.lake)) return new Response('Lake not open yet.', { status: 403 })
      gear = gearOf(profile)
    }
    if (existing) {
      this.send(existing, { t: 'notice', text: 'The lake was opened in another tab, so this one went ashore.' })
      try { existing.socket.close(4001, 'replaced') } catch { /* already closed */ }
      this.remove(existing)
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const socket = pair[1]
    socket.accept()
    const landing = landingOf(LAKES[identity.lake])
    let id = peerCode(Math.random)
    while (this.peers.has(id)) id = peerCode(Math.random)
    const peer: Peer = {
      id, name: identity.name, member: identity.member, gear, pos: [landing.x, landing.z, landing.heading, 0, 0], phase: 'off', boat: id, seat: 0, locked: false,
      key: identity.key, userId: identity.userId, socket, tokens: 60, refilled: Date.now(), gearAt: 0, dirty: true,
    }
    this.peers.set(id, peer)
    this.byKey.set(identity.key, id)
    this.send(peer, { t: 'welcome', id, lake: identity.lake, instance: identity.instance, peers: [...this.peers.values()].filter(p => p !== peer).map(view) })
    this.broadcast({ t: 'join', peer: view(peer) }, peer)
    this.ensureTimer()

    socket.addEventListener('message', event => {
      void this.onMessage(peer, event.data).catch(() => undefined)
    })
    const closed = () => {
      if (this.peers.get(peer.id) === peer) this.remove(peer)
      try { socket.close(1000, 'bye') } catch { /* already closed */ }
    }
    socket.addEventListener('close', closed)
    socket.addEventListener('error', closed)
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket })
  }

  private status() {
    const all = [...this.peers.values()]
    return { boats: all.filter(p => p.boat === p.id).length, anglers: all.length }
  }

  private peerByKey(key: string): Peer | undefined {
    const id = this.byKey.get(key)
    return id ? this.peers.get(id) : undefined
  }

  /** Everyone on a captain's boat, the captain first. */
  private crewOf(boat: string): Peer[] {
    return [...this.peers.values()].filter(p => p.boat === boat).sort((a, b) => a.seat - b.seat)
  }

  private allow(peer: Peer): boolean {
    const now = Date.now()
    peer.tokens = Math.min(60, peer.tokens + ((now - peer.refilled) / 1000) * 30)
    peer.refilled = now
    if (peer.tokens < 1) return false
    peer.tokens -= 1
    return true
  }

  private async onMessage(peer: Peer, data: unknown): Promise<void> {
    if (typeof data !== 'string' || data.length > 4000 || !this.allow(peer)) return
    let raw: unknown
    try { raw = JSON.parse(data) } catch { return }
    const parsed = clientMessage.safeParse(raw)
    if (!parsed.success) return
    const m = parsed.data
    switch (m.t) {
      case 'p': {
        if (peer.boat !== peer.id) return
        peer.pos = m.d
        peer.dirty = true
        for (const rider of this.crewOf(peer.id)) if (rider !== peer) rider.pos = m.d
        return
      }
      case 'f': {
        peer.phase = m.phase
        peer.fish = m.fish
        this.broadcast({ t: 'f', id: peer.id, phase: m.phase, ...(m.fish ? { fish: m.fish } : {}) }, peer)
        return
      }
      case 'gear': {
        const now = Date.now()
        if (now - peer.gearAt < 1500) return
        peer.gearAt = now
        if (peer.member && peer.userId) peer.gear = gearOf(await loadProfile(this.env, peer.userId, peer.name))
        else peer.gear = guestGear(m.gear)
        if (this.peers.get(peer.id) !== peer) return
        this.broadcast({ t: 'gear', id: peer.id, gear: peer.gear })
        return
      }
      case 'board': return this.board(peer, m.boat)
      case 'leave': return this.ashore(peer)
      case 'lock': {
        if (peer.boat !== peer.id) return
        peer.locked = m.locked
        this.broadcast({ t: 'lock', id: peer.id, locked: m.locked })
        return
      }
      case 'kick': {
        const rider = this.peers.get(m.id)
        if (!rider || rider === peer || rider.boat !== peer.id) return
        this.send(rider, { t: 'notice', text: `${peer.name} asked you to head back to your own boat.` })
        this.ashore(rider)
        return
      }
    }
  }

  private board(peer: Peer, boat: string): void {
    const captain = this.peers.get(boat)
    if (!captain || captain === peer || captain.boat !== captain.id) { this.send(peer, { t: 'notice', text: 'That boat is not on the lake any more.' }); return }
    if (peer.boat === boat) return
    if (captain.locked) { this.send(peer, { t: 'notice', text: `${captain.name} is not taking anyone aboard right now.` }); return }
    if (peer.boat === peer.id && this.crewOf(peer.id).length > 1) { this.send(peer, { t: 'notice', text: 'Your crew is aboard your boat. Head back together or let them go first.' }); return }
    const crew = this.crewOf(boat)
    const seat = crew.length >= CREW_SIZE ? -1 : freeSeat(crew.map(p => p.seat))
    if (seat < 0) { this.send(peer, { t: 'notice', text: `${captain.name}'s boat is full.` }); return }
    peer.boat = boat
    peer.seat = seat
    peer.pos = captain.pos
    this.broadcast({ t: 'seat', id: peer.id, boat, seat, pos: peer.pos })
  }

  private ashore(peer: Peer): void {
    if (peer.boat === peer.id) return
    const [x, z, h] = peer.pos
    const side = 7 + peer.seat * 3
    peer.pos = [x + Math.cos(h) * side, z - Math.sin(h) * side, h, 0, 0]
    peer.boat = peer.id
    peer.seat = 0
    peer.dirty = true
    this.broadcast({ t: 'seat', id: peer.id, boat: peer.id, seat: 0, pos: peer.pos })
  }

  private remove(peer: Peer): void {
    this.peers.delete(peer.id)
    if (this.byKey.get(peer.key) === peer.id) this.byKey.delete(peer.key)
    for (const rider of this.crewOf(peer.id)) {
      this.send(rider, { t: 'notice', text: `${peer.name} headed in, so you are back in your own boat.` })
      this.ashore(rider)
    }
    this.broadcast({ t: 'gone', id: peer.id })
    if (!this.peers.size && this.timer) { clearInterval(this.timer); this.timer = null }
  }

  private ensureTimer(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.flush(), 1000 / POSITION_HZ)
  }

  private flush(): void {
    const d: [string, ...Position][] = []
    for (const p of this.peers.values()) if (p.dirty && p.boat === p.id) { d.push([p.id, ...p.pos]); p.dirty = false }
    if (d.length) this.broadcast({ t: 'pos', d })
  }

  private send(peer: Peer, message: ServerMessage): void {
    try { peer.socket.send(JSON.stringify(message)) } catch { /* closed */ }
  }

  private broadcast(message: ServerMessage, except?: Peer): void {
    const data = JSON.stringify(message)
    for (const p of this.peers.values()) if (p !== except) try { p.socket.send(data) } catch { /* closed */ }
  }
}

export function lakeStub(env: Env, lake: LakeId, instance: number) {
  if (!env.ANGLER_LAKE) return null
  return env.ANGLER_LAKE.get(env.ANGLER_LAKE.idFromName(instanceName(lake, instance)))
}

/** Tells the lake instance about a landed fish so everyone there sees it. Never fails the catch. */
export async function announceCatch(env: Env, lake: LakeId, instance: number | undefined, key: string, fish: { species: string; weight: number; length: number; tier: string; delay?: number }) {
  if (instance === undefined) return
  const stub = lakeStub(env, lake, instance)
  if (!stub) return
  try { await stub.fetch(new Request('https://angler-lake/catch', { method: 'POST', body: JSON.stringify({ key, ...fish }) })) } catch { /* lake offline */ }
}

/** How many anglers share the caller's boat right now (1 when alone, 0 when not on the lake). */
export async function crewSize(env: Env, lake: LakeId, instance: number | undefined, key: string): Promise<number> {
  if (instance === undefined) return 0
  const stub = lakeStub(env, lake, instance)
  if (!stub) return 0
  try {
    const r = await stub.fetch(new Request('https://angler-lake/crew', { method: 'POST', body: JSON.stringify({ key }) }))
    const body = await r.json() as { crew?: number }
    return Number(body.crew) || 0
  } catch {
    return 0
  }
}

export async function lakeStatus(env: Env, lake: LakeId) {
  let boats = 0, anglers = 0
  for (let i = 0; i < 8; i++) {
    const stub = lakeStub(env, lake, i)
    if (!stub) break
    try {
      const s = await (await stub.fetch(new Request('https://angler-lake/status'))).json() as { boats: number; anglers: number }
      boats += s.boats
      anglers += s.anglers
      if (s.boats < BOATS_PER_INSTANCE) break
    } catch {
      break
    }
  }
  return { boats, anglers }
}
