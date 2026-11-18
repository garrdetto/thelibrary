/**
 * The pavement where roads meet or end, as flat triangles (renderer-free, so the tests read what the page draws).
 * Every road is a ribbon that starts and stops at its junction nodes, so what is left uncovered there is the notch
 * between two arms that open wider than a right angle, and the round end of a road that stops. Each notch is filled
 * to the corner where the two arms' edges meet, and each dead end gets a half disc the width of the road. Two arms of
 * the same road carrying straight on need nothing.
 */
import type { MapDoc, RoadData } from '../data/MapData'
import { halfAt, townProfiles } from '../data/Streets'

export interface JunctionArm { road: RoadData; dx: number; dz: number; half: number }
export interface JunctionNode { x: number; z: number; arms: JunctionArm[] }

/** Gaps between arms that need a fill: wider than a right angle (the ribbons cover the rest) but not a straight edge. */
const FILL_FROM = (Math.PI * 95) / 180
const FILL_TO = (Math.PI * 176) / 180
const CAP_SEGMENTS = 8

/** Every point two roads share or a road ends at, with the arms leaving it. */
export function junctionNodes(doc: MapDoc): JunctionNode[] {
  const profiles = townProfiles(doc)
  const nodes = new Map<string, JunctionNode & { roads: Set<RoadData>; end: boolean }>()
  for (const road of doc.roads) {
    if (road.k > 3) continue
    const p = road.p
    const n = p.length / 2
    for (let i = 0; i < n; i++) {
      const x = p[i * 2], z = p[i * 2 + 1]
      const id = `${Math.round(x * 2)},${Math.round(z * 2)}`
      let node = nodes.get(id)
      if (!node) nodes.set(id, (node = { x, z, arms: [], roads: new Set(), end: false }))
      node.roads.add(road)
      if (i === 0 || i === n - 1) node.end = true
      const half = halfAt(profiles, road, x, z)
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= n) continue
        const dx = p[j * 2] - x, dz = p[j * 2 + 1] - z
        const len = Math.hypot(dx, dz)
        if (len < 0.3) continue
        node.arms.push({ road, dx: dx / len, dz: dz / len, half })
      }
    }
  }
  const out: JunctionNode[] = []
  for (const node of nodes.values()) if (node.arms.length && (node.roads.size > 1 || node.end)) out.push(node)
  return out
}

export interface JunctionFill {
  /** Flat x, z triples of triangles. */
  tris: number[]
  /** The highest road class lift among the arms that meet here (the fill lies just over it). */
  kind: number
}

/**
 * The triangles that close each junction's notches and cap each road end. A lane or gravel drive that stops on the
 * edge of a bigger road (the bake's driveways end there, never over the road) gets no cap, which would reach into it.
 */
export function junctionFills(doc: MapDoc): JunctionFill[] {
  const out: JunctionFill[] = []
  const edges = roadEdges(doc)
  for (const node of junctionNodes(doc)) {
    const arms = node.arms.map((a) => ({ ...a, angle: Math.atan2(a.dz, a.dx) })).sort((a, b) => a.angle - b.angle)
    const kind = Math.min(...arms.map((a) => a.road.k))
    const tris: number[] = []
    if (arms.length === 1 && arms[0].road.k >= 2 && edges.meets(node.x, node.z, arms[0].road.k)) continue
    if (arms.length === 1) {
      const a = arms[0]
      const base = Math.atan2(-a.dz, -a.dx)
      for (let s = 0; s < CAP_SEGMENTS; s++) {
        const t0 = base - Math.PI / 2 + (s / CAP_SEGMENTS) * Math.PI, t1 = base - Math.PI / 2 + ((s + 1) / CAP_SEGMENTS) * Math.PI
        tris.push(node.x, node.z, node.x + Math.cos(t0) * a.half, node.z + Math.sin(t0) * a.half, node.x + Math.cos(t1) * a.half, node.z + Math.sin(t1) * a.half)
      }
    } else {
      for (let i = 0; i < arms.length; i++) {
        const a = arms[i], b = arms[(i + 1) % arms.length]
        let gap = b.angle - a.angle
        if (gap <= 0) gap += Math.PI * 2
        if (gap < FILL_FROM || gap > FILL_TO) continue
        const corner = edgeCorner(a, b)
        if (!corner) continue
        const ex = node.x - a.dz * a.half, ez = node.z + a.dx * a.half
        const fx = node.x + b.dz * b.half, fz = node.z - b.dx * b.half
        tris.push(node.x, node.z, ex, ez, node.x + corner[0], node.z + corner[1], node.x, node.z, node.x + corner[0], node.z + corner[1], fx, fz)
      }
    }
    if (tris.length) out.push({ tris, kind })
  }
  return out
}

const EDGE_GRID = 64

/** The streets and highways as segments in a grid, to tell whether a lane's end lies on one's edge. */
function roadEdges(doc: MapDoc): { meets: (x: number, z: number, kind: number) => boolean } {
  const cells = new Map<number, { ax: number; az: number; bx: number; bz: number; half: number; k: number }[]>()
  const key = (gx: number, gz: number) => (gx + 32768) * 65536 + gz + 32768
  for (const road of doc.roads) {
    if (road.k > 1) continue
    const p = road.p
    for (let k = 0; k + 3 < p.length; k += 2) {
      const seg = { ax: p[k], az: p[k + 1], bx: p[k + 2], bz: p[k + 3], half: road.w / 2, k: road.k }
      const pad = seg.half + 1
      for (let gx = Math.floor((Math.min(seg.ax, seg.bx) - pad) / EDGE_GRID); gx <= Math.floor((Math.max(seg.ax, seg.bx) + pad) / EDGE_GRID); gx++) {
        for (let gz = Math.floor((Math.min(seg.az, seg.bz) - pad) / EDGE_GRID); gz <= Math.floor((Math.max(seg.az, seg.bz) + pad) / EDGE_GRID); gz++) {
          const id = key(gx, gz)
          let list = cells.get(id)
          if (!list) cells.set(id, (list = []))
          list.push(seg)
        }
      }
    }
  }
  return {
    meets(x, z, kind) {
      for (const s of cells.get(key(Math.floor(x / EDGE_GRID), Math.floor(z / EDGE_GRID))) ?? []) {
        if (s.k >= kind) continue
        const dx = s.bx - s.ax, dz = s.bz - s.az
        const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)))
        if (Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) <= s.half + 0.35) return true
      }
      return false
    },
  }
}

/** Where arm `a`'s left edge meets arm `b`'s right edge, relative to the node, or null when it is too far off. */
function edgeCorner(a: JunctionArm, b: JunctionArm): [number, number] | null {
  const lx = -a.dz * a.half, lz = a.dx * a.half
  const rx = b.dz * b.half, rz = -b.dx * b.half
  const det = a.dx * -b.dz - a.dz * -b.dx
  if (Math.abs(det) < 1e-6) return null
  const cx = rx - lx, cz = rz - lz
  const t = (cx * -b.dz - cz * -b.dx) / det
  const s = (a.dx * cz - a.dz * cx) / det
  if (t < 0 || s < 0) return null
  const x = lx + a.dx * t, z = lz + a.dz * t
  if (Math.hypot(x, z) > Math.max(a.half, b.half) * 4) return null
  return [x, z]
}
