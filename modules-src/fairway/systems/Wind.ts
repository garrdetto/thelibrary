/** Seeded wind per hole and its height profile: wind matters most high in the air and fades near the ground. */
import { tuning, type WindSpec } from '../tuning'
import { createRandom, randomBetween } from './Random'
import type { Vec3 } from './Vector'

export interface WindState {
  speed: number
  /** Direction the wind blows toward, as a yaw on the ground plane (same convention as headingVector). */
  yaw: number
  vector: readonly [number, number]
}

/** Rolls a wind for one hole from its seed: uniform speed in the configured range and a uniform direction. */
export function windForSeed(seed: number, spec: WindSpec = tuning.wind): WindState {
  const random = createRandom(seed)
  const speed = randomBetween(random, spec.speedRange[0], spec.speedRange[1])
  const yaw = randomBetween(random, -Math.PI, Math.PI)
  return { speed, yaw, vector: [Math.sin(yaw) * speed, Math.cos(yaw) * speed] }
}

export function windFromVector(vector: readonly [number, number]): WindState {
  return { speed: Math.hypot(vector[0], vector[1]), yaw: Math.atan2(vector[0], vector[1]), vector }
}

/**
 * Wind velocity felt by the ball at a height above the ground, using a power-law boundary layer:
 *   w(h) = w_ref · max(f₀, min(1, h / h_ref)^α)
 * with reference height h_ref, exponent α and a small ground floor f₀ so a rolling ball still drifts slightly.
 */
export function windAtHeight(vector: readonly [number, number], heightAboveGround: number, spec: WindSpec = tuning.wind): Vec3 {
  const ratio = Math.max(0, Math.min(1, heightAboveGround / spec.referenceHeight))
  const factor = Math.max(spec.groundFactor, Math.pow(ratio, spec.heightExponent))
  return [vector[0] * factor, 0, vector[1] * factor]
}
