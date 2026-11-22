/**
 * The open county, streamed in 256 m chunks around the camera. A `ChunkStreamer` loads the nearest chunks first within a per-frame
 * budget; each chunk gets its own `Scope` and node under the world root, and every layer builds its part of the chunk: the built-in
 * terrain (2 m grid near, 8 m far), roads and props, then any layers the host adds (site scenery). Layers learn the camera's
 * distance to their chunk every update so they can swap detail, and register shadow casters that the renderer hands to the
 * atmosphere only while the chunk is within shadow range. The renderer owns its materials, the sign atlas and the prop templates,
 * reports loaded chunks and thin instances to the `MemoryGuard`, gives up one streaming ring at a time under memory pressure and
 * takes one back after each 60 s at 'ok', and `dispose()` removes every mesh, material, geometry and texture it made, plus the
 * layers it was given. `update` allocates nothing beyond what loading a chunk needs. Chunks also stream a little past the world's
 * edge (ground and trees only) so the county never ends in a cliff.
 */
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { Terrain } from '../../shared/Terrain'
import { CHUNK_SIZE, CHUNKS_PER_SIDE } from '../../shared/WorldLayout'
import type { MemoryGuard } from '../../systems/MemoryGuard'
import { Scope } from '../../systems/Scope'
import type { Disposable } from '../../systems/Scope'
import { ChunkStreamer } from '../../systems/Streamer'
import { qualitySettings } from '../Quality'
import type { QualitySettings, QualityTier } from '../Quality'
import type { Atmosphere } from './Atmosphere'
import { Props } from './Props'
import { createSignAtlas } from './PropsSigns'
import { Roads } from './Roads'
import { TerrainChunk, TerrainChunks } from './TerrainChunks'
import { createWorldMaterials } from './WorldRendererMaterials'
import type { WorldMaterials } from './WorldRendererMaterials'

/** A chunk's share of one layer. `setDistance`, when present, hears the camera's distance (m) to the chunk's square each update. */
export interface ChunkPart extends Disposable {
  setDistance?(distance: number): void
}

/** What a layer is told when it builds a chunk; valid for the chunk's whole life. */
export interface ChunkContext {
  readonly scene: Scene
  /** The county frame: an identity node under the renderer's parent. Meshes placed in county coordinates can hang here. */
  readonly parent: TransformNode
  /** This chunk's node under `parent`, positioned at the chunk's minimum corner (x0, 0, z0). Disposed with the chunk. */
  readonly root: TransformNode
  readonly terrain: Terrain
  readonly quality: Readonly<QualitySettings>
  readonly cx: number
  readonly cz: number
  /** World coordinates of the chunk's minimum corner, and its size (256). */
  readonly x0: number
  readonly z0: number
  readonly size: number
  /** Camera distance (m) to the chunk's square when it was built. */
  readonly distance: number
  /** Registers a mesh that casts sun shadows while this chunk is within shadow range (removed again before the chunk unloads). */
  addShadowCaster(mesh: AbstractMesh): void
  /** Adds to the thin-instance count the renderer reports to the MemoryGuard. */
  countInstances(count: number): void
}

/** Something that builds part of each chunk. The renderer disposes every part when its chunk unloads, and the layer itself on `dispose`. */
export interface ChunkLayer {
  readonly name?: string
  build(chunkX: number, chunkZ: number, ctx: ChunkContext): ChunkPart | null
  /** Optional per-frame work (time-sliced rebuilds), with the milliseconds left in the frame's budget. */
  update?(budgetMs: number): void
  dispose?(): void
}

export interface WorldRendererOptions {
  /** When given, chunk shadow casters go to its sun shadows and its fog follows the streaming radius. */
  atmosphere?: Atmosphere
  /** Milliseconds per update for loading chunks and rebuilding detail (default 3). */
  budgetMs?: number
  clock?: () => number
}

export interface WorldRenderer {
  /** The county frame node (identity, under the parent given at creation). */
  readonly root: TransformNode
  readonly materials: WorldMaterials
  readonly quality: Readonly<QualitySettings>
  /** Current streaming radius in chunks (the tier's, minus any rings given up under pressure). */
  readonly radius: number
  readonly loadedChunks: number
  readonly thinInstances: number
  /** Chunks still waiting for their 2 m or 8 m ground. */
  readonly pendingDetail: number
  /** Streams around the camera's position in the county frame. Call every frame. */
  update(cameraPos: { readonly x: number; readonly z: number }, nowMs?: number): void
  /** Loads everything around (x, z) at full detail at once (for a loading screen). */
  prime(x: number, z: number): void
  /** Switches tier: new radius, prop density and detail bands (reloads every chunk). */
  setTier(tier: QualityTier): void
  dispose(): void
}

interface LoadedChunk {
  cx: number
  cz: number
  scope: Scope
  parts: ChunkPart[]
  distanceParts: ChunkPart[]
  terrain: TerrainChunk | null
  casters: AbstractMesh[]
  castersOn: boolean
  instances: number
}

export const MIN_RADIUS = 2
export const RESTORE_AFTER_MS = 60000
/** How many chunk rings past the world's edge are still drawn (ground and trees). */
export const OUTSIDE_RINGS = 2
const SHADOW_SLACK = 32
const HALF_CHUNKS = CHUNKS_PER_SIDE / 2

function chunksWithin(radius: number): number {
  const reach = Math.ceil(radius)
  let count = 0
  for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) if (Math.hypot(dx, dz) <= radius) count++
  return count
}

/** Most chunks the streamer may hold at `radius` (everything within the unload ring, plus a little slack). */
export function maxLoadedFor(radius: number): number {
  return chunksWithin(radius + 1) + 4
}

/** Distance from (x, z) to chunk (cx, cz)'s square, 0 inside it. */
export function chunkDistance(x: number, z: number, chunkX: number, chunkZ: number): number {
  const x0 = chunkX * CHUNK_SIZE
  const z0 = chunkZ * CHUNK_SIZE
  const dx = x < x0 ? x0 - x : x > x0 + CHUNK_SIZE ? x - x0 - CHUNK_SIZE : 0
  const dz = z < z0 ? z0 - z : z > z0 + CHUNK_SIZE ? z - z0 - CHUNK_SIZE : 0
  return Math.sqrt(dx * dx + dz * dz)
}

function insideWorld(chunkX: number, chunkZ: number): boolean {
  return chunkX >= -HALF_CHUNKS && chunkX < HALF_CHUNKS && chunkZ >= -HALF_CHUNKS && chunkZ < HALF_CHUNKS
}

function nearWorld(chunkX: number, chunkZ: number): boolean {
  return chunkX >= -HALF_CHUNKS - OUTSIDE_RINGS && chunkX < HALF_CHUNKS + OUTSIDE_RINGS && chunkZ >= -HALF_CHUNKS - OUTSIDE_RINGS && chunkZ < HALF_CHUNKS + OUTSIDE_RINGS
}

/**
 * Creates the streamed county under `parent`. `layers` are extra chunk layers (site scenery and the like) built after the
 * terrain, roads and props; the renderer takes ownership of them.
 */
export function createWorldRenderer(
  scene: Scene,
  parent: TransformNode,
  terrain: Terrain,
  guard: MemoryGuard | null,
  tier: QualityTier,
  layers: readonly ChunkLayer[] = [],
  options: WorldRendererOptions = {},
): WorldRenderer {
  const clock = options.clock ?? (() => performance.now())
  const budgetMs = options.budgetMs ?? 3
  const atmosphere = options.atmosphere ?? null
  let quality = qualitySettings(tier)
  const scope = new Scope('trucksim-world')
  const root = scope.track(new TransformNode('trucksim-world', scene))
  root.parent = parent
  const atlas = scope.track(createSignAtlas(scene))
  const materials = scope.track(createWorldMaterials(scene, atlas))
  const terrainLayer = scope.track(new TerrainChunks(scene, terrain, materials.terrain, clock))
  const roadLayer = new Roads(scene, terrain, materials.road)
  const propLayer = scope.track(new Props(scene, terrain, { foliage: materials.foliage, sign: materials.sign }, atlas, quality))
  const allLayers: ChunkLayer[] = [terrainLayer, roadLayer, propLayer, ...layers]
  const outsideLayers: ChunkLayer[] = [terrainLayer, propLayer]
  let totalInstances = 0
  let cameraX = 0
  let cameraZ = 0
  let okSince = clock()
  let disposed = false

  function shadowRange(): number {
    return atmosphere && quality.shadows !== 'off' ? quality.shadowDistance : 0
  }

  function setCasters(chunk: LoadedChunk, on: boolean): void {
    if (chunk.castersOn === on || !atmosphere) return
    chunk.castersOn = on
    for (const mesh of chunk.casters) {
      if (on) atmosphere.addCaster(mesh)
      else atmosphere.removeCaster(mesh)
    }
  }

  function load(chunkX: number, chunkZ: number): LoadedChunk {
    const chunkScope = scope.child(`chunk ${chunkX},${chunkZ}`)
    const chunk: LoadedChunk = { cx: chunkX, cz: chunkZ, scope: chunkScope, parts: [], distanceParts: [], terrain: null, casters: [], castersOn: false, instances: 0 }
    if (!nearWorld(chunkX, chunkZ)) return chunk
    const node = chunkScope.track(new TransformNode(`trucksim-chunk-${chunkX}-${chunkZ}`, scene))
    node.parent = root
    node.position.set(chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE)
    node.freezeWorldMatrix()
    const distance = chunkDistance(cameraX, cameraZ, chunkX, chunkZ)
    const ctx: ChunkContext = {
      scene,
      parent: root,
      root: node,
      terrain,
      quality,
      cx: chunkX,
      cz: chunkZ,
      x0: chunkX * CHUNK_SIZE,
      z0: chunkZ * CHUNK_SIZE,
      size: CHUNK_SIZE,
      distance,
      addShadowCaster(mesh) {
        if (chunk.casters.includes(mesh)) return
        chunk.casters.push(mesh)
        if (chunk.castersOn) atmosphere?.addCaster(mesh)
      },
      countInstances(count) {
        chunk.instances += count
        totalInstances += count
      },
    }
    const chunkLayers = insideWorld(chunkX, chunkZ) ? allLayers : outsideLayers
    for (const layer of chunkLayers) {
      let part: ChunkPart | null = null
      try {
        part = layer.build(chunkX, chunkZ, ctx)
      } catch (error) {
        console.error(`World layer ${layer.name ?? 'unnamed'} failed on chunk ${chunkX},${chunkZ}`, error)
      }
      if (!part) continue
      chunkScope.track(part)
      chunk.parts.push(part)
      if (typeof part.setDistance === 'function') chunk.distanceParts.push(part)
      if (part instanceof TerrainChunk) chunk.terrain = part
    }
    const range = shadowRange()
    if (range > 0 && distance < range) setCasters(chunk, true)
    return chunk
  }

  function unload(chunk: LoadedChunk): void {
    setCasters(chunk, false)
    totalInstances -= chunk.instances
    chunk.instances = 0
    chunk.casters.length = 0
    chunk.scope.dispose()
  }

  const streamer = new ChunkStreamer<LoadedChunk>({
    chunkSize: CHUNK_SIZE,
    radius: quality.streamRadius,
    load,
    unload,
    budgetMs: Math.max(1, budgetMs - 1),
    maxLoaded: maxLoadedFor(quality.streamRadius),
    clock,
  })

  function applyFogRange(): void {
    atmosphere?.setFogRange((streamer.radius - 0.5) * CHUNK_SIZE)
  }
  applyFogRange()

  const visitChunk = (chunk: LoadedChunk) => {
    const distance = chunkDistance(cameraX, cameraZ, chunk.cx, chunk.cz)
    const parts = chunk.distanceParts
    for (let index = 0; index < parts.length; index++) (parts[index].setDistance as (value: number) => void)(distance)
    const range = shadowRange()
    if (range <= 0 || chunk.casters.length === 0) return
    const on = chunk.castersOn ? distance < range + SHADOW_SLACK : distance < range
    if (on !== chunk.castersOn) setCasters(chunk, on)
  }

  function shrink(): void {
    const next = Math.max(MIN_RADIUS, streamer.radius - 1)
    if (next === streamer.radius) return
    streamer.setRadius(next)
    applyFogRange()
  }

  const stopPressure = guard?.onPressure((level) => {
    if (disposed) return
    if (level === 'warn' || level === 'critical') shrink()
    else okSince = clock()
  }) ?? null
  const stopChunkGauge = guard?.registerGauge('world chunks', () => streamer.loaded) ?? null
  let stopInstanceGauge = guard?.registerGauge('world thin instances', () => totalInstances, quality.instanceBudget) ?? null

  function update(cameraPos: { readonly x: number; readonly z: number }, nowMs?: number): void {
    if (disposed) return
    const now = nowMs ?? clock()
    cameraX = cameraPos.x
    cameraZ = cameraPos.z
    streamer.update(cameraX, cameraZ, now)
    streamer.forEach(visitChunk)
    const left = Math.max(0.5, budgetMs - (clock() - now))
    for (let index = 0; index < allLayers.length; index++) allLayers[index].update?.(left)
    const pressure = guard ? guard.pressure : 'ok'
    if (pressure !== 'ok') okSince = now
    else if (streamer.radius < quality.streamRadius && now - okSince >= RESTORE_AFTER_MS) {
      streamer.setRadius(streamer.radius + 1)
      okSince = now
      applyFogRange()
    }
  }

  return {
    root,
    materials,
    get quality() {
      return quality
    },
    get radius() {
      return streamer.radius
    },
    get loadedChunks() {
      return streamer.loaded
    },
    get thinInstances() {
      return totalInstances
    },
    get pendingDetail() {
      return terrainLayer.queued
    },
    update,
    prime(x, z) {
      if (disposed) return
      cameraX = x
      cameraZ = z
      streamer.update(x, z, Number.POSITIVE_INFINITY)
      streamer.forEach(visitChunk)
      streamer.forEach((chunk) => {
        if (chunk.terrain) terrainLayer.completeNow(chunk.terrain)
      })
    },
    setTier(next) {
      if (disposed || next === quality.tier) return
      quality = qualitySettings(next)
      propLayer.setQuality(quality)
      streamer.clear()
      streamer.setRadius(quality.streamRadius)
      streamer.setMaxLoaded(maxLoadedFor(quality.streamRadius))
      stopInstanceGauge?.()
      stopInstanceGauge = guard?.registerGauge('world thin instances', () => totalInstances, quality.instanceBudget) ?? null
      okSince = clock()
      applyFogRange()
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopPressure?.()
      stopChunkGauge?.()
      stopInstanceGauge?.()
      streamer.clear()
      for (const layer of layers) {
        try {
          layer.dispose?.()
        } catch (error) {
          console.error(`World layer ${layer.name ?? 'unnamed'} failed to dispose`, error)
        }
      }
      scope.dispose()
    },
  }
}
