import type { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import '@babylonjs/core/Rendering/boundingBoxRenderer'
import type { EngineContext, TrunkCollider } from '../core/EngineSetup'
import type { ModelName, ModelTemplate } from '../core/ModelLibrary'
import { HALF, Terrain, fbm, forestDensity, lakeCoord, marshWeight, trailOffset } from './Terrain'

export const STAND_SIZE = 128
export const STANDS = Math.round((HALF * 2) / STAND_SIZE)
export const GRASS_RADIUS = 72
export const GRASS_CAPACITY = 16000
const SHADOW_STAND_RADIUS = 150
const FLAGS = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
const USE_OCCLUSION = FLAGS.get('occ') !== '0'
const USE_LOD = FLAGS.get('lod') !== '0'
const USE_FREEZE = FLAGS.get('freeze') !== '0'
const USE_PARENT = FLAGS.get('parent') !== '0'

type TreeKind = 'pine' | 'hardwood' | 'birch'
type Scatter = 'fern' | 'rock' | 'log' | 'cattail'

interface Batch {
  matrices: number[]
  colors: number[] | null
}

interface Stand {
  node: TransformNode
  center: Vector3
  casters: Mesh[]
  meshes: Mesh[]
}

function hash(x: number, z: number, salt: number): number {
  let h = Math.imul(Math.floor(x) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.floor(z) + salt * 7919, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

const HARDWOOD_COLORS: [number, number, number][] = [
  [0.48, 0.62, 0.26], [0.42, 0.56, 0.22], [0.55, 0.64, 0.28], [1.0, 0.52, 0.14], [0.95, 0.3, 0.1], [1.0, 0.78, 0.24], [0.86, 0.42, 0.12], [0.62, 0.66, 0.24],
]
const BIRCH_COLORS: [number, number, number][] = [[0.95, 0.86, 0.3], [0.7, 0.78, 0.3], [1.0, 0.72, 0.2]]

export class Foliage {
  readonly stands: Stand[] = []
  readonly colliders: TrunkCollider[] = []
  readonly grass: Mesh
  private readonly grassMatrices = new Float32Array(GRASS_CAPACITY * 16)
  private grassCenter = new Vector3(1e9, 0, 1e9)
  private shadowStands = new Set<Stand>()
  private extraCount = -1
  private lastExtra: AbstractMesh[] = []
  private nearScratch = new Set<Stand>()
  private readonly tints = new Map<string, Material>()
  private readonly tmp = Matrix.Identity()
  private readonly q = new Quaternion()
  private readonly s = new Vector3()
  private readonly p = new Vector3()

  constructor(private readonly ctx: EngineContext, private readonly terrain: Terrain, private readonly models: Map<ModelName, ModelTemplate>, private readonly keepClear: Vector3[]) {
    for (let sj = 0; sj < STANDS; sj++) for (let si = 0; si < STANDS; si++) this.buildStand(si, sj)
    const grassTemplate = this.models.get('grass')!.parts.get('blades')!.mesh
    this.grass = new Mesh('grass-ring', ctx.scene)
    grassTemplate.geometry!.copy('grass-ring-geo').applyToMesh(this.grass)
    this.grass.material = grassTemplate.material
    this.grass.isPickable = false
    this.grass.receiveShadows = true
    this.grass.alwaysSelectAsActiveMesh = true
    this.grass.thinInstanceSetBuffer('matrix', this.grassMatrices, 16, false)
    this.grass.thinInstanceCount = 0
    ctx.registerDynamic(this.grass)
  }

  private clear(x: number, z: number, r: number): boolean {
    for (const c of this.keepClear) if ((c.x - x) ** 2 + (c.z - z) ** 2 < r * r) return false
    return true
  }

  private pushMatrix(list: number[], x: number, y: number, z: number, yaw: number, scale: number, tiltX = 0, tiltZ = 0, sy = scale): void {
    Quaternion.FromEulerAnglesToRef(tiltX, yaw, tiltZ, this.q)
    this.s.set(scale, sy, scale)
    this.p.set(x, y, z)
    Matrix.ComposeToRef(this.s, this.q, this.p, this.tmp)
    const m = this.tmp.m
    for (let i = 0; i < 16; i++) list.push(m[i])
  }

  private buildStand(si: number, sj: number): void {
    const x0 = -HALF + si * STAND_SIZE
    const z0 = -HALF + sj * STAND_SIZE
    const trunks: Record<TreeKind, Batch> = { pine: { matrices: [], colors: null }, hardwood: { matrices: [], colors: null }, birch: { matrices: [], colors: null } }
    const crowns = new Map<string, Batch>()
    const scatter: Record<Scatter, Batch> = { fern: { matrices: [], colors: null }, rock: { matrices: [], colors: null }, log: { matrices: [], colors: null }, cattail: { matrices: [], colors: null } }
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
        const tint = kind === 'hardwood' ? Math.floor(hash(cx, cz, 10) * HARDWOOD_COLORS.length) : kind === 'birch' ? Math.floor(hash(cx, cz, 10) * BIRCH_COLORS.length) : 0
        const key = `${kind}:${tint}`
        if (!crowns.has(key)) crowns.set(key, { matrices: [], colors: null })
        const before = trunks[kind].matrices.length
        this.pushMatrix(trunks[kind].matrices, x, h - 0.15, z, yaw, scale, (hash(cx, cz, 7) - 0.5) * 0.06, (hash(cx, cz, 8) - 0.5) * 0.06, scale * (0.9 + hash(cx, cz, 9) * 0.25))
        crowns.get(key)!.matrices.push(...trunks[kind].matrices.slice(before))
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
          if (roll < 0.18 + marsh * 0.6) this.pushMatrix(scatter.cattail.matrices, x, h - 0.05, z, roll * 40, 0.8 + hash(cx, cz, 14) * 0.5)
          continue
        }
        if (h < 0.9 || !this.clear(x, z, 6) || trailOffset(x, z) < 3) continue
        const density = forestDensity(x, z)
        if (roll < density * 0.32) {
          this.pushMatrix(scatter.fern.matrices, x, h - 0.05, z, roll * 60, 0.75 + hash(cx, cz, 15) * 0.7)
        } else if (roll > 0.993 - this.terrain.slopeAt(x, z) * 0.02) {
          const sc = 0.5 + hash(cx, cz, 16) * 1.3
          this.pushMatrix(scatter.rock.matrices, x, h - 0.25 * sc, z, roll * 90, sc, 0, 0, sc * (0.7 + hash(cx, cz, 17) * 0.5))
          const r = 1.05 * sc
          this.colliders.push({ x, z, r, min: new Vector3(x - r, h - 1, z - r), max: new Vector3(x + r, h + 2, z + r) })
        } else if (roll > 0.985 && density > 0.5) {
          this.pushMatrix(scatter.log.matrices, x, h - 0.05, z, roll * 70, 0.8 + hash(cx, cz, 18) * 0.4)
        }
      }
    }
    const node = new TransformNode(`stand_${si}_${sj}`, this.ctx.scene)
    const stand: Stand = { node, center: new Vector3(x0 + STAND_SIZE / 2, 0, z0 + STAND_SIZE / 2), casters: [], meshes: [] }
    const lodNames: Record<TreeKind, ModelName> = { pine: 'pine-lo', hardwood: 'hardwood-lo', birch: 'birch-lo' }
    const addTree = (name: string, kind: TreeKind, part: string, batch: Batch, tint: string | null) => {
      const hi = this.thinMesh(stand, name, kind, part, batch, tint)
      const lo = this.thinMesh(stand, `${name}-lo`, lodNames[kind], part, batch, tint, true)
      if (USE_LOD) {
        hi.addLODLevel(115, lo)
        hi.addLODLevel(640, null)
      } else lo.setEnabled(false)
      stand.casters.push(hi)
    }
    for (const kind of Object.keys(trunks) as TreeKind[]) if (trunks[kind].matrices.length) addTree(`${kind}-trunk`, kind, 'trunk', trunks[kind], null)
    for (const [key, batch] of crowns) addTree(`${key.replace(':', '-')}-crown`, key.split(':')[0] as TreeKind, 'crown', batch, key)
    const cutoffs: Record<Scatter, number> = { fern: 120, rock: 340, log: 220, cattail: 170 }
    const parts: Record<Scatter, [ModelName, string]> = { fern: ['fern', 'fronds'], rock: ['rock', 'rock'], log: ['log', 'log'], cattail: ['cattail', 'reeds'] }
    for (const kind of Object.keys(scatter) as Scatter[]) {
      const batch = scatter[kind]
      if (!batch.matrices.length) continue
      const mesh = this.thinMesh(stand, kind, parts[kind][0], parts[kind][1], batch, null)
      if (USE_LOD) mesh.addLODLevel(cutoffs[kind], null)
      if (kind === 'rock' || kind === 'log') stand.casters.push(mesh)
    }
    this.stands.push(stand)
  }

  private crownMaterial(key: string, base: Material): Material {
    const cacheKey = `${key}|${base.name}`
    const found = this.tints.get(cacheKey)
    if (found) return found
    const [kind, index] = key.split(':')
    const c = kind === 'hardwood' ? HARDWOOD_COLORS[Number(index)] : kind === 'birch' ? BIRCH_COLORS[Number(index)] : ([1, 1, 1] as [number, number, number])
    const src = base as StandardMaterial
    const mat = new StandardMaterial(`crown-${key}-${src.name}`, this.ctx.scene)
    mat.diffuseTexture = src.diffuseTexture
    mat.specularColor = src.specularColor.clone()
    mat.ambientColor = src.ambientColor.clone()
    mat.backFaceCulling = src.backFaceCulling
    mat.twoSidedLighting = src.twoSidedLighting
    mat.transparencyMode = src.transparencyMode
    mat.alphaCutOff = src.alphaCutOff
    mat.useAlphaFromDiffuseTexture = src.useAlphaFromDiffuseTexture
    mat.diffuseColor = new Color3(c[0], c[1], c[2])
    this.tints.set(cacheKey, mat)
    return mat
  }

  private thinMesh(stand: Stand, name: string, model: ModelName, part: string, batch: Batch, tint: string | null, isLod = false): Mesh {
    const source = this.models.get(model)!.parts.get(part)!.mesh
    const mesh = new Mesh(`${stand.node.name}-${name}`, this.ctx.scene)
    source.geometry!.copy(`${mesh.name}-geo`).applyToMesh(mesh)
    mesh.material = tint ? this.crownMaterial(tint, source.material!) : source.material
    if (USE_PARENT) mesh.parent = stand.node
    mesh.isPickable = false
    mesh.receiveShadows = true
    mesh.thinInstanceSetBuffer('matrix', new Float32Array(batch.matrices), 16, true)
    mesh.thinInstanceRefreshBoundingInfo(false)
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
    return mesh
  }

  updateGrass(center: Vector3): void {
    const dx = center.x - this.grassCenter.x
    const dz = center.z - this.grassCenter.z
    if (dx * dx + dz * dz < 14 * 14) return
    this.grassCenter.copyFrom(center)
    const cell = 1.05
    const r = GRASS_RADIUS
    const x0 = Math.floor((center.x - r) / cell)
    const x1 = Math.floor((center.x + r) / cell)
    const z0 = Math.floor((center.z - r) / cell)
    const z1 = Math.floor((center.z + r) / cell)
    let count = 0
    const out = this.grassMatrices
    for (let gz = z0; gz <= z1 && count < GRASS_CAPACITY; gz++) {
      for (let gx = x0; gx <= x1 && count < GRASS_CAPACITY; gx++) {
        const x = (gx + hash(gx, gz, 21)) * cell
        const z = (gz + hash(gx, gz, 22)) * cell
        const ddx = x - center.x
        const ddz = z - center.z
        const d2 = ddx * ddx + ddz * ddz
        if (d2 > r * r) continue
        const h = this.terrain.heightAt(x, z)
        if (h < 0.55) continue
        const density = forestDensity(x, z)
        const want = (0.78 - density * 0.62) * (trailOffset(x, z) < 2.4 ? 0.1 : 1) * (1 - Math.sqrt(d2) / r * 0.45)
        if (hash(gx, gz, 23) > want) continue
        const sc = 0.7 + hash(gx, gz, 24) * 0.8
        Quaternion.FromEulerAnglesToRef(0, hash(gx, gz, 25) * 6.283, 0, this.q)
        this.s.set(sc, sc * (0.8 + hash(gx, gz, 26) * 0.6), sc)
        this.p.set(x, h - 0.03, z)
        Matrix.ComposeToRef(this.s, this.q, this.p, this.tmp)
        this.tmp.copyToArray(out, count * 16)
        count++
      }
    }
    this.grass.thinInstanceCount = count
    this.grass.thinInstanceBufferUpdated('matrix')
  }

  updateShadowCasters(focus: Vector3, extra: AbstractMesh[]): void {
    const near = this.nearScratch
    near.clear()
    for (const stand of this.stands) {
      const dx = Math.max(Math.abs(stand.center.x - focus.x) - STAND_SIZE / 2, 0)
      const dz = Math.max(Math.abs(stand.center.z - focus.z) - STAND_SIZE / 2, 0)
      if (dx * dx + dz * dz < SHADOW_STAND_RADIUS * SHADOW_STAND_RADIUS) near.add(stand)
    }
    let changed = near.size !== this.shadowStands.size || extra.length !== this.extraCount
    this.extraCount = extra.length
    if (!changed) for (const s of near) if (!this.shadowStands.has(s)) changed = true
    if (!changed) for (let i = 0; i < extra.length; i++) if (this.lastExtra[i] !== extra[i]) { changed = true; break }
    const map = this.ctx.shadows.getShadowMap()!
    if (changed || !map.renderList || map.renderList.length === 0) {
      this.nearScratch = this.shadowStands
      this.shadowStands = near
      this.lastExtra = extra.slice()
      const list: AbstractMesh[] = extra.slice()
      for (const stand of near) for (const mesh of stand.casters) list.push(mesh)
      map.renderList = list
    }
  }

  forceShadowRefresh(): void {
    this.shadowStands = new Set()
    this.extraCount = -1
  }
}
