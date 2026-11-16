/**
 * Fox Lake's town: Montello, Wisconsin, mounted on the Rack & Reel game as a host world.
 *
 * Montello is Tello's own builder (tello/world/Montello.ts) over the baked map of the real city and the country three
 * miles round it, hung under one node at `TOWN_OFFSET` that mirrors z into the scene's handedness, so the shared
 * world's numbers (lots, doors, pumps, players) are Montello's map with z turned. It is lit, shadowed and fogged by
 * Rack & Reel's renderer; its trees are Tello's. Every player's house, your cars and the neighbors run on the Fox
 * Plains code in fp/ (same Rapier raycast cars, same build rules).
 *
 * It joins Fox Lake's own shared world (/api/maplestreet?world=foxlake): its own players, lots, houses and money, so
 * everyone starts fresh here. The shared world's clock drives the sky. The lake gameplay (fishing, hunting, Wild Man,
 * the dock) is Rack & Reel's own, moved onto Lake Montello (lake/LakeSite.ts); the UTV, the quad and the boat come
 * only when the account owns them (`Account.rides`).
 */
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { GameExtension, GameHost } from '../../rackreel/game/Game'
import { STAND_SIZE } from '../../rackreel/world/Foliage'
import { hourFromSearch } from '../../rackreel/systems/TimeOfDay'
import type { MapMarker } from '../../rackreel/ui/Minimap'
import type { ControlRow } from '../../rackreel/ui/Controls'
import { setHostRoot, setRenderer } from '../fp/core/Geo'
import { Mats, setAnisotropy } from '../fp/core/Tex'
import { Assets } from '../fp/core/Assets'
import { Physics } from '../fp/physics/Physics'
import { VehicleModels } from '../fp/physics/VehicleModels'
import { Houses } from '../fp/world/Houses'
import { OfflineTransport } from '../../maplestreet/src/net/OfflineTransport'
import { WorldTransport, guestKey, worldEndpoint } from '../../maplestreet/src/net/WorldTransport'
import type { NetStatus, Transport } from '../../maplestreet/src/net/Transport'
import { randomId, store } from '../../maplestreet/src/core/Storage'
import type { ClientMsg, PlayerSnap, ServerMsg } from '../../maplestreet/shared/Protocol'
import type { BuildOp, LotState } from '../../maplestreet/shared/BuildRules'
import type { Account } from '../../maplestreet/shared/Economy'
import { STARTER_TRUCK, VEHICLES } from '../../maplestreet/shared/Economy'
import { lotPrice, type LotDef } from '../../maplestreet/shared/WorldLayout'
import { MONTELLO_LOTS } from '../../maplestreet/shared/MontelloPlaces'
import { TelloMap } from '../../tello/town/TelloMap'
import { Montello } from '../../tello/world/Montello'
import type { TelloLand } from '../../tello/region'
import { Cars } from './Cars'
import { Neighbors } from './Neighbors'
import { TownGfx } from './TownGfx'
import { TownHud } from './TownHud'
import { Wading } from './Wading'
import { RegionCuller } from '../core/RegionCuller'
import { CasinoHost } from '../casino/CasinoHost'
import { SITE } from '../casino/CasinoLayout'
import { registerMapPlaces } from '../places/MapPlaces'
import { FoxLakeDev } from '../dev/FoxLakeDev'
import { lakePlaces, montelloPlaces } from '../dev/Places'
import { findMainStreet, type StreetSpot } from '../lake/Spawn'
import type { LakeSite } from '../lake/LakeSite'
import { LAKE_COUNTRY_MESHES, LAKE_COUNTRY_REACH, TOWN_OFFSET, headingToTownYaw, sceneToTown, townToScene } from '../region'
import { Places } from '../places/Places'

const STEP = 1 / 60
const CULL_REACH = 640
const MAX_STEPS = 4
const NET_HZ = 15
/** Camera near plane (metres) on foot (the rod and rifle are held close) and at the wheel. */
const NEAR_ON_FOOT = 0.08
const NEAR_DRIVING = 0.4
const GARAGE_KEY = 'KeyV'
const HOME_KEY = 'KeyH'
const GO_HOME_COOLDOWN_MS = 15 * 60 * 1000
const TOWN_BUILD_DELAY = 1.5

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
  /** Montello's land (after `foxLakeLand`) and where the lake gameplay stands on it. */
  land: TelloLand
  site: LakeSite
  /** `?at=`: a Montello map point (metres) to stand on once play starts, the World Editor's "Open in Life Sim". */
  at?: { x: number; z: number } | null
}

/** What the places in town (the outfitter's counter) call to open Rack & Reel's gear, wardrobe and catalog. */
export interface GearHooks {
  /** True while the player stands at a gear rack: 1 and 2 then take or swap the rod and the rifle. */
  atRack(here: boolean): void
  /** The gear rack (what you carry), the wardrobe or the order desk (the catalog, paid in Rack & Reel cash). */
  open(tab: 'rack' | 'wardrobe' | 'desk'): void
}

export class FoxLakeTown implements GameExtension {
  readonly drivesClock = true
  private host!: GameHost
  private root!: TransformNode
  private gfx!: TownGfx
  private physics!: Physics
  private mats!: Mats
  private assets!: Assets
  private houses!: Houses
  private models!: VehicleModels
  private cars!: Cars
  private neighbors!: Neighbors
  private hud!: TownHud
  private montello!: Montello
  private map: TelloMap | null = null
  /** Shops, bars, banks, pumps and paid work (places/). */
  private places: Places | null = null
  private net: Transport | null = null
  private netStatus: NetStatus = 'connecting'
  private selfId: string | null = null
  private account: Account | null = null
  private welcomed = false
  private serverHours: number | null = null
  private readonly pinnedHour = hourFromSearch(location.search)
  private acc = 0
  private netAcc = 0
  private readonly focusPts: { x: number; z: number }[] = []
  private readonly _t = { x: 0, y: 0, z: 0 }
  private extraKind: string | null = null
  private hudAcc = 0
  private buildSeq = 0
  private readonly culler = new RegionCuller(CULL_REACH)
  private readonly casino = new CasinoHost()
  private casinoMounted = false
  /** The developer panel and the spawned vehicles anyone can drive (dev/). */
  dev: FoxLakeDev | null = null
  private wading: Wading | null = null
  private readonly land: TelloLand
  private readonly start: StreetSpot
  private townWait = TOWN_BUILD_DELAY
  private townStarted = false
  private townReady = false
  /** `?at=` until it has been done: the map point, and where the player was first put (scene) once they have been. */
  private jump: { x: number; z: number; put: { x: number; z: number } | null } | null

  constructor(private readonly opts: TownOptions) {
    this.land = opts.land
    this.start = findMainStreet(opts.land)
    this.jump = opts.at ? { x: opts.at.x, z: opts.at.z, put: null } : null
  }

  // ------------------------------------------------------------ frames

  /** The Main Street kerb where play starts, as a town point (z turned) and the yaw that faces along the street. */
  private startPose(): { x: number; z: number; yaw: number; heading: number } {
    const s = this.start
    return { x: s.x, z: -s.z, yaw: Math.PI / 2 - s.heading, heading: s.heading }
  }

  // ------------------------------------------------------------ build

  async build(host: GameHost): Promise<void> {
    this.host = host
    const land = this.land
    const { scene } = host.ctx
    this.gfx = new TownGfx(scene, (mesh, add) => (add ? host.addCaster(mesh) : host.removeCaster(mesh)))
    setRenderer(this.gfx)
    setAnisotropy(8)
    this.root = new TransformNode('fox-lake-town', scene)
    this.root.position.set(TOWN_OFFSET.x, TOWN_OFFSET.y, TOWN_OFFSET.z)
    this.root.scaling.set(1, 1, -1)
    this.root.computeWorldMatrix(true)
    setHostRoot(this.root)
    host.hud.setLoading(0.7, 'Surveying Montello…')
    this.physics = await Physics.create()
    this.assets = new Assets(scene)
    this.mats = new Mats(scene)
    this.houses = new Houses(this.physics, this.mats, this.assets)
    this.models = new VehicleModels(this.assets)
    registerMapPlaces(land.doc)
    this.montello = new Montello(land, {
      host,
      physics: this.physics,
      shift: { x: 0, y: 0, z: 0 },
      mats: this.mats,
      gfx: this.gfx,
      culler: this.culler,
      openExit: null,
      lotHouses: new Set([...MONTELLO_LOTS.flatMap((l) => (l.scan === undefined ? [] : [l.scan])), ...(SITE.building >= 0 ? [SITE.building] : [])]),
    })
    this.montello.buildSolids()
    host.foliage.hostCasters = (focus) => (land.holdsScene(focus.x, focus.z) ? this.gfx.near(focus) : EMPTY)
    this.hud = new TownHud()
  }

  // ------------------------------------------------------------ ready

  async ready(host: GameHost): Promise<void> {
    const scene = host.ctx.scene
    const sky = scene.getMeshByName('sky') as Mesh | null
    if (sky) this.gfx.bakeSky(sky)
    this.cars = new Cars(scene, this.physics, this.models, host.vehicles)
    this.cars.ground = (x, z) => this.land.heightAt(x, -z)
    this.cars.onImpact = (kind, dv, at) => {
      if (this.account?.garage.includes(kind as never)) this.send({ t: 'crash', kind: kind as never, dv, at })
    }
    this.neighbors = new Neighbors(this.physics, this.models, {
      scene,
      camera: host.ctx.camera,
      hunter: host.hunter,
      paint: host.headPaint,
      townRoot: this.root,
      register: (mesh) => host.ctx.registerDynamic(mesh),
      unregister: (mesh) => host.ctx.unregisterDynamic(mesh),
    }, () => this.selfId)
    this.dev = new FoxLakeDev({
      host,
      physics: this.physics,
      models: this.models,
      send: (m) => this.send(m),
      self: () => this.selfId,
      dropRemote: (id) => this.neighbors.dropVehicle(id),
      home: () => this.spawn(),
      places: () => [...montelloPlaces(this.land), ...lakePlaces(this.opts.site)],
    })
    await Promise.all([STARTER_TRUCK, 'trailer', 'mower'].map((k) => this.models.preload(k).catch(() => null)))
    this.placeStarterCars()
    this.wading = new Wading(host.terrain, this.cars, (text) => host.hud.toast(text, 'warn'))
    this.cars.flooded = (car) => this.wading?.flooded(car) ?? false
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
    this.places = new Places({
      host,
      cars: this.cars,
      send: (m) => this.send(m),
      account: () => this.account,
      land: this.land,
      northMap: () => this.map,
      gear: this.gear,
    })
    addEventListener('keydown', (e) => this.key(e))
    for (const stand of host.foliage.stands) this.culler.addGroup(stand.meshes, stand.center.x, stand.center.z, STAND_SIZE * 0.72)
    const country = scene.meshes.filter((m) => {
      if (m.infiniteDistance || !m.isEnabled() || !LAKE_COUNTRY_MESHES.test(m.name)) return false
      const c = m.getBoundingInfo().boundingBox.centerWorld
      return Math.hypot(c.x, c.z) < LAKE_COUNTRY_REACH
    })
    this.culler.addGroup(country, 0, 0, LAKE_COUNTRY_REACH)
    this.culler.update(0, host.ctx.camera.globalPosition, true)
    await this.connect()
  }

  /** The pickup with its trailer and the riding mower, set down on Main Street ahead of the start. */
  private placeStarterCars(): void {
    const p = this.startPose()
    const fx = Math.sin(p.heading)
    const fz = -Math.cos(p.heading)
    const truck = this.cars.add(STARTER_TRUCK, 0, 0, 0, null)
    const trailer = this.cars.add('trailer', 0, 0, 0, null)
    const mower = this.cars.add('mower', 0, 0, 0, null)
    this.cars.setDown(truck.fp, p.x + fx * 7, p.z + fz * 7, p.yaw)
    this.cars.setDown(trailer.fp, p.x, p.z, p.yaw)
    truck.fp.hitch(trailer.fp)
    this.cars.setDown(mower.fp, p.x + fx * 12 - fz * 3, p.z + fz * 12 + fx * 3, p.yaw)
    this.cars.syncAll()
  }

  // ------------------------------------------------------------ gear (hooks for the places)

  readonly gear: GearHooks = {
    atRack: (here) => this.host.setGearRackHere(here),
    open: (tab) => this.host.openGearPanel(tab),
  }

  /**
   * Montello's casino: the Foxtails Lounge & Casino where Foxtails Gentlemen's Club stands on State Highway 23. The
   * club's own scanned building comes down (it stays out of the town), `CasinoHost` builds the room, the machines and
   * the bar on its lot, and `casinoMounted` lets its prompts, wallet and table sessions answer.
   */
  protected async mountCasino(): Promise<void> {
    if (SITE.building >= 0) this.montello.clearHouse(SITE.building)
    this.casino.build(this.root, this.mats, this.physics)
    await this.casino.ready(this.host)
    this.casinoMounted = true
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
      } else await attempt(new OfflineTransport({ devTools: true, foxLake: true }))
    } catch (e) {
      console.warn('[foxlake] falling back to solo:', e)
      try {
        this.net?.close()
      } catch {
        /* closed */
      }
      this.host.hud.toast(`${(e as Error).message || 'Connection failed'}: playing Montello on your own on this device`)
      await attempt(new OfflineTransport({ foxLake: true }))
    }
    await this.mountCasino()
    if (this.casinoMounted) this.casino.configureWallet(this.net instanceof WorldTransport, guestKey())
    this.opts.onRoom?.(this.net instanceof WorldTransport ? 'WORLD' : null, this.net?.label ?? 'Solo')
  }

  private send(m: ClientMsg): void {
    this.net?.send(m)
  }

  private onServer(m: ServerMsg): void {
    this.dev?.onServer(m, this.net instanceof OfflineTransport)
    switch (m.t) {
      case 'welcome': {
        this.selfId = m.you
        this.setHours(m.hours)
        this.neighbors.clear()
        this.houses.setWorld(m.world)
        for (const id in m.world.lots) this.clearScannedHouse(m.world.lots[id])
        this.setAccount(m.account)
        if (!this.welcomed) {
          this.welcomed = true
          const home = this.homeLot()
          if (home) {
            this.cars.parkAtHome(home)
            if (!this.host.playing) this.standAtHome(home)
            this.host.hud.toast(`Welcome home to Montello, ${m.account.name}. Lot ${home.id} is right where you left it.`)
          } else this.host.hud.toast(`Welcome to Montello, ${m.account.name}! Walk onto a lot for sale to buy it, or ask for work in town.`)
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
          const bought = this.houses.world?.lots[m.op.lotId]
          if (bought) this.clearScannedHouse(bought)
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
      case 'newDay':
        this.host.hud.toast(`Day ${m.day} in Montello.`)
        break
      case 'left':
        this.neighbors.removeOwner(m.id)
        break
      case 'toast':
        this.host.hud.toast(m.text)
        break
      case 'job':
        if (this.places) this.places.onJob(m.job, m.note)
        else if (m.note) this.host.hud.toast(m.note)
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
    if (this.casinoMounted) this.casino.syncMoney(acc.money)
    this.places?.onAccount(acc)
    this.host.setRides({ utv: acc.rides.includes('utv'), quad: acc.rides.includes('quad'), boat: acc.rides.includes('boat') })
  }

  private homeLot(): (LotState & LotDef) | null {
    const w = this.houses.world
    const me = this.account?.id
    if (!w || !me) return null
    const state = Object.values(w.lots).find((l) => l.owner === me)
    if (!state) return null
    const def = MONTELLO_LOTS.find((l) => l.id === state.id)
    return def ? { ...def, ...state } : null
  }

  private standAtHome(lot: LotDef): void {
    const dir = lot.front === '+z' ? 1 : -1
    const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z
    const p = townToScene(lot.x + 8, 0, frontZ - dir * 2)
    this.host.teleport(new Vector3(p.x, this.land.heightAt(this.land.toMapX(p.x), this.land.toMapZ(p.z)), p.z), dir > 0 ? 0 : Math.PI)
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
    const state: ClientMsg & { t: 'state' } = { t: 'state', p, v: this.cars.snapshots(me) }
    this.dev?.stamp(state)
    this.send(state)
  }

  /** Where the player is, in the shared world's (town) coordinates. */
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
    this.dev?.update(dt, night)
    this.mats.setNight(night)
    this.gfx.update(night, this.host.clock.sky.glow)
    const focus = this.townFocus()
    this.houses.update(dt, focus)
    this.neighbors.update(dt, night, focus)
    this.culler.update(dt, this.host.ctx.camera.globalPosition)
    // The near plane sets how finely the depth buffer splits distance: pushed out while driving (nothing is that close to
    // the chase camera) so walls, trim and windows far down the street don't flicker against each other.
    this.host.ctx.camera.minZ = this.host.driving ? NEAR_DRIVING : NEAR_ON_FOOT
    if (this.casinoMounted) this.casino.update(dt)
    this.map?.update(dt)
    this.montello.update(dt)
    this.jumpToStart()
    this.startMontello(dt)
    this.places?.update(dt)
    this.netAcc += dt
    if (this.netAcc >= 1 / NET_HZ) {
      this.netAcc = 0
      this.sendState()
    }
    this.hudAcc -= dt
    if (this.hudAcc <= 0) {
      this.hudAcc = 0.5
      const reconnecting = this.netStatus === 'offline' && !(this.net instanceof OfflineTransport)
      const at = this.host.driving?.position ?? this.host.player
      this.hud.setStatus(this.net ? `${this.net.label}${reconnecting ? ' (reconnecting)' : ''}` : 'Connecting', this.neighbors.count, this.placeName(at.x, at.z) ?? 'Montello')
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
    const drive = pts.length
    this.cars.focusPoints(pts)
    this.montello.solidTrees(pts.slice(drive))
    this.physics.stream(pts, dt)
    this.wading?.step(dt)
    this.physics.step(dt)
  }

  /**
   * Builds Montello's buildings, ground, water and trees once the game is running: a moment after you start, in small
   * slices between frames (tello/world/Montello.ts), so driving and turning stay smooth while it builds. Its ground
   * and walls are already solid from the loading screen (`buildSolids`).
   */
  private startMontello(dt: number): void {
    if (this.townStarted || !this.host.playing) return
    this.townWait -= dt
    if (this.townWait > 0) return
    this.townStarted = true
    void this.montello
      .build()
      .then(() => {
        this.montello.ready()
        this.townReady = true
      })
      .catch((e) => console.warn('[foxlake] Montello could not be built', e))
  }

  /**
   * `?at=`: as play starts, puts the player on foot at that map point with the developer panel's teleport (dry ground
   * clear of trunks and solids). That runs before Montello's build starts, so its ground and trees go up round the spot
   * first; the ground is already solid from the loading screen. Once the buildings are solid too, a player who has not
   * moved and finds a solid where they stand is put on safe ground again from the same point.
   */
  private jumpToStart(): void {
    const jump = this.jump
    if (!jump || !this.host.playing || !this.dev) return
    const land = this.land
    const label = `${Math.round(jump.x)}, ${Math.round(jump.z)}`
    if (!jump.put) {
      if (!land.playable(jump.x, jump.z, 2)) {
        this.host.hud.toast(`${label} is outside Montello's playable area.`, 'warn')
        this.jump = null
        return
      }
      const outcome = this.dev.goTo(land.toSceneX(jump.x), land.toSceneZ(jump.z), this.host.facing, label)
      if (outcome.state !== 'done') {
        if (outcome.state === 'refused') this.host.hud.toast(outcome.text, 'warn')
        this.jump = null
        return
      }
      jump.put = { x: this.host.player.x, z: this.host.player.z }
      return
    }
    if (!this.townReady) return
    const p = this.host.player
    if (!this.host.driving && Math.hypot(p.x - jump.put.x, p.z - jump.put.z) < 1.5 && this.obstacle(p.x, p.z, 0.5)) this.dev.goTo(land.toSceneX(jump.x), land.toSceneZ(jump.z), this.host.facing, label, true)
    this.jump = null
  }

  // ------------------------------------------------------------ the walker

  collide(p: Vector3, r: number): void {
    if (!this.physics || !this.land.holdsScene(p.x, p.z)) return
    const t = sceneToTown(p.x, p.y, p.z, this._t)
    const q = { x: t.x, z: t.z }
    const hitStatic = this.physics.pushOut(q, t.y, r)
    const hitVehicle = this.physics.pushOutVehicles(q, t.y, r)
    const s = townToScene(q.x, t.y, q.z, this._t)
    const moved = { x: s.x, z: s.z }
    const hitTree = this.montello.pushTrees(moved, r)
    if (!hitStatic && !hitVehicle && !hitTree) return
    p.x = moved.x
    p.z = moved.z
  }

  obstacle(x: number, z: number, r: number): boolean {
    if (!this.land.holdsScene(x, z)) return false
    const t = sceneToTown(x, 0, z, this._t)
    return this.physics.blocked(t.x, t.z, this.host.terrain.heightAt(x, z) - TOWN_OFFSET.y, r)
  }

  spawn(): { at: Vector3; facing: number } | null {
    const home = this.homeLot()
    if (home) {
      const dir = home.front === '+z' ? 1 : -1
      const frontZ = home.front === '+z' ? home.z + home.d : home.z
      const p = townToScene(home.x + 8, 0, frontZ - dir * 2)
      return { at: new Vector3(p.x, this.land.heightAt(this.land.toMapX(p.x), this.land.toMapZ(p.z)), p.z), facing: dir > 0 ? 0 : Math.PI }
    }
    const s = this.start
    return { at: new Vector3(this.land.toSceneX(s.x), this.land.heightAt(s.x, s.z), this.land.toSceneZ(s.z)), facing: s.heading }
  }

  greeting(): string {
    return 'Welcome to Montello, Wisconsin. Your pickup is parked just ahead: E to drive, Ctrl for the map and directions.'
  }

  placeName(x: number, z: number): string | null {
    if (!this.montello) return null
    return this.montello.placeName(x, z)
  }

  // ------------------------------------------------------------ interactions

  /** A bought Montello lot's scanned house comes down, so its owner can build their own. */
  private clearScannedHouse(lot: LotState): void {
    if (lot.owner && lot.scan !== undefined) this.montello.clearHouse(lot.scan)
  }

  /** The lot for sale you're standing on, on foot. */
  private lotForSale(): LotState | null {
    if (this.host.driving) return null
    const t = this.townPosition()
    const lots = this.houses.world?.lots
    for (const id in lots) {
      const lot = lots[id]
      if (lot.owner) continue
      if (t.x >= lot.x && t.x <= lot.x + lot.w && t.z >= lot.z && t.z <= lot.z + lot.d) return lot
    }
    return null
  }

  prompt(): string {
    const spawned = this.dev?.prompt()
    if (spawned) return spawned
    const seat = this.casinoMounted ? this.casino.prompt() : ''
    if (seat) return seat
    const place = this.places?.prompt()
    if (place) return place
    const lot = this.lotForSale()
    if (lot) return `E — Buy lot ${lot.id} for $${lotPrice(lot).toLocaleString()}`
    return ''
  }

  interact(): boolean {
    if (this.dev?.interact()) return true
    if (this.casinoMounted && this.casino.interact()) return true
    if (this.places?.interact()) return true
    const lot = this.lotForSale()
    if (!lot) return false
    if ((this.account?.money ?? 0) < lotPrice(lot)) this.host.hud.toast(`Lot ${lot.id} costs $${lotPrice(lot).toLocaleString()}. Work in town, fish and hunt to save up.`, 'warn')
    else this.send({ t: 'build', seq: ++this.buildSeq, op: { op: 'buyLot', lotId: lot.id } })
    return true
  }

  private key(e: KeyboardEvent): void {
    if (e.repeat) return
    const ctrl = e.code === 'ControlLeft' || e.code === 'ControlRight'
    if (this.map?.open) {
      if (ctrl) this.map.hide()
      return
    }
    if (!this.host.playing || this.host.hud.modalOpen) return
    if (ctrl) this.map?.show()
    else if (e.code === GARAGE_KEY) this.swapGarageVehicle()
    else if (e.code === HOME_KEY) this.goHome()
  }

  /** V: brings out the next vehicle you own (beside the pickup and trailer), parked at home or on Main Street. */
  private swapGarageVehicle(): void {
    const acc = this.account
    if (!acc) return
    const kinds = acc.garage.filter((k) => k !== STARTER_TRUCK && k !== 'trailer')
    if (!kinds.length) {
      this.host.hud.toast('Buy more vehicles at the dealership on Main Street; they show up here.')
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
    const p = this.startPose()
    const at = home ? homeSpot(home) : { x: p.x + Math.sin(p.heading) * 12, z: p.z - Math.cos(p.heading) * 12, yaw: p.yaw }
    const car = this.cars.add(next, at.x, at.z, at.yaw, acc)
    this.cars.parkVehicle(car.fp, at.x, at.z, at.yaw)
    this.cars.sync(car)
    this.extraKind = next
    this.host.hud.toast(`${VEHICLES[next]?.name ?? next} is out ${home ? `on your driveway at lot ${home.id}` : 'on Main Street'}. V swaps it.`)
  }

  private goHome(): void {
    if (this.host.driving) {
      this.host.hud.toast('Park and step out first.')
      return
    }
    if (this.host.mode === 'bowfish' || this.host.mode === 'crew') {
      this.host.hud.toast('Finish the boat ride first.')
      return
    }
    const home = this.homeLot()
    if (home) {
      const key = `maplestreet/go-home/${this.account?.id ?? 'guest'}`
      const last = Number(store.get(key) ?? 0) || 0
      const wait = Math.max(0, last + GO_HOME_COOLDOWN_MS - Date.now())
      if (wait > 0) {
        this.host.hud.toast(`Go home is ready again in ${Math.ceil(wait / 60000)} min`)
        return
      }
      store.set(key, String(Date.now()))
      this.standAtHome(home)
      this.host.hud.toast('Home sweet home. Your vehicles are where you left them.')
      return
    }
    const spawn = this.spawn()!
    this.host.teleport(spawn.at, spawn.facing)
    this.host.hud.toast('Back on Main Street. Buy a lot and H takes you home.')
  }

  /** The corner map is Tello's own map of Montello (Rack & Reel's is hidden). */
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

  controls(): ControlRow[] {
    return [
      { keys: ['Ctrl'], text: 'Map of Montello: click a place or a spot for turn-by-turn directions' },
      { keys: ['N'], text: 'Zoom the corner map' },
      { keys: ['V'], text: 'Bring out your next vehicle' },
      { keys: ['H'], text: 'Go home (every 15 minutes), or back to Main Street' },
      ...(this.dev?.controls() ?? []),
    ]
  }

  get roomCode(): string | null {
    return this.net instanceof WorldTransport ? 'WORLD' : null
  }

  debug(): Record<string, unknown> {
    return {
      net: this.net?.label ?? null,
      status: this.netStatus,
      neighbors: this.neighbors?.count ?? 0,
      colliders: this.physics?.streamStats(),
      cars: [...(this.cars?.list.keys() ?? [])],
      culled: this.culler.stats(),
      montello: { started: this.townStarted, ready: this.townReady, treeCellsSolid: this.montello?.solidTreeCells },
      serverHours: this.serverHours,
    }
  }
}

const EMPTY: readonly AbstractMesh[] = []

function homeSpot(lot: LotDef): { x: number; z: number; yaw: number } {
  const dir = lot.front === '+z' ? 1 : -1
  const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z
  return { x: lot.x + 8.6, z: frontZ - dir * 5.5, yaw: dir > 0 ? -Math.PI / 2 : Math.PI / 2 }
}
