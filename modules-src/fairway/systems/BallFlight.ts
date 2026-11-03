/** Deterministic golf-ball flight, bounce and roll: a semi-implicit Euler integrator at the engine's fixed step, driven only by shot parameters and a seed. */
import { clubById, clubLaunchSpeed, tuning, type ClubId, type LieKind, type SurfaceKind } from '../tuning'
import { courseFor, type Course } from './Course'
import { createRandom } from './Random'
import { contactFor, lieForSurface, liePowerFactor, lieSpinFactor } from './Surfaces'
import { addScaled, cross, dot, headingVector, horizontalDistance, length, normalize, rightVector, scale, sub, UP, type Vec3 } from './Vector'
import { windAtHeight } from './Wind'

export interface ShotParams {
  hole: number
  origin: Vec3
  yaw: number
  club: ClubId
  power: number
  /** Signed accuracy miss in [−1, 1]: negative hooks (left), positive slices (right). */
  curve: number
  /** Player spin setting in [−1, 1]: positive adds backspin, negative takes it away toward topspin. */
  spin: number
  lie: LieKind
  teeShot: boolean
  wind: readonly [number, number]
}

export type ShotOutcome = 'rest' | 'holed' | 'water' | 'out'

export interface ShotResult {
  /** Ball centre every fixed step, flattened as x, y, z triples; sample i is at time i · stepSeconds. */
  samples: number[]
  stepSeconds: number
  outcome: ShotOutcome
  /** Where the ball physically stopped (or entered the water, or left the course). */
  rest: Vec3
  /** Where the next stroke is played from: the rest spot, the drop zone after water, or the origin after out of bounds. */
  next: Vec3
  nextLie: LieKind
  restSurface: SurfaceKind
  penalty: number
  landing: Vec3 | null
  carry: number
  apex: number
  descentDegrees: number | null
  flightSeconds: number
  powerFactor: number
  launchSpeed: number
  launchDegrees: number
  spinRpm: number
}

interface FlightState {
  position: Vec3
  velocity: Vec3
  spinAxis: Vec3
  spinRate: number
}

const RPM_TO_RADIANS = (2 * Math.PI) / 60

/**
 * Launch conditions from the club, meter and lie.
 *   v₀ = power × club.launchSpeed × lie.powerFactor          (launchSpeed = club speed × smash factor)
 *   launch yaw ψ′ = ψ − curve × maxYaw                        (positive curve turns right)
 *   v⃗ = v₀ (cos θ · ĥ(ψ′) + sin θ · ŷ)                       (θ = club loft, ĥ the ground heading)
 *   ω = spinRpm × 2π/60 × lieSpin × (0.4 + 0.6·power) × (1 + spin·k)
 * The spin axis starts as the right vector r̂ (pure backspin, so ω̂ × v⃗ points up) and is tilted toward −ŷ by
 * curve × maxSideSpinTilt, giving the sidespin that bends a slice right and a hook left.
 */
export function launchState(params: ShotParams, powerFactor: number): FlightState & { launchSpeed: number; launchDegrees: number } {
  const club = clubById(params.lie === 'green' ? 'putter' : params.club)
  const meter = tuning.meter
  const launchSpeed = Math.max(0, Math.min(1, params.power)) * clubLaunchSpeed(club) * powerFactor
  const yaw = params.yaw - params.curve * meter.maxYawRadians
  const loft = (club.loftDegrees * Math.PI) / 180
  const heading = headingVector(yaw)
  const velocity = addScaled(scale(heading, Math.cos(loft) * launchSpeed), UP, Math.sin(loft) * launchSpeed)
  const tilt = params.curve * meter.maxSideSpinTilt
  const right = rightVector(yaw)
  const spinAxis = normalize(addScaled(scale(right, Math.cos(tilt)), UP, -Math.sin(tilt)))
  const spinScale = (1 + Math.max(-1, Math.min(1, params.spin)) * tuning.flight.spinRangeFraction) * (0.4 + 0.6 * params.power)
  const spinRate = club.spinRpm * RPM_TO_RADIANS * lieSpinFactor(params.lie, params.teeShot) * spinScale
  return { position: params.origin, velocity, spinAxis, spinRate, launchSpeed, launchDegrees: club.loftDegrees }
}

/**
 * Airborne acceleration on the ball (per unit mass), with the wind w⃗ entering as relative air velocity u⃗ = v⃗ − w⃗(h):
 *   gravity  a_g = −g ŷ
 *   drag     a_d = −(½ ρ C_d A / m) |u⃗| u⃗
 *   Magnus   a_l =  (½ ρ C_l A / m) |u⃗| (ω̂ × u⃗),   C_l = min(C_max, k_l · S),   S = r|ω| / |u⃗|
 * Positive spin rate is backspin (lift up, more carry, steeper descent); a negative rate flips ω̂ and gives topspin dive.
 */
export function airAcceleration(state: FlightState, wind: Vec3): Vec3 {
  const { ball, air } = tuning
  const area = Math.PI * ball.radiusM * ball.radiusM
  const relative = sub(state.velocity, wind)
  const speed = length(relative)
  let acceleration: Vec3 = [0, -air.gravity, 0]
  if (speed < 1e-6) return acceleration
  const dragFactor = (0.5 * air.density * ball.dragCoefficient * area) / ball.massKg
  acceleration = addScaled(acceleration, relative, -dragFactor * speed)
  const spinParameter = (ball.radiusM * Math.abs(state.spinRate)) / speed
  const lift = Math.min(ball.liftMax, ball.liftSlope * spinParameter)
  if (lift > 0) {
    const axis = scale(state.spinAxis, Math.sign(state.spinRate))
    const liftFactor = (0.5 * air.density * lift * area) / ball.massKg
    acceleration = addScaled(acceleration, cross(axis, relative), liftFactor * speed)
  }
  return acceleration
}

/**
 * Ground impact. With the surface normal n̂, the velocity splits into v_n = (v⃗·n̂) n̂ and v_t = v⃗ − v_n.
 *   v⃗′ = −e · v_n + (1 − μ_k − c) · v_t
 * e is the surface restitution, μ_k its tangential friction, and c a backspin "check" term
 * c = check · clamp(r·ω_back / |v_t|, 0, 1) that lets a spinning wedge stop on a green. Spin keeps a retention fraction.
 */
export function bounce(state: FlightState, normal: Vec3, surface: SurfaceKind): FlightState {
  const contact = contactFor(surface)
  const normalSpeed = dot(state.velocity, normal)
  const normalPart = scale(normal, normalSpeed)
  const tangential = sub(state.velocity, normalPart)
  const tangentialSpeed = length(tangential)
  const backspin = Math.max(0, state.spinRate * dot(state.spinAxis, normalize(cross(tangential, UP))))
  const check = tangentialSpeed > 1e-6 ? contact.backspinCheck * Math.min(1, (tuning.ball.radiusM * backspin) / tangentialSpeed) : 0
  const keep = Math.max(0, 1 - contact.tangentialFriction - check)
  return {
    position: state.position,
    velocity: addScaled(scale(tangential, keep), normalPart, -contact.restitution),
    spinAxis: state.spinAxis,
    spinRate: state.spinRate * contact.spinRetention,
  }
}

/**
 * One rolling step on the ground (horizontal components only, the ball stays on the surface):
 *   a = −μ_r g v̂ − g ∇h
 * Rolling resistance μ_r g opposes the motion and is clamped so it can stop the ball but never reverse it;
 * the slope term −g∇h pulls the ball downhill, which is what breaks a putt across a tilted green.
 */
export function rollStep(velocity: readonly [number, number], gradient: readonly [number, number], rollingFriction: number, dt: number): [number, number] {
  const g = tuning.air.gravity
  let vx = velocity[0] - g * gradient[0] * dt
  let vz = velocity[1] - g * gradient[1] * dt
  const speed = Math.hypot(vx, vz)
  const friction = rollingFriction * g * dt
  if (speed <= friction) return [0, 0]
  vx -= (vx / speed) * friction
  vz -= (vz / speed) * friction
  return [vx, vz]
}

function treeInteraction(course: Course, state: FlightState, dt: number, airborne: boolean): FlightState {
  const spec = tuning.trees
  let { position, velocity } = state
  for (const tree of course.trees) {
    const dx = position[0] - tree.x
    const dz = position[2] - tree.z
    const reach = spec.crownRadius * tree.scale
    if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue
    const base = course.heightAt(tree.x, tree.z)
    const horizontal = Math.hypot(dx, dz)
    const trunk = spec.trunkRadius * tree.scale
    if (horizontal < trunk && position[1] - base < spec.trunkHeight * tree.scale) {
      const normal: Vec3 = horizontal > 1e-6 ? [dx / horizontal, 0, dz / horizontal] : [1, 0, 0]
      const into = dot(velocity, normal)
      if (into < 0) velocity = addScaled(velocity, normal, -(1 + spec.trunkRestitution) * into)
      position = [tree.x + normal[0] * trunk, position[1], tree.z + normal[2] * trunk]
      continue
    }
    if (!airborne) continue
    const dy = position[1] - (base + spec.crownCenterHeight * tree.scale)
    if (horizontal * horizontal + dy * dy < reach * reach) velocity = scale(velocity, Math.exp(-spec.crownDragPerSecond * dt))
  }
  return { ...state, position, velocity }
}

/**
 * Simulates a whole shot from (params, seed) and returns every sample plus the outcome. Nothing else is read, so the
 * host and every guest replay the same flight; only the seed varies the rough lie penalty. The loop is semi-implicit
 * Euler at the fixed step Δt: v ← v + a·Δt, then x ← x + v·Δt (velocity first keeps the orbit-like flight stable).
 * Phases: air (gravity, drag, Magnus, wind, trees) → bounces on each impact → roll until |v| < restSpeed on a slope
 * gentle enough to hold the ball. Water ends the shot with a one-stroke penalty and a drop; leaving the bounds is
 * stroke-and-distance (penalty, replay from the origin); the cup captures a slow enough ball.
 */
export function simulateShot(params: ShotParams, seed: number, course: Course = courseFor(params.hole)): ShotResult {
  const { flight, cup, ball, match } = tuning
  const dt = 1 / flight.stepHz
  const random = createRandom(seed)
  const powerFactor = liePowerFactor(params.lie, params.teeShot, random)
  const launch = launchState(params, powerFactor)
  const pin = course.pinPosition()
  const origin: Vec3 = [params.origin[0], course.heightAt(params.origin[0], params.origin[2]) + ball.radiusM, params.origin[2]]
  let state: FlightState = { position: origin, velocity: launch.velocity, spinAxis: launch.spinAxis, spinRate: launch.spinRate }
  const samples: number[] = [origin[0], origin[1], origin[2]]
  let airborne = launch.velocity[1] > 1e-6
  let landing: Vec3 | null = null
  let descentDegrees: number | null = null
  let apex = origin[1]
  let flightSeconds = 0
  let outcome: ShotOutcome = 'rest'
  let restSurface: SurfaceKind = course.surfaceAt(origin[0], origin[2])
  const maxSteps = Math.ceil(flight.maxSeconds * flight.stepHz)
  const spinDecay = Math.exp(-dt / ball.spinDecaySeconds)

  if (!airborne) {
    const normal = course.normalAt(origin[0], origin[2])
    state = { ...state, velocity: sub(state.velocity, scale(normal, dot(state.velocity, normal))) }
  }

  for (let step = 0; step < maxSteps; step++) {
    if (airborne) {
      const ground = course.heightAt(state.position[0], state.position[2])
      const wind = windAtHeight(params.wind, state.position[1] - ground)
      const velocity = addScaled(state.velocity, airAcceleration(state, wind), dt)
      state = { ...state, velocity, position: addScaled(state.position, velocity, dt), spinRate: state.spinRate * spinDecay }
      state = treeInteraction(course, state, dt, true)
      flightSeconds += dt
      apex = Math.max(apex, state.position[1])
      const [x, y, z] = state.position
      const floor = course.heightAt(x, z) + ball.radiusM
      if (y <= floor) {
        state = { ...state, position: [x, floor, z] }
        const surface = course.surfaceAt(x, z)
        restSurface = surface
        if (!landing) {
          landing = state.position
          descentDegrees = (Math.atan2(-state.velocity[1], Math.hypot(state.velocity[0], state.velocity[2])) * 180) / Math.PI
        }
        if (!course.inBounds(x, z)) {
          outcome = 'out'
        } else if (surface === 'water') {
          outcome = 'water'
        } else if (horizontalDistance(state.position, pin) < cup.radius && Math.hypot(state.velocity[0], state.velocity[2]) < cup.dunkSpeed) {
          state = { ...state, position: pin }
          outcome = 'holed'
        } else {
          const normal = course.normalAt(x, z)
          const into = -dot(state.velocity, normal)
          if (into > flight.bounceMinNormalSpeed) {
            state = bounce(state, normal, surface)
          } else {
            airborne = false
            const tangential = sub(state.velocity, scale(normal, dot(state.velocity, normal)))
            state = { ...state, velocity: tangential }
          }
        }
      }
    } else {
      const [x, , z] = state.position
      const surface = course.surfaceAt(x, z)
      restSurface = surface
      const gradient = course.gradientAt(x, z)
      const contact = contactFor(surface)
      const [vx, vz] = rollStep([state.velocity[0], state.velocity[2]], gradient, contact.rollingFriction, dt)
      const nx = x + vx * dt
      const nz = z + vz * dt
      state = treeInteraction(course, { ...state, velocity: [vx, 0, vz], position: [nx, course.heightAt(nx, nz) + ball.radiusM, nz] }, dt, false)
      const speed = Math.hypot(state.velocity[0], state.velocity[2])
      const slopePull = tuning.air.gravity * Math.hypot(gradient[0], gradient[1])
      const nextSurface = course.surfaceAt(state.position[0], state.position[2])
      if (!course.inBounds(state.position[0], state.position[2])) outcome = 'out'
      else if (nextSurface === 'water') outcome = 'water'
      else if (horizontalDistance(state.position, pin) < cup.radius && speed < cup.captureSpeed) {
        state = { ...state, position: pin }
        outcome = 'holed'
      } else if (speed < flight.restSpeed && slopePull <= flight.staticSlopeFactor * contact.rollingFriction * tuning.air.gravity) {
        restSurface = nextSurface
        samples.push(state.position[0], state.position[1], state.position[2])
        break
      }
    }
    samples.push(state.position[0], state.position[1], state.position[2])
    if (outcome !== 'rest') break
  }

  const rest = state.position
  let next: Vec3 = rest
  let penalty = 0
  if (outcome === 'water') {
    penalty = match.waterPenalty
    next = course.dropPosition(course.waterIndexAt(rest[0], rest[2]))
  } else if (outcome === 'out') {
    penalty = match.outOfBoundsPenalty
    next = origin
  } else if (outcome === 'holed') {
    next = pin
  }
  const nextSurface = outcome === 'out' ? course.surfaceAt(origin[0], origin[2]) : course.surfaceAt(next[0], next[2])
  const nextLie: LieKind = outcome === 'out' && params.teeShot ? 'tee' : outcome === 'out' ? params.lie : lieForSurface(nextSurface)
  return {
    samples,
    stepSeconds: dt,
    outcome,
    rest,
    next,
    nextLie,
    restSurface,
    penalty,
    landing,
    carry: landing ? horizontalDistance(landing, origin) : 0,
    apex: apex - origin[1],
    descentDegrees,
    flightSeconds,
    powerFactor,
    launchSpeed: launch.launchSpeed,
    launchDegrees: launch.launchDegrees,
    spinRpm: launch.spinRate / RPM_TO_RADIANS,
  }
}

export function sampleCount(result: ShotResult): number {
  return result.samples.length / 3
}

export function sampleAt(result: ShotResult, index: number): Vec3 {
  const clamped = Math.max(0, Math.min(sampleCount(result) - 1, index)) * 3
  return [result.samples[clamped], result.samples[clamped + 1], result.samples[clamped + 2]]
}
