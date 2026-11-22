/**
 * The environment cube PBR materials reflect, baked on the CPU from the same sky function the dome is coloured with: no files,
 * no probe render. Each face is filled from `skyRadiance` (the lit ground below the horizon), uploaded as 8-bit sRGB with
 * mipmaps (rougher paint reads blurrier mips), and its diffuse light is integrated into the spherical polynomial Babylon uses for
 * image-based ambient light. Faces follow the GL cube convention; in a right-handed scene Babylon looks cubes up with z flipped,
 * so the bake flips z the same way. On an engine that can't create raw cube textures (the NullEngine in tests) there is simply
 * no environment.
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import '@babylonjs/core/Engines/Extensions/engine.rawTexture'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.rawTexture'
import type { InternalTexture } from '@babylonjs/core/Materials/Textures/internalTexture'
import { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture'
import '@babylonjs/core/Materials/Textures/baseTexture.polynomial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { SphericalHarmonics, SphericalPolynomial } from '@babylonjs/core/Maths/sphericalPolynomial'
import type { Scene } from '@babylonjs/core/scene'
import { skyRadiance } from './AtmosphereSky'
import type { Rgb, SkyState } from './AtmosphereSky'

interface RawCubeEngine {
  createRawCubeTexture(data: ArrayBufferView[] | null, size: number, format: number, type: number, generateMipMaps: boolean, invertY: boolean, samplingMode: number): InternalTexture
  updateRawCubeTexture(texture: InternalTexture, data: ArrayBufferView[], format: number, type: number, invertY: boolean): void
}

function linearToSrgbByte(value: number): number {
  const clamped = value <= 0 ? 0 : value >= 1 ? 1 : value
  const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
  return Math.round(encoded * 255)
}

function faceDirection(face: number, s: number, t: number, out: Rgb): Rgb {
  switch (face) {
    case 0: out[0] = 1; out[1] = -t; out[2] = -s; break
    case 1: out[0] = -1; out[1] = -t; out[2] = s; break
    case 2: out[0] = s; out[1] = 1; out[2] = t; break
    case 3: out[0] = s; out[1] = -1; out[2] = -t; break
    case 4: out[0] = s; out[1] = -t; out[2] = 1; break
    default: out[0] = -s; out[1] = -t; out[2] = -1; break
  }
  const length = Math.hypot(out[0], out[1], out[2])
  out[0] /= length
  out[1] /= length
  out[2] /= length
  return out
}

/** A cube texture wrapping a raw internal cube created elsewhere. */
class SkyCubeTexture extends BaseTexture {
  constructor(scene: Scene, internal: InternalTexture) {
    super(scene, internal)
    this.isCube = true
  }
}

function areaElement(x: number, y: number): number {
  return Math.atan2(x * y, Math.sqrt(x * x + y * y + 1))
}

/** A CPU-baked sky cube for `scene.environmentTexture`. */
export class SkyEnvironment {
  readonly size: number
  readonly texture: BaseTexture | null
  private readonly scene: Scene
  private readonly internal: InternalTexture | null
  private readonly faces: Uint8Array[]
  private readonly direction: Rgb = [0, 0, 0]
  private readonly radiance: Rgb = [0, 0, 0]
  private readonly lightDirection = new Vector3()
  private readonly lightColor = new Color3()

  constructor(scene: Scene, size: number) {
    this.scene = scene
    this.size = size
    this.faces = Array.from({ length: 6 }, () => new Uint8Array(size * size * 4))
    let internal: InternalTexture | null = null
    try {
      internal = (scene.getEngine() as unknown as RawCubeEngine).createRawCubeTexture(this.faces, size, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE, true, false, Constants.TEXTURE_TRILINEAR_SAMPLINGMODE)
    } catch {
      internal = null
    }
    this.internal = internal
    if (!internal) {
      this.texture = null
      return
    }
    const texture = new SkyCubeTexture(scene, internal)
    texture.name = 'trucksim-sky-environment'
    texture.gammaSpace = true
    texture.coordinatesMode = Constants.TEXTURE_CUBIC_MODE
    texture.lodGenerationScale = 0.8
    this.texture = texture
  }

  /** Re-fills and uploads the cube for `state`, and refreshes its diffuse polynomial. */
  bake(state: SkyState): void {
    if (!this.texture || !this.internal) return
    const size = this.size
    const flipZ = this.scene.useRightHandedSystem ? -1 : 1
    const harmonics = new SphericalHarmonics()
    const texel = 2 / size
    const half = texel / 2
    let totalSolidAngle = 0
    for (let face = 0; face < 6; face++) {
      const data = this.faces[face]
      for (let y = 0; y < size; y++) {
        const t = (y + 0.5) * texel - 1
        for (let x = 0; x < size; x++) {
          const s = (x + 0.5) * texel - 1
          const dir = faceDirection(face, s, t, this.direction)
          const color = skyRadiance(state, dir[0], dir[1], dir[2] * flipZ, this.radiance)
          if (dir[1] < -0.06) {
            const below = Math.min(1, (-dir[1] - 0.06) / 0.25)
            color[0] += (state.ground[0] - color[0]) * below
            color[1] += (state.ground[1] - color[1]) * below
            color[2] += (state.ground[2] - color[2]) * below
          }
          const at = (y * size + x) * 4
          data[at] = linearToSrgbByte(color[0])
          data[at + 1] = linearToSrgbByte(color[1])
          data[at + 2] = linearToSrgbByte(color[2])
          data[at + 3] = 255
          const solidAngle = areaElement(s - half, t - half) - areaElement(s - half, t + half) - areaElement(s + half, t - half) + areaElement(s + half, t + half)
          this.lightDirection.set(dir[0], dir[1], dir[2])
          this.lightColor.set(Math.min(color[0], 64), Math.min(color[1], 64), Math.min(color[2], 64))
          harmonics.addLight(this.lightDirection, this.lightColor, solidAngle)
          totalSolidAngle += solidAngle
        }
      }
    }
    harmonics.scaleInPlace((4 * Math.PI) / totalSolidAngle)
    harmonics.convertIncidentRadianceToIrradiance()
    harmonics.convertIrradianceToLambertianRadiance()
    ;(this.scene.getEngine() as unknown as RawCubeEngine).updateRawCubeTexture(this.internal, this.faces, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE, false)
    this.texture.sphericalPolynomial = SphericalPolynomial.FromHarmonics(harmonics)
  }

  dispose(): void {
    if (this.scene.environmentTexture === this.texture) this.scene.environmentTexture = null
    this.texture?.dispose()
  }
}
