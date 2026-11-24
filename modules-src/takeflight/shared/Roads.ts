/**
 * The country roads: a network joining every place and airport (a minimum spanning tree over their distances, plus links from
 * each node to its two nearest neighbours within `EXTRA_LINK` and from each major node to its two nearest major nodes within `MAJOR_LINK` that it is not already heading toward, skipping
 * any link that would run almost alongside one the node already has, so the map has loops and the cities have through roads). Each road runs from one end to the
 * other with a gentle seeded meander, steps sideways around lakes and is smoothed. Pure and built once; drawn by
 * `render/RoadRenderer.ts` and on the maps. Roads are scenery: the simulation never reads them.
 */
import { AIRPORTS } from './Airports'
import { PLACES } from './Towns'
import { WATER_LEVEL, WORLD_SEED, terrainHeight, valueNoise } from './Terrain'
import { PI, sin } from '../sim/SimMath'

export interface RoadNode {
  id: string
  x: number
  z: number
  /** Major nodes (cities, towns, larger airports) get wider roads between them. */
  major: boolean
}

export interface Road {
  from: string
  to: string
  /** Main roads join two major nodes. */
  main: boolean
  /** Polyline in world metres, x and z interleaved. */
  points: Float64Array
  /** Bounding box, for streaming. */
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

const STEP = 250
const MEANDER = 650
const EXTRA_LINK = 32000
const MAJOR_LINK = 70000
const DRY = WATER_LEVEL + 3

export function roadNodes(): RoadNode[] {
  const nodes: RoadNode[] = []
  for (const place of PLACES) nodes.push({ id: place.id, x: place.x, z: place.z, major: place.kind !== 'village' })
  for (const airport of AIRPORTS) nodes.push({ id: airport.id, x: airport.x, z: airport.z, major: airport.kind === 'hub' || airport.kind === 'midsize' || airport.kind === 'regional' || airport.kind === 'cargo' })
  return nodes
}

function distance(a: RoadNode, b: RoadNode): number {
  return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z))
}

/** Pairs of node indices to join. */
function links(nodes: RoadNode[]): [number, number][] {
  const out: [number, number][] = []
  const seen = new Set<string>()
  const add = (i: number, j: number) => {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`
    if (seen.has(key)) return
    seen.add(key)
    out.push([i, j])
  }
  const inTree = new Array<boolean>(nodes.length).fill(false)
  const best = new Array<number>(nodes.length).fill(Infinity)
  const parent = new Array<number>(nodes.length).fill(-1)
  best[0] = 0
  for (let n = 0; n < nodes.length; n++) {
    let pick = -1
    for (let i = 0; i < nodes.length; i++) if (!inTree[i] && (pick < 0 || best[i] < best[pick])) pick = i
    inTree[pick] = true
    if (parent[pick] >= 0) add(parent[pick], pick)
    for (let i = 0; i < nodes.length; i++) {
      if (inTree[i]) continue
      const d = distance(nodes[pick], nodes[i])
      if (d < best[i]) {
        best[i] = d
        parent[i] = pick
      }
    }
  }
  const alongside = (i: number, j: number) => {
    const a = nodes[i]
    const b = nodes[j]
    const d = distance(a, b)
    for (const [p, q] of out) {
      const other = p === i ? q : q === i ? p : -1
      if (other < 0) continue
      const c = nodes[other]
      const e = distance(a, c)
      const cos = ((b.x - a.x) * (c.x - a.x) + (b.z - a.z) * (c.z - a.z)) / (d * e)
      if (cos > 0.9) return true
    }
    return false
  }
  for (let i = 0; i < nodes.length; i++) {
    const order = nodes.map((node, j) => ({ j, d: j === i ? Infinity : distance(nodes[i], node) })).sort((a, b) => a.d - b.d)
    for (const { j, d } of order.slice(0, 2)) if (d < EXTRA_LINK && !alongside(i, j) && !alongside(j, i)) add(i, j)
    if (!nodes[i].major) continue
    let majors = 0
    for (const { j, d } of order) {
      if (majors === 2 || d > MAJOR_LINK) break
      if (!nodes[j].major || j === i || alongside(i, j) || alongside(j, i)) continue
      majors++
      add(i, j)
    }
  }
  return out
}

/** Moves a point sideways along (px, pz) until it is on dry land; returns false when none is found within 5 km. */
function dryOffset(x: number, z: number, px: number, pz: number, out: { x: number; z: number }): boolean {
  if (terrainHeight(x, z) > DRY) {
    out.x = x
    out.z = z
    return true
  }
  for (let d = 200; d <= 5000; d += 200) {
    for (const side of [1, -1]) {
      const tx = x + px * d * side
      const tz = z + pz * d * side
      if (terrainHeight(tx, tz) > DRY) {
        out.x = tx
        out.z = tz
        return true
      }
    }
  }
  out.x = x
  out.z = z
  return false
}

function route(a: RoadNode, b: RoadNode, seed: number): number[] {
  const length = distance(a, b)
  const steps = Math.max(2, Math.ceil(length / STEP))
  const dx = (b.x - a.x) / length
  const dz = (b.z - a.z) / length
  const px = -dz
  const pz = dx
  const points: number[] = []
  const dry = { x: 0, z: 0 }
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const envelope = sin(PI * t)
    const wander = (valueNoise(t * length / 5000, seed * 0.37, WORLD_SEED + seed) - 0.5) * 2 * MEANDER * envelope
    const x = a.x + (b.x - a.x) * t + px * wander
    const z = a.z + (b.z - a.z) * t + pz * wander
    if (s === 0 || s === steps) points.push(x, z)
    else {
      dryOffset(x, z, px, pz, dry)
      points.push(dry.x, dry.z)
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 2; i < points.length - 2; i += 2) {
      const sx = (points[i - 2] + points[i] * 2 + points[i + 2]) / 4
      const sz = (points[i - 1] + points[i + 1] * 2 + points[i + 3]) / 4
      if (terrainHeight(sx, sz) > DRY) {
        points[i] = sx
        points[i + 1] = sz
      }
    }
  }
  return points
}

let built: Road[] | null = null

/** Every road, built once. */
export function allRoads(): readonly Road[] {
  if (built) return built
  const nodes = roadNodes()
  built = links(nodes).map(([i, j], index) => {
    const a = nodes[i]
    const b = nodes[j]
    const points = route(a, b, index + 1)
    let minX = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxZ = -Infinity
    for (let p = 0; p < points.length; p += 2) {
      if (points[p] < minX) minX = points[p]
      if (points[p] > maxX) maxX = points[p]
      if (points[p + 1] < minZ) minZ = points[p + 1]
      if (points[p + 1] > maxZ) maxZ = points[p + 1]
    }
    return { from: a.id, to: b.id, main: a.major && b.major, points: Float64Array.from(points), minX, minZ, maxX, maxZ }
  })
  return built
}
