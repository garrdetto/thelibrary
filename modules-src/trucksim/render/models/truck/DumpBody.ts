/**
 * The dump body of the dump trucks, built in moving frames: the bed (floor, ribbed sides with top and rub rails, headboard,
 * cab protector reaching over the cab roof, rear corner posts, long sills and cross members, side markers) in the frame of
 * its hinge pivot at `hingeZ`; the tailgate in the frame of its top hinge (it swings out from the bottom); the hoist as a
 * barrel and a telescoping rod in their own frames, with `hoistPose` solving where they point and how far the rod reaches for
 * a bed angle; and a heaped load mesh of unit height that `setLoad` scales.
 */

import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { PartBatch } from './Batch'
import type { BedLayout, TruckLayout } from './Layout'
import { at, boxAt, cylinder, latheHardX, mix, prism, ringSection, slab, slabX, solid, type P2 } from './Geometry'
import { xr } from './Cab'

/** Rest geometry of the hoist in the vehicle frame (y, z only; it sits on the centreline). */
export interface HoistRig {
  baseY: number
  baseZ: number
  /** Attachment on the bed in the bed pivot frame. */
  topY: number
  topZ: number
  barrelLength: number
  barrelRadius: number
  overlap: number
}

/** Where the hoist pivots on the frame and where it meets the bed. */
export function hoistRig(L: TruckLayout, bed: BedLayout): HoistRig {
  if (bed.hoist === 'front') {
    const baseZ = (L.cabBackZ + bed.frontZ) / 2 + 0.06
    const baseY = L.frameTop + 0.12
    const topY = bed.topY - 0.14
    const topZ = bed.frontZ + 0.17
    const rest = Math.hypot(topY - baseY, topZ - baseZ)
    return { baseY, baseZ, topY: topY - bed.hingeY, topZ: topZ - bed.hingeZ, barrelLength: rest * 0.86, barrelRadius: 0.11, overlap: 0.12 }
  }
  const baseZ = bed.frontZ - 1.75
  const baseY = L.frameTop - 0.05
  const topY = bed.floorY - 0.17
  const topZ = bed.frontZ - 0.38
  const rest = Math.hypot(topY - baseY, topZ - baseZ)
  return { baseY, baseZ, topY: topY - bed.hingeY, topZ: topZ - bed.hingeZ, barrelLength: rest * 0.84, barrelRadius: 0.09, overlap: 0.1 }
}

/** Fills `out` with the hoist's direction angle (about X) and length for a bed angle, without allocating. */
export function hoistPose(rig: HoistRig, bed: BedLayout, angle: number, out: { pitch: number; length: number }): void {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const y = bed.hingeY + rig.topY * c + rig.topZ * s
  const z = bed.hingeZ - rig.topY * s + rig.topZ * c
  const dy = y - rig.baseY
  const dz = z - rig.baseZ
  out.length = Math.hypot(dy, dz)
  out.pitch = Math.atan2(dz, dy)
}

/** The bed in its pivot frame (origin at the hinge: z = hingeZ, y = hingeY). */
export function buildBed(b: PartBatch, L: TruckLayout, bed: BedLayout): void {
  const oy = bed.hingeY
  const oz = bed.hingeZ
  const bw = bed.halfWidth
  const fY = bed.floorY - oy
  const tY = bed.topY - oy
  const zr = bed.rearZ - oz
  const zf = bed.frontZ - oz
  const ft = L.frameTop - oy
  b.add('primary', boxAt(-(bw - 0.04), bw - 0.04, fY - 0.025, fY, zr, zf - 0.04))
  for (const s of [1, -1] as const) {
    const [s0, s1] = xr(s, bw - 0.06, bw - 0.02)
    b.add('primary', boxAt(s0, s1, fY - 0.14, tY, zr + 0.1, zf))
    const [t0, t1] = xr(s, bw - 0.09, bw + 0.02)
    b.add('primary', slab(t0, t1, tY - 0.02, tY + 0.1, zr + 0.1, zf, 0.03, 0.012, 0.02))
    const [r0, r1] = xr(s, bw - 0.03, bw + 0.012)
    b.add('primary', slab(r0, r1, fY - 0.17, fY - 0.08, zr + 0.1, zf, 0.012))
    const count = Math.max(4, Math.round((zf - zr) / 0.56))
    for (let k = 1; k < count; k++) {
      const z = mix(zr + 0.1, zf, k / count)
      const [k0, k1] = xr(s, bw - 0.025, bw + 0.028)
      b.add('primary', slab(k0, k1, fY - 0.1, tY - 0.01, z - 0.032, z + 0.032, 0.01))
    }
    const [p0, p1] = xr(s, bw - 0.1, bw + 0.035)
    b.add('primary', slab(p0, p1, fY - 0.18, tY + 0.14, zr, zr + 0.12, 0.015))
    const [l0, l1] = xr(s, 0.38, 0.48)
    b.add('darkSteel', boxAt(l0, l1, ft + 0.01, fY - 0.025, zr + 0.06, zf - 0.08))
    for (const z of [zr + 0.5, zf - 0.4]) {
      const [m0, m1] = xr(s, bw + 0.028, bw + 0.04)
      b.add('lampAmber', slab(m0, m1, tY + 0.02, tY + 0.07, z - 0.04, z + 0.04, 0.006))
    }
    const [q0, q1] = xr(s, bw - 0.08, bw - 0.02)
    b.add('lampRed', boxAt(q0, q1, tY + 0.06, tY + 0.11, zr - 0.006, zr))
  }
  const cross = Math.max(5, Math.round((zf - zr) / 0.5))
  for (let k = 0; k <= cross; k++) {
    const z = mix(zr + 0.15, zf - 0.15, k / cross)
    b.add('darkSteel', boxAt(-(bw - 0.05), bw - 0.05, fY - 0.14, fY - 0.025, z - 0.04, z + 0.04))
  }
  b.add('primary', boxAt(-(bw - 0.02), bw - 0.02, fY - 0.14, tY + 0.14, zf - 0.06, zf))
  for (const y of [fY + 0.35, tY - 0.25]) b.add('primary', slabX(-(bw - 0.06), bw - 0.06, y - 0.04, y + 0.04, zf, zf + 0.05, 0.012))
  const canopyY = bed.canopyY - oy
  const canopyFront = bed.canopyFrontZ - oz
  b.add('primary', boxAt(-(bw - 0.12), bw - 0.12, tY + 0.1, canopyY + 0.04, zf - 0.06, zf))
  b.add('primary', slab(-(bw - 0.12), bw - 0.12, canopyY, canopyY + 0.05, zf - 0.04, canopyFront, 0.012, 0.012, 0.02))
  for (const x of [-(bw - 0.3), 0, bw - 0.3]) b.add('primary', slab(x - 0.03, x + 0.03, canopyY + 0.05, canopyY + 0.11, zf - 0.04, canopyFront - 0.02, 0.012))
  for (const s of [1, -1]) {
    const gusset: P2[] = [[0, 0], [0, canopyY - tY - 0.08], [Math.min(0.5, canopyFront - zf - 0.05), canopyY - tY - 0.08]]
    const g = prism(gusset, -0.015, 0.015)
    at(g, 0, 0, 0, 0, -Math.PI / 2)
    b.add('primary', at(g, s * (bw - 0.14), tY + 0.08, zf))
  }
  if (bed.hoist === 'front') {
    const rig = hoistRig(L, bed)
    b.add('darkSteel', slab(-0.14, 0.14, rig.topY - 0.1, rig.topY + 0.1, zf, rig.topZ + 0.06, 0.02))
    b.add('steel', at(cylinder(0.08, 0.08, 0.34, 12, 'x'), 0, rig.topY, rig.topZ))
  } else {
    const rig = hoistRig(L, bed)
    b.add('darkSteel', slab(-0.16, 0.16, rig.topY - 0.06, fY - 0.025, rig.topZ - 0.12, rig.topZ + 0.12, 0.02))
    b.add('steel', at(cylinder(0.07, 0.07, 0.36, 12, 'x'), 0, rig.topY, rig.topZ))
  }
  b.add('steel', at(cylinder(0.09, 0.09, 1.0, 12, 'x'), 0, 0, 0))
}

/** The tailgate pivot in the bed frame. */
export function tailgatePivot(bed: BedLayout): { y: number; z: number } {
  return { y: bed.topY + 0.07 - bed.hingeY, z: bed.rearZ - 0.02 - bed.hingeZ }
}

/** The tailgate in its hinge frame (origin at the top hinge pin; it hangs down along -Y). */
export function buildTailgate(b: PartBatch, bed: BedLayout): void {
  const bw = bed.halfWidth
  const drop = bed.topY + 0.07 - (bed.floorY - 0.13)
  b.add('primary', boxAt(-(bw - 0.11), bw - 0.11, -drop, -0.05, -0.06, 0.02))
  for (const f of [0.22, 0.5, 0.78]) {
    const y = -0.05 - (drop - 0.05) * f
    b.add('primary', slabX(-(bw - 0.14), bw - 0.14, y - 0.035, y + 0.035, -0.09, -0.055, 0.01))
  }
  for (const s of [1, -1]) {
    const [a0, a1] = xr(s, bw - 0.13, bw - 0.09)
    b.add('primary', slab(a0, a1, -drop * 0.9, 0.04, -0.085, 0.01, 0.01))
    b.add('darkSteel', at(latheHardX(ringSection(0.0005, 0.045, -0.035, 0.035, 0.006), 12), s * (bw - 0.11), 0, 0))
    const [h0, h1] = xr(s, bw - 0.2, bw - 0.12)
    b.add('darkSteel', boxAt(h0, h1, -drop - 0.03, -drop + 0.08, -0.02, 0.06))
  }
}

/** The hoist barrel along local +Y from its frame pivot. */
export function buildHoistBarrel(b: PartBatch, rig: HoistRig): void {
  const r = rig.barrelRadius
  b.add('darkSteel', at(cylinder(r * 2, r * 2, rig.barrelLength, 18), 0, rig.barrelLength / 2, 0))
  b.add('darkSteel', at(cylinder(r * 2.3, r * 2.3, 0.06, 18), 0, rig.barrelLength - 0.03, 0))
  b.add('darkSteel', at(cylinder(r * 1.6, r * 1.6, 0.3, 14, 'x'), 0, 0.02, 0))
}

/** The hoist rod (a unit-length telescope scaled along local +Y to reach the bed). */
export function buildHoistRod(b: PartBatch, rig: HoistRig): void {
  const r = rig.barrelRadius * 0.78
  b.add('chrome', at(cylinder(r * 2, r * 2, 1, 16), 0, 0.5, 0))
  for (const f of [0.34, 0.67]) b.add('chrome', at(cylinder(r * 2.2, r * 2.2, 0.02, 16), 0, f, 0))
}

/** The heap: a closed mound of unit height over the bed floor, in the bed frame at floor level. */
export function buildHeap(bed: BedLayout): VertexData {
  const bw = bed.halfWidth - 0.07
  const z0 = bed.rearZ + 0.08 - bed.hingeZ
  const z1 = bed.frontZ - 0.08 - bed.hingeZ
  const nx = 10
  const nz = 14
  const positions: number[] = []
  const indices: number[] = []
  const height = (u: number, v: number) => {
    const across = Math.pow(Math.max(0, 1 - u * u), 0.6)
    const along = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(v), 3)), 0.5)
    return 0.5 + 0.5 * across * along
  }
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = (i / nx) * 2 - 1
      const v = (j / nz) * 2 - 1
      positions.push(u * bw, height(u, v), mix(z0, z1, j / nz))
    }
  }
  const top = (i: number, j: number) => j * (nx + 1) + i
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) indices.push(top(i, j), top(i + 1, j), top(i + 1, j + 1), top(i, j), top(i + 1, j + 1), top(i, j + 1))
  }
  const ring: number[] = []
  for (let i = 0; i <= nx; i++) ring.push(top(i, 0))
  for (let j = 1; j <= nz; j++) ring.push(top(nx, j))
  for (let i = nx - 1; i >= 0; i--) ring.push(top(i, nz))
  for (let j = nz - 1; j >= 1; j--) ring.push(top(0, j))
  const base = positions.length / 3
  for (const k of ring) positions.push(positions[k * 3], 0, positions[k * 3 + 2])
  for (let k = 0; k < ring.length; k++) {
    const n = (k + 1) % ring.length
    indices.push(ring[k], base + n, ring[n], ring[k], base + k, base + n)
  }
  const centre = positions.length / 3
  positions.push(0, 0, (z0 + z1) / 2)
  for (let k = 0; k < ring.length; k++) indices.push(centre, base + ((k + 1) % ring.length), base + k)
  return solid(positions, indices)
}
