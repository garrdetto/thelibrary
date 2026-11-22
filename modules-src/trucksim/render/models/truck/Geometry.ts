/**
 * Geometry kernel for the procedural trucks: every primitive returns a Babylon `VertexData` (positions, normals, indices; no UVs,
 * since nothing is textured) built in a local frame, ready to be placed with `at` and merged per material by `PartBatch`.
 * Closed shapes are lofted, swept or lathed with smooth normals and wound to Babylon's convention whatever the order the points
 * were generated in, so callers never think about handedness. Points are plain `[x, y, z]` tuples.
 */

import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreateSphereVertexData } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import { CreateTorusVertexData } from '@babylonjs/core/Meshes/Builders/torusBuilder'

/** A point or direction. */
export type P3 = [number, number, number]
/** A profile point: `u` along the sweep's side axis, `v` along its normal. */
export type P2 = [number, number]

/** A rounded-rectangle cross-section of a loft along Z. */
export interface Section {
  x0: number
  x1: number
  y0: number
  y1: number
  /** Radius of the two top corners. */
  rt: number
  /** Radius of the two bottom corners. */
  rb: number
}

const MIN_RADIUS = 0.002

function pack(positions: number[], indices: number[], normals: number[]): VertexData {
  const data = new VertexData()
  data.positions = positions
  data.indices = indices
  data.normals = normals
  return data
}

/** Signed volume about the centroid; Babylon's front faces wind so that a closed outward shape reads negative. */
function signedVolume(positions: number[], indices: number[]): number {
  let cx = 0
  let cy = 0
  let cz = 0
  const count = positions.length / 3
  for (let i = 0; i < positions.length; i += 3) {
    cx += positions[i]
    cy += positions[i + 1]
    cz += positions[i + 2]
  }
  cx /= count
  cy /= count
  cz /= count
  let volume = 0
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    const ax = positions[a] - cx
    const ay = positions[a + 1] - cy
    const az = positions[a + 2] - cz
    const bx = positions[b] - cx
    const by = positions[b + 1] - cy
    const bz = positions[b + 2] - cz
    const qx = positions[c] - cx
    const qy = positions[c + 1] - cy
    const qz = positions[c + 2] - cz
    volume += ax * (by * qz - bz * qy) + ay * (bz * qx - bx * qz) + az * (bx * qy - by * qx)
  }
  return volume
}

function flipIndices(indices: number[]): void {
  for (let t = 0; t < indices.length; t += 3) {
    const swap = indices[t + 1]
    indices[t + 1] = indices[t + 2]
    indices[t + 2] = swap
  }
}

/** Winds a closed shape to Babylon's convention and computes smooth normals. */
export function solid(positions: number[], indices: number[]): VertexData {
  if (signedVolume(positions, indices) > 0) flipIndices(indices)
  const normals: number[] = []
  VertexData.ComputeNormals(positions, indices, normals)
  return pack(positions, indices, normals)
}

/** Rewinds every triangle so its front face agrees with the vertex normals already set. */
export function windToNormals(data: VertexData): VertexData {
  const p = data.positions as number[]
  const n = data.normals as number[]
  const idx = data.indices as number[]
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3
    const b = idx[t + 1] * 3
    const c = idx[t + 2] * 3
    const ux = p[b] - p[a]
    const uy = p[b + 1] - p[a + 1]
    const uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a]
    const vy = p[c + 1] - p[a + 1]
    const vz = p[c + 2] - p[a + 2]
    const cx = uy * vz - uz * vy
    const cy = uz * vx - ux * vz
    const cz = ux * vy - uy * vx
    const nx = n[a] + n[b] + n[c]
    const ny = n[a + 1] + n[b + 1] + n[c + 1]
    const nz = n[a + 2] + n[b + 2] + n[c + 2]
    if (cx * nx + cy * ny + cz * nz > 0) {
      const swap = idx[t + 1]
      idx[t + 1] = idx[t + 2]
      idx[t + 2] = swap
    }
  }
  return data
}

function stripped(data: VertexData): VertexData {
  return pack(Array.from(data.positions as ArrayLike<number>), Array.from(data.indices as ArrayLike<number>), Array.from(data.normals as ArrayLike<number>))
}

/** Places a primitive in place: scale, then roll/pitch/yaw (Z, X, Y), then translate. Returns the same data. */
export function at(data: VertexData, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): VertexData {
  const matrix = Matrix.Compose(new Vector3(sx, sy, sz), Quaternion.RotationYawPitchRoll(ry, rx, rz), new Vector3(x, y, z))
  return data.transform(matrix)
}

/** Applies an arbitrary matrix in place. */
export function apply(data: VertexData, matrix: Matrix): VertexData {
  return data.transform(matrix)
}

/** A copy of the data, so one built part can be placed twice. */
export function copy(data: VertexData): VertexData {
  return stripped(data)
}

/** A copy mirrored across the YZ plane (left part to right part); winding is corrected by `transform`. */
export function mirrorX(data: VertexData): VertexData {
  return copy(data).transform(Matrix.Scaling(-1, 1, 1))
}

/** An axis-aligned box centred on the origin. */
export function box(width: number, height: number, depth: number): VertexData {
  return stripped(CreateBoxVertexData({ width, height, depth }))
}

/** A box from corner ranges, in place. */
export function boxAt(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): VertexData {
  return at(box(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
}

/** A capped cylinder or cone centred on the origin, along the given axis. */
export function cylinder(diameterTop: number, diameterBottom: number, height: number, tessellation: number, axis: 'x' | 'y' | 'z' = 'y'): VertexData {
  const data = stripped(CreateCylinderVertexData({ diameterTop, diameterBottom, height, tessellation }))
  if (axis === 'x') at(data, 0, 0, 0, 0, 0, -Math.PI / 2)
  else if (axis === 'z') at(data, 0, 0, 0, Math.PI / 2)
  return data
}

/** A sphere, optionally squashed per axis. */
export function sphere(diameter: number, segments = 8, sx = 1, sy = 1, sz = 1): VertexData {
  const data = stripped(CreateSphereVertexData({ diameter, segments }))
  if (sx !== 1 || sy !== 1 || sz !== 1) at(data, 0, 0, 0, 0, 0, 0, sx, sy, sz)
  return data
}

/** A torus lying in the XZ plane. */
export function torus(diameter: number, thickness: number, tessellation = 24): VertexData {
  return stripped(CreateTorusVertexData({ diameter, thickness, tessellation }))
}

/**
 * Stitches rings of equal point count into a surface. `wrap` joins the last ring to the first (a closed path); caps fan the
 * first and last rings with their own flat-shaded vertices.
 */
export function rings(ringList: P3[][], options: { wrap?: boolean; capStart?: boolean; capEnd?: boolean; openRing?: boolean } = {}): VertexData {
  const positions: number[] = []
  const indices: number[] = []
  const count = ringList[0].length
  const ringCount = ringList.length
  for (const ring of ringList) for (const point of ring) positions.push(point[0], point[1], point[2])
  const segments = options.openRing ? count - 1 : count
  const spans = options.wrap ? ringCount : ringCount - 1
  for (let i = 0; i < spans; i++) {
    const next = (i + 1) % ringCount
    for (let j = 0; j < segments; j++) {
      const k = (j + 1) % count
      const a = i * count + j
      const b = i * count + k
      const c = next * count + k
      const d = next * count + j
      indices.push(a, b, c, a, c, d)
    }
  }
  const sides = solidSides(positions, indices)
  if (!options.capStart && !options.capEnd) return sides
  const capped = [sides]
  if (options.capStart) capped.push(cap(ringList[0], true))
  if (options.capEnd) capped.push(cap(ringList[ringCount - 1], false))
  return merge(capped)
}

function solidSides(positions: number[], indices: number[]): VertexData {
  return pack(positions, indices, [])
}

function cap(ring: P3[], start: boolean): VertexData {
  const positions: number[] = []
  const indices: number[] = []
  let cx = 0
  let cy = 0
  let cz = 0
  for (const p of ring) {
    cx += p[0]
    cy += p[1]
    cz += p[2]
  }
  cx /= ring.length
  cy /= ring.length
  cz /= ring.length
  positions.push(cx, cy, cz)
  for (const p of ring) positions.push(p[0], p[1], p[2])
  for (let j = 0; j < ring.length; j++) {
    const k = (j + 1) % ring.length
    if (start) indices.push(0, k + 1, j + 1)
    else indices.push(0, j + 1, k + 1)
  }
  return pack(positions, indices, [])
}

/**
 * Joins parts of one closed shape: the winding is decided for the whole (by signed volume) and normals are smoothed within
 * each part only, so the seams between parts stay hard edges.
 */
export function combine(parts: VertexData[]): VertexData {
  return merge(parts)
}

function merge(parts: VertexData[]): VertexData {
  const positions: number[] = []
  const indices: number[] = []
  const groups: Array<[number, number]> = []
  for (const part of parts) {
    const base = positions.length / 3
    const start = indices.length
    for (const v of part.positions as number[]) positions.push(v)
    for (const i of part.indices as number[]) indices.push(i + base)
    groups.push([start, indices.length])
  }
  if (signedVolume(positions, indices) > 0) flipIndices(indices)
  const normals = new Array<number>(positions.length).fill(0)
  for (const [start, end] of groups) {
    const local: number[] = []
    VertexData.ComputeNormals(positions, indices.slice(start, end), local)
    for (let t = start; t < end; t++) {
      const v = indices[t] * 3
      normals[v] = local[v]
      normals[v + 1] = local[v + 1]
      normals[v + 2] = local[v + 2]
    }
  }
  return pack(positions, indices, normals)
}

/** Finalises a ring surface without caps: winds and computes smooth normals. */
function finishRings(data: VertexData): VertexData {
  if ((data.normals as number[]).length > 0) return data
  return solid(data.positions as number[], data.indices as number[])
}

/** Ring surface helper that always returns finished data. */
export function surface(ringList: P3[][], options: { wrap?: boolean; capStart?: boolean; capEnd?: boolean; openRing?: boolean } = {}): VertexData {
  return finishRings(rings(ringList, options))
}

/** The corner radii a section really gets after clamping to its size. */
export function clampedRadii(section: Section): [number, number] {
  const w = section.x1 - section.x0
  const h = section.y1 - section.y0
  const limit = Math.max(0, Math.min(w, h) / 2) * 0.98
  let rt = Math.min(Math.max(section.rt, MIN_RADIUS), limit)
  let rb = Math.min(Math.max(section.rb, MIN_RADIUS), limit)
  if (rt + rb > h - 1e-4) {
    const scale = (h - 1e-4) / (rt + rb)
    rt *= scale
    rb *= scale
  }
  return [rt, rb]
}

/** Points around a rounded rectangle, counter-clockwise from the right edge, `segments` steps per corner. */
export function roundRect(section: Section, segments: number): P2[] {
  const [rt, rb] = clampedRadii(section)
  const out: P2[] = []
  const corner = (cx: number, cy: number, r: number, from: number) => {
    for (let k = 0; k <= segments; k++) {
      const a = from + (Math.PI / 2) * (k / segments)
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  corner(section.x1 - rt, section.y1 - rt, rt, 0)
  corner(section.x0 + rt, section.y1 - rt, rt, Math.PI / 2)
  corner(section.x0 + rb, section.y0 + rb, rb, Math.PI)
  corner(section.x1 - rb, section.y0 + rb, rb, Math.PI * 1.5)
  return out
}

/** Options for `loft`. */
export interface LoftOptions {
  /** Corner segments per quarter. */
  seg?: number
  /** Interior sections between the ends (for shapes that change along Z). */
  steps?: number
  /** Radius of the rounded ends. */
  re?: number
  /** Sections used to round each end. */
  endSeg?: number
  /** Which ends are rounded: both, front (+Z), back (-Z) or none. */
  ends?: 'both' | 'front' | 'back' | 'none'
  /** Round the bottom edge at the ends too (off keeps the bottom flat, e.g. a hood sitting on a fender). */
  insetBottom?: boolean
  /** Leave the ends open. */
  open?: boolean
}

/** How far a loft's rounded end pulls the section in at station `z` (front end at `z1`, back end at `z0`). */
export function endInset(z: number, z0: number, z1: number, re: number, ends: 'both' | 'front' | 'back' | 'none' = 'both'): number {
  if (re <= 0) return 0
  let d = Infinity
  if (ends === 'both' || ends === 'front') d = Math.min(d, z1 - z)
  if (ends === 'both' || ends === 'back') d = Math.min(d, z - z0)
  if (d >= re) return 0
  const k = re - Math.max(0, d)
  return re - Math.sqrt(Math.max(0, re * re - k * k))
}

/** A section pulled in by `inset` on every side (and the bottom unless `bottom` is false). */
export function insetSection(s: Section, inset: number, bottom: boolean): Section {
  const w = s.x1 - s.x0
  const h = s.y1 - s.y0
  const maxInset = Math.max(0, Math.min(w, bottom ? h : h * 2) * 0.48)
  const d = Math.min(inset, maxInset)
  return { x0: s.x0 + d, x1: s.x1 - d, y0: s.y0 + (bottom ? d : 0), y1: s.y1 - d, rt: s.rt, rb: s.rb }
}

/**
 * Lofts rounded-rectangle sections along Z from `z0` to `z1` (`z0 < z1`), with rounded ends. `shape(z)` gives the section at
 * each station, so hoods, fenders and fairings can taper and sweep while flat panels pass a constant.
 */
export function loft(shape: (z: number) => Section, z0: number, z1: number, options: LoftOptions = {}): VertexData {
  const seg = options.seg ?? 3
  const steps = options.steps ?? 0
  const ends = options.ends ?? 'both'
  const endSeg = options.endSeg ?? 3
  const re = Math.min(options.re ?? 0, (z1 - z0) * 0.45)
  const bottom = options.insetBottom ?? true
  const stations: Array<[number, number]> = []
  const roundBack = re > 0 && (ends === 'both' || ends === 'back')
  const roundFront = re > 0 && (ends === 'both' || ends === 'front')
  if (roundBack) {
    for (let k = 0; k < endSeg; k++) {
      const a = (Math.PI / 2) * (k / endSeg)
      stations.push([z0 + re * (1 - Math.cos(a)), re * (1 - Math.sin(a))])
    }
  }
  const innerStart = roundBack ? z0 + re : z0
  const innerEnd = roundFront ? z1 - re : z1
  for (let k = 0; k <= steps + 1; k++) stations.push([innerStart + (innerEnd - innerStart) * (k / (steps + 1)), 0])
  if (roundFront) {
    for (let k = endSeg - 1; k >= 0; k--) {
      const a = (Math.PI / 2) * (k / endSeg)
      stations.push([z1 - re * (1 - Math.cos(a)), re * (1 - Math.sin(a))])
    }
  }
  const ringList: P3[][] = stations.map(([z, inset]) => {
    const section = inset > 0 ? insetSection(shape(z), inset, bottom) : shape(z)
    return roundRect(section, seg).map(([x, y]) => [x, y, z] as P3)
  })
  return surface(ringList, { capStart: !options.open, capEnd: !options.open })
}

/** A rounded slab between corner ranges: every edge rounded, `rt`/`rb` on the long top/bottom edges, `re` at the Z ends. */
export function slab(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, rt: number, rb = rt, re = Math.min(rt, rb), options: LoftOptions = {}): VertexData {
  const section: Section = { x0, x1, y0, y1, rt, rb }
  return loft(() => section, Math.min(z0, z1), Math.max(z0, z1), { re, ...options })
}

/** A rounded slab whose long axis runs along X instead of Z (bumpers, bars, cross members). */
export function slabX(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, rt: number, rb = rt, re = Math.min(rt, rb), options: LoftOptions = {}): VertexData {
  const data = slab(-(z1 - z0) / 2, (z1 - z0) / 2, y0, y1, Math.min(x0, x1), Math.max(x0, x1), rt, rb, re, options)
  return at(data, 0, 0, (z0 + z1) / 2, 0, Math.PI / 2, 0)
}

function sub(a: P3, b: P3): P3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function norm(a: P3): P3 {
  const length = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / length, a[1] / length, a[2] / length]
}

function cross(a: P3, b: P3): P3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dot(a: P3, b: P3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** Options for `sweep`. */
export interface SweepOptions {
  /** Fixed side axis: the profile's `u` runs along it (projected square to the path). Omit for parallel transport. */
  side?: P3
  /** The path is a closed loop. */
  closed?: boolean
  /** Cap both ends (ignored for closed paths). */
  caps?: boolean
}

/** Sweeps a closed 2D profile (or one per path point) along a 3D path. */
export function sweep(path: P3[], profile: P2[] | ((index: number) => P2[]), options: SweepOptions = {}): VertexData {
  const count = path.length
  const closed = !!options.closed
  const ringList: P3[][] = []
  let previousSide: P3 | null = null
  for (let i = 0; i < count; i++) {
    const prev = closed ? path[(i - 1 + count) % count] : path[Math.max(0, i - 1)]
    const next = closed ? path[(i + 1) % count] : path[Math.min(count - 1, i + 1)]
    const tangent = norm(sub(next, prev))
    let side: P3
    if (options.side) {
      const axis = options.side
      const d = dot(axis, tangent)
      side = norm([axis[0] - tangent[0] * d, axis[1] - tangent[1] * d, axis[2] - tangent[2] * d])
    } else if (previousSide) {
      const d = dot(previousSide, tangent)
      side = norm([previousSide[0] - tangent[0] * d, previousSide[1] - tangent[1] * d, previousSide[2] - tangent[2] * d])
    } else {
      const seed: P3 = Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
      side = norm(cross(cross(tangent, seed), tangent))
    }
    previousSide = side
    const normal = cross(tangent, side)
    const points = typeof profile === 'function' ? profile(i) : profile
    const p = path[i]
    ringList.push(points.map(([u, v]) => [p[0] + side[0] * u + normal[0] * v, p[1] + side[1] * u + normal[1] * v, p[2] + side[2] * u + normal[2] * v] as P3))
  }
  const caps = !closed && options.caps !== false
  return surface(ringList, { wrap: closed, capStart: caps, capEnd: caps })
}

/** A circle profile for tubes. */
export function circle(radius: number, tessellation: number): P2[] {
  const out: P2[] = []
  for (let k = 0; k < tessellation; k++) {
    const a = (Math.PI * 2 * k) / tessellation
    out.push([radius * Math.cos(a), radius * Math.sin(a)])
  }
  return out
}

/** A round tube along a path. */
export function tube(path: P3[], radius: number, tessellation = 10, options: SweepOptions = {}): VertexData {
  return sweep(path, circle(radius, tessellation), options)
}

/** A rounded-rectangle profile centred on the path, `w` along the side axis and `d` along the normal. */
export function rectProfile(w: number, d: number, r: number, seg = 2): P2[] {
  return roundRect({ x0: -w / 2, x1: w / 2, y0: -d / 2, y1: d / 2, rt: r, rb: r }, seg)
}

/** A straight rounded bar between two points; `side` orients its width. */
export function bar(from: P3, to: P3, w: number, d: number, r: number, side: P3 = [1, 0, 0]): VertexData {
  return sweep([from, to], rectProfile(w, d, r), { side })
}

/** Rounds the interior corners of a polyline with quadratic arcs (`radius` is the cut-back distance limit). */
export function roundCorners(points: P3[], radius: number, segments = 4, closed = false): P3[] {
  const count = points.length
  const out: P3[] = []
  for (let i = 0; i < count; i++) {
    const p = points[i]
    const interior = closed || (i > 0 && i < count - 1)
    if (!interior) {
      out.push(p)
      continue
    }
    const prev = points[(i - 1 + count) % count]
    const next = points[(i + 1) % count]
    const inLength = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])
    const outLength = Math.hypot(next[0] - p[0], next[1] - p[1], next[2] - p[2])
    const cut = Math.min(radius, inLength * 0.49, outLength * 0.49)
    const a = norm(sub(p, prev))
    const b = norm(sub(next, p))
    const s: P3 = [p[0] - a[0] * cut, p[1] - a[1] * cut, p[2] - a[2] * cut]
    const e: P3 = [p[0] + b[0] * cut, p[1] + b[1] * cut, p[2] + b[2] * cut]
    for (let k = 0; k <= segments; k++) {
      const t = k / segments
      const u = 1 - t
      out.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1], u * u * s[2] + 2 * u * t * p[2] + t * t * e[2]])
    }
  }
  return out
}

/**
 * Revolves a profile of `[radius, y]` points around the Y axis. A closed profile (a tyre section) wraps; an open one can cap
 * its ends.
 */
export function lathe(profile: P2[], tessellation: number, options: { closed?: boolean; capStart?: boolean; capEnd?: boolean } = {}): VertexData {
  const ringList: P3[][] = profile.map(([r, y]) => {
    const radius = Math.max(r, 0.0005)
    const ring: P3[] = []
    for (let k = 0; k < tessellation; k++) {
      const a = (Math.PI * 2 * k) / tessellation
      ring.push([radius * Math.cos(a), y, radius * Math.sin(a)])
    }
    return ring
  })
  return surface(ringList, { wrap: !!options.closed, capStart: options.capStart, capEnd: options.capEnd })
}

/**
 * A lathe with a hard edge at every profile point (flat rings, bevels, machined faces): each segment is shaded on its own
 * while the winding is decided for the whole closed profile.
 */
export function latheHard(profile: P2[], tessellation: number, closed = true): VertexData {
  const parts: VertexData[] = []
  const count = profile.length
  const spans = closed ? count : count - 1
  for (let i = 0; i < spans; i++) {
    const a = profile[i]
    const b = profile[(i + 1) % count]
    const ringList: P3[][] = [a, b].map(([r, y]) => {
      const radius = Math.max(r, 0.0005)
      const ring: P3[] = []
      for (let k = 0; k < tessellation; k++) {
        const angle = (Math.PI * 2 * k) / tessellation
        ring.push([radius * Math.cos(angle), y, radius * Math.sin(angle)])
      }
      return ring
    })
    parts.push(rings(ringList))
  }
  return merge(parts)
}

/** `latheHard` turned to run along X. */
export function latheHardX(profile: P2[], tessellation: number, closed = true): VertexData {
  return at(latheHard(profile, tessellation, closed), 0, 0, 0, 0, 0, -Math.PI / 2)
}

/** A beveled rectangular ring section `[radius, axial]` for `latheHard`: from `r0` to `r1`, `x0` to `x1`. */
export function ringSection(r0: number, r1: number, x0: number, x1: number, bevel: number): P2[] {
  const b = Math.min(bevel, (r1 - r0) / 3, (x1 - x0) / 3)
  return [
    [r0, x0 + b], [r0 + b, x0], [r1 - b, x0], [r1, x0 + b], [r1, x1 - b], [r1 - b, x1], [r0 + b, x1], [r0, x1 - b],
  ]
}

/** A lathe turned to run along X (wheels, hubs, axle parts): the profile's `y` becomes X. */
export function latheX(profile: P2[], tessellation: number, options: { closed?: boolean; capStart?: boolean; capEnd?: boolean } = {}): VertexData {
  return at(lathe(profile, tessellation, options), 0, 0, 0, 0, 0, -Math.PI / 2)
}

/** A lathe turned to run along Z (lamps, horns, pipes pointing forward). */
export function latheZ(profile: P2[], tessellation: number, options: { closed?: boolean; capStart?: boolean; capEnd?: boolean } = {}): VertexData {
  return at(lathe(profile, tessellation, options), 0, 0, 0, Math.PI / 2)
}

/** A flat four-cornered panel with thickness (glass, plates); corners in order around the panel. */
export function panel(a: P3, b: P3, c: P3, d: P3, thickness: number): VertexData {
  const n = norm(cross(sub(b, a), sub(d, a)))
  const h = thickness / 2
  const front = [a, b, c, d].map((p) => [p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h] as P3)
  const back = [a, b, c, d].map((p) => [p[0] - n[0] * h, p[1] - n[1] * h, p[2] - n[2] * h] as P3)
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const face = (quad: P3[], normal: P3) => {
    const base = positions.length / 3
    for (const p of quad) {
      positions.push(p[0], p[1], p[2])
      normals.push(normal[0], normal[1], normal[2])
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  face(front, n)
  face(back, [-n[0], -n[1], -n[2]])
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    const edge = sub(front[j], front[i])
    let outward = norm(cross(edge, n))
    const mid: P3 = [(front[i][0] + front[j][0]) / 2, (front[i][1] + front[j][1]) / 2, (front[i][2] + front[j][2]) / 2]
    const centre: P3 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2]
    if (dot(outward, sub(mid, centre)) < 0) outward = [-outward[0], -outward[1], -outward[2]]
    face([front[i], front[j], back[j], back[i]], outward)
  }
  return windToNormals(pack(positions, indices, normals))
}

/** A convex polygon in the XY plane extruded from `z0` to `z1`, flat-shaded with hard edges. */
export function prism(points: P2[], z0: number, z1: number): VertexData {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const count = points.length
  let cx = 0
  let cy = 0
  for (const [x, y] of points) {
    cx += x
    cy += y
  }
  cx /= count
  cy /= count
  const capFace = (z: number, nz: number) => {
    const base = positions.length / 3
    positions.push(cx, cy, z)
    normals.push(0, 0, nz)
    for (const [x, y] of points) {
      positions.push(x, y, z)
      normals.push(0, 0, nz)
    }
    for (let j = 0; j < count; j++) indices.push(base, base + 1 + j, base + 1 + ((j + 1) % count))
  }
  capFace(z0, -1)
  capFace(z1, 1)
  for (let j = 0; j < count; j++) {
    const [ax, ay] = points[j]
    const [bx, by] = points[(j + 1) % count]
    let nx = by - ay
    let ny = -(bx - ax)
    const length = Math.hypot(nx, ny) || 1
    nx /= length
    ny /= length
    if (nx * ((ax + bx) / 2 - cx) + ny * ((ay + by) / 2 - cy) < 0) {
      nx = -nx
      ny = -ny
    }
    const base = positions.length / 3
    positions.push(ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z1)
    for (let k = 0; k < 4; k++) normals.push(nx, ny, 0)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return windToNormals(pack(positions, indices, normals))
}

/** A thin ribbon (stripe, seam, trim line) lying on a plane of constant X, following a polyline of `[z, y]` points. */
export function sideRibbon(points: P2[], width: number | ((t: number) => number), x: number, thickness: number, outward: 1 | -1): VertexData {
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const count = points.length
  const top: P2[] = []
  const bottom: P2[] = []
  for (let i = 0; i < count; i++) {
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(count - 1, i + 1)]
    const dz = next[0] - prev[0]
    const dy = next[1] - prev[1]
    const length = Math.hypot(dz, dy) || 1
    const nz = -dy / length
    const ny = dz / length
    const w = (typeof width === 'function' ? width(i / Math.max(1, count - 1)) : width) / 2
    top.push([points[i][0] + nz * w, points[i][1] + ny * w])
    bottom.push([points[i][0] - nz * w, points[i][1] - ny * w])
  }
  const xOuter = x + outward * thickness
  const pushQuad = (q: P3[], n: P3) => {
    const base = positions.length / 3
    for (const p of q) {
      positions.push(p[0], p[1], p[2])
      normals.push(n[0], n[1], n[2])
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  for (let i = 0; i < count - 1; i++) {
    pushQuad([[xOuter, top[i][1], top[i][0]], [xOuter, top[i + 1][1], top[i + 1][0]], [xOuter, bottom[i + 1][1], bottom[i + 1][0]], [xOuter, bottom[i][1], bottom[i][0]]], [outward, 0, 0])
    const tz = top[i + 1][0] - top[i][0]
    const ty = top[i + 1][1] - top[i][1]
    const tl = Math.hypot(tz, ty) || 1
    pushQuad([[x, top[i][1], top[i][0]], [x, top[i + 1][1], top[i + 1][0]], [xOuter, top[i + 1][1], top[i + 1][0]], [xOuter, top[i][1], top[i][0]]], [0, tz / tl, -ty / tl])
    const bz = bottom[i + 1][0] - bottom[i][0]
    const by = bottom[i + 1][1] - bottom[i][1]
    const bl = Math.hypot(bz, by) || 1
    pushQuad([[x, bottom[i][1], bottom[i][0]], [x, bottom[i + 1][1], bottom[i + 1][0]], [xOuter, bottom[i + 1][1], bottom[i + 1][0]], [xOuter, bottom[i][1], bottom[i][0]]], [0, -bz / bl, by / bl])
  }
  const endCap = (i: number, sign: number) => {
    const p = points[i]
    const q = points[Math.max(0, Math.min(count - 1, i + sign))]
    const dz = p[0] - q[0]
    const dy = p[1] - q[1]
    const l = Math.hypot(dz, dy) || 1
    pushQuad([[x, top[i][1], top[i][0]], [xOuter, top[i][1], top[i][0]], [xOuter, bottom[i][1], bottom[i][0]], [x, bottom[i][1], bottom[i][0]]], [0, dy / l, dz / l])
  }
  endCap(0, 1)
  endCap(count - 1, -1)
  return windToNormals(pack(positions, indices, normals))
}

/** Samples a cubic Bezier in 2D. */
export function bezier2(a: P2, b: P2, c: P2, d: P2, steps: number): P2[] {
  const out: P2[] = []
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    const u = 1 - t
    const w0 = u * u * u
    const w1 = 3 * u * u * t
    const w2 = 3 * u * t * t
    const w3 = t * t * t
    out.push([w0 * a[0] + w1 * b[0] + w2 * c[0] + w3 * d[0], w0 * a[1] + w1 * b[1] + w2 * c[1] + w3 * d[1]])
  }
  return out
}

/** Smooth 0…1 step. */
export function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/** Linear blend. */
export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Height of a wheel arch of radius `r` centred at `cz` and `cy` at station `z`, or `base` outside it. */
export function archBottom(z: number, cz: number, cy: number, r: number, base: number): number {
  const dz = z - cz
  if (Math.abs(dz) >= r) return base
  return Math.max(base, cy + Math.sqrt(r * r - dz * dz))
}

/**
 * A thin shell lying on the top corner of a lofted shape (a swept headlight lens or its bezel): between stations `z0` and
 * `z1`, over the corner arc from `a0` to `a1` degrees (0 at the side, 90 at the top), on side `side`, standing `offset` off the
 * surface with the given thickness. `shape` should already include any end inset.
 */
export function cornerStrip(shape: (z: number) => Section, z0: number, z1: number, steps: number, side: 1 | -1, a0: number, a1: number, offset: number, thickness: number, arcSteps = 8): VertexData {
  const ringList: P3[][] = []
  for (let k = 0; k <= steps; k++) {
    const z = z0 + (z1 - z0) * (k / steps)
    const section = shape(z)
    const [rt] = clampedRadii(section)
    const cx = side > 0 ? section.x1 - rt : section.x0 + rt
    const cy = section.y1 - rt
    const outer: P3[] = []
    const inner: P3[] = []
    for (let i = 0; i <= arcSteps; i++) {
      const deg = a0 + (a1 - a0) * (i / arcSteps)
      const theta = side > 0 ? (deg * Math.PI) / 180 : Math.PI - (deg * Math.PI) / 180
      const nx = Math.cos(theta)
      const ny = Math.sin(theta)
      outer.push([cx + nx * (rt + offset), cy + ny * (rt + offset), z])
      inner.push([cx + nx * (rt + offset - thickness), cy + ny * (rt + offset - thickness), z])
    }
    ringList.push([...outer, ...inner.reverse()])
  }
  return surface(ringList, { capStart: true, capEnd: true })
}
