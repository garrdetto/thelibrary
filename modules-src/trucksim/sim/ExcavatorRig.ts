/**
 * The drivable 20.5 t tracked excavator for lowboy jobs. The undercarriage rides on ray-cast rollers (suspension only); the
 * tracks drive it by pushing it along the ground they touch, so it climbs ramps and decks, counter-rotates for pivot turns and
 * holds still on a slope, and it only has traction while the rollers are down. House swing, boom, stick and bucket follow a
 * `MachineInput` at hydraulic speeds (no arm colliders). `secureTo(trailer)` chains it down on an RGN's well deck: its body
 * sleeps, its mass becomes the trailer's payload and its pose rides with the deck until `release`.
 */
import type RAPIER from '@dimforge/rapier3d-compat'
import type { PhysicsHost } from './PhysicsHost'
import { GRAVITY, WheelSet, forwardOf, headingQuat, holdBias, upOf } from './TruckRig'
import type { RigState, Spawn, WheelDef } from './TruckRig'
import type { TrailerRig } from './TrailerRig'
import { worldToLocal } from './Coupling'
import { toWorld } from './types'
import type { ExcavatorPose, MachineInput, Quat, Vec3 } from './types'

/** Operating mass, kg. */
export const EXCAVATOR_MASS_KG = 20500
/** Track centre-to-centre gauge, m. */
export const TRACK_GAUGE = 2.2
/** Width over the tracks, m. */
export const EXCAVATOR_WIDTH = 2.8
/** Track length on the ground, m. */
export const TRACK_LENGTH = 3.7
/** High-range travel speed, m/s (about 5.4 km/h). */
export const TRAVEL_SPEED = 1.5
/** Travel acceleration, m/s². */
export const TRAVEL_ACCEL = 0.8
/** Pivot-turn rate, rad/s. */
export const TURN_RATE = 0.45
/** Track-on-ground friction for traction. */
export const TRACK_MU = 0.7
/** House swing speed, rad/s. */
export const SWING_RATE = 1.0
/** Boom speed, rad/s. */
export const BOOM_RATE = 0.45
/** Stick speed, rad/s. */
export const STICK_RATE = 0.6
/** Bucket speed, rad/s. */
export const BUCKET_RATE = 1.0
/** Boom angle above horizontal, min and max, rad. */
export const BOOM_LIMITS: [number, number] = [-0.6, 1.1]
/** Stick curl from the boom line, min and max, rad. */
export const STICK_LIMITS: [number, number] = [0.4, 2.6]
/** Bucket curl, min and max, rad. */
export const BUCKET_LIMITS: [number, number] = [-0.7, 2.4]
/** Transport pose: boom low, stick and bucket tucked. */
export const TRANSPORT_POSE = { boom: 0.15, stick: 2.4, bucket: 2.2 }
/** Fastest the machine may still be moving to be chained down, m/s. */
export const SECURE_SPEED = 0.3

const ROLLER_RADIUS = 0.25
const ROLLER_Z = [-1.8, -0.9, 0, 0.9, 1.8]
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Whether the machine can be (or was) chained down, and why not. */
export interface SecureCheck {
  ok: boolean
  reason?: 'not-lowboy' | 'off-deck' | 'moving' | 'secured'
}

/** The drivable tracked excavator. Call `update` once per fixed step before the world steps. */
export class ExcavatorRig {
  readonly host: PhysicsHost
  readonly body: RAPIER.RigidBody
  readonly wheels: WheelSet
  /** The trailer it is chained to, or null. */
  secured: TrailerRig | null = null
  swing = 0
  boom = TRANSPORT_POSE.boom
  stick = TRANSPORT_POSE.stick
  bucket = TRANSPORT_POSE.bucket
  /** Track travel for tread scrolling, m. */
  trackL = 0
  trackR = 0
  /** Forward speed at the last update, m/s. */
  speed = 0
  private travel = 0
  private readonly bias: number
  private readonly state: RigState
  private readonly poseOut: ExcavatorPose
  private readonly rideAt: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly rideRot: Quat = { x: 0, y: 0, z: 0, w: 1 }
  private readonly normal: Vec3 = { x: 0, y: 1, z: 0 }
  private readonly impulse: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly angvel: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly scratch: Vec3 = { x: 0, y: 0, z: 0 }
  /** True once `dispose` has run. */
  disposed = false

  constructor(host: PhysicsHost, spawn: Spawn) {
    this.host = host
    this.bias = holdBias(host)
    const R = host.rapier
    const load = (EXCAVATOR_MASS_KG * GRAVITY) / (ROLLER_Z.length * 2)
    const defs: WheelDef[] = []
    for (const z of ROLLER_Z) {
      for (const side of [1, -1]) {
        defs.push({
          x: (side * TRACK_GAUGE) / 2, z, radius: ROLLER_RADIUS, steer: false, drive: false, dual: false, lift: false,
          fullLoad: load * 3, designLoad: load, serviceBrake: 0, parkBrake: 0, traction: false,
        })
      }
    }
    const reach = 2.2
    const ground = spawn.y ?? Math.max(
      host.heightAt(spawn.x, spawn.z),
      host.heightAt(spawn.x + Math.sin(spawn.heading) * reach, spawn.z + Math.cos(spawn.heading) * reach),
      host.heightAt(spawn.x - Math.sin(spawn.heading) * reach, spawn.z - Math.cos(spawn.heading) * reach),
    )
    this.body = host.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, ground + 0.03, spawn.z)
        .setRotation(headingQuat(spawn.heading))
        .setLinearDamping(0.05)
        .setAngularDamping(0.8)
        .setCanSleep(false),
    )
    const m = EXCAVATOR_MASS_KG
    const groups = host.groups.machine
    host.world.createCollider(
      R.ColliderDesc.cuboid(EXCAVATOR_WIDTH / 2, 0.32, 2.2)
        .setTranslation(0, 0.6, 0)
        .setMassProperties(m, { x: 0, y: 0.45, z: -0.2 }, { x: (m / 12) * (2.2 * 2.2 + 4.4 * 4.4), y: (m / 12) * (2.8 * 2.8 + 4.4 * 4.4), z: (m / 12) * (2.8 * 2.8 + 2.2 * 2.2) }, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.6)
        .setCollisionGroups(groups),
      this.body,
    )
    host.world.createCollider(R.ColliderDesc.cuboid(1.3, 0.5, 1.5).setTranslation(0, 1.45, -0.4).setDensity(0).setFriction(0.5).setCollisionGroups(groups), this.body)
    host.world.createCollider(R.ColliderDesc.cuboid(0.5, 0.5, 0.55).setTranslation(0.75, 2.4, 0.55).setDensity(0).setFriction(0.5).setCollisionGroups(groups), this.body)
    this.wheels = new WheelSet(host, this.body, defs, m)
    const pos = this.body.translation()
    const rot = this.body.rotation()
    this.state = {
      position: { x: pos.x, y: pos.y, z: pos.z }, rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      forward: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 },
    }
    forwardOf(this.state.rotation, this.state.forward)
    upOf(this.state.rotation, this.state.up)
    this.poseOut = {
      position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, swing: 0, boom: this.boom, stick: this.stick, bucket: this.bucket, trackL: 0, trackR: 0,
    }
  }

  get massKg(): number {
    return EXCAVATOR_MASS_KG
  }

  readState(): RigState {
    const s = this.state
    if (this.secured?.disposed) this.dropOff()
    if (this.secured) {
      const ts = this.secured.readState()
      toWorld(ts, this.rideAt, s.position)
      multiply(ts.rotation, this.rideRot, s.rotation)
    } else {
      const t = this.body.translation()
      const r = this.body.rotation()
      s.position.x = t.x
      s.position.y = t.y
      s.position.z = t.z
      s.rotation.x = r.x
      s.rotation.y = r.y
      s.rotation.z = r.z
      s.rotation.w = r.w
    }
    forwardOf(s.rotation, s.forward)
    upOf(s.rotation, s.up)
    return s
  }

  /** Steps the arm and, unless chained down, the tracks and rollers. Call once per fixed step before the world steps. */
  update(dt: number, input: MachineInput): void {
    if (this.disposed) return
    if (this.secured) {
      this.readState()
      return
    }
    this.swing += clamp(input.swing, -1, 1) * SWING_RATE * dt
    this.boom = clamp(this.boom + clamp(input.boom, -1, 1) * BOOM_RATE * dt, BOOM_LIMITS[0], BOOM_LIMITS[1])
    this.stick = clamp(this.stick + clamp(input.stick, -1, 1) * STICK_RATE * dt, STICK_LIMITS[0], STICK_LIMITS[1])
    this.bucket = clamp(this.bucket + clamp(input.bucket, -1, 1) * BUCKET_RATE * dt, BUCKET_LIMITS[0], BUCKET_LIMITS[1])
    const s = this.readState()
    this.wheels.refreshGrip(s)
    this.wheels.update(dt, this.host.groups.wheelRay)
    this.wheels.readNormals()
    let contacts = 0
    let support = 0
    for (let i = 0; i < this.wheels.count; i++) {
      if (this.wheels.normal[i] <= 0) continue
      contacts++
      support += this.wheels.normal[i]
    }
    const n = this.normal
    n.x = s.up.x
    n.y = s.up.y
    n.z = s.up.z
    const v = this.body.linvel()
    const forward = s.forward
    this.speed = v.x * forward.x + v.y * forward.y + v.z * forward.z
    const drive = clamp(input.drive, -1, 1)
    const turn = clamp(input.turn, -1, 1)
    const target = drive * TRAVEL_SPEED * (1 - 0.35 * Math.abs(turn))
    this.travel += clamp(target - this.travel, -TRAVEL_ACCEL * dt, TRAVEL_ACCEL * dt)
    if (contacts >= 3) {
      const along = forward.x * n.x + forward.y * n.y + forward.z * n.z
      let fx = forward.x - n.x * along
      let fy = forward.y - n.y * along
      let fz = forward.z - n.z * along
      const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1
      fx /= fl
      fy /= fl
      fz /= fl
      const vn = v.x * n.x + v.y * n.y + v.z * n.z
      const px = v.x - n.x * vn
      const py = v.y - n.y * vn
      const pz = v.z - n.z * vn
      const gn = -GRAVITY * n.y
      const gx = -n.x * gn
      const gy = -GRAVITY - n.y * gn
      const gz = -n.z * gn
      const m = EXCAVATOR_MASS_KG
      const b = this.bias
      let ix = m * (fx * this.travel - px) - m * gx * dt * b
      let iy = m * (fy * this.travel - py) - m * gy * dt * b
      let iz = m * (fz * this.travel - pz) - m * gz * dt * b
      const limit = TRACK_MU * this.wheels.grip[0] * Math.max(support, m * GRAVITY * 0.5) * dt
      const size = Math.sqrt(ix * ix + iy * iy + iz * iz)
      if (size > limit) {
        ix *= limit / size
        iy *= limit / size
        iz *= limit / size
      }
      this.impulse.x = ix
      this.impulse.y = iy
      this.impulse.z = iz
      this.body.applyImpulse(this.impulse, true)
      const w = this.body.angvel()
      const yaw = turn * TURN_RATE * (Math.abs(drive) > 0.05 ? 0.7 : 1)
      const current = w.x * n.x + w.y * n.y + w.z * n.z
      const next = current + clamp(yaw - current, -2 * dt, 2 * dt)
      this.angvel.x = w.x + n.x * (next - current)
      this.angvel.y = w.y + n.y * (next - current)
      this.angvel.z = w.z + n.z * (next - current)
      this.body.setAngvel(this.angvel, true)
    }
    const yawRate = contacts >= 3 ? this.angvel.y : this.body.angvel().y
    this.trackL += (this.speed - (yawRate * TRACK_GAUGE) / 2) * dt
    this.trackR += (this.speed + (yawRate * TRACK_GAUGE) / 2) * dt
  }

  /** Is the machine standing still on the RGN's well deck, so it can be chained down? */
  checkSecure(trailer: TrailerRig): SecureCheck {
    if (this.secured) return { ok: false, reason: 'secured' }
    const rgn = trailer.model.rgn
    if (!trailer.isLowboy || !rgn) return { ok: false, reason: 'not-lowboy' }
    const local = worldToLocal(trailer.readState(), this.readState().position, this.scratch)
    const half = TRACK_LENGTH / 2
    const onWell = local.z <= rgn.wellFrontZ - half + 0.4 && local.z >= rgn.wellRearZ + half - 0.4 && Math.abs(local.x) <= 0.6 && Math.abs(local.y - rgn.wellHeight) <= 0.35
    if (!onWell) return { ok: false, reason: 'off-deck' }
    const v = this.body.linvel()
    const tv = trailer.body.linvel()
    const rel = Math.sqrt((v.x - tv.x) ** 2 + (v.y - tv.y) ** 2 + (v.z - tv.z) ** 2)
    if (rel > SECURE_SPEED) return { ok: false, reason: 'moving' }
    return { ok: true }
  }

  /** Chains the machine down on the well deck: it becomes `trailer`'s payload and rides with it. */
  secureTo(trailer: TrailerRig): SecureCheck {
    const check = this.checkSecure(trailer)
    if (!check.ok) return check
    const ts = trailer.readState()
    const s = this.readState()
    worldToLocal(ts, s.position, this.rideAt)
    const q = ts.rotation
    multiply({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, s.rotation, this.rideRot)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, false)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, false)
    this.body.setEnabled(false)
    this.secured = trailer
    this.travel = 0
    this.speed = 0
    trailer.setPayload(EXCAVATOR_MASS_KG, { y: this.rideAt.y + 1.0, z: this.rideAt.z })
    return check
  }

  private dropOff(): void {
    const s = this.state
    this.secured = null
    this.body.setEnabled(true)
    this.body.setTranslation(s.position, true)
    this.body.setRotation(s.rotation, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  }

  /** Unchains the machine where it rides (or at `spawn`) and takes its mass off the trailer. */
  release(spawn?: Spawn): void {
    const trailer = this.secured
    if (!trailer) return
    const s = this.readState()
    this.secured = null
    trailer.setPayload(0)
    this.body.setEnabled(true)
    if (spawn) {
      const ground = spawn.y ?? this.host.heightAt(spawn.x, spawn.z)
      this.body.setTranslation({ x: spawn.x, y: ground + 0.05, z: spawn.z }, true)
      this.body.setRotation(headingQuat(spawn.heading), true)
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    } else {
      this.body.setTranslation(s.position, true)
      this.body.setRotation(s.rotation, true)
      this.body.setLinvel(trailer.body.linvel(), true)
    }
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.readState()
  }

  /** Puts the machine down at (x, z) facing `heading`, stopped (releases it first if chained). */
  teleport(x: number, z: number, heading: number, y?: number): void {
    if (this.secured) this.release({ x, z, heading, y })
    const ground = y ?? this.host.heightAt(x, z)
    this.body.setTranslation({ x, y: ground + 0.05, z }, true)
    this.body.setRotation(headingQuat(heading), true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.travel = 0
    this.readState()
  }

  /** The machine's pose for the renderer (one reused object). */
  pose(): ExcavatorPose {
    const s = this.disposed ? this.state : this.readState()
    const p = this.poseOut
    p.position.x = s.position.x
    p.position.y = s.position.y
    p.position.z = s.position.z
    p.rotation.x = s.rotation.x
    p.rotation.y = s.rotation.y
    p.rotation.z = s.rotation.z
    p.rotation.w = s.rotation.w
    p.swing = this.swing
    p.boom = this.boom
    p.stick = this.stick
    p.bucket = this.bucket
    p.trackL = this.trackL
    p.trackR = this.trackR
    return p
  }

  dispose(): void {
    if (this.disposed) return
    if (this.secured && !this.secured.disposed) this.secured.setPayload(0)
    this.secured = null
    this.disposed = true
    this.wheels.dispose()
    this.host.world.removeRigidBody(this.body)
  }
}

function multiply(a: Quat, b: Quat, out: Quat): Quat {
  const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y
  const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x
  const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
  const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  out.x = x
  out.y = y
  out.z = z
  out.w = w
  return out
}
