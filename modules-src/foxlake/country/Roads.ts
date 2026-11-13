/**
 * Fox Lake's roads beyond the town grid (renderer-free, scene coordinates:
 * +x east, +z north). The Lake Road leaves the interstate at an at-grade
 * junction east of the lake and runs south-west across the flats to the
 * apron in front of Fox Outfitters' garage, so the town, the county road, the
 * interstate and the lake country's store are one connected network. The
 * interstate's rail and median open at the junction; its far south-east end,
 * where the hills close in, is barricaded. Barrier segments here are what the
 * cars collide with.
 */
import { HIGHWAY, highwayCoord, highwayGrade, type HighwayGap, type TerrainShape } from '../../rackreel/world/Terrain'

export interface PathPoint {
  x: number
  z: number
  w: number
}

/** Where the Lake Road meets the interstate (along it, from the bridge). */
export const LAKE_JUNCTION_T = -250
export const LAKE_ROAD_WIDTH = 8

/** Rail and median openings at the junction. */
export const HIGHWAY_GAPS: readonly HighwayGap[] = [
  { side: -1, t0: LAKE_JUNCTION_T - 9, t1: LAKE_JUNCTION_T + 9 },
  { side: 0, t0: LAKE_JUNCTION_T - 14, t1: LAKE_JUNCTION_T + 14 },
]

/** The barricade across the interstate before it runs into the hills. */
export const HIGHWAY_END_T = -425

export function highwayAt(t: number, across = 0): { x: number; z: number } {
  return { x: HIGHWAY.x + HIGHWAY.dx * t + HIGHWAY.dz * across, z: HIGHWAY.z + HIGHWAY.dz * t - HIGHWAY.dx * across }
}

const junction = highwayAt(LAKE_JUNCTION_T, -(HIGHWAY.halfWidth - 1))
const CONTROL: { x: number; z: number }[] = [
  highwayAt(LAKE_JUNCTION_T, -2),
  junction,
  { x: 305, z: -1 },
  { x: 263, z: -40 },
  { x: 216, z: -73 },
  { x: 176, z: -95 },
  { x: 151, z: -101 },
]

/** The turning apron in front of Fox Outfitters' garage, where the Lake Road ends. */
export const LAKE_ROAD_APRON = { x: 147, z: -102, r: 8 }

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

/** The Lake Road's centreline every `step` metres (starting just inside the interstate's edge). */
export function lakeRoadPath(step = 4): PathPoint[] {
  const pts = CONTROL.slice(1)
  const out: PathPoint[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z)
    const n = Math.max(2, Math.ceil(len / step))
    for (let k = 0; k < n; k++) {
      const t = k / n
      out.push({ x: catmull(p0.x, p1.x, p2.x, p3.x, t), z: catmull(p0.z, p1.z, p2.z, p3.z, t), w: LAKE_ROAD_WIDTH })
    }
  }
  const last = pts[pts.length - 1]
  out.push({ x: last.x, z: last.z, w: LAKE_ROAD_WIDTH })
  out[0].w = LAKE_ROAD_WIDTH + 6
  if (out[1]) out[1].w = LAKE_ROAD_WIDTH + 3
  return out
}

/** The polyline through the control points from the interstate's centre (for routing and the map). */
export function lakeRoadCentre(): { x: number; z: number }[] {
  return [CONTROL[0], ...lakeRoadPath(6).map((p) => ({ x: p.x, z: p.z }))]
}

// ---------------------------------------------------------------- road bed

interface Grade {
  pts: PathPoint[]
  y: Float32Array
}

let grade: Grade | null = null

/** The Lake Road's surface height along its path: the land smoothed over ±20 m, joining the interstate's grade. */
function roadGrade(raw: (x: number, z: number) => number): Grade {
  if (grade) return grade
  const pts = lakeRoadPath(4)
  const base = pts.map((p) => Math.max(1.2, raw(p.x, p.z)))
  const y = new Float32Array(pts.length)
  for (let i = 0; i < pts.length; i++) {
    let sum = 0
    let n = 0
    for (let k = -5; k <= 5; k++) {
      const j = Math.min(pts.length - 1, Math.max(0, i + k))
      sum += base[j]
      n++
    }
    y[i] = sum / n
  }
  const join = highwayGrade(highwayCoord(pts[0].x, pts[0].z).t) + 0.02
  for (let i = 0; i < Math.min(pts.length, 8); i++) {
    const f = i / 8
    y[i] = join * (1 - f) + y[i] * f
  }
  return (grade = { pts, y })
}

/** The nearest Lake Road sample to (x, z): its distance to the centreline, half width and surface height. */
export function nearestLakeRoad(x: number, z: number, raw: (x: number, z: number) => number): { d: number; half: number; y: number } {
  const g = roadGrade(raw)
  let best = Infinity
  let bi = 0
  for (let i = 0; i < g.pts.length; i++) {
    const d = (g.pts[i].x - x) ** 2 + (g.pts[i].z - z) ** 2
    if (d < best) {
      best = d
      bi = i
    }
  }
  return { d: Math.sqrt(best), half: g.pts[bi].w / 2, y: g.y[bi] }
}

/** The Lake Road's surface height under (x, z) (for its ribbon). */
export function lakeRoadHeight(x: number, z: number, raw: (x: number, z: number) => number): number {
  return nearestLakeRoad(x, z, raw).y
}

/** Carves the road bed into the lake country: level across the road, easing back to the land over 6 m. */
export function carveLakeRoad(x: number, z: number, h: number, raw: (x: number, z: number) => number): number {
  if (x < 120 || x > 345 || z < -125 || z > 40) return h
  const apron = Math.hypot(x - LAKE_ROAD_APRON.x, z - LAKE_ROAD_APRON.z)
  const r = nearestLakeRoad(x, z, raw)
  const edge = Math.min(r.d - r.half, apron - LAKE_ROAD_APRON.r)
  if (edge > 7) return h
  const w = 1 - Math.min(1, Math.max(0, (edge - 1) / 6))
  const k = w * w * (3 - 2 * w)
  const target = apron - LAKE_ROAD_APRON.r < r.d - r.half ? Math.max(h, r.y) - 0.04 : r.y - 0.04
  return h + (target - h) * k
}

// ---------------------------------------------------------------- barriers

export interface BarrierSegment {
  ax: number
  az: number
  bx: number
  bz: number
  /** Half thickness, and the barrier's bottom and top heights. */
  half: number
  y0: number
  y1: number
}

const SEG = 8

function inGap(side: -1 | 0 | 1, t0: number, t1: number): boolean {
  return HIGHWAY_GAPS.some((g) => g.side === side && t1 > g.t0 && t0 < g.t1)
}

function inSquare(p: { x: number; z: number }, lim: number): boolean {
  return Math.abs(p.x) < lim && Math.abs(p.z) < lim
}

/**
 * Every solid barrier on the interstate as straight pieces: the median jersey wall, the bridge's side walls and the
 * guardrails beyond them, less the openings at the Lake Road junction, plus the road-closed barricade.
 */
export function barrierSegments(shape: TerrainShape, surface: (x: number, z: number) => number): BarrierSegment[] {
  const out: BarrierSegment[] = []
  const hw = HIGHWAY.halfWidth
  const span = HIGHWAY.span / 2
  const add = (side: -1 | 0 | 1, across: number, t0: number, t1: number, half: number, top: number) => {
    for (let t = t0; t < t1 - 0.5; t += SEG) {
      const tb = Math.min(t1, t + SEG)
      if (inGap(side, t, tb)) continue
      if (t < HIGHWAY_END_T - 4) continue
      const a = highwayAt(t, across)
      const b = highwayAt(tb, across)
      if (!inSquare(a, 500) || !inSquare(b, 500)) continue
      const onSpan = Math.abs((t + tb) / 2) < span
      const ya = onSpan ? highwayGrade(t, shape) : surface(a.x, a.z)
      const yb = onSpan ? highwayGrade(tb, shape) : surface(b.x, b.z)
      out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, half, y0: Math.min(ya, yb) - 0.6, y1: Math.max(ya, yb) + top })
    }
  }
  add(0, 0, -HIGHWAY.reach, HIGHWAY.reach, 0.32, 0.85)
  for (const side of [-1, 1] as const) {
    add(side, side * (hw - 0.35), -span - 4, span + 4, 0.32, 0.85)
    add(side, side * (hw + 0.4), -HIGHWAY.reach, -span - 4, 0.12, 0.8)
    add(side, side * (hw + 0.4), span + 4, HIGHWAY.reach, 0.12, 0.8)
  }
  const a = highwayAt(HIGHWAY_END_T, -hw - 1)
  const b = highwayAt(HIGHWAY_END_T, hw + 1)
  const y = highwayGrade(HIGHWAY_END_T, shape)
  out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, half: 0.5, y0: y - 0.6, y1: y + 1.5 })
  return out
}

/** True when a circle of radius `r` at (x, z), standing on ground at height `y`, overlaps one of `segs`. */
export function hitsBarrier(segs: readonly BarrierSegment[], x: number, z: number, r: number, y: number): boolean {
  if (highwayCoord(x, z).across > HIGHWAY.halfWidth + 3 + r) return false
  for (const s of segs) {
    if (y > s.y1 || y + 1.6 < s.y0) continue
    const dx = s.bx - s.ax
    const dz = s.bz - s.az
    const len2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / len2))
    const px = s.ax + dx * t - x
    const pz = s.az + dz * t - z
    if (px * px + pz * pz < (r + s.half) ** 2) return true
  }
  return false
}

// ---------------------------------------------------------------- freight roads

/**
 * Short roads to the freight sites (shared/Freight.ts), scene coordinates: Freight Rd from the county road's bend into
 * the yard, Main St on east past Shoreline Dr into the sawmill, and Pine Ridge Rd off the Lake Road to the logging
 * landing. Every one meets another road, so the network stays connected.
 */
export const FREIGHT_ROADS: readonly { name: string; width: number; pts: { x: number; z: number }[] }[] = [
  { name: 'Freight Rd', width: 9, pts: [{ x: -299, z: 570 }, { x: -266, z: 570 }] },
  { name: 'Main St', width: 10, pts: [{ x: 194, z: 1152 }, { x: 236, z: 1152 }] },
  { name: 'Pine Ridge Rd', width: 7, pts: [{ x: 262, z: -42 }, { x: 284, z: -55 }, { x: 306, z: -74 }, { x: 330, z: -94 }] },
]

/** Freight yard, sawmill and landing grounds in scene coordinates (kept level and clear of trees and grass). */
export const FREIGHT_GROUNDS = {
  yard: { x0: -365, x1: -295, z0: 530, z1: 606 },
  mill: { x0: 219, x1: 260, z0: 1116, z1: 1188 },
  landing: { x: 334, z: -100, r: 26 },
} as const

/** A freight road's centreline every `step` metres, with its width. */
export function freightRoadPath(i: number, step = 3): PathPoint[] {
  const r = FREIGHT_ROADS[i]
  const out: PathPoint[] = []
  for (let k = 0; k < r.pts.length - 1; k++) {
    const a = r.pts[k], b = r.pts[k + 1]
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step))
    for (let j = 0; j < n; j++) out.push({ x: a.x + ((b.x - a.x) * j) / n, z: a.z + ((b.z - a.z) * j) / n, w: r.width })
  }
  const last = r.pts[r.pts.length - 1]
  out.push({ x: last.x, z: last.z, w: r.width })
  return out
}
