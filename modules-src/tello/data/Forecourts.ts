/**
 * Paved forecourts for the fuel stations: the open data maps the pumps but no pavement round them, so they stood on
 * grass with trees between the islands. Each station with pumps gets a slab (a lot named "<station> forecourt") over
 * the pump islands, out to its street and up to its store's door, following the ground. The pavement field is marked
 * under it, so no tree, grass or infill grows there. Renderer-free, run once at load (`fixStreets`).
 */
import type { MapDoc, MapGrids, Poi } from './MapData'
import { pointInRing } from '../world/Poly'

/** Margin round each pump (metres): room for a car each side of an island. */
const PUMP_MARGIN = 7
/** How much of the street front the forecourt opens onto, either way from the pumps. */
const STREET_FRONT = 13
/** Room in front of the store's door. */
const DOOR_MARGIN = 4

export const FORECOURT = / forecourt$/

function hull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: [number, number][] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** The nearest point on the named street to (x, z), and the street's direction there. */
function streetNear(doc: MapDoc, name: string | undefined, x: number, z: number): { x: number; z: number; ux: number; uz: number; d: number } | null {
  let best: { x: number; z: number; ux: number; uz: number; d: number } | null = null
  for (const road of doc.roads) {
    if (road.k > 2 || (name && road.n !== name)) continue
    const p = road.p
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az
      const len = Math.hypot(dx, dz)
      if (len < 1e-6) continue
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (len * len)))
      const qx = ax + dx * t, qz = az + dz * t
      const d = Math.hypot(x - qx, z - qz)
      if (!best || d < best.d) best = { x: qx, z: qz, ux: dx / len, uz: dz / len, d }
    }
  }
  return best
}

/** The forecourt ring (map x, z) for a station with pumps, or null. */
export function forecourtRing(doc: MapDoc, poi: Poi): number[] | null {
  const pumps = poi.pumps
  if (!pumps?.length) return null
  const pts: [number, number][] = []
  let cx = 0, cz = 0
  for (const [x, z] of pumps) {
    cx += x / pumps.length
    cz += z / pumps.length
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push([x + a * PUMP_MARGIN, z + b * PUMP_MARGIN])
  }
  if (poi.d) for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pts.push([poi.d[0] + a * DOOR_MARGIN, poi.d[1] + b * DOOR_MARGIN])
  const street = streetNear(doc, poi.s, cx, cz)
  if (street && street.d < 45) for (const s of [-1, 1]) pts.push([street.x + street.ux * s * STREET_FRONT, street.z + street.uz * s * STREET_FRONT])
  return hull(pts).flat().map((v) => Math.round(v * 100) / 100)
}

export function addForecourts(doc: MapDoc, grids: MapGrids): void {
  const f = doc.frame
  const done = new Set<string>()
  for (const poi of doc.pois) {
    if (poi.k !== 'fuel' || !poi.pumps?.length || done.has(poi.n)) continue
    done.add(poi.n)
    const name = `${poi.n} forecourt`
    if (doc.lots.some((l) => (l as { n?: string }).n === name)) continue
    const ring = forecourtRing(doc, poi)
    if (!ring) continue
    // Low enough that the slab follows the ground everywhere (lots lie at the higher of `f` and the ground).
    doc.lots.push({ f: -1000, p: ring, n: name } as MapDoc['lots'][number])
    const n = grids.fineSide, step = f.fine
    const xs = ring.filter((_v, k) => k % 2 === 0), zs = ring.filter((_v, k) => k % 2 === 1)
    for (let j = Math.floor((Math.min(...zs) - f.z0) / step); j <= Math.ceil((Math.max(...zs) - f.z0) / step); j++) {
      for (let k = Math.floor((Math.min(...xs) - f.x0) / step); k <= Math.ceil((Math.max(...xs) - f.x0) / step); k++) {
        if (j < 0 || k < 0 || j >= n || k >= n) continue
        if (pointInRing(ring, f.x0 + k * step, f.z0 + j * step)) grids.clear[j * n + k] = Math.min(grids.clear[j * n + k], -1)
      }
    }
  }
}
