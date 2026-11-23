/**
 * Finds the elevator trim that holds an aircraft in steady level flight at a given true airspeed, mass and flap setting, by
 * solving lift = weight for angle of attack in the lift table and then zeroing the pitching moment. Used to start a flight in
 * the air already trimmed; it reads only the aircraft's data and the atmosphere.
 */
import type { AircraftSpec } from '../shared/AircraftSpec'
import { GRAVITY } from './Atmosphere'
import { DEG, clamp, interpolate, sin } from './SimMath'

export interface TrimResult {
  alpha: number
  trim: number
}

export function levelTrim(spec: AircraftSpec, mass: number, trueAirspeed: number, density: number, flap: number): TrimResult {
  const aero = spec.aero
  const qbar = 0.5 * density * trueAirspeed * trueAirspeed
  const needed = (mass * GRAVITY) / (qbar * spec.wing.area)
  const shift = aero.flapStallShift * flap
  let low = -8
  let high = aero.stallAlpha + shift - 0.5
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2
    const cl = interpolate(aero.lift.alpha, aero.lift.value, mid - shift) + aero.flapLift * flap
    if (cl < needed) low = mid
    else high = mid
  }
  const alpha = (low + high) / 2
  const cm = aero.pitch0 + aero.pitchAlpha * sin(alpha * DEG) + aero.flapPitch * flap
  return { alpha, trim: clamp(-cm / aero.pitchTrim, -1, 1) }
}
