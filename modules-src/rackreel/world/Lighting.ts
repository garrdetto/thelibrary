/** Applies the clock to the scene: the key light follows the sun and then the full moon, and the fill, ambient, fog, exposure, sky and lake blend toward a moonlit blue night. */
import type { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { EngineContext } from '../core/EngineSetup'
import { FOG_COLOR, FOG_DENSITY } from '../core/EngineSetup'
import type { Clock, Direction, SkyState } from '../systems/TimeOfDay'

const REAIM = Math.cos((0.4 * Math.PI) / 180)
const MIN_KEY_ELEVATION = Math.sin((4 * Math.PI) / 180)

const DAY = {
  sun: new Color3(1.0, 0.9, 0.76),
  low: new Color3(1.0, 0.6, 0.36),
  moon: new Color3(0.56, 0.66, 0.95),
  skyDiffuse: new Color3(0.66, 0.75, 0.88),
  skyGround: new Color3(0.4, 0.37, 0.29),
  ambient: new Color3(0.3, 0.32, 0.32),
}
const NIGHT = {
  skyDiffuse: new Color3(0.3, 0.38, 0.62),
  skyGround: new Color3(0.05, 0.05, 0.065),
  ambient: new Color3(0.11, 0.12, 0.16),
  fog: new Color3(0.035, 0.05, 0.085),
}
const DUSK_FOG = new Color3(0.72, 0.56, 0.48)
/** People stay readable at night: their textured materials get a small emissive lift (it is multiplied by the texture, so detail is kept). */
const CHARACTER_MATERIAL = /^rr-(hunter|wildman)/
const CHARACTER_NIGHT_LIFT = 0.12
const MATTE_DIFFUSE = 0.94
const MATTE_AMBIENT = 0.6
const MATTE_LIFT = 0.035

/** A host world's own picture on top of Rack & Reel's lighting (Fox Lake). */
export interface LightingLook {
  /** Shadow darkness from 0 (black) to 1 (no shadow); Rack & Reel's own is 0.62. */
  shadowDarkness?: number
  /** Multiplies the exposure at full night: 1.15 is 15 % brighter. */
  nightBrightness?: number
  /** Characters with no sheen at all and a softer fill, so cloth and skin never read as shiny or metallic. */
  matteCharacters?: boolean
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

function toVector(d: Direction, out: Vector3): Vector3 {
  return out.set(d.x, d.y, d.z)
}

export class Lighting {
  readonly fogColor = FOG_COLOR.clone()
  private readonly keyDir = new Vector3(0, -1, 0)
  private readonly applied = new Vector3(Number.NaN, 0, 0)
  private readonly sunVec = new Vector3()
  private readonly moonVec = new Vector3()
  private readonly tmp = new Color3()
  state!: SkyState

  constructor(private readonly ctx: EngineContext, private readonly skyMat: ShaderMaterial, private readonly waterMat: ShaderMaterial, private readonly clock: Clock, private readonly look: LightingLook = {}) {
    if (look.shadowDarkness !== undefined) ctx.shadows.setDarkness(Math.min(1, Math.max(0, look.shadowDarkness)))
    this.update(true)
  }

  get night(): number {
    return this.state.night
  }

  update(force = false): void {
    const s = this.clock.sky
    this.state = s
    const { ctx } = this
    toVector(s.sun, this.sunVec)
    toVector(s.moon, this.moonVec)
    const sunK = smooth(-4, 6, s.sunElevation)
    const moonK = (1 - sunK) * smooth(-2, 14, s.moonElevation)
    const useSun = sunK > 0.02 || moonK < 0.02
    const key = useSun ? this.sunVec : this.moonVec
    this.keyDir.copyFrom(key)
    if (this.keyDir.y < MIN_KEY_ELEVATION) {
      const flat = Math.hypot(this.keyDir.x, this.keyDir.z) || 1
      const k = Math.sqrt(1 - MIN_KEY_ELEVATION * MIN_KEY_ELEVATION) / flat
      this.keyDir.set(this.keyDir.x * k, MIN_KEY_ELEVATION, this.keyDir.z * k)
    }
    this.keyDir.scaleInPlace(-1)
    if (force || !(Vector3.Dot(this.keyDir, this.applied) > REAIM)) {
      ctx.setSunDirection(this.keyDir)
      this.applied.copyFrom(this.keyDir)
    }
    const sun = ctx.sun
    if (useSun) {
      Color3.LerpToRef(DAY.low, DAY.sun, smooth(2, 20, s.sunElevation), sun.diffuse)
      sun.intensity = 2.35 * sunK
    } else {
      sun.diffuse.copyFrom(DAY.moon)
      sun.intensity = 0.42 * moonK
    }
    sun.specular.copyFrom(sun.diffuse).scaleInPlace(0.3)
    const n = s.night
    const sky = ctx.sky
    sky.intensity = 1.05 + (0.24 - 1.05) * n
    Color3.LerpToRef(DAY.skyDiffuse, NIGHT.skyDiffuse, n, sky.diffuse)
    Color3.LerpToRef(DAY.skyGround, NIGHT.skyGround, n, sky.groundColor)
    Color3.LerpToRef(DAY.ambient, NIGHT.ambient, n, ctx.scene.ambientColor)
    Color3.LerpToRef(FOG_COLOR, DUSK_FOG, s.glow * 0.7, this.tmp)
    Color3.LerpToRef(this.tmp, NIGHT.fog, n, this.fogColor)
    ctx.scene.fogColor.copyFrom(this.fogColor)
    ctx.scene.fogDensity = FOG_DENSITY * (1 + n * 0.35)
    ctx.scene.clearColor = new Color4(this.fogColor.r, this.fogColor.g, this.fogColor.b, 1)
    ctx.pipeline.imageProcessing.exposure = (1.08 + (1.42 * 1.05 - 1.08) * n) * (1 + ((this.look.nightBrightness ?? 1) - 1) * n)
    ctx.pipeline.bloomThreshold = 0.92 - n * 0.22
    for (const mat of [this.skyMat, this.waterMat]) {
      mat.setVector3('sunDir', this.sunVec)
      mat.setVector3('moonDir', this.moonVec)
      mat.setFloat('night', n)
      mat.setFloat('glow', s.glow)
    }
    this.waterMat.setColor3('fogColor', this.fogColor)
    this.waterMat.setFloat('fogDensity', ctx.scene.fogDensity)
    if (force || Math.abs(n - this.liftedFor) > 0.01 || ctx.scene.materials.length !== this.materialCount) {
      this.liftedFor = n
      this.materialCount = ctx.scene.materials.length
      const matte = !!this.look.matteCharacters
      const lift = CHARACTER_NIGHT_LIFT * n + (matte ? MATTE_LIFT * (1 - n) : 0)
      for (const mat of ctx.scene.materials) {
        if (!(mat instanceof StandardMaterial) || !CHARACTER_MATERIAL.test(mat.name)) continue
        mat.emissiveColor.set(lift, lift, lift * 1.08)
        if (!matte) continue
        mat.specularColor.set(0, 0, 0)
        mat.diffuseColor.set(MATTE_DIFFUSE, MATTE_DIFFUSE, MATTE_DIFFUSE)
        mat.ambientColor.set(MATTE_AMBIENT, MATTE_AMBIENT, MATTE_AMBIENT)
      }
    }
  }

  private liftedFor = -1
  private materialCount = 0

  /** The boat's lamp on the lake surface: brightens and clears the water inside its cone. */
  setLamp(position: Vector3, direction: Vector3, color: Color3, on: boolean): void {
    this.waterMat.setVector3('lampPos', position)
    this.waterMat.setVector3('lampDir', direction)
    this.waterMat.setVector3('lampColor', on ? new Vector3(color.r, color.g, color.b) : Vector3.Zero())
  }
}
