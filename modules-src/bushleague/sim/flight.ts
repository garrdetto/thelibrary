/** Ball flight: gravity, quadratic drag and Magnus lift from spin rate and axis, wind and air density by altitude, then bounces and roll. Semi-implicit Euler at a fixed step, so every runtime gets the same numbers. */
import { BALL_RADIUS, DEG, MOUND_DISTANCE, PLATE_FRONT, fenceDistance, fenceHeight, horizontalDistance, inFoulPlayable, isFairAngle, sprayAngle } from './field'
import { PITCH_SPECS } from './pitches'
import { TUNING } from './tuning'
import type { Hand, Park, PitchType, Sample, Vec3, Wind } from './types'

const MASS = 0.145
const AREA = Math.PI * BALL_RADIUS * BALL_RADIUS
const DRAG_COEFFICIENT = 0.409
const BATTED_LIFT = 0.85

export interface Spin {
  rpm: number
  tilt: number
  efficiency: number
}

export interface Air {
  density: number
  gravity: number
  wind: Wind
}

export function airFor(park: Park, wind: Wind): Air {
  return { density: 1.225 * Math.exp(-park.altitude / 8500), gravity: park.gravity, wind: park.dome ? { speed: 0, toward: 0 } : wind }
}

interface State {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

function liftCoefficient(spinFactor: number): number {
  return spinFactor <= 0 ? 0 : 1 / (2.32 + 0.4 / spinFactor)
}

/** One semi-implicit Euler step in the air. Spin tilt 0 pushes the ball up, positive tilt pushes it toward the side vector (vz, 0, -vx). */
function stepAir(state: State, spin: Spin, air: Air, dt: number): void {
  const heightFactor = Math.min(1, Math.max(0, state.y / 8))
  const windX = air.wind.speed * heightFactor * Math.sin(air.wind.toward * DEG)
  const windZ = air.wind.speed * heightFactor * Math.cos(air.wind.toward * DEG)
  const rx = state.vx - windX
  const ry = state.vy
  const rz = state.vz - windZ
  const speed = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1e-6
  const k = (0.5 * air.density * AREA) / MASS
  let ax = -k * DRAG_COEFFICIENT * speed * rx
  let ay = -k * DRAG_COEFFICIENT * speed * ry - air.gravity
  let az = -k * DRAG_COEFFICIENT * speed * rz
  if (spin.rpm > 0) {
    const omega = (spin.rpm * 2 * Math.PI) / 60
    const lift = k * liftCoefficient((BALL_RADIUS * omega) / speed) * spin.efficiency * speed * speed
    const ux = rx / speed
    const uy = ry / speed
    const uz = rz / speed
    let upX = -uy * ux
    let upY = 1 - uy * uy
    let upZ = -uy * uz
    const upLength = Math.sqrt(upX * upX + upY * upY + upZ * upZ) || 1
    upX /= upLength
    upY /= upLength
    upZ /= upLength
    const sideLength = Math.sqrt(uz * uz + ux * ux) || 1
    const sideX = uz / sideLength
    const sideZ = -ux / sideLength
    const c = Math.cos(spin.tilt * DEG)
    const s = Math.sin(spin.tilt * DEG)
    ax += lift * (c * upX + s * sideX)
    ay += lift * (c * upY)
    az += lift * (c * upZ + s * sideZ)
  }
  state.vx += ax * dt
  state.vy += ay * dt
  state.vz += az * dt
  state.x += state.vx * dt
  state.y += state.vy * dt
  state.z += state.vz * dt
}

export interface Launch {
  speed: number
  launch: number
  spray: number
  backspin: number
  sidespin: number
}

export type BallEnd = 'rest' | 'fence' | 'homer' | 'stands' | 'groundRule' | 'timeout'

export interface BallPath {
  samples: Sample[]
  /** Index of the first sample on the ground, or -1 when the ball never lands in play. */
  firstGround: number
  end: BallEnd
  /** Index where the ball crossed the fence (home run or ground-rule double), or -1. */
  fenceIndex: number
  wallIndex: number
  apex: number
  launch: Launch
}

const AIR_DT = 0.02
const WARNING_TRACK = 4.6
const MAX_TIME = 14

export function contactPoint(): Vec3 {
  return { x: 0, y: 0.85, z: 0.45 }
}

/** Full path of a batted ball from the contact point until it stops, leaves the park or goes into the seats. */
export function battedBallPath(launch: Launch, park: Park, air: Air): BallPath {
  const start = contactPoint()
  const cosLaunch = Math.cos(launch.launch * DEG)
  const state: State = {
    x: start.x,
    y: start.y,
    z: start.z,
    vx: launch.speed * cosLaunch * Math.sin(launch.spray * DEG),
    vy: launch.speed * Math.sin(launch.launch * DEG),
    vz: launch.speed * cosLaunch * Math.cos(launch.spray * DEG),
  }
  const totalSpin = Math.hypot(launch.backspin, launch.sidespin)
  const spin: Spin = {
    rpm: totalSpin,
    tilt: totalSpin > 0 ? Math.atan2(launch.sidespin, launch.backspin) / DEG : 0,
    efficiency: BATTED_LIFT,
  }
  const samples: Sample[] = [{ t: 0, x: state.x, y: state.y, z: state.z }]
  let firstGround = -1
  let fenceIndex = -1
  let wallIndex = -1
  let apex = state.y
  let end: BallEnd = 'timeout'
  let t = 0
  let rolling = false
  let inAir = true
  const nearestFence = Math.min(...park.fence)
  let previousDistance = horizontalDistance(state)

  while (t < MAX_TIME) {
    if (inAir) {
      stepAir(state, spin, air, AIR_DT)
    } else if (rolling) {
      const speed = Math.hypot(state.vx, state.vz)
      const infield = Math.hypot(state.x, state.z - MOUND_DISTANCE) < 29
      const decel = infield ? TUNING.roll.infield : TUNING.roll.outfield
      if (speed <= decel * AIR_DT * 2) {
        state.vx = 0
        state.vz = 0
        end = 'rest'
      } else {
        const scale = (speed - decel * AIR_DT * 2) / speed
        state.vx *= scale
        state.vz *= scale
      }
      state.x += state.vx * AIR_DT * 2
      state.z += state.vz * AIR_DT * 2
    }
    t += inAir ? AIR_DT : AIR_DT * 2
    apex = Math.max(apex, state.y)

    const distance = horizontalDistance(state)
    const fair = isFairAngle(state)
    const nearFence = fair && distance >= nearestFence - 0.5
    const spray = nearFence ? sprayAngle(state) : 0
    const fence = nearFence ? fenceDistance(park, spray) : Infinity

    if (nearFence && distance >= fence && previousDistance < fence + 0.5) {
      if (state.y > fenceHeight(park, spray)) {
        fenceIndex = samples.length
        samples.push({ t, x: state.x, y: state.y, z: state.z })
        end = firstGround < 0 ? 'homer' : 'groundRule'
        break
      }
      const radialX = state.x / distance
      const radialZ = state.z / distance
      const radial = state.vx * radialX + state.vz * radialZ
      if (radial > 0) {
        state.vx -= 1.35 * radial * radialX
        state.vz -= 1.35 * radial * radialZ
        state.vx *= 0.7
        state.vz *= 0.7
        state.x = radialX * (fence - 0.05)
        state.z = radialZ * (fence - 0.05)
        if (wallIndex < 0) wallIndex = samples.length
        if (rolling && Math.hypot(state.vx, state.vz) < 1) end = 'fence'
      }
    }

    if (!fair && !inFoulPlayable(park, state) && state.z > -park.backstop - 1) {
      if (state.y < 3 || !inAir) {
        samples.push({ t, x: state.x, y: Math.max(state.y, BALL_RADIUS), z: state.z })
        end = 'stands'
        break
      }
    }
    if (state.z < -park.backstop) {
      samples.push({ t, x: state.x, y: Math.max(state.y, BALL_RADIUS), z: -park.backstop })
      end = 'stands'
      break
    }

    if (inAir && state.y <= BALL_RADIUS && state.vy < 0) {
      if (firstGround < 0) firstGround = samples.length
      state.y = BALL_RADIUS
      spin.rpm = 0
      if (state.vy < -1.6) {
        const infield = Math.hypot(state.x, state.z - MOUND_DISTANCE) < 29
        const track = !infield && fair && distance > fenceDistance(park, sprayAngle(state)) - WARNING_TRACK
        state.vy = -state.vy * (infield ? 0.42 : track ? 0.52 : 0.36)
        const keep = infield ? 0.8 : track ? 0.78 : 0.66
        state.vx *= keep
        state.vz *= keep
      } else {
        state.vy = 0
        inAir = false
        rolling = true
      }
    }
    samples.push({ t, x: state.x, y: state.y, z: state.z })
    previousDistance = horizontalDistance(state)
    if (end === 'rest' || end === 'fence') break
  }
  return { samples, firstGround, end, fenceIndex, wallIndex, apex, launch }
}

export type Fairness = 'fair' | 'foul'

/** Fair or foul for a ball nobody catches: by the first landing spot beyond the bags, otherwise where it passes a bag or comes to rest. */
export function judgeFair(path: BallPath, isBeyondBags: (point: Sample) => boolean): Fairness {
  if (path.end === 'homer') return 'fair'
  const samples = path.samples
  if (path.firstGround < 0) return path.end === 'stands' ? 'foul' : 'fair'
  const landing = samples[path.firstGround]
  if (isBeyondBags(landing)) return isFairAngle(landing) ? 'fair' : 'foul'
  for (let index = path.firstGround; index < samples.length; index++) {
    const sample = samples[index]
    if (isBeyondBags(sample)) return isFairAngle(sample) ? 'fair' : 'foul'
  }
  if (path.end === 'stands') return 'foul'
  return isFairAngle(samples[samples.length - 1]) ? 'fair' : 'foul'
}

export function positionAt(samples: readonly Sample[], t: number): Vec3 {
  if (t <= samples[0].t) return { x: samples[0].x, y: samples[0].y, z: samples[0].z }
  let low = 0
  let high = samples.length - 1
  if (t >= samples[high].t) return { x: samples[high].x, y: samples[high].y, z: samples[high].z }
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (samples[mid].t <= t) low = mid
    else high = mid
  }
  const a = samples[low]
  const b = samples[high]
  const f = (t - a.t) / (b.t - a.t || 1)
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f }
}

export interface PitchPathInput {
  type: PitchType
  throws: Hand
  speed: number
  release: Vec3
  plate: { x: number; y: number }
  wobbleSeed: number
}

/** Release point for a pitcher of the given height and arm, in the sim frame (right-handers release on the third-base side). */
export function releasePoint(throws: Hand, height: number): Vec3 {
  const arm = throws === 'R' ? -0.55 : 0.55
  return { x: arm, y: height * 0.96, z: MOUND_DISTANCE - 1.6 }
}

function pitchSpin(input: PitchPathInput): Spin {
  const spec = PITCH_SPECS[input.type]
  return { rpm: spec.rpm, tilt: input.throws === 'R' ? spec.tilt : -spec.tilt, efficiency: spec.efficiency }
}

function flyPitch(input: PitchPathInput, velocity: Vec3, air: Air, record: Sample[] | null): { x: number; y: number; t: number } {
  const spin = pitchSpin(input)
  const spec = PITCH_SPECS[input.type]
  const state: State = { x: input.release.x, y: input.release.y, z: input.release.z, vx: velocity.x, vy: velocity.y, vz: velocity.z }
  const dt = 1 / 400
  let t = 0
  let wobblePhase = (input.wobbleSeed % 1000) / 159
  record?.push({ t: 0, x: state.x, y: state.y, z: state.z })
  let steps = 0
  while (state.z > PLATE_FRONT && t < 2) {
    stepAir(state, spin, air, dt)
    if (spec.wobble > 0) {
      wobblePhase += dt * 9
      state.vx += Math.sin(wobblePhase * 2.3) * spec.wobble * 6 * dt
      state.vy += Math.cos(wobblePhase * 1.7) * spec.wobble * 4 * dt
    }
    t += dt
    steps++
    if (record && steps % 6 === 0) record.push({ t, x: state.x, y: state.y, z: state.z })
  }
  record?.push({ t, x: state.x, y: state.y, z: state.z })
  return { x: state.x, y: state.y, t }
}

export interface PitchPath {
  samples: Sample[]
  flightTime: number
  /** Break against a spinless pitch at the same speed, in metres at the plate (x toward first base, y up). */
  breakX: number
  breakY: number
}

/** Aims the release velocity so the pitch, with its spin and wind, crosses the front of the plate at `plate`. */
export function pitchPath(input: PitchPathInput, air: Air): PitchPath {
  const dz = input.release.z - PLATE_FRONT
  let aimX = input.plate.x
  let aimY = input.plate.y
  let result = { x: 0, y: 0, t: 0 }
  let velocity: Vec3 = { x: 0, y: 0, z: 0 }
  for (let pass = 0; pass < 4; pass++) {
    const flight = dz / input.speed
    const vx = (aimX - input.release.x) / flight
    const vy = (aimY - input.release.y) / flight + 0.5 * air.gravity * flight
    const length = Math.hypot(vx, vy, dz / flight)
    const scale = input.speed / length
    velocity = { x: vx * scale, y: vy * scale, z: -(dz / flight) * scale }
    result = flyPitch(input, velocity, air, null)
    aimX += input.plate.x - result.x
    aimY += input.plate.y - result.y
  }
  const samples: Sample[] = []
  result = flyPitch(input, velocity, air, samples)
  const spinless = flyPitchSpinless(input, velocity, air)
  return { samples, flightTime: result.t, breakX: result.x - spinless.x, breakY: result.y - spinless.y }
}

function flyPitchSpinless(input: PitchPathInput, velocity: Vec3, air: Air): { x: number; y: number } {
  const state: State = { x: input.release.x, y: input.release.y, z: input.release.z, vx: velocity.x, vy: velocity.y, vz: velocity.z }
  const spin: Spin = { rpm: 0, tilt: 0, efficiency: 0 }
  const dt = 1 / 400
  let t = 0
  while (state.z > PLATE_FRONT && t < 2) {
    stepAir(state, spin, air, dt)
    t += dt
  }
  return { x: state.x, y: state.y }
}

/** Analytic estimate of a pitch's flight time from release to the front of the plate, used by the headless sim. */
export function pitchFlightTime(speed: number, release: Vec3): number {
  return ((release.z - PLATE_FRONT) / speed) * 1.045
}

/** Approximate total movement (metres) a pitch type shows, for the hitter's read in the headless sim. */
export function pitchMovement(type: PitchType): number {
  const spec = PITCH_SPECS[type]
  return spec.wobble > 0 ? 0.35 : (spec.rpm / 2300) * spec.efficiency * 0.42
}
