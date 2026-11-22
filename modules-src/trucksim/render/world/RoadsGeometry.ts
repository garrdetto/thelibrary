/**
 * Road ribbons as plain arrays. Every road in `ROADS` becomes a polyline with arc lengths; where a road runs into one of higher
 * rank (highway, then road, street, gravel; earlier in the list first) the lower road is cut back to the other's shoulder edge,
 * and the higher road records a "mouth" there so its edge line and shoulder give way to the joining road's surface (both sides
 * and the centre line at a crossing). A chunk's ribbon is built from the stretches of centre line inside the chunk: stations at
 * every vertex, cut, mouth edge, dash end and at most 4 m apart, each span with its own two rows of vertices so dashes and
 * mouths change colour crisply. The cross-section is laid edge to edge (shoulder, asphalt, painted lines, wheel-path tint or
 * gravel tyre tracks) with no overlapping faces, so paint never fights the asphalt, and the whole ribbon sits 2 cm above the
 * ground. Renderer-free; the Roads layer turns the arrays into one mesh per chunk.
 */
import { SHOULDER, valueNoise } from '../../shared/Terrain'
import type { Terrain } from '../../shared/Terrain'
import { CHUNK_SIZE, ROADS, SITE_BY_ID } from '../../shared/WorldLayout'
import type { Road, RoadKind } from '../../shared/WorldLayout'
import { linearFromHex } from './AtmosphereSky'
import type { Rgb } from './AtmosphereSky'
import { frontFacing } from './WorldRendererBuffers'

export const ROAD_LIFT = 0.02
const MAX_STATION_SPACING = 4
const DASH_PERIOD = 12
const DASH_LENGTH = 3
const RANK: Record<RoadKind, number> = { highway: 0, road: 1, street: 2, gravel: 3 }

type Role = 'asphalt' | 'oil' | 'wheel' | 'white' | 'whiteDash' | 'yellow' | 'shoulder' | 'gravel' | 'track' | 'crown' | 'verge'

interface Breakpoint {
  offset: number
  role: Role
}

export interface Mouth {
  from: number
  to: number
  /** +1 left of the road's direction, −1 right, 0 both (a crossing). */
  side: number
  gravel: boolean
}

export interface RoadPath {
  road: Road
  index: number
  rank: number
  half: number
  loop: boolean
  /** Polyline points; a loop repeats its first point at the end. */
  xs: number[]
  zs: number[]
  /** Arc length at each point. */
  arc: number[]
  length: number
  /** Arc intervals cut away where the road runs into a higher one. */
  cuts: [number, number][]
  mouths: Mouth[]
  section: Breakpoint[]
  dashed: boolean
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export const ROAD_COLORS: Record<Role, Rgb> = {
  asphalt: linearFromHex(0x3b3c3d),
  oil: linearFromHex(0x323334),
  wheel: linearFromHex(0x444546),
  white: linearFromHex(0xdad8d0),
  whiteDash: linearFromHex(0xdad8d0),
  yellow: linearFromHex(0xd8a42e),
  shoulder: linearFromHex(0x8a8170),
  gravel: linearFromHex(0x9b9180),
  track: linearFromHex(0x7c7365),
  crown: linearFromHex(0xa59b89),
  verge: linearFromHex(0x80805e),
}
const SIDEWALK = linearFromHex(0xa6a39b)

function pavedSection(half: number, lanes: boolean): Breakpoint[] {
  const s = SHOULDER
  const right: Breakpoint[] = [
    { offset: -half - s, role: 'shoulder' }, { offset: -half, role: 'shoulder' },
    { offset: -half, role: 'asphalt' }, { offset: -half + 0.2, role: 'asphalt' },
    { offset: -half + 0.2, role: 'white' }, { offset: -half + 0.35, role: 'white' },
    { offset: -half + 0.35, role: 'asphalt' },
  ]
  if (lanes) {
    const lane = half / 2
    right.push(
      { offset: -lane - lane / 2, role: 'wheel' },
      { offset: -lane - 0.06, role: 'asphalt' }, { offset: -lane - 0.06, role: 'whiteDash' },
      { offset: -lane + 0.06, role: 'whiteDash' }, { offset: -lane + 0.06, role: 'asphalt' },
      { offset: -lane / 2, role: 'oil' },
    )
  } else {
    right.push({ offset: -half * 0.68, role: 'wheel' }, { offset: -half * 0.48, role: 'oil' }, { offset: -half * 0.28, role: 'wheel' })
  }
  right.push(
    { offset: -0.23, role: 'asphalt' }, { offset: -0.23, role: 'yellow' }, { offset: -0.11, role: 'yellow' }, { offset: -0.11, role: 'asphalt' },
  )
  const left = right.map((point) => ({ offset: -point.offset, role: point.role })).reverse()
  return [...right, ...left]
}

function streetSection(half: number): Breakpoint[] {
  const s = SHOULDER
  return [
    { offset: -half - s, role: 'shoulder' }, { offset: -half, role: 'shoulder' },
    { offset: -half, role: 'asphalt' }, { offset: -half * 0.55, role: 'wheel' }, { offset: 0, role: 'oil' }, { offset: half * 0.55, role: 'wheel' },
    { offset: half, role: 'asphalt' }, { offset: half, role: 'shoulder' }, { offset: half + s, role: 'shoulder' },
  ]
}

function gravelSection(half: number): Breakpoint[] {
  const outer = half - 1.3
  const inner = Math.max(0.75, half - 3.1)
  const right: Breakpoint[] = [
    { offset: -half - SHOULDER, role: 'verge' }, { offset: -half, role: 'gravel' },
    { offset: -outer - 0.4, role: 'gravel' }, { offset: -outer, role: 'track' }, { offset: -outer + 0.4, role: 'gravel' },
    { offset: -inner - 0.4, role: 'gravel' }, { offset: -inner, role: 'track' }, { offset: -inner + 0.4, role: 'gravel' },
  ]
  const left = right.map((point) => ({ offset: -point.offset, role: point.role })).reverse()
  return [...right, { offset: 0, role: 'crown' }, ...left]
}

function sectionFor(road: Road): Breakpoint[] {
  const half = road.width / 2
  switch (road.kind) {
    case 'highway': return pavedSection(half, true)
    case 'road': return pavedSection(half, false)
    case 'street': return streetSection(half)
    default: return gravelSection(half)
  }
}

function buildPath(road: Road, index: number): RoadPath {
  const xs = road.points.map((point) => point[0])
  const zs = road.points.map((point) => point[1])
  if (road.loop) {
    xs.push(xs[0])
    zs.push(zs[0])
  }
  const arc = [0]
  for (let i = 1; i < xs.length; i++) arc.push(arc[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]))
  const section = sectionFor(road)
  return {
    road, index, rank: RANK[road.kind], half: road.width / 2, loop: !!road.loop, xs, zs, arc, length: arc[arc.length - 1], cuts: [], mouths: [],
    section, dashed: section.some((point) => point.role === 'whiteDash'),
    minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
  }
}

interface Projection {
  distance: number
  arc: number
  lateral: number
  dirX: number
  dirZ: number
}

/** Nearest point of `path` to (x, z), ignoring projections past the ends of an open road. */
export function projectOnPath(path: RoadPath, x: number, z: number, out: Projection): Projection {
  out.distance = Number.POSITIVE_INFINITY
  const last = path.xs.length - 2
  for (let i = 0; i <= last; i++) {
    const ax = path.xs[i]
    const az = path.zs[i]
    const ex = path.xs[i + 1] - ax
    const ez = path.zs[i + 1] - az
    const length2 = ex * ex + ez * ez
    if (length2 < 1e-9) continue
    let t = ((x - ax) * ex + (z - az) * ez) / length2
    if (!path.loop && ((i === 0 && t < 0) || (i === last && t > 1))) continue
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const px = ax + ex * t - x
    const pz = az + ez * t - z
    const distance = Math.sqrt(px * px + pz * pz)
    if (distance < out.distance) {
      const length = Math.sqrt(length2)
      out.distance = distance
      out.arc = path.arc[i] + t * length
      out.dirX = ex / length
      out.dirZ = ez / length
      out.lateral = ((x - ax) * ez - (z - az) * ex) / length
    }
  }
  return out
}

/** Point and unit direction at arc length `s` (clamped, or wrapped on a loop). */
export function pointAt(path: RoadPath, s: number, out: { x: number; z: number; dirX: number; dirZ: number; segment: number }): typeof out {
  let arc = s
  if (path.loop) arc = ((arc % path.length) + path.length) % path.length
  else arc = Math.max(0, Math.min(path.length, arc))
  let segment = 0
  while (segment < path.xs.length - 2 && path.arc[segment + 1] < arc) segment++
  const length = path.arc[segment + 1] - path.arc[segment] || 1
  const t = (arc - path.arc[segment]) / length
  const ex = path.xs[segment + 1] - path.xs[segment]
  const ez = path.zs[segment + 1] - path.zs[segment]
  out.x = path.xs[segment] + ex * t
  out.z = path.zs[segment] + ez * t
  out.dirX = ex / length
  out.dirZ = ez / length
  out.segment = segment
  return out
}

function outranks(a: RoadPath, b: RoadPath): boolean {
  return a.rank < b.rank || (a.rank === b.rank && a.index < b.index)
}

function boxesMeet(a: RoadPath, b: RoadPath, margin: number): boolean {
  return a.minX - margin <= b.maxX && a.maxX + margin >= b.minX && a.minZ - margin <= b.maxZ && a.maxZ + margin >= b.minZ
}

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  intervals.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const interval of intervals) {
    const last = merged[merged.length - 1]
    if (last && interval[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], interval[1])
    else merged.push([interval[0], interval[1]])
  }
  return merged
}

function findCuts(lower: RoadPath, higher: RoadPath): [number, number][] {
  const reach = higher.half + SHOULDER
  const projection: Projection = { distance: 0, arc: 0, lateral: 0, dirX: 0, dirZ: 0 }
  const point = { x: 0, z: 0, dirX: 0, dirZ: 0, segment: 0 }
  const inside = (s: number) => projectOnPath(higher, pointAt(lower, s, point).x, point.z, projection).distance < reach
  const step = 0.5
  const intervals: [number, number][] = []
  let start = inside(0) ? 0 : -1
  let previous = 0
  for (let s = step; s <= lower.length + step * 0.5; s += step) {
    const at = Math.min(s, lower.length)
    const now = inside(at)
    if (now && start < 0) {
      let a = previous
      let b = at
      for (let k = 0; k < 24; k++) {
        const mid = (a + b) / 2
        if (inside(mid)) b = mid
        else a = mid
      }
      start = b
    } else if (!now && start >= 0) {
      let a = previous
      let b = at
      for (let k = 0; k < 24; k++) {
        const mid = (a + b) / 2
        if (inside(mid)) a = mid
        else b = mid
      }
      intervals.push([start, a])
      start = -1
    }
    previous = at
  }
  if (start >= 0) intervals.push([start, lower.length])
  return intervals
}

function addMouth(lower: RoadPath, higher: RoadPath, cut: [number, number]): void {
  const projection: Projection = { distance: 0, arc: 0, lateral: 0, dirX: 0, dirZ: 0 }
  const point = { x: 0, z: 0, dirX: 0, dirZ: 0, segment: 0 }
  let bestArc = cut[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (let s = cut[0]; s <= cut[1] + 1e-6; s += 0.25) {
    pointAt(lower, s, point)
    const distance = projectOnPath(higher, point.x, point.z, projection).distance
    if (distance < bestDistance) {
      bestDistance = distance
      bestArc = s
    }
  }
  pointAt(lower, bestArc, point)
  const lowerDirX = point.dirX
  const lowerDirZ = point.dirZ
  projectOnPath(higher, point.x, point.z, projection)
  const center = projection.arc
  const sine = Math.abs(lowerDirX * projection.dirZ - lowerDirZ * projection.dirX)
  const reach = (lower.half + 0.35) / Math.max(0.35, sine)
  const sides: number[] = []
  const probe = (s: number) => {
    pointAt(lower, s, point)
    const lateral = projectOnPath(higher, point.x, point.z, { distance: 0, arc: 0, lateral: 0, dirX: 0, dirZ: 0 }).lateral
    sides.push(Math.sign(lateral))
  }
  if (lower.loop || cut[0] > 0.01) probe(cut[0] - 1)
  if (lower.loop || cut[1] < lower.length - 0.01) probe(cut[1] + 1)
  let side = sides[0] ?? 0
  if (sides.length === 2 && sides[0] !== sides[1]) side = 0
  const mouth = { from: center - reach, to: center + reach, side, gravel: lower.road.kind === 'gravel' }
  if (higher.loop) {
    const span = higher.length
    const from = ((mouth.from % span) + span) % span
    const to = from + (mouth.to - mouth.from)
    if (to > span) {
      higher.mouths.push({ ...mouth, from, to: span }, { ...mouth, from: 0, to: to - span })
      return
    }
    higher.mouths.push({ ...mouth, from, to })
    return
  }
  higher.mouths.push(mouth)
}

/** The county's roads with their junction cuts and mouths, computed once. */
export class RoadNetwork {
  readonly paths: RoadPath[]

  constructor(roads: readonly Road[] = ROADS) {
    this.paths = roads.map((road, index) => buildPath(road, index))
    for (const lower of this.paths) {
      const cuts: [number, number][] = []
      for (const higher of this.paths) {
        if (higher === lower || !outranks(higher, lower) || !boxesMeet(lower, higher, higher.half + SHOULDER + 1)) continue
        for (const cut of findCuts(lower, higher)) {
          cuts.push(cut)
          addMouth(lower, higher, cut)
        }
      }
      lower.cuts = mergeIntervals(cuts)
    }
  }
}

let sharedNetwork: RoadNetwork | null = null

/** The network for the county's `ROADS` (built on first use). */
export function getRoadNetwork(): RoadNetwork {
  sharedNetwork ??= new RoadNetwork()
  return sharedNetwork
}

export interface RoadArrays {
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  indices: Uint16Array | Uint32Array
}

interface Station {
  arc: number
  x: number
  z: number
  /** Left normal scaled by the mitre factor. */
  leftX: number
  leftZ: number
  centerY: number
  leftY: number
  rightY: number
  normalX: number
  normalY: number
  normalZ: number
}

function clipSegment(ax: number, az: number, bx: number, bz: number, x0: number, z0: number, x1: number, z1: number): [number, number] | null {
  let t0 = 0
  let t1 = 1
  const dx = bx - ax
  const dz = bz - az
  const p = [-dx, dx, -dz, dz]
  const q = [ax - x0, x1 - ax, az - z0, z1 - az]
  for (let k = 0; k < 4; k++) {
    const upper = k === 1 || k === 3
    if (p[k] === 0) {
      if (upper ? q[k] <= 0 : q[k] < 0) return null
      continue
    }
    const r = q[k] / p[k]
    if (p[k] < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null
}

function subtract(runs: [number, number][], cuts: [number, number][]): [number, number][] {
  let result = runs
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = []
    for (const [r0, r1] of result) {
      if (c1 <= r0 || c0 >= r1) {
        next.push([r0, r1])
        continue
      }
      if (c0 > r0) next.push([r0, c0])
      if (c1 < r1) next.push([c1, r1])
    }
    result = next
  }
  return result.filter(([a, b]) => b - a > 0.05)
}

class ArrayBuilder {
  positions: number[] = []
  normals: number[] = []
  colors: number[] = []
  indices: number[] = []

  get vertexCount(): number {
    return this.positions.length / 3
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, color: Rgb): number {
    const index = this.vertexCount
    this.positions.push(x, y, z)
    this.normals.push(nx, ny, nz)
    this.colors.push(color[0], color[1], color[2], 1)
    return index
  }
}

const TOWN = SITE_BY_ID.town

/** The colour a breakpoint shows on this span (dashes, mouths and the town's sidewalks applied). */
function roleColor(role: Role, offset: number, path: RoadPath, mouth: Mouth | null, dashOn: boolean, x: number, z: number, terrain: Terrain, out: Rgb): Rgb {
  let shown: Role = role
  if (role === 'whiteDash' && !dashOn) shown = 'asphalt'
  if (mouth) {
    const sideHit = mouth.side === 0 || Math.sign(offset) === mouth.side
    const edgeZone = Math.abs(offset) > path.half * 0.75
    if (shown === 'shoulder' && sideHit) shown = mouth.gravel ? 'gravel' : 'asphalt'
    else if ((shown === 'white' || shown === 'whiteDash') && sideHit && (edgeZone || mouth.side === 0)) shown = 'asphalt'
    else if (shown === 'yellow' && mouth.side === 0) shown = 'asphalt'
  }
  const base = shown === 'shoulder' && path.road.kind === 'street' && Math.abs(x - TOWN.x) <= TOWN.w / 2 && Math.abs(z - TOWN.z) <= TOWN.d / 2 ? SIDEWALK : ROAD_COLORS[shown]
  let shade = 1
  if (shown === 'asphalt' || shown === 'oil' || shown === 'wheel') shade = 0.93 + 0.12 * (valueNoise(x, z, 31, terrain.seed + 71) * 0.5 + 0.5)
  else if (shown === 'gravel' || shown === 'track' || shown === 'crown' || shown === 'shoulder' || shown === 'verge') shade = 0.9 + 0.18 * (valueNoise(x, z, 9, terrain.seed + 72) * 0.5 + 0.5)
  else shade = 0.96 + 0.06 * (valueNoise(x, z, 5, terrain.seed + 73) * 0.5 + 0.5)
  out[0] = base[0] * shade
  out[1] = base[1] * shade
  out[2] = base[2] * shade
  return out
}

function stationAt(path: RoadPath, terrain: Terrain, s: number, vertexIndex: number, out: Station): Station {
  const point = { x: 0, z: 0, dirX: 0, dirZ: 0, segment: 0 }
  pointAt(path, s, point)
  let leftX = point.dirZ
  let leftZ = -point.dirX
  if (vertexIndex >= 0) {
    const count = path.xs.length
    const hasPrevious = vertexIndex > 0 || path.loop
    const hasNext = vertexIndex < count - 1 || path.loop
    if (hasPrevious && hasNext) {
      const previous = vertexIndex > 0 ? vertexIndex - 1 : count - 2
      const next = vertexIndex < count - 1 ? vertexIndex + 1 : 1
      const at = vertexIndex === count - 1 && path.loop ? 0 : vertexIndex
      const inX = path.xs[at] - path.xs[previous]
      const inZ = path.zs[at] - path.zs[previous]
      const outX = path.xs[next] - path.xs[at]
      const outZ = path.zs[next] - path.zs[at]
      const inLength = Math.hypot(inX, inZ) || 1
      const outLength = Math.hypot(outX, outZ) || 1
      const l1x = inZ / inLength
      const l1z = -inX / inLength
      const l2x = outZ / outLength
      const l2z = -outX / outLength
      let mx = l1x + l2x
      let mz = l1z + l2z
      const mLength = Math.hypot(mx, mz)
      if (mLength > 1e-6) {
        mx /= mLength
        mz /= mLength
        const scale = 1 / Math.max(0.35, mx * l1x + mz * l1z)
        leftX = mx * scale
        leftZ = mz * scale
      }
    }
  }
  const reach = path.half + SHOULDER
  out.arc = s
  out.x = point.x
  out.z = point.z
  out.leftX = leftX
  out.leftZ = leftZ
  out.centerY = terrain.heightAt(point.x, point.z)
  out.leftY = terrain.heightAt(point.x + leftX * reach, point.z + leftZ * reach)
  out.rightY = terrain.heightAt(point.x - leftX * reach, point.z - leftZ * reach)
  const normal = terrain.normalAt(point.x, point.z, 2)
  out.normalX = normal[0]
  out.normalY = normal[1]
  out.normalZ = normal[2]
  return out
}

function heightAcross(station: Station, offset: number, reach: number): number {
  const t = Math.min(1, Math.abs(offset) / reach)
  return station.centerY + ((offset >= 0 ? station.leftY : station.rightY) - station.centerY) * t
}

function mouthAt(path: RoadPath, s: number): Mouth | null {
  for (const mouth of path.mouths) if (s >= mouth.from && s <= mouth.to) return mouth
  return null
}

function vertexAtArc(path: RoadPath, arc: number): number {
  for (let i = 0; i < path.arc.length; i++) if (Math.abs(path.arc[i] - arc) < 1e-6) return i
  return -1
}

function stationArcs(path: RoadPath, run: [number, number]): { arcs: number[]; vertices: number[] } {
  const marks: { arc: number; vertex: number }[] = [{ arc: run[0], vertex: vertexAtArc(path, run[0]) }, { arc: run[1], vertex: vertexAtArc(path, run[1]) }]
  for (let i = 0; i < path.arc.length; i++) if (path.arc[i] > run[0] && path.arc[i] < run[1]) marks.push({ arc: path.arc[i], vertex: i })
  for (const mouth of path.mouths) {
    if (mouth.from > run[0] && mouth.from < run[1]) marks.push({ arc: mouth.from, vertex: -1 })
    if (mouth.to > run[0] && mouth.to < run[1]) marks.push({ arc: mouth.to, vertex: -1 })
  }
  if (path.dashed) {
    const first = Math.floor(run[0] / DASH_PERIOD) * DASH_PERIOD
    for (let base = first; base < run[1]; base += DASH_PERIOD) {
      if (base > run[0]) marks.push({ arc: base, vertex: -1 })
      if (base + DASH_LENGTH > run[0] && base + DASH_LENGTH < run[1]) marks.push({ arc: base + DASH_LENGTH, vertex: -1 })
    }
  }
  marks.sort((a, b) => a.arc - b.arc)
  const arcs: number[] = []
  const vertices: number[] = []
  for (const mark of marks) {
    const last = arcs.length - 1
    if (last >= 0 && mark.arc - arcs[last] < 1e-3) {
      if (mark.vertex >= 0) vertices[last] = mark.vertex
      continue
    }
    if (last >= 0) {
      const gap = mark.arc - arcs[last]
      const pieces = Math.ceil(gap / MAX_STATION_SPACING)
      for (let k = 1; k < pieces; k++) {
        arcs.push(arcs[last] + (gap * k) / pieces)
        vertices.push(-1)
      }
    }
    arcs.push(mark.arc)
    vertices.push(mark.vertex)
  }
  return { arcs, vertices }
}

function emitRun(builder: ArrayBuilder, path: RoadPath, terrain: Terrain, run: [number, number], originX: number, originZ: number): void {
  const { arcs, vertices } = stationArcs(path, run)
  if (arcs.length < 2) return
  const section = path.section
  const reach = path.half + SHOULDER
  const color: Rgb = [0, 0, 0]
  let previous = stationAt(path, terrain, arcs[0], vertices[0], {} as Station)
  for (let k = 1; k < arcs.length; k++) {
    const current = stationAt(path, terrain, arcs[k], vertices[k], {} as Station)
    const mid = (previous.arc + current.arc) / 2
    const dashOn = ((mid % DASH_PERIOD) + DASH_PERIOD) % DASH_PERIOD < DASH_LENGTH
    const mouth = mouthAt(path, path.loop ? ((mid % path.length) + path.length) % path.length : mid)
    const rowStart = builder.vertexCount
    for (const station of [previous, current]) {
      for (const point of section) {
        const x = station.x + station.leftX * point.offset
        const z = station.z + station.leftZ * point.offset
        const y = heightAcross(station, point.offset, reach) + ROAD_LIFT
        roleColor(point.role, point.offset, path, mouth, dashOn, x, z, terrain, color)
        builder.vertex(x - originX, y, z - originZ, station.normalX, station.normalY, station.normalZ, color)
      }
    }
    const width = section.length
    for (let b = 0; b < width - 1; b++) {
      if (section[b + 1].offset - section[b].offset < 1e-4) continue
      const a0 = rowStart + b
      const a1 = rowStart + b + 1
      const c0 = rowStart + width + b
      const c1 = rowStart + width + b + 1
      const p = builder.positions
      if (frontFacing(p[a0 * 3], p[a0 * 3 + 1], p[a0 * 3 + 2], p[a1 * 3], p[a1 * 3 + 1], p[a1 * 3 + 2], p[c0 * 3], p[c0 * 3 + 1], p[c0 * 3 + 2], 0, 1, 0)) builder.indices.push(a0, a1, c0, a1, c1, c0)
      else builder.indices.push(a0, c0, a1, a1, c0, c1)
    }
    previous = current
  }
}

/** Ribbon arrays for every road stretch whose centre line lies in chunk (chunkX, chunkZ), local to the chunk's corner; null if none. */
export function buildRoadArrays(terrain: Terrain, network: RoadNetwork, chunkX: number, chunkZ: number): RoadArrays | null {
  const x0 = chunkX * CHUNK_SIZE
  const z0 = chunkZ * CHUNK_SIZE
  const x1 = x0 + CHUNK_SIZE
  const z1 = z0 + CHUNK_SIZE
  const builder = new ArrayBuilder()
  for (const path of network.paths) {
    if (path.maxX < x0 || path.minX > x1 || path.maxZ < z0 || path.minZ > z1) continue
    const runs: [number, number][] = []
    for (let i = 0; i < path.xs.length - 1; i++) {
      const clip = clipSegment(path.xs[i], path.zs[i], path.xs[i + 1], path.zs[i + 1], x0, z0, x1, z1)
      if (!clip) continue
      const length = path.arc[i + 1] - path.arc[i]
      const from = path.arc[i] + clip[0] * length
      const to = path.arc[i] + clip[1] * length
      const last = runs[runs.length - 1]
      if (last && Math.abs(last[1] - from) < 1e-6) last[1] = to
      else runs.push([from, to])
    }
    for (const run of subtract(runs, path.cuts)) emitRun(builder, path, terrain, run, x0, z0)
  }
  if (builder.vertexCount === 0) return null
  const count = builder.vertexCount
  return {
    positions: Float32Array.from(builder.positions),
    normals: Float32Array.from(builder.normals),
    colors: Float32Array.from(builder.colors),
    indices: count > 65535 ? Uint32Array.from(builder.indices) : Uint16Array.from(builder.indices),
  }
}
