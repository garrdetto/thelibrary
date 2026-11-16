/**
 * Trims a parking lot back off the roads that run over it (renderer-free): the lot is rasterised at half a metre, every
 * cell within a road's half width plus a margin is cut away, and the pieces left are traced back into rings.
 */
import { distToSegment, inRing, ringArea } from './Geom'

export interface ClipRoad { p: ArrayLike<number>; half: number }

const RES = 0.5
const MIN_PIECE = 30

/** The pieces of `ring` left once every road is cut out of it (largest first); empty when nothing usable is left. */
export function clipLotRing(ring: ArrayLike<number>, roads: readonly ClipRoad[], margin: number): number[][] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let k = 0; k + 1 < ring.length; k += 2) {
    x0 = Math.min(x0, ring[k]); x1 = Math.max(x1, ring[k])
    z0 = Math.min(z0, ring[k + 1]); z1 = Math.max(z1, ring[k + 1])
  }
  const near = roads.filter((r) => {
    for (let k = 0; k + 1 < r.p.length; k += 2) {
      const pad = r.half + margin
      if (r.p[k] > x0 - pad - 200 && r.p[k] < x1 + pad + 200 && r.p[k + 1] > z0 - pad - 200 && r.p[k + 1] < z1 + pad + 200) return true
    }
    return false
  })
  if (!near.length) return [Array.from(ring)]
  const mx0 = x0 - RES, mz0 = z0 - RES
  const nx = Math.ceil((x1 - x0) / RES) + 3, nz = Math.ceil((z1 - z0) / RES) + 3
  if (nx * nz > 4_000_000) return [Array.from(ring)]
  const mask = new Uint8Array(nx * nz)
  let cut = false
  for (let j = 1; j < nz - 1; j++) {
    const z = mz0 + j * RES
    for (let i = 1; i < nx - 1; i++) {
      const x = mx0 + i * RES
      if (!inRing(ring, x, z)) continue
      let keep = true
      for (const r of near) {
        const reach = r.half + margin
        for (let k = 0; k + 3 < r.p.length; k += 2) {
          if (distToSegment(x, z, r.p[k], r.p[k + 1], r.p[k + 2], r.p[k + 3]) < reach) { keep = false; break }
        }
        if (!keep) break
      }
      if (keep) mask[j * nx + i] = 1
      else cut = true
    }
  }
  if (!cut) return [Array.from(ring)]
  const loops = traceMask(mask, nx, nz).map((l) => l.map((v, k) => (k % 2 === 0 ? mx0 + v * RES : mz0 + v * RES)))
  const pieces = loops.map((l) => simplifyRing(l, 0.2)).filter((l) => l.length >= 6 && ringArea(l) >= MIN_PIECE)
  pieces.sort((a, b) => ringArea(b) - ringArea(a))
  // Inner loops (holes round a road that runs inside the lot) are dropped: a lot is one outline.
  const outer: number[][] = []
  for (const p of pieces) if (!outer.some((o) => inRing(o, p[0], p[1]))) outer.push(p)
  return outer
}

/** Marching squares over a 0/1 mask (border cells must be 0): closed loops in mask units (x, z pairs). */
export function traceMask(mask: Uint8Array, nx: number, nz: number): number[][] {
  const segs: number[] = []
  const key = (a: number, b: number) => a * 131072 + b
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const c = mask[j * nx + i] | (mask[j * nx + i + 1] << 1) | (mask[(j + 1) * nx + i + 1] << 2) | (mask[(j + 1) * nx + i] << 3)
      if (c === 0 || c === 15) continue
      const B = key(2 * i + 1, 2 * j), R = key(2 * i + 2, 2 * j + 1), T = key(2 * i + 1, 2 * j + 2), L = key(2 * i, 2 * j + 1)
      switch (c) {
        case 1: case 14: segs.push(L, B); break
        case 2: case 13: segs.push(B, R); break
        case 3: case 12: segs.push(L, R); break
        case 4: case 11: segs.push(R, T); break
        case 6: case 9: segs.push(B, T); break
        case 7: case 8: segs.push(L, T); break
        case 5: segs.push(L, B, R, T); break
        case 10: segs.push(B, R, T, L); break
      }
    }
  }
  const at = new Map<number, number[]>()
  for (let s = 0; s < segs.length; s += 2) {
    for (const e of [segs[s], segs[s + 1]]) {
      const list = at.get(e)
      if (list) list.push(s)
      else at.set(e, [s])
    }
  }
  const used = new Uint8Array(segs.length / 2)
  const loops: number[][] = []
  for (let s = 0; s < segs.length; s += 2) {
    if (used[s / 2]) continue
    used[s / 2] = 1
    const start = segs[s]
    let cur = segs[s + 1]
    const loop = [start, cur]
    let guard = segs.length
    while (cur !== start && guard-- > 0) {
      const list = at.get(cur) ?? []
      let next = -1
      for (const t of list) if (!used[t / 2]) { next = t; break }
      if (next < 0) break
      used[next / 2] = 1
      cur = segs[next] === cur ? segs[next + 1] : segs[next]
      loop.push(cur)
    }
    if (cur !== start || loop.length < 4) continue
    loop.pop()
    const out: number[] = []
    for (const e of loop) out.push(Math.floor(e / 131072) / 2, (e % 131072) / 2)
    loops.push(out)
  }
  return loops
}

/** Douglas-Peucker on a closed ring. */
export function simplifyRing(ring: number[], tolerance: number): number[] {
  const n = ring.length / 2
  if (n <= 4) return ring
  let far = 0, fd = -1
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(ring[i * 2] - ring[0], ring[i * 2 + 1] - ring[1])
    if (d > fd) { fd = d; far = i }
  }
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[far] = 1
  const run = (a: number, b: number) => {
    const stack: [number, number][] = [[a, b]]
    while (stack.length) {
      const [s, e] = stack.pop()!
      const ei = e % n
      let best = -1, bd = tolerance
      for (let i = s + 1; i < e; i++) {
        const ii = i % n
        const d = distToSegment(ring[ii * 2], ring[ii * 2 + 1], ring[s * 2], ring[s * 2 + 1], ring[ei * 2], ring[ei * 2 + 1])
        if (d > bd) { bd = d; best = i }
      }
      if (best >= 0) {
        keep[best % n] = 1
        stack.push([s, best], [best, e])
      }
    }
  }
  run(0, far)
  run(far, n)
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i * 2], ring[i * 2 + 1])
  return out
}
