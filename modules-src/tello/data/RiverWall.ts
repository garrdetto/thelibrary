/**
 * The concrete retaining wall along Main Street where it runs beside the Montello River (renderer-free, made at load
 * like the other street fixes). Wherever the river comes within ten feet of the street's edge the street is levelled
 * from its far edge out to the wall's face, the bank past the face is dug down under the river, and the wall stands on
 * the river side with its top just over the street, so the guardrail runs straight and level along it.
 *
 * The ground grid is 4 m, too coarse for a vertical face, so three things keep the ground out of sight: the strip from
 * the street's centre to the face is a deck (`riverWallDecks`, read by `TelloLand.heightAt`, so you stand and drive on
 * the level), the drawn ground under it is sunk to the river bed (`riverWallDrop`), and the water reaches under the wall.
 */
import { COVER, type MapDoc, type MapGrids, type RoadData } from './MapData'
import { resample } from '../world/Poly'

/** The streets that get a wall where the river is close, and the box the wall may stand in. */
const WALL_STREETS = [{ name: 'Main Street', x0: 110, x1: 240, z0: -360, z1: -140 }]
/** Stations along the street, metres apart. */
export const WALL_STEP = 2
/** The wall's face stands this far past the street's edge; the guardrail stands on its top. */
export const WALL_OFFSET = 2
/** The wall's top over the street (a curb). */
export const WALL_CURB = 0.15
/** River within this far of the street's edge (ten feet, plus the 4 m grid's reach) calls for the wall. */
const WALL_NEAR = 3.05 + 1.5
/** Gaps up to this many stations between close stretches are walled too; shorter stretches are left alone. */
const GAP = 10
const MIN_RUN = 8
/** Stations the wall runs past the close stretch at each end. */
const END_PAD = 2
/** Stations in from each end where the drawn ground is sunk (so the change happens under the wall's top). */
const SINK_IN = 3
/** The bed by the wall, under the river's surface. */
const BED_DEPTH = 1.2
/** How far past the face the bank is dug down. */
const DIG = 8

export interface RiverWallRun {
  /** The street's centre line at each station (flat x, z pairs). */
  pts: number[]
  /** The unit normal toward the river at each station. */
  nx: number[]
  nz: number[]
  /** Half the street's width. */
  half: number
  /** The street's level at each station when the map was fixed (metres, before any rebase) and how far the bed is below it. */
  y: number[]
  depth: number[]
}

export interface RiverWallData {
  runs: RiverWallRun[]
  /** Grid node → how far its drawn ground sinks below the node's height. */
  drop: Map<number, number>
}

const walls = new WeakMap<MapDoc, RiverWallData>()

/** The walls of a fixed map (none until `fixRiverWalls` ran on it). */
export function riverWalls(doc: MapDoc): RiverWallData {
  return walls.get(doc) ?? { runs: [], drop: new Map() }
}

/** How far the drawn ground at grid node `k` is sunk under a wall's top (0 elsewhere). */
export function riverWallDrop(doc: MapDoc, k: number): number {
  return walls.get(doc)?.drop.get(k) ?? 0
}

/** The decks over each wall's strip, from the street's far edge to the face, one per pair of stations. */
export function riverWallDecks(doc: MapDoc): { y: number; half: number; pts: number[] }[] {
  const out: { y: number; half: number; pts: number[] }[] = []
  for (const run of riverWalls(doc).runs) {
    const face = run.half + WALL_OFFSET
    const mid = (face - run.half) / 2
    const half = (face + run.half) / 2
    for (let i = 0; i + 1 < run.y.length; i++) {
      out.push({
        y: (run.y[i] + run.y[i + 1]) / 2,
        half,
        pts: [run.pts[i * 2] + run.nx[i] * mid, run.pts[i * 2 + 1] + run.nz[i] * mid, run.pts[i * 2 + 2] + run.nx[i + 1] * mid, run.pts[i * 2 + 3] + run.nz[i + 1] * mid],
      })
    }
  }
  return out
}

/** Main Street's roads inside the box, chained end to end into one line. */
function chain(doc: MapDoc, name: string, inBox: (x: number, z: number) => boolean): { line: number[]; half: number } | null {
  const parts = doc.roads.filter((r) => r.n === name && r.k <= 1 && r.w > 7 && r.p.some((_v, k) => k % 2 === 0 && inBox(r.p[k], r.p[k + 1])))
  if (!parts.length) return null
  const key = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`
  const ends = new Set(parts.map((r) => key(r.p[r.p.length - 2], r.p[r.p.length - 1])))
  let road: RoadData | undefined = parts.find((r) => !ends.has(key(r.p[0], r.p[1]))) ?? parts[0]
  const used = new Set<RoadData>()
  const line: number[] = []
  while (road && !used.has(road)) {
    used.add(road)
    line.push(...(line.length ? road.p.slice(2) : road.p))
    const tail = key(road.p[road.p.length - 2], road.p[road.p.length - 1])
    road = parts.find((r) => !used.has(r) && key(r.p[0], r.p[1]) === tail)
  }
  return { line, half: Math.max(...[...used].map((r) => r.w / 2)) }
}

/** Builds the walls: finds the close stretches, levels the street to the face, digs the bank past it and fills it with the river. */
export function fixRiverWalls(doc: MapDoc, grids: MapGrids): RiverWallData {
  const data: RiverWallData = { runs: [], drop: new Map() }
  walls.set(doc, data)
  const f = doc.frame
  const side = grids.side
  const node = (x: number, z: number) => {
    const i = Math.round((x - f.x0) / f.cell), j = Math.round((z - f.z0) / f.cell)
    return i < 0 || j < 0 || i >= side || j >= side ? -1 : j * side + i
  }
  const wet = (k: number) => k >= 0 && grids.water[k] > grids.ground[k]
  const groundAt = (x: number, z: number) => {
    const gx = Math.min(side - 1.0001, Math.max(0, (x - f.x0) / f.cell)), gz = Math.min(side - 1.0001, Math.max(0, (z - f.z0) / f.cell))
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j
    const g = grids.ground
    const a = g[j * side + i], b = g[j * side + i + 1], c = g[(j + 1) * side + i], d = g[(j + 1) * side + i + 1]
    return (fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz)) / 100
  }
  for (const street of WALL_STREETS) {
    const inBox = (x: number, z: number) => x >= street.x0 && x <= street.x1 && z >= street.z0 && z <= street.z1
    const found = chain(doc, street.name, inBox)
    if (!found) continue
    const all = resample(found.line, WALL_STEP)
    const pts: number[] = []
    for (let k = 0; k < all.length; k += 2) if (inBox(all[k], all[k + 1])) pts.push(all[k], all[k + 1])
    const n = pts.length / 2
    if (n < MIN_RUN) continue
    const half = found.half
    const normal = (i: number): [number, number] => {
      const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1)
      const dx = pts[c * 2] - pts[a * 2], dz = pts[c * 2 + 1] - pts[a * 2 + 1]
      const len = Math.hypot(dx, dz) || 1
      return [-dz / len, dx / len]
    }
    // How far the river is from the street's centre on each side, and its surface there.
    const reach = (i: number, s: number): { d: number; level: number } | null => {
      const [nx, nz] = normal(i)
      for (let d = half; d <= half + 14; d += 0.5) {
        const k = node(pts[i * 2] + nx * s * d, pts[i * 2 + 1] + nz * s * d)
        if (wet(k)) return { d, level: grids.water[k] / 100 }
      }
      return null
    }
    let votes = 0
    for (let i = 0; i < n; i++) {
      const l = reach(i, 1), r = reach(i, -1)
      votes += (l ? 1 : 0) - (r ? 1 : 0)
    }
    const s = votes >= 0 ? 1 : -1
    const near = Array.from({ length: n }, (_v, i) => reach(i, s))
    const flag = near.map((r) => !!r && r.d <= half + WALL_NEAR)
    for (let i = 0; i < n; i++) {
      if (flag[i]) continue
      let a = i
      while (a >= 0 && !flag[a]) a--
      let b = i
      while (b < n && !flag[b]) b++
      if (a >= 0 && b < n && b - a - 1 <= GAP) for (let k = a + 1; k < b; k++) flag[k] = true
    }
    let i = 0
    while (i < n) {
      if (!flag[i]) {
        i++
        continue
      }
      let j = i
      while (j + 1 < n && flag[j + 1]) j++
      if (j - i + 1 >= MIN_RUN) data.runs.push(makeRun(Math.max(0, i - END_PAD), Math.min(n - 1, j + END_PAD)))
      i = j + 1
    }

    function makeRun(a: number, b: number): RiverWallRun {
      const run: RiverWallRun = { pts: [], nx: [], nz: [], half, y: [], depth: [] }
      const raw: number[] = []
      const levels: (number | null)[] = []
      for (let k = a; k <= b; k++) {
        const [nx, nz] = normal(k)
        run.pts.push(pts[k * 2], pts[k * 2 + 1])
        run.nx.push(nx * s)
        run.nz.push(nz * s)
        raw.push(groundAt(pts[k * 2], pts[k * 2 + 1]))
        levels.push(near[k]?.level ?? null)
      }
      const m = raw.length
      run.y = smooth(smooth(raw, 3), 3)
      for (let k = 0; k < m; k++) {
        if (levels[k] !== null) continue
        let best: number | null = null, gap = Infinity
        for (let q = 0; q < m; q++) if (levels[q] !== null && Math.abs(q - k) < gap) { gap = Math.abs(q - k); best = levels[q] }
        levels[k] = best
      }
      for (let k = 0; k < m; k++) run.depth.push(Math.max(0.6, run.y[k] - ((levels[k] ?? run.y[k] - 1.5) - BED_DEPTH)))
      shapeGround(run, levels as (number | null)[])
      return run
    }
  }
  return data

  function shapeGround(run: RiverWallRun, levels: (number | null)[]): void {
    const m = run.y.length
    const face = run.half + WALL_OFFSET
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (let k = 0; k < m; k++) {
      x0 = Math.min(x0, run.pts[k * 2]); x1 = Math.max(x1, run.pts[k * 2])
      z0 = Math.min(z0, run.pts[k * 2 + 1]); z1 = Math.max(z1, run.pts[k * 2 + 1])
    }
    const pad = face + DIG + 4
    for (let j = Math.floor((z0 - pad - f.z0) / f.cell); j <= Math.ceil((z1 + pad - f.z0) / f.cell); j++) {
      for (let i = Math.floor((x0 - pad - f.x0) / f.cell); i <= Math.ceil((x1 + pad - f.x0) / f.cell); i++) {
        if (i < 0 || j < 0 || i >= side || j >= side) continue
        const x = f.x0 + i * f.cell, z = f.z0 + j * f.cell
        let at = -1, best = Infinity
        for (let k = 0; k < m; k++) {
          const d = (run.pts[k * 2] - x) ** 2 + (run.pts[k * 2 + 1] - z) ** 2
          if (d < best) { best = d; at = k }
        }
        const dx = x - run.pts[at * 2], dz = z - run.pts[at * 2 + 1]
        const tx = run.nz[at], tz = -run.nx[at]
        if (Math.abs(dx * tx + dz * tz) > WALL_STEP * 0.75) continue
        const across = dx * run.nx[at] + dz * run.nz[at]
        const k = j * side + i
        const y = run.y[at]
        const level = levels[at]
        if (across >= -run.half - 1 && across <= face) {
          grids.ground[k] = Math.round(y * 100)
          if (grids.cover[k] === COVER.water) grids.cover[k] = COVER.bare
          if (across > 0 && at >= SINK_IN && at <= m - 1 - SINK_IN) {
            data.drop.set(k, run.depth[at])
            if (level !== null) grids.water[k] = Math.round(level * 100)
          }
        } else if (across > face && across <= face + DIG && level !== null) {
          const g = grids.ground[k] / 100
          if (wet(k) || g < level + 1) {
            grids.ground[k] = Math.round(Math.min(g, level - BED_DEPTH) * 100)
            grids.water[k] = Math.round(level * 100)
            grids.cover[k] = COVER.water
          }
        }
      }
    }
  }
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
