/**
 * The ground mesh, one 256 m chunk at a time. A chunk is drawn from a 2 m grid when the camera is within about one chunk of it
 * and from an 8 m grid beyond, switching with hysteresis; the far grid is built at once when the chunk loads, and the 2 m grid
 * is sampled a few rows per frame (within the world renderer's time budget) before it replaces the old mesh, so crossing into a
 * new chunk never hitches. Heights come straight from `Terrain.heightAt`; normals come from the height function by central
 * differences over one grid step, sampled one step past the chunk's border, so two neighbouring chunks agree exactly along their
 * shared edge; skirts hang below every edge to hide cracks where a 2 m chunk meets an 8 m one. Vertex colours come from
 * `surfaceAt` through `TerrainChunksPalette`. Every chunk of a resolution draws with one shared index buffer.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import { Geometry } from '@babylonjs/core/Meshes/geometry'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import type { Terrain } from '../../shared/Terrain'
import { CHUNK_SIZE } from '../../shared/WorldLayout'
import type { Rgb } from './AtmosphereSky'
import { groundColor } from './TerrainChunksPalette'
import { SharedIndexBuffer, pushFacing } from './WorldRendererBuffers'
import type { ChunkContext, ChunkLayer, ChunkPart } from './WorldRenderer'

export type TerrainLod = 'near' | 'far'

export const NEAR_SPACING = 2
export const FAR_SPACING = 8
/** Camera distance to a chunk's square (m) below which it switches to the 2 m grid, and above which it goes back to 8 m. */
export const NEAR_ENTER = 176
export const NEAR_EXIT = 240
const SKIRT_DEPTH: Record<TerrainLod, number> = { near: 4, far: 12 }

/** Grid size for a level of detail: `cells` squares a side, `verts` = cells + 1 vertices a side, plus four skirts. */
export function terrainGrid(lod: TerrainLod): { spacing: number; cells: number; verts: number; total: number } {
  const spacing = lod === 'near' ? NEAR_SPACING : FAR_SPACING
  const cells = CHUNK_SIZE / spacing
  const verts = cells + 1
  return { spacing, cells, verts, total: verts * verts + verts * 4 }
}

/** Vertex arrays for one chunk mesh, positions local to the chunk's minimum corner (x0, 0, z0). */
export interface TerrainArrays {
  lod: TerrainLod
  x0: number
  z0: number
  verts: number
  spacing: number
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
}

/** Builds the shared triangle list for a grid of `verts` × `verts` vertices with skirts on all four edges. */
export function terrainIndices(lod: TerrainLod): Uint16Array | Uint32Array {
  const { verts, spacing, total } = terrainGrid(lod)
  const flat = new Float32Array(total * 3)
  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const at = (iz * verts + ix) * 3
      flat[at] = ix * spacing
      flat[at + 2] = iz * spacing
    }
  }
  const skirtStart = verts * verts
  const edgeVertex = (edge: number, i: number): number => {
    if (edge === 0) return i
    if (edge === 1) return (verts - 1) * verts + i
    if (edge === 2) return i * verts
    return i * verts + verts - 1
  }
  for (let edge = 0; edge < 4; edge++) {
    for (let i = 0; i < verts; i++) {
      const top = edgeVertex(edge, i)
      const at = (skirtStart + edge * verts + i) * 3
      flat[at] = flat[top * 3]
      flat[at + 1] = -1
      flat[at + 2] = flat[top * 3 + 2]
    }
  }
  const indices: number[] = []
  for (let iz = 0; iz < verts - 1; iz++) {
    for (let ix = 0; ix < verts - 1; ix++) {
      const a = iz * verts + ix
      const b = a + 1
      const c = a + verts
      const d = c + 1
      pushFacing(indices, flat, a, b, c, 0, 1, 0)
      pushFacing(indices, flat, b, d, c, 0, 1, 0)
    }
  }
  const outward: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]]
  for (let edge = 0; edge < 4; edge++) {
    const [ox, oz] = outward[edge]
    for (let i = 0; i < verts - 1; i++) {
      const topA = edgeVertex(edge, i)
      const topB = edgeVertex(edge, i + 1)
      const lowA = skirtStart + edge * verts + i
      const lowB = lowA + 1
      pushFacing(indices, flat, topA, lowA, topB, ox, 0, oz)
      pushFacing(indices, flat, topB, lowA, lowB, ox, 0, oz)
    }
  }
  return total > 65535 ? Uint32Array.from(indices) : Uint16Array.from(indices)
}

/**
 * Samples one chunk incrementally: each `step` takes one row of heights (with a one-step border) and colours the row before it.
 * Scratch arrays are passed in so a single sampler's memory can be reused chunk after chunk.
 */
export class TerrainSampler {
  readonly lod: TerrainLod
  readonly x0: number
  readonly z0: number
  private readonly terrain: Terrain
  private readonly verts: number
  private readonly spacing: number
  private readonly heights: Float64Array
  private readonly colors: Float32Array
  private readonly color: Rgb = [0, 0, 0]
  private row = 0

  constructor(terrain: Terrain, chunkX: number, chunkZ: number, lod: TerrainLod, heights?: Float64Array, colors?: Float32Array) {
    const grid = terrainGrid(lod)
    this.terrain = terrain
    this.lod = lod
    this.verts = grid.verts
    this.spacing = grid.spacing
    this.x0 = chunkX * CHUNK_SIZE
    this.z0 = chunkZ * CHUNK_SIZE
    const border = grid.verts + 2
    this.heights = heights && heights.length >= border * border ? heights : new Float64Array(border * border)
    this.colors = colors && colors.length >= grid.verts * grid.verts * 3 ? colors : new Float32Array(grid.verts * grid.verts * 3)
  }

  get done(): boolean {
    return this.row > this.verts + 1
  }

  /** Samples rows until `deadline` (on `clock`) or the end; returns true when every row is done. Always samples at least one row. */
  run(deadline: number, clock: () => number): boolean {
    do {
      this.sampleRow()
    } while (!this.done && clock() < deadline)
    return this.done
  }

  private sampleRow(): void {
    const verts = this.verts
    const border = verts + 2
    const spacing = this.spacing
    const row = this.row
    if (row <= verts + 1) {
      const z = this.z0 + (row - 1) * spacing
      for (let column = 0; column < border; column++) this.heights[row * border + column] = this.terrain.heightAt(this.x0 + (column - 1) * spacing, z)
    }
    const colorRow = row - 1
    if (colorRow >= 0 && colorRow < verts) {
      const z = this.z0 + colorRow * spacing
      const fine = this.lod === 'near'
      for (let ix = 0; ix < verts; ix++) {
        const x = this.x0 + ix * spacing
        const height = this.heights[(colorRow + 1) * border + ix + 1]
        groundColor(this.terrain, x, z, height, fine, this.color)
        const at = (colorRow * verts + ix) * 3
        this.colors[at] = this.color[0]
        this.colors[at + 1] = this.color[1]
        this.colors[at + 2] = this.color[2]
      }
    }
    this.row++
  }

  /** Assembles the vertex arrays (call once `done`). */
  finish(): TerrainArrays {
    const verts = this.verts
    const border = verts + 2
    const spacing = this.spacing
    const total = verts * verts + verts * 4
    const positions = new Float32Array(total * 3)
    const normals = new Float32Array(total * 3)
    const colors = new Float32Array(total * 4)
    const heights = this.heights
    for (let iz = 0; iz < verts; iz++) {
      for (let ix = 0; ix < verts; ix++) {
        const center = (iz + 1) * border + ix + 1
        const nx = -(heights[center + 1] - heights[center - 1])
        const ny = 2 * spacing
        const nz = -(heights[center + border] - heights[center - border])
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
        const vertex = iz * verts + ix
        positions[vertex * 3] = ix * spacing
        positions[vertex * 3 + 1] = heights[center]
        positions[vertex * 3 + 2] = iz * spacing
        normals[vertex * 3] = nx / length
        normals[vertex * 3 + 1] = ny / length
        normals[vertex * 3 + 2] = nz / length
        colors[vertex * 4] = this.colors[vertex * 3]
        colors[vertex * 4 + 1] = this.colors[vertex * 3 + 1]
        colors[vertex * 4 + 2] = this.colors[vertex * 3 + 2]
        colors[vertex * 4 + 3] = 1
      }
    }
    const depth = SKIRT_DEPTH[this.lod]
    const skirtStart = verts * verts
    for (let edge = 0; edge < 4; edge++) {
      for (let i = 0; i < verts; i++) {
        const top = edge === 0 ? i : edge === 1 ? (verts - 1) * verts + i : edge === 2 ? i * verts : i * verts + verts - 1
        const vertex = skirtStart + edge * verts + i
        positions[vertex * 3] = positions[top * 3]
        positions[vertex * 3 + 1] = positions[top * 3 + 1] - depth
        positions[vertex * 3 + 2] = positions[top * 3 + 2]
        normals[vertex * 3] = normals[top * 3]
        normals[vertex * 3 + 1] = normals[top * 3 + 1]
        normals[vertex * 3 + 2] = normals[top * 3 + 2]
        colors[vertex * 4] = colors[top * 4] * 0.8
        colors[vertex * 4 + 1] = colors[top * 4 + 1] * 0.8
        colors[vertex * 4 + 2] = colors[top * 4 + 2] * 0.8
        colors[vertex * 4 + 3] = 1
      }
    }
    return { lod: this.lod, x0: this.x0, z0: this.z0, verts, spacing, positions, normals, colors }
  }
}

/** Samples and assembles a whole chunk at once (tests, priming). */
export function buildTerrainArrays(terrain: Terrain, chunkX: number, chunkZ: number, lod: TerrainLod): TerrainArrays {
  const sampler = new TerrainSampler(terrain, chunkX, chunkZ, lod)
  sampler.run(Number.POSITIVE_INFINITY, () => 0)
  return sampler.finish()
}

/** One chunk's ground: its current mesh and the level of detail it wants. */
export class TerrainChunk implements ChunkPart {
  readonly chunkX: number
  readonly chunkZ: number
  mesh: Mesh | null = null
  lod: TerrainLod | null = null
  wanted: TerrainLod
  distance: number
  disposed = false
  private readonly layer: TerrainChunks
  readonly ctx: ChunkContext

  constructor(layer: TerrainChunks, ctx: ChunkContext) {
    this.layer = layer
    this.ctx = ctx
    this.chunkX = ctx.cx
    this.chunkZ = ctx.cz
    this.distance = ctx.distance
    this.wanted = ctx.distance < NEAR_ENTER ? 'near' : 'far'
  }

  setDistance(distance: number): void {
    this.distance = distance
    const next: TerrainLod = this.wanted === 'near' ? (distance > NEAR_EXIT ? 'far' : 'near') : distance < NEAR_ENTER ? 'near' : 'far'
    if (next === this.wanted) return
    this.wanted = next
    if (next !== this.lod) this.layer.request(this)
  }

  /** Shows `arrays` as this chunk's mesh, replacing (and disposing) the previous level of detail. */
  apply(arrays: TerrainArrays): void {
    if (this.disposed) return
    const next = this.layer.createMesh(this.ctx, arrays)
    this.mesh?.dispose()
    this.mesh = next
    this.lod = arrays.lod
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.layer.forget(this)
    this.mesh?.dispose()
    this.mesh = null
  }
}

/** The built-in terrain layer. */
export class TerrainChunks implements ChunkLayer {
  readonly name = 'terrain'
  private readonly scene: Scene
  private readonly terrain: Terrain
  private readonly material: Material
  private readonly indexBuffers: Record<TerrainLod, SharedIndexBuffer>
  private readonly pending: TerrainChunk[] = []
  private readonly clock: () => number
  private readonly scratchHeights: Float64Array
  private readonly scratchColors: Float32Array
  private readonly farHeights: Float64Array
  private readonly farColors: Float32Array
  private job: { chunk: TerrainChunk; sampler: TerrainSampler } | null = null
  private meshCount = 0

  constructor(scene: Scene, terrain: Terrain, material: Material, clock: () => number = () => performance.now()) {
    this.scene = scene
    this.terrain = terrain
    this.material = material
    this.clock = clock
    const engine = scene.getEngine()
    this.indexBuffers = { near: new SharedIndexBuffer(engine, terrainIndices('near')), far: new SharedIndexBuffer(engine, terrainIndices('far')) }
    const near = terrainGrid('near')
    const far = terrainGrid('far')
    this.scratchHeights = new Float64Array((near.verts + 2) * (near.verts + 2))
    this.scratchColors = new Float32Array(near.verts * near.verts * 3)
    this.farHeights = new Float64Array((far.verts + 2) * (far.verts + 2))
    this.farColors = new Float32Array(far.verts * far.verts * 3)
  }

  /** Chunks waiting for a new level of detail. */
  get queued(): number {
    return this.pending.length + (this.job ? 1 : 0)
  }

  build(_chunkX: number, _chunkZ: number, ctx: ChunkContext): TerrainChunk {
    const chunk = new TerrainChunk(this, ctx)
    const sampler = new TerrainSampler(this.terrain, ctx.cx, ctx.cz, 'far', this.farHeights, this.farColors)
    sampler.run(Number.POSITIVE_INFINITY, this.clock)
    chunk.apply(sampler.finish())
    if (chunk.wanted !== chunk.lod) this.request(chunk)
    return chunk
  }

  /** Builds the chunk's wanted level of detail right away (loading screens). */
  completeNow(chunk: TerrainChunk): void {
    if (chunk.disposed || chunk.wanted === chunk.lod) return
    if (this.job?.chunk === chunk) this.job = null
    this.forgetPending(chunk)
    chunk.apply(buildTerrainArrays(this.terrain, chunk.chunkX, chunk.chunkZ, chunk.wanted))
  }

  request(chunk: TerrainChunk): void {
    if (chunk.disposed || this.job?.chunk === chunk || this.pending.includes(chunk)) return
    this.pending.push(chunk)
  }

  forget(chunk: TerrainChunk): void {
    if (this.job?.chunk === chunk) this.job = null
    this.forgetPending(chunk)
  }

  private forgetPending(chunk: TerrainChunk): void {
    const index = this.pending.indexOf(chunk)
    if (index >= 0) this.pending.splice(index, 1)
  }

  /** Advances queued level-of-detail rebuilds, nearest chunk first, for at most `budgetMs`. */
  update(budgetMs: number): void {
    const deadline = this.clock() + budgetMs
    for (;;) {
      if (!this.job) {
        const next = this.takeNearest()
        if (!next) return
        if (next.wanted === next.lod) continue
        this.job = { chunk: next, sampler: new TerrainSampler(this.terrain, next.chunkX, next.chunkZ, next.wanted, this.scratchHeights, this.scratchColors) }
      }
      const job = this.job
      if (!job.sampler.run(deadline, this.clock)) return
      this.job = null
      if (!job.chunk.disposed) {
        if (job.chunk.wanted === job.sampler.lod) job.chunk.apply(job.sampler.finish())
        else this.request(job.chunk)
      }
      if (this.clock() >= deadline) return
    }
  }

  private takeNearest(): TerrainChunk | null {
    let best = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < this.pending.length; index++) {
      const candidate = this.pending[index]
      if (candidate.distance < bestDistance) {
        bestDistance = candidate.distance
        best = index
      }
    }
    if (best < 0) return null
    const [chunk] = this.pending.splice(best, 1)
    return chunk
  }

  /** Creates a ground mesh from `arrays` under the chunk's node. */
  createMesh(ctx: ChunkContext, arrays: TerrainArrays): Mesh {
    const name = `trucksim-terrain-${ctx.cx}-${ctx.cz}-${arrays.lod}-${this.meshCount++}`
    const mesh = new Mesh(name, this.scene)
    const geometry = new Geometry(`${name}-geometry`, this.scene)
    geometry.setVerticesData('position', arrays.positions, false, 3)
    geometry.setVerticesData('normal', arrays.normals, false, 3)
    geometry.setVerticesData('color', arrays.colors, false, 4)
    this.indexBuffers[arrays.lod].attach(geometry, arrays.positions.length / 3)
    geometry.applyToMesh(mesh)
    mesh.parent = ctx.root
    mesh.material = this.material
    mesh.receiveShadows = true
    mesh.isPickable = false
    mesh.freezeWorldMatrix()
    return mesh
  }

  dispose(): void {
    this.pending.length = 0
    this.job = null
    this.indexBuffers.near.dispose()
    this.indexBuffers.far.dispose()
  }
}
