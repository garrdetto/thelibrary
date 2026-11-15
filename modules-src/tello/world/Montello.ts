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
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { GameHost } from '../../rackreel/game/Game'
import type { Mats } from '../../foxlake/fp/core/Tex'
import type { Physics } from '../../foxlake/fp/physics/Physics'
import type { TownGfx } from '../../foxlake/town/TownGfx'
import type { RegionCuller } from '../../foxlake/core/RegionCuller'
import type { TelloLand } from '../region'
import { buildGround, GROUND_CHUNK } from './Ground'
import { Water } from './Water'
import { bridgeSolids, buildBridges, buildRoads } from './Roads'
import { buildStreetPaint } from './StreetPaint'
import { BUILDING_CELL, buildBuildings, type ApartBuilding } from './Buildings'
import { buildBarricades } from './Barricades'
import { buildGuardrails } from './Guardrails'
import { buildStorefronts } from './Storefronts'
import { buildStreetDressing } from './StreetDressing'
import { buildIntersection, type Intersection } from './Intersection'
import { buildFalls, type Falls } from './Falls'
import { buildCornerGarage } from './CornerGarage'
import { buildLandmarks } from './Landmarks'
import { KIT_URL, ModelKit } from './Kit'
import { roadIndex, roadNameAt } from '../town/Routes'
import { shiftedPhysics, type Shift, type StaticSink } from './Sink'
import { Forest, PLANT_RADIUS } from './Forest'

const NAME_CELL = 64
const WALL_HEIGHT = 30
/** How far past what is seen the ground stays solid (the play grid reads no further out than 254 m), and how deep it sinks beyond. */
const GROUND_REACH = 8
const SUNK = 80

export interface MontelloSetup {
  host: GameHost
  physics: Physics
  /** Tello's town frame to the host's physics frame. */
  shift: Shift
  mats: Mats
  gfx: TownGfx
  culler: RegionCuller
  /** Leaves the playable area's edge open within `r` metres of this spot (map coordinates), where a host world's road comes in. */
  openExit: { x: number; z: number; r: number } | null
  /** Houses (Tello building indexes) on lots a player can buy: built on their own, so they come down when bought. */
  lotHouses?: ReadonlySet<number>
}

export class Montello {
  readonly root: TransformNode
  private readonly sink: StaticSink
  private water: Water | null = null
  private junction: Intersection | null = null
  private falls: Falls | null = null
  private forest: Forest | null = null
  private readonly nameIndex: Map<number, number[]>
  private lotHouses = new Map<number, ApartBuilding>()
  private readonly cleared = new Set<number>()

  constructor(readonly land: TelloLand, private readonly s: MontelloSetup) {
    this.root = new TransformNode('tello-town', s.host.ctx.scene)
    this.root.position.set(land.offset.x, 0, land.offset.z)
    this.root.scaling.set(1, 1, -1)
    this.root.computeWorldMatrix(true)
    this.sink = shiftedPhysics(s.physics, s.shift)
    this.nameIndex = roadIndex(land.doc.roads, NAME_CELL)
  }

  private solidsBuilt = false
  /** How the last `build` was cut up: slices run and the longest one (ms of work in one frame). */
  readonly buildStats = { slices: 0, longestMs: 0, longest: '' }

  /**
   * Montello's ground and edge walls in the physics world only. Quick, and a host world calls it while loading, so
   * cars can drive into Montello before its buildings are drawn (`build` adds the rest as the game runs).
   */
  buildSolids(): void {
    if (this.solidsBuilt) return
    this.solidsBuilt = true
    this.addGround()
    this.addWalls()
  }

  /**
   * Builds everything while a host world keeps running: the work is cut into slices of a few milliseconds with a frame
   * between them (`pace`), so driving and turning stay smooth while Montello goes up.
   */
  async build(progress: (share: number, text: string) => void = () => {}): Promise<void> {
    const { land, s } = this
    const { scene } = s.host.ctx
    const pace = paced(SLICE_MS, this.buildStats)
    progress(0, 'Surveying Montello…')
    this.buildSolids()
    await pace('buildSolids')
    const kits = Promise.all([ModelKit.load(scene, KIT_URL.downtown), ModelKit.load(scene, KIT_URL.quarry)])
    const ground = await buildGround(scene, land, () => pace())
    await pace('buildGround')
    this.water = new Water(s.host.ctx, land)
    await pace('water')
    const roads = [...buildRoads(scene, land), ...buildStreetPaint(scene, land)]
    await pace('buildRoads')
    const bridges = buildBridges(scene, land, (mesh) => s.gfx.addCaster(mesh))
    for (const b of bridgeSolids(land)) this.sink.addStaticBox({ cx: b.x, cy: b.y, cz: -b.z, hx: b.across, hy: b.up, hz: b.along, rotY: Math.atan2(Math.sin(b.heading), -Math.cos(b.heading)) })
    progress(0.4, 'Raising the town…')
    await pace('buildBridges')
    this.lotHouses = (await buildBuildings(this.root, s.mats, this.sink, land, s.lotHouses, () => pace())).apart
    for (const index of this.cleared) this.clearHouse(index)
    const [downtownKit, quarryKit] = await kits
    await pace('kits')
    buildBarricades(this.root, s.mats, this.sink, land, s.openExit)
    await pace('buildBarricades')
    buildGuardrails(this.root, s.mats, this.sink, land)
    await pace('buildGuardrails')
    await buildStorefronts(this.root, s.mats, land, downtownKit, () => pace())
    await pace('buildStorefronts')
    await buildLandmarks(this.root, s.mats, this.sink, land)
    await pace('buildLandmarks')
    buildCornerGarage(this.root, s.mats, this.sink, land)
    await pace('buildCornerGarage')
    buildStreetDressing(this.root, s.mats, this.sink, land)
    await pace('buildStreetDressing')
    this.junction = buildIntersection(this.root, s.mats, this.sink, land)
    await pace('buildIntersection')
    this.falls = buildFalls(this.root, s.mats, this.sink, land, quarryKit)
    progress(0.8, 'Planting the trees…')
    await pace('buildFalls')
    this.forest = new Forest(land, (spots, size) => s.host.foliage.plantTrees(spots, size), this.sink)
    const start = land.holdsScene(s.host.player.x, s.host.player.z) ? { x: land.toMapX(s.host.player.x), z: land.toMapZ(s.host.player.z) } : { x: 0, z: 0 }
    await this.forest.plantAround(start.x, start.z, PLANT_RADIUS, () => pace())
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
    const still = this.root.getChildMeshes(false).filter((m) => m.isWorldMatrixFrozen)
    this.s.culler.addByCell(still, BUILDING_CELL)
    // Once on the GPU, the town's still, unpickable meshes need no copy of their vertices in memory.
    for (const m of still) if (!m.isPickable && m instanceof Mesh) m.geometry?.clearCachedData()
  }

  update(dt: number, focus?: { x: number; z: number }): void {
    const at = focus ?? this.s.host.driving?.position ?? this.s.host.player
    this.forest?.update(dt, at.x, at.z)
    this.water?.update(dt, this.s.host.lighting)
    this.junction?.update(dt)
    this.falls?.update(dt)
  }

  /**
   * The ground as one Rapier heightfield, sunk out of the way past what is seen of Montello, so a host world's own land
   * can lie inside the map's square there.
   */
  private addGround(): void {
    const land = this.land
    const n = land.side - 1
    const heights = new Float32Array(land.side * land.side)
    const ground = land.grids.ground
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const row = n - j
        const seen = land.seen(land.x0 + i * land.cell, land.z0 + row * land.cell, -GROUND_REACH)
        heights[i + j * land.side] = ground[row * land.side + i] / 100 - (seen ? 0 : SUNK)
      }
    }
    this.sink.addHeightfield(n, land.size, heights, land.x0 + land.size / 2, -(land.z0 + land.size / 2))
  }

  /** Invisible walls along the playable area's edge, so nothing drives out of town (the way in from Fox Lake stays open). */
  private addWalls(): void {
    const land = this.land
    const ring = land.doc.limits.play
    const n = ring.length / 2
    const open = this.s.openExit
    for (let k = 0; k < n; k++) {
      const ax = ring[k * 2]
      const az = ring[k * 2 + 1]
      const bx = ring[((k + 1) % n) * 2]
      const bz = ring[((k + 1) % n) * 2 + 1]
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 0.05) continue
      const mx = (ax + bx) / 2
      const mz = (az + bz) / 2
      if (open && Math.hypot(mx - open.x, mz - open.z) < open.r) continue
      const ground = Math.min(land.groundAt(ax, az), land.groundAt(bx, bz), land.groundAt(mx, mz))
      this.sink.addStaticBox({ cx: mx, cy: ground - 4 + WALL_HEIGHT / 2, cz: -mz, hx: len / 2 + 0.4, hy: WALL_HEIGHT / 2, hz: 0.5, rotY: Math.atan2(bz - az, bx - ax) })
    }
  }

  /** Takes down the scanned house on a lot that has been bought (a building index from `lotHouses`), solids and all. */
  clearHouse(index: number): void {
    this.cleared.add(index)
    const house = this.lotHouses.get(index)
    if (!house) return
    house.node.setEnabled(false)
    for (const solid of house.solids) this.sink.removeStatic(solid)
    house.solids.length = 0
  }

  /** Trunks become solid for cars as anything that drives comes within about 50 m of them (points in the physics frame). */
  solidTrees(points: readonly { x: number; z: number }[]): void {
    if (!this.forest) return
    const { shift } = this.s
    this.forest.solidTrees(points.map((p) => ({ x: p.x - shift.x, z: -(p.z - shift.z) })))
  }

  get solidTreeCells(): number {
    return this.forest?.solidCells ?? 0
  }

  /** Tree counts: baked crowns, infill added so far, stands planted of those that hold trees. */
  get treeStats(): { baked: number; infill: number; plantedStands: number; stands: number } {
    const f = this.forest
    return { baked: f?.bakedCount ?? 0, infill: f?.infilled ?? 0, plantedStands: f?.plantedStands ?? 0, stands: f?.standCount ?? 0 }
  }

  /** Pushes a walker at a scene point out of the trunks around it; true when it moved. */
  pushTrees(p: { x: number; z: number }, r: number): boolean {
    if (!this.forest) return false
    const moved = this.forest.push(this.land.toMapX(p.x), this.land.toMapZ(p.z), r)
    if (!moved) return false
    p.x = this.land.toSceneX(moved.x)
    p.z = this.land.toSceneZ(moved.z)
    return true
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


function frame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()))
}

/** Work slices while Montello builds in a running game: about a third of a 60 fps frame each. */
const SLICE_MS = 8

/** Yields a frame whenever more than `ms` of work has run since the last one; `stats` records the slices. */
function paced(ms: number, stats: { slices: number; longestMs: number; longest: string }): (step?: string) => Promise<void> {
  let since = performance.now()
  return async (step?: string) => {
    const always = step !== undefined
    const ran = performance.now() - since
    if (ran < ms && !always) return
    stats.slices++
    if (ran > stats.longestMs) {
      stats.longestMs = Math.round(ran)
      stats.longest = step ?? 'slice'
    }
    await frame()
    since = performance.now()
  }
}

export type { Mesh }
