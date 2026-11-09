/**
 * Puts the garage livery (paint scheme, sponsor, painted-on numbers) on any custom car body.
 *
 * The livery is drawn once in the stock Super Late Model's atlas layout (`shorttrack-car.bin`'s regions:
 * left and right sides, top, back and front, each a box projection in stock-car metres). Every
 * triangle of a custom body picks the region its normal faces, and its points are stretched from the
 * custom car's bounds onto the stock car's, so stripes, flames and logos land in the same places on
 * any shape.
 *
 * Textured bodies are baked in their own UV layout. Every texel is painted from its own 3D point
 * and smooth normal (`liveryWrap.ts`), so the art changes from side to top along clean lines and
 * logos run over seams in one piece. Each texel takes the livery colour times its
 * shading (`paintShade`): glass, tyres and grilles stay dark while the panels take a clean, even coat. Untextured bodies get new UVs into the livery atlas instead.
 *
 * Renderer-free (plain arrays and RGBA bytes) so the game, the admin preview and the tests share it.
 */

import { shade, weighInto, wrapContext } from './liveryWrap'
import type { LiveryGeo } from './liveryWrap'

export type Axis = 0 | 1 | 2
export type LiveryRegion = { name: string; rect: [number, number, number, number]; uAxis: Axis; u0: number; u1: number; vAxis: Axis; v0: number; v1: number }
export type Bounds = { min: [number, number, number]; max: [number, number, number] }
export type Pixels = { data: Uint8ClampedArray; width: number; height: number }

/** The stock car's body bounds in the livery's frame (from its regions). */
export const STOCK_BOUNDS: Bounds = { min: [-2.7352, 0.0031, -1.0952], max: [2.5727, 1.222, 1.0959] }

/** `[name, [x, y, w, h], uAxis, u0, u1, vAxis, v0, v1]` rows from the stock car asset. */
export function parseRegions(raw: unknown): LiveryRegion[] {
  if (!Array.isArray(raw)) return []
  const out: LiveryRegion[] = []
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 8 || !Array.isArray(r[1])) continue
    out.push({ name: String(r[0]), rect: r[1].map(Number) as LiveryRegion['rect'], uAxis: Number(r[2]) as Axis, u0: Number(r[3]), u1: Number(r[4]), vAxis: Number(r[5]) as Axis, v0: Number(r[6]), v1: Number(r[7]) })
  }
  return out
}

/**
 * Which region a face is painted from (car frame: +x forward, +y up, +z the driver's right). The
 * normal picks the axis it faces and the face's place on the body picks the side, so faces wound
 * the wrong way (common in scanned and generated models) still get the right side's art.
 */
export function regionFor(n: [number, number, number], c: [number, number, number], b: Bounds): 'L' | 'R' | 'T' | 'B' | 'F' {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2])
  const mid = (k: Axis) => (b.min[k] + b.max[k]) / 2
  if (ay > 0.6 * Math.max(ax, az) && ay > 0.35 && c[1] > b.min[1] + (b.max[1] - b.min[1]) * 0.35) return 'T'
  if (az >= ax * 0.8) return c[2] >= mid(2) ? 'R' : 'L'
  return c[0] >= mid(0) ? 'F' : 'B'
}

function centroid(pos: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] {
  return [(pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3]
}

/** Stretches a car-frame point from `from` bounds onto the stock car's. */
export function toStock(p: [number, number, number], from: Bounds, axis: Axis) {
  const a = from.min[axis], b = from.max[axis], s0 = STOCK_BOUNDS.min[axis], s1 = STOCK_BOUNDS.max[axis]
  return b - a > 1e-6 ? s0 + ((p[axis] - a) / (b - a)) * (s1 - s0) : (s0 + s1) / 2
}

/** Livery atlas coordinates (0–1, top-left origin) for a car-frame point painted from `region`, kept just inside it. */
export function atlasPoint(p: [number, number, number], region: LiveryRegion, from: Bounds): [number, number] {
  const [rx, ry, rw, rh] = region.rect
  const fu = (toStock(p, from, region.uAxis) - region.u0) / (region.u1 - region.u0)
  const fv = (toStock(p, from, region.vAxis) - region.v0) / (region.v1 - region.v0)
  const c = (f: number) => Math.min(0.995, Math.max(0.005, f))
  return [rx + c(fu) * rw, ry + c(fv) * rh]
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

/**
 * How bright the paint comes out on a texel, from its luminance over the body's. Dark texels
 * (glass, tyres, grilles, gaps: under 30% of the body) keep their darkness; everything brighter is
 * flattened hard so the blotches, baked-in decals and JPEG mottling of generated or scanned
 * textures don't show through the paint. The normal map still carries the panel detail.
 */
export function paintShade(l: number, ref: number) {
  const s = l / ref
  const flat = Math.min(1.12, Math.max(0.8, Math.pow(s, 0.25)))
  if (s <= 0.3) return s
  if (s >= 0.6) return flat
  const k = (s - 0.3) / 0.3
  return s + (flat - s) * k * k * (3 - 2 * k)
}

function faceNormal(pos: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] {
  const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2]
  const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2]
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1
  return [nx / l, ny / l, nz / l]
}

export function boundsOf(positions: ArrayLike<number>[]): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const pos of positions) for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = pos[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] }
  return { min: [min[0], Math.min(0, min[1]), min[2]], max }
}

/** Surface area of an indexed or plain triangle list. */
export function meshArea(pos: ArrayLike<number>, index: ArrayLike<number> | null) {
  let area = 0
  const n = index ? index.length : pos.length / 3
  for (let t = 0; t + 2 < n; t += 3) {
    const a = index ? index[t] : t, b = index ? index[t + 1] : t + 1, c = index ? index[t + 2] : t + 2
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2]
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2]
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
  }
  return area
}

/**
 * How strongly each texel takes paint (0–1): everything, or only texels near a key colour
 * (the same match as the "Everything close to a color" paint mode).
 */
export function paintWeight(key: string | null, tolerance: number) {
  if (!key) return () => 1
  const k = [1, 3, 5].map(i => parseInt(key.slice(i, i + 2), 16))
  const limit = (tolerance * 441.7) ** 2
  return (r: number, g: number, b: number) => {
    const d = (r - k[0]) ** 2 + (g - k[1]) ** 2 + (b - k[2]) ** 2
    return d > limit ? 0 : Math.min(1, (1 - d / limit) * 3)
  }
}

/**
 * The body's own shade: the median luminance (0–255) of the painted texels, ignoring near-black
 * ones (glass, tyres, shadows), so the body panels come out at exactly the driver's colour.
 */
export function bodyLuminance(px: Uint8ClampedArray, covered: Uint8Array | null, weight: (r: number, g: number, b: number) => number) {
  const hist = new Float64Array(256)
  let total = 0
  for (let i = 0, t = 0; i < px.length; i += 4, t++) {
    if (covered && !covered[t]) continue
    const w = weight(px[i], px[i + 1], px[i + 2])
    if (w <= 0) continue
    const l = Math.round(lum(px[i], px[i + 1], px[i + 2]))
    if (l < 14) continue
    hist[l] += w; total += w
  }
  if (!total) return 128
  let acc = 0
  for (let l = 0; l < 256; l++) { acc += hist[l]; if (acc >= total / 2) return Math.max(24, l) }
  return 128
}

/** Recolors a whole texture to one colour, keeping its shading (the admin preview and the no-livery fallback). */
export function tintPixels(px: Uint8ClampedArray, rgb: [number, number, number], weight: (r: number, g: number, b: number) => number, ref = bodyLuminance(px, null, weight)) {
  for (let i = 0; i < px.length; i += 4) {
    const w = weight(px[i], px[i + 1], px[i + 2])
    if (w <= 0) continue
    const s = paintShade(lum(px[i], px[i + 1], px[i + 2]), ref)
    for (let c = 0; c < 3; c++) px[i + c] = px[i + c] * (1 - w) + Math.min(255, rgb[c] * s) * w
  }
}

/** UVs outside 0–1 repeat; exactly 1 stays 1 so a chart's far edge doesn't fold back to 0. */
const wrapUv = (v: number) => (v < 0 || v > 1 ? v - Math.floor(v) : v)

export type BakePart = { positions: ArrayLike<number>; uvs: ArrayLike<number>; index: ArrayLike<number> | null; normals?: ArrayLike<number> | null }

/** Per-axis scale from a custom body's bounds onto the stock car's (normals divide by it). */
function stretchOf(from: Bounds): [number, number, number] {
  return [0, 1, 2].map(k => { const a = from.max[k] - from.min[k]; return a > 1e-6 ? (STOCK_BOUNDS.max[k] - STOCK_BOUNDS.min[k]) / a : 1 }) as [number, number, number]
}

/**
 * Car-frame positions (and normals) of a part moved into the livery frame: the stock car's metres,
 * stretched from `from` like `atlasPoint` does, so `liveryWrap.ts` can work on them directly.
 */
export function toLiveryFrame(positions: ArrayLike<number>, normals: ArrayLike<number> | null | undefined, from: Bounds) {
  const s = stretchOf(from), pos = new Float32Array(positions.length), nor = normals ? new Float32Array(normals.length) : null
  const p: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < positions.length; i += 3) {
    p[0] = positions[i]; p[1] = positions[i + 1]; p[2] = positions[i + 2]
    for (let k = 0 as Axis; k < 3; k++) pos[i + k] = toStock(p, from, k as Axis)
    if (nor && normals) {
      const x = normals[i] / s[0], y = normals[i + 1] / s[1], z = normals[i + 2] / s[2], l = Math.hypot(x, y, z) || 1
      nor[i] = x / l; nor[i + 1] = y / l; nor[i + 2] = z / l
    }
  }
  return { positions: pos, normals: nor }
}

/**
 * Bakes `livery` (the stock-layout atlas) into `texture` (in place) for every triangle of `parts`
 * that uses it. `positions` are car-frame metres, `bounds` the whole custom body's, `flipY` the
 * texture's (glTF textures are not flipped: v = 0 is the top row).
 * `fallback` is the driver's primary colour for texels no triangle covers.
 */
export function bakeLivery(o: {
  texture: Pixels; livery: Pixels; regions: LiveryRegion[]; parts: BakePart[]; bounds: Bounds; flipY: boolean
  weight: (r: number, g: number, b: number) => number; fallback: [number, number, number]
  /** Decals only (logos, lettering, numbers) in the atlas layout; projected over seams. Without it the livery's own decals are used flat. */
  decals?: Pixels | null
  /** The body's projection maps (`buildLiveryGeo`), so decals only land on the outer surface. */
  geo?: LiveryGeo | null
}) {
  const { texture: T } = o
  const W = T.width, H = T.height, n = W * H
  const liv = new Uint8ClampedArray(n * 3), covered = new Uint8Array(n)
  // where triangles share texels (mirrored or stacked UV islands, common in game models), the one seen from
  // outside paints it, so a wheel-well liner or the inside of the shell can't wipe a logo off the panel
  const seen = o.geo ? new Uint8Array(n) : null
  const ctx = wrapContext({ regions: o.regions, base: o.livery, decals: o.decals ?? null, geo: o.geo ?? null, bounds: STOCK_BOUNDS })
  const tx = [0, 0, 0], ty = [0, 0, 0], vi = [0, 0, 0], col = [0, 0, 0], p = [0, 0, 0], nn = [0, 0, 0], wb = new Float64Array(5), wd = new Float64Array(5)
  for (const part of o.parts) {
    const frame = toLiveryFrame(part.positions, part.normals, o.bounds)
    const pos = frame.positions, nor = frame.normals, uv = part.uvs, idx = part.index
    const count = idx ? idx.length : pos.length / 3
    for (let t = 0; t + 2 < count; t += 3) {
      for (let k = 0; k < 3; k++) {
        const v = idx ? idx[t + k] : t + k
        vi[k] = v
        const u = wrapUv(uv[v * 2]), w = wrapUv(uv[v * 2 + 1])
        tx[k] = u * W - 0.5; ty[k] = (o.flipY ? 1 - w : w) * H - 0.5
      }
      const d = (tx[1] - tx[0]) * (ty[2] - ty[0]) - (tx[2] - tx[0]) * (ty[1] - ty[0])
      if (Math.abs(d) < 1e-9) continue
      const fn = faceNormal(pos, vi[0], vi[1], vi[2])
      const x0 = Math.max(0, Math.floor(Math.min(tx[0], tx[1], tx[2]))), x1 = Math.min(W - 1, Math.ceil(Math.max(tx[0], tx[1], tx[2])))
      const y0 = Math.max(0, Math.floor(Math.min(ty[0], ty[1], ty[2]))), y1 = Math.min(H - 1, Math.ceil(Math.max(ty[0], ty[1], ty[2])))
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const b1 = ((x - tx[0]) * (ty[2] - ty[0]) - (tx[2] - tx[0]) * (y - ty[0])) / d
        const b2 = ((tx[1] - tx[0]) * (y - ty[0]) - (x - tx[0]) * (ty[1] - ty[0])) / d
        const b0 = 1 - b1 - b2
        if (b0 < -1e-4 || b1 < -1e-4 || b2 < -1e-4) continue
        for (let k = 0; k < 3; k++) p[k] = b0 * pos[vi[0] * 3 + k] + b1 * pos[vi[1] * 3 + k] + b2 * pos[vi[2] * 3 + k]
        let l = 0
        if (nor) {
          for (let k = 0; k < 3; k++) nn[k] = b0 * nor[vi[0] * 3 + k] + b1 * nor[vi[1] * 3 + k] + b2 * nor[vi[2] * 3 + k]
          l = Math.hypot(nn[0], nn[1], nn[2])
        }
        if (l > 1e-6) for (let k = 0; k < 3; k++) nn[k] /= l
        else { nn[0] = fn[0]; nn[1] = fn[1]; nn[2] = fn[2] }
        const ti = y * W + x
        weighInto(ctx, p, nn, wb, wd)
        if (seen) {
          const v = Math.round(Math.max(wd[0], wd[1], wd[2], wd[3], wd[4]) * 254) + 1
          if (covered[ti] && v < seen[ti]) continue
          seen[ti] = v
        }
        shade(ctx, p, wb, col, wd)
        liv[ti * 3] = col[0]; liv[ti * 3 + 1] = col[1]; liv[ti * 3 + 2] = col[2]; covered[ti] = 1
      }
    }
  }
  // Grow the painted islands a few texels so filtering at UV seams never pulls in the fallback colour.
  for (let pass = 0; pass < 3; pass++) {
    const grow: number[] = []
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (covered[i]) continue
      const j = x > 0 && covered[i - 1] === 1 ? i - 1 : x < W - 1 && covered[i + 1] === 1 ? i + 1 : y > 0 && covered[i - W] === 1 ? i - W : y < H - 1 && covered[i + W] === 1 ? i + W : -1
      if (j >= 0) grow.push(i, j)
    }
    for (let g = 0; g < grow.length; g += 2) { const i = grow[g], j = grow[g + 1]; liv[i * 3] = liv[j * 3]; liv[i * 3 + 1] = liv[j * 3 + 1]; liv[i * 3 + 2] = liv[j * 3 + 2]; covered[i] = 2 }
    for (let g = 0; g < grow.length; g += 2) covered[grow[g]] = 1
  }
  const px = T.data, ref = bodyLuminance(px, covered, o.weight)
  for (let i = 0, t = 0; i < px.length; i += 4, t++) {
    const w = o.weight(px[i], px[i + 1], px[i + 2])
    if (w <= 0) continue
    const s = paintShade(lum(px[i], px[i + 1], px[i + 2]), ref)
    for (let c = 0; c < 3; c++) {
      const paint = covered[t] ? liv[t * 3 + c] : o.fallback[c]
      px[i + c] = px[i + c] * (1 - w) + Math.min(255, paint * s) * w
    }
  }
  return T
}

/**
 * New livery-atlas UVs for an untextured body part: one region per triangle, so the geometry must be
 * non-indexed (three vertices per triangle). Returns `uv` for `positions`.
 */
export function liveryUvs(positions: ArrayLike<number>, regions: LiveryRegion[], bounds: Bounds) {
  const byName = new Map(regions.map(r => [r.name, r]))
  const out = new Float32Array((positions.length / 3) * 2)
  for (let t = 0; t + 8 < positions.length; t += 9) {
    const v = t / 3, region = byName.get(regionFor(faceNormal(positions, v, v + 1, v + 2), centroid(positions, v, v + 1, v + 2), bounds))
    if (!region) continue
    for (let k = 0; k < 3; k++) {
      const a = atlasPoint([positions[t + k * 3], positions[t + k * 3 + 1], positions[t + k * 3 + 2]], region, bounds)
      out[(v + k) * 2] = a[0]; out[(v + k) * 2 + 1] = a[1]
    }
  }
  return out
}
