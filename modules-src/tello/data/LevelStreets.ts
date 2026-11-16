/**
 * Every street with a sidewalk along it is level from side to side (renderer-free, made at load): the ground under the
 * street, its curbs and its sidewalks is set to the street's own height along its centre line (eased over a few
 * metres), so a sidewalk sits the same curb height over the street on both sides and nothing leans across. Past the
 * sidewalk's outer edge the change fades out over `FALLOFF`. Water, bridges and their approaches are left alone.
 */
import type { MapDoc, MapGrids, RoadData } from './MapData'
import { townProfiles } from './Streets'
import { resample } from '../world/Poly'

const STEP = 2
/** A sidewalk counts as the street's when it runs alongside within this far of the street's edge. */
const WALK_GAP = 6
/** The level ground reaches this far past the sidewalk's outer edge, then fades out over `FALLOFF`. */
const PAD = 4
const FALLOFF = 6
/** The street's height along it is averaged over this many stations each way (twice). */
const SMOOTH = 3
/** Nodes that would move more than this are left as they are (a wall, a ditch, a bank). */
const MAX_CHANGE = 1.2
/** Ground this close to a bridge is the bridge's approach. */
const BRIDGE_CLEAR = 22
const HASH = 8

interface Target { w: number; d: number; y: number }

/** The sidewalks' sample points in `HASH` m squares: x, z and half width. */
function walkIndex(doc: MapDoc): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const r of doc.roads) {
    if (r.k !== 4) continue
    const p = resample(r.p, 1.5)
    for (let k = 0; k < p.length; k += 2) {
      const key = `${Math.floor(p[k] / HASH)},${Math.floor(p[k + 1] / HASH)}`
      let list = out.get(key)
      if (!list) out.set(key, (list = []))
      list.push(p[k], p[k + 1], r.w / 2)
    }
  }
  return out
}

/** How far each side's sidewalk reaches from the centre line at every station (0 where there's none). */
function sidewalkReach(road: RoadData, pts: number[], walks: Map<string, number[]>): { left: Float32Array; right: Float32Array } {
  const n = pts.length / 2
  const left = new Float32Array(n), right = new Float32Array(n)
  const half = road.w / 2
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1]
    const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1)
    const dx = pts[c * 2] - pts[a * 2], dz = pts[c * 2 + 1] - pts[a * 2 + 1]
    const len = Math.hypot(dx, dz) || 1
    const tx = dx / len, tz = dz / len
    const reach = half + WALK_GAP + 2
    for (let cj = Math.floor((z - reach) / HASH); cj <= Math.floor((z + reach) / HASH); cj++) {
      for (let ci = Math.floor((x - reach) / HASH); ci <= Math.floor((x + reach) / HASH); ci++) {
        const list = walks.get(`${ci},${cj}`)
        if (!list) continue
        for (let k = 0; k < list.length; k += 3) {
          const qx = list[k] - x, qz = list[k + 1] - z
          if (Math.abs(qx * tx + qz * tz) > 1.6) continue
          const lat = -qx * tz + qz * tx
          const d = Math.abs(lat)
          if (d < half - 0.5 || d > half + WALK_GAP) continue
          const outer = d + list[k + 2]
          if (lat > 0) left[i] = Math.max(left[i], outer)
          else right[i] = Math.max(right[i], outer)
        }
      }
    }
  }
  return { left, right }
}

/** Levels every street that has a sidewalk across its whole width and its sidewalks. */
export function levelStreets(doc: MapDoc, grids: MapGrids): number {
  const f = doc.frame
  const side = grids.side
  const walks = walkIndex(doc)
  const profiles = townProfiles(doc)
  const bridges: number[] = []
  for (const b of doc.bridges) for (let k = 0; k < b.p.length; k += 2) bridges.push(b.p[k], b.p[k + 1])
  const nearBridge = (x: number, z: number) => {
    for (let k = 0; k < bridges.length; k += 2) if (Math.abs(bridges[k] - x) < BRIDGE_CLEAR && Math.abs(bridges[k + 1] - z) < BRIDGE_CLEAR) return true
    return false
  }
  const groundAt = (x: number, z: number) => {
    const gx = Math.min(side - 1.0001, Math.max(0, (x - f.x0) / f.cell)), gz = Math.min(side - 1.0001, Math.max(0, (z - f.z0) / f.cell))
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j
    const g = grids.ground
    const a = g[j * side + i], b = g[j * side + i + 1], c = g[(j + 1) * side + i], d = g[(j + 1) * side + i + 1]
    return (fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz)) / 100
  }
  const targets = new Map<number, Target>()
  for (const road of doc.roads) {
    if (road.k > 1 || road.p.length < 4) continue
    const prof = profiles.get(road)
    const pts = prof ? prof.pts : resample(road.p, STEP)
    const n = pts.length / 2
    if (n < 2) continue
    let left: Float32Array, right: Float32Array
    if (prof) {
      left = prof.outerL
      right = prof.outerR
    } else ({ left, right } = sidewalkReach(road, pts, walks))
    const has = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (left[i] > 0 || right[i] > 0) for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) has[k] = 1
    if (!has.some((v) => v)) continue
    const raw: number[] = []
    for (let i = 0; i < n; i++) raw.push(groundAt(pts[i * 2], pts[i * 2 + 1]))
    const y = smooth(smooth(raw, SMOOTH), SMOOTH)
    const half = (i: number) => (prof ? prof.half[i] : road.w / 2)
    for (let i = 0; i < n; i++) {
      if (!has[i]) continue
      const x = pts[i * 2], z = pts[i * 2 + 1]
      if (nearBridge(x, z)) continue
      const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1)
      const dx = pts[c * 2] - pts[a * 2], dz = pts[c * 2 + 1] - pts[a * 2 + 1]
      const len = Math.hypot(dx, dz) || 1
      const tx = dx / len, tz = dz / len
      const reachL = Math.max(left[i], half(i) + 0.5) + PAD
      const reachR = Math.max(right[i], half(i) + 0.5) + PAD
      const r = Math.max(reachL, reachR) + FALLOFF
      for (let j = Math.floor((z - r - f.z0) / f.cell); j <= Math.ceil((z + r - f.z0) / f.cell); j++) {
        for (let ii = Math.floor((x - r - f.x0) / f.cell); ii <= Math.ceil((x + r - f.x0) / f.cell); ii++) {
          if (ii < 0 || j < 0 || ii >= side || j >= side) continue
          const px = f.x0 + ii * f.cell - x, pz = f.z0 + j * f.cell - z
          if (Math.abs(px * tx + pz * tz) > STEP * 0.75) continue
          const lat = -px * tz + pz * tx
          const d = Math.abs(lat)
          const reach = lat > 0 ? reachL : reachR
          const w = d <= reach ? 1 : 1 - (d - reach) / FALLOFF
          if (w <= 0) continue
          const k = j * side + ii
          const was = targets.get(k)
          if (!was || w > was.w || (w === was.w && d < was.d)) targets.set(k, { w, d, y: y[i] })
        }
      }
    }
  }
  let moved = 0
  for (const [k, t] of targets) {
    if (grids.water[k] !== 0) continue
    const old = grids.ground[k] / 100
    if (Math.abs(t.y - old) > MAX_CHANGE) continue
    const next = Math.round((old + (t.y - old) * t.w) * 100)
    if (next !== grids.ground[k]) {
      grids.ground[k] = next
      moved++
    }
  }
  return moved
}

function smooth(v: number[], r: number): number[] {
  return v.map((_x, i) => {
    let s = 0, c = 0
    for (let k = Math.max(0, i - r); k <= Math.min(v.length - 1, i + r); k++) {
      s += v[k]
      c++
    }
    return s / c
  })
}

/** Every station of a street with a sidewalk: its centre, left normal and how far its sidewalks reach each side (for the tests). */
export function sidewalkStations(doc: MapDoc): { x: number; z: number; nx: number; nz: number; l: number; r: number }[] {
  const out: { x: number; z: number; nx: number; nz: number; l: number; r: number }[] = []
  const walks = walkIndex(doc)
  const profiles = townProfiles(doc)
  for (const road of doc.roads) {
    if (road.k > 1 || road.p.length < 4) continue
    const prof = profiles.get(road)
    const pts = prof ? prof.pts : resample(road.p, STEP)
    const n = pts.length / 2
    const { left, right } = prof ? { left: prof.outerL, right: prof.outerR } : sidewalkReach(road, pts, walks)
    for (let i = 0; i < n; i++) {
      if (!(left[i] > 0 || right[i] > 0)) continue
      const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1)
      const dx = pts[c * 2] - pts[a * 2], dz = pts[c * 2 + 1] - pts[a * 2 + 1]
      const len = Math.hypot(dx, dz) || 1
      out.push({ x: pts[i * 2], z: pts[i * 2 + 1], nx: -dz / len, nz: dx / len, l: Math.max(left[i], road.w / 2), r: Math.max(right[i], road.w / 2) })
    }
  }
  return out
}
