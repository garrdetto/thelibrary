/**
 * Montello (Tello's map of the real city) south-west of Fox Plains, and State Highway 23 between them.
 *
 * The land answers Rack & Reel's terrain in three parts: Montello's surveyed ground on its map (a whole map width west
 * of the origin, `MONTELLO_AT`), Fox Plains' town land up to its square's west edge, and the wooded corridor between,
 * where Highway 23 climbs from the town's level to Montello's. The corridor's ground uses the same hills as the forest
 * ring, so it meets the town's land without a seam, and settles onto Montello's own ground over the last stretch
 * before the map's edge. Inside the map, past the ground Montello draws, the corridor carries the highway on to the
 * city limits.
 */
import { Terrain, fbm, type Ground, type OutsideLand, type TerrainShape } from '../../rackreel/world/Terrain'
import type { TelloLand } from '../../tello/region'
import { montelloGround } from '../../tello/region'
import { FOX_LAKE_SHAPE, LINK_ROAD, TOWN_LAND, TOWN_SQUARE, TOWN_Y, linkRoadPath, outsideHeight, roadClear, woodsHills } from '../region'

/** How far from Highway 23's centreline you may walk; the invisible walls stand at `LINK_WALL`. */
export const LINK_WALK = 29
export const LINK_WALL = 32
/** How far from the road the corridor's ground and woods are drawn. */
export const LINK_SEEN = 150
const FIELD_CELL = 2
/** Metres inside Montello's playable area that the corridor reaches along the highway, so you can walk on into town. */
const INTO_CITY = 40
/** Within `MEET_NEAR` metres of where the highway meets Montello the corridor's ground is Montello's; by `MEET_FAR` it is its own. */
const MEET_NEAR = 30
const MEET_FAR = 120
/** The road's name where it runs. */
export const LINK_NAME = 'State Highway 23'
/** Montello's ground under Highway 23 is graded flat to the road out to this far past its edge, then eased back to the survey over `GRADE_BLEND`. */
const GRADE_SHOULDER = 2
const GRADE_BLEND = 8
/** Grass keeps this far (metres) off Highway 23's edge, so blades never lean over the asphalt. */
const GRASS_CLEAR = 1.5

export interface RoadPoint {
  x: number
  z: number
  w: number
  /** Metres along the road from Main Street. */
  s: number
}

interface Near {
  d: number
  s: number
  w: number
}

export class MontelloLink {
  /** Highway 23 as the corridor draws it: from Main Street's west end to the end of the baked highway at Montello's edge. */
  readonly road: RoadPoint[]
  /** The baked highway inside Montello's map from its edge to just inside the city limits (scene coordinates, onward). */
  readonly inward: RoadPoint[]
  /** Where Highway 23 leaves Montello's playable area (map coordinates): Montello's walls and barricades open there. */
  readonly exit: { x: number; z: number; r: number }
  /** The road plus the baked highway on into Montello, for distances. */
  private readonly guide: RoadPoint[]
  readonly joinY: number
  /** Metres along the road where it leaves Fox Plains' square, and where it reaches Montello. */
  readonly sExit: number
  readonly sJoin: number
  /** Montello's map's east edge (scene x). */
  readonly edgeX: number
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
    cutHighway(land)
    this.montello = land.outside()
    this.edgeX = land.toSceneX(land.x0 + land.size)
    this.road = withArc(linkRoadPath(2))
    const last = this.road[this.road.length - 1]
    this.sJoin = last.s
    const exit = this.road.find((p) => p.x < TOWN_SQUARE.x0)
    this.sExit = exit ? exit.s : this.sJoin * 0.4
    this.joinY = land.heightAt(land.toMapX(LINK_ROAD.join.x), land.toMapZ(LINK_ROAD.join.z))
    this.inward = highwayInward(land, last)
    const out = this.inward.find((p) => land.playable(land.toMapX(p.x), land.toMapZ(p.z)))
    this.exit = out ? { x: land.toMapX(out.x), z: land.toMapZ(out.z), r: LINK_WALL + 4 } : { x: land.toMapX(last.x), z: land.toMapZ(last.z), r: 0 }
    this.guide = [...this.road, ...this.inward]
    const xs = this.guide.map((p) => p.x)
    const zs = this.guide.map((p) => p.z)
    const pad = LINK_SEEN + 12
    this.box = { x0: Math.min(...xs) - pad, x1: Math.max(TOWN_SQUARE.x0 + 60, Math.max(...xs) + pad), z0: Math.min(...zs) - pad, z1: Math.max(...zs) + pad }
    this.fw = Math.ceil((this.box.x1 - this.box.x0) / FIELD_CELL) + 1
    this.fh = Math.ceil((this.box.z1 - this.box.z0) / FIELD_CELL) + 1
    this.dist = new Float32Array(this.fw * this.fh).fill(1e6)
    this.along = new Float32Array(this.fw * this.fh)
    this.width = new Float32Array(this.fw * this.fh).fill(LINK_ROAD.width)
    this.stampAll()
    this.gradeHighway()
  }

  /**
   * Grades Montello's surveyed ground under the stretch of Highway 23 that runs over Montello's land: the bake's ground
   * there is the old, cut highway's surroundings, up to 60 cm above the new road in places, and it showed through the
   * asphalt as humps of grass. Under the road (and its 1.5 m shoulders) the ground takes the road's own profile, easing
   * back to the survey over `GRADE_BLEND` metres, and the road is written into the clearance grid, so Montello's ground
   * mesh, its physics heightfield and its grass all agree with the road.
   */
  private gradeHighway(): void {
    const land = this.land
    const { ground, clear, fineSide } = land.grids
    const near: Near = { d: 0, s: 0, w: 0 }
    const reach = GRADE_SHOULDER + GRADE_BLEND
    const touch = (side: number, step: number, write: (k: number, clear: number, s: number) => void) => {
      for (let j = 0; j < side; j++) {
        const mz = land.z0 + j * step
        const z = land.toSceneZ(mz)
        if (z < this.box.z0 || z > this.box.z1) continue
        for (let i = 0; i < side; i++) {
          const mx = land.x0 + i * step
          const x = land.toSceneX(mx)
          if (x < this.box.x0 || x > this.box.x1) continue
          const n = this.near(x, z, near)
          const c = n.d - n.w / 2
          if (c > reach || n.s > this.sJoin) continue
          write(j * side + i, c, n.s)
        }
      }
    }
    touch(land.side, land.cell, (k, c, s) => {
      const keep = smoothstep(GRADE_SHOULDER, reach, c)
      ground[k] = Math.max(0, Math.round((this.roadY(s) + (ground[k] / 100 - this.roadY(s)) * keep) * 100))
    })
    touch(fineSide, land.frame.fine, (k, c) => {
      const q = Math.max(-127, Math.min(127, Math.round(c * 4)))
      if (q < clear[k]) clear[k] = q
    })
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
      out.w = LINK_ROAD.width
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
    const fromTown = TOWN_SQUARE.x0 - x
    const settle = Math.max(smoothstep(12, 60, clear), 1 - smoothstep(0, 40, fromTown))
    const base = this.roadY(n.s) + (TOWN_Y - this.roadY(n.s)) * (1 - smoothstep(0, 140, fromTown)) * settle
    let h = base + woodsHills(x, z) * smoothstep(0, 1, (clear - 10) / 75)
    // Near where the highway meets Montello the land off the road settles onto Montello's own surveyed ground.
    const land = this.land
    const k = land.holdsScene(x, z) ? (1 - smoothstep(MEET_NEAR, MEET_FAR, Math.hypot(x - LINK_ROAD.join.x, z - LINK_ROAD.join.z))) * smoothstep(3, 18, clear) : 0
    if (k > 0) h += (land.groundAt(land.toMapX(x), land.toMapZ(z)) - h) * k
    return h
  }

  inCorridor(x: number, z: number, margin = 0): boolean {
    if (x > TOWN_SQUARE.x0 + 40) return false
    return this.near(x, z, this._n).d < LINK_WALK - margin
  }

  /** True west of Fox Plains' square: on Highway 23 through the woods, or in Montello. */
  beyondTown(x: number, _z: number): boolean {
    return x < TOWN_SQUARE.x0 + 8
  }

  /** True on Montello's map. */
  onMap(x: number, z: number): boolean {
    return this.owns(x, z)
  }

  /**
   * True where Montello's land is: the playable area and the band seen past it. Its map's square reaches further, and
   * may hold Fox Plains' own land where it lies close, so Fox Lake asks this rather than the square.
   */
  owns(x: number, z: number): boolean {
    const land = this.land
    return land.holdsScene(x, z) && land.seen(land.toMapX(x), land.toMapZ(z))
  }

  heightAt(x: number, z: number): number {
    if (this.owns(x, z)) return this.montello.heightAt(x, z)
    if (x >= TOWN_SQUARE.x0) return outsideHeight(x, z)
    return this.corridorHeight(x, z)
  }

  roadClear(x: number, z: number): number {
    const land = this.land
    if (this.owns(x, z)) return land.clearAt(land.toMapX(x), land.toMapZ(z))
    const n = this.near(x, z, this._n)
    const own = n.d - n.w / 2
    return x >= TOWN_SQUARE.x0 ? Math.min(roadClear(x, z), own) : own
  }

  grassAt(x: number, z: number): boolean {
    const n = this.near(x, z, this._n)
    const clear = n.d - n.w / 2
    if (clear < GRASS_CLEAR) return false
    if (this.owns(x, z)) return this.montello.grassAt?.(x, z) ?? false
    // Highway 23 runs a few hundred metres inside Fox Plains' square too: no grass on it or its shoulders there either.
    if (x >= TOWN_SQUARE.x0) return TOWN_LAND.grassAt?.(x, z) ?? false
    if (n.d > LINK_SEEN) return false
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
    if (land && this.link?.owns(x, z)) return land.depthAt(land.toMapX(x), land.toMapZ(z))
    return super.depthAt(x, z)
  }

  override groundAt(x: number, z: number): Ground {
    const land = this.link?.land
    return (land && this.link?.owns(x, z) && montelloGround(land, x, z)) || super.groundAt(x, z)
  }
}

function withArc(points: { x: number; z: number; w: number }[]): RoadPoint[] {
  let s = 0
  return points.map((p, i) => {
    if (i > 0) s += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z)
    return { ...p, s }
  })
}

/**
 * Ends the baked State Highway 23 at `LINK_ROAD.join`, where Fox Lake's own road takes over, so Montello draws it only
 * up to there (the rest would lie under the corridor's road, or out in the woods). Safe to call twice.
 */
function cutHighway(land: TelloLand): void {
  const jx = land.toMapX(LINK_ROAD.join.x)
  const jz = land.toMapZ(LINK_ROAD.join.z)
  let best: { road: { p: number[] }; k: number; d: number } | null = null
  for (const road of land.doc.roads) {
    if (road.n !== LINK_NAME) continue
    for (let k = 0; k + 3 < road.p.length; k += 2) {
      const ax = road.p[k], az = road.p[k + 1], bx = road.p[k + 2], bz = road.p[k + 3]
      const dx = bx - ax, dz = bz - az
      const t = Math.min(1, Math.max(0, ((jx - ax) * dx + (jz - az) * dz) / (dx * dx + dz * dz || 1)))
      const d = Math.hypot(ax + dx * t - jx, az + dz * t - jz)
      if (!best || d < best.d) best = { road, k, d }
    }
  }
  if (!best || best.d > 3) return
  const p = best.road.p
  // Keep the side of the cut that runs back into town (toward the playable area).
  const head = [...p.slice(0, best.k + 2), jx, jz]
  const tail = [jx, jz, ...p.slice(best.k + 2)]
  const inTown = (pts: number[]) => pts.some((_v, i) => i % 2 === 0 && land.playable(pts[i], pts[i + 1]))
  const keep = inTown(head) ? head : tail
  // The kept end is always the join, last.
  const ordered = keep === head ? head : reversePairs(tail)
  p.length = 0
  p.push(...ordered.map((v) => Math.round(v * 10) / 10))
}

function reversePairs(p: number[]): number[] {
  const out: number[] = []
  for (let k = p.length - 2; k >= 0; k -= 2) out.push(p[k], p[k + 1])
  return out
}

/**
 * The baked State Highway 23 inside Montello's map, from the end that `last` meets back toward town until it is
 * `INTO_CITY` metres inside the playable area (scene coordinates), continuing `last`'s arc length.
 */
function highwayInward(land: TelloLand, last: RoadPoint): RoadPoint[] {
  let road = null as null | { w: number; p: number[] }
  let best = Infinity
  for (const r of land.doc.roads) {
    if (r.n !== LINK_NAME) continue
    const n = r.p.length
    const d = Math.hypot(land.toSceneX(r.p[n - 2]) - last.x, land.toSceneZ(r.p[n - 1]) - last.z)
    if (d < best) {
      best = d
      road = r
    }
  }
  if (!road || best > 5) return []
  const out: RoadPoint[] = []
  let s = last.s
  let px = last.x
  let pz = last.z
  for (let k = road.p.length - 4; k >= 0; k -= 2) {
    const x = land.toSceneX(road.p[k])
    const z = land.toSceneZ(road.p[k + 1])
    s += Math.hypot(x - px, z - pz)
    out.push({ x, z, w: road.w, s })
    px = x
    pz = z
    if (land.playable(road.p[k], road.p[k + 1], INTO_CITY)) break
  }
  return out
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export { fbm }
