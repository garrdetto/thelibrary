import { LAMP_DEPTH, LAMP_DEPTH_LIMIT, LAMP_GRID, LAMP_SIZE_LIMITS, SHAPE_LIMITS, shapeContains } from '../../../../modules-src/maplestreet/shared/Shapes'
import type { LampDepth, LampSize, Shape } from '../../../../modules-src/maplestreet/shared/Shapes'

/** A point on a straight-on view of the model, in metres: x across the picture, y down. */
export type Pt = { x: number; y: number }
export type TracedLamp = { point: { x: number; y: number; z: number }; shape: Shape; size: LampSize; depth?: LampDepth }

const PROUD = 0.012
const r3 = (v: number) => Math.round(v * 1000) / 1000

/** Where a ray along x through (z, y) meets the model: the frontmost hit for the front, the rearmost for the back. */
export function surfaceX(tris: Float32Array, z: number, y: number, front: boolean): number | null {
  let best: number | null = null
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2]
    const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5]
    const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8]
    const d = (bz - az) * (cy - ay) - (cz - az) * (by - ay)
    if (Math.abs(d) < 1e-12) continue
    const u = ((z - az) * (cy - ay) - (cz - az) * (y - ay)) / d
    const v = ((bz - az) * (y - ay) - (z - az) * (by - ay)) / d
    if (u < 0 || v < 0 || u + v > 1) continue
    const x = ax + u * (bx - ax) + v * (cx - ax)
    if (best === null || (front ? x > best : x < best)) best = x
  }
  return best
}

/** Only the triangles that can be hit by rays through this z/y box, so sampling a lamp doesn't walk the whole model each time. */
function trianglesNear(tris: Float32Array, zMin: number, zMax: number, yMin: number, yMax: number): Float32Array {
  const out: number[] = []
  for (let i = 0; i < tris.length; i += 9) {
    const z0 = Math.min(tris[i + 2], tris[i + 5], tris[i + 8]), z1 = Math.max(tris[i + 2], tris[i + 5], tris[i + 8])
    const y0 = Math.min(tris[i + 1], tris[i + 4], tris[i + 7]), y1 = Math.max(tris[i + 1], tris[i + 4], tris[i + 7])
    if (z1 < zMin || z0 > zMax || y1 < yMin || y0 > yMax) continue
    for (let k = 0; k < 9; k++) out.push(tris[i + k])
  }
  return new Float32Array(out)
}

/**
 * The body's surface under a traced lamp: a LAMP_GRID² grid of x positions
 * over the lamp's box, sampled where the grid falls inside the outline (a
 * little outside too) and filled outward from there. Null when nothing is hit.
 */
function sampleSurface(tris: Float32Array, shape: Shape, place: (u: number, v: number) => { z: number; y: number }, front: boolean): { center: number; depth: LampDepth } | null {
  const n = LAMP_GRID, cells: (number | null)[] = []
  const pad = 0.6 / (n - 1)
  const near = (u: number, v: number) => shapeContains(shape, u, v) || [[pad, 0], [-pad, 0], [0, pad], [0, -pad]].some(([du, dv]) => shapeContains(shape, u + du, v + dv))
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const u = i / (n - 1), v = j / (n - 1)
    if (!near(u, v)) { cells.push(null); continue }
    const at = place(u, v)
    cells.push(surfaceX(tris, at.z, at.y, front))
  }
  const hits = cells.filter((x): x is number => x !== null)
  if (!hits.length) return null
  const sorted = [...hits].sort((a, b) => a - b)
  const center = sorted[Math.floor(sorted.length / 2)]
  const grid = cells.map(x => x === null ? null : x - center)
  for (let pass = 0; pass < n * 2 && grid.some(x => x === null); pass++) {
    const next = [...grid]
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (grid[j * n + i] !== null) continue
      let sum = 0, count = 0
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj
        if (a < 0 || b < 0 || a >= n || b >= n) continue
        const x = grid[b * n + a]
        if (x !== null) { sum += x; count++ }
      }
      if (count) next[j * n + i] = sum / count
    }
    grid.splice(0, grid.length, ...next)
  }
  const depth = grid.map(x => Math.max(-LAMP_DEPTH_LIMIT, Math.min(LAMP_DEPTH_LIMIT, Math.round((x ?? 0) * 1000) / 1000)))
  return { center, depth }
}

/**
 * Turns an outline drawn on the front or rear view into a lamp: the outline
 * becomes the shape (on the right-hand side, mirrored in the game), its box
 * the size, the marker moves to its middle on the body's surface, and the
 * surface under it is sampled so the lens follows the body. Used by hand
 * tracing and by the automatic light finder alike.
 *
 * `tris` is the model in the ground frame; `drop` is ground y minus chassis y.
 */
export function lampFromOutline(outline: Pt[], front: boolean, tris: Float32Array, drop: number, fallbackX: number): TracedLamp | null {
  if (outline.length < SHAPE_LIMITS.minPoints || outline.length > SHAPE_LIMITS.maxPoints) return null
  const pts = outline.map(p => ({ z: front ? -p.x : p.x, y: -p.y }))
  const cz = pts.reduce((a, p) => a + p.z, 0) / pts.length
  const sign = cz < 0 ? -1 : 1
  const zs = pts.map(p => p.z * sign), ys = pts.map(p => p.y)
  const zMin = Math.min(...zs), zMax = Math.max(...zs), yMin = Math.min(...ys), yMax = Math.max(...ys)
  const w = Math.min(LAMP_SIZE_LIMITS.max, Math.max(LAMP_SIZE_LIMITS.min, zMax - zMin))
  const h = Math.min(LAMP_SIZE_LIMITS.max, Math.max(LAMP_SIZE_LIMITS.min, yMax - yMin))
  const zc = (zMin + zMax) / 2, yc = (yMin + yMax) / 2
  const unit = (n: number) => Math.min(1, Math.max(0, Math.round(n * 1000) / 1000))
  const shape = zs.map((z, i) => ({ u: unit((z - zc) / w + 0.5), v: unit((ys[i] - yc) / h + 0.5) }))
  const cyMean = ys.reduce((a, b) => a + b, 0) / ys.length
  const czMean = pts.reduce((a, p) => a + p.z, 0) / pts.length
  const local = trianglesNear(tris, Math.min(sign * zMin, sign * zMax) - w, Math.max(sign * zMin, sign * zMax) + w, yMin - h, yMax + h)
  const samples = [{ z: czMean, y: cyMean }, ...pts.map(p => ({ z: p.z + (czMean - p.z) * 0.3, y: p.y + (cyMean - p.y) * 0.3 }))]
  const hits = samples.map(s => surfaceX(local, s.z, s.y, front)).filter((x): x is number => x !== null)
  const surface = sampleSurface(local, shape, (u, v) => ({ z: sign * (zc + (u - 0.5) * w), y: yc + (v - 0.5) * h }), front)
  let x: number
  if (surface) x = surface.center
  else if (hits.length) {
    const edge = front ? Math.max(...hits) : Math.min(...hits)
    x = front ? edge - LAMP_DEPTH / 2 + PROUD : edge + LAMP_DEPTH / 2 - PROUD
  } else x = fallbackX
  return { point: { x: r3(x), y: r3(yc - drop), z: r3(Math.abs(zc) < 0.01 ? 0 : zc) }, shape, size: { w: r3(w), h: r3(h) }, ...(surface ? { depth: surface.depth } : {}) }
}
