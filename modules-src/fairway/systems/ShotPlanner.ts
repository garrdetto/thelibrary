/** Shot planning for the aim preview: the perfectly struck flight for the current setup, the power that reaches a distance, the default shot type and the landing zone a fair miss spreads over. */
import { tuning, type LieKind, type ShotKind } from '../tuning'
import { simulateShot, type ShotParams, type ShotResult } from './BallFlight'
import type { Course } from './Course'
import { horizontalDistance, type Vec3 } from './Vector'

export interface LandingZone {
  center: Vec3
  yaw: number
  /** Half extent along the aim line (short and long) in metres. */
  halfLength: number
  /** Half extent across the aim line (left and right) in metres. */
  halfWidth: number
}

/** A struck-perfectly copy of the parameters: no path or face miss, the given power. */
export function perfectParams(params: ShotParams, power: number): ShotParams {
  return { ...params, power: Math.max(0, Math.min(1, power)), curve: 0, push: 0 }
}

/** Flies the perfect shot with the fixed preview seed (so a rough lie previews one fair outcome of its random penalty). */
export function previewShot(params: ShotParams, course: Course): ShotResult {
  return simulateShot(params, tuning.shortGame.previewSeed, course)
}

/** Putts and short-game shots are judged where they stop; full shots by their carry. */
export function measuresRest(params: Pick<ShotParams, 'lie' | 'club' | 'shot'>): boolean {
  return params.lie === 'green' || params.club === 'putter' || (params.shot ?? 'full') !== 'full'
}

function reach(params: ShotParams, course: Course): number {
  const result = previewShot(params, course)
  if (measuresRest(params)) return horizontalDistance(result.rest, params.origin)
  return result.landing ? result.carry : horizontalDistance(result.rest, params.origin)
}

/**
 * Power for a distance by bisection on [minPower, 1]: carry (full shots) and rest distance (putts and short game) both
 * grow with power, so the interval halves each step toward the power whose perfect strike reaches the target.
 */
export function powerForDistance(params: ShotParams, distance: number, course: Course): number {
  const { minPower, plannerIterations } = tuning.shortGame
  if (reach(perfectParams(params, 1), course) <= distance) return 1
  let low = minPower
  let high = 1
  for (let step = 0; step < plannerIterations; step++) {
    const middle = (low + high) / 2
    if (reach(perfectParams(params, middle), course) < distance) low = middle
    else high = middle
  }
  return Math.round(((low + high) / 2) * 1000) / 1000
}

/** Short shots near the green default to a chip; everything else, and every putt, to a full swing. */
export function defaultShotKind(distanceToPin: number, lie: LieKind): ShotKind {
  if (lie === 'green' || lie === 'tee') return 'full'
  return distanceToPin <= tuning.shortGame.autoChipRange ? 'chip' : 'full'
}

/**
 * Where a fair miss lands: an ellipse around the perfect landing spot, aligned with the aim. Across the line it spans the
 * start-line change of a 40 % path and face miss plus the bend of that face miss (about 6 % of carry); along the line the
 * rhythm loss (up to 7 % of carry) and, from the rough, the ±10 % lie penalty.
 */
export function landingZone(params: ShotParams, result: ShotResult): LandingZone | null {
  const spot = result.landing ?? result.rest
  const carry = horizontalDistance(spot, params.origin)
  if (carry < 0.5) return null
  const meter = tuning.meter
  const fair = 0.4
  const startLine = Math.tan(fair * (meter.maxPushRadians + meter.maxYawRadians))
  const putting = params.lie === 'green' || params.club === 'putter'
  const halfWidth = Math.max(0.4, carry * (startLine + (putting ? 0 : 0.06 * fair)))
  const roughSpread = params.lie === 'rough' ? 0.1 : 0
  const halfLength = Math.max(0.4, carry * (meter.maxRhythmLoss * 0.5 + roughSpread) + (putting ? 0 : 1))
  return { center: spot, yaw: params.yaw, halfLength, halfWidth }
}
