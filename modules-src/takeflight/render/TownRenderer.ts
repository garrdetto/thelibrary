/**
 * Draws one place from `shared/Towns.ts`: a thin-instanced unit box per building kind with a colour per instance (plaster and
 * brick houses, shop fronts, concrete offices, glass towers, metal warehouses), gabled roofs on houses, window grids on offices
 * and towers that light up at night, and the streets as ribbons draped a little above the ground. Houses, shops and streets are
 * only drawn within `DETAIL_RANGE` of the camera; offices, towers and warehouses stay as the skyline. Matte everywhere except a
 * faint sheen on tower glass (gloss rule). Parented to the world root (floating origin).
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { Building, BuildingKind, Place } from '../shared/Towns'
import { AIRPORTS } from '../shared/Airports'
import { WATER_LEVEL, terrainHeight } from '../shared/Terrain'

const DETAIL_RANGE = 7000
const STREET_STEP = 12
const STREET_LIFT = 0.55
const KINDS: BuildingKind[] = ['house', 'shop', 'office', 'tower', 'warehouse']
const DETAIL_KINDS = new Set<BuildingKind>(['house', 'shop'])

const PALETTE: Record<BuildingKind, [number, number, number][]> = {
  house: [[0.78, 0.74, 0.66], [0.62, 0.36, 0.28], [0.85, 0.83, 0.78], [0.55, 0.58, 0.56], [0.72, 0.62, 0.48]],
  shop: [[0.7, 0.66, 0.58], [0.5, 0.32, 0.26], [0.62, 0.64, 0.66], [0.78, 0.72, 0.6]],
  office: [[0.58, 0.6, 0.62], [0.68, 0.66, 0.6], [0.45, 0.48, 0.52]],
  tower: [[0.32, 0.4, 0.48], [0.42, 0.48, 0.52], [0.26, 0.3, 0.34], [0.5, 0.54, 0.56]],
  warehouse: [[0.6, 0.62, 0.62], [0.46, 0.5, 0.54], [0.66, 0.6, 0.5], [0.4, 0.44, 0.42]],
}

function windowTexture(scene: Scene, name: string, cols: number, rows: number): DynamicTexture {
  const texture = new DynamicTexture(name, { width: 256, height: 512 }, scene, true)
  const g = texture.getContext()
  g.fillStyle = '#000'
  g.fillRect(0, 0, 256, 512)
  let seed = cols * 31 + rows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      const lit = (seed >>> 16) % 100
      if (lit < 45) continue
      const warm = lit > 85 ? '#ffd9a0' : lit > 60 ? '#fff1d0' : '#d8e6ff'
      g.fillStyle = warm
      g.fillRect(c * (256 / cols) + 4, r * (512 / rows) + 5, 256 / cols - 8, 512 / rows - 10)
    }
  }
  texture.update(true)
  texture.wrapU = Texture.WRAP_ADDRESSMODE
  texture.wrapV = Texture.WRAP_ADDRESSMODE
  return texture
}

function matte(name: string, scene: Scene): PBRMaterial {
  const material = new PBRMaterial(name, scene)
  material.albedoColor = new Color3(1, 1, 1)
  material.metallic = 0
  material.roughness = 1
  material.metallicF0Factor = 0
  material.environmentIntensity = 0.55
  material.maxSimultaneousLights = 2
  return material
}

function gableRoof(scene: Scene): Mesh {
  const positions = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 0.5, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 0.5, 0.5]
  const indices = [0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4]
  const mesh = new Mesh('takeflight-roof', scene)
  const data = new VertexData()
  data.positions = positions
  data.indices = indices
  const normals: number[] = []
  VertexData.ComputeNormals(positions, indices, normals)
  data.normals = normals
  data.applyToMesh(mesh, false)
  return mesh
}

export class TownRenderer {
  readonly root: TransformNode
  private readonly meshes: Mesh[] = []
  private readonly detail: Mesh[] = []
  private readonly materials: PBRMaterial[] = []
  private readonly textures: DynamicTexture[] = []
  private readonly lit: PBRMaterial[] = []
  private detailShown = true

  constructor(private readonly scene: Scene, readonly place: Place, parent: TransformNode) {
    this.root = new TransformNode(`takeflight-town-${place.spec.id}`, scene)
    this.root.parent = parent
    const byKind = new Map<BuildingKind, Building[]>()
    for (const b of place.buildings) {
      const list = byKind.get(b.kind)
      if (list) list.push(b)
      else byKind.set(b.kind, [b])
    }
    for (const kind of KINDS) {
      const list = byKind.get(kind)
      if (!list || list.length === 0) continue
      const material = this.track(matte(`takeflight-${kind}`, scene))
      if (kind === 'tower' || kind === 'office') {
        const texture = windowTexture(scene, `takeflight-windows-${kind}`, kind === 'tower' ? 6 : 5, kind === 'tower' ? 24 : 10)
        this.textures.push(texture)
        material.emissiveTexture = texture
        material.emissiveColor = new Color3(0, 0, 0)
        if (kind === 'tower') {
          material.roughness = 0.55
          material.metallicF0Factor = 0.15
        }
        this.lit.push(material)
      }
      const box = CreateBox(`takeflight-${kind}s-${place.spec.id}`, { size: 1, wrap: true }, scene)
      box.material = material
      const matrices = new Float32Array(list.length * 16)
      const colors = new Float32Array(list.length * 4)
      const palette = PALETTE[kind]
      list.forEach((b, i) => {
        this.writeMatrix(matrices, i, b, b.width, b.height, b.depth, b.base + b.height / 2)
        const c = palette[Math.floor(b.shade * palette.length) % palette.length]
        const tint = 0.9 + b.shade * 0.2
        colors.set([c[0] * tint, c[1] * tint, c[2] * tint, 1], i * 4)
      })
      this.finish(box, matrices, colors, DETAIL_KINDS.has(kind))
      if (kind === 'house') {
        const roofMaterial = this.track(matte('takeflight-roofs', scene))
        const roof = gableRoof(scene)
        roof.name = `takeflight-roofs-${place.spec.id}`
        roof.material = roofMaterial
        const roofMatrices = new Float32Array(list.length * 16)
        const roofColors = new Float32Array(list.length * 4)
        list.forEach((b, i) => {
          this.writeMatrix(roofMatrices, i, b, b.width + 0.6, Math.min(4, b.width * 0.45), b.depth + 0.6, b.base + b.height)
          const dark = b.shade > 0.5
          roofColors.set(dark ? [0.28, 0.2, 0.17, 1] : [0.33, 0.34, 0.36, 1], i * 4)
        })
        this.finish(roof, roofMatrices, roofColors, true)
      }
    }
    this.buildStreets()
  }

  private track(material: PBRMaterial): PBRMaterial {
    this.materials.push(material)
    return material
  }

  private writeMatrix(out: Float32Array, i: number, b: Building, sx: number, sy: number, sz: number, y: number): void {
    const h = (b.yaw * Math.PI) / 180
    const ux = Math.sin(h)
    const uz = -Math.cos(h)
    const o = i * 16
    out[o] = ux * sx
    out[o + 1] = 0
    out[o + 2] = uz * sx
    out[o + 3] = 0
    out[o + 4] = 0
    out[o + 5] = sy
    out[o + 6] = 0
    out[o + 7] = 0
    out[o + 8] = -uz * sz
    out[o + 9] = 0
    out[o + 10] = ux * sz
    out[o + 11] = 0
    out[o + 12] = b.x
    out[o + 13] = y
    out[o + 14] = b.z
    out[o + 15] = 1
  }

  private finish(mesh: Mesh, matrices: Float32Array, colors: Float32Array, detail: boolean): void {
    mesh.parent = this.root
    mesh.isPickable = false
    mesh.receiveShadows = true
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, true)
    mesh.thinInstanceSetBuffer('color', colors, 4, true)
    mesh.thinInstanceRefreshBoundingInfo(false)
    mesh.freezeWorldMatrix()
    this.meshes.push(mesh)
    if (detail) this.detail.push(mesh)
  }

  private buildStreets(): void {
    const positions: number[] = []
    const indices: number[] = []
    const onAirport = (x: number, z: number) => AIRPORTS.some((a) => Math.abs(x - a.x) < a.halfX + 60 && Math.abs(z - a.z) < a.halfZ + 60)
    const r = this.place.spec.radius
    for (const street of this.place.streets) {
      const length = Math.hypot(street.bx - street.ax, street.bz - street.az)
      const dx = (street.bx - street.ax) / length
      const dz = (street.bz - street.az) / length
      const half = street.width / 2
      let previous: number | null = null
      for (let a = 0; a <= length; a += STREET_STEP) {
        const x = street.ax + dx * a
        const z = street.az + dz * a
        const fromCentre = Math.hypot(x - this.place.spec.x, z - this.place.spec.z) / r
        const ground = terrainHeight(x, z)
        if (fromCentre > 0.95 || ground < WATER_LEVEL + 1 || onAirport(x, z)) {
          previous = null
          continue
        }
        const base = positions.length / 3
        const y = ground + STREET_LIFT
        positions.push(x + dz * half, y, z - dx * half, x - dz * half, y, z + dx * half)
        if (previous !== null) indices.push(previous, previous + 1, base, previous + 1, base + 1, base)
        previous = base
      }
    }
    if (indices.length === 0) return
    const mesh = new Mesh(`takeflight-streets-${this.place.spec.id}`, this.scene)
    const data = new VertexData()
    data.positions = positions
    data.indices = indices
    const normals: number[] = []
    VertexData.ComputeNormals(positions, indices, normals)
    data.normals = normals
    data.applyToMesh(mesh, false)
    const material = this.track(matte('takeflight-street', this.scene))
    material.albedoColor = new Color3(0.17, 0.175, 0.18)
    material.backFaceCulling = false
    mesh.material = material
    mesh.parent = this.root
    mesh.isPickable = false
    mesh.receiveShadows = true
    mesh.freezeWorldMatrix()
    this.meshes.push(mesh)
    this.detail.push(mesh)
  }

  get buildingMeshes(): readonly Mesh[] {
    return this.meshes
  }

  /** Per frame: hides small detail far away and lights the windows by `night` (0 day, 1 dark). */
  update(eyeX: number, eyeZ: number, night: number): void {
    const dx = eyeX - this.place.spec.x
    const dz = eyeZ - this.place.spec.z
    const near = Math.sqrt(dx * dx + dz * dz) < DETAIL_RANGE + this.place.spec.radius
    if (near !== this.detailShown) {
      this.detailShown = near
      for (const mesh of this.detail) mesh.setEnabled(near)
    }
    const glow = Math.max(0, (night - 0.25) / 0.75) * 1.6
    for (const material of this.lit) material.emissiveColor.set(glow, glow * 0.95, glow * 0.85)
  }

  dispose(): void {
    this.root.dispose(false, false)
    for (const material of this.materials) material.dispose()
    for (const texture of this.textures) texture.dispose()
  }
}
