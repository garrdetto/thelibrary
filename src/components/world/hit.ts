import type { BuildingData, LotData, MapDoc, RoadData } from '../../../modules-src/tello/data/MapData'
import { distToSegment, inRing } from '../../../modules-src/tello/edits/Geom'

const CELL = 48

/** Roads, buildings and lots by 48 m cell, for picking under the cursor and snapping new roads onto old ones. */
export class HitIndex {
  private roads = new Map<number, number[]>()
  private buildings = new Map<number, number[]>()
  private lots = new Map<number, number[]>()

  constructor(readonly doc: MapDoc) {
    doc.roads.forEach((r, i) => {
      const seen = new Set<number>()
      for (let k = 0; k + 3 < r.p.length; k += 2) {
        const pad = r.w / 2 + 2
        this.cover(this.roads, Math.min(r.p[k], r.p[k + 2]) - pad, Math.min(r.p[k + 1], r.p[k + 3]) - pad, Math.max(r.p[k], r.p[k + 2]) + pad, Math.max(r.p[k + 1], r.p[k + 3]) + pad, i, seen)
      }
      if (r.p.length === 2) this.cover(this.roads, r.p[0] - 2, r.p[1] - 2, r.p[0] + 2, r.p[1] + 2, i, seen)
    })
    doc.buildings.forEach((b, i) => {
      if (b.x) return
      const box = boxOf(b.p)
      this.cover(this.buildings, box[0], box[1], box[2], box[3], i, new Set())
    })
    doc.lots.forEach((l, i) => {
      const box = boxOf(l.p)
      this.cover(this.lots, box[0], box[1], box[2], box[3], i, new Set())
    })
  }

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768)
  }

  private cover(map: Map<number, number[]>, x0: number, z0: number, x1: number, z1: number, index: number, seen: Set<number>): void {
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        const k = this.key(i, j)
        if (seen.has(k)) continue
        seen.add(k)
        const list = map.get(k)
        if (list) list.push(index)
        else map.set(k, [index])
      }
    }
  }

  private near(map: Map<number, number[]>, x: number, z: number, r: number): Set<number> {
    const out = new Set<number>()
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const list = map.get(this.key(i, j))
        if (list) for (const v of list) out.add(v)
      }
    }
    return out
  }

  /** The road nearest the point within `tol` metres of its pavement (narrow walks and trails win ties with streets under them). */
  roadAt(x: number, z: number, tol: number, filter?: (r: RoadData) => boolean): RoadData | null {
    let best: RoadData | null = null
    let bd = Infinity
    for (const i of this.near(this.roads, x, z, tol + 20)) {
      const r = this.doc.roads[i]
      if (!r || (filter && !filter(r))) continue
      const d = distToRoad(r, x, z) - r.w / 2
      if (d > tol) continue
      const score = d + (r.k >= 4 ? -0.5 : 0)
      if (score < bd) { bd = score; best = r }
    }
    return best
  }

  buildingAt(x: number, z: number, skip?: Set<string>): BuildingData | null {
    let best: BuildingData | null = null
    let area = Infinity
    for (const i of this.near(this.buildings, x, z, 1)) {
      const b = this.doc.buildings[i]
      if (!b || b.x || (skip && b.id && skip.has(b.id))) continue
      if (!inRing(b.p, x, z)) continue
      const box = boxOf(b.p)
      const a = (box[2] - box[0]) * (box[3] - box[1])
      if (a < area) { area = a; best = b }
    }
    return best
  }

  lotAt(x: number, z: number): LotData | null {
    for (const i of this.near(this.lots, x, z, 1)) {
      const l = this.doc.lots[i]
      if (l && inRing(l.p, x, z)) return l
    }
    return null
  }

  /** The nearest point on any road's centre line within `reach` (an end or a corner when one is within `reach`, else along a segment). */
  snap(x: number, z: number, reach: number, filter?: (r: RoadData) => boolean): { x: number; z: number; road: RoadData; vertex: boolean } | null {
    let best: { x: number; z: number; road: RoadData; vertex: boolean } | null = null
    let bd = reach
    let bv = reach
    for (const i of this.near(this.roads, x, z, reach + 10)) {
      const r = this.doc.roads[i]
      if (!r || (filter && !filter(r))) continue
      for (let k = 0; k + 1 < r.p.length; k += 2) {
        const d = Math.hypot(r.p[k] - x, r.p[k + 1] - z)
        if (d < bv) { bv = d; best = { x: r.p[k], z: r.p[k + 1], road: r, vertex: true } }
      }
      if (best?.vertex) continue
      for (let k = 0; k + 3 < r.p.length; k += 2) {
        const ax = r.p[k], az = r.p[k + 1], dx = r.p[k + 2] - ax, dz = r.p[k + 3] - az
        const l2 = dx * dx + dz * dz || 1
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2))
        const px = ax + dx * t, pz = az + dz * t
        const d = Math.hypot(px - x, pz - z)
        if (d < bd && !(best && best.vertex)) { bd = d; best = { x: px, z: pz, road: r, vertex: false } }
      }
    }
    return best
  }
}

export function distToRoad(r: RoadData, x: number, z: number): number {
  if (r.p.length < 4) return Math.hypot(x - r.p[0], z - r.p[1])
  let best = Infinity
  for (let k = 0; k + 3 < r.p.length; k += 2) best = Math.min(best, distToSegment(x, z, r.p[k], r.p[k + 1], r.p[k + 2], r.p[k + 3]))
  return best
}

export function boxOf(p: ArrayLike<number>): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (let k = 0; k + 1 < p.length; k += 2) {
    x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k])
    z0 = Math.min(z0, p[k + 1]); z1 = Math.max(z1, p[k + 1])
  }
  return [x0, z0, x1, z1]
}
