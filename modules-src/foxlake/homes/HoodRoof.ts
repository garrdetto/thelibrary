/**
 * The Hood's roof generator (`hood/src/models/House.ts` `buildRoof`), without a renderer: the roof over every
 * enclosed area as triangle lists in grid metres, y measured from the roof base. Hip roofs rise with distance from
 * all outside walls; gables slope on the long sides only and close the ends with wall; flat roofs get a deep fascia.
 */
import { D, W, inLot, type LotGrid } from '../../hood/shared/Lot'
import { OVERHANGS, PITCHES, type HouseStyle } from '../../hood/shared/Style'

export const WALL_HEIGHT = 2.75
export const ROOF_BASE = WALL_HEIGHT + 0.1
const MAX_RUN = 4.5

type P = [number, number, number]

export interface RoofTris {
  /** Every list is flat triangles: x, y, z per corner. */
  roof: number[]
  fascia: number[]
  gutters: number[]
  gables: number[]
  /** Highest point above the roof base. */
  top: number
}

function tilesAt(x: number, z: number): [number, number][] {
  const xs = Number.isInteger(x) ? [x - 1, x] : [Math.floor(x)]
  const zs = Number.isInteger(z) ? [z - 1, z] : [Math.floor(z)]
  const out: [number, number][] = []
  for (const tx of xs) for (const tz of zs) out.push([tx, tz])
  return out
}

export function roofOverhang(style: HouseStyle): number {
  return style.roofStyle === 'flat' ? 0.18 : (OVERHANGS[style.overhang] ?? 0.4)
}

export function eaveHeight(style: HouseStyle): number {
  return style.roofStyle === 'flat' ? ROOF_BASE - 0.3 : ROOF_BASE - roofOverhang(style) * (PITCHES[style.pitch] ?? 0.5) - 0.17
}

export function buildRoof(grid: LotGrid, style: HouseStyle): RoofTris | null {
  const steps = 2
  const nx = W * steps, nz = D * steps
  const pitch = PITCHES[style.pitch] ?? 0.5
  const overhang = roofOverhang(style)
  const isIn = (tx: number, tz: number) => inLot(tx, tz) && grid.isInside(tx, tz)
  const insideCell = (i: number, j: number) => grid.isInside(Math.floor(i / steps), Math.floor(j / steps))
  let minX = W, maxX = 0, minZ = D, maxZ = 0
  for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) if (grid.isInside(x, z)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x + 1); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z + 1) }
  if (minX >= maxX) return null
  const ridgeX = maxX - minX >= maxZ - minZ
  const key = (i: number, j: number) => i * (nz + 1) + j
  const boundary = new Map<number, { sx: number; sz: number; eave: boolean; x: number; z: number }>()
  const eaves: [number, number][] = []
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const x = i / steps, z = j / steps
    const touching = tilesAt(x, z)
    let ins = 0, cx = 0, cz = 0
    for (const [tx, tz] of touching) if (isIn(tx, tz)) { ins++; cx += tx + 0.5; cz += tz + 0.5 }
    if (ins === 0 || ins === touching.length) continue
    const dx = x - cx / ins, dz = z - cz / ins
    const sx = Math.abs(dx) < 0.01 ? 0 : Math.sign(dx), sz = Math.abs(dz) < 0.01 ? 0 : Math.sign(dz)
    let eave = true
    if (style.roofStyle === 'gable') {
      eave = false
      if (ridgeX && Number.isInteger(z)) for (const tx of Number.isInteger(x) ? [x - 1, x] : [Math.floor(x)]) if (isIn(tx, z - 1) !== isIn(tx, z)) eave = true
      if (!ridgeX && Number.isInteger(x)) for (const tz of Number.isInteger(z) ? [z - 1, z] : [Math.floor(z)]) if (isIn(x - 1, tz) !== isIn(x, tz)) eave = true
    }
    boundary.set(key(i, j), { sx, sz, eave, x, z })
    if (eave) eaves.push([x, z])
  }
  const heightAt = (x: number, z: number): number => {
    if (style.roofStyle === 'flat') return 0.12
    let d = Infinity
    if (style.roofStyle === 'gable') {
      for (const [bx, bz] of eaves) {
        if (ridgeX ? Math.abs(bx - x) < 0.001 : Math.abs(bz - z) < 0.001) d = Math.min(d, ridgeX ? Math.abs(bz - z) : Math.abs(bx - x))
      }
    }
    if (d === Infinity) for (const [bx, bz] of eaves) d = Math.min(d, Math.max(Math.abs(bx - x), Math.abs(bz - z)))
    return Math.min(d, MAX_RUN) * pitch
  }
  const cache = new Map<number, P>()
  const raw = new Map<number, number>()
  const rawHeight = (i: number, j: number) => {
    const k = key(i, j)
    let h = raw.get(k)
    if (h === undefined) {
      const b = boundary.get(k)
      h = b?.eave && style.roofStyle !== 'flat' ? 0 : heightAt(i / steps, j / steps)
      raw.set(k, h)
    }
    return h
  }
  const vertex = (i: number, j: number): P => {
    const k = key(i, j)
    const hit = cache.get(k)
    if (hit) return hit
    const b = boundary.get(k)
    const x = i / steps, z = j / steps
    let out: P
    if (!b) out = [x, rawHeight(i, j), z]
    else if (style.roofStyle === 'gable') {
      const endScale = 0.45
      const ox = ridgeX ? b.sx * (b.eave && !b.sx ? 0 : b.eave ? overhang : overhang * endScale) : b.sx * overhang
      const oz = ridgeX ? b.sz * overhang : b.sz * (b.eave && !b.sz ? 0 : b.eave ? overhang : overhang * endScale)
      out = [x + ox, b.eave ? -overhang * pitch : rawHeight(i, j), z + oz]
    } else out = [x + b.sx * overhang, style.roofStyle === 'flat' ? 0.12 : -overhang * pitch, z + b.sz * overhang]
    cache.set(k, out)
    return out
  }
  const roof: number[] = []
  const fascia: number[] = []
  const gutters: number[] = []
  const gables: number[] = []
  const push = (list: number[], ...points: P[]) => { for (const p of points) list.push(p[0], p[1], p[2]) }
  const drop = style.roofStyle === 'flat' ? 0.42 : 0.17
  let top = 0
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (!insideCell(i, j)) continue
    const a = vertex(i, j), b = vertex(i + 1, j), c = vertex(i + 1, j + 1), d = vertex(i, j + 1)
    top = Math.max(top, a[1], b[1], c[1], d[1])
    if ((i + j) % 2 === 0) push(roof, a, d, c, a, c, b)
    else push(roof, a, d, b, b, d, c)
    const sides: [boolean, P, P, [number, number], [number, number], [number, number]][] = [
      [j === 0 || !insideCell(i, j - 1), b, a, [i + 1, j], [i, j], [0, -1]],
      [j === nz - 1 || !insideCell(i, j + 1), d, c, [i, j + 1], [i + 1, j + 1], [0, 1]],
      [i === 0 || !insideCell(i - 1, j), a, d, [i, j], [i, j + 1], [-1, 0]],
      [i === nx - 1 || !insideCell(i + 1, j), c, b, [i + 1, j + 1], [i + 1, j], [1, 0]],
    ]
    for (const [open, p, q, pk, qk, [nxDir, nzDir]] of sides) {
      if (!open) continue
      const p2: P = [p[0], p[1] - drop, p[2]]
      const q2: P = [q[0], q[1] - drop, q[2]]
      push(fascia, p, q, q2, p, q2, p2)
      const pe = boundary.get(key(...pk))?.eave, qe = boundary.get(key(...qk))?.eave
      if (style.gutters && style.roofStyle !== 'flat' && pe && qe) {
        const o = 0.09
        const p3: P = [p[0] + nxDir * o, p[1] - 0.05, p[2] + nzDir * o]
        const q3: P = [q[0] + nxDir * o, q[1] - 0.05, q[2] + nzDir * o]
        const p4: P = [p3[0], p3[1] - 0.14, p3[2]]
        const q4: P = [q3[0], q3[1] - 0.14, q3[2]]
        push(gutters, p3, q3, q4, p3, q4, p4, p2, q2, q4, p2, q4, p4)
      }
      if (style.roofStyle === 'gable' && !(pe && qe)) {
        const px = pk[0] / steps, pz = pk[1] / steps, qx = qk[0] / steps, qz = qk[1] / steps
        const ph = rawHeight(...pk), qh = rawHeight(...qk)
        if (ph > 0.01 || qh > 0.01) push(gables, [px, -0.14, pz], [qx, -0.14, qz], [qx, qh, qz], [px, -0.14, pz], [qx, qh, qz], [px, ph, pz])
      }
    }
  }
  return { roof, fascia, gutters, gables, top }
}
