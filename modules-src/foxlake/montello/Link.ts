/**
 * Montello (Tello's map of the real city) north of Fox Plains, and County Road F between them.
 *
 * The land answers Rack & Reel's terrain in three parts: Montello's surveyed ground on its map (the map stays where
 * Tello puts it, a whole map width north of the origin), Fox Plains' town land up to its square's north edge, and the
 * wooded corridor between, where County Road F climbs from the town's level to Montello's. The corridor's ground uses
 * the same hills as the forest ring, so it meets the town's land without a seam, and settles onto Montello's own
 * ground over the last stretch before the map's edge.
 */
import { Terrain, fbm, type Ground, type OutsideLand, type TerrainShape } from '../../rackreel/world/Terrain'
import type { TelloLand } from '../../tello/region'
import { montelloGround } from '../../tello/region'
import { FOX_LAKE_SHAPE, NORTH_ROAD, TOWN_LAND, TOWN_SQUARE, TOWN_Y, northRoadPath, outsideHeight, roadClear, woodsHills } from '../region'

/** How far from County Road F's centreline you may walk; the invisible walls stand at `LINK_WALL`. */
export const LINK_WALK = 29
export const LINK_WALL = 32
/** How far from the road the corridor's ground and woods are drawn. */
export const LINK_SEEN = 150
const FIELD_CELL = 2
/** Metres of County Highway F past the map's edge that count as corridor, so you can walk on into Montello. */
const INTO_MAP = 150

export interface RoadPoint {
  x: number
  z: number
  w: number
  /** Metres along the road from East Ave. */
  s: number
}

interface Near {
  d: number
  s: number
  w: number
}

export class MontelloLink {
  /** County Road F as drawn: from East Ave's north end to Montello's edge. */
  readonly road: RoadPoint[]
  /** The road plus County Highway F on into Montello, for distances. */
  private readonly guide: RoadPoint[]
  readonly joinY: number
  /** Metres along the road where it leaves Fox Plains' square, and where it reaches Montello. */
  readonly sExit: number
  readonly sJoin: number
  /** Montello's map edge (scene z). */
  readonly edgeZ: number
  readonly box: { x0: number; z0: number; x1: number; z1: number }
  private readonly fw: number
  private readonly fh: number
  private readonly dist: Float32Array
  private readonly along: Float32Array
  private readonly width: Float32Array
  private readonly montello: OutsideLand
  readonly land: TelloLand

  constructor(land: TelloLand) {
    this.land = land
    this.montello = land.outside()
    this.edgeZ = land.toSceneZ(land.z0)
    this.road = withArc(northRoadPath(2))
    const last = this.road[this.road.length - 1]
    this.sJoin = last.s
    const exit = this.road.find((p) => p.z > TOWN_SQUARE.z1)
    this.sExit = exit ? exit.s : this.sJoin * 0.4
    this.joinY = land.heightAt(land.toMapX(NORTH_ROAD.join.x), land.toMapZ(NORTH_ROAD.join.z))
    this.guide = [...this.road, ...countyHighwayF(land, last)]
    const xs = this.guide.map((p) => p.x)
    const zs = this.guide.map((p) => p.z)
    const pad = LINK_SEEN + 12
    this.box = { x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, z0: TOWN_SQUARE.z1 - 60, z1: Math.max(...zs) + pad }
    this.fw = Math.ceil((this.box.x1 - this.box.x0) / FIELD_CELL) + 1
    this.fh = Math.ceil((this.box.z1 - this.box.z0) / FIELD_CELL) + 1
    this.dist = new Float32Array(this.fw * this.fh).fill(1e6)
    this.along = new Float32Array(this.fw * this.fh)
    this.width = new Float32Array(this.fw * this.fh).fill(NORTH_ROAD.width)
    this.stampAll()
  }

  /** The distance field: for every cell near the road, the distance to its centreline, how far along it, and its width. */
  private stampAll(): void {
    const reach = LINK_SEEN + 12
    const { box, fw } = this
    for (let k = 0; k + 1 < this.guide.length; k++) {
      const a = this.guide[k]
      const b = this.guide[k + 1]
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - box.x0) / FIELD_CELL))
      const i1 = Math.min(fw - 1, Math.ceil((Math.max(a.x, b.x) + reach - box.x0) / FIELD_CELL))
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - reach - box.z0) / FIELD_CELL))
      const j1 = Math.min(this.fh - 1, Math.ceil((Math.max(a.z, b.z) + reach - box.z0) / FIELD_CELL))
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len2 = dx * dx + dz * dz || 1
      for (let j = j0; j <= j1; j++) {
        const z = box.z0 + j * FIELD_CELL
        for (let i = i0; i <= i1; i++) {
          const x = box.x0 + i * FIELD_CELL
          const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2))
          const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t))
          const c = j * fw + i
          if (d < this.dist[c]) {
            this.dist[c] = d
            this.along[c] = a.s + (b.s - a.s) * t
            this.width[c] = a.w + (b.w - a.w) * t
          }
        }
      }
    }
  }

  /** Distance to the road's centreline, how far along it and its width there (d is huge away from the corridor). */
  near(x: number, z: number, out: Near = { d: 0, s: 0, w: 0 }): Near {
    const { box, fw } = this
    const u = (x - box.x0) / FIELD_CELL
    const v = (z - box.z0) / FIELD_CELL
    if (u < 0 || v < 0 || u > fw - 1.001 || v > this.fh - 1.001) {
      out.d = 1e6
      out.s = 0
      out.w = NORTH_ROAD.width
      return out
    }
    const i = Math.floor(u)
    const j = Math.floor(v)
    const fu = u - i
    const fv = v - j
    const k = j * fw + i
    const lerp = (g: Float32Array) => {
      const a = g[k] + (g[k + 1] - g[k]) * fu
      const b = g[k + fw] + (g[k + fw + 1] - g[k + fw]) * fu
      return a + (b - a) * fv
    }
    out.d = lerp(this.dist)
    out.s = lerp(this.along)
    out.w = lerp(this.width)
    return out
  }

  /** The road's height at `s` metres along: the town's level until it leaves the square, then a steady climb to Montello's. */
  roadY(s: number): number {
    return TOWN_Y + (this.joinY - TOWN_Y) * smoothstep(this.sExit, this.sJoin, s)
  }

  private readonly _n: Near = { d: 0, s: 0, w: 0 }

  /** The corridor's ground: the road's level, the forest ring's hills away from it, and Montello's ground near its edge. */
  corridorHeight(x: number, z: number): number {
    const n = this.near(x, z, this._n)
    const clear = n.d - n.w / 2
    // Away from the road, the woods next to Fox Plains' square sit at the town's level like the forest ring beside them.
    const fromTown = z - TOWN_SQUARE.z1
    const settle = Math.max(smoothstep(12, 60, clear), 1 - smoothstep(0, 40, fromTown))
    const base = this.roadY(n.s) + (TOWN_Y - this.roadY(n.s)) * (1 - smoothstep(0, 140, fromTown)) * settle
    let h = base + woodsHills(x, z) * smoothstep(0, 1, (clear - 10) / 75)
    const south = this.edgeZ - z
    if (south < 160) {
      const land = this.land
      const k = 1 - smoothstep(40, 160, south)
      h += (land.groundAt(land.toMapX(x), land.z0) - h) * k
    }
    return h
  }

  inCorridor(x: number, z: number, margin = 0): boolean {
    if (z < TOWN_SQUARE.z1 - 40) return false
    return this.near(x, z, this._n).d < LINK_WALK - margin
  }

  /** True on Montello's map. */
  onMap(x: number, z: number): boolean {
    return this.land.holdsScene(x, z)
  }

  heightAt(x: number, z: number): number {
    if (this.land.holdsScene(x, z)) return this.montello.heightAt(x, z)
    if (z <= TOWN_SQUARE.z1) return outsideHeight(x, z)
    return this.corridorHeight(x, z)
  }

  roadClear(x: number, z: number): number {
    const land = this.land
    if (land.holdsScene(x, z)) return land.clearAt(land.toMapX(x), land.toMapZ(z))
    const n = this.near(x, z, this._n)
    const own = n.d - n.w / 2
    return z <= TOWN_SQUARE.z1 ? Math.min(roadClear(x, z), own) : own
  }

  grassAt(x: number, z: number): boolean {
    if (this.land.holdsScene(x, z)) return this.montello.grassAt?.(x, z) ?? false
    if (z <= TOWN_SQUARE.z1) return TOWN_LAND.grassAt?.(x, z) ?? false
    const n = this.near(x, z, this._n)
    const clear = n.d - n.w / 2
    if (clear < 1.2 || n.d > LINK_SEEN) return false
    if (clear < 14) return true
    const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
    return h - Math.floor(h) < 0.3
  }

  /** Fox Plains, the corridor and Montello as one stretch of land beyond the lake country. */
  outside(): OutsideLand {
    return {
      contains: (x, z, margin) => TOWN_LAND.contains(x, z, margin) || this.inCorridor(x, z, margin) || this.montello.contains(x, z, margin),
      heightAt: (x, z) => this.heightAt(x, z),
      grassAt: (x, z) => this.grassAt(x, z),
    }
  }

  shape(): TerrainShape {
    return { ...FOX_LAKE_SHAPE, outside: this.outside(), roadClear: (x, z) => this.roadClear(x, z) }
  }
}

/** Fox Lake's terrain with Montello on it: Montello's lakes and rivers at their own levels, and its ground types. */
export class FoxLakeTerrain extends Terrain {
  constructor(readonly link: MontelloLink | null) {
    super(link ? link.shape() : FOX_LAKE_SHAPE)
  }

  override depthAt(x: number, z: number): number {
    const land = this.link?.land
    if (land && land.holdsScene(x, z)) return land.depthAt(land.toMapX(x), land.toMapZ(z))
    return super.depthAt(x, z)
  }

  override groundAt(x: number, z: number): Ground {
    const land = this.link?.land
    return (land && montelloGround(land, x, z)) || super.groundAt(x, z)
  }
}

function withArc(points: { x: number; z: number; w: number }[]): RoadPoint[] {
  let s = 0
  return points.map((p, i) => {
    if (i > 0) s += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z)
    return { ...p, s }
  })
}

/** County Highway F from its first point on into Montello (scene coordinates), continuing `last`'s arc length. */
function countyHighwayF(land: TelloLand, last: RoadPoint): RoadPoint[] {
  const road = land.doc.roads.find((r) => r.n === 'County Highway F' && Math.min(...r.p.filter((_v, i) => i % 2 === 1)) < land.z0 + 10)
  if (!road) return []
  const out: RoadPoint[] = []
  let s = last.s
  let px = last.x
  let pz = last.z
  for (let k = 2; k + 1 < road.p.length; k += 2) {
    const x = land.toSceneX(road.p[k])
    const z = land.toSceneZ(road.p[k + 1])
    s += Math.hypot(x - px, z - pz)
    out.push({ x, z, w: road.w, s })
    px = x
    pz = z
    if (z > land.toSceneZ(land.z0) + INTO_MAP) break
  }
  return out
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export { fbm }
