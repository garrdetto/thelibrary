/**
 * The aerodynamic flight model. One `FlightModel` holds an aircraft's full rigid-body state and advances it by one fixed tick:
 * control-surface actuators, flaps, gear, spoilers and trim; engine spool, thrust and fuel; lift, drag and side force from the
 * aircraft's coefficient tables against angle of attack and sideslip; stability and control moments with rate damping; stall,
 * the loss of roll damping that lets a stalled wing autorotate into a spin; ground effect; P-factor and propwash over the tail;
 * gear and structure contacts as spring-dampers with rolling, braking and side friction; and break-up on hard contact.
 *
 * World axes: x east, y up, z south. Body axes: x forward, y up, z right. Angular velocity is kept in body axes. Uses only
 * `SimMath`, keeps every intermediate in fields, and allocates nothing per tick, so equal inputs give equal results everywhere.
 */
import type { AircraftSpec, ContactSpec } from '../shared/AircraftSpec'
import type { Ground, GroundSample } from '../shared/Terrain'
import { createGroundSample } from '../shared/Terrain'
import { GRAVITY, SEA_LEVEL_PRESSURE, createAirSample, indicatedAirspeed, sampleAir } from './Atmosphere'
import type { AirSample } from './Atmosphere'
import type { ControlInput } from './Controls'
import { DEG, RAD, approach, asin, atan2, clamp, cos, interpolate, lerp, sin, smoothstep } from './SimMath'
import type { WindField } from './Wind'

export interface FlightEnvironment {
  ground: Ground
  wind: WindField
  /** Kelvin above standard. */
  temperatureOffset: number
  /** Sea-level pressure, Pa. */
  seaLevelPressure: number
}

export interface Touchdown {
  tick: number
  /** Sink rate at first wheel contact, m/s (positive down). */
  sinkRate: number
  /** Peak normal load factor in the half second after contact. */
  g: number
  x: number
  z: number
  /** Heading of the nose and track over the ground, degrees. */
  heading: number
  track: number
  ias: number
  bounce: boolean
}

export type CrashReason = 'gear collapse' | 'prop strike' | 'wing strike' | 'tail strike' | 'impact' | 'ditching' | 'overstress'

const SURFACE_GRIP: Record<GroundSample['surface'], number> = { runway: 1, taxiway: 1, apron: 1, grass: 0.72, water: 0.15 }
const SURFACE_ROLL: Record<GroundSample['surface'], number> = { runway: 0.015, taxiway: 0.016, apron: 0.016, grass: 0.055, water: 0.4 }
const BRAKE_SHARE = 0.68
const TOUCHDOWN_WINDOW = 60
const AIRBORNE_TICKS = 120

interface ContactState {
  spec: ContactSpec
  touching: boolean
  load: number
  compression: number
}

export class FlightModel {
  readonly spec: AircraftSpec
  tick = 0
  px = 0
  py = 0
  pz = 0
  vx = 0
  vy = 0
  vz = 0
  qx = 0
  qy = 0
  qz = 0
  qw = 1
  wx = 0
  wy = 0
  wz = 0
  fuel: number
  payload: number
  elevator = 0
  aileron = 0
  rudder = 0
  trim = 0
  flap = 0
  gear = 1
  spoiler = 0
  power = 0
  crashed: CrashReason | null = null

  ias = 0
  tas = 0
  groundSpeed = 0
  alpha = 0
  beta = 0
  loadFactor = 1
  /** Sideways specific force in g (the slip ball sits opposite it). */
  lateralG = 0
  /** Rate of turn about the vertical, degrees per second, positive to the right. */
  turnRate = 0
  mach = 0
  agl = 0
  verticalSpeed = 0
  heading = 0
  pitch = 0
  bank = 0
  track = 0
  thrust = 0
  rpm = 0
  fuelFlow = 0
  stall = 0
  wheelLoad = 0
  airborneTicks = 0
  touchdowns = 0
  /** Times a structure point (tail, prop, wingtip) has touched the ground. */
  strikes = 0
  lastTouchdown: Touchdown | null = null
  peakG = 1
  readonly contacts: ContactState[]
  readonly air: AirSample = createAirSample()

  private readonly detentMax: number
  private readonly propwash: number
  private readonly inductionFactor: number
  private readonly ground: GroundSample = createGroundSample()
  private readonly wind = { x: 0, y: 0, z: 0 }
  private touchdownOpen: Touchdown | null = null
  private touchdownTicks = 0
  private m00 = 1
  private m01 = 0
  private m02 = 0
  private m10 = 0
  private m11 = 1
  private m12 = 0
  private m20 = 0
  private m21 = 0
  private m22 = 1
  private fx = 0
  private fy = 0
  private fz = 0
  private bfx = 0
  private bfy = 0
  private bfz = 0
  private tx = 0
  private ty = 0
  private tz = 0

  constructor(spec: AircraftSpec) {
    this.spec = spec
    this.fuel = spec.mass.defaultFuel
    this.payload = spec.mass.defaultPayload
    this.contacts = spec.contacts.map((contact) => ({ spec: contact, touching: false, load: 0, compression: 0 }))
    const detents = spec.controls.flapDetents
    this.detentMax = detents[detents.length - 1] || 1
    this.propwash = spec.engine.count === 1 && spec.engine.kind !== 'turbofan' ? 0.1 : 0
    const aspect = (spec.wing.span * spec.wing.span) / spec.wing.area
    this.inductionFactor = 1 / (3.141592653589793 * spec.wing.oswald * aspect)
  }

  get mass(): number {
    return this.spec.mass.empty + this.payload + this.fuel
  }

  /** Back to a fresh aircraft: default fuel and payload, controls neutral, engine stopped, counters cleared. */
  reset(): void {
    this.tick = 0
    this.fuel = this.spec.mass.defaultFuel
    this.payload = this.spec.mass.defaultPayload
    this.elevator = 0
    this.aileron = 0
    this.rudder = 0
    this.trim = 0
    this.flap = 0
    this.gear = 1
    this.spoiler = 0
    this.power = 0
    this.crashed = null
    this.touchdowns = 0
    this.strikes = 0
    this.lastTouchdown = null
    this.touchdownOpen = null
    this.touchdownTicks = 0
    this.peakG = 1
    this.wheelLoad = 0
  }

  /** Places the aircraft at a world position with heading, pitch and bank (degrees), moving along its nose at `speed` m/s. */
  place(x: number, y: number, z: number, headingDeg: number, pitchDeg: number, bankDeg: number, speed: number): void {
    this.px = x
    this.py = y
    this.pz = z
    const yaw = (90 - headingDeg) * DEG * 0.5
    const pitch = pitchDeg * DEG * 0.5
    const roll = bankDeg * DEG * 0.5
    const ay = sin(yaw)
    const aw = cos(yaw)
    const bz = sin(pitch)
    const bw = cos(pitch)
    const cx = sin(roll)
    const cw = cos(roll)
    const iy = ay * bw
    const iz = aw * bz
    const iw = aw * bw
    const ix = ay * bz
    this.qw = iw * cw - ix * cx
    this.qx = iw * cx + ix * cw
    this.qy = iy * cw + iz * cx
    this.qz = iz * cw - iy * cx
    this.normalize()
    this.updateMatrix()
    this.vx = this.m00 * speed
    this.vy = this.m10 * speed
    this.vz = this.m20 * speed
    this.wx = 0
    this.wy = 0
    this.wz = 0
    this.crashed = null
    this.airborneTicks = speed > 5 ? AIRBORNE_TICKS : 0
    for (const contact of this.contacts) {
      contact.touching = false
      contact.load = 0
      contact.compression = 0
    }
  }

  /** Puts the aircraft at rest on its wheels at (x, z) facing `headingDeg`, settled onto the ground. */
  placeOnGround(ground: Ground, x: number, z: number, headingDeg: number): void {
    const h = ground.heightAt(x, z)
    let wheelY = 0
    let wheelX = 0
    let noseY = 0
    let noseX = 0
    for (const contact of this.spec.contacts) {
      if (contact.kind !== 'wheel') continue
      if (contact.steer > 0 || contact.position[0] > 0) {
        noseY = contact.position[1]
        noseX = contact.position[0]
      } else {
        wheelY = contact.position[1]
        wheelX = contact.position[0]
      }
    }
    const pitch = atan2(noseY - wheelY, noseX - wheelX) * -RAD
    this.place(x, h - wheelY - 0.06, z, headingDeg, pitch, 0, 0)
    this.power = this.spec.engine.idle
  }

  /** Copies another model's full state (used for the previous-tick snapshot and for replays). */
  copyFrom(other: FlightModel): void {
    this.tick = other.tick
    this.px = other.px
    this.py = other.py
    this.pz = other.pz
    this.vx = other.vx
    this.vy = other.vy
    this.vz = other.vz
    this.qx = other.qx
    this.qy = other.qy
    this.qz = other.qz
    this.qw = other.qw
    this.wx = other.wx
    this.wy = other.wy
    this.wz = other.wz
    this.fuel = other.fuel
    this.payload = other.payload
    this.elevator = other.elevator
    this.aileron = other.aileron
    this.rudder = other.rudder
    this.trim = other.trim
    this.flap = other.flap
    this.gear = other.gear
    this.spoiler = other.spoiler
    this.power = other.power
    this.crashed = other.crashed
  }

  private normalize(): void {
    const length = Math.sqrt(this.qx * this.qx + this.qy * this.qy + this.qz * this.qz + this.qw * this.qw)
    this.qx /= length
    this.qy /= length
    this.qz /= length
    this.qw /= length
  }

  private updateMatrix(): void {
    const { qx: x, qy: y, qz: z, qw: w } = this
    const xx = x * x
    const yy = y * y
    const zz = z * z
    const xy = x * y
    const xz = x * z
    const yz = y * z
    const wx = w * x
    const wy = w * y
    const wz = w * z
    this.m00 = 1 - 2 * (yy + zz)
    this.m01 = 2 * (xy - wz)
    this.m02 = 2 * (xz + wy)
    this.m10 = 2 * (xy + wz)
    this.m11 = 1 - 2 * (xx + zz)
    this.m12 = 2 * (yz - wx)
    this.m20 = 2 * (xz - wy)
    this.m21 = 2 * (yz + wx)
    this.m22 = 1 - 2 * (xx + yy)
  }

  /** Body-axis vector to world: column i of the rotation matrix is body axis i. */
  private addBodyForce(bx: number, by: number, bz: number): void {
    this.bfx += bx
    this.bfy += by
    this.bfz += bz
  }

  private addContactForces(env: FlightEnvironment, input: ControlInput): void {
    const ground = this.ground
    let wheelLoad = 0
    for (let i = 0; i < this.contacts.length; i++) {
      const contact = this.contacts[i]
      const c = contact.spec
      if (c.kind === 'wheel' && c.retracts && this.gear < 0.98) {
        contact.touching = false
        contact.load = 0
        contact.compression = 0
        continue
      }
      const cx = c.position[0]
      const cy = c.position[1]
      const cz = c.position[2]
      const wx = this.px + this.m00 * cx + this.m01 * cy + this.m02 * cz
      const wy = this.py + this.m10 * cx + this.m11 * cy + this.m12 * cz
      const wz = this.pz + this.m20 * cx + this.m21 * cy + this.m22 * cz
      env.ground.sample(wx, wz, ground)
      const depth = (ground.height - wy) * ground.ny
      if (depth <= 0) {
        contact.touching = false
        contact.load = 0
        contact.compression = 0
        continue
      }
      const rvx = this.wy * cz - this.wz * cy
      const rvy = this.wz * cx - this.wx * cz
      const rvz = this.wx * cy - this.wy * cx
      const pvx = this.vx + this.m00 * rvx + this.m01 * rvy + this.m02 * rvz
      const pvy = this.vy + this.m10 * rvx + this.m11 * rvy + this.m12 * rvz
      const pvz = this.vz + this.m20 * rvx + this.m21 * rvy + this.m22 * rvz
      const nx = ground.nx
      const ny = ground.ny
      const nz = ground.nz
      const vn = pvx * nx + pvy * ny + pvz * nz
      if (!contact.touching) {
        if (c.kind === 'structure') this.strikes++
        const impact = -vn
        const limit = ground.surface === 'water' ? 0.8 : c.breakSpeed
        if (impact > limit && this.crashed === null) {
          this.crashed = ground.surface === 'water' ? 'ditching' : c.kind === 'wheel' ? 'gear collapse' : c.name.startsWith('prop') ? 'prop strike' : c.name.startsWith('wing') ? 'wing strike' : c.name === 'tail' ? 'tail strike' : 'impact'
        }
      }
      contact.touching = true
      contact.compression = depth
      let normalForce = c.stiffness * depth - c.damping * vn
      if (normalForce < 0) normalForce = 0
      contact.load = normalForce
      const tvx = pvx - vn * nx
      const tvy = pvy - vn * ny
      const tvz = pvz - vn * nz
      const grip = SURFACE_GRIP[ground.surface] * c.friction
      let fx = normalForce * nx
      let fy = normalForce * ny
      let fz = normalForce * nz
      if (c.kind === 'wheel') {
        wheelLoad += normalForce
        const steer = c.steer * DEG * this.rudder
        const sx = cos(steer)
        const sz = sin(steer)
        let hx = this.m00 * sx + this.m02 * sz
        let hy = this.m10 * sx + this.m12 * sz
        let hz = this.m20 * sx + this.m22 * sz
        const hn = hx * nx + hy * ny + hz * nz
        hx -= hn * nx
        hy -= hn * ny
        hz -= hn * nz
        const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1
        hx /= hl
        hy /= hl
        hz /= hl
        const lx = hy * nz - hz * ny
        const ly = hz * nx - hx * nz
        const lz = hx * ny - hy * nx
        const vLong = tvx * hx + tvy * hy + tvz * hz
        const vLat = tvx * lx + tvy * ly + tvz * lz
        const pedal = c.brake === 'left' ? input.brakeLeft : c.brake === 'right' ? input.brakeRight : 0
        const braking = c.brake === 'none' ? 0 : pedal > input.parkingBrake ? pedal : input.parkingBrake
        const longCoefficient = SURFACE_ROLL[ground.surface] + braking * BRAKE_SHARE * grip
        let fLong = -normalForce * longCoefficient * (vLong / ((vLong < 0 ? -vLong : vLong) + 0.25))
        let fLat = -normalForce * grip * (vLat / ((vLat < 0 ? -vLat : vLat) + 0.2))
        const limit = normalForce * grip
        const total = Math.sqrt(fLong * fLong + fLat * fLat)
        if (total > limit && total > 0) {
          fLong *= limit / total
          fLat *= limit / total
        }
        fx += hx * fLong + lx * fLat
        fy += hy * fLong + ly * fLat
        fz += hz * fLong + lz * fLat
      } else {
        const tv = Math.sqrt(tvx * tvx + tvy * tvy + tvz * tvz)
        const slide = (normalForce * c.friction * SURFACE_GRIP[ground.surface]) / (tv + 0.3)
        fx -= tvx * slide
        fy -= tvy * slide
        fz -= tvz * slide
        if (normalForce > 2 * this.mass * GRAVITY && this.crashed === null) this.crashed = c.name.startsWith('wing') ? 'wing strike' : c.name === 'tail' ? 'tail strike' : 'impact'
      }
      const bx = this.m00 * fx + this.m10 * fy + this.m20 * fz
      const by = this.m01 * fx + this.m11 * fy + this.m21 * fz
      const bz = this.m02 * fx + this.m12 * fy + this.m22 * fz
      this.bfx += bx
      this.bfy += by
      this.bfz += bz
      this.tx += cy * bz - cz * by
      this.ty += cz * bx - cx * bz
      this.tz += cx * by - cy * bx
    }
    this.wheelLoad = wheelLoad
  }

  /** Advances the aircraft by `dt` seconds with `input` (already quantised). */
  step(input: ControlInput, dt: number, env: FlightEnvironment): void {
    const spec = this.spec
    const aero = spec.aero
    const controls = spec.controls
    this.tick++
    if (this.crashed !== null) {
      this.vx = this.vy = this.vz = 0
      this.wx = this.wy = this.wz = 0
      return
    }

    const surfaceStep = controls.rate * dt
    this.elevator = approach(this.elevator, clamp(input.pitch, -1, 1), surfaceStep)
    this.aileron = approach(this.aileron, clamp(input.roll, -1, 1), surfaceStep)
    this.rudder = approach(this.rudder, clamp(input.yaw, -1, 1), surfaceStep)
    this.trim = clamp(this.trim + input.trim * controls.trimRate * dt, -1, 1)
    const detents = controls.flapDetents
    const detent = detents[clamp(Math.round(input.flaps), 0, detents.length - 1)]
    this.flap = approach(this.flap, detent / this.detentMax, dt / controls.flapTime)
    if (controls.retractable) {
      const wantDown = input.gear >= 0.5 || this.wheelLoad > 0
      this.gear = approach(this.gear, wantDown ? 1 : 0, controls.gearTime > 0 ? dt / controls.gearTime : 1)
    } else this.gear = 1
    this.spoiler = controls.spoilers ? approach(this.spoiler, clamp(input.spoilers, 0, 1), dt * 2) : 0

    const engine = spec.engine
    const lever = this.fuel > 0 ? engine.idle + (1 - engine.idle) * clamp(input.throttle, 0, 1) : 0
    this.power += (lever - this.power) * clamp(dt / engine.spool, 0, 1)

    this.updateMatrix()
    const groundHeight = env.ground.heightAt(this.px, this.pz)
    this.agl = this.py - groundHeight
    sampleAir(this.py, env.temperatureOffset, env.seaLevelPressure || SEA_LEVEL_PRESSURE, this.air)
    env.wind.step(dt)
    env.wind.sample(this.agl, this.wind)
    const ax = this.vx - this.wind.x
    const ay = this.vy - this.wind.y
    const az = this.vz - this.wind.z
    const u = this.m00 * ax + this.m10 * ay + this.m20 * az
    const v = this.m01 * ax + this.m11 * ay + this.m21 * az
    const w = this.m02 * ax + this.m12 * ay + this.m22 * az
    const speed = Math.sqrt(u * u + v * v + w * w)
    const alpha = speed > 0.5 ? atan2(-v, u) : 0
    const beta = speed > 0.5 ? asin(clamp(w / speed, -1, 1)) : 0
    const alphaDeg = alpha * RAD
    const rho = this.air.density
    const qbar = 0.5 * rho * speed * speed
    const area = spec.wing.area
    const span = spec.wing.span
    const chord = spec.wing.chord

    const shift = aero.flapStallShift * this.flap
    const stallAlpha = aero.stallAlpha + shift
    const absAlpha = alphaDeg < 0 ? -alphaDeg : alphaDeg
    const attached = 1 - smoothstep(25, 40, absAlpha)
    let cl = interpolate(aero.lift.alpha, aero.lift.value, alphaDeg - shift) + aero.flapLift * this.flap * attached
    cl -= aero.spoilerLift * this.spoiler * attached
    let induced = 1
    if (aero.groundEffect) {
      const wingHeight = this.agl > 0.3 ? this.agl : 0.3
      const ratio = (16 * wingHeight) / span
      induced = (ratio * ratio) / (1 + ratio * ratio)
      cl *= 1 + 0.06 * (1 - induced) * attached
    }
    const cd = aero.cd0 + this.inductionFactor * cl * cl * induced * attached + interpolate(aero.stallDrag.alpha, aero.stallDrag.value, absAlpha) + aero.flapDrag * this.flap + aero.gearDrag * this.gear + aero.spoilerDrag * this.spoiler + 0.5 * beta * beta
    const cy = aero.sideslip * beta + aero.sideRudder * this.rudder

    const lift = cl * qbar * area
    const drag = cd * qbar * area
    const side = cy * qbar * area
    this.fx = 0
    this.fy = 0
    this.fz = 0
    this.bfx = 0
    this.bfy = 0
    this.bfz = 0
    this.tx = 0
    this.ty = 0
    this.tz = 0
    if (speed > 0.5) {
      const planar = Math.sqrt(u * u + v * v) || 1
      this.addBodyForce((-v / planar) * lift - (u / speed) * drag, (u / planar) * lift - (v / speed) * drag, side - (w / speed) * drag)
    }

    let thrust = 0
    const sigma = this.air.sigma
    if (engine.kind === 'turbofan') {
      this.mach = speed / this.air.speedOfSound
      thrust = engine.staticThrust * this.power * (sigma > 0 ? Math.sqrt(sigma) * (0.6 + 0.4 * sigma) : 0) * (1 - 0.3 * this.mach)
    } else {
      const lapse = engine.kind === 'piston' ? 1.132 * sigma - 0.132 : sigma * (0.7 + 0.3 * sigma)
      const shaft = engine.maxPower * this.power * (lapse > 0 ? lapse : 0)
      const knee = (engine.propEfficiency * engine.maxPower) / engine.staticThrust
      thrust = (engine.propEfficiency * shaft) / Math.sqrt(speed * speed + knee * knee)
    }
    if (spec.controls.reversers && input.reverse >= 0.5 && this.wheelLoad > 0) thrust *= -0.45
    this.thrust = thrust * engine.count
    this.mach = speed / this.air.speedOfSound
    for (let e = 0; e < engine.count; e++) {
      const position = engine.positions[e < engine.positions.length ? e : 0]
      this.bfx += thrust
      this.ty += position[2] * thrust
      this.tz -= position[1] * thrust
    }
    const lowSpeed = clamp(1 - speed / 70, 0.25, 1)
    this.ty += engine.torqueYaw * this.thrust * lowSpeed * (0.6 + 0.4 * clamp(alphaDeg / 12, 0, 1))
    const burn = engine.fuelFlow * engine.count * (0.12 + 0.88 * this.power)
    this.fuelFlow = this.fuel > 0 ? burn : 0
    this.fuel = this.fuel - burn * dt > 0 ? this.fuel - burn * dt : 0
    const rpmRange = engine.rpm[1] - engine.rpm[0]
    this.rpm = this.fuel > 0 || this.power > 0.01 ? engine.rpm[0] + rpmRange * clamp(0.55 * this.power + 0.45 * Math.sqrt(this.power) * clamp(0.6 + speed / 120, 0, 1.05), 0, 1.04) : 0

    const rateSpeed = speed > 8 ? speed : 8
    const p = this.wx
    const q = this.wz
    const r = -this.wy
    const pHat = (p * span) / (2 * rateSpeed)
    const qHat = (q * chord) / (2 * rateSpeed)
    const rHat = (r * span) / (2 * rateSpeed)
    const stalled = smoothstep(stallAlpha, stallAlpha + 5, absAlpha)
    this.stall = smoothstep(stallAlpha - 4, stallAlpha, absAlpha)
    const tailQbar = qbar + this.propwash * thrust
    const rollCoefficient = aero.rollSideslip * beta + lerp(aero.rollRate, 0.12, stalled) * pHat + lerp(aero.rollYawRate, 0.35, stalled) * rHat + aero.rollControl * this.aileron * (1 - 0.5 * stalled)
    const pitchCoefficient = aero.pitch0 + aero.pitchAlpha * sin(alpha) + aero.pitchRate * qHat + aero.pitchTrim * this.trim + aero.flapPitch * this.flap
    const yawCoefficient = aero.yawSideslip * beta + aero.yawRate * rHat + aero.yawRollRate * pHat + aero.yawAileron * this.aileron
    const rollMoment = rollCoefficient * qbar * area * span + aero.rollRudder * this.rudder * tailQbar * area * span
    const pitchMoment = pitchCoefficient * qbar * area * chord + aero.pitchControl * this.elevator * tailQbar * area * chord
    const yawMoment = yawCoefficient * qbar * area * span + aero.yawControl * this.rudder * tailQbar * area * span
    this.tx += rollMoment
    this.ty -= yawMoment
    this.tz += pitchMoment

    this.addContactForces(env, input)

    this.fx += this.m00 * this.bfx + this.m01 * this.bfy + this.m02 * this.bfz
    this.fy += this.m10 * this.bfx + this.m11 * this.bfy + this.m12 * this.bfz
    this.fz += this.m20 * this.bfx + this.m21 * this.bfy + this.m22 * this.bfz
    const mass = this.mass
    this.loadFactor = this.bfy / (mass * GRAVITY)
    this.lateralG = this.bfz / (mass * GRAVITY)
    this.fy -= mass * GRAVITY
    if (this.loadFactor > spec.limits.gPositive * 1.5 || this.loadFactor < spec.limits.gNegative * 1.5) {
      if (this.crashed === null) this.crashed = 'overstress'
    }

    this.vx += (this.fx / mass) * dt
    this.vy += (this.fy / mass) * dt
    this.vz += (this.fz / mass) * dt
    this.px += this.vx * dt
    this.py += this.vy * dt
    this.pz += this.vz * dt

    const scale = mass / spec.mass.maxTakeoff
    const ixx = spec.inertia.roll * scale
    const iyy = spec.inertia.yaw * scale
    const izz = spec.inertia.pitch * scale
    const ixy = spec.inertia.rollYaw * scale
    const hx = ixx * this.wx - ixy * this.wy
    const hy = -ixy * this.wx + iyy * this.wy
    const hz = izz * this.wz
    const mx = this.tx - (this.wy * hz - this.wz * hy)
    const my = this.ty - (this.wz * hx - this.wx * hz)
    const mz = this.tz - (this.wx * hy - this.wy * hx)
    const det = ixx * iyy - ixy * ixy
    this.wx += ((iyy * mx + ixy * my) / det) * dt
    this.wy += ((ixy * mx + ixx * my) / det) * dt
    this.wz += (mz / izz) * dt

    const hwx = 0.5 * dt * this.wx
    const hwy = 0.5 * dt * this.wy
    const hwz = 0.5 * dt * this.wz
    const { qx, qy, qz, qw } = this
    this.qw = qw - qx * hwx - qy * hwy - qz * hwz
    this.qx = qx + qw * hwx + qy * hwz - qz * hwy
    this.qy = qy + qw * hwy + qz * hwx - qx * hwz
    this.qz = qz + qw * hwz + qx * hwy - qy * hwx
    this.normalize()

    this.alpha = alphaDeg
    this.beta = beta * RAD
    this.tas = speed
    this.ias = indicatedAirspeed(speed, rho, this.air.pressure, this.air.speedOfSound)
    this.updateAttitude()
    this.trackTouchdown()
  }

  private updateAttitude(): void {
    this.updateMatrix()
    this.pitch = asin(clamp(this.m10, -1, 1)) * RAD
    let heading = atan2(this.m00, -this.m20) * RAD
    if (heading < 0) heading += 360
    this.heading = heading
    this.bank = atan2(-this.m12, this.m11) * RAD
    this.groundSpeed = Math.sqrt(this.vx * this.vx + this.vz * this.vz)
    this.turnRate = -(this.m10 * this.wx + this.m11 * this.wy + this.m12 * this.wz) * RAD
    let track = this.groundSpeed > 0.5 ? atan2(this.vx, -this.vz) * RAD : heading
    if (track < 0) track += 360
    this.track = track
    this.verticalSpeed = this.vy
  }

  private trackTouchdown(): void {
    const onWheels = this.wheelLoad > 0
    if (this.touchdownOpen) {
      this.touchdownTicks++
      if (this.loadFactor > this.touchdownOpen.g) this.touchdownOpen.g = this.loadFactor
      if (this.touchdownTicks >= TOUCHDOWN_WINDOW) {
        this.lastTouchdown = this.touchdownOpen
        this.touchdownOpen = null
      }
    }
    if (!onWheels) {
      this.airborneTicks++
      return
    }
    if (this.airborneTicks >= AIRBORNE_TICKS || (this.airborneTicks > 6 && this.lastTouchdown !== null)) {
      const bounce = this.airborneTicks < AIRBORNE_TICKS
      this.touchdowns++
      this.touchdownTicks = 0
      this.touchdownOpen = { tick: this.tick, sinkRate: -this.vy, g: this.loadFactor, x: this.px, z: this.pz, heading: this.heading, track: this.track, ias: this.ias, bounce }
      if (bounce) this.lastTouchdown = this.touchdownOpen
    }
    this.airborneTicks = 0
  }
}
