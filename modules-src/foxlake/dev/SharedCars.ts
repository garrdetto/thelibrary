/**
 * Spawned vehicles (the developer panel's) as this player meets them.
 *
 * The shared world keeps every spawned vehicle in its snapshots and decides
 * who is driving it (shared/DevTools.ts). While it is parked or someone else
 * drives it, town/Neighbors.ts draws it like any neighbor's car. Pressing E
 * beside a parked one asks the world for it; once the world says this player
 * is the driver, the snapshot car is swapped for a real Fox Plains Rapier car
 * (the same fp/physics/Vehicle.ts the player's own cars are) driven through
 * Rack & Reel's vehicle controller, and its pose goes out with every state
 * message. Getting out lets it roll to a stop, then hands it back, and the
 * snapshot car takes over where it stopped.
 */
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { GameHost } from '../../rackreel/game/Game'
import type { DriveInput, ExternalDriver, Vehicle as RrVehicle } from '../../rackreel/systems/VehicleController'
import { Vehicle } from '../fp/physics/Vehicle'
import type { Physics } from '../fp/physics/Physics'
import type { VehicleModels } from '../fp/physics/VehicleModels'
import { isSharedVehicleId } from '../../maplestreet/shared/DevTools'
import { VEHICLES } from '../../maplestreet/shared/Economy'
import type { ClientMsg, SharedVehicleInfo, VehicleSnap } from '../../maplestreet/shared/Protocol'
import { TUNING } from '../../maplestreet/shared/Vehicles'
import { sceneToTown } from '../region'

/** The same reach Rack & Reel gives its own vehicles. */
const ENTER_RANGE = 4.2
const CLAIM_TIMEOUT_MS = 2500
/** After getting out: handed back once it has stopped, or after this long. */
const SETTLE_MAX = 3
const SETTLE_MIN = 0.5
const REST_SPEED = 0.15
const FLUSH_MAX = 1
const HANDBACK_MAX = 2

type Phase = 'driving' | 'settling' | 'flushing' | 'released'

interface Local {
  id: string
  fp: Vehicle
  rr: RrVehicle | null
  seat: TransformNode
  phase: Phase
  timer: number
  /** A state message carrying the stopped pose has gone out. */
  flushed: boolean
  /** The snapshot car is back in the snapshots under the world's name. */
  handedBack: boolean
}

export interface SharedCarsHost {
  host: GameHost
  physics: Physics
  models: VehicleModels
  send(m: ClientMsg): void
  self(): string | null
  /** Stops drawing the snapshot copy of a vehicle at once. */
  dropRemote(id: string): void
}

export interface SpawnedRow {
  id: string
  kind: string
  name: string
  driver: string | null
  /** Milliseconds until it disappears. */
  left: number
}

const _f = new Vector3()
const _t = { x: 0, y: 0, z: 0 }

export class SharedCars implements ExternalDriver {
  private infos: (SharedVehicleInfo & { until: number })[] = []
  private readonly poses = new Map<string, VehicleSnap>()
  private local: Local | null = null
  private pending: { id: string; at: number } | null = null

  constructor(private readonly deps: SharedCarsHost) {}

  /** A new welcome (first join or a reconnect): the world has parked whatever this player was driving. */
  reset(): void {
    this.pending = null
    this.discard(true)
    this.infos = []
    this.poses.clear()
  }

  rows(): SpawnedRow[] {
    const now = performance.now()
    return this.infos.map((v) => ({ id: v.id, kind: v.kind, name: VEHICLES[v.kind]?.name ?? 'Vehicle', driver: v.driver, left: Math.max(0, v.until - now) }))
  }

  /** The world's list changed: who drives what, and what is gone. */
  setList(list: SharedVehicleInfo[]): void {
    const now = performance.now()
    for (const old of this.infos) if (!list.some((v) => v.id === old.id)) this.deps.dropRemote(old.id)
    this.infos = list.map((v) => ({ ...v, until: now + v.left }))
    for (const id of [...this.poses.keys()]) if (!list.some((v) => v.id === id)) this.poses.delete(id)
    const me = this.deps.self()
    const local = this.local
    const mine = local ? list.find((v) => v.id === local.id) : undefined
    if (local && (!mine || (mine.driver !== me && local.phase !== 'released'))) this.discard(true)
    for (const v of list) {
      if (!me || v.driver !== me || this.local?.id === v.id) continue
      if (this.pending?.id === v.id) this.pending = null
      if (!this.begin(v)) this.deps.send({ t: 'shared', op: 'release', id: v.id })
    }
    const asked = this.pending ? list.find((v) => v.id === this.pending!.id) : undefined
    if (this.pending && (!asked || asked.driver)) this.pending = null
  }

  /** Every snapshot: where each spawned vehicle is, and whether the one just handed back is the world's again. */
  onSnap(vehicles: VehicleSnap[]): void {
    const me = this.deps.self()
    for (const v of vehicles) {
      if (!isSharedVehicleId(v.id)) continue
      this.poses.set(v.id, v)
      if (this.local && this.local.id === v.id && this.local.phase === 'released' && v.owner !== me) this.local.handedBack = true
    }
  }

  /** The parked or taken spawned vehicle the player is standing at, unless one of their own is nearer. */
  private nearest(): { info: SharedVehicleInfo; kind: string } | null {
    const host = this.deps.host
    if (host.mode !== 'foot' || !this.infos.length) return null
    const p = host.player
    const t = sceneToTown(p.x, p.y, p.z, _t)
    let best: { info: SharedVehicleInfo; kind: string } | null = null
    let reach = ENTER_RANGE
    for (const info of this.infos) {
      if (this.local?.id === info.id) continue
      const pose = this.poses.get(info.id)
      if (!pose) continue
      const d = Math.hypot(pose.x - t.x, pose.y - t.y, pose.z - t.z)
      if (d >= reach) continue
      reach = d
      best = { info, kind: pose.kind }
    }
    if (!best) return null
    const own = host.vehicles.nearest(p, ENTER_RANGE)
    return own && own.root.isEnabled() && Vector3.Distance(p, own.position) < reach ? null : best
  }

  prompt(): string {
    const near = this.nearest()
    if (!near) return ''
    const name = VEHICLES[near.kind]?.name ?? 'vehicle'
    return near.info.driver ? `The ${name} is taken` : `E — drive the ${name} (spawned for anyone)`
  }

  /** E on foot beside a spawned vehicle: asks the world for it. */
  interact(): boolean {
    const near = this.nearest()
    if (!near) return false
    if (near.info.driver) {
      this.deps.host.hud.toast(`Someone else is driving the ${VEHICLES[near.kind]?.name ?? 'vehicle'}.`)
      return true
    }
    if (this.pending) return true
    if (!TUNING[near.kind]) {
      this.deps.host.hud.toast('That vehicle is not loaded on this device yet. Reload the page to drive it.', 'warn')
      return true
    }
    if (this.local && this.local.phase !== 'released') this.release(this.local)
    this.pending = { id: near.info.id, at: performance.now() }
    this.deps.send({ t: 'shared', op: 'claim', id: near.info.id })
    return true
  }

  /** The world made this player the driver: build the real car where the snapshot one stands and get in. */
  private begin(info: SharedVehicleInfo): boolean {
    const { host, physics, models } = this.deps
    const pose = this.poses.get(info.id)
    const tuning = pose ? TUNING[pose.kind] : undefined
    if (!pose || !tuning || host.mode !== 'foot' || !host.playing) return false
    this.discard(false)
    this.deps.dropRemote(info.id)
    const fp = new Vehicle(physics, models, pose.kind, info.id, { x: pose.x, y: pose.y, z: pose.z }, 0, null)
    fp.body.setTranslation({ x: pose.x, y: pose.y, z: pose.z }, true)
    fp.body.setRotation({ x: pose.qx, y: pose.qy, z: pose.qz, w: pose.qw }, true)
    fp.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    fp.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    physics.snapTracked(fp.body)
    fp.quiet(20)
    const seat = new TransformNode(`shared-seat-${info.id}`, host.ctx.scene)
    seat.rotationQuaternion = new Quaternion()
    const s = tuning.seat ?? { x: 0, y: 0.4, z: -0.4 }
    const rr = host.vehicles.addExternal(seat, this, new Vector3(), 0, new Vector3(s.z, s.y + 0.1, s.x), new Vector3(-(tuning.chassis.hz + 0.9), 0, 0), VEHICLES[pose.kind]?.name ?? tuning.label ?? 'car')
    this.local = { id: info.id, fp, rr, seat, phase: 'driving', timer: 0, flushed: false, handedBack: false }
    this.sync(this.local)
    host.enterVehicle(rr)
    return true
  }

  /** Rack & Reel's controller, each frame: the driver's input goes to the car. Getting back in before it is handed back carries on driving. */
  step(_dt: number, input: DriveInput, v: RrVehicle): void {
    const l = this.local
    if (!l || l.rr !== v || !v.occupied) return
    l.fp.input = { throttle: input.throttle, steer: -input.steer, brake: 0, handbrake: input.brake }
    if (l.phase !== 'driving') {
      l.phase = 'driving'
      l.flushed = false
    }
  }

  /** The driver got out (or was moved): brake, and hand it back once it has stopped. */
  park(v: RrVehicle): void {
    const l = this.local
    if (!l || l.rr !== v) return
    l.fp.input = { throttle: 0, steer: 0, brake: 1, handbrake: true }
    if (l.phase === 'driving') {
      l.phase = 'settling'
      l.timer = 0
    }
  }

  /** Adds this player's spawned car to an outgoing state message: its pose, and their seat in it while they drive. */
  stamp(state: Extract<ClientMsg, { t: 'state' }>): void {
    const l = this.local
    const me = this.deps.self()
    if (!l || !me || l.phase === 'released') return
    state.s = l.fp.snapshot(me)
    if (l.phase === 'driving') state.p.vehicleId = l.id
    else if (l.phase === 'flushing') l.flushed = true
  }

  /** Every frame, after the physics step and its render interpolation. */
  update(dt: number, night: number): void {
    if (this.pending && performance.now() - this.pending.at > CLAIM_TIMEOUT_MS) this.pending = null
    const l = this.local
    if (!l) return
    this.sync(l)
    l.fp.updateVisuals(night, l.phase !== 'driving' || l.fp.input.handbrake || (l.fp.input.throttle < 0 && l.fp.speed > 0.5))
    if (l.rr?.occupied && l.phase !== 'driving') {
      l.phase = 'driving'
      l.flushed = false
    }
    if (l.phase === 'driving') return
    l.timer += dt
    if (l.phase === 'settling') {
      if ((l.timer > SETTLE_MIN && Math.abs(l.fp.speed) < REST_SPEED) || l.timer > SETTLE_MAX) {
        l.fp.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        l.fp.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        l.phase = 'flushing'
        l.timer = 0
        l.flushed = false
      }
    } else if (l.phase === 'flushing') {
      if (l.flushed || l.timer > FLUSH_MAX) this.release(l)
    } else if (l.handedBack || l.timer > HANDBACK_MAX) this.discard(false)
  }

  /** Gives the car back to the world. The real car stays until the snapshot one is drawn again, so it never blinks out. */
  private release(l: Local): void {
    this.deps.send({ t: 'shared', op: 'release', id: l.id })
    if (l.rr) {
      this.deps.host.vehicles.remove(l.rr)
      l.rr = null
    }
    l.phase = 'released'
    l.timer = 0
    l.handedBack = false
  }

  /** Takes the real car away. `eject`: the player is still in it (it was removed, or the connection was replaced), so they are stood beside it first. */
  private discard(eject: boolean): void {
    const l = this.local
    if (!l) return
    this.local = null
    const { host } = this.deps
    if (l.rr) {
      if (eject && host.driving === l.rr) host.teleport(host.vehicles.localToWorld(l.rr, l.rr.exitSide), l.rr.heading)
      host.vehicles.remove(l.rr)
    }
    l.fp.dispose()
    l.seat.dispose()
  }

  /** Copies the car's interpolated pose into its Rack & Reel record and the seat stand-in (as town/Cars.ts does for the player's own cars). */
  private sync(l: Local): void {
    const root = l.fp.root
    root.computeWorldMatrix(true)
    const p = root.getAbsolutePosition()
    const f = l.fp.forward(_f)
    const heading = Math.atan2(f.x, -f.z)
    const pitch = -Math.asin(Math.max(-1, Math.min(1, f.y)))
    l.seat.position.copyFrom(p)
    Quaternion.FromEulerAnglesToRef(pitch, heading, 0, l.seat.rotationQuaternion!)
    const v = l.rr
    if (!v) return
    v.position.copyFrom(p)
    v.heading = heading
    v.pitch = pitch
    v.roll = 0
    v.speed = l.fp.speed
  }

  debug(): Record<string, unknown> {
    return { spawned: this.infos.map((v) => ({ id: v.id, kind: v.kind, driver: v.driver })), driving: this.local ? { id: this.local.id, phase: this.local.phase } : null, pending: this.pending?.id ?? null }
  }
}
