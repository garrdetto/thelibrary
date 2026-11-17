/**
 * Estimated ball flight from launch data, for shots whose launch monitor does not report carry.
 * Axes: x toward the target, y up, z right. Forces per unit mass: gravity, drag −k·Cd·|v|·v and Magnus lift k·Cl·|v|²·n̂,
 * with k = ρA / 2m, spin ratio S = rω/|v|, Cd = cd0 + cdSpin·S + cdSpeed·(1 − |v|/75) and Cl = min(clMax, clSlope·S^clPow), fitted to tour averages (±5 % carry).
 * The lift direction n̂ = normalize(ω̂ × v̂), with ω̂ = (0, −sin a, cos a) for spin axis a (positive curves right).
 * Spin decays exponentially. Integration is semi-implicit Euler at 5 ms. Calm air at sea level.
 */
export type FlightInput = { ballSpeed: number; launch: number; direction: number; totalSpin: number; spinAxis: number }

export type FlightEstimate = {
  carry: number
  offline: number
  apex: number
  descent: number
  hangTime: number
  total: number
}

const MPH = 0.44704
const YARD = 0.9144
const FOOT = 0.3048
const RADIUS = 0.021335
const MASS = 0.04593
const AIR = 1.194
const GRAVITY = 9.81
const K = (AIR * Math.PI * RADIUS * RADIUS) / (2 * MASS)

export const flightTuning = { cd0: 0.218, cdSpin: 0.164, cdSpeed: 0.089, clSlope: 1.0, clPow: 0.794, clMax: 0.308, spinDecay: 0.0101 }

/** One sample of the ball's position: seconds after impact, then yards downrange, feet high and yards right. */
export type TracePoint = { t: number; x: number; y: number; z: number }

export type FlightTrace = FlightEstimate & { air: TracePoint[]; ground: TracePoint[] }

const SAMPLE_SECONDS = 0.02

export function estimateFlight(input: FlightInput): FlightEstimate | null {
  return integrate(input, null)
}

/**
 * The whole path for a replay: airborne samples every 20 ms, then one hop and an easing roll out to the estimated total
 * along the landing heading. The hop rises with a third of the landing's vertical speed and covers a quarter of the roll.
 */
export function traceFlight(input: FlightInput): FlightTrace | null {
  const air: TracePoint[] = [{ t: 0, x: 0, y: 0, z: 0 }]
  const estimate = integrate(input, air)
  if (!estimate) return null
  const landing = air[air.length - 1]
  const previous = air[Math.max(0, air.length - 2)]
  const heading = Math.atan2(landing.z - previous.z, Math.max(1e-6, landing.x - previous.x))
  const roll = Math.max(0, estimate.total - estimate.carry)
  const ground: TracePoint[] = []
  if (roll > 0.5) {
    const hop = roll * 0.25
    const speedDown = Math.tan((estimate.descent * Math.PI) / 180) * Math.max(1, (landing.x - previous.x) / Math.max(1e-6, landing.t - previous.t)) * YARD
    const lift = Math.min(speedDown / 3, 6)
    const hopTime = (2 * lift) / GRAVITY
    const rollTime = Math.min(5, Math.max(0.6, roll / 6))
    const steps = 40
    for (let index = 1; index <= steps; index++) {
      const share = index / steps
      const inHop = share <= 0.35
      const along = inHop ? hop * (share / 0.35) : hop + (roll - hop) * (1 - (1 - (share - 0.35) / 0.65) ** 2)
      const t = landing.t + (inHop ? hopTime * (share / 0.35) : hopTime + rollTime * ((share - 0.35) / 0.65))
      const hopShare = share / 0.35
      const height = inHop ? (lift * hopTime * hopShare - 0.5 * GRAVITY * (hopTime * hopShare) ** 2) / FOOT : 0
      ground.push({ t, x: landing.x + along * Math.cos(heading), y: Math.max(0, height), z: landing.z + along * Math.sin(heading) })
    }
  }
  return { ...estimate, air, ground }
}

function integrate(input: FlightInput, path: TracePoint[] | null): FlightEstimate | null {
  const speed = input.ballSpeed * MPH
  if (!(speed > 2) || !Number.isFinite(input.launch)) return null
  const launch = (input.launch * Math.PI) / 180
  const heading = ((input.direction || 0) * Math.PI) / 180
  const axisAngle = ((input.spinAxis || 0) * Math.PI) / 180
  const axis = [0, -Math.sin(axisAngle), Math.cos(axisAngle)]
  let omega = (Math.max(0, input.totalSpin || 0) * 2 * Math.PI) / 60
  let vx = speed * Math.cos(launch) * Math.cos(heading)
  let vy = speed * Math.sin(launch)
  let vz = speed * Math.cos(launch) * Math.sin(heading)
  let x = 0
  let y = 0
  let z = 0
  let apex = 0
  let t = 0
  const dt = 0.005
  const decay = Math.exp(-flightTuning.spinDecay * dt)
  while (t < 20) {
    const v = Math.hypot(vx, vy, vz)
    const ratio = v > 0 ? (RADIUS * omega) / v : 0
    const cd = Math.max(0.12, flightTuning.cd0 + flightTuning.cdSpin * ratio + flightTuning.cdSpeed * (1 - v / 75))
    const cl = Math.max(0, Math.min(flightTuning.clMax, flightTuning.clSlope * Math.pow(ratio, flightTuning.clPow)))
    let nx = axis[1] * vz - axis[2] * vy
    let ny = axis[2] * vx - axis[0] * vz
    let nz = axis[0] * vy - axis[1] * vx
    const n = Math.hypot(nx, ny, nz) || 1
    nx /= n; ny /= n; nz /= n
    const lift = K * cl * v * v
    const drag = K * cd * v
    vx += (-drag * vx + lift * nx) * dt
    vy += (-GRAVITY - drag * vy + lift * ny) * dt
    vz += (-drag * vz + lift * nz) * dt
    const px = x
    const py = y
    const pz = z
    x += vx * dt
    y += vy * dt
    z += vz * dt
    omega *= decay
    t += dt
    if (y > apex) apex = y
    if (path && y >= 0 && t - path[path.length - 1].t >= SAMPLE_SECONDS - 1e-9) path.push({ t, x: x / YARD, y: y / FOOT, z: z / YARD })
    if (y < 0 && t > 0.05) {
      const f = py / (py - y)
      const lx = px + (x - px) * f
      const lz = pz + (z - pz) * f
      const horizontal = Math.hypot(vx, vz)
      const descent = (Math.atan2(-vy, horizontal) * 180) / Math.PI
      const roll = rollYards(horizontal, descent, omega)
      const carry = lx / YARD
      path?.push({ t: t - dt * (1 - f), x: carry, y: 0, z: lz / YARD })
      return {
        carry,
        offline: lz / YARD,
        apex: apex / FOOT,
        descent,
        hangTime: t - dt * (1 - f),
        total: carry + roll,
      }
    }
  }
  return null
}

/** Rough fairway roll: faster, flatter landings with little spin release further. */
function rollYards(horizontalSpeed: number, descent: number, omega: number) {
  const rpm = (omega * 60) / (2 * Math.PI)
  const angle = Math.max(0, Math.min(1, (60 - descent) / 45))
  const spin = Math.max(0.15, 1 - rpm / 7000)
  return Math.max(0, horizontalSpeed * 1.25 * angle * angle * spin)
}
