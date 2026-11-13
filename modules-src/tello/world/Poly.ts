/** Small polygon helpers (renderer-free): signed area, ear clipping, point in polygon, polyline resampling. */

/** Twice-signed area halved: positive when the ring runs counter-clockwise with x right and z up. */
export function signedArea(ring: ArrayLike<number>): number {
  let s = 0
  const n = ring.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    s += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1]
  }
  return s / 2
}

export function pointInRing(ring: ArrayLike<number>, x: number, z: number): boolean {
  let inside = false
  const n = ring.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2]
    const zi = ring[i * 2 + 1]
    const xj = ring[j * 2]
    const zj = ring[j * 2 + 1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** Triangulates a simple ring (flat x, z pairs) by ear clipping; returns vertex indices, three per triangle. */
export function triangulate(ring: ArrayLike<number>): number[] {
  const n = ring.length / 2
  if (n < 3) return []
  const ccw = signedArea(ring) > 0
  const idx: number[] = []
  for (let i = 0; i < n; i++) idx.push(ccw ? i : n - 1 - i)
  const out: number[] = []
  const X = (i: number) => ring[i * 2]
  const Z = (i: number) => ring[i * 2 + 1]
  const cross = (a: number, b: number, c: number) => (X(b) - X(a)) * (Z(c) - Z(a)) - (Z(b) - Z(a)) * (X(c) - X(a))
  const within = (a: number, b: number, c: number, p: number) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0
  let guard = n * n + 8
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length]
      const b = idx[i]
      const c = idx[(i + 1) % idx.length]
      if (cross(a, b, c) <= 1e-9) continue
      let ear = true
      for (const p of idx) {
        if (p === a || p === b || p === c) continue
        if (within(a, b, c, p)) {
          ear = false
          break
        }
      }
      if (!ear) continue
      out.push(a, b, c)
      idx.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) idx.splice(0, 1)
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2])
  return out
}

/** A polyline (flat x, z pairs) with no segment longer than `step`. */
export function resample(pts: ArrayLike<number>, step: number): number[] {
  const out = [pts[0], pts[1]]
  for (let k = 2; k < pts.length; k += 2) {
    const ax = pts[k - 2]
    const az = pts[k - 1]
    const bx = pts[k]
    const bz = pts[k + 1]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step))
    for (let i = 1; i <= n; i++) out.push(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)
  }
  return out
}

export function polylineLength(pts: ArrayLike<number>): number {
  let len = 0
  for (let k = 2; k < pts.length; k += 2) len += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1])
  return len
}
