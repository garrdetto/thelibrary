import { Constants } from '@babylonjs/core/Engines/constants'
import type { Material } from '@babylonjs/core/Materials/material'
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import '@babylonjs/core/Materials/material.detailMapConfiguration'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'
import type { Scene } from '@babylonjs/core/scene'
import type * as THREE from 'three'

/** Small deterministic generator so the detail textures are the same on every load. */
function noise(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Phase 3 surface detail on top of the materials the bridge mirrors: metallic flake under clear-coated paint
 * (a fine random normal map on the base layer, the coat stays smooth), sheen on tires, and a high-frequency detail
 * map on surfaces that already carry a normal map (asphalt and concrete).
 */
export class SurfaceDetail {
  private readonly flake: RawTexture
  private readonly detail: RawTexture

  constructor(scene: Scene) {
    const N = 256, r = noise(7), flake = new Uint8Array(N * N * 4), detail = new Uint8Array(N * N * 4)
    for (let i = 0; i < N * N; i++) {
      const x = (r() - 0.5) * 0.9, y = (r() - 0.5) * 0.9, z = Math.sqrt(Math.max(0, 1 - x * x - y * y))
      flake.set([Math.round((x * 0.5 + 0.5) * 255), Math.round((y * 0.5 + 0.5) * 255), Math.round((z * 0.5 + 0.5) * 255), 255], i * 4)
      const nx = (r() - 0.5) * 0.35, ny = (r() - 0.5) * 0.35, a = 0.5 + (r() - 0.5) * 0.18, rough = 0.5 + (r() - 0.5) * 0.3
      detail.set([Math.round(a * 255), Math.round((ny + 0.5) * 255), Math.round(rough * 255), Math.round((nx + 0.5) * 255)], i * 4)
    }
    this.flake = new RawTexture(flake, N, N, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE)
    this.flake.wrapU = this.flake.wrapV = Texture.WRAP_ADDRESSMODE
    this.flake.uScale = this.flake.vScale = 24
    this.flake.gammaSpace = false
    this.detail = new RawTexture(detail, N, N, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE)
    this.detail.wrapU = this.detail.wrapV = Texture.WRAP_ADDRESSMODE
    this.detail.uScale = this.detail.vScale = 6
    this.detail.gammaSpace = false
  }

  /** Called when the bridge applies a material's structural settings; `on` follows the quality tier. */
  apply(mat: PBRMaterial, m: THREE.Material, on: boolean): void {
    const p = m as THREE.MeshPhysicalMaterial
    const paint = (p.clearcoat ?? 0) > 0 && !p.normalMap
    if (paint) {
      mat.bumpTexture = on ? this.flake : null
      if (on) mat.bumpTexture!.level = 0.18
    }
    const c = p.color, dark = !!c && c.r + c.g + c.b < 0.06
    const tire = !p.map && !p.transparent && (p.roughness ?? 0) >= 0.85 && dark
    mat.sheen.isEnabled = on && tire
    if (on && tire) {
      mat.sheen.intensity = 0.35
      mat.sheen.color.set(0.6, 0.6, 0.62)
      mat.sheen.roughness = 0.45
    }
    const textured = !!p.normalMap && !paint
    mat.detailMap.isEnabled = on && textured
    if (on && textured) {
      mat.detailMap.texture = this.detail
      mat.detailMap.diffuseBlendLevel = 0.12
      mat.detailMap.roughnessBlendLevel = 0.25
      mat.detailMap.bumpLevel = 0.6
    }
  }
}

/** The classic crowd's cheer (a three `onBeforeCompile` hook), as a Babylon material plugin for both shader languages. */
export class CrowdPlugin extends MaterialPluginBase {
  time = 0
  lift = 0.6
  private enabled = true

  get isEnabled(): boolean {
    return this.enabled
  }

  set isEnabled(on: boolean) {
    if (this.enabled === on) return
    this.enabled = on
    this.markAllDefinesAsDirty()
    this._enable(on)
  }

  constructor(material: Material) {
    super(material, 'Crowd', 200, { CROWD: false })
    this._enable(true)
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines.CROWD = this.enabled
  }

  override getClassName(): string {
    return 'CrowdPlugin'
  }

  override isCompatible(): boolean {
    return true
  }

  override getAttributes(attributes: string[]): void {
    attributes.push('crowdPhase')
  }

  override getUniforms(shaderLanguage?: ShaderLanguage): { ubo: { name: string; size: number; type: string }[]; vertex?: string } {
    const ubo = [{ name: 'crowdTime', size: 1, type: 'float' }, { name: 'crowdLift', size: 1, type: 'float' }]
    return shaderLanguage === ShaderLanguage.WGSL ? { ubo } : { ubo, vertex: '#ifdef CROWD\nuniform float crowdTime;\nuniform float crowdLift;\n#endif' }
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat('crowdTime', this.time)
    uniformBuffer.updateFloat('crowdLift', this.lift)
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== 'vertex') return null
    if (shaderLanguage === ShaderLanguage.WGSL) {
      return {
        CUSTOM_VERTEX_DEFINITIONS: 'attribute crowdPhase: f32;',
        CUSTOM_VERTEX_UPDATE_POSITION: `{
          let ph = vertexInputs.crowdPhase;
          let cheer = step(1.0 - 0.45 * uniforms.crowdLift, ph) * max(0.0, sin(uniforms.crowdTime * (2.2 + ph * 3.0) + ph * 40.0));
          positionUpdated.y += cheer * 0.2;
          positionUpdated.x += sin(uniforms.crowdTime * 1.3 + ph * 20.0) * 0.015;
        }`,
      }
    }
    return {
      CUSTOM_VERTEX_DEFINITIONS: 'attribute float crowdPhase;',
      CUSTOM_VERTEX_UPDATE_POSITION: `{
        float ph = crowdPhase;
        float cheer = step(1.0 - 0.45 * crowdLift, ph) * max(0.0, sin(crowdTime * (2.2 + ph * 3.0) + ph * 40.0));
        positionUpdated.y += cheer * 0.2;
        positionUpdated.x += sin(crowdTime * 1.3 + ph * 20.0) * 0.015;
      }`,
    }
  }
}

/** The per-fan phase the classic shader derived from gl_InstanceID: fract(sin(id * 12.9898) * 43758.5453). */
export function crowdPhases(count: number): Float32Array {
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const v = Math.sin(i * 12.9898) * 43758.5453
    out[i] = v - Math.floor(v)
  }
  return out
}
