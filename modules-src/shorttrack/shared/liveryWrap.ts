/**
 * Seamless livery wrapping for Short Track Showdown cars (the stock car and every custom body).
 *
 * The Garage livery is drawn as five flat projections in the stock car's atlas (`L`/`R` sides, `T` top,
 * `B` back, `F` front; see `carRepaint.ts`). A body panel can only show one projection per texel, so
 * where a panel curves from the side into the top or the ends the art used to switch abruptly along
 * jagged face edges: stripes stopped short, the deck and nose colours spilled down the quarters and a
 * logo crossing the change was cut in half.
 *
 * This file paints every texel from its 3D point instead:
 * - Base paint (colours, bands, stripes, flames) picks its projection from the smooth surface normal
 *   with a narrow blend and a bias toward the sides, so the outline between side and top/end art is a
 *   clean curve that follows the body's shoulders instead of the triangle edges.
 * - Decals (sponsor logos, lettering, painted-on numbers) are projected like a real decal projector:
 *   every texel facing the projection and on the outer surface gets them, whichever atlas region it
 *   lives in, so a logo runs over a seam in one piece.
 * - `fitDecal` moves and, if it has to, shrinks a side decal so it sits on painted body panel rather
 *   than over a wheel opening, a window or off the end of the car.
 *
 * Everything is computed from the car's own geometry, so it works for the stock car and for any body
 * the admin uploads later. Renderer-free (plain arrays) so the game, the admin preview and the tests
 * share it. All positions here are in the livery frame: stock-car metres, the frame the regions use.
 */
import type { Bounds, LiveryRegion, Pixels } from './carRepaint'

export type Vec3 = [number, number, number]
export type RegionName = 'L' | 'R' | 'T' | 'B' | 'F'

/** One mesh (or part of one) in the livery frame. `paint` marks surfaces that wear the livery. */
export type GeoPart = { positions: ArrayLike<number>; normals?: ArrayLike<number> | null; index: ArrayLike<number> | null; paint: boolean }

/** The outermost surface seen along one projection, on a grid of `cell` metres over the region's extent. */
export type ProjMap = {
  name: RegionName; uAxis: number; vAxis: number; wAxis: number; sign: 1 | -1
  umin: number; vmin: number; nu: number; nv: number; cell: number
  /** Outermost `sign * p[wAxis]` per cell (-Infinity where nothing is hit). */
  depth: Float32Array
  /** 1 where the outermost hit is painted body facing this projection (logos can sit there). */
  paint: Uint8Array
  /** `depth` widened to the deepest of each cell and its eight neighbours, so steep panels aren't cut by the grid. */
  outer: Float32Array
}

/** Geometry facts the wrap needs: one map per projection plus the body's extent. */
export type LiveryGeo = { maps: Partial<Record<RegionName, ProjMap>>; bounds: Bounds }

/** Which way each projection looks at the body: the axis it runs along and the side it sees. */
const FACING: Record<RegionName, { w: number; sign: 1 | -1 }> = { L: { w: 2, sign: -1 }, R: { w: 2, sign: 1 }, T: { w: 1, sign: 1 }, F: { w: 0, sign: 1 }, B: { w: 0, sign: -1 } }

/** Fixed order of the five projections in per-point weight arrays. */
export const PLAN_ORDER: RegionName[] = ['L', 'R', 'T', 'B', 'F']
const PLAN_INDEX: Record<RegionName, number> = { L: 0, R: 1, T: 2, B: 3, F: 4 }
/** Decals are laid top, back, front, then the sides, so side logos end up on top where they meet. */
const DECAL_SLOTS = [2, 3, 4, 0, 1]

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** Livery-frame bounds of a set of parts. */
function partsBounds(parts: GeoPart[]): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = p.positions[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v
  }
  return { min, max }
}

/**
 * Rasterizes the parts along every region's projection (outermost surface per cell). `cell` is the grid
 * size in metres; 2 cm keeps the stock car's maps under 25k cells each.
 */
export function buildLiveryGeo(parts: GeoPart[], regions: LiveryRegion[], cell = 0.02): LiveryGeo {
  const bounds = partsBounds(parts), maps: LiveryGeo['maps'] = {}
  for (const r of regions) {
    const f = FACING[r.name as RegionName]
    if (!f) continue
    const umin = Math.min(r.u0, r.u1, bounds.min[r.uAxis]) - cell, umax = Math.max(r.u0, r.u1, bounds.max[r.uAxis]) + cell
    const vmin = Math.min(r.v0, r.v1, bounds.min[r.vAxis]) - cell, vmax = Math.max(r.v0, r.v1, bounds.max[r.vAxis]) + cell
    const nu = Math.max(1, Math.ceil((umax - umin) / cell)), nv = Math.max(1, Math.ceil((vmax - vmin) / cell))
    const m: ProjMap = { name: r.name as RegionName, uAxis: r.uAxis, vAxis: r.vAxis, wAxis: f.w, sign: f.sign, umin, vmin, nu, nv, cell, depth: new Float32Array(nu * nv).fill(-Infinity), paint: new Uint8Array(nu * nv), outer: new Float32Array(nu * nv) }
    for (const part of parts) rasterProj(m, part)
    for (let v = 0; v < nv; v++) for (let u = 0; u < nu; u++) {
      let o = -Infinity
      for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) {
        const uu = u + du, vv = v + dv
        if (uu >= 0 && vv >= 0 && uu < nu && vv < nv) { const d = m.depth[vv * nu + uu]; if (d > o) o = d }
      }
      m.outer[v * nu + u] = o
    }
    maps[m.name] = m
  }
  return { maps, bounds }
}

function rasterProj(m: ProjMap, part: GeoPart) {
  const pos = part.positions, idx = part.index, n = idx ? idx.length : pos.length / 3
  const U = [0, 0, 0], V = [0, 0, 0], Wd = [0, 0, 0]
  for (let t = 0; t + 2 < n; t += 3) {
    const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2
    const vs = [a, b, c]
    for (let k = 0; k < 3; k++) {
      const o = vs[k] * 3
      U[k] = (pos[o + m.uAxis] - m.umin) / m.cell - 0.5; V[k] = (pos[o + m.vAxis] - m.vmin) / m.cell - 0.5; Wd[k] = m.sign * pos[o + m.wAxis]
    }
    // the face's facing toward this projection, for the paint flag
    const ax = pos[b * 3] - pos[a * 3], ay = pos[b * 3 + 1] - pos[a * 3 + 1], az = pos[b * 3 + 2] - pos[a * 3 + 2]
    const bx = pos[c * 3] - pos[a * 3], by = pos[c * 3 + 1] - pos[a * 3 + 1], bz = pos[c * 3 + 2] - pos[a * 3 + 2]
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, nl = Math.hypot(nx, ny, nz) || 1
    const facing = Math.abs([nx, ny, nz][m.wAxis]) / nl
    const paint = part.paint && facing >= 0.4 ? 1 : 0
    const d = (U[1] - U[0]) * (V[2] - V[0]) - (U[2] - U[0]) * (V[1] - V[0])
    const x0 = Math.max(0, Math.ceil(Math.min(U[0], U[1], U[2]))), x1 = Math.min(m.nu - 1, Math.floor(Math.max(U[0], U[1], U[2])))
    const y0 = Math.max(0, Math.ceil(Math.min(V[0], V[1], V[2]))), y1 = Math.min(m.nv - 1, Math.floor(Math.max(V[0], V[1], V[2])))
    if (Math.abs(d) < 1e-9) {
      // edge-on to this projection: still occludes the cells it crosses at its outermost point
      if (x1 - x0 > 3 || y1 - y0 > 3) continue
      const w = Math.max(Wd[0], Wd[1], Wd[2])
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * m.nu + x; if (w > m.depth[i]) { m.depth[i] = w; m.paint[i] = 0 } }
      continue
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const b1 = ((x - U[0]) * (V[2] - V[0]) - (U[2] - U[0]) * (y - V[0])) / d
      const b2 = ((U[1] - U[0]) * (y - V[0]) - (x - U[0]) * (V[1] - V[0])) / d
      const b0 = 1 - b1 - b2
      if (b0 < -1e-4 || b1 < -1e-4 || b2 < -1e-4) continue
      const w = b0 * Wd[0] + b1 * Wd[1] + b2 * Wd[2], i = y * m.nu + x
      if (w > m.depth[i]) { m.depth[i] = w; m.paint[i] = paint }
    }
  }
}

/** Disc triangles standing in for a wheel (custom bodies get the stock wheels added at run time). */
export function wheelOccluder(x: number, y: number, z: number, radius: number, segments = 24): GeoPart {
  const positions: number[] = [x, y, z], index: number[] = []
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    positions.push(x + Math.cos(a) * radius, y + Math.sin(a) * radius, z)
    if (i) index.push(0, i, i + 1)
  }
  return { positions, index, paint: false }
}

// ---------------------------------------------------------------- decal fitting

type Rect = { x: number; y: number; w: number; h: number }

/** Summed-area table of the paintable cells of a side map (blocked rectangles cleared). */
function sideTable(m: ProjMap, blocked: Rect[]) {
  const { nu, nv } = m, sat = new Float64Array((nu + 1) * (nv + 1))
  const free = Uint8Array.from(m.paint)
  for (const r of blocked) {
    const x0 = Math.max(0, Math.floor((r.x - r.w / 2 - m.umin) / m.cell)), x1 = Math.min(nu - 1, Math.ceil((r.x + r.w / 2 - m.umin) / m.cell))
    const y0 = Math.max(0, Math.floor((r.y - r.h / 2 - m.vmin) / m.cell)), y1 = Math.min(nv - 1, Math.ceil((r.y + r.h / 2 - m.vmin) / m.cell))
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) free[y * nu + x] = 0
  }
  for (let y = 0; y < nv; y++) {
    let row = 0
    for (let x = 0; x < nu; x++) { row += free[y * nu + x]; sat[(y + 1) * (nu + 1) + x + 1] = sat[y * (nu + 1) + x + 1] + row }
  }
  return sat
}

/** Fraction of a rectangle (metres) that is paintable panel. */
function coverage(m: ProjMap, sat: Float64Array, r: Rect) {
  const nu1 = m.nu + 1
  const fx0 = (r.x - r.w / 2 - m.umin) / m.cell, fx1 = (r.x + r.w / 2 - m.umin) / m.cell
  const fy0 = (r.y - r.h / 2 - m.vmin) / m.cell, fy1 = (r.y + r.h / 2 - m.vmin) / m.cell
  const x0 = Math.round(fx0), x1 = Math.round(fx1), y0 = Math.round(fy0), y1 = Math.round(fy1)
  if (x0 < 0 || y0 < 0 || x1 > m.nu || y1 > m.nv || x1 <= x0 || y1 <= y0) return 0
  const s = sat[y1 * nu1 + x1] - sat[y0 * nu1 + x1] - sat[y1 * nu1 + x0] + sat[y0 * nu1 + x0]
  return s / ((x1 - x0) * (y1 - y0))
}

export type DecalFit = { x: number; y: number; k: number }

/**
 * Where a side decal (centre x/y and size in metres on side `side`) should go so it sits on painted
 * body panel: unchanged when at least 98% of it already does, otherwise the nearest spot (within
 * `reach` metres along the car and a third of that up or down) at the largest size from 100% down to
 * 55% that fits, never over a `blocked` rectangle (the race numbers). Without a map it is unchanged.
 */
export function fitDecal(geo: LiveryGeo | null, side: 'L' | 'R', x: number, y: number, w: number, h: number, blocked: Rect[] = [], reach = 0.7): DecalFit {
  const m = geo?.maps[side]
  if (!m || !(w > 0) || !(h > 0)) return { x, y, k: 1 }
  const sat = sideTable(m, blocked), need = 0.98
  if (coverage(m, sat, { x, y, w, h }) >= need) return { x, y, k: 1 }
  let best: DecalFit & { score: number } = { x, y, k: 1, score: -Infinity }
  const step = Math.max(m.cell, 0.03)
  for (const k of [1, 0.92, 0.85, 0.78, 0.7, 0.62, 0.55]) {
    let found = false
    for (let dy = 0; dy <= reach / 3 + 1e-9; dy += step) for (const sy of dy ? [-1, 1] : [1])
      for (let dx = 0; dx <= reach + 1e-9; dx += step) for (const sx of dx ? [-1, 1] : [1]) {
        const r = { x: x + sx * dx, y: y + sy * dy, w: w * k, h: h * k }, c = coverage(m, sat, r)
        // full coverage first, then the least movement; partial coverage only as a last resort
        const score = c >= need ? 10 - Math.hypot(dx, dy * 2) : c - 1
        if (score > best.score) best = { x: r.x, y: r.y, k, score }
        if (c >= need) found = true
      }
    if (found) break
  }
  return { x: best.x, y: best.y, k: best.k }
}

// ---------------------------------------------------------------- painting texels

export type WrapCtx = {
  regions: Map<string, LiveryRegion>
  /** The livery's base paint (no decals), in the atlas layout. */
  base: Pixels
  /** Decals only (transparent elsewhere), same layout; null when there are none. */
  decals: Pixels | null
  geo: LiveryGeo | null
  mid: Vec3
  /** Lowest y that can take top (hood, roof, deck) art. */
  high: number
}

export function wrapContext(o: { regions: LiveryRegion[]; base: Pixels; decals: Pixels | null; geo: LiveryGeo | null; bounds: Bounds }): WrapCtx {
  const b = o.bounds
  return {
    regions: new Map(o.regions.map(r => [r.name, r])), base: o.base, decals: o.decals, geo: o.geo,
    mid: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2], high: b.min[1] + (b.max[1] - b.min[1]) * 0.35,
  }
}

/** Sharpness of the change between projections and how strongly the sides win on rounded shoulders. */
const SIDE_BIAS = 1.4, END_BIAS = 1.0
/** x^12 (the sharpness of the change between projections) by squaring. */
const sharp = (x: number) => { const a = x * x, b = a * a; return b * b * b }

/**
 * Base-paint weights for a point: side, end and top from the smooth normal, sharpened so the change is
 * a narrow, clean line. The side and end are picked by where the point is (not the winding), so
 * flipped faces in scanned or generated models still get the right side's art.
 */
export function baseWeights(ctx: WrapCtx, p: ArrayLike<number>, n: ArrayLike<number>): [RegionName, number][] {
  const side: RegionName = p[2] >= ctx.mid[2] ? 'R' : 'L', end: RegionName = p[0] >= ctx.mid[0] ? 'F' : 'B'
  const ws = sharp(Math.min(1, Math.abs(n[2]) * SIDE_BIAS)), we = sharp(Math.min(1, Math.abs(n[0]) * END_BIAS))
  const wt = p[1] > ctx.high ? sharp(Math.abs(n[1])) : 0
  const sum = ws + we + wt
  if (sum < 1e-9) {
    const ax = Math.abs(n[0]), az = Math.abs(n[2])
    return [[az >= ax * 0.8 ? side : end, 1]]
  }
  const out: [RegionName, number][] = []
  if (ws / sum > 0.004) out.push([side, ws / sum])
  if (we / sum > 0.004) out.push([end, we / sum])
  if (wt / sum > 0.004) out.push(['T', wt / sum])
  const total = out.reduce((a, [, w]) => a + w, 0)
  for (const e of out) e[1] /= total
  return out
}

/** `baseWeights` into a reused array in `PLAN_ORDER` (L, R, T, B, F), without allocating. */
function baseWeightsInto(ctx: WrapCtx, p: ArrayLike<number>, n: ArrayLike<number>, out: Float64Array) {
  out[0] = out[1] = out[2] = out[3] = out[4] = 0
  const si = p[2] >= ctx.mid[2] ? 1 : 0, ei = p[0] >= ctx.mid[0] ? 4 : 3
  const ws = sharp(Math.min(1, Math.abs(n[2]) * SIDE_BIAS)), we = sharp(Math.min(1, Math.abs(n[0]) * END_BIAS))
  const wt = p[1] > ctx.high ? sharp(Math.abs(n[1])) : 0
  const sum = ws + we + wt
  if (sum < 1e-9) { out[Math.abs(n[2]) >= Math.abs(n[0]) * 0.8 ? si : ei] = 1; return out }
  const a = ws / sum > 0.004 ? ws : 0, b = we / sum > 0.004 ? we : 0, c = wt / sum > 0.004 ? wt : 0, t = a + b + c
  out[si] = a / t; out[ei] = b / t; out[2] = c / t
  return out
}

/** How strongly a decal projected by `name` lands on a point (0–1): facing it and on the outer surface. */
export function decalWeight(ctx: WrapCtx, name: RegionName, p: ArrayLike<number>, n: ArrayLike<number>) {
  const f = FACING[name]
  if (name === 'L' || name === 'R') { if ((p[2] >= ctx.mid[2] ? 'R' : 'L') !== name) return 0 }
  else if (name === 'F' || name === 'B') { if ((p[0] >= ctx.mid[0] ? 'F' : 'B') !== name) return 0 }
  else if (p[1] <= ctx.high) return 0
  const facing = Math.abs(n[f.w])
  const k = smooth(0.28, 0.5, facing)
  if (k <= 0) return 0
  const m = ctx.geo?.maps[name]
  if (!m) return k
  const u = Math.floor((p[m.uAxis] - m.umin) / m.cell), v = Math.floor((p[m.vAxis] - m.vmin) / m.cell)
  if (u < 0 || v < 0 || u >= m.nu || v >= m.nv) return k
  const outer = m.outer[v * m.nu + u]
  if (outer === -Infinity) return k
  const tan = Math.sqrt(Math.max(0, 1 - facing * facing)) / Math.max(facing, 0.28)
  const tol = 0.03 + m.cell * 1.5 * tan
  return f.sign * p[f.w] >= outer - tol ? k : 0
}

/** Atlas texel coordinates (0–W, 0–H) of point `p` in region `r`, or null outside it when `strict`. */
function regionPx(r: LiveryRegion, p: ArrayLike<number>, W: number, H: number, strict: boolean): [number, number] | null {
  let fu = (p[r.uAxis] - r.u0) / (r.u1 - r.u0), fv = (p[r.vAxis] - r.v0) / (r.v1 - r.v0)
  if (strict && (fu < 0 || fu > 1 || fv < 0 || fv > 1)) return null
  fu = Math.min(0.998, Math.max(0.002, fu)); fv = Math.min(0.998, Math.max(0.002, fv))
  const [rx, ry, rw, rh] = r.rect
  // stay on texels wholly inside the region, so bilinear sampling never reads the gutter around it
  const x = (rx + fu * rw) * W - 0.5, y = (ry + fv * rh) * H - 0.5
  return [Math.min(Math.floor((rx + rw) * W) - 1, Math.max(Math.ceil(rx * W), x)), Math.min(Math.floor((ry + rh) * H) - 1, Math.max(Math.ceil(ry * H), y))]
}

/** Bilinear RGBA sample into `out` (0–255). */
function sample(px: Pixels, x: number, y: number, out: number[]) {
  const W = px.width, H = px.height, d = px.data
  x = Math.min(W - 1, Math.max(0, x)); y = Math.min(H - 1, Math.max(0, y))
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = x - x0, fy = y - y0
  const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4, i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4
  for (let c = 0; c < 4; c++) out[c] = (d[i00 + c] * (1 - fx) + d[i10 + c] * fx) * (1 - fy) + (d[i01 + c] * (1 - fx) + d[i11 + c] * fx) * fy
}

const tmp = [0, 0, 0, 0]

/** The finished livery colour (RGB 0–255) at a point with smooth normal `n` (unit length). */
export function texelColor(ctx: WrapCtx, p: ArrayLike<number>, n: ArrayLike<number>, out: number[]) {
  return shade(ctx, p, weighInto(ctx, p, n, WB, WD), out)
}

const WB = new Float64Array(5), WD = new Float64Array(5)

/**
 * Base weights (`wb`) and decal strengths (`wd`) of a point in `PLAN_ORDER`, into reused arrays. Geometry
 * only, so callers can keep them. The strongest decal strength is also how visible the point is from outside:
 * inner panels and the inside of the shell score 0.
 */
export function weighInto(ctx: WrapCtx, p: ArrayLike<number>, n: ArrayLike<number>, wb: Float64Array, wd: Float64Array) {
  baseWeightsInto(ctx, p, n, wb)
  for (let j = 0; j < 5; j++) wd[j] = decalWeight(ctx, PLAN_ORDER[j], p, n)
  return wb
}

/** Paints a point from its weights (`weighInto`) into `out` (RGB 0–255). */
export function shade(ctx: WrapCtx, p: ArrayLike<number>, wb: ArrayLike<number>, out: number[], wd: ArrayLike<number> = WD) {
  let r = 0, g = 0, b = 0, sum = 0
  const B = ctx.base, D = ctx.decals
  for (let k = 0; k < 5; k++) {
    const w = wb[k], reg = ctx.regions.get(PLAN_ORDER[k])
    if (!(w > 0) || !reg) continue
    const at = regionPx(reg, p, B.width, B.height, false)!
    sample(B, at[0], at[1], tmp)
    r += tmp[0] * w; g += tmp[1] * w; b += tmp[2] * w; sum += w
  }
  if (sum) { r /= sum; g /= sum; b /= sum }
  if (D) for (const k of DECAL_SLOTS) {
    const s = wd[k], reg = ctx.regions.get(PLAN_ORDER[k])
    if (!(s > 0) || !reg) continue
    const at = regionPx(reg, p, D.width, D.height, true)
    if (!at) continue
    sample(D, at[0], at[1], tmp)
    const a = (tmp[3] / 255) * s
    if (a <= 0.002) continue
    r += (tmp[0] - r) * a; g += (tmp[1] - g) * a; b += (tmp[2] - b) * a
  }
  out[0] = r; out[1] = g; out[2] = b
  return out
}

// ---------------------------------------------------------------- atlas-layout bodies

/** A body whose UVs point into the livery atlas itself (the stock car, untextured custom parts). */
export type AtlasPart = { positions: ArrayLike<number>; normals: ArrayLike<number> | null; uvs: ArrayLike<number>; index: ArrayLike<number> | null }

/** Texels of an atlas-layout body that need painting from 3D, worked out once per body and size. */
export type AtlasPlan = {
  width: number; height: number; texel: Int32Array; pos: Float32Array
  /** Per texel and region (`PLAN_ORDER`): base-paint weight and decal strength, 0–255 (geometry only, so worked out once). */
  base: Uint8Array; decal: Uint8Array
  grow: Int32Array
}



/**
 * Finds the texels where the flat atlas art would be wrong: wherever the smooth normal blends into
 * another projection, a decal from another projection lands, or the texel is hidden from its own
 * projection (inner panels share atlas space with the outer ones and must not take their logos).
 * Everything else already shows exactly what its region drew, so repainting skips it.
 * Overlapping triangles keep the outermost one, the surface you see.
 */
export function planAtlas(parts: AtlasPart[], regions: LiveryRegion[], geo: LiveryGeo | null, bounds: Bounds, width: number, height: number): AtlasPlan {
  const W = width, H = height, N = W * H
  const ctx = wrapContext({ regions, base: { width: 1, height: 1, data: new Uint8ClampedArray(4) }, decals: null, geo, bounds })
  const rects = regions.map(r => ({ r, f: FACING[r.name as RegionName], x0: r.rect[0] * W, y0: r.rect[1] * H, x1: (r.rect[0] + r.rect[2]) * W, y1: (r.rect[1] + r.rect[3]) * H }))
  const ownerOf = new Int8Array(N).fill(-1)
  for (let k = 0; k < rects.length; k++) {
    const e = rects[k]
    for (let y = Math.max(0, Math.floor(e.y0)); y < Math.min(H, Math.ceil(e.y1)); y++) for (let x = Math.max(0, Math.floor(e.x0)); x < Math.min(W, Math.ceil(e.x1)); x++)
      if (x + 0.5 >= e.x0 && x + 0.5 < e.x1 && y + 0.5 >= e.y0 && y + 0.5 < e.y1) ownerOf[y * W + x] = k
  }
  // Pass 1: which triangle owns each texel (the outermost along its region's projection).
  const prio = new Float32Array(N).fill(-Infinity), winner = new Int32Array(N).fill(-1)
  const starts: number[] = []
  let total = 0
  for (const part of parts) { starts.push(total); total += Math.floor((part.index ? part.index.length : part.positions.length / 3) / 3) }
  const tx = [0, 0, 0], ty = [0, 0, 0], vi = [0, 0, 0]
  const corners = (part: AtlasPart, t: number) => {
    const idx = part.index, uv = part.uvs
    for (let k = 0; k < 3; k++) { const v = idx ? idx[t * 3 + k] : t * 3 + k; vi[k] = v; tx[k] = uv[v * 2] * W - 0.5; ty[k] = uv[v * 2 + 1] * H - 0.5 }
    return (tx[1] - tx[0]) * (ty[2] - ty[0]) - (tx[2] - tx[0]) * (ty[1] - ty[0])
  }
  const bary = (x: number, y: number, d: number, out: number[]) => {
    out[1] = ((x - tx[0]) * (ty[2] - ty[0]) - (tx[2] - tx[0]) * (y - ty[0])) / d
    out[2] = ((tx[1] - tx[0]) * (y - ty[0]) - (x - tx[0]) * (ty[1] - ty[0])) / d
    out[0] = 1 - out[1] - out[2]
    return out[0] >= -1e-4 && out[1] >= -1e-4 && out[2] >= -1e-4
  }
  const bc = [0, 0, 0]
  parts.forEach((part, pi) => {
    const pos = part.positions, count = Math.floor((part.index ? part.index.length : pos.length / 3) / 3)
    for (let t = 0; t < count; t++) {
      const d = corners(part, t)
      if (Math.abs(d) < 1e-9) continue
      const x0 = Math.max(0, Math.floor(Math.min(tx[0], tx[1], tx[2]))), x1 = Math.min(W - 1, Math.ceil(Math.max(tx[0], tx[1], tx[2])))
      const y0 = Math.max(0, Math.floor(Math.min(ty[0], ty[1], ty[2]))), y1 = Math.min(H - 1, Math.ceil(Math.max(ty[0], ty[1], ty[2])))
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (!bary(x, y, d, bc)) continue
        const i = y * W + x, o = ownerOf[i], f = o >= 0 ? rects[o].f : null
        const pr = f ? f.sign * (bc[0] * pos[vi[0] * 3 + f.w] + bc[1] * pos[vi[1] * 3 + f.w] + bc[2] * pos[vi[2] * 3 + f.w]) : 0
        if (pr < prio[i]) continue
        prio[i] = pr; winner[i] = starts[pi] + t
      }
    }
  })
  // Pass 2: the winner's point and smooth normal at each texel; keep the texels the flat art gets wrong.
  const list: number[] = [], P: number[] = [], BW: number[] = [], DK: number[] = [], need = new Uint8Array(N)
  const p = [0, 0, 0], n = [0, 0, 0], wb = new Float64Array(5), wd = new Float64Array(5)
  parts.forEach((part, pi) => {
    const pos = part.positions, nor = part.normals, count = Math.floor((part.index ? part.index.length : pos.length / 3) / 3)
    for (let t = 0; t < count; t++) {
      const d = corners(part, t), id = starts[pi] + t
      if (Math.abs(d) < 1e-9) continue
      const x0 = Math.max(0, Math.floor(Math.min(tx[0], tx[1], tx[2]))), x1 = Math.min(W - 1, Math.ceil(Math.max(tx[0], tx[1], tx[2])))
      const y0 = Math.max(0, Math.floor(Math.min(ty[0], ty[1], ty[2]))), y1 = Math.min(H - 1, Math.ceil(Math.max(ty[0], ty[1], ty[2])))
      let fn: Vec3 | null = null
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * W + x
        if (winner[i] !== id || !bary(x, y, d, bc)) continue
        winner[i] = -2   // done (a texel exactly on a shared edge is taken once)
        const a0 = vi[0] * 3, a1 = vi[1] * 3, a2 = vi[2] * 3
        p[0] = bc[0] * pos[a0] + bc[1] * pos[a1] + bc[2] * pos[a2]
        p[1] = bc[0] * pos[a0 + 1] + bc[1] * pos[a1 + 1] + bc[2] * pos[a2 + 1]
        p[2] = bc[0] * pos[a0 + 2] + bc[1] * pos[a1 + 2] + bc[2] * pos[a2 + 2]
        let l = 0
        if (nor) {
          n[0] = bc[0] * nor[a0] + bc[1] * nor[a1] + bc[2] * nor[a2]
          n[1] = bc[0] * nor[a0 + 1] + bc[1] * nor[a1 + 1] + bc[2] * nor[a2 + 1]
          n[2] = bc[0] * nor[a0 + 2] + bc[1] * nor[a1 + 2] + bc[2] * nor[a2 + 2]
          l = Math.hypot(n[0], n[1], n[2])
        }
        if (l > 1e-6) { n[0] /= l; n[1] /= l; n[2] /= l }
        else { fn = fn || faceNormal(pos, vi[0], vi[1], vi[2]); n[0] = fn[0]; n[1] = fn[1]; n[2] = fn[2] }
        const o = ownerOf[i]
        weighInto(ctx, p, n, wb, wd)
        let pure = o >= 0
        if (pure) {
          const oi = PLAN_INDEX[rects[o].r.name as RegionName]
          for (let j = 0; j < 5 && pure; j++) pure = j === oi ? wb[j] > 0.996 && wd[j] >= 0.999 : wb[j] < 0.004 && wd[j] <= 0
        }
        if (!pure) {
          list.push(i); P.push(p[0], p[1], p[2]); need[i] = 1
          for (let j = 0; j < 5; j++) BW.push(Math.round(wb[j] * 255))
          for (let j = 0; j < 5; j++) DK.push(Math.round(wd[j] * 255))
        }
      }
    }
  })
  // Bleed repainted texels a few texels into the gutters so filtering at island edges never pulls in the
  // flat art from the other side of a seam.
  const grow: number[] = [], filled = new Uint8Array(N)
  for (let i = 0; i < N; i++) filled[i] = winner[i] !== -1 ? 1 : 0
  for (let pass = 0; pass < 3; pass++) {
    const add: number[] = []
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (filled[i]) continue
      const j = x > 0 && filled[i - 1] ? i - 1 : x < W - 1 && filled[i + 1] ? i + 1 : y > 0 && filled[i - W] ? i - W : y < H - 1 && filled[i + W] ? i + W : -1
      if (j >= 0) add.push(i, j)
    }
    for (let g = 0; g < add.length; g += 2) { filled[add[g]] = 1; if (need[add[g + 1]]) { need[add[g]] = 1; grow.push(add[g], add[g + 1]) } }
  }
  return { width: W, height: H, texel: Int32Array.from(list), pos: Float32Array.from(P), base: Uint8Array.from(BW), decal: Uint8Array.from(DK), grow: Int32Array.from(grow) }
}

function faceNormal(pos: ArrayLike<number>, a: number, b: number, c: number): Vec3 {
  const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2]
  const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2]
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1
  return [nx / l, ny / l, nz / l]
}

/** Repaints the planned texels of `target` (RGBA, atlas layout, already holding base + decals) in place. */
export function applyAtlas(plan: AtlasPlan, target: Pixels, ctx: WrapCtx) {
  if (target.width !== plan.width || target.height !== plan.height) throw new Error('atlas plan size')
  const d = target.data, p = [0, 0, 0], wb = new Float64Array(5), wd = new Float64Array(5), out = [0, 0, 0]
  for (let j = 0; j < plan.texel.length; j++) {
    p[0] = plan.pos[j * 3]; p[1] = plan.pos[j * 3 + 1]; p[2] = plan.pos[j * 3 + 2]
    for (let k = 0; k < 5; k++) { wb[k] = plan.base[j * 5 + k]; wd[k] = plan.decal[j * 5 + k] / 255 }
    shade(ctx, p, wb, out, wd)
    const i = plan.texel[j] * 4
    d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = 255
  }
  for (let g = 0; g < plan.grow.length; g += 2) {
    const i = plan.grow[g] * 4, s = plan.grow[g + 1] * 4
    d[i] = d[s]; d[i + 1] = d[s + 1]; d[i + 2] = d[s + 2]; d[i + 3] = d[s + 3]
  }
  return target
}

/**
 * A plan for an atlas `k` times larger (each side), made from a smaller one instead of from scratch: every
 * planned texel becomes a k×k block whose points step along the surface by the texel's own gradient (taken
 * from its planned neighbours), so seams on a crisp 2048 livery cost a quarter of planning one.
 */
export function upsamplePlan(plan: AtlasPlan, k: number): AtlasPlan {
  const W = plan.width, H = plan.height, n = plan.texel.length, W2 = W * k, H2 = H * k, kk = k * k
  const at = new Int32Array(W * H).fill(-1)
  for (let j = 0; j < n; j++) at[plan.texel[j]] = j
  const texel = new Int32Array(n * kk), pos = new Float32Array(n * kk * 3), base = new Uint8Array(n * kk * 5), decal = new Uint8Array(n * kk * 5)
  const near = 0.03
  // the step in metres for one texel along x or y, from a planned neighbour on the same surface
  const grad = (j: number, x: number, y: number, dx: number, dy: number, out: number[]) => {
    for (const s of [1, -1]) {
      const xx = x + dx * s, yy = y + dy * s
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
      const q = at[yy * W + xx]
      if (q < 0) continue
      const gx = (plan.pos[q * 3] - plan.pos[j * 3]) * s, gy = (plan.pos[q * 3 + 1] - plan.pos[j * 3 + 1]) * s, gz = (plan.pos[q * 3 + 2] - plan.pos[j * 3 + 2]) * s
      if (Math.hypot(gx, gy, gz) > near) continue
      out[0] = gx; out[1] = gy; out[2] = gz
      return
    }
    out[0] = out[1] = out[2] = 0
  }
  const gx = [0, 0, 0], gy = [0, 0, 0]
  for (let j = 0, o = 0; j < n; j++) {
    const t = plan.texel[j], x = t % W, y = (t - x) / W
    grad(j, x, y, 1, 0, gx); grad(j, x, y, 0, 1, gy)
    for (let sy = 0; sy < k; sy++) for (let sx = 0; sx < k; sx++, o++) {
      const fx = (sx + 0.5) / k - 0.5, fy = (sy + 0.5) / k - 0.5
      texel[o] = (y * k + sy) * W2 + x * k + sx
      for (let c = 0; c < 3; c++) pos[o * 3 + c] = plan.pos[j * 3 + c] + gx[c] * fx + gy[c] * fy
      base.set(plan.base.subarray(j * 5, j * 5 + 5), o * 5); decal.set(plan.decal.subarray(j * 5, j * 5 + 5), o * 5)
    }
  }
  const grow = new Int32Array(plan.grow.length * kk)
  for (let g = 0, o = 0; g < plan.grow.length; g += 2) {
    const i = plan.grow[g], s = plan.grow[g + 1], ix = i % W, iy = (i - ix) / W, sx0 = s % W, sy0 = (s - sx0) / W
    for (let sy = 0; sy < k; sy++) for (let sx = 0; sx < k; sx++) {
      grow[o++] = (iy * k + sy) * W2 + ix * k + sx
      grow[o++] = (sy0 * k + sy) * W2 + sx0 * k + sx
    }
  }
  return { width: W2, height: H2, texel, pos, base, decal, grow }
}
