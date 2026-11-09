/**
 * Finds the windows and the rear spoiler on a custom car body so they stay clear instead of taking
 * the driver's paint. Generated bodies come as one textured material, so the glass and the Lexan
 * spoiler are only regions of the body's texture; this marks them texel by texel.
 *
 * The body's shape is measured first (`measureGreenhouse`): the centreline roof profile gives the
 * roof, the cowl at the bottom of the windshield and the hood, and the places where the upper body
 * turns to the side give the A-pillars and the sail panels. Then every texel is placed on the body
 * through its triangle and sorted:
 * - windshield: between the roof's front edge and the cowl, inside the pillars; when the model's
 *   texture has darker glass there (generated models usually do), only the dark part;
 * - rear window: between the roof's rear edge and the deck, inside the sail panels;
 * - spoiler: the plate standing on the tail above the deck.
 *
 * Renderer-free (plain arrays and RGBA bytes) so the game and the tests share it.
 */
import type { Bounds, Pixels } from './carRepaint'

export const CLEAR_BODY = 0
export const CLEAR_GLASS = 1
export const CLEAR_SPOILER = 2

export type Greenhouse = {
  lo: [number, number, number]
  hi: [number, number, number]
  length: number
  height: number
  halfWidth: number
  zc: number
  binWidth: number
  ytop: Float64Array
  limit: Float64Array
  roofFront: number
  roofRear: number
  hoodY: number
  cowl: number
  deckY: number
}

const BINS = 64

function faceNormal(pos: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] {
  const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2]
  const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2]
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1
  return [nx / l, ny / l, nz / l]
}

const triangleCount = (pos: ArrayLike<number>, index: ArrayLike<number> | null) => Math.floor((index ? index.length : pos.length / 3) / 3)
const corner = (index: ArrayLike<number> | null, t: number, k: number) => (index ? index[t * 3 + k] : t * 3 + k)

/** The roof, cowl, pillars and deck of a body in the car frame (+x forward, +y up), or null if it has no roof to measure. */
export function measureGreenhouse(pos: ArrayLike<number>, index: ArrayLike<number> | null, b: Bounds): Greenhouse | null {
  const lo = b.min, hi = b.max
  const length = hi[0] - lo[0], height = hi[1] - Math.min(0, lo[1]), halfWidth = (hi[2] - lo[2]) / 2, zc = (hi[2] + lo[2]) / 2
  if (!(length > 0.5 && height > 0.3 && halfWidth > 0.2)) return null
  const binWidth = length / BINS
  const bin = (x: number) => Math.min(BINS - 1, Math.max(0, Math.floor((x - lo[0]) / binWidth)))
  const ytop = new Float64Array(BINS).fill(-Infinity)
  for (let i = 0; i + 2 < pos.length; i += 3) {
    if (Math.abs(pos[i + 2] - zc) > 0.3 * halfWidth) continue
    const k = bin(pos[i])
    if (pos[i + 1] > ytop[k]) ytop[k] = pos[i + 1]
  }
  for (let k = 0; k < BINS; k++) if (!Number.isFinite(ytop[k])) ytop[k] = k ? ytop[k - 1] : 0
  const xAt = (k: number) => lo[0] + (k + 0.5) * binWidth
  let top = 0
  for (let k = 1; k < BINS; k++) if (ytop[k] > ytop[top]) top = k
  const roofLine = ytop[top] - 0.04 * height
  let front = top, rear = top
  for (let k = 0; k < BINS; k++) if (ytop[k] > roofLine) { front = Math.max(front, k); rear = Math.min(rear, k) }
  const roofFront = xAt(front), roofRear = xAt(rear)
  const profile = (x: number) => {
    const f = (x - lo[0]) / binWidth - 0.5, k = Math.min(BINS - 1, Math.max(0, Math.floor(f))), t = Math.min(1, Math.max(0, f - k))
    return ytop[k] + (ytop[Math.min(BINS - 1, k + 1)] - ytop[k]) * t
  }
  const hoodY = profile(roofFront + 0.6 * (hi[0] - roofFront))
  let cowl = NaN
  for (let k = front; k < BINS; k++) if (ytop[k] < hoodY + 0.04 * height) { cowl = xAt(k); break }
  const limit = new Float64Array(BINS).fill(Infinity)
  const n = triangleCount(pos, index)
  for (let t = 0; t < n; t++) {
    const a = corner(index, t, 0), bb = corner(index, t, 1), c = corner(index, t, 2)
    const x = (pos[a * 3] + pos[bb * 3] + pos[c * 3]) / 3, y = (pos[a * 3 + 1] + pos[bb * 3 + 1] + pos[c * 3 + 1]) / 3
    const z = Math.abs((pos[a * 3 + 2] + pos[bb * 3 + 2] + pos[c * 3 + 2]) / 3 - zc)
    const nrm = faceNormal(pos, a, bb, c)
    if (Math.abs(nrm[2]) > 0.4 && z > 0.25 * halfWidth && y > hoodY && y > profile(x) - 0.2 * height) {
      const k = bin(x)
      if (z < limit[k]) limit[k] = z
    }
  }
  let deckY = Infinity
  for (let k = 0; k < BINS; k++) if (xAt(k) > lo[0] + 0.045 * length && xAt(k) < lo[0] + 0.09 * length) deckY = Math.min(deckY, ytop[k])
  if (!Number.isFinite(deckY)) deckY = NaN
  return { lo: [...lo], hi: [...hi], length, height, halfWidth, zc, binWidth, ytop, limit, roofFront, roofRear, hoodY, cowl, deckY }
}

/** 0 body, 1 windshield, 2 spoiler, 3 rear window for a point on the body with face normal `n`. */
export function regionAt(g: Greenhouse, p: [number, number, number], n: [number, number, number]) {
  const { lo, length: L, height: H, halfWidth: hw } = g
  const x = p[0], y = p[1], z = Math.abs(p[2] - g.zc)
  const f = (x - lo[0]) / g.binWidth - 0.5, k = Math.min(BINS - 1, Math.max(0, Math.floor(f))), t = Math.min(1, Math.max(0, f - k))
  const yt = g.ytop[k] + (g.ytop[Math.min(BINS - 1, k + 1)] - g.ytop[k]) * t
  if (Number.isFinite(g.deckY) && x < lo[0] + 0.06 * L && y > g.deckY + 0.01 * H) return 2
  if (y < yt - 0.1 * H || Math.abs(n[1]) < 0.2) return 0
  const lim = g.limit[Math.min(BINS - 1, Math.max(0, Math.floor((x - lo[0]) / g.binWidth)))]
  if (!Number.isFinite(lim) || z > lim - 0.04 * hw) return 0
  if (Number.isFinite(g.cowl) && x > g.roofFront - 0.02 * L && x < g.cowl + 0.01 * L && y > g.hoodY + 0.01 * H) return 1
  if (x < g.roofRear - 0.01 * L && x > lo[0] + 0.1 * L && Math.abs(n[2]) < 0.35) return 3
  return 0
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b
const wrapUv = (v: number) => (v < 0 || v > 1 ? v - Math.floor(v) : v)

export type ClearMask = {
  /** Per texel: 0 body, 1 glass, 2 spoiler. */
  mask: Uint8Array
  /** Per triangle: bit 1 it covers clear texels, bit 2 it covers body texels. */
  triangles: Uint8Array
  glass: number
  spoiler: number
}

/**
 * Marks the clear texels of a textured body. `positions` are car-frame metres, `bounds` the whole
 * body's, `flipY` the texture's. Null when the body has nothing clear to show.
 */
export function clearMask(o: { texture: Pixels; positions: ArrayLike<number>; uvs: ArrayLike<number>; index: ArrayLike<number> | null; bounds: Bounds; flipY: boolean }): ClearMask | null {
  const g = measureGreenhouse(o.positions, o.index, o.bounds)
  if (!g) return null
  const W = o.texture.width, H = o.texture.height, px = o.texture.data
  const region = new Uint8Array(W * H), owner = new Int32Array(W * H).fill(-1)
  const pos = o.positions, uv = o.uvs, n = triangleCount(pos, o.index)
  const tx = [0, 0, 0], ty = [0, 0, 0], v = [0, 0, 0]
  const p: [number, number, number] = [0, 0, 0]
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      v[k] = corner(o.index, t, k)
      tx[k] = wrapUv(uv[v[k] * 2]) * W - 0.5
      ty[k] = (o.flipY ? 1 - wrapUv(uv[v[k] * 2 + 1]) : wrapUv(uv[v[k] * 2 + 1])) * H - 0.5
    }
    const d = (tx[1] - tx[0]) * (ty[2] - ty[0]) - (tx[2] - tx[0]) * (ty[1] - ty[0])
    if (Math.abs(d) < 1e-9) continue
    const nrm = faceNormal(pos, v[0], v[1], v[2])
    const x0 = Math.max(0, Math.floor(Math.min(tx[0], tx[1], tx[2]))), x1 = Math.min(W - 1, Math.ceil(Math.max(tx[0], tx[1], tx[2])))
    const y0 = Math.max(0, Math.floor(Math.min(ty[0], ty[1], ty[2]))), y1 = Math.min(H - 1, Math.ceil(Math.max(ty[0], ty[1], ty[2])))
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const b1 = ((x - tx[0]) * (ty[2] - ty[0]) - (tx[2] - tx[0]) * (y - ty[0])) / d
      const b2 = ((tx[1] - tx[0]) * (y - ty[0]) - (x - tx[0]) * (ty[1] - ty[0])) / d
      const b0 = 1 - b1 - b2
      if (b0 < -1e-4 || b1 < -1e-4 || b2 < -1e-4) continue
      for (let c = 0; c < 3; c++) p[c] = b0 * pos[v[0] * 3 + c] + b1 * pos[v[1] * 3 + c] + b2 * pos[v[2] * 3 + c]
      const i = y * W + x
      region[i] = regionAt(g, p, nrm); owner[i] = t
    }
  }
  const hist = new Float64Array(256)
  let covered = 0
  for (let i = 0; i < W * H; i++) {
    if (owner[i] < 0) continue
    const l = Math.round(lum(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]))
    if (l >= 14) { hist[l]++; covered++ }
  }
  let ref = 128
  for (let l = 0, acc = 0; l < 256; l++) { acc += hist[l]; if (acc >= covered / 2) { ref = Math.max(24, l); break } }
  const dark = (i: number) => lum(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) < 0.8 * ref
  let shield = 0, shieldDark = 0
  const triShield = new Uint32Array(n), triDark = new Uint32Array(n)
  for (let i = 0; i < W * H; i++) if (region[i] === 1) { shield++; triShield[owner[i]]++; if (dark(i)) { shieldDark++; triDark[owner[i]]++ } }
  const darkGlass = shieldDark > 0.25 * shield
  const mask = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const r = region[i]
    if (r === 2) mask[i] = CLEAR_SPOILER
    else if (r === 3) mask[i] = CLEAR_GLASS
    else if (r === 1 && (!darkGlass || dark(i) || triDark[owner[i]] * 2 > triShield[owner[i]])) mask[i] = CLEAR_GLASS
  }
  // Clear islands grow a few texels into uncovered space so filtering at UV seams never pulls paint onto the glass.
  for (let pass = 0; pass < 3; pass++) {
    const grow: number[] = []
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (owner[i] >= 0 || mask[i]) continue
      const m = (x > 0 && mask[i - 1]) || (x < W - 1 && mask[i + 1]) || (y > 0 && mask[i - W]) || (y < H - 1 && mask[i + W]) || 0
      if (m) grow.push(i, m)
    }
    for (let k = 0; k < grow.length; k += 2) mask[grow[k]] = grow[k + 1]
  }
  const triangles = new Uint8Array(n)
  let glass = 0, spoiler = 0
  for (let i = 0; i < W * H; i++) {
    if (mask[i] === CLEAR_GLASS) glass++
    else if (mask[i] === CLEAR_SPOILER) spoiler++
    if (owner[i] >= 0) triangles[owner[i]] |= mask[i] ? 1 : 2
  }
  if (!glass && !spoiler) return null
  return { mask, triangles, glass, spoiler }
}

/**
 * Triangles (by number) among `[first, first + count)` of a hand-modelled body that make up the rear
 * spoiler, judged at each triangle's centre. For bodies whose spoiler shares the paint material.
 */
export function spoilerTriangles(pos: ArrayLike<number>, index: ArrayLike<number> | null, bounds: Bounds, first: number, count: number) {
  const g = measureGreenhouse(pos, index, bounds)
  const out: number[] = []
  if (!g) return out
  for (let t = first; t < first + count; t++) {
    const a = corner(index, t, 0), b = corner(index, t, 1), c = corner(index, t, 2)
    const p: [number, number, number] = [0, 1, 2].map((k) => (pos[a * 3 + k] + pos[b * 3 + k] + pos[c * 3 + k]) / 3) as [number, number, number]
    if (regionAt(g, p, faceNormal(pos, a, b, c)) === CLEAR_SPOILER) out.push(t)
  }
  return out
}

/** Clear-part looks: lightly smoked windshield and rear glass, nearly clear Lexan spoiler (RGBA, 0–255). */
export const CLEAR_LOOK: Record<number, [number, number, number, number]> = {
  [CLEAR_GLASS]: [60, 74, 84, 96],
  [CLEAR_SPOILER]: [232, 238, 242, 52],
}

/** The RGBA texture the clear parts are drawn with: tinted where clear, fully transparent elsewhere. */
export function clearPixels(m: ClearMask, width: number, height: number) {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const look = CLEAR_LOOK[m.mask[i]]
    if (!look) continue
    out[i * 4] = look[0]; out[i * 4 + 1] = look[1]; out[i * 4 + 2] = look[2]; out[i * 4 + 3] = look[3]
  }
  return out
}

/** Cuts the clear texels out of a body texture (alpha 0) so the painted body leaves holes where the glass sits. */
export function cutClear(px: Uint8ClampedArray, m: ClearMask) {
  for (let i = 0; i < m.mask.length; i++) if (m.mask[i]) px[i * 4 + 3] = 0
}

/**
 * Reorders a triangle list so the body and the clear parts can be drawn as two overlapping groups:
 * body-only triangles, then triangles with both, then clear-only ones. Returns the new index and the
 * two ranges (in index entries).
 */
export function clearGroups(index: ArrayLike<number> | null, triangles: Uint8Array) {
  const n = triangles.length
  const order: number[] = []
  for (const want of [2, 3, 1]) for (let t = 0; t < n; t++) if ((triangles[t] || 2) === want) order.push(t)
  const out = new Uint32Array(order.length * 3)
  order.forEach((t, j) => { for (let k = 0; k < 3; k++) out[j * 3 + k] = index ? index[t * 3 + k] : t * 3 + k })
  let bodyEnd = 0, clearStart = 0
  for (let j = 0; j < order.length; j++) {
    const f = triangles[order[j]] || 2
    if (f & 2) bodyEnd = j + 1
    if (!(f & 1)) clearStart = j + 1
  }
  return { index: out, body: { start: 0, count: bodyEnd * 3 }, clear: { start: clearStart * 3, count: (order.length - clearStart) * 3 } }
}
