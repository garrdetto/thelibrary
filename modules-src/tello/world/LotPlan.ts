/**
 * How a parking lot is marked, worked out from its outline alone (renderer-free, so the tests can check it): the lot's
 * long sides set the rows' direction; stalls are 2.7 by 5.5 m, head to head across 7 m aisles; a stripe is drawn only
 * where it fits inside the lot with room to spare; the lot's edge gets a curb except across driveways (where a street
 * or lane meets it) and along building walls; big lots get light poles down their aisles.
 */
import type { RoadData } from '../data/MapData'
import { pointInRing } from './Poly'

export const STALL_W = 2.7
export const STALL_D = 5.5
export const AISLE = 7
const MARGIN = 0.7

export interface LotPlan {
  angle: number
  stripes: [number, number, number, number][]
  curbs: [number, number][][]
  lights: [number, number][]
  stalls: number
  area: number
}

export interface Obstacles {
  roads: readonly RoadData[]
  blocks: readonly number[][]
}

export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2))
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

export function distToRing(ring: ArrayLike<number>, x: number, z: number): number {
  const n = ring.length / 2
  let best = Infinity
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    best = Math.min(best, distToSegment(x, z, ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]))
  }
  return best
}

export function ringArea(ring: ArrayLike<number>): number {
  let s = 0
  const n = ring.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    s += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1]
  }
  return Math.abs(s) / 2
}

/** The direction (radians) of the ring edge whose rotated bounding box is smallest. */
export function bestAngle(ring: ArrayLike<number>): number {
  const n = ring.length / 2
  let best = 0
  let bestArea = Infinity
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const a = Math.atan2(ring[j * 2 + 1] - ring[i * 2 + 1], ring[j * 2] - ring[i * 2])
    if (Math.hypot(ring[j * 2] - ring[i * 2], ring[j * 2 + 1] - ring[i * 2 + 1]) < 3) continue
    const c = Math.cos(a)
    const s = Math.sin(a)
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
    for (let k = 0; k < n; k++) {
      const u = ring[k * 2] * c + ring[k * 2 + 1] * s
      const v = -ring[k * 2] * s + ring[k * 2 + 1] * c
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v)
    }
    const area = (u1 - u0) * (v1 - v0)
    if (area < bestArea) {
      bestArea = area
      best = a
    }
  }
  return best
}

function roomAt(ring: ArrayLike<number>, x: number, z: number, margin: number): boolean {
  return pointInRing(ring, x, z) && distToRing(ring, x, z) >= margin
}

export function planLot(ring: ArrayLike<number>, obstacles: Obstacles, opts: { stripes?: boolean; lights?: boolean } = {}): LotPlan {
  const n = ring.length / 2
  const area = ringArea(ring)
  const plan: LotPlan = { angle: bestAngle(ring), stripes: [], curbs: [], lights: [], stalls: 0, area }
  if (n < 3) return plan
  const c = Math.cos(plan.angle)
  const s = Math.sin(plan.angle)
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (let k = 0; k < n; k++) {
    const u = ring[k * 2] * c + ring[k * 2 + 1] * s
    const v = -ring[k * 2] * s + ring[k * 2 + 1] * c
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v)
  }
  const toMap = (u: number, v: number): [number, number] => [u * c - v * s, u * s + v * c]
  const period = 2 * STALL_D + AISLE
  const rows: [number, number][] = []
  const aisles: number[] = []
  if (opts.stripes !== false && area > 350) {
    for (let base = v0 + 1; base + STALL_D < v1; base += period) {
      rows.push([base, base + STALL_D])
      aisles.push(base + STALL_D + AISLE / 2)
      if (base + period - STALL_D < v1) rows.push([base + STALL_D + AISLE, base + period])
    }
    for (const [va, vb] of rows) {
      let stalls = 0
      for (let u = u0 + 1; u <= u1 - 1; u += STALL_W) {
        const a = toMap(u, va)
        const b = toMap(u, vb)
        const m = toMap(u, (va + vb) / 2)
        if (!roomAt(ring, a[0], a[1], MARGIN) || !roomAt(ring, b[0], b[1], MARGIN) || !roomAt(ring, m[0], m[1], MARGIN)) continue
        plan.stripes.push([a[0], a[1], b[0], b[1]])
        stalls++
      }
      plan.stalls += Math.max(0, stalls - 1)
    }
  }
  const nearBox = (pts: ArrayLike<number>): boolean => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let i = 0; i + 1 < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1])
    }
    return x1 > lx0 - 20 && x0 < lx1 + 20 && z1 > lz0 - 20 && z0 < lz1 + 20
  }
  let lx0 = Infinity, lx1 = -Infinity, lz0 = Infinity, lz1 = -Infinity
  for (let k = 0; k < n; k++) {
    lx0 = Math.min(lx0, ring[k * 2]); lx1 = Math.max(lx1, ring[k * 2]); lz0 = Math.min(lz0, ring[k * 2 + 1]); lz1 = Math.max(lz1, ring[k * 2 + 1])
  }
  const nearRoads = obstacles.roads.filter((r) => r.k <= 2 && nearBox(r.p))
  const nearBlocks = obstacles.blocks.filter(nearBox)
  const blocked = (x: number, z: number): boolean => {
    for (const r of nearRoads) {
      if (r.k > 2) continue
      const half = r.w / 2 + 1.2
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        if (distToSegment(x, z, r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]) < half) return true
      }
    }
    for (const b of nearBlocks) {
      if (pointInRing(b, x, z) || distToRing(b, x, z) < 1.4) return true
    }
    return false
  }
  let run: [number, number][] = []
  const flush = () => {
    if (run.length >= 3) plan.curbs.push(run)
    run = []
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const steps = Math.max(1, Math.round(len / 1.5))
    for (let k = 0; k <= steps; k++) {
      const x = ax + ((bx - ax) * k) / steps
      const z = az + ((bz - az) * k) / steps
      if (blocked(x, z)) flush()
      else run.push([x, z])
    }
  }
  flush()
  if (opts.lights !== false && area > 1200) {
    for (const v of aisles) {
      for (let u = u0 + 10; u <= u1 - 6 && plan.lights.length < 12; u += 32) {
        const [x, z] = toMap(u, v)
        if (roomAt(ring, x, z, 2.5)) plan.lights.push([x, z])
      }
    }
  }
  return plan
}

/** Whether a parking lot's outline is one of the aerial-photo lots added for a school, store or club. */
export function lotName(lot: { n?: string }): string {
  return lot.n ?? ''
}
