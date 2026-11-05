/** One derby car: a Rapier chassis body with a raycast vehicle controller, its visual model, controls, damage (body and engine), dents, the out-of-the-heat state and the idle clock. */
import * as THREE from 'three/webgpu'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { PhysicsWorld } from '../../../engine'
import { config, type BodySpec, type DamageSpec, type VehicleSpec } from '../config'
import { createCar, type CarModel } from '../models/CarBody'
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

  /** Applies a hit to this car; returns the health it lost. */
  takeHit(hit: Hit, from: number, now: number, damage: DamageSpec): number {
    const last = this.lastHitAt.get(from) ?? -Infinity
    if (now - last < damage.hitCooldown) return 0
    this.lastHitAt.set(from, now)
    if (!this.alive) return 0
    const zoneScale = damage.zone[hit.zone]
    const loss = damage.maxHitDamage * hit.strength * zoneScale
    this.health = Math.max(0, this.health - loss)
    this.engine = Math.max(0, this.engine - loss * damage.engineShare[hit.zone])
    const localPoint = this.toLocal(hit.point, new THREE.Vector3())
    const direction = new THREE.Vector3(-localPoint.x, 0, -localPoint.z)
    if (hit.zone === 'side') direction.set(-Math.sign(localPoint.x) || 1, 0, 0)
    else direction.set(0, 0, hit.zone === 'front' ? 1 : -1)
    this.model.dent(localPoint, direction.normalize(), Math.min(1, 0.3 + hit.strength * 0.8), { radius: damage.dentRadius, depth: damage.dentDepth, maxDepth: damage.dentMaxDepth, darken: damage.dentDarken })
    if (this.health <= 0) this.knockOut('wrecked')
    return loss
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
    const target = this.alive ? this.controls.steer * tuning.maxSteer * (1 - (1 - tuning.steerAtSpeedScale) * Math.min(1, speed / tuning.steerFadeSpeed)) : 0
    const rate = tuning.steerRate * dt
    this.steerAngle += Math.max(-rate, Math.min(rate, target - this.steerAngle))
    const throttle = this.alive ? this.controls.throttle : 0
    let engineForce = 0
    if (throttle > 0 && forwardSpeed < tuning.topSpeed) engineForce = tuning.engineForce * throttle * this.power
    else if (throttle < 0 && forwardSpeed > -tuning.reverseTopSpeed) engineForce = tuning.reverseForce * throttle * this.power
    const braking = this.controls.brake && this.alive
    const brake = braking ? tuning.brakeForce : throttle === 0 ? tuning.rollingBrake : 0
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSteering(i, i < 2 ? -this.steerAngle : 0)
      this.controller.setWheelEngineForce(i, i >= 2 ? engineForce : engineForce * 0.15)
      this.controller.setWheelBrake(i, this.alive ? brake : tuning.brakeForce * 0.6)
    }
    this.controller.updateVehicle(dt, undefined, undefined, filter)
    if (Math.abs(throttle) > 0.4 && speed < tuning.stuckSpeed) this.stuckClock += dt
    else this.stuckClock = Math.max(0, this.stuckClock - dt * 2)
    if (!this.upright) this.flipClock += dt
    else this.flipClock = 0
    if (this.alive) {
      this.idle += dt
      this.survived += dt
    }
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
      if (connection) wheel.position.set(connection.x, connection.y - length, connection.z)
      wheel.rotation.set(0, i < 2 ? -this.steerAngle : 0, 0)
      wheel.rotateX(this.controller.wheelRotation(i) ?? 0)
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
