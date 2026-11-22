/**
 * Shared plumbing for the trailer, machine, cargo and work-zone visuals: a `Palette` that hands out materials by slot name
 * (library names, `paint:<hex>`, `matte:<hex>` and a few fixed colours) and releases every reference it took, a `MergeBatch`
 * that folds placed `VertexData` into one mesh per slot, and a handful of flat-shaded shapes (frusta, YZ extrusions, double-sided
 * shells) the Geometry kernel does not provide.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { Material } from '@babylonjs/core/Materials/material'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { MaterialLibrary, LampColor, MaterialName } from '../../Materials'
import '@babylonjs/core/Meshes/instancedMesh'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { boxAt, windToNormals } from '../truck/Geometry'
import type { P2, P3 } from '../truck/Geometry'

const FIXED: Record<string, { kind: 'paint' | 'matte'; hex: string }> = {
  wood: { kind: 'matte', hex: '#8f6c44' },
  woodDark: { kind: 'matte', hex: '#6d4f31' },
  woodPale: { kind: 'matte', hex: '#c9a56c' },
  tapeRed: { kind: 'matte', hex: '#c4161c' },
  tapeWhite: { kind: 'matte', hex: '#e9ecee' },
  tarp: { kind: 'matte', hex: '#2d3a33' },
  tarpBlue: { kind: 'matte', hex: '#27405c' },
  orange: { kind: 'matte', hex: '#e2621c' },
  safety: { kind: 'matte', hex: '#e8c21a' },
  concrete: { kind: 'matte', hex: '#9b988f' },
  gravel: { kind: 'matte', hex: '#8d877d' },
  grain: { kind: 'matte', hex: '#d3a93a' },
  yellow: { kind: 'paint', hex: '#e3a21a' },
  machineGrey: { kind: 'paint', hex: '#3d4147' },
  binSteel: { kind: 'paint', hex: '#c7ccd1' },
  wrap: { kind: 'matte', hex: '#dfe5e8' },
  cardboard: { kind: 'matte', hex: '#b78a55' },
  rubberBlack: { kind: 'matte', hex: '#141517' },
  reflector: { kind: 'matte', hex: '#d8d8d2' },
}

/** Hands out materials by slot name and gives back every paint or matte reference when disposed. */
export class Palette {
  private readonly held = new Map<string, PBRMaterial>()
  private readonly owned: PBRMaterial[] = []
  private disposed = false

  constructor(readonly mats: MaterialLibrary) {}

  /** A material for a slot: a library name, `paint:#hex`, `matte:#hex`, or one of the fixed colours such as `wood` or `yellow`. */
  get(slot: string): PBRMaterial {
    const cached = this.held.get(slot)
    if (cached) return cached
    let material: PBRMaterial
    if (slot.startsWith('paint:')) material = this.mats.paint(slot.slice(6), 'gloss')
    else if (slot.startsWith('matte:')) material = this.mats.cargo(slot.slice(6))
    else {
      const fixed = FIXED[slot]
      if (fixed) material = fixed.kind === 'paint' ? this.mats.paint(fixed.hex, 'gloss') : this.mats.cargo(fixed.hex)
      else {
        this.held.set(slot, this.mats.get(slot as MaterialName))
        return this.held.get(slot) as PBRMaterial
      }
    }
    this.held.set(slot, material)
    this.releasable.push(material)
    return material
  }

  private readonly releasable: PBRMaterial[] = []

  /** A lamp material this palette owns and disposes. */
  lamp(color: LampColor, name: string): PBRMaterial {
    const material = this.mats.lampInstance(color, name)
    this.owned.push(material)
    return material
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const material of this.releasable) this.mats.release(material)
    for (const material of this.owned) material.dispose()
    this.releasable.length = 0
    this.owned.length = 0
    this.held.clear()
  }
}

interface Group {
  positions: number[]
  normals: number[]
  indices: number[]
}

/** Collects placed parts per slot and builds one mesh per slot. */
export class MergeBatch {
  private readonly groups = new Map<string, Group>()

  add(slot: string, data: VertexData): this {
    let group = this.groups.get(slot)
    if (!group) {
      group = { positions: [], normals: [], indices: [] }
      this.groups.set(slot, group)
    }
    const base = group.positions.length / 3
    const positions = data.positions as ArrayLike<number>
    const normals = data.normals as ArrayLike<number>
    const indices = data.indices as ArrayLike<number>
    for (let i = 0; i < positions.length; i++) group.positions.push(positions[i])
    for (let i = 0; i < normals.length; i++) group.normals.push(normals[i])
    for (let i = 0; i < indices.length; i++) group.indices.push(indices[i] + base)
    return this
  }

  addAll(slot: string, parts: readonly VertexData[]): this {
    for (const part of parts) this.add(slot, part)
    return this
  }

  get empty(): boolean {
    return this.groups.size === 0
  }

  /** Builds one mesh per slot under `parent`, appends them to `out` and clears the batch. */
  build(scene: Scene, name: string, parent: TransformNode, palette: Palette, out: AbstractMesh[]): Mesh[] {
    const built: Mesh[] = []
    for (const [slot, group] of this.groups) {
      if (group.indices.length === 0) continue
      const mesh = new Mesh(`${name}-${slot}`, scene)
      mesh.parent = parent
      const data = new VertexData()
      data.positions = new Float32Array(group.positions)
      data.normals = new Float32Array(group.normals)
      data.indices = group.positions.length / 3 > 65535 ? new Uint32Array(group.indices) : group.indices
      data.applyToMesh(mesh, false)
      mesh.material = palette.get(slot) as Material
      mesh.isPickable = false
      mesh.receiveShadows = true
      out.push(mesh)
      built.push(mesh)
    }
    this.groups.clear()
    return built
  }
}

/** Disposes meshes, nodes and instances in order, ignoring ones already gone. */
export function disposeAll(items: readonly { dispose(doNotRecurse?: boolean, disposeMaterialAndTextures?: boolean): void }[]): void {
  for (let i = items.length - 1; i >= 0; i--) items[i].dispose(false, false)
}

/** A flat-shaded closed frustum with rectangular ends: `top*` at `y1`, `bottom*` at `y0`, both centred on `(cx, cz)`. */
export function frustum(cx: number, cz: number, topW: number, topD: number, botW: number, botD: number, y0: number, y1: number, caps = true): VertexData {
  const bottom: P3[] = [[cx - botW / 2, y0, cz - botD / 2], [cx + botW / 2, y0, cz - botD / 2], [cx + botW / 2, y0, cz + botD / 2], [cx - botW / 2, y0, cz + botD / 2]]
  const top: P3[] = [[cx - topW / 2, y1, cz - topD / 2], [cx + topW / 2, y1, cz - topD / 2], [cx + topW / 2, y1, cz + topD / 2], [cx - topW / 2, y1, cz + topD / 2]]
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const midY = (y0 + y1) / 2
  const quad = (a: P3, b: P3, c: P3, d: P3, outward: boolean) => {
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = d[0] - a[0]
    const vy = d[1] - a[1]
    const vz = d[2] - a[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz) || 1
    nx /= length
    ny /= length
    nz /= length
    const mx = (a[0] + b[0] + c[0] + d[0]) / 4 - cx
    const my = (a[1] + b[1] + c[1] + d[1]) / 4 - midY
    const mz = (a[2] + b[2] + c[2] + d[2]) / 4 - cz
    if ((nx * mx + ny * my + nz * mz) * (outward ? 1 : -1) < 0) {
      nx = -nx
      ny = -ny
      nz = -nz
    }
    const base = positions.length / 3
    for (const p of [a, b, c, d]) {
      positions.push(p[0], p[1], p[2])
      normals.push(nx, ny, nz)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  for (let k = 0; k < 4; k++) {
    const j = (k + 1) % 4
    quad(bottom[k], bottom[j], top[j], top[k], true)
  }
  if (caps) {
    quad(bottom[0], bottom[1], bottom[2], bottom[3], true)
    quad(top[0], top[1], top[2], top[3], true)
  }
  const data = new VertexData()
  data.positions = positions
  data.normals = normals
  data.indices = indices
  return windToNormals(data)
}

/** The same shape seen from inside as well as outside: a copy with reversed winding and negated normals is appended. */
export function doubleSided(data: VertexData): VertexData {
  const positions = Array.from(data.positions as ArrayLike<number>)
  const normals = Array.from(data.normals as ArrayLike<number>)
  const indices = Array.from(data.indices as ArrayLike<number>)
  const count = positions.length / 3
  const out = new VertexData()
  out.positions = positions.concat(positions)
  out.normals = normals.concat(normals.map((n) => -n))
  const reversed: number[] = []
  for (let t = 0; t < indices.length; t += 3) reversed.push(indices[t] + count, indices[t + 2] + count, indices[t + 1] + count)
  out.indices = indices.concat(reversed)
  return out
}

/** A convex polygon given as `[z, y]` points extruded along X from `x0` to `x1`. */
export function extrudeYZ(points: P2[], x0: number, x1: number, prismFn: (points: P2[], z0: number, z1: number) => VertexData): VertexData {
  const data = prismFn(points, 0, 1)
  const p = data.positions as number[]
  const n = data.normals as number[]
  for (let i = 0; i < p.length; i += 3) {
    const u = p[i]
    const v = p[i + 1]
    const w = p[i + 2]
    p[i] = x0 + (x1 - x0) * w
    p[i + 1] = v
    p[i + 2] = u
    const nu = n[i]
    const nv = n[i + 1]
    const nw = n[i + 2]
    n[i] = nw
    n[i + 1] = nv
    n[i + 2] = nu
  }
  return windToNormals(data)
}

/** A thin flat strip lying on a vertical plane of constant X: used for reflective tape and painted bands. */
export function tapeX(x: number, y0: number, y1: number, z0: number, z1: number, out: 1 | -1): VertexData {
  const thickness = 0.004
  return out > 0 ? boxAt(x, x + thickness, y0, y1, z0, z1) : boxAt(x - thickness, x, y0, y1, z0, z1)
}

/** A thin flat strip on the ground plane, for painted lines. */
export function tapeY(y: number, x0: number, x1: number, z0: number, z1: number): VertexData {
  return boxAt(x0, x1, y, y + 0.004, z0, z1)
}

/** Moves a small number toward a target at a fixed rate, without allocating. */
export function approach(current: number, target: number, step: number): number {
  if (current < target) return Math.min(target, current + step)
  return Math.max(target, current - step)
}

/** Clamps `value` between `lo` and `hi`. */
export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value
}
