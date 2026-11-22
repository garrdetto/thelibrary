/**
 * Procedural, vertex-coloured prop models in a few hundred triangles each, built once and shared by every chunk: a broadleaf
 * shade tree (tapered trunk with a fork and a crown of five lumpy leaf masses, lit with normals pointing out from the crown's
 * centre so the canopy shades as one soft volume, darker underneath and inside), its 90-triangle distant version, an eastern
 * pine (five drooping tiers) and its distant version, and a wooden utility pole with crossarm and insulators. Colours are linear
 * light, roughly matched to late-summer foliage; per-instance tints vary them. Renderer-free arrays plus a helper that turns
 * one into a hidden template mesh.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'
import { linearFromHex } from './AtmosphereSky'
import type { Rgb } from './AtmosphereSky'
import { pushFacing } from './WorldRendererBuffers'

export interface ModelArrays {
  positions: number[]
  normals: number[]
  colors: number[]
  indices: number[]
}

const BARK = linearFromHex(0x56473a)
const BARK_DARK = linearFromHex(0x3e332a)
const LEAF = linearFromHex(0x52832f)
const LEAF_LIGHT = linearFromHex(0x7aa443)
const LEAF_DARK = linearFromHex(0x325823)
const NEEDLE = linearFromHex(0x2c4c2b)
const NEEDLE_LIGHT = linearFromHex(0x416a37)
const POLE_WOOD = linearFromHex(0x6a5947)
const CROSSARM = linearFromHex(0x5b4c3d)
const INSULATOR = linearFromHex(0x8d978b)

function noise3(x: number, y: number, z: number, salt: number): number {
  let h = Math.imul(Math.round(x * 97) ^ 0x27d4eb2d, 0x85ebca6b) ^ Math.imul(Math.round(y * 89) + salt * 131, 0xc2b2ae35) ^ Math.imul(Math.round(z * 83), 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function blendColor(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

let unitSphere: { positions: number[]; faces: number[] } | null = null

/** A unit icosphere subdivided once (42 vertices, 80 faces). */
function icosphere(): { positions: number[]; faces: number[] } {
  if (unitSphere) return unitSphere
  const t = (1 + Math.sqrt(5)) / 2
  const positions: number[] = []
  const add = (x: number, y: number, z: number) => {
    const length = Math.hypot(x, y, z)
    positions.push(x / length, y / length, z / length)
    return positions.length / 3 - 1
  }
  for (const [x, y, z] of [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]) add(x, y, z)
  const base = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1]
  const midpoints = new Map<string, number>()
  const midpoint = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`
    const found = midpoints.get(key)
    if (found !== undefined) return found
    const index = add((positions[a * 3] + positions[b * 3]) / 2, (positions[a * 3 + 1] + positions[b * 3 + 1]) / 2, (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2)
    midpoints.set(key, index)
    return index
  }
  const faces: number[] = []
  for (let i = 0; i < base.length; i += 3) {
    const a = base[i]
    const b = base[i + 1]
    const c = base[i + 2]
    const ab = midpoint(a, b)
    const bc = midpoint(b, c)
    const ca = midpoint(c, a)
    faces.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca)
  }
  unitSphere = { positions, faces }
  return unitSphere
}

class ModelBuilder implements ModelArrays {
  positions: number[] = []
  normals: number[] = []
  colors: number[] = []
  indices: number[] = []

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, color: Rgb): number {
    const length = Math.hypot(nx, ny, nz) || 1
    this.positions.push(x, y, z)
    this.normals.push(nx / length, ny / length, nz / length)
    this.colors.push(color[0], color[1], color[2], 1)
    return this.positions.length / 3 - 1
  }

  /** A tapered tube from (x0, y0, z0) to (x1, y1, z1), radii r0 → r1, `sides` sides, optionally capped on top. */
  tube(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r0: number, r1: number, sides: number, bottom: Rgb, top: Rgb, cap = false): void {
    const ax = x1 - x0
    const ay = y1 - y0
    const az = z1 - z0
    const length = Math.hypot(ax, ay, az)
    const dx = ax / length
    const dy = ay / length
    const dz = az / length
    let ux = 0
    let uy = 0
    let uz = 1
    if (Math.abs(dz) > 0.9) {
      ux = 1
      uz = 0
    }
    let px = dy * uz - dz * uy
    let py = dz * ux - dx * uz
    let pz = dx * uy - dy * ux
    const pLength = Math.hypot(px, py, pz)
    px /= pLength
    py /= pLength
    pz /= pLength
    const qx = dy * pz - dz * py
    const qy = dz * px - dx * pz
    const qz = dx * py - dy * px
    const ring = (cx: number, cy: number, cz: number, radius: number, color: Rgb) => {
      const first = this.positions.length / 3
      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2
        const ox = Math.cos(angle) * px + Math.sin(angle) * qx
        const oy = Math.cos(angle) * py + Math.sin(angle) * qy
        const oz = Math.cos(angle) * pz + Math.sin(angle) * qz
        this.vertex(cx + ox * radius, cy + oy * radius, cz + oz * radius, ox, oy, oz, color)
      }
      return first
    }
    const lower = ring(x0, y0, z0, r0, bottom)
    const upper = ring(x1, y1, z1, r1, top)
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides
      const mx = (this.positions[(lower + i) * 3] + this.positions[(upper + j) * 3]) / 2 - (x0 + x1) / 2
      const my = (this.positions[(lower + i) * 3 + 1] + this.positions[(upper + j) * 3 + 1]) / 2 - (y0 + y1) / 2
      const mz = (this.positions[(lower + i) * 3 + 2] + this.positions[(upper + j) * 3 + 2]) / 2 - (z0 + z1) / 2
      pushFacing(this.indices, this.positions, lower + i, lower + j, upper + i, mx, my, mz)
      pushFacing(this.indices, this.positions, lower + j, upper + j, upper + i, mx, my, mz)
    }
    if (cap) {
      const center = this.vertex(x1, y1, z1, dx, dy, dz, top)
      for (let i = 0; i < sides; i++) pushFacing(this.indices, this.positions, upper + i, upper + ((i + 1) % sides), center, dx, dy, dz)
    }
  }

  /** A lumpy leaf mass: an icosphere at (cx, cy, cz) with radii (rx, ry, rz), lit as part of a crown centred at `crown`. */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, crown: [number, number, number], salt: number, detailed: boolean): void {
    const sphere = icosphere()
    const first = this.positions.length / 3
    const count = detailed ? sphere.positions.length / 3 : 12
    for (let i = 0; i < count; i++) {
      const ux = sphere.positions[i * 3]
      const uy = sphere.positions[i * 3 + 1]
      const uz = sphere.positions[i * 3 + 2]
      const bump = 0.82 + noise3(ux, uy, uz, salt) * 0.36
      const x = cx + ux * rx * bump
      const y = cy + uy * ry * bump
      const z = cz + uz * rz * bump
      const ox = x - crown[0]
      const oy = (y - crown[1]) * 0.9
      const oz = z - crown[2]
      const outward = Math.hypot(ox, oy, oz) || 1
      const nx = ux * 0.28 + (ox / outward) * 0.72
      const ny = uy * 0.28 + (oy / outward) * 0.72 + 0.12
      const nz = uz * 0.28 + (oz / outward) * 0.72
      const height = uy * 0.5 + 0.5
      let color = blendColor(LEAF_DARK, LEAF, Math.min(1, 0.25 + height * 0.95))
      color = blendColor(color, LEAF_LIGHT, Math.max(0, uy) * 0.45 * (0.6 + noise3(ux, uy, uz, salt + 7) * 0.8))
      const depth = Math.min(1, outward / 3.4)
      const occlusion = 0.62 + 0.38 * depth
      this.vertex(x, y, z, nx, ny, nz, [color[0] * occlusion, color[1] * occlusion, color[2] * occlusion])
    }
    const faces = detailed ? sphere.faces : ICOSAHEDRON_FACES
    for (let i = 0; i < faces.length; i += 3) {
      const a = first + faces[i]
      const b = first + faces[i + 1]
      const c = first + faces[i + 2]
      const mx = (this.positions[a * 3] + this.positions[b * 3] + this.positions[c * 3]) / 3 - cx
      const my = (this.positions[a * 3 + 1] + this.positions[b * 3 + 1] + this.positions[c * 3 + 1]) / 3 - cy
      const mz = (this.positions[a * 3 + 2] + this.positions[b * 3 + 2] + this.positions[c * 3 + 2]) / 3 - cz
      pushFacing(this.indices, this.positions, a, b, c, mx, my, mz)
    }
  }

  /** A drooping cone tier of a pine: base ring at `y` (radius `radius`, tips sagging by `droop`), apex `height` above. */
  tier(y: number, radius: number, height: number, droop: number, sides: number, salt: number): void {
    const apex = this.vertex(0, y + height, 0, 0, 1, 0, NEEDLE_LIGHT)
    const first = this.positions.length / 3
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2 + salt * 0.7
      const reach = radius * (0.88 + noise3(i, salt, 3, salt) * 0.24)
      const x = Math.cos(angle) * reach
      const z = Math.sin(angle) * reach
      const slope = radius / height
      this.vertex(x, y - droop, z, Math.cos(angle), slope * 0.9 + 0.25, Math.sin(angle), blendColor(NEEDLE, NEEDLE_LIGHT, noise3(i, salt, 5, salt) * 0.5))
    }
    const under = this.vertex(0, y + height * 0.12, 0, 0, -1, 0, blendColor(NEEDLE, BARK_DARK, 0.4))
    for (let i = 0; i < sides; i++) {
      const a = first + i
      const b = first + ((i + 1) % sides)
      const angle = ((i + 0.5) / sides) * Math.PI * 2 + salt * 0.7
      pushFacing(this.indices, this.positions, a, b, apex, Math.cos(angle), 0.6, Math.sin(angle))
      pushFacing(this.indices, this.positions, a, b, under, 0, -1, 0)
    }
  }

  /** An axis-aligned box centred at (cx, cy, cz). */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: Rgb): void {
    const center = [cx, cy, cz]
    const half = [sx / 2, sy / 2, sz / 2]
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3
      const w = (axis + 2) % 3
      for (const sign of [1, -1]) {
        const corners: number[] = []
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const point = [center[0], center[1], center[2]]
          point[axis] += sign * half[axis]
          point[u] += a * half[u]
          point[w] += b * half[w]
          const normal = [0, 0, 0]
          normal[axis] = sign
          corners.push(this.vertex(point[0], point[1], point[2], normal[0], normal[1], normal[2], color))
        }
        const nx = axis === 0 ? sign : 0
        const ny = axis === 1 ? sign : 0
        const nz = axis === 2 ? sign : 0
        pushFacing(this.indices, this.positions, corners[0], corners[1], corners[2], nx, ny, nz)
        pushFacing(this.indices, this.positions, corners[0], corners[2], corners[3], nx, ny, nz)
      }
    }
  }
}

const ICOSAHEDRON_FACES = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1]

/** Broadleaf tree about 12 m tall at scale 1 (origin at the trunk's foot). */
export function broadleafModel(detailed: boolean): ModelArrays {
  const model = new ModelBuilder()
  const crown: [number, number, number] = [0, 7.6, 0]
  if (detailed) {
    model.tube(0, -0.2, 0, 0.05, 4.4, 0.02, 0.34, 0.21, 7, BARK_DARK, BARK)
    model.tube(0.05, 3.6, 0.02, 1.1, 6.4, 0.35, 0.17, 0.08, 5, BARK, BARK)
    model.tube(0.05, 3.8, 0.02, -0.9, 6.6, -0.45, 0.16, 0.08, 5, BARK, BARK)
    model.blob(0, 7.9, 0, 3.1, 2.6, 3.1, crown, 1, true)
    model.blob(1.75, 6.75, 0.7, 2.3, 2.0, 2.3, crown, 2, true)
    model.blob(-1.6, 6.95, -0.75, 2.4, 2.1, 2.4, crown, 3, true)
    model.blob(0.35, 6.55, -1.85, 2.1, 1.8, 2.1, crown, 4, true)
    model.blob(-0.45, 9.4, 0.5, 2.1, 1.7, 2.1, crown, 5, true)
  } else {
    model.tube(0, -0.2, 0, 0.05, 5.0, 0.02, 0.32, 0.2, 4, BARK_DARK, BARK)
    model.blob(0, 7.5, 0, 3.7, 3.2, 3.7, crown, 1, true)
  }
  return model
}

/** Eastern pine about 13 m tall at scale 1. */
export function pineModel(detailed: boolean): ModelArrays {
  const model = new ModelBuilder()
  if (detailed) {
    model.tube(0, -0.2, 0, 0, 11.5, 0, 0.24, 0.07, 6, BARK_DARK, BARK)
    const tiers = 5
    for (let i = 0; i < tiers; i++) {
      const y = 1.8 + i * 1.85
      model.tier(y, 2.6 - i * 0.44, 3.3 - i * 0.18, 0.45 - i * 0.05, 9, i + 1)
    }
  } else {
    model.tube(0, -0.2, 0, 0, 2.2, 0, 0.22, 0.16, 4, BARK_DARK, BARK)
    model.tier(1.8, 2.5, 10.4, 0.3, 6, 1)
  }
  return model
}

/** Wooden utility pole about 10.2 m tall with a crossarm along local x (origin at its foot). */
export function poleModel(): ModelArrays {
  const model = new ModelBuilder()
  model.tube(0, -0.3, 0, 0, 10.25, 0, 0.16, 0.12, 7, POLE_WOOD, POLE_WOOD, true)
  model.box(0, 9.2, 0.16, 2.5, 0.11, 0.13, CROSSARM)
  model.tube(-0.12, 8.7, 0.16, -0.75, 9.15, 0.16, 0.035, 0.035, 4, CROSSARM, CROSSARM)
  model.tube(0.12, 8.7, 0.16, 0.75, 9.15, 0.16, 0.035, 0.035, 4, CROSSARM, CROSSARM)
  model.tube(-1.05, 9.25, 0.16, -1.05, 9.42, 0.16, 0.055, 0.045, 5, INSULATOR, INSULATOR, true)
  model.tube(1.05, 9.25, 0.16, 1.05, 9.42, 0.16, 0.055, 0.045, 5, INSULATOR, INSULATOR, true)
  model.tube(0, 10.25, 0, 0, 10.38, 0, 0.055, 0.045, 5, INSULATOR, INSULATOR, true)
  return model
}

/** Triangle count of a model (for budgets and tests). */
export function triangleCount(model: ModelArrays): number {
  return model.indices.length / 3
}

/** A hidden mesh holding `model`, used as the vertex-buffer template every chunk's thin-instance host links to. */
export function templateMesh(scene: Scene, name: string, model: ModelArrays): Mesh {
  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  data.positions = model.positions
  data.normals = model.normals
  data.colors = model.colors
  data.indices = model.indices
  data.applyToMesh(mesh, false)
  mesh.setEnabled(false)
  mesh.isPickable = false
  return mesh
}
