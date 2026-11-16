/**
 * Geometry for the world edits (renderer-free): smooth curves through plotted points, parallel offsets, and distance
 * fields of shapes rasterised onto Tello's grids, so an edit touches only the nodes near it.
 */
import type { CurveFit, Flat, Shape } from './WorldEdits'

export interface Box { x0: number; z0: number; x1: number; z1: number }

export function boxOf(pts: ArrayLike<number>, pad = 0): Box {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let k = 0; k + 1 < pts.length; k += 2) {
    x0 = Math.min(x0, pts[k]); x1 = Math.max(x1, pts[k])
    z0 = Math.min(z0, pts[k + 1]); z1 = Math.max(z1, pts[k + 1])
  }
  return { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad }
}

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b
  if (!b) return a
  return { x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) }
}

export function shapeBox(shape: Shape, pad = 0): Box {
  return shape.k === 'path' ? boxOf(shape.pts, shape.r + pad) : boxOf(shape.ring, pad)
}

export function lineLength(p: ArrayLike<number>): number {
  let len = 0
  for (let k = 0; k + 3 < p.length; k += 2) len += Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1])
  return len
}

/** Points no more than `step` apart along a line (both ends kept, every original point kept). */
export function densify(p: ArrayLike<number>, step: number): number[] {
  if (p.length < 4) return Array.from(p)
  const out = [p[0], p[1]]
  for (let k = 0; k + 3 < p.length; k += 2) {
    const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step))
    for (let i = 1; i <= n; i++) out.push(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)
  }
  return out
}

/** Drops points closer than `min` to the previous kept point (the last is always kept). */
export function dedupe(p: ArrayLike<number>, min = 0.05): number[] {
  const out: number[] = []
  for (let k = 0; k + 1 < p.length; k += 2) {
    const n = out.length
    if (n && Math.hypot(p[k] - out[n - 2], p[k + 1] - out[n - 1]) < min) {
      if (k + 2 >= p.length) { out[n - 2] = p[k]; out[n - 1] = p[k + 1] }
      continue
    }
    out.push(p[k], p[k + 1])
  }
  return out
}

/** Douglas-Peucker simplification of an open line (x, z pairs). */
export function simplify(p: ArrayLike<number>, tolerance: number): number[] {
  const n = p.length / 2
  if (n <= 2) return Array.from(p)
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let best = -1, bd = tolerance
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(p[i * 2], p[i * 2 + 1], p[a * 2], p[a * 2 + 1], p[b * 2], p[b * 2 + 1])
      if (d > bd) { bd = d; best = i }
    }
    if (best >= 0) {
      keep[best] = 1
      stack.push([a, best], [best, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1])
  return out
}

export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az
  const l2 = dx * dx + dz * dz
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0
  return Math.hypot(px - ax - dx * t, pz - az - dz * t)
}

export function distToLine(p: ArrayLike<number>, x: number, z: number): number {
  if (p.length < 4) return p.length >= 2 ? Math.hypot(x - p[0], z - p[1]) : Infinity
  let best = Infinity
  for (let k = 0; k + 3 < p.length; k += 2) best = Math.min(best, distToSegment(x, z, p[k], p[k + 1], p[k + 2], p[k + 3]))
  return best
}

/**
 * Rounds each interior corner of a polyline with an arc of radius `radius` (shrunk where the legs are too short for
 * it), sampled no coarser than `step` metres or 8°. A radius of 0 keeps the corners sharp.
 */
export function filletLine(pts: ArrayLike<number>, radius: number | number[], step = 2): number[] {
  const p = dedupe(pts)
  const n = p.length / 2
  if (n < 3) return densify(p, step)
  const out: number[] = [p[0], p[1]]
  let prevCut = 0
  for (let i = 1; i < n - 1; i++) {
    const ax = p[i * 2 - 2], az = p[i * 2 - 1], bx = p[i * 2], bz = p[i * 2 + 1], cx = p[i * 2 + 2], cz = p[i * 2 + 3]
    const l1 = Math.hypot(bx - ax, bz - az), l2 = Math.hypot(cx - bx, cz - bz)
    const ux = (bx - ax) / l1, uz = (bz - az) / l1, vx = (cx - bx) / l2, vz = (cz - bz) / l2
    const cos = Math.max(-1, Math.min(1, ux * vx + uz * vz))
    const turn = Math.acos(cos)
    const r = Array.isArray(radius) ? radius[i] ?? 0 : radius
    if (r <= 0.01 || turn < 1e-3 || l1 - prevCut < 0.05) {
      pushTo(out, bx, bz, step)
      prevCut = 0
      continue
    }
    // Tangent length for this radius, limited so neighbouring arcs never overlap on a leg.
    const want = r * Math.tan(turn / 2)
    const room1 = l1 - prevCut
    const room2 = i === n - 2 ? l2 : l2 / 2
    const t = Math.max(0, Math.min(want, room1, room2))
    const rr = t / Math.tan(turn / 2)
    const sx = bx - ux * t, sz = bz - uz * t
    const ex = bx + vx * t, ez = bz + vz * t
    pushTo(out, sx, sz, step)
    const side = ux * vz - uz * vx > 0 ? 1 : -1
    const ocx = sx - uz * rr * side, ocz = sz + ux * rr * side
    const a0 = Math.atan2(sz - ocz, sx - ocx)
    const sweep = turn * side
    const segs = Math.max(2, Math.ceil(Math.max(Math.abs(sweep) / (Math.PI / 22.5), (Math.abs(sweep) * rr) / step)))
    for (let s = 1; s < segs; s++) {
      const a = a0 + (sweep * s) / segs
      out.push(ocx + Math.cos(a) * rr, ocz + Math.sin(a) * rr)
    }
    out.push(ex, ez)
    prevCut = t
  }
  pushTo(out, p[n * 2 - 2], p[n * 2 - 1], step)
  return dedupe(out, 0.02)
}

function pushTo(out: number[], x: number, z: number, step: number): void {
  const lx = out[out.length - 2], lz = out[out.length - 1]
  const len = Math.hypot(x - lx, z - lz)
  if (len < 0.02) return
  const k = Math.max(1, Math.ceil(len / step))
  for (let i = 1; i <= k; i++) out.push(lx + ((x - lx) * i) / k, lz + ((z - lz) * i) / k)
}

/**
 * A centripetal Catmull-Rom curve through every point (no loops or cusps), sampled about `step` metres apart. `tension`
 * 0..1 pulls it toward the straight legs.
 */
export function splineLine(pts: ArrayLike<number>, step = 2, tension = 0): number[] {
  const p = dedupe(pts)
  const n = p.length / 2
  if (n < 3) return densify(p, step)
  const P = (i: number) => {
    if (i < 0) return [2 * p[0] - p[2], 2 * p[1] - p[3]]
    if (i >= n) return [2 * p[n * 2 - 2] - p[n * 2 - 4], 2 * p[n * 2 - 1] - p[n * 2 - 3]]
    return [p[i * 2], p[i * 2 + 1]]
  }
  const out: number[] = [p[0], p[1]]
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2)
    const d = (a: number[], b: number[]) => Math.max(1e-4, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5))
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3)
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    const segs = Math.max(1, Math.ceil(len / step))
    for (let s = 1; s <= segs; s++) {
      const t = t1 + ((t2 - t1) * s) / segs
      const lerp = (a: number[], b: number[], ta: number, tb: number) => {
        const u = (t - ta) / (tb - ta || 1)
        return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
      }
      const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3)
      const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3)
      const C = lerp(B1, B2, t1, t2)
      const straight = [p1[0] + (p2[0] - p1[0]) * (s / segs), p1[1] + (p2[1] - p1[1]) * (s / segs)]
      out.push(C[0] + (straight[0] - C[0]) * tension, C[1] + (straight[1] - C[1]) * tension)
    }
  }
  return dedupe(out, 0.02)
}

/** The curve a road or river follows through its plotted points. */
export function curveOf(pts: ArrayLike<number>, radius: number, fit: CurveFit = 'arcs', step = 2): number[] {
  if (pts.length < 4) return Array.from(pts)
  return fit === 'spline' ? splineLine(pts, step) : filletLine(pts, radius, step)
}

/**
 * A line moved `d` metres to its left (negative: right) with mitred corners, then rounded like the original so the two
 * stay parallel through every curve (inner corners get a smaller radius, outer ones a larger one).
 */
export function offsetCurve(pts: ArrayLike<number>, d: number, radius: number, fit: CurveFit = 'arcs', step = 2): number[] {
  const p = dedupe(pts)
  const n = p.length / 2
  if (n < 2) return Array.from(p)
  if (fit === 'spline') return offsetDense(splineLine(p, step), d)
  const out: number[] = []
  const radii: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1)
    let nx: number, nz: number, scale = 1
    if (i === 0 || i === n - 1) {
      const dx = p[c * 2] - p[a * 2], dz = p[c * 2 + 1] - p[a * 2 + 1]
      const len = Math.hypot(dx, dz) || 1
      nx = -dz / len; nz = dx / len
      radii.push(0)
    } else {
      const ux = p[i * 2] - p[a * 2], uz = p[i * 2 + 1] - p[a * 2 + 1], vx = p[c * 2] - p[i * 2], vz = p[c * 2 + 1] - p[i * 2 + 1]
      const lu = Math.hypot(ux, uz) || 1, lv = Math.hypot(vx, vz) || 1
      const n1x = -uz / lu, n1z = ux / lu, n2x = -vz / lv, n2z = vx / lv
      nx = n1x + n2x; nz = n1z + n2z
      const ln = Math.hypot(nx, nz) || 1
      nx /= ln; nz /= ln
      scale = 1 / Math.max(0.25, nx * n1x + nz * n1z)
      const left = (ux / lu) * (vz / lv) - (uz / lu) * (vx / lv) > 0
      radii.push(Math.max(0.5, radius + (left ? -d : d)))
    }
    out.push(p[i * 2] + nx * d * scale, p[i * 2 + 1] + nz * d * scale)
  }
  return radius > 0 ? filletLine(out, radii, step) : densify(out, step)
}

/** Offsets an already dense line point by point (normals averaged over neighbours). */
export function offsetDense(p: ArrayLike<number>, d: number): number[] {
  const n = p.length / 2
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1)
    const dx = p[c * 2] - p[a * 2], dz = p[c * 2 + 1] - p[a * 2 + 1]
    const len = Math.hypot(dx, dz) || 1
    out.push(p[i * 2] - (dz / len) * d, p[i * 2 + 1] + (dx / len) * d)
  }
  return out
}

/** Polygon area (absolute) of a ring. */
export function ringArea(ring: ArrayLike<number>): number {
  let s = 0
  const n = ring.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    s += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1]
  }
  return Math.abs(s) / 2
}

export function centroidOf(ring: ArrayLike<number>): [number, number] {
  let x = 0, z = 0
  const n = ring.length / 2
  for (let i = 0; i < n; i++) { x += ring[i * 2]; z += ring[i * 2 + 1] }
  return [x / Math.max(1, n), z / Math.max(1, n)]
}

export function inRing(ring: ArrayLike<number>, x: number, z: number): boolean {
  let inside = false
  const n = ring.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2], zi = ring[i * 2 + 1], xj = ring[j * 2], zj = ring[j * 2 + 1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

// ---------------------------------------------------------------- distance fields on a grid

/** A regular grid: node (i, j) is at (x0 + i·cell, z0 + j·cell), `side` nodes a side, row-major from the south-west. */
export interface GridSpec { x0: number; z0: number; cell: number; side: number }

/**
 * Signed distance from each node near a shape to it: ≤ 0 within the shape (a path's radius, an area's inside),
 * positive outside, for the nodes inside the shape's box widened by `reach`. Nodes beyond `reach` read +Infinity
 * (outside) or -Infinity (deep inside an area). `at` (paths only) is each node's distance along the path to its
 * nearest point, for heights and levels that change along it.
 */
export interface Field {
  i0: number
  j0: number
  w: number
  h: number
  d: Float32Array
  at?: Float32Array
}

export function nodeRange(g: GridSpec, box: Box): { i0: number; j0: number; i1: number; j1: number } | null {
  const i0 = Math.max(0, Math.floor((box.x0 - g.x0) / g.cell))
  const j0 = Math.max(0, Math.floor((box.z0 - g.z0) / g.cell))
  const i1 = Math.min(g.side - 1, Math.ceil((box.x1 - g.x0) / g.cell))
  const j1 = Math.min(g.side - 1, Math.ceil((box.z1 - g.z0) / g.cell))
  if (i1 < i0 || j1 < j0) return null
  return { i0, j0, i1, j1 }
}

export function shapeField(g: GridSpec, shape: Shape, reach: number, wantAt = false): Field | null {
  const box = shapeBox(shape, reach + g.cell)
  const range = nodeRange(g, box)
  if (!range) return null
  const w = range.i1 - range.i0 + 1, h = range.j1 - range.j0 + 1
  const d = new Float32Array(w * h).fill(Infinity)
  const field: Field = { i0: range.i0, j0: range.j0, w, h, d }
  if (shape.k === 'path') {
    const at = wantAt ? new Float32Array(w * h) : undefined
    field.at = at
    pathInto(g, field, shape.pts, shape.r, reach)
  } else {
    areaInto(g, field, shape.ring, reach)
  }
  return field
}

/** Writes a path's distance (minus its radius) into a field, segment by segment, keeping the nearest. */
function pathInto(g: GridSpec, f: Field, pts: ArrayLike<number>, r: number, reach: number): void {
  const p = pts.length >= 4 ? pts : [pts[0], pts[1], pts[0] + 1e-4, pts[1]]
  const pad = r + reach + g.cell
  let along = 0
  for (let k = 0; k + 3 < p.length; k += 2) {
    const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3]
    const dx = bx - ax, dz = bz - az
    const l2 = dx * dx + dz * dz
    const len = Math.sqrt(l2)
    const i0 = Math.max(f.i0, Math.floor((Math.min(ax, bx) - pad - g.x0) / g.cell)), i1 = Math.min(f.i0 + f.w - 1, Math.ceil((Math.max(ax, bx) + pad - g.x0) / g.cell))
    const j0 = Math.max(f.j0, Math.floor((Math.min(az, bz) - pad - g.z0) / g.cell)), j1 = Math.min(f.j0 + f.h - 1, Math.ceil((Math.max(az, bz) + pad - g.z0) / g.cell))
    for (let j = j0; j <= j1; j++) {
      const z = g.z0 + j * g.cell
      for (let i = i0; i <= i1; i++) {
        const x = g.x0 + i * g.cell
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0
        const dist = Math.hypot(x - ax - dx * t, z - az - dz * t) - r
        const o = (j - f.j0) * f.w + (i - f.i0)
        if (dist < f.d[o]) {
          f.d[o] = dist
          if (f.at) f.at[o] = along + t * len
        }
      }
    }
    along += len
  }
}

/** Writes an area's signed distance into a field: inside by scanline, the distance only within `reach` of an edge. */
function areaInto(g: GridSpec, f: Field, ring: ArrayLike<number>, reach: number): void {
  const n = ring.length / 2
  if (n < 3) return
  const inside = new Uint8Array(f.w * f.h)
  const xs: number[] = []
  for (let jj = 0; jj < f.h; jj++) {
    const z = g.z0 + (f.j0 + jj) * g.cell
    xs.length = 0
    for (let a = 0, b = n - 1; a < n; b = a++) {
      const za = ring[a * 2 + 1], zb = ring[b * 2 + 1]
      if (za > z !== zb > z) xs.push(ring[a * 2] + ((z - za) * (ring[b * 2] - ring[a * 2])) / (zb - za))
    }
    xs.sort((p, q) => p - q)
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const from = Math.max(0, Math.ceil((xs[s] - g.x0) / g.cell) - f.i0)
      const to = Math.min(f.w - 1, Math.floor((xs[s + 1] - g.x0) / g.cell) - f.i0)
      for (let ii = from; ii <= to; ii++) inside[jj * f.w + ii] = 1
    }
  }
  for (let o = 0; o < inside.length; o++) f.d[o] = inside[o] ? -Infinity : Infinity
  const pad = reach + g.cell
  for (let a = 0, b = n - 1; a < n; b = a++) {
    const ax = ring[b * 2], az = ring[b * 2 + 1], bx = ring[a * 2], bz = ring[a * 2 + 1]
    const i0 = Math.max(f.i0, Math.floor((Math.min(ax, bx) - pad - g.x0) / g.cell)), i1 = Math.min(f.i0 + f.w - 1, Math.ceil((Math.max(ax, bx) + pad - g.x0) / g.cell))
    const j0 = Math.max(f.j0, Math.floor((Math.min(az, bz) - pad - g.z0) / g.cell)), j1 = Math.min(f.j0 + f.h - 1, Math.ceil((Math.max(az, bz) + pad - g.z0) / g.cell))
    for (let j = j0; j <= j1; j++) {
      const z = g.z0 + j * g.cell
      for (let i = i0; i <= i1; i++) {
        const o = (j - f.j0) * f.w + (i - f.i0)
        const dist = distToSegment(g.x0 + i * g.cell, z, ax, az, bx, bz)
        if (dist > reach + g.cell) continue
        if (inside[o]) { if (-dist > f.d[o]) f.d[o] = -dist }
        else if (dist < f.d[o]) f.d[o] = dist
      }
    }
  }
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1)))
  return t * t * (3 - 2 * t)
}

/** How much of an edit a node gets at signed distance `d` from its shape with a fade of `falloff` metres. */
export function weightAt(d: number, falloff: number): number {
  if (d <= 0) return 1
  if (falloff <= 0 || d >= falloff) return 0
  return 1 - smoothstep(0, falloff, d)
}

// ---------------------------------------------------------------- deterministic randomness

/** A string hashed to 32 bits (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** A small seeded random source (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function lattice(seed: number, i: number, j: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + seed) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise in -1..1, three octaves, feature size `size` metres. */
export function noise2(seed: number, x: number, z: number, size: number): number {
  let sum = 0, amp = 1, norm = 0, s = size
  for (let o = 0; o < 3; o++) {
    const fx = x / s, fz = z / s
    const i = Math.floor(fx), j = Math.floor(fz)
    const u = fx - i, v = fz - j
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v)
    const a = lattice(seed + o * 101, i, j), b = lattice(seed + o * 101, i + 1, j), c = lattice(seed + o * 101, i, j + 1), d = lattice(seed + o * 101, i + 1, j + 1)
    sum += amp * ((a + (b - a) * su) * (1 - sv) + (c + (d - c) * su) * sv)
    norm += amp
    amp *= 0.5
    s *= 0.5
  }
  return (sum / norm) * 2 - 1
}

export type { Flat }
