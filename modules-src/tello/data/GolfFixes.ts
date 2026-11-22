/**
 * Load-time corrections to the golf courses the bake laid out (`doc.golf`), run at the end of `fixStreets` so Fox Lake's
 * packed map carries them too. Renderer-free.
 *
 * - Every tee box is kept clear of trunks, `TEE_CLEAR` metres round it (hole 2 at White Lake had a 25 m tree in its box).
 * - The woods along hole 9's last leg at White Lake (between the fairway's climb and the green, and round the green) are
 *   thinned to open woods like the trees west of the green: trunks off the fairway and green edges, the rest at least
 *   `THIN_GAP` apart (tallest kept), and the canopy lowered under the share that grows Forest infill.
 */
import { pointInRing } from '../world/Poly'
import { treeUnits, type GolfHoleData, type MapDoc, type MapGrids } from './MapData'

export const TEE_CLEAR = 3
export const THINNED_HOLES: { course: string; hole: number }[] = [{ course: 'White Lake Golf Club', hole: 9 }]
export const THIN_REACH = 45
export const THIN_EDGE = 8
export const THIN_GAP = 20
export const THIN_CANOPY = 100

type Pt = [number, number]

function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(x - ax - dx * t, z - az - dz * t)
}

/** Metres from a point to a ring's outline (0 inside it). */
export function ringDist(ring: number[], x: number, z: number): number {
  if (pointInRing(ring, x, z)) return 0
  let best = Infinity
  const n = ring.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    best = Math.min(best, segDist(x, z, ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]))
  }
  return best
}

/** The last leg of a hole, from the turn before the green to the far side of the green. */
export function lastLegOf(hole: GolfHoleData): [Pt, Pt] {
  const p = hole.line
  const n = p.length / 2
  const a: Pt = [p[(n - 2) * 2], p[(n - 2) * 2 + 1]]
  const b: Pt = [p[(n - 1) * 2], p[(n - 1) * 2 + 1]]
  let far = 0
  for (let k = 0; k < hole.green.length; k += 2) far = Math.max(far, Math.hypot(hole.green[k] - b[0], hole.green[k + 1] - b[1]))
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [a, [b[0] + ((b[0] - a[0]) / l) * far, b[1] + ((b[1] - a[1]) / l) * far]]
}

/** True where a hole's woods are thinned: within `THIN_REACH` of its last leg. */
export function inThinnedWoods(hole: GolfHoleData, x: number, z: number, reach = THIN_REACH): boolean {
  const [a, b] = lastLegOf(hole)
  return segDist(x, z, a[0], a[1], b[0], b[1]) <= reach
}

function thinnedHoles(doc: MapDoc): GolfHoleData[] {
  const out: GolfHoleData[] = []
  for (const t of THINNED_HOLES) {
    const hole = doc.golf?.find((c) => c.n === t.course)?.holes.find((h) => h.n === t.hole)
    if (hole && hole.line.length >= 4) out.push(hole)
  }
  return out
}

export function fixGolf(doc: MapDoc, grids: MapGrids): void {
  const courses = doc.golf ?? []
  if (!courses.length) return
  const f = doc.frame
  const units = treeUnits(f)
  const tees = courses.flatMap((c) => c.holes.map((h) => h.box)).filter((b) => b.length >= 6)
  const thin = thinnedHoles(doc)
  const count = grids.treeX.length
  const gone = new Uint8Array(count)
  const kept: { i: number; x: number; z: number; h: number }[] = []
  for (let i = 0; i < count; i++) {
    const x = f.x0 + grids.treeX[i] / units
    const z = f.z0 + grids.treeZ[i] / units
    if (tees.some((box) => ringDist(box, x, z) <= TEE_CLEAR)) {
      gone[i] = 1
      continue
    }
    for (const hole of thin) {
      if (!inThinnedWoods(hole, x, z)) continue
      if (ringDist(hole.green, x, z) <= THIN_EDGE || hole.fw.some((fw) => fw.length >= 6 && ringDist(fw, x, z) <= THIN_EDGE)) gone[i] = 1
      else kept.push({ i, x, z, h: grids.treeH[i] })
      break
    }
  }
  kept.sort((p, q) => q.h - p.h || p.i - q.i)
  const standing: { x: number; z: number }[] = []
  for (const t of kept) {
    if (standing.some((s) => Math.hypot(s.x - t.x, s.z - t.z) < THIN_GAP)) gone[t.i] = 1
    else standing.push(t)
  }
  for (const hole of thin) lowerCanopy(doc, grids, (x, z, pad) => inThinnedWoods(hole, x, z, THIN_REACH + pad), lastLegOf(hole), THIN_REACH, THIN_CANOPY)
  for (const box of tees) {
    const c = ringCentre(box)
    let r = 0
    for (let k = 0; k < box.length; k += 2) r = Math.max(r, Math.hypot(box[k] - c[0], box[k + 1] - c[1]))
    lowerCanopy(doc, grids, (x, z, pad) => ringDist(box, x, z) <= TEE_CLEAR + pad, [c, c], r + TEE_CLEAR, 0)
  }
  let keep = 0
  for (let i = 0; i < count; i++) if (!gone[i]) keep++
  if (keep === count) return
  const X = new Uint16Array(keep), Z = new Uint16Array(keep), S = new Uint8Array(keep), H = new Uint8Array(keep)
  let o = 0
  for (let i = 0; i < count; i++) {
    if (gone[i]) continue
    X[o] = grids.treeX[i]
    Z[o] = grids.treeZ[i]
    S[o] = grids.treeS[i]
    H[o] = grids.treeH[i]
    o++
  }
  grids.treeX = X
  grids.treeZ = Z
  grids.treeS = S
  grids.treeH = H
}

function ringCentre(ring: number[]): Pt {
  let x = 0, z = 0
  for (let k = 0; k < ring.length; k += 2) {
    x += ring[k]
    z += ring[k + 1]
  }
  return [x / (ring.length / 2), z / (ring.length / 2)]
}

/** Caps the canopy at `cap` wherever `inside` holds (padded a cell, so the bilinear canopy stays under it right to the edge), in the box round `a`–`b` grown by `reach`. */
function lowerCanopy(doc: MapDoc, grids: MapGrids, inside: (x: number, z: number, pad: number) => boolean, [a, b]: [Pt, Pt], reach: number, cap: number): void {
  const f = doc.frame
  const n = grids.side
  const pad = reach + f.cell * 2
  const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - pad - f.x0) / f.cell))
  const i1 = Math.min(n - 1, Math.ceil((Math.max(a[0], b[0]) + pad - f.x0) / f.cell))
  const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - pad - f.z0) / f.cell))
  const j1 = Math.min(n - 1, Math.ceil((Math.max(a[1], b[1]) + pad - f.z0) / f.cell))
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (!inside(f.x0 + i * f.cell, f.z0 + j * f.cell, f.cell)) continue
      const k = j * n + i
      if (grids.canopy[k] > cap) grids.canopy[k] = cap
    }
  }
}
