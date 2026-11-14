/**
 * Montello's water: Buffalo Lake, Lake Montello, the Fox and Montello rivers
 * and every pond, each at its own surveyed level, drawn with Rack & Reel's
 * water shader (the same waves, sky reflection, sun glitter and shore foam as
 * Bear Paw Lake). The surface is a mesh over the wet cells that follows the
 * level grid, so the rivers step down at the dams. The shader finds the depth
 * under each pixel in a depth map of the whole town; the map repeats, and
 * Tello's centre is a whole map width from the scene's origin, so the
 * shader's origin-centred lookup lands on the right texel.
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { EngineContext } from '../../rackreel/core/EngineSetup'
import { FOG_COLOR, FOG_DENSITY } from '../../rackreel/core/EngineSetup'
import '../../rackreel/world/Shaders'
import type { Lighting } from '../../rackreel/world/Lighting'
import type { TelloLand } from '../region'

const CHUNK = 64

/** Depth under each cell centre (the mean of its corners), as the shader's depth map: red = depth / 24 m. */
export function depthBytes(land: TelloLand): Uint8Array {
  const n = land.side
  const cells = n - 1
  const { ground, water } = land.grids
  const bytes = new Uint8Array(cells * cells * 4)
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      let depth = 0
      let wet = 0
      for (const k of [j * n + i, j * n + i + 1, (j + 1) * n + i, (j + 1) * n + i + 1]) {
        if (!water[k]) continue
        const d = (water[k] - ground[k]) / 100
        if (d > 0) {
          depth += d
          wet++
        }
      }
      depth = wet ? depth / 4 : 0
      const o = (j * cells + i) * 4
      bytes[o] = depth > 0 ? Math.max(1, Math.min(255, Math.round((depth / 24) * 255))) : 0
      bytes[o + 3] = 255
    }
  }
  return bytes
}

export class Water {
  readonly material: ShaderMaterial
  readonly meshes: Mesh[] = []
  private time = 0

  constructor(private readonly ctx: EngineContext, land: TelloLand) {
    const { scene } = ctx
    if (Math.abs(land.offset.x + land.x0 + land.size / 2) > 1e-6 || Math.abs(((land.offset.z + land.z0 + land.size / 2) / land.size) % 1) > 1e-6) throw new Error('Tello must sit a whole map width from the origin')
    const cells = land.side - 1
    const depthMap = RawTexture.CreateRGBATexture(depthBytes(land), cells, cells, scene, false, false, Texture.BILINEAR_SAMPLINGMODE)
    depthMap.wrapU = Texture.WRAP_ADDRESSMODE
    depthMap.wrapV = Texture.WRAP_ADDRESSMODE
    const material = new ShaderMaterial('tello-water-mat', scene, 'rrWater', {
      attributes: ['position'],
      uniforms: ['world', 'viewProjection', 'cameraPos', 'fogColor', 'fogDensity', 'time', 'worldSize', 'sunDir', 'moonDir', 'night', 'glow', 'lampPos', 'lampDir', 'lampColor'],
      samplers: ['depthMap'],
      needAlphaBlending: true,
      shaderLanguage: ctx.engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
    })
    material.setTexture('depthMap', depthMap)
    material.setVector3('sunDir', ctx.sunDirection.scale(-1))
    material.setVector3('moonDir', ctx.sunDirection.clone())
    material.setFloat('night', 0)
    material.setFloat('glow', 0)
    material.setFloat('time', 0)
    material.setVector3('cameraPos', Vector3.Zero())
    material.setVector3('lampPos', new Vector3(0, -100, 0))
    material.setVector3('lampDir', new Vector3(0, -1, 0))
    material.setVector3('lampColor', Vector3.Zero())
    material.setColor3('fogColor', FOG_COLOR)
    material.setFloat('fogDensity', FOG_DENSITY)
    material.setFloat('worldSize', land.size)
    material.alphaMode = Constants.ALPHA_COMBINE
    material.backFaceCulling = false
    this.material = material
    const n = land.side
    const water = land.grids.water
    for (let cj = 0; cj < cells; cj += CHUNK) {
      for (let ci = 0; ci < cells; ci += CHUNK) {
        const positions: number[] = []
        const indices: number[] = []
        const index = new Map<number, number>()
        const vertex = (i: number, j: number): number => {
          const key = j * n + i
          let v = index.get(key)
          if (v === undefined) {
            v = positions.length / 3
            positions.push(land.toSceneX(land.x0 + i * land.cell), water[key] / 100, land.toSceneZ(land.z0 + j * land.cell))
            index.set(key, v)
          }
          return v
        }
        for (let j = cj; j < Math.min(cells, cj + CHUNK); j++) {
          for (let i = ci; i < Math.min(cells, ci + CHUNK); i++) {
            if (!water[j * n + i] || !water[j * n + i + 1] || !water[(j + 1) * n + i] || !water[(j + 1) * n + i + 1]) continue
            if (!land.seen(land.x0 + i * land.cell, land.z0 + j * land.cell, -20)) continue
            const a = vertex(i, j)
            const b = vertex(i + 1, j)
            const c = vertex(i, j + 1)
            const d = vertex(i + 1, j + 1)
            indices.push(a, b, c, d, c, b)
          }
        }
        if (!indices.length) continue
        const data = new VertexData()
        data.positions = positions
        data.indices = indices
        const mesh = new Mesh(`tello-water:${ci / CHUNK},${cj / CHUNK}`, scene)
        data.applyToMesh(mesh, false)
        mesh.material = material
        mesh.isPickable = false
        mesh.alphaIndex = 0
        mesh.freezeWorldMatrix()
        mesh.doNotSyncBoundingInfo = true
        this.meshes.push(mesh)
      }
    }
  }

  /** Keeps the surface under the same sun, moon, fog and clock as everything else. */
  update(dt: number, lighting: Lighting): void {
    this.time += dt
    const m = this.material
    const s = lighting.state
    m.setVector3('sunDir', new Vector3(s.sun.x, s.sun.y, s.sun.z))
    m.setVector3('moonDir', new Vector3(s.moon.x, s.moon.y, s.moon.z))
    m.setFloat('night', s.night)
    m.setFloat('glow', s.glow)
    m.setColor3('fogColor', lighting.fogColor)
    m.setFloat('fogDensity', this.ctx.scene.fogDensity)
    m.setFloat('time', this.time)
    m.setVector3('cameraPos', this.ctx.camera.globalPosition)
  }
}
