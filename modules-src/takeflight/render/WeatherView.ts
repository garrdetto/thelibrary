/**
 * Draws the simulation's weather: the cloud layer (base and depth above the departure field, drifting with the wind), rain
 * around the camera below the cloud base, visibility through the scene fog (closing right in inside a cloud), sunlight dimmed
 * under cloud, and the clock moving on during the flight so the sun travels. Reads `Simulation.weather`, which the sim keeps
 * current; changes nothing in the simulation.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'
import type { Atmosphere } from '../../trucksim/render/world/Atmosphere'
import type { Simulation } from '../sim/Simulation'
import { DEG } from '../sim/SimMath'
import { Clouds } from './Clouds'
import type { CloudLight } from './Clouds'
import { FLIGHT_QUALITY } from './Quality'
import type { QualityTier } from './Quality'
import { Rain } from './Rain'

const IN_CLOUD_FOG = 70
const FOG_EPSILON = 0.04

export class WeatherView {
  private readonly clouds: Clouds
  private readonly rain: Rain
  private readonly light: CloudLight = { sunDir: new Vector3(0, 1, 0), sunColor: new Color3(), ambient: new Color3() }
  private viewDistance: number
  private startHours = 12
  private elapsed = 0
  private field = 0
  private driftX = 0
  private driftZ = 0
  private fogRange = 0

  constructor(private readonly scene: Scene, private readonly atmosphere: Atmosphere, tier: QualityTier, webgpu: boolean) {
    this.clouds = new Clouds(scene, tier, webgpu)
    this.rain = new Rain(scene, tier)
    this.viewDistance = FLIGHT_QUALITY[tier].viewDistance
  }

  setQuality(tier: QualityTier): void {
    this.clouds.setQuality(tier)
    this.rain.setQuality(tier)
    this.viewDistance = FLIGHT_QUALITY[tier].viewDistance
    this.fogRange = 0
  }

  /** A new flight: the clock starts at `hours`, cloud heights count from `fieldElevation`. */
  start(hours: number, fieldElevation: number): void {
    this.startHours = hours
    this.elapsed = 0
    this.field = fieldElevation
    this.atmosphere.setTime(hours)
  }

  get hours(): number {
    return (this.startHours + this.elapsed / 3600) % 24
  }

  /** Per frame. `eye` is the camera in scene coordinates; `flying` moves the clock on. */
  update(dt: number, sim: Simulation, eye: Vector3, originX: number, originZ: number, flying: boolean): void {
    if (flying) {
      this.elapsed += dt
      this.atmosphere.setTime(this.hours)
    }
    const weather = sim.weather
    const wind = sim.env.wind.spec
    const toward = (wind.direction + 180) * DEG
    const speed = wind.speed * 1.6
    this.driftX += Math.sin(toward) * speed * dt
    this.driftZ -= Math.cos(toward) * speed * dt
    const base = this.field + weather.base
    const top = base + weather.depth
    const state = this.atmosphere.state
    const key = state.keyDirection
    this.light.sunDir.set(key[0], key[1], key[2])
    const sunScale = state.keyIntensity * 0.9
    this.light.sunColor.set(state.keyColor[0] * sunScale, state.keyColor[1] * sunScale, state.keyColor[2] * sunScale)
    const ambientScale = state.hemiIntensity * 0.75
    this.light.ambient.set(state.hemiSky[0] * ambientScale + 0.04, state.hemiSky[1] * ambientScale + 0.04, state.hemiSky[2] * ambientScale + 0.045)
    const scene = this.scene
    this.clouds.update(eye, base, top, weather.cover, originX + this.driftX, originZ + this.driftZ, Math.min(this.viewDistance, 45000), this.light, scene.fogColor, scene.fogDensity, weather.base < 5)
    this.atmosphere.sun.intensity = state.keyIntensity * (1 - 0.62 * weather.cover * weather.cover)
    this.atmosphere.hemi.intensity = state.hemiIntensity * (1 - 0.2 * weather.cover)
    const inside = this.clouds.inside(eye, base, top)
    const range = inside ? IN_CLOUD_FOG : Math.min(this.viewDistance * 0.85, weather.visibility)
    if (this.fogRange === 0 || Math.abs(range - this.fogRange) > this.fogRange * FOG_EPSILON) {
      this.fogRange = range
      this.atmosphere.setFogRange(range)
    }
    const a = sim.aircraft
    const rain = eye.y < base + 60 ? weather.rain : 0
    this.rain.update(rain, eye.x, eye.y, eye.z, Math.sin(toward) * wind.speed - a.vx, -Math.cos(toward) * wind.speed - a.vz, dt)
  }

  dispose(): void {
    this.clouds.dispose()
    this.rain.dispose()
  }
}
