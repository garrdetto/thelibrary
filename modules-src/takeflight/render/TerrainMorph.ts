/**
 * CDLOD geomorphing for the terrain material. Every tile vertex carries `tfMorph`, its height on the parent tile's coarser grid;
 * the vertex shader blends the height toward it as the vertex nears the distance at which the quadtree hands the area to the
 * parent, so a tile and its parent agree where they swap and nothing pops. The blend range per tile comes from its size and the
 * split factor, and the eye is passed in the tile's own coordinates, so no world matrix is needed in the shader. GLSL and WGSL
 * are kept in step; if the material fails to compile with the plugin, the renderer switches the plugin off.
 */
import type { Engine } from '@babylonjs/core/Engines/engine'
import { Material } from '@babylonjs/core/Materials/material'
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'
import type { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh'
import type { Scene } from '@babylonjs/core/scene'
import { MORPH_ATTRIBUTE } from './TerrainTile'

const GLSL_DEFS = `
#ifdef TFMORPH
attribute float ${MORPH_ATTRIBUTE};
#endif
`
const GLSL_MAIN = `
#ifdef TFMORPH
{
  float tfDistance = distance(tfMorphEye.xyz, positionUpdated);
  float tfK = clamp((tfDistance - tfMorphRange.x) / max(1.0, tfMorphRange.y - tfMorphRange.x), 0.0, 1.0);
  positionUpdated.y = mix(positionUpdated.y, ${MORPH_ATTRIBUTE}, tfK);
}
#endif
`
const WGSL_DEFS = `
#ifdef TFMORPH
attribute ${MORPH_ATTRIBUTE}: f32;
#endif
`
const WGSL_MAIN = `
#ifdef TFMORPH
{
  let tfDistance = distance(uniforms.tfMorphEye.xyz, positionUpdated);
  let tfK = clamp((tfDistance - uniforms.tfMorphRange.x) / max(1.0, uniforms.tfMorphRange.y - uniforms.tfMorphRange.x), 0.0, 1.0);
  positionUpdated.y = mix(positionUpdated.y, vertexInputs.${MORPH_ATTRIBUTE}, tfK);
}
#endif
`

/** Fractions of a tile's hand-over distance (2 × size × split, where its parent stops splitting) where morphing starts and ends. */
const MORPH_START = 0.62
const MORPH_END = 0.94

export class TerrainMorphPlugin extends MaterialPluginBase {
  /** Camera position (scene coordinates) and the quadtree split factor, updated by the renderer each frame. */
  eye: Vector3 | null = null
  split = 2
  private active = true

  constructor(material: Material) {
    super(material, 'TerrainMorph', 210, { TFMORPH: false })
    this._enable(true)
  }

  /** Turns morphing off for good (after a compile error) and rebuilds the material without it. */
  disable(): void {
    if (!this.active) return
    this.active = false
    this._material.markAsDirty(Material.AllDirtyFlag)
  }

  override getClassName(): string {
    return 'TerrainMorphPlugin'
  }

  override isCompatible(): boolean {
    return true
  }

  override prepareDefines(defines: Record<string, unknown>, _scene: Scene, mesh: AbstractMesh): void {
    defines.TFMORPH = this.active && mesh.isVerticesDataPresent(MORPH_ATTRIBUTE)
  }

  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    if (mesh.isVerticesDataPresent(MORPH_ATTRIBUTE)) attributes.push(MORPH_ATTRIBUTE)
  }

  override getUniforms(shaderLanguage?: ShaderLanguage) {
    const ubo = [
      { name: 'tfMorphEye', size: 4, type: 'vec4' },
      { name: 'tfMorphRange', size: 4, type: 'vec4' },
    ]
    return shaderLanguage === ShaderLanguage.WGSL ? { ubo } : { ubo, vertex: '#ifdef TFMORPH\nuniform vec4 tfMorphEye;\nuniform vec4 tfMorphRange;\n#endif' }
  }

  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: Engine, subMesh: SubMesh): void {
    const mesh = subMesh.getMesh()
    const size = (mesh.metadata as { morphSize?: number } | null)?.morphSize ?? 0
    const eye = this.eye
    if (!eye || size <= 0) {
      ubo.updateFloat4('tfMorphEye', 0, 0, 0, 0)
      ubo.updateFloat4('tfMorphRange', 1e9, 2e9, 0, 0)
      return
    }
    const p = mesh.getAbsolutePosition()
    ubo.updateFloat4('tfMorphEye', eye.x - p.x, eye.y, eye.z - p.z, 0)
    const handOver = 2 * size * this.split
    ubo.updateFloat4('tfMorphRange', handOver * MORPH_START, handOver * MORPH_END, 0, 0)
  }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType !== 'vertex') return null
    return shaderLanguage === ShaderLanguage.WGSL
      ? { CUSTOM_VERTEX_DEFINITIONS: WGSL_DEFS, CUSTOM_VERTEX_UPDATE_POSITION: WGSL_MAIN }
      : { CUSTOM_VERTEX_DEFINITIONS: GLSL_DEFS, CUSTOM_VERTEX_UPDATE_POSITION: GLSL_MAIN }
  }
}
