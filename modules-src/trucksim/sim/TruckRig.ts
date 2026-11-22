/**
 * A drivable truck on Rapier: a chassis body whose origin is the vehicle frame (on the ground under the front axle, +Z forward,
 * +X left) with the catalog mass and a low centre of mass toward the rear, and one ray-cast wheel per axle side. Springs are
 * real spring rates (sized so the fully loaded truck sits about 9 cm down at its ride height, rescaled whenever the payload
 * changes because Rapier multiplies them by the chassis mass), tyre grip follows the surface under each wheel, steering lock
 * falls off with speed (Ackermann on the steer axle), the engine and gearbox are `Drivetrain`, air brakes build pressure with a
 * short lag and are limited by grip (no lock-ups), the parking brake holds on the drive axles, lift axles drop under load, and
 * a dump truck carries a `DumpBody` whose load is payload mass. `WheelSet`, the wheel and brake model, is shared with
 * `TrailerRig` and `ExcavatorRig`.
 */
import type RAPIER from '@dimforge/rapier3d-compat'
import { FIFTH_WHEEL_HEIGHT } from '../shared/Catalog'
import type { TruckModel } from '../shared/Catalog'
import type { PhysicsHost } from './PhysicsHost'
import { Drivetrain } from './Drivetrain'
import type { DrivetrainInput } from './Drivetrain'
import { DumpBody } from './Dump'
import { toWorld } from './types'
import type { BodyPose, DriveInput, TruckPose, Vec3, WheelPose } from './types'
import type { TrailerRig } from './TrailerRig'

/** m/s². */
export const GRAVITY = 9.81
/** Suspension length with the spring unloaded, m. */
export const SUSPENSION_REST = 0.32
/** Most a spring compresses from its rest length, m. */
export const SUSPENSION_TRAVEL = 0.2
/** Static spring compression with the vehicle fully loaded, m. */
export const SAG_FULL = 0.09
/** Damping ratio in bump. */
export const DAMPING_BUMP = 0.3
/** Damping ratio in rebound. */
export const DAMPING_REBOUND = 0.5
/** A wheel's suspension force cap as a multiple of its fully loaded static load. */
export const MAX_SUSPENSION_SHARE = 3.5
/** Peak sideways tyre friction on dry asphalt (Rapier friction slip, scaled by surface grip). */
export const TYRE_MU_SIDE = 0.95
/** Peak tyre friction for drive and brake forces on dry asphalt (scaled by surface grip). */
export const TYRE_MU_LONG = 0.85
/** Service brake capacity per wheel as a share of its fully loaded static load (0.5 g for a loaded rig). */
export const SERVICE_BRAKE_G = 0.5
/** Spring (parking) brake capacity per braked wheel as a share of its fully loaded static load. */
export const PARK_BRAKE_G = 0.6
/** Seconds for the air brakes to apply fully. */
export const AIR_APPLY_SECONDS = 0.3
/** Seconds for the air brakes to release fully. */
export const AIR_RELEASE_SECONDS = 0.45
/** Steer lock at walking pace, rad (about 35°). */
export const MAX_STEER = 0.62
/** Road speed (m/s) at which the steer lock has halved. */
export const STEER_FADE_SPEED = 9
/** How fast the road wheels steer, rad/s. */
export const STEER_RATE = 0.9
/** Truck tyre rolling-resistance coefficient. */
export const ROLLING_RESISTANCE = 0.0065
/** kg/m³, for aerodynamic drag. */
export const AIR_DENSITY = 1.2
/** A change in velocity larger than this in one step is an impact (m/s). */
export const IMPACT_DV = 3
/** Kingpin load a tractor's springs are sized for (a loaded trailer), kg. */
export const KINGPIN_DESIGN_KG = 16000
/** How far a raised lift axle's wheels hang above their road position, m. */
export const LIFT_RAISE = 0.22
/** Lift axles come down at this share of the bed's capacity. */
export const LIFT_DOWN_SHARE = 0.3

/** Steer lock (rad) at a road speed (m/s): full lock when crawling, a few degrees at highway speed. */
export function steerLock(speed: number): number {
  const ratio = speed / STEER_FADE_SPEED
  return MAX_STEER / (1 + ratio * ratio)
}

/** Unit forward (+Z) of a rotation, written into `out`. */
export function forwardOf(q: { x: number; y: number; z: number; w: number }, out: Vec3): Vec3 {
  out.x = 2 * (q.x * q.z + q.w * q.y)
  out.y = 2 * (q.y * q.z - q.w * q.x)
  out.z = 1 - 2 * (q.x * q.x + q.y * q.y)
  return out
}

/** Unit up (+Y) of a rotation, written into `out`. */
export function upOf(q: { x: number; y: number; z: number; w: number }, out: Vec3): Vec3 {
  out.x = 2 * (q.x * q.y - q.w * q.z)
  out.y = 1 - 2 * (q.x * q.x + q.z * q.z)
  out.z = 2 * (q.y * q.z + q.w * q.x)
  return out
}

/** Quaternion for a heading (rotation about +Y). */
export function headingQuat(heading: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }
}

/**
 * Share of a gravity-like force to feed forward when holding a body still. Rapier 0.14 integrates gravity over
 * `numSolverIterations` substeps while impulses land at the start of the step, so the velocity read after a step lags by
 * (n − 1)/(2n) of g·dt; feeding (n + 1)/(2n) of the force forward cancels it exactly.
 */
export function holdBias(host: PhysicsHost): number {
  const n = Math.max(1, host.world.integrationParameters.numSolverIterations)
  return (n + 1) / (2 * n)
}

/** One ray-cast wheel: where it is in the body frame, what it does and the loads that size its spring and brakes. */
export interface WheelDef {
  x: number
  z: number
  radius: number
  steer: boolean
  drive: boolean
  dual: boolean
  lift: boolean
  /** Static load on this wheel with the vehicle fully loaded, N (sets the spring rate). */
  fullLoad: number
  /** Static load at which the wheel sits exactly at its design ride height, N. */
  designLoad: number
  /** Service brake force at full pressure, N. */
  serviceBrake: number
  /** Spring brake force when parked, N (0 for unbraked wheels). */
  parkBrake: number
  /** False for suspension-only rollers (tracked machines drive themselves). */
  traction?: boolean
}

/**
 * The ray-cast wheels of one body: Rapier's vehicle controller set up for +Z forward and Y up, springs from `WheelDef` loads,
 * grip refreshed from the host a couple of wheels per step, and the drive and brake split in `applyLongitudinal`.
 */
export class WheelSet {
  readonly controller: RAPIER.DynamicRayCastVehicleController
  readonly defs: readonly WheelDef[]
  readonly count: number
  readonly poses: WheelPose[]
  /** Current steer angle per wheel (rad, + left). */
  readonly steer: Float64Array
  readonly connectionY: Float64Array
  /** Suspension force per wheel from the last controller update (0 when airborne or lifted), N. */
  readonly normal: Float64Array
  readonly grip: Float64Array
  private readonly host: PhysicsHost
  private readonly world: RAPIER.World
  private readonly k: Float64Array
  private readonly damping: Float64Array
  private readonly lifted: Uint8Array
  private readonly drive: Float64Array
  private readonly brakeShare: Float64Array
  private readonly spin: Float64Array
  private readonly local: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly worldPoint: Vec3 = { x: 0, y: 0, z: 0 }
  private cursor = 0
  private massKg = 1
  disposed = false

  constructor(host: PhysicsHost, body: RAPIER.RigidBody, defs: WheelDef[], massKg: number) {
    this.host = host
    this.world = host.world
    this.defs = defs
    this.count = defs.length
    const n = defs.length
    this.steer = new Float64Array(n)
    this.connectionY = new Float64Array(n)
    this.normal = new Float64Array(n)
    this.grip = new Float64Array(n).fill(1)
    this.k = new Float64Array(n)
    this.damping = new Float64Array(n)
    this.lifted = new Uint8Array(n)
    this.drive = new Float64Array(n)
    this.brakeShare = new Float64Array(n)
    this.spin = new Float64Array(n)
    this.controller = host.world.createVehicleController(body)
    this.controller.indexUpAxis = 1
    this.controller.setIndexForwardAxis = 2
    this.poses = defs.map((def) => ({ x: def.x, y: def.radius, z: def.z, steer: 0, spin: 0, radius: def.radius, dual: def.dual, lifted: false }))
    for (let i = 0; i < n; i++) {
      const def = defs[i]
      const k = def.fullLoad / SAG_FULL
      this.k[i] = k
      this.damping[i] = 2 * Math.sqrt((k * def.fullLoad) / GRAVITY)
      this.connectionY[i] = def.radius + SUSPENSION_REST - def.designLoad / k
      this.controller.addWheel({ x: def.x, y: this.connectionY[i], z: def.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, SUSPENSION_REST, def.radius)
      this.controller.setWheelMaxSuspensionTravel(i, SUSPENSION_TRAVEL)
      this.controller.setWheelMaxSuspensionForce(i, def.fullLoad * MAX_SUSPENSION_SHARE)
      const traction = def.traction !== false
      this.controller.setWheelFrictionSlip(i, traction ? TYRE_MU_SIDE : 0)
      this.controller.setWheelSideFrictionStiffness(i, traction ? 1 : 0)
    }
    this.setMass(massKg)
  }

  /** Rescales the springs for the body's current total mass (Rapier multiplies suspension forces by it). */
  setMass(massKg: number): void {
    this.massKg = Math.max(1, massKg)
    for (let i = 0; i < this.count; i++) this.applySpring(i)
  }

  private applySpring(i: number): void {
    const lifted = this.lifted[i] === 1
    const m = this.massKg
    this.controller.setWheelSuspensionStiffness(i, lifted ? 0 : this.k[i] / m)
    this.controller.setWheelSuspensionCompression(i, lifted ? 0 : (DAMPING_BUMP * this.damping[i]) / m)
    this.controller.setWheelSuspensionRelaxation(i, lifted ? 0 : (DAMPING_REBOUND * this.damping[i]) / m)
    this.controller.setWheelMaxSuspensionForce(i, lifted ? 0 : this.defs[i].fullLoad * MAX_SUSPENSION_SHARE)
    const traction = this.defs[i].traction !== false
    this.controller.setWheelFrictionSlip(i, lifted || !traction ? 0 : TYRE_MU_SIDE * this.grip[i])
    this.controller.setWheelSideFrictionStiffness(i, lifted || !traction ? 0 : 1)
  }

  setLifted(i: number, lifted: boolean): void {
    if ((this.lifted[i] === 1) === lifted) return
    this.lifted[i] = lifted ? 1 : 0
    this.poses[i].lifted = lifted
    this.applySpring(i)
  }

  isLifted(i: number): boolean {
    return this.lifted[i] === 1
  }

  setSteer(i: number, angle: number): void {
    this.steer[i] = angle
    this.controller.setWheelSteering(i, angle)
  }

  /** Re-reads the surface grip under `perStep` wheels (round robin). */
  refreshGrip(pose: BodyPose, perStep = 2): void {
    for (let s = 0; s < Math.min(perStep, this.count); s++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % this.count
      const def = this.defs[i]
      this.local.x = def.x
      this.local.y = 0
      this.local.z = def.z
      toWorld(pose, this.local, this.worldPoint)
      const grip = this.host.gripAt(this.worldPoint.x, this.worldPoint.z)
      if (Math.abs(grip - this.grip[i]) > 0.005) {
        this.grip[i] = grip
        if (!this.lifted[i] && def.traction !== false) this.controller.setWheelFrictionSlip(i, TYRE_MU_SIDE * grip)
      }
    }
  }

  /** Reads each wheel's suspension force from the last controller update. */
  readNormals(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.lifted[i] || !this.controller.wheelIsInContact(i)) {
        this.normal[i] = 0
        continue
      }
      const force = this.controller.wheelSuspensionForce(i) ?? 0
      this.normal[i] = Math.min(Math.max(0, force), this.defs[i].fullLoad * MAX_SUSPENSION_SHARE)
    }
  }

  /** Wheels touching the ground (lifted wheels never count). */
  contacts(): number {
    let n = 0
    for (let i = 0; i < this.count; i++) if (!this.lifted[i] && this.controller.wheelIsInContact(i)) n++
    return n
  }

  /**
   * Splits `driveForce` over the drive wheels by load and adds the brakes. The brake force is whatever stops the body within
   * this step (so a parked rig holds still on a grade), limited by the brakes' capacity at this air pressure and by tyre grip.
   * `instantForce` is everything else applied as an impulse this step and `gravityForce` the weight's pull along forward.
   * Returns the brake force applied (N, along forward).
   */
  applyLongitudinal(dt: number, massKg: number, speed: number, driveForce: number, instantForce: number, gravityForce: number, bias: number, pressure: number, parked: boolean): number {
    this.readNormals()
    let loaded = 0
    for (let i = 0; i < this.count; i++) if (this.defs[i].drive) loaded += this.normal[i]
    let driven = 0
    for (let i = 0; i < this.count; i++) {
      let f = 0
      if (this.defs[i].drive && loaded > 0 && this.normal[i] > 0) {
        const cap = TYRE_MU_LONG * this.grip[i] * this.normal[i]
        f = Math.max(-cap, Math.min(cap, (driveForce * this.normal[i]) / loaded))
      }
      this.drive[i] = f
      driven += f
    }
    let capacity = 0
    for (let i = 0; i < this.count; i++) {
      const def = this.defs[i]
      const brake = Math.max(def.serviceBrake * pressure, parked ? def.parkBrake : 0)
      const share = brake > 0 && this.normal[i] > 0 ? Math.min(brake, TYRE_MU_LONG * this.grip[i] * this.normal[i]) : 0
      this.brakeShare[i] = share
      capacity += share
    }
    let braking = 0
    if (capacity > 0) braking = Math.max(-capacity, Math.min(capacity, -((massKg * speed) / dt + driven + instantForce + gravityForce * bias)))
    for (let i = 0; i < this.count; i++) {
      const f = this.drive[i] + (capacity > 0 ? (braking * this.brakeShare[i]) / capacity : 0)
      this.controller.setWheelEngineForce(i, f)
    }
    return braking
  }

  /** Runs the controller; `ignore` filters out colliders the rays must not see (a coupled trailer over the drive axles). */
  update(dt: number, filterGroups: number, ignore?: (collider: RAPIER.Collider) => boolean): void {
    this.controller.updateVehicle(dt, undefined, filterGroups, ignore)
  }

  /** Writes hub positions (vehicle frame), steer and spin into `poses`; `speed` (m/s) spins the wheels on the ground. */
  writePoses(speed: number, dt: number): void {
    for (let i = 0; i < this.count; i++) {
      const pose = this.poses[i]
      const def = this.defs[i]
      if (this.lifted[i]) {
        pose.y = def.radius + LIFT_RAISE
      } else {
        const length = this.controller.wheelIsInContact(i) ? this.controller.wheelSuspensionLength(i) ?? SUSPENSION_REST : SUSPENSION_REST
        pose.y = this.connectionY[i] - length
        this.spin[i] = (this.spin[i] + (speed * dt) / def.radius) % (Math.PI * 2)
      }
      pose.steer = this.steer[i]
      pose.spin = this.spin[i]
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.world.removeVehicleController(this.controller)
  }
}

/** Where a rig is set down: the origin's ground position and heading. */
export interface Spawn {
  x: number
  z: number
  heading: number
  /** Ground height under the origin; read from the host when missing. */
  y?: number
}

/** Per-wheel static loads in N, in the order of the axles given. */
export interface AxleLoads {
  full: number[]
  design: number[]
}

/** Share of a drive axle's load a lowered lift axle carries (its air bags run at lower pressure). */
export const LIFT_AXLE_SHARE = 0.6

/**
 * Static load per wheel (N) on two supports: the steer axles and the rest (or a kingpin at z = 0 and the axles), with lift
 * axles carrying `LIFT_AXLE_SHARE` of a drive axle's load and raised (carrying nothing) when empty. `design` is the load each
 * wheel's ride height is set for: halfway between empty and full.
 */
export function wheelLoads(axles: { z: number; front: boolean; lift?: boolean }[], emptyKg: number, emptyZ: number, extraKg: number, extraZ: number, kingpin: boolean): AxleLoads {
  const front = axles.filter((a) => a.front)
  const zf = kingpin ? 0 : front.reduce((s, a) => s + a.z, 0) / Math.max(1, front.length)
  const split = (kg: number, z: number, liftsDown: boolean): number[] => {
    let weights = 0
    let moment = 0
    for (const a of axles) {
      if (a.front || (a.lift && !liftsDown)) continue
      const w = a.lift ? LIFT_AXLE_SHARE : 1
      weights += w
      moment += w * a.z
    }
    const zr = moment / Math.max(1e-6, weights)
    const frontShare = Math.min(0.85, Math.max(0.1, (z - zr) / (zf - zr)))
    return axles.map((a) => {
      if (a.front) return (frontShare * kg * GRAVITY) / (2 * front.length)
      if (a.lift && !liftsDown) return 0
      return ((a.lift ? LIFT_AXLE_SHARE : 1) * (1 - frontShare) * kg * GRAVITY) / (2 * weights)
    })
  }
  const fullKg = emptyKg + extraKg
  const fullZ = (emptyKg * emptyZ + extraKg * extraZ) / fullKg
  const full = split(fullKg, fullZ, true)
  const empty = split(emptyKg, emptyZ, false)
  return { full, design: full.map((f, i) => (axles[i].lift ? f * 0.75 : (f + empty[i]) / 2)) }
}

/** A rig's cached pose plus its forward and up axes. */
export type RigState = BodyPose & { forward: Vec3; up: Vec3 }

/** A truck the player drives: dump trucks and tractors alike. Call `update` once per fixed step before the world steps. */
export class TruckRig {
  readonly host: PhysicsHost
  readonly model: TruckModel
  readonly body: RAPIER.RigidBody
  readonly wheels: WheelSet
  readonly drivetrain: Drivetrain
  readonly dump: DumpBody | null
  readonly axleCount: number
  /** The trailer on the fifth wheel (set by `Coupling`). */
  trailer: TrailerRig | null = null
  headlights = false
  /** Lift axles: `auto` drops them at 30 % of bed capacity. */
  liftMode: 'auto' | 'down' | 'up' = 'auto'
  onImpact: ((dv: number) => void) | null = null
  /** Service brake air pressure 0 … 1 (the trailer brakes follow it when its lines are connected). */
  brakePressure = 0
  parkingBrake = true
  steerAngle = 0
  odometerM = 0
  /** Kilograms that left the dump bed in the last update. */
  lastDumpKg = 0
  /** Forward speed (m/s, + forward) at the last update. */
  speed = 0
  private payload = 0
  private readonly payloadAt: Vec3
  private readonly comZ: number
  private readonly comY: number
  private readonly dragArea: number
  private readonly steerAxleZ: number
  private readonly rearAxles: { z: number; lift: boolean }[]
  private readonly bias: number
  private readonly state: RigState
  private readonly poseOut: TruckPose
  private readonly prevVel: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly scratch: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly fifthLocal: Vec3
  private readonly fifthOut: Vec3 = { x: 0, y: 0, z: 0 }
  private quiet = 3
  /** True once `dispose` has run. */
  disposed = false
  private readonly notTrailer = (collider: RAPIER.Collider): boolean => collider.parent() !== this.trailer?.body
  private readonly engineInput: DrivetrainInput = { throttle: 0, engineBrake: false, shiftUp: false, shiftDown: false, speed: 0, massKg: 0, grade: 0 }

  constructor(host: PhysicsHost, model: TruckModel, spawn: Spawn) {
    this.host = host
    this.model = model
    this.axleCount = model.axles.length
    this.drivetrain = new Drivetrain(model)
    this.dump = model.dump ? new DumpBody(model.dump) : null
    this.bias = holdBias(host)
    const R = host.rapier
    const steerAxles = model.axles.filter((a) => a.steer)
    const rear = model.axles.filter((a) => !a.steer)
    this.steerAxleZ = steerAxles.reduce((s, a) => s + a.z, 0) / Math.max(1, steerAxles.length)
    this.rearAxles = rear.map((a) => ({ z: a.z, lift: !!a.lift }))
    const fixedRear = rear.filter((a) => !a.lift)
    const rearZ = fixedRear.reduce((s, a) => s + a.z, 0) / Math.max(1, fixedRear.length)
    const isDump = !!model.dump
    this.comZ = (isDump ? 0.5 : 0.38) * rearZ
    this.comY = isDump ? 0.9 : 0.85
    this.dragArea = isDump ? 7.5 : 5.6
    this.fifthLocal = { x: 0, y: FIFTH_WHEEL_HEIGHT, z: model.fifthWheelZ ?? rearZ }
    const dumpSpec = model.dump
    this.payloadAt = dumpSpec
      ? { x: 0, y: dumpSpec.bedFloorY + 0.25, z: dumpSpec.bedFrontZ + 0.42 * (dumpSpec.bedRearZ - dumpSpec.bedFrontZ) }
      : { x: 0, y: FIFTH_WHEEL_HEIGHT + 0.1, z: this.fifthLocal.z }
    const extraKg = dumpSpec ? dumpSpec.capacityKg : model.fifthWheelZ !== undefined ? KINGPIN_DESIGN_KG : 0
    const extraZ = dumpSpec ? this.payloadAt.z : this.fifthLocal.z
    const loads = wheelLoads(model.axles.map((a) => ({ z: a.z, front: a.steer, lift: a.lift })), model.massKg, this.comZ, extraKg, extraZ, false)
    const fullTotal = (model.massKg + extraKg) * GRAVITY
    const driveWheels = model.axles.filter((a) => a.drive).length * 2
    const defs: WheelDef[] = []
    model.axles.forEach((axle, index) => {
      for (const side of [1, -1]) {
        defs.push({
          x: (side * model.track) / 2, z: axle.z, radius: model.wheelRadius, steer: axle.steer, drive: axle.drive, dual: axle.dual,
          lift: !!axle.lift, fullLoad: loads.full[index], designLoad: loads.design[index],
          serviceBrake: SERVICE_BRAKE_G * loads.full[index],
          parkBrake: axle.drive ? (PARK_BRAKE_G * fullTotal) / Math.max(1, driveWheels) : 0,
        })
      }
    })
    const ground = spawn.y ?? Math.max(host.heightAt(spawn.x, spawn.z), this.groundUnder(spawn, rearZ))
    this.body = host.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, ground + 0.03, spawn.z)
        .setRotation(headingQuat(spawn.heading))
        .setLinearDamping(0)
        .setAngularDamping(0.05)
        .setCanSleep(false),
    )
    this.addColliders(R)
    this.wheels = new WheelSet(host, this.body, defs, model.massKg)
    const pos = this.body.translation()
    const rot = this.body.rotation()
    this.state = {
      position: { x: pos.x, y: pos.y, z: pos.z }, rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      forward: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 },
    }
    forwardOf(this.state.rotation, this.state.forward)
    upOf(this.state.rotation, this.state.up)
    this.poseOut = {
      position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, wheels: this.wheels.poses, dumpAngle: 0, tailgate: 0,
      brakeLights: false, reversing: false, headlights: false, load: 0,
    }
    this.updateLiftAxles()
    this.writePose()
  }

  private groundUnder(spawn: Spawn, rearZ: number): number {
    return this.host.heightAt(spawn.x + Math.sin(spawn.heading) * rearZ, spawn.z + Math.cos(spawn.heading) * rearZ)
  }

  private addColliders(R: typeof RAPIER): void {
    const m = this.model
    const groups = this.host.groups.chassis
    const half = m.width / 2 - 0.08
    const length = m.frontZ - m.rearZ
    const lowerZ = (m.frontZ + m.rearZ) / 2
    const lowerY = 0.8
    const mass = m.massKg
    const height = 1.8
    const inertia = {
      x: (mass / 12) * (height * height + length * length),
      y: (mass / 12) * (m.width * m.width + length * length),
      z: (mass / 12) * (m.width * m.width + height * height),
    }
    this.host.world.createCollider(
      R.ColliderDesc.cuboid(half, 0.25, length / 2)
        .setTranslation(0, lowerY, lowerZ)
        .setMassProperties(mass, { x: 0, y: this.comY - lowerY, z: this.comZ - lowerZ }, inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.4)
        .setCollisionGroups(groups),
      this.body,
    )
    const cabFront = m.frontZ - m.hoodLength
    const cabRear = cabFront - (m.style === 'cabover' ? 2.0 : 1.75) - m.sleeperLength
    const cabTop = Math.max(m.cabHeight, m.roofHeight)
    this.box(R, half, (cabTop - 1.05) / 2, (cabFront - cabRear) / 2, 0, (cabTop + 1.05) / 2, (cabFront + cabRear) / 2, groups)
    if (m.hoodLength > 0) {
      const hoodTop = m.cabHeight * 0.62
      this.box(R, half - 0.2, (hoodTop - 1.05) / 2, m.hoodLength / 2, 0, (hoodTop + 1.05) / 2, m.frontZ - m.hoodLength / 2, groups)
    }
    const dump = m.dump
    if (dump) {
      const top = dump.bedFloorY + dump.sideHeight
      this.box(R, m.width / 2 - 0.03, (top - 1.05) / 2, (dump.bedFrontZ - dump.bedRearZ) / 2, 0, (top + 1.05) / 2, (dump.bedFrontZ + dump.bedRearZ) / 2, groups)
    }
  }

  private box(R: typeof RAPIER, hx: number, hy: number, hz: number, x: number, y: number, z: number, groups: number): void {
    this.host.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setDensity(0).setFriction(0.4).setCollisionGroups(groups), this.body)
  }

  get payloadKg(): number {
    return this.payload
  }

  /** Truck plus payload, kg. */
  get massKg(): number {
    return this.model.massKg + this.payload
  }

  get speedKph(): number {
    return this.speed * 3.6
  }

  get rpm(): number {
    return this.drivetrain.rpm
  }

  get gear(): number {
    return this.drivetrain.gear
  }

  get fuelL(): number {
    return this.drivetrain.fuelL
  }

  set fuelL(litres: number) {
    this.drivetrain.fuelL = Math.max(0, Math.min(this.model.fuelTankL, litres))
  }

  /** Litres burned since the truck was created. */
  get fuelUsedL(): number {
    return this.drivetrain.fuelUsedL
  }

  /** True while the lift axles are down (always true without lift axles). */
  get liftAxlesDown(): boolean {
    for (let i = 0; i < this.wheels.count; i++) if (this.wheels.isLifted(i)) return false
    return true
  }

  /** Sets the payload mass (kg). A dump truck's bed load follows (clamped to its capacity). */
  setPayload(kg: number): void {
    const capped = this.dump ? Math.min(this.dump.capacityKg, Math.max(0, kg)) : Math.max(0, kg)
    if (this.dump) {
      this.dump.loadKg = capped
      if (capped <= 0) this.dump.material = null
    }
    this.applyPayload(capped)
  }

  private applyPayload(kg: number): void {
    this.payload = kg
    const length = this.model.dump ? this.model.dump.bedFrontZ - this.model.dump.bedRearZ : 2
    const width = this.model.width - 0.2
    const height = 1
    if (kg > 0) {
      this.body.setAdditionalMassProperties(
        kg,
        this.payloadAt,
        { x: (kg / 12) * (height * height + length * length), y: (kg / 12) * (width * width + length * length), z: (kg / 12) * (width * width + height * height) },
        { x: 0, y: 0, z: 0, w: 1 },
        true,
      )
    } else {
      this.body.setAdditionalMassProperties(0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, true)
    }
    this.wheels.setMass(this.massKg)
    this.updateLiftAxles()
  }

  private updateLiftAxles(): void {
    const capacity = this.dump ? this.dump.capacityKg : 1
    const down = this.liftMode === 'down' || (this.liftMode === 'auto' && this.payload >= LIFT_DOWN_SHARE * capacity)
    for (let i = 0; i < this.wheels.count; i++) if (this.wheels.defs[i].lift) this.wheels.setLifted(i, !down)
  }

  /** Re-reads the body's pose into the rig's cached state (done by `update`; call between steps before coupling checks). */
  readState(): RigState {
    const t = this.body.translation()
    const r = this.body.rotation()
    const s = this.state
    s.position.x = t.x
    s.position.y = t.y
    s.position.z = t.z
    s.rotation.x = r.x
    s.rotation.y = r.y
    s.rotation.z = r.z
    s.rotation.w = r.w
    forwardOf(s.rotation, s.forward)
    upOf(s.rotation, s.up)
    return s
  }

  /**
   * Steps controls, engine, brakes, steering, dump and wheels. Call once per fixed step before the world steps (and before the
   * trailer's update). `shiftUp`/`shiftDown` are read as edges: clear them after the first fixed step of a frame.
   */
  update(dt: number, input: DriveInput): void {
    if (this.disposed) return
    const s = this.readState()
    const v = this.body.linvel()
    const forward = s.forward
    this.speed = v.x * forward.x + v.y * forward.y + v.z * forward.z
    this.checkImpact(v)
    const speed = this.speed
    const absSpeed = Math.abs(speed)
    const pressureTarget = Math.min(1, Math.max(0, input.brake))
    const delta = pressureTarget - this.brakePressure
    this.brakePressure += delta > 0 ? Math.min(delta, dt / AIR_APPLY_SECONDS) : Math.max(delta, -dt / AIR_RELEASE_SECONDS)
    this.parkingBrake = input.parkingBrake
    this.steerTo(dt, input.steer, absSpeed)
    const mass = this.massKg
    const pulled = mass + (this.trailer ? this.trailer.massKg : 0)
    const engine = this.engineInput
    engine.throttle = input.throttle
    engine.engineBrake = input.engineBrake
    engine.shiftUp = input.shiftUp
    engine.shiftDown = input.shiftDown
    engine.speed = speed
    engine.massKg = pulled
    engine.grade = forward.y
    const driveForce = this.drivetrain.update(dt, engine)
    if (this.dump) {
      this.lastDumpKg = this.dump.update(dt)
      if (Math.abs(this.dump.loadKg - this.payload) > 0.5 || (this.dump.loadKg === 0 && this.payload > 0)) this.applyPayload(this.dump.loadKg)
    }
    this.updateLiftAxles()
    const rolling = -Math.sign(speed) * Math.min(ROLLING_RESISTANCE * mass * GRAVITY, (mass * absSpeed) / dt)
    const aero = -0.5 * AIR_DENSITY * this.dragArea * speed * absSpeed
    const instant = rolling + aero
    if (instant !== 0) {
      const impulse = this.scratch
      impulse.x = forward.x * instant * dt
      impulse.y = forward.y * instant * dt
      impulse.z = forward.z * instant * dt
      this.body.applyImpulse(impulse, true)
    }
    this.wheels.refreshGrip(s)
    this.wheels.applyLongitudinal(dt, mass, speed, driveForce, instant, -GRAVITY * mass * forward.y, this.bias, this.brakePressure, this.parkingBrake)
    this.wheels.update(dt, this.host.groups.wheelRay, this.trailer ? this.notTrailer : undefined)
    this.wheels.writePoses(speed, dt)
    this.odometerM += absSpeed * dt
  }

  private steerTo(dt: number, input: number, absSpeed: number): void {
    const target = Math.max(-1, Math.min(1, input)) * steerLock(absSpeed)
    this.steerAngle += Math.max(-STEER_RATE * dt, Math.min(STEER_RATE * dt, target - this.steerAngle))
    let rearSum = 0
    let rearCount = 0
    const liftsDown = this.liftAxlesDown
    for (let a = 0; a < this.rearAxles.length; a++) {
      const axle = this.rearAxles[a]
      if (axle.lift && !liftsDown) continue
      rearSum += axle.z
      rearCount++
    }
    const wheelbase = Math.max(1, this.steerAxleZ - rearSum / Math.max(1, rearCount))
    const tan = Math.tan(this.steerAngle)
    for (let i = 0; i < this.wheels.count; i++) {
      const def = this.wheels.defs[i]
      if (!def.steer) continue
      const angle = Math.abs(tan) < 1e-5 ? 0 : Math.atan(wheelbase / (wheelbase / tan - def.x))
      this.wheels.setSteer(i, angle)
    }
  }

  private checkImpact(v: { x: number; y: number; z: number }): void {
    const dx = v.x - this.prevVel.x
    const dy = v.y - this.prevVel.y
    const dz = v.z - this.prevVel.z
    this.prevVel.x = v.x
    this.prevVel.y = v.y
    this.prevVel.z = v.z
    if (this.quiet > 0) {
      this.quiet--
      return
    }
    const dv = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dv > IMPACT_DV) {
      this.quiet = 20
      this.onImpact?.(dv)
    }
  }

  /** Skips impact detection for a few steps (teleports, coupling). */
  hush(steps = 30): void {
    this.quiet = Math.max(this.quiet, steps)
  }

  private writePose(): void {
    const s = this.state
    const p = this.poseOut
    p.position.x = s.position.x
    p.position.y = s.position.y
    p.position.z = s.position.z
    p.rotation.x = s.rotation.x
    p.rotation.y = s.rotation.y
    p.rotation.z = s.rotation.z
    p.rotation.w = s.rotation.w
    p.dumpAngle = this.dump ? this.dump.angle : 0
    p.tailgate = this.dump ? this.dump.tailgate : 0
    p.brakeLights = this.brakePressure > 0.05
    p.reversing = this.drivetrain.gear < 0
    p.headlights = this.headlights
    p.load = Math.min(1, Math.max(0, this.drivetrain.load))
  }

  /** The truck's pose for the renderer (one reused object; wheels in the vehicle frame). */
  pose(): TruckPose {
    if (!this.disposed) this.readState()
    this.writePose()
    return this.poseOut
  }

  /** World position of a point in the vehicle frame (`out` is reused when given). */
  localToWorld(local: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    return toWorld(this.readState(), local, out)
  }

  /** World position of the fifth wheel's plate centre (one reused object unless `out` is given). */
  fifthWheelWorld(out: Vec3 = this.fifthOut): Vec3 {
    return toWorld(this.readState(), this.fifthLocal, out)
  }

  /** The fifth wheel's plate centre in the vehicle frame. */
  get fifthWheelLocal(): Readonly<Vec3> {
    return this.fifthLocal
  }

  /** Puts the truck down at (x, z) facing `heading`, stopped; a coupled trailer is set down in line behind it. */
  teleport(x: number, z: number, heading: number, y?: number): void {
    const ground = y ?? this.host.heightAt(x, z)
    this.body.setTranslation({ x, y: ground + 0.05, z }, true)
    this.body.setRotation(headingQuat(heading), true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.prevVel.x = this.prevVel.y = this.prevVel.z = 0
    this.speed = 0
    this.steerAngle = 0
    this.hush()
    this.readState()
    if (this.trailer) {
      const fz = this.fifthLocal.z
      this.trailer.teleport(x + Math.sin(heading) * fz, z + Math.cos(heading) * fz, heading, ground + 0.05)
    }
  }

  dispose(): void {
    if (this.disposed) return
    const trailer = this.trailer
    if (trailer) {
      if (trailer.joint) trailer.unjoin(false)
      trailer.tractor = null
      this.trailer = null
    }
    this.disposed = true
    this.wheels.dispose()
    this.host.world.removeRigidBody(this.body)
  }
}
