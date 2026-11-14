/**
 * Montello inside the city limits, built into any host world on Fox Lake's engine: the surveyed ground, the water at
 * every level, the roads and bridges, every building on its real footprint, a tree under every crown in the lidar, the
 * walls at the edge of the playable area and the barricades where roads leave it.
 *
 * Everything is laid out in Tello's town frame (map x, height, -map z), the frame Fox Lake's builders and Rapier
 * world use. `shift` moves that frame into the host's physics frame: zero in Tello, where Montello is the whole world,
 * and a fixed offset in Fox Lake, whose physics uses Fox Plains' town frame. The drawn meshes always sit at the same
 * scene position (the map centre a whole map width north of the origin), which Rack & Reel's water shader needs.
 */
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { GameHost } from '../../rackreel/game/Game'
import type { Mats } from '../../foxlake/fp/core/Tex'
import type { Physics } from '../../foxlake/fp/physics/Physics'
import type { TownGfx } from '../../foxlake/town/TownGfx'
import type { RegionCuller } from '../../foxlake/core/RegionCuller'
import type { TelloLand } from '../region'
import { buildGround, GROUND_CHUNK } from './Ground'
import { Water } from './Water'
import { bridgeSolids, buildBridges, buildRoads } from './Roads'
import { buildBuildings } from './Buildings'
import { buildBarricades } from './Barricades'
import { roadIndex, roadNameAt } from '../town/Routes'
import { shiftedPhysics, type Shift, type StaticSink } from './Sink'

const TREE_KINDS = ['pine', 'hardwood', 'birch'] as const
const TREE_RADIUS = [0.34, 0.42, 0.25]
/** Each tree model's height at scale 1, so a tree stands as tall as the lidar measured it. */
const TREE_MODEL_HEIGHT = [16.2, 11.87, 11.89]
const TREE_CELL = 16
const NAME_CELL = 64
/** Ends of the walls at the playable area's edge closer than this to the map's south edge leave County Highway F open. */
const LINK_EDGE = 0.8
const WALL_HEIGHT = 30

export interface MontelloSetup {
  host: GameHost
  physics: Physics
  /** Tello's town frame to the host's physics frame. */
  shift: Shift
  mats: Mats
  gfx: TownGfx
  culler: RegionCuller
  /** Leaves the playable area open where County Highway F meets the map's south edge (Fox Lake's road comes in there). */
  openLink: boolean
}

export class Montello {
  readonly root: TransformNode
  private readonly sink: StaticSink
  private water: Water | null = null
  private readonly treeCells = new Map<number, number[]>()
  private readonly treeSolid = new Set<number>()
  private readonly nameIndex: Map<number, number[]>

  constructor(readonly land: TelloLand, private readonly s: MontelloSetup) {
    this.root = new TransformNode('tello-town', s.host.ctx.scene)
    this.root.position.set(land.offset.x, 0, land.offset.z)
    this.root.scaling.set(1, 1, -1)
    this.root.computeWorldMatrix(true)
    this.sink = shiftedPhysics(s.physics, s.shift)
    this.nameIndex = roadIndex(land.doc.roads, NAME_CELL)
  }

  /** Builds everything (call while the host world loads, before Rack & Reel lays out its tree stands). */
  async build(progress: (share: number, text: string) => void = () => {}): Promise<void> {
    const { land, s } = this
    const { scene } = s.host.ctx
    progress(0, 'Surveying Montello…')
    this.addGround()
    this.addWalls()
    const ground = buildGround(scene, land)
    this.water = new Water(s.host.ctx, land)
    const roads = buildRoads(scene, land)
    const bridges = buildBridges(scene, land, (mesh) => s.gfx.addCaster(mesh))
    for (const b of bridgeSolids(land)) this.sink.addStaticBox({ cx: b.x, cy: b.y, cz: -b.z, hx: b.across, hy: b.up, hz: b.along, rotY: Math.atan2(Math.sin(b.heading), -Math.cos(b.heading)) })
    progress(0.4, 'Raising the town…')
    await frame()
    buildBuildings(this.root, s.mats, this.sink, land)
    buildBarricades(this.root, s.mats, this.sink, land)
    progress(0.8, 'Planting the trees…')
    await frame()
    this.plantTrees()
    const chunk = GROUND_CHUNK * land.cell
    for (const m of [...ground, ...this.water.meshes]) {
      const c = m.getBoundingInfo().boundingBox.centerWorld
      s.culler.addGroup([m], c.x, c.z, chunk * 0.71)
    }
    for (const m of [...roads, ...bridges]) {
      const b = m.getBoundingInfo().boundingBox
      s.culler.addGroup([m], b.centerWorld.x, b.centerWorld.z, Math.hypot(b.extendSizeWorld.x, b.extendSizeWorld.z))
    }
  }

  /** Hands the town's static meshes to the culler (call once the builders have frozen them). */
  ready(): void {
    this.s.culler.addByCell(this.root.getChildMeshes(false).filter((m) => m.isWorldMatrixFrozen), 192)
  }

  update(dt: number): void {
    this.water?.update(dt, this.s.host.lighting)
  }

  /** The ground as one Rapier heightfield. */
  private addGround(): void {
    const land = this.land
    const n = land.side - 1
    const heights = new Float32Array(land.side * land.side)
    const ground = land.grids.ground
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) heights[i + j * land.side] = ground[(n - j) * land.side + i] / 100
    this.sink.addHeightfield(n, land.size, heights, land.x0 + land.size / 2, -(land.z0 + land.size / 2))
  }

  /** Invisible walls along the playable area's edge, so nothing drives out of town (the way in from Fox Lake stays open). */
  private addWalls(): void {
    const land = this.land
    const ring = land.doc.limits.play
    const n = ring.length / 2
    const south = land.z0
    for (let k = 0; k < n; k++) {
      const ax = ring[k * 2]
      const az = ring[k * 2 + 1]
      const bx = ring[((k + 1) % n) * 2]
      const bz = ring[((k + 1) % n) * 2 + 1]
      if (this.s.openLink && az - south < LINK_EDGE && bz - south < LINK_EDGE) continue
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 0.05) continue
      const mx = (ax + bx) / 2
      const mz = (az + bz) / 2
      const ground = Math.min(land.groundAt(ax, az), land.groundAt(bx, bz), land.groundAt(mx, mz))
      this.sink.addStaticBox({ cx: mx, cy: ground - 4 + WALL_HEIGHT / 2, cz: -mz, hx: len / 2 + 0.4, hy: WALL_HEIGHT / 2, hz: 0.5, rotY: Math.atan2(bz - az, bx - ax) })
    }
  }

  private plantTrees(): void {
    const land = this.land
    const { treeX, treeZ, treeS } = land.grids
    const spots: { x: number; y: number; z: number; kind: 'pine' | 'hardwood' | 'birch'; scale: number; yaw: number }[] = []
    for (let i = 0; i < treeX.length; i++) {
      const x = land.x0 + treeX[i] / 10
      const z = land.z0 + treeZ[i] / 10
      const kind = Math.min(2, treeS[i] >> 6)
      const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
      spots.push({ x: land.toSceneX(x), y: land.groundAt(x, z), z: land.toSceneZ(z), kind: TREE_KINDS[kind], scale: this.treeScale(i), yaw: (h - Math.floor(h)) * Math.PI * 2 })
      const key = treeKey(x, z)
      let list = this.treeCells.get(key)
      if (!list) this.treeCells.set(key, (list = []))
      list.push(i)
    }
    this.s.host.foliage.plantTrees(spots)
  }

  /** The model scale that makes tree `i` its measured height. */
  private treeScale(i: number): number {
    const g = this.land.grids
    return Math.min(2.6, Math.max(0.3, g.treeH[i] / 4 / TREE_MODEL_HEIGHT[Math.min(2, g.treeS[i] >> 6)]))
  }

  private trunk(i: number): { x: number; z: number; r: number } {
    const g = this.land.grids
    return { x: this.land.x0 + g.treeX[i] / 10, z: this.land.z0 + g.treeZ[i] / 10, r: TREE_RADIUS[Math.min(2, g.treeS[i] >> 6)] * this.treeScale(i) + 0.2 }
  }

  /** Trunks become solid for cars as anything that drives comes within about 50 m of them (points in the physics frame). */
  solidTrees(points: readonly { x: number; z: number }[]): void {
    const { shift } = this.s
    for (const p of points) {
      const mx = p.x - shift.x
      const mz = -(p.z - shift.z)
      if (!this.land.inside(mx, mz, -60)) continue
      for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3; j++) {
          const key = treeKey(mx + i * TREE_CELL, mz + j * TREE_CELL)
          if (this.treeSolid.has(key)) continue
          this.treeSolid.add(key)
          const list = this.treeCells.get(key)
          if (!list) continue
          for (const t of list) {
            const tr = this.trunk(t)
            this.sink.addStaticCylinder(tr.x, this.land.groundAt(tr.x, tr.z) + 2, -tr.z, 2.6, tr.r)
          }
        }
      }
    }
  }

  get solidTreeCells(): number {
    return this.treeSolid.size
  }

  /** Pushes a walker at a scene point out of the trunks around it; true when it moved. */
  pushTrees(p: { x: number; z: number }, r: number): boolean {
    const land = this.land
    let mx = land.toMapX(p.x)
    let mz = land.toMapZ(p.z)
    let hit = false
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.treeCells.get(treeKey(mx + i * TREE_CELL, mz + j * TREE_CELL))
        if (!list) continue
        for (const t of list) {
          const tr = this.trunk(t)
          const dx = mx - tr.x
          const dz = mz - tr.z
          const d = Math.hypot(dx, dz)
          const min = tr.r + r
          if (d < min && d > 1e-4) {
            mx = tr.x + (dx / d) * min
            mz = tr.z + (dz / d) * min
            hit = true
          }
        }
      }
    }
    if (hit) {
      p.x = land.toSceneX(mx)
      p.z = land.toSceneZ(mz)
    }
    return hit
  }

  /** The street, place or water at a scene point. */
  placeName(x: number, z: number): string {
    const land = this.land
    if (!land.holdsScene(x, z)) return 'Montello'
    const mx = land.toMapX(x)
    const mz = land.toMapZ(z)
    const road = roadNameAt(land.doc.roads, this.nameIndex, NAME_CELL, mx, mz)
    if (road) return road
    let near: string | null = null
    let bd = 70
    for (const poi of land.doc.pois) {
      if (poi.k === 'water') continue
      const d = Math.hypot(poi.x - mx, poi.z - mz)
      if (d < bd) {
        bd = d
        near = poi.n
      }
    }
    if (near) return near
    const level = land.waterAt(mx, mz)
    if (level !== null) {
      // The named water at this level (each lake and river reach has its own), nearest first.
      let water = 'The water'
      let best = Infinity
      for (const poi of land.doc.pois) {
        if (poi.k !== 'water') continue
        const at = land.waterAt(poi.x, poi.z)
        const score = Math.hypot(poi.x - mx, poi.z - mz) + (at !== null && Math.abs(at - level) < 0.12 ? 0 : 5000)
        if (score < best) {
          best = score
          water = poi.n
        }
      }
      return water
    }
    return land.playAt(mx, mz) > 0 ? 'Montello' : 'Outside the city limits'
  }
}

function treeKey(x: number, z: number): number {
  return (Math.floor(x / TREE_CELL) + 4096) * 8192 + Math.floor(z / TREE_CELL) + 4096
}

function frame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()))
}

export type { Mesh }
