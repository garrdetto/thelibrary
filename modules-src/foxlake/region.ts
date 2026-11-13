/**
 * Where the two halves of Fox Lake sit. The scene uses Rack & Reel's own
 * coordinates (its lake country is the 1024 m square around the origin, +x
 * east, +z north, left-handed like every Babylon scene). The Fox Plains town
 * keeps its shared-world coordinates, which are right-handed: the town hangs
 * under a node that moves it north of the country and mirrors z, so it reads
 * exactly as classic Fox Plains players see it and the numbers the shared
 * world sends never change.
 *
 *   scene.x = town.x + TOWN_OFFSET.x
 *   scene.y = town.y + TOWN_OFFSET.y
 *   scene.z = TOWN_OFFSET.z - town.z
 *
 * East Ave (town x = 87) runs south out of town into the lake country's
 * interstate, which leaves the square's open north edge at about x = -261.
 */
import { HALF, HIGHWAY, PLAY_LIMIT, fbm, rawHeight } from '../rackreel/world/Terrain'
import type { OutsideLand, TerrainShape } from '../rackreel/world/Terrain'
import { MAP_BOUNDS, WORLD_HALF } from '../maplestreet/shared/WorldLayout'
import { FREIGHT_GROUNDS, FREIGHT_ROADS, HIGHWAY_GAPS, LAKE_ROAD_APRON, carveLakeRoad, freightRoadPath, lakeRoadPath } from './country/Roads'
import { ROADSIDE, lotRect } from './roadside/RoadsideLayout'

/** Ground level of the town in the scene (above the lake, level with the interstate's north end). */
export const TOWN_Y = 2
export const TOWN_OFFSET = { x: -356, y: TOWN_Y, z: HALF + WORLD_HALF } as const

export interface XYZ {
  x: number
  y: number
  z: number
}

export function townToScene(x: number, y: number, z: number, out: XYZ = { x: 0, y: 0, z: 0 }): XYZ {
  out.x = x + TOWN_OFFSET.x
  out.y = y + TOWN_OFFSET.y
  out.z = TOWN_OFFSET.z - z
  return out
}

export function sceneToTown(x: number, y: number, z: number, out: XYZ = { x: 0, y: 0, z: 0 }): XYZ {
  out.x = x - TOWN_OFFSET.x
  out.y = y - TOWN_OFFSET.y
  out.z = TOWN_OFFSET.z - z
  return out
}

/** A heading (Rack & Reel: forward is (sin h, cos h) in the scene) from a town yaw (forward is (sin y, cos y) in the town), and back. */
export function townYawToHeading(yaw: number): number {
  return wrapAngle(Math.PI - yaw)
}

export function headingToTownYaw(heading: number): number {
  return wrapAngle(Math.PI - heading)
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/** The town's square in scene coordinates. */
export const TOWN_SQUARE = {
  x0: -WORLD_HALF + TOWN_OFFSET.x,
  x1: WORLD_HALF + TOWN_OFFSET.x,
  z0: TOWN_OFFSET.z - WORLD_HALF,
  z1: TOWN_OFFSET.z + WORLD_HALF,
} as const

/** How far in from the town square's outer edges the player may go (the forest ring stops them there). */
export const TOWN_MARGIN = 24

export function inTownSquare(x: number, z: number, margin = 0): boolean {
  const zNear = TOWN_SQUARE.z0 - (margin > 0 ? 0 : 1)
  return x >= TOWN_SQUARE.x0 + TOWN_MARGIN + margin && x <= TOWN_SQUARE.x1 - TOWN_MARGIN - margin && z >= zNear && z <= TOWN_SQUARE.z1 - TOWN_MARGIN - margin
}

/** The country road's centreline, from the interstate's north end to East Ave: a curve, then straight north. */
export const CONNECTOR = (() => {
  const t0 = (HALF - 8 - HIGHWAY.z) / HIGHWAY.dz
  const start = { x: HIGHWAY.x + HIGHWAY.dx * t0, z: HIGHWAY.z + HIGHWAY.dz * t0 }
  const eastAve = townToScene(87, 0, 0).x
  const bend = { x: eastAve, z: HALF + 70 }
  const end = { x: eastAve, z: townToScene(0, 0, 267).z }
  return { t0, start, bend, end, dir: { x: HIGHWAY.dx, z: HIGHWAY.dz }, width: 10, startWidth: HIGHWAY.halfWidth * 2 }
})()

/** Points along the connector, every `step` metres, with the road's width there. */
export function connectorPath(step = 4): { x: number; z: number; w: number }[] {
  const { start, bend, end, dir, width, startWidth } = CONNECTOR
  const out: { x: number; z: number; w: number }[] = []
  const reach = Math.hypot(bend.x - start.x, bend.z - start.z) * 0.5
  const c1 = { x: start.x + dir.x * reach, z: start.z + dir.z * reach }
  const c2 = { x: bend.x, z: bend.z - reach }
  const curveLen = reach * 2.4
  const n = Math.max(4, Math.ceil(curveLen / step))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    const x = u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * bend.x
    const z = u * u * u * start.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * bend.z
    out.push({ x, z, w: startWidth + (width - startWidth) * smooth(t) })
  }
  for (let z = bend.z + step; z <= end.z; z += step) out.push({ x: end.x, z, w: width })
  return out
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Distance from (x, z) to the connector's centreline (sampled; fine for placement and bounds). */
export function connectorDistance(x: number, z: number): number {
  let best = Infinity
  for (const p of connectorSamples()) best = Math.min(best, Math.hypot(p.x - x, p.z - z) - p.w / 2)
  return best
}

let samples: { x: number; z: number; w: number }[] | null = null
function connectorSamples(): { x: number; z: number; w: number }[] {
  return (samples ??= connectorPath(3))
}

/** The built-up town (lots, streets, downtown) in scene coordinates, where the ground stays flat. */
export const BUILT_UP = {
  x0: MAP_BOUNDS.x0 + TOWN_OFFSET.x - 6,
  x1: MAP_BOUNDS.x1 + TOWN_OFFSET.x + 6,
  z0: TOWN_OFFSET.z - MAP_BOUNDS.z1 - 6,
  z1: TOWN_OFFSET.z - MAP_BOUNDS.z0 + 6,
} as const

function rectDistance(x: number, z: number, r: { x0: number; x1: number; z0: number; z1: number }): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1)
  const dz = Math.max(r.z0 - z, 0, z - r.z1)
  if (dx > 0 || dz > 0) return Math.hypot(dx, dz)
  return -Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z)
}

// ---------------------------------------------------------------- roads and lots: a distance field

const FIELD = { x0: -380, z0: -150, x1: 360, z1: 1200, cell: 2 } as const
const FIELD_W = Math.ceil((FIELD.x1 - FIELD.x0) / FIELD.cell) + 1
const FIELD_H = Math.ceil((FIELD.z1 - FIELD.z0) / FIELD.cell) + 1
let field: Float32Array | null = null

function stamp(f: Float32Array, cx: number, cz: number, reach: number, dist: (x: number, z: number) => number): void {
  const i0 = Math.max(0, Math.floor((cx - reach - FIELD.x0) / FIELD.cell))
  const i1 = Math.min(FIELD_W - 1, Math.ceil((cx + reach - FIELD.x0) / FIELD.cell))
  const j0 = Math.max(0, Math.floor((cz - reach - FIELD.z0) / FIELD.cell))
  const j1 = Math.min(FIELD_H - 1, Math.ceil((cz + reach - FIELD.z0) / FIELD.cell))
  for (let j = j0; j <= j1; j++) {
    const z = FIELD.z0 + j * FIELD.cell
    for (let i = i0; i <= i1; i++) {
      const d = dist(FIELD.x0 + i * FIELD.cell, z)
      const k = j * FIELD_W + i
      if (d < f[k]) f[k] = d
    }
  }
}

/** Metres to the edge of the county road, the Lake Road (and its apron) or a roadside lot; ~Infinity far from them. */
function buildField(): Float32Array {
  const f = new Float32Array(FIELD_W * FIELD_H).fill(1e6)
  const REACH = 14
  for (const p of [...lakeRoadPath(2), ...connectorPath(2)]) stamp(f, p.x, p.z, p.w / 2 + REACH, (x, z) => Math.hypot(x - p.x, z - p.z) - p.w / 2)
  const a = LAKE_ROAD_APRON
  stamp(f, a.x, a.z, a.r + REACH, (x, z) => Math.hypot(x - a.x, z - a.z) - a.r)
  for (let i = 0; i < FREIGHT_ROADS.length; i++) for (const p of freightRoadPath(i, 2)) stamp(f, p.x, p.z, p.w / 2 + REACH, (x, z) => Math.hypot(x - p.x, z - p.z) - p.w / 2)
  for (const r of [FREIGHT_GROUNDS.yard, FREIGHT_GROUNDS.mill]) stamp(f, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, Math.max(r.x1 - r.x0, r.z1 - r.z0) / 2 + REACH, (x, z) => rectDistance(x, z, r))
  const L = FREIGHT_GROUNDS.landing
  stamp(f, L.x, L.z, L.r + REACH, (x, z) => Math.hypot(x - L.x, z - L.z) - L.r)
  for (const place of ROADSIDE) {
    const r = lotRect(place)
    const c = townToScene(r.cx, 0, r.cz)
    const rect = { x0: c.x - r.sx / 2, x1: c.x + r.sx / 2, z0: c.z - r.sz / 2, z1: c.z + r.sz / 2 }
    stamp(f, c.x, c.z, Math.max(r.sx, r.sz) / 2 + REACH, (x, z) => rectDistance(x, z, rect))
  }
  return f
}

/** Metres from (x, z) to the nearest county road, Lake Road or roadside lot edge (negative on them). */
export function roadClear(x: number, z: number): number {
  if (x < FIELD.x0 || x > FIELD.x1 || z < FIELD.z0 || z > FIELD.z1) return 1e6
  const f = (field ??= buildField())
  const u = (x - FIELD.x0) / FIELD.cell
  const v = (z - FIELD.z0) / FIELD.cell
  const i = Math.min(FIELD_W - 2, Math.floor(u))
  const j = Math.min(FIELD_H - 2, Math.floor(v))
  const fu = u - i
  const fv = v - j
  const k = j * FIELD_W + i
  const a = f[k] + (f[k + 1] - f[k]) * fu
  const b = f[k + FIELD_W] + (f[k + FIELD_W + 1] - f[k + FIELD_W]) * fu
  return a + (b - a) * fv
}

// ---------------------------------------------------------------- the land around town

/** Gentle wooded hills around Fox Plains: flat in town, on the roads and lots, rising over 70 m away from them. */
export function outsideHeight(x: number, z: number): number {
  const town = rectDistance(x, z, BUILT_UP)
  if (town < 12) return TOWN_Y
  const road = roadClear(x, z)
  const flat = Math.min(town - 12, road - 10)
  if (flat <= 0) return TOWN_Y
  const amp = smooth(Math.min(1, flat / 75))
  const hills = (fbm(x * 0.0065 + 5.3, z * 0.0065 - 2.1, 3, 91) * 0.5 + 0.5) * 7 + fbm(x * 0.028, z * 0.028, 2, 92) * 0.7
  return TOWN_Y + Math.max(0, hills) * amp
}

/** The town and its forest ring, as land beyond the lake country's square. */
export const TOWN_LAND: OutsideLand = {
  contains(x, z, margin) {
    if (inTownSquare(x, z, margin)) return true
    return z > HALF - 2 && z < TOWN_SQUARE.z0 + 2 && Math.abs(x) < PLAY_LIMIT - margin
  },
  heightAt(x, z) {
    return outsideHeight(x, z)
  },
  grassAt(x, z) {
    return rectDistance(x, z, BUILT_UP) > 4 && roadClear(x, z) > 0.8
  },
}

const rawFox = (x: number, z: number) => rawHeight(x, z, FOX_LAKE_SHAPE)

/** Rack & Reel's map with its north edge open onto the town, the Lake Road carved in and the interstate opened for it. */
export const FOX_LAKE_SHAPE: TerrainShape = {
  rim: { north: false, south: true, east: true, west: true },
  outsideHeight: TOWN_Y,
  outside: TOWN_LAND,
  outsideHeightAt: outsideHeight,
  roadClear,
  carve: (x, z, h) => carveLakeRoad(x, z, h, rawFox),
  highwayGaps: HIGHWAY_GAPS,
}

/** Which part of Fox Lake a scene point is in. */
export function zoneAt(z: number): 'town' | 'country' {
  return z > HALF ? 'town' : 'country'
}
