/**
 * The region's towns and the hub's city, laid out from a seed so the page, the simulation and the Worker agree on every building.
 * Each place is a rotated street grid around a centre: blocks are filled with houses toward the edge, shops along the main street,
 * offices and towers downtown in the city, and warehouses in the industrial district. Buildings stay off airport ground, water and
 * steep slopes, and below every runway's approach and departure surface (a 2.5° slope from the runway end, 150 m either side
 * widening by 15 %), so they never stand in a glidepath. `obstacleTop` answers "how tall is the building here" for the sim's
 * collision check, testing each rotated footprint found through a 64 m grid. Renderer-free and exact.
 */
import { AIRPORTS, runwayEndFor } from './Airports'
import { WATER_LEVEL, terrainHeight } from './Terrain'
import { DEG, SimRandom, cos, sin } from '../sim/SimMath'

export type PlaceKind = 'metro' | 'city' | 'town' | 'industrial' | 'village'
export type BuildingKind = 'house' | 'shop' | 'office' | 'tower' | 'skyscraper' | 'warehouse'

export interface PlaceSpec {
  id: string
  name: string
  kind: PlaceKind
  x: number
  z: number
  /** Radius of the built-up area, metres. */
  radius: number
  /** Street grid heading, degrees. */
  heading: number
  seed: number
}

export interface Building {
  kind: BuildingKind
  x: number
  z: number
  /** Footprint along and across the street heading, metres. */
  width: number
  depth: number
  height: number
  /** Heading of the footprint, degrees. */
  yaw: number
  /** Ground height under the footprint's lowest corner (the building's foot). */
  base: number
  /** 0..1 colour pick for the renderer. */
  shade: number
}

export interface Street {
  ax: number
  az: number
  bx: number
  bz: number
  width: number
  main: boolean
}

export interface Place {
  spec: PlaceSpec
  buildings: Building[]
  streets: Street[]
}

export const PLACES: readonly PlaceSpec[] = [
  { id: 'halvard-city', name: 'Halvard', kind: 'city', x: 64300, z: 51200, radius: 2600, heading: 120, seed: 9101 },
  { id: 'ashby-town', name: 'Ashby', kind: 'town', x: 40250, z: 14170, radius: 1300, heading: 150, seed: 9202 },
  { id: 'corran-town', name: 'Corran', kind: 'town', x: -53300, z: -1400, radius: 1500, heading: 140, seed: 9303 },
  { id: 'fenwick-works', name: 'Fenwick Works', kind: 'industrial', x: -27900, z: 40600, radius: 1200, heading: 40, seed: 9404 },
  { id: 'harrow-village', name: 'Harrow', kind: 'village', x: -1500, z: -2400, radius: 700, heading: 90, seed: 9505 },
  { id: 'millbrook-village', name: 'Millbrook', kind: 'village', x: 14800, z: -8300, radius: 500, heading: 140, seed: 9606 },
  { id: 'calder-metro', name: 'Calder', kind: 'metro', x: 0, z: 50000, radius: 3400, heading: 25, seed: 9707 },
  { id: 'bramwell-town', name: 'Bramwell', kind: 'town', x: 30000, z: -10000, radius: 1100, heading: 70, seed: 9808 },
  { id: 'ketterby-town', name: 'Ketterby', kind: 'town', x: -70000, z: 40000, radius: 1200, heading: 15, seed: 9909 },
  { id: 'wyndham-town', name: 'Wyndham', kind: 'town', x: 30000, z: 30000, radius: 1100, heading: 160, seed: 10010 },
  { id: 'ottery-village', name: 'Ottery', kind: 'village', x: -40000, z: -10000, radius: 600, heading: 35, seed: 10111 },
  { id: 'tarn-hollow-village', name: 'Tarn Hollow', kind: 'village', x: -20000, z: -10000, radius: 550, heading: 100, seed: 10212 },
  { id: 'hollin-cross-village', name: 'Hollin Cross', kind: 'village', x: -20000, z: 20000, radius: 600, heading: 60, seed: 10313 },
  { id: 'sedge-end-village', name: 'Sedge End', kind: 'village', x: 70000, z: 20000, radius: 600, heading: 130, seed: 10414 },
  { id: 'rookham-village', name: 'Rookham', kind: 'village', x: 80000, z: 0, radius: 600, heading: 10, seed: 10515 },
  { id: 'larkfield-village', name: 'Larkfield', kind: 'village', x: 40000, z: 70000, radius: 650, heading: 80, seed: 10616 },
  { id: 'dunmere-village', name: 'Dunmere', kind: 'village', x: 20000, z: 80000, radius: 600, heading: 45, seed: 10717 },
  { id: 'elmstead-village', name: 'Elmstead', kind: 'village', x: -60000, z: 70000, radius: 600, heading: 120, seed: 10818 },
  { id: 'pellow-village', name: 'Pellow', kind: 'village', x: -90000, z: 0, radius: 600, heading: 20, seed: 10919 },
  { id: 'ashcombe-village', name: 'Ashcombe', kind: 'village', x: -30000, z: 60000, radius: 600, heading: 170, seed: 11020 },
]

const BLOCK = 110
const STREET = 12
const MAIN_STREET = 18
const APPROACH_SLOPE = sin(2.5 * DEG) / cos(2.5 * DEG)
const APPROACH_REACH = 9000

/** Highest a building may stand at (x, z): below every runway's approach and departure surfaces, or Infinity when clear of them. */
export function heightLimit(x: number, z: number): number {
  let limit = Infinity
  for (const airport of AIRPORTS) {
    const ax = x - airport.x
    const az = z - airport.z
    if (ax * ax + az * az > (APPROACH_REACH + 4000) * (APPROACH_REACH + 4000)) continue
    for (const runway of airport.runways) {
      for (const end of [0, 1] as const) {
        const e = runwayEndFor(runway, end === 0 ? runway.heading : runway.heading + 180)
        const out = -((x - e.x) * e.dx + (z - e.z) * e.dz)
        if (out < -runway.length - 60 || out > APPROACH_REACH) continue
        const cross = Math.abs((x - e.x) * -e.dz + (z - e.z) * e.dx)
        const d = out < 0 ? 0 : out
        if (cross > 150 + d * 0.15) continue
        const top = airport.elevation + d * APPROACH_SLOPE - 8
        if (top < limit) limit = top
      }
    }
  }
  return limit
}

function onAirport(x: number, z: number, margin: number): boolean {
  for (const airport of AIRPORTS) {
    if (Math.abs(x - airport.x) < airport.halfX + margin && Math.abs(z - airport.z) < airport.halfZ + margin) return true
  }
  return false
}

function slope(x: number, z: number): number {
  const s = 12
  const dx = terrainHeight(x + s, z) - terrainHeight(x - s, z)
  const dz = terrainHeight(x, z + s) - terrainHeight(x, z - s)
  return Math.sqrt(dx * dx + dz * dz) / (2 * s)
}

function pick(kind: PlaceKind, centre: number, onMain: boolean, random: SimRandom): { kind: BuildingKind; w: number; d: number; h: number } | null {
  const r = random.next()
  if (kind === 'industrial') return { kind: 'warehouse', w: 40 + r * 50, d: 30 + random.next() * 35, h: 9 + random.next() * 9 }
  if (kind === 'metro' && centre < 0.3) return { kind: 'skyscraper', w: 30 + r * 16, d: 30 + random.next() * 14, h: 150 + (1 - centre / 0.3) * 240 * (0.45 + random.next() * 0.55) }
  if (kind === 'metro' && centre < 0.5) return { kind: 'tower', w: 26 + r * 18, d: 26 + random.next() * 16, h: 60 + (1 - (centre - 0.3) / 0.2) * 80 * (0.4 + random.next() * 0.6) }
  if (kind === 'metro' && centre < 0.68) return { kind: 'office', w: 24 + r * 20, d: 20 + random.next() * 18, h: 18 + random.next() * 34 }
  if (kind === 'city' && centre < 0.28) return { kind: 'tower', w: 26 + r * 18, d: 26 + random.next() * 16, h: 60 + (1 - centre / 0.28) * 140 * (0.5 + random.next() * 0.5) }
  if (kind === 'city' && centre < 0.55) return { kind: 'office', w: 24 + r * 20, d: 20 + random.next() * 18, h: 18 + random.next() * 34 }
  if (onMain && centre < 0.7) return { kind: 'shop', w: 14 + r * 10, d: 14 + random.next() * 8, h: 7 + random.next() * 6 }
  if (random.next() < (kind === 'village' ? 0.45 : 0.25)) return null
  return { kind: 'house', w: 9 + r * 5, d: 8 + random.next() * 4, h: 5.5 + random.next() * 2.5 }
}

/** Builds a place's streets and buildings. Pure: the same spec always gives the same place. */
export function buildPlace(spec: PlaceSpec): Place {
  const random = new SimRandom(spec.seed)
  const h = spec.heading * DEG
  const ux = sin(h)
  const uz = -cos(h)
  const vx = -uz
  const vz = ux
  const streets: Street[] = []
  const buildings: Building[] = []
  const cells = Math.ceil(spec.radius / BLOCK)
  const span = cells * BLOCK
  for (let i = -cells; i <= cells; i++) {
    const main = i === 0
    const width = main ? MAIN_STREET : STREET
    const along = i * BLOCK
    streets.push({ ax: spec.x + vx * along - ux * span, az: spec.z + vz * along - uz * span, bx: spec.x + vx * along + ux * span, bz: spec.z + vz * along + uz * span, width, main })
    streets.push({ ax: spec.x + ux * along - vx * span, az: spec.z + uz * along - vz * span, bx: spec.x + ux * along + vx * span, bz: spec.z + uz * along + vz * span, width: STREET, main: false })
  }
  for (let i = -cells; i < cells; i++) {
    for (let j = -cells; j < cells; j++) {
      const blockU = (i + 0.5) * BLOCK
      const blockV = (j + 0.5) * BLOCK
      const bx = spec.x + ux * blockU + vx * blockV
      const bz = spec.z + uz * blockU + vz * blockV
      const dist = Math.sqrt(blockU * blockU + blockV * blockV)
      const centre = dist / spec.radius
      if (centre > 1) continue
      const edge = centre > 0.75 ? (centre - 0.75) / 0.25 : 0
      if (random.next() < edge * 0.8) continue
      const onMain = j === -1 || j === 0
      const slots = (spec.kind === 'city' && centre < 0.55) || (spec.kind === 'metro' && centre < 0.68) ? 1 : spec.kind === 'industrial' ? 2 : 4
      for (let s = 0; s < slots; s++) {
        const choice = pick(spec.kind, centre, onMain, random)
        if (!choice) continue
        const inner = BLOCK - STREET - 8
        const su = slots === 1 ? 0 : slots === 2 ? (s - 0.5) * inner * 0.5 : ((s % 2) - 0.5) * inner * 0.5
        const sv = slots === 4 ? (Math.floor(s / 2) - 0.5) * inner * 0.5 : 0
        const cap = slots === 1 ? inner : inner * 0.48
        const w = Math.min(choice.w, cap)
        const d = Math.min(choice.d, cap)
        const x = bx + ux * su + vx * sv
        const z = bz + uz * su + vz * sv
        if (onAirport(x, z, 120)) continue
        const ground = terrainHeight(x, z)
        if (ground < WATER_LEVEL + 2 || slope(x, z) > 0.22) continue
        const corners = [terrainHeight(x + ux * w * 0.5 + vx * d * 0.5, z + uz * w * 0.5 + vz * d * 0.5), terrainHeight(x - ux * w * 0.5 + vx * d * 0.5, z - uz * w * 0.5 + vz * d * 0.5), terrainHeight(x + ux * w * 0.5 - vx * d * 0.5, z + uz * w * 0.5 - vz * d * 0.5), terrainHeight(x - ux * w * 0.5 - vx * d * 0.5, z - uz * w * 0.5 - vz * d * 0.5)]
        let base = ground
        for (const c of corners) if (c < base) base = c
        let height = choice.h
        const limit = heightLimit(x, z)
        if (base + height > limit) height = limit - base
        if (height < 4) continue
        buildings.push({ kind: choice.kind, x, z, width: w, depth: d, height, yaw: spec.heading, base: base - 0.4, shade: random.next() })
      }
    }
  }
  return { spec, buildings, streets }
}

const CELL = 64
const grid = new Map<number, Building[]>()
let built = false
const places: Place[] = []

function key(ix: number, iz: number): number {
  return (ix + 32768) * 65536 + (iz + 32768)
}

function ensureGrid(): void {
  if (built) return
  built = true
  for (const spec of PLACES) {
    const place = buildPlace(spec)
    places.push(place)
    for (const b of place.buildings) {
      const r = Math.sqrt(b.width * b.width + b.depth * b.depth) * 0.5
      for (let ix = Math.floor((b.x - r) / CELL); ix <= Math.floor((b.x + r) / CELL); ix++) {
        for (let iz = Math.floor((b.z - r) / CELL); iz <= Math.floor((b.z + r) / CELL); iz++) {
          const k = key(ix, iz)
          const list = grid.get(k)
          if (list) list.push(b)
          else grid.set(k, [b])
        }
      }
    }
  }
}

/** Every place, built once. */
export function allPlaces(): readonly Place[] {
  ensureGrid()
  return places
}

/** The top of the building whose footprint contains (x, z), or -Infinity where none stands. */
export function obstacleTop(x: number, z: number): number {
  ensureGrid()
  const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)))
  if (!list) return -Infinity
  let top = -Infinity
  for (const b of list) {
    const h = b.yaw * DEG
    const ux = sin(h)
    const uz = -cos(h)
    const rx = x - b.x
    const rz = z - b.z
    const along = rx * ux + rz * uz
    const across = rx * -uz + rz * ux
    if (Math.abs(along) <= b.width * 0.5 && Math.abs(across) <= b.depth * 0.5 && b.base + b.height > top) top = b.base + b.height
  }
  return top
}

/** 0..1 how built-up a point is (the renderer thins trees and fields there). */
export function townWeight(x: number, z: number): number {
  let best = 0
  for (const spec of PLACES) {
    const dx = x - spec.x
    const dz = z - spec.z
    const d = Math.sqrt(dx * dx + dz * dz) / spec.radius
    const w = d < 0.9 ? 1 : d < 1.15 ? (1.15 - d) / 0.25 : 0
    if (w > best) best = w
  }
  return best
}
