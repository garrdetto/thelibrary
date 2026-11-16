/**
 * Flying a helicopter (a vehicle whose tuning has `flight`, Life Sim only). The skids are the raycast wheels, so on
 * the ground it sits and slides like any vehicle with its brakes on. Climbing (Space) lifts it off; in the air gravity
 * is switched off for its body and the body is flown toward a target velocity: W/S ask for forward speed up to the
 * top speed, A/D a turn rate, Space and Shift a climb or descent rate, nothing holds the altitude. Each step moves the
 * velocity at most `accel` m/s² toward that target (a little more for climbing), so it eases in and out, and the body
 * leans toward where it is going: nose down with forward speed and throttle, banked into turns. Descending onto the
 * ground with little speed lands it. Without a pilot (or out of fuel) it sinks to the ground on its own.
 */
import type RAPIER from '@dimforge/rapier3d-compat'
import type { FlightTuning, VehicleTuning } from '../../../maplestreet/shared/Vehicles'

export interface FlightInput {
  throttle: number
  steer: number
  /** +1 climb, −1 descend, 0 hold; undefined when nobody is flying it. */
  lift?: number
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const G = 9.81
/** Below this horizontal speed (m/s) a descent onto the skids lands it. */
const LAND_SPEED = 4
/** How hard the body is turned toward the attitude it should have (1/s). */
const ALIGN = 4.5

export class Flight {
  /** In the air (gravity off, flown); false while it rests on its skids. */
  flying = false
  /** Rotor speed, 0 (stopped) to 1 (flying); the view spins the rotors with it. */
  spool = 0
  private readonly f: FlightTuning

  constructor(private readonly body: RAPIER.RigidBody, private readonly ctrl: RAPIER.DynamicRayCastVehicleController, private readonly preset: VehicleTuning) {
    this.f = preset.flight!
  }

  private grounded(): boolean {
    const n = this.ctrl.numWheels()
    for (let i = 0; i < n; i++) if (this.ctrl.wheelIsInContact(i)) return true
    return false
  }

  /** One physics step; returns the fuel burned this step in "metres driven" (the car's own fuel rate applies). */
  step(dt: number, input: FlightInput, empty: boolean): number {
    const f = this.f
    const P = this.preset
    const piloted = input.lift !== undefined
    const lift = piloted ? clamp(input.lift!, -1, 1) : -1
    const grounded = this.grounded()
    const lv = this.body.linvel()
    const r = this.body.rotation()
    const fx = 1 - 2 * (r.y * r.y + r.z * r.z)
    const fz = 2 * (r.x * r.z - r.w * r.y)
    const fl = Math.hypot(fx, fz) || 1
    const hx = fx / fl
    const hz = fz / fl
    if (!this.flying && piloted && lift > 0 && !empty) {
      this.flying = true
      this.body.setGravityScale(0, true)
    }
    const hSpeed = Math.hypot(lv.x, lv.z)
    if (this.flying && grounded && lift < 0 && hSpeed < LAND_SPEED) {
      this.flying = false
      this.body.setGravityScale(1, true)
    }
    this.spool = clamp(this.spool + ((this.flying || (piloted && lift > 0)) ? dt / 2.5 : -dt / 6), 0, 1)
    const n = this.ctrl.numWheels()
    if (!this.flying) {
      for (let i = 0; i < n; i++) {
        this.ctrl.setWheelEngineForce(i, 0)
        this.ctrl.setWheelSteering(i, 0)
        this.ctrl.setWheelBrake(i, P.brake)
      }
      return 0
    }
    for (let i = 0; i < n; i++) {
      this.ctrl.setWheelEngineForce(i, 0)
      this.ctrl.setWheelSteering(i, 0)
      this.ctrl.setWheelBrake(i, 0)
    }
    const throttle = piloted ? clamp(input.throttle, -1, 1) : 0
    const steer = piloted ? clamp(input.steer, -1, 1) : 0
    const top = P.topSpeed
    const fwdSpeed = lv.x * hx + lv.z * hz
    const want = throttle >= 0 ? throttle * top : throttle * top * 0.25
    const tx = hx * want
    const tz = hz * want
    const step = f.accel * dt
    let dx = tx - lv.x
    let dz = tz - lv.z
    const dl = Math.hypot(dx, dz)
    if (dl > step) {
      dx *= step / dl
      dz *= step / dl
    }
    const wantVy = empty ? -f.climb * 0.6 : lift * f.climb
    const vy = lv.y + clamp(wantVy - lv.y, -f.accel * 1.4 * dt, f.accel * 1.4 * dt)
    this.body.setLinvel({ x: lv.x + dx, y: vy, z: lv.z + dz }, true)

    const yawRate = steer * f.yawRate * (1 - 0.35 * Math.min(1, Math.abs(fwdSpeed) / top))
    const pitch = f.tilt * clamp(0.6 * (fwdSpeed / top) + 0.4 * throttle, -0.6, 1)
    const bank = clamp((-yawRate * Math.max(0, fwdSpeed)) / G, -0.45, 0.45)
    const rx = -hz
    const rz = hx
    let ux = hx * Math.tan(pitch) + rx * Math.tan(bank)
    let uy = 1
    let uz = hz * Math.tan(pitch) + rz * Math.tan(bank)
    const ul = Math.hypot(ux, uy, uz)
    ux /= ul
    uy /= ul
    uz /= ul
    const cx = 2 * (r.x * r.y - r.w * r.z)
    const cy = 1 - 2 * (r.x * r.x + r.z * r.z)
    const cz = 2 * (r.y * r.z + r.w * r.x)
    const wx = (cy * uz - cz * uy) * ALIGN
    const wy = (cz * ux - cx * uz) * ALIGN
    const wz = (cx * uy - cy * ux) * ALIGN
    const av = this.body.angvel()
    const k = Math.min(1, dt * 8)
    this.body.setAngvel({ x: av.x + (wx - av.x) * k, y: av.y + (yawRate + wy - av.y) * k, z: av.z + (wz - av.z) * k }, true)
    return (Math.hypot(lv.x, lv.z) + 25) * dt
  }

  /** Back on the ground at rest (placed, reset or towed). */
  settle(): void {
    this.flying = false
    this.spool = 0
    this.body.setGravityScale(1, true)
  }
}
