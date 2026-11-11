import type { Material } from '@babylonjs/core/Materials/material'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import '@babylonjs/core/Rendering/boundingBoxRenderer'
import type { EngineContext, TrunkCollider } from '../core/EngineSetup'
import type { ModelName, ModelTemplate } from '../core/ModelLibrary'
import { FloatBatch, composeInstance, crownColor, hash, writeTint } from './FoliagePlacement'
import type { GrassHole, Rgb, TreeKind } from './FoliagePlacement'
import type { FoliageLook, FoliageMaterial, FoliageShading } from './FoliageShader'
import { GrassField } from './GrassField'
import { linkGeometry } from './SharedGeometry'
import { HALF, HIGHWAY, Terrain, fbm, forestDensity, highwayCoord, lakeCoord, marshWeight, trailOffset } from './Terrain'

export const STAND_SIZE = 128
export const STANDS = Math.round((HALF * 2) / STAND_SIZE)
const SHADOW_STAND_RADIUS = 150
const FLAGS = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
const USE_OCCLUSION = FLAGS.get('occ') !== '0'
const USE_LOD = FLAGS.get('lod') !== '0'
const USE_FREEZE = FLAGS.get('freeze') !== '0'
const USE_PARENT = FLAGS.get('parent') !== '0'

const TREE_KINDS: readonly TreeKind[] = ['pine', 'hardwood', 'birch']
type Scatter = 'fern' | 'rock' | 'log' | 'cattail'
const SCATTER: readonly Scatter[] = ['fern', 'rock', 'log', 'cattail']
const SCATTER_PARTS: Record<Scatter, [ModelName, string]> = { fern: ['fern', 'fronds'], rock: ['rock', 'rock'], log: ['log', 'log'], cattail: ['cattail', 'reeds'] }
const SCATTER_CUTOFF: Record<Scatter, number> = { fern: 120, rock: 340, log: 220, cattail: 170 }
const LOD_MODEL: Record<TreeKind, ModelName> = { pine: 'pine-lo', hardwood: 'hardwood-lo', birch: 'birch-lo' }
/** Trunk and crown of a kind share one sway, so the crown stays on the trunk; only the crown's leaves shiver. */
const TREE_SWAY: Record<TreeKind, Pick<FoliageLook, 'threshold' | 'range' | 'sway' | 'speed' | 'ripple'>> = {
  pine: { threshold: 1.2, range: 15, sway: 0.26, speed: 0.9, ripple: 0.05 },
  hardwood: { threshold: 1.0, range: 11, sway: 0.2, speed: 0.8, ripple: 0.05 },
  birch: { threshold: 1.0, range: 10.5, sway: 0.3, speed: 1.0, ripple: 0.05 },
}
const WHITE: Rgb = [1, 1, 1]

interface Stand {
  node: TransformNode
  center: Vector3
  casters: Mesh[]
  meshes: Mesh[]
}

export class Foliage {
  readonly stands: Stand[] = []
  readonly colliders: TrunkCollider[] = []
  readonly grassHoles: GrassHole[] = []
  readonly grass: GrassField
  private shadowStands = new Set<Stand>()
  private shadowsStale = true
  private nearScratch = new Set<Stand>()
  private primed = false
  private readonly treeMatrices: Record<TreeKind, FloatBatch> = { pine: new FloatBatch(4096), hardwood: new FloatBatch(4096), birch: new FloatBatch(1024) }
  private readonly trunkTints: Record<TreeKind, FloatBatch> = { pine: new FloatBatch(1024), hardwood: new FloatBatch(1024), birch: new FloatBatch(256) }
  private readonly crownTints: Record<TreeKind, FloatBatch> = { pine: new FloatBatch(1024), hardwood: new FloatBatch(1024), birch: new FloatBatch(256) }
  private readonly scatterMatrices: Record<Scatter, FloatBatch> = { fern: new FloatBatch(4096), rock: new FloatBatch(256), log: new FloatBatch(256), cattail: new FloatBatch(4096) }
  private readonly scatterTints: Record<Scatter, FloatBatch> = { fern: new FloatBatch(1024), rock: new FloatBatch(16), log: new FloatBatch(16), cattail: new FloatBatch(1024) }

  constructor(private readonly ctx: EngineContext, private readonly terrain: Terrain, private readonly models: Map<ModelName, ModelTemplate>, private readonly keepClear: Vector3[], private readonly shading: FoliageShading) {
    for (let sj = 0; sj < STANDS; sj++) for (let si = 0; si < STANDS; si++) this.buildStand(si, sj)
    this.grass = new GrassField(ctx, terrain, this.models.get('grass')!.parts.get('blades')!.mesh, shading, this.grassHoles)
  }

  private clear(x: number, z: number, r: number): boolean {
    for (const c of this.keepClear) if ((c.x - x) ** 2 + (c.z - z) ** 2 < r * r) return false
    return true
  }

  private trunkMaterial(kind: TreeKind): FoliageMaterial {
    return this.shading.material(`${kind}-trunk`, { ...TREE_SWAY[kind], ambient: 0.3 })
  }

  private crownMaterial(kind: TreeKind): FoliageMaterial {
    const source = this.models.get(kind)!.parts.get('crown')!.mesh.material as StandardMaterial
    return this.shading.material(`${kind}-crown`, { ...TREE_SWAY[kind], flutter: 0.035, twoSided: true, translucency: 0.25, ambient: 0, texture: source.diffuseTexture ?? undefined })
  }

  private scatterMaterial(kind: Scatter, source: Mesh): Material {
    if (kind === 'fern') return this.shading.material('fern', { threshold: 0.04, range: 0.5, sway: 0.07, speed: 1.6, ripple: 0.3, flutter: 0.008, twoSided: true, upward: 0.3, translucency: 0.2, ambient: 0.3 })
    if (kind === 'cattail') return this.shading.material('cattail', { threshold: 0.1, range: 1.7, sway: 0.17, speed: 1.3, ripple: 0.25, flutter: 0.004, twoSided: true, upward: 0.2, translucency: 0.15, ambient: 0.3 })
    return source.material!
  }

  private buildStand(si: number, sj: number): void {
    const x0 = -HALF + si * STAND_SIZE
    const z0 = -HALF + sj * STAND_SIZE
    for (const kind of TREE_KINDS) {
      this.treeMatrices[kind].reset()
      this.trunkTints[kind].reset()
      this.crownTints[kind].reset()
    }
    for (const kind of SCATTER) {
      this.scatterMatrices[kind].reset()
      this.scatterTints[kind].reset()
    }
    const treeCell = 6.5
    for (let gz = 0; gz < STAND_SIZE / treeCell; gz++) {
      for (let gx = 0; gx < STAND_SIZE / treeCell; gx++) {
        const cx = x0 + gx * treeCell
        const cz = z0 + gz * treeCell
        const x = cx + hash(cx, cz, 1) * treeCell
        const z = cz + hash(cx, cz, 2) * treeCell
        const density = forestDensity(x, z)
        const h = this.terrain.heightAt(x, z)
        if (h < 0.9 || this.terrain.slopeAt(x, z) > 0.75 || !this.clear(x, z, 11)) continue
        if (hash(cx, cz, 3) > density * 0.92 + 0.012) continue
        const zone = fbm(x * 0.006 + 40, z * 0.006 - 13, 3, 61)
        const pick = hash(cx, cz, 4)
        const kind: TreeKind = pick < 0.12 ? 'birch' : zone + (pick - 0.5) * 0.5 > -0.05 ? 'pine' : 'hardwood'
        const scale = 0.72 + hash(cx, cz, 5) * 0.55
        const yaw = hash(cx, cz, 6) * Math.PI * 2
        const matrices = this.treeMatrices[kind]
        const at = matrices.reserve(16)
        composeInstance(matrices.data, at, x, h - 0.15, z, yaw, scale, scale * (0.9 + hash(cx, cz, 9) * 0.25), scale, (hash(cx, cz, 7) - 0.5) * 0.06, (hash(cx, cz, 8) - 0.5) * 0.06)
        const phase = hash(cx, cz, 50)
        const trunk = this.trunkTints[kind]
        const trunkAt = trunk.reserve(4)
        writeTint(trunk.data, trunkAt, WHITE, cx, cz, 31, 0.14, phase)
        const crown = this.crownTints[kind]
        const crownAt = crown.reserve(4)
        writeTint(crown.data, crownAt, crownColor(kind, cx, cz), cx, cz, 41, kind === 'pine' ? 0.16 : 0.12, phase)
        const r = (kind === 'birch' ? 0.25 : kind === 'pine' ? 0.34 : 0.42) * scale + 0.25
        this.colliders.push({ x, z, r, min: new Vector3(x - r, h - 1, z - r), max: new Vector3(x + r, h + 12, z + r) })
      }
    }
    const fineCell = 3.2
    for (let gz = 0; gz < STAND_SIZE / fineCell; gz++) {
      for (let gx = 0; gx < STAND_SIZE / fineCell; gx++) {
        const cx = x0 + gx * fineCell
        const cz = z0 + gz * fineCell
        const x = cx + hash(cx, cz, 11) * fineCell
        const z = cz + hash(cx, cz, 12) * fineCell
        const h = this.terrain.heightAt(x, z)
        const roll = hash(cx, cz, 13)
        const { s, angle } = lakeCoord(x, z)
        if (h > -0.5 && h < 0.7 && s > 0.85 && s < 1.6) {
          const marsh = marshWeight(angle)
          if (roll < 0.18 + marsh * 0.6) this.scatter('cattail', cx, cz, x, h - 0.05, z, roll * 40, 0.8 + hash(cx, cz, 14) * 0.5)
          continue
        }
        if (h < 0.9 || !this.clear(x, z, 6) || trailOffset(x, z) < 3 || highwayCoord(x, z).across < HIGHWAY.halfWidth + 3) continue
        const density = forestDensity(x, z)
        if (roll < density * 0.32) {
          this.scatter('fern', cx, cz, x, h - 0.05, z, roll * 60, 0.75 + hash(cx, cz, 15) * 0.7)
        } else if (roll > 0.993 - this.terrain.slopeAt(x, z) * 0.02) {
          const sc = 0.5 + hash(cx, cz, 16) * 1.3
          this.scatter('rock', cx, cz, x, h - 0.25 * sc, z, roll * 90, sc, sc * (0.7 + hash(cx, cz, 17) * 0.5))
          const r = 1.05 * sc
          this.colliders.push({ x, z, r, min: new Vector3(x - r, h - 1, z - r), max: new Vector3(x + r, h + 2, z + r) })
        } else if (roll > 0.985 && density > 0.5) {
          this.scatter('log', cx, cz, x, h - 0.05, z, roll * 70, 0.8 + hash(cx, cz, 18) * 0.4)
        }
      }
    }
    const node = new TransformNode(`stand_${si}_${sj}`, this.ctx.scene)
    const stand: Stand = { node, center: new Vector3(x0 + STAND_SIZE / 2, 0, z0 + STAND_SIZE / 2), casters: [], meshes: [] }
    for (const kind of TREE_KINDS) {
      if (!this.treeMatrices[kind].length) continue
      const matrices = this.treeMatrices[kind].toArray()
      this.addTree(stand, kind, 'trunk', matrices, this.trunkTints[kind].toArray(), this.trunkMaterial(kind))
      this.addTree(stand, kind, 'crown', matrices, this.crownTints[kind].toArray(), this.crownMaterial(kind))
    }
    for (const kind of SCATTER) {
      const batch = this.scatterMatrices[kind]
      if (!batch.length) continue
      const [model, part] = SCATTER_PARTS[kind]
      const source = this.models.get(model)!.parts.get(part)!.mesh
      const swaying = kind === 'fern' || kind === 'cattail'
      const mesh = this.thinMesh(stand, kind, source, batch.toArray(), swaying ? this.scatterTints[kind].toArray() : null, this.scatterMaterial(kind, source))
      if (USE_LOD) mesh.addLODLevel(SCATTER_CUTOFF[kind], null)
      if (!swaying) stand.casters.push(mesh)
    }
    this.stands.push(stand)
  }

  private scatter(kind: Scatter, cx: number, cz: number, x: number, y: number, z: number, yaw: number, scale: number, sy = scale): void {
    const matrices = this.scatterMatrices[kind]
    const at = matrices.reserve(16)
    composeInstance(matrices.data, at, x, y, z, yaw, scale, sy, scale)
    if (kind !== 'fern' && kind !== 'cattail') return
    const tints = this.scatterTints[kind]
    const tintAt = tints.reserve(4)
    writeTint(tints.data, tintAt, WHITE, cx, cz, kind === 'fern' ? 61 : 71, 0.22, hash(cx, cz, 60))
  }

  private addTree(stand: Stand, kind: TreeKind, part: string, matrices: Float32Array, tints: Float32Array, material: Material): void {
    const hi = this.thinMesh(stand, `${kind}-${part}`, this.models.get(kind)!.parts.get(part)!.mesh, matrices, tints, material)
    const lo = this.thinMesh(stand, `${kind}-${part}-lo`, this.models.get(LOD_MODEL[kind])!.parts.get(part)!.mesh, matrices, tints, material, true)
    if (USE_LOD) {
      hi.addLODLevel(115, lo)
      hi.addLODLevel(640, null)
    } else lo.setEnabled(false)
    stand.casters.push(hi)
  }

  private thinMesh(stand: Stand, name: string, source: Mesh, matrices: Float32Array, tints: Float32Array | null, material: Material, isLod = false): Mesh {
    const mesh = new Mesh(`${stand.node.name}-${name}`, this.ctx.scene)
    linkGeometry(source, mesh)
    mesh.material = material
    if (USE_PARENT) mesh.parent = stand.node
    mesh.isPickable = false
    mesh.receiveShadows = true
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, true)
    if (tints) {
      mesh.thinInstanceRegisterAttribute('instanceColor', 4)
      mesh.thinInstanceSetBuffer('instanceColor', tints, 4, true)
    }
    if (!isLod && USE_OCCLUSION) {
      mesh.occlusionType = AbstractMesh.OCCLUSION_TYPE_OPTIMISTIC
      mesh.occlusionQueryAlgorithmType = AbstractMesh.OCCLUSION_ALGORITHM_TYPE_CONSERVATIVE
      mesh.occlusionRetryCount = 2
    }
    if (USE_FREEZE) {
      mesh.freezeWorldMatrix()
      mesh.doNotSyncBoundingInfo = true
    }
    stand.meshes.push(mesh)
    this.shading.lightProbe ??= mesh
    return mesh
  }

  updateGrass(center: Vector3): void {
    if (this.primed) {
      this.grass.update(center)
      return
    }
    this.primed = true
    this.grass.prime(center)
  }

  /** Trees, rocks and logs near `focus` go to the cached shadow layer; `moving` (the hunter, animals, vehicles) to the layer redrawn as they move. */
  updateShadowCasters(focus: Vector3, moving: AbstractMesh[]): void {
    const near = this.nearScratch
    near.clear()
    for (const stand of this.stands) {
      const dx = Math.max(Math.abs(stand.center.x - focus.x) - STAND_SIZE / 2, 0)
      const dz = Math.max(Math.abs(stand.center.z - focus.z) - STAND_SIZE / 2, 0)
      if (dx * dx + dz * dz < SHADOW_STAND_RADIUS * SHADOW_STAND_RADIUS) near.add(stand)
    }
    let changed = this.shadowsStale || near.size !== this.shadowStands.size
    if (!changed) for (const s of near) if (!this.shadowStands.has(s)) changed = true
    const layers = this.ctx.shadowLayers
    if (changed) {
      this.shadowsStale = false
      this.nearScratch = this.shadowStands
      this.shadowStands = near
      const fixed: AbstractMesh[] = []
      for (const stand of near) for (const mesh of stand.casters) fixed.push(mesh)
      layers.setFixed(fixed)
    }
    layers.setMoving(moving)
  }

  forceShadowRefresh(): void {
    this.shadowsStale = true
  }

  dispose(): void {
    this.grass.dispose()
    for (const stand of this.stands) {
      for (const mesh of stand.meshes) mesh.dispose()
      stand.node.dispose()
    }
    this.stands.length = 0
    this.shadowStands.clear()
    this.nearScratch.clear()
  }
}
