/**
 * The county road network as a graph: every `ROADS` polyline is split wherever another road crosses it or ends on it, nodes
 * within half a metre are merged, and an A* search finds the drive between two points after walking each end onto the nearest
 * road. `COUNTY` is the `HaulWorld` whose `routeDistance` uses it, so job distances are the same in the page and the Worker.
 */
import type { HaulWorld } from './HaulWorld'
import { ALL_ZONES, LOTS, ROADS, SITES, SITE_BY_ID, ZONE_BY_ID } from './WorldLayout'
import type { Zone, ZoneKind } from './WorldLayout'

const MERGE_DISTANCE = 0.5
const ENDPOINT_TOLERANCE = 0.5
const CELL = 1
/** Segments are bucketed in squares this size so crossings are only tested between neighbours. */
const SEGMENT_CELL = 64

type Point = [number, number]

interface Segment {
  a: Point
  b: Point
  splits: number[]
}

interface Edge {
  to: number
  length: number
}

interface Graph {
  nodes: Point[]
  edges: Edge[][]
  segments: { from: number; to: number }[]
}

export interface RoutePath {
  points: [number, number][]
  length: number
}

interface Snap {
  segment: number
  t: number
  x: number
  z: number
  offset: number
}

function intersect(first: Segment, second: Segment): [number, number] | null {
  const dx1 = first.b[0] - first.a[0]
  const dz1 = first.b[1] - first.a[1]
  const dx2 = second.b[0] - second.a[0]
  const dz2 = second.b[1] - second.a[1]
  const denominator = dx1 * dz2 - dz1 * dx2
  if (Math.abs(denominator) < 1e-9) return null
  const ex = second.a[0] - first.a[0]
  const ez = second.a[1] - first.a[1]
  const t = (ex * dz2 - ez * dx2) / denominator
  const u = (ex * dz1 - ez * dx1) / denominator
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null
  return [t, u]
}

function projectOnto(segment: Segment, x: number, z: number): { t: number; distance: number } {
  const dx = segment.b[0] - segment.a[0]
  const dz = segment.b[1] - segment.a[1]
  const lengthSquared = dx * dx + dz * dz
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - segment.a[0]) * dx + (z - segment.a[1]) * dz) / lengthSquared))
  return { t, distance: Math.hypot(x - (segment.a[0] + dx * t), z - (segment.a[1] + dz * t)) }
}

/** A road polyline: points in order, closed when `loop` is set. */
export interface RoadLine {
  points: readonly (readonly [number, number])[]
  loop?: boolean
}

function buildGraph(roads: readonly RoadLine[], tolerance = ENDPOINT_TOLERANCE): Graph {
  const raw: { segment: Segment; road: number }[] = []
  roads.forEach((road, roadIndex) => {
    const points = (road.loop ? [...road.points, road.points[0]] : road.points) as Point[]
    for (let i = 0; i + 1 < points.length; i++) raw.push({ segment: { a: points[i], b: points[i + 1], splits: [] }, road: roadIndex })
  })
  const segmentCells = new Map<string, number[]>()
  const cellsOf = (segment: Segment): string[] => {
    const x0 = Math.floor((Math.min(segment.a[0], segment.b[0]) - tolerance) / SEGMENT_CELL)
    const x1 = Math.floor((Math.max(segment.a[0], segment.b[0]) + tolerance) / SEGMENT_CELL)
    const z0 = Math.floor((Math.min(segment.a[1], segment.b[1]) - tolerance) / SEGMENT_CELL)
    const z1 = Math.floor((Math.max(segment.a[1], segment.b[1]) + tolerance) / SEGMENT_CELL)
    const out: string[] = []
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) out.push(`${cx},${cz}`)
    return out
  }
  raw.forEach((entry, index) => {
    for (const key of cellsOf(entry.segment)) {
      const list = segmentCells.get(key)
      if (list) list.push(index)
      else segmentCells.set(key, [index])
    }
  })
  for (let i = 0; i < raw.length; i++) {
    const near = new Set<number>()
    for (const key of cellsOf(raw[i].segment)) for (const j of segmentCells.get(key) ?? []) if (j !== i) near.add(j)
    for (const j of near) {
      if (raw[i].road === raw[j].road) continue
      if (j > i) {
        const hit = intersect(raw[i].segment, raw[j].segment)
        if (hit) {
          raw[i].segment.splits.push(hit[0])
          raw[j].segment.splits.push(hit[1])
        }
      }
      for (const end of [raw[j].segment.a, raw[j].segment.b]) {
        const close = projectOnto(raw[i].segment, end[0], end[1])
        if (close.distance <= tolerance) raw[i].segment.splits.push(close.t)
      }
    }
  }

  const nodes: Point[] = []
  const merge = Math.max(MERGE_DISTANCE, tolerance)
  const cell = Math.max(CELL, merge)
  const buckets = new Map<string, number[]>()
  const nodeAt = (x: number, z: number): number => {
    const cx = Math.floor(x / cell)
    const cz = Math.floor(z / cell)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const index of buckets.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (Math.hypot(nodes[index][0] - x, nodes[index][1] - z) <= merge) return index
        }
      }
    }
    nodes.push([x, z])
    const key = `${cx},${cz}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(nodes.length - 1)
    else buckets.set(key, [nodes.length - 1])
    return nodes.length - 1
  }

  const edgeKeys = new Set<string>()
  const segments: { from: number; to: number }[] = []
  for (const { segment } of raw) {
    const ts = [0, ...segment.splits.filter((t) => t > 0 && t < 1), 1].sort((p, q) => p - q)
    const ids = ts.map((t) => nodeAt(segment.a[0] + (segment.b[0] - segment.a[0]) * t, segment.a[1] + (segment.b[1] - segment.a[1]) * t))
    for (let k = 0; k + 1 < ids.length; k++) {
      const from = ids[k]
      const to = ids[k + 1]
      if (from === to) continue
      const key = from < to ? `${from}:${to}` : `${to}:${from}`
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key)
      segments.push({ from, to })
    }
  }
  const edges: Edge[][] = nodes.map(() => [])
  for (const { from, to } of segments) {
    const length = Math.hypot(nodes[from][0] - nodes[to][0], nodes[from][1] - nodes[to][1])
    edges[from].push({ to, length })
    edges[to].push({ to: from, length })
  }
  return { nodes, edges, segments }
}


function snapToRoad(g: Graph, x: number, z: number): Snap {
  let best: Snap = { segment: 0, t: 0, x: g.nodes[0][0], z: g.nodes[0][1], offset: Infinity }
  g.segments.forEach((entry, index) => {
    const a = g.nodes[entry.from]
    const b = g.nodes[entry.to]
    const near = projectOnto({ a, b, splits: [] }, x, z)
    if (near.distance < best.offset) best = { segment: index, t: near.t, x: a[0] + (b[0] - a[0]) * near.t, z: a[1] + (b[1] - a[1]) * near.t, offset: near.distance }
  })
  return best
}

class MinHeap {
  private keys: number[] = []
  private values: number[] = []

  get size(): number {
    return this.keys.length
  }

  push(key: number, value: number): void {
    this.keys.push(key)
    this.values.push(value)
    let child = this.keys.length - 1
    while (child > 0) {
      const parent = (child - 1) >> 1
      if (this.keys[parent] <= this.keys[child]) break
      this.swap(parent, child)
      child = parent
    }
  }

  pop(): { key: number; value: number } {
    const top = { key: this.keys[0], value: this.values[0] }
    const lastKey = this.keys.pop() as number
    const lastValue = this.values.pop() as number
    if (this.keys.length > 0) {
      this.keys[0] = lastKey
      this.values[0] = lastValue
      let parent = 0
      for (;;) {
        const left = parent * 2 + 1
        const right = left + 1
        let smallest = parent
        if (left < this.keys.length && this.keys[left] < this.keys[smallest]) smallest = left
        if (right < this.keys.length && this.keys[right] < this.keys[smallest]) smallest = right
        if (smallest === parent) break
        this.swap(parent, smallest)
        parent = smallest
      }
    }
    return top
  }

  private swap(i: number, j: number): void {
    const key = this.keys[i]
    this.keys[i] = this.keys[j]
    this.keys[j] = key
    const value = this.values[i]
    this.values[i] = this.values[j]
    this.values[j] = value
  }
}

function pathLength(points: Point[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  return length
}

/** A road network built once from its polylines; `route` finds the drive between two points on it. */
export interface RoadNetwork {
  route(fromX: number, fromZ: number, toX: number, toZ: number): RoutePath
}

/**
 * Builds a network lazily from `roads` (the graph is made on the first route). A road end within `tolerance` metres of another
 * road joins it; simplified road data needs at least its simplification tolerance here, or T-junctions come apart.
 */
export function createRoadNetwork(roads: readonly RoadLine[], tolerance = ENDPOINT_TOLERANCE): RoadNetwork {
  let g: Graph | null = null
  return { route: (fromX, fromZ, toX, toZ) => routeOn((g ??= buildGraph(roads, tolerance)), fromX, fromZ, toX, toZ) }
}

const COUNTY_ROADS = createRoadNetwork(ROADS)

/**
 * The drive from (fromX, fromZ) to (toX, toZ) on the county: walk to the nearest road point, follow roads by A*, walk off at the
 * nearest road point to the destination. `points` starts and ends at the given coordinates; `length` is the whole polyline in metres.
 */
export function route(fromX: number, fromZ: number, toX: number, toZ: number): RoutePath {
  return COUNTY_ROADS.route(fromX, fromZ, toX, toZ)
}

function routeOn(g: Graph, fromX: number, fromZ: number, toX: number, toZ: number): RoutePath {
  if (fromX === toX && fromZ === toZ) return { points: [[fromX, fromZ]], length: 0 }
  const start = snapToRoad(g, fromX, fromZ)
  const goal = snapToRoad(g, toX, toZ)
  const startEdge = g.segments[start.segment]
  const goalEdge = g.segments[goal.segment]
  const origin: Point = [fromX, fromZ]
  const destination: Point = [toX, toZ]
  const snappedStart: Point = [start.x, start.z]
  const snappedGoal: Point = [goal.x, goal.z]

  const direct = start.segment === goal.segment
  let best: Point[] | null = direct ? [origin, snappedStart, snappedGoal, destination] : null
  let bestLength = best ? pathLength(best) : Infinity

  const count = g.nodes.length
  const cost = new Float64Array(count).fill(Infinity)
  const parent = new Int32Array(count).fill(-1)
  const closed = new Uint8Array(count)
  const heap = new MinHeap()
  const heuristic = (node: number) => Math.hypot(g.nodes[node][0] - goal.x, g.nodes[node][1] - goal.z)
  for (const node of [startEdge.from, startEdge.to]) {
    cost[node] = Math.hypot(g.nodes[node][0] - start.x, g.nodes[node][1] - start.z)
    heap.push(cost[node] + heuristic(node), node)
  }
  const goalNodes = [goalEdge.from, goalEdge.to]
  let bestGoalNode = -1
  let bestGoalCost = Infinity
  while (heap.size > 0) {
    const { key, value: node } = heap.pop()
    if (closed[node]) continue
    if (key >= bestGoalCost) break
    closed[node] = 1
    if (goalNodes.includes(node)) {
      const total = cost[node] + Math.hypot(g.nodes[node][0] - goal.x, g.nodes[node][1] - goal.z)
      if (total < bestGoalCost) {
        bestGoalCost = total
        bestGoalNode = node
      }
    }
    for (const edge of g.edges[node]) {
      const next = cost[node] + edge.length
      if (next < cost[edge.to]) {
        cost[edge.to] = next
        parent[edge.to] = node
        heap.push(next + heuristic(edge.to), edge.to)
      }
    }
  }
  if (bestGoalNode >= 0) {
    const nodePath: Point[] = []
    for (let node = bestGoalNode; node >= 0; node = parent[node]) nodePath.push(g.nodes[node])
    nodePath.reverse()
    const candidate: Point[] = [origin, snappedStart, ...nodePath, snappedGoal, destination]
    const length = pathLength(candidate)
    if (length < bestLength) {
      best = candidate
      bestLength = length
    }
  }
  if (!best) return { points: [], length: Infinity }
  const points: Point[] = [best[0]]
  for (let i = 1; i < best.length; i++) {
    const previous = points[points.length - 1]
    if (Math.hypot(best[i][0] - previous[0], best[i][1] - previous[1]) > 1e-9 || i === best.length - 1) points.push(best[i])
  }
  return { points, length: pathLength(points) }
}

/** Zone-to-zone drive lengths on `network`, cached per pair. */
export function zoneDistances(network: RoadNetwork): (from: Zone, to: Zone) => number {
  const cache = new Map<string, number>()
  return (from, to) => {
    const key = `${from.id}>${to.id}`
    const known = cache.get(key)
    if (known !== undefined) return known
    const length = network.route(from.x, from.z, to.x, to.z).length
    cache.set(key, length)
    return length
  }
}

const routeDistance = zoneDistances(COUNTY_ROADS)

/** The county as a `HaulWorld`: Millbrook, the highway loop, the work sites and Haulers Row. */
export const COUNTY: HaulWorld = {
  id: 'county',
  sites: SITES,
  zones: ALL_ZONES,
  lots: LOTS,
  lot: (index: number) => LOTS[index],
  zone: (id: string) => ZONE_BY_ID[id],
  site: (id: string) => SITE_BY_ID[id],
  zonesOfKind: (kind: ZoneKind) => ALL_ZONES.filter((zone) => zone.kind === kind),
  routeDistance,
}
