/**
 * Montello's ground, laid the way Fox Lake lays its own: vertex-coloured
 * meshes over Rack & Reel's detail texture (the scene's sun, sky and fog),
 * 4 m apart, coloured by the lake country's palette from the real ground
 * cover (meadow and dry grass, mown lawns in town, needles and moss under the
 * woods, marsh, bare sand, gravel shoulders along the roads, lake and river
 * beds). One mesh per 256 m, so far ones are culled.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'
import { fbm } from '../../rackreel/world/Terrain'
import { detailTexture } from '../../rackreel/world/World'
import { COVER } from '../data/MapData'
import { smoothstep, type TelloLand } from '../region'

export const GROUND_CHUNK = 64

type Rgb = readonly [number, number, number]
const mown: Rgb = [0.36, 0.47, 0.2]
const meadow: Rgb = [0.42, 0.47, 0.22]
const dry: Rgb = [0.56, 0.52, 0.3]
const stubble: Rgb = [0.62, 0.56, 0.36]
const needles: Rgb = [0.33, 0.27, 0.17]
const moss: Rgb = [0.25, 0.32, 0.14]
const marsh: Rgb = [0.36, 0.38, 0.2]
const sand: Rgb = [0.62, 0.55, 0.42]
const lakebed: Rgb = [0.36, 0.32, 0.22]
const rock: Rgb = [0.45, 0.44, 0.41]
const shoulder: Rgb = [0.43, 0.39, 0.31]
const lot: Rgb = [0.4, 0.39, 0.37]

function mix(a: Rgb, b: Rgb, t: number): [number, number, number] {
  const k = Math.min(1, Math.max(0, t))
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

/** The ground colour at a map point (linear 0..1). */
export function groundColor(land: TelloLand, x: number, z: number): [number, number, number] {
  const cover = land.coverAt(x, z)
  const n = land.side
  const i = Math.min(n - 1, Math.max(0, Math.round((x - land.x0) / land.cell)))
  const j = Math.min(n - 1, Math.max(0, Math.round((z - land.z0) / land.cell)))
  const tone = land.grids.tone[j * n + i] / 255
  const canopy = land.grids.canopy[j * n + i] / 255
  const varN = fbm(x * 0.05, z * 0.05, 3, 13) * 0.5 + 0.5
  let c = mix(meadow, dry, tone * 0.9 + fbm(x * 0.012, z * 0.012, 3, 41) * 0.5 + 0.15)
  if (cover === COVER.lawn) c = mix(c, mown, 0.92)
  else if (cover === COVER.field) c = mix(c, stubble, 0.35 + tone * 0.65)
  else if (cover === COVER.marsh) c = mix(c, marsh, 0.8)
  else if (cover === COVER.bare) c = mix(c, sand, 0.85)
  else if (cover === COVER.lot) c = [lot[0], lot[1], lot[2]]
  c = mix(c, mix(needles, moss, varN * 0.8), smoothstep(0.3, 0.75, canopy) * (cover === COVER.lawn ? 0.3 : 1))
  const clear = land.clearAt(x, z)
  const verge = cover === COVER.lawn || cover === COVER.lot ? 1.1 : 3
  if (clear < verge) c = mix(shoulder, c, smoothstep(0, verge, clear))
  c = mix(c, rock, smoothstep(0.5, 0.8, land.slopeAt(x, z)))
  const level = land.waterAt(x, z)
  if (level !== null) {
    const depth = level - land.groundAt(x, z)
    c = mix(c, sand, smoothstep(-0.1, 0.25, depth))
    c = mix(c, lakebed, smoothstep(0.3, 2.2, depth))
  }
  const shade = 0.85 + varN * 0.3
  return [c[0] * shade, c[1] * shade, c[2] * shade]
}

/** How far the drawn ground sits under what you stand on: a little everywhere, more under pavement so road ribbons clear it. */
export function groundSink(clear: number): number {
  return 0.03 + 0.15 * (1 - smoothstep(-0.5, 1.8, clear))
}

export function buildGround(scene: Scene, land: TelloLand): Mesh[] {
  const mat = new StandardMaterial('tello-ground-mat', scene)
  mat.diffuseTexture = detailTexture(scene)
  mat.specularColor = new Color3(0.02, 0.02, 0.02)
  mat.ambientColor = new Color3(0.4, 0.4, 0.4)
  mat.freeze()
  const out: Mesh[] = []
  const cells = land.side - 1
  const step = land.cell
  for (let cj = 0; cj < cells; cj += GROUND_CHUNK) {
    for (let ci = 0; ci < cells; ci += GROUND_CHUNK) {
      const nx = Math.min(GROUND_CHUNK, cells - ci)
      const nz = Math.min(GROUND_CHUNK, cells - cj)
      const vx = nx + 1
      const vz = nz + 1
      const positions = new Float32Array(vx * vz * 3)
      const colors = new Float32Array(vx * vz * 4)
      const uvs = new Float32Array(vx * vz * 2)
      const indices = new Uint32Array(nx * nz * 6)
      for (let j = 0; j < vz; j++) {
        for (let i = 0; i < vx; i++) {
          const k = j * vx + i
          const mx = land.x0 + (ci + i) * step
          const mz = land.z0 + (cj + j) * step
          const x = land.toSceneX(mx)
          const z = land.toSceneZ(mz)
          positions[k * 3] = x
          positions[k * 3 + 1] = land.groundAt(mx, mz) - groundSink(land.clearAt(mx, mz))
          positions[k * 3 + 2] = z
          uvs[k * 2] = x / 7
          uvs[k * 2 + 1] = z / 7
          const c = groundColor(land, mx, mz)
          colors[k * 4] = c[0]
          colors[k * 4 + 1] = c[1]
          colors[k * 4 + 2] = c[2]
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
      const mesh = new Mesh(`tello-ground:${ci / GROUND_CHUNK},${cj / GROUND_CHUNK}`, scene)
      data.applyToMesh(mesh, false)
      mesh.material = mat
      mesh.receiveShadows = true
      mesh.isPickable = false
      mesh.freezeWorldMatrix()
      mesh.doNotSyncBoundingInfo = true
      out.push(mesh)
    }
  }
  return out
}
