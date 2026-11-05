/** The shared lake: one WebSocket to the AnglerLake Durable Object, up to four boats per lake instance with two anglers to a boat, name tags, catch news and invite codes for the library chat. Catches still come only from /api/angler. */
import * as pc from 'playcanvas'
import type { World } from './World'
import { RemoteAngler } from './RemoteAngler'
import { Boat } from '../scene/Boat'
import { Wake } from '../scene/Wake'
import type { BoatKind, BoatSpec } from '../shared/Boats'
import type { LakeId } from '../shared/Lakes'
import { BOARD_RADIUS, CREW_SIZE, POSITION_HZ, crowdAt, inviteCode } from '../shared/Online'
import type { ClientMessage, Gear, PeerView, Position, RemotePhase, ServerMessage } from '../shared/Online'
import { SPECIES, formatWeight, isSpeciesId } from '../shared/Species'
import { clamp } from '../shared/Random'

type ToastKind = 'good' | 'warn' | 'soft' | 'gold'

export interface OnlineEvents {
  toast(text: string, kind: ToastKind, seconds?: number): void
  changed(): void
  /** The angler's own phase and held fish, read every frame. */
  fishing(): { phase: RemotePhase; fish?: { species: string; length: number } }
  /** Called when the player boards or leaves another angler's boat. */
  crewChanged(aboard: boolean): void
  gear(): Gear
  signedIn(): boolean
  chime(big: boolean): void
}

interface MovingBoat {
  id: string
  boat: Boat | null
  wake: Wake | null
  kind: BoatKind
  paintKey: string
  loading: boolean
  target: { x: number; z: number; heading: number; speed: number; at: number }
  state: { x: number; z: number; heading: number; speed: number; anchored: boolean }
  phase: number
}

interface Remote {
  view: PeerView
  angler: RemoteAngler
  tag: HTMLElement
  boat: MovingBoat | null
}

const RETRY_MS = [2000, 5000, 10000, 20000, 30000]

function guestKey(): string {
  const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), b => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('')
  try {
    const saved = localStorage.getItem('tl-angler-guest')
    if (saved && /^[A-Za-z0-9]{12,64}$/.test(saved)) return saved
    const key = fresh()
    localStorage.setItem('tl-angler-guest', key)
    return key
  } catch {
    return fresh()
  }
}

export class Online {
  selfId: string | null = null
  lake: LakeId | null = null
  instance = 0
  /** Captain id of the boat the player is on (their own id when captaining). */
  myBoat: string | null = null
  mySeat = 0
  locked = false
  readonly remotes = new Map<string, Remote>()
  private socket: WebSocket | null = null
  private retry = 0
  private retryTimer = 0
  private wanted: { lake: LakeId; instance?: number; board?: string } | null = null
  private sendTimer = 0
  private lastSent = { x: 0, z: 0, h: 0, a: -1, at: 0 }
  private lastPhase: RemotePhase = 'off'
  private lastFishKey = ''
  private pendingCarrier: string | null = null
  private carrierAnchored = false
  private readonly tags: HTMLElement
  private readonly guest = guestKey()

  constructor(private readonly world: World, private readonly events: OnlineEvents, tags: HTMLElement) {
    this.tags = tags
  }

  get connected(): boolean {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN && this.selfId)
  }

  get aboard(): boolean {
    return Boolean(this.selfId && this.myBoat && this.myBoat !== this.selfId)
  }

  /** Joins the shared copy of a lake; an invite names the instance and the boat to climb aboard. */
  connect(lake: LakeId, invite?: { instance: number; board: string }): void {
    this.disconnect()
    this.wanted = { lake, instance: invite?.instance, board: invite?.board }
    this.retry = 0
    this.open()
  }

  disconnect(): void {
    this.wanted = null
    clearTimeout(this.retryTimer)
    const s = this.socket
    this.socket = null
    if (s) try { s.close(1000, 'bye') } catch { /* closed */ }
    this.reset()
  }

  private reset(): void {
    if (this.aboard && this.world.carrier) {
      const st = this.world.carrier.state
      this.world.disembark(st.x + 8, st.z, st.heading)
      this.events.crewChanged(false)
    }
    for (const r of this.remotes.values()) this.dropRemote(r)
    this.remotes.clear()
    this.selfId = null
    this.myBoat = null
    this.mySeat = 0
    this.locked = false
    this.pendingCarrier = null
    this.lastPhase = 'off'
    this.lastFishKey = ''
    this.lastSent.at = 0
    this.events.changed()
  }

  private open(): void {
    const w = this.wanted
    if (!w) return
    const params = new URLSearchParams({ lake: w.lake })
    if (w.instance !== undefined) params.set('instance', String(w.instance))
    if (w.board) params.set('crew', '1')
    if (!this.events.signedIn()) params.set('guest', this.guest)
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/angler-lake?${params}`
    let socket: WebSocket
    try { socket = new WebSocket(url) } catch { this.scheduleRetry(); return }
    this.socket = socket
    socket.addEventListener('message', e => { if (this.socket === socket && typeof e.data === 'string') this.onMessage(e.data) })
    socket.addEventListener('close', e => {
      if (this.socket !== socket) return
      this.socket = null
      const hadSession = Boolean(this.selfId)
      this.reset()
      if (e.code === 4001) { this.wanted = null; return }
      if (hadSession) this.events.toast('Lost touch with the other anglers. Reconnecting…', 'soft')
      if (this.wanted) { this.wanted.instance = undefined; this.wanted.board = undefined }
      this.scheduleRetry()
    })
  }

  private scheduleRetry(): void {
    if (!this.wanted) return
    clearTimeout(this.retryTimer)
    this.retryTimer = window.setTimeout(() => this.open(), RETRY_MS[Math.min(this.retry++, RETRY_MS.length - 1)])
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  /** After the wardrobe or boat is saved, so the others see the change. */
  sendGear(): void {
    this.send(this.events.signedIn() ? { t: 'gear' } : { t: 'gear', gear: this.events.gear() })
  }

  board(id: string): void {
    this.send({ t: 'board', boat: id })
  }

  leaveBoat(): void {
    this.send({ t: 'leave' })
  }

  setLocked(locked: boolean): void {
    this.locked = locked
    this.send({ t: 'lock', locked })
    this.events.changed()
  }

  kick(id: string): void {
    this.send({ t: 'kick', id })
  }

  /** The library chat's invite code for the boat the player is on. */
  inviteCode(): string | null {
    if (!this.connected || !this.lake || !this.myBoat) return null
    return inviteCode(this.lake, this.instance, this.myBoat)
  }

  /** Everyone on the player's boat, the captain first, the player included. */
  crew(): { id: string; name: string; seat: number; you: boolean }[] {
    if (!this.selfId || !this.myBoat) return []
    const out = [{ id: this.selfId, name: 'You', seat: this.mySeat, you: true }]
    for (const r of this.remotes.values()) if (r.view.boat === this.myBoat) out.push({ id: r.view.id, name: r.view.name, seat: r.view.seat, you: false })
    return out.sort((a, b) => a.seat - b.seat)
  }

  /** The name of a boatmate who has a fish on right now, for double headers. */
  crewFighting(): string | null {
    if (!this.myBoat) return null
    for (const r of this.remotes.values()) if (r.view.boat === this.myBoat && r.view.phase === 'fight') return r.view.name
    return null
  }

  captainName(): string {
    if (!this.myBoat || this.myBoat === this.selfId) return 'You'
    return this.remotes.get(this.myBoat)?.view.name ?? 'Captain'
  }

  /** Other boats near enough to share the fish under the player. */
  crowd(): number {
    const s = this.world.physics?.state
    if (!s || !this.connected) return 0
    const boats: { x: number; z: number }[] = []
    for (const r of this.remotes.values()) if (r.boat && r.view.id !== this.myBoat) boats.push(r.boat.state)
    return crowdAt(s.x, s.z, boats)
  }

  boatsOut(): number {
    let n = 0
    for (const r of this.remotes.values()) if (r.view.boat === r.view.id) n++
    return this.connected ? n + (this.aboard ? 0 : 1) : 0
  }

  /** The nearest other boat close enough to step across to, if both are nearly stopped. */
  boardable(): Remote | null {
    const s = this.world.physics?.state
    if (!s || !this.connected || this.aboard || Math.abs(s.speed) > 2) return null
    if (this.crew().length > 1) return null
    let best: Remote | null = null, bestD = BOARD_RADIUS
    for (const r of this.remotes.values()) {
      if (!r.boat || r.view.locked || Math.abs(r.boat.state.speed) > 2) continue
      const d = Math.hypot(r.boat.state.x - s.x, r.boat.state.z - s.z)
      const crew = [...this.remotes.values()].filter(o => o.view.boat === r.view.id).length
      if (d < bestD && crew < CREW_SIZE) { best = r; bestD = d }
    }
    return best
  }

  markers(): { x: number; z: number; heading: number; label?: string }[] {
    const out: { x: number; z: number; heading: number; label?: string }[] = []
    for (const r of this.remotes.values()) if (r.boat && r.view.id !== this.myBoat) out.push({ x: r.boat.state.x, z: r.boat.state.z, heading: r.boat.state.heading, label: r.view.name })
    return out
  }

  private onMessage(data: string): void {
    let m: ServerMessage
    try { m = JSON.parse(data) as ServerMessage } catch { return }
    switch (m.t) {
      case 'welcome': {
        this.reset()
        this.selfId = m.id
        this.lake = m.lake
        this.instance = m.instance
        this.myBoat = m.id
        this.retry = 0
        for (const p of m.peers) this.addRemote(p)
        if (!this.events.signedIn()) this.sendGear()
        const board = this.wanted?.board
        if (this.wanted) this.wanted.board = undefined
        if (board) this.board(board)
        this.lastSent.at = 0
        this.events.changed()
        return
      }
      case 'join': {
        this.addRemote(m.peer)
        if (this.remotes.size <= 8) this.events.toast(`${m.peer.name} launched a boat on the lake.`, 'soft')
        this.events.changed()
        return
      }
      case 'gone': {
        const r = this.remotes.get(m.id)
        if (!r) return
        this.dropRemote(r)
        this.remotes.delete(m.id)
        this.events.changed()
        return
      }
      case 'gear': {
        const r = this.remotes.get(m.id)
        if (!r) return
        r.view.gear = m.gear
        r.angler.setLook(m.gear.look)
        if (r.boat) this.styleBoat(r.boat, m.gear)
        return
      }
      case 'pos': {
        const at = performance.now()
        for (const [id, x, z, h, v, a] of m.d) {
          const r = this.remotes.get(id)
          if (!r) continue
          r.view.pos = [x, z, h, v, a]
          if (r.boat) {
            r.boat.target = { x, z, heading: h, speed: v, at }
            r.boat.state.anchored = a === 1
          }
        }
        return
      }
      case 'f': {
        const r = this.remotes.get(m.id)
        if (!r) return
        r.view.phase = m.phase
        r.view.fish = m.fish
        r.angler.setPhase(m.phase, m.fish)
        return
      }
      case 'seat': return this.onSeat(m.id, m.boat, m.seat, m.pos)
      case 'lock': {
        if (m.id === this.selfId) this.locked = m.locked
        const r = this.remotes.get(m.id)
        if (r) r.view.locked = m.locked
        this.events.changed()
        return
      }
      case 'catch': {
        if (m.id === this.selfId || !isSpeciesId(m.species)) return
        const name = SPECIES[m.species].name.toLowerCase()
        const crewmate = this.remotes.get(m.id)?.view.boat === this.myBoat
        const big = ['Trophy', 'Legendary'].includes(m.tier)
        if (crewmate) this.events.chime(big)
        if (crewmate) this.events.toast(`${m.name} landed a ${formatWeight(m.weight)} ${name}${m.tier === 'Common' ? '' : ` (${m.tier})`}.`, big ? 'gold' : 'good', big ? 8 : 5)
        else if (big || m.tier === 'Quality') this.events.toast(`Across the lake, ${m.name} landed a ${formatWeight(m.weight)} ${name} (${m.tier}).`, big ? 'gold' : 'soft', big ? 8 : 5)
        return
      }
      case 'notice': {
        this.events.toast(m.text, 'warn', 6)
        return
      }
    }
  }

  private onSeat(id: string, boat: string, seat: number, pos: Position): void {
    if (id === this.selfId) {
      const was = this.myBoat
      this.myBoat = boat
      this.mySeat = seat
      if (boat === id && was !== id) {
        this.pendingCarrier = null
        this.world.disembark(pos[0], pos[1], pos[2])
        this.carrierAnchored = false
        this.events.toast('Back in your own boat.', 'soft')
        this.events.crewChanged(false)
      } else if (boat !== id) {
        this.pendingCarrier = boat
        this.tryBoard()
      }
      this.events.changed()
      return
    }
    const r = this.remotes.get(id)
    if (!r) return
    const wasCaptain = r.view.boat === r.view.id
    r.view.boat = boat
    r.view.seat = seat
    r.view.pos = pos
    const captain = boat === id
    if (captain && !wasCaptain) r.boat = this.makeBoat(r.view)
    if (!captain && wasCaptain && r.boat) { this.dropBoat(r.boat); r.boat = null }
    if (!captain && boat === this.selfId) this.events.toast(`${r.view.name} came aboard your boat.`, 'good')
    if (captain && !wasCaptain && this.myBoat === this.selfId) this.events.toast(`${r.view.name} headed back to their own boat.`, 'soft')
    this.events.changed()
  }

  private tryBoard(): void {
    const id = this.pendingCarrier
    if (!id) return
    const r = this.remotes.get(id)
    if (!r?.boat?.boat) return
    this.pendingCarrier = null
    this.world.board({ boat: r.boat.boat, state: r.boat.state }, this.mySeat)
    this.carrierAnchored = r.boat.state.anchored
    this.events.toast(`Aboard ${r.view.name}'s boat. The captain drives; you fish when they anchor.`, 'good', 6)
    this.events.crewChanged(true)
  }

  /** True while crewing and the captain has the anchor down. */
  captainAnchored(): boolean {
    return this.aboard && this.carrierAnchored
  }

  private addRemote(view: PeerView): void {
    if (this.remotes.has(view.id)) this.dropRemote(this.remotes.get(view.id)!)
    const angler = new RemoteAngler(this.world.app, this.world.characterAssets, view.gear.look, this.world.root, `angler-${view.id}`)
    angler.setPhase(view.phase, view.fish)
    const tag = document.createElement('div')
    tag.className = 'ang-tag'
    tag.hidden = true
    this.tags.appendChild(tag)
    const r: Remote = { view, angler, tag, boat: null }
    if (view.boat === view.id) r.boat = this.makeBoat(view)
    this.remotes.set(view.id, r)
  }

  private dropRemote(r: Remote): void {
    r.angler.destroy()
    r.tag.remove()
    if (r.boat) this.dropBoat(r.boat)
    r.boat = null
  }

  private makeBoat(view: PeerView): MovingBoat {
    const [x, z, h, v, a] = view.pos
    const b: MovingBoat = {
      id: view.id, boat: null, wake: null, kind: view.gear.boat, paintKey: '', loading: false,
      target: { x, z, heading: h, speed: v, at: performance.now() },
      state: { x, z, heading: h, speed: v, anchored: a === 1 },
      phase: Math.random() * 10,
    }
    this.styleBoat(b, view.gear)
    return b
  }

  private styleBoat(b: MovingBoat, gear: Gear): void {
    const key = JSON.stringify(gear.paint)
    if (b.boat && b.kind === gear.boat) {
      if (b.paintKey !== key) { b.boat.setPaint(gear.paint); b.paintKey = key }
      return
    }
    b.kind = gear.boat
    b.paintKey = key
    const build = (bass: Awaited<ReturnType<World['remoteBassAssets']>>) => {
      const riders = b.boat ? b.boat.hull.children.filter(c => c.tags.has('rider')) : []
      for (const r of riders) b.boat!.hull.removeChild(r)
      b.boat?.destroy()
      b.boat = new Boat(this.world.app, gear.boat, gear.paint, bass, `boat-${b.id}`)
      this.world.root.addChild(b.boat.root)
      for (const r of riders) b.boat.hull.addChild(r)
      b.loading = false
      if (!b.wake) { b.wake = new Wake(this.world.app, b.boat.spec); this.world.root.addChild(b.wake.entity) }
      b.wake.setSpec(b.boat.spec)
      if (this.world.carrier && this.myBoat === b.id) this.world.carrier.boat = b.boat
      this.tryBoard()
    }
    if (gear.boat === 'bass') {
      b.loading = true
      void this.world.remoteBassAssets().then(bass => { if (this.isLive(b) && b.kind === 'bass') build(bass) })
    } else build(null)
  }

  private isLive(b: MovingBoat): boolean {
    for (const r of this.remotes.values()) if (r.boat === b) return true
    return false
  }

  private dropBoat(b: MovingBoat): void {
    if (b.boat) {
      for (const c of b.boat.hull.children.filter(c => c.tags.has('rider'))) b.boat.hull.removeChild(c)
      b.boat.destroy()
    }
    b.wake?.destroy()
    b.wake = null
    b.boat = null
  }

  /** Per frame: send our position and phase, move the other boats, seat everyone, draw rods and name tags. */
  update(dt: number): void {
    if (!this.connected) return
    const w = this.world
    const time = w.time
    this.sendState(dt)
    const visible = !w.background
    const cam = w.camera?.entity
    const camPos = cam?.getPosition()
    for (const r of this.remotes.values()) {
      const b = r.boat
      if (b) this.moveBoat(b, dt, time)
      const host = this.hostFor(r.view.boat)
      const e = r.angler.character.entity
      if (!host) { e.enabled = false; continue }
      if (e.parent !== host.hull) { e.parent?.removeChild(e); host.hull.addChild(e) }
      e.enabled = true
      if (!visible) continue
      r.angler.place(host.spec, r.view.seat, time)
      const near = camPos ? camPos.distance(e.getPosition()) < 140 : true
      r.angler.update(dt, time, near)
    }
    if (this.aboard && this.world.carrier) {
      const anchored = this.world.carrier.state.anchored
      if (anchored !== this.carrierAnchored) { this.carrierAnchored = anchored; this.events.changed() }
    }
    if (visible) this.drawTags()
  }

  private hostFor(boat: string): { hull: pc.Entity; spec: BoatSpec } | null {
    if (boat === this.selfId) return this.world.boat ? { hull: this.world.boat.hull, spec: this.world.boat.spec } : null
    const b = this.remotes.get(boat)?.boat?.boat
    return b ? { hull: b.hull, spec: b.spec } : null
  }

  private moveBoat(b: MovingBoat, dt: number, time: number): void {
    const t = b.target, s = b.state
    const age = Math.min(1, (performance.now() - t.at) / 1000)
    const px = t.x - Math.sin(t.heading) * t.speed * age
    const pz = t.z - Math.cos(t.heading) * t.speed * age
    if (Math.hypot(px - s.x, pz - s.z) > 40) { s.x = px; s.z = pz; s.heading = t.heading }
    const k = 1 - Math.exp(-dt * 5)
    s.x += (px - s.x) * k
    s.z += (pz - s.z) * k
    s.heading += Math.atan2(Math.sin(t.heading - s.heading), Math.cos(t.heading - s.heading)) * k
    s.speed = t.speed
    if (!b.boat) return
    b.wake?.update(dt, s.x, s.z, s.heading, s.speed, !this.world.background)
    const plane = clamp(Math.abs(s.speed) / 14, 0, 1)
    const heave = Math.sin(time * 1.4 + b.phase) * 0.025 + plane * 0.05
    b.boat.root.setPosition(s.x, heave, s.z)
    b.boat.root.setEulerAngles(0, (s.heading * 180) / Math.PI, 0)
    b.boat.hull.setLocalEulerAngles(plane * (1 - plane * 0.4) * 4.5 + Math.sin(time * 1.1 + b.phase) * 0.6, 0, Math.sin(time * 0.9 + b.phase * 2) * 1.2)
    if (!this.world.background) b.boat.setLightsOn(this.world.sky.state.day < 0.5)
  }

  private sendState(dt: number): void {
    this.sendTimer += dt
    const f = this.events.fishing()
    const fishKey = f.fish ? `${f.fish.species}:${f.fish.length}` : ''
    if (f.phase !== this.lastPhase || fishKey !== this.lastFishKey) {
      this.lastPhase = f.phase
      this.lastFishKey = fishKey
      this.send({ t: 'f', phase: f.phase, ...(f.fish ? { fish: f.fish } : {}) })
    }
    if (this.aboard || this.sendTimer < 1 / POSITION_HZ) return
    this.sendTimer = 0
    const s = this.world.physics?.state
    if (!s) return
    const a = this.world.anchored ? 1 : 0
    const last = this.lastSent
    const nowMs = performance.now()
    const moved = Math.hypot(s.x - last.x, s.z - last.z) > 0.05 || Math.abs(s.heading - last.h) > 0.01 || a !== last.a
    if (!moved && nowMs - last.at < 5000) return
    Object.assign(last, { x: s.x, z: s.z, h: s.heading, a, at: nowMs })
    const r2 = (n: number) => Math.round(n * 100) / 100
    this.send({ t: 'p', d: [r2(s.x), r2(s.z), Math.round(s.heading * 1000) / 1000, r2(s.speed), a] })
  }

  private drawTags(): void {
    const cam = this.world.camera?.entity?.camera
    const camPos = this.world.camera?.entity.getPosition()
    const screen = new pc.Vec3()
    for (const r of this.remotes.values()) {
      const b = r.boat?.boat
      if (!cam || !camPos || !b || r.view.id === this.myBoat) { r.tag.hidden = true; continue }
      const p = b.root.getPosition()
      const top = new pc.Vec3(p.x, p.y + 2.6, p.z)
      const dist = camPos.distance(top)
      const forward = this.world.camera.entity.forward
      const toward = top.clone().sub(camPos)
      if (dist > 320 || toward.dot(forward) < 0) { r.tag.hidden = true; continue }
      cam.worldToScreen(top, screen)
      const crew = [...this.remotes.values()].filter(o => o.view.boat === r.view.id && o !== r).length
      const text = crew ? `${r.view.name} +${crew}` : r.view.name
      if (r.tag.textContent !== text) r.tag.textContent = text
      r.tag.hidden = false
      r.tag.style.transform = `translate(${Math.round(screen.x)}px, ${Math.round(screen.y)}px) translate(-50%, -100%)`
      r.tag.style.opacity = String(clamp(1.2 - dist / 320, 0.35, 1))
    }
  }
}
