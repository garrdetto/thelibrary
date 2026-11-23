/**
 * The Take Flight page: boots Babylon on WebGPU (WebGL2 fallback) with a reverse depth buffer, builds the sky, terrain, water,
 * Harrow Field and the Wren, and runs the flight. The flight model ticks at a fixed 120 Hz inside `Simulation`; each frame reads
 * the pilot's devices, advances the sim, interpolates the aircraft between ticks, and moves the camera, terrain, lights, cockpit
 * gauges, HUD and overlay. The start screen picks where and how to fly; Escape pauses. `FlightSession` records and scores each
 * flight: stopping after a landing, ending it from the pause screen or a crash opens the debrief, which can play the touchdown
 * replay re-flown by `TouchdownReplay`. Every Babylon resource, observer and DOM listener belongs to one `Scope` torn down on
 * `pagehide`.
 */
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { Scene } from '@babylonjs/core/scene'
import { createEngine } from '../../rackreel/core/EngineBoot'
import { attachResolution } from '../../rackreel/core/Resolution'
import type { Resolution } from '../../rackreel/core/Resolution'
import { Scope } from '../../trucksim/systems/Scope'
import { resolveTier } from '../../trucksim/render/Quality'
import { createAtmosphere } from '../../trucksim/render/world/Atmosphere'
import type { Atmosphere } from '../../trucksim/render/world/Atmosphere'
import { createPipeline } from '../../trucksim/render/world/Pipeline'
import type { WorldPipeline } from '../../trucksim/render/world/Pipeline'
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator'
import type { AircraftSpec } from '../shared/AircraftSpec'
import { HARROW_FIELD, airportById, nearestAirport } from '../shared/Airports'
import type { AirportSpec } from '../shared/Airports'
import { approachFor } from '../shared/Approach'
import type { ApproachState } from '../shared/Approach'
import { CHECKRIDE_SPECS, LICENCE_LABELS, summarizeFlight } from '../shared/Career'
import { FLEET, fleetSpec } from '../shared/Fleet'
import { hangarEntry } from '../shared/Hangar'
import type { CheckrideId } from '../shared/Career'
import { RECORD_VERSION } from '../shared/FlightRecord'
import type { RecordHeader } from '../shared/FlightRecord'
import { TERRAIN, WATER_LEVEL } from '../shared/Terrain'
import { NO_ASSISTS } from '../sim/Assists'
import { FOOT, FPM, SEA_LEVEL_PRESSURE } from '../sim/Atmosphere'
import { runwayContact } from '../sim/Scoring'
import type { EndReason } from '../sim/Scoring'
import { Simulation } from '../sim/Simulation'
import type { InterpolatedState } from '../sim/Simulation'
import { placeStart } from '../sim/Starts'
import type { TouchdownEvent } from '../sim/Telemetry'
import type { WindSpec } from '../sim/Wind'
import { CALM } from '../sim/Wind'
import { InputManager } from '../input/InputManager'
import type { PilotAction } from '../input/InputManager'
import { AircraftVisual } from '../render/AircraftVisual'
import { Cockpit } from '../render/Cockpit'
import { FLIGHT_QUALITY } from '../render/Quality'
import type { QualityTier } from '../render/Quality'
import { TerrainRenderer } from '../render/TerrainRenderer'
import { WeatherView } from '../render/WeatherView'
import { AssetManager } from '../world/AssetManager'
import { CareerPanel } from '../ui/CareerPanel'
import { Debrief } from '../ui/Debrief'
import { DevOverlay } from '../ui/DevOverlay'
import { Hud } from '../ui/Hud'
import { Menus } from '../ui/Menus'
import type { FlightOptions, StartKind, TimeKind, WindKind } from '../ui/Menus'
import { CameraRig, VIEW_ORDER } from './Cameras'
import { CareerStore } from './CareerStore'
import { allPlaces } from '../shared/Towns'
import { World } from './World'
import { FlightSession } from './FlightSession'
import { TouchdownReplay } from './TouchdownReplay'

export interface BootProgress {
  (share: number, text: string): void
}

type Phase = 'menu' | 'flying' | 'paused' | 'debrief' | 'replay'

const WINDS: Record<WindKind, WindSpec> = {
  calm: CALM,
  light: { direction: 90, speed: 3.1, gust: 0, turbulence: 0.12 },
  crosswind: { direction: 180, speed: 6.2, gust: 1.2, turbulence: 0.25 },
  gusty: { direction: 240, speed: 7.2, gust: 5.1, turbulence: 0.5 },
}
const HOURS: Record<TimeKind, number> = { morning: 8.2, noon: 12.5, evening: 18.9, night: 22.5 }
const VIEW_NAMES = { cockpit: 'Cockpit', chase: 'Chase', tower: 'Tower' } as const

export class Standalone {
  readonly scene: Scene
  spec: AircraftSpec
  readonly sim: Simulation
  private readonly scope = new Scope('takeflight')
  private readonly engine: AbstractEngine
  private tier: QualityTier
  private readonly assets: AssetManager
  private readonly cameras: CameraRig
  private readonly input: InputManager
  private readonly hud: Hud
  private readonly menus: Menus
  private readonly dev: DevOverlay
  private readonly session: FlightSession
  private readonly replay: TouchdownReplay
  private readonly debrief: Debrief
  private readonly career = new CareerStore()
  private readonly careerPanel: CareerPanel
  private instrumentsOnly = false
  private failureAnnounced = false
  private submittedSeconds = 0
  private atmosphere!: Atmosphere
  private pipeline: WorldPipeline | null = null
  private terrain!: TerrainRenderer
  private world!: World
  private weather!: WeatherView
  private towerAirport: AirportSpec = HARROW_FIELD
  private water!: Mesh
  private visual!: AircraftVisual
  private cockpit!: Cockpit
  private resolution!: Resolution
  private phase: Phase = 'menu'
  private options: FlightOptions | null = null
  private readonly state: InterpolatedState = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }
  private lightsOn = false
  private parkingBrake = false
  private minimalHud = false
  private simMs = 0
  private endTimer = 0
  private menuOrbit = 0
  private readonly wind = { x: 0, y: 0, z: 0 }
  private readonly eyeWorld = new Vector3()

  private constructor(engine: AbstractEngine, private readonly backend: 'webgpu' | 'webgl2', private readonly canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.engine = engine
    engine.useReverseDepthBuffer = true
    this.scene = new Scene(engine)
    this.scene.useRightHandedSystem = true
    this.scene.clearColor = new Color4(0.6, 0.72, 0.86, 1)
    this.scene.skipPointerMovePicking = true
    this.scene.autoClear = true
    this.spec = FLEET[0]
    this.tier = resolveTier(location.search, backend)
    this.sim = new Simulation({ aircraft: this.spec, ground: TERRAIN, wind: CALM, seed: 1, temperatureOffset: 0, seaLevelPressure: SEA_LEVEL_PRESSURE, assists: { ...NO_ASSISTS } })
    this.assets = new AssetManager(this.scene)
    this.scope.track(this.assets)
    this.cameras = new CameraRig(this.scene)
    this.input = this.scope.track(new InputManager(canvas))
    this.hud = this.scope.track(new Hud(ui))
    this.hud.setVisible(false)
    this.dev = this.scope.track(new DevOverlay(ui, this.scene, engine, {
      simMs: () => this.simMs,
      assets: () => this.assets.stats,
      terrain: () => this.terrain.stats,
      backend,
      tier: this.tier,
    }))
    this.careerPanel = this.scope.track(new CareerPanel(ui, {
      checkride: (id) => this.startCheckride(id),
      cargo: (job, aircraft) => {
        this.careerPanel.hide()
        this.startFlight({ ...this.menus.options, aircraft, airport: job.from, start: 'stand', checkride: null, job })
      },
      back: () => {
        this.careerPanel.hide()
        this.menus.showStart()
      },
    }))
    this.scope.defer(this.career.onChange(() => this.careerPanel.render(this.career.profile, this.career.mode, this.career.username)))
    this.careerPanel.render(this.career.profile, this.career.mode, this.career.username)
    this.menus = this.scope.track(new Menus(ui, this.input, {
      fly: (options) => this.startFlight(options),
      resume: () => this.resume(),
      restart: () => this.options && this.startFlight(this.options),
      end: () => this.endFlight('pilot'),
      quit: () => this.toMenu(),
      quality: (tier) => this.setTier(tier),
      checkrides: () => {
        this.menus.hide()
        this.careerPanel.showCheckrides(this.career.profile)
      },
      cargo: () => {
        this.menus.hide()
        this.careerPanel.showCargo(this.career.profile)
      },
    }, this.tier, `${this.spec.maker} ${this.spec.name}`, this.careerPanel.summary, Object.fromEntries(FLEET.map((spec) => [spec.id, `${spec.maker} ${spec.name}`]))))
    this.session = new FlightSession(this.sim)
    this.scope.defer(() => this.session.dispose())
    this.replay = new TouchdownReplay(TERRAIN)
    this.scope.defer(() => this.replay.stop())
    this.debrief = this.scope.track(new Debrief(ui, {
      replay: () => this.startReplay(),
      continueFlight: () => this.continueFlight(),
      again: () => this.options && this.startFlight(this.options),
      change: () => this.toMenu(),
    }, {
      speed: () => (this.replay.speed = this.replay.speed < 1 ? 1 : 0.5),
      camera: () => this.cameras.mode = this.cameras.mode === 'chase' ? 'tower' : 'chase',
      back: () => this.stopReplay(),
    }))
  }

  static async boot(canvas: HTMLCanvasElement, ui: HTMLElement, report: BootProgress): Promise<Standalone> {
    report(0.05, 'Starting the graphics engine…')
    const boot = await createEngine(canvas)
    const host = new Standalone(boot.engine, boot.backend, canvas, ui)
    await host.build(report)
    boot.watchFirstFrame()
    return host
  }

  /** Console and smoke-test hooks (`window.__takeflight`). */
  get debug(): { sim: Simulation; session: FlightSession; fly(options?: Partial<FlightOptions>): void; view(mode: 'cockpit' | 'chase' | 'tower'): void; end(): void; replay(): void; phase: Phase } {
    return {
      sim: this.sim,
      session: this.session,
      fly: (options) => this.startFlight({ ...this.menus.options, ...options }),
      view: (mode) => this.setView(mode),
      end: () => this.endFlight('pilot'),
      replay: () => this.startReplay(),
      phase: this.phase,
    }
  }

  private async build(report: BootProgress): Promise<void> {
    const scene = this.scene
    const quality = FLIGHT_QUALITY[this.tier]
    report(0.15, 'Lighting the sky…')
    this.atmosphere = createAtmosphere(scene, { tier: this.tier, camera: this.cameras.camera, hours: HOURS.noon, fogRange: quality.viewDistance * 0.85 })
    this.scope.track(this.atmosphere)
    this.cameras.camera.maxZ = quality.viewDistance * 1.25
    try {
      this.pipeline = createPipeline(scene, this.cameras.camera, this.tier)
      this.scope.track(this.pipeline)
    } catch (error) {
      console.warn('Take Flight: post-processing unavailable', error)
    }
    report(0.3, 'Raising the hills…')
    this.weather = new WeatherView(scene, this.atmosphere, this.tier, this.backend === 'webgpu')
    this.scope.defer(() => this.weather.dispose())
    this.world = new World(scene)
    this.scope.defer(() => this.world.dispose())
    this.terrain = this.scope.track(new TerrainRenderer(scene, quality, this.world.root))
    this.water = this.buildWater()
    report(0.45, 'Painting the runway…')
    this.world.updateAirports(0, 0)
    report(0.6, 'Rolling the Wren out of the hangar…')
    this.visual = await AircraftVisual.load(scene, this.assets, this.spec.model)
    for (const mesh of this.visual.detailMeshes) this.atmosphere.addCaster(mesh)
    this.cockpit = new Cockpit(scene, this.assets, this.visual.root, this.sim.aircraft)
    this.scope.defer(() => {
      this.cockpit.dispose()
      this.visual.dispose()
    })
    this.resolution = attachResolution(this.engine, this.canvas)
    const onResize = () => {
      this.engine.resize()
      this.resolution.refit()
    }
    addEventListener('resize', onResize)
    this.scope.defer(() => removeEventListener('resize', onResize))
    const offAction = this.input.onAction((action) => this.onAction(action))
    this.scope.defer(offAction)
    this.placeAt(HARROW_FIELD, 'stand')
    this.sim.paused = true
    report(0.75, 'Loading the countryside…')
    this.showAround(HARROW_FIELD)
    report(0.85, 'Laying out the towns…')
    allPlaces()
    report(0.9, 'Opening your logbook…')
    await this.career.load()
    report(0.95, 'Ready')
    if (new URLSearchParams(location.search).get('perf') === '1') this.dev.setVisible(true)
    const observer = scene.onBeforeRenderObservable.add(() => this.frame())
    this.scope.defer(() => scene.onBeforeRenderObservable.remove(observer))
    this.engine.runRenderLoop(() => scene.render())
    this.scope.defer(() => this.engine.stopRenderLoop())
    this.menus.showStart()
  }

  private buildWater(): Mesh {
    const water = CreateGround('takeflight-water', { width: 1, height: 1, subdivisions: 1 }, this.scene)
    const material = new PBRMaterial('takeflight-water', this.scene)
    material.albedoColor = new Color3(0.02, 0.06, 0.08)
    material.metallic = 0
    material.roughness = 0.08
    material.environmentIntensity = 0.9
    water.material = material
    water.isPickable = false
    water.receiveShadows = true
    water.position.y = WATER_LEVEL - 0.6
    water.scaling.set(200000, 1, 200000)
    this.scope.track(material)
    this.scope.track(water)
    return water
  }

  private setTier(tier: QualityTier): void {
    if (tier === this.tier) return
    this.tier = tier
    const quality = FLIGHT_QUALITY[tier]
    this.atmosphere.setQuality(tier)
    this.atmosphere.setFogRange(quality.viewDistance * 0.85)
    this.pipeline?.setTier(tier)
    this.terrain.setQuality(quality)
    this.weather.setQuality(tier)
    this.cameras.camera.maxZ = quality.viewDistance * 1.25
    for (const mesh of this.visual.detailMeshes) this.atmosphere.addCaster(mesh)
  }

  /** Rebases the world on the aircraft, loads the airports around it and builds the terrain under the camera at once (loading screens and new flights). */
  private showAround(airport: AirportSpec): void {
    const a = this.sim.aircraft
    this.world.follow(a.px, a.pz, true)
    this.cameras.originX = this.world.originX
    this.cameras.originZ = this.world.originZ
    this.world.updateAirports(a.px, a.pz)
    this.towerAirport = airport
    this.cameras.setTower(...airport.tower)
    this.sim.interpolate(1, this.state)
    this.toScene(this.state)
    const mode = this.cameras.mode
    this.cameras.mode = 'chase'
    this.cameras.update(this.state, a, 0.4, 0.15, 0, 0)
    this.cameras.mode = mode
    const eye = this.cameras.camera.position
    this.terrain.update(eye.x + this.world.originX, eye.y, eye.z + this.world.originZ, Infinity)
  }

  /** World to scene coordinates (minus the floating origin), in place. */
  private toScene(state: InterpolatedState): void {
    state.x -= this.world.originX
    state.z -= this.world.originZ
  }

  private placeAt(airport: AirportSpec, start: StartKind): void {
    const placed = placeStart(this.sim.aircraft, this.sim.pilot, airport, TERRAIN, start)
    this.parkingBrake = placed.parkingBrake
    this.input.setThrottle(placed.throttle)
    this.sim.settle()
  }

  /** Swaps in another aircraft type between flights: model, cockpit and flight model. */
  private async useAircraft(spec: AircraftSpec): Promise<void> {
    if (spec === this.spec) return
    for (const mesh of this.visual.detailMeshes) this.atmosphere.removeCaster(mesh)
    this.cockpit.dispose()
    this.visual.dispose()
    this.spec = spec
    this.sim.setAircraft(spec)
    this.visual = await AircraftVisual.load(this.scene, this.assets, spec.model)
    for (const mesh of this.visual.detailMeshes) this.atmosphere.addCaster(mesh)
    this.cockpit = new Cockpit(this.scene, this.assets, this.visual.root, this.sim.aircraft)
  }

  private startCheckride(id: CheckrideId): void {
    const setup = CHECKRIDE_SPECS[id].setup
    this.careerPanel.hide()
    this.startFlight({ ...this.menus.options, aircraft: setup.aircraft ?? 'halden-wren', airport: setup.airport, start: setup.start, wind: setup.wind, weather: setup.weather, time: setup.time, assists: { autoTrim: false, stallProtection: false, landingGuidance: false }, checkride: id })
  }

  private startFlight(options: FlightOptions): void {
    const spec = fleetSpec(options.aircraft) ?? FLEET[0]
    if (!options.checkride) {
      const entry = hangarEntry(spec.id)
      if (entry && !this.career.profile.licences.includes(entry.requires)) {
        this.menus.notice(`The ${spec.name} needs the ${LICENCE_LABELS[entry.requires]}. Earn it with a checkride first.`)
        this.menus.showStart()
        return
      }
    }
    this.menus.notice('')
    if (spec !== this.spec) {
      void this.useAircraft(spec).then(() => this.startFlight(options), (error) => {
        console.error(error)
        this.menus.notice('That aircraft could not be loaded.')
        this.menus.showStart()
      })
      return
    }
    this.options = { ...options, assists: { ...options.assists } }
    this.careerPanel.hide()
    this.submittedSeconds = 0
    this.failureAnnounced = false
    const ride = options.checkride ? CHECKRIDE_SPECS[options.checkride] : null
    const airport = airportById(options.airport) ?? HARROW_FIELD
    if (ride?.setup.instrumentsOnly) this.minimalHud = true
    this.hud.setMinimal(this.minimalHud)
    this.instrumentsOnly = this.minimalHud && !options.assists.landingGuidance
    this.setTier(options.tier)
    this.replay.stop()
    this.debrief.hide()
    if (this.phase === 'flying' || this.phase === 'paused') this.session.abandon()
    const header: RecordHeader = { version: RECORD_VERSION, aircraft: this.spec.id, airport: airport.id, start: options.start, wind: { ...WINDS[options.wind] }, seed: (Date.now() & 0x7fffffff) | 1, temperatureOffset: 0, seaLevelPressure: SEA_LEVEL_PRESSURE, assists: { ...this.options.assists }, weather: options.weather, failure: ride?.setup.failure ?? null, payload: options.job ? options.job.kg : null, job: options.job ? options.job.id : null }
    this.sim.reset({ wind: header.wind, seed: header.seed, temperatureOffset: header.temperatureOffset, seaLevelPressure: header.seaLevelPressure, assists: this.options.assists, weather: header.weather, failure: header.failure, payload: header.payload })
    this.placeAt(airport, options.start)
    this.showAround(airport)
    this.session.begin(header)
    this.weather.start(HOURS[options.time], airport.elevation)
    this.lightsOn = options.time === 'night' || options.time === 'evening'
    this.sim.paused = false
    this.phase = 'flying'
    this.endTimer = 0
    this.input.enabled = true
    this.menus.hide()
    this.hud.setVisible(true)
    this.setView(options.start === 'stand' ? 'cockpit' : 'chase')
    if (options.job) this.hud.toast(`Cargo: ${options.job.kg.toLocaleString('en-US')} kg of ${options.job.goods} to ${airportById(options.job.to)?.name ?? options.job.to}. Release the parking brake (P) and go.`, 8)
    else if (ride) this.hud.toast(`${ride.title}: ${ride.brief}`, 8)
    else this.hud.toast(options.start === 'stand' ? `Parking brake set: P releases it. Taxi to runway ${airport.runways[0].ends[0]} via A.` : options.start.startsWith('final') ? 'On a 3-mile final: follow the PAPI, two white and two red.' : 'Cleared for take-off: full throttle, rotate at 55 kt.', 5)
    this.canvas.focus()
  }

  private resume(): void {
    if (this.phase !== 'paused') return
    this.phase = 'flying'
    this.sim.paused = false
    this.input.enabled = true
    this.menus.hide()
    this.canvas.focus()
  }

  /** Ends the flight and opens its debrief. */
  private endFlight(reason: EndReason): void {
    if (this.phase !== 'flying' && this.phase !== 'paused') return
    this.phase = 'debrief'
    this.sim.paused = true
    this.input.enabled = false
    this.menus.hide()
    this.hud.setVisible(false)
    const { score, record } = this.session.finish(reason, this.sim.aircraft.crashed, this.spec)
    const options = this.options
    const checkride = options?.checkride ?? null
    this.debrief.show(score, this.session.recorder.telemetryLog(), { canContinue: reason !== 'crash' && !this.sim.aircraft.crashed && checkride === null, aircraft: `${this.spec.maker} ${this.spec.name}`, airport: (airportById(score.landing?.airport ?? options?.airport ?? '') ?? HARROW_FIELD).name, checkride: checkride ? CHECKRIDE_SPECS[checkride].title : null })
    if (options) {
      const summary = summarizeFlight(score, { aircraft: this.spec.id, airport: options.airport, start: options.start, wind: options.wind, weather: options.weather, time: options.time, seconds: Math.max(0, score.seconds - this.submittedSeconds), resumed: this.submittedSeconds > 0, assists: options.assists, instrumentsOnly: this.instrumentsOnly, engineFailure: this.sim.aircraft.failedEngine >= 0, checkride, job: options.job && this.submittedSeconds === 0 ? options.job.id : null })
      this.submittedSeconds = score.seconds
      void this.career.record(summary).then((outcome) => {
        if (this.session.score === score) this.debrief.setCareer(CareerPanel.outcome(outcome, this.career.mode))
      })
    }
    void record.then((result) => {
      if (this.session.score === score) this.debrief.setRecord(result ? result.bytes : null, result ? result.raw : 0)
    })
  }

  private continueFlight(): void {
    if (this.phase !== 'debrief') return
    this.debrief.hide()
    this.session.resume()
    this.phase = 'flying'
    this.sim.paused = false
    this.input.enabled = true
    this.hud.setVisible(true)
    this.canvas.focus()
  }

  private startReplay(): void {
    const score = this.session.score
    const header = this.session.header
    if (this.phase !== 'debrief' || !score?.landing || !header) return
    this.replay.start(header, this.session.recorder.inputLog(), this.session.snapshots, score.landing.tick)
    const touchdown = this.session.recorder.touchdowns.find((t) => t.tick === score.landing?.tick)
    if (touchdown) {
      const airport = nearestAirport(touchdown.x, touchdown.z)
      const end = runwayContact(airport, touchdown.x, touchdown.z, touchdown.track)?.end
      const dx = end ? end.dx : 1
      const dz = end ? end.dz : 0
      const side = 45
      this.cameras.setTower(touchdown.x - dx * 70 - dz * side, airport.elevation + 3, touchdown.z - dz * 70 + dx * side)
    }
    this.phase = 'replay'
    this.cameras.mode = 'tower'
    void this.cockpit.setActive(false)
    this.debrief.showReplay()
  }

  private stopReplay(): void {
    if (this.phase !== 'replay') return
    this.replay.stop()
    this.cameras.setTower(...this.towerAirport.tower)
    this.cameras.mode = 'chase'
    this.phase = 'debrief'
    this.debrief.reveal()
  }

  private touchdownToast(event: TouchdownEvent): void {
    const contact = runwayContact(nearestAirport(event.x, event.z), event.x, event.z, event.track)
    const sink = Math.round(event.sinkRate / FPM)
    let where = ''
    if (contact) {
      const feet = Math.round(Math.abs(contact.cross) / FOOT)
      where = feet < 3 ? ' · on the centreline' : ` · ${feet} ft ${contact.cross > 0 ? 'right' : 'left'} of centreline`
    }
    this.hud.toast(`Touchdown ${sink} fpm · ${event.g.toFixed(2)} G${where}`, 4)
  }

  private toMenu(): void {
    if (this.phase === 'flying' || this.phase === 'paused') this.session.abandon()
    this.replay.stop()
    this.debrief.hide()
    this.phase = 'menu'
    this.sim.paused = true
    this.hud.setVisible(false)
    this.setView('chase')
    const airport = airportById(this.menus.options.airport) ?? HARROW_FIELD
    this.placeAt(airport, 'stand')
    this.showAround(airport)
    this.menus.showStart()
  }

  private setView(mode: 'cockpit' | 'chase' | 'tower'): void {
    this.cameras.mode = mode
    this.input.lookYaw = 0
    this.input.lookPitch = 0
    void this.cockpit.setActive(mode === 'cockpit')
  }

  private onAction(action: PilotAction): void {
    const pilot = this.sim.pilot
    if (action === 'pause') {
      if (this.phase === 'replay') {
        this.stopReplay()
        return
      }
      if (this.phase === 'flying') {
        this.phase = 'paused'
        this.sim.paused = true
        this.input.enabled = false
        this.menus.showPause()
      } else if (this.phase === 'paused') this.resume()
      return
    }
    if (action === 'devOverlay') {
      this.dev.toggle()
      return
    }
    if (this.phase !== 'flying') return
    const detents = this.spec.controls.flapDetents
    if (action === 'flapsDown') pilot.flaps = Math.min(detents.length - 1, pilot.flaps + 1)
    else if (action === 'flapsUp') pilot.flaps = Math.max(0, pilot.flaps - 1)
    else if (action === 'gear') {
      if (this.spec.controls.retractable) pilot.gear = pilot.gear >= 0.5 ? 0 : 1
      else this.hud.toast('The Wren has fixed gear')
    } else if (action === 'parkingBrake') {
      this.parkingBrake = !this.parkingBrake
      pilot.parkingBrake = this.parkingBrake ? 1 : 0
      this.hud.toast(this.parkingBrake ? 'Parking brake set' : 'Parking brake released')
    } else if (action === 'view') {
      const next = VIEW_ORDER[(VIEW_ORDER.indexOf(this.cameras.mode) + 1) % VIEW_ORDER.length]
      this.setView(next)
    } else if (action === 'lights') this.lightsOn = !this.lightsOn
    else if (action === 'hud') {
      if (this.options?.checkride && CHECKRIDE_SPECS[this.options.checkride].setup.instrumentsOnly) {
        this.hud.toast('Instrument checkride: the HUD stays on the essentials')
        return
      }
      this.minimalHud = !this.minimalHud
      this.hud.setMinimal(this.minimalHud)
      if (!this.minimalHud) this.instrumentsOnly = false
    }
  }

  private approach(): ApproachState | null {
    const a = this.sim.aircraft
    return approachFor(a.px, a.py, a.pz, a.heading)
  }

  /** The HUD's approach aids: ILS needles on ILS runways (an instrument, always shown), the glidepath bar with landing guidance. */
  private guidance(): { glidepath: number | null; ils: { name: string; localizer: number; glideslope: number } | null } {
    const approach = this.approach()
    if (!approach) return { glidepath: null, ils: null }
    const ils = approach.ils ? { name: approach.end.name, localizer: approach.localizer, glideslope: approach.glideslope } : null
    return { glidepath: this.options?.assists.landingGuidance && approach.distance < 12000 ? approach.glideslope : null, ils }
  }

  private frame(): void {
    const dt = Math.min(0.1, this.engine.getDeltaTime() / 1000)
    const frameMs = this.engine.getDeltaTime()
    const sim = this.sim
    this.input.update(dt, sim.pilot, this.spec.controls.flapDetents.length)
    sim.pilot.parkingBrake = this.parkingBrake ? 1 : 0
    const t0 = performance.now()
    let share = sim.advance(dt)
    this.simMs = performance.now() - t0
    let shown = sim
    const replaySim = this.phase === 'replay' ? this.replay.sim : null
    if (replaySim) {
      share = this.replay.update(dt)
      shown = replaySim
      this.debrief.updateReplay(this.replay.progress, this.replay.clock, this.replay.speed)
    }
    shown.interpolate(share, this.state)
    const aircraft = shown.aircraft
    if (this.world.follow(this.state.x, this.state.z)) {
      this.cameras.originX = this.world.originX
      this.cameras.originZ = this.world.originZ
    }
    if (this.phase !== 'replay') {
      const near = nearestAirport(this.state.x, this.state.z)
      if (near !== this.towerAirport) {
        this.towerAirport = near
        this.cameras.setTower(...near.tower)
      }
    }
    this.toScene(this.state)
    const camera = this.cameras.camera
    let lookYaw = this.input.lookYaw
    let lookPitch = this.input.lookPitch
    if (this.phase === 'menu') {
      this.menuOrbit += dt * 0.08
      lookYaw = this.menuOrbit
      lookPitch = 0.12
    }
    const zoom = this.input.wheel
    this.input.wheel = 0
    this.cameras.update(this.state, aircraft, lookYaw, lookPitch, zoom, dt)
    const pixels = this.cameras.pixelsFor(this.state, this.spec.wing.span, this.engine.getRenderHeight())
    this.visual.update(this.state, aircraft, pixels, this.lightsOn, dt)
    const eyeX = camera.position.x + this.world.originX
    const eyeZ = camera.position.z + this.world.originZ
    this.world.updateAirports(eyeX, eyeZ)
    this.world.updateTowns(eyeX, eyeZ, this.atmosphere.night)
    this.terrain.update(eyeX, camera.position.y, eyeZ)
    this.atmosphere.update(camera.position)
    this.weather.update(dt, shown, camera.position, this.world.originX, this.world.originZ, this.phase === 'flying')
    const shadows = this.atmosphere.shadows
    if (shadows instanceof CascadedShadowGenerator) shadows.shadowMaxZ = Math.min(FLIGHT_QUALITY[this.tier].viewDistance, 260 + Math.max(0, aircraft.agl) * 2.5)
    sim.env.wind.sample(10, this.wind)
    this.eyeWorld.set(eyeX, camera.position.y, eyeZ)
    for (const airport of this.world.loadedAirports) airport.update(this.eyeWorld, this.wind.x, this.wind.z, this.atmosphere.night)
    this.water.position.x = Math.round(camera.position.x / 1000) * 1000
    this.water.position.z = Math.round(camera.position.z / 1000) * 1000
    this.cockpit.update(sim.applied, FLIGHT_QUALITY[this.tier].gaugeHz, dt)
    if (this.phase === 'flying' || this.phase === 'paused') this.hud.update(aircraft, sim.applied, { view: VIEW_NAMES[this.cameras.mode], lights: this.lightsOn, parkingBrake: this.parkingBrake, ...this.guidance() }, dt)
    this.dev.update(frameMs, dt)
    this.resolution.update(performance.now(), this.engine.getFps())
    if (this.phase === 'flying') {
      if (aircraft.failedEngine >= 0 && !this.failureAnnounced) {
        this.failureAnnounced = true
        this.hud.toast(`Engine ${aircraft.failedEngine + 1} failed: rudder toward the live engine, keep the speed, fly the circuit and land`, 7)
      }
      this.session.pump()
      const touchdown = this.session.takeTouchdown()
      if (touchdown && !aircraft.crashed) this.touchdownToast(touchdown)
      if (aircraft.crashed) {
        this.endTimer += dt
        if (this.endTimer > 2) this.endFlight('crash')
      } else if (this.session.stoppedAfterLanding(aircraft, dt)) this.endFlight('stopped')
    }
  }

  dispose(): void {
    this.scope.dispose()
    this.scene.dispose()
    this.engine.dispose()
  }
}

