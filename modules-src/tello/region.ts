/**
 * Where Tello sits and what its land is.
 *
 * Tello is Montello, Wisconsin at 1:1. It runs on Fox Lake's engine: Rack &
 * Reel's game with a host world. Rack & Reel's own lake country still stands
 * in its 1024 m square around the scene's origin, sealed by its rim of hills;
 * Montello lies 1.5 km north of it, out of sight and out of reach, so nothing
 * of the lake country is ever drawn here.
 *
 * Three frames:
 *   map    x east, z north, metres from the origin near City Hall (the baked files)
 *   scene  map + OFFSET (left-handed like every Babylon scene; the map's centre is at (0, 4096),
 *          a whole number of map widths from the origin, which lets Rack & Reel's water shader
 *          read Tello's depth map through a repeating texture)
 *   town   (map.x, y, -map.z): right-handed, what Fox Lake's town builders and car physics use;
 *          hangs under a root node at OFFSET with z mirrored
 */
import { STANDALONE_SHAPE, Terrain } from '../rackreel/world/Terrain'
import type { Ground, OutsideLand, TerrainShape } from '../rackreel/world/Terrain'
import { COVER } from './data/MapData'
import type { BridgeData, Frame, MapDoc, MapGrids } from './data/MapData'

/** How far in from the map's edge anyone may go. */
export const EDGE_MARGIN = 36

export interface XZ { x: number; z: number }

interface Deck { y: number; half: number; pts: number[]; x0: number; z0: number; x1: number; z1: number }

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Montello's land: heights, water, cover and pavement, in map coordinates. */
export class TelloLand {
  readonly frame: Frame
  readonly side: number
  readonly cell: number
  readonly x0: number
  readonly z0: number
  readonly size: number
  /** scene = map + offset. */
  readonly offset: XZ
  private readonly decks: Deck[] = []

  constructor(readonly doc: MapDoc, readonly grids: MapGrids) {
    const f = doc.frame
    this.frame = f
    this.side = grids.side
    this.cell = f.cell
    this.x0 = f.x0
    this.z0 = f.z0
    this.size = f.size
    this.offset = { x: -(f.x0 + f.size / 2), z: f.size - (f.z0 + f.size / 2) }
    for (const b of doc.bridges) this.decks.push(deckOf(b))
  }

  /** True inside the map, `margin` metres in from its edge. */
  inside(x: number, z: number, margin = 0): boolean {
    return x >= this.x0 + margin && x <= this.x0 + this.size - margin && z >= this.z0 + margin && z <= this.z0 + this.size - margin
  }

  private node(grid: ArrayLike<number>, x: number, z: number): number {
    const n = this.side
    const gx = Math.min(n - 1.0001, Math.max(0, (x - this.x0) / this.cell))
    const gz = Math.min(n - 1.0001, Math.max(0, (z - this.z0) / this.cell))
    const i = Math.floor(gx)
    const j = Math.floor(gz)
    const fx = gx - i
    const fz = gz - j
    const a = grid[j * n + i]
    const b = grid[j * n + i + 1]
    const c = grid[(j + 1) * n + i]
    const d = grid[(j + 1) * n + i + 1]
    // The same two triangles per cell as the ground mesh.
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz)
  }

  private nearest(grid: ArrayLike<number>, x: number, z: number): number {
    const n = this.side
    const i = Math.min(n - 1, Math.max(0, Math.round((x - this.x0) / this.cell)))
    const j = Math.min(n - 1, Math.max(0, Math.round((z - this.z0) / this.cell)))
    return grid[j * n + i]
  }

  /** The ground itself (the bed under water), metres. */
  groundAt(x: number, z: number): number {
    return this.node(this.grids.ground, x, z) / 100
  }

  /** The bridge deck over (x, z), or null. */
  deckAt(x: number, z: number): number | null {
    for (const d of this.decks) {
      if (x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1) continue
      const p = d.pts
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k]
        const az = p[k + 1]
        const dx = p[k + 2] - ax
        const dz = p[k + 3] - az
        const len2 = dx * dx + dz * dz || 1
        const t = ((x - ax) * dx + (z - az) * dz) / len2
        if (t < -0.02 || t > 1.02) continue
        if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) <= d.half) return d.y
      }
    }
    return null
  }

  /** What you stand or drive on: the ground, or a bridge deck above it. */
  heightAt(x: number, z: number): number {
    const g = this.groundAt(x, z)
    const deck = this.decks.length ? this.deckAt(x, z) : null
    return deck !== null && deck > g ? deck : g
  }

  /** The water surface at (x, z), or null on dry land. */
  waterAt(x: number, z: number): number | null {
    const n = this.side
    const gx = Math.min(n - 1.0001, Math.max(0, (x - this.x0) / this.cell))
    const gz = Math.min(n - 1.0001, Math.max(0, (z - this.z0) / this.cell))
    const i = Math.floor(gx)
    const j = Math.floor(gz)
    const w = this.grids.water
    if (!w[j * n + i] || !w[j * n + i + 1] || !w[(j + 1) * n + i] || !w[(j + 1) * n + i + 1]) return null
    const level = this.node(w, x, z) / 100
    return level > this.groundAt(x, z) ? level : null
  }

  /** Water depth over the bed (0 on land and on bridges). */
  depthAt(x: number, z: number): number {
    const level = this.waterAt(x, z)
    if (level === null) return 0
    if (this.decks.length && this.deckAt(x, z) !== null) return 0
    return Math.max(0, level - this.groundAt(x, z))
  }

  coverAt(x: number, z: number): number {
    return this.nearest(this.grids.cover, x, z)
  }

  /** 0..1 share under tree crowns. */
  canopyAt(x: number, z: number): number {
    return this.node(this.grids.canopy, x, z) / 255
  }

  /** Metres to the nearest pavement or wall (negative on it), up to about 30 m. */
  clearAt(x: number, z: number): number {
    const n = this.grids.fineSide
    const step = this.frame.fine
    const gx = Math.min(n - 1.0001, Math.max(0, (x - this.x0) / step))
    const gz = Math.min(n - 1.0001, Math.max(0, (z - this.z0) / step))
    const i = Math.floor(gx)
    const j = Math.floor(gz)
    const fx = gx - i
    const fz = gz - j
    const g = this.grids.clear
    const a = g[j * n + i] + (g[j * n + i + 1] - g[j * n + i]) * fx
    const b = g[(j + 1) * n + i] + (g[(j + 1) * n + i + 1] - g[(j + 1) * n + i]) * fx
    return (a + (b - a) * fz) / 4
  }

  slopeAt(x: number, z: number): number {
    const e = this.cell
    const dx = this.groundAt(x + e, z) - this.groundAt(x - e, z)
    const dz = this.groundAt(x, z + e) - this.groundAt(x, z - e)
    return Math.atan(Math.hypot(dx, dz) / (2 * e))
  }

  /** Meadow grass grows on open, unpaved, unmown ground; thinly under the trees. */
  grassAt(x: number, z: number): boolean {
    if (!this.inside(x, z, 4)) return false
    const cover = this.coverAt(x, z)
    if (cover === COVER.water || cover === COVER.lawn || cover === COVER.lot || cover === COVER.bare) return false
    if (this.clearAt(x, z) < 0.9) return false
    if (this.depthAt(x, z) > 0) return false
    if (cover === COVER.woods) {
      const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
      return h - Math.floor(h) < 0.3
    }
    return true
  }

  // ---------------------------------------------------------------- frames

  toSceneX(x: number): number { return x + this.offset.x }
  toSceneZ(z: number): number { return z + this.offset.z }
  toMapX(sceneX: number): number { return sceneX - this.offset.x }
  toMapZ(sceneZ: number): number { return sceneZ - this.offset.z }

  /** True when a scene point is on Tello's map. */
  holdsScene(sceneX: number, sceneZ: number, margin = 0): boolean {
    return this.inside(sceneX - this.offset.x, sceneZ - this.offset.z, margin)
  }

  /** The land as Rack & Reel's terrain sees it (scene coordinates). */
  outside(): OutsideLand {
    return {
      contains: (x, z, margin) => this.holdsScene(x, z, EDGE_MARGIN + margin),
      heightAt: (x, z) => (this.holdsScene(x, z) ? this.heightAt(x - this.offset.x, z - this.offset.z) : 0),
      grassAt: (x, z) => this.grassAt(x - this.offset.x, z - this.offset.z),
    }
  }

  /** Rack & Reel's map, its lake country sealed, with Tello as the land beyond it. */
  shape(): TerrainShape {
    return {
      ...STANDALONE_SHAPE,
      outside: this.outside(),
      roadClear: (x, z) => (this.holdsScene(x, z) ? this.clearAt(x - this.offset.x, z - this.offset.z) : 1e6),
    }
  }

  /** Longitude and latitude of a map point (the inverse of the bake's projection, good to a few centimetres here). */
  lonLat(x: number, z: number): { lon: number; lat: number } {
    return utmToLonLat(this.frame.utmE + x, this.frame.utmN + z, this.frame.utmZone)
  }
}

function deckOf(b: BridgeData): Deck {
  let x0 = Infinity
  let z0 = Infinity
  let x1 = -Infinity
  let z1 = -Infinity
  for (let k = 0; k < b.p.length; k += 2) {
    x0 = Math.min(x0, b.p[k]); x1 = Math.max(x1, b.p[k])
    z0 = Math.min(z0, b.p[k + 1]); z1 = Math.max(z1, b.p[k + 1])
  }
  const half = b.w / 2 + (b.k <= 3 ? 0.9 : 0.35)
  return { y: b.y, half, pts: b.p, x0: x0 - half, z0: z0 - half, x1: x1 + half, z1: z1 + half }
}

/** Rack & Reel's terrain with Montello as its land: depth comes from Montello's own water levels, not from y = 0. */
export class TelloTerrain extends Terrain {
  constructor(readonly land: TelloLand) {
    super(land.shape())
  }

  override depthAt(x: number, z: number): number {
    if (this.land.holdsScene(x, z)) return this.land.depthAt(x - this.land.offset.x, z - this.land.offset.z)
    return super.depthAt(x, z)
  }

  override groundAt(x: number, z: number): Ground {
    if (!this.land.holdsScene(x, z)) return super.groundAt(x, z)
    const mx = x - this.land.offset.x
    const mz = z - this.land.offset.z
    if (this.land.depthAt(mx, mz) > 0.3) return 'water'
    const cover = this.land.coverAt(mx, mz)
    if (cover === COVER.marsh) return 'marsh'
    if (cover === COVER.woods) return 'forest'
    if (cover === COVER.bare) return 'shore'
    return 'meadow'
  }
}

// ---------------------------------------------------------------- projection

const WGS_A = 6378137
const WGS_F = 1 / 298.257223563
const K0 = 0.9996

/** UTM (northern hemisphere) to longitude and latitude, degrees. */
export function utmToLonLat(easting: number, northing: number, zone: number): { lon: number; lat: number } {
  const e2 = WGS_F * (2 - WGS_F)
  const ep2 = e2 / (1 - e2)
  const x = easting - 500000
  const m = northing / K0
  const mu = m / (WGS_A * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256))
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu)
  const s = Math.sin(phi1)
  const c = Math.cos(phi1)
  const t = Math.tan(phi1)
  const n1 = WGS_A / Math.sqrt(1 - e2 * s * s)
  const t1 = t * t
  const c1 = ep2 * c * c
  const r1 = (WGS_A * (1 - e2)) / Math.pow(1 - e2 * s * s, 1.5)
  const d = x / (n1 * K0)
  const lat = phi1 - ((n1 * t) / r1) * ((d * d) / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720)
  const lon = (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120) / c
  return { lon: (zone * 6 - 183) + (lon * 180) / Math.PI, lat: (lat * 180) / Math.PI }
}

/** Longitude and latitude to UTM (northern hemisphere). */
export function lonLatToUtm(lon: number, lat: number, zone: number): { e: number; n: number } {
  const e2 = WGS_F * (2 - WGS_F)
  const ep2 = e2 / (1 - e2)
  const phi = (lat * Math.PI) / 180
  const lam = ((lon - (zone * 6 - 183)) * Math.PI) / 180
  const s = Math.sin(phi)
  const c = Math.cos(phi)
  const t = Math.tan(phi)
  const n = WGS_A / Math.sqrt(1 - e2 * s * s)
  const tt = t * t
  const cc = ep2 * c * c
  const a = c * lam
  const m = WGS_A * ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) + ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi))
  const e = K0 * n * (a + ((1 - tt + cc) * a ** 3) / 6 + ((5 - 18 * tt + tt * tt + 72 * cc - 58 * ep2) * a ** 5) / 120) + 500000
  const north = K0 * (m + n * t * ((a * a) / 2 + ((5 - tt + 9 * cc + 4 * cc * cc) * a ** 4) / 24 + ((61 - 58 * tt + tt * tt + 600 * cc - 330 * ep2) * a ** 6) / 720))
  return { e, n: north }
}

export { smoothstep }
