/**
 * The built-in prop layer: trees, utility poles with their wires, and site signs. Each tree type and level of detail has one
 * hidden template mesh shared by the whole county; a chunk gets a thin-instance host per type that links to the template's
 * vertex buffers and shared index buffer, so a chunk costs a handful of draw calls (broadleaf, pine, poles, wires, signs) and no
 * materials of its own. The detailed and distant tree hosts share their instance list and swap by the chunk's distance with a
 * little hysteresis; wires show only up close and everything past `treeFar` is hidden. Trees always cast their sun shadow from the
 * distant model (about a fifth of the triangles): while the detailed trees are shown, the distant host stays enabled on a layer
 * no camera sees, which shadow maps ignore because they draw an explicit caster list. Poles and signs cast too. The world
 * renderer decides when a chunk is within shadow range.
 */
import { Geometry } from '@babylonjs/core/Meshes/geometry'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Material } from '@babylonjs/core/Materials/material'
import type { Scene } from '@babylonjs/core/scene'
import type { Terrain } from '../../shared/Terrain'
import { CHUNK_SIZE } from '../../shared/WorldLayout'
import type { QualitySettings } from '../Quality'
import { broadleafModel, pineModel, poleModel, templateMesh } from './PropsModels'
import type { ModelArrays } from './PropsModels'
import { WIRE_SAG, createChunkProps, placeChunkProps } from './PropsPlacement'
import type { ChunkProps, InstanceBatch } from './PropsPlacement'
import { buildSignArrays } from './PropsSigns'
import type { SignAtlas } from './PropsSigns'
import { SharedIndexBuffer, linkVertexBuffers } from './WorldRendererBuffers'
import type { ChunkContext, ChunkLayer, ChunkPart } from './WorldRenderer'

const BAND_SLACK = 24
/** A layer outside every camera's default mask: meshes on it are drawn only into shadow maps (explicit render lists skip the mask test). */
export const SHADOW_ONLY_LAYER = 0x10000000
const DEFAULT_LAYER = 0x0fffffff
const SIGN_RANGE = 520
const POLE_RANGE = 900
const WIRE_SEGMENTS = 8
const WIRE_THICKNESS = 0.032
const WIRE_COLOR = [0.02, 0.02, 0.022]

interface Template {
  mesh: Mesh
  indices: SharedIndexBuffer
  vertices: number
}

export interface PropsMaterials {
  foliage: Material
  sign: Material
}

type TreeBand = 'high' | 'low' | 'hidden'

function wireArrays(wires: readonly number[], originX: number, originZ: number): { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint16Array | Uint32Array } | null {
  const conductors = wires.length / 6
  if (conductors === 0) return null
  const positions: number[] = []
  const indices: number[] = []
  const half = WIRE_THICKNESS / 2
  for (let c = 0; c < conductors; c++) {
    const ax = wires[c * 6] - originX
    const ay = wires[c * 6 + 1]
    const az = wires[c * 6 + 2] - originZ
    const bx = wires[c * 6 + 3] - originX
    const by = wires[c * 6 + 4]
    const bz = wires[c * 6 + 5] - originZ
    const span = Math.hypot(bx - ax, bz - az)
    const sag = span * WIRE_SAG
    const sideX = span > 0 ? -(bz - az) / span : 1
    const sideZ = span > 0 ? (bx - ax) / span : 0
    for (let k = 0; k < WIRE_SEGMENTS; k++) {
      const t0 = k / WIRE_SEGMENTS
      const t1 = (k + 1) / WIRE_SEGMENTS
      const p0x = ax + (bx - ax) * t0
      const p0y = ay + (by - ay) * t0 - 4 * sag * t0 * (1 - t0)
      const p0z = az + (bz - az) * t0
      const p1x = ax + (bx - ax) * t1
      const p1y = ay + (by - ay) * t1 - 4 * sag * t1 * (1 - t1)
      const p1z = az + (bz - az) * t1
      for (const [ox, oy, oz] of [[0, half, 0], [sideX * half, 0, sideZ * half]]) {
        const first = positions.length / 3
        positions.push(p0x - ox, p0y - oy, p0z - oz, p0x + ox, p0y + oy, p0z + oz, p1x + ox, p1y + oy, p1z + oz, p1x - ox, p1y - oy, p1z - oz)
        indices.push(first, first + 1, first + 2, first, first + 2, first + 3, first, first + 2, first + 1, first, first + 3, first + 2)
      }
    }
  }
  const count = positions.length / 3
  const normals = new Float32Array(count * 3)
  const colors = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    normals[i * 3 + 1] = 1
    colors[i * 4] = WIRE_COLOR[0]
    colors[i * 4 + 1] = WIRE_COLOR[1]
    colors[i * 4 + 2] = WIRE_COLOR[2]
    colors[i * 4 + 3] = 1
  }
  return { positions: Float32Array.from(positions), normals, colors, indices: count > 65535 ? Uint32Array.from(indices) : Uint16Array.from(indices) }
}

/** One chunk's props and their distance bands. */
class PropChunk implements ChunkPart {
  readonly instances: number
  private readonly meshes: Mesh[] = []
  private readonly treeHigh: Mesh[] = []
  private readonly treeLow: Mesh[] = []
  private readonly poles: Mesh | null
  private readonly wires: Mesh | null
  private readonly signs: Mesh | null
  private readonly quality: QualitySettings
  private band: TreeBand = 'hidden'
  private polesShown = true
  private wiresShown = true
  private signsShown = true

  constructor(parts: { treeHigh: Mesh[]; treeLow: Mesh[]; poles: Mesh | null; wires: Mesh | null; signs: Mesh | null; instances: number }, quality: QualitySettings, distance: number) {
    this.treeHigh = parts.treeHigh
    this.treeLow = parts.treeLow
    this.poles = parts.poles
    this.wires = parts.wires
    this.signs = parts.signs
    this.instances = parts.instances
    this.quality = quality
    for (const mesh of [...parts.treeHigh, ...parts.treeLow, parts.poles, parts.wires, parts.signs]) if (mesh) this.meshes.push(mesh)
    this.band = distance < quality.treeNear ? 'high' : distance < quality.treeFar ? 'low' : 'hidden'
    this.polesShown = distance < POLE_RANGE
    this.wiresShown = distance < quality.wireRange
    this.signsShown = distance < SIGN_RANGE
    this.show()
  }

  setDistance(distance: number): void {
    const q = this.quality
    let band = this.band
    if (band === 'high' && distance > q.treeNear + BAND_SLACK) band = 'low'
    if (band === 'low' && distance < q.treeNear) band = 'high'
    if (band === 'low' && distance > q.treeFar + BAND_SLACK) band = 'hidden'
    if (band === 'hidden' && distance < q.treeFar) band = distance < q.treeNear ? 'high' : 'low'
    const poles = this.polesShown ? distance < POLE_RANGE + BAND_SLACK : distance < POLE_RANGE
    const wires = this.wiresShown ? distance < q.wireRange + BAND_SLACK : distance < q.wireRange
    const signs = this.signsShown ? distance < SIGN_RANGE + BAND_SLACK : distance < SIGN_RANGE
    if (band === this.band && poles === this.polesShown && wires === this.wiresShown && signs === this.signsShown) return
    this.band = band
    this.polesShown = poles
    this.wiresShown = wires
    this.signsShown = signs
    this.show()
  }

  private show(): void {
    for (const mesh of this.treeHigh) mesh.setEnabled(this.band === 'high')
    for (const mesh of this.treeLow) {
      mesh.setEnabled(this.band !== 'hidden')
      mesh.layerMask = this.band === 'high' ? SHADOW_ONLY_LAYER : DEFAULT_LAYER
    }
    this.poles?.setEnabled(this.polesShown)
    this.wires?.setEnabled(this.wiresShown)
    this.signs?.setEnabled(this.signsShown)
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose()
    this.meshes.length = 0
  }
}

/** The built-in prop layer. */
export class Props implements ChunkLayer {
  readonly name = 'props'
  private readonly scene: Scene
  private readonly terrain: Terrain
  private readonly materials: PropsMaterials
  private readonly atlas: SignAtlas
  private quality: QualitySettings
  private readonly scratch: ChunkProps = createChunkProps()
  private readonly templates: Record<'oakHigh' | 'oakLow' | 'pineHigh' | 'pineLow' | 'pole', Template>
  private hostCount = 0

  constructor(scene: Scene, terrain: Terrain, materials: PropsMaterials, atlas: SignAtlas, quality: QualitySettings) {
    this.scene = scene
    this.terrain = terrain
    this.materials = materials
    this.atlas = atlas
    this.quality = quality
    this.templates = {
      oakHigh: this.template('trucksim-broadleaf', broadleafModel(true)),
      oakLow: this.template('trucksim-broadleaf-far', broadleafModel(false)),
      pineHigh: this.template('trucksim-pine', pineModel(true)),
      pineLow: this.template('trucksim-pine-far', pineModel(false)),
      pole: this.template('trucksim-pole', poleModel()),
    }
  }

  private template(name: string, model: ModelArrays): Template {
    const mesh = templateMesh(this.scene, name, model)
    const indices = model.positions.length / 3 > 65535 ? Uint32Array.from(model.indices) : Uint16Array.from(model.indices)
    return { mesh, indices: new SharedIndexBuffer(this.scene.getEngine(), indices), vertices: model.positions.length / 3 }
  }

  /** Density and distance bands for chunks built from now on. */
  setQuality(quality: QualitySettings): void {
    this.quality = quality
  }

  private host(template: Template, name: string, matrices: Float32Array, colors: Float32Array, ctx: ChunkContext): Mesh {
    const mesh = new Mesh(`${name}-${ctx.cx}-${ctx.cz}-${this.hostCount++}`, this.scene)
    const geometry = new Geometry(`${mesh.name}-geometry`, this.scene)
    linkVertexBuffers(this.scene.getEngine(), template.mesh.geometry as Geometry, geometry)
    template.indices.attach(geometry, template.vertices)
    geometry.applyToMesh(mesh)
    mesh.parent = ctx.root
    mesh.material = this.materials.foliage
    mesh.isPickable = false
    mesh.receiveShadows = true
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, true)
    mesh.thinInstanceSetBuffer('color', colors, 4, true)
    mesh.thinInstanceRefreshBoundingInfo(false)
    mesh.freezeWorldMatrix()
    return mesh
  }

  private batchArrays(batch: InstanceBatch, originX: number, originZ: number): { matrices: Float32Array; colors: Float32Array } {
    const matrices = batch.takeMatrices()
    for (let i = 0; i < batch.count; i++) {
      matrices[i * 16 + 12] -= originX
      matrices[i * 16 + 14] -= originZ
    }
    return { matrices, colors: batch.takeColors() }
  }

  build(chunkX: number, chunkZ: number, ctx: ChunkContext): ChunkPart | null {
    const props = placeChunkProps(this.terrain, chunkX, chunkZ, this.quality.propDensity, this.scratch)
    const originX = chunkX * CHUNK_SIZE
    const originZ = chunkZ * CHUNK_SIZE
    const treeHigh: Mesh[] = []
    const treeLow: Mesh[] = []
    let poles: Mesh | null = null
    let wires: Mesh | null = null
    let signs: Mesh | null = null
    if (props.oak.count > 0) {
      const { matrices, colors } = this.batchArrays(props.oak, originX, originZ)
      treeHigh.push(this.host(this.templates.oakHigh, 'trucksim-broadleaf', matrices, colors, ctx))
      treeLow.push(this.host(this.templates.oakLow, 'trucksim-broadleaf-far', matrices, colors, ctx))
    }
    if (props.pine.count > 0) {
      const { matrices, colors } = this.batchArrays(props.pine, originX, originZ)
      treeHigh.push(this.host(this.templates.pineHigh, 'trucksim-pine', matrices, colors, ctx))
      treeLow.push(this.host(this.templates.pineLow, 'trucksim-pine-far', matrices, colors, ctx))
    }
    if (props.pole.count > 0) {
      const { matrices, colors } = this.batchArrays(props.pole, originX, originZ)
      poles = this.host(this.templates.pole, 'trucksim-poles', matrices, colors, ctx)
    }
    const wire = wireArrays(props.wires, originX, originZ)
    if (wire) {
      wires = new Mesh(`trucksim-wires-${chunkX}-${chunkZ}`, this.scene)
      const data = new VertexData()
      data.positions = wire.positions
      data.normals = wire.normals
      data.colors = wire.colors
      data.indices = wire.indices
      data.applyToMesh(wires, false)
      wires.parent = ctx.root
      wires.material = this.materials.foliage
      wires.isPickable = false
      wires.freezeWorldMatrix()
    }
    const sign = buildSignArrays(props.signs, this.atlas, originX, originZ)
    if (sign) {
      signs = new Mesh(`trucksim-signs-${chunkX}-${chunkZ}`, this.scene)
      const data = new VertexData()
      data.positions = sign.positions
      data.normals = sign.normals
      data.colors = sign.colors
      data.uvs = sign.uvs
      data.indices = sign.indices
      data.applyToMesh(signs, false)
      signs.parent = ctx.root
      signs.material = this.materials.sign
      signs.isPickable = false
      signs.receiveShadows = true
      signs.freezeWorldMatrix()
    }
    const instances = props.oak.count + props.pine.count + props.pole.count
    if (treeHigh.length === 0 && !poles && !wires && !signs) return null
    const chunk = new PropChunk({ treeHigh, treeLow, poles, wires, signs, instances }, this.quality, ctx.distance)
    for (const mesh of treeLow) ctx.addShadowCaster(mesh)
    if (poles) ctx.addShadowCaster(poles)
    if (signs) ctx.addShadowCaster(signs)
    ctx.countInstances(instances)
    return chunk
  }

  dispose(): void {
    for (const template of Object.values(this.templates)) {
      template.mesh.dispose()
      template.indices.dispose()
    }
  }
}
