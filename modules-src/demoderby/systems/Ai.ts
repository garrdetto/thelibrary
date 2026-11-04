/** Opponent driving: pick a target, line up a nose or tail hit, steer around wrecks, back out of corners and walls, and break out when no progress is being made; writes only the car's controls. */
import * as THREE from 'three/webgpu'
import type { AiLevel } from '../config'
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
  seed: number
}

export function createBrain(level: AiLevel, seed: number): AiBrain {
  return { level, targetId: null, retargetClock: 0, manoeuvreClock: 0, manoeuvreThrottle: 0, manoeuvreSteer: 0, approach: 1, progressClock: 0, progressDistance: Infinity, seed }
}

const toTarget = new THREE.Vector3()
const right = new THREE.Vector3()
const toOther = new THREE.Vector3()

const PROGRESS_WINDOW = 3.5
const PROGRESS_MIN = 1.5
const BLOCK_RANGE = 6
const BLOCK_CONE = 0.55

function noise(brain: AiBrain): number {
  brain.seed = (brain.seed * 1664525 + 1013904223) >>> 0
  return brain.seed / 4294967296
}

function manoeuvre(brain: AiBrain, seconds: number, throttle: number, steer: number): void {
  brain.manoeuvreClock = seconds
  brain.manoeuvreThrottle = throttle
  brain.manoeuvreSteer = steer
  brain.progressClock = 0
  brain.progressDistance = Infinity
}

function pickTarget(brain: AiBrain, car: Vehicle, cars: readonly Vehicle[]): void {
  let best: Vehicle | null = null
  let bestScore = -Infinity
  const from = car.pos.clone()
  for (const other of cars) {
    if (other === car || !other.alive) continue
    const distance = from.distanceTo(other.pos)
    const weak = (100 - other.health) / 100
    let score = -distance + weak * 8 * brain.level.aggression + noise(brain) * 6
    if (other.isPlayer) score += 3 * brain.level.aggression
    if (score > bestScore) {
      bestScore = score
      best = other
    }
  }
  brain.targetId = best?.id ?? null
  brain.approach = noise(brain) < brain.level.rearPreference ? -1 : 1
  brain.retargetClock = brain.level.retarget * (0.7 + noise(brain) * 0.6)
  brain.progressClock = 0
  brain.progressDistance = Infinity
}

/** True when a wrecked car or the barrier sits close ahead of the car in the given travel direction (+1 nose, -1 tail). */
function blocked(car: Vehicle, cars: readonly Vehicle[], direction: 1 | -1, arena: { halfL: number; halfW: number }): boolean {
  const position = car.pos.clone()
  const heading = car.heading.clone().multiplyScalar(direction)
  const ahead = position.clone().addScaledVector(heading, BLOCK_RANGE * 0.7)
  if (Math.abs(ahead.x) > arena.halfL - 1.6 || Math.abs(ahead.z) > arena.halfW - 1.6) return true
  for (const other of cars) {
    if (other === car || other.alive) continue
    toOther.copy(other.pos).sub(position)
    toOther.y = 0
    const distance = toOther.length()
    if (distance > BLOCK_RANGE) continue
    if (toOther.normalize().dot(heading) > BLOCK_CONE) return true
  }
  return false
}

export function driveAi(brain: AiBrain, car: Vehicle, cars: readonly Vehicle[], arena: { halfL: number; halfW: number }, dt: number): void {
  const controls = car.controls
  if (!car.alive) {
    controls.throttle = 0
    controls.steer = 0
    controls.brake = true
    return
  }
  controls.brake = false
  brain.retargetClock -= dt
  const target = brain.targetId === null ? null : cars.find((other) => other.id === brain.targetId && other.alive) ?? null
  if (!target || brain.retargetClock <= 0) pickTarget(brain, car, cars)
  const chosen = brain.targetId === null ? null : cars.find((other) => other.id === brain.targetId) ?? null

  if (brain.manoeuvreClock > 0) {
    brain.manoeuvreClock -= dt
    controls.throttle = brain.manoeuvreThrottle
    controls.steer = brain.manoeuvreSteer
    return
  }

  const position = car.pos.clone()
  const heading = car.heading.clone()
  right.set(-heading.z, 0, heading.x)

  if (car.stuck) {
    const away = blocked(car, cars, -1, arena) ? 1 : -1
    manoeuvre(brain, 1 + noise(brain) * 0.8, away * brain.level.throttle, noise(brain) < 0.5 ? -1 : 1)
    brain.approach = (brain.approach * -1) as 1 | -1
    return
  }

  if (chosen) {
    const distance = position.distanceTo(chosen.pos)
    brain.progressClock += dt
    if (distance < brain.progressDistance - PROGRESS_MIN) {
      brain.progressDistance = distance
      brain.progressClock = 0
    } else if (brain.progressClock > PROGRESS_WINDOW && distance > 4.5) {
      const away = blocked(car, cars, -1, arena) ? 1 : -1
      manoeuvre(brain, 1.2 + noise(brain) * 0.8, away * brain.level.throttle, noise(brain) < 0.5 ? -1 : 1)
      brain.approach = (brain.approach * -1) as 1 | -1
      return
    }
  }

  const margin = 4
  const travel = Math.sign(controls.throttle || 1)
  const lookAhead = position.clone().addScaledVector(heading, travel * 5)
  const nearWall = Math.abs(lookAhead.x) > arena.halfL - margin || Math.abs(lookAhead.z) > arena.halfW - margin
  const facingWall = (Math.abs(position.x) > arena.halfL - margin && Math.sign(heading.x * travel) === Math.sign(position.x)) || (Math.abs(position.z) > arena.halfW - margin && Math.sign(heading.z * travel) === Math.sign(position.z))
  if (nearWall && facingWall && car.speed > 1) {
    const turn = position.x * heading.z - position.z * heading.x > 0 ? 1 : -1
    manoeuvre(brain, 0.9 + noise(brain) * 0.6, -travel * brain.level.throttle, turn)
    return
  }

  if (!chosen) {
    controls.throttle = 0.3
    controls.steer = Math.sin(brain.seed) * 0.4
    return
  }
  toTarget.copy(chosen.pos).sub(position)
  toTarget.y = 0
  const distance = toTarget.length()
  toTarget.normalize()
  const ahead = heading.dot(toTarget)
  const side = right.dot(toTarget)
  const noseClear = !blocked(car, cars, 1, arena)
  const tailClear = !blocked(car, cars, -1, arena)
  const wantBackIn = brain.approach < 0 && distance < 14 && tailClear
  if (wantBackIn) {
    if (ahead < -0.4) {
      controls.throttle = -brain.level.throttle
      controls.steer = side > 0 ? 0.9 : -0.9
      return
    }
    controls.throttle = noseClear ? brain.level.throttle * 0.7 : -brain.level.throttle * 0.6
    controls.steer = side > 0 ? -1 : 1
    return
  }
  if (ahead > 0.3 && noseClear) {
    controls.throttle = brain.level.throttle
    controls.steer = Math.max(-1, Math.min(1, side * 2.2))
  } else if ((ahead < -0.5 && distance < 8 && tailClear) || !noseClear) {
    controls.throttle = tailClear ? -brain.level.throttle : brain.level.throttle * 0.5
    controls.steer = side > 0 ? 0.8 : -0.8
  } else {
    controls.throttle = brain.level.throttle * 0.75
    controls.steer = side > 0 ? 1 : -1
  }
}
