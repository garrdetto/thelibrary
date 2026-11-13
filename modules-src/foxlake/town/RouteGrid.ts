/**
 * Turn-by-turn routing across all of Fox Lake (renderer-free). The lake
 * country and the town are rasterised once into 6 m cells in scene
 * coordinates (+x east, +z north): roads, the county road and the interstate
 * are cheap, trails a little dearer, open ground and woods dearer still, and
 * water, buildings and the edge of the world can't be crossed. A* finds the
 * cheapest path, which is simplified into straight legs and turned into
 * spoken-style steps ("Turn left onto Elm St").
 */
import { HALF, PLAY_LIMIT, highwayCoord, type Terrain } from '../../rackreel/world/Terrain'
import { onHighway } from '../../rackreel/world/Highway'
import { ROADS, curveDistance } from '../../maplestreet/shared/WorldLayout'
import { CONNECTOR, TOWN_SQUARE, connectorDistance, inTownSquare, sceneToTown } from '../region'

export const ROUTE_CELL = 6

export const KIND = { blocked: 0, water: 1, forest: 2, meadow: 3, trail: 4, highway: 5, connector: 6, road: 7, lawn: 8, building: 9, marsh: 10, rock: 11 } as const
export type Kind = (typeof KIND)[keyof typeof KIND]

const COST: Record<number, number> = {
  [KIND.blocked]: Infinity,
  [KIND.water]: Infinity,
  [KIND.building]: Infinity,
  [KIND.road]: 1,
  [KIND.highway]: 1,
  [KIND.connector]: 1,
  [KIND.trail]: 1.6,
  [KIND.lawn]: 4,
  [KIND.meadow]: 3.5,
  [KIND.forest]: 6,
  [KIND.marsh]: 6,
  [KIND.rock]: 8,
}

export interface Point {
  x: number
  z: number
}

export interface Step {
  /** Where the step happens (scene coordinates) and how far along the route that is, in metres. */
  at: Point
  along: number
  turn: 'start' | 'left' | 'right' | 'slight-left' | 'slight-right' | 'sharp-left' | 'sharp-right' | 'straight' | 'arrive'
  text: string
}

export interface Route {
  points: Point[]
  /** Distance along the route at each point. */
  along: number[]
  length: number
  steps: Step[]
  goal: Point
}

export interface RouteWorld {
  terrain: Terrain
  /** True where a town solid (a house, a shop) stands, in town coordinates. */
  blocked(townX: number, townZ: number): boolean
  /** The street name at a town point (scene coordinates), or null. */
  streetName(x: number, z: number): string | null
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']

export function compass(dx: number, dz: number): string {
  const a = Math.atan2(dx, dz)
  return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]
}

export function formatDistance(m: number): string {
  if (m >= 950) return `${(m / 1000).toFixed(1)} km`
  if (m >= 100) return `${Math.round(m / 10) * 10} m`
  return `${Math.max(5, Math.round(m / 5) * 5)} m`
}

export class RouteGrid {
  readonly x0 = TOWN_SQUARE.x0
  readonly z0 = -HALF
  readonly cols: number
  readonly rows: number
  readonly kinds: Uint8Array

  constructor(private readonly world: RouteWorld) {
    const x1 = HALF
    const z1 = TOWN_SQUARE.z1
    this.cols = Math.ceil((x1 - this.x0) / ROUTE_CELL)
    this.rows = Math.ceil((z1 - this.z0) / ROUTE_CELL)
    this.kinds = new Uint8Array(this.cols * this.rows)
    for (let j = 0; j < this.rows; j++) for (let i = 0; i < this.cols; i++) this.kinds[j * this.cols + i] = this.classify(this.x0 + (i + 0.5) * ROUTE_CELL, this.z0 + (j + 0.5) * ROUTE_CELL)
  }

  private nearConnector(x: number, z: number): boolean {
    if (z < HALF - 12 || z > CONNECTOR.end.z + 8) return false
    const lo = Math.min(CONNECTOR.start.x, CONNECTOR.end.x) - 30
    const hi = Math.max(CONNECTOR.start.x, CONNECTOR.end.x) + 30
    return x > lo && x < hi && connectorDistance(x, z) < 1
  }

  private classify(x: number, z: number): Kind {
    if (this.nearConnector(x, z)) return KIND.connector
    if (z <= HALF) {
      if (Math.abs(x) > PLAY_LIMIT || z < -PLAY_LIMIT) return KIND.blocked
      const h = highwayCoord(x, z)
      const ground = this.world.terrain.groundAt(x, z)
      if (onHighway(h.across, h.t) && this.world.terrain.heightAt(x, z) > -0.3) return KIND.highway
      if (ground === 'water') return KIND.water
      if (ground === 'trail') return KIND.trail
      if (ground === 'forest') return KIND.forest
      if (ground === 'marsh') return KIND.marsh
      if (ground === 'rock') return KIND.rock
      return KIND.meadow
    }
    if (!inTownSquare(x, z, 2)) return KIND.blocked
    const t = sceneToTown(x, 0, z)
    for (const r of ROADS) if (Math.abs(t.x - r.cx) < r.sx / 2 && Math.abs(t.z - r.cz) < r.sz / 2) return KIND.road
    if (curveDistance(t.x, t.z) < 3.5) return KIND.road
    if (this.world.blocked(t.x, t.z)) return KIND.building
    return KIND.lawn
  }

  index(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / ROUTE_CELL)
    const j = Math.floor((z - this.z0) / ROUTE_CELL)
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return -1
    return j * this.cols + i
  }

  center(k: number): Point {
    const i = k % this.cols
    const j = (k - i) / this.cols
    return { x: this.x0 + (i + 0.5) * ROUTE_CELL, z: this.z0 + (j + 0.5) * ROUTE_CELL }
  }

  kindAt(x: number, z: number): Kind {
    const k = this.index(x, z)
    return k < 0 ? KIND.blocked : (this.kinds[k] as Kind)
  }

  passable(k: number): boolean {
    return k >= 0 && Number.isFinite(COST[this.kinds[k]])
  }

  /** The nearest cell you can travel through, within `reach` metres. */
  nearestPassable(x: number, z: number, reach = 120): number {
    const k0 = this.index(x, z)
    if (this.passable(k0)) return k0
    const r = Math.ceil(reach / ROUTE_CELL)
    const ci = Math.floor((x - this.x0) / ROUTE_CELL)
    const cj = Math.floor((z - this.z0) / ROUTE_CELL)
    let best = -1
    let bd = Infinity
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = ci + di
      const j = cj + dj
      if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) continue
      const k = j * this.cols + i
      if (!this.passable(k)) continue
      const d = di * di + dj * dj
      if (d < bd) {
        bd = d
        best = k
      }
    }
    return best
  }

  /** The cheapest route from `from` to `to` (or to the closest reachable point, for an island or open water), or null when there is none. */
  route(from: Point, to: Point): Route | null {
    const start = this.nearestPassable(from.x, from.z)
    const goal = this.nearestPassable(to.x, to.z, 700)
    if (start < 0 || goal < 0) return null
    const cells = this.search(start, goal)
    if (!cells) return null
    const raw = cells.map((k) => this.center(k))
    raw[0] = { x: from.x, z: from.z }
    const end = this.center(cells[cells.length - 1])
    raw[raw.length - 1] = end
    const points = simplify(raw, 9)
    const along = [0]
    for (let i = 1; i < points.length; i++) along.push(along[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z))
    const length = along[along.length - 1]
    return { points, along, length, steps: this.steps(points, along), goal: end }
  }

  private search(start: number, goal: number): number[] | null {
    const n = this.kinds.length
    const g = new Float32Array(n).fill(Infinity)
    const from = new Int32Array(n).fill(-1)
    const closed = new Uint8Array(n)
    const heap = new Heap()
    const gp = this.center(goal)
    const h = (k: number) => {
      const p = this.center(k)
      return Math.hypot(p.x - gp.x, p.z - gp.z) / ROUTE_CELL
    }
    g[start] = 0
    heap.push(start, h(start))
    const cols = this.cols
    let nearest = start
    let nearestH = h(start)
    while (heap.size) {
      const k = heap.pop()
      if (k === goal) break
      if (closed[k]) continue
      closed[k] = 1
      const hk = h(k)
      if (hk < nearestH) {
        nearestH = hk
        nearest = k
      }
      const i = k % cols
      const j = (k - i) / cols
      const here = COST[this.kinds[k]]
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue
        const ni = i + di
        const nj = j + dj
        if (ni < 0 || nj < 0 || ni >= cols || nj >= this.rows) continue
        const nk = nj * cols + ni
        if (closed[nk]) continue
        const c = COST[this.kinds[nk]]
        if (!Number.isFinite(c)) continue
        if (di && dj && (!this.passable(j * cols + ni) || !this.passable(nj * cols + i))) continue
        const step = (di && dj ? Math.SQRT2 : 1) * (c + here) * 0.5
        const ng = g[k] + step
        if (ng < g[nk]) {
          g[nk] = ng
          from[nk] = k
          heap.push(nk, ng + h(nk))
        }
      }
    }
    const end = from[goal] >= 0 || goal === start ? goal : nearest
    if (end === start && goal !== start) return null
    const out: number[] = []
    for (let k = end; k >= 0; k = from[k]) {
      out.push(k)
      if (k === start) break
    }
    return out.reverse()
  }

  /** What a leg is called: a street, the county road, the interstate, a trail, or nothing (open ground). */
  legName(a: Point, b: Point): string | null {
    const counts = new Map<string, number>()
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    const n = Math.max(1, Math.min(9, Math.round(len / 12)))
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n
      const x = a.x + (b.x - a.x) * t
      const z = a.z + (b.z - a.z) * t
      const kind = this.kindAt(x, z)
      const name = kind === KIND.road ? this.world.streetName(x, z) : kind === KIND.connector ? 'County Road' : kind === KIND.highway ? 'the interstate' : kind === KIND.trail ? 'the trail' : ''
      counts.set(name ?? '', (counts.get(name ?? '') ?? 0) + 1)
    }
    let best = ''
    let bc = -1
    for (const [name, c] of counts) if (c > bc) {
      bc = c
      best = name
    }
    return best || null
  }

  private steps(points: Point[], along: number[]): Step[] {
    const out: Step[] = []
    if (points.length < 2) return out
    const names: (string | null)[] = []
    for (let i = 0; i + 1 < points.length; i++) names.push(this.legName(points[i], points[i + 1]))
    const first = names[0]
    const d0 = { x: points[1].x - points[0].x, z: points[1].z - points[0].z }
    out.push({ at: points[0], along: 0, turn: 'start', text: `Head ${compass(d0.x, d0.z)}${first ? ` on ${first}` : ''}` })
    let prevName = first
    let legStart = 0
    for (let i = 1; i + 1 < points.length; i++) {
      const a = points[legStart]
      const b = points[i]
      const c = points[i + 1]
      const ax = b.x - a.x
      const az = b.z - a.z
      const bx = c.x - b.x
      const bz = c.z - b.z
      const angle = Math.atan2(ax * bz - az * bx, ax * bx + az * bz)
      const deg = Math.abs(angle) * (180 / Math.PI)
      const name = names[i]
      const renamed = name !== prevName && !!name
      const needed = name || prevName ? 40 : 65
      if (deg < needed && !renamed) continue
      if (along[i + 1] - along[i] < 10 && i + 2 < points.length && deg < 70) continue
      const left = angle > 0
      const turn: Step['turn'] = deg < 30 ? 'straight' : deg < 55 ? (left ? 'slight-left' : 'slight-right') : deg < 130 ? (left ? 'left' : 'right') : left ? 'sharp-left' : 'sharp-right'
      const verb = turn === 'straight' ? 'Continue' : turn === 'slight-left' ? 'Bear left' : turn === 'slight-right' ? 'Bear right' : turn === 'left' ? 'Turn left' : turn === 'right' ? 'Turn right' : turn === 'sharp-left' ? 'Make a sharp left' : 'Make a sharp right'
      out.push({ at: b, along: along[i], turn, text: name && name !== prevName ? `${verb} onto ${name}` : verb })
      prevName = name
      legStart = i
    }
    out.push({ at: points[points.length - 1], along: along[along.length - 1], turn: 'arrive', text: 'Arrive at your destination' })
    return out
  }
}

/** Douglas–Peucker: drops points within `tolerance` metres of the straight line between their neighbours. */
export function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    const a = points[s]
    const b = points[e]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz) || 1
    let worst = -1
    let wd = tolerance
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((points[i].x - a.x) * dz - (points[i].z - a.z) * dx) / len
      if (d > wd) {
        wd = d
        worst = i
      }
    }
    if (worst < 0) continue
    keep[worst] = 1
    stack.push([s, worst], [worst, e])
  }
  return points.filter((_, i) => keep[i])
}

/** Where `p` is along the route (metres) and how far it is from the route's line. */
export function progressOn(route: Route, p: Point): { along: number; off: number } {
  let best = Infinity
  let at = 0
  const pts = route.points
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2))
    const d = Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z)
    if (d < best) {
      best = d
      at = route.along[i] + Math.sqrt(l2) * t
    }
  }
  return { along: at, off: best }
}

class Heap {
  private keys: number[] = []
  private pri: number[] = []

  get size(): number {
    return this.keys.length
  }

  push(k: number, p: number): void {
    const keys = this.keys
    const pri = this.pri
    let i = keys.length
    keys.push(k)
    pri.push(p)
    while (i > 0) {
      const up = (i - 1) >> 1
      if (pri[up] <= p) break
      keys[i] = keys[up]
      pri[i] = pri[up]
      i = up
    }
    keys[i] = k
    pri[i] = p
  }

  pop(): number {
    const keys = this.keys
    const pri = this.pri
    const top = keys[0]
    const k = keys.pop()!
    const p = pri.pop()!
    const n = keys.length
    if (n) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && pri[c + 1] < pri[c]) c++
        if (pri[c] >= p) break
        keys[i] = keys[c]
        pri[i] = pri[c]
        i = c
      }
      keys[i] = k
      pri[i] = p
    }
    return top
  }
}
