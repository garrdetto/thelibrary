/**
 * Montello's trees. The bake finds every crown in the lidar canopy height model (position, height, conifer or
 * broadleaf) and thins the far woods so the file stays small. This plants them in wide stands, only where the player
 * is or is going (a stand within `PLANT_RADIUS` of the walker or driver), and fills the thinned woods back in at that
 * moment: extra trunks on a jittered grid wherever the canopy grid says forest, never on pavement, walls, water or
 * open ground, and never closer than `INFILL_GAP` to another tree. Fields, lawns and lots stay open because the
 * infill only grows in woods cover. Trunks are solid for cars and walkers (`solidTrees`, `pushTrees`).
 */
import { COVER, treeUnits } from '../data/MapData'
import type { TelloLand } from '../region'
import type { StaticSink } from './Sink'

export const TREE_KINDS = ['pine', 'hardwood', 'birch'] as const
export type TreeKind = (typeof TREE_KINDS)[number]
export const TREE_RADIUS = [0.34, 0.42, 0.25]
/** Each tree model's height at scale 1, so a tree stands as tall as the lidar measured it. */
export const TREE_MODEL_HEIGHT = [16.2, 11.87, 11.89]
export const TREE_CELL = 16
/** Stands are 384 m squares: a few thousand meshes cover the whole map instead of tens of thousands. */
export const TREE_STAND = 384
/** A stand is planted once the walker or driver is this close to its square (the far tree model is culled at 640 m). */
export const PLANT_RADIUS = 720
export const INFILL_SPACING = 6
export const INFILL_GAP = 7.5
/** Infill trunks keep this far from pavement and walls (the bake keeps its own 1.3 m). */
export const INFILL_ROAD = 3.5
export const INFILL_CANOPY = 0.55
const INFILL_DEFAULT_HEIGHT = 13
const GROW_INTERVAL = 0.15

export interface TreeSpot {
  x: number
  y: number
  z: number
  kind: TreeKind
  scale: number
  yaw: number
}

export type PlantTrees = (spots: readonly TreeSpot[], standSize: number) => void

interface Neighbour {
  d: number
  kind: number
  h: number
}

export function treeKey(x: number, z: number): number {
  return (Math.floor(x / TREE_CELL) + 4096) * 8192 + Math.floor(z / TREE_CELL) + 4096
}

function unit(a: number, b: number, salt: number): number {
  const h = Math.sin(a * 12.9898 + b * 78.233 + salt * 37.719) * 43758.5453
  return h - Math.floor(h)
}

export class Forest {
  private readonly cells = new Map<number, number[]>()
  private readonly stands = new Map<number, number[]>()
  private readonly planted = new Set<number>()
  private readonly solid = new Set<number>()
  private readonly units: number
  private readonly baked: number
  private readonly extraX: number[] = []
  private readonly extraZ: number[] = []
  private readonly extraKind: number[] = []
  private readonly extraScale: number[] = []
  private clock = 0
  infilled = 0

  constructor(private readonly land: TelloLand, private readonly plant: PlantTrees, private readonly sink: StaticSink) {
    this.units = treeUnits(land.frame)
    const { treeX, treeZ } = land.grids
    this.baked = treeX.length
    for (let i = 0; i < this.baked; i++) {
      const x = land.x0 + treeX[i] / this.units
      const z = land.z0 + treeZ[i] / this.units
      this.add(this.cells, treeKey(x, z), i)
      this.add(this.stands, this.standOf(land.toSceneX(x), land.toSceneZ(z)), i)
    }
  }

  get plantedStands(): number {
    return this.planted.size
  }

  get standCount(): number {
    return this.stands.size
  }

  get solidCells(): number {
    return this.solid.size
  }

  /** Every tree the map can hold: the baked crowns plus what infill has added so far. */
  get treeCount(): number {
    return this.baked + this.extraX.length
  }

  get bakedCount(): number {
    return this.baked
  }

  private add(map: Map<number, number[]>, key: number, i: number): void {
    const list = map.get(key)
    if (list) list.push(i)
    else map.set(key, [i])
  }

  private standOf(sceneX: number, sceneZ: number): number {
    return this.standKey(Math.floor(sceneX / TREE_STAND), Math.floor(sceneZ / TREE_STAND))
  }

  private standKey(ci: number, cj: number): number {
    return (ci + 4096) * 8192 + cj + 4096
  }

  treeX(i: number): number {
    return i < this.baked ? this.land.x0 + this.land.grids.treeX[i] / this.units : this.extraX[i - this.baked]
  }

  treeZ(i: number): number {
    return i < this.baked ? this.land.z0 + this.land.grids.treeZ[i] / this.units : this.extraZ[i - this.baked]
  }

  treeKind(i: number): number {
    return i < this.baked ? Math.min(2, this.land.grids.treeS[i] >> 6) : this.extraKind[i - this.baked]
  }

  treeScale(i: number): number {
    if (i >= this.baked) return this.extraScale[i - this.baked]
    const kind = this.treeKind(i)
    return Math.min(2.6, Math.max(0.3, this.land.grids.treeH[i] / 4 / TREE_MODEL_HEIGHT[kind]))
  }

  trunk(i: number): { x: number; z: number; r: number } {
    return { x: this.treeX(i), z: this.treeZ(i), r: TREE_RADIUS[this.treeKind(i)] * this.treeScale(i) + 0.2 }
  }

  private spot(i: number): TreeSpot {
    const x = this.treeX(i)
    const z = this.treeZ(i)
    const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
    return { x: this.land.toSceneX(x), y: this.land.groundAt(x, z), z: this.land.toSceneZ(z), kind: TREE_KINDS[this.treeKind(i)], scale: this.treeScale(i), yaw: (h - Math.floor(h)) * Math.PI * 2 }
  }

  /** The nearest tree within a cell's reach (16 m or more) of a map point. */
  private nearest(mx: number, mz: number): Neighbour | null {
    let best: Neighbour | null = null
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const list = this.cells.get(treeKey(mx + a * TREE_CELL, mz + b * TREE_CELL))
        if (!list) continue
        for (const t of list) {
          const d = Math.hypot(this.treeX(t) - mx, this.treeZ(t) - mz)
          if (!best || d < best.d) best = { d, kind: this.treeKind(t), h: t < this.baked ? this.land.grids.treeH[t] / 4 : this.extraScale[t - this.baked] * TREE_MODEL_HEIGHT[this.extraKind[t - this.baked]] }
        }
      }
    }
    return best
  }

  /** The trees the thinned woods lost, grown back in the stand `ci`, `cj` (scene stand indices); deterministic and appended to the tree index. */
  infill(ci: number, cj: number): number[] {
    const land = this.land
    const made: number[] = []
    const n = Math.ceil(TREE_STAND / INFILL_SPACING)
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const sx = ci * TREE_STAND + (a + 0.5 + (unit(ci * 1000 + a, cj * 1000 + b, 1) - 0.5) * 0.85) * INFILL_SPACING
        const sz = cj * TREE_STAND + (b + 0.5 + (unit(ci * 1000 + a, cj * 1000 + b, 2) - 0.5) * 0.85) * INFILL_SPACING
        const mx = land.toMapX(sx)
        const mz = land.toMapZ(sz)
        if (!land.inside(mx, mz, 6) || !land.seen(mx, mz, 30)) continue
        if (land.coverAt(mx, mz) !== COVER.woods || land.canopyAt(mx, mz) < INFILL_CANOPY) continue
        if (land.depthAt(mx, mz) > 0 || land.clearAt(mx, mz) < INFILL_ROAD) continue
        const near = this.nearest(mx, mz)
        if (near && near.d < INFILL_GAP) continue
        const roll = unit(sx, sz, 3)
        const kind = near && near.d < 24 ? near.kind : roll < 0.28 ? 0 : roll > 0.9 ? 2 : 1
        const height = (near && near.d < 24 ? near.h : INFILL_DEFAULT_HEIGHT) * (0.8 + unit(sx, sz, 4) * 0.4)
        const index = this.baked + this.extraX.length
        this.extraX.push(mx)
        this.extraZ.push(mz)
        this.extraKind.push(kind)
        this.extraScale.push(Math.min(2.6, Math.max(0.3, Math.min(40, height) / TREE_MODEL_HEIGHT[kind])))
        this.add(this.cells, treeKey(mx, mz), index)
        made.push(index)
      }
    }
    this.infilled += made.length
    return made
  }

  /** Plants one stand: its baked crowns and the infill. */
  private plantStand(key: number): number {
    if (this.planted.has(key)) return 0
    this.planted.add(key)
    const ci = Math.floor(key / 8192) - 4096
    const cj = (key % 8192) - 4096
    const list = this.stands.get(key) ?? []
    const spots: TreeSpot[] = []
    for (const i of list) spots.push(this.spot(i))
    for (const i of this.infill(ci, cj)) spots.push(this.spot(i))
    if (spots.length) this.plant(spots, TREE_STAND)
    return spots.length
  }

  /** Stands (with trees or woods to fill) whose square is within `radius` of a map point, nearest first. */
  private near(mx: number, mz: number, radius: number): number[] {
    const sx = this.land.toSceneX(mx)
    const sz = this.land.toSceneZ(mz)
    const reach = Math.ceil(radius / TREE_STAND) + 1
    const ci0 = Math.floor(sx / TREE_STAND)
    const cj0 = Math.floor(sz / TREE_STAND)
    const found: { key: number; d: number }[] = []
    for (let a = -reach; a <= reach; a++) {
      for (let b = -reach; b <= reach; b++) {
        const ci = ci0 + a
        const cj = cj0 + b
        const key = this.standKey(ci, cj)
        if (this.planted.has(key)) continue
        const cx = Math.max(ci * TREE_STAND, Math.min((ci + 1) * TREE_STAND, sx))
        const cz = Math.max(cj * TREE_STAND, Math.min((cj + 1) * TREE_STAND, sz))
        const d = Math.hypot(cx - sx, cz - sz)
        if (d > radius) continue
        if (!this.land.seen(this.land.toMapX(cx), this.land.toMapZ(cz), 0) && !this.stands.has(key)) continue
        found.push({ key, d })
      }
    }
    return found.sort((p, q) => p.d - q.d).map((f) => f.key)
  }

  /** Plants every stand within `radius` of a map point (the first ring while the town loads, one slice at a time). */
  async plantAround(mx: number, mz: number, radius: number, pace?: () => Promise<void>): Promise<number> {
    let count = 0
    for (const key of this.near(mx, mz, radius)) {
      if (pace) await pace()
      count += this.plantStand(key)
    }
    return count
  }

  /** Keeps the woods growing in round whoever is moving: at most one stand every `GROW_INTERVAL` seconds. */
  update(dt: number, sceneX: number, sceneZ: number): void {
    this.clock -= dt
    if (this.clock > 0) return
    this.clock = GROW_INTERVAL
    const mx = this.land.toMapX(sceneX)
    const mz = this.land.toMapZ(sceneZ)
    if (!this.land.inside(mx, mz, -200)) return
    const next = this.near(mx, mz, PLANT_RADIUS)[0]
    if (next !== undefined) this.plantStand(next)
  }

  /** Makes sure the stands around a map point are planted now, so their trunks exist when the cells turn solid. */
  ensureAround(mx: number, mz: number, radius: number): void {
    for (const key of this.near(mx, mz, radius)) this.plantStand(key)
  }

  /** Trunks become solid for cars as anything that drives comes within about 50 m of them (points in map coordinates). */
  solidTrees(points: readonly { x: number; z: number }[]): void {
    for (const p of points) {
      if (!this.land.inside(p.x, p.z, -60)) continue
      this.ensureAround(p.x, p.z, 60)
      for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3; j++) {
          const key = treeKey(p.x + i * TREE_CELL, p.z + j * TREE_CELL)
          if (this.solid.has(key)) continue
          this.solid.add(key)
          const list = this.cells.get(key)
          if (!list) continue
          for (const t of list) {
            const tr = this.trunk(t)
            this.sink.addStaticCylinder(tr.x, this.land.groundAt(tr.x, tr.z) + 2, -tr.z, 2.6, tr.r)
          }
        }
      }
    }
  }

  /** Pushes a walker at a map point out of the trunks around it; returns the new point when it moved. */
  push(mx: number, mz: number, r: number): { x: number; z: number } | null {
    let x = mx
    let z = mz
    let hit = false
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.cells.get(treeKey(mx + i * TREE_CELL, mz + j * TREE_CELL))
        if (!list) continue
        for (const t of list) {
          const tr = this.trunk(t)
          const dx = x - tr.x
          const dz = z - tr.z
          const d = Math.hypot(dx, dz)
          const min = tr.r + r
          if (d < min && d > 1e-4) {
            x = tr.x + (dx / d) * min
            z = tr.z + (dz / d) * min
            hit = true
          }
        }
      }
    }
    return hit ? { x, z } : null
  }

  /** Every tree in the 16 m cell around a map point (baked and infill), for tests. */
  treesAround(mx: number, mz: number): number[] {
    return this.cells.get(treeKey(mx, mz)) ?? []
  }
}
