/** Opponent driving: picks targets by distance, weakness, an exposed flank and a wall to pin against; leads moving targets and aims at hurt corners and wheels; backs in to protect a hurt engine; dodges cars charging its flank; steers by the angle to its aim point (with its own bent-wheel pull taken out), lifts and brakes for tight turns, three-points out of hopeless angles, avoids wrecks and walls, and breaks out when stuck or not closing. Writes only the car's controls. */
import * as THREE from 'three/webgpu'
import { config, type AiLevel } from '../config'
import type { Vehicle } from './Vehicle'

export interface AiBrain {
  level: AiLevel
  targetId: number | null
  retargetClock: number
  /** Seconds left in a forced manoeuvre, with its throttle and steer. */
  manoeuvreClock: number
  manoeuvreThrottle: number
  manoeuvreSteer: number
  /** -1 backing in, +1 charging; chosen when a target is picked. */
  approach: 1 | -1
  progressClock: number
  progressDistance: number
  /** Seconds before it may dodge again. */
  dodgeClock: number
  /** Where it was at the start of the current stuck window, and how long that window has run. */
  anchorX: number
  anchorZ: number
  anchorClock: number
  /** Seconds spent grinding slowly against its target (it backs off for a run-up after a moment). */
  grindClock: number
  seed: number
}

export function createBrain(level: AiLevel, seed: number): AiBrain {
  return { level, targetId: null, retargetClock: 0, manoeuvreClock: 0, manoeuvreThrottle: 0, manoeuvreSteer: 0, approach: 1, progressClock: 0, progressDistance: Infinity, dodgeClock: 0, anchorX: 0, anchorZ: 0, anchorClock: 0, grindClock: 0, seed }
}

const toTarget = new THREE.Vector3()
const right = new THREE.Vector3()
const toOther = new THREE.Vector3()
const aim = new THREE.Vector3()
const targetRight = new THREE.Vector3()
const velocity = new THREE.Vector3()
const position = new THREE.Vector3()
const heading = new THREE.Vector3()

const PROGRESS_WINDOW = 3.2
const PROGRESS_MIN = 1.5
const BLOCK_RANGE = 6
const BLOCK_CONE = 0.55
const THREAT_RANGE = 10
const URGENT_SECONDS = 18
const ANCHOR_WINDOW = 1.6
const ANCHOR_MIN = 0.9
const GRIND_RANGE = 6.5
const GRIND_SPEED = 2.6
const GRIND_SECONDS = 0.7

function noise(brain: AiBrain): number {
  brain.seed = (brain.seed * 1664525 + 1013904223) >>> 0
  return brain.seed / 4294967296
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function manoeuvre(brain: AiBrain, seconds: number, throttle: number, steer: number): void {
  brain.manoeuvreClock = seconds
  brain.manoeuvreThrottle = throttle
  brain.manoeuvreSteer = steer
  brain.progressClock = 0
  brain.progressDistance = Infinity
}

function planarVelocity(car: Vehicle, out: THREE.Vector3): THREE.Vector3 {
  const v = car.body.linvel()
  return out.set(v.x, 0, v.z)
}

function urgent(car: Vehicle): boolean {
  return car.idle > config.damage.idleOutSeconds - URGENT_SECONDS
}

/** True when its engine or radiator is hurt enough that it should hit with the tail. */
function protectsNose(brain: AiBrain, car: Vehicle): boolean {
  return car.engine < brain.level.protectEngine || car.damage.radiator < brain.level.protectEngine * 0.8
}

function pickTarget(brain: AiBrain, car: Vehicle, cars: readonly Vehicle[], arena: { halfL: number; halfW: number }): void {
  let best: Vehicle | null = null
  let bestScore = -Infinity
  const from = position.copy(car.pos)
  const level = brain.level
  const hurry = urgent(car)
  for (const other of cars) {
    if (other === car || !other.alive) continue
    toOther.copy(other.pos).sub(from)
    toOther.y = 0
    const distance = toOther.length()
    toOther.normalize()
    const weak = (100 - other.health) / 100
    const otherHeading = other.heading
    targetRight.set(-otherHeading.z, 0, otherHeading.x)
    const flank = Math.abs(targetRight.dot(toOther))
    const op = other.pos
    const wallGap = Math.min(arena.halfL - Math.abs(op.x), arena.halfW - Math.abs(op.z))
    const pinned = wallGap < 3.5 ? 1 - wallGap / 3.5 : 0
    let score = -distance * (hurry ? 2 : 1) + weak * 8 * level.aggression + flank * 4 * level.aim + pinned * 3 * level.aim + noise(brain) * 5 * (1.2 - level.aim)
    if (other.isPlayer) score += 2.5 * level.aggression
    if (other.id === brain.targetId) score += 2
    if (score > bestScore) {
      bestScore = score
      best = other
    }
  }
  brain.targetId = best?.id ?? null
  brain.approach = protectsNose(brain, car) || noise(brain) < level.rearPreference ? -1 : 1
  brain.retargetClock = level.retarget * (0.7 + noise(brain) * 0.6)
  brain.progressClock = 0
  brain.progressDistance = Infinity
}

/** True when a wrecked car or the barrier sits close ahead of the car in the given travel direction (+1 nose, -1 tail). */
function blocked(car: Vehicle, cars: readonly Vehicle[], direction: 1 | -1, arena: { halfL: number; halfW: number }): boolean {
  const from = car.pos.clone()
  const travel = car.heading.clone().multiplyScalar(direction)
  const ahead = from.clone().addScaledVector(travel, BLOCK_RANGE * 0.7)
  if (Math.abs(ahead.x) > arena.halfL - 1.6 || Math.abs(ahead.z) > arena.halfW - 1.6) return true
  for (const other of cars) {
    if (other === car || other.alive) continue
    toOther.copy(other.pos).sub(from)
    toOther.y = 0
    const distance = toOther.length()
    if (distance > BLOCK_RANGE) continue
    if (toOther.normalize().dot(travel) > BLOCK_CONE) return true
  }
  return false
}

/** A live car bearing down on this one: returns it with the seconds to impact, or null. */
function incoming(car: Vehicle, cars: readonly Vehicle[]): { threat: Vehicle; eta: number } | null {
  let found: { threat: Vehicle; eta: number } | null = null
  const from = car.pos.clone()
  const ourVelocity = planarVelocity(car, new THREE.Vector3())
  for (const other of cars) {
    if (other === car || !other.alive) continue
    toOther.copy(from).sub(other.pos)
    toOther.y = 0
    const distance = toOther.length()
    if (distance > THREAT_RANGE || distance < 2) continue
    toOther.divideScalar(distance)
    planarVelocity(other, velocity).sub(ourVelocity)
    const closing = velocity.dot(toOther)
    if (closing < 4.5) continue
    const travel = other.heading.clone().multiplyScalar(Math.sign(other.forwardSpeed) || 1)
    if (travel.dot(toOther) < 0.85) continue
    const eta = distance / closing
    if (eta < 1.5 && (!found || eta < found.eta)) found = { threat: other, eta }
  }
  return found
}

export function driveAi(brain: AiBrain, car: Vehicle, cars: readonly Vehicle[], arena: { halfL: number; halfW: number }, dt: number): void {
  const controls = car.controls
  const level = brain.level
  if (!car.alive) {
    controls.throttle = 0
    controls.steer = 0
    controls.brake = true
    return
  }
  controls.brake = false
  brain.retargetClock -= dt
  brain.dodgeClock -= dt
  const current = brain.targetId === null ? null : cars.find((other) => other.id === brain.targetId && other.alive) ?? null
  if (!current || brain.retargetClock <= 0) pickTarget(brain, car, cars, arena)
  const chosen = brain.targetId === null ? null : cars.find((other) => other.id === brain.targetId) ?? null
  const pull = car.steerPull
  const throttleCap = urgent(car) ? 1 : level.throttle

  position.copy(car.pos)
  brain.anchorClock += dt
  if (brain.anchorClock >= ANCHOR_WINDOW) {
    const moved = Math.hypot(position.x - brain.anchorX, position.z - brain.anchorZ)
    const wasPushing = Math.abs(controls.throttle) > 0.3
    brain.anchorX = position.x
    brain.anchorZ = position.z
    brain.anchorClock = 0
    if (moved < ANCHOR_MIN && wasPushing) {
      const away = -Math.sign(controls.throttle) || 1
      const clear = away > 0 ? !blocked(car, cars, 1, arena) : !blocked(car, cars, -1, arena)
      manoeuvre(brain, 1 + noise(brain) * 0.6, (clear ? away : -away) * throttleCap, noise(brain) < 0.5 ? -0.8 : 0.8)
      brain.approach = (brain.approach * -1) as 1 | -1
      brain.grindClock = 0
    }
  }

  if (brain.manoeuvreClock > 0) {
    brain.manoeuvreClock -= dt
    controls.throttle = brain.manoeuvreThrottle
    controls.steer = clamp(brain.manoeuvreSteer - pull, -1, 1)
    return
  }

  heading.copy(car.heading)
  right.set(-heading.z, 0, heading.x)

  if (car.stuck) {
    const away = blocked(car, cars, -1, arena) ? 1 : -1
    manoeuvre(brain, 0.9 + noise(brain) * 0.7, away * throttleCap, noise(brain) < 0.5 ? -1 : 1)
    brain.approach = (brain.approach * -1) as 1 | -1
    return
  }

  if (chosen && position.distanceTo(chosen.pos) < GRIND_RANGE && car.speed < GRIND_SPEED && Math.abs(controls.throttle) > 0.3) {
    brain.grindClock += dt
    if (brain.grindClock > GRIND_SECONDS) {
      brain.grindClock = 0
      const away = -Math.sign(controls.throttle) || 1
      const clear = away > 0 ? !blocked(car, cars, 1, arena) : !blocked(car, cars, -1, arena)
      manoeuvre(brain, 0.8 + noise(brain) * 0.5, (clear ? away : -away) * throttleCap, (noise(brain) - 0.5) * 0.8)
      if (noise(brain) < 0.5) brain.approach = (brain.approach * -1) as 1 | -1
      return
    }
  } else {
    brain.grindClock = Math.max(0, brain.grindClock - dt)
  }

  const threat = brain.dodgeClock <= 0 ? incoming(car, cars) : null
  if (threat && threat.threat !== chosen) {
    brain.dodgeClock = 1.2
    if (noise(brain) < level.evasion) {
      toOther.copy(threat.threat.pos).sub(position)
      toOther.y = 0
      toOther.normalize()
      const ahead = heading.dot(toOther)
      const side = right.dot(toOther)
      if (ahead > 0.55 && protectsNose(brain, car)) {
        manoeuvre(brain, 0.7, -throttleCap, side > 0 ? 1 : -1)
      } else if (Math.abs(ahead) < 0.6) {
        const forwardClear = !blocked(car, cars, 1, arena)
        manoeuvre(brain, 0.55 + threat.eta * 0.3, (forwardClear ? 1 : -1) * throttleCap, 0)
      }
      if (brain.manoeuvreClock > 0) return
    }
  }

  if (chosen) {
    const distance = position.distanceTo(chosen.pos)
    brain.progressClock += dt
    if (distance < brain.progressDistance - PROGRESS_MIN) {
      brain.progressDistance = distance
      brain.progressClock = 0
    } else if (brain.progressClock > PROGRESS_WINDOW && distance > 4.5) {
      const away = blocked(car, cars, -1, arena) ? 1 : -1
      manoeuvre(brain, 1 + noise(brain) * 0.7, away * throttleCap, noise(brain) < 0.5 ? -1 : 1)
      brain.approach = (brain.approach * -1) as 1 | -1
      return
    }
  }

  const margin = 4
  const travel = Math.sign(controls.throttle || 1)
  const lookAhead = position.clone().addScaledVector(heading, travel * 5)
  const nearWall = Math.abs(lookAhead.x) > arena.halfL - margin || Math.abs(lookAhead.z) > arena.halfW - margin
  const facingWall = (Math.abs(position.x) > arena.halfL - margin && Math.sign(heading.x * travel) === Math.sign(position.x)) || (Math.abs(position.z) > arena.halfW - margin && Math.sign(heading.z * travel) === Math.sign(position.z))
  const pinning = chosen ? chosen.pos.distanceTo(position) < 7 && heading.clone().multiplyScalar(travel).dot(toTarget.copy(chosen.pos).sub(position).normalize()) > 0.7 : false
  if (nearWall && facingWall && car.speed > 1 && !pinning) {
    const turn = position.x * heading.z - position.z * heading.x > 0 ? 1 : -1
    manoeuvre(brain, 0.8 + noise(brain) * 0.5, -travel * throttleCap, turn)
    return
  }

  if (!chosen) {
    controls.throttle = 0.35
    controls.steer = clamp(Math.sin(brain.seed) * 0.4 - pull, -1, 1)
    return
  }

  toTarget.copy(chosen.pos).sub(position)
  toTarget.y = 0
  const distance = toTarget.length()
  const closing = Math.max(4, car.speed + 2)
  const leadSeconds = clamp(distance / closing, 0, 1.4) * level.lead
  aim.copy(chosen.pos).addScaledVector(planarVelocity(chosen, velocity), leadSeconds)
  const theirHeading = chosen.heading
  targetRight.set(-theirHeading.z, 0, theirHeading.x)
  const panels = chosen.damage.panels
  const exposed = Math.sign(targetRight.dot(toOther.copy(position).sub(chosen.pos))) || 1
  const noseWeaker = panels.frontLeft + panels.frontRight < panels.rearLeft + panels.rearRight
  aim.addScaledVector(targetRight, exposed * chosen.spec.width * 0.35 * level.aim)
  aim.addScaledVector(theirHeading, (noseWeaker ? 1 : -1) * chosen.spec.wheelbase * 0.3 * level.aim)
  toTarget.copy(aim).sub(position)
  toTarget.y = 0
  toTarget.normalize()
  const ahead = heading.dot(toTarget)
  const side = right.dot(toTarget)
  const noseClear = !blocked(car, cars, 1, arena)
  const tailClear = !blocked(car, cars, -1, arena)
  const speed = car.speed

  const backIn = brain.approach < 0 && distance < 16 && tailClear
  if (backIn) {
    const angle = Math.atan2(side, -ahead)
    if (Math.abs(angle) < 1.9) {
      controls.throttle = -throttleCap * (Math.abs(angle) < 0.6 ? 1 : 0.7)
      controls.steer = clamp(angle * level.steerGain - pull, -1, 1)
      controls.brake = Math.abs(angle) > 1.1 && speed > 8
      return
    }
    controls.throttle = noseClear ? throttleCap * 0.75 : -throttleCap * 0.6
    controls.steer = clamp((side > 0 ? -1 : 1) - pull, -1, 1)
    return
  }

  const angle = Math.atan2(side, ahead)
  if (Math.abs(angle) > 2.1 && distance < 9 && tailClear) {
    manoeuvre(brain, 0.6 + noise(brain) * 0.3, -throttleCap, side > 0 ? -1 : 1)
    return
  }
  if (!noseClear && tailClear) {
    controls.throttle = -throttleCap
    controls.steer = clamp((side > 0 ? 0.8 : -0.8) - pull, -1, 1)
    return
  }
  const turn = Math.abs(angle)
  controls.steer = clamp(angle * level.steerGain - pull, -1, 1)
  controls.throttle = noseClear ? throttleCap * (turn < 0.45 ? 1 : turn < 1 ? 0.8 : 0.6) : throttleCap * 0.5
  controls.brake = turn > 1.1 && speed > 9
}
