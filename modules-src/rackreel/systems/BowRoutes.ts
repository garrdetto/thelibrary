/** Wisco Wild Man's routes and autopilot, renderer-free: loops that hug the lake shore and the island with the hull's side 5–10 yards off the bank (`ROUTE.shoreGap` metres from the centreline, never closer than `ROUTE.shoreGapMin`) in water at least `ROUTE.contour` deep, runs across open water on plane, and the way home to his launch. */
import { BAY, CHANNEL, ISLAND, LAKE_CENTER, bayCoord, bayRadius, lakeRadius } from '../world/Terrain'

export interface Pt {
  x: number
  z: number
}

export interface WaterMap {
  depthAt(x: number, z: number): number
  heightAt(x: number, z: number): number
}

export interface Clearance {
  points: Pt[]
  segments: [Pt, Pt][]
}

export const ROUTE = {
  contour: 0.7,
  minDepth: 0.6,
  /** How far the boat's centreline keeps from the water's edge on a loop (metres): the hull's side then runs about 8 yards off the bank. `shoreGapMin` is the hard floor once the loop is smoothed. */
  shoreGap: 9,
  shoreGapMin: 7.5,
  /** Half the hull's width at the gunwale, so gaps can be measured from the boat's side rather than its centreline. */
  halfBeam: 1.6,
  /** Where the bank starts to the eye: cattails grow anywhere shallower than this (world/Foliage.ts), so gaps are measured from this depth, not the water's edge. */
  reedDepth: 0.5,
  /** How far a smoothed loop point may be nudged back toward the shore where the smoothing swung it wide (metres). */
  hug: 10,
  spacing: 2,
  clear: 6,
  runDepth: 2.5,
  corridor: 4,
  lookahead: 4,
  turnRate: 0.55,
  runTurnRate: 0.25,
  minPlaneLeg: 40,
  offPlane: 25,
  /** The first stretch of a run is driven at cruise so the boat is lined up on the deep line before it gets on plane. */
  lineUp: 15,
}

export const SPEED = { creep: 0.67, cruise: 1.34, push: 2.68, run: 13.4 }
/** How far the keel sits above the ground it is beached on. */
export const HULL_DRAFT = 0.12
export const SPEED_STEPS = [SPEED.creep, SPEED.cruise, SPEED.push] as const
export const PLANE_SECONDS = 4
const PLANE_ACCEL = (SPEED.run - SPEED.cruise) / PLANE_SECONDS
const OFF_PLANE_DECEL = (SPEED.run * SPEED.run - SPEED.cruise * SPEED.cruise) / (2 * ROUTE.offPlane)

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

export function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t))
}

/** Distance from `p` to the nearest visible bank (the reed line, water shallower than `edge`), looked for in rings out to `limit` metres; `limit` when none is that close. */
export function shoreDistance(map: WaterMap, p: Pt, limit = ROUTE.shoreGap, edge = ROUTE.reedDepth): number {
  for (let r = 0.5; r < limit; r += 0.5) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2
      if (map.depthAt(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r) <= edge) return r
    }
  }
  return limit
}

/** A loop point the boat may run through: deep enough, clear of the dock and parked boats, and `gap` off the shore. */
export function boatWater(map: WaterMap, p: Pt, clear: Clearance, depth: number, gap: number): boolean {
  return map.depthAt(p.x, p.z) >= depth && clearanceDistance(p, clear) >= ROUTE.clear + 0.5 && shoreDistance(map, p, gap) >= gap
}

export function clearanceDistance(p: Pt, clear: Clearance): number {
  let d = Infinity
  for (const q of clear.points) d = Math.min(d, Math.hypot(p.x - q.x, p.z - q.z))
  for (const [a, b] of clear.segments) d = Math.min(d, segmentDistance(p, a, b))
  return d
}

function circularSmooth(values: number[], window: number): number[] {
  const n = values.length
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = -window; k <= window; k++) s += values[(i + k + n) % n]
    out[i] = s / (window * 2 + 1)
  }
  return out
}

/** Resamples a closed polyline every `step` metres. */
export function resampleLoop(points: Pt[], step: number): Pt[] {
  const out: Pt[] = []
  const n = points.length
  let carry = 0
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    let t = carry
    while (t < len) {
      const k = t / len
      out.push({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k })
      t += step
    }
    carry = t - len
  }
  return out
}

/** Nudges a loop point back toward the shore (away from `center` on inward loops) as long as it stays in boat water `ROUTE.shoreGap` off the edge, so a smoothed loop still hugs the inside of coves. */
function hug(map: WaterMap, p: Pt, center: Pt, inward: boolean, clear: Clearance): Pt {
  const dx = p.x - center.x
  const dz = p.z - center.z
  const len = Math.hypot(dx, dz) || 1
  const sx = (inward ? dx : -dx) / len
  const sz = (inward ? dz : -dz) / len
  let q = p
  for (let d = 0.5; d <= ROUTE.hug; d += 0.5) {
    const n = { x: p.x + sx * d, z: p.z + sz * d }
    if (!boatWater(map, n, clear, ROUTE.contour, ROUTE.shoreGap)) break
    q = n
  }
  return q
}

function settle(map: WaterMap, p: Pt, center: Pt, inward: boolean, clear: Clearance): Pt {
  const dx = p.x - center.x
  const dz = p.z - center.z
  const len = Math.hypot(dx, dz) || 1
  const sx = (inward ? -dx : dx) / len
  const sz = (inward ? -dz : dz) / len
  let q = { ...p }
  for (let i = 0; i < 160; i++) {
    if (boatWater(map, q, clear, ROUTE.minDepth, ROUTE.shoreGapMin)) break
    q = { x: q.x + sx * 0.5, z: q.z + sz * 0.5 }
  }
  return q
}

/**
 * A loop around a centre that hugs the shore from `ROUTE.shoreGap` out. `inward` loops (the lake shore) march in from the
 * bank until the water is deep enough and the edge is far enough away; outward loops (the island) march out from the
 * centre. Spots that are too shallow, too close to the shore or too close to the dock or a parked boat are pushed toward
 * deeper water, then the loop is smoothed and resampled every 2 m.
 */
export function contourLoop(map: WaterMap, center: Pt, inward: boolean, clear: Clearance, depth = ROUTE.contour, outer: (angle: number) => number = (a) => lakeRadius(a) * 1.12): Pt[] {
  const samples = 240
  const radii: number[] = []
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2
    const cx = Math.cos(a)
    const cz = Math.sin(a)
    let r = inward ? outer(a) : 0
    const stop = inward ? 0 : 140
    let found = inward ? outer(a) * 0.55 : 60
    if (inward) {
      for (; r > stop; r -= 0.5) if (boatWater(map, { x: center.x + cx * r, z: center.z + cz * r }, clear, depth, ROUTE.shoreGap)) { found = r; break }
    } else {
      for (; r < stop; r += 0.5) if (boatWater(map, { x: center.x + cx * r, z: center.z + cz * r }, clear, depth, ROUTE.shoreGap)) { found = r; break }
    }
    radii.push(found)
  }
  const smoothR = circularSmooth(circularSmooth(radii, 4), 4)
  let pts: Pt[] = smoothR.map((r, i) => {
    const a = (i / samples) * Math.PI * 2
    return { x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r }
  })
  for (let pass = 0; pass < 3; pass++) {
    pts = pts.map((p) => settle(map, p, center, inward, clear))
    const xs = circularSmooth(pts.map((p) => p.x), 2)
    const zs = circularSmooth(pts.map((p) => p.z), 2)
    pts = pts.map((_, i) => ({ x: xs[i], z: zs[i] }))
  }
  pts = pts.map((p) => hug(map, p, center, inward, clear))
  {
    const xs = circularSmooth(pts.map((p) => p.x), 1)
    const zs = circularSmooth(pts.map((p) => p.z), 1)
    pts = pts.map((_, i) => ({ x: xs[i], z: zs[i] }))
  }
  pts = pts.map((p) => settle(map, p, center, inward, clear))
  return resampleLoop(resampleLoop(pts, ROUTE.spacing).map((p) => settle(map, p, center, inward, clear)), ROUTE.spacing).map((p) => settle(map, p, center, inward, clear))
}

export function shoreLoop(map: WaterMap, clear: Clearance): Pt[] {
  return contourLoop(map, LAKE_CENTER, true, clear)
}

export function islandLoop(map: WaterMap, clear: Clearance): Pt[] {
  return contourLoop(map, { x: ISLAND.x, z: ISLAND.z }, false, clear)
}

/** The back bay beyond the highway bridge: around the bay's own contour (its mouth bulges a little into the channel). */
export function bayLoop(map: WaterMap, clear: Clearance): Pt[] {
  return contourLoop(map, { x: BAY.x, z: BAY.z }, true, clear, ROUTE.contour, (a) => bayRadius(a) * 1.02)
}

export function buildLoops(map: WaterMap, clear: Clearance): Record<RouteName, Pt[]> {
  return { shore: shoreLoop(map, clear), island: islandLoop(map, clear), bay: bayLoop(map, clear) }
}

/** Waypoints a deep-water run may bend through: a ring around the island and the length of the channel under the bridge. */
export function deepWaypoints(map: WaterMap): Pt[] {
  const out: Pt[] = []
  for (const r of [ISLAND.r + 34, ISLAND.r + 54]) {
    for (let k = 0; k < 18; k++) {
      const ang = (k / 18) * Math.PI * 2
      const v = { x: ISLAND.x + Math.cos(ang) * r, z: ISLAND.z + Math.sin(ang) * r }
      if (map.depthAt(v.x, v.z) >= ROUTE.runDepth + 0.5) out.push(v)
    }
  }
  const dx = CHANNEL.bx - CHANNEL.ax
  const dz = CHANNEL.bz - CHANNEL.az
  const len = Math.hypot(dx, dz)
  for (const k of [-0.12, 0.05, 0.5, 0.92]) {
    const v = { x: CHANNEL.ax + dx * k, z: CHANNEL.az + dz * k }
    if (k < 0) {
      v.x = CHANNEL.ax + (dx / len) * -20
      v.z = CHANNEL.az + (dz / len) * -20
    }
    if (map.depthAt(v.x, v.z) >= ROUTE.runDepth + 0.5) out.push(v)
  }
  return out
}

export function nearestIndex(loop: Pt[], p: Pt, from = -1, window = 0): number {
  let best = 0
  let bestD = Infinity
  const n = loop.length
  const count = window > 0 && from >= 0 ? window * 2 + 1 : n
  for (let k = 0; k < count; k++) {
    const i = window > 0 && from >= 0 ? (from - window + k + n) % n : k
    const d = (loop[i].x - p.x) ** 2 + (loop[i].z - p.z) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** True when the straight line a → b keeps at least `depth` of water everywhere within `corridor` metres of it. */
export function deepLine(map: WaterMap, a: Pt, b: Pt, depth = ROUTE.runDepth, corridor = ROUTE.corridor): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z)
  const steps = Math.max(2, Math.ceil(len / 2))
  const nx = len > 0 ? -(b.z - a.z) / len : 0
  const nz = len > 0 ? (b.x - a.x) / len : 0
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = a.x + (b.x - a.x) * t
    const z = a.z + (b.z - a.z) * t
    for (const o of [-corridor, 0, corridor]) if (map.depthAt(x + nx * o, z + nz * o) < depth) return false
  }
  return true
}

/** True when there is at least `depth` of water everywhere within `radius` metres of `p` (sampled on two rings). */
export function deepAround(map: WaterMap, p: Pt, depth: number, radius = ROUTE.corridor): boolean {
  for (const r of [radius / 2, radius]) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      if (map.depthAt(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r) < depth) return false
    }
  }
  return true
}

/** The nearest spot with deep water around it that the boat can reach from `p` without running aground. */
export function nearestDeep(map: WaterMap, p: Pt, depth = ROUTE.runDepth + 0.8): Pt {
  if (map.depthAt(p.x, p.z) >= depth && deepAround(map, p, depth - 0.8)) return { ...p }
  for (let r = 3; r <= 120; r += 3) {
    let best: Pt | null = null
    let bestDepth = -Infinity
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2
      const q = { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }
      const d = map.depthAt(q.x, q.z)
      if (d >= depth && deepAround(map, q, depth - 0.8) && deepLine(map, p, q, 0.55, 0) && d > bestDepth) {
        best = q
        bestDepth = d
      }
    }
    if (best) return best
  }
  return { ...p }
}

/** A deep-water path from a to b: straight when it can be, otherwise the shortest bend through the island ring and the channel (Dijkstra over waypoints joined by deep lines). */
export function deepPath(map: WaterMap, a: Pt, b: Pt, depth = ROUTE.runDepth, corridor = ROUTE.corridor): Pt[] | null {
  if (deepLine(map, a, b, depth, Math.min(corridor, 1.5))) return [a, b]
  const nodes = [a, b, ...deepWaypoints(map)]
  const n = nodes.length
  const dist = new Array<number>(n).fill(Infinity)
  const prev = new Array<number>(n).fill(-1)
  const done = new Array<boolean>(n).fill(false)
  const edge = new Map<number, boolean>()
  const ok = (i: number, j: number) => {
    const key = i < j ? i * 1000 + j : j * 1000 + i
    let v = edge.get(key)
    if (v === undefined) {
      v = deepLine(map, nodes[i], nodes[j], depth, i < 2 || j < 2 ? Math.min(corridor, 1.5) : corridor)
      edge.set(key, v)
    }
    return v
  }
  dist[0] = 0
  for (let step = 0; step < n; step++) {
    let u = -1
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i
    if (u < 0 || dist[u] === Infinity) break
    if (u === 1) break
    done[u] = true
    for (let v = 0; v < n; v++) {
      if (done[v] || v === u) continue
      const d = dist[u] + Math.hypot(nodes[u].x - nodes[v].x, nodes[u].z - nodes[v].z)
      if (d < dist[v] && ok(u, v)) {
        dist[v] = d
        prev[v] = u
      }
    }
  }
  if (dist[1] === Infinity) return null
  const path: Pt[] = []
  for (let i = 1; i >= 0; i = prev[i]) path.unshift(nodes[i])
  return path
}

export interface Leg {
  to: Pt
  plane: boolean
  /** Final approach: creep the last few metres and stop on the point. */
  stop?: boolean
  /** Wide open the whole leg, no easing off (the island jump and the beaching run). */
  send?: boolean
  /** Runs up onto the bank at speed and slides to a stop on `to`. */
  beach?: boolean
  /** Whips the boat round onto this leg's line: a hard, sliding turn at speed before flooring it again. */
  whip?: boolean
  /** The line over the island: the hull follows the jump's arc here. */
  jump?: boolean
}

/** The sharp spin onto the island line on the way home: how fast the bow comes round, how fast the slide catches up with it, and how much speed he keeps through it. */
export const WHIP = { turnRate: 3.2, grip: 2.2, keep: 0.55, lined: 0.12, sharp: 0.35, pass: 8 }

/** Wild Man's way home: a straight run over the island (`entry` → `exit`, airborne from `takeoff` to `touchdown`), then still wide open onto the bank at `beach`. */
export interface HomeStunt {
  setup: Pt
  entry: Pt
  exit: Pt
  dir: Pt
  /** Distance along entry → exit where the hull leaves and meets the water. */
  takeoff: number
  touchdown: number
  /** Top of the arc, metres above the water. */
  peak: number
  beach: Pt
}

export const STUNT = {
  entryBack: 48,
  setupBack: 30,
  exitOut: 8,
  margin: 3,
  clearance: 2.8,
  beachUp: 2,
  beachSide: 9,
  maxSpan: 80,
  minRun: 12,
  maxBend: 0.35,
  dryRun: 14,
}

function landSpan(map: WaterMap, a: Pt, d: Pt, length: number): { first: number; last: number; top: number } | null {
  let first = -1
  let last = -1
  let top = 0
  for (let s = 0; s <= length; s += 0.5) {
    const x = a.x + d.x * s
    const z = a.z + d.z * s
    if (Math.hypot(x - ISLAND.x, z - ISLAND.z) > ISLAND.r * 1.6) continue
    const h = map.heightAt(x, z)
    if (h > -0.05) {
      if (first < 0) first = s
      last = s
      top = Math.max(top, h)
    }
  }
  return first < 0 ? null : { first, last, top }
}

/** The airborne arc over the island and its slope (rise per metre along the line) at distance `s` from the entry. */
export function stuntArc(stunt: HomeStunt, s: number): { lift: number; slope: number } {
  const a = stunt.takeoff
  const b = stunt.touchdown
  if (s <= a || s >= b) return { lift: 0, slope: 0 }
  const u = (s - a) / (b - a)
  return { lift: 4 * stunt.peak * u * (1 - u), slope: (4 * stunt.peak * (1 - 2 * u)) / (b - a) }
}

/**
 * Plans the trip home over the island: a beaching spot on the bank either side of his camp, then lines through the island aimed at it, and keeps
 * the first with deep water for the run-up, a sane flight and open water from the landing almost all the way to the bank. Returns null when none
 * fits (he then comes home the ordinary way).
 */
export function planHomeStunt(map: WaterMap, launch: Launch): HomeStunt | null {
  const out = { x: launch.shore.x - launch.boat.x, z: launch.shore.z - launch.boat.z }
  const outLen = Math.hypot(out.x, out.z) || 1
  const n = { x: out.x / outLen, z: out.z / outLen }
  const side = { x: -n.z, z: n.x }
  const beaches: Pt[] = []
  for (const k of [1, -1]) {
    const base = { x: launch.shore.x + side.x * STUNT.beachSide * k, z: launch.shore.z + side.z * STUNT.beachSide * k }
    let shore = base
    for (let s = -20; s <= 20; s += 0.5) {
      const q = { x: base.x + n.x * s, z: base.z + n.z * s }
      if (map.heightAt(q.x, q.z) > 0) {
        shore = q
        break
      }
    }
    const beach = { x: shore.x + n.x * STUNT.beachUp, z: shore.z + n.z * STUNT.beachUp }
    if (Math.hypot(beach.x - launch.camp.x, beach.z - launch.camp.z) > 6.5 && map.heightAt(beach.x, beach.z) < 1.2) beaches.push(beach)
  }
  for (const beach of beaches) {
    const toBeach = Math.atan2(beach.z - ISLAND.z, beach.x - ISLAND.x)
    for (const turn of [0, 0.1, -0.1, 0.2, -0.2, 0.3, -0.3]) {
      const a = toBeach + turn
      const dir = { x: Math.cos(a), z: Math.sin(a) }
      const reach = ISLAND.r * 1.6
      const entry = { x: ISLAND.x - dir.x * (reach + STUNT.entryBack), z: ISLAND.z - dir.z * (reach + STUNT.entryBack) }
      const setup = { x: entry.x - dir.x * STUNT.setupBack, z: entry.z - dir.z * STUNT.setupBack }
      const span = landSpan(map, entry, dir, (reach + STUNT.entryBack) * 2)
      if (!span || span.first < STUNT.entryBack * 0.6) continue
      const takeoff = span.first - STUNT.margin
      const touchdown = span.last + STUNT.margin
      if (touchdown - takeoff > STUNT.maxSpan) continue
      const exit = { x: entry.x + dir.x * (span.last + STUNT.exitOut), z: entry.z + dir.z * (span.last + STUNT.exitOut) }
      const run = { x: beach.x - exit.x, z: beach.z - exit.z }
      const runLen = Math.hypot(run.x, run.z)
      if (runLen < STUNT.minRun || Math.abs(wrapAngle(Math.atan2(run.z, run.x) - a)) > STUNT.maxBend) continue
      if (map.depthAt(setup.x, setup.z) < ROUTE.runDepth || !deepLine(map, setup, { x: entry.x + dir.x * (span.first - 6), z: entry.z + dir.z * (span.first - 6) }, 1.0, 2)) continue
      const wet = { x: beach.x - (run.x / runLen) * STUNT.dryRun, z: beach.z - (run.z / runLen) * STUNT.dryRun }
      if (!deepLine(map, exit, wet, 0.4, 1.5)) continue
      return { setup, entry, exit, dir, takeoff, touchdown, peak: span.top + STUNT.clearance, beach }
    }
  }
  return null
}

/** Legs from `from` to `to`: out to deep water at cruise, across on plane (only on long legs through deep water), then in at cruise. */
export function planTrip(map: WaterMap, from: Pt, to: Pt, stopAtEnd: boolean): Leg[] {
  const start = nearestDeep(map, from)
  const end = nearestDeep(map, to)
  const legs: Leg[] = []
  const far = Math.hypot(to.x - from.x, to.z - from.z)
  if (far < ROUTE.minPlaneLeg || Math.hypot(end.x - start.x, end.z - start.z) < ROUTE.minPlaneLeg) {
    legs.push({ to, plane: false, stop: stopAtEnd })
    return legs
  }
  if (Math.hypot(start.x - from.x, start.z - from.z) > 1) legs.push({ to: start, plane: false })
  const deep = deepPath(map, start, end)
  const path = deep ?? deepPath(map, start, end, 0.6, 0) ?? [start, end]
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    let len = Math.hypot(b.x - a.x, b.z - a.z)
    const plane = deep !== null && len >= ROUTE.minPlaneLeg
    if (plane && legs.length === 0 && len > ROUTE.lineUp + ROUTE.minPlaneLeg) {
      const t = ROUTE.lineUp / len
      legs.push({ to: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, plane: false })
      len -= ROUTE.lineUp
    }
    legs.push({ to: b, plane })
  }
  legs.push({ to, plane: false, stop: stopAtEnd })
  return legs
}

export interface Launch {
  shore: Pt
  /** Where Wild Man sits on his cooler, on dry ground. */
  camp: Pt
  /** Where his boat waits, nosed in just off the bank. */
  boat: Pt
  boatHeading: number
}

/** Wild Man's launch: the nearest stretch of firm, dry shoreline 30–55 m from the dock, away from the marsh. */
export function findLaunch(map: WaterMap, dockStart: Pt, dockEnd: Pt): Launch {
  const dockAngle = Math.atan2(dockStart.z - LAKE_CENTER.z, dockStart.x - LAKE_CENTER.x)
  let best: Launch | null = null
  let bestScore = Infinity
  for (let k = -80; k <= 80; k++) {
    const a = dockAngle + k * 0.005
    const cx = Math.cos(a)
    const cz = Math.sin(a)
    let shore: Pt | null = null
    for (let r = lakeRadius(a) * 0.6; r < lakeRadius(a) * 1.6; r += 0.5) {
      if (map.heightAt(LAKE_CENTER.x + cx * r, LAKE_CENTER.z + cz * r) > 0) {
        shore = { x: LAKE_CENTER.x + cx * r, z: LAKE_CENTER.z + cz * r }
        break
      }
    }
    if (!shore) continue
    const d = Math.hypot(shore.x - dockStart.x, shore.z - dockStart.z)
    if (d < 30 || d > 55) continue
    if (segmentDistance(shore, dockStart, dockEnd) < 25) continue
    let camp: Pt | null = null
    for (let s = 2; s < 14; s += 0.5) {
      const q = { x: shore.x + cx * s, z: shore.z + cz * s }
      if (map.heightAt(q.x, q.z) > 0.45) {
        camp = q
        break
      }
    }
    if (!camp) continue
    let boat: Pt | null = null
    for (let s = 4; s < 40; s += 0.5) {
      const q = { x: shore.x - cx * s, z: shore.z - cz * s }
      if (map.depthAt(q.x, q.z) > 0.9) {
        boat = q
        break
      }
    }
    if (!boat) continue
    const steep = Math.abs(map.heightAt(camp.x, camp.z) - map.heightAt(shore.x, shore.z)) / Math.max(1, Math.hypot(camp.x - shore.x, camp.z - shore.z))
    const reach = Math.hypot(boat.x - shore.x, boat.z - shore.z)
    const score = d + steep * 40 + reach * 2
    if (score < bestScore) {
      bestScore = score
      best = { shore, camp, boat, boatHeading: Math.atan2(cx, cz) + Math.PI / 2 }
    }
  }
  if (best) return best
  const fallback = { x: dockEnd.x + 8, z: dockEnd.z }
  return { shore: fallback, camp: { x: dockStart.x + 6, z: dockStart.z }, boat: fallback, boatHeading: 0 }
}

export type PilotMode = 'docked' | 'loop' | 'travel'
export type RouteName = 'shore' | 'island' | 'bay'
export const ROUTE_ORDER: readonly RouteName[] = ['shore', 'island', 'bay']

export interface PilotEvents {
  /** The boat came off plane at the end of a run. */
  offPlane?: boolean
  /** The boat climbed onto plane. */
  onPlane?: boolean
  /** Reached the end of a trip leg list: joined a loop or docked. */
  arrived?: 'loop' | 'docked'
  /** Left the water off the island. */
  airborne?: boolean
  /** Came back down on the far side. */
  splashdown?: boolean
  /** Slid to a stop up on the bank at the end of the run home. */
  beached?: boolean
}

export class Autopilot {
  x: number
  z: number
  heading: number
  speed = 0
  /** Index into SPEED_STEPS. */
  setting = 1
  hold = false
  route: RouteName = 'shore'
  mode: PilotMode = 'docked'
  homeward = false
  /** Height of the hull above the water: in the air over the island, or up on the bank. */
  lift = 0
  /** Rise per metre travelled, for the bow-up and bow-down of the jump. */
  liftSlope = 0
  /** Sitting up on the bank after beaching it. */
  beached = false
  /** Length of the hull, so a beached boat is kept above the bank from stern to bow. */
  hullLength = 10.4
  /** Pitch of the bank under a beached hull (radians, bow up positive); 0 on the water. */
  groundPitch = 0
  private legs: Leg[] = []
  private leg = 0
  private index = 0
  private planingNow = false
  /** Which way the hull is actually moving: the heading, except while it slides through a whip turn. */
  private course = 0
  /** In a whip turn: the bow swings faster than the boat changes direction. */
  whipping = false
  private sliding = false
  private stuntPlan: HomeStunt | null | undefined
  private flying = false
  private slide: number | null = null

  constructor(private readonly map: WaterMap, readonly loops: Record<RouteName, Pt[]>, readonly landing: Launch) {
    this.x = landing.boat.x
    this.z = landing.boat.z
    this.heading = landing.boatHeading
    this.course = this.heading
  }

  get onPlane(): boolean {
    return this.speed > SPEED.push + 1
  }

  /** 0..1 how far onto plane the boat is (bow-up, lights off, no carp). */
  get planing(): number {
    return smooth(SPEED.push + 0.5, SPEED.run * 0.7, this.speed)
  }

  get running(): boolean {
    return this.mode === 'travel' && this.legs.some((l) => l.plane) && (this.planingNow || this.onPlane)
  }

  get travelling(): boolean {
    return this.mode === 'travel'
  }

  get currentLegs(): readonly Leg[] {
    return this.legs
  }

  get homeStunt(): HomeStunt | null {
    if (this.stuntPlan === undefined) this.stuntPlan = planHomeStunt(this.map, this.landing)
    return this.stuntPlan
  }

  /** Back off the bank and afloat beside the launch. */
  private refloat(): void {
    if (!this.beached) return
    this.beached = false
    this.x = this.landing.boat.x
    this.z = this.landing.boat.z
    this.heading = this.landing.boatHeading
    this.speed = 0
    this.lift = 0
    this.liftSlope = 0
  }

  /** Leave the launch for the nearest point on the shore loop. */
  depart(): void {
    this.refloat()
    this.route = 'shore'
    this.homeward = false
    this.travelTo(this.joinPoint('shore'), false)
  }

  switchRoute(): RouteName {
    this.route = ROUTE_ORDER[(ROUTE_ORDER.indexOf(this.route) + 1) % ROUTE_ORDER.length]
    this.homeward = false
    this.travelTo(this.joinPoint(this.route), false)
    return this.route
  }

  headHome(): void {
    this.homeward = true
    this.travelTo(this.landing.boat, true)
  }

  /** Wild Man's way home: floored from wherever he is to the run-up spot (through deep water), whipped round onto the line over the island, wide open over it, then straight up onto the bank beside his camp. Falls back to `headHome` when no line over the island fits. */
  sendItHome(): void {
    const st = this.homeStunt
    if (!st) {
      this.headHome()
      return
    }
    this.homeward = true
    const legs: Leg[] = planTrip(this.map, { x: this.x, z: this.z }, st.setup, false).map((l) => ({ to: l.to, plane: false, send: true }))
    legs.push({ to: st.entry, plane: false, send: true, whip: true, jump: true })
    legs.push({ to: st.exit, plane: false, send: true, jump: true })
    legs.push({ to: st.beach, plane: false, send: true, beach: true })
    this.legs = legs
    this.leg = 0
    this.mode = 'travel'
    this.hold = false
    this.slide = null
  }

  private joinPoint(route: RouteName): Pt {
    const loop = this.loops[route]
    const inside = route === 'bay' && bayCoord(this.x, this.z) > 0.9
    const here = inside ? { x: BAY.x + (CHANNEL.ax - BAY.x) * 0.25, z: BAY.z + (CHANNEL.az - BAY.z) * 0.25 } : { x: this.x, z: this.z }
    const i = nearestIndex(loop, here)
    return loop[(i + 3) % loop.length]
  }

  private travelTo(to: Pt, stop: boolean): void {
    this.legs = planTrip(this.map, { x: this.x, z: this.z }, to, stop)
    this.leg = 0
    this.mode = 'travel'
    this.hold = false
    this.slide = null
  }

  private remainingOnLeg(): number {
    const l = this.legs[this.leg]
    return Math.hypot(l.to.x - this.x, l.to.z - this.z)
  }

  private steerToward(tx: number, tz: number, dt: number, whip = false): number {
    const want = Math.atan2(tx - this.x, tz - this.z)
    const err = wrapAngle(want - this.heading)
    const rate = whip ? WHIP.turnRate : ROUTE.turnRate + (ROUTE.runTurnRate - ROUTE.turnRate) * smooth(SPEED.cruise, SPEED.run, Math.abs(this.speed))
    const turn = Math.max(-rate * dt, Math.min(rate * dt, err))
    this.heading = wrapAngle(this.heading + turn)
    return err
  }

  private approach(target: number, dt: number): void {
    const v = this.speed
    let rate: number
    if (target > v) rate = v >= SPEED.push - 0.2 && target > SPEED.push ? PLANE_ACCEL : 0.9
    else rate = v > SPEED.push + 0.5 ? OFF_PLANE_DECEL : 1.2
    this.speed = target > v ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt)
  }

  update(dt: number, fishOn: boolean): PilotEvents {
    const events: PilotEvents = {}
    const wasPlane = this.onPlane
    if (this.mode === 'docked') {
      this.approach(0, dt)
    } else if (this.mode === 'loop') {
      const loop = this.loops[this.route]
      this.index = nearestIndex(loop, { x: this.x, z: this.z }, this.index, 12)
      const ahead = Math.max(1, Math.round(Math.max(ROUTE.lookahead, Math.abs(this.speed) * 1.2) / ROUTE.spacing))
      const target = loop[(this.index + ahead) % loop.length]
      const err = this.steerToward(target.x, target.z, dt)
      const base = this.hold || fishOn ? 0 : SPEED_STEPS[this.setting]
      this.approach(base * (1 - 0.5 * Math.min(1, Math.abs(err) / 0.8)), dt)
    } else {
      const l = this.legs[this.leg]
      const left = this.remainingOnLeg()
      const aim = Math.abs(wrapAngle(Math.atan2(l.to.x - this.x, l.to.z - this.z) - this.heading))
      const whip = !!l.send && !l.beach && (!!l.whip || aim > WHIP.sharp) && aim > WHIP.lined
      this.whipping = whip
      const err = this.slide === null ? this.steerToward(l.to.x, l.to.z, dt, whip) : 0
      const brake = (this.speed * this.speed - SPEED.cruise * SPEED.cruise) / (2 * OFF_PLANE_DECEL) + 4
      let target = SPEED.cruise
      if (l.plane && Math.abs(err) < 0.25 && left > Math.max(ROUTE.offPlane, brake)) target = SPEED.run
      if (l.send) target = whip ? SPEED.run * WHIP.keep : SPEED.run
      if (l.stop && left < 8) target = Math.max(0.25, SPEED.creep * Math.min(1, left / 4))
      if (this.hold && !l.plane && !l.send) target = 0
      this.planingNow = target === SPEED.run
      if (l.beach && this.slide === null && this.map.depthAt(this.x, this.z) < 0.45) this.slide = (this.speed * this.speed) / (2 * Math.max(1.5, left))
      if (this.slide !== null) this.speed = Math.max(0, this.speed - this.slide * dt)
      else this.approach(target, dt)
      if (l.beach && this.slide !== null && (this.speed <= 0.05 || left < 0.3)) {
        this.speed = 0
        this.slide = null
        this.mode = 'docked'
        this.beached = true
        this.planingNow = false
        this.leg = this.legs.length
        events.arrived = 'docked'
        events.beached = true
        this.settle(dt, events)
        return events
      }
      const next = this.legs[this.leg + 1]
      const reached = l.beach ? false : l.stop ? left < 1.2 : left < Math.max(l.send && next?.send && !l.whip ? WHIP.pass : 2.5, Math.abs(this.speed) * dt * 2)
      if (reached) {
        this.leg++
        if (this.leg >= this.legs.length) {
          if (l.stop) {
            this.mode = 'docked'
            this.speed = Math.min(this.speed, SPEED.creep)
            events.arrived = 'docked'
          } else {
            this.mode = 'loop'
            this.index = nearestIndex(this.loops[this.route], { x: this.x, z: this.z })
            events.arrived = 'loop'
          }
          this.planingNow = false
        }
      }
    }
    if (this.mode !== 'travel' || !this.legs[this.leg]?.send) this.whipping = false
    if (this.whipping) this.sliding = true
    if (this.sliding) {
      const slip = wrapAngle(this.heading - this.course)
      this.course = wrapAngle(this.course + Math.sign(slip) * Math.min(Math.abs(slip), WHIP.grip * dt))
      if (!this.whipping && Math.abs(slip) < 0.05) this.sliding = false
    }
    if (!this.sliding) this.course = this.heading
    this.x += Math.sin(this.course) * this.speed * dt
    this.z += Math.cos(this.course) * this.speed * dt
    if (!wasPlane && this.onPlane) events.onPlane = true
    if (wasPlane && !this.onPlane) events.offPlane = true
    this.settle(dt, events)
    return events
  }

  /** Lifts the hull along the jump's arc over the island, or onto the ground wherever it is above the water. */
  private settle(dt: number, events: PilotEvents): void {
    const before = this.lift
    let lift = 0
    const st = this.stuntPlan
    const l = this.legs[this.leg]
    if (st && this.homeward && this.mode === 'travel' && l?.jump) {
      lift = stuntArc(st, (this.x - st.entry.x) * st.dir.x + (this.z - st.entry.z) * st.dir.z).lift
    }
    const flying = lift > 0.3
    if (flying && !this.flying) events.airborne = true
    if (!flying && this.flying) events.splashdown = true
    this.flying = flying
    const ground = this.hullGround()
    lift = Math.max(lift, ground.lift, 0)
    this.lift = lift
    this.groundPitch = ground.lift > 0 && ground.lift >= lift - 1e-6 ? ground.pitch : 0
    const run = Math.abs(this.speed) * dt
    this.liftSlope = run > 1e-3 ? Math.max(-1, Math.min(1, (lift - before) / run)) : this.liftSlope * 0.9
  }

  get airborne(): boolean {
    return this.flying
  }

  /**
   * The bank under the hull: the lift that keeps the whole keel `HULL_DRAFT` above the ground (stern, middle and bow sampled along the
   * heading) and the pitch of the slope it sits on. Both are 0 over open water.
   */
  hullGround(): { lift: number; pitch: number } {
    const fx = Math.sin(this.heading)
    const fz = Math.cos(this.heading)
    const half = this.hullLength * 0.42
    const offsets = [-half, -half / 2, 0, half / 2, half]
    const ground = offsets.map((d) => this.map.heightAt(this.x + fx * d, this.z + fz * d))
    if (Math.max(...ground) <= -HULL_DRAFT) return { lift: 0, pitch: 0 }
    const keel = (g: number) => Math.max(g, -HULL_DRAFT)
    const pitch = Math.atan2(keel(ground[4]) - keel(ground[0]), half * 2)
    const s = Math.sin(pitch)
    let lift = 0
    for (let i = 0; i < offsets.length; i++) lift = Math.max(lift, ground[i] + HULL_DRAFT - offsets[i] * s)
    return { lift, pitch }
  }
}

/** The dock as `findLandmarks` in world/World.ts lays it out: from the bank at angle −0.9 out 16 m over the water. */
export function dockLine(map: WaterMap): { start: Pt; end: Pt } {
  const angle = -0.9
  const radius = lakeRadius(angle)
  const dx = Math.cos(angle)
  const dz = Math.sin(angle)
  let shoreDist = radius * 0.8
  for (let d = radius * 0.7; d < radius * 1.5; d += 0.5) {
    if (map.heightAt(LAKE_CENTER.x + dx * d, LAKE_CENTER.z + dz * d) > 0.6) {
      shoreDist = d
      break
    }
  }
  const at = (d: number) => ({ x: LAKE_CENTER.x + dx * d, z: LAKE_CENTER.z + dz * d })
  return { start: at(shoreDist + 2), end: at(shoreDist - 16) }
}
