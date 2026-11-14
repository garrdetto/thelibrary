/**
 * Downtown Montello's streets as they really are, corrected at load on top of the baked map (renderer-free, so the
 * tests and the Worker-free page read the same thing):
 *
 * - West Montello, East Montello and Main Street are one lane each way with a parking lane along both curbs. Each
 *   street keeps that full width wherever the buildings leave room for a sidewalk, and narrows to the baked width
 *   where they don't (`streetProfiles`).
 * - Main Street's north end: OpenStreetMap draws two Main Streets that overlap for 20 m. It is one street up to a
 *   narrow grass island, then one lane each side of the island to the light at State Highway 23 (`fixMainSplit`).
 * - The West Montello Street bridge carries the street level over the Montello River (the bare-earth lidar dips where
 *   the deck was, and the river under it was filled in): the deck is set level with the street, widened over both
 *   sidewalks, the approaches are filled to it and the channel is dug out under it (`fixBridge`).
 */
import type { BridgeData, BuildingData, MapDoc, MapGrids, RoadData } from './MapData'
import { BUILDING_HEIGHTS, EXTRA_BUILDINGS } from './Downtown'
import { pointInRing, resample } from '../world/Poly'

/** Lane and parking lane, metres: one lane each way plus a parking lane along each curb. */
export const LANE = 3.5
export const PARKING = 2.6
export const STREET_HALF = LANE + PARKING
/** A street narrower than this has no room to park. */
export const PARKING_MIN_HALF = 5.6
/** Sidewalk kept between the curb and a building's wall. */
const SIDEWALK_MIN = 2.1
/** Stations of a street profile, metres apart. */
export const PROFILE_STEP = 2

/** Where downtown streets get the full town cross-section. */
const CORE = { x0: -45, x1: 300, z0: -135, z1: 45 }
const TOWN_STREETS = ['West Montello Street', 'East Montello Street', 'Main Street', 'State Highway 23']

/** Main Street's north end after the fix: the shared street up to the island's nose, and the lane each side of it. */
export const MAIN_SPLIT = { x: 116.4, z: -20.5 }
const MERGED = [122, -41.1, 120.6, -33.5, 118.3, -26.5, MAIN_SPLIT.x, MAIN_SPLIT.z]
const WEST_LEG = [MAIN_SPLIT.x, MAIN_SPLIT.z, 113.2, -14.5, 111.2, -10.5, 109.7, -7.9, 108, 2.5, 105.6, 11, 102.9, 20.4]
const EAST_LEG = [MAIN_SPLIT.x, MAIN_SPLIT.z, 118.9, -15.2, 119.5, -11.5, 119.3, 0.7, 119.1, 8.3, 119, 14, 118.8, 21.9]
/** The island's north edge, along the highway's south curb. */
export const ISLAND_NORTH = 14.7
/** Each leg: one lane and a little shoulder. */
export const LEG_WIDTH = 6.6

/** The grass island between the legs, as a ring (map x, z). */
export function mainIsland(): number[] {
  const west = offsetLine(WEST_LEG, -LEG_WIDTH / 2 - 0.15)
  const east = offsetLine(EAST_LEG, LEG_WIDTH / 2 + 0.15)
  const ring: number[] = []
  const north = ISLAND_NORTH
  // Up the west leg's right curb, across the highway's curb, and back down the east leg's left curb.
  const keep = (p: number[]) => {
    const out: number[] = []
    for (let k = 0; k < p.length; k += 2) if (p[k + 1] < north) out.push(p[k], p[k + 1])
    return out
  }
  const w = keep(west)
  const e = keep(east)
  ring.push(...w, w[w.length - 2], north, e[e.length - 2], north)
  for (let k = e.length - 2; k >= 0; k -= 2) ring.push(e[k], e[k + 1])
  return trimNose(ring)
}

/** Drops the ring's points where the two curbs cross near the nose, so the island starts at a point. */
function trimNose(ring: number[]): number[] {
  const n = ring.length / 2
  const out: number[] = []
  for (let k = 0; k < n; k++) {
    const x = ring[k * 2], z = ring[k * 2 + 1]
    if (z < MAIN_SPLIT.z + 9.5) continue
    out.push(x, z)
  }
  // A rounded nose between the two curbs' first kept points.
  const nose = { x: (out[0] + out[out.length - 2]) / 2, z: MAIN_SPLIT.z + 8.4 }
  return [nose.x, nose.z, ...out]
}

/** A polyline moved `d` metres to its left (positive) or right, with x east and z north. */
export function offsetLine(p: ArrayLike<number>, d: number): number[] {
  const n = p.length / 2
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1)
    const dx = p[c * 2] - p[a * 2], dz = p[c * 2 + 1] - p[a * 2 + 1]
    const len = Math.hypot(dx, dz) || 1
    out.push(p[i * 2] - (dz / len) * d, p[i * 2 + 1] + (dx / len) * d)
  }
  return out
}

/** True for a road that gets the downtown cross-section (somewhere along it). */
export function isTownStreet(r: RoadData): boolean {
  if (!TOWN_STREETS.includes(r.n) || r.k > 1) return false
  for (let k = 0; k < r.p.length; k += 2) if (inCore(r.p[k], r.p[k + 1])) return true
  return false
}

function inCore(x: number, z: number): boolean {
  return x >= CORE.x0 && x <= CORE.x1 && z >= CORE.z0 && z <= CORE.z1
}

/** True for one of the one-lane legs around Main Street's island. */
export function isMainLeg(r: RoadData): boolean {
  return r.n === 'Main Street' && r.w === LEG_WIDTH
}

function reversePairs(p: number[]): number[] {
  const out: number[] = []
  for (let k = p.length - 2; k >= 0; k -= 2) out.push(p[k], p[k + 1])
  return out
}

const near = (x: number, z: number, x1: number, z1: number, d = 0.6) => Math.abs(x - x1) < d && Math.abs(z - z1) < d

/** Rewrites the two overlapping Main Streets at the north end as one street and two legs around the island. */
export function fixMainSplit(doc: MapDoc): boolean {
  const roads = doc.roads
  const south = roads.find((r) => r.n === 'Main Street' && near(r.p[r.p.length - 2], r.p[r.p.length - 1], 122, -41.1) && r.p[1] < -100)
  const westAt = roads.findIndex((r) => r.n === 'Main Street' && near(r.p[0], r.p[1], 102.9, 20.4) && near(r.p[r.p.length - 2], r.p[r.p.length - 1], 122, -41.1))
  const eastAt = roads.findIndex((r) => r.n === 'Main Street' && near(r.p[0], r.p[1], 122, -41.1) && near(r.p[r.p.length - 2], r.p[r.p.length - 1], 118.8, 21.9))
  if (!south || westAt < 0 || eastAt < 0) return false
  south.p = [...south.p.slice(0, -2), ...MERGED]
  // The west leg keeps its baked direction (from the highway south); the east leg runs north to it.
  roads[westAt].w = LEG_WIDTH
  roads[westAt].p = reversePairs(WEST_LEG)
  roads[eastAt].w = LEG_WIDTH
  roads[eastAt].p = [...EAST_LEG]
  return true
}

// ---------------------------------------------------------------- the West Montello Street bridge

/** The Montello River's course under the bridge, south to north (map x, z), and the channel's half widths. */
const CHANNEL = [79.4, 1.5, 77.7, 14.8, 72.6, 28.5]
const CHANNEL_BED = 4.9
const CHANNEL_HALF = 3.9
const CHANNEL_WALL = 1.2
const CHANNEL_WET = 7.5
/** Deck width over the street and both sidewalks, and how far it reaches past the baked ends. */
const BRIDGE_WIDTH = 16.6
const BRIDGE_REACH = 3
/** The street's own level either side of the river, sampled this far out along it. */
const APPROACH = 12

/** Levels the West Montello Street bridge with the street and digs out the river under it. */
export function fixBridge(doc: MapDoc, grids: MapGrids): BridgeData | null {
  const f = doc.frame
  const side = grids.side
  const bridge = doc.bridges.find((b) => b.k <= 1 && doc.roads[b.r]?.n === 'West Montello Street')
  if (!bridge) return null
  const p = bridge.p
  const ax = p[0], az = p[1], bx = p[p.length - 2], bz = p[p.length - 1]
  const len = Math.hypot(bx - ax, bz - az) || 1
  const ux = (bx - ax) / len, uz = (bz - az) / len
  const node = (x: number, z: number) => {
    const i = Math.round((x - f.x0) / f.cell), j = Math.round((z - f.z0) / f.cell)
    return j * side + i
  }
  const level = (x: number, z: number) => grids.ground[node(x, z)] / 100
  const yA = level(ax - ux * APPROACH, az - uz * APPROACH)
  const yB = level(bx + ux * APPROACH, bz + uz * APPROACH)
  const chord = (t: number) => yA + ((yB - yA) * (t + APPROACH)) / (len + APPROACH * 2)
  bridge.y = Math.round(((chord(0) + chord(len)) / 2) * 100) / 100
  bridge.w = BRIDGE_WIDTH
  bridge.s = 1
  bridge.p = [ax - ux * BRIDGE_REACH, az - uz * BRIDGE_REACH, bx + ux * BRIDGE_REACH, bz + uz * BRIDGE_REACH]
  // The sidewalks' own little bridges beside it are now part of the one deck.
  const cx = (ax + bx) / 2, cz = (az + bz) / 2
  doc.bridges = doc.bridges.filter((b) => b === bridge || b.k <= 3 || Math.hypot(b.p[0] - cx, b.p[1] - cz) > 16)
  const water = riverLevel(grids, f, CHANNEL)
  for (let j = 0; j < side; j++) {
    const z = f.z0 + j * f.cell
    if (z < CHANNEL[1] - 12 || z > CHANNEL[5] + 12) continue
    for (let i = 0; i < side; i++) {
      const x = f.x0 + i * f.cell
      if (x < cx - 30 || x > cx + 30) continue
      const k = j * side + i
      const along = (x - ax) * ux + (z - az) * uz
      const across = Math.abs(-(x - ax) * uz + (z - az) * ux)
      const d = distToLine(CHANNEL, x, z)
      const g = grids.ground[k] / 100
      if (d <= CHANNEL_WET && grids.water[k] === 0 && z > CHANNEL[1] && z < CHANNEL[5]) grids.water[k] = Math.round(water * 100)
      if (d <= CHANNEL_HALF + CHANNEL_WALL && z > CHANNEL[1] - 2 && z < CHANNEL[5] + 2) {
        // The bed, walled up to the abutments.
        const bed = CHANNEL_BED + Math.max(0, d - CHANNEL_HALF) * 3
        if (bed < g) grids.ground[k] = Math.round(bed * 100)
        continue
      }
      // The approaches: filled up to the line between the street's level either side of the river.
      if (across < 10 && along > -APPROACH - 2 && along < len + APPROACH + 2) {
        const target = chord(Math.min(len + APPROACH, Math.max(-APPROACH, along))) - 0.04 - Math.max(0, across - 7) * 0.3
        if (target > g) grids.ground[k] = Math.round(target * 100)
      }
    }
  }
  return bridge
}

/** The river's surface next to the channel (the highest wet node within reach of its ends). */
function riverLevel(grids: MapGrids, f: MapDoc['frame'], line: number[]): number {
  let best = 0
  for (const [x, z] of [[line[0], line[1] - 6], [line[line.length - 2], line[line.length - 1] + 4]]) {
    for (let dz = -8; dz <= 8; dz += f.cell) {
      for (let dx = -8; dx <= 8; dx += f.cell) {
        const i = Math.round((x + dx - f.x0) / f.cell), j = Math.round((z + dz - f.z0) / f.cell)
        const k = j * grids.side + i
        if (grids.water[k] > grids.ground[k]) best = Math.max(best, grids.water[k] / 100)
      }
    }
  }
  return best || 5.64
}

export function distToLine(p: ArrayLike<number>, x: number, z: number): number {
  let best = Infinity
  for (let k = 0; k + 3 < p.length; k += 2) {
    const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)))
  }
  return best
}

// ---------------------------------------------------------------- street profiles

export interface StreetProfile {
  /** Stations `PROFILE_STEP` apart along the road (flat x, z). */
  pts: number[]
  /** Half width at each station. */
  half: Float32Array
  /** True where there's room to park. */
  parking: Uint8Array
}

/** The cross-section of every downtown street: full town width where the buildings leave room, the baked width elsewhere. */
export function streetProfiles(doc: MapDoc): Map<RoadData, StreetProfile> {
  const out = new Map<RoadData, StreetProfile>()
  const walls = buildingEdges(doc)
  for (const road of doc.roads) {
    if (!isTownStreet(road) || isMainLeg(road)) continue
    const pts = resample(road.p, PROFILE_STEP)
    const n = pts.length / 2
    const raw = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2], z = pts[i * 2 + 1]
      if (!inCore(x, z)) {
        raw[i] = road.w / 2
        continue
      }
      const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1)
      const dx = pts[c * 2] - pts[a * 2], dz = pts[c * 2 + 1] - pts[a * 2 + 1]
      const len = Math.hypot(dx, dz) || 1
      const sx = -dz / len, sz = dx / len
      const room = Math.min(rayToWalls(walls, x, z, sx, sz), rayToWalls(walls, x, z, -sx, -sz))
      raw[i] = Math.min(STREET_HALF, Math.max(road.w / 2, room - SIDEWALK_MIN))
    }
    // Narrow for a whole building's length, then ease back out over a few metres.
    const win = 3
    const low = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      let m = Infinity
      for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k++) m = Math.min(m, raw[k])
      low[i] = m
    }
    const half = new Float32Array(n)
    const parking = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0
      for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k++) {
        s += low[k]
        c++
      }
      half[i] = s / c
      parking[i] = half[i] >= PARKING_MIN_HALF ? 1 : 0
    }
    out.set(road, { pts, half, parking })
  }
  return out
}

/** Half width of `road` at the station nearest (x, z) (the baked half width for roads without a profile). */
export function halfAt(profiles: Map<RoadData, StreetProfile>, road: RoadData, x: number, z: number): number {
  const prof = profiles.get(road)
  if (!prof) return road.w / 2
  let best = Infinity, at = 0
  for (let i = 0; i < prof.half.length; i++) {
    const d = (prof.pts[i * 2] - x) ** 2 + (prof.pts[i * 2 + 1] - z) ** 2
    if (d < best) {
      best = d
      at = i
    }
  }
  return prof.half[at]
}

interface Edge { ax: number; az: number; bx: number; bz: number }

function buildingEdges(doc: MapDoc): Edge[] {
  const out: Edge[] = []
  for (const b of doc.buildings) {
    const p = b.p
    let inside = false
    for (let k = 0; k < p.length; k += 2) if (inCore(p[k], p[k + 1])) inside = true
    if (!inside || b.k === 'canopy') continue
    const n = p.length / 2
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n
      out.push({ ax: p[k * 2], az: p[k * 2 + 1], bx: p[j * 2], bz: p[j * 2 + 1] })
    }
  }
  return out
}

/** Distance from (x, z) along (dx, dz) to the first wall, up to 14 m. */
function rayToWalls(walls: Edge[], x: number, z: number, dx: number, dz: number): number {
  let best = 14
  for (const e of walls) {
    if (Math.min(e.ax, e.bx) > x + 15 || Math.max(e.ax, e.bx) < x - 15 || Math.min(e.az, e.bz) > z + 15 || Math.max(e.az, e.bz) < z - 15) continue
    const ex = e.bx - e.ax, ez = e.bz - e.az
    const den = dx * ez - dz * ex
    if (Math.abs(den) < 1e-9) continue
    const t = ((e.ax - x) * ez - (e.az - z) * ex) / den
    const u = ((e.ax - x) * dz - (e.az - z) * dx) / den
    if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t)
  }
  return best
}

/** Marks the widened streets as pavement in the 2 m pavement field, so the ground tucks under them and no grass grows there. */
export function paveProfiles(doc: MapDoc, grids: MapGrids, profiles: Map<RoadData, StreetProfile>): void {
  const f = doc.frame
  const n = grids.fineSide
  const step = f.fine
  for (const prof of profiles.values()) {
    const m = prof.half.length
    for (let s = 0; s < m; s++) {
      const x = prof.pts[s * 2], z = prof.pts[s * 2 + 1]
      const h = prof.half[s]
      const r = Math.ceil((h + 1) / step)
      const ci = Math.round((x - f.x0) / step), cj = Math.round((z - f.z0) / step)
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || j < 0 || i >= n || j >= n) continue
          const px = f.x0 + i * step, pz = f.z0 + j * step
          const d = Math.hypot(px - x, pz - z)
          if (d > h + 1) continue
          const v = Math.max(-127, Math.round((d - h) * 4))
          const k = j * n + i
          if (v < grids.clear[k]) grids.clear[k] = v
        }
      }
    }
  }
}

const fixed = new WeakSet<MapDoc>()
const profileCache = new WeakMap<MapDoc, Map<RoadData, StreetProfile>>()

/** The street profiles of a (fixed) map, worked out once. */
export function townProfiles(doc: MapDoc): Map<RoadData, StreetProfile> {
  let p = profileCache.get(doc)
  if (!p) profileCache.set(doc, (p = streetProfiles(doc)))
  return p
}

/** Every load-time correction, in order; a map is only fixed once, however many lands are made from it. */
export function fixStreets(doc: MapDoc, grids: MapGrids): void {
  if (fixed.has(doc)) return
  fixed.add(doc)
  fixMainSplit(doc)
  fixBridge(doc, grids)
  fixBuildings(doc, grids)
  paveProfiles(doc, grids, townProfiles(doc))
}

// ---------------------------------------------------------------- buildings

/** Raises the buildings the lidar measured low and adds the ones the footprint data is missing. */
export function fixBuildings(doc: MapDoc, grids: MapGrids): void {
  for (const t of BUILDING_HEIGHTS) {
    const b = doc.buildings.find((x) => Math.hypot(x.r[0][0] - t.at[0], x.r[0][1] - t.at[1]) < 1)
    if (!b) continue
    const lift = t.h - b.h
    b.h = t.h
    for (const r of b.r) {
      r[6] += lift
      r[7] += lift
    }
  }
  const f = doc.frame
  const ground = (x: number, z: number) => grids.ground[Math.round((z - f.z0) / f.cell) * grids.side + Math.round((x - f.x0) / f.cell)] / 100
  EXTRA_BUILDINGS.forEach((e, i) => {
    if (doc.buildings.some((b) => Math.hypot(b.r[0][0] - e.at[0], b.r[0][1] - e.at[1]) < 1)) return
    const c = Math.cos(e.yaw), s = Math.sin(e.yaw)
    const corner = (a: number, b: number) => [e.at[0] + c * a * e.half[0] - s * b * e.half[1], e.at[1] + s * a * e.half[0] + c * b * e.half[1]]
    const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
    const heights = ring.map(([x, z]) => ground(x, z))
    const b: BuildingData = {
      k: 'store',
      h: e.h,
      f: Math.round((Math.max(...heights) + 0.12) * 100) / 100,
      l: Math.round(Math.min(...heights) * 100) / 100,
      s: 70001 + i * 97,
      p: ring.flat().map((v) => Math.round(v * 100) / 100),
      r: [[e.at[0], e.at[1], e.half[0], e.half[1], e.yaw, 0, e.h, e.h]],
      m: 1,
      rc: e.roof,
    }
    doc.buildings.push(b)
    // Walls count as pavement in the pavement field, so grass and trees keep out of the new building.
    const n = grids.fineSide, step = f.fine
    const xs = b.p.filter((_v, k) => k % 2 === 0), zs = b.p.filter((_v, k) => k % 2 === 1)
    for (let j = Math.floor((Math.min(...zs) - f.z0) / step); j <= Math.ceil((Math.max(...zs) - f.z0) / step); j++) {
      for (let k = Math.floor((Math.min(...xs) - f.x0) / step); k <= Math.ceil((Math.max(...xs) - f.x0) / step); k++) {
        if (pointInRing(b.p, f.x0 + k * step, f.z0 + j * step)) grids.clear[j * n + k] = Math.min(grids.clear[j * n + k], -8)
      }
    }
  })
}

// ---------------------------------------------------------------- the light

export type SignalGroup = 'ew' | 'n'
export type SignalLamp = 'red' | 'amber' | 'green'
/** One cycle at the light: the highway's green, its amber, all red, Main Street's green, its amber, all red (seconds). */
export const SIGNAL_CYCLE = [24, 4, 2, 14, 4, 2]

/** Which lamp the highway (`ew`) and Main Street (`n`) show `t` seconds into the cycle. */
export function signalPhase(t: number): Record<SignalGroup, SignalLamp> {
  const steps: Record<SignalGroup, SignalLamp>[] = [
    { ew: 'green', n: 'red' }, { ew: 'amber', n: 'red' }, { ew: 'red', n: 'red' },
    { ew: 'red', n: 'green' }, { ew: 'red', n: 'amber' }, { ew: 'red', n: 'red' },
  ]
  const total = SIGNAL_CYCLE.reduce((a, b) => a + b, 0)
  let s = ((t % total) + total) % total
  for (let i = 0; i < SIGNAL_CYCLE.length; i++) {
    if (s < SIGNAL_CYCLE[i]) return steps[i]
    s -= SIGNAL_CYCLE[i]
  }
  return steps[0]
}
