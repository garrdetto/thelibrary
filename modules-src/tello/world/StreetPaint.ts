/**
 * The paint on downtown Montello's streets: a double yellow centre line, and on each side the white line along the
 * parking lane with a tick at every stall, or a white edge line where there's no room to park. Lines stop short of
 * every cross street and break for alleys and driveways. At the light where Main Street meets State Highway 23 there
 * are stop bars on each approach and ladder crosswalks across West Montello Street and both of Main Street's legs.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import type { RoadData } from '../data/MapData'
import { isMainLeg, LANE, LEG_WIDTH, townProfiles, type StreetProfile } from '../data/Streets'
import type { TelloLand } from '../region'
import { batchOf, CELL, toMesh, type Batch } from './Roads'

const LIFT = 0.085
const LINE = 0.11
const STALL = 6.7
const TICK = 1.9

type Paint = 'white' | 'yellow'

interface Gap { x: number; z: number; r: number; full: boolean }

export function buildStreetPaint(scene: Scene, land: TelloLand): Mesh[] {
  const profiles = townProfiles(land.doc)
  const batches = new Map<string, Batch>()
  const h = (x: number, z: number) => land.heightAt(x, z) + LIFT
  const quad = (paint: Paint, c: [number, number][]) => {
    const b = batchOf(batches, `${paint}|${Math.floor(c[0][0] / CELL)},${Math.floor(c[0][1] / CELL)}`)
    const v = b.positions.length / 3
    for (const [x, z] of c) {
      b.positions.push(land.toSceneX(x), h(x, z), land.toSceneZ(z))
      b.uvs.push(x, z)
    }
    b.indices.push(v, v + 1, v + 2, v, v + 2, v + 3)
  }
  for (const [road, prof] of profiles) paintStreet(prof, gapsFor(land, road), quad)
  for (const m of junctionMarks(land)) quad('white', m)
  const mats: Record<Paint, StandardMaterial> = { white: paint(scene, 'white', new Color3(0.86, 0.86, 0.84)), yellow: paint(scene, 'yellow', new Color3(0.86, 0.66, 0.16)) }
  const out: Mesh[] = []
  for (const [key, b] of batches) {
    if (!b.indices.length) continue
    out.push(toMesh(scene, `tello-paint:${key}`, b, mats[key.split('|')[0] as Paint]))
  }
  return out
}

function paint(scene: Scene, name: string, color: Color3): StandardMaterial {
  const mat = new StandardMaterial(`tello-paint-${name}`, scene)
  mat.diffuseColor = color
  mat.specularColor = Color3.Black()
  mat.ambientColor = new Color3(0.35, 0.35, 0.35)
  mat.backFaceCulling = false
  mat.zOffset = -4
  return mat
}

/** Where `road`'s lines stop: cross streets (everything) and alleys or driveways (just the curb-side lines). */
function gapsFor(land: TelloLand, road: RoadData): Gap[] {
  const out: Gap[] = []
  const p = road.p
  const ends = [[p[0], p[1]], [p[p.length - 2], p[p.length - 1]]]
  for (const other of land.doc.roads) {
    if (other === road || other.k > 3) continue
    const q = other.p
    for (const [x, z] of [[q[0], q[1]], [q[q.length - 2], q[q.length - 1]]]) {
      if (distTo(p, x, z) > road.w / 2 + 7) continue
      // The same street carrying on from one of this road's own ends isn't a crossing.
      const ownEnd = ends.some(([ex, ez]) => Math.hypot(ex - x, ez - z) < 0.6)
      if (ownEnd && other.n === road.n && !isMainLeg(other)) continue
      if (other.k <= 1) out.push({ x, z, r: Math.max(other.w / 2 + 2.5, 6.5), full: true })
      else out.push({ x, z, r: other.w / 2 + 1, full: false })
    }
  }
  return out
}

function paintStreet(prof: StreetProfile, gaps: Gap[], quad: (paint: Paint, c: [number, number][]) => void): void {
  const { pts, half, parking } = prof
  const n = pts.length / 2
  const frames: { x: number; z: number; sx: number; sz: number; tx: number; tz: number; along: number }[] = []
  let along = 0
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1)
    const dx = pts[c * 2] - pts[a * 2], dz = pts[c * 2 + 1] - pts[a * 2 + 1]
    const len = Math.hypot(dx, dz) || 1
    if (i > 0) along += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1])
    frames.push({ x: pts[i * 2], z: pts[i * 2 + 1], sx: -dz / len, sz: dx / len, tx: dx / len, tz: dz / len, along })
  }
  const blocked = (x: number, z: number, curb: boolean) => gaps.some((g) => (g.full || curb) && Math.hypot(g.x - x, g.z - z) < g.r)
  // A line `off` metres left of the centre (negative: right), from station i to i + 1.
  const line = (paint: Paint, i: number, off: (k: number) => number, curb: boolean) => {
    const a = frames[i], b = frames[i + 1]
    const oa = off(i), ob = off(i + 1)
    const ax = a.x + a.sx * oa, az = a.z + a.sz * oa, bx = b.x + b.sx * ob, bz = b.z + b.sz * ob
    if (blocked(ax, az, curb) || blocked(bx, bz, curb)) return
    const w = LINE / 2
    quad(paint, [[ax - a.sx * w, az - a.sz * w], [bx - b.sx * w, bz - b.sz * w], [bx + b.sx * w, bz + b.sz * w], [ax + a.sx * w, az + a.sz * w]])
  }
  for (let i = 0; i < n - 1; i++) {
    line('yellow', i, () => 0.12, false)
    line('yellow', i, () => -0.12, false)
    const park = parking[i] && parking[i + 1]
    for (const side of [1, -1]) {
      if (park) line('white', i, () => side * LANE, true)
      else line('white', i, (k) => side * (half[k] - 0.3), true)
    }
  }
  // Stall ticks out from the parking line to the curb.
  let next = STALL / 2
  for (let i = 0; i < n; i++) {
    const f = frames[i]
    if (f.along < next) continue
    next = f.along + STALL
    if (!parking[i]) continue
    for (const side of [1, -1]) {
      const x0 = f.x + f.sx * side * LANE, z0 = f.z + f.sz * side * LANE
      const len = Math.min(TICK, half[i] - LANE - 0.2)
      const x1 = x0 + f.sx * side * len, z1 = z0 + f.sz * side * len
      if (blocked(x0, z0, true) || blocked(x1, z1, true)) continue
      const w = LINE / 2
      quad('white', [[x0 - f.tx * w, z0 - f.tz * w], [x1 - f.tx * w, z1 - f.tz * w], [x1 + f.tx * w, z1 + f.tz * w], [x0 + f.tx * w, z0 + f.tz * w]])
    }
  }
}

function distTo(p: ArrayLike<number>, x: number, z: number): number {
  let best = Infinity
  for (let k = 0; k + 3 < p.length; k += 2) {
    const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)))
  }
  return best
}

/** A point `dist` metres from a polyline's start (or end), with its direction of travel toward that end and its left normal. */
function station(p: number[], fromEnd: boolean, dist: number): { x: number; z: number; tx: number; tz: number; sx: number; sz: number } {
  const q: number[] = []
  if (fromEnd) for (let k = p.length - 2; k >= 0; k -= 2) q.push(p[k], p[k + 1])
  else q.push(...p)
  let left = dist
  for (let k = 0; k + 3 < q.length; k += 2) {
    const dx = q[k + 2] - q[k], dz = q[k + 3] - q[k + 1]
    const len = Math.hypot(dx, dz) || 1
    if (left <= len || k + 4 >= q.length) {
      const t = Math.min(1, left / len)
      // Travel runs toward the chosen end: opposite to walking away from it.
      const tx = -dx / len, tz = -dz / len
      return { x: q[k] + dx * t, z: q[k + 1] + dz * t, tx, tz, sx: -tz, sz: tx }
    }
    left -= len
  }
  return { x: q[0], z: q[1], tx: 1, tz: 0, sx: 0, sz: 1 }
}

/** Stop bars and crosswalks at the light where Main Street's legs meet State Highway 23. */
function junctionMarks(land: TelloLand): [number, number][][] {
  const roads = land.doc.roads
  const profiles = townProfiles(land.doc)
  const out: [number, number][][] = []
  const near = (r: RoadData, x: number, z: number) => Math.hypot(r.p[0] - x, r.p[1] - z) < 0.6 || Math.hypot(r.p[r.p.length - 2] - x, r.p[r.p.length - 1] - z) < 0.6
  const west = roads.find((r) => r.n === 'West Montello Street' && near(r, 102.9, 20.4))
  const east = roads.find((r) => r.n === 'State Highway 23' && near(r, 152.5, 17.9) && near(r, 118.8, 21.9))
  const eastLeg = roads.find((r) => isMainLeg(r) && near(r, 118.8, 21.9))
  const westLeg = roads.find((r) => isMainLeg(r) && near(r, 102.9, 20.4))
  if (!west || !east || !eastLeg || !westLeg) return out
  const endIs = (r: RoadData, x: number, z: number) => Math.hypot(r.p[r.p.length - 2] - x, r.p[r.p.length - 1] - z) < 0.6
  // A bar across the lane on the right of traffic heading for the end, `dist` metres short of it.
  const bar = (r: RoadData, x: number, z: number, dist: number, from: number, to: number) => {
    const s = station(r.p, endIs(r, x, z), dist)
    const rx = -s.sx, rz = -s.sz
    const w = 0.25
    out.push([[s.x + rx * from - s.tx * w, s.z + rz * from - s.tz * w], [s.x + rx * to - s.tx * w, s.z + rz * to - s.tz * w], [s.x + rx * to + s.tx * w, s.z + rz * to + s.tz * w], [s.x + rx * from + s.tx * w, s.z + rz * from + s.tz * w]])
  }
  // A ladder of bars running with traffic, across the whole street.
  const ladder = (r: RoadData, x: number, z: number, dist: number, half: number) => {
    const s = station(r.p, endIs(r, x, z), dist)
    for (let o = -half + 0.4; o < half - 0.3; o += 1.2) {
      const cx = s.x + s.sx * o, cz = s.z + s.sz * o
      const ax = cx - s.tx * 1.5, az = cz - s.tz * 1.5, bx = cx + s.tx * 1.5, bz = cz + s.tz * 1.5
      out.push([[ax - s.sx * 0.3, az - s.sz * 0.3], [bx - s.sx * 0.3, bz - s.sz * 0.3], [bx + s.sx * 0.3, bz + s.sz * 0.3], [ax + s.sx * 0.3, az + s.sz * 0.3]])
    }
  }
  const wHalf = profiles.get(west)?.half
  const eHalf = profiles.get(east)?.half
  const wh = wHalf ? wHalf[wHalf.length - 1] : 4.7
  const eh = eHalf ? eHalf[0] : 4.7
  ladder(west, 102.9, 20.4, 7.5, wh)
  bar(west, 102.9, 20.4, 10.2, 0.25, LANE)
  bar(east, 118.8, 21.9, 8.5, 0.25, LANE + Math.min(0, eh - 6.1))
  ladder(eastLeg, 118.8, 21.9, 8.6, LEG_WIDTH / 2)
  bar(eastLeg, 118.8, 21.9, 11, -LEG_WIDTH / 2 + 0.3, LEG_WIDTH / 2 - 0.3)
  ladder(westLeg, 102.9, 20.4, 9.5, LEG_WIDTH / 2)
  return out
}
