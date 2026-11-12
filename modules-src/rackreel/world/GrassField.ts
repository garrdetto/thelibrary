/**
 * Grass around the player as streamed chunks of thin instances. Each 16 m chunk owns one mesh that shares the grass clump's vertex
 * buffers and holds fixed-size matrix and tint buffers on the GPU; chunks are filled nearest first within a small time budget as they
 * come into range and go back to a pool when they fall behind, so nothing is allocated while walking. Every chunk is built in the same
 * two scratch arrays and uploaded, so no instance data is kept on the CPU. Far chunks draw only the tallest blades of each clump, a
 * little wider, and the shader shrinks clumps into the ground toward the edge of the ring instead of popping them.
 */
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Observer } from '@babylonjs/core/Misc/observable'
import type { Nullable } from '@babylonjs/core/types'
import type { EngineContext } from '../core/EngineSetup'
import { GRASS, GRASS_CHUNK_CAPACITY, GrassBuilder, grassChunkDistance, grassChunkKey, orderBlades } from './FoliagePlacement'
import type { GrassChunkData, GrassHole } from './FoliagePlacement'
import type { FoliageMaterial, FoliageShading } from './FoliageShader'
import { linkGeometry } from './SharedGeometry'
import type { Terrain } from './Terrain'

const BUILD_BUDGET_MS = 1.6
/** After a jump this far (a respawn, the end of a boat trip) the ring is refilled in a few frames rather than a few seconds. */
const JUMP = 40
const JUMP_BUDGET_MS = 24
const LOD_SLACK = 2.5
const RESCAN_STEP = 0.75
const TIER_BLADES = [1, 0.64, 0.36]
const TIER_WIDEN = [1, 1.45, 2.1]

interface Chunk {
  mesh: Mesh
  cx: number
  cz: number
  count: number
  tier: number
}

export class GrassField {
  /** Chunks drawn, clumps and blades placed in the ring, and blades submitted after the distance tiers. */
  readonly stats = { chunks: 0, instances: 0, blades: 0, drawnBlades: 0 }
  private readonly builder: GrassBuilder
  private readonly scratch: GrassChunkData = { matrices: new Float32Array(GRASS_CHUNK_CAPACITY * 16), colors: new Float32Array(GRASS_CHUNK_CAPACITY * 4), count: 0, minY: 0, maxY: 0 }
  private readonly known = new Set<number>()
  private readonly chunks: Chunk[] = []
  private readonly emptyX: number[] = []
  private readonly emptyZ: number[] = []
  private readonly pool: Chunk[] = []
  private readonly materials: FoliageMaterial[]
  private readonly indices: Uint16Array
  private readonly tierIndexCount: number[]
  private readonly tierBlades: number[]
  private readonly bladeCount: number
  private readonly min = new Vector3()
  private readonly max = new Vector3()
  private readonly scanned = new Vector3(1e9, 0, 1e9)
  private settled = false
  private made = 0
  private restored: Nullable<Observer<AbstractEngine>>

  constructor(private readonly ctx: EngineContext, terrain: Terrain, private readonly template: Mesh, private readonly shading: FoliageShading, holes: readonly GrassHole[]) {
    this.builder = new GrassBuilder(terrain, holes)
    const ordered = orderBlades(template.getVerticesData(VertexBuffer.PositionKind)!, template.getIndices()!)
    this.indices = ordered.indices
    this.bladeCount = ordered.ends.length
    this.tierBlades = TIER_BLADES.map((share) => Math.max(1, Math.round(this.bladeCount * share)))
    this.tierIndexCount = this.tierBlades.map((blades) => ordered.ends[blades - 1])
    this.materials = TIER_WIDEN.map((widen, tier) => shading.material(`grass-${tier}`, {
      threshold: 0.03, range: 0.5, sway: 0.2, speed: 1.9, ripple: 0.33, flutter: 0.012, twoSided: true, upward: 0.4, translucency: 0.2, ambient: 0.3, fades: true, widen, wear: true,
    }))
    shading.fade.set(0, 0, GRASS.fadeStart, 1 / (GRASS.fadeEnd - GRASS.fadeStart))
    this.restored = ctx.engine.onContextRestoredObservable.add(() => this.reset())
  }

  /** Fills every chunk in range at once (the loading screen). */
  prime(center: Vector3): void {
    this.update(center, Infinity)
  }

  update(center: Vector3, budgetMs = BUILD_BUDGET_MS): void {
    this.shading.fade.x = center.x
    this.shading.fade.y = center.z
    const moved = Math.abs(center.x - this.scanned.x) + Math.abs(center.z - this.scanned.z)
    if (this.settled && moved < RESCAN_STEP) return
    this.scanned.copyFrom(center)
    this.drop(center)
    this.settled = this.stream(center, moved > JUMP ? Math.max(budgetMs, JUMP_BUDGET_MS) : budgetMs)
    this.grade(center)
  }

  private drop(center: Vector3): void {
    const chunks = this.chunks
    for (let i = chunks.length - 1; i >= 0; i--) {
      const chunk = chunks[i]
      if (grassChunkDistance(chunk.cx, chunk.cz, center.x, center.z) <= GRASS.release) continue
      chunk.mesh.setEnabled(false)
      this.known.delete(grassChunkKey(chunk.cx, chunk.cz))
      this.pool.push(chunk)
      chunks[i] = chunks[chunks.length - 1]
      chunks.pop()
    }
    const ex = this.emptyX
    const ez = this.emptyZ
    for (let i = ex.length - 1; i >= 0; i--) {
      if (grassChunkDistance(ex[i], ez[i], center.x, center.z) <= GRASS.release) continue
      this.known.delete(grassChunkKey(ex[i], ez[i]))
      ex[i] = ex[ex.length - 1]
      ez[i] = ez[ez.length - 1]
      ex.pop()
      ez.pop()
    }
  }

  /** Fills missing chunks nearest first until the time budget runs out; true once none are missing. */
  private stream(center: Vector3, budgetMs: number): boolean {
    const size = GRASS.chunk
    const reach = GRASS.fadeEnd
    const cx0 = Math.floor((center.x - reach) / size)
    const cx1 = Math.floor((center.x + reach) / size)
    const cz0 = Math.floor((center.z - reach) / size)
    const cz1 = Math.floor((center.z + reach) / size)
    const started = performance.now()
    for (;;) {
      let best = Infinity
      let bx = 0
      let bz = 0
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const d = grassChunkDistance(cx, cz, center.x, center.z)
          if (d >= reach || d >= best || this.known.has(grassChunkKey(cx, cz))) continue
          best = d
          bx = cx
          bz = cz
        }
      }
      if (best === Infinity) return true
      this.fill(bx, bz)
      if (performance.now() - started > budgetMs) return false
    }
  }

  private grade(center: Vector3): void {
    const size = GRASS.chunk
    const stats = this.stats
    stats.chunks = this.chunks.length
    stats.instances = 0
    stats.drawnBlades = 0
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i]
      const d = Math.hypot((chunk.cx + 0.5) * size - center.x, (chunk.cz + 0.5) * size - center.z)
      let tier = chunk.tier
      if (tier < 0) tier = d < GRASS.near ? 0 : d < GRASS.mid ? 1 : 2
      else if (tier === 0 && d > GRASS.near + LOD_SLACK) tier = 1
      else if (tier === 1 && d < GRASS.near - LOD_SLACK) tier = 0
      else if (tier === 1 && d > GRASS.mid + LOD_SLACK) tier = 2
      else if (tier === 2 && d < GRASS.mid - LOD_SLACK) tier = 1
      if (tier !== chunk.tier) {
        chunk.tier = tier
        chunk.mesh.material = this.materials[tier]
        chunk.mesh.subMeshes[0].indexCount = this.tierIndexCount[tier]
      }
      stats.instances += chunk.count
      stats.drawnBlades += chunk.count * this.tierBlades[tier]
    }
    stats.blades = stats.instances * this.bladeCount
  }

  private fill(cx: number, cz: number): void {
    this.known.add(grassChunkKey(cx, cz))
    const built = this.scratch
    this.builder.build(cx, cz, built)
    if (built.count === 0) {
      this.emptyX.push(cx)
      this.emptyZ.push(cz)
      return
    }
    const chunk = this.pool.pop() ?? this.create()
    chunk.cx = cx
    chunk.cz = cz
    chunk.count = built.count
    chunk.tier = -1
    const mesh = chunk.mesh
    mesh.thinInstanceCount = built.count
    mesh.thinInstanceBufferUpdated('matrix')
    mesh.thinInstanceBufferUpdated('instanceColor')
    const size = GRASS.chunk
    this.min.set(cx * size - 0.6, built.minY - 0.1, cz * size - 0.6)
    this.max.set((cx + 1) * size + 0.6, built.maxY + 0.2, (cz + 1) * size + 0.6)
    mesh.getBoundingInfo().reConstruct(this.min, this.max, mesh.getWorldMatrix())
    mesh.setEnabled(true)
    this.chunks.push(chunk)
  }

  private create(): Chunk {
    const mesh = new Mesh(`grass-chunk-${this.made++}`, this.ctx.scene)
    linkGeometry(this.template, mesh, this.indices)
    mesh.material = this.materials[0]
    mesh.isPickable = false
    mesh.freezeWorldMatrix()
    mesh.doNotSyncBoundingInfo = true
    mesh.thinInstanceSetBuffer('matrix', this.scratch.matrices, 16, false)
    mesh.thinInstanceRegisterAttribute('instanceColor', 4)
    mesh.thinInstanceSetBuffer('instanceColor', this.scratch.colors, 4, false)
    mesh.thinInstanceCount = 0
    mesh.setEnabled(false)
    this.ctx.registerDynamic(mesh)
    return { mesh, cx: 0, cz: 0, count: 0, tier: -1 }
  }

  /** Empties the ring so the next update fills it again (the chunk buffers only exist on the GPU, so a restored context has lost them). */
  reset(): void {
    for (const chunk of this.chunks) {
      chunk.mesh.setEnabled(false)
      this.pool.push(chunk)
    }
    this.chunks.length = 0
    this.emptyX.length = 0
    this.emptyZ.length = 0
    this.known.clear()
    this.settled = false
    this.scanned.set(1e9, 0, 1e9)
  }

  dispose(): void {
    if (this.restored) this.ctx.engine.onContextRestoredObservable.remove(this.restored)
    this.restored = null
    this.reset()
    for (const chunk of this.pool) {
      this.ctx.unregisterDynamic(chunk.mesh)
      chunk.mesh.dispose()
    }
    this.pool.length = 0
  }
}
