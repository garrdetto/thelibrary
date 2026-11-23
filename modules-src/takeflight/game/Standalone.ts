/**
 * The Take Flight page: boots Babylon on WebGPU (WebGL2 fallback) with a reverse depth buffer, builds the sky, terrain, water,
 * Harrow Field and the Wren, and runs the flight. The flight model ticks at a fixed 120 Hz inside `Simulation`; each frame reads
 * the pilot's devices, advances the sim, interpolates the aircraft between ticks, and moves the camera, terrain, lights, cockpit
 * gauges, HUD and overlay. The start screen picks where and how to fly; Escape pauses; a crash ends the flight. Every Babylon
 * resource, observer and DOM listener belongs to one `Scope` torn down on `pagehide`.
 */
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
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
import wren from '../shared/aircraft/wren.json'
import { parseAircraft } from '../shared/AircraftSpec'
import type { AircraftSpec } from '../shared/AircraftSpec'
import { HARROW_FIELD, runwayFrame } from '../shared/Airports'
import { TERRAIN, WATER_LEVEL } from '../shared/Terrain'
import { NO_ASSISTS } from '../sim/Assists'
import { FOOT, KNOT, SEA_LEVEL_PRESSURE, createAirSample, sampleAir } from '../sim/Atmosphere'
import { Simulation } from '../sim/Simulation'
import type { InterpolatedState } from '../sim/Simulation'
import { DEG } from '../sim/SimMath'
import { levelTrim } from '../sim/Trim'
import type { WindSpec } from '../sim/Wind'
import { CALM } from '../sim/Wind'
import { InputManager } from '../input/InputManager'
import type { PilotAction } from '../input/InputManager'
import { AircraftVisual } from '../render/AircraftVisual'
import { AirportRenderer } from '../render/AirportRenderer'
import { Cockpit } from '../render/Cockpit'
import { FLIGHT_QUALITY } from '../render/Quality'
import type { QualityTier } from '../render/Quality'
import { TerrainRenderer } from '../render/TerrainRenderer'
import { AssetManager } from '../world/AssetManager'
import { DevOverlay } from '../ui/DevOverlay'
import { Hud } from '../ui/Hud'
import { Menus } from '../ui/Menus'
import type { FlightOptions, StartKind, TimeKind, WindKind } from '../ui/Menus'
import { CameraRig, VIEW_ORDER } from './Cameras'

export interface BootProgress {
  (share: number, text: string): void
}

type Phase = 'menu' | 'flying' | 'paused' | 'ended'

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
  readonly spec: AircraftSpec
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
  private atmosphere!: Atmosphere
  private pipeline: WorldPipeline | null = null
  private terrain!: TerrainRenderer
  private airport!: AirportRenderer
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
  private readonly air = createAirSample()

  private constructor(engine: AbstractEngine, backend: 'webgpu' | 'webgl2', private readonly canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.engine = engine
    engine.useReverseDepthBuffer = true
    this.scene = new Scene(engine)
    this.scene.useRightHandedSystem = true
    this.scene.clearColor = new Color4(0.6, 0.72, 0.86, 1)
    this.scene.skipPointerMovePicking = true
    this.scene.autoClear = true
    this.spec = parseAircraft(wren)
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
    this.menus = this.scope.track(new Menus(ui, this.input, {
      fly: (options) => this.startFlight(options),
      resume: () => this.resume(),
      restart: () => this.options && this.startFlight(this.options),
      quit: () => this.toMenu(),
      quality: (tier) => this.setTier(tier),
    }, this.tier, `${this.spec.maker} ${this.spec.name}`))
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
  get debug(): { sim: Simulation; fly(options?: Partial<FlightOptions>): void; view(mode: 'cockpit' | 'chase' | 'tower'): void; phase: Phase } {
    return {
      sim: this.sim,
      fly: (options) => this.startFlight({ ...this.menus.options, ...options }),
      view: (mode) => this.setView(mode),
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
    this.terrain = this.scope.track(new TerrainRenderer(scene, quality))
    this.water = this.buildWater()
    report(0.45, 'Painting the runway…')
    this.airport = this.scope.track(new AirportRenderer(scene, HARROW_FIELD))
    this.cameras.setTower(...HARROW_FIELD.tower)
    report(0.6, 'Rolling the Wren out of the hangar…')
    this.visual = await AircraftVisual.load(scene, this.assets, this.spec.model)
    this.scope.track(this.visual)
    for (const mesh of this.visual.detailMeshes) this.atmosphere.addCaster(mesh)
    this.cockpit = this.scope.track(new Cockpit(scene, this.assets, this.visual.root, this.sim.aircraft))
    this.resolution = attachResolution(this.engine, this.canvas)
    const onResize = () => {
      this.engine.resize()
      this.resolution.refit()
    }
    addEventListener('resize', onResize)
    this.scope.defer(() => removeEventListener('resize', onResize))
    const offAction = this.input.onAction((action) => this.onAction(action))
    this.scope.defer(offAction)
    this.placeAt('stand')
    this.sim.paused = true
    report(0.75, 'Loading the countryside…')
    this.sim.interpolate(1, this.state)
    this.cameras.mode = 'chase'
    this.cameras.update(this.state, this.sim.aircraft, 0.4, 0.15, 0, 0)
    this.terrain.update(this.cameras.camera.position.x, this.cameras.camera.position.y, this.cameras.camera.position.z, Infinity)
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
    this.cameras.camera.maxZ = quality.viewDistance * 1.25
    for (const mesh of this.visual.detailMeshes) this.atmosphere.addCaster(mesh)
  }

  private placeAt(start: StartKind): void {
    const sim = this.sim
    const aircraft = sim.aircraft
    const runway = HARROW_FIELD.runways[0]
    const frame = runwayFrame(runway)
    const pilot = sim.pilot
    pilot.flaps = 0
    pilot.gear = 1
    this.parkingBrake = false
    let throttle = 0
    if (start === 'stand') {
      const stand = HARROW_FIELD.stands[0]
      aircraft.placeOnGround(TERRAIN, stand.x, stand.z, stand.heading)
      this.parkingBrake = true
    } else if (start === 'runway09' || start === 'runway27') {
      const along = start === 'runway09' ? 25 : runway.length - 25
      const heading = start === 'runway09' ? runway.heading : (runway.heading + 180) % 360
      aircraft.placeOnGround(TERRAIN, frame.x0 + frame.dx * along, frame.z0 + frame.dz * along, heading)
    } else if (start === 'final09' || start === 'final27') {
      const fromLow = start === 'final09'
      const distance = 3 * 1609
      const aim = 250
      const along = fromLow ? aim - distance : runway.length - aim + distance
      const heading = fromLow ? runway.heading : (runway.heading + 180) % 360
      const x = frame.x0 + frame.dx * along
      const z = frame.z0 + frame.dz * along
      const height = Math.tan(runway.glidepath * DEG) * distance
      const speed = this.spec.vSpeeds.vapp * KNOT
      const flapIndex = Math.min(1, this.spec.controls.flapDetents.length - 1)
      const detents = this.spec.controls.flapDetents
      const flapShare = detents[flapIndex] / detents[detents.length - 1]
      sampleAir(HARROW_FIELD.elevation + height, 0, SEA_LEVEL_PRESSURE, this.air)
      const trim = levelTrim(this.spec, aircraft.mass, speed, this.air.density, flapShare)
      aircraft.place(x, HARROW_FIELD.elevation + 1.3 + height, z, heading, trim.alpha - runway.glidepath, 0, speed)
      aircraft.vy = -Math.sin(runway.glidepath * DEG) * speed
      aircraft.trim = trim.trim
      aircraft.flap = flapShare
      aircraft.power = 0.3
      pilot.flaps = flapIndex
      throttle = 0.3
    } else {
      const altitude = 3500 * FOOT
      const speed = this.spec.vSpeeds.cruise * KNOT * 0.95
      sampleAir(altitude, 0, SEA_LEVEL_PRESSURE, this.air)
      const trim = levelTrim(this.spec, aircraft.mass, speed, this.air.density, 0)
      aircraft.place(-9000, altitude, 2500, runway.heading, trim.alpha, 0, speed)
      aircraft.trim = trim.trim
      aircraft.power = 0.72
      throttle = 0.72
    }
    pilot.throttle = throttle
    pilot.parkingBrake = this.parkingBrake ? 1 : 0
    this.input.setThrottle(throttle)
    sim.settle()
  }

  private startFlight(options: FlightOptions): void {
    this.options = { ...options, assists: { ...options.assists } }
    this.setTier(options.tier)
    this.sim.reset({ wind: WINDS[options.wind], seed: (Date.now() & 0x7fffffff) | 1, temperatureOffset: 0, seaLevelPressure: SEA_LEVEL_PRESSURE, assists: this.options.assists })
    this.placeAt(options.start)
    this.atmosphere.setTime(HOURS[options.time])
    this.lightsOn = options.time === 'night' || options.time === 'evening'
    this.sim.paused = false
    this.phase = 'flying'
    this.endTimer = 0
    this.input.enabled = true
    this.menus.hide()
    this.hud.setVisible(true)
    this.setView(options.start === 'stand' ? 'cockpit' : 'chase')
    this.hud.toast(options.start === 'stand' ? 'Parking brake set: P releases it. Taxi to runway 09 via A.' : options.start.startsWith('final') ? 'On a 3-mile final: follow the PAPI, two white and two red.' : 'Cleared for take-off: full throttle, rotate at 55 kt.', 5)
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

  private toMenu(): void {
    this.phase = 'menu'
    this.sim.paused = true
    this.hud.setVisible(false)
    this.setView('chase')
    this.placeAt('stand')
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
      this.minimalHud = !this.minimalHud
      this.hud.setMinimal(this.minimalHud)
    }
  }

  private glidepathDots(): number | null {
    if (!this.options?.assists.landingGuidance) return null
    const a = this.sim.aircraft
    const runway = HARROW_FIELD.runways[0]
    const frame = runwayFrame(runway)
    for (let end = 0; end < 2; end++) {
      const heading = end === 0 ? runway.heading : (runway.heading + 180) % 360
      let diff = Math.abs(a.heading - heading) % 360
      if (diff > 180) diff = 360 - diff
      if (diff > 35) continue
      const ux = end === 0 ? frame.dx : -frame.dx
      const uz = end === 0 ? frame.dz : -frame.dz
      const tx = end === 0 ? frame.x0 : frame.x0 + frame.dx * runway.length
      const tz = end === 0 ? frame.z0 : frame.z0 + frame.dz * runway.length
      const aimX = tx + ux * 250
      const aimZ = tz + uz * 250
      const along = (aimX - a.px) * ux + (aimZ - a.pz) * uz
      if (along < 50 || along > 12000) continue
      const height = a.py - 1.3 - HARROW_FIELD.elevation
      const angle = Math.atan2(height, along) / DEG
      return (angle - runway.glidepath) / 0.35
    }
    return null
  }

  private frame(): void {
    const dt = Math.min(0.1, this.engine.getDeltaTime() / 1000)
    const frameMs = this.engine.getDeltaTime()
    const sim = this.sim
    this.input.update(dt, sim.pilot, this.spec.controls.flapDetents.length)
    sim.pilot.parkingBrake = this.parkingBrake ? 1 : 0
    const t0 = performance.now()
    const share = sim.advance(dt)
    this.simMs = performance.now() - t0
    sim.interpolate(share, this.state)
    const aircraft = sim.aircraft
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
    this.terrain.update(camera.position.x, camera.position.y, camera.position.z)
    this.atmosphere.update(camera.position)
    const shadows = this.atmosphere.shadows
    if (shadows instanceof CascadedShadowGenerator) shadows.shadowMaxZ = Math.min(FLIGHT_QUALITY[this.tier].viewDistance, 260 + Math.max(0, aircraft.agl) * 2.5)
    sim.env.wind.sample(10, this.wind)
    this.airport.update(camera.position, this.wind.x, this.wind.z, this.atmosphere.night)
    this.water.position.x = Math.round(camera.position.x / 1000) * 1000
    this.water.position.z = Math.round(camera.position.z / 1000) * 1000
    this.cockpit.update(sim.applied, FLIGHT_QUALITY[this.tier].gaugeHz, dt)
    if (this.phase !== 'menu') this.hud.update(aircraft, sim.applied, { view: VIEW_NAMES[this.cameras.mode], lights: this.lightsOn, parkingBrake: this.parkingBrake, glidepath: this.glidepathDots() }, dt)
    this.dev.update(frameMs, dt)
    this.resolution.update(performance.now(), this.engine.getFps())
    if (this.phase === 'flying' && aircraft.crashed) {
      this.endTimer += dt
      if (this.endTimer > 2) {
        this.phase = 'ended'
        this.sim.paused = true
        this.menus.showCrash(aircraft.crashed)
      }
    }
  }

  dispose(): void {
    this.scope.dispose()
    this.scene.dispose()
    this.engine.dispose()
  }
}

