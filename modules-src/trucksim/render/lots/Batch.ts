/**
 * Collects scenery geometry (boxes, cylinders, cones, gable roofs, quads) per material key in a movable local frame and turns
 * each key into one merged mesh, so a whole building or a whole chunk of buildings costs one draw call per material. Nothing is
 * created in the scene until `build`. Winding follows Babylon's convention (front faces read clockwise by the right-handed
 * cross product), so every shape faces outward in the right-handed Truck Simulator frame. Heading `h` faces `(sin h, 0, cos h)`.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { Material } from '@babylonjs/core/Materials/material'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'

export type Vec3 = readonly [number, number, number]

/** A rectangle of a sign atlas in texture space (v grows upward). */
export interface UvRect {
  u0: number
  u1: number
  v0: number
  v1: number
}

interface Group {
  positions: number[]
  normals: number[]
  uvs: number[]
  indices: number[]
}

/** Horizontal or vertical axis of a cylinder. */
export type CylinderAxis = 'y' | 'x' | 'z'

const FULL_UV: UvRect = { u0: 0, u1: 1, v0: 0, v1: 1 }

/** Accumulates scenery per material key. */
export class SceneryBatch {
  private readonly groups = new Map<string, Group>()
  private ox = 0
  private oy = 0
  private oz = 0
  private cos = 1
  private sin = 0

  /** Sets the local frame: origin in world metres and a yaw (local +z points along `(sin yaw, 0, cos yaw)`). */
  frame(x: number, y: number, z: number, yaw = 0): this {
    this.ox = x
    this.oy = y
    this.oz = z
    this.cos = Math.cos(yaw)
    this.sin = Math.sin(yaw)
    return this
  }

  /** True when nothing was added. */
  get empty(): boolean {
    return this.groups.size === 0
  }

  /** Vertex count across every group. */
  get vertexCount(): number {
    let count = 0
    for (const group of this.groups.values()) count += group.positions.length / 3
    return count
  }

  /** The material keys in use. */
  get keys(): string[] {
    return [...this.groups.keys()]
  }

  private group(key: string): Group {
    let group = this.groups.get(key)
    if (!group) {
      group = { positions: [], normals: [], uvs: [], indices: [] }
      this.groups.set(key, group)
    }
    return group
  }

  private worldX(x: number, z: number): number {
    return this.ox + x * this.cos + z * this.sin
  }

  private worldZ(x: number, z: number): number {
    return this.oz - x * this.sin + z * this.cos
  }

  /** The world position of a local point. */
  toWorld(x: number, y: number, z: number): Vec3 {
    return [this.worldX(x, z), this.oy + y, this.worldZ(x, z)]
  }

  private vertex(group: Group, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    const index = group.positions.length / 3
    group.positions.push(this.worldX(x, z), this.oy + y, this.worldZ(x, z))
    group.normals.push(nx * this.cos + nz * this.sin, ny, -nx * this.sin + nz * this.cos)
    group.uvs.push(u, v)
    return index
  }

  /**
   * One quad whose corners run counter-clockwise seen from outside (right-handed): `a` bottom-left, `b` bottom-right, `c`
   * top-right, `d` top-left of the face. `uv` maps the face into an atlas cell.
   */
  quad(key: string, a: Vec3, b: Vec3, c: Vec3, d: Vec3, uv: UvRect = FULL_UV): this {
    const group = this.group(key)
    const e1x = b[0] - a[0]
    const e1y = b[1] - a[1]
    const e1z = b[2] - a[2]
    const e2x = c[0] - a[0]
    const e2y = c[1] - a[1]
    const e2z = c[2] - a[2]
    let nx = e1y * e2z - e1z * e2y
    let ny = e1z * e2x - e1x * e2z
    let nz = e1x * e2y - e1y * e2x
    const length = Math.hypot(nx, ny, nz) || 1
    nx /= length
    ny /= length
    nz /= length
    const i0 = this.vertex(group, a[0], a[1], a[2], nx, ny, nz, uv.u0, uv.v0)
    const i1 = this.vertex(group, b[0], b[1], b[2], nx, ny, nz, uv.u1, uv.v0)
    const i2 = this.vertex(group, c[0], c[1], c[2], nx, ny, nz, uv.u1, uv.v1)
    const i3 = this.vertex(group, d[0], d[1], d[2], nx, ny, nz, uv.u0, uv.v1)
    group.indices.push(i0, i2, i1, i0, i3, i2)
    return this
  }

  /** A quad drawn from both sides (roof panels, flags, chain-link). */
  quad2(key: string, a: Vec3, b: Vec3, c: Vec3, d: Vec3, uv: UvRect = FULL_UV): this {
    this.quad(key, a, b, c, d, uv)
    return this.quad(key, b, a, d, c, { u0: uv.u1, u1: uv.u0, v0: uv.v0, v1: uv.v1 })
  }

  /** A triangle facing the side `hint` points to (any vector on the outward side). */
  tri(key: string, a: Vec3, b: Vec3, c: Vec3, hint: Vec3): this {
    const group = this.group(key)
    const e1x = b[0] - a[0]
    const e1y = b[1] - a[1]
    const e1z = b[2] - a[2]
    const e2x = c[0] - a[0]
    const e2y = c[1] - a[1]
    const e2z = c[2] - a[2]
    let nx = e1y * e2z - e1z * e2y
    let ny = e1z * e2x - e1x * e2z
    let nz = e1x * e2y - e1y * e2x
    const length = Math.hypot(nx, ny, nz) || 1
    nx /= length
    ny /= length
    nz /= length
    const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0
    if (flip) {
      nx = -nx
      ny = -ny
      nz = -nz
    }
    const i0 = this.vertex(group, a[0], a[1], a[2], nx, ny, nz, 0, 0)
    const i1 = this.vertex(group, b[0], b[1], b[2], nx, ny, nz, 1, 0)
    const i2 = this.vertex(group, c[0], c[1], c[2], nx, ny, nz, 0, 1)
    if (flip) group.indices.push(i0, i1, i2)
    else group.indices.push(i0, i2, i1)
    return this
  }

  /**
   * A flat face seen from outside on the plane `side` (`+z`, `-z`, `+x`, `-x`) at coordinate `c`, spanning `a0..a1` along the
   * plane's horizontal axis (x for z faces, z for x faces) and `y0..y1`; `uv` maps it into an atlas cell, readable from outside.
   */
  face(key: string, side: '+z' | '-z' | '+x' | '-x', c: number, a0: number, a1: number, y0: number, y1: number, uv: UvRect = FULL_UV): this {
    if (side === '+z') return this.quad(key, [a0, y0, c], [a1, y0, c], [a1, y1, c], [a0, y1, c], uv)
    if (side === '-z') return this.quad(key, [a1, y0, c], [a0, y0, c], [a0, y1, c], [a1, y1, c], uv)
    if (side === '+x') return this.quad(key, [c, y0, a1], [c, y0, a0], [c, y1, a0], [c, y1, a1], uv)
    return this.quad(key, [c, y0, a0], [c, y0, a1], [c, y1, a1], [c, y1, a0], uv)
  }

  /**
   * A lettering plate: `face` sized `width` by `width / aspect` (the atlas cell's shape, so text is never stretched), centred at
   * `a` along the plane and `y` high. `face` already lays the text out to read from outside on every side, so the far side of
   * a two-sided sign needs no flip (`back` is kept for callers and changes nothing).
   */
  placard(key: string, side: '+z' | '-z' | '+x' | '-x', c: number, a: number, y: number, width: number, uv: UvRect, back = false, aspect = 4): this {
    const half = width / 2
    const high = width / aspect / 2
    void back
    return this.face(key, side, c, a - half, a + half, y - high, y + high, uv)
  }

  /** A quad whose winding is chosen so it faces the side `hint` points to (any four coplanar corners in order). */
  quadHint(key: string, a: Vec3, b: Vec3, c: Vec3, d: Vec3, hint: Vec3): this {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const nx = e1[1] * e2[2] - e1[2] * e2[1]
    const ny = e1[2] * e2[0] - e1[0] * e2[2]
    const nz = e1[0] * e2[1] - e1[1] * e2[0]
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] >= 0) return this.quad(key, a, b, c, d)
    return this.quad(key, a, d, c, b)
  }

  /** A straight bar of cross-section `w` by `h` between two points (conveyors, pipes, braces, ramps). */
  beam(key: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w: number, h: number): this {
    let dx = x1 - x0
    let dy = y1 - y0
    let dz = z1 - z0
    const length = Math.hypot(dx, dy, dz) || 1
    dx /= length
    dy /= length
    dz /= length
    let sx = dy * 0 - dz * 1
    let sy = dz * 0 - dx * 0
    let sz = dx * 1 - dy * 0
    const sl = Math.hypot(sx, sy, sz)
    if (sl < 1e-6) {
      sx = 1
      sy = 0
      sz = 0
    } else {
      sx /= sl
      sy /= sl
      sz /= sl
    }
    const ux = dy * sz - dz * sy
    const uy = dz * sx - dx * sz
    const uz = dx * sy - dy * sx
    const hw = w / 2
    const hh = h / 2
    const corner = (end: 0 | 1, i: number, j: number): Vec3 => {
      const bx = end === 0 ? x0 : x1
      const by = end === 0 ? y0 : y1
      const bz = end === 0 ? z0 : z1
      return [bx + sx * i * hw + ux * j * hh, by + sy * i * hw + uy * j * hh, bz + sz * i * hw + uz * j * hh]
    }
    this.quadHint(key, corner(0, 1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(0, 1, 1), [sx, sy, sz])
    this.quadHint(key, corner(0, -1, -1), corner(1, -1, -1), corner(1, -1, 1), corner(0, -1, 1), [-sx, -sy, -sz])
    this.quadHint(key, corner(0, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(0, 1, 1), [ux, uy, uz])
    this.quadHint(key, corner(0, -1, -1), corner(1, -1, -1), corner(1, 1, -1), corner(0, 1, -1), [-ux, -uy, -uz])
    this.quadHint(key, corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(1, -1, 1), [dx, dy, dz])
    this.quadHint(key, corner(0, -1, -1), corner(0, 1, -1), corner(0, 1, 1), corner(0, -1, 1), [-dx, -dy, -dz])
    return this
  }

  /**
   * A closed polygon prism: `profile` points in the local xy plane (y up), extruded along z from `z0` to `z1`, with flat
   * normals. Used for gambrel and barrel profiles; the profile must be convex and listed counter-clockwise seen from +z.
   */
  prism(key: string, profile: readonly (readonly [number, number])[], z0: number, z1: number): this {
    const n = profile.length
    for (let i = 0; i < n; i++) {
      const a = profile[i]
      const c = profile[(i + 1) % n]
      this.quadHint(key, [a[0], a[1], z0], [c[0], c[1], z0], [c[0], c[1], z1], [a[0], a[1], z1], [c[1] - a[1], -(c[0] - a[0]), 0])
    }
    for (let i = 1; i < n - 1; i++) {
      this.tri(key, [profile[0][0], profile[0][1], z1], [profile[i][0], profile[i][1], z1], [profile[i + 1][0], profile[i + 1][1], z1], [0, 0, 1])
      this.tri(key, [profile[0][0], profile[0][1], z0], [profile[i][0], profile[i][1], z0], [profile[i + 1][0], profile[i + 1][1], z0], [0, 0, -1])
    }
    return this
  }

  /**
   * An axis-aligned box in the local frame: centre `(x, z)`, base at `y`, size `(sx, sy, sz)`. `bottom` adds the underside.
   */
  box(key: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, bottom = false): this {
    const x0 = x - sx / 2
    const x1 = x + sx / 2
    const z0 = z - sz / 2
    const z1 = z + sz / 2
    const y1 = y + sy
    this.quad(key, [x0, y, z1], [x1, y, z1], [x1, y1, z1], [x0, y1, z1])
    this.quad(key, [x1, y, z0], [x0, y, z0], [x0, y1, z0], [x1, y1, z0])
    this.quad(key, [x1, y, z1], [x1, y, z0], [x1, y1, z0], [x1, y1, z1])
    this.quad(key, [x0, y, z0], [x0, y, z1], [x0, y1, z1], [x0, y1, z0])
    this.quad(key, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0])
    if (bottom) this.quad(key, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1])
    return this
  }

  /** A box between two corners (local frame). */
  boxBetween(key: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, bottom = false): this {
    return this.box(key, (x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, bottom)
  }

  /**
   * A cylinder or cone with smooth sides. On axis `y` the base is at `y` and it rises `length`; on `x` or `z` the axis runs
   * from `(x, y, z)` for `length` metres in +x or +z with `y` the axis height. `rTop` makes a cone or taper.
   */
  cylinder(key: string, x: number, y: number, z: number, radius: number, length: number, segments = 12, rTop = radius, axis: CylinderAxis = 'y', caps = true): this {
    const group = this.group(key)
    const slope = radius - rTop
    const norm = Math.hypot(1, slope / length) || 1
    const ring = (i: number, along: number, r: number, nr: number, ny: number, u: number): number => {
      const angle = (i / segments) * Math.PI * 2
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      const nx = (c * nr) / norm
      const nyy = ny / norm
      const nz = (s * nr) / norm
      if (axis === 'y') return this.vertex(group, x + c * r, y + along, z + s * r, nx, nyy, nz, u, along / length)
      if (axis === 'x') return this.vertex(group, x + along, y + c * r, z + s * r, nyy, nx, nz, u, along / length)
      return this.vertex(group, x + c * r, y + s * r, z + along, nx, nz, nyy, u, along / length)
    }
    const bottom: number[] = []
    const top: number[] = []
    for (let i = 0; i <= segments; i++) {
      bottom.push(ring(i, 0, radius, 1, slope / length, i / segments))
      top.push(ring(i, length, rTop, 1, slope / length, i / segments))
    }
    const flip = axis !== 'y'
    for (let i = 0; i < segments; i++) {
      if (flip) group.indices.push(bottom[i], top[i], bottom[i + 1], bottom[i + 1], top[i], top[i + 1])
      else group.indices.push(bottom[i], bottom[i + 1], top[i], bottom[i + 1], top[i + 1], top[i])
    }
    if (!caps) return this
    const cap = (along: number, r: number, up: boolean): void => {
      if (r <= 0.0001) return
      const sign = up ? 1 : -1
      const centre = axis === 'y'
        ? this.vertex(group, x, y + along, z, 0, sign, 0, 0.5, 0.5)
        : axis === 'x'
          ? this.vertex(group, x + along, y, z, sign, 0, 0, 0.5, 0.5)
          : this.vertex(group, x, y, z + along, 0, 0, sign, 0.5, 0.5)
      const ids: number[] = []
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2
        const c = Math.cos(angle)
        const s = Math.sin(angle)
        if (axis === 'y') ids.push(this.vertex(group, x + c * r, y + along, z + s * r, 0, sign, 0, 0.5 + c * 0.5, 0.5 + s * 0.5))
        else if (axis === 'x') ids.push(this.vertex(group, x + along, y + c * r, z + s * r, sign, 0, 0, 0.5 + c * 0.5, 0.5 + s * 0.5))
        else ids.push(this.vertex(group, x + c * r, y + s * r, z + along, 0, 0, sign, 0.5 + c * 0.5, 0.5 + s * 0.5))
      }
      const forward = axis === 'y' ? up : axis === 'x' ? !up : up
      for (let i = 0; i < segments; i++) {
        if (forward) group.indices.push(centre, ids[i], ids[i + 1])
        else group.indices.push(centre, ids[i + 1], ids[i])
      }
    }
    cap(length, rTop, true)
    cap(0, radius, false)
    return this
  }

  /**
   * A gable roof over the rectangle `x0..x1`, `z0..z1` with the eaves at `y` and the ridge `rise` higher, running along `x`
   * or `z`. The slopes (both sides) use `roofKey`, the end triangles `endKey`; `overhang` pushes the slopes past the walls.
   */
  gable(roofKey: string, endKey: string, x0: number, z0: number, x1: number, z1: number, y: number, rise: number, ridge: 'x' | 'z', overhang = 0.4): this {
    const top = y + rise
    if (ridge === 'x') {
      const xm0 = x0 - overhang
      const xm1 = x1 + overhang
      const zm = (z0 + z1) / 2
      const a0 = z0 - overhang
      const a1 = z1 + overhang
      const drop = (rise * overhang) / ((z1 - z0) / 2)
      this.quad2(roofKey, [xm0, y - drop, a1], [xm1, y - drop, a1], [xm1, top, zm], [xm0, top, zm])
      this.quad2(roofKey, [xm1, y - drop, a0], [xm0, y - drop, a0], [xm0, top, zm], [xm1, top, zm])
      this.tri(endKey, [x0, y, z0], [x0, y, z1], [x0, top, zm], [-1, 0, 0])
      this.tri(endKey, [x1, y, z0], [x1, y, z1], [x1, top, zm], [1, 0, 0])
    } else {
      const zm0 = z0 - overhang
      const zm1 = z1 + overhang
      const xm = (x0 + x1) / 2
      const a0 = x0 - overhang
      const a1 = x1 + overhang
      const drop = (rise * overhang) / ((x1 - x0) / 2)
      this.quad2(roofKey, [a0, y - drop, zm1], [xm, top, zm1], [xm, top, zm0], [a0, y - drop, zm0])
      this.quad2(roofKey, [xm, top, zm1], [a1, y - drop, zm1], [a1, y - drop, zm0], [xm, top, zm0])
      this.tri(endKey, [x0, y, z0], [x1, y, z0], [xm, top, z0], [0, 0, -1])
      this.tri(endKey, [x0, y, z1], [x1, y, z1], [xm, top, z1], [0, 0, 1])
    }
    return this
  }

  /** A single sloped roof (lean-to) rising from `yLow` at the low side to `yHigh`, `fall` the side that is low: -x, +x, -z or +z. */
  slope(key: string, x0: number, z0: number, x1: number, z1: number, yLow: number, yHigh: number, fall: '-x' | '+x' | '-z' | '+z'): this {
    const lowX0 = fall === '-x' ? yLow : fall === '+x' ? yHigh : yHigh
    const lowX1 = fall === '+x' ? yLow : fall === '-x' ? yHigh : yHigh
    if (fall === '-x' || fall === '+x') {
      this.quad2(key, [x0, lowX0, z1], [x1, lowX1, z1], [x1, lowX1, z0], [x0, lowX0, z0])
    } else {
      const yz0 = fall === '-z' ? yLow : yHigh
      const yz1 = fall === '+z' ? yLow : yHigh
      this.quad2(key, [x0, yz1, z1], [x1, yz1, z1], [x1, yz0, z0], [x0, yz0, z0])
    }
    return this
  }

  /** Creates one mesh per key under `parent`; materials come from `material(key)`. Clears the batch. */
  build(scene: Scene, name: string, parent: TransformNode, material: (key: string) => Material, shadows = true): Mesh[] {
    const out: Mesh[] = []
    for (const [key, group] of this.groups) {
      if (group.indices.length === 0) continue
      out.push(this.makeMesh(scene, `${name}-${key}`, parent, group, material(key), shadows))
    }
    this.groups.clear()
    return out
  }

  /** Merges every key into one mesh (translucent ghosts). Clears the batch. */
  buildSingle(scene: Scene, name: string, parent: TransformNode, material: Material): Mesh | null {
    const merged: Group = { positions: [], normals: [], uvs: [], indices: [] }
    for (const group of this.groups.values()) {
      const base = merged.positions.length / 3
      for (let i = 0; i < group.positions.length; i++) merged.positions.push(group.positions[i])
      for (let i = 0; i < group.normals.length; i++) merged.normals.push(group.normals[i])
      for (let i = 0; i < group.uvs.length; i++) merged.uvs.push(group.uvs[i])
      for (let i = 0; i < group.indices.length; i++) merged.indices.push(group.indices[i] + base)
    }
    this.groups.clear()
    if (merged.indices.length === 0) return null
    return this.makeMesh(scene, name, parent, merged, material, false)
  }

  private makeMesh(scene: Scene, name: string, parent: TransformNode, group: Group, material: Material, shadows: boolean): Mesh {
    const mesh = new Mesh(name, scene)
    mesh.parent = parent
    const data = new VertexData()
    data.positions = new Float32Array(group.positions)
    data.normals = new Float32Array(group.normals)
    data.uvs = new Float32Array(group.uvs)
    data.indices = group.positions.length / 3 > 65535 ? new Uint32Array(group.indices) : new Uint16Array(group.indices)
    data.applyToMesh(mesh, false)
    mesh.material = material
    mesh.isPickable = false
    mesh.receiveShadows = shadows
    mesh.freezeWorldMatrix()
    mesh.doNotSyncBoundingInfo = true
    return mesh
  }
}
