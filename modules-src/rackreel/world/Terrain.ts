export const WORLD_SIZE = 1024
export const HALF = WORLD_SIZE / 2
export const GRID = 320
export const CELL = WORLD_SIZE / GRID
export const WATER_LEVEL = 0
export const PLAY_LIMIT = HALF - 34
export const LAKE_CENTER = { x: 10, z: 30 }

/** Which edges of the square carry the 42 m rim of hills. +z is north. */
export interface Rim {
  north: boolean
  south: boolean
  east: boolean
  west: boolean
}

/**
 * The shape of the map. Standalone Rack & Reel is the square ringed by hills on
 * every side. A host world (Fox Lake) can open edges: an open edge blends down
 * to `outsideHeight` instead of rising, and `outside` answers for the land
 * beyond the square.
 */
export interface TerrainShape {
  rim: Rim
  outsideHeight: number
  outside?: OutsideLand
  /** The host world's ground height at (x, z) beyond an open edge, when it isn't flat at `outsideHeight`; open edges blend to it. */
  outsideHeightAt?(x: number, z: number): number
  /** Metres from (x, z) to the edge of the nearest host-world road or lot (negative on it): trees, rocks, ferns and grass keep off. */
  roadClear?(x: number, z: number): number
  /** Reshapes the lake country's height `h` at (x, z) for a host world's road bed; applied to the height grid. */
  carve?(x: number, z: number, h: number): number
  /** Openings in the interstate's barriers where a host world's road joins it: side -1 (south-west rail), 0 (median), 1 (north-east rail), between t0 and t1 along it. */
  highwayGaps?: readonly HighwayGap[]
  /** The woods floor's colours (linear 0..1) when the host world wants them lighter than the lake country's own `WOODS_FLOOR`. */
  woodsFloor?: WoodsFloor
}

export interface WoodsFloor {
  needles: readonly number[]
  moss: readonly number[]
}

export const WOODS_FLOOR: WoodsFloor = { needles: [0.33, 0.27, 0.17], moss: [0.25, 0.32, 0.14] }

export interface HighwayGap {
  side: -1 | 0 | 1
  t0: number
  t1: number
}

/** Land beyond the square, supplied by a host world. */
export interface OutsideLand {
  /** True when (x, z) is walkable or drivable land of the host world, `margin` metres in from its edge. */
  contains(x: number, z: number, margin: number): boolean
  heightAt(x: number, z: number): number
  /** True where meadow grass grows out there (off roads, yards and floors). */
  grassAt?(x: number, z: number): boolean
}

export const STANDALONE_SHAPE: TerrainShape = { rim: { north: true, south: true, east: true, west: true }, outsideHeight: 0 }

/** How far an open edge's blend reaches in from the edge. */
export const OPEN_EDGE_BLEND = 110

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 982451653)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function valueNoise(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uz = fz * fz * (3 - 2 * fz)
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1
}

export function fbm(x: number, z: number, octaves = 4, seed = 0): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 17) * amp
    freq *= 2.03
    amp *= 0.5
  }
  return sum
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function lakeRadius(angle: number): number {
  return 168 + 34 * Math.sin(angle * 3 + 1.1) + 22 * Math.sin(angle * 5 - 0.4) + 12 * Math.sin(angle * 9 + 2.0)
}

export function lakeCoord(x: number, z: number): { s: number; angle: number; radius: number } {
  const dx = x - LAKE_CENTER.x
  const dz = z - LAKE_CENTER.z
  const angle = Math.atan2(dz, dx)
  const radius = lakeRadius(angle)
  return { s: Math.hypot(dx, dz) / radius, angle, radius }
}

export function marshWeight(angle: number): number {
  const a = Math.atan2(Math.sin(angle - 2.3), Math.cos(angle - 2.3))
  return smoothstep(0.75, 0.15, Math.abs(a))
}

export const ISLAND = { x: 70, z: -20, r: 26 }

/** Broad shallow weed flats on three stretches of shoreline (west by the marsh, south and east), away from the dock. */
export function flatsWeight(angle: number): number {
  let w = 0
  for (const [at, width] of [[2.75, 0.42], [-1.95, 0.3], [0.32, 0.26]] as const) {
    const d = Math.atan2(Math.sin(angle - at), Math.cos(angle - at))
    w = Math.max(w, Math.exp(-(d * d) / (width * width)))
  }
  return smoothstep(0.15, 0.7, w)
}

export function trailOffset(x: number, z: number): number {
  const { s, radius } = lakeCoord(x, z)
  return Math.abs(s - 1.42) * radius
}

const CHANNEL_ANGLE = 0.9
const CHANNEL_DIR = { x: Math.cos(CHANNEL_ANGLE), z: Math.sin(CHANNEL_ANGLE) }
/** The back bay: a shallow weedy basin north-east of the lake, reached only by a channel that runs under the interstate. */
export const BAY = { x: LAKE_CENTER.x + CHANNEL_DIR.x * 275, z: LAKE_CENTER.z + CHANNEL_DIR.z * 275, r: 58 }
export const CHANNEL = {
  ax: LAKE_CENTER.x + CHANNEL_DIR.x * lakeRadius(CHANNEL_ANGLE) * 0.82,
  az: LAKE_CENTER.z + CHANNEL_DIR.z * lakeRadius(CHANNEL_ANGLE) * 0.82,
  bx: BAY.x,
  bz: BAY.z,
  width: 26,
}
/** The interstate: a straight four-lane highway crossing the channel on a bridge. `x, z` is where it crosses the channel; it runs along (dx, dz). */
export const HIGHWAY = {
  x: LAKE_CENTER.x + CHANNEL_DIR.x * 205,
  z: LAKE_CENTER.z + CHANNEL_DIR.z * 205,
  dx: -CHANNEL_DIR.z,
  dz: CHANNEL_DIR.x,
  halfWidth: 12,
  deck: 7.5,
  span: 64,
  reach: 640,
}

export function bayRadius(angle: number): number {
  return BAY.r * (1 + 0.12 * Math.sin(angle * 3 + 0.5) + 0.08 * Math.sin(angle * 5 - 1))
}

export function bayCoord(x: number, z: number): number {
  return Math.hypot(x - BAY.x, z - BAY.z) / bayRadius(Math.atan2(z - BAY.z, x - BAY.x))
}

export function channelDistance(x: number, z: number): number {
  const dx = CHANNEL.bx - CHANNEL.ax
  const dz = CHANNEL.bz - CHANNEL.az
  const t = Math.max(0, Math.min(1, ((x - CHANNEL.ax) * dx + (z - CHANNEL.az) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(x - (CHANNEL.ax + dx * t), z - (CHANNEL.az + dz * t))
}

/** Along-road and across-road distances from the highway's channel crossing. */
export function highwayCoord(x: number, z: number): { t: number; across: number } {
  const px = x - HIGHWAY.x
  const pz = z - HIGHWAY.z
  return { t: px * HIGHWAY.dx + pz * HIGHWAY.dz, across: Math.abs(px * HIGHWAY.dz - pz * HIGHWAY.dx) }
}

const GRADE_STEP = 4
const gradeTables = new WeakMap<TerrainShape, Float32Array>()

/** 1 where the highway reaches an open edge (it eases down to the host world's ground there), 0 well inside. */
function openEdgeWeight(x: number, z: number, shape: TerrainShape): number {
  const { rim } = shape
  let edge = -Infinity
  for (const [on, d] of [[rim.north, z], [rim.south, -z], [rim.east, x], [rim.west, -x]] as const) if (!on) edge = Math.max(edge, d)
  return edge === -Infinity ? 0 : smoothstep(HALF - 70, HALF - 8, edge)
}

/** Height of the road surface along the highway: the land smoothed over ±48 m, climbing at 5 % to the bridge deck, easing to the ground beyond an open edge. */
export function highwayGrade(t: number, shape: TerrainShape = STANDALONE_SHAPE): number {
  let gradeTable = gradeTables.get(shape)
  if (!gradeTable) {
    const n = Math.ceil((HIGHWAY.reach * 2) / GRADE_STEP) + 1
    const base = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const tt = -HIGHWAY.reach + i * GRADE_STEP
      base[i] = baseHeight(HIGHWAY.x + HIGHWAY.dx * tt, HIGHWAY.z + HIGHWAY.dz * tt, shape)
    }
    gradeTable = new Float32Array(n)
    const w = 12
    for (let i = 0; i < n; i++) {
      let sum = 0
      let count = 0
      for (let k = -w; k <= w; k++) {
        const j = Math.min(n - 1, Math.max(0, i + k))
        sum += Math.max(1.5, base[j])
        count++
      }
      const tt = -HIGHWAY.reach + i * GRADE_STEP
      const ramp = HIGHWAY.deck - Math.max(0, Math.abs(tt) - HIGHWAY.span / 2) * 0.05
      gradeTable[i] = Math.max(sum / count, ramp)
      const open = openEdgeWeight(HIGHWAY.x + HIGHWAY.dx * tt, HIGHWAY.z + HIGHWAY.dz * tt, shape)
      if (open > 0) {
        const px = HIGHWAY.x + HIGHWAY.dx * tt
        const pz = HIGHWAY.z + HIGHWAY.dz * tt
        const outside = shape.outsideHeightAt ? shape.outsideHeightAt(px, pz) : shape.outsideHeight
        gradeTable[i] += (outside + 0.25 - gradeTable[i]) * open
      }
    }
    gradeTables.set(shape, gradeTable)
  }
  const u = (Math.max(-HIGHWAY.reach, Math.min(HIGHWAY.reach, t)) + HIGHWAY.reach) / GRADE_STEP
  const i = Math.min(gradeTable.length - 2, Math.floor(u))
  const f = u - i
  return gradeTable[i] + (gradeTable[i + 1] - gradeTable[i]) * f
}

export function rawHeight(x: number, z: number, shape: TerrainShape = STANDALONE_SHAPE): number {
  let h = baseHeight(x, z, shape)
  const road = highwayCoord(x, z)
  if (road.across < HIGHWAY.halfWidth + 18 && Math.abs(road.t) > HIGHWAY.span / 2 - 1) {
    const w = 1 - smoothstep(HIGHWAY.halfWidth + 1, HIGHWAY.halfWidth + 18, road.across)
    h += (highwayGrade(road.t, shape) - 0.25 - h) * w
  }
  return h
}

function baseHeight(x: number, z: number, shape: TerrainShape): number {
  const { s, angle } = lakeCoord(x, z)
  const hills = fbm(x * 0.0042 + 3.1, z * 0.0042 - 1.7, 4, 1) * 34 + fbm(x * 0.016, z * 0.016, 3, 5) * 5
  const marsh = marshWeight(angle)
  let land = 3.2 + Math.max(-1.5, hills) * smoothstep(1.05, 1.9, s)
  land = land * (1 - marsh * smoothstep(2.0, 1.1, s)) + marsh * smoothstep(2.0, 1.1, s) * (0.35 + fbm(x * 0.05, z * 0.05, 2, 9) * 0.3)
  const floor = -1.2 - 15 * Math.pow(Math.max(0, 1 - s), 0.75) * (0.75 + 0.25 * fbm(x * 0.01, z * 0.01, 2, 3)) - fbm(x * 0.03, z * 0.03, 2, 4) * 1.4
  const shelf = flatsWeight(angle) * smoothstep(0.6, 0.76, s)
  const flat = -0.95 - (fbm(x * 0.035, z * 0.035, 3, 23) * 0.5 + 0.5) * 0.9
  const bed = floor + (Math.max(floor, flat) - floor) * shelf
  const shore = smoothstep(0.9, 1.12, s)
  let h = bed + (land - bed) * shore
  const di = Math.hypot(x - ISLAND.x, z - ISLAND.z) / ISLAND.r
  if (di < 1.6) h = Math.max(h, (1 - smoothstep(0.2, 1.3, di)) * 5.5 - 1.5 + fbm(x * 0.08, z * 0.08, 2, 11))
  const trail = trailOffset(x, z)
  if (s > 1.2 && trail < 6) h = h * (0.88 + 0.12 * smoothstep(1.5, 6, trail))
  const dc = channelDistance(x, z)
  const W = CHANNEL.width
  if (dc < W * 2.2) h = Math.min(h, -3.6 + 4.8 * smoothstep(W * 0.28, W * 0.62, dc) + 30 * smoothstep(W * 0.62, W * 2.2, dc) - fbm(x * 0.05, z * 0.05, 2, 13) * 0.25)
  const db = bayCoord(x, z)
  if (db < 1.9) {
    const floor = -1.1 - 3.4 * Math.pow(Math.max(0, 1 - db), 2.6) - (fbm(x * 0.04, z * 0.04, 3, 17) * 0.5 + 0.2) * smoothstep(0.95, 0.5, db)
    h = Math.min(h, floor + 4.4 * smoothstep(0.82, 1.18, db) + 30 * smoothstep(1.18, 1.9, db))
  }
  return shapeEdges(h, x, z, shape)
}

function shapeEdges(h: number, x: number, z: number, shape: TerrainShape): number {
  const { rim } = shape
  if (rim.north && rim.south && rim.east && rim.west) return h + smoothstep(HALF - 90, HALF - 4, Math.max(Math.abs(x), Math.abs(z))) * 42
  let rimEdge = -Infinity
  let openEdge = -Infinity
  for (const [on, d] of [[rim.north, z], [rim.south, -z], [rim.east, x], [rim.west, -x]] as const) {
    if (on) rimEdge = Math.max(rimEdge, d)
    else openEdge = Math.max(openEdge, d)
  }
  const open = smoothstep(HALF - OPEN_EDGE_BLEND, HALF, openEdge)
  const rimmed = h + smoothstep(HALF - 90, HALF - 4, rimEdge) * 42 * (1 - open)
  const outside = open > 0 && shape.outsideHeightAt ? shape.outsideHeightAt(x, z) : shape.outsideHeight
  const lift = 1.5 * (1 - smoothstep(HALF - 24, HALF, openEdge))
  return rimmed + (Math.max(outside, Math.min(rimmed, outside + lift)) - rimmed) * open
}

/** 0 on open water, the channel and the highway; 1 well clear of them. */
export function waterwayClear(x: number, z: number): number {
  const road = highwayCoord(x, z)
  return smoothstep(1.05, 1.3, bayCoord(x, z)) * smoothstep(CHANNEL.width * 0.7, CHANNEL.width * 1.4, channelDistance(x, z)) * smoothstep(HIGHWAY.halfWidth + 3, HIGHWAY.halfWidth + 20, road.across)
}

export function forestDensity(x: number, z: number): number {
  const { s, angle } = lakeCoord(x, z)
  const patches = fbm(x * 0.0065 + 11, z * 0.0065 - 4, 3, 21) * 0.5 + 0.55
  const meadow = smoothstep(0.1, -0.25, fbm(x * 0.004 - 7, z * 0.004 + 2, 2, 31))
  const shore = smoothstep(1.12, 1.35, s)
  const marsh = 1 - marshWeight(angle) * smoothstep(2.0, 1.2, s) * 0.85
  const trail = smoothstep(3.5, 8, trailOffset(x, z))
  return Math.max(0, Math.min(1, patches * shore * marsh * trail * (1 - meadow * 0.75) * waterwayClear(x, z)))
}

export type Ground = 'water' | 'shore' | 'marsh' | 'meadow' | 'forest' | 'trail' | 'rock'

export class Terrain {
  readonly heights: Float32Array
  readonly verts = GRID + 1

  constructor(readonly shape: TerrainShape = STANDALONE_SHAPE) {
    this.heights = new Float32Array(this.verts * this.verts)
    for (let j = 0; j < this.verts; j++) {
      for (let i = 0; i < this.verts; i++) {
        const x = -HALF + i * CELL
        const z = -HALF + j * CELL
        const h = rawHeight(x, z, shape)
        this.heights[j * this.verts + i] = shape.carve ? shape.carve(x, z, h) : h
      }
    }
  }

  /** True inside the square (beyond its play limit) or on the host world's land. */
  inSquare(x: number, z: number): boolean {
    return Math.abs(x) <= HALF && Math.abs(z) <= HALF
  }

  /** True where the player and land vehicles may go, `margin` metres in from the edge. */
  inBounds(x: number, z: number, margin = 0): boolean {
    const lim = PLAY_LIMIT - margin
    if (Math.abs(x) <= lim && Math.abs(z) <= lim) return true
    const outside = this.shape.outside
    if (!outside) return false
    if (outside.contains(x, z, margin)) return true
    const { rim } = this.shape
    const edge = HALF + 1
    if (Math.abs(x) <= lim && ((!rim.north && z > 0 && z <= edge) || (!rim.south && z < 0 && z >= -edge))) return true
    if (Math.abs(z) <= lim && ((!rim.east && x > 0 && x <= edge) || (!rim.west && x < 0 && x >= -edge))) return true
    return false
  }

  /** Moves `p` back inside the bounds when a step took it out (to `fromX`, `fromZ`, or the square's limit). */
  confine(p: { x: number; z: number }, fromX: number, fromZ: number): void {
    if (this.inBounds(p.x, p.z)) return
    if (!this.shape.outside) {
      p.x = Math.max(-PLAY_LIMIT, Math.min(PLAY_LIMIT, p.x))
      p.z = Math.max(-PLAY_LIMIT, Math.min(PLAY_LIMIT, p.z))
      return
    }
    if (this.inBounds(p.x, fromZ)) p.z = fromZ
    else if (this.inBounds(fromX, p.z)) p.x = fromX
    else {
      p.x = fromX
      p.z = fromZ
    }
  }

  heightAt(x: number, z: number): number {
    const outside = this.shape.outside
    if (outside && (Math.abs(x) > HALF || Math.abs(z) > HALF)) return outside.heightAt(x, z)
    const gx = Math.min(GRID - 1e-4, Math.max(0, (x + HALF) / CELL))
    const gz = Math.min(GRID - 1e-4, Math.max(0, (z + HALF) / CELL))
    const i = Math.floor(gx)
    const j = Math.floor(gz)
    const fx = gx - i
    const fz = gz - j
    const v = this.verts
    const h00 = this.heights[j * v + i]
    const h10 = this.heights[j * v + i + 1]
    const h01 = this.heights[(j + 1) * v + i]
    const h11 = this.heights[(j + 1) * v + i + 1]
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz)
  }

  slopeAt(x: number, z: number): number {
    const e = CELL
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z)
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e)
    return Math.atan(Math.hypot(dx, dz) / (2 * e))
  }

  depthAt(x: number, z: number): number {
    return WATER_LEVEL - this.heightAt(x, z)
  }

  groundAt(x: number, z: number): Ground {
    const h = this.heightAt(x, z)
    if (h < -0.35) return 'water'
    const { s, angle } = lakeCoord(x, z)
    if (marshWeight(angle) > 0.4 && s < 1.9 && h < 1.4) return 'marsh'
    if (h < 0.9) return 'shore'
    if (s > 1.2 && trailOffset(x, z) < 3) return 'trail'
    if (this.slopeAt(x, z) > 0.62) return 'rock'
    return forestDensity(x, z) > 0.42 ? 'forest' : 'meadow'
  }
}
