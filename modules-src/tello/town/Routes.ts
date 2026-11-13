/**
 * Directions over Montello's own road network (renderer-free). The graph's
 * nodes are the road vertices, joined where roads share a point; a route is
 * the quickest way between the vertices nearest the two ends, with highways
 * and streets cheaper per metre than driveways, tracks and trails.
 */
import type { RoadData } from '../data/MapData'

const COST = [1, 1.25, 2.2, 2.6, 3.2, 3.6]

export interface Route { pts: number[]; length: number }

export class RoadGraph {
  readonly x: number[] = []
  readonly z: number[] = []
  private readonly edges: { to: number; cost: number; len: number }[][] = []
  private readonly cells = new Map<number, number[]>()

  constructor(roads: readonly RoadData[], private readonly cell = 40) {
    const ids = new Map<string, number>()
    const node = (x: number, z: number): number => {
      const key = `${Math.round(x * 2)},${Math.round(z * 2)}`
      let id = ids.get(key)
      if (id === undefined) {
        id = this.x.length
        ids.set(key, id)
        this.x.push(x)
        this.z.push(z)
        this.edges.push([])
        const c = this.cellKey(x, z)
        let list = this.cells.get(c)
        if (!list) this.cells.set(c, (list = []))
        list.push(id)
      }
      return id
    }
    for (const road of roads) {
      let prev = -1
      for (let k = 0; k < road.p.length; k += 2) {
        const id = node(road.p[k], road.p[k + 1])
        if (prev >= 0 && prev !== id) {
          const len = Math.hypot(this.x[id] - this.x[prev], this.z[id] - this.z[prev])
          const cost = len * COST[road.k]
          this.edges[prev].push({ to: id, cost, len })
          this.edges[id].push({ to: prev, cost, len })
        }
        prev = id
      }
    }
  }

  private cellKey(x: number, z: number): number {
    return (Math.floor(x / this.cell) + 4096) * 8192 + Math.floor(z / this.cell) + 4096
  }

  /** The road vertex nearest (x, z), or -1 when none is within `reach`. */
  nearest(x: number, z: number, reach = 400): number {
    let best = -1
    let bd = reach
    const r = Math.ceil(reach / this.cell)
    const ci = Math.floor(x / this.cell)
    const cj = Math.floor(z / this.cell)
    for (let ring = 0; ring <= r; ring++) {
      for (let i = ci - ring; i <= ci + ring; i++) {
        for (let j = cj - ring; j <= cj + ring; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue
          const list = this.cells.get((i + 4096) * 8192 + j + 4096)
          if (!list) continue
          for (const id of list) {
            const d = Math.hypot(this.x[id] - x, this.z[id] - z)
            if (d < bd) {
              bd = d
              best = id
            }
          }
        }
      }
      if (best >= 0 && bd < (ring - 0.5) * this.cell) break
    }
    return best
  }

  /** The quickest way by road from near (ax, az) to near (bx, bz), or null when the two aren't joined. */
  route(ax: number, az: number, bx: number, bz: number): Route | null {
    const from = this.nearest(ax, az)
    const to = this.nearest(bx, bz)
    if (from < 0 || to < 0) return null
    const n = this.x.length
    const dist = new Float64Array(n).fill(Infinity)
    const prev = new Int32Array(n).fill(-1)
    const heap: number[] = []
    const key: number[] = []
    const push = (id: number, k: number) => {
      let i = heap.length
      heap.push(id)
      key.push(k)
      while (i > 0) {
        const p = (i - 1) >> 1
        if (key[p] <= key[i]) break
        ;[heap[p], heap[i]] = [heap[i], heap[p]]
        ;[key[p], key[i]] = [key[i], key[p]]
        i = p
      }
    }
    const pop = (): number => {
      const top = heap[0]
      const lastId = heap.pop()!
      const lastKey = key.pop()!
      if (heap.length) {
        heap[0] = lastId
        key[0] = lastKey
        let i = 0
        for (;;) {
          const l = i * 2 + 1
          const r = l + 1
          let m = i
          if (l < heap.length && key[l] < key[m]) m = l
          if (r < heap.length && key[r] < key[m]) m = r
          if (m === i) break
          ;[heap[m], heap[i]] = [heap[i], heap[m]]
          ;[key[m], key[i]] = [key[i], key[m]]
          i = m
        }
      }
      return top
    }
    dist[from] = 0
    const hx = this.x[to]
    const hz = this.z[to]
    push(from, 0)
    while (heap.length) {
      const id = pop()
      if (id === to) break
      for (const e of this.edges[id]) {
        const d = dist[id] + e.cost
        if (d < dist[e.to]) {
          dist[e.to] = d
          prev[e.to] = id
          push(e.to, d + Math.hypot(this.x[e.to] - hx, this.z[e.to] - hz))
        }
      }
    }
    if (!Number.isFinite(dist[to])) return null
    const pts: number[] = []
    let length = 0
    for (let id = to; id >= 0; id = prev[id]) {
      pts.push(this.z[id], this.x[id])
      if (prev[id] >= 0) length += Math.hypot(this.x[id] - this.x[prev[id]], this.z[id] - this.z[prev[id]])
    }
    pts.reverse()
    return { pts, length }
  }
}

/** The road at (x, z): the named road whose centreline passes within its width (plus `slack`), nearest first. */
export function roadNameAt(roads: readonly RoadData[], index: Map<number, number[]>, cell: number, x: number, z: number, slack = 3): string | null {
  let best: string | null = null
  let bd = Infinity
  const ci = Math.floor(x / cell)
  const cj = Math.floor(z / cell)
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      const list = index.get((i + 4096) * 8192 + j + 4096)
      if (!list) continue
      for (const r of list) {
        const road = roads[r]
        if (!road.n) continue
        const p = road.p
        for (let k = 0; k + 3 < p.length; k += 2) {
          const dx = p[k + 2] - p[k]
          const dz = p[k + 3] - p[k + 1]
          const t = Math.max(0, Math.min(1, ((x - p[k]) * dx + (z - p[k + 1]) * dz) / (dx * dx + dz * dz || 1)))
          const d = Math.hypot(x - (p[k] + dx * t), z - (p[k + 1] + dz * t)) - road.w / 2
          if (d < slack && d < bd) {
            bd = d
            best = road.n
          }
        }
      }
    }
  }
  return best
}

/** Which roads pass through each `cell`-sized square (for `roadNameAt`). */
export function roadIndex(roads: readonly RoadData[], cell: number): Map<number, number[]> {
  const index = new Map<number, number[]>()
  roads.forEach((road, r) => {
    const seen = new Set<number>()
    const p = road.p
    for (let k = 0; k + 3 < p.length; k += 2) {
      const n = Math.max(1, Math.ceil(Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]) / (cell / 2)))
      for (let s = 0; s <= n; s++) {
        const x = p[k] + ((p[k + 2] - p[k]) * s) / n
        const z = p[k + 1] + ((p[k + 3] - p[k + 1]) * s) / n
        const key = (Math.floor(x / cell) + 4096) * 8192 + Math.floor(z / cell) + 4096
        if (seen.has(key)) continue
        seen.add(key)
        let list = index.get(key)
        if (!list) index.set(key, (list = []))
        list.push(r)
      }
    }
  })
  return index
}
