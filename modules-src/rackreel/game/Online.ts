import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { PeerRoom } from '../../../engine/net/Peer'
import type { RoomStatus } from '../../../engine/net/Peer'
import type { RoomFormat } from '../../../engine/net/RoomFormats'
import type { EngineContext } from '../core/EngineSetup'
import { disposeRig, instantiate } from '../core/ModelLibrary'
import type { ModelName, ModelRig, ModelTemplate } from '../core/ModelLibrary'
import { instantiateSkinned } from '../core/SkinnedModel'
import type { SkinnedTemplate } from '../core/SkinnedModel'
import { unpackAppearance } from '../shared/Appearance'
import type { HeadPaint } from './HeadPaint'
import type { NetAnimal } from '../systems/Wildlife'
import { Avatar, HIP_HEIGHT } from './Avatar'
import type { AvatarHands, AvatarStance } from './Avatar'
import { createAnchorLine } from './BoatSeats'
import { GearHands, placeRifle, placeRodInHand } from './Grips'
import type { DeckSeat } from './BoatSeats'

export const RACKREEL_ROOM: RoomFormat = { prefix: 'tl-rackreel-', alphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', length: 6, wireCase: 'lower' }
export const PARTY_MAX = 4

export interface PlayerState {
  id: string
  n: string
  p: [number, number, number]
  f: number
  st: AvatarStance
  h: AvatarHands
  sp: number
  c: boolean
  cl: number
  ap: number
  o: string[]
  /** Face, hair, beard, face shape and body size, packed by `packAppearance`. */
  k?: string
  v?: { k: 'utv' | 'boat' | 'quad'; p: [number, number, number]; q: [number, number, number]; s: [number, number, number]; a?: 1; d?: DeckSeat }
  r?: { o: string; s: [number, number, number] }
  /** Night bowfishing on Wisco Wild Man's boat: the trip owner sends the boat (`o`: x, z, heading, speed, light mode, docked, and the hull's lift over the island jump or up on the bank); crew send the owner's id (`w`); everyone sends their shooting spot (`s`). */
  b?: { o?: BowPose; w?: string; s: number; d?: [number, number] }
}

export type BowPose = [number, number, number, number, number, number, number?]

export interface BowTrip {
  id: string
  name: string
  pose: BowPose
}

export interface RemoteBoat {
  id: string
  name: string
  root: TransformNode
  heading: number
  anchored: boolean
  deck: DeckSeat
  speed: number
  crew: string | null
}

export type NetMessage =
  | { t: 'state'; s: PlayerState }
  | { t: 'states'; all: Record<string, PlayerState> }
  | { t: 'herd'; a: NetAnimal[] }
  | { t: 'shot'; id: number; vital: boolean; from: [number, number, number] }
  | { t: 'tag'; id: number }
  | { t: 'news'; text: string }
  | { t: 'seat'; to: string; from: string }

interface Remote {
  avatar: Avatar
  state: PlayerState
  /** The packed appearance last applied to the avatar. */
  look?: string
  shown: Vector3
  vehicle: ModelRig | null
  vehicleKind: string
  anchorLine: Mesh | null
  tag: HTMLDivElement
  rod: ModelRig
  rifle: ModelRig
  /** Smoothed feet on the bowfishing boat. */
  deck?: Vector3
}

export interface OnlineHooks {
  herd(list: NetAnimal[]): void
  shot(id: number, vital: boolean, from: Vector3): void
  tag(id: number): void
  news(text: string): void
  status(text: string): void
  seat(from: string): void
  localBoat(): TransformNode | null
  /** Wisco Wild Man's boat, which party members on a bowfishing trip stand on. */
  bowBoat(): TransformNode
  /** Feet position of a bowfishing spot in boat space. */
  /** A party member's feet on the bowfishing boat (boat space): where they walked to, or their shooting spot. */
  bowSpot(slot: number, deck?: [number, number]): Vector3
}

const VEHICLE_MODEL: Record<string, ModelName> = { utv: 'utv', boat: 'boat', quad: 'quad' }

const LOBBY_API = '/api/rackreel-lobbies'
const LOBBY_HEARTBEAT = 20

export interface OpenLobby {
  code: string
  host: string
  players: number
}

/** Parties whose hosts switched Open lobby on, newest first. */
export async function fetchLobbies(): Promise<OpenLobby[]> {
  const response = await fetch(LOBBY_API, { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error('Lobby list unavailable')
  const body = await response.json() as { lobbies?: OpenLobby[] }
  return Array.isArray(body.lobbies) ? body.lobbies : []
}

export class Online {
  readonly room: PeerRoom<NetMessage>
  private readonly remotes = new Map<string, Remote>()
  private sendTimer = 0
  private herdTimer = 0
  private statusTimer = 0
  private hostStates: Record<string, PlayerState> = {}
  private readonly tags: HTMLDivElement
  private readonly passengers = new Set<TransformNode>()
  private readonly gearHands = new GearHands()
  private memberList: { id: string; name: string; at: Vector3 }[] = []
  private lastStatus = ''
  private clock = 0
  private readonly target = new Vector3()
  private readonly head = new Vector3()
  private readonly projected = new Vector3()
  private lobbyTimer = 0
  private lobbyCode = ''
  private readonly lobbyKey = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('')
  /** The host listed this party in the open lobbies on the start screen. */
  lobbyOpen = false
  name = 'Guest'
  id = ''

  constructor(private readonly ctx: EngineContext, private readonly scene: Scene, private readonly models: Map<ModelName, ModelTemplate>, private readonly hunter: SkinnedTemplate, private readonly paint: HeadPaint, private readonly hooks: OnlineHooks) {
    this.room = new PeerRoom<NetMessage>(RACKREEL_ROOM, { hostAttempts: 5, rejoinSeconds: 3, maxPeers: PARTY_MAX - 1 }, {
      message: (m, from) => this.receive(m, from),
      join: () => {
        this.publishLobby()
        this.hooks.status(this.describe())
      },
      leave: (peer) => {
        if (this.room.isHost) this.drop(peer)
        else for (const id of [...this.remotes.keys()]) this.drop(id)
        delete this.hostStates[peer]
        this.publishLobby()
        this.hooks.status(this.describe())
      },
      status: (s) => {
        if (s === 'error' || s === 'idle') this.closeLobby()
        this.hooks.status(this.describe(s))
      },
    })
    this.tags = document.createElement('div')
    this.tags.className = 'hud name-tags'
    document.body.append(this.tags)
    addEventListener('pagehide', () => this.closeLobby())
  }

  get isHost(): boolean {
    return this.room.open && this.room.isHost
  }

  /** Lists (or unlists) this party for anyone on the start screen. Opens a party first when there isn't one. */
  async setLobbyOpen(open: boolean): Promise<void> {
    if (!open) {
      this.closeLobby()
      this.hooks.status(this.describe())
      return
    }
    if (this.isGuest) throw new Error('Only the party host can open the lobby.')
    if (!this.isHost) await this.host()
    this.lobbyOpen = true
    this.publishLobby()
    this.hooks.status(this.describe())
  }

  private publishLobby(): void {
    this.lobbyTimer = LOBBY_HEARTBEAT
    if (!this.lobbyOpen || !this.isHost) return
    this.lobbyCode = this.room.code
    void fetch(LOBBY_API, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'open', code: this.room.code, key: this.lobbyKey, players: Math.min(PARTY_MAX, this.room.peers.length + 1), guest: this.name.startsWith('Guest-') ? this.name : undefined }),
    }).catch(() => undefined)
  }

  private closeLobby(): void {
    const code = this.lobbyCode
    this.lobbyOpen = false
    this.lobbyCode = ''
    if (!code) return
    void fetch(LOBBY_API, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close', code, key: this.lobbyKey }),
    }).catch(() => undefined)
  }

  get active(): boolean {
    return this.room.open
  }

  get isGuest(): boolean {
    return this.room.open && !this.room.isHost
  }

  /** Party members other than you; the list is rebuilt only when someone joins, leaves or renames. */
  get members(): { id: string; name: string; at: Vector3 }[] {
    return this.memberList
  }

  private rebuildMembers(): void {
    this.memberList = [...this.remotes.entries()].map(([id, r]) => ({ id, name: r.state.n, at: r.shown }))
  }

  describe(status: RoomStatus = this.room.status): string {
    if (status === 'idle') return ''
    if (status === 'opening' || status === 'connecting') return 'Connecting…'
    if (status === 'error') return 'Could not reach the party. Check the code and try again.'
    if (status === 'disconnected') return 'Lost the host — trying to rejoin…'
    return `Party ${this.room.code} · ${this.remotes.size + 1} of ${PARTY_MAX}${this.lobbyOpen ? ' · open lobby' : ''}`
  }

  async host(): Promise<string> {
    const code = await this.room.host()
    this.hooks.status(this.describe())
    return code
  }

  async join(code: string): Promise<void> {
    await this.room.join(code)
  }

  /** Joins and waits until the host answers; rejects when the code doesn't connect. */
  async joinAndWait(code: string, timeoutMs = 15000): Promise<void> {
    await this.room.join(code)
    const deadline = performance.now() + timeoutMs
    while (this.room.status === 'connecting') {
      if (performance.now() > deadline) break
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    if (this.room.status !== 'connected') {
      this.leave()
      throw new Error('That party did not answer.')
    }
  }

  leave(): void {
    this.room.close()
    for (const id of [...this.remotes.keys()]) this.drop(id)
    this.hostStates = {}
    this.hooks.status('')
  }

  bridge(): void {
    this.room.bridgeHub(() => this.host())
    this.room.autoJoinFromQuery()
  }

  sendShot(id: number, vital: boolean, from: Vector3): void {
    this.room.send({ t: 'shot', id, vital, from: [from.x, from.y, from.z] })
  }

  sendTag(id: number): void {
    this.room.send({ t: 'tag', id })
  }

  announce(text: string): void {
    if (this.active) this.room.send({ t: 'news', text: `${this.name} ${text}` })
  }

  carry(node: TransformNode): void {
    this.passengers.add(node)
  }

  boats(): RemoteBoat[] {
    const out: RemoteBoat[] = []
    for (const r of this.remotes.values()) {
      const v = r.state.v
      if (!v || v.k !== 'boat' || !r.vehicle) continue
      out.push({
        id: r.state.id, name: r.state.n, root: r.vehicle.root, heading: v.q[0], anchored: v.a === 1, deck: v.d ?? 0, speed: r.state.sp,
        crew: this.crewOf(r.state.id),
      })
    }
    return out
  }

  boat(id: string): RemoteBoat | null {
    return this.boats().find((b) => b.id === id) ?? null
  }

  crewOf(ownerId: string): string | null {
    for (const r of this.remotes.values()) if (r.state.r?.o === ownerId) return r.state.n
    return null
  }

  /** A party member's bowfishing trip (they own Wild Man's boat right now), if any. */
  bowTrip(): BowTrip | null {
    for (const r of this.remotes.values()) {
      const o = r.state.b?.o
      if (o) return { id: r.state.id, name: r.state.n, pose: o }
    }
    return null
  }

  /** Bowfishing spots taken by party members. */
  bowSlots(): number[] {
    const out: number[] = []
    for (const r of this.remotes.values()) if (r.state.b) out.push(r.state.b.s)
    return out
  }

  requestSeat(ownerId: string): void {
    this.room.send({ t: 'seat', to: ownerId, from: this.name })
  }

  update(dt: number, me: PlayerState, herd: () => NetAnimal[]): void {
    if (!this.active) return
    this.sendTimer -= dt
    if (this.sendTimer <= 0) {
      this.sendTimer = 0.12
      if (this.room.isHost) {
        this.hostStates.host = me
        for (const peer of this.room.peers) {
          const all: Record<string, PlayerState> = {}
          for (const [id, st] of Object.entries(this.hostStates)) if (id !== peer) all[id] = st
          this.room.sendTo(peer, { t: 'states', all })
        }
      } else this.room.send({ t: 'state', s: me })
    }
    if (this.room.isHost) {
      this.herdTimer -= dt
      if (this.herdTimer <= 0) {
        this.herdTimer = 0.25
        this.room.send({ t: 'herd', a: herd() })
      }
    }
    if (this.lobbyOpen) {
      this.lobbyTimer -= dt
      if (this.lobbyTimer <= 0) this.publishLobby()
    }
    this.statusTimer -= dt
    if (this.statusTimer <= 0) {
      this.statusTimer = 1
      const text = this.describe()
      if (text !== this.lastStatus) {
        this.lastStatus = text
        this.hooks.status(text)
      }
    }
    this.clock += dt
    for (const [, r] of this.remotes) this.animate(r, dt)
    this.positionTags()
  }

  /** Adds remote players (and their vehicles) within `reach` metres of `focus` to the shadow casters. */
  collectCasters(out: AbstractMesh[], focus: Vector3, reach: number): void {
    for (const r of this.remotes.values()) {
      if (Math.abs(r.shown.x - focus.x) > reach || Math.abs(r.shown.z - focus.z) > reach) continue
      for (const m of r.avatar.meshes) out.push(m)
      if (r.vehicle) for (const m of r.vehicle.meshes) out.push(m)
    }
  }

  private receive(m: NetMessage, from: string): void {
    if (m.t === 'state' && this.room.isHost) {
      this.hostStates[from] = m.s
      this.upsert(from, m.s)
    } else if (m.t === 'states' && !this.room.isHost) {
      for (const [id, s] of Object.entries(m.all)) this.upsert(id, s)
      for (const id of [...this.remotes.keys()]) if (!(id in m.all)) this.drop(id)
    } else if (m.t === 'herd' && !this.room.isHost) this.hooks.herd(m.a)
    else if (m.t === 'shot' && this.room.isHost) this.hooks.shot(m.id, m.vital, new Vector3(...m.from))
    else if (m.t === 'tag') {
      this.hooks.tag(m.id)
      if (this.room.isHost) this.room.send(m)
    } else if (m.t === 'news') {
      this.hooks.news(m.text)
      if (this.room.isHost) this.room.send(m)
    } else if (m.t === 'seat') {
      if (m.to === this.id) this.hooks.seat(m.from)
      else if (this.room.isHost) this.room.send(m)
    }
  }

  private upsert(id: string, s: PlayerState): void {
    let r = this.remotes.get(id)
    if (!r) {
      const avatar = new Avatar(instantiateSkinned(this.hunter, this.scene, (mesh) => this.ctx.registerDynamic(mesh)))
      const tag = document.createElement('div')
      tag.className = 'name-tag'
      this.tags.append(tag)
      const reg = (mesh: AbstractMesh) => this.ctx.registerDynamic(mesh)
      const rod = instantiate(this.models.get('rod')!, null, this.scene, reg)
      rod.root.parent = avatar.rightHand
      placeRodInHand(rod.root, avatar)
      const rifle = instantiate(this.models.get('rifle')!, null, this.scene, reg)
      rifle.root.parent = avatar.root
      r = { avatar, state: s, shown: new Vector3(...s.p), vehicle: null, vehicleKind: '', anchorLine: null, tag, rod, rifle }
      this.remotes.set(id, r)
      this.passengers.add(avatar.root)
      this.rebuildMembers()
    }
    const renamed = r.state.n !== s.n
    r.state = s
    if (renamed || r.tag.textContent !== s.n) {
      r.tag.textContent = s.n
      if (renamed) this.rebuildMembers()
    }
    r.avatar.setOutfit(s.o)
    if (r.look !== s.k) {
      r.look = s.k
      r.avatar.setAppearance(unpackAppearance(s.k), this.paint)
    }
  }

  private animate(r: Remote, dt: number): void {
    const s = r.state
    const target = this.target.set(s.p[0], s.p[1], s.p[2])
    if (Vector3.Distance(r.shown, target) > 25) r.shown.copyFrom(target)
    else Vector3.LerpToRef(r.shown, target, Math.min(1, dt * 10), r.shown)
    const root = r.avatar.root
    if (s.b) {
      this.removeVehicle(r)
      const spot = this.hooks.bowSpot(s.b.s, s.b.d)
      if (!r.deck || Vector3.Distance(r.deck, spot) > 3) r.deck = spot.clone()
      else Vector3.LerpToRef(r.deck, spot, Math.min(1, dt * 10), r.deck)
      this.seatOn(root, this.hooks.bowBoat(), [r.deck.x, r.deck.y + HIP_HEIGHT, r.deck.z], s.f)
    } else if (s.v) {
      if (r.vehicleKind !== s.v.k) {
        this.removeVehicle(r)
        r.vehicle = instantiate(this.models.get(VEHICLE_MODEL[s.v.k])!, null, this.scene, (mesh) => this.ctx.registerDynamic(mesh))
        r.vehicle.root.rotationQuaternion = new Quaternion()
        r.vehicleKind = s.v.k
        if (s.v.k === 'boat') r.anchorLine = createAnchorLine(this.scene, r.vehicle.root)
      }
      const vr = r.vehicle!.root
      Vector3.LerpToRef(vr.position, this.target.set(s.v.p[0], s.v.p[1], s.v.p[2]), Math.min(1, dt * 10), vr.position)
      Quaternion.FromEulerAnglesToRef(s.v.q[1], s.v.q[0], s.v.q[2], vr.rotationQuaternion!)
      r.anchorLine?.setEnabled(s.v.a === 1)
      this.seatOn(root, vr, s.v.s, s.v.a === 1 ? s.f : 0)
    } else {
      this.removeVehicle(r)
      const ride = s.r ? this.rideFor(s.r.o) : null
      if (ride && s.r) this.seatOn(root, ride, s.r.s, s.f)
      else {
        root.parent = null
        root.rotationQuaternion = null
        root.position.copyFrom(r.shown)
        root.rotation.set(0, s.f, 0)
      }
    }
    const crank = this.clock * 12
    r.avatar.update(dt, { stance: s.st, hands: s.h, speed: s.sp, crouch: s.c, castPower: s.h === 'cast' ? 0.6 : 0, aimPitch: s.ap, climbPhase: s.cl, crankPhase: crank })
    const rifleOut = s.h === 'rifle' || s.h === 'aim'
    r.rod.root.setEnabled(!rifleOut && !s.b && s.h !== 'wheel' && s.st !== 'climb')
    r.rifle.root.setEnabled(rifleOut && s.st !== 'climb')
    if (rifleOut) placeRifle(r.rifle.root, r.avatar, s.h === 'aim', s.ap, 0)
    if (s.b) r.avatar.solveHands(dt, null, null)
    else this.gearHands.apply(dt, r.avatar, s.h, { rod: r.rod.root, rifle: r.rifle.root, crank })
  }

  private seatOn(root: TransformNode, boat: TransformNode, seat: [number, number, number], swivel: number): void {
    root.parent = boat
    root.rotationQuaternion = null
    root.rotation.set(0, swivel, 0)
    root.position.set(seat[0], seat[1] - HIP_HEIGHT, seat[2])
  }

  private rideFor(ownerId: string): TransformNode | null {
    if (ownerId === this.id) return this.hooks.localBoat()
    for (const r of this.remotes.values()) if (r.state.id === ownerId && r.vehicleKind === 'boat' && r.vehicle) return r.vehicle.root
    return null
  }

  private removeVehicle(r: Remote): void {
    if (!r.vehicle) return
    for (const p of this.passengers) if (p.parent === r.vehicle.root) p.setParent(null)
    r.anchorLine?.dispose()
    r.anchorLine = null
    disposeRig(r.vehicle, (mesh) => this.ctx.unregisterDynamic(mesh))
    r.vehicle = null
    r.vehicleKind = ''
  }

  private positionTags(): void {
    const engine = this.ctx.engine
    const cam = this.ctx.camera
    const w = engine.getRenderWidth()
    const h = engine.getRenderHeight()
    const vp = cam.viewport.toGlobal(w, h)
    const transform = this.scene.getTransformMatrix()
    for (const r of this.remotes.values()) {
      const head = this.head.copyFrom(r.avatar.root.getAbsolutePosition()).addInPlaceFromFloats(0, 2.05, 0)
      const p = Vector3.ProjectToRef(head, Matrix.IdentityReadOnly, transform, vp, this.projected)
      const visible = p.z > 0 && p.z < 1 && Vector3.Distance(head, cam.globalPosition) < 260
      r.tag.hidden = !visible
      if (visible) {
        r.tag.style.left = `${(p.x / w) * 100}%`
        r.tag.style.top = `${(p.y / h) * 100}%`
      }
    }
  }

  private drop(id: string): void {
    const r = this.remotes.get(id)
    if (!r) return
    r.rod.root.parent = null
    r.rifle.root.parent = null
    this.removeVehicle(r)
    this.passengers.delete(r.avatar.root)
    r.avatar.root.parent = null
    r.avatar.dispose((mesh) => this.ctx.unregisterDynamic(mesh))
    disposeRig(r.rod, (mesh) => this.ctx.unregisterDynamic(mesh))
    disposeRig(r.rifle, (mesh) => this.ctx.unregisterDynamic(mesh))
    r.tag.remove()
    this.remotes.delete(id)
    this.rebuildMembers()
  }
}
