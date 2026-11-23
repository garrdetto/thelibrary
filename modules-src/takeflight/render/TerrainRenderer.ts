/**
 * The region's terrain as a quadtree of tiles around the camera. Each frame the tree is walked from 16 km roots; a tile splits
 * while the camera is within `terrainSplit` times its size and stops at `minTile`. Every tile is a 33 × 33 grid with a skirt that
 * hides cracks against coarser neighbours, coloured per vertex (farmland patchwork, woods, rock, snow, shore) under one shared
 * matte material with a tiling detail texture. Tile data is built in `terrain.worker.ts` (synchronously while loading, and where
 * workers are unavailable); until a tile is ready its nearest built ancestor stands in. Vertices geomorph toward their parent's
 * grid before the hand-over (`TerrainMorph.ts`), so LOD changes do not pop. Finest tiles also carry thin-instanced trees. Unused tiles are kept in a small cache and disposed
 * oldest first. Heights come from `shared/Terrain`, so the ground the wheels roll on is the ground you see.
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { hash2 } from '../sim/SimMath'
import { REGION_HALF, WATER_LEVEL, WORLD_SEED, fieldShade, forestDensity, terrainHeight } from '../shared/Terrain'
import { MORPH_ATTRIBUTE, TILE_INDICES, buildTileData } from './TerrainTile'
import type { Rgb, TileData } from './TerrainTile'
import { townWeight } from '../shared/Towns'
import type { FlightQuality } from './Quality'
import { TerrainMorphPlugin } from './TerrainMorph'
import type { TileRequest } from './terrain.worker'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

const ROOT_SIZE = 16384

interface PendingTile {
  key: number
  x0: number
  z0: number
  size: number
}

const KEY_OFFSET = 262144

/** A tile's numeric key: its corner (whole metres within ±262 km) and size (a power of two). */
export function tileKey(x0: number, z0: number, size: number): number {
  return ((x0 + KEY_OFFSET) * 524288 + (z0 + KEY_OFFSET)) * 32 + Math.round(Math.log2(size))
}

const largestFirst = (a: PendingTile, b: PendingTile) => b.size - a.size
const CACHE_LIMIT = 420
const MAX_INFLIGHT = 8
const MAX_READY = 64
const TREE_CELL = 22
const MAX_TREES = 420

interface Tile {
  key: number
  x0: number
  z0: number
  size: number
  mesh: Mesh
  trees: Mesh | null
  lastUsed: number
  minY: number
  maxY: number
}

function detailTexture(scene: Scene): DynamicTexture {
  const size = 256
  const texture = new DynamicTexture('takeflight-ground-detail', { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE)
  const context = texture.getContext()
  const image = context.getImageData(0, 0, size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = (hash2(x, y, 11) / 4294967296) * 0.5 + (hash2(x >> 2, y >> 2, 12) / 4294967296) * 0.3 + (hash2(x >> 4, y >> 4, 13) / 4294967296) * 0.2
      const v = Math.round(196 + (n - 0.5) * 70)
      const at = (y * size + x) * 4
      image.data[at] = v
      image.data[at + 1] = v
      image.data[at + 2] = v
      image.data[at + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  texture.update(true)
  texture.wrapU = Texture.WRAP_ADDRESSMODE
  texture.wrapV = Texture.WRAP_ADDRESSMODE
  texture.anisotropicFilteringLevel = 8
  return texture
}

function buildTreeMesh(scene: Scene, material: PBRMaterial): Mesh {
  const crown = CreateCylinder('takeflight-tree-crown', { height: 1, diameterTop: 0, diameterBottom: 1, tessellation: 6 }, scene)
  crown.position.y = 0.62
  crown.scaling.set(0.42, 0.85, 0.42)
  crown.bakeCurrentTransformIntoVertices()
  const trunk = CreateCylinder('takeflight-tree-trunk', { height: 0.25, diameter: 0.07, tessellation: 4 }, scene)
  trunk.position.y = 0.12
  trunk.bakeCurrentTransformIntoVertices()
  const colours = (mesh: Mesh, rgb: Rgb) => {
    const count = mesh.getTotalVertices()
    const data = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      data[i * 4] = rgb[0]
      data[i * 4 + 1] = rgb[1]
      data[i * 4 + 2] = rgb[2]
      data[i * 4 + 3] = 1
    }
    mesh.setVerticesData('color', data, false, 4)
  }
  colours(crown, [0.07, 0.15, 0.05])
  colours(trunk, [0.16, 0.11, 0.07])
  const tree = Mesh.MergeMeshes([crown, trunk], true, true) as Mesh
  tree.name = 'takeflight-tree'
  tree.material = material
  tree.isPickable = false
  tree.setEnabled(false)
  return tree
}

export interface TerrainStats {
  tiles: number
  visible: number
  built: number
  trees: number
}

export class TerrainRenderer {
  readonly material: PBRMaterial
  private readonly treeMaterial: PBRMaterial
  private readonly treeTemplate: Mesh
  private readonly detail: DynamicTexture | null
  private readonly tiles = new Map<number, Tile>()
  private visible = new Set<Tile>()
  private readonly wanted: Tile[] = []
  private readonly pending: PendingTile[] = []
  private readonly pendingPool: PendingTile[] = []
  private showing = new Set<Tile>()
  private readonly morph: TerrainMorphPlugin
  private readonly eyeScene = new Vector3()
  private worker: Worker | null = null
  private readonly inflight = new Set<number>()
  private readonly ready = new Map<number, TileData>()
  private frame = 0
  private builtThisFrame = 0
  private treeCount = 0
  private quality: FlightQuality

  constructor(private readonly scene: Scene, quality: FlightQuality, private readonly parent: TransformNode | null = null) {
    this.quality = quality
    this.detail = typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined' ? detailTexture(scene) : null
    const material = new PBRMaterial('takeflight-ground', scene)
    material.albedoColor = new Color3(1, 1, 1)
    material.albedoTexture = this.detail
    material.metallic = 0
    material.roughness = 1
    material.metallicF0Factor = 0
    material.environmentIntensity = 0.55
    material.maxSimultaneousLights = 2
    this.material = material
    this.morph = new TerrainMorphPlugin(material)
    this.morph.split = quality.terrainSplit
    material.onError = (_effect, errors) => {
      console.warn('Take Flight: terrain morphing unavailable', errors)
      this.morph.disable()
    }
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' })
        this.worker.onmessage = (event: MessageEvent<{ key: number; data: TileData }>) => {
          this.inflight.delete(event.data.key)
          if (this.ready.size < MAX_READY) this.ready.set(event.data.key, event.data.data)
        }
        this.worker.onerror = () => {
          this.worker?.terminate()
          this.worker = null
          this.inflight.clear()
        }
      } catch {
        this.worker = null
      }
    }
    const treeMaterial = new PBRMaterial('takeflight-trees', scene)
    treeMaterial.albedoColor = new Color3(1, 1, 1)
    treeMaterial.metallic = 0
    treeMaterial.roughness = 1
    treeMaterial.metallicF0Factor = 0
    treeMaterial.environmentIntensity = 0.45
    this.treeMaterial = treeMaterial
    this.treeTemplate = buildTreeMesh(scene, treeMaterial)
  }

  setQuality(quality: FlightQuality): void {
    this.quality = quality
    this.morph.split = quality.terrainSplit
    for (const tile of this.tiles.values()) this.disposeTile(tile)
    this.tiles.clear()
    this.visible.clear()
  }

  get stats(): TerrainStats {
    return { tiles: this.tiles.size, visible: this.visible.size, built: this.builtThisFrame, trees: this.treeCount }
  }

  /** Height of the drawn surface (the same function the sim uses). */
  heightAt(x: number, z: number): number {
    return terrainHeight(x, z)
  }

  /**
   * Selects and shows tiles for a camera at (cx, cy, cz). With `budgetMs` of Infinity every needed tile is built now (loading
   * screen); otherwise building stops when the budget is used and coarser ancestors fill in.
   */
  update(cx: number, cy: number, cz: number, budgetMs = this.quality.buildBudgetMs): void {
    this.frame++
    this.builtThisFrame = 0
    this.wanted.length = 0
    this.pending.length = 0
    const groundY = terrainHeight(cx, cz)
    const height = Math.max(0, cy - groundY)
    const roots = Math.ceil((REGION_HALF * 2) / ROOT_SIZE)
    const origin = -roots * ROOT_SIZE * 0.5
    for (let i = 0; i < roots; i++) {
      for (let j = 0; j < roots; j++) this.select(origin + i * ROOT_SIZE, origin + j * ROOT_SIZE, ROOT_SIZE, cx, cz, height)
    }
    const start = performance.now()
    this.pending.sort(largestFirst)
    const show = this.showing
    show.clear()
    const parent = this.parent?.position
    this.morph.eye = this.eyeScene.set(cx + (parent ? parent.x : 0), cy, cz + (parent ? parent.z : 0))
    const loading = budgetMs === Infinity
    for (const want of this.pending) {
      let tile = this.tiles.get(want.key)
      if (!tile) {
        const data = this.ready.get(want.key)
        if (data) {
          this.ready.delete(want.key)
          tile = this.buildTile(want.key, want.x0, want.z0, want.size, data)
          this.builtThisFrame++
        } else if (this.worker && !loading) {
          if (!this.inflight.has(want.key) && this.inflight.size < MAX_INFLIGHT) {
            this.inflight.add(want.key)
            const request: TileRequest = { key: want.key, x0: want.x0, z0: want.z0, size: want.size }
            this.worker.postMessage(request)
          }
        } else if (performance.now() - start < budgetMs) {
          tile = this.buildTile(want.key, want.x0, want.z0, want.size)
          this.builtThisFrame++
        }
      }
      if (tile) {
        show.add(tile)
        continue
      }
      let size = want.size * 2
      while (size <= ROOT_SIZE) {
        const ax = Math.floor((want.x0 - origin) / size) * size + origin
        const az = Math.floor((want.z0 - origin) / size) * size + origin
        const ancestor = this.tiles.get(tileKey(ax, az, size))
        if (ancestor) {
          show.add(ancestor)
          break
        }
        size *= 2
      }
    }
    for (const tile of this.visible) {
      if (show.has(tile)) continue
      tile.mesh.setEnabled(false)
      tile.trees?.setEnabled(false)
    }
    this.treeCount = 0
    for (const tile of show) {
      tile.lastUsed = this.frame
      if (!tile.mesh.isEnabled()) tile.mesh.setEnabled(true)
      if (tile.trees) {
        const dx = Math.max(0, Math.abs(cx - (tile.x0 + tile.size / 2)) - tile.size / 2)
        const dz = Math.max(0, Math.abs(cz - (tile.z0 + tile.size / 2)) - tile.size / 2)
        const near = dx * dx + dz * dz < this.quality.treeRange * this.quality.treeRange
        tile.trees.setEnabled(near)
        if (near) this.treeCount += tile.trees.thinInstanceCount
      }
    }
    this.showing = this.visible
    this.visible = show
    if (this.tiles.size > CACHE_LIMIT) this.evict()
  }

  private select(x0: number, z0: number, size: number, cx: number, cz: number, height: number): void {
    const dx = Math.max(0, Math.abs(cx - (x0 + size / 2)) - size / 2)
    const dz = Math.max(0, Math.abs(cz - (z0 + size / 2)) - size / 2)
    const flat = Math.sqrt(dx * dx + dz * dz)
    if (flat > this.quality.viewDistance) return
    const distance = Math.sqrt(flat * flat + height * height)
    if (size > this.quality.minTile && distance < size * this.quality.terrainSplit) {
      const half = size / 2
      this.select(x0, z0, half, cx, cz, height)
      this.select(x0 + half, z0, half, cx, cz, height)
      this.select(x0, z0 + half, half, cx, cz, height)
      this.select(x0 + half, z0 + half, half, cx, cz, height)
      return
    }
    const index = this.pending.length
    const want = this.pendingPool[index] ?? (this.pendingPool[index] = { key: 0, x0: 0, z0: 0, size: 0 })
    want.key = tileKey(x0, z0, size)
    want.x0 = x0
    want.z0 = z0
    want.size = size
    this.pending.push(want)
  }

  private buildTile(key: number, x0: number, z0: number, size: number, data: TileData = buildTileData(x0, z0, size)): Tile {
    const mesh = new Mesh(`takeflight-terrain-${key}`, this.scene)
    const vertexData = new VertexData()
    vertexData.positions = data.positions
    vertexData.normals = data.normals
    vertexData.colors = data.colors
    vertexData.uvs = data.uvs
    vertexData.indices = TILE_INDICES
    vertexData.applyToMesh(mesh, false)
    mesh.setVerticesData(MORPH_ATTRIBUTE, data.morph, false, 1)
    mesh.metadata = { morphSize: size }
    const minY = data.minY
    const maxY = data.maxY
    mesh.position.set(x0, 0, z0)
    mesh.parent = this.parent
    mesh.material = this.material
    mesh.isPickable = false
    mesh.receiveShadows = true
    mesh.freezeWorldMatrix()
    mesh.doNotSyncBoundingInfo = true
    const trees = size <= 512 ? this.plantTrees(key, x0, z0, size, mesh) : null
    const tile: Tile = { key, x0, z0, size, mesh, trees, lastUsed: this.frame, minY, maxY }
    this.tiles.set(key, tile)
    return tile
  }

  private plantTrees(key: number, x0: number, z0: number, size: number, parent: Mesh): Mesh | null {
    const cells = Math.floor(size / TREE_CELL)
    const matrices: number[] = []
    const density = this.quality.treeDensity
    for (let j = 0; j < cells && matrices.length < MAX_TREES * 16; j++) {
      for (let i = 0; i < cells; i++) {
        const gx = Math.floor((x0 + i * TREE_CELL) / TREE_CELL)
        const gz = Math.floor((z0 + j * TREE_CELL) / TREE_CELL)
        const r1 = hash2(gx, gz, WORLD_SEED + 71) / 4294967296
        if (r1 > density) continue
        const r2 = hash2(gx, gz, WORLD_SEED + 72) / 4294967296
        const r3 = hash2(gx, gz, WORLD_SEED + 73) / 4294967296
        const x = x0 + (i + r2) * TREE_CELL
        const z = z0 + (j + r3) * TREE_CELL
        if (townWeight(x, z) > 0.2) continue
        const forest = forestDensity(x, z)
        const hedge = fieldShade(x + 9, z) > 0.94 ? 0.5 : 0
        if (forest + hedge < 0.35 + r1 * 0.5) continue
        const h = terrainHeight(x, z)
        if (h < WATER_LEVEL + 1 || h > 1250) continue
        const scale = 9 + r2 * 9
        matrices.push(scale, 0, 0, 0, 0, scale * (0.9 + r3 * 0.4), 0, 0, 0, 0, scale, 0, x - x0, h - 0.3, z - z0, 1)
        if (matrices.length >= MAX_TREES * 16) break
      }
    }
    if (matrices.length === 0) return null
    const trees = this.treeTemplate.clone(`takeflight-trees-${key}`, null, true, false) as Mesh
    trees.makeGeometryUnique()
    trees.parent = parent
    trees.setEnabled(true)
    trees.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16, true)
    trees.isPickable = false
    trees.alwaysSelectAsActiveMesh = false
    trees.thinInstanceRefreshBoundingInfo(false)
    return trees
  }

  private evict(): void {
    const idle = [...this.tiles.values()].filter((tile) => !this.visible.has(tile)).sort((a, b) => a.lastUsed - b.lastUsed)
    let excess = this.tiles.size - CACHE_LIMIT
    for (const tile of idle) {
      if (excess <= 0) break
      this.disposeTile(tile)
      this.tiles.delete(tile.key)
      excess--
    }
  }

  private disposeTile(tile: Tile): void {
    tile.trees?.dispose()
    tile.mesh.dispose()
  }

  dispose(): void {
    for (const tile of this.tiles.values()) this.disposeTile(tile)
    this.tiles.clear()
    this.visible.clear()
    this.worker?.terminate()
    this.worker = null
    this.ready.clear()
    this.inflight.clear()
    this.treeTemplate.dispose()
    this.treeMaterial.dispose()
    this.material.dispose()
    this.detail?.dispose()
  }
}
