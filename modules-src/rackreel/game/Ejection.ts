/**
 * A driver thrown through the UTV's windshield by a hard tree hit, renderer-free:
 * flies forward off the seat, hits the ground and rolls head over heels, lies
 * face down for a moment and then gets back up. `hip` is the body's pivot
 * (the avatar's hips), `pitch` the forward tumble about it and `facing` the
 * direction of travel.
 */

/** A tree hit at this share of the UTV's top speed or more throws the driver. */
export const EJECT_SPEED_SHARE = 0.5
/** How far off straight ahead (radians) the driver flies, away from the trunk. */
export const EJECT_DEFLECT = 0.45
/** The avatar's hip height standing (`HIP_HEIGHT` in Avatar.ts). */
const HIP = 0.98
const LAUNCH_UP = 3.2
const LAUNCH_SHARE = 0.6
const LAUNCH_MAX = 9
const GRAVITY = 9.8
const FLY_SPIN = 2.4
const TUCK_RADIUS = 0.35
const PRONE_HIP = 0.16
const ROLL_DRAG = 3.4
const ROLL_MIN = 1.3
const LIE_SECONDS = 0.8
const RISE_SECONDS = 1.1
const MAX_SECONDS = 8
const TAU = Math.PI * 2
const PRONE = Math.PI / 2

export type EjectPhase = 'fly' | 'roll' | 'lie' | 'rise' | 'done'

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface EjectWorld {
  groundAt(x: number, z: number): number
  /** True where a body can't go (a trunk, deep water, the edge of the map). */
  blocked(x: number, z: number): boolean
}

/** The heading the driver flies on: straight ahead, turned away from the side the trunk is on. */
export function ejectHeading(heading: number, at: { x: number; z: number }, trunk: { x: number; z: number }): number {
  const rx = trunk.x - at.x
  const rz = trunk.z - at.z
  const right = rx * Math.cos(heading) - rz * Math.sin(heading)
  return heading + (right > 0 ? -EJECT_DEFLECT : EJECT_DEFLECT)
}

export class Ejection {
  phase: EjectPhase = 'fly'
  readonly hip: Point3
  pitch = 0
  readonly facing: number
  private vy = LAUNCH_UP
  private speed: number
  private t = 0
  private phaseT = 0
  private liePitch = PRONE

  constructor(seat: Point3, facing: number, vehicleSpeed: number, private readonly world: EjectWorld) {
    this.hip = { x: seat.x, y: seat.y, z: seat.z }
    this.facing = facing
    this.speed = Math.min(LAUNCH_MAX, Math.abs(vehicleSpeed) * LAUNCH_SHARE)
  }

  get done(): boolean {
    return this.phase === 'done'
  }

  /** Knees drawn in while tumbling and while getting up. */
  get tucked(): boolean {
    return this.phase === 'roll' || this.phase === 'rise'
  }

  /** The ground point under the body (for the camera and where the player stands up). */
  get ground(): Point3 {
    return { x: this.hip.x, y: this.world.groundAt(this.hip.x, this.hip.z), z: this.hip.z }
  }

  step(dt: number): void {
    if (this.phase === 'done') return
    this.t += dt
    this.phaseT += dt
    if (this.t > MAX_SECONDS && this.phase !== 'rise') this.enter('rise')
    if (this.phase === 'fly' || this.phase === 'roll') this.slide(dt)
    const ground = this.world.groundAt(this.hip.x, this.hip.z)
    if (this.phase === 'fly') {
      this.vy -= GRAVITY * dt
      this.hip.y += this.vy * dt
      this.pitch += FLY_SPIN * dt
      if (this.vy < 0 && this.hip.y <= ground + TUCK_RADIUS) {
        this.hip.y = ground + TUCK_RADIUS
        this.speed *= 0.75
        this.enter('roll')
      }
      return
    }
    if (this.phase === 'roll') {
      this.speed = Math.max(ROLL_MIN, this.speed - ROLL_DRAG * dt)
      const before = this.pitch
      this.pitch += (this.speed / TUCK_RADIUS) * dt
      this.hip.y = ground + TUCK_RADIUS
      const settling = this.speed <= ROLL_MIN + 1e-6
      const target = Math.floor((before - PRONE) / TAU) * TAU + TAU + PRONE
      if (settling && before < target && this.pitch >= target) {
        this.pitch = target
        this.liePitch = target
        this.speed = 0
        this.enter('lie')
      }
      return
    }
    if (this.phase === 'lie') {
      const k = Math.min(1, this.phaseT / 0.25)
      this.hip.y = ground + TUCK_RADIUS + (PRONE_HIP - TUCK_RADIUS) * k
      if (this.phaseT >= LIE_SECONDS) this.enter('rise')
      return
    }
    const k = Math.min(1, this.phaseT / RISE_SECONDS)
    const e = k * k * (3 - 2 * k)
    const startPitch = this.liePitch - Math.round((this.liePitch - PRONE) / TAU) * TAU
    this.pitch = startPitch * (1 - e)
    this.hip.y = ground + PRONE_HIP + (HIP - PRONE_HIP) * e
    if (k >= 1) this.enter('done')
  }

  private slide(dt: number): void {
    if (this.speed <= 0) return
    const nx = this.hip.x + Math.sin(this.facing) * this.speed * dt
    const nz = this.hip.z + Math.cos(this.facing) * this.speed * dt
    if (this.world.blocked(nx, nz)) {
      this.speed = this.phase === 'roll' ? ROLL_MIN * 0.5 : 0
      return
    }
    this.hip.x = nx
    this.hip.z = nz
  }

  private enter(phase: EjectPhase): void {
    if (phase === 'rise' && this.phase !== 'lie') this.liePitch = this.pitch
    this.phase = phase
    this.phaseT = 0
  }
}
