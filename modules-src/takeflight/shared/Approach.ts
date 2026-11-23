/**
 * Where the aircraft sits relative to the approach it is flying: the nearest landing runway end it is lined up with (within 35°
 * of the runway heading, 50 m to 18 km before the aiming point), its height against the glidepath and its offset from the
 * extended centreline, in instrument dots. ILS runways drive the HUD's localizer and glideslope needles; any runway drives the
 * landing-guidance bar. Renderer-free.
 */
import { AIRPORTS, aimDistance, landingEnds, runwayEndFor } from './Airports'
import type { AirportSpec, RunwayEnd, RunwaySpec } from './Airports'
import { RAD, atan2 } from '../sim/SimMath'

/** Glideslope dot (0.35°) and localizer dot (1.25°). */
export const GS_DOT = 0.35
export const LOC_DOT = 1.25
const RANGE = 18000
const RANGE_SQ = (RANGE + 4000) * (RANGE + 4000)

export interface ApproachState {
  airport: AirportSpec
  runway: RunwaySpec
  end: RunwayEnd
  ils: boolean
  /** Dots above (+) or below the glidepath. */
  glideslope: number
  /** Dots right (+) or left of the extended centreline. */
  localizer: number
  /** Metres to the aiming point along the approach. */
  distance: number
}

const scratch: RunwayEnd = { end: 0, name: '', heading: 0, x: 0, z: 0, dx: 0, dz: 0 }

function headingGap(a: number, b: number): number {
  let d = Math.abs(a - b) % 360
  if (d > 180) d = 360 - d
  return d
}

/** The approach being flown from (x, y, z) on `heading`, or null when not lined up with any landing runway end. */
export function approachFor(x: number, y: number, z: number, heading: number, wheelHeight = 1.3): ApproachState | null {
  let best: ApproachState | null = null
  for (const airport of AIRPORTS) {
    const ax = x - airport.x
    const az = z - airport.z
    if (ax * ax + az * az > RANGE_SQ) continue
    for (const runway of airport.runways) {
      for (const index of landingEnds(airport, runway)) {
        const end = runwayEndFor(runway, index === 0 ? runway.heading : runway.heading + 180, scratch)
        if (headingGap(heading, end.heading) > 35) continue
        const aim = aimDistance(runway)
        const aimX = end.x + end.dx * aim
        const aimZ = end.z + end.dz * aim
        const along = (aimX - x) * end.dx + (aimZ - z) * end.dz
        if (along < 50 || along > RANGE) continue
        const cross = (x - aimX) * -end.dz + (z - aimZ) * end.dx
        const height = y - wheelHeight - airport.elevation
        const glideslope = (atan2(height, along) * RAD - runway.glidepath) / GS_DOT
        const localizer = (atan2(cross, along + runway.length) * RAD) / LOC_DOT
        if (Math.abs(localizer) > 8) continue
        if (!best || along < best.distance) best = { airport, runway, end: { ...end }, ils: runway.ils[end.end], glideslope, localizer, distance: along }
      }
    }
  }
  return best
}
