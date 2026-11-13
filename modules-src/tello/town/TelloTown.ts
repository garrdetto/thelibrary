/**
 * Tello: Montello, Wisconsin as a host world on Fox Lake's engine.
 *
 * Rack & Reel's game supplies the renderer, sky, sun and moon, fog, the
 * skinned hunter with his animations and the character creator, the grass and
 * the trees; Fox Lake's town code (fp/) supplies the building finishes, the
 * Rapier world and the cars. This file lays Montello under them: the surveyed
 * ground, every road and bridge, every lake, river and pond at its own level,
 * every building on its real footprint, and a tree under every crown in the
 * aerial photo. It runs on this device only (no shared world); Rack & Reel's
 * hunting party still shows friends on foot.
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { GameExtension, GameHost } from '../../rackreel/game/Game'
import type { MapMarker } from '../../rackreel/ui/Minimap'
import type { ControlRow } from '../../rackreel/ui/Controls'
import { STAND_SIZE } from '../../rackreel/world/Foliage'
import { setHostRoot, setRenderer } from '../../foxlake/fp/core/Geo'
import { Mats, setAnisotropy } from '../../foxlake/fp/core/Tex'
import { Assets } from '../../foxlake/fp/core/Assets'
import { Physics } from '../../foxlake/fp/physics/Physics'
import { VehicleModels } from '../../foxlake/fp/physics/VehicleModels'
import { Cars, type Car } from '../../foxlake/town/Cars'
import { TownGfx } from '../../foxlake/town/TownGfx'
import { RegionCuller } from '../../foxlake/core/RegionCuller'
import { STARTER_TRUCK, VEHICLES } from '../../maplestreet/shared/Economy'
import { TUNING } from '../../maplestreet/shared/Vehicles'
import type { TelloLand } from '../region'
import { EDGE_MARGIN } from '../region'
import { buildGround, GROUND_CHUNK } from '../world/Ground'
import { Water } from '../world/Water'
import { bridgeSolids, buildBridges, buildRoads } from '../world/Roads'
import { buildBuildings } from '../world/Buildings'
import { TelloMap } from './TelloMap'
import { roadIndex, roadNameAt } from './Routes'

const STEP = 1 / 60
const MAX_STEPS = 4
const CULL_REACH = 640
const GARAGE_KEY = 'KeyV'
const HOME_KEY = 'KeyH'
const TREE_KINDS = ['pine', 'hardwood', 'birch'] as const
const TREE_RADIUS = [0.34, 0.42, 0.25]
/** Each tree model's height at scale 1, so a tree stands as tall as the lidar measured it. */
const TREE_MODEL_HEIGHT = [16.2, 11.87, 11.89]
const TREE_CELL = 16
const NAME_CELL = 64
/** Water this deep under a car slows it; this deep floods the engine and it is towed back to dry ground. */
const WADE_DRAG_DEPTH = 0.25
const FLOOD_DEPTH = 0.85
const TOW_AFTER = 1.6
/** What V brings out, after the pickup. */
const GARAGE = ['hdtruck', 'coupe', 'sedan', 'golfcart', 'atv', 'mower', 'zeroturn']
const EMPTY: readonly AbstractMesh[] = []

interface Wet { dry: { x: number; z: number; yaw: number } | null; flooded: number }

export class TelloTown implements GameExtension {
  private host!: GameHost
  private root!: TransformNode
  private gfx!: TownGfx
  private physics!: Physics
  private mats!: Mats
  private assets!: Assets
  private models!: VehicleModels
  private cars!: Cars
  private water!: Water
  private map: TelloMap | null = null
  private acc = 0
  private readonly culler = new RegionCuller(CULL_REACH)
  private readonly focusPts: { x: number; z: number }[] = []
  private readonly treeCells = new Map<number, number[]>()
  private readonly treeSolid = new Set<number>()
  private readonly nameIndex: Map<number, number[]>
  private readonly wet = new Map<Car, Wet>()
  private extraKind: string | null = null
  private home: { x: number; z: number; heading: number }
  private statusAcc = 0
  private lastStatus = ''

  constructor(private readonly land: TelloLand) {
    this.nameIndex = roadIndex(land.doc.roads, NAME_CELL)
    this.home = this.findHome()
  }

  // ------------------------------------------------------------ frames

  /** Town coordinates (what the builders and the physics use) from a scene point. */
  private townX(sceneX: number): number { return this.land.toMapX(sceneX) }
  private townZ(sceneZ: number): number { return -this.land.toMapZ(sceneZ) }

  /** Where play starts: the kerb of the main street nearest the map's origin (City Hall), facing along it. */
  private findHome(): { x: number; z: number; heading: number } {
    let best = { x: 0, z: 0, heading: 0 }
    let bd = Infinity
    for (const road of this.land.doc.roads) {
      if (road.k > 1) continue
      const p = road.p
      for (let k = 0; k + 3 < p.length; k += 2) {
        const mx = (p[k] + p[k + 2]) / 2
        const mz = (p[k + 1] + p[k + 3]) / 2
        const d = Math.hypot(mx, mz) + (road.k === 0 ? 0 : 40)
        const dx = p[k + 2] - p[k]
        const dz = p[k + 3] - p[k + 1]
        const len = Math.hypot(dx, dz)
        if (d >= bd || len < 6) continue
        const side = road.w / 2 + 1.6
        const x = mx + (dz / len) * side
        const z = mz - (dx / len) * side
        if (this.land.clearAt(x, z) < 0.6 || this.land.depthAt(x, z) > 0) continue
        bd = d
        best = { x, z, heading: Math.atan2(dx, dz) }
      }
    }
    return best
  }

  // ------------------------------------------------------------ build

  async build(host: GameHost): Promise<void> {
    this.host = host
    const land = this.land
    const { scene } = host.ctx
    host.hud.setLoading(0.7, 'Surveying Montello…')
    this.gfx = new TownGfx(scene, (mesh, add) => (add ? host.addCaster(mesh) : host.removeCaster(mesh)), (x, _y, z) => ({ x: this.townX(x), z: this.townZ(z) }))
    setRenderer(this.gfx)
    setAnisotropy(8)
    this.root = new TransformNode('tello-town', scene)
    this.root.position.set(land.offset.x, 0, land.offset.z)
    this.root.scaling.set(1, 1, -1)
    this.root.computeWorldMatrix(true)
    setHostRoot(this.root)
    this.physics = await Physics.create()
    this.addGround()
    this.assets = new Assets(scene)
    this.mats = new Mats(scene)
    const ground = buildGround(scene, land)
    this.water = new Water(host.ctx, land)
    const roads = buildRoads(scene, land)
    const bridges = buildBridges(scene, land, (mesh) => this.gfx.addCaster(mesh))
    for (const b of bridgeSolids(land)) this.physics.addStaticBox({ cx: b.x, cy: b.y, cz: -b.z, hx: b.across, hy: b.up, hz: b.along, rotY: Math.atan2(Math.sin(b.heading), -Math.cos(b.heading)) })
    host.hud.setLoading(0.76, 'Raising the town…')
    await new Promise((r) => requestAnimationFrame(r))
    buildBuildings(this.root, this.mats, this.physics, land)
    host.hud.setLoading(0.8, 'Planting the trees…')
    await new Promise((r) => requestAnimationFrame(r))
    this.plantTrees()
    this.models = new VehicleModels(this.assets)
    host.foliage.hostCasters = (focus) => (land.holdsScene(focus.x, focus.z) ? this.gfx.near(focus) : EMPTY)
    const chunk = GROUND_CHUNK * land.cell
    for (const m of [...ground, ...this.water.meshes]) {
      const c = m.getBoundingInfo().boundingBox.centerWorld
      this.culler.addGroup([m], c.x, c.z, chunk * 0.71)
    }
    for (const m of [...roads, ...bridges]) {
      const b = m.getBoundingInfo().boundingBox
      this.culler.addGroup([m], b.centerWorld.x, b.centerWorld.z, Math.hypot(b.extendSizeWorld.x, b.extendSizeWorld.z))
    }
  }

  /** The ground as one Rapier heightfield (town coordinates), walled at the map's edge. */
  private addGround(): void {
    const land = this.land
    const n = land.side - 1
    const heights = new Float32Array(land.side * land.side)
    const ground = land.grids.ground
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) heights[i + j * land.side] = ground[(n - j) * land.side + i] / 100
    const cx = land.x0 + land.size / 2
    const cz = -(land.z0 + land.size / 2)
    this.physics.addHeightfield(n, land.size, heights, cx, cz)
    const half = land.size / 2 - EDGE_MARGIN + 8
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      this.physics.addStaticBox({ cx: cx + dx * (half + 1), cy: 30, cz: cz + dz * (half + 1), hx: dx ? 1 : half + 2, hy: 60, hz: dz ? 1 : half + 2 })
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
      const scale = this.treeScale(i)
      const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
      spots.push({ x: land.toSceneX(x), y: land.groundAt(x, z), z: land.toSceneZ(z), kind: TREE_KINDS[kind], scale, yaw: (h - Math.floor(h)) * Math.PI * 2 })
      const key = this.treeKey(x, z)
      let list = this.treeCells.get(key)
      if (!list) this.treeCells.set(key, (list = []))
      list.push(i)
    }
    this.host.foliage.plantTrees(spots)
  }

  private treeKey(x: number, z: number): number {
    return (Math.floor(x / TREE_CELL) + 4096) * 8192 + Math.floor(z / TREE_CELL) + 4096
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

  /** Trunks become solid for cars as anything that drives comes within about 50 m of them. */
  private solidTrees(points: readonly { x: number; z: number }[]): void {
    for (const p of points) {
      const mx = p.x
      const mz = -p.z
      for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3; j++) {
          const key = this.treeKey(mx + i * TREE_CELL, mz + j * TREE_CELL)
          if (this.treeSolid.has(key)) continue
          this.treeSolid.add(key)
          const list = this.treeCells.get(key)
          if (!list) continue
          for (const t of list) {
            const tr = this.trunk(t)
            this.physics.addStaticCylinder(tr.x, this.land.groundAt(tr.x, tr.z) + 2, -tr.z, 2.6, tr.r)
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ ready

  async ready(host: GameHost): Promise<void> {
    const scene = host.ctx.scene
    const sky = scene.getMeshByName('sky') as Mesh | null
    if (sky) this.gfx.bakeSky(sky)
    this.cars = new Cars(scene, this.physics, this.models, host.vehicles)
    await this.models.preload(STARTER_TRUCK).catch(() => null)
    const h = this.home
    const fx = Math.sin(h.heading)
    const fz = Math.cos(h.heading)
    this.park(this.cars.add(STARTER_TRUCK, 0, 0, 0, null), h.x + fx * 7, h.z + fz * 7, h.heading)
    this.culler.addByCell(this.root.getChildMeshes(false).filter((m) => m.isWorldMatrixFrozen), 192)
    for (const stand of host.foliage.stands) this.culler.addGroup(stand.meshes, stand.center.x, stand.center.z, STAND_SIZE * 0.72)
    this.map = new TelloMap({
      land: this.land,
      where: () => {
        const v = host.driving
        const at = v ? v.position : host.player
        return { x: this.land.toMapX(at.x), z: this.land.toMapZ(at.z), heading: v ? v.heading : host.facing }
      },
      toast: (text) => host.hud.toast(text),
      canvas: host.ctx.engine.getRenderingCanvas(),
    })
    addEventListener('keydown', (e) => this.key(e))
    const spawn = this.spawn()
    host.teleport(spawn.at, spawn.facing)
    host.ctx.camera.rotation.set(0.18, spawn.facing, 0)
    // Rack & Reel's lake country stands sealed and out of sight far to the south: its scenery (ground, water, cabin,
    // boats, stands, game and Wild Man's camp) is switched off for good. Chosen by name as well as by place, so
    // nothing of the player's (whose meshes can still report the origin right after the move) is caught.
    const countryNames = /^(terrain|water|dock|highway|bridge|weed|cabin|boat|bowboat|utv|treestand|boxblind|deer|bear|antlers|fish-|wildman|wild-|fx-)/
    const country = scene.meshes.filter((m) => {
      if (m.infiniteDistance || !m.isEnabled() || !countryNames.test(m.name)) return false
      const c = m.getBoundingInfo().boundingBox.centerWorld
      return Math.hypot(c.x, c.z) < 760
    })
    this.culler.addGroup(country, 0, 0, 760)
    this.culler.update(0, host.ctx.camera.globalPosition, true)
  }

  /** Sets a car down on the ground at a map point, heading along `heading` (0 = north, clockwise). */
  private park(car: Car, x: number, z: number, heading: number): void {
    const yaw = Math.PI / 2 - heading
    car.fp.place(x, -z, yaw)
    const t = car.fp.body.translation()
    car.fp.body.setTranslation({ x: t.x, y: t.y + this.land.heightAt(x, z), z: t.z }, true)
    this.physics.snapTracked(car.fp.body)
    this.physics.wake(x, -z, 40)
    this.cars.sync(car)
  }

  // ------------------------------------------------------------ per frame

  update(dt: number): void {
    if (!this.cars) return
    this.acc += dt
    let steps = 0
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.fixed(STEP)
      this.acc -= STEP
      steps++
    }
    if (steps === MAX_STEPS) this.acc = 0
    this.physics.interpolate(this.acc / STEP)
    this.cars.syncAll()
    const night = this.host.lighting.night
    this.cars.visuals(night)
    this.mats.setNight(night)
    this.gfx.update(night, this.host.clock.sky.glow)
    this.water.update(dt, this.host.lighting)
    this.culler.update(dt, this.host.ctx.camera.globalPosition)
    this.map?.update(dt)
    this.statusAcc -= dt
    if (this.statusAcc <= 0) {
      this.statusAcc = 0.5
      const at = this.host.driving?.position ?? this.host.player
      const ll = this.land.lonLat(this.land.toMapX(at.x), this.land.toMapZ(at.z))
      const text = `Montello, Wisconsin · ${ll.lat.toFixed(4)}° N ${Math.abs(ll.lon).toFixed(4)}° W`
      if (text !== this.lastStatus) {
        this.lastStatus = text
        const chip = document.getElementById('town-status')
        if (chip) chip.textContent = text
      }
    }
  }

  private fixed(dt: number): void {
    const pts = this.focusPts
    pts.length = 0
    const p = this.host.player
    pts.push({ x: this.townX(p.x), z: this.townZ(p.z) })
    const drive = pts.length
    this.cars.focusPoints(pts)
    this.solidTrees(pts.slice(drive))
    this.physics.stream(pts, dt)
    this.wade(dt)
    this.physics.step(dt)
  }

  /** Cars in the water: drag as it deepens, a flooded engine at door height, then a tow back to dry ground. */
  private wade(dt: number): void {
    for (const car of this.cars.list.values()) {
      let w = this.wet.get(car)
      if (!w) this.wet.set(car, (w = { dry: null, flooded: 0 }))
      const p = car.fp.position
      const depth = this.land.depthAt(p.x, -p.z)
      const body = car.fp.body
      const off = !this.land.inside(p.x, -p.z, EDGE_MARGIN - 10) || p.y < this.land.groundAt(p.x, -p.z) - 3
      if (depth < 0.05 && !off) {
        const f = car.fp.forward()
        if (Math.abs(car.fp.speed) < 25) w.dry = { x: p.x, z: -p.z, yaw: Math.atan2(f.x, -f.z) }
        w.flooded = 0
        continue
      }
      if (depth > WADE_DRAG_DEPTH) {
        const v = body.linvel()
        const k = Math.min(0.9, (depth - WADE_DRAG_DEPTH) * 2.2) * dt * 4
        body.setLinvel({ x: v.x * (1 - k), y: v.y, z: v.z * (1 - k) }, true)
      }
      if (depth > FLOOD_DEPTH || off) {
        if (w.flooded === 0 && this.cars.driving() === car) this.host.hud.toast(off ? 'That is the edge of the map. A tow truck is setting you back on the road.' : 'The engine flooded. A tow truck is pulling you back to dry ground.', 'warn')
        w.flooded += dt
        if (w.flooded > TOW_AFTER || off) {
          const spot = w.dry ?? { x: this.home.x, z: this.home.z, yaw: this.home.heading }
          this.park(car, spot.x, spot.z, spot.yaw + Math.PI)
          w.flooded = 0
        }
      }
    }
  }

  // ------------------------------------------------------------ the walker

  collide(p: Vector3, r: number): void {
    if (!this.physics || !this.land.holdsScene(p.x, p.z)) return
    const q = { x: this.townX(p.x), z: this.townZ(p.z) }
    const hitStatic = this.physics.pushOut(q, p.y, r)
    const hitVehicle = this.physics.pushOutVehicles(q, p.y, r)
    let mx = q.x
    let mz = -q.z
    let hitTree = false
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.treeCells.get(this.treeKey(mx + i * TREE_CELL, mz + j * TREE_CELL))
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
            hitTree = true
          }
        }
      }
    }
    if (!hitStatic && !hitVehicle && !hitTree) return
    p.x = this.land.toSceneX(mx)
    p.z = this.land.toSceneZ(mz)
  }

  obstacle(x: number, z: number, r: number): boolean {
    if (!this.land.holdsScene(x, z)) return false
    return this.physics.blocked(this.townX(x), this.townZ(z), this.land.heightAt(this.land.toMapX(x), this.land.toMapZ(z)), r)
  }

  spawn(): { at: Vector3; facing: number } {
    const h = this.home
    return { at: new Vector3(this.land.toSceneX(h.x), this.land.heightAt(h.x, h.z), this.land.toSceneZ(h.z)), facing: h.heading }
  }

  greeting(): string {
    return 'Welcome to Montello, Wisconsin. Your pickup is parked just ahead: E to drive, Ctrl for the map and directions.'
  }

  placeName(x: number, z: number): string | null {
    if (!this.land.holdsScene(x, z)) return 'Montello'
    const mx = this.land.toMapX(x)
    const mz = this.land.toMapZ(z)
    const road = roadNameAt(this.land.doc.roads, this.nameIndex, NAME_CELL, mx, mz)
    if (road) return road
    let near: string | null = null
    let bd = 70
    for (const poi of this.land.doc.pois) {
      if (poi.k === 'water') continue
      const d = Math.hypot(poi.x - mx, poi.z - mz)
      if (d < bd) {
        bd = d
        near = poi.n
      }
    }
    if (near) return near
    const level = this.land.waterAt(mx, mz)
    if (level !== null) {
      // The named water at this level (each lake and river reach has its own), nearest first.
      let water = 'The water'
      let best = Infinity
      for (const poi of this.land.doc.pois) {
        if (poi.k !== 'water') continue
        const at = this.land.waterAt(poi.x, poi.z)
        const score = Math.hypot(poi.x - mx, poi.z - mz) + (at !== null && Math.abs(at - level) < 0.12 ? 0 : 5000)
        if (score < best) {
          best = score
          water = poi.n
        }
      }
      return water
    }
    return 'Montello'
  }

  // ------------------------------------------------------------ keys and maps

  controls(): ControlRow[] {
    return [
      { keys: ['E'], text: 'Drive your vehicle' },
      { keys: ['V'], text: 'Bring out another vehicle' },
      { keys: ['H'], text: 'Back to Main Street' },
      { keys: ['Ctrl'], text: 'Map of Montello and directions' },
      { keys: ['N'], text: 'Corner map zoom' },
    ]
  }

  private key(e: KeyboardEvent): void {
    if (e.repeat) return
    if (this.map?.open) {
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.map.hide()
      return
    }
    if (!this.host.playing || this.host.hud.modalOpen) return
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.map?.show()
    else if (e.code === GARAGE_KEY) void this.nextVehicle()
    else if (e.code === HOME_KEY) this.goHome()
  }

  /** V: sets the next vehicle beside you (one extra out at a time, beside the pickup). */
  private async nextVehicle(): Promise<void> {
    const host = this.host
    if (host.driving) {
      host.hud.toast('Park and step out first.')
      return
    }
    const kinds = GARAGE.filter((k) => TUNING[k])
    const next = kinds[(this.extraKind ? kinds.indexOf(this.extraKind) + 1 : 0) % kinds.length]
    await this.models.preload(next).catch(() => null)
    if (this.extraKind) this.cars.remove(this.extraKind)
    const x = this.land.toMapX(host.player.x) + Math.sin(host.facing) * 5
    const z = this.land.toMapZ(host.player.z) + Math.cos(host.facing) * 5
    if (this.land.depthAt(x, z) > 0.2 || this.physics.blocked(x, -z, this.land.heightAt(x, z), 2.2)) {
      this.extraKind = null
      host.hud.toast('There is no room here. Step out into the open and press V again.')
      return
    }
    this.park(this.cars.add(next, 0, 0, 0, null), x, z, host.facing + Math.PI / 2)
    this.extraKind = next
    host.hud.toast(`${VEHICLES[next]?.name ?? TUNING[next]?.label ?? next} is out in front of you. V swaps it for the next one.`)
  }

  private goHome(): void {
    if (this.host.driving) {
      this.host.hud.toast('Park and step out first.')
      return
    }
    const spawn = this.spawn()
    this.host.teleport(spawn.at, spawn.facing)
    this.host.hud.toast('Back on Main Street.')
  }

  drawMinimap(dt: number, x: number, z: number, cameraYaw: number, facing: number, markers: () => MapMarker[]): boolean {
    if (!this.map) return false
    const land = this.land
    const here = this.host.driving?.position
    this.map.drawMini(dt, land.toMapX(here?.x ?? x), land.toMapZ(here?.z ?? z), cameraYaw, facing, markers().filter((m) => m.kind === 'friend'), (m) => (land.holdsScene(m.x, m.z) ? { x: land.toMapX(m.x), z: land.toMapZ(m.z) } : null))
    return true
  }

  cycleMinimapZoom(): string {
    return this.map?.cycleZoom() ?? ''
  }

  /** For the console and the capture script. */
  debug(): Record<string, unknown> {
    return { colliders: this.physics.streamStats(), culling: this.culler.stats(), cars: [...this.cars.list.keys()], home: this.home, treeCellsSolid: this.treeSolid.size }
  }
}
