/**
 * Everyone else in the shared world, as Fox Lake draws them: neighbors are
 * Rack & Reel hunters (the one character Fox Lake uses), their vehicles are
 * the Fox Plains models under the town's node. Positions come from the same
 * snapshots classic Fox Plains reads, drawn 120 ms in the past and
 * interpolated. Vehicles get a view and a kinematic collider within 200 m;
 * simulated walkers only within 110 m. Real neighbors get a name tag. The
 * per-frame loop allocates nothing.
 */
import type RAPIER from '@dimforge/rapier3d-compat'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { MASK, type Physics } from '../fp/physics/Physics'
import type { VehicleModels, VehicleView } from '../fp/physics/VehicleModels'
import { TUNING } from '../../maplestreet/shared/Vehicles'
import type { PlayerSnap, VehicleSnap } from '../../maplestreet/shared/Protocol'
import { Avatar, HIP_HEIGHT } from '../../rackreel/game/Avatar'
import { instantiateSkinned } from '../../rackreel/core/SkinnedModel'
import type { SkinnedTemplate } from '../../rackreel/core/SkinnedModel'
import type { HeadPaint } from '../../rackreel/game/HeadPaint'
import { BEARDS, DEFAULT_APPEARANCE, FACES, HAIR } from '../../rackreel/shared/Appearance'
import { townToScene, townYawToHeading } from '../region'

const INTERP_DELAY_MS = 120
const V_SPAWN = 200
const V_DESPAWN = 240
const W_SPAWN = 110
const W_DESPAWN = 140
const TAG_RANGE = 70
const isNpc = (id: string) => id.startsWith('npc-')

/** Everyday outfits neighbors wear (picked from their name, so each neighbor always looks the same). */
const OUTFITS: string[][] = [
  ['jacket-flannel', 'vest-none', 'cap-backwards', 'pants-jeans', 'pack-none'],
  ['jacket-canvas', 'vest-none', 'cap-visor', 'pants-jeans', 'pack-none'],
  ['jacket-tank', 'vest-none', 'cap-cowboy', 'pants-khaki', 'pack-none'],
  ['jacket-angler', 'vest-none', 'cap-bucket', 'pants-khaki', 'pack-none'],
  ['jacket-camo', 'vest-none', 'cap-camo', 'pants-jeans', 'pack-none'],
]

class SnapBuffer<T> {
  private items: { t: number; s: T }[] = []
  push(t: number, s: T): void {
    if (this.items.length && t <= this.items[this.items.length - 1].t) return
    this.items.push({ t, s })
    if (this.items.length > 24) this.items.shift()
  }
  get latest(): T | null {
    return this.items.length ? this.items[this.items.length - 1].s : null
  }
  sample(t: number): { a: T; b: T; k: number } | null {
    const it = this.items
    if (!it.length) return null
    if (t <= it[0].t) return { a: it[0].s, b: it[0].s, k: 0 }
    for (let i = it.length - 1; i > 0; i--) {
      if (it[i - 1].t <= t) {
        if (t >= it[i].t) return { a: it[i].s, b: it[i].s, k: 0 }
        return { a: it[i - 1].s, b: it[i].s, k: (t - it[i - 1].t) / Math.max(1, it[i].t - it[i - 1].t) }
      }
    }
    return { a: it[it.length - 1].s, b: it[it.length - 1].s, k: 0 }
  }
}

interface RemoteVehicle { kind: string; owner: string; buf: SnapBuffer<VehicleSnap>; seen: number; view: VehicleView | null; body: RAPIER.RigidBody | null; fresh: boolean; spin: number[]; style: VehicleSnap['style'] }
interface RemotePlayer { name: string; color: string; npc: boolean; avatar: Avatar | null; buf: SnapBuffer<PlayerSnap>; seen: number; tag: HTMLDivElement | null; outfit: string[]; shown: Vector3; facing: number }

const _p = new Vector3()
const _s = new Vector3()
const _seat = new Vector3()
const _fwd = new Vector3()
const _qa = new Quaternion()
const _qb = new Quaternion()
const _pos = { x: 0, y: 0, z: 0 }
const _rot = { x: 0, y: 0, z: 0, w: 1 }
const _scene = { x: 0, y: 0, z: 0 }

function hashName(name: string): number {
  let h = 0
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

export interface NeighborHost {
  scene: Scene
  camera: Camera
  hunter: SkinnedTemplate
  paint: HeadPaint
  townRoot: TransformNode
  register(mesh: AbstractMesh): void
  unregister(mesh: AbstractMesh): void
}

export class Neighbors {
  private players = new Map<string, RemotePlayer>()
  private vehicles = new Map<string, RemoteVehicle>()
  private clockOffset: number | null = null
  private tags: HTMLDivElement
  readonly ownerNames = new Map<string, string>()

  constructor(private readonly physics: Physics, private readonly models: VehicleModels, private readonly host: NeighborHost, private readonly selfId: () => string | null) {
    this.tags = document.createElement('div')
    this.tags.id = 'town-tags'
    this.tags.className = 'hud name-tags'
    document.body.appendChild(this.tags)
  }

  get count(): number {
    let n = 0
    for (const p of this.players.values()) if (!p.npc) n++
    return n
  }

  /** Names of real neighbors, for the HUD. */
  names(): string[] {
    const out: string[] = []
    for (const p of this.players.values()) if (!p.npc) out.push(p.name)
    return out
  }

  ingest(time: number, players: PlayerSnap[], vehicles: VehicleSnap[]): void {
    const offset = time - Date.now()
    this.clockOffset = this.clockOffset === null ? offset : this.clockOffset * 0.95 + offset * 0.05
    const me = this.selfId()
    const now = performance.now()
    for (const p of players) {
      if (p.id === me) continue
      let rp = this.players.get(p.id)
      if (!rp) {
        rp = { name: p.name, color: p.color, npc: isNpc(p.id), avatar: null, buf: new SnapBuffer(), seen: now, tag: null, outfit: OUTFITS[hashName(p.name) % OUTFITS.length], shown: new Vector3(), facing: 0 }
        this.players.set(p.id, rp)
      }
      this.ownerNames.set(p.id, p.name)
      rp.buf.push(time, p)
      rp.seen = now
    }
    for (const v of vehicles) {
      if (v.owner === me) continue
      let rv = this.vehicles.get(v.id)
      if (!rv) {
        rv = { kind: v.kind, owner: v.owner, buf: new SnapBuffer(), seen: now, view: null, body: null, fresh: false, spin: [], style: null }
        this.vehicles.set(v.id, rv)
      }
      rv.style = v.style ?? null
      rv.view?.setStyle(rv.style)
      rv.buf.push(time, v)
      rv.seen = now
    }
    for (const [id, rp] of this.players) if (now - rp.seen > 3000) this.removePlayer(id)
    for (const [id, rv] of this.vehicles) if (now - rv.seen > 3000) this.removeVehicle(id)
  }

  removeOwner(sessionId: string): void {
    this.removePlayer(sessionId)
    for (const [id] of this.vehicles) if (id.startsWith(`${sessionId}:`)) this.removeVehicle(id)
  }

  clear(): void {
    for (const id of [...this.players.keys()]) this.removePlayer(id)
    for (const id of [...this.vehicles.keys()]) this.removeVehicle(id)
  }

  private makeAvatar(rp: RemotePlayer): Avatar {
    const avatar = new Avatar(instantiateSkinned(this.host.hunter, this.host.scene, (mesh) => this.host.register(mesh)))
    avatar.setOutfit(rp.outfit)
    const h = hashName(rp.name)
    avatar.setAppearance({ ...DEFAULT_APPEARANCE, face: FACES[h % FACES.length].id, hair: HAIR[(h >>> 4) % HAIR.length].id, beard: BEARDS[(h >>> 8) % BEARDS.length].id }, this.host.paint)
    return avatar
  }

  private dropAvatar(rp: RemotePlayer): void {
    rp.avatar?.dispose((mesh) => this.host.unregister(mesh))
    rp.avatar = null
  }

  private removePlayer(id: string): void {
    const rp = this.players.get(id)
    if (!rp) return
    this.dropAvatar(rp)
    rp.tag?.remove()
    this.players.delete(id)
  }

  private removeVehicle(id: string): void {
    const rv = this.vehicles.get(id)
    if (!rv) return
    this.release(rv)
    this.vehicles.delete(id)
  }

  private acquire(rv: RemoteVehicle): void {
    const R = this.physics.R
    const P = TUNING[rv.kind] ?? TUNING.sedan
    rv.view = this.models.build(rv.kind, rv.style)
    rv.view.root.parent = this.host.townRoot
    rv.view.root.rotationQuaternion ??= new Quaternion()
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased())
    this.physics.world.createCollider(this.physics.vehicleShape(P.chassis.hx, P.chassis.hy, P.chassis.hz).setCollisionGroups(P.tongue ? MASK.remoteTrailer : MASK.remote), body)
    rv.body = body
    rv.fresh = true
    rv.spin = rv.view.wheels.map(() => 0)
  }

  private release(rv: RemoteVehicle): void {
    rv.view?.destroy()
    rv.view = null
    if (rv.body) this.physics.world.removeRigidBody(rv.body)
    rv.body = null
  }

  update(dt: number, night: number, focus: { x: number; z: number }): void {
    if (this.clockOffset === null) return
    const t = Date.now() + this.clockOffset - INTERP_DELAY_MS
    for (const rv of this.vehicles.values()) {
      const last = rv.buf.latest
      if (!last) continue
      const d2 = (last.x - focus.x) ** 2 + (last.z - focus.z) ** 2
      if (!rv.view) {
        if (d2 < V_SPAWN * V_SPAWN) this.acquire(rv)
        else continue
      } else if (d2 > V_DESPAWN * V_DESPAWN) {
        this.release(rv)
        continue
      }
      const s = rv.buf.sample(t)
      if (!s || !rv.view || !rv.body) continue
      const { a, b, k } = s
      const root = rv.view.root
      const q = root.rotationQuaternion!
      root.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k)
      _qa.set(a.qx, a.qy, a.qz, a.qw)
      _qb.set(b.qx, b.qy, b.qz, b.qw)
      Quaternion.SlerpToRef(_qa, _qb, k, q)
      const speed = a.speed + (b.speed - a.speed) * k
      const steer = a.steer + (b.steer - a.steer) * k
      const axles = (TUNING[rv.kind] ?? TUNING.sedan).axles
      const wheels = rv.view.wheels
      for (let i = 0; i < wheels.length; i++) {
        const w = wheels[i]
        const ax = axles[w.axle]
        rv.spin[i] -= (speed * dt) / (ax?.radius ?? 0.35)
        w.steer.rotation.y = ax?.steer ? steer : 0
        w.spin.rotation.z = rv.spin[i]
      }
      rv.view.setLamps(night, false)
      _pos.x = root.position.x
      _pos.y = root.position.y
      _pos.z = root.position.z
      _rot.x = q.x
      _rot.y = q.y
      _rot.z = q.z
      _rot.w = q.w
      if (rv.fresh) {
        rv.body.setTranslation(_pos, true)
        rv.body.setRotation(_rot, true)
        rv.fresh = false
      }
      rv.body.setNextKinematicTranslation(_pos)
      rv.body.setNextKinematicRotation(_rot)
    }

    for (const rp of this.players.values()) {
      const s = rp.buf.sample(t)
      if (!s) continue
      const { a, b, k } = s
      const vid = b.vehicleId ?? a.vehicleId
      if (vid) {
        const rv = this.vehicles.get(vid)
        if (rv?.view) {
          if (!rp.avatar) rp.avatar = this.makeAvatar(rp)
          this.seatIn(rp, rv)
          rp.avatar.update(dt, { stance: 'sit', hands: 'wheel', speed: 0, crouch: false, castPower: 0, aimPitch: 0, climbPhase: 0 })
          this.placeTag(rp, rp.avatar.root.position, 1.5)
        } else {
          this.dropAvatar(rp)
          this.placeTag(rp, null, 0)
        }
        continue
      }
      _p.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k)
      const d2 = (_p.x - focus.x) ** 2 + (_p.z - focus.z) ** 2
      if (rp.npc && !rp.avatar && d2 > W_SPAWN * W_SPAWN) continue
      if (rp.npc && rp.avatar && d2 > W_DESPAWN * W_DESPAWN) {
        this.dropAvatar(rp)
        continue
      }
      if (!rp.avatar) rp.avatar = this.makeAvatar(rp)
      townToScene(_p.x, _p.y, _p.z, _scene)
      const root = rp.avatar.root
      root.parent = null
      root.rotationQuaternion = null
      root.position.set(_scene.x, _scene.y, _scene.z)
      let dy = b.yaw - a.yaw
      dy = Math.atan2(Math.sin(dy), Math.cos(dy))
      root.rotation.set(0, townYawToHeading(a.yaw + dy * k), 0)
      rp.avatar.update(dt, { stance: 'stand', hands: 'free', speed: a.speed + (b.speed - a.speed) * k, crouch: false, castPower: 0, aimPitch: 0, climbPhase: 0 })
      this.placeTag(rp, root.position, 2.05)
    }
  }

  /** Puts a neighbor in the driver's seat of their vehicle (the vehicle sits under the mirrored town node; the hunter does not). */
  private seatIn(rp: RemotePlayer, rv: RemoteVehicle): void {
    const view = rv.view!
    const seat = (TUNING[rv.kind] ?? TUNING.sedan).seat
    view.root.computeWorldMatrix(true)
    const world = view.root.getWorldMatrix()
    Vector3.TransformCoordinatesFromFloatsToRef(seat.x, seat.y, seat.z, world, _seat)
    Vector3.TransformNormalFromFloatsToRef(1, 0, 0, world, _fwd)
    const root = rp.avatar!.root
    root.parent = null
    root.rotationQuaternion = null
    root.position.set(_seat.x, _seat.y + 0.1 - HIP_HEIGHT, _seat.z)
    root.rotation.set(0, Math.atan2(_fwd.x, _fwd.z), 0)
  }

  private placeTag(rp: RemotePlayer, at: { x: number; y: number; z: number } | null, lift: number): void {
    if (rp.npc) return
    const cam = this.host.camera.globalPosition
    const visible = at && (at.x - cam.x) ** 2 + (at.z - cam.z) ** 2 < TAG_RANGE * TAG_RANGE
    const screen = visible ? this.toScreen(_s.set(at.x, at.y + lift, at.z)) : null
    if (!screen) {
      if (rp.tag) rp.tag.style.display = 'none'
      return
    }
    if (!rp.tag) {
      rp.tag = document.createElement('div')
      rp.tag.className = 'name-tag'
      const dot = document.createElement('i')
      dot.style.background = rp.color
      rp.tag.append(dot, document.createTextNode(rp.name))
      this.tags.appendChild(rp.tag)
    }
    rp.tag.style.display = ''
    rp.tag.style.transform = `translate(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px) translate(-50%, -100%)`
  }

  private toScreen(p: Vector3): { x: number; y: number } | null {
    const engine = this.host.scene.getEngine()
    const w = engine.getRenderWidth()
    const h = engine.getRenderHeight()
    const vp = this.host.camera.viewport.toGlobal(w, h)
    const out = Vector3.Project(p, Matrix.IdentityReadOnly, this.host.scene.getTransformMatrix(), vp)
    if (out.z < 0 || out.z > 1) return null
    const canvas = engine.getRenderingCanvas()
    const scale = canvas ? canvas.clientWidth / w : 1
    return { x: out.x * scale, y: out.y * scale }
  }

  dispose(): void {
    this.clear()
    this.tags.remove()
  }
}
