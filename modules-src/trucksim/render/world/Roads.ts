/**
 * The built-in road layer: one merged ribbon mesh per chunk (every road stretch whose centre line lies in the chunk, built by
 * `RoadsGeometry`) in the shared road material, which pulls the ribbon toward the camera with a depth offset so it stays on top
 * of the ground at any distance. Roads receive shadows and cast none. One draw call per chunk that has a road.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'
import type { Terrain } from '../../shared/Terrain'
import { buildRoadArrays, getRoadNetwork } from './RoadsGeometry'
import type { RoadNetwork } from './RoadsGeometry'
import type { ChunkContext, ChunkLayer, ChunkPart } from './WorldRenderer'

/** The built-in road layer. */
export class Roads implements ChunkLayer {
  readonly name = 'roads'
  private readonly scene: Scene
  private readonly terrain: Terrain
  private readonly material: Material
  private readonly network: RoadNetwork

  constructor(scene: Scene, terrain: Terrain, material: Material, network: RoadNetwork = getRoadNetwork()) {
    this.scene = scene
    this.terrain = terrain
    this.material = material
    this.network = network
  }

  build(chunkX: number, chunkZ: number, ctx: ChunkContext): ChunkPart | null {
    const arrays = buildRoadArrays(this.terrain, this.network, chunkX, chunkZ)
    if (!arrays) return null
    const mesh = new Mesh(`trucksim-roads-${chunkX}-${chunkZ}`, this.scene)
    const data = new VertexData()
    data.positions = arrays.positions
    data.normals = arrays.normals
    data.colors = arrays.colors
    data.indices = arrays.indices
    data.applyToMesh(mesh, false)
    mesh.parent = ctx.root
    mesh.material = this.material
    mesh.receiveShadows = true
    mesh.isPickable = false
    mesh.freezeWorldMatrix()
    return mesh
  }
}
