import type { Scene } from '@babylonjs/core/scene'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { fbm, smoothstep } from './Noise'
import { surfaceTextures } from './Textures'

const SIZE = 1600
const SUBDIVISIONS = 240
const TILE = 10
const GRASS = [0.12, 0.17, 0.06]
const DRY = [0.24, 0.22, 0.12]
const ROCK = [0.13, 0.13, 0.12]
const SNOW = [0.82, 0.85, 0.9]

function heightAt(x: number, z: number, halfWidth: number, halfLength: number): number {
  const dx = Math.max(0, Math.abs(x) - halfWidth - 2)
  const dz = Math.max(0, Math.abs(z) - halfLength - 2)
  const d = Math.hypot(dx, dz)
  const hills = (fbm(x / 70 + 20, z / 70 - 6, 3, 4) - 0.42) * 22 * smoothstep(6, 70, d)
  const massif = smoothstep(0.32, 0.78, fbm(x / 260 + 5, z / 260 + 9, 7, 4))
  const detail = fbm(x / 50 - 3, z / 50 + 2, 19, 4)
  const mountains = (massif * 160 + detail * 60) * smoothstep(150, 420, d)
  return -0.3 + Math.max(-2, hills) + mountains
}

export function createTerrain(scene: Scene, halfWidth: number, halfLength: number): Mesh {
  const ground = MeshBuilder.CreateGround('arena-terrain', { width: SIZE, height: SIZE, subdivisions: SUBDIVISIONS, updatable: false }, scene)
  const positions = ground.getVerticesData(VertexBuffer.PositionKind) as Float32Array
  const indices = ground.getIndices() as Uint32Array
  for (let index = 0; index < positions.length; index += 3) {
    positions[index + 1] = heightAt(positions[index], positions[index + 2], halfWidth, halfLength)
  }
  const normals = new Float32Array(positions.length)
  VertexData.ComputeNormals(positions, indices, normals)
  const colors = new Float32Array((positions.length / 3) * 4)
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const y = positions[vertex * 3 + 1]
    const slope = 1 - normals[vertex * 3 + 1]
    const patch = fbm(positions[vertex * 3] / 40, positions[vertex * 3 + 2] / 40, 13, 3)
    const rock = smoothstep(0.12, 0.3, slope)
    const snow = smoothstep(150, 200, y) * (1 - smoothstep(0.35, 0.6, slope))
    for (let channel = 0; channel < 3; channel++) {
      const soil = GRASS[channel] * (1 - patch) + DRY[channel] * patch
      const ground = soil * (1 - rock) + ROCK[channel] * rock
      colors[vertex * 4 + channel] = ground * (1 - snow) + SNOW[channel] * snow
    }
    colors[vertex * 4 + 3] = 1
  }
  ground.setVerticesData(VertexBuffer.PositionKind, positions)
  ground.setVerticesData(VertexBuffer.NormalKind, normals)
  ground.setVerticesData(VertexBuffer.ColorKind, colors)

  const textures = surfaceTextures(scene, 'arena-terrain', { pattern: 'grass', base: [215, 215, 205], accent: [180, 176, 160], grime: 0.25, seed: 71, bump: 3 })
  textures.albedo.uScale = textures.albedo.vScale = SIZE / TILE
  textures.normal.uScale = textures.normal.vScale = SIZE / TILE
  const material = new PBRMaterial('arena-terrain', scene)
  material.albedoColor = Color3.White()
  material.albedoTexture = textures.albedo
  material.bumpTexture = textures.normal
  material.bumpTexture.level = 0.6
  material.metallic = 0
  material.roughness = 0.94
  ground.material = material
  ground.isPickable = false
  ground.receiveShadows = true
  ground.freezeWorldMatrix()
  return ground
}
