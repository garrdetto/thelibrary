/**
 * The region's terrain as a quadtree of tiles around the camera. Each frame the tree is walked from 16 km roots; a tile splits
 * while the camera is within `terrainSplit` times its size and stops at `minTile`. Every tile is a 33 × 33 grid with a skirt that
 * hides cracks against coarser neighbours, coloured per vertex (farmland patchwork, woods, rock, snow, shore) under one shared
 * matte material with a tiling detail texture. Tiles are built within a per-frame time budget; until a tile is ready its nearest
 * built ancestor stands in. Finest tiles also carry thin-instanced trees. Unused tiles are kept in a small cache and disposed
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
import type { Scene } from '@babylonjs/core/scene'
import { hash2 } from '../sim/SimMath'
import { REGION_HALF, WATER_LEVEL, WORLD_SEED, fieldShade, forestDensity, naturalHeight, terrainHeight } from '../shared/Terrain'
import type { FlightQuality } from './Quality'

const GRID = 32
const ROOT_SIZE = 16384
const CACHE_LIMIT = 420
const TREE_CELL = 22
const MAX_TREES = 420

interface Tile {
  key: string
  x0: number
  z0: number
  size: number
  mesh: Mesh
  trees: Mesh | null
  lastUsed: number
  minY: number
  maxY: number
}

type Rgb = [number, number, number]

const GRASS_A: Rgb = [0.25, 0.34, 0.12]
const GRASS_B: Rgb = [0.36, 0.40, 0.17]
const CROP: Rgb = [0.52, 0.47, 0.25]
const PLOUGH: Rgb = [0.33, 0.25, 0.17]
const FOREST: Rgb = [0.10, 0.17, 0.07]
const ROCK: Rgb = [0.38, 0.36, 0.33]
const SNOW: Rgb = [0.86, 0.88, 0.9]
const SHORE: Rgb = [0.5, 0.46, 0.34]
const AIRFIELD: Rgb = [0.27, 0.36, 0.14]

function mix(a: Rgb, b: Rgb, t: number, out: Rgb): Rgb {
  out[0] = a[0] + (b[0] - a[0]) * t
  out[1] = a[1] + (b[1] - a[1]) * t
  out[2] = a[2] + (b[2] - a[2]) * t
  return out
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

const fieldColour: Rgb = [0, 0, 0]
const colour: Rgb = [0, 0, 0]

/** Ground colour (linear) for a point with height `h` and slope `steep` (1 - normal.y). */
export function groundColour(x: number, z: number, h: number, steep: number, out: Rgb): Rgb {
  const shade = fieldShade(x, z)
  const natural = naturalHeight(x, z)
  if (shade < 0.45) mix(GRASS_A, GRASS_B, shade / 0.45, fieldColour)
  else if (shade < 0.7) mix(GRASS_B, CROP, (shade - 0.45) / 0.25, fieldColour)
  else if (shade < 0.85) mix(CROP, PLOUGH, (shade - 0.7) / 0.15, fieldColour)
  else mix(PLOUGH, GRASS_A, (shade - 0.85) / 0.15, fieldColour)
  mix(fieldColour, AIRFIELD, clamp01(Math.abs(h - natural) / 6), out)
  const forest = forestDensity(x, z)
  if (forest > 0) mix(out, FOREST, forest, out)
  const rockiness = clamp01((steep - 0.12) / 0.14) + clamp01((h - 900) / 500) * 0.6
  if (rockiness > 0) mix(out, ROCK, clamp01(rockiness), out)
  const snow = clamp01((h - 1300 - (fieldShade(x * 3, z * 3) - 0.5) * 160) / 160) * (1 - clamp01((steep - 0.3) / 0.2))
  if (snow > 0) mix(out, SNOW, snow, out)
  const shore = clamp01(1 - (h - WATER_LEVEL) / 4)
  if (shore > 0) mix(out, SHORE, shore, out)
  return out
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
  private readonly tiles = new Map<string, Tile>()
  private readonly visible = new Set<Tile>()
  private readonly wanted: Tile[] = []
  private readonly pending: { key: string; x0: number; z0: number; size: number }[] = []
  private frame = 0
  private builtThisFrame = 0
  private treeCount = 0
  private quality: FlightQuality
  private readonly heights = new Float32Array((GRID + 3) * (GRID + 3))

  constructor(private readonly scene: Scene, quality: FlightQuality) {
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
    this.pending.sort((a, b) => b.size - a.size)
    const show = new Set<Tile>()
    for (const want of this.pending) {
      let tile = this.tiles.get(want.key)
      if (!tile && performance.now() - start < budgetMs) {
        tile = this.buildTile(want.key, want.x0, want.z0, want.size)
        this.builtThisFrame++
      }
      if (tile) {
        show.add(tile)
        continue
      }
      let size = want.size * 2
      while (size <= ROOT_SIZE) {
        const ax = Math.floor((want.x0 - origin) / size) * size + origin
        const az = Math.floor((want.z0 - origin) / size) * size + origin
        const ancestor = this.tiles.get(`${ax}:${az}:${size}`)
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
    this.visible.clear()
    for (const tile of show) this.visible.add(tile)
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
    this.pending.push({ key: `${x0}:${z0}:${size}`, x0, z0, size })
  }

  private buildTile(key: string, x0: number, z0: number, size: number): Tile {
    const step = size / GRID
    const stride = GRID + 3
    const heights = this.heights
    for (let j = 0; j < stride; j++) {
      for (let i = 0; i < stride; i++) heights[j * stride + i] = terrainHeight(x0 + (i - 1) * step, z0 + (j - 1) * step)
    }
    const verts = (GRID + 1) * (GRID + 1)
    const skirt = GRID * 4
    const positions = new Float32Array((verts + skirt) * 3)
    const normals = new Float32Array((verts + skirt) * 3)
    const colors = new Float32Array((verts + skirt) * 4)
    const uvs = new Float32Array((verts + skirt) * 2)
    let minY = Infinity
    let maxY = -Infinity
    for (let j = 0; j <= GRID; j++) {
      for (let i = 0; i <= GRID; i++) {
        const index = j * (GRID + 1) + i
        const h = heights[(j + 1) * stride + i + 1]
        const hx = heights[(j + 1) * stride + i + 2] - heights[(j + 1) * stride + i]
        const hz = heights[(j + 2) * stride + i + 1] - heights[j * stride + i + 1]
        let nx = -hx
        let ny = 2 * step
        let nz = -hz
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
        nx /= length
        ny /= length
        nz /= length
        const wx = x0 + i * step
        const wz = z0 + j * step
        positions[index * 3] = i * step
        positions[index * 3 + 1] = h
        positions[index * 3 + 2] = j * step
        normals[index * 3] = nx
        normals[index * 3 + 1] = ny
        normals[index * 3 + 2] = nz
        groundColour(wx, wz, h, 1 - ny, colour)
        colors[index * 4] = colour[0]
        colors[index * 4 + 1] = colour[1]
        colors[index * 4 + 2] = colour[2]
        colors[index * 4 + 3] = 1
        uvs[index * 2] = wx / 40
        uvs[index * 2 + 1] = wz / 40
        if (h < minY) minY = h
        if (h > maxY) maxY = h
      }
    }
    const indices: number[] = []
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const a = j * (GRID + 1) + i
        const b = a + 1
        const c = a + GRID + 1
        const d = c + 1
        indices.push(a, b, c, b, d, c)
      }
    }
    const depth = Math.max(4, size * 0.02)
    const edge: number[] = []
    for (let i = 0; i < GRID; i++) edge.push(i)
    for (let j = 0; j < GRID; j++) edge.push(j * (GRID + 1) + GRID)
    for (let i = GRID; i > 0; i--) edge.push(GRID * (GRID + 1) + i)
    for (let j = GRID; j > 0; j--) edge.push(j * (GRID + 1))
    for (let k = 0; k < edge.length; k++) {
      const src = edge[k]
      const dst = verts + k
      positions[dst * 3] = positions[src * 3]
      positions[dst * 3 + 1] = positions[src * 3 + 1] - depth
      positions[dst * 3 + 2] = positions[src * 3 + 2]
      normals[dst * 3] = normals[src * 3]
      normals[dst * 3 + 1] = normals[src * 3 + 1]
      normals[dst * 3 + 2] = normals[src * 3 + 2]
      colors[dst * 4] = colors[src * 4]
      colors[dst * 4 + 1] = colors[src * 4 + 1]
      colors[dst * 4 + 2] = colors[src * 4 + 2]
      colors[dst * 4 + 3] = 1
      uvs[dst * 2] = uvs[src * 2]
      uvs[dst * 2 + 1] = uvs[src * 2 + 1]
    }
    for (let k = 0; k < edge.length; k++) {
      const a = edge[k]
      const b = edge[(k + 1) % edge.length]
      const sa = verts + k
      const sb = verts + ((k + 1) % edge.length)
      indices.push(a, b, sa, b, sb, sa, a, sa, b, b, sa, sb)
    }
    const mesh = new Mesh(`takeflight-terrain-${key}`, this.scene)
    const data = new VertexData()
    data.positions = positions
    data.normals = normals
    data.colors = colors
    data.uvs = uvs
    data.indices = indices
    data.applyToMesh(mesh, false)
    mesh.position.set(x0, 0, z0)
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

  private plantTrees(key: string, x0: number, z0: number, size: number, parent: Mesh): Mesh | null {
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
    this.treeTemplate.dispose()
    this.treeMaterial.dispose()
    this.material.dispose()
    this.detail?.dispose()
  }
}
