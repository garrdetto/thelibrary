/**
 * The standalone Truck Simulator page as a `TruckHost`: Babylon on WebGPU or WebGL2 (Rack & Reel's `createEngine`), a
 * right-handed scene, the county's sky, terrain, roads, trees and site scenery streamed around the camera, every truck lot on
 * Haulers Row, the work-zone equipment, the session, cameras, HUD, panels, synthesised sound and the memory guard. Everything is
 * owned by one `Scope` and torn down on `pagehide`.
 */
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Scene } from '@babylonjs/core/scene'
import { createEngine } from '../../rackreel/core/EngineBoot'
import { attachResolution } from '../../rackreel/core/Resolution'
import { Progress } from '../net/Progress'
import { LotRenderer } from '../render/Lots'
import { MaterialLibrary } from '../render/Materials'
import { buildTruckVisual } from '../render/models/TruckVisual'
import type { TruckVisual } from '../render/models/TruckVisual'
import { lowerTier, resolveTier } from '../render/Quality'
import type { QualityTier } from '../render/Quality'
import { createWorkZones } from '../render/work/WorkZones'
import { createAtmosphere } from '../render/world/Atmosphere'
import type { Atmosphere } from '../render/world/Atmosphere'
import { createPipeline } from '../render/world/Pipeline'
import type { WorldPipeline } from '../render/world/Pipeline'
import { DEALER_DISPLAY_SPOTS, createSiteLayer, siteStaticBoxes } from '../render/world/Sites'
import { createWorldRenderer } from '../render/world/WorldRenderer'
import { truckResale } from '../shared/Actions'
import { FUEL_PRICE_PER_L, REPAIR_COST_PER_POINT, RESALE_SHARE, TRAILER_BY_ID, TRUCKS, TRUCK_BY_ID, defaultLook, lookCost } from '../shared/Catalog'
import { FUEL_STATION_MARKUP, REPAIR_LABOUR_MARKUP, level } from '../shared/Economy'
import type { Profile } from '../shared/Economy'
import { generateJobs, jobSlot } from '../shared/Jobs'
import { hasService } from '../shared/Lots'
import { COUNTY } from '../shared/RoadGraph'
import { getTerrain } from '../shared/Terrain'
import { ALL_ZONES, DEFAULT_SPAWN, LOTS, SITES, SITE_BY_ID, ZONE_BY_ID } from '../shared/WorldLayout'
import type { LotSpec } from '../shared/WorldLayout'
import { SimWorld } from '../sim/SimWorld'
import { TruckAudio } from '../systems/Audio'
import { Keys } from '../systems/Keys'
import { MemoryGuard } from '../systems/MemoryGuard'
import { Scope } from '../systems/Scope'
import { Hud } from '../ui/Hud'
import { openDealer, openFleet, openGarage } from '../ui/Shop'
import { openHelp, openJobBoard, openMap, openPause, showStart } from '../ui/Panels'
import type { PanelHandle } from '../ui/Panels'
import { BuildMode } from './BuildMode'
import { CameraRig } from './Cameras'
import type { FollowSubject } from './Cameras'
import { CountyMap } from './MapDraw'
import type { MapMarkers } from './MapDraw'
import { TruckSession } from './TruckSession'
import type { SessionView } from './TruckSession'
import type { ToastKind, TruckHost } from './TruckHost'

export interface BootProgress {
  (share: number, text: string): void
}

const DAY_MINUTES_PER_SECOND = 1
const DEALER_SHOW = 520
const DEALER_HIDE = 720

export class Standalone implements TruckHost {
  readonly scene: Scene
  readonly frameRoot: TransformNode
  readonly mats: MaterialLibrary
  readonly world = COUNTY
  physics!: SimWorld
  progress!: Progress
  private readonly scope = new Scope('trucksim')
  private readonly engine: AbstractEngine
  private readonly terrain = getTerrain()
  private keysSource!: Keys
  private hud!: Hud
  private cameras!: CameraRig
  private atmosphere!: Atmosphere
  private pipeline: WorldPipeline | null = null
  private tier: QualityTier
  private session!: TruckSession
  private lotsRenderer!: LotRenderer
  private readonly lotBoxes = new Map<number, number[]>()
  private panel: PanelHandle | null = null
  private building: BuildMode | null = null
  private started = false
  private hours = 8.5
  private audio = new TruckAudio()
  private volume = 0.7
  private countyMap = new CountyMap()
  private readonly markers: MapMarkers = { rig: { x: 0, z: 0, heading: 0 }, target: null, route: null, ownLot: null }
  private readonly follow: FollowSubject = { x: 0, y: 0, z: 0, heading: 0, span: 10, eye: { x: 0, y: 0, z: 0 }, speed: 0 }
  private readonly highlight = new Set<string>()
  private readonly cameraPos = new Vector3()
  private dealerVisuals: TruckVisual[] = []
  private guard!: MemoryGuard
  private lastCash = -1
  private lastBuildKey = ''
  private lotsTimer = 120
  private clockTimer = 0
  private disposed = false

  private constructor(engine: AbstractEngine, private readonly canvas: HTMLCanvasElement, private readonly uiRoot: HTMLElement, backend: 'webgpu' | 'webgl2') {
    this.engine = engine
    this.scene = new Scene(engine)
    this.scene.useRightHandedSystem = true
    this.scene.clearColor = new Color4(0.62, 0.72, 0.84, 1)
    this.scene.skipPointerMovePicking = true
    this.frameRoot = new TransformNode('trucksim-frame', this.scene)
    this.mats = new MaterialLibrary(this.scene)
    this.tier = resolveTier(location.search, backend)
  }

  static async boot(canvas: HTMLCanvasElement, uiRoot: HTMLElement, report: BootProgress): Promise<Standalone> {
    report(0.05, 'Starting the graphics engine…')
    const boot = await createEngine(canvas)
    const host = new Standalone(boot.engine, canvas, uiRoot, boot.backend)
    await host.build(report)
    boot.watchFirstFrame()
    return host
  }

  get keys(): ReadonlySet<string> {
    return this.keysSource.codes
  }

  lotFor(index: number | null): LotSpec | null {
    return index === null ? null : LOTS[index] ?? null
  }

  spawnPoint(): { x: number; z: number; heading: number } {
    return DEFAULT_SPAWN
  }

  addCaster(mesh: AbstractMesh): void {
    this.atmosphere?.addCaster(mesh)
  }

  removeCaster(mesh: AbstractMesh): void {
    this.atmosphere?.removeCaster(mesh)
  }

  toast(text: string, kind: ToastKind = 'info'): void {
    this.hud?.toast(text, kind)
  }

  paused(): boolean {
    return !this.started || this.panel !== null || this.building !== null
  }

  private async build(report: BootProgress): Promise<void> {
    const scene = this.scene
    report(0.15, 'Loading your career…')
    this.progress = await Progress.load(COUNTY)
    report(0.3, 'Grading the county roads…')
    this.physics = this.scope.track(await SimWorld.create(this.terrain))
    for (const site of SITES) for (const box of siteStaticBoxes(site.id)) this.physics.addStaticBox(box)
    this.keysSource = this.scope.track(new Keys(window, { canvas: this.canvas }))
    this.cameras = this.scope.track(new CameraRig(scene, this.canvas, (x, z) => this.terrain.heightAt(x, z)))
    report(0.45, 'Raising the sun…')
    this.atmosphere = this.scope.track(createAtmosphere(scene, { tier: this.tier, camera: this.cameras.drive, hours: this.hours }))
    this.pipeline = createPipeline(scene, this.cameras.drive, this.tier)
    this.guard = this.scope.track(new MemoryGuard(scene, {}))
    report(0.6, 'Building the sites…')
    const siteLayer = createSiteLayer(scene, this.mats, this.terrain)
    const worldRenderer = this.scope.track(createWorldRenderer(scene, this.frameRoot, this.terrain, this.guard, this.tier, [siteLayer], { atmosphere: this.atmosphere }))
    const workZones = this.scope.track(createWorkZones(scene, this.frameRoot, this.mats, ALL_ZONES, (x, z) => this.terrain.heightAt(x, z)))
    this.lotsRenderer = this.scope.track(new LotRenderer(scene, this.frameRoot, this.mats, this.terrain))
    this.hud = this.scope.track(new Hud(this.uiRoot))
    this.session = this.scope.track(new TruckSession(this, {
      openDealer: () => this.openDealerPanel(),
      jobDone: (message, pay) => {
        this.hud.toast(`${message}${pay > 0 ? ` · +$${Math.round(pay).toLocaleString()}` : ''}`, 'good')
        this.audio.airBrake(0.6)
      },
      horn: (on) => this.audio.setHorn(on ? (this.session.truck && this.progress.profile.trucks.find((t) => t.uid === this.progress.profile.activeTruck)?.look.horn === 'air' ? 'air' : 'stock') : null),
      airBrake: () => this.audio.airBrake(),
    }))
    this.drawLots(this.progress.profile)
    this.scope.defer(this.progress.onChange((profile) => this.onProfile(profile)))
    this.guard.registerGauge('physics chunks', () => this.physics.loadedChunks)
    this.guard.registerGauge('cached paints', () => this.mats.cachedCount, 120)
    this.guard.registerGauge('work zones built', () => workZones.built)
    this.scope.defer(this.guard.onPressure((level) => {
      if (level !== 'critical' || this.tier === 'low') return
      this.mats.trim(24)
      this.setTier(lowerTier(this.tier))
      this.hud.toast(`Graphics lowered to ${this.tier} to keep memory steady`, 'warn')
    }))
    const rig = this.session.rigPosition()
    report(0.8, 'Streaming the land around your lot…')
    worldRenderer.prime(rig.x, rig.z)
    this.physics.stream([rig])
    this.hud.setMinimap((ctx, size) => {
      this.countyMap.drawMinimap(ctx, size, 900, this.markers)
    })
    const resolution = attachResolution(this.engine, this.canvas)
    const onResize = () => {
      this.engine.resize()
      resolution.refit()
    }
    window.addEventListener('resize', onResize)
    this.scope.defer(() => window.removeEventListener('resize', onResize))
    const onKey = (e: KeyboardEvent) => this.onKey(e)
    window.addEventListener('keydown', onKey)
    this.scope.defer(() => window.removeEventListener('keydown', onKey))
    report(1, 'Ready')
    let lastFrame = performance.now()
    this.engine.runRenderLoop(() => {
      if (this.disposed) return
      const now = performance.now()
      const dt = Math.min(0.1, Math.max(0.001, (now - lastFrame) / 1000))
      lastFrame = now
      const view = this.session.frame(dt, (before) => {
        this.physics.step(dt, before)
      })
      const p = this.session.rigPosition()
      this.physics.stream(this.session.excavator ? [p, this.session.excavator.pose().position] : [p], 2)
      if (this.building === null) this.cameras.update(dt, this.session.followSubject(this.follow))
      const active = this.cameras.active
      this.cameraPos.copyFrom(active.globalPosition)
      worldRenderer.update(this.cameraPos, now)
      this.atmosphere.update(this.cameraPos)
      workZones.setFocus(p.x, p.z)
      workZones.update(dt, this.session.zoneActivity())
      workZones.highlight(this.session.highlightZones(this.highlight))
      this.updateDealerDisplay(p.x, p.z)
      this.updateClock(dt)
      this.updateHud(view, p)
      this.updateAudio(view)
      this.lotsTimer -= dt
      if (this.lotsTimer <= 0) {
        this.lotsTimer = 120
        void this.progress.refreshLots().then(() => this.drawLots(this.progress.profile))
      }
      this.keysSource.endFrame()
      resolution.update(now, this.engine.getFps())
      this.scene.render()
    })
    this.scope.defer(() => this.engine.stopRenderLoop())
    this.showStartScreen()
  }

  private showStartScreen(): void {
    const profile = this.progress.profile
    this.panel = showStart(this.uiRoot, {
      signedIn: this.progress.signedIn,
      username: this.progress.username,
      company: profile.company,
      onStart: (company) => {
        this.panel = null
        this.started = true
        this.audio.start()
        this.audio.setVolume(this.volume)
        this.canvas.focus()
        if (this.progress.signedIn && company && company !== this.progress.profile.company) void this.progress.act({ action: 'rename', company })
        if (this.progress.offline) this.hud.toast('The yard office is offline: driving as a guest for this visit', 'warn')
        else if (!this.progress.signedIn) this.hud.toast('Driving as a guest: sign in to the library to keep your trucks and lot', 'info')
        this.hud.toast('Press J for the job board, M for the map, O for your fleet, Y to build on your lot', 'info')
      },
    })
  }

  private onProfile(profile: Profile): void {
    const key = JSON.stringify([profile.lot, profile.company, profile.build])
    if (key !== this.lastBuildKey) this.drawLots(profile)
  }

  /** Draws every lot on the Row: yours from your profile, the others from the public list, the rest for lease. */
  private drawLots(profile: Profile): void {
    this.lastBuildKey = JSON.stringify([profile.lot, profile.company, profile.build])
    const others = new Map(this.progress.lots.map((lot) => [lot.index, lot]))
    for (const lot of LOTS) {
      const mine = profile.lot === lot.index
      const other = others.get(lot.index)
      const owner = mine ? { name: this.progress.username ?? 'You', company: profile.company } : other ? { name: other.owner, company: other.company } : null
      const items = mine ? profile.build : other?.build ?? []
      this.lotsRenderer.setLot(lot, owner, items)
      for (const id of this.lotBoxes.get(lot.index) ?? []) this.physics.removeStatic(id)
      this.lotBoxes.set(lot.index, this.lotsRenderer.staticBoxes(lot.index).map((box) => this.physics.addStaticBox(box)))
    }
    this.markers.ownLot = profile.lot
  }

  private updateDealerDisplay(x: number, z: number): void {
    const dealer = SITE_BY_ID.dealer
    if (!dealer) return
    const d = Math.hypot(x - dealer.x, z - dealer.z)
    if (this.dealerVisuals.length === 0 && d < DEALER_SHOW) {
      const picks = ['kestrel-cx-day', 'pinnacle-lh-sleeper', 'northstar-aero-sleeper', 'ironhaul-dx', 'pinnacle-lh-lwb', 'bedrock-quad']
      DEALER_DISPLAY_SPOTS.forEach((spot, i) => {
        const model = TRUCK_BY_ID[picks[i % picks.length]] ?? TRUCKS[i % TRUCKS.length]
        const visual = buildTruckVisual(this.scene, this.frameRoot, model, defaultLook(model), this.mats)
        const y = this.terrain.heightAt(spot.x, spot.z) + 0.12
        visual.update({
          position: { x: spot.x, y, z: spot.z }, rotation: { x: 0, y: Math.sin(spot.heading / 2), z: 0, w: Math.cos(spot.heading / 2) },
          wheels: model.axles.flatMap((axle) => [1, -1].map((side) => ({ x: (side * model.track) / 2, y: model.wheelRadius, z: axle.z, steer: 0, spin: 0, radius: model.wheelRadius, dual: axle.dual, lifted: Boolean(axle.lift) }))),
          dumpAngle: 0, tailgate: 0, brakeLights: false, reversing: false, headlights: false, load: 0,
        })
        for (const mesh of visual.meshes) this.atmosphere.addCaster(mesh)
        this.dealerVisuals.push(visual)
      })
    } else if (this.dealerVisuals.length > 0 && d > DEALER_HIDE) this.clearDealerDisplay()
  }

  private clearDealerDisplay(): void {
    for (const visual of this.dealerVisuals) {
      for (const mesh of visual.meshes) this.atmosphere.removeCaster(mesh)
      visual.dispose()
    }
    this.dealerVisuals = []
  }

  private updateClock(dt: number): void {
    if (!this.started) return
    this.hours = (this.hours + (dt * DAY_MINUTES_PER_SECOND) / 60) % 24
    this.clockTimer -= dt
    if (this.clockTimer <= 0) {
      this.clockTimer = 0.25
      this.atmosphere.setTime(this.hours)
      if (this.session.truck) this.session.truck.headlights = this.session.truck.headlights || this.atmosphere.night > 0.6
    }
  }

  private updateHud(view: SessionView, p: { x: number; z: number; heading: number }): void {
    const profile = this.progress.profile
    this.hud.setGauges(view.gauges)
    if (profile.cash !== this.lastCash) {
      this.lastCash = profile.cash
      this.hud.setCash(profile.cash)
      this.hud.setLevel(level(profile.xp))
    }
    this.hud.setClock(this.hours)
    this.hud.setPlace(view.place)
    this.hud.setJob(view.job)
    this.hud.setSteps(view.steps)
    this.hud.prompt(this.started && !this.building ? view.prompt : null)
    this.markers.rig.x = p.x
    this.markers.rig.z = p.z
    this.markers.rig.heading = p.heading
    this.markers.target = view.target
    this.markers.route = view.route
  }

  private updateAudio(view: SessionView): void {
    if (!this.audio.started) return
    const g = view.gauges
    this.audio.setEngine(g.rpm, view.engineLoad)
    this.audio.setJakeBrake(g.engineBrake && view.engineLoad === 0 && g.rpm > 1150 && g.speedKph > 15)
    this.audio.setBackupBeeper(view.reversing && g.speedKph > 0.5)
    this.audio.setHydraulic(view.hydraulic)
  }

  private setTier(tier: QualityTier): void {
    this.tier = tier
    this.atmosphere.setQuality(tier)
    this.pipeline?.setTier(tier)
  }

  private openPanel(open: () => PanelHandle): void {
    if (this.panel || this.building) return
    this.keysSource.clear()
    this.panel = open()
  }

  private closed = (): void => {
    this.panel = null
    this.keysSource.clear()
    this.canvas.focus()
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.started || this.building || this.panel) return
    switch (e.code) {
      case 'KeyJ': this.openJobBoardPanel(); break
      case 'KeyM': this.openPanel(() => openMap(this.uiRoot, { draw: (ctx, w, h) => this.countyMap.drawFull(ctx, w, h, this.markers), onClose: this.closed })); break
      case 'KeyO': this.openFleetPanel(); break
      case 'KeyY': this.enterBuildMode(); break
      case 'KeyC': this.cameras.toggleView(); break
      case 'F1': e.preventDefault(); this.openPanel(() => openHelp(this.uiRoot, { onClose: this.closed })); break
      case 'F9': this.session.respawn(); this.hud.toast('Rig brought back to your lot', 'info'); break
      case 'Escape': this.openPanel(() => openPause(this.uiRoot, {
        tier: this.tier, volume: this.volume,
        onTier: (tier) => this.setTier(tier),
        onVolume: (v) => {
          this.volume = v
          this.audio.setVolume(v)
        },
        onResume: this.closed,
      })); break
      default: break
    }
  }

  private openJobBoardPanel(): void {
    const siteName = (id: string) => {
      const zone = ZONE_BY_ID[id]
      return zone ? `${SITE_BY_ID[zone.site]?.name ?? zone.site} · ${zone.label}` : id
    }
    this.openPanel(() => {
      const board = openJobBoard(this.uiRoot, {
        jobs: generateJobs(COUNTY, jobSlot(Date.now())),
        profile: this.progress.profile,
        canTake: (job) => this.session.canTake(job),
        siteName,
        onAccept: async (job) => {
          const result = await this.progress.act({ action: 'accept-job', job: job.id })
          this.hud.toast(result.message || (result.ok ? 'Job accepted' : 'Could not take that job'), result.ok ? 'good' : 'warn')
          if (result.ok) {
            board.close()
          } else board.update(this.progress.profile)
        },
        onAbandon: async () => {
          const result = await this.progress.act({ action: 'abandon-job' })
          this.hud.toast(result.message || 'Job abandoned', result.ok ? 'info' : 'warn')
          board.update(this.progress.profile)
        },
        onClose: this.closed,
      })
      return board
    })
  }

  private openDealerPanel(): void {
    this.openPanel(() => {
      const dealer = openDealer(this.uiRoot, {
        profile: this.progress.profile,
        onBuyTruck: async (model, look) => {
          const result = await this.progress.act({ action: 'buy-truck', model, look })
          this.hud.toast(result.message || (result.ok ? 'Bought! It is waiting at your lot' : 'Could not buy that'), result.ok ? 'good' : 'warn')
          dealer.update(this.progress.profile)
        },
        onBuyTrailer: async (model) => {
          const result = await this.progress.act({ action: 'buy-trailer', model })
          this.hud.toast(result.message || (result.ok ? 'Bought! It is waiting at your lot' : 'Could not buy that'), result.ok ? 'good' : 'warn')
          dealer.update(this.progress.profile)
        },
        onClose: this.closed,
      })
      return dealer
    })
  }

  private atServiceOrShop(): boolean {
    const p = this.session.rigPosition()
    const lot = this.lotFor(this.progress.profile.lot)
    if (lot && hasService(this.progress.profile.build) && p.x >= lot.x && p.x <= lot.x + lot.w && p.z >= lot.z && p.z <= lot.z + lot.d) return true
    return ALL_ZONES.some((zone) => zone.kind === 'service' && Math.abs(p.x - zone.x) < zone.w / 2 + 6 && Math.abs(p.z - zone.z) < zone.d / 2 + 6)
  }

  private openFleetPanel(): void {
    const profile = () => this.progress.profile
    const shop = () => hasService(profile().build)
    this.openPanel(() => {
      const fleet = openFleet(this.uiRoot, {
        profile: profile(),
        onSelect: async (truck, trailer) => {
          const result = await this.progress.act({ action: 'select', truck, trailer })
          this.hud.toast(result.message || (result.ok ? 'Your rig is ready at the lot' : 'Could not switch rigs'), result.ok ? 'good' : 'warn')
          fleet.update(profile())
        },
        onSell: async (kind, uid) => {
          const result = await this.progress.act(kind === 'truck' ? { action: 'sell-truck', uid } : { action: 'sell-trailer', uid })
          this.hud.toast(result.message || (result.ok ? 'Sold' : 'Could not sell that'), result.ok ? 'good' : 'warn')
          fleet.update(profile())
        },
        onRepair: async (uid) => {
          if (!this.atServiceOrShop()) {
            this.hud.toast('Drive to a service bay or a shop on your lot for repairs', 'warn')
            return
          }
          const result = await this.progress.act({ action: 'repair', uid })
          this.hud.toast(result.message || (result.ok ? 'Repaired' : 'Could not repair'), result.ok ? 'good' : 'warn')
          fleet.update(profile())
        },
        onRefuel: () => this.hud.toast('Pull into a fuel lane (or your own fuel island) and press E', 'info'),
        onCustomise: (uid) => {
          if (uid !== profile().activeTruck) {
            this.hud.toast('Select that truck first, then customise it', 'info')
            return
          }
          fleet.close()
          this.openGaragePanel()
        },
        repairCost: (uid) => {
          const truck = profile().trucks.find((t) => t.uid === uid)
          const trailer = profile().trailers.find((t) => t.uid === uid)
          const damage = truck?.damage ?? trailer?.damage ?? 0
          return Math.round(damage * REPAIR_COST_PER_POINT * (shop() ? 1 : REPAIR_LABOUR_MARKUP))
        },
        refuelCost: (uid) => {
          const truck = profile().trucks.find((t) => t.uid === uid)
          const model = truck ? TRUCK_BY_ID[truck.model] : null
          return truck && model ? Math.round(Math.max(0, model.fuelTankL - truck.fuelL) * FUEL_PRICE_PER_L * FUEL_STATION_MARKUP) : 0
        },
        sellValue: (kind, uid) => {
          if (kind === 'truck') {
            const truck = profile().trucks.find((t) => t.uid === uid)
            const model = truck ? TRUCK_BY_ID[truck.model] : null
            return truck && model ? truckResale(model.price, truck.damage) : 0
          }
          const trailer = profile().trailers.find((t) => t.uid === uid)
          const model = trailer ? TRAILER_BY_ID[trailer.model] : null
          return trailer && model ? Math.round(model.price * RESALE_SHARE * (1 - trailer.damage / 200)) : 0
        },
        onClose: this.closed,
      })
      return fleet
    })
  }

  private openGaragePanel(): void {
    const profile = this.progress.profile
    const truck = profile.trucks.find((t) => t.uid === profile.activeTruck)
    if (!truck) return
    this.openPanel(() => openGarage(this.uiRoot, {
      profile,
      truck,
      onPreview: (look) => this.session.previewLook(look),
      price: (look) => lookCost(truck.look, look),
      onSave: async (look) => {
        const result = await this.progress.act({ action: 'customize', uid: truck.uid, look })
        this.hud.toast(result.message || (result.ok ? 'Fresh look saved' : 'Could not save that look'), result.ok ? 'good' : 'warn')
        this.session.previewLook(null)
      },
      onClose: () => {
        this.session.previewLook(null)
        this.closed()
      },
    }))
  }

  private enterBuildMode(): void {
    const lot = this.lotFor(this.progress.profile.lot)
    if (!lot) {
      this.hud.toast('You need a lot on Haulers Row to build. Every signed-in driver gets one.', 'warn')
      return
    }
    this.keysSource.clear()
    this.pipeline?.dispose()
    this.pipeline = null
    this.hud.setVisible(false)
    this.building = new BuildMode({
      scene: this.scene, canvas: this.canvas, cameras: this.cameras, lots: this.lotsRenderer, progress: this.progress, uiRoot: this.uiRoot, lot,
      heightAt: (x, z) => this.terrain.heightAt(x, z),
      toast: (text, kind) => this.hud.toast(text, kind),
      onExit: () => {
        this.building = null
        this.hud.setVisible(true)
        this.pipeline?.dispose()
        this.pipeline = createPipeline(this.scene, this.cameras.drive, this.tier)
        this.keysSource.clear()
        this.canvas.focus()
      },
    })
    this.pipeline = createPipeline(this.scene, this.cameras.build, this.tier)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.building?.dispose()
    this.panel?.close()
    this.clearDealerDisplay()
    this.pipeline?.dispose()
    this.audio.dispose()
    this.scope.dispose()
    this.mats.dispose()
    this.scene.dispose()
    this.engine.dispose()
  }
}
