/**
 * Draws the country roads from `shared/Roads.ts` as matte ribbons draped a little above the terrain, in chunks of about 2 km that
 * are built when the camera comes within `LOAD_RANGE` and released beyond `UNLOAD_RANGE` (a few chunks per check, checked every
 * `CHECK_FRAMES` frames). Ribbons stop at airport ground and inside towns, whose own streets take over. Parented to the world root.
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { AIRPORTS } from '../shared/Airports'
import { allRoads } from '../shared/Roads'
import { WATER_LEVEL, terrainHeight } from '../shared/Terrain'
import { PLACES } from '../shared/Towns'

const CHUNK_POINTS = 8
const SPACING = 15
const LIFT = 0.6
const LOAD_RANGE = 6000
const UNLOAD_RANGE = 8000
const CHECK_FRAMES = 20
const BUILDS_PER_CHECK = 3

interface Chunk {
  key: string
  main: boolean
  points: Float64Array
  cx: number
  cz: number
  radius: number
  mesh: Mesh | null
  /** Built once and found to have nothing to draw (all on airport ground or in a town). */
  empty: boolean
}

function blocked(x: number, z: number): boolean {
  for (const airport of AIRPORTS) if (Math.abs(x - airport.x) < airport.halfX + 60 && Math.abs(z - airport.z) < airport.halfZ + 60) return true
  for (const place of PLACES) {
    const dx = x - place.x
    const dz = z - place.z
    if (dx * dx + dz * dz < place.radius * place.radius * 0.85) return true
  }
  return false
}

export class RoadRenderer {
  private readonly chunks: Chunk[] = []
  private readonly material: PBRMaterial
  private readonly mainMaterial: PBRMaterial
  private frames = CHECK_FRAMES
  private built = 0

  constructor(private readonly scene: Scene, private readonly parent: TransformNode, private readonly onBuilt: (mesh: Mesh) => void) {
    this.material = this.matte('takeflight-road', 0.2)
    this.mainMaterial = this.matte('takeflight-road-main', 0.16)
    for (const [r, road] of allRoads().entries()) {
      const count = road.points.length / 2
      for (let start = 0; start < count - 1; start += CHUNK_POINTS) {
        const end = Math.min(count - 1, start + CHUNK_POINTS)
        const points = road.points.slice(start * 2, end * 2 + 2)
        let cx = 0
        let cz = 0
        for (let i = 0; i < points.length; i += 2) {
          cx += points[i]
          cz += points[i + 1]
        }
        cx /= points.length / 2
        cz /= points.length / 2
        let radius = 0
        for (let i = 0; i < points.length; i += 2) radius = Math.max(radius, Math.sqrt((points[i] - cx) * (points[i] - cx) + (points[i + 1] - cz) * (points[i + 1] - cz)))
        this.chunks.push({ key: `${r}-${start}`, main: road.main, points, cx, cz, radius, mesh: null, empty: false })
      }
    }
  }

  private matte(name: string, shade: number): PBRMaterial {
    const material = new PBRMaterial(name, this.scene)
    material.albedoColor = new Color3(shade, shade * 1.02, shade * 1.05)
    material.metallic = 0
    material.roughness = 1
    material.metallicF0Factor = 0
    material.environmentIntensity = 0.5
    material.maxSimultaneousLights = 2
    material.backFaceCulling = false
    material.zOffset = -2
    return material
  }

  /** Chunks drawn right now. */
  get count(): number {
    return this.built
  }

  /** Streams chunks around a camera at world (x, z); call every frame, it only works every `CHECK_FRAMES`. */
  update(worldX: number, worldZ: number, force = false): void {
    if (!force && ++this.frames < CHECK_FRAMES) return
    this.frames = 0
    let builds = 0
    for (const chunk of this.chunks) {
      const dx = worldX - chunk.cx
      const dz = worldZ - chunk.cz
      const distance = Math.sqrt(dx * dx + dz * dz) - chunk.radius
      if (!chunk.mesh && !chunk.empty && distance < LOAD_RANGE && (force || builds < BUILDS_PER_CHECK)) {
        chunk.mesh = this.build(chunk)
        chunk.empty = chunk.mesh === null
        builds++
      } else if (chunk.mesh && distance > UNLOAD_RANGE) {
        chunk.mesh.dispose(false, false)
        chunk.mesh = null
        this.built--
      }
    }
  }

  private build(chunk: Chunk): Mesh | null {
    const half = chunk.main ? 4.5 : 3.5
    const positions: number[] = []
    const indices: number[] = []
    const p = chunk.points
    let previous: number | null = null
    let dx = 1
    let dz = 0
    const vertex = (x: number, z: number) => {
      const ground = terrainHeight(x, z)
      if (blocked(x, z) || ground < WATER_LEVEL + 0.5) {
        previous = null
        return
      }
      const base = positions.length / 3
      const y = ground + LIFT
      positions.push(x + dz * half, y, z - dx * half, x - dz * half, y, z + dx * half)
      if (previous !== null) indices.push(previous, previous + 1, base, previous + 1, base + 1, base)
      previous = base
    }
    for (let i = 0; i < p.length - 2; i += 2) {
      const ax = p[i]
      const az = p[i + 1]
      const length = Math.sqrt((p[i + 2] - ax) * (p[i + 2] - ax) + (p[i + 3] - az) * (p[i + 3] - az))
      if (length === 0) continue
      dx = (p[i + 2] - ax) / length
      dz = (p[i + 3] - az) / length
      for (let a = 0; a < length; a += SPACING) vertex(ax + dx * a, az + dz * a)
    }
    vertex(p[p.length - 2], p[p.length - 1])
    if (indices.length === 0) return null
    const mesh = new Mesh(`takeflight-road-${chunk.key}`, this.scene)
    const data = new VertexData()
    data.positions = positions
    data.indices = indices
    const normals: number[] = []
    VertexData.ComputeNormals(positions, indices, normals)
    data.normals = normals
    data.applyToMesh(mesh, false)
    mesh.material = chunk.main ? this.mainMaterial : this.material
    mesh.parent = this.parent
    mesh.isPickable = false
    mesh.receiveShadows = true
    mesh.freezeWorldMatrix()
    this.onBuilt(mesh)
    this.built++
    return mesh
  }

  dispose(): void {
    for (const chunk of this.chunks) {
      chunk.mesh?.dispose(false, false)
      chunk.mesh = null
    }
    this.built = 0
    this.material.dispose()
    this.mainMaterial.dispose()
  }
}
