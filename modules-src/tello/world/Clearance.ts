/**
 * Where pavement and buildings collide, worked out once per land at load (renderer-free, so tests share it):
 *
 * - `blockedBuildings`: buildings a street, highway or lane runs through. The open data puts a few footprints on the
 *   carriageway (a trailer across a park street, a house under a widened downtown street, sheds on alleys); they are
 *   left out everywhere a building is drawn or made solid, so no building stands in a road. Places (shops, the fuel
 *   stations, the school) keep theirs, and a driveway that ends at its garage never blocks the garage.
 * - `Pavement`: every drivable ribbon as segments in a grid, so sidewalks and paths stop at the curb instead of being
 *   laid across a street, and `insideBuilding` so pavement stops at a wall.
 */
import type { BuildingData, RoadData } from '../data/MapData'
import { isMainLeg, townProfiles } from '../data/Streets'
import type { TelloLand } from '../region'
import { pointInRing } from './Poly'
import { stationsOf } from './Stations'

const GRID = 32
/** A footprint is in the road only when the carriageway reaches this far inside it (metres). */
const BLOCK_DEPTH = 0.6
/** Lanes this close to a dead end are driveways reaching their garage. */
const DRIVEWAY_END = 9
/** Footprints bigger than this are kept even with a lane through them (drive-throughs, canopies, big sheds). */
const KEEP_AREA = 900
/** Only these give way to a lane; stores and civic buildings keep their footprint and the lane stops at the wall. */
const SMALL_KINDS = new Set<string>(['house', 'shed', 'garage'])

interface Seg { ax: number; az: number; bx: number; bz: number; ha: number; hb: number; k: number }

/** Drivable ribbons (highways, streets and lanes) for "is this point on a road" checks. */
export class Pavement {
  private readonly cells = new Map<number, Seg[]>()

  add(seg: Seg): void {
    const pad = Math.max(seg.ha, seg.hb) + 1
    const gx0 = Math.floor((Math.min(seg.ax, seg.bx) - pad) / GRID), gx1 = Math.floor((Math.max(seg.ax, seg.bx) + pad) / GRID)
    const gz0 = Math.floor((Math.min(seg.az, seg.bz) - pad) / GRID), gz1 = Math.floor((Math.max(seg.az, seg.bz) + pad) / GRID)
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const key = gx * 65536 + gz
        let list = this.cells.get(key)
        if (!list) this.cells.set(key, (list = []))
        list.push(seg)
      }
    }
  }

  /** How far inside the nearest drivable ribbon (map x, z) lies: positive on the road, negative off it. */
  inside(x: number, z: number, maxKind = 2): number {
    const list = this.cells.get(Math.floor(x / GRID) * 65536 + Math.floor(z / GRID))
    let best = -Infinity
    if (!list) return best
    for (const s of list) {
      if (s.k > maxKind) continue
      const dx = s.bx - s.ax, dz = s.bz - s.az
      const len2 = dx * dx + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / len2))
      const d = Math.hypot(x - s.ax - dx * t, z - s.az - dz * t)
      const half = s.ha + (s.hb - s.ha) * t
      best = Math.max(best, half - d)
    }
    return best
  }
}

interface Footprints { cells: Map<number, number[]>; boxes: { x0: number; z0: number; x1: number; z1: number }[] }

function footprints(buildings: readonly BuildingData[]): Footprints {
  const cells = new Map<number, number[]>()
  const boxes = buildings.map((b, i) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let k = 0; k < b.p.length; k += 2) {
      x0 = Math.min(x0, b.p[k]); x1 = Math.max(x1, b.p[k])
      z0 = Math.min(z0, b.p[k + 1]); z1 = Math.max(z1, b.p[k + 1])
    }
    if (b.k !== 'canopy' && !b.x && b.p.length >= 6) {
      for (let gx = Math.floor(x0 / GRID); gx <= Math.floor(x1 / GRID); gx++) {
        for (let gz = Math.floor(z0 / GRID); gz <= Math.floor(z1 / GRID); gz++) {
          const key = gx * 65536 + gz
          let list = cells.get(key)
          if (!list) cells.set(key, (list = []))
          list.push(i)
        }
      }
    }
    return { x0, z0, x1, z1 }
  })
  return { cells, boxes }
}

/** Depth of a point inside a ring (distance to its nearest edge), or -1 outside. */
function depthIn(ring: ArrayLike<number>, x: number, z: number): number {
  if (!pointInRing(ring, x, z)) return -1
  let d = Infinity
  const n = ring.length / 2
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n
    const ax = ring[k * 2], az = ring[k * 2 + 1], dx = ring[j * 2] - ax, dz = ring[j * 2 + 1] - az
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
    d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t))
  }
  return d
}

function area(ring: ArrayLike<number>): number {
  let a = 0
  const n = ring.length / 2
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n
    a += ring[k * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[k * 2 + 1]
  }
  return Math.abs(a / 2)
}

interface Clearance { blocked: Set<number>; gone: WeakSet<BuildingData>; pavement: Pavement; fp: Footprints; lots: { p: number[]; x0: number; z0: number; x1: number; z1: number }[] }

const cache = new WeakMap<object, Clearance>()

function endKey(x: number, z: number): string {
  return `${Math.round(x * 2)},${Math.round(z * 2)}`
}

function clearanceOf(land: TelloLand): Clearance {
  const hit = cache.get(land.doc)
  if (hit) return hit
  const doc = land.doc
  const profiles = townProfiles(doc)
  const pavement = new Pavement()
  const fp = footprints(doc.buildings)
  const kept = new Set<number>()
  for (const poi of doc.pois as { i?: number }[]) if (poi.i !== undefined) kept.add(poi.i)
  const ends = new Map<string, number>()
  for (const r of doc.roads) {
    if (r.k > 3) continue
    for (const k of [0, r.p.length - 2]) ends.set(endKey(r.p[k], r.p[k + 1]), (ends.get(endKey(r.p[k], r.p[k + 1])) ?? 0) + 1)
  }
  const blocked = new Set<number>()
  doc.buildings.forEach((b, i) => {
    if (b.x) blocked.add(i)
  })
  for (const road of doc.roads) {
    if (road.k > 2 || road.p.length < 4) continue
    const prof = profiles.get(road)
    const st = stationsOf(road, prof, !!prof || isMainLeg(road))
    const half = (i: number) => (prof ? prof.half[i] : road.w / 2)
    for (let i = 0; i + 1 < st.length; i++) pavement.add({ ax: st[i].x, az: st[i].z, bx: st[i + 1].x, bz: st[i + 1].z, ha: half(i), hb: half(i + 1), k: road.k })
    const deadStart = road.k === 2 && (ends.get(endKey(road.p[0], road.p[1])) ?? 0) <= 1
    const deadEnd = road.k === 2 && (ends.get(endKey(road.p[road.p.length - 2], road.p[road.p.length - 1])) ?? 0) <= 1
    const total = st.length ? st[st.length - 1].along : 0
    for (let i = 0; i < st.length; i++) {
      const s = st[i]
      if ((deadStart && s.along < DRIVEWAY_END) || (deadEnd && total - s.along < DRIVEWAY_END)) continue
      const h = Math.max(0, half(i) - 0.4)
      for (const side of [-1, -0.5, 0, 0.5, 1]) {
        const x = s.x + s.sx * side * h, z = s.z + s.sz * side * h
        const list = fp.cells.get(Math.floor(x / GRID) * 65536 + Math.floor(z / GRID))
        if (!list) continue
        for (const b of list) {
          if (blocked.has(b) || kept.has(b)) continue
          const box = fp.boxes[b]
          if (x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1) continue
          const bd = doc.buildings[b]
          if (road.k === 2 && (bd.n || !SMALL_KINDS.has(bd.k))) continue
          if (road.k === 2 && area(bd.p) > KEEP_AREA) continue
          if (depthIn(bd.p, x, z) > BLOCK_DEPTH) blocked.add(b)
        }
      }
    }
  }
  const gone = new WeakSet<BuildingData>()
  for (const b of blocked) gone.add(doc.buildings[b])
  const lots = doc.lots.map((l) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let k = 0; k < l.p.length; k += 2) {
      x0 = Math.min(x0, l.p[k]); x1 = Math.max(x1, l.p[k])
      z0 = Math.min(z0, l.p[k + 1]); z1 = Math.max(z1, l.p[k + 1])
    }
    return { p: l.p, x0, z0, x1, z1 }
  })
  const out = { blocked, gone, pavement, fp, lots }
  cache.set(land.doc, out)
  return out
}

/** Building indexes a street, highway or lane runs through: not drawn, not solid. */
export function blockedBuildings(land: TelloLand): ReadonlySet<number> {
  return clearanceOf(land).blocked
}

/** True for a building a road runs through (by object, for loops over the buildings). */
export function isBlocked(land: TelloLand, b: BuildingData): boolean {
  return clearanceOf(land).gone.has(b)
}

/** The drivable pavement index. */
export function pavementOf(land: TelloLand): Pavement {
  return clearanceOf(land).pavement
}

/** True on a paved lot (parking lots and fuel forecourts). */
export function onLot(land: TelloLand, x: number, z: number): boolean {
  for (const l of clearanceOf(land).lots) if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1 && pointInRing(l.p, x, z)) return true
  return false
}

/** How far inside a standing building's footprint a map point is (negative outside). */
export function insideBuilding(land: TelloLand, x: number, z: number): number {
  const c = clearanceOf(land)
  const list = c.fp.cells.get(Math.floor(x / GRID) * 65536 + Math.floor(z / GRID))
  if (!list) return -1
  let best = -1
  for (const b of list) {
    if (c.blocked.has(b)) continue
    const box = c.fp.boxes[b]
    if (x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1) continue
    best = Math.max(best, depthIn(land.doc.buildings[b].p, x, z))
  }
  return best
}

export type { RoadData }
