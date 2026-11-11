import { Constants } from '@babylonjs/core/Engines/constants'
import type { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration'
import { Material } from '@babylonjs/core/Materials/material'
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { SubMesh } from '@babylonjs/core/Meshes/subMesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'
import type * as THREE from 'three'

/**
 * Draws a three.js scene graph with Babylon (Phase 2 of docs/shorttrack/PLAN.md). The classic module keeps
 * building and animating its scene with three.js objects; every frame `sync()` mirrors what changed: transforms,
 * visibility, geometry and instance buffers (by attribute version), material values and canvas textures. Meshes
 * with a three `ShaderMaterial` are skipped; the presenter draws those (the sky) natively.
 */

type AnyMaterial = THREE.Material & Partial<THREE.MeshPhysicalMaterial & THREE.SpriteMaterial & THREE.PointsMaterial & { map: THREE.Texture | null }>

type Entry = {
  /** How far the geometry reaches from the object's origin, in local units; -1 when it is never skipped for size. */
  reach: number
  object: THREE.Object3D
  mesh: Mesh | null
  materials: PBRMaterial[]
  geometry: THREE.BufferGeometry | null
  versions: Map<string, number>
  index: number
  matrix: Float32Array
  instanceVersion: number
  colorVersion: number
  count: number
  vertexColors: boolean
  points: boolean
  seen: number
}

type TextureEntry = { texture: BaseTexture; version: number; dynamic: DynamicTexture | null; canvas: HTMLCanvasElement | null }

const SCRATCH = new Matrix()
const tmpPos = new Vector3()
const tmpScale = new Vector3()
const tmpQuat = new Quaternion()

const flag = (m: object, key: string): boolean => (m as Record<string, unknown>)[key] === true
const isMesh = (o: THREE.Object3D): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true
const isInstanced = (o: THREE.Object3D): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh === true
const isSprite = (o: THREE.Object3D): o is THREE.Sprite => (o as THREE.Sprite).isSprite === true
const isPoints = (o: THREE.Object3D): o is THREE.Points => (o as THREE.Points).isPoints === true
const isLines = (o: THREE.Object3D): o is THREE.LineSegments => (o as THREE.LineSegments).isLineSegments === true

function readAttribute(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): Float32Array {
  const n = attr.count, out = new Float32Array(n * size)
  const isPlain = !(attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && attr.itemSize === size && (attr as THREE.BufferAttribute).array instanceof Float32Array && !(attr as THREE.BufferAttribute).normalized
  if (isPlain) return (attr as THREE.BufferAttribute).array as Float32Array
  for (let i = 0; i < n; i++) {
    out[i * size] = attr.getX(i)
    if (size > 1) out[i * size + 1] = attr.itemSize > 1 ? attr.getY(i) : 0
    if (size > 2) out[i * size + 2] = attr.itemSize > 2 ? attr.getZ(i) : 0
    if (size > 3) out[i * size + 3] = attr.itemSize > 3 ? attr.getW(i) : 1
  }
  return out
}

function indicesOf(g: THREE.BufferGeometry): Uint32Array | Uint16Array {
  if (g.index) {
    const a = g.index.array
    return a instanceof Uint16Array || a instanceof Uint32Array ? a : Uint32Array.from(a as ArrayLike<number>)
  }
  const n = g.attributes.position.count, out = new Uint32Array(n)
  for (let i = 0; i < n; i++) out[i] = i
  return out
}

function reachOf(g: THREE.BufferGeometry): number {
  if (!g.attributes.position) return -1
  if (!g.boundingSphere) g.computeBoundingSphere()
  const s = g.boundingSphere
  return s && Number.isFinite(s.radius) ? s.radius + s.center.length() : -1
}

const plainColor = (c: THREE.Color | undefined, k = 1): Color3 => (c ? new Color3(c.r * k, c.g * k, c.b * k) : new Color3(1, 1, 1))

export type BridgeHooks = {
  /** After a material's structural settings were applied (tier-dependent extras go here). */
  material?: (mat: PBRMaterial, m: THREE.Material) => void
  /** Image processing for every mirrored material (fixed, so the pre-pass renderer's per-pass toggling of the
   * scene's configuration does not mark them dirty). */
  imageProcessing?: ImageProcessingConfiguration
  /** After an instanced mesh's first instance upload. */
  instanced?: (mesh: Mesh, o: THREE.InstancedMesh, materials: PBRMaterial[]) => void
}

export class ThreeBridge {
  private entries = new Map<THREE.Object3D, Entry>()
  private materialCache = new Map<string, PBRMaterial>()
  private textures = new Map<THREE.Texture, TextureEntry>()
  private frame = 0
  readonly skipped = new Set<string>()
  /** Meshes that cast shadows this frame (the presenter hands them to its shadow generator). */
  readonly casters = new Set<Mesh>()
  /** Where the main camera is, and the smallest reach-to-distance ratio still drawn (0 draws everything). */
  readonly viewer = new Vector3()
  detail = 0

  constructor(private scene: Scene, private environment: () => { intensity: number; scale: number }, private hooks: BridgeHooks = {}) {}

  /** Re-applies every material's structural settings (for example after a quality change). */
  refreshMaterials(): void {
    this.applied = new WeakMap()
  }

  /** Mirrors `root` (its world matrices must be current). */
  sync(root: THREE.Object3D): void {
    this.frame++
    this.casters.clear()
    this.visit(root, true)
    for (const [object, entry] of this.entries) {
      if (entry.seen !== this.frame) {
        entry.mesh?.dispose(false, false)
        this.entries.delete(object)
      }
    }
  }

  /**
   * Whether a part would cover only a few pixels from the viewer: its reach over its distance is under `detail`.
   * A car is some thirty parts, and trim, lenses and wheel pieces of the cars far down the track cost a draw each.
   */
  private tooSmall(o: THREE.Object3D, reach: number): boolean {
    if (this.detail <= 0) return false
    const e = o.matrixWorld.elements, v = this.viewer
    const scale = Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10])
    const dx = e[12] - v.x, dy = e[13] - v.y, dz = e[14] - v.z
    return reach * reach * scale < this.detail * this.detail * (dx * dx + dy * dy + dz * dz)
  }

  private visit(o: THREE.Object3D, parentVisible: boolean): void {
    const visible = parentVisible && o.visible
    if (isMesh(o) || isSprite(o) || isPoints(o) || isLines(o)) {
      if (visible || this.entries.has(o)) this.mirror(o, visible)
    }
    for (const child of o.children) this.visit(child, visible)
  }

  private mirror(o: THREE.Object3D, visible: boolean): void {
    let entry = this.entries.get(o)
    if (!entry) {
      entry = this.create(o)
      this.entries.set(o, entry)
    }
    entry.seen = this.frame
    const mesh = entry.mesh
    if (!mesh) return
    mesh.isVisible = visible
    if (!visible) return
    if (entry.reach >= 0 && this.tooSmall(o, entry.reach)) {
      mesh.isVisible = false
      return
    }
    this.updateTransform(o, entry, mesh)
    if (entry.geometry) this.updateGeometry(entry, mesh)
    if (isInstanced(o)) this.updateInstances(o, entry, mesh)
    if (entry.points) this.updatePoints(o as THREE.Points, entry, mesh)
    const mats = Array.isArray((o as THREE.Mesh).material) ? ((o as THREE.Mesh).material as THREE.Material[]) : [(o as THREE.Mesh).material as THREE.Material]
    mats.forEach((m, i) => entry.materials[i] && this.updateMaterial(m as AnyMaterial, entry.materials[i], entry))
    if ((o as THREE.Mesh).castShadow && !entry.points) this.casters.add(mesh)
    mesh.receiveShadows = !!(o as THREE.Mesh).receiveShadow
  }

  private create(o: THREE.Object3D): Entry {
    const entry: Entry = { reach: -1, object: o, mesh: null, materials: [], geometry: null, versions: new Map(), index: -1, matrix: new Float32Array(16), instanceVersion: -1, colorVersion: -1, count: -1, vertexColors: false, points: false, seen: this.frame }
    const raw = (o as THREE.Mesh).material
    const mats = (Array.isArray(raw) ? raw : [raw]) as AnyMaterial[]
    if (mats.some((m) => flag(m, 'isShaderMaterial'))) {
      this.skipped.add(o.name || o.type)
      return entry
    }
    const mesh = new Mesh(o.name || o.type, this.scene)
    mesh.rotationQuaternion = new Quaternion()
    entry.mesh = mesh
    if (isSprite(o)) {
      this.buildQuad(mesh, (o as THREE.Sprite).center)
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL
    } else if (isLines(o)) {
      entry.geometry = null
      this.buildLines(mesh, (o as THREE.LineSegments).geometry)
    } else if (isPoints(o)) {
      entry.points = true
      this.buildPointShape(mesh)
      mesh.alwaysSelectAsActiveMesh = true
    } else {
      entry.geometry = (o as THREE.Mesh).geometry
      entry.vertexColors = mats.some((m) => m.vertexColors)
      this.buildGeometry(entry, mesh, mats.length)
      if (o.frustumCulled && !isInstanced(o)) entry.reach = reachOf(entry.geometry)
    }
    if (!o.frustumCulled || isInstanced(o)) mesh.alwaysSelectAsActiveMesh = true
    entry.materials = mats.map((m) => this.material(m, o))
    if (entry.materials.length > 1) {
      const multi = new MultiMaterial(`${mesh.name}-multi`, this.scene)
      multi.subMaterials.push(...entry.materials)
      mesh.material = multi
    } else mesh.material = entry.materials[0] ?? null
    if (o.renderOrder) mesh.alphaIndex = o.renderOrder
    mesh.renderingGroupId = 1
    return entry
  }

  private buildQuad(mesh: Mesh, center: THREE.Vector2): void {
    const cx = center.x - 0.5, cy = center.y - 0.5
    const data = new VertexData()
    data.positions = [-0.5 - cx, -0.5 - cy, 0, 0.5 - cx, -0.5 - cy, 0, 0.5 - cx, 0.5 - cy, 0, -0.5 - cx, 0.5 - cy, 0]
    data.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]
    data.uvs = [0, 0, 1, 0, 1, 1, 0, 1]
    data.indices = [0, 1, 2, 0, 2, 3]
    data.applyToMesh(mesh)
  }

  /** Line segments become thin quads facing up and sideways (WebGPU has no wide lines). */
  private buildLines(mesh: Mesh, g: THREE.BufferGeometry): void {
    const p = readAttribute(g.attributes.position, 3), idx = indicesOf(g), w = 0.006, positions: number[] = [], indices: number[] = []
    for (let i = 0; i + 1 < idx.length; i += 2) {
      const a = idx[i] * 3, b = idx[i + 1] * 3
      for (const [ox, oy, oz] of [[0, w, 0], [w, 0, 0], [0, 0, w]]) {
        const base = positions.length / 3
        positions.push(p[a] - ox, p[a + 1] - oy, p[a + 2] - oz, p[a] + ox, p[a + 1] + oy, p[a + 2] + oz, p[b] + ox, p[b + 1] + oy, p[b + 2] + oz, p[b] - ox, p[b + 1] - oy, p[b + 2] - oz)
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
      }
    }
    const data = new VertexData()
    data.positions = positions
    data.indices = indices
    const normals: number[] = []
    VertexData.ComputeNormals(positions, indices, normals)
    data.normals = normals
    data.applyToMesh(mesh)
  }

  private buildPointShape(mesh: Mesh): void {
    const s = 0.5, data = new VertexData()
    data.positions = [s, 0, 0, -s, 0, 0, 0, s, 0, 0, -s, 0, 0, 0, s, 0, 0, -s]
    data.indices = [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5]
    data.normals = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]
    data.applyToMesh(mesh)
  }

  private buildGeometry(entry: Entry, mesh: Mesh, materialCount: number): void {
    const g = entry.geometry!
    const a = g.attributes
    if (!a.position) return
    const data = new VertexData()
    data.positions = readAttribute(a.position, 3)
    data.indices = indicesOf(g)
    if (a.normal) data.normals = readAttribute(a.normal, 3)
    else {
      const normals: number[] = []
      VertexData.ComputeNormals(data.positions, data.indices, normals)
      data.normals = normals
    }
    if (a.uv) data.uvs = readAttribute(a.uv, 2)
    if (entry.vertexColors && a.color) data.colors = readAttribute(a.color, 4)
    data.applyToMesh(mesh, true)
    for (const key of ['position', 'normal', 'uv', 'color']) if (a[key]) entry.versions.set(key, (a[key] as THREE.BufferAttribute).version ?? 0)
    entry.index = g.index ? g.index.version : 0
    if (materialCount > 1 && g.groups.length) {
      mesh.subMeshes = []
      const total = mesh.getTotalVertices()
      for (const group of g.groups) new SubMesh(group.materialIndex ?? 0, 0, total, group.start, Math.min(group.count, data.indices.length - group.start), mesh)
    }
    const range = g.drawRange
    if (range && range.count !== Infinity && mesh.subMeshes.length === 1) {
      mesh.subMeshes[0].indexStart = range.start
      mesh.subMeshes[0].indexCount = Math.min(range.count, data.indices.length - range.start)
    }
  }

  private updateGeometry(entry: Entry, mesh: Mesh): void {
    const g = entry.geometry!
    const a = g.attributes
    if (g !== (entry.object as THREE.Mesh).geometry) {
      entry.geometry = (entry.object as THREE.Mesh).geometry
      entry.versions.clear()
      this.buildGeometry(entry, mesh, entry.materials.length)
      if (entry.reach >= 0) entry.reach = reachOf(entry.geometry)
      return
    }
    const kinds: [string, string, number][] = [['position', VertexBuffer.PositionKind, 3], ['normal', VertexBuffer.NormalKind, 3], ['uv', VertexBuffer.UVKind, 2], ['color', VertexBuffer.ColorKind, 4]]
    for (const [key, kind, size] of kinds) {
      const attr = a[key]
      if (!attr || (key === 'color' && !entry.vertexColors)) continue
      const v = (attr as THREE.BufferAttribute).version ?? 0
      if (entry.versions.get(key) === v) continue
      entry.versions.set(key, v)
      if (mesh.isVerticesDataPresent(kind) && mesh.getTotalVertices() === attr.count) mesh.updateVerticesData(kind, readAttribute(attr, size), false, false)
      else mesh.setVerticesData(kind, readAttribute(attr, size), true, size)
    }
    if (g.index && g.index.version !== entry.index) {
      entry.index = g.index.version
      mesh.setIndices(indicesOf(g), mesh.getTotalVertices(), true)
    }
  }

  private updateTransform(o: THREE.Object3D, entry: Entry, mesh: Mesh): void {
    const e = o.matrixWorld.elements
    let same = true
    for (let i = 0; i < 16; i++) if (entry.matrix[i] !== e[i]) {
      same = false
      break
    }
    if (same) return
    entry.matrix.set(e)
    Matrix.FromArrayToRef(e, 0, SCRATCH)
    SCRATCH.decompose(tmpScale, tmpQuat, tmpPos)
    if (isSprite(o)) {
      mesh.position.copyFrom(tmpPos)
      mesh.scaling.set(tmpScale.x, tmpScale.y, 1)
      return
    }
    mesh.position.copyFrom(tmpPos)
    mesh.rotationQuaternion!.copyFrom(tmpQuat)
    mesh.scaling.copyFrom(tmpScale)
  }

  private updateInstances(o: THREE.InstancedMesh, entry: Entry, mesh: Mesh): void {
    const matrices = o.instanceMatrix
    if (matrices.version !== entry.instanceVersion || o.count !== entry.count) {
      const array = matrices.array as Float32Array
      const first = entry.count === -1 || entry.instanceVersion === -1
      if (first) mesh.thinInstanceSetBuffer('matrix', array, 16, false)
      else mesh.thinInstanceBufferUpdated('matrix')
      entry.instanceVersion = matrices.version
      entry.count = o.count
      mesh.thinInstanceCount = o.count
      mesh.thinInstanceRefreshBoundingInfo(false)
      if (first) this.hooks.instanced?.(mesh, o, entry.materials)
    }
    const colors = o.instanceColor
    if (colors && colors.version !== entry.colorVersion) {
      entry.colorVersion = colors.version
      const rgb = colors.array as Float32Array, n = rgb.length / 3, rgba = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) {
        rgba[i * 4] = rgb[i * 3]
        rgba[i * 4 + 1] = rgb[i * 3 + 1]
        rgba[i * 4 + 2] = rgb[i * 3 + 2]
        rgba[i * 4 + 3] = 1
      }
      mesh.thinInstanceSetBuffer('color', rgba, 4, false)
    }
  }

  /** Points become small diamonds (WebGPU has no point size): one thin instance per lit point. */
  private updatePoints(o: THREE.Points, entry: Entry, mesh: Mesh): void {
    const pos = o.geometry.attributes.position, col = o.geometry.attributes.color
    const version = (pos as THREE.BufferAttribute).version
    if (version === entry.instanceVersion) return
    entry.instanceVersion = version
    const size = ((o.material as THREE.PointsMaterial).size ?? 0.2) * 0.6
    const p = pos.array as Float32Array, c = col ? (col.array as Float32Array) : null
    const n = pos.count, matrices = new Float32Array(n * 16), colors = new Float32Array(n * 4)
    let live = 0
    for (let i = 0; i < n; i++) {
      const r = c ? c[i * 3] : 1, g = c ? c[i * 3 + 1] : 1, b = c ? c[i * 3 + 2] : 1
      if (r + g + b <= 0.001) continue
      const m = live * 16
      matrices[m] = size
      matrices[m + 5] = size
      matrices[m + 10] = size
      matrices[m + 12] = p[i * 3]
      matrices[m + 13] = p[i * 3 + 1]
      matrices[m + 14] = p[i * 3 + 2]
      matrices[m + 15] = 1
      colors[live * 4] = r
      colors[live * 4 + 1] = g
      colors[live * 4 + 2] = b
      colors[live * 4 + 3] = 1
      live++
    }
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, false)
    mesh.thinInstanceSetBuffer('color', colors, 4, false)
    mesh.thinInstanceCount = live
  }

  private material(m: AnyMaterial, o: THREE.Object3D): PBRMaterial {
    const key = `${m.uuid}:${isInstanced(o) ? 'i' : ''}${isPoints(o) ? 'p' : ''}`
    const cached = this.materialCache.get(key)
    if (cached) return cached
    const mat = new PBRMaterial(m.name || m.type, this.scene)
    if (this.hooks.imageProcessing) mat.imageProcessingConfiguration = this.hooks.imageProcessing
    mat.metallic = 0
    mat.roughness = 1
    mat.sideOrientation = Material.CounterClockWiseSideOrientation
    mat.useRadianceOverAlpha = false
    mat.useSpecularOverAlpha = false
    mat.enableSpecularAntiAliasing = true
    const basic = ['isMeshBasicMaterial', 'isSpriteMaterial', 'isPointsMaterial', 'isLineBasicMaterial'].some((k) => flag(m, k))
    mat.unlit = !!basic
    if (isPoints(o)) mat.unlit = true
    this.materialCache.set(key, mat)
    this.updateMaterial(m, mat, null)
    return mat
  }

  private applied = new WeakMap<PBRMaterial, { version: number; transparent: boolean; maps: (BaseTexture | null)[] }>()

  /**
   * Structural settings (blending, culling, depth, texture slots) are applied when three bumps the material's
   * version or a texture slot changes; per-frame values (colours, emissive, opacity, roughness, environment) only
   * when they differ. Babylon re-validates a material's shader whenever a structural setter runs, so setting them
   * every frame would cost far more than the draw itself.
   */
  private updateMaterial(m: AnyMaterial, mat: PBRMaterial, _entry: Entry | null): void {
    const color = m.color as THREE.Color | undefined
    if (color && (mat.albedoColor.r !== color.r || mat.albedoColor.g !== color.g || mat.albedoColor.b !== color.b)) mat.albedoColor.set(color.r, color.g, color.b)
    const opacity = m.opacity ?? 1
    if (mat.alpha !== opacity) mat.alpha = opacity
    const maps = mat.unlit ? [this.texture(m.map ?? null), null, null, null, null] : [this.texture(m.map ?? null), this.texture(m.emissiveMap ?? null), this.texture(m.normalMap ?? null, true), this.texture(m.roughnessMap ?? m.metalnessMap ?? null, true), this.texture(m.aoMap ?? null, true)]
    maps.push(this.texture(m.alphaMap ?? null, true))
    if (!mat.unlit) {
      const metal = m.metalness ?? 0, rough = m.roughness ?? 1
      if (mat.metallic !== metal) mat.metallic = metal
      if (mat.roughness !== rough) mat.roughness = rough
      const e = m.emissive as THREE.Color | undefined, k = m.emissiveIntensity ?? 1
      if (e && (mat.emissiveColor.r !== e.r * k || mat.emissiveColor.g !== e.g * k || mat.emissiveColor.b !== e.b * k)) mat.emissiveColor.set(e.r * k, e.g * k, e.b * k)
      const env = m.envMap ? (m.envMapIntensity ?? 1) * this.environment().scale : this.environment().intensity
      if (mat.environmentIntensity !== env) mat.environmentIntensity = env
      const cc = m.clearcoat ?? 0, ccr = m.clearcoatRoughness ?? 0
      if (mat.clearCoat.isEnabled !== cc > 0) mat.clearCoat.isEnabled = cc > 0
      if (cc > 0 && mat.clearCoat.intensity !== cc) mat.clearCoat.intensity = cc
      if (cc > 0 && mat.clearCoat.roughness !== ccr) mat.clearCoat.roughness = ccr
    }
    const transparentNow = m.transparent && opacity < 1
    const last = this.applied.get(mat)
    if (last && last.version === m.version && last.transparent === transparentNow && last.maps.every((t, i) => t === maps[i])) return
    this.applied.set(mat, { version: m.version, transparent: transparentNow, maps })
    mat.albedoTexture = maps[0]
    if (!mat.unlit) {
      mat.emissiveTexture = maps[1]
      mat.bumpTexture = maps[2]
      mat.invertNormalMapX = false
      mat.invertNormalMapY = false
      mat.metallicTexture = maps[3]
      mat.useRoughnessFromMetallicTextureGreen = !!maps[3]
      mat.useMetallnessFromMetallicTextureBlue = !!(maps[3] && m.metalnessMap)
      mat.useRoughnessFromMetallicTextureAlpha = false
      mat.ambientTexture = maps[4]
    }
    const alphaMapTex = maps[5]
    mat.opacityTexture = alphaMapTex
    if (alphaMapTex) (alphaMapTex as Texture).getAlphaFromRGB = true
    const additive = m.blending === 2
    const alphaMap = !!(m.map && m.transparent)
    if (additive) {
      mat.alphaMode = Constants.ALPHA_ADD
      mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
    } else if (m.transparent && (transparentNow || alphaMap || alphaMapTex)) mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
    else if ((m.alphaTest ?? 0) > 0) {
      mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST
      mat.alphaCutOff = m.alphaTest ?? 0.5
    } else mat.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE
    if (mat.albedoTexture) mat.albedoTexture.hasAlpha = alphaMap || (m.alphaTest ?? 0) > 0
    mat.useAlphaFromAlbedoTexture = !!mat.albedoTexture && (alphaMap || (m.alphaTest ?? 0) > 0)
    mat.disableDepthWrite = m.depthWrite === false
    mat.depthFunction = m.depthTest === false ? Constants.ALWAYS : 0
    mat.backFaceCulling = m.side === 0 || m.side === 1
    mat.sideOrientation = m.side === 1 ? Material.ClockWiseSideOrientation : Material.CounterClockWiseSideOrientation
    mat.zOffset = m.polygonOffset ? m.polygonOffsetFactor : 0
    mat.zOffsetUnits = m.polygonOffset ? m.polygonOffsetUnits : 0
    mat.fogEnabled = m.fog !== false
    mat.wireframe = !!(m as THREE.MeshStandardMaterial).wireframe
    this.hooks.material?.(mat, m)
  }


  private texture(t: THREE.Texture | null, linear = false): BaseTexture | null {
    if (!t) return null
    let entry = this.textures.get(t)
    const image = t.image as (HTMLCanvasElement | HTMLImageElement | ImageBitmap | { data: ArrayBufferView; width: number; height: number }) | null
    if (!image) return null
    if (!entry) {
      const made = this.makeTexture(t, image, linear)
      if (!made) return null
      entry = made
      this.textures.set(t, made)
    }
    if (entry.version !== t.version) {
      entry.version = t.version
      if (entry.dynamic && entry.canvas) {
        if (!(image instanceof HTMLCanvasElement)) {
          const ctx = entry.canvas.getContext('2d')!
          ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height)
          ctx.drawImage(image as CanvasImageSource, 0, 0)
        }
        entry.dynamic.update(t.flipY, false, true)
      }
    }
    const tex = entry.texture as Texture
    tex.uScale = t.repeat.x
    tex.vScale = t.repeat.y
    tex.uOffset = t.offset.x
    tex.vOffset = t.offset.y
    tex.wrapU = t.wrapS === 1000 ? Texture.WRAP_ADDRESSMODE : t.wrapS === 1002 ? Texture.MIRROR_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE
    tex.wrapV = t.wrapT === 1000 ? Texture.WRAP_ADDRESSMODE : t.wrapT === 1002 ? Texture.MIRROR_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE
    return entry.texture
  }

  private makeTexture(t: THREE.Texture, image: NonNullable<unknown>, linear: boolean): TextureEntry | null {
    const srgb = t.colorSpace === 'srgb' && !linear
    if ('data' in (image as object) && (image as { data: unknown }).data) {
      const img = image as { data: ArrayBufferView; width: number; height: number }
      let data = img.data as Uint8Array | Float32Array
      const format = (t as THREE.DataTexture).format
      if (format === 1022 && data instanceof Uint8Array) {
        const rgba = new Uint8Array(img.width * img.height * 4)
        for (let i = 0; i < img.width * img.height; i++) {
          rgba[i * 4] = data[i * 3]
          rgba[i * 4 + 1] = data[i * 3 + 1]
          rgba[i * 4 + 2] = data[i * 3 + 2]
          rgba[i * 4 + 3] = 255
        }
        data = rgba
      }
      const type = data instanceof Float32Array ? Constants.TEXTURETYPE_FLOAT : Constants.TEXTURETYPE_UNSIGNED_BYTE
      const raw = new RawTexture(data, img.width, img.height, Constants.TEXTUREFORMAT_RGBA, this.scene, t.generateMipmaps, t.flipY, Texture.TRILINEAR_SAMPLINGMODE, type)
      raw.gammaSpace = srgb
      return { texture: raw, version: t.version, dynamic: null, canvas: null }
    }
    const source = image as HTMLCanvasElement | HTMLImageElement | ImageBitmap
    const width = (source as HTMLImageElement).naturalWidth || source.width, height = (source as HTMLImageElement).naturalHeight || source.height
    if (!width || !height) return null
    const canvas = source instanceof HTMLCanvasElement ? source : document.createElement('canvas')
    if (canvas !== source) {
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(source as CanvasImageSource, 0, 0)
    }
    const dynamic = new DynamicTexture(t.name || 'canvas', canvas, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE)
    dynamic.gammaSpace = srgb
    dynamic.anisotropicFilteringLevel = Math.min(8, t.anisotropy || 4)
    dynamic.update(t.flipY, false, true)
    return { texture: dynamic, version: t.version, dynamic, canvas }
  }

  dispose(): void {
    for (const e of this.entries.values()) e.mesh?.dispose()
    for (const m of this.materialCache.values()) m.dispose()
    for (const t of this.textures.values()) t.texture.dispose()
    this.entries.clear()
    this.materialCache.clear()
    this.textures.clear()
  }
}

export const toColor3 = plainColor
