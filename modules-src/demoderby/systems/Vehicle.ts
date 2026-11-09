/** One derby car: a Rapier chassis body with a raycast vehicle controller, its visual model, controls, damage (body, engine and every component in `Damage.ts`) and what it does to the drive, dents, the out-of-the-heat state and the idle clock. */
import * as THREE from 'three/webgpu'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { PhysicsWorld } from '../../../engine'
import { config, type BodySpec, type DamageSpec, type VehicleSpec } from '../config'
import { createCar, type CarModel, type DetachedPart } from '../models/CarBody'
import { applyComponentHit, applyRoll, createDamage, handlingOf, stepComponents, type CarDamage, type DamageNews, type Handling } from './Damage'
import type { CarLook } from './Look'

export interface Controls {
  throttle: number
  steer: number
  brake: boolean
}

export type HitZone = 'front' | 'rear' | 'side'

export interface Hit {
  zone: HitZone
  /** 0–1 share of a full-strength hit. */
  strength: number
  point: THREE.Vector3
  /** A barrier, not a car: scaled by `wallScale`. */
  wall?: boolean
}

export class Vehicle {
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  readonly controller: RAPIER.DynamicRayCastVehicleController
  readonly model: CarModel
  readonly controls: Controls = { throttle: 0, steer: 0, brake: false }
  health = 100
  engine = 100
  alive = true
  outReason: 'wrecked' | 'idle' | null = null
  /** Seconds since this car last landed a hit on someone. */
  idle = 0
  hitsLanded = 0
  knockouts = 0
  points = 0
  survived = 0
  place = 0
  readonly damage: CarDamage = createDamage()
  /** Component changes since the last drain (tires, wheels, bumpers, lamps, glass, radiator, fire). */
  readonly news: DamageNews[] = []
  /** Parts that came off since the last drain, in world space, for the debris. */
  readonly detached: DetachedPart[] = []
  /** Damage rules for this heat (scaled by the damage preset). */
  rules: DamageSpec = config.damage
  private readonly handling: Handling
  private handlingVersion = -1
  private readonly engineBox = { value: 100 }
  private rolled = false
  private hitCount = 0
  private steerAngle = 0
  private stuckClock = 0
  private flipClock = 0
  private lastHitAt = new Map<number, number>()
  private readonly forward = new THREE.Vector3()
  private readonly velocity = new THREE.Vector3()
  private readonly local = new THREE.Vector3()
  private readonly quaternion = new THREE.Quaternion()
  private readonly position = new THREE.Vector3()
  private readonly wheelContact = new THREE.Vector3()

  constructor(
    readonly id: number,
    readonly look: CarLook,
    readonly spec: BodySpec,
    readonly isPlayer: boolean,
    private readonly physics: PhysicsWorld,
    private readonly tuning: VehicleSpec,
    spawn: THREE.Vector3,
    yaw: number,
  ) {
    const { rapier, world } = physics
    this.model = createCar(spec, look, isPlayer ? 0 : id)
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spec.centreHeight + 0.2, spawn.z)
        .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
        .setLinearDamping(tuning.linearDamping)
        .setAngularDamping(tuning.angularDamping)
        .setCcdEnabled(true),
    )
    const [hx, hy, hz] = spec.colliderHalf
    this.collider = world.createCollider(
      rapier.ColliderDesc.cuboid(hx, hy, hz)
        .setMass(spec.mass)
        .setFriction(tuning.bodyFriction)
        .setRestitution(tuning.bodyRestitution)
        .setActiveEvents(rapier.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(config.damage.hitThreshold * 0.5),
      this.body,
    )
    this.controller = world.createVehicleController(this.body)
    this.controller.indexUpAxis = 1
    this.controller.setIndexForwardAxis = 2
    const connectionY = tuning.suspensionRest + spec.wheelRadius - spec.centreHeight
    const wheelPositions = [
      [-spec.track / 2, connectionY, -spec.wheelbase / 2],
      [spec.track / 2, connectionY, -spec.wheelbase / 2],
      [-spec.track / 2, connectionY, spec.wheelbase / 2],
      [spec.track / 2, connectionY, spec.wheelbase / 2],
    ]
    wheelPositions.forEach(([x, y, z], i) => {
      this.controller.addWheel({ x, y, z }, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, tuning.suspensionRest, spec.wheelRadius)
      this.controller.setWheelSuspensionStiffness(i, tuning.suspensionStiffness)
      this.controller.setWheelMaxSuspensionTravel(i, tuning.suspensionTravel)
      this.controller.setWheelSuspensionCompression(i, tuning.suspensionCompression)
      this.controller.setWheelSuspensionRelaxation(i, tuning.suspensionRelaxation)
      this.controller.setWheelMaxSuspensionForce(i, tuning.maxSuspensionForce)
      this.controller.setWheelFrictionSlip(i, tuning.frictionSlip)
      this.controller.setWheelSideFrictionStiffness(i, tuning.sideFrictionStiffness)
    })
    physics.track(this.body)
    this.handling = handlingOf(this.damage, config.damage.handling)
  }

  get power(): number {
    const floor = config.damage.powerFloor
    return floor + (1 - floor) * Math.max(0, this.engine) / 100
  }

  get speed(): number {
    const v = this.body.linvel()
    return Math.sqrt(v.x * v.x + v.z * v.z)
  }

  /** Signed speed along the car's forward axis (positive is driving forward). */
  get forwardSpeed(): number {
    this.readPose()
    const v = this.body.linvel()
    return this.forward.dot(this.velocity.set(v.x, v.y, v.z))
  }

  readPose(): void {
    const t = this.body.translation()
    const r = this.body.rotation()
    this.position.set(t.x, t.y, t.z)
    this.quaternion.set(r.x, r.y, r.z, r.w)
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion)
  }

  get pos(): THREE.Vector3 {
    this.readPose()
    return this.position
  }

  get heading(): THREE.Vector3 {
    this.readPose()
    return this.forward
  }

  get upright(): boolean {
    this.readPose()
    return this.local.set(0, 1, 0).applyQuaternion(this.quaternion).y > 0.35
  }

  get stuck(): boolean {
    return this.stuckClock > this.tuning.stuckSeconds
  }

  /** Where a world-space point lies on the car: nose, tail or a flank. */
  zoneOf(point: THREE.Vector3): HitZone {
    this.readPose()
    this.local.copy(point).sub(this.position).applyQuaternion(this.quaternion.clone().invert())
    const frontLimit = -this.spec.length * 0.3
    const rearLimit = this.spec.length * 0.3
    if (this.local.z < frontLimit) return 'front'
    if (this.local.z > rearLimit) return 'rear'
    return 'side'
  }

  toLocal(point: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    this.readPose()
    return target.copy(point).sub(this.position).applyQuaternion(this.quaternion.clone().invert())
  }

  /** Applies a hit to this car: body and engine health, the component damage around the struck point, dents and parts; returns the health it lost. */
  takeHit(hit: Hit, from: number, now: number, damage: DamageSpec = this.rules): number {
    const last = this.lastHitAt.get(from) ?? -Infinity
    if (now - last < damage.hitCooldown) return 0
    this.lastHitAt.set(from, now)
    const zoneScale = damage.zone[hit.zone]
    const loss = damage.maxHitDamage * hit.strength * zoneScale * (hit.wall ? damage.wallScale : 1)
    const localPoint = this.toLocal(hit.point, new THREE.Vector3())
    const half = this.spec.length / 2
    localPoint.z = Math.max(-half, Math.min(half, localPoint.z))
    localPoint.x = Math.max(-this.spec.width / 2, Math.min(this.spec.width / 2, localPoint.x))
    const direction = new THREE.Vector3()
    if (hit.zone === 'side') direction.set(-Math.sign(localPoint.x) || 1, 0, 0)
    else direction.set(0, 0, hit.zone === 'front' ? 1 : -1)
    const dentStrength = Math.min(1, 0.3 + hit.strength * 0.8) * (hit.wall ? 0.75 : 1)
    this.model.dent(localPoint, direction, dentStrength, { radius: damage.dentRadius, depth: damage.dentDepth, maxDepth: damage.dentMaxDepth, darken: damage.dentDarken })
    if (!this.alive) {
      this.showParts()
      return 0
    }
    this.health = Math.max(0, this.health - loss)
    this.engine = Math.max(0, this.engine - loss * damage.engineShare[hit.zone])
    this.hitCount++
    this.news.push(...applyComponentHit(this.damage, this.spec, damage, localPoint.x, localPoint.y, localPoint.z, loss, this.id * 131 + this.hitCount))
    this.showParts()
    if (this.health <= 0) this.knockOut('wrecked')
    return loss
  }

  private showParts(): void {
    this.detached.push(...this.model.showDamage(this.damage))
  }

  knockOut(reason: 'wrecked' | 'idle'): void {
    if (!this.alive) return
    this.alive = false
    this.outReason = reason
    this.controls.throttle = 0
    this.controls.steer = 0
    this.controls.brake = true
    this.model.paint.color.multiplyScalar(0.72)
  }

  /** Steps the controls into the vehicle controller and the controller itself. */
  update(dt: number, filter: (collider: RAPIER.Collider) => boolean): void {
    const { tuning } = this
    this.readPose()
    const speed = this.speed
    const forwardSpeed = this.forwardSpeed
    this.applyHandling()
    const handling = this.handling
    const lock = tuning.maxSteer * handling.steerScale * (1 - (1 - tuning.steerAtSpeedScale) * Math.min(1, speed / tuning.steerFadeSpeed))
    const target = this.alive ? this.controls.steer * lock + handling.pull : handling.pull
    const rate = tuning.steerRate * dt
    this.steerAngle += Math.max(-rate, Math.min(rate, target - this.steerAngle))
    const throttle = this.alive ? this.controls.throttle : 0
    const torque = tuning.launchBoost + (tuning.topEndForce - tuning.launchBoost) * Math.min(1, Math.abs(forwardSpeed) / tuning.topSpeed)
    const top = tuning.topSpeed * (0.75 + 0.25 * handling.drive)
    let engineForce = 0
    if (throttle > 0 && forwardSpeed < top) engineForce = tuning.engineForce * throttle * this.power * handling.drive * torque
    else if (throttle < 0 && forwardSpeed > -tuning.reverseTopSpeed) engineForce = tuning.reverseForce * throttle * this.power * handling.drive * torque
    const braking = this.controls.brake && this.alive
    const brake = (braking ? tuning.brakeForce : throttle === 0 ? tuning.rollingBrake : 0) + handling.drag
    for (let i = 0; i < 4; i++) {
      const steer = i < 2 ? -this.steerAngle - this.damage.wheels[i].toe : -this.damage.wheels[i].toe
      this.controller.setWheelSteering(i, steer)
      this.controller.setWheelEngineForce(i, this.damage.wheels[i].off ? 0 : i >= 2 ? engineForce : engineForce * 0.15)
      this.controller.setWheelBrake(i, this.alive ? brake * (this.damage.wheels[i].off ? 2 : 1) : tuning.brakeForce * 0.6)
    }
    this.controller.updateVehicle(dt, undefined, undefined, filter)
    this.engineBox.value = this.engine
    const burn = stepComponents(this.damage, this.rules, this.engineBox, this.alive ? throttle : 0, dt, this.news)
    this.engine = this.engineBox.value
    if (burn > 0 && this.alive) {
      this.health = Math.max(0, this.health - burn)
      if (this.health <= 0) this.knockOut('wrecked')
    }
    if (Math.abs(throttle) > 0.4 && speed < tuning.stuckSpeed) this.stuckClock += dt
    else this.stuckClock = Math.max(0, this.stuckClock - dt * 2)
    if (!this.upright) {
      this.flipClock += dt
      if (!this.rolled && this.flipClock > 0.4) {
        this.rolled = true
        this.rollOnto()
      }
    } else {
      this.flipClock = 0
      this.rolled = false
    }
    if (this.alive) {
      this.idle += dt
      this.survived += dt
    }
  }

  /** Pushes this step's damage into the vehicle controller: per-wheel grip, springs, ride height and rolling radius. */
  private applyHandling(): void {
    if (this.handlingVersion === this.damage.version) return
    this.handlingVersion = this.damage.version
    const handling = handlingOf(this.damage, config.damage.handling, this.handling)
    const { tuning } = this
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelFrictionSlip(i, tuning.frictionSlip * handling.grip[i])
      this.controller.setWheelSideFrictionStiffness(i, tuning.sideFrictionStiffness * handling.grip[i])
      this.controller.setWheelSuspensionStiffness(i, tuning.suspensionStiffness * handling.spring[i])
      this.controller.setWheelSuspensionRestLength(i, tuning.suspensionRest + handling.drop[i])
      this.controller.setWheelRadius(i, this.spec.wheelRadius * handling.radius[i])
    }
  }

  /** The car landed on its roof: crush it in and crack the glass. */
  private rollOnto(): void {
    const rules = this.rules
    this.news.push(...applyRoll(this.damage, rules))
    const roofY = this.spec.roof - this.spec.centreHeight
    this.model.dent(new THREE.Vector3(0, roofY, 0), new THREE.Vector3(0, -1, 0), 0.9, { radius: this.spec.length * 0.35, depth: rules.dentDepth * 1.3, maxDepth: rules.dentMaxDepth, darken: rules.dentDarken })
    if (this.alive) {
      this.health = Math.max(0, this.health - rules.component.rollLoss)
      if (this.health <= 0) this.knockOut('wrecked')
    }
    this.showParts()
  }

  /** The steering input that cancels the pull of bent front wheels (what a driver holds to go straight). */
  get steerPull(): number {
    return this.handling.pull / Math.max(0.05, this.tuning.maxSteer * this.handling.steerScale)
  }

  /** Visual wheel state: camber, toe, flat and missing. */
  wheelState(i: number): CarDamage['wheels'][number] {
    return this.damage.wheels[i]
  }

  get flippedFor(): number {
    return this.flipClock
  }

  /** Sets the car back on its wheels where it is (used after a roll-over). */
  rightSelf(): void {
    this.readPose()
    const yaw = Math.atan2(this.forward.x, this.forward.z) + Math.PI
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    this.body.setTranslation({ x: this.position.x, y: this.spec.centreHeight + 0.6, z: this.position.z }, true)
    this.body.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.flipClock = 0
    this.stuckClock = 0
    this.physics.track(this.body)
  }

  /** Copies the body pose onto the model, lays the contact shadow under it and spins the wheels. */
  sync(alpha: number): void {
    this.physics.syncMesh(this.body, this.model.root, alpha)
    const root = this.model.root
    const shadow = this.model.shadow
    const yaw = Math.atan2(2 * (root.quaternion.w * root.quaternion.y + root.quaternion.x * root.quaternion.z), 1 - 2 * (root.quaternion.y * root.quaternion.y + root.quaternion.x * root.quaternion.x))
    shadow.position.set(root.position.x, 0.02, root.position.z)
    shadow.rotation.set(-Math.PI / 2, 0, yaw)
    const lift = Math.max(0, root.position.y - this.spec.centreHeight)
    const spread = 1 + lift * 0.4
    shadow.scale.set(spread, spread, 1)
    ;(shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.15, 0.85 - lift * 0.5)
    for (let i = 0; i < 4; i++) {
      const wheel = this.model.wheels[i]
      const connection = this.controller.wheelChassisConnectionPointCs(i)
      const length = this.controller.wheelSuspensionLength(i) ?? this.tuning.suspensionRest
      const state = this.damage.wheels[i]
      const squash = state.flat && !state.off ? this.spec.wheelRadius * (1 - this.handling.radius[i]) : 0
      if (connection) wheel.position.set(connection.x + (i % 2 === 0 ? -1 : 1) * Math.abs(state.camber) * 0.12, connection.y - length - squash * 0.5, connection.z)
      wheel.rotation.set(0, (i < 2 ? -this.steerAngle : 0) - state.toe, state.camber)
      wheel.rotateX(this.controller.wheelRotation(i) ?? 0)
      const flatScale = state.flat ? 1 - (1 - this.handling.radius[i]) * 0.5 : 1
      wheel.scale.set(1, flatScale, flatScale)
    }
  }

  /** World position of a wheel's contact patch, when it touches the ground. */
  wheelGround(i: number): THREE.Vector3 | null {
    if (!this.controller.wheelIsInContact(i)) return null
    const point = this.controller.wheelContactPoint(i)
    return point ? this.wheelContact.set(point.x, point.y, point.z) : null
  }

  /** Lateral slip of the rear axle (m/s), used for dust. */
  get sideSlip(): number {
    this.readPose()
    const v = this.body.linvel()
    this.velocity.set(v.x, 0, v.z)
    const right = this.local.set(1, 0, 0).applyQuaternion(this.quaternion)
    return Math.abs(right.dot(this.velocity))
  }

  dispose(): void {
    this.physics.untrack(this.body)
    this.physics.world.removeVehicleController(this.controller)
    this.physics.world.removeRigidBody(this.body)
    this.model.dispose()
  }
}
