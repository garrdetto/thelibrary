/**
 * Fox Lake's town, mounted on the Rack & Reel game as a host world.
 *
 * The Fox Plains town (lots, streets, downtown, every player's house) is built
 * by the same code Fox Plains 2 used (fp/), under one node that places it
 * north of the lake country and mirrors it into the scene's handedness. It is
 * lit, shadowed and fogged by Rack & Reel's renderer; its trees are Rack &
 * Reel's foliage; its ground is laid the way Rack & Reel lays its own. The
 * town's cars run on Fox Plains' Rapier physics (same handling), which also
 * holds the lake country as a heightfield so a car can drive out to the lake.
 *
 * It joins Fox Lake's own shared world (/api/maplestreet?world=foxlake): the
 * same rules and town as Fox Plains, but its own players, lots, houses and
 * money, so everyone starts fresh here. The shared world's clock drives the sky.
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { GameExtension, GameHost } from '../../rackreel/game/Game'
import { CELL, GRID, HALF } from '../../rackreel/world/Terrain'
import { hourFromSearch } from '../../rackreel/systems/TimeOfDay'
import { setHostRoot, setRenderer } from '../fp/core/Geo'
import { Mats, setAnisotropy } from '../fp/core/Tex'
import { Assets } from '../fp/core/Assets'
import { Physics } from '../fp/physics/Physics'
import { VehicleModels } from '../fp/physics/VehicleModels'
import { Town } from '../fp/world/Town'
import type { TreeSpot } from '../fp/world/Town'
import { Downtown } from '../fp/world/Downtown'
import { Houses } from '../fp/world/Houses'
import { OfflineTransport } from '../../maplestreet/src/net/OfflineTransport'
import { WorldTransport, guestKey, worldEndpoint } from '../../maplestreet/src/net/WorldTransport'
import type { NetStatus, Transport } from '../../maplestreet/src/net/Transport'
import { randomId, store } from '../../maplestreet/src/core/Storage'
import type { ClientMsg, MowStroke, PlayerSnap, ServerMsg } from '../../maplestreet/shared/Protocol'
import type { BuildOp, LotState } from '../../maplestreet/shared/BuildRules'
import type { Account } from '../../maplestreet/shared/Economy'
import { STARTER_TRUCK, VEHICLES } from '../../maplestreet/shared/Economy'
import { ROADS, ROAD_NAMES, SHOP_DOORS, SHOP_RADIUS, SPAWN, lotPrice, makeLots, type LotDef } from '../../maplestreet/shared/WorldLayout'
import { decodeCells, gameDays } from '../../maplestreet/shared/Mowing'
import { Cars } from './Cars'
import { Neighbors } from './Neighbors'
import { TownGfx } from './TownGfx'
import { GROUND_RECT, buildConnector, buildFreightRoads, buildLakeRoad, buildTownGround, fillerTrees } from './TownGround'
import { buildFreightSites } from '../trucking/FreightSites'
import { Fleet } from '../trucking/Fleet'
import { Dispatch } from '../trucking/Dispatch'
import { LANDING, MILL, YARD } from '../../maplestreet/shared/Freight'
import { Wading } from './Wading'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { asphaltTexture } from '../../rackreel/world/Highway'
import { buildRoadside } from '../roadside/RoadsideBuild'
import { RoadsideSigns } from '../roadside/RoadsideSigns'
import { ROADSIDE, doorSpot, roadsideAt, type RoadsidePlace } from '../roadside/RoadsideLayout'
import { addRoadColliders, roadSurface } from '../country/RoadPhysics'
import { buildBarricade } from '../country/Barricade'
import { hitsBarrier, type BarrierSegment } from '../country/Roads'
import { TownHud } from './TownHud'
import { WorldMap } from './WorldMap'
import { Atlas } from './Atlas'
import { FoxMinimap } from './FoxMinimap'
import { findLandmarks } from '../../rackreel/world/World'
import type { MapMarker } from '../../rackreel/ui/Minimap'
import type { ControlRow } from '../../rackreel/ui/Controls'
import { RegionCuller } from '../core/RegionCuller'
import { CasinoHost, CASINO_NAME } from '../casino/CasinoHost'
import { CASINO } from '../casino/CasinoLayout'
import { STAND_SIZE } from '../../rackreel/world/Foliage'
import { FOX_LAKE_SHAPE, TOWN_OFFSET, TOWN_SQUARE, TOWN_Y, connectorDistance, headingToTownYaw, outsideHeight, roadClear, sceneToTown, townToScene, zoneAt, CONNECTOR } from '../region'

const STEP = 1 / 60
const CULL_REACH = 640
const TOWN_CELL = 192
const MAX_STEPS = 4
const NET_HZ = 15
const GARAGE_KEY = 'KeyV'
const HOME_KEY = 'KeyH'
const GO_HOME_COOLDOWN_MS = 15 * 60 * 1000

/** Same identity key as Fox Plains, so one browser is one neighbor in both. */
function persistentKey(): string {
  const K = 'maplestreet/identity'
  let k = store.get(K)
  if (!k) {
    k = randomId(24)
    store.set(K, k)
  }
  return k
}

export interface TownOptions {
  name: string
  color: string
  mode: 'world' | 'offline'
  /** Called when the shared world (or solo) is joined: the room code for invites, and a label. */
  onRoom?: (code: string | null, label: string) => void
}

export class FoxLakeTown implements GameExtension {
  readonly drivesClock = true
  private host!: GameHost
  private root!: TransformNode
  private gfx!: TownGfx
  private physics!: Physics
  private mats!: Mats
  private assets!: Assets
  private town!: Town
  private houses!: Houses
  private models!: VehicleModels
  private cars!: Cars
  private neighbors!: Neighbors
  private hud!: TownHud
  private map: WorldMap | null = null
  private atlas: Atlas | null = null
  private minimap: FoxMinimap | null = null
  private net: Transport | null = null
  private netStatus: NetStatus = 'connecting'
  private selfId: string | null = null
  private account: Account | null = null
  private welcomed = false
  private dayNum = 1
  private serverHours: number | null = null
  private readonly pinnedHour = hourFromSearch(location.search)
  private clockDays = 0
  private acc = 0
  private netAcc = 0
  private mowAcc = 0
  private mowBuf: MowStroke[] = []
  private lastDeck: Vector3 | null = null
  private readonly lots = makeLots()
  private readonly focusPts: { x: number; z: number }[] = []
  private readonly _t = { x: 0, y: 0, z: 0 }
  private readonly _deck = new Vector3()
  private extraKind: string | null = null
  private hudAcc = 0
  private buildSeq = 0
  /** Far town cells and far lake-country stands are switched off (the fog hides them). */
  private readonly culler = new RegionCuller(CULL_REACH)
  private readonly casino = new CasinoHost()
  private barriers: BarrierSegment[] = []
  private wading: Wading | null = null
  private signs: RoadsideSigns | null = null
  private fleet: Fleet | null = null
  private dispatch: Dispatch | null = null

  constructor(private readonly opts: TownOptions) {}

  // ------------------------------------------------------------ build

  async build(host: GameHost): Promise<void> {
    this.host = host
    const { scene } = host.ctx
    this.gfx = new TownGfx(scene, (mesh, add) => (add ? host.addCaster(mesh) : host.removeCaster(mesh)))
    setRenderer(this.gfx)
    setAnisotropy(8)
    this.root = new TransformNode('fox-lake-town', scene)
    this.root.position.set(TOWN_OFFSET.x, TOWN_OFFSET.y, TOWN_OFFSET.z)
    this.root.scaling.set(1, 1, -1)
    this.root.computeWorldMatrix(true)
    setHostRoot(this.root)
    host.hud.setLoading(0.7, 'Laying out Fox Plains…')
    this.physics = await Physics.create()
    this.addCountryHeightfield()
    this.addOutsideHeightfield()
    this.barriers = addRoadColliders(this.physics, host.terrain, FOX_LAKE_SHAPE)
    this.assets = new Assets(scene)
    this.mats = new Mats(scene)
    const asphaltTex = asphaltTexture(scene, 10)
    const asphalt = (name: string) => countryAsphalt(scene, name, asphaltTex)
    this.town = new Town(this.physics, this.mats, {
      ground: false,
      asphalt,
      trees: (spots) => this.plantTownTrees(spots),
      keepClear: (x, z) => {
        const c = CASINO.clear
        if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return true
        if (roadsideAt(x, z, 5)) return true
        if (x > YARD.x0 - 6 && x < YARD.x1 + 6 && z > YARD.z0 - 6 && z < YARD.z1 + 6) return true
        if (x > MILL.x0 - 6 && x < MILL.x1 + 6 && z > MILL.z0 - 6 && z < MILL.z1 + 6) return true
        const s = townToScene(x, 0, z, this._t)
        return connectorDistance(s.x, s.z) < 9 || roadClear(s.x, s.z) < 4
      },
    })
    new Downtown(this.physics, this.mats)
    this.houses = new Houses(this.physics, this.mats, this.assets)
    this.casino.build(this.root, this.mats, this.physics)
    buildRoadside(this.root, this.mats, this.physics, asphalt('roadside-asphalt'))
    buildFreightSites(this.root, scene, this.mats, this.physics, (x, z) => host.terrain.heightAt(x, z))
    this.signs = new RoadsideSigns(scene)
    this.models = new VehicleModels(this.assets)
    const ground = buildTownGround(scene, host.terrain)
    const road = buildConnector(scene, host.terrain)
    const lakeRoad = buildLakeRoad(scene, host.terrain)
    this.freezeStatic([ground, road, ...lakeRoad, ...buildFreightRoads(scene, host.terrain)])
    buildBarricade(scene, FOX_LAKE_SHAPE, host.terrain)
    host.foliage.plantTrees(fillerTrees().map((t) => ({ ...t, y: host.terrain.heightAt(t.x, t.z) })))
    host.foliage.hostCasters = (focus) => (focus.z > HALF - 120 ? this.gfx.near(focus) : EMPTY)
    host.foliage.grassHoles.push({ x: CONNECTOR.start.x, z: CONNECTOR.start.z, r: 14 })
    this.hud = new TownHud()
  }

  /**
   * The lake country as a Rapier heightfield (town coordinates), so a car can drive out to the lake; lifted to the
   * interstate's and the Lake Road's surfaces where they cover it, so wheels ride on the asphalt.
   */
  private addCountryHeightfield(): void {
    const terrain = this.host.terrain
    const n = GRID
    const heights = new Float32Array((n + 1) * (n + 1))
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const sceneZ = HALF - j * CELL
        const sceneX = -HALF + i * CELL
        const ground = terrain.heights[Math.round((sceneZ + HALF) / CELL) * (n + 1) + i]
        const road = roadSurface(FOX_LAKE_SHAPE, terrain, sceneX, sceneZ)
        heights[i + j * (n + 1)] = Math.max(ground, road ?? -Infinity) - TOWN_OFFSET.y
      }
    }
    const centre = sceneToTown(0, 0, 0)
    this.physics.addHeightfield(n, n * CELL, heights, centre.x, centre.z)
  }

  /** The rolling land around town (region.ts `outsideHeight`) as a heightfield over the town square, 4 m apart. */
  private addOutsideHeightfield(): void {
    const n = 320
    const size = 1280
    const step = size / n
    const heights = new Float32Array((n + 1) * (n + 1))
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const s = townToScene(-size / 2 + i * step, 0, -size / 2 + j * step, this._t)
        heights[i + j * (n + 1)] = outsideHeight(s.x, s.z) - TOWN_Y
      }
    }
    this.physics.addHeightfield(n, size, heights, 0, 0)
  }

  private plantTownTrees(spots: TreeSpot[]): void {
    const out: { x: number; y: number; z: number; kind: 'pine' | 'hardwood' | 'birch'; scale: number; yaw: number }[] = []
    for (const s of spots) {
      const p = townToScene(s.x, 0, s.z)
      if (p.x < GROUND_RECT.x0 + 4 || p.z > GROUND_RECT.z1 - 4) continue
      const hash = Math.abs(Math.sin(s.x * 12.9898 + s.z * 78.233) * 43758.5453) % 1
      const kind = s.kind === 'spruce' ? 'pine' : s.kind === 'linden' && hash < 0.35 ? 'birch' : 'hardwood'
      out.push({ x: p.x, y: this.host.terrain.heightAt(p.x, p.z), z: p.z, kind, scale: s.s * 0.82, yaw: (s.yaw * Math.PI) / 180 })
    }
    this.host.foliage.plantTrees(out)
  }

  private freezeStatic(meshes: Mesh[]): void {
    for (const m of meshes) {
      m.computeWorldMatrix(true)
      m.freezeWorldMatrix()
    }
  }

  // ------------------------------------------------------------ ready

  async ready(host: GameHost): Promise<void> {
    const sky = host.ctx.scene.getMeshByName('sky') as Mesh | null
    if (sky) this.gfx.bakeSky(sky)
    this.cars = new Cars(host.ctx.scene, this.physics, this.models, host.vehicles)
    this.cars.onImpact = (kind, dv, at) => {
      if (this.account?.garage.includes(kind as never)) this.send({ t: 'crash', kind: kind as never, dv, at })
    }
    this.neighbors = new Neighbors(this.physics, this.models, {
      scene: host.ctx.scene,
      camera: host.ctx.camera,
      hunter: host.hunter,
      paint: host.headPaint,
      townRoot: this.root,
      register: (mesh) => host.ctx.registerDynamic(mesh),
      unregister: (mesh) => host.ctx.unregisterDynamic(mesh),
    }, () => this.selfId)
    await Promise.all([STARTER_TRUCK, 'trailer', 'mower'].map((k) => this.models.preload(k).catch(() => null)))
    const truck = this.cars.add(STARTER_TRUCK, SPAWN.x + 4, SPAWN.z, 0, null)
    const trailer = this.cars.add('trailer', SPAWN.x - 3, SPAWN.z, 0, null)
    truck.fp.hitch(trailer.fp)
    this.cars.add('mower', SPAWN.x + 4, SPAWN.z + 6, 0, null)
    await this.casino.ready(host)
    this.wading = new Wading(host.terrain, this.cars, (text) => host.hud.toast(text, 'warn'))
    this.cars.flooded = (car) => this.wading?.flooded(car) ?? false
    this.cars.stayPut = (kind) => Fleet.isFleet(kind)
    this.fleet = new Fleet(this.cars, (text) => host.hud.toast(text))
    this.fleet.spawn()
    const dock = findLandmarks(host.terrain).dock.start
    this.atlas = new Atlas(host.terrain, host.mapMarkers(), { x: dock.x, z: dock.z })
    const lotState = (lot: LotDef) => {
      const owner = this.houses.world?.lots[lot.id]?.owner
      return owner ? (owner === this.account?.id ? 'mine' : 'owned') : 'sale'
    }
    this.minimap = new FoxMinimap(this.atlas, () => this.map?.current ?? null, lotState)
    this.map = new WorldMap({
      atlas: this.atlas,
      markers: () => host.mapMarkers(),
      lot: lotState,
      world: {
        terrain: host.terrain,
        blocked: (x, z) => this.physics.blocked(x, z, 0, 1),
        streetName: (x, z) => {
          const name = this.placeName(x, z)
          return name && name !== 'Fox Plains' && name !== 'Fox Lake woods' && name !== CASINO_NAME ? name : null
        },
      },
      where: () => {
        const v = host.driving
        return v ? { x: v.position.x, z: v.position.z, heading: v.heading } : { x: host.player.x, z: host.player.z, heading: host.facing }
      },
      toast: (text) => host.hud.toast(text),
      canvas: host.ctx.engine.getRenderingCanvas(),
    })
    this.dispatch = new Dispatch({
      send: (m) => this.send(m),
      toast: (text) => host.hud.toast(text),
      routeTo: (x, z, name) => this.map?.routeToPoint(x, z, name),
      clearRoute: () => this.map?.clear(),
      where: () => this.townPosition(),
      driving: () => !!host.driving,
      scene: host.ctx.scene,
      groundAt: (x, z) => host.terrain.heightAt(x, z),
    }, this.fleet)
    addEventListener('keydown', (e) => this.key(e))
    this.culler.addByCell(this.root.getChildMeshes(false).filter((m) => m.isWorldMatrixFrozen), TOWN_CELL)
    for (const stand of host.foliage.stands) this.culler.addGroup(stand.meshes, stand.center.x, stand.center.z, STAND_SIZE * 0.72)
    const casino = this.casino.center()
    this.culler.addGroup(this.casino.staticMeshes(), casino.x, casino.z, 24)
    if (this.signs) {
      for (const p of ROADSIDE) {
        const d = townToScene(doorSpot(p).x, 0, doorSpot(p).z)
        this.culler.addGroup(this.signs.root.getChildMeshes(false).filter((m) => Math.hypot(m.getAbsolutePosition().x - d.x, m.getAbsolutePosition().z - d.z) < 40), d.x, d.z, 40)
      }
    }
    this.culler.update(0, host.ctx.camera.globalPosition, true)
    await this.connect()
  }

  // ------------------------------------------------------------ net

  private async connect(): Promise<void> {
    const join = { key: `${persistentKey()}:${this.opts.name.toLowerCase()}`, name: this.opts.name, color: this.opts.color }
    const attempt = async (t: Transport) => {
      t.onStatus((s) => (this.netStatus = s))
      t.onMessage((m) => this.onServer(m))
      this.net = t
      await t.connect(join)
    }
    try {
      if (this.opts.mode === 'world') {
        const url = worldEndpoint('foxlake')
        if (!url) throw new Error('The shared world needs this page to be opened from the site')
        await attempt(new WorldTransport(url))
      } else await attempt(new OfflineTransport())
    } catch (e) {
      console.warn('[foxlake] falling back to solo:', e)
      try {
        this.net?.close()
      } catch {
        /* closed */
      }
      this.host.hud.toast(`${(e as Error).message || 'Connection failed'}: playing the town on your own on this device`)
      await attempt(new OfflineTransport())
    }
    this.casino.configureWallet(this.net instanceof WorldTransport, guestKey())
    this.opts.onRoom?.(this.net instanceof WorldTransport ? 'WORLD' : null, this.net?.label ?? 'Solo')
  }

  private send(m: ClientMsg): void {
    this.net?.send(m)
  }

  private nowDays(): number {
    const t = gameDays(this.dayNum, this.serverHours ?? this.host.clock.hour)
    this.clockDays = t < this.clockDays && this.clockDays - t < 1.01 ? this.clockDays : t
    return this.clockDays
  }

  private onServer(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome': {
        this.selfId = m.you
        this.dayNum = m.day
        this.setHours(m.hours)
        this.clockDays = 0
        this.nowDays()
        this.neighbors.clear()
        this.houses.setWorld(m.world)
        for (const id in m.world.lots) {
          const lot = m.world.lots[id]
          this.town.setLotOwner(id, lot.owner)
          const lawn = this.town.lawns.get(id)
          if (lawn) lawn.loadCells(decodeCells(m.mowed[id], lot.w * lot.d))
        }
        this.setAccount(m.account)
        if (!this.welcomed) {
          this.welcomed = true
          const home = this.homeLot()
          if (home) {
            this.cars.parkAtHome(home)
            if (!this.host.playing || zoneAt(this.host.player.z) === 'town') this.standAtHome(home)
            this.host.hud.toast(`Welcome home to Fox Lake, ${m.account.name}. Lot ${home.id} is right where you left it.`)
          } else this.host.hud.toast(`Welcome to Fox Lake, ${m.account.name}! Walk onto a lot for sale to buy it; the lake is down East Ave and the county road.`)
        }
        break
      }
      case 'snap':
        this.setHours(m.hours)
        this.neighbors.ingest(m.time, m.players, m.vehicles)
        break
      case 'build':
        this.houses.apply(m.op as BuildOp, m.actorId, m.actorName)
        if (m.op.op === 'buyLot') {
          this.town.setLotOwner(m.op.lotId, m.actorId)
          this.host.hud.toast(m.actorId === this.account?.id ? `Lot ${m.op.lotId} is yours!` : `${m.actorName} bought lot ${m.op.lotId}`)
        }
        break
      case 'buildRejected':
        this.host.hud.toast(m.reason, 'warn')
        break
      case 'account':
        this.setAccount(m.account)
        if (m.note) this.host.hud.toast(m.note)
        break
      case 'mow':
        for (const s of m.strokes) this.town.lawns.get(s.lotId)?.mow(s, this.nowDays())
        break
      case 'newDay':
        this.dayNum = m.day
        this.host.hud.toast(`Day ${m.day} in Fox Lake.`)
        break
      case 'left':
        this.neighbors.removeOwner(m.id)
        break
      case 'toast':
        this.host.hud.toast(m.text)
        break
      case 'job':
        if (m.note) this.host.hud.toast(m.note)
        break
      case 'freight':
        this.dispatch?.onJob(m.job, m.note, m.paid)
        break
    }
  }

  private setHours(hours: number): void {
    this.serverHours = hours
    if (this.pinnedHour === null) this.host.clock.set(hours)
  }

  private setAccount(acc: Account): void {
    this.account = acc
    this.cars.restyle(acc)
    this.hud.setAccount(acc, this.host.progress.signedIn)
    this.casino.syncMoney(acc.money)
  }

  private homeLot(): (LotState & LotDef) | null {
    const w = this.houses.world
    const me = this.account?.id
    if (!w || !me) return null
    const state = Object.values(w.lots).find((l) => l.owner === me)
    if (!state) return null
    const def = this.lots.find((l) => l.id === state.id)
    return def ? { ...def, ...state } : null
  }

  private standAtHome(lot: LotDef): void {
    const dir = lot.front === '+z' ? 1 : -1
    const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z
    const p = townToScene(lot.x + 8, 0, frontZ - dir * 2)
    this.host.teleport(new Vector3(p.x, p.y, p.z), dir > 0 ? 0 : Math.PI)
  }

  private sendState(): void {
    const me = this.selfId
    if (!me) return
    const drivingCar = this.cars.driving()
    const t = this.townPosition()
    const p: PlayerSnap = {
      id: me, name: this.opts.name, color: this.opts.color, x: t.x, y: t.y, z: t.z,
      yaw: headingToTownYaw(drivingCar ? drivingCar.rr.heading : this.host.facing),
      speed: drivingCar ? 0 : Math.min(20, this.host.driving ? Math.abs(this.host.driving.speed) : 0),
      vehicleId: drivingCar ? `${me}:${drivingCar.fp.id}` : null,
    }
    this.send({ t: 'state', p, v: this.cars.snapshots(me) })
  }

  /** Where the player is, in the shared world's (town) coordinates. Out in the lake country that is beyond the town's square, which classic Fox Plains hides. */
  private townPosition(): { x: number; y: number; z: number } {
    const v = this.host.driving
    const at = v ? v.position : this.host.player
    return sceneToTown(at.x, at.y, at.z, this._t)
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
    const focus = this.townFocus()
    this.town.update(dt, night, focus, this.nowDays())
    this.houses.update(dt, focus)
    this.neighbors.update(dt, night, focus)
    this.culler.update(dt, this.host.ctx.camera.globalPosition)
    this.casino.update(dt)
    this.fleet?.update(dt)
    this.dispatch?.update(dt)
    this.map?.update(dt)
    this.netAcc += dt
    if (this.netAcc >= 1 / NET_HZ) {
      this.netAcc = 0
      this.sendState()
      this.mowAcc += 1 / NET_HZ
      if (this.mowAcc > 0.2 && this.mowBuf.length) {
        this.mowAcc = 0
        this.send({ t: 'mow', strokes: this.mowBuf.splice(0, 20) })
      }
    }
    this.hudAcc -= dt
    if (this.hudAcc <= 0) {
      this.hudAcc = 0.5
      const reconnecting = this.netStatus === 'offline' && !(this.net instanceof OfflineTransport)
      this.hud.setStatus(this.net ? `${this.net.label}${reconnecting ? ' (reconnecting)' : ''}` : 'Connecting', this.neighbors.count, zoneAt(this.host.player.z))
    }
  }

  private townFocus(): { x: number; z: number } {
    const t = this.townPosition()
    return { x: t.x, z: t.z }
  }

  private fixed(dt: number): void {
    const pts = this.focusPts
    pts.length = 0
    const t = this.townPosition()
    pts.push({ x: t.x, z: t.z })
    this.cars.focusPoints(pts)
    this.physics.stream(pts, dt)
    this.wading?.step(dt)
    this.physics.step(dt)
    this.mowStep()
  }

  private mowStep(): void {
    const car = this.cars.driving()
    const v = car?.fp
    if (!v || !v.preset.mowerDeck) {
      this.lastDeck = null
      return
    }
    const deck = v.localToWorld(v.preset.mowerDeck.x, 0, 0, this._deck)
    if (!this.lastDeck) {
      this.lastDeck = deck.clone()
      return
    }
    const d = Vector3.Distance(deck, this.lastDeck)
    if (d > 3) {
      this.lastDeck.copyFrom(deck)
      return
    }
    if (d < 0.35) return
    const mx = (deck.x + this.lastDeck.x) / 2
    const mz = (deck.z + this.lastDeck.z) / 2
    const lawn = this.town.lawnAt(mx, mz)
    if (lawn) {
      const s: MowStroke = { lotId: lawn.lot.id, x: mx, z: mz, hx: deck.x - this.lastDeck.x, hz: deck.z - this.lastDeck.z, width: v.preset.mowerDeck.width, len: d + 0.12 }
      lawn.mow(s, this.nowDays())
      this.mowBuf.push(s)
    }
    this.lastDeck.copyFrom(deck)
  }

  // ------------------------------------------------------------ the walker

  /** Town solids near town, and parked or moving vehicles anywhere (cars can drive out into the lake country). */
  collide(p: Vector3, r: number): void {
    if (!this.physics) return
    const t = sceneToTown(p.x, p.y, p.z, this._t)
    const q = { x: t.x, z: t.z }
    const hitStatic = p.z >= HALF - 8 && this.physics.pushOut(q, t.y, r)
    const hitVehicle = this.physics.pushOutVehicles(q, t.y, r)
    if (!hitStatic && !hitVehicle) return
    const s = townToScene(q.x, t.y, q.z, this._t)
    p.x = s.x
    p.z = s.z
  }

  obstacle(x: number, z: number, r: number): boolean {
    if (hitsBarrier(this.barriers, x, z, r, this.host.terrain.heightAt(x, z))) return true
    if (z < HALF - 8) return false
    const t = sceneToTown(x, TOWN_OFFSET.y, z, this._t)
    return this.physics.blocked(t.x, t.z, 0, r)
  }

  spawn(): { at: Vector3; facing: number } | null {
    const home = this.homeLot()
    if (home) {
      const dir = home.front === '+z' ? 1 : -1
      const frontZ = home.front === '+z' ? home.z + home.d : home.z
      const p = townToScene(home.x + 8, 0, frontZ - dir * 2)
      return { at: new Vector3(p.x, p.y, p.z), facing: dir > 0 ? 0 : Math.PI }
    }
    const p = townToScene(SPAWN.x, 0, SPAWN.z - 4)
    return { at: new Vector3(p.x, p.y, p.z), facing: Math.PI }
  }

  placeName(x: number, z: number): string | null {
    if (z < HALF) {
      const tl = sceneToTown(x, 0, z, this._t)
      if (Math.hypot(tl.x - LANDING.x, tl.z - LANDING.z) < LANDING.r) return 'Pine Ridge landing'
      if (roadClear(x, z) < 3 && z < 60 && x > 100) return x > 266 && z < -40 ? 'Pine Ridge Rd' : 'Lake Road'
      return null
    }
    if (this.casino.contains(x, z)) return CASINO_NAME
    const t = sceneToTown(x, 0, z, this._t)
    const place = roadsideAt(t.x, t.z, 2)
    if (place) return place.name
    if (t.x > YARD.x0 && t.x < YARD.x1 && t.z > YARD.z0 && t.z < YARD.z1) return 'Fox Lake Freight & Gravel'
    if (t.x > MILL.x0 && t.x < MILL.x1 && t.z > MILL.z0 && t.z < MILL.z1) return 'Fox Plains Sawmill'
    if (connectorDistance(x, z) < 8) return 'County Road'
    if (t.x < TOWN_SQUARE.x0 - TOWN_OFFSET.x + 40 || Math.abs(t.z) > 330 || t.x > 590 || t.x < -410) return 'Fox Lake woods'
    for (let i = 0; i < ROADS.length; i++) {
      const r = ROADS[i]
      if (Math.abs(t.x - r.cx) < r.sx / 2 + 6 && Math.abs(t.z - r.cz) < r.sz / 2 + 6) return ROAD_NAMES[i]
    }
    return 'Fox Plains'
  }

  // ------------------------------------------------------------ interactions

  /** The lot for sale you're standing on, on foot in town. */
  private lotForSale(): LotState | null {
    if (this.host.driving || zoneAt(this.host.player.z) !== 'town') return null
    const t = this.townPosition()
    const lots = this.houses.world?.lots
    for (const id in lots) {
      const lot = lots[id]
      if (lot.owner) continue
      if (t.x >= lot.x && t.x <= lot.x + lot.w && t.z >= lot.z && t.z <= lot.z + lot.d) return lot
    }
    return null
  }

  private nearDoor() {
    const t = this.townPosition()
    let best: (typeof SHOP_DOORS)[number] | null = null
    let bd = SHOP_RADIUS
    for (const d of SHOP_DOORS) {
      const dd = Math.hypot(t.x - d.x, t.z - d.z)
      if (dd < bd) {
        bd = dd
        best = d
      }
    }
    return best
  }

  /** The roadside place whose door you're standing at, on foot. */
  private roadsideDoor(): RoadsidePlace | null {
    if (this.host.driving) return null
    const t = this.townPosition()
    for (const p of ROADSIDE) {
      const d = doorSpot(p)
      if (Math.hypot(t.x - d.x, t.z - d.z) < 3.2) return p
    }
    return null
  }

  prompt(): string {
    if (zoneAt(this.host.player.z) !== 'town') return ''
    const seat = this.casino.prompt()
    if (seat) return seat
    const stop = this.roadsideDoor()
    if (stop) return `E — ${stop.name}`
    if (this.dispatch?.nearBoard()) return 'E — Dispatch board: take a load'
    const door = this.nearDoor()
    if (door) return door.kind === 'clothing' ? `E — ${door.name}: try on outfits` : `E — ${door.name}`
    const lot = this.lotForSale()
    if (lot) return `E — Buy lot ${lot.id} for $${lotPrice(lot).toLocaleString()}`
    return ''
  }

  interact(): boolean {
    if (zoneAt(this.host.player.z) === 'town' && this.casino.interact()) return true
    if (zoneAt(this.host.player.z) === 'town' && this.dispatch?.nearBoard()) {
      this.dispatch.show()
      return true
    }
    const stop = zoneAt(this.host.player.z) === 'town' ? this.roadsideDoor() : null
    if (stop) {
      this.host.hud.toast(ROADSIDE_GREETING[stop.kind](stop))
      return true
    }
    const door = zoneAt(this.host.player.z) === 'town' ? this.nearDoor() : null
    if (door) {
      if (door.kind === 'clothing') this.host.openWardrobe()
      else this.host.hud.toast(`${door.name} isn't open in Fox Lake yet.`)
      return true
    }
    const lot = this.lotForSale()
    if (!lot) return false
    if ((this.account?.money ?? 0) < lotPrice(lot)) this.host.hud.toast(`Lot ${lot.id} costs $${lotPrice(lot).toLocaleString()}. Mow lawns and hunt and fish the lake country to save up.`, 'warn')
    else this.send({ t: 'build', seq: ++this.buildSeq, op: { op: 'buyLot', lotId: lot.id } })
    return true
  }

  private key(e: KeyboardEvent): void {
    if (!this.host.playing || e.repeat || this.host.hud.modalOpen) return
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.map?.show()
    else if (e.code === GARAGE_KEY) this.swapGarageVehicle()
    else if (e.code === HOME_KEY) this.goHome()
    else if (e.code === 'KeyT') this.fleet?.toggleHitch()
    else if (e.code === 'KeyB') this.fleet?.toggleDump()
    else if (e.code === 'KeyL') this.dispatch?.press()
  }

  /** V: brings out the next vehicle you own (beside the pickup and trailer), parked at home or downtown. */
  private swapGarageVehicle(): void {
    const acc = this.account
    if (!acc) return
    const kinds = acc.garage.filter((k) => k !== STARTER_TRUCK && k !== 'trailer')
    if (!kinds.length) {
      this.host.hud.toast('Buy more vehicles at Maple Motors in Fox Plains (classic); they show up here.')
      return
    }
    const current = this.extraKind ?? (this.cars.list.has('mower') ? 'mower' : null)
    const next = kinds[(Math.max(-1, current ? kinds.indexOf(current as never) : -1) + 1) % kinds.length]
    const driving = this.cars.driving()
    if (current && driving?.kind === current) {
      this.host.hud.toast(`Park and get out of the ${VEHICLES[current]?.name ?? current} first.`)
      return
    }
    if (current) this.cars.remove(current)
    const home = this.homeLot()
    const at = home ? homeSpot(home) : { x: SPAWN.x + 4, z: SPAWN.z + 6, yaw: 0 }
    const car = this.cars.add(next, at.x, at.z, at.yaw, acc)
    this.cars.parkVehicle(car.fp, at.x, at.z, at.yaw)
    this.cars.sync(car)
    this.extraKind = next
    this.host.hud.toast(`${VEHICLES[next]?.name ?? next} is out ${home ? `on your driveway at lot ${home.id}` : 'by the freight depot'}. V swaps it.`)
  }

  private goHome(): void {
    const home = this.homeLot()
    if (!home) {
      this.host.hud.toast(`You don't have a home yet. Walk onto a lot for sale in town to buy one.`)
      return
    }
    const key = `maplestreet/go-home/${this.account?.id ?? 'guest'}`
    const last = Number(store.get(key) ?? 0) || 0
    const wait = Math.max(0, last + GO_HOME_COOLDOWN_MS - Date.now())
    if (wait > 0) {
      this.host.hud.toast(`Go home is ready again in ${Math.ceil(wait / 60000)} min`)
      return
    }
    if (this.host.mode === 'bowfish' || this.host.mode === 'crew') {
      this.host.hud.toast('Finish the boat ride first.')
      return
    }
    store.set(key, String(Date.now()))
    this.standAtHome(home)
    this.host.hud.toast('Home sweet home. Your vehicles are where you left them.')
  }

  /** While driving: loading and dumping at a freight stop, or coupling a trailer that's in reach. */
  drivePrompt(): string {
    const job = this.dispatch?.prompt() ?? ''
    if (job) return job
    const car = this.cars?.driving()
    if (car?.kind === 'semi' && !car.fp.trailer && Math.abs(car.fp.speed) < 2) return 'T — Couple a trailer (back the fifth wheel under its kingpin)'
    if (car?.kind === 'dumptruck' && Math.abs(car.fp.speed) < 1) return 'B — Raise or lower the dump body'
    return ''
  }

  /** The corner map is Fox Lake's own atlas everywhere (Rack & Reel's is hidden). */
  drawMinimap(dt: number, x: number, z: number, cameraYaw: number, facing: number, markers: () => MapMarker[]): boolean {
    if (!this.minimap) return false
    this.minimap.draw(dt, x, z, cameraYaw, facing, markers)
    return true
  }

  cycleMinimapZoom(): string {
    return this.minimap?.cycleZoom() ?? ''
  }

  controls(): ControlRow[] {
    return [
      { keys: ['Ctrl'], text: 'Full map: click a place or a spot for turn-by-turn directions' },
      { keys: ['N'], text: 'Zoom the corner map' },
      { keys: ['T'], text: 'Couple or drop a trailer (tractor or pickup)' },
      { keys: ['B'], text: 'Raise or lower the dump body (dump truck)' },
      { keys: ['L'], text: 'Load or unload freight at a stop' },
      { keys: ['V'], text: 'Bring out your next vehicle' },
      { keys: ['H'], text: 'Go home (every 15 minutes)' },
    ]
  }

  get roomCode(): string | null {
    return this.net instanceof WorldTransport ? 'WORLD' : null
  }

  debug(): Record<string, unknown> {
    return { net: this.net?.label ?? null, status: this.netStatus, neighbors: this.neighbors?.count ?? 0, colliders: this.physics?.streamStats(), cars: [...(this.cars?.list.keys() ?? [])], culled: this.culler.stats() }
  }
}

const EMPTY: readonly AbstractMesh[] = []

const ROADSIDE_GREETING: Record<RoadsidePlace['kind'], (p: RoadsidePlace) => string> = {
  cabin: (p) => `${p.name} is locked up tight. ${p.blurb}`,
  gas: (p) => `${p.name}: "Pumps are on, the bait's fresh and the coffee's hot." ${p.blurb}`,
  motel: (p) => `${p.name}: the office bell rings, but nobody's at the desk yet. ${p.blurb}`,
  bar: (p) => `${p.name}: the jukebox is on and the grill's warming up. ${p.blurb}`,
}

/** Every street and lot in Fox Lake in the lake country's asphalt (the interstate's grit), tiled every 10 m. */
function countryAsphalt(scene: import('@babylonjs/core/scene').Scene, name: string, texture: import('@babylonjs/core/Materials/Textures/baseTexture').BaseTexture): StandardMaterial {
  const mat = new StandardMaterial(`fox-lake-${name}`, scene)
  mat.diffuseTexture = texture
  mat.specularColor = new Color3(0.04, 0.04, 0.04)
  mat.ambientColor = new Color3(0.35, 0.35, 0.35)
  return mat
}

function homeSpot(lot: LotDef): { x: number; z: number; yaw: number } {
  const dir = lot.front === '+z' ? 1 : -1
  const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z
  return { x: lot.x + 8.6, z: frontZ - dir * 5.5, yaw: dir > 0 ? -Math.PI / 2 : Math.PI / 2 }
}
