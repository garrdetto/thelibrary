/**
 * Fox Lake's ground north of the lake country, made the way Rack & Reel makes
 * its own: one vertex-coloured mesh over the detail texture (StandardMaterial,
 * the scene's sun, sky and fog), so the town's lawns, meadows and woods blend
 * straight into the lake country at the seam. The country road from the
 * interstate to East Ave is a ribbon in the interstate's asphalt.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'
import { HALF, fbm, smoothstep } from '../../rackreel/world/Terrain'
import type { Terrain } from '../../rackreel/world/Terrain'
import { detailTexture } from '../../rackreel/world/World'
import { roadTexture } from '../../rackreel/world/Highway'
import { MAP_BOUNDS } from '../../maplestreet/shared/WorldLayout'
import { TOWN_OFFSET, TOWN_SQUARE, TOWN_Y, connectorDistance, connectorPath, sceneToTown } from '../region'

/** The ground covers the town square and the strip between it and the lake country's north-east corner. */
export const GROUND_RECT = { x0: TOWN_SQUARE.x0, x1: HALF + 8, z0: HALF - 4, z1: TOWN_SQUARE.z1 } as const
const CELL = 8

const mown = [0.36, 0.47, 0.2]
const meadow = [0.44, 0.48, 0.24]
const dry = [0.55, 0.52, 0.31]
const needles = [0.33, 0.27, 0.17]
const moss = [0.25, 0.32, 0.14]

function mix(a: number[], b: number[], t: number): number[] {
  const k = Math.min(1, Math.max(0, t))
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

/** 1 deep in the forest ring, 0 in the built-up town (town coordinates). */
export function woodsAt(tx: number, tz: number): number {
  const out = Math.max(MAP_BOUNDS.x0 - tx, tx - MAP_BOUNDS.x1, tz - MAP_BOUNDS.z1, MAP_BOUNDS.z0 - tz)
  return smoothstep(4, 40, out) * (0.75 + 0.25 * (fbm(tx * 0.01, tz * 0.01, 3, 71) * 0.5 + 0.5))
}

export function buildTownGround(scene: Scene, terrain: Terrain): Mesh {
  const nx = Math.ceil((GROUND_RECT.x1 - GROUND_RECT.x0) / CELL)
  const nz = Math.ceil((GROUND_RECT.z1 - GROUND_RECT.z0) / CELL)
  const vx = nx + 1
  const vz = nz + 1
  const positions = new Float32Array(vx * vz * 3)
  const colors = new Float32Array(vx * vz * 4)
  const uvs = new Float32Array(vx * vz * 2)
  const indices = new Uint32Array(nx * nz * 6)
  for (let j = 0; j < vz; j++) {
    for (let i = 0; i < vx; i++) {
      const k = j * vx + i
      const x = GROUND_RECT.x0 + i * CELL
      const z = GROUND_RECT.z0 + j * CELL
      const inside = Math.abs(x) <= HALF && Math.abs(z) <= HALF
      const y = inside ? terrain.heightAt(x, z) - 0.05 : TOWN_Y - 0.03
      positions[k * 3] = x
      positions[k * 3 + 1] = y
      positions[k * 3 + 2] = z
      uvs[k * 2] = x / 7
      uvs[k * 2 + 1] = z / 7
      const t = sceneToTown(x, 0, z)
      const woods = woodsAt(t.x, t.z)
      const varN = fbm(x * 0.05, z * 0.05, 3, 13) * 0.5 + 0.5
      let c = mix(mown, mix(meadow, dry, fbm(x * 0.012, z * 0.012, 3, 41) + 0.4), 0.35 + woods * 0.65)
      c = mix(c, mix(needles, moss, varN * 0.8), woods * 0.8)
      const shade = 0.85 + varN * 0.3
      colors[k * 4] = c[0] * shade
      colors[k * 4 + 1] = c[1] * shade
      colors[k * 4 + 2] = c[2] * shade
      colors[k * 4 + 3] = 1
    }
  }
  let t = 0
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * vx + i
      indices[t++] = a
      indices[t++] = a + 1
      indices[t++] = a + vx
      indices[t++] = a + vx + 1
      indices[t++] = a + vx
      indices[t++] = a + 1
    }
  }
  const normals = new Float32Array(positions.length)
  VertexData.ComputeNormals(positions, indices, normals, { useRightHandedSystem: false })
  const data = new VertexData()
  data.positions = positions
  data.indices = indices
  data.normals = normals
  data.colors = colors
  data.uvs = uvs
  const mesh = new Mesh('town-ground', scene)
  data.applyToMesh(mesh, false)
  const mat = new StandardMaterial('town-ground-mat', scene)
  mat.diffuseTexture = detailTexture(scene)
  mat.specularColor = new Color3(0.02, 0.02, 0.02)
  mat.ambientColor = new Color3(0.4, 0.4, 0.4)
  mat.freeze()
  mesh.material = mat
  mesh.receiveShadows = true
  mesh.isPickable = false
  mesh.freezeWorldMatrix()
  mesh.doNotSyncBoundingInfo = true
  return mesh
}

/** The two-lane country road from the interstate's north end to East Ave. */
export function buildConnector(scene: Scene, terrain: Terrain): Mesh {
  const path = connectorPath(4)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let along = 0
  for (let i = 0; i < path.length; i++) {
    const p = path[i]
    const q = path[Math.min(path.length - 1, i + 1)]
    const o = path[Math.max(0, i - 1)]
    const dx = q.x - o.x
    const dz = q.z - o.z
    const len = Math.hypot(dx, dz) || 1
    const sx = -dz / len
    const sz = dx / len
    if (i > 0) along += Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z)
    for (const side of [-1, 1]) {
      const x = p.x + sx * side * p.w * 0.5
      const z = p.z + sz * side * p.w * 0.5
      positions.push(x, roadHeight(terrain, x, z), z)
      uvs.push(side < 0 ? 0 : 1, along / 9)
    }
    if (i > 0) {
      const b = i * 2
      indices.push(b - 2, b, b - 1, b - 1, b, b + 1)
    }
  }
  const normals: number[] = []
  VertexData.ComputeNormals(positions, indices, normals, { useRightHandedSystem: false })
  const data = new VertexData()
  data.positions = positions
  data.indices = indices
  data.normals = normals
  data.uvs = uvs
  const mesh = new Mesh('county-road', scene)
  data.applyToMesh(mesh, false)
  const mat = new StandardMaterial('county-road-mat', scene)
  const tex = roadTexture(scene)
  tex.wrapV = Texture.WRAP_ADDRESSMODE
  mat.diffuseTexture = tex
  mat.specularColor = new Color3(0.04, 0.04, 0.04)
  mat.ambientColor = new Color3(0.35, 0.35, 0.35)
  mat.backFaceCulling = false
  mat.zOffset = -2
  mesh.material = mat
  mesh.receiveShadows = true
  mesh.isPickable = false
  mesh.freezeWorldMatrix()
  return mesh
}

function roadHeight(terrain: Terrain, x: number, z: number): number {
  return Math.max(terrain.heightAt(x, z), TOWN_Y) + 0.06
}

/** Tree spots for the strip of woods east of the town square (scene coordinates), clear of the road. */
export function fillerTrees(): { x: number; z: number; scale: number; yaw: number; kind: 'pine' | 'hardwood' | 'birch' }[] {
  const out: { x: number; z: number; scale: number; yaw: number; kind: 'pine' | 'hardwood' | 'birch' }[] = []
  const x0 = TOWN_SQUARE.x1 - 20
  for (let x = x0; x < GROUND_RECT.x1 - 4; x += 7) {
    for (let z = HALF + 6; z < TOWN_SQUARE.z1 - 10; z += 7) {
      const h = fbm(x * 0.37, z * 0.41, 2, 5) * 0.5 + 0.5
      if (h < 0.35) continue
      const px = x + (fbm(x * 0.9, z, 1, 7) * 0.5 + 0.5) * 5
      const pz = z + (fbm(x, z * 0.9, 1, 8) * 0.5 + 0.5) * 5
      if (connectorDistance(px, pz) < 6) continue
      const pick = fbm(px * 0.11, pz * 0.13, 2, 9) * 0.5 + 0.5
      out.push({ x: px, z: pz, scale: 0.75 + h * 0.5, yaw: pick * Math.PI * 2, kind: pick < 0.15 ? 'birch' : pick < 0.6 ? 'pine' : 'hardwood' })
    }
  }
  return out
}

export const GROUND_LEVEL = TOWN_OFFSET.y
