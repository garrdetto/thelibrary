/**
 * Tyre wear on the lake country's ground: one byte per third of a metre (about a tyre's width) over the whole square
 * (3072 x 3072, 9 MB), kept on the CPU and in an R8 texture the terrain and the grass both read. Each wheel on the
 * ground presses the one cell under it as it rolls, so only the wheel tracks are touched: one pass leaves two darker,
 * pressed-down tracks, and only a line driven again and again, tens of times, wears through to bare dirt with the two
 * ruts showing, like a real two-track.
 * Only the changed rectangle is uploaded, at most a few times a second, so driving costs a few kilobytes per upload.
 *
 * `WearPlugin` adds the marks to the terrain's standard material; the grass shader (FoliageShader's `wear` look) reads
 * the same texture to flatten and yellow the clumps that stand in the ruts.
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase'
import type { Material } from '@babylonjs/core/Materials/material'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture'
import type { InternalTexture } from '@babylonjs/core/Materials/Textures/internalTexture'
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'
import { Vector4 } from '@babylonjs/core/Maths/math.vector'
import type { EngineContext } from '../core/EngineSetup'
import { HALF, WORLD_SIZE, highwayCoord } from './Terrain'
import type { Terrain } from './Terrain'
import { onHighway } from './Highway'

const TEXELS_PER_M = 3
const SIZE = WORLD_SIZE * TEXELS_PER_M
/** Wear one wheel adds per metre rolled (0..255 scale): one pass leaves a pressed track, dirt starts after about 17 passes and the ruts are bare after about 40. */
const PRESS_PER_M = 20
const STEP_M = 0.25
const UPLOAD_EVERY_S = 0.2

/** A vehicle's wheels in its own frame (x across, z forward), metres. */
export type WheelSet = readonly (readonly [number, number])[]

export const UTV_WHEELS: WheelSet = [[-0.62, 0.95], [0.62, 0.95], [-0.62, -0.9], [0.62, -0.9]]
export const QUAD_WHEELS: WheelSet = [[-0.5, 0.62], [0.5, 0.62], [-0.5, -0.58], [0.5, -0.58]]
export const CAR_WHEELS: WheelSet = [[-0.8, 1.45], [0.8, 1.45], [-0.8, -1.35], [0.8, -1.35]]

interface Track { x: Float32Array; z: Float32Array }

/** Both the WebGPU and WebGL2 engines upload a sub-rectangle of a texture with this. */
interface PartialUpload {
  updateTextureData(texture: InternalTexture, data: ArrayBufferView, x: number, y: number, width: number, height: number): void
}

export class GroundWear {
  readonly texture: RawTexture
  /** Square origin x, z, 1 / size (u = (x - origin x) * area.z), and 1 while marks show. */
  readonly area = new Vector4(-HALF, -HALF, 1 / WORLD_SIZE, 1)
  private readonly data = new Uint8Array(SIZE * SIZE)
  private readonly scratch = new Uint8Array(256 * 256)
  private readonly tracks = new WeakMap<object, Track>()
  private dirty = { x0: SIZE, y0: SIZE, x1: -1, y1: -1 }
  private sinceUpload = 0

  constructor(private readonly ctx: EngineContext, private readonly terrain: Terrain) {
    this.texture = new RawTexture(this.data, SIZE, SIZE, Constants.TEXTUREFORMAT_R, ctx.scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE)
    this.texture.wrapU = Texture.CLAMP_ADDRESSMODE
    this.texture.wrapV = Texture.CLAMP_ADDRESSMODE
    this.texture.name = 'ground-wear'
  }

  /**
   * Rolls one vehicle's wheels to where it is now: each wheel that moved presses wear along the line it travelled.
   * `vehicle` is any stable key (the vehicle object); `airborne` skips pressing but still moves the wheels.
   */
  roll(vehicle: object, x: number, z: number, heading: number, wheels: WheelSet, airborne = false): void {
    let t = this.tracks.get(vehicle)
    const c = Math.cos(heading)
    const s = Math.sin(heading)
    if (!t) {
      t = { x: new Float32Array(wheels.length), z: new Float32Array(wheels.length) }
      for (let i = 0; i < wheels.length; i++) {
        t.x[i] = x + wheels[i][0] * c + wheels[i][1] * s
        t.z[i] = z - wheels[i][0] * s + wheels[i][1] * c
      }
      this.tracks.set(vehicle, t)
      return
    }
    for (let i = 0; i < wheels.length; i++) {
      const wx = x + wheels[i][0] * c + wheels[i][1] * s
      const wz = z - wheels[i][0] * s + wheels[i][1] * c
      const ax = t.x[i]
      const az = t.z[i]
      const d = Math.hypot(wx - ax, wz - az)
      if (d < STEP_M) continue
      t.x[i] = wx
      t.z[i] = wz
      if (airborne || d > 6) continue
      const steps = Math.ceil(d / STEP_M)
      const amount = (PRESS_PER_M * d) / steps
      for (let k = 1; k <= steps; k++) {
        const f = k / steps
        this.press(ax + (wx - ax) * f, az + (wz - az) * f, amount)
      }
    }
  }

  /** Wear 0..1 at (x, z) (tests and debugging). */
  at(x: number, z: number): number {
    const i = Math.floor((x + HALF) * TEXELS_PER_M)
    const j = Math.floor((z + HALF) * TEXELS_PER_M)
    if (i < 0 || j < 0 || i >= SIZE || j >= SIZE) return 0
    return this.data[j * SIZE + i] / 255
  }

  private wearable(x: number, z: number): boolean {
    if (!this.terrain.inSquare(x, z)) return false
    const g = this.terrain.groundAt(x, z)
    if (g === 'water' || g === 'rock') return false
    const { t, across } = highwayCoord(x, z)
    return !onHighway(across, t)
  }

  /** Presses `amount` into the cell under (x, z): one tyre's width. */
  private press(x: number, z: number, amount: number): void {
    if (!this.wearable(x, z)) return
    const i = Math.floor((x + HALF) * TEXELS_PER_M)
    const j = Math.floor((z + HALF) * TEXELS_PER_M)
    if (i < 0 || j < 0 || i >= SIZE || j >= SIZE) return
    this.add(i, j, amount)
    const d = this.dirty
    if (i < d.x0) d.x0 = i
    if (j < d.y0) d.y0 = j
    if (i > d.x1) d.x1 = i
    if (j > d.y1) d.y1 = j
  }

  private add(i: number, j: number, amount: number): void {
    const k = j * SIZE + i
    const v = this.data[k] + amount
    const whole = Math.floor(v)
    this.data[k] = Math.min(255, whole + (Math.random() < v - whole ? 1 : 0))
  }

  /** Uploads what changed (call once a frame). */
  update(dt: number): void {
    this.sinceUpload += dt
    const d = this.dirty
    if (d.x1 < 0 || this.sinceUpload < UPLOAD_EVERY_S) return
    this.sinceUpload = 0
    const internal = this.texture.getInternalTexture()
    if (!internal) return
    const x0 = d.x0 & ~3
    const x1 = Math.min(SIZE, (d.x1 + 4) & ~3)
    const engine = this.ctx.engine as unknown as PartialUpload
    for (let y = d.y0; y <= d.y1; y += 256) {
      const rows = Math.min(256, d.y1 + 1 - y)
      for (let x = x0; x < x1; x += 256) {
        const w = Math.min(256, x1 - x)
        const out = this.scratch.subarray(0, w * rows)
        for (let r = 0; r < rows; r++) out.set(this.data.subarray((y + r) * SIZE + x, (y + r) * SIZE + x + w), r * w)
        engine.updateTextureData(internal, out, x, y, w, rows)
      }
    }
    this.dirty = { x0: SIZE, y0: SIZE, x1: -1, y1: -1 }
  }

  dispose(): void {
    this.texture.dispose()
  }
}

const GLSL_DEFS = `
#ifdef GROUNDWEAR
uniform sampler2D wearSampler;
#endif
`

const GLSL_MAIN = `
#ifdef GROUNDWEAR
{
  float worn = texture2D(wearSampler, (vPositionW.xz - wearArea.xy) * wearArea.z).r * wearArea.w;
  float pressK = smoothstep(0.004, 0.05, worn);
  float dirtK = smoothstep(0.42, 0.98, worn);
  float grit = 1.0;
#ifdef DIFFUSE
  grit = 0.55 + 0.9 * dot(texture2D(diffuseSampler, vPositionW.xz * 0.53).rgb, vec3(0.333));
#endif
  vec3 pressed = baseColor.rgb * vec3(0.72, 0.74, 0.58);
  vec3 soil = vec3(0.31, 0.24, 0.16) * grit;
  baseColor.rgb = mix(mix(baseColor.rgb, pressed, pressK), soil, dirtK);
}
#endif
`

const WGSL_DEFS = `
#ifdef GROUNDWEAR
var wearSamplerSampler: sampler;
var wearSampler: texture_2d<f32>;
#endif
`

const WGSL_MAIN = `
#ifdef GROUNDWEAR
{
  let worn = textureSample(wearSampler, wearSamplerSampler, (fragmentInputs.vPositionW.xz - uniforms.wearArea.xy) * uniforms.wearArea.z).r * uniforms.wearArea.w;
  let pressK = smoothstep(0.004, 0.05, worn);
  let dirtK = smoothstep(0.42, 0.98, worn);
  var grit = 1.0;
#ifdef DIFFUSE
  grit = 0.55 + 0.9 * dot(textureSample(diffuseSampler, diffuseSamplerSampler, fragmentInputs.vPositionW.xz * 0.53).rgb, vec3f(0.333));
#endif
  let pressed = baseColor.rgb * vec3f(0.72, 0.74, 0.58);
  let soil = vec3f(0.31, 0.24, 0.16) * grit;
  baseColor = vec4f(mix(mix(baseColor.rgb, pressed, pressK), soil, dirtK), baseColor.a);
}
#endif
`

/** Tyre marks and worn dirt on a standard material (the lake country's terrain), from a `GroundWear`. */
export class WearPlugin extends MaterialPluginBase {
  constructor(material: Material, private readonly wear: GroundWear) {
    super(material, 'GroundWear', 220, { GROUNDWEAR: false })
    this._enable(true)
  }

  override getClassName() { return 'WearPlugin' }
  override isCompatible() { return true }
  override prepareDefines(defines: Record<string, unknown>) { defines.GROUNDWEAR = true }
  override isReadyForSubMesh() { return this.wear.texture.isReady() }
  override getSamplers(samplers: string[]) { samplers.push('wearSampler') }

  override getUniforms(shaderLanguage?: ShaderLanguage) {
    const ubo = [{ name: 'wearArea', size: 4, type: 'vec4' }]
    return shaderLanguage === ShaderLanguage.WGSL ? { ubo } : { ubo, fragment: '#ifdef GROUNDWEAR\nuniform vec4 wearArea;\n#endif' }
  }

  override bindForSubMesh(ubo: UniformBuffer) {
    const a = this.wear.area
    ubo.updateFloat4('wearArea', a.x, a.y, a.z, a.w)
    ubo.setTexture('wearSampler', this.wear.texture)
  }

  override getActiveTextures(list: BaseTexture[]) { list.push(this.wear.texture) }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== 'fragment') return null
    return shaderLanguage === ShaderLanguage.WGSL
      ? { CUSTOM_FRAGMENT_DEFINITIONS: WGSL_DEFS, CUSTOM_FRAGMENT_UPDATE_DIFFUSE: WGSL_MAIN }
      : { CUSTOM_FRAGMENT_DEFINITIONS: GLSL_DEFS, CUSTOM_FRAGMENT_UPDATE_DIFFUSE: GLSL_MAIN }
  }
}
