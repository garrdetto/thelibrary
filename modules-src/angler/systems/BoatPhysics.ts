/** Planing-hull boat model: thrust against displacement and planing drag (with the hump), speed-dependent steering, keel grip, wind drift, wave motion, grounding in shallow water and shore contact. */
import { heightAt } from '../shared/Lakes'
import type { LakeDef } from '../shared/Lakes'
import type { BoatSpec } from '../shared/Boats'
import { clamp, valueNoise } from '../shared/Random'

const MPH = 0.44704

export interface BoatControls {
  throttle: number
  steer: number
  trolling: boolean
  anchored: boolean
}

export interface BoatState {
  x: number
  z: number
  heading: number
  speed: number
  lateral: number
  yawRate: number
  pitch: number
  roll: number
  heave: number
  grounded: boolean
  odometer: number
}

export function newBoatState(x: number, z: number, heading: number): BoatState {
  return { x, z, heading, speed: 0, lateral: 0, yawRate: 0, pitch: 0, roll: 0, heave: 0, grounded: false, odometer: 0 }
}

export class BoatPhysics {
  state: BoatState
  private time = 0
  motorBoost = 1
  private readonly lake: LakeDef

  constructor(lake: LakeDef, readonly spec: BoatSpec, state: BoatState) {
    this.lake = lake
    this.state = state
  }

  get maxSpeed(): number {
    return this.spec.maxMph * MPH * this.motorBoost
  }

  step(dt: number, controls: BoatControls, wind: { x: number; z: number; speed: number }): void {
    const s = this.state
    this.time += dt
    const vmax = controls.trolling ? 1.4 : this.maxSpeed
    const vPlane = this.spec.planeMph * MPH
    const thrustMax = controls.trolling ? 0.9 : 3.6
    const linear = controls.trolling ? 0.6 : 0.05
    const k = Math.max(0.0005, (thrustMax - linear * vmax) / (vmax * vmax))
    const throttle = controls.anchored ? 0 : clamp(controls.throttle, -1, 1)
    const thrust = throttle >= 0 ? throttle * thrustMax : throttle * thrustMax * 0.4
    const hump = vPlane < 40 ? 1 + 1.1 * Math.exp(-(((Math.abs(s.speed) - vPlane * 0.75) / (vPlane * 0.4)) ** 2)) : 1
    const drag = Math.sign(s.speed) * (k * s.speed * s.speed * hump) + linear * s.speed
    s.speed += (thrust - drag) * dt
    if (controls.anchored) s.speed *= Math.exp(-2.5 * dt)
    if (Math.abs(s.speed) < 0.01 && throttle === 0) s.speed = 0

    const u = s.speed
    const steerAuthority = clamp(u / 4, -1, 1) * (1 - 0.45 * clamp(Math.abs(u) / Math.max(vmax, 1), 0, 1))
    let target = -controls.steer * this.spec.turnRate * 0.62 * steerAuthority
    if (Math.abs(u) < 1.5 && !controls.anchored) target += -controls.steer * 0.28 * (controls.trolling ? 1 : 0.6)
    s.yawRate += (target - s.yawRate) * (1 - Math.exp(-dt / 0.35))
    s.heading += s.yawRate * dt

    const windPush = wind.speed * 0.012 * (1 - clamp(Math.abs(u) / 6, 0, 1))
    const fx = -Math.sin(s.heading), fz = -Math.cos(s.heading)
    const rx = Math.cos(s.heading), rz = -Math.sin(s.heading)
    s.lateral += (-s.yawRate * u * 0.05 - s.lateral) * (1 - Math.exp(-dt * 3))
    let vx = fx * u + rx * s.lateral + wind.x * windPush
    let vz = fz * u + rz * s.lateral + wind.z * windPush
    if (controls.anchored) { vx *= 0.02; vz *= 0.02 }
    if (this.lake.current) {
      vx += this.lake.current.x * this.lake.current.speed * 0.35
      vz += this.lake.current.z * this.lake.current.speed * 0.35
      if (controls.anchored) { vx -= this.lake.current.x * this.lake.current.speed * 0.35; vz -= this.lake.current.z * this.lake.current.speed * 0.35 }
    }

    const nx = s.x + vx * dt, nz = s.z + vz * dt
    const L = this.spec.halfLength * 0.85
    const bowH = heightAt(this.lake, nx + fx * L, nz + fz * L)
    const sternH = heightAt(this.lake, nx - fx * L, nz - fz * L)
    const midH = heightAt(this.lake, nx, nz)
    const draft = this.spec.draft
    const blockedAhead = bowH > -draft * 0.6 && u > 0
    const blockedBehind = sternH > -draft * 0.6 && u < 0
    s.grounded = midH > -draft || bowH > -draft * 0.4
    if (blockedAhead || blockedBehind || midH > -draft * 0.5) {
      s.speed = -Math.sign(u) * Math.min(Math.abs(u) * 0.25, 0.6)
      const gx = heightAt(this.lake, s.x + 2, s.z) - heightAt(this.lake, s.x - 2, s.z)
      const gz = heightAt(this.lake, s.x, s.z + 2) - heightAt(this.lake, s.x, s.z - 2)
      const gl = Math.hypot(gx, gz) || 1
      s.x -= (gx / gl) * 0.6 * dt
      s.z -= (gz / gl) * 0.6 * dt
    } else {
      s.odometer += Math.hypot(nx - s.x, nz - s.z)
      s.x = nx
      s.z = nz
    }
    if (s.grounded) s.speed *= Math.exp(-3 * dt)

    const planeT = vPlane < 40 ? Math.exp(-(((Math.abs(u) - vPlane * 0.85) / (vPlane * 0.45)) ** 2)) : 0
    const accel = thrust - drag
    const targetPitch = (planeT * 6.5 + clamp(u / vmax, 0, 1) * 1.6 + clamp(accel, -1, 2) * 0.6) * (Math.PI / 180)
    const waveAmp = 0.04 + wind.speed * 0.006
    const waves = (valueNoise(this.time * 0.9, s.x * 0.05, 3) - 0.5) * waveAmp * 2
    const slap = Math.abs(u) > 8 ? (valueNoise(this.time * 6, 0.5, 9) - 0.5) * 0.04 * (wind.speed / 10 + 0.4) : 0
    s.pitch += (targetPitch + waves * 0.4 + slap * 0.6 - s.pitch) * (1 - Math.exp(-dt * 2.2))
    const targetRoll = clamp(s.yawRate * u * 0.012, -0.2, 0.2) + (valueNoise(this.time * 0.7, 9.1, 5) - 0.5) * waveAmp * 0.8
    s.roll += (targetRoll - s.roll) * (1 - Math.exp(-dt * 2.5))
    s.heave = waves + slap - clamp(Math.abs(u) / 20, 0, 0.12)
  }
}

export const toMph = (mps: number) => mps / MPH
