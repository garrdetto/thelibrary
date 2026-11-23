/**
 * Airport layouts in world metres (x east, y up, z south; heading 0 = north = -z, 90 = east = +x). Runways are given by their
 * centre, true heading of the low-numbered end's approach direction, length and width; taxiways are straight segments; aprons are
 * rectangles. The terrain flattens itself to `elevation` under each airport. Renderer-free: the sim, scoring and Worker read it.
 */
import { DEG, cos, sin } from '../sim/SimMath'

export type Surface = 'runway' | 'taxiway' | 'apron' | 'grass' | 'water'

export interface RunwaySpec {
  /** Designators of the two ends, e.g. ['09', '27']: the first is flown on `heading`. */
  ends: [string, string]
  cx: number
  cz: number
  heading: number
  length: number
  width: number
  surface: 'asphalt' | 'grass'
  /** ILS on each end (false for visual-only runways). */
  ils: [boolean, boolean]
  /** Glidepath angle in degrees for PAPI and ILS. */
  glidepath: number
}

export interface TaxiwaySpec {
  name: string
  points: [number, number][]
  width: number
}

export interface ApronSpec {
  x0: number
  z0: number
  x1: number
  z1: number
}

export interface StandSpec {
  name: string
  x: number
  z: number
  heading: number
}

export interface AirportSpec {
  id: string
  name: string
  icao: string
  kind: 'grass' | 'ga' | 'regional' | 'cargo' | 'midsize' | 'hub' | 'challenge'
  /** Reference point. */
  x: number
  z: number
  elevation: number
  /** Metres beyond the paved area over which the terrain blends back to its natural height. */
  blend: number
  /** Half extents of the flattened area around the reference point. */
  halfX: number
  halfZ: number
  runways: RunwaySpec[]
  taxiways: TaxiwaySpec[]
  aprons: ApronSpec[]
  stands: StandSpec[]
  /** Tower cab position for the tower camera. */
  tower: [number, number, number]
}

export const HARROW_FIELD: AirportSpec = {
  id: 'harrow',
  name: 'Harrow Field',
  icao: 'KHRW',
  kind: 'ga',
  x: 0,
  z: 0,
  elevation: 128,
  blend: 650,
  halfX: 820,
  halfZ: 320,
  runways: [{ ends: ['09', '27'], cx: 0, cz: 0, heading: 90, length: 1250, width: 30, surface: 'asphalt', ils: [false, false], glidepath: 3 }],
  taxiways: [
    { name: 'A', points: [[-625, -95], [625, -95]], width: 12 },
    { name: 'A1', points: [[-610, -95], [-610, 0]], width: 12 },
    { name: 'A2', points: [[0, -95], [0, 0]], width: 12 },
    { name: 'A3', points: [[610, -95], [610, 0]], width: 12 },
  ],
  aprons: [{ x0: -230, z0: -185, x1: 40, z1: -101 }],
  stands: [
    { name: 'Stand 1', x: -190, z: -150, heading: 180 },
    { name: 'Stand 2', x: -150, z: -150, heading: 180 },
    { name: 'Stand 3', x: -110, z: -150, heading: 180 },
  ],
  tower: [95, 146, -160],
}

export const AIRPORTS: readonly AirportSpec[] = [HARROW_FIELD]

export interface RunwayFrame {
  /** Unit vector along the runway in the direction of the first end's heading. */
  dx: number
  dz: number
  /** Threshold of the first end (start of the paved surface flown on `heading`). */
  x0: number
  z0: number
}

export function runwayFrame(runway: RunwaySpec, out: RunwayFrame = { dx: 0, dz: 0, x0: 0, z0: 0 }): RunwayFrame {
  const h = runway.heading * DEG
  out.dx = sin(h)
  out.dz = -cos(h)
  out.x0 = runway.cx - out.dx * runway.length * 0.5
  out.z0 = runway.cz - out.dz * runway.length * 0.5
  return out
}

const frame: RunwayFrame = { dx: 0, dz: 0, x0: 0, z0: 0 }

/** Along-track and cross-track (right positive) distance of a point from a runway's first threshold. */
export function runwayCoordinates(runway: RunwaySpec, x: number, z: number, out: { along: number; cross: number }): { along: number; cross: number } {
  runwayFrame(runway, frame)
  const rx = x - frame.x0
  const rz = z - frame.z0
  out.along = rx * frame.dx + rz * frame.dz
  out.cross = rx * -frame.dz + rz * frame.dx
  return out
}

const coords = { along: 0, cross: 0 }

function onSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number, halfWidth: number): boolean {
  const ex = bx - ax
  const ez = bz - az
  const lengthSq = ex * ex + ez * ez
  let t = lengthSq > 0 ? ((px - ax) * ex + (pz - az) * ez) / lengthSq : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const qx = ax + ex * t - px
  const qz = az + ez * t - pz
  return qx * qx + qz * qz <= halfWidth * halfWidth
}

/** The paved surface at a point, or null off every airport's pavement. */
export function pavementAt(x: number, z: number): Surface | null {
  for (let a = 0; a < AIRPORTS.length; a++) {
    const airport = AIRPORTS[a]
    if (x < airport.x - airport.halfX || x > airport.x + airport.halfX || z < airport.z - airport.halfZ || z > airport.z + airport.halfZ) continue
    for (let r = 0; r < airport.runways.length; r++) {
      const runway = airport.runways[r]
      runwayCoordinates(runway, x, z, coords)
      if (coords.along >= -8 && coords.along <= runway.length + 8 && coords.cross >= -runway.width * 0.5 - 1 && coords.cross <= runway.width * 0.5 + 1) return runway.surface === 'grass' ? 'grass' : 'runway'
    }
    for (let t = 0; t < airport.taxiways.length; t++) {
      const taxiway = airport.taxiways[t]
      for (let p = 1; p < taxiway.points.length; p++) {
        const a0 = taxiway.points[p - 1]
        const b0 = taxiway.points[p]
        if (onSegment(x, z, a0[0], a0[1], b0[0], b0[1], taxiway.width * 0.5 + 1.5)) return 'taxiway'
      }
    }
    for (let p = 0; p < airport.aprons.length; p++) {
      const apron = airport.aprons[p]
      if (x >= apron.x0 && x <= apron.x1 && z >= apron.z0 && z <= apron.z1) return 'apron'
    }
  }
  return null
}

export function airportById(id: string): AirportSpec | undefined {
  return AIRPORTS.find((airport) => airport.id === id)
}
