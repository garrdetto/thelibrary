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
  elevation: 205,
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
  tower: [95, 223, -160],
}

interface LayoutSpec {
  id: string
  name: string
  icao: string
  kind: AirportSpec['kind']
  x: number
  z: number
  elevation: number
  heading: number
  length: number
  width: number
  surface: RunwaySpec['surface']
  ils: [boolean, boolean]
  /** Second runway parallel to the first, this many metres to its right (hubs). */
  parallel?: { offset: number; length: number }
  /** Side of the runway (+1 right of the first end's direction, -1 left) for taxiway, apron and buildings. */
  side: 1 | -1
  apron: { width: number; depth: number }
  stands: number
}

function designator(heading: number): string {
  const n = Math.round(heading / 10) % 36 || 36
  return String(n).padStart(2, '0')
}

/** Lays out a whole airport from a few numbers: runway(s), a parallel taxiway with end and middle connectors, an axis-aligned apron off the middle connector, stands and a tower beside the apron. */
function layout(spec: LayoutSpec): AirportSpec {
  const h = spec.heading * DEG
  const dx = sin(h)
  const dz = -cos(h)
  const rx = -dz * spec.side
  const rz = dx * spec.side
  const half = spec.length / 2
  const big = spec.length >= 1500
  const taxiOffset = (big ? 150 : 95) + (spec.parallel && spec.side > 0 ? spec.parallel.offset : 0)
  const taxiWidth = big ? 23 : 12
  const point = (along: number, across: number): [number, number] => [Math.round((spec.x + dx * along + rx * across) * 10) / 10, Math.round((spec.z + dz * along + rz * across) * 10) / 10]
  const low = designator(spec.heading)
  const high = designator(spec.heading + 180)
  const runways: RunwaySpec[] = []
  if (spec.parallel) {
    const sideName = (offsetRight: boolean, end: 0 | 1) => (offsetRight === (end === 0) ? 'R' : 'L')
    const p = spec.parallel
    const px = spec.x + -dz * p.offset
    const pz = spec.z + dx * p.offset
    runways.push({ ends: [low + sideName(false, 0), high + sideName(false, 1)], cx: spec.x, cz: spec.z, heading: spec.heading, length: spec.length, width: spec.width, surface: spec.surface, ils: spec.ils, glidepath: 3 })
    runways.push({ ends: [low + sideName(true, 0), high + sideName(true, 1)], cx: Math.round(px * 10) / 10, cz: Math.round(pz * 10) / 10, heading: spec.heading, length: p.length, width: spec.width, surface: spec.surface, ils: spec.ils, glidepath: 3 })
  } else {
    runways.push({ ends: [low, high], cx: spec.x, cz: spec.z, heading: spec.heading, length: spec.length, width: spec.width, surface: spec.surface, ils: spec.ils, glidepath: 3 })
  }
  const taxiways: TaxiwaySpec[] = [
    { name: 'A', points: [point(-half + 15, taxiOffset), point(half - 15, taxiOffset)], width: taxiWidth },
    { name: 'A1', points: [point(-half + 15, taxiOffset), point(-half + 15, 0)], width: taxiWidth },
    { name: 'A2', points: [point(0, taxiOffset), point(0, 0)], width: taxiWidth },
    { name: 'A3', points: [point(half - 15, taxiOffset), point(half - 15, 0)], width: taxiWidth },
  ]
  const apronCentre = point(0, taxiOffset + taxiWidth / 2 + spec.apron.depth / 2 + 25)
  const link = point(0, taxiOffset + taxiWidth / 2 + 25)
  taxiways.push({ name: 'B', points: [point(0, taxiOffset), link], width: taxiWidth })
  const aw = spec.apron.width / 2
  const ad = spec.apron.depth / 2
  const extent = Math.max(aw, ad)
  const apron: ApronSpec = { x0: apronCentre[0] - extent, z0: apronCentre[1] - extent, x1: apronCentre[0] + extent, z1: apronCentre[1] + extent }
  const stands: StandSpec[] = []
  const standHeading = (spec.heading + (spec.side > 0 ? 270 : 90)) % 360
  for (let i = 0; i < spec.stands; i++) {
    const t = spec.stands === 1 ? 0 : (i / (spec.stands - 1) - 0.5) * (2 * extent - 40)
    stands.push({ name: `Stand ${i + 1}`, x: Math.round(apronCentre[0] + t), z: Math.round(apronCentre[1]), heading: standHeading })
  }
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  const grow = (x: number, z: number) => {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  for (const r of runways) for (const e of [-1, 1]) for (const c of [-1, 1]) grow(r.cx + dx * e * (r.length / 2 + 60) + -dz * c * 40, r.cz + dz * e * (r.length / 2 + 60) + dx * c * 40)
  for (const t of taxiways) for (const [x, z] of t.points) {
    grow(x - 40, z - 40)
    grow(x + 40, z + 40)
  }
  grow(apron.x0 - 80, apron.z0 - 80)
  grow(apron.x1 + 80, apron.z1 + 80)
  const tower = point(spec.length * 0.18, taxiOffset + taxiWidth / 2 + 25 + spec.apron.depth + 40)
  grow(tower[0], tower[1])
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  return {
    id: spec.id,
    name: spec.name,
    icao: spec.icao,
    kind: spec.kind,
    x: Math.round(cx),
    z: Math.round(cz),
    elevation: spec.elevation,
    blend: big ? 900 : 600,
    halfX: Math.ceil((maxX - minX) / 2 + 60),
    halfZ: Math.ceil((maxZ - minZ) / 2 + 60),
    runways,
    taxiways,
    aprons: [apron],
    stands,
    tower: [tower[0], spec.elevation + (big ? 32 : 18), tower[1]],
  }
}

export const MILLBROOK_STRIP = layout({ id: 'millbrook', name: 'Millbrook Strip', icao: 'KMBK', kind: 'grass', x: 13000, z: -6000, elevation: 213, heading: 140, length: 650, width: 22, surface: 'grass', ils: [false, false], side: 1, apron: { width: 90, depth: 60 }, stands: 3 })
export const ASHBY_REGIONAL = layout({ id: 'ashby', name: 'Ashby Regional', icao: 'KASH', kind: 'regional', x: 42000, z: 12000, elevation: 218, heading: 150, length: 1800, width: 30, surface: 'asphalt', ils: [true, true], side: 1, apron: { width: 220, depth: 120 }, stands: 6 })
export const FENWICK_FREIGHT = layout({ id: 'fenwick', name: 'Fenwick Freight Field', icao: 'KFWK', kind: 'cargo', x: -25000, z: 37500, elevation: 208, heading: 40, length: 2700, width: 45, surface: 'asphalt', ils: [true, true], side: -1, apron: { width: 360, depth: 200 }, stands: 6 })
export const CORRAN_COUNTY = layout({ id: 'corran', name: 'Corran County Airport', icao: 'KCRN', kind: 'midsize', x: -50000, z: -5000, elevation: 164, heading: 140, length: 2400, width: 45, surface: 'asphalt', ils: [true, true], side: 1, apron: { width: 300, depth: 160 }, stands: 8 })
export const HALVARD_INTERNATIONAL = layout({ id: 'halvard', name: 'Halvard International', icao: 'KHLV', kind: 'hub', x: 60000, z: 45000, elevation: 172, heading: 120, length: 3600, width: 45, surface: 'asphalt', ils: [true, true], parallel: { offset: 400, length: 3000 }, side: 1, apron: { width: 480, depth: 260 }, stands: 10 })
export const CRAG_NOTCH = layout({ id: 'cragnotch', name: 'Crag Notch', icao: 'KCRG', kind: 'challenge', x: -14000, z: -44000, elevation: 1065, heading: 60, length: 900, width: 18, surface: 'asphalt', ils: [false, false], side: -1, apron: { width: 80, depth: 60 }, stands: 2 })

export const AIRPORTS: readonly AirportSpec[] = [HARROW_FIELD, MILLBROOK_STRIP, ASHBY_REGIONAL, FENWICK_FREIGHT, CORRAN_COUNTY, HALVARD_INTERNATIONAL, CRAG_NOTCH]

/** Runway ends a pilot may land on (Crag Notch is one-way: land on 06, depart on 24). */
export function landingEnds(airport: AirportSpec, runway: RunwaySpec): (0 | 1)[] {
  return airport.id === 'cragnotch' && runway === airport.runways[0] ? [0] : [0, 1]
}

/** The airport whose flattened area contains a point, or the nearest by reference point. */
export function nearestAirport(x: number, z: number): AirportSpec {
  let best = AIRPORTS[0]
  let bestDistance = Infinity
  for (const airport of AIRPORTS) {
    const dx = x - airport.x
    const dz = z - airport.z
    const distance = dx * dx + dz * dz
    if (distance < bestDistance) {
      bestDistance = distance
      best = airport
    }
  }
  return best
}

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

/** Distance of the aiming point (PAPI and touchdown-zone markings) past each threshold. */
export function aimDistance(runway: RunwaySpec): number {
  return runway.length >= 1500 ? 400 : 250
}

export interface RunwayEnd {
  /** Index into `runway.ends`. */
  end: 0 | 1
  name: string
  heading: number
  /** Threshold of this end and the unit vector along the runway in its landing direction. */
  x: number
  z: number
  dx: number
  dz: number
}

/** The runway end flown on a heading: the one whose landing direction is within 90° of `headingDeg`. */
export function runwayEndFor(runway: RunwaySpec, headingDeg: number, out: RunwayEnd = { end: 0, name: '', heading: 0, x: 0, z: 0, dx: 0, dz: 0 }): RunwayEnd {
  runwayFrame(runway, frame)
  let diff = (headingDeg - runway.heading) % 360
  if (diff < 0) diff += 360
  const low = diff <= 90 || diff >= 270
  out.end = low ? 0 : 1
  out.name = runway.ends[out.end]
  out.heading = low ? runway.heading : (runway.heading + 180) % 360
  out.dx = low ? frame.dx : -frame.dx
  out.dz = low ? frame.dz : -frame.dz
  out.x = low ? frame.x0 : frame.x0 + frame.dx * runway.length
  out.z = low ? frame.z0 : frame.z0 + frame.dz * runway.length
  return out
}
