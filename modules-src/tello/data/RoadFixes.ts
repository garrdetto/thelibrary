/**
 * Corrections to the baked road network, made at load (renderer-free, so the tests read what the page does):
 *
 * - corners in a single OpenStreetMap way are rounded into smooth arcs, so a ribbon never folds on itself at a sharp
 *   bend and its lines run in curves (`roundCorners`);
 * - every street and highway is bent away from the buildings its full width and a sidewalk would run into, smoothly,
 *   the way a real road is laid round a house on the corner (`bendAroundBuildings`);
 * - the pavement field is brought in line with the roads that moved (`repaveMoved`);
 * - the stretches where a road runs right beside deep water or a steep drop, where a guardrail stands (`guardrailRuns`).
 *
 * Roads at their junction nodes, on bridges and downtown (`FROZEN`) stay where the map has them.
 */
import type { BuildingData, MapDoc, MapGrids, RoadData } from './MapData'
import { resample } from '../world/Poly'

/** Downtown, where `Streets.ts` and the storefronts own the street lines, with a margin. */
export const FROZEN = { x0: -57, x1: 312, z0: -147, z1: 57 }
/** Highways ease their corners over a longer arc than streets. */
const CORNER_RADIUS = { 0: 45, 1: 16 }
/** A rounded corner never cuts more than this far in from its vertex. */
const CORNER_CUT = 5
/** Room kept between a road's edge and a wall: a sidewalk and a curb. */
export const BUILDING_MARGIN = 1.6
/** The most a road is bent from where the map has it. */
const MAX_BEND = 8
/** Distance over which a bend fades out toward a junction. */
const JUNCTION_EASE = 8
const SPACING = 2

const key = (x: number, z: number) => `${Math.round(x * 2)},${Math.round(z * 2)}`

export const isFrozen = (x: number, z: number) => x >= FROZEN.x0 && x <= FROZEN.x1 && z >= FROZEN.z0 && z <= FROZEN.z1

/** Roads that get smoothing and bending: streets and highways. */
export const isStreetClass = (r: RoadData) => r.k <= 1

function endpointKeys(doc: MapDoc): Set<string> {
  const out = new Set<string>()
  for (const r of doc.roads) {
    if (r.k > 3) continue
    out.add(key(r.p[0], r.p[1]))
    out.add(key(r.p[r.p.length - 2], r.p[r.p.length - 1]))
  }
  return out
}

function nearBridge(doc: MapDoc, x: number, z: number): boolean {
  for (const b of doc.bridges) {
    for (let k = 0; k < b.p.length; k += 2) if (Math.hypot(b.p[k] - x, b.p[k + 1] - z) < b.w + 10) return true
  }
  return false
}

/** Rounds the corners of a polyline into quadratic arcs; vertices `pinned` returns true for stay where they are. */
export function roundCorners(p: number[], radius: number, pinned: (x: number, z: number, i: number) => boolean): number[] {
  const n = p.length / 2
  if (n < 3) return p.slice()
  const out = [p[0], p[1]]
  for (let i = 1; i < n - 1; i++) {
    const bx = p[i * 2], bz = p[i * 2 + 1]
    const ax = p[i * 2 - 2], az = p[i * 2 - 1], cx = p[i * 2 + 2], cz = p[i * 2 + 3]
    const lu = Math.hypot(ax - bx, az - bz), lw = Math.hypot(cx - bx, cz - bz)
    if (lu < 0.5 || lw < 0.5 || pinned(bx, bz, i)) {
      out.push(bx, bz)
      continue
    }
    const ux = (ax - bx) / lu, uz = (az - bz) / lu, wx = (cx - bx) / lw, wz = (cz - bz) / lw
    const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, ux * wx + uz * wz)))
    if (turn < 0.12 || turn > 2.6) {
      out.push(bx, bz)
      continue
    }
    const tan = Math.tan(turn / 2)
    let t = Math.min(radius * tan, lu * 0.48, lw * 0.48)
    const cut = 0.25 * t * Math.hypot(ux + wx, uz + wz)
    if (cut > CORNER_CUT) t *= CORNER_CUT / cut
    const ex = bx + ux * t, ez = bz + uz * t, fx = bx + wx * t, fz = bz + wz * t
    const steps = Math.max(2, Math.ceil(t / 2.5))
    for (let s = 0; s <= steps; s++) {
      const q = s / steps, a = (1 - q) * (1 - q), m = 2 * q * (1 - q), c = q * q
      out.push(a * ex + m * bx + c * fx, a * ez + m * bz + c * fz)
    }
  }
  out.push(p[p.length - 2], p[p.length - 1])
  return out
}

interface Edge { ax: number; az: number; bx: number; bz: number }

const GRID = 32

export class WallIndex {
  private readonly cells = new Map<string, Edge[]>()
  private readonly polys: { p: number[]; x0: number; z0: number; x1: number; z1: number }[] = []
  private readonly polyCells = new Map<string, number[]>()

  constructor(buildings: readonly BuildingData[]) {
    for (const b of buildings) {
      if (b.k === 'canopy') continue
      const p = b.p
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
      for (let k = 0; k < p.length; k += 2) {
        x0 = Math.min(x0, p[k])
        x1 = Math.max(x1, p[k])
        z0 = Math.min(z0, p[k + 1])
        z1 = Math.max(z1, p[k + 1])
      }
      const id = this.polys.push({ p, x0, z0, x1, z1 }) - 1
      for (let gx = Math.floor(x0 / GRID); gx <= Math.floor(x1 / GRID); gx++) {
        for (let gz = Math.floor(z0 / GRID); gz <= Math.floor(z1 / GRID); gz++) {
          const cell = `${gx},${gz}`
          let ids = this.polyCells.get(cell)
          if (!ids) this.polyCells.set(cell, (ids = []))
          ids.push(id)
        }
      }
      const n = p.length / 2
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n
        const e: Edge = { ax: p[k * 2], az: p[k * 2 + 1], bx: p[j * 2], bz: p[j * 2 + 1] }
        const gx0 = Math.floor(Math.min(e.ax, e.bx) / GRID), gx1 = Math.floor(Math.max(e.ax, e.bx) / GRID)
        const gz0 = Math.floor(Math.min(e.az, e.bz) / GRID), gz1 = Math.floor(Math.max(e.az, e.bz) / GRID)
        for (let gx = gx0; gx <= gx1; gx++) {
          for (let gz = gz0; gz <= gz1; gz++) {
            const id = `${gx},${gz}`
            let list = this.cells.get(id)
            if (!list) this.cells.set(id, (list = []))
            list.push(e)
          }
        }
      }
    }
  }

  /** The nearest wall point within `reach` of (x, z), and whether (x, z) is inside a building. */
  nearest(x: number, z: number, reach: number): { d: number; x: number; z: number; inside: boolean } | null {
    let best: { d: number; x: number; z: number; inside: boolean } | null = null
    const g0 = Math.floor((x - reach) / GRID), g1 = Math.floor((x + reach) / GRID)
    const h0 = Math.floor((z - reach) / GRID), h1 = Math.floor((z + reach) / GRID)
    for (let gx = g0; gx <= g1; gx++) {
      for (let gz = h0; gz <= h1; gz++) {
        const list = this.cells.get(`${gx},${gz}`)
        if (!list) continue
        for (const e of list) {
          const dx = e.bx - e.ax, dz = e.bz - e.az
          const t = Math.max(0, Math.min(1, ((x - e.ax) * dx + (z - e.az) * dz) / (dx * dx + dz * dz || 1)))
          const px = e.ax + dx * t, pz = e.az + dz * t
          const d = Math.hypot(x - px, z - pz)
          if (d < reach && (!best || d < best.d)) best = { d, x: px, z: pz, inside: false }
        }
      }
    }
    for (const id of this.polyCells.get(`${Math.floor(x / GRID)},${Math.floor(z / GRID)}`) ?? []) {
      const poly = this.polys[id]
      if (x < poly.x0 || x > poly.x1 || z < poly.z0 || z > poly.z1) continue
      if (inRing(poly.p, x, z)) return { d: best ? best.d : 0, x: best ? best.x : x, z: best ? best.z : z, inside: true }
    }
    return best
  }
}

function inRing(p: ArrayLike<number>, x: number, z: number): boolean {
  let inside = false
  const n = p.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** The distance from a building's wall to the nearest point of the road's centre line, negative where it runs through it. */
export function wallGap(walls: WallIndex, p: ArrayLike<number>): number {
  let worst = Infinity
  const pts = resample(p, SPACING)
  for (let k = 0; k < pts.length; k += 2) {
    const hit = walls.nearest(pts[k], pts[k + 1], 40)
    if (!hit) continue
    worst = Math.min(worst, hit.inside ? -hit.d : hit.d)
  }
  return worst
}

function gaussian(values: number[][], sigma: number): number[][] {
  const radius = Math.ceil(sigma * 3)
  const kernel: number[] = []
  let sum = 0
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma))
    kernel.push(w)
    sum += w
  }
  const n = values.length
  return values.map((_v, i) => {
    let x = 0, z = 0
    for (let k = -radius; k <= radius; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k))
      const w = kernel[k + radius] / sum
      x += values[j][0] * w
      z += values[j][1] * w
    }
    return [x, z]
  })
}

export interface BendReport { smoothed: number; bent: number; moved: { road: RoadData; before: number[] }[] }

/** Rounds corners and bends streets away from walls (see the file's header); returns what changed. */
export function fixRoadLines(doc: MapDoc): BendReport {
  const report: BendReport = { smoothed: 0, bent: 0, moved: [] }
  const ends = endpointKeys(doc)
  const walls = new WallIndex(doc.buildings)
  const junctionPoints: number[] = []
  for (const r of doc.roads) {
    if (r.k > 3) continue
    junctionPoints.push(r.p[0], r.p[1], r.p[r.p.length - 2], r.p[r.p.length - 1])
  }
  for (const road of doc.roads) {
    if (!isStreetClass(road) || road.p.length < 4) continue
    const before = road.p.slice()
    const pinned = (x: number, z: number) => ends.has(key(x, z)) || isFrozen(x, z) || nearBridge(doc, x, z)
    let pts = roundCorners(road.p, CORNER_RADIUS[road.k as 0 | 1], pinned)
    if (pts.length !== road.p.length) report.smoothed++
    const bent = bendRoad(road, pts, walls, doc, junctionPoints)
    if (bent) {
      pts = bent
      report.bent++
    }
    if (pts !== road.p && (pts.length !== before.length || pts.some((v, i) => Math.abs(v - before[i]) > 0.01))) {
      road.p = pts.map((v) => Math.round(v * 100) / 100)
      report.moved.push({ road, before })
    }
  }
  return report
}

/** The road's points bent clear of walls, or null when it already clears them. */
function bendRoad(road: RoadData, source: number[], walls: WallIndex, doc: MapDoc, junctionPoints: number[]): number[] | null {
  const need = road.w / 2 + BUILDING_MARGIN
  const dense = resample(source, SPACING)
  const n = dense.length / 2
  if (n < 4) return null
  const pos = Array.from({ length: n }, (_v, i) => [dense[i * 2], dense[i * 2 + 1]])
  const crowded = pos.some(([x, z]) => {
    const hit = walls.nearest(x, z, need)
    return !!hit && (hit.inside || hit.d < need)
  })
  if (!crowded) return null
  const weight = pos.map(([x, z], i) => {
    if (isFrozen(x, z) || nearBridge(doc, x, z)) return 0
    let w = Math.min(1, Math.min(i, n - 1 - i) * SPACING / JUNCTION_EASE)
    for (let k = 0; k < junctionPoints.length; k += 2) {
      const d = Math.hypot(junctionPoints[k] - x, junctionPoints[k + 1] - z)
      if (d < JUNCTION_EASE && d > 0.01 && onLine(source, junctionPoints[k], junctionPoints[k + 1])) w = Math.min(w, d / JUNCTION_EASE)
      else if (d <= 0.01) w = 0
    }
    return w
  })
  const origin = pos.map((p) => [p[0], p[1]])
  let touched = false
  for (let pass = 0; pass < 18; pass++) {
    const push = pos.map(() => [0, 0])
    let any = false
    for (let i = 0; i < n; i++) {
      if (weight[i] <= 0) continue
      const hit = walls.nearest(pos[i][0], pos[i][1], need + 0.5)
      if (!hit) continue
      const gap = hit.inside ? -hit.d : hit.d
      if (gap >= need) continue
      let vx = pos[i][0] - hit.x, vz = pos[i][1] - hit.z
      const len = Math.hypot(vx, vz)
      if (len < 1e-4) continue
      if (hit.inside) {
        vx = -vx
        vz = -vz
      }
      push[i] = [(vx / len) * (need - gap), (vz / len) * (need - gap)]
      any = true
    }
    if (!any) break
    touched = true
    const spread = gaussian(push, 2.2)
    let top = 0, peak = 0
    for (let i = 0; i < n; i++) {
      top = Math.max(top, Math.hypot(push[i][0], push[i][1]))
      peak = Math.max(peak, Math.hypot(spread[i][0], spread[i][1]))
    }
    const gain = Math.min(2.5, top / Math.max(peak, 1e-6))
    for (let i = 0; i < n; i++) {
      const dx = spread[i][0] * gain * weight[i] * 0.9, dz = spread[i][1] * gain * weight[i] * 0.9
      const nx = pos[i][0] + dx - origin[i][0], nz = pos[i][1] + dz - origin[i][1]
      const total = Math.hypot(nx, nz)
      const scale = total > MAX_BEND ? MAX_BEND / total : 1
      pos[i] = [origin[i][0] + nx * scale, origin[i][1] + nz * scale]
    }
  }
  if (!touched) return null
  return pos.flatMap(([x, z]) => [x, z])
}

function onLine(p: ArrayLike<number>, x: number, z: number): boolean {
  for (let k = 0; k + 3 < p.length; k += 2) {
    const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
    if (Math.hypot(x - ax - dx * t, z - az - dz * t) < 1) return true
  }
  return false
}

class LineIndex {
  private readonly cells = new Map<string, number[]>()

  constructor(private readonly p: ArrayLike<number>) {
    for (let k = 0; k + 3 < p.length; k += 2) {
      const gx0 = Math.floor(Math.min(p[k], p[k + 2]) / 16), gx1 = Math.floor(Math.max(p[k], p[k + 2]) / 16)
      const gz0 = Math.floor(Math.min(p[k + 1], p[k + 3]) / 16), gz1 = Math.floor(Math.max(p[k + 1], p[k + 3]) / 16)
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          const id = `${gx},${gz}`
          let list = this.cells.get(id)
          if (!list) this.cells.set(id, (list = []))
          list.push(k)
        }
      }
    }
  }

  /** Distance to the line, exact up to 16 m and 16 beyond. */
  distance(x: number, z: number): number {
    let best = 16
    const gx = Math.floor(x / 16), gz = Math.floor(z / 16)
    for (let a = gx - 1; a <= gx + 1; a++) {
      for (let b = gz - 1; b <= gz + 1; b++) {
        for (const k of this.cells.get(`${a},${b}`) ?? []) {
          const p = this.p
          const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
          best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t))
        }
      }
    }
    return best
  }
}

/** Brings the 2 m pavement field in line with roads that moved: the old bed is released, the new one marked. */
export function repaveMoved(doc: MapDoc, grids: MapGrids, moved: BendReport['moved']): void {
  const f = doc.frame
  const n = grids.fineSide
  const step = f.fine
  for (const { road, before } of moved) {
    const half = road.w / 2
    const reach = half + 3
    const oldDense = resample(before, 4)
    const newDense = resample(road.p, 4)
    const oldIndex = new LineIndex(oldDense), newIndex = new LineIndex(newDense)
    const changed = (line: number[], other: LineIndex) => {
      const out: number[][] = []
      for (let k = 0; k + 3 < line.length; k += 2) {
        const mx = (line[k] + line[k + 2]) / 2, mz = (line[k + 1] + line[k + 3]) / 2
        if (other.distance(mx, mz) > 0.2 || other.distance(line[k], line[k + 1]) > 0.2) out.push([line[k], line[k + 1], line[k + 2], line[k + 3]])
      }
      return out
    }
    const touched = new Map<number, number>()
    const sweep = (segs: number[][]) => {
      for (const [ax, az, bx, bz] of segs) {
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - f.x0) / step)), i1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + reach - f.x0) / step))
        const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - f.z0) / step)), j1 = Math.min(n - 1, Math.ceil((Math.max(az, bz) + reach - f.z0) / step))
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) touched.set(j * n + i, 1)
      }
    }
    sweep(changed(oldDense, newIndex))
    sweep(changed(newDense, oldIndex))
    for (const k of touched.keys()) {
      const i = k % n, j = (k - i) / n
      const x = f.x0 + i * step, z = f.z0 + j * step
      const dOld = oldIndex.distance(x, z)
      const dNew = newIndex.distance(x, z)
      const was = Math.round((dOld - half) * 4)
      if (Math.abs(grids.clear[k] - was) <= 2 && dNew > dOld) grids.clear[k] = Math.max(grids.clear[k], Math.min(127, Math.round((dNew - half) * 4)))
      if (dNew - half < 4) grids.clear[k] = Math.min(grids.clear[k], Math.max(-127, Math.round((dNew - half) * 4)))
    }
  }
}

// ---------------------------------------------------------------- guardrails

/** What `guardrailRuns` needs of the land. */
export interface RailLand {
  groundAt(x: number, z: number): number
  depthAt(x: number, z: number): number
  deckAt(x: number, z: number): number | null
}

/** One run of guardrail: the line it stands on (flat x, z pairs, 3 m apart) and the road it guards. */
export interface RailRun { road: number; side: -1 | 1; pts: number[] }

/** How far past the road's edge the rail stands. */
export const RAIL_SETBACK = 0.9
const RAIL_STEP = 3
/** Water at least this deep with a bank this steep, or any drop at least `RAIL_DROP`, within `RAIL_LOOK` of the edge calls for a rail. */
const RAIL_DEPTH = 0.3
const RAIL_WATER_DROP = 0.9
const RAIL_DROP = 2.2
const RAIL_LOOK = 4.5
const RAIL_WATER_LOOK = 8
const RAIL_MIN = 15

/** The stretches of road with deep water or a steep drop right beside them. Streets and highways, not downtown and not bridges. */
export function guardrailRuns(doc: MapDoc, land: RailLand): RailRun[] {
  const out: RailRun[] = []
  const ends: number[] = []
  for (const r of doc.roads) {
    if (r.k > 3) continue
    ends.push(r.p[0], r.p[1], r.p[r.p.length - 2], r.p[r.p.length - 1])
  }
  doc.roads.forEach((road, index) => {
    if (road.k > 1) return
    const pts = resample(road.p, RAIL_STEP)
    const n = pts.length / 2
    const half = road.w / 2
    for (const side of [-1, 1] as const) {
      const flag: boolean[] = []
      const line: number[] = []
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1)
        const dx = pts[c * 2] - pts[a * 2], dz = pts[c * 2 + 1] - pts[a * 2 + 1]
        const len = Math.hypot(dx, dz) || 1
        const nx = (-dz / len) * side, nz = (dx / len) * side
        const x = pts[i * 2], z = pts[i * 2 + 1]
        line.push(x + nx * (half + RAIL_SETBACK), z + nz * (half + RAIL_SETBACK))
        let bad = false
        if (!isFrozen(x, z) && land.deckAt(x, z) === null) {
          const road0 = land.groundAt(x, z)
          for (let d = half + 1.2; d <= half + RAIL_WATER_LOOK && !bad; d += 1.2) {
            const px = x + nx * d, pz = z + nz * d
            const drop = road0 - land.groundAt(px, pz)
            if ((land.depthAt(px, pz) >= RAIL_DEPTH && drop >= RAIL_WATER_DROP) || (drop >= RAIL_DROP && d <= half + RAIL_LOOK)) bad = true
          }
          if (bad && land.deckAt(x + nx * (half + 1), z + nz * (half + 1)) !== null) bad = false
        }
        if (bad) {
          for (let k = 0; k < ends.length; k += 2) {
            const ex = ends[k] - x, ez = ends[k + 1] - z
            if (Math.hypot(ex, ez) < half + 7 && ex * nx + ez * nz > half * 0.5) {
              bad = false
              break
            }
          }
        }
        flag.push(bad)
      }
      for (let i = 1; i < n - 1; i++) if (!flag[i] && flag[i - 1] && flag[i + 1]) flag[i] = true
      let i = 0
      while (i < n) {
        if (!flag[i]) {
          i++
          continue
        }
        let j = i
        while (j + 1 < n && flag[j + 1]) j++
        if ((j - i) * RAIL_STEP >= RAIL_MIN) {
          const from = Math.max(0, i - 1), to = Math.min(n - 1, j + 1)
          out.push({ road: index, side, pts: line.slice(from * 2, to * 2 + 2) })
        }
        i = j + 1
      }
    }
  })
  return out
}
