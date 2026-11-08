import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { EngineContext } from '../core/EngineSetup'
import type { ModelRig } from '../core/ModelLibrary'
import { PLAY_LIMIT, WATER_LEVEL } from '../world/Terrain'
import type { Terrain } from '../world/Terrain'
import { bufferedSine } from './Waves'

export { bufferedSine, SINE_BUFFER } from './Waves'

export type VehicleMode = 'NONE' | 'ATV' | 'BOAT'

export interface DriveInput {
  throttle: number
  steer: number
  brake: boolean
}

export const ATV_TUNING = {
  maxForward: 17,
  maxReverse: 6,
  accel: 7.5,
  brake: 16,
  rolling: 0.9,
  drag: 0.012,
  wheelBase: 1.95,
  track: 1.24,
  maxSteer: 0.6,
  wheelRadius: 0.34,
  rideHeight: 0.02,
  maxClimb: 0.68,
  wadeDepth: 0.55,
  spring: 60,
  damping: 13,
}

export const BOAT_TUNING = {
  maxForward: 15,
  maxReverse: 3.5,
  accel: 4.8,
  drag: 0.045,
  idleDrag: 0.6,
  turnRate: 0.85,
  minDepth: 0.45,
  draft: 0.12,
  bobAmplitude: 0.055,
  pitchAmplitude: 0.022,
  rollAmplitude: 0.03,
  planeLift: 0.13,
}

export interface Vehicle {
  kind: 'ATV' | 'BOAT'
  rig: ModelRig
  root: TransformNode
  position: Vector3
  heading: number
  speed: number
  steer: number
  pitch: number
  roll: number
  vy: number
  slopeAngle: number
  wheelSpin: number
  seat: Vector3
  exitSide: Vector3
  clock: number
  occupied: boolean
}

export class VehicleController {
  mode: VehicleMode = 'NONE'
  active: Vehicle | null = null
  readonly vehicles: Vehicle[] = []
  private readonly wheelLocal = [
    { name: 'wheelFL', x: 0.62, z: 1.0 },
    { name: 'wheelFR', x: -0.62, z: 1.0 },
    { name: 'wheelBL', x: 0.62, z: -0.95 },
    { name: 'wheelBR', x: -0.62, z: -0.95 },
  ]

  constructor(private readonly ctx: EngineContext, private readonly terrain: Terrain, private readonly ground: Mesh) {}

  add(kind: 'ATV' | 'BOAT', rig: ModelRig, position: Vector3, heading: number): Vehicle {
    const root = rig.root
    root.rotationQuaternion = new Quaternion()
    const vehicle: Vehicle = {
      kind, rig, root, position: position.clone(), heading, speed: 0, steer: 0, pitch: 0, roll: 0, vy: 0, slopeAngle: 0, wheelSpin: 0,
      seat: kind === 'ATV' ? new Vector3(0.3, 0.92, -0.05) : new Vector3(0.0, 0.42, -2.25),
      exitSide: kind === 'ATV' ? new Vector3(1.6, 0, 0) : new Vector3(1.8, 0, 0),
      clock: Math.random() * 10,
      occupied: false,
    }
    if (kind === 'ATV') vehicle.position.y = this.terrain.heightAt(position.x, position.z) + ATV_TUNING.rideHeight
    this.vehicles.push(vehicle)
    this.applyTransform(vehicle)
    return vehicle
  }

  nearest(point: Vector3, range: number): Vehicle | null {
    let best: Vehicle | null = null
    let bestD = range
    for (const v of this.vehicles) {
      const d = Vector3.Distance(point, v.position)
      if (d < bestD) {
        bestD = d
        best = v
      }
    }
    return best
  }

  enter(vehicle: Vehicle): void {
    this.active = vehicle
    this.mode = vehicle.kind
    vehicle.occupied = true
  }

  exit(): Vector3 | null {
    const v = this.active
    if (!v) return null
    const side = this.localToWorld(v, v.exitSide)
    let spot = side
    if (v.kind === 'BOAT' || this.terrain.depthAt(side.x, side.z) > 0.7) spot = this.findShore(v) ?? side
    if (v.kind === 'BOAT' && this.terrain.depthAt(spot.x, spot.z) > 0.9) return null
    v.occupied = false
    v.speed = 0
    this.active = null
    this.mode = 'NONE'
    spot.y = this.terrain.heightAt(spot.x, spot.z)
    return spot
  }

  private findShore(v: Vehicle): Vector3 | null {
    for (let r = 2; r < 12; r += 1) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2
        const x = v.position.x + Math.cos(ang) * r
        const z = v.position.z + Math.sin(ang) * r
        if (this.terrain.heightAt(x, z) > 0.15) return new Vector3(x, 0, z)
      }
    }
    return null
  }

  localToWorld(v: Vehicle, local: Vector3): Vector3 {
    const c = Math.cos(v.heading)
    const s = Math.sin(v.heading)
    return new Vector3(v.position.x + local.x * c + local.z * s, v.position.y + local.y, v.position.z - local.x * s + local.z * c)
  }

  forward(v: Vehicle): Vector3 {
    return new Vector3(Math.sin(v.heading), 0, Math.cos(v.heading))
  }

  update(dt: number, input: DriveInput): void {
    for (const v of this.vehicles) {
      v.clock += dt
      const drive = v === this.active ? input : { throttle: 0, steer: 0, brake: true }
      if (v.kind === 'ATV') this.updateAtv(v, dt, drive)
      else this.updateBoat(v, dt, drive)
      this.applyTransform(v)
    }
  }

  private wheelContact(v: Vehicle, lx: number, lz: number, x: number, z: number): { y: number; nx: number; ny: number; nz: number } {
    const c = Math.cos(v.heading)
    const s = Math.sin(v.heading)
    const wx = x + lx * c + lz * s
    const wz = z - lx * s + lz * c
    const hit = this.ctx.groundRay(this.ground, wx, wz)
    if (hit) return { y: hit.y, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z }
    return { y: this.terrain.heightAt(wx, wz), nx: 0, ny: 1, nz: 0 }
  }

  private trunkBlocked(x: number, z: number, radius: number): boolean {
    for (const t of this.ctx.queryTrunks(x, z, radius)) {
      if ((t.x - x) ** 2 + (t.z - z) ** 2 < (t.r + radius) ** 2) return true
    }
    return false
  }

  private updateAtv(v: Vehicle, dt: number, input: DriveInput): void {
    const T = ATV_TUNING
    const targetSteer = input.steer * T.maxSteer * (1 - Math.min(0.55, Math.abs(v.speed) / T.maxForward * 0.55))
    v.steer += (targetSteer - v.steer) * Math.min(1, dt * 6)
    if (input.brake) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), T.brake * dt)
    else if (input.throttle > 0) v.speed += input.throttle * T.accel * dt * (v.speed < 0 ? 2.2 : 1)
    else if (input.throttle < 0) v.speed += input.throttle * T.accel * dt * (v.speed > 0 ? 2.2 : 0.7)
    v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), (T.rolling + T.drag * v.speed * v.speed) * dt)
    v.speed -= Math.sin(v.pitch) * 9.8 * dt * 0.55
    v.speed = Math.max(-T.maxReverse, Math.min(T.maxForward, v.speed))
    const yawRate = (v.speed / T.wheelBase) * Math.tan(v.steer)
    const nextHeading = v.heading + yawRate * dt
    const fx = Math.sin(nextHeading)
    const fz = Math.cos(nextHeading)
    let nx = v.position.x + fx * v.speed * dt
    let nz = v.position.z + fz * v.speed * dt
    const probeX = nx + fx * Math.sign(v.speed) * 1.1
    const probeZ = nz + fz * Math.sign(v.speed) * 1.1
    const blocked = this.trunkBlocked(probeX, probeZ, 0.7) || this.terrain.depthAt(probeX, probeZ) > T.wadeDepth || Math.abs(probeX) > PLAY_LIMIT || Math.abs(probeZ) > PLAY_LIMIT
    const climb = this.terrain.slopeAt(probeX, probeZ)
    const uphill = this.terrain.heightAt(probeX, probeZ) > this.terrain.heightAt(nx, nz)
    if (blocked || (climb > T.maxClimb && uphill && Math.abs(v.speed) > 0.2)) {
      v.speed = -v.speed * 0.2
      nx = v.position.x
      nz = v.position.z
    } else {
      v.heading = nextHeading
    }
    const contacts = this.wheelLocal.map((w) => this.wheelContact(v, w.x, w.z, nx, nz))
    const [fl, fr, bl, br] = contacts
    const front = (fl.y + fr.y) / 2
    const back = (bl.y + br.y) / 2
    const left = (fl.y + bl.y) / 2
    const right = (fr.y + br.y) / 2
    const targetY = (front + back) / 2 + T.rideHeight
    const targetPitch = -Math.atan2(front - back, T.wheelBase)
    const targetRoll = Math.atan2(left - right, T.track)
    let ny = 0
    for (const c of contacts) ny += c.ny
    v.slopeAngle = Math.acos(Math.min(1, ny / 4))
    if (v.position.y > targetY + 0.08) {
      v.vy -= 9.8 * dt
    } else {
      const springForce = (targetY - v.position.y) * T.spring - v.vy * T.damping
      v.vy += springForce * dt
    }
    v.position.set(nx, Math.max(v.position.y + v.vy * dt, targetY - 0.05), nz)
    if (v.position.y <= targetY - 0.049 && v.vy < 0) v.vy = 0
    const k = Math.min(1, dt * 9)
    v.pitch += (targetPitch - v.pitch) * k
    v.roll += (targetRoll - v.roll) * k
    v.wheelSpin += (v.speed / T.wheelRadius) * dt
    for (const w of this.wheelLocal) {
      const joint = v.rig.joints.get(w.name)
      if (!joint) continue
      joint.rotation.x = v.wheelSpin
      joint.rotation.y = w.z > 0 ? v.steer : 0
    }
  }

  private updateBoat(v: Vehicle, dt: number, input: DriveInput): void {
    const T = BOAT_TUNING
    v.steer += (input.steer - v.steer) * Math.min(1, dt * 3)
    if (input.throttle > 0) v.speed += input.throttle * T.accel * dt
    else if (input.throttle < 0) v.speed += input.throttle * T.accel * dt * (v.speed > 0 ? 1.6 : 0.8)
    const drag = T.drag * v.speed * Math.abs(v.speed) + Math.sign(v.speed) * T.idleDrag * (input.throttle === 0 ? 1 : 0.2)
    v.speed -= Math.sign(drag) * Math.min(Math.abs(v.speed), Math.abs(drag) * dt)
    if (input.brake) v.speed *= Math.max(0, 1 - dt * 1.5)
    v.speed = Math.max(-T.maxReverse, Math.min(T.maxForward, v.speed))
    const authority = Math.min(1, 0.25 + Math.abs(v.speed) / 5)
    v.heading += v.steer * T.turnRate * authority * dt * (v.speed < 0 ? -1 : 1)
    const fx = Math.sin(v.heading)
    const fz = Math.cos(v.heading)
    const nx = v.position.x + fx * v.speed * dt
    const nz = v.position.z + fz * v.speed * dt
    const bowX = nx + fx * 2.6 * Math.sign(v.speed || 1)
    const bowZ = nz + fz * 2.6 * Math.sign(v.speed || 1)
    if (this.terrain.depthAt(bowX, bowZ) < T.minDepth || this.terrain.depthAt(nx, nz) < T.minDepth) {
      v.speed = -v.speed * 0.15
    } else {
      v.position.x = nx
      v.position.z = nz
    }
    const t = v.clock
    const planing = Math.min(1, Math.abs(v.speed) / T.maxForward)
    const swell = T.bobAmplitude * (bufferedSine(t * 1.35) * 0.65 + bufferedSine(t * 2.31 + 1.7) * 0.35) * (1 - planing * 0.5)
    const targetY = WATER_LEVEL - T.draft + swell + planing * 0.08
    v.position.y += (targetY - v.position.y) * Math.min(1, dt * 4)
    const targetPitch = -planing * T.planeLift + T.pitchAmplitude * bufferedSine(t * 1.05 + 0.6) + (planing > 0.3 ? T.pitchAmplitude * 0.5 * bufferedSine(t * 7.3) * planing : 0)
    const targetRoll = T.rollAmplitude * bufferedSine(t * 0.87 + 2.1) - v.steer * planing * 0.08
    v.pitch += (targetPitch - v.pitch) * Math.min(1, dt * 3)
    v.roll += (targetRoll - v.roll) * Math.min(1, dt * 3)
    const motor = v.rig.joints.get('motor')
    if (motor) motor.rotation.y = -v.steer * 0.45
  }

  private applyTransform(v: Vehicle): void {
    v.root.position.copyFrom(v.position)
    Quaternion.FromEulerAnglesToRef(v.pitch, v.heading, v.roll, v.root.rotationQuaternion!)
  }

  driverTransform(v: Vehicle): { position: Vector3; rotation: Quaternion } {
    return { position: this.localToWorld(v, v.seat), rotation: v.root.rotationQuaternion!.clone() }
  }
}

export function attachDriver(parent: TransformNode, seat: Vector3): TransformNode {
  const node = new TransformNode('driver-seat', parent.getScene())
  node.parent = parent
  node.position.copyFrom(seat)
  return node
}
