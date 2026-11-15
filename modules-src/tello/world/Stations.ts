/**
 * The stations a road's ribbon is built on (renderer-free, so the clearance checks and tests share them with Roads.ts).
 */
import { PROFILE_STEP, type StreetProfile } from '../data/Streets'
import { resample } from './Poly'

/** Metres between stations along streets and highways, and along everything else. */
export const STREET_STEP = 3
export const OTHER_STEP = 4
/** A ribbon's corner is never pushed out further than this many times its half width. */
const MITER_LIMIT = 1.6

export interface Station { x: number; z: number; sx: number; sz: number; along: number; miter: number }

/** The points a road's ribbon is built on, with each one's left normal (scaled to hold the width round a bend) and distance along. */
export function stationsOf(road: { k: number; p: number[] }, profile?: StreetProfile, town = false): Station[] {
  const pts = profile ? profile.pts : resample(road.p, town ? PROFILE_STEP : road.k <= 1 ? STREET_STEP : OTHER_STEP)
  const n = pts.length / 2
  const out: Station[] = []
  let along = 0
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1]
    const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1)
    let nx = 0, nz = 0, miter = 1
    const px = x - pts[a * 2], pz = z - pts[a * 2 + 1], qx = pts[c * 2] - x, qz = pts[c * 2 + 1] - z
    const pl = Math.hypot(px, pz), ql = Math.hypot(qx, qz)
    if (pl > 1e-6 && ql > 1e-6) {
      const n1x = -pz / pl, n1z = px / pl, n2x = -qz / ql, n2z = qx / ql
      const bx = n1x + n2x, bz = n1z + n2z
      const bl = Math.hypot(bx, bz) || 1
      nx = bx / bl
      nz = bz / bl
      miter = Math.min(MITER_LIMIT, 1 / Math.max(0.1, nx * n1x + nz * n1z))
    } else {
      const dx = pts[c * 2] - pts[a * 2], dz = pts[c * 2 + 1] - pts[a * 2 + 1]
      const len = Math.hypot(dx, dz) || 1
      nx = -dz / len
      nz = dx / len
    }
    if (i > 0) along += Math.hypot(x - pts[i * 2 - 2], z - pts[i * 2 - 1])
    out.push({ x, z, sx: nx, sz: nz, along, miter })
  }
  return out
}
