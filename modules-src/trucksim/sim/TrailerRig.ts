/**
 * A semi-trailer on Rapier: its own body (origin on the ground under the kingpin, +Z forward), ray-cast wheels on every axle,
 * a landing-gear collider that holds the kingpin plate at `kingpinHeight` while it is down (3 s travel), payload mass placed
 * over the deck, spring brakes while parked or with the air lines off and the tractor's service brake when they are on, and
 * doors (reefer doors, hopper gates or tarp). The RGN lowboy's gooseneck detaches: the deck front is lowered onto the ground as
 * a ramp and the neck rides on the tractor; reattaching lifts the deck back over 1.5 s. `Coupling` drives the joint; the game
 * calls `update` once per fixed step after the tractor's.
 */
import type RAPIER from '@dimforge/rapier3d-compat'
import { FIFTH_WHEEL_HEIGHT } from '../shared/Catalog'
import type { TrailerModel } from '../shared/Catalog'
import type { PhysicsHost } from './PhysicsHost'
import { GRAVITY, IMPACT_DV, PARK_BRAKE_G, ROLLING_RESISTANCE, AIR_DENSITY, SERVICE_BRAKE_G, WheelSet, forwardOf, headingQuat, holdBias, upOf, wheelLoads } from './TruckRig'
import type { RigState, Spawn, TruckRig, WheelDef } from './TruckRig'
import { toWorld } from './types'
import type { GooseneckPose, TrailerPose, Vec3 } from './types'

/** Seconds for the landing gear to travel fully up or down. */
export const GEAR_SECONDS = 3
/** How far the landing-gear feet retract, m. */
export const GEAR_STROKE = 0.45
/** Seconds for doors, gates or tarp to open or close fully. */
export const DOORS_SECONDS = 2
/** How fast the coupling joint draws the kingpin onto the fifth wheel, m/s. */
export const SNAP_SPEED = 0.5
/** Seconds for a reattached gooseneck to lift the deck back to riding height. */
export const NECK_RAISE_SECONDS = 1.5
/** How fast the gooseneck lowers the deck front, m/s. */
export const NECK_LOWER_SPEED = 0.45
/** The most the gooseneck lowers the deck front, m. */
export const NECK_MAX_DROP = 1.2
/** Height of the lowboy deck's front lip underside in the trailer frame, m (it touches the ground first when lowered). */
export const RGN_LIP_UNDERSIDE = 0.54

/** RGN gooseneck: pinned to the deck, lowering the deck, off and riding on the tractor, or lifting the deck back. */
export type NeckState = 'attached' | 'lowering' | 'detached' | 'raising'
/** The fifth-wheel joint: none, drawing the kingpin into the jaws, or locked. */
export type CouplingState = 'none' | 'snapping' | 'locked'

const LEG_HALF = 0.5
const smooth = (t: number): number => t * t * (3 - 2 * t)

/** One semi-trailer. Call `update` once per fixed step, after its tractor's. */
export class TrailerRig {
  readonly host: PhysicsHost
  readonly model: TrailerModel
  readonly body: RAPIER.RigidBody
  readonly wheels: WheelSet
  readonly isLowboy: boolean
  /** The tractor this trailer is coupled to (or, for a detached RGN, the tractor carrying its gooseneck). */
  tractor: TruckRig | null = null
  /** The fifth-wheel joint while coupled. */
  joint: RAPIER.ImpulseJoint | null = null
  coupling: CouplingState = 'none'
  /** Air lines (glad hands) connected to the tractor. */
  lines = false
  /** Landing gear: 1 down, 0 up; values between stop the legs part way, as cranking does. */
  gearTarget = 1
  gear = 1
  /** Doors, hopper gates or tarp: 1 open, 0 shut. */
  doorsTarget: 0 | 1 = 0
  doors = 0
  neckState: NeckState = 'attached'
  onImpact: ((dv: number) => void) | null = null
  /** Forward speed at the last update, m/s. */
  speed = 0
  private payload = 0
  private readonly payloadAt: Vec3
  private readonly comY: number
  private readonly comZ: number
  private readonly bias: number
  private readonly state: RigState
  private readonly poseOut: TrailerPose
  private readonly neckPose: GooseneckPose | null
  private readonly legs: RAPIER.Collider
  private readonly neck: RAPIER.Collider | null
  private readonly anchor: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly anchorFrom: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly kingpinLocal: Vec3
  private readonly lipLocal: Vec3
  private readonly kingpinOut: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly scratch: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly scratchWorld: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly scratchLocal: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly legTranslation: Vec3 = { x: 0, y: LEG_HALF, z: 0 }
  private readonly prevVel: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly ray: RAPIER.Ray
  private readonly dragArea: number
  private legGear = -1
  private neckTimer = 0
  private neckDrop = 0
  private linesBefore = false
  private quiet = 3
  /** True once `dispose` has run. */
  disposed = false

  constructor(host: PhysicsHost, model: TrailerModel, spawn: Spawn) {
    this.host = host
    this.model = model
    this.isLowboy = model.kind === 'lowboy' && !!model.rgn
    this.bias = holdBias(host)
    const R = host.rapier
    this.kingpinLocal = { x: 0, y: model.kingpinHeight, z: 0 }
    const rgn = model.rgn
    this.lipLocal = { x: 0, y: RGN_LIP_UNDERSIDE, z: rgn ? rgn.neckRearZ : model.frontZ }
    const axleZ = model.axles.reduce((s, z) => s + z, 0) / model.axles.length
    this.comZ = 0.55 * axleZ
    this.comY = this.isLowboy ? 0.7 : model.kind === 'tanker' || model.kind === 'reefer' ? 1.3 : 1.05
    this.payloadAt = rgn
      ? { x: 0, y: rgn.wellHeight + 1.0, z: (rgn.wellFrontZ + rgn.wellRearZ) / 2 }
      : { x: 0, y: Math.min(1.75, model.deckHeight + 0.45), z: (model.frontZ + model.rearZ) / 2 }
    this.dragArea = model.kind === 'reefer' ? 2.2 : model.kind === 'flatbed' || model.kind === 'lowboy' ? 0.8 : 1.6
    const loads = wheelLoads(model.axles.map((z) => ({ z, front: false })), model.emptyMassKg, this.comZ, model.maxPayloadKg, this.payloadAt.z, true)
    const track = model.width - 0.55
    const defs: WheelDef[] = []
    model.axles.forEach((z, index) => {
      for (const side of [1, -1]) {
        defs.push({
          x: (side * track) / 2, z, radius: model.wheelRadius, steer: false, drive: false, dual: true, lift: false,
          fullLoad: loads.full[index], designLoad: loads.design[index],
          serviceBrake: SERVICE_BRAKE_G * loads.full[index], parkBrake: PARK_BRAKE_G * loads.full[index],
        })
      }
    })
    const sin = Math.sin(spawn.heading)
    const cos = Math.cos(spawn.heading)
    const ground = spawn.y ?? Math.max(
      host.heightAt(spawn.x, spawn.z),
      host.heightAt(spawn.x + sin * model.landingGearZ, spawn.z + cos * model.landingGearZ),
      host.heightAt(spawn.x + sin * axleZ, spawn.z + cos * axleZ),
    )
    this.body = host.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, ground + 0.03, spawn.z)
        .setRotation(headingQuat(spawn.heading))
        .setLinearDamping(0)
        .setAngularDamping(0.05)
        .setCanSleep(false),
    )
    this.neck = this.addColliders(R)
    this.legs = host.world.createCollider(
      R.ColliderDesc.cuboid(model.width / 2 - 0.35, LEG_HALF, 0.12)
        .setTranslation(0, LEG_HALF, model.landingGearZ)
        .setDensity(0)
        .setFriction(1.2)
        .setCollisionGroups(host.groups.trailer),
      this.body,
    )
    this.legTranslation.z = model.landingGearZ
    this.wheels = new WheelSet(host, this.body, defs, model.emptyMassKg)
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
    const pos = this.body.translation()
    const rot = this.body.rotation()
    this.state = {
      position: { x: pos.x, y: pos.y, z: pos.z }, rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
      forward: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 },
    }
    forwardOf(this.state.rotation, this.state.forward)
    upOf(this.state.rotation, this.state.up)
    this.neckPose = this.isLowboy ? { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, attached: true } : null
    this.poseOut = {
      position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, wheels: this.wheels.poses, landingGear: 1,
      gooseneck: this.neckPose, doors: 0, brakeLights: false,
    }
    this.placeLegs()
    this.writePose()
  }

  private addColliders(R: typeof RAPIER): RAPIER.Collider | null {
    const m = this.model
    const groups = this.host.groups.trailer
    const mass = m.emptyMassKg
    const length = m.frontZ - m.rearZ
    const inertia = {
      x: (mass / 12) * (1.5 * 1.5 + length * length),
      y: (mass / 12) * (m.width * m.width + length * length),
      z: (mass / 12) * (m.width * m.width + 1.5 * 1.5),
    }
    const frame = { x: 0, y: 0, z: 0, w: 1 }
    const rgn = m.rgn
    if (!rgn) {
      const bottom = m.kingpinHeight
      const top = Math.max(m.height, bottom + 0.3)
      const cy = (top + bottom) / 2
      const cz = (m.frontZ + m.rearZ) / 2
      this.host.world.createCollider(
        R.ColliderDesc.cuboid(m.width / 2 - 0.03, (top - bottom) / 2, length / 2)
          .setTranslation(0, cy, cz)
          .setMassProperties(mass, { x: 0, y: this.comY - cy, z: this.comZ - cz }, inertia, frame)
          .setFriction(0.5)
          .setCollisionGroups(groups),
        this.body,
      )
      return null
    }
    const hx = m.width / 2 - 0.03
    const front = rgn.wellFrontZ
    const rear = rgn.wellRearZ
    const top = rgn.wellHeight
    const points = new Float32Array([
      hx, top, front, -hx, top, front,
      hx, top, rear, -hx, top, rear,
      hx, top - 0.3, rear, -hx, top - 0.3, rear,
      hx, top - 0.3, -8.2, -hx, top - 0.3, -8.2,
      hx, RGN_LIP_UNDERSIDE, front, -hx, RGN_LIP_UNDERSIDE, front,
    ])
    const hull = R.ColliderDesc.convexHull(points)
    if (!hull) throw new Error('Lowboy deck hull failed')
    this.host.world.createCollider(
      hull.setMassProperties(mass, { x: 0, y: this.comY, z: this.comZ }, inertia, frame).setFriction(0.9).setCollisionGroups(groups),
      this.body,
    )
    const rearTop = m.wheelRadius * 2 + 0.35
    this.host.world.createCollider(
      R.ColliderDesc.cuboid(hx, 0.15, (rear - m.rearZ) / 2).setTranslation(0, rearTop - 0.15, (rear + m.rearZ) / 2).setDensity(0).setFriction(0.6).setCollisionGroups(groups),
      this.body,
    )
    const neckTop = m.kingpinHeight + 0.4
    return this.host.world.createCollider(
      R.ColliderDesc.cuboid(hx - 0.05, 0.2, (m.frontZ - rgn.neckRearZ) / 2)
        .setTranslation(0, neckTop - 0.2, (m.frontZ + rgn.neckRearZ) / 2)
        .setDensity(0)
        .setFriction(0.5)
        .setCollisionGroups(groups),
      this.body,
    )
  }

  get neckAttached(): boolean {
    return this.neckState === 'attached'
  }

  get payloadKg(): number {
    return this.payload
  }

  /** Trailer plus payload, kg. */
  get massKg(): number {
    return this.model.emptyMassKg + this.payload
  }

  get speedKph(): number {
    return this.speed * 3.6
  }

  /** True while the air lines are on and the trailer brakes follow the tractor. */
  get brakesFromTractor(): boolean {
    return !!this.joint && !!this.tractor && this.lines
  }

  /** Sets the payload (kg) with its centre of mass at `at` in the trailer frame (defaults to the middle of the deck). */
  setPayload(kg: number, at?: { y?: number; z?: number }): void {
    this.payload = Math.max(0, kg)
    const com = this.scratchLocal
    com.x = 0
    com.y = at?.y ?? this.payloadAt.y
    com.z = at?.z ?? this.payloadAt.z
    if (this.payload > 0) {
      const k = this.payload / 12
      this.body.setAdditionalMassProperties(this.payload, com, { x: k * (2.25 + 36), y: k * (5.8 + 36), z: k * (5.8 + 2.25) }, { x: 0, y: 0, z: 0, w: 1 }, true)
    } else {
      this.body.setAdditionalMassProperties(0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, true)
    }
    this.wheels.setMass(this.massKg)
  }

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

  /** World position of the kingpin plate (one reused object unless `out` is given). */
  kingpinWorld(out: Vec3 = this.kingpinOut): Vec3 {
    return toWorld(this.readState(), this.kingpinLocal, out)
  }

  /** The kingpin plate in the trailer frame. */
  get kingpinPoint(): Readonly<Vec3> {
    return this.kingpinLocal
  }

  /** World position of a point in the trailer frame. */
  localToWorld(local: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
    return toWorld(this.readState(), local, out)
  }

  /**
   * Joins the kingpin to `truck` with a spherical joint whose truck-side anchor starts at `anchorOnTruck` (so it begins with
   * no error) and is drawn to the fifth wheel by `update`. Used by `Coupling`.
   */
  joinTo(truck: TruckRig, anchorOnTruck: Vec3, raising: boolean): void {
    const R = this.host.rapier
    this.anchor.x = anchorOnTruck.x
    this.anchor.y = anchorOnTruck.y
    this.anchor.z = anchorOnTruck.z
    this.anchorFrom.x = anchorOnTruck.x
    this.anchorFrom.y = anchorOnTruck.y
    this.anchorFrom.z = anchorOnTruck.z
    const data = R.JointData.spherical(this.anchor, this.kingpinLocal)
    this.joint = this.host.world.createImpulseJoint(data, truck.body, this.body, true)
    this.joint.setContactsEnabled(false)
    this.tractor = truck
    truck.trailer = this
    this.coupling = 'snapping'
    if (raising) {
      this.neckState = 'raising'
      this.neckTimer = 0
    }
    truck.hush()
    this.quiet = 30
  }

  /** Removes the joint; `keepTractor` leaves the tractor association (a detached RGN's neck stays on it). Used by `Coupling`. */
  unjoin(keepTractor: boolean): void {
    if (this.joint) this.host.world.removeImpulseJoint(this.joint, true)
    this.joint = null
    this.coupling = 'none'
    this.tractor?.hush()
    this.quiet = 30
    if (!keepTractor) {
      if (this.tractor) this.tractor.trailer = null
      this.tractor = null
      this.lines = false
    }
  }

  /** Starts lowering the deck front onto the ground (RGN). Used by `Coupling.detachNeck`. */
  startLowering(): void {
    this.neckState = 'lowering'
    this.neckDrop = 0
    this.legs.setEnabled(false)
    this.neck?.setEnabled(false)
  }

  /** Height of the deck lip above whatever is under it (m), or Infinity when nothing is within 3 m. */
  lipClearance(): number {
    const lip = toWorld(this.readState(), this.lipLocal, this.scratch)
    this.ray.origin.x = lip.x
    this.ray.origin.y = lip.y + 0.5
    this.ray.origin.z = lip.z
    const hit = this.host.world.castRay(this.ray, 3.5, true, undefined, this.host.groups.wheelRay, undefined, this.body)
    return hit ? hit.timeOfImpact - 0.5 : Infinity
  }

  private finishDetach(): void {
    this.linesBefore = this.lines
    this.unjoin(true)
    this.lines = false
    this.neckState = 'detached'
    this.neck?.setEnabled(false)
    this.legs.setEnabled(false)
  }

  private finishAttach(): void {
    this.neckState = 'attached'
    this.coupling = 'locked'
    this.neck?.setEnabled(true)
    this.legs.setEnabled(true)
    this.legGear = -1
    this.lines = this.linesBefore
  }

  private placeLegs(): void {
    if (Math.abs(this.legGear - this.gear) < 1e-4) return
    this.legGear = this.gear
    this.legTranslation.y = LEG_HALF + (1 - this.gear) * GEAR_STROKE
    this.legs.setTranslationWrtParent(this.legTranslation)
  }

  private stepJoint(dt: number): void {
    const joint = this.joint
    const tractor = this.tractor
    if (!joint || !tractor) return
    const target = tractor.fifthWheelLocal
    const a = this.anchor
    if (this.neckState === 'raising') {
      this.neckTimer += dt
      const t = smooth(Math.min(1, this.neckTimer / NECK_RAISE_SECONDS))
      a.x = this.anchorFrom.x + (target.x - this.anchorFrom.x) * t
      a.y = this.anchorFrom.y + (target.y - this.anchorFrom.y) * t
      a.z = this.anchorFrom.z + (target.z - this.anchorFrom.z) * t
      joint.setAnchor1(a)
      if (this.neckTimer >= NECK_RAISE_SECONDS) this.finishAttach()
      return
    }
    if (this.neckState === 'lowering') {
      const step = NECK_LOWER_SPEED * dt
      this.neckDrop += step
      a.y -= step
      joint.setAnchor1(a)
      const held = this.kingpinWorld(this.scratchWorld).y - tractor.localToWorld(a, this.scratch).y
      if (this.lipClearance() <= 0.02 || this.neckDrop >= NECK_MAX_DROP || held > 0.06) this.finishDetach()
      return
    }
    if (this.coupling !== 'snapping') return
    const max = SNAP_SPEED * dt
    const dx = target.x - a.x
    const dz = target.z - a.z
    const flat = Math.sqrt(dx * dx + dz * dz)
    if (flat > max) {
      a.x += (dx / flat) * max
      a.z += (dz / flat) * max
    } else {
      a.x = target.x
      a.z = target.z
    }
    const dy = target.y - a.y
    if (dy > 0 || this.gear < 1) a.y += Math.max(-max, Math.min(max, dy))
    joint.setAnchor1(a)
    if (flat < 1e-3 && Math.abs(target.y - a.y) < 1e-3) this.coupling = 'locked'
  }

  /** Steps gear, doors, joint snapping, the RGN neck, brakes and wheels. Call once per fixed step after the tractor's update. */
  update(dt: number): void {
    if (this.disposed) return
    const s = this.readState()
    const v = this.body.linvel()
    const forward = s.forward
    this.speed = v.x * forward.x + v.y * forward.y + v.z * forward.z
    this.checkImpact(v)
    const gearStep = dt / GEAR_SECONDS
    this.gear += Math.max(-gearStep, Math.min(gearStep, Math.min(1, Math.max(0, this.gearTarget)) - this.gear))
    this.placeLegs()
    const doorStep = dt / DOORS_SECONDS
    this.doors += Math.max(-doorStep, Math.min(doorStep, this.doorsTarget - this.doors))
    this.stepJoint(dt)
    const connected = this.brakesFromTractor
    const tractor = this.tractor
    const pressure = connected && tractor ? tractor.brakePressure : 0
    const parked = connected && tractor ? tractor.parkingBrake : true
    const speed = this.speed
    const absSpeed = Math.abs(speed)
    const mass = this.massKg
    const rolling = -Math.sign(speed) * Math.min(ROLLING_RESISTANCE * mass * GRAVITY * 0.6, (mass * absSpeed) / dt)
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
    this.wheels.applyLongitudinal(dt, mass, speed, 0, instant, -GRAVITY * mass * forward.y, this.bias, pressure, parked)
    this.wheels.update(dt, this.host.groups.wheelRay)
    this.wheels.writePoses(speed, dt)
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
    p.landingGear = this.gear
    p.doors = this.doors
    const tractor = this.tractor
    p.brakeLights = this.brakesFromTractor && !!tractor && tractor.brakePressure > 0.05
    const neck = this.neckPose
    if (!neck) return
    neck.attached = this.neckState === 'attached'
    if (neck.attached || !tractor) {
      neck.position.x = s.position.x
      neck.position.y = s.position.y
      neck.position.z = s.position.z
      neck.rotation.x = s.rotation.x
      neck.rotation.y = s.rotation.y
      neck.rotation.z = s.rotation.z
      neck.rotation.w = s.rotation.w
      return
    }
    const fifth = tractor.fifthWheelLocal
    const local = this.scratchLocal
    local.x = fifth.x
    local.y = FIFTH_WHEEL_HEIGHT - this.model.kingpinHeight
    local.z = fifth.z
    const ts = tractor.readState()
    toWorld(ts, local, neck.position)
    neck.rotation.x = ts.rotation.x
    neck.rotation.y = ts.rotation.y
    neck.rotation.z = ts.rotation.z
    neck.rotation.w = ts.rotation.w
  }

  /** The trailer's pose for the renderer (one reused object). */
  pose(): TrailerPose {
    if (!this.disposed) this.readState()
    this.writePose()
    return this.poseOut
  }

  /** Puts the trailer down with its kingpin over (x, z) facing `heading`, stopped. */
  teleport(x: number, z: number, heading: number, y?: number): void {
    const ground = y ?? this.host.heightAt(x, z)
    this.body.setTranslation({ x, y: ground + 0.03, z }, true)
    this.body.setRotation(headingQuat(heading), true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.prevVel.x = this.prevVel.y = this.prevVel.z = 0
    this.speed = 0
    this.quiet = 30
    this.readState()
  }

  dispose(): void {
    if (this.disposed) return
    if (this.joint) this.unjoin(false)
    else if (this.tractor) {
      this.tractor.trailer = null
      this.tractor = null
    }
    this.disposed = true
    this.wheels.dispose()
    this.host.world.removeRigidBody(this.body)
  }
}
