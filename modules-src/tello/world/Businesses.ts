/**
 * The exteriors of Montello's working businesses outside downtown (downtown's fronts are Storefronts.ts): the fuel
 * stations (Kwik Trip, BP and Mobil: glass store front with a sign band and entry canopy, pump islands with Blender
 * dispensers where the bake put the pumps, a lit fuel canopy lettered on both sides, canopy posts and bollards), the
 * grocery (Freitag's Food Center: glass front and vestibule canopy, sign, cart corrals, roof units), Drew's Lakeside
 * Bar & Grill (entry, sign, a deck on the lake side), Foxtails Gentlemen's Club on Highway 23 (blank dark front, lit
 * canopy, a sign pylon; exterior only), the Marquette County Sheriff's Office (portico, flagpoles, monument sign) and
 * the freight depot behind Freitag's (a metal warehouse with a row of dock doors). Plain lettering on dark boards, no
 * logos and no brand colours. Places come from the JSON `pois` (`i` building index, `d` front door, `pumps`).
 */
import { hexRGB, type RGB } from '../../foxlake/fp/core/Geo'
import { pointInRing } from './Poly'
import type { BuildingData, Poi } from '../data/MapData'
import type { TelloLand } from '../region'
import { edgesOf, facing, type Edge } from './Buildings'
import { place } from './Kit'
import type { PlaceLayer } from './PlaceLayer'
import type { StaticSink } from './Sink'
import { SIGN_BOARD, SIGN_INK, type Signs } from './Signs'

export interface DepotSite {
  /** Map coordinates: the middle of the dock face, its outward direction (map), the building's centre and yaw. */
  dock: { x: number; z: number }
  face: [number, number]
  x: number
  z: number
  yaw: number
  length: number
  depth: number
}

export interface BusinessesBuilt { fuelStations: number; pumps: number; canopies: number; signs: number; depot: DepotSite | null }

const DARK = hexRGB(0x23262b)
const ALUM = hexRGB(0x4a4d52)
const WOOD = hexRGB(0x6f573f)
const WOOD_DARK = hexRGB(0x4d3a2a)
const CANOPY_WHITE = hexRGB(0xe9e7e1)
const CANOPY_BAND = hexRGB(0x4a4d52)
const METAL_WALL = hexRGB(0xb9bdbf)
const FLAGPOLE = hexRGB(0xd7d9db)

/** A `pois` row with the bake's place fields: its building's index and the spot behind that building. */
type PlacePoi = Poi & { i?: number; b?: [number, number] }

const FUEL_NAMES = new Set(['Kwik Trip', 'BP', 'Mobil'])

/** Places whose own building a host world replaces (Fox Lake rebuilds Foxtails as its casino): only their street sign is drawn. */
export const REPLACED_BUILDINGS = new Set<string>()

export interface Wall { e: Edge; t: number; floor: number }

const toTown = (x: number, z: number): [number, number] => [x, -z]

/** The wall of the building closest to the door (a map point), with where along it the door is. */
export function wallNear(b: BuildingData, door: [number, number, number]): Wall | null {
  const edges = edgesOf(b.p)
  const [dx, dz] = toTown(door[0], door[1])
  const out: [number, number] = [Math.sin(door[2]), -Math.cos(door[2])]
  let best: Edge | null = null
  let bestScore = Infinity
  for (const e of edges) {
    if (e.len < 2.5) continue
    const ex = (e.bx - e.ax) / e.len
    const ez = (e.bz - e.az) / e.len
    const t = Math.max(0, Math.min(e.len, (dx - e.ax) * ex + (dz - e.az) * ez))
    const dist = Math.hypot(dx - (e.ax + ex * t), dz - (e.az + ez * t))
    const score = dist + (e.nx * out[0] + e.nz * out[1] < 0.3 ? 40 : 0)
    if (score < bestScore) {
      bestScore = score
      best = e
    }
  }
  if (!best) return null
  const ex = (best.bx - best.ax) / best.len
  const ez = (best.bz - best.az) / best.len
  return { e: best, t: Math.max(0, Math.min(best.len, (dx - best.ax) * ex + (dz - best.az) * ez)), floor: b.f }
}

export function at(w: Wall, t: number, out = 0): [number, number] {
  const e = w.e
  return [e.ax + ((e.bx - e.ax) / e.len) * t + e.nx * out, e.az + ((e.bz - e.az) / e.len) * t + e.nz * out]
}

function wallQuad(b: ReturnType<PlaceLayer['builder']>, w: Wall, t0: number, t1: number, y0: number, y1: number, out: number, color?: RGB): void {
  const e = w.e
  const p0 = at(w, t0, out)
  const p1 = at(w, t1, out)
  facing(b, [[p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]]], [e.nx, 0, e.nz], [[0, 0], [t1 - t0, 0], [t1 - t0, y1 - y0], [0, y1 - y0]], color)
}

function wallBox(layer: PlaceLayer, w: Wall, t0: number, t1: number, y0: number, y1: number, out0: number, out1: number, color: RGB): void {
  const [x, z] = at(w, (t0 + t1) / 2)
  const b = layer.builder(x, z, layer.M.paint)
  const e = w.e
  const ax = (e.bx - e.ax) / e.len
  const az = (e.bz - e.az) / e.len
  const mid = (out0 + out1) / 2
  const cx = x + e.nx * mid
  const cz = z + e.nz * mid
  b.orientedBox(cx, (y0 + y1) / 2, cz, (t1 - t0) / 2, (y1 - y0) / 2, (out1 - out0) / 2, Math.atan2(-az, ax), { color })
}

/** A glass store front along part of a wall: lit panes between dark mullions, a sill, a fascia band and double entry doors at the door. */
function storeFront(layer: PlaceLayer, w: Wall, from: number, to: number, doorWidth: number, band: RGB): void {
  const { floor } = w
  const [mx, mz] = at(w, (from + to) / 2)
  const glass = layer.builder(mx, mz, layer.M.lit, false, false)
  const y0 = floor + 0.35
  const y1 = floor + 2.75
  const d0 = Math.max(from, w.t - doorWidth / 2)
  const d1 = Math.min(to, w.t + doorWidth / 2)
  const span = (a: number, b: number) => {
    if (b - a > 0.3) wallQuad(glass, w, a, b, y0, y1, 0.05)
  }
  span(from, d0)
  span(d1, to)
  wallQuad(glass, w, d0, d1, floor + 0.05, floor + 2.5, 0.05)
  const cols = Math.max(1, Math.round((to - from) / 1.5))
  for (let i = 0; i <= cols; i++) {
    const t = from + ((to - from) * i) / cols
    if (t > d0 + 0.1 && t < d1 - 0.1) continue
    wallBox(layer, w, t - 0.04, t + 0.04, y0 - 0.05, y1 + 0.05, 0.03, 0.12, ALUM)
  }
  wallBox(layer, w, d0 - 0.04, d0 + 0.04, floor, floor + 2.55, 0.03, 0.12, ALUM)
  wallBox(layer, w, d1 - 0.04, d1 + 0.04, floor, floor + 2.55, 0.03, 0.12, ALUM)
  wallBox(layer, w, (d0 + d1) / 2 - 0.03, (d0 + d1) / 2 + 0.03, floor, floor + 2.5, 0.04, 0.1, ALUM)
  wallBox(layer, w, from - 0.1, to + 0.1, y0 - 0.25, y0, 0.0, 0.22, hexRGB(0x7d7466))
  wallBox(layer, w, from - 0.1, to + 0.1, y1, y1 + 0.85, 0.0, 0.3, band)
  wallBox(layer, w, from - 0.15, to + 0.15, y1 + 0.85, y1 + 0.97, 0.0, 0.36, hexRGB(0xd9d6cf))
}

export function entryCanopy(layer: PlaceLayer, w: Wall, scaleX = 1): void {
  const [x, z] = at(w, w.t)
  layer.lay('entry-canopy', x, z, place(x + w.e.nx * 0.02, w.floor, z + w.e.nz * 0.02, scaleX, 1, 1, Math.atan2(w.e.nx, w.e.nz)), { paint: CANOPY_WHITE, trim: CANOPY_BAND, stone: hexRGB(0xffffff) })
}

export function wallPacks(layer: PlaceLayer, w: Wall, count: number, y: number): void {
  for (let i = 0; i < count; i++) {
    const t = (w.e.len * (i + 0.5)) / count
    const [x, z] = at(w, t)
    layer.lay('wall-pack', x, z, place(x + w.e.nx * 0.02, w.floor + y, z + w.e.nz * 0.02, 1, 1, 1, Math.atan2(w.e.nx, w.e.nz)), {})
  }
}

function placeBuilding(land: TelloLand, poi: PlacePoi): BuildingData | null {
  return poi.i === undefined ? null : land.doc.buildings[poi.i] ?? null
}

function findFree(land: TelloLand, from: [number, number], n: [number, number], offsets: number[], sides: number[], blocks: BuildingData[]): [number, number] | null {
  for (const off of offsets) {
    for (const side of sides) {
      const x = from[0] + n[0] * off - n[1] * side
      const z = from[1] + n[1] * off + n[0] * side
      if (land.clearAt(x, z) < 2.2) continue
      if (blocks.some((b) => pointInRing(b.p, x, z))) continue
      return [x, z]
    }
  }
  return null
}

interface Ctx { land: TelloLand; layer: PlaceLayer; signs: Signs; sink: StaticSink; out: BusinessesBuilt }

function addSign(c: Ctx, text: string, x: number, z: number, y: number, w: number, h: number, n: [number, number], board = SIGN_BOARD, ink = SIGN_INK, out = 0.04): void {
  c.signs.add({ text, x, z, y, w, h, n, board, ink, out })
  c.out.signs++
}

/** A fuel canopy: slab, band, four posts, a lit underside. `rect` in map coordinates (centre, half sizes, yaw). */
function canopy(c: Ctx, rect: [number, number, number, number, number], floor: number, top: number, name: string): void {
  const [mx, mz, hx, hz, yaw] = rect
  const cs = Math.cos(yaw)
  const sn = Math.sin(yaw)
  const slab = c.layer.builder(mx, -mz, c.layer.M.paint)
  slab.orientedBox(mx, top - 0.3, -mz, hx, 0.3, hz, yaw, { color: CANOPY_WHITE })
  slab.orientedBox(mx, top - 0.3, -mz, hx + 0.03, 0.12, hz + 0.03, yaw, { color: CANOPY_BAND })
  const lit = c.layer.builder(mx, -mz, c.layer.M.lit, false, false)
  const corner = (a: number, d: number): [number, number] => [mx + a * hx * cs - d * hz * sn, -(mz + a * hx * sn + d * hz * cs)]
  const under = top - 0.61
  for (const a of [-0.6, 0.15]) {
    const p = [corner(a, -0.75), corner(a + 0.45, -0.75), corner(a + 0.45, 0.75), corner(a, 0.75)]
    facing(lit, p.map(([x, z]): [number, number, number] => [x, under, z]), [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]])
  }
  const post = c.layer.builder(mx, -mz, c.layer.M.paint)
  for (const [a, d] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = a * Math.max(0.6, hx - 1.2)
    const lz = d * Math.max(0.6, hz - 1.2)
    const px = mx + lx * cs - lz * sn
    const pz = -(mz + lx * sn + lz * cs)
    post.cylinder(px, floor - 0.2, pz, 0.2, 0.2, top - floor - 0.5, 10, false, CANOPY_WHITE)
    c.sink.addStaticCylinder(px, floor + (top - floor) / 2, pz, (top - floor) / 2, 0.28)
  }
  for (const side of [-1, 1]) {
    addSign(c, name.toUpperCase(), mx - sn * side * hz, -(mz + cs * side * hz), top - 0.57, Math.min(5.2, hx * 1.4), 0.5, [-sn * side, -(cs * side)], SIGN_BOARD, SIGN_INK, 0.05)
  }
  c.out.canopies++
}

function pumpsOf(c: Ctx, poi: Poi): void {
  const pumps = poi.pumps
  if (!pumps?.length) return
  const used = new Set<number>()
  const islands: { a: [number, number]; b: [number, number] }[] = []
  for (let i = 0; i < pumps.length; i++) {
    if (used.has(i)) continue
    let best = -1
    let bd = 8
    for (let j = i + 1; j < pumps.length; j++) {
      if (used.has(j)) continue
      const d = Math.hypot(pumps[i][0] - pumps[j][0], pumps[i][1] - pumps[j][1])
      if (d < bd) {
        bd = d
        best = j
      }
    }
    used.add(i)
    if (best >= 0) {
      used.add(best)
      islands.push({ a: pumps[i], b: pumps[best] })
    } else islands.push({ a: pumps[i], b: pumps[i] })
  }
  for (const { a, b } of islands) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const ux = len > 0.1 ? (b[0] - a[0]) / len : 1
    const uz = len > 0.1 ? (b[1] - a[1]) / len : 0
    const mx = (a[0] + b[0]) / 2
    const mz = (a[1] + b[1]) / 2
    const y = c.land.heightAt(mx, mz)
    const yaw = Math.atan2(uz, ux)
    const [tx, tz] = toTown(mx, mz)
    const length = Math.max(2.4, len + 2.4)
    c.layer.lay('island', tx, tz, place(tx, y, tz, length, 1, 1, yaw), {})
    c.sink.addStaticBox({ cx: tx, cy: y + 0.4, cz: tz, hx: length / 2, hy: 0.4, hz: 0.55, rotY: yaw })
    for (const p of len > 0.1 ? [a, b] : [a]) {
      const [px, pz] = toTown(p[0], p[1])
      c.layer.lay('pump', px, pz, place(px, y + 0.18, pz, 1, 1, 1, yaw), {})
      c.out.pumps++
    }
    for (const end of [-1, 1]) {
      const bx = mx + ux * end * (length / 2 + 0.3)
      const bz = mz + uz * end * (length / 2 + 0.3)
      const [qx, qz] = toTown(bx, bz)
      c.layer.lay('bollard', qx, qz, place(qx, c.land.heightAt(bx, bz), qz), { paint: hexRGB(0xd9c24a) })
    }
  }
}

function fuelStation(c: Ctx, poi: PlacePoi, hasCanopy: (x: number, z: number) => boolean): void {
  const b = placeBuilding(c.land, poi)
  if (!b || !poi.d) return
  const wall = wallNear(b, poi.d)
  if (wall) {
    const { e } = wall
    const from = Math.max(0.8, wall.t - Math.min(8, e.len * 0.45))
    const to = Math.min(e.len - 0.8, wall.t + Math.min(8, e.len * 0.45))
    storeFront(c.layer, wall, from, to, 2.2, DARK)
    entryCanopy(c.layer, wall, 1.2)
    wallPacks(c.layer, wall, Math.max(2, Math.floor(e.len / 7)), 3.0)
    const [sx, sz] = at(wall, (from + to) / 2)
    addSign(c, poi.n.toUpperCase(), sx, sz, wall.floor + 3.15, Math.min(6, to - from - 0.6), 0.6, [e.nx, e.nz], SIGN_BOARD, SIGN_INK, 0.2)
  }
  const pumps = poi.pumps ?? []
  if (pumps.length) {
    const cx = pumps.reduce((s, p) => s + p[0], 0) / pumps.length
    const cz = pumps.reduce((s, p) => s + p[1], 0) / pumps.length
    pumpsOf(c, poi)
    if (!hasCanopy(cx, cz)) {
      const a = pumps[0]
      let nearest = pumps[1] ?? pumps[0]
      let nd = Infinity
      for (const p of pumps.slice(1)) {
        const d = Math.hypot(p[0] - a[0], p[1] - a[1])
        if (d < nd) {
          nd = d
          nearest = p
        }
      }
      const yaw = nd < 1e8 && nd > 0.1 ? Math.atan2(nearest[1] - a[1], nearest[0] - a[0]) : 0
      const cs = Math.cos(yaw)
      const sn = Math.sin(yaw)
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
      for (const p of pumps) {
        const u = (p[0] - cx) * cs + (p[1] - cz) * sn
        const v = -(p[0] - cx) * sn + (p[1] - cz) * cs
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v)
      }
      const mu = (u0 + u1) / 2
      const mv = (v0 + v1) / 2
      const rect: [number, number, number, number, number] = [cx + mu * cs - mv * sn, cz + mu * sn + mv * cs, (u1 - u0) / 2 + 4, (v1 - v0) / 2 + 3.5, yaw]
      canopy(c, rect, c.land.heightAt(cx, cz), c.land.heightAt(cx, cz) + 4.8, poi.n)
    }
  }
  c.out.fuelStations++
}

function existingCanopies(c: Ctx): void {
  const fuel = c.land.doc.pois.filter((p) => p.k === 'fuel' && FUEL_NAMES.has(p.n))
  for (const b of c.land.doc.buildings) {
    if (b.k !== 'canopy') continue
    const [mx, mz] = b.r[0]
    let near: Poi | null = null
    let nd = 60
    for (const p of fuel) {
      const d = Math.hypot(p.x - mx, p.z - mz)
      if (d < nd) {
        nd = d
        near = p
      }
    }
    if (!near) continue
    const top = b.f + (b.m ? b.h : Math.max(4.6, b.h))
    const rect = b.r[0] as [number, number, number, number, number]
    const lit = c.layer.builder(rect[0], -rect[1], c.layer.M.lit, false, false)
    const cs = Math.cos(rect[4])
    const sn = Math.sin(rect[4])
    const corner = (a: number, d: number): [number, number] => [rect[0] + a * rect[2] * cs - d * rect[3] * sn, -(rect[1] + a * rect[2] * sn + d * rect[3] * cs)]
    for (const a of [-0.6, 0.15]) {
      const p = [corner(a, -0.75), corner(a + 0.45, -0.75), corner(a + 0.45, 0.75), corner(a, 0.75)]
      facing(lit, p.map(([x, z]): [number, number, number] => [x, top - 0.61, z]), [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]])
    }
    for (const side of [-1, 1]) addSign(c, near.n.toUpperCase(), rect[0] - sn * side * rect[3], -(rect[1] + cs * side * rect[3]), top - 0.57, Math.min(5.2, rect[2] * 1.4), 0.5, [-sn * side, -(cs * side)], SIGN_BOARD, SIGN_INK, 0.05)
    c.out.canopies++
  }
}

function groceryStore(c: Ctx, poi: PlacePoi): void {
  const b = placeBuilding(c.land, poi)
  if (!b || !poi.d) return
  const wall = wallNear(b, poi.d)
  if (!wall) return
  const { e } = wall
  const from = Math.max(1, wall.t - Math.min(22, e.len * 0.45))
  const to = Math.min(e.len - 1, wall.t + Math.min(22, e.len * 0.45))
  storeFront(c.layer, wall, from, to, 3.4, hexRGB(0x3b3f44))
  entryCanopy(c.layer, wall, 1.8)
  wallPacks(c.layer, wall, Math.max(3, Math.floor(e.len / 9)), 3.4)
  const [sx, sz] = at(wall, (from + to) / 2)
  addSign(c, poi.n.toUpperCase(), sx, sz, wall.floor + 3.4, Math.min(14, to - from - 1), 1.1, [e.nx, e.nz], SIGN_BOARD, SIGN_INK, 0.4)
  const main = b.r[0]
  const yaw = main[4]
  const cs = Math.cos(yaw)
  const sn = Math.sin(yaw)
  const roof = b.f + Math.max(...b.r.map((r) => r[6] ?? 0), b.h) + 0.45
  for (let i = 0; i < 7; i++) {
    const u = (-0.65 + (i % 4) * 0.42) * main[2]
    const v = (i < 4 ? -0.35 : 0.3) * main[3]
    const rx = main[0] + u * cs - v * sn
    const rz = main[1] + u * sn + v * cs
    const [tx, tz] = toTown(rx, rz)
    c.layer.lay('rtu', tx, tz, place(tx, roof, tz, 1.3, 1.3, 1.3, yaw), {})
  }
  const lot = c.land.doc.lots.find((l) => (l as { n?: string }).n === "Freitag's Food Center lot")
  if (lot) {
    const xs = lot.p.filter((_v, i) => i % 2 === 0)
    const zs = lot.p.filter((_v, i) => i % 2 === 1)
    const x1 = Math.max(...xs)
    const z0 = Math.min(...zs)
    const z1 = Math.max(...zs)
    for (const k of [0.25, 0.5, 0.75]) {
      const cx = x1 - 3
      const cz = z0 + (z1 - z0) * k
      if (!pointInRing(lot.p, cx, cz)) continue
      const [tx, tz] = toTown(cx, cz)
      c.layer.lay('cart-corral', tx, tz, place(tx, c.land.heightAt(cx, cz), tz, 1, 1, 1, 0), {})
    }
  }
}

function lakeside(c: Ctx, poi: PlacePoi): void {
  const b = placeBuilding(c.land, poi)
  if (!b || !poi.d) return
  const wall = wallNear(b, poi.d)
  if (!wall) return
  const { e } = wall
  entryCanopy(c.layer, wall, 0.8)
  const [sx, sz] = at(wall, e.len / 2)
  addSign(c, poi.n.toUpperCase(), sx, sz, wall.floor + 3.0, Math.min(6.2, e.len - 0.6), 0.75, [e.nx, e.nz], 0x1f3a2e, SIGN_INK, 0.2)
  const back = backEdge(b, e)
  if (!back) return
  const deckLen = 4.5
  const deckWide = Math.min(9, e.len)
  const cx = back.x - e.nx * (deckLen / 2)
  const cz = back.z - e.nz * (deckLen / 2)
  const dxw = (e.bx - e.ax) / e.len
  const dzw = (e.bz - e.az) / e.len
  const yaw = Math.atan2(-dzw, dxw)
  const wood = c.layer.builder(cx, cz, c.layer.M.paint)
  wood.orientedBox(cx, b.f + 0.1, cz, deckWide / 2, 0.1, deckLen / 2, yaw, { color: WOOD })
  for (const side of [-1, 1]) {
    for (let k = 0; k <= 4; k++) {
      const lat = -deckLen / 2 + (deckLen * k) / 4
      wood.cylinder(cx + dxw * side * (deckWide / 2) - e.nx * lat, b.f + 0.2, cz + dzw * side * (deckWide / 2) - e.nz * lat, 0.05, 0.05, 1.0, 6, true, WOOD_DARK)
    }
  }
  for (const k of [-1, 0, 1]) {
    const px = cx + dxw * k * 2.6
    const pz = cz + dzw * k * 2.6
    wood.cylinder(px, b.f + 1.9, pz, 0.8, 0.8, 0.05, 10, true, hexRGB(0xd9d6cf))
    wood.cylinder(px, b.f + 0.2, pz, 0.04, 0.04, 1.75, 6, true, WOOD_DARK)
  }
  c.sink.addStaticBox({ cx, cy: b.f + 0.1, cz, hx: deckWide / 2, hy: 0.1, hz: deckLen / 2, rotY: yaw })
}

function backEdge(b: BuildingData, front: Edge): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null
  let score = -Infinity
  for (const e of edgesOf(b.p)) {
    const dot = -(e.nx * front.nx + e.nz * front.nz)
    if (dot > score && e.len > 2.5) {
      score = dot
      best = { x: (e.ax + e.bx) / 2, z: (e.az + e.bz) / 2 }
    }
  }
  return best
}

/** Yahooz Sports Bar & Grill: its renovated front has no sign of its own, so it gets a lettered board over the doors and lights. */
function yahooz(c: Ctx, poi: PlacePoi): void {
  const b = placeBuilding(c.land, poi)
  if (!b || !poi.d) return
  const wall = wallNear(b, poi.d)
  if (!wall) return
  const [sx, sz] = at(wall, wall.t)
  addSign(c, 'YAHOOZ SPORTS BAR & GRILL', sx, sz, wall.floor + 2.75, Math.min(5.4, wall.e.len - 0.6), 0.62, [wall.e.nx, wall.e.nz], 0x2e4640, SIGN_INK, 0.45)
  wallPacks(c.layer, wall, 2, 3.2)
}

function foxtails(c: Ctx, poi: PlacePoi): void {
  const b = placeBuilding(c.land, poi)
  if (!b || !poi.d) return
  const wall = wallNear(b, poi.d)
  if (!wall) return
  const { e } = wall
  if (!REPLACED_BUILDINGS.has(poi.n)) {
    entryCanopy(c.layer, wall, 1.3)
    const [sx, sz] = at(wall, wall.t)
    addSign(c, "FOXTAILS GENTLEMEN'S CLUB", sx, sz, wall.floor + 3.7, Math.min(8, e.len - 0.4), 0.9, [e.nx, e.nz], 0x15110f, 0xe2b04a, 0.35)
    wallPacks(c.layer, wall, Math.max(2, Math.floor(e.len / 6)), 3.0)
  }
  const spot = findFree(c.land, [poi.d[0], poi.d[1]], [Math.sin(poi.d[2]), Math.cos(poi.d[2])], [9, 12, 15], [0, 6, -6], c.land.doc.buildings)
  if (spot) {
    const [px, pz] = toTown(spot[0], spot[1])
    const pole = c.layer.builder(px, pz, c.layer.M.paint)
    pole.cylinder(px, c.land.heightAt(spot[0], spot[1]) - 0.2, pz, 0.12, 0.12, 6.2, 8, true, ALUM)
    const n: [number, number] = [Math.sin(poi.d[2]), -Math.cos(poi.d[2])]
    addSign(c, "FOXTAILS GENTLEMEN'S CLUB", px, pz, c.land.heightAt(spot[0], spot[1]) + 4.4, 3.6, 1.6, n, 0x15110f, 0xe2b04a, 0.15)
    c.sink.addStaticCylinder(px, c.land.heightAt(spot[0], spot[1]) + 3, pz, 3, 0.2)
  }
}

function sheriff(c: Ctx, poi: PlacePoi): void {
  const b = placeBuilding(c.land, poi)
  if (!b || !poi.d) return
  const wall = wallNear(b, poi.d)
  if (!wall) return
  const { e } = wall
  entryCanopy(c.layer, wall, 1.7)
  wallPacks(c.layer, wall, Math.max(3, Math.floor(e.len / 8)), 3.2)
  const [sx, sz] = at(wall, wall.t)
  addSign(c, 'MARQUETTE COUNTY SHERIFF', sx, sz, wall.floor + 3.75, 7.4, 0.7, [e.nx, e.nz], 0x1f2a3c, SIGN_INK, 0.45)
  const nMap: [number, number] = [Math.sin(poi.d[2]), Math.cos(poi.d[2])]
  const spot = findFree(c.land, [poi.d[0], poi.d[1]], nMap, [7, 9, 11], [4, -4, 8], c.land.doc.buildings)
  if (spot) {
    const [px, pz] = toTown(spot[0], spot[1])
    const y = c.land.heightAt(spot[0], spot[1])
    const n: [number, number] = [nMap[0], -nMap[1]]
    c.layer.builder(px, pz, c.layer.M.foundation, false).box(px - 2.2, y - 0.1, pz - 0.35, px + 2.2, y + 1.7, pz + 0.35, { color: [1, 1, 1] })
    addSign(c, "SHERIFF'S OFFICE", px, pz, y + 0.6, 3.6, 0.8, n, 0x1f2a3c, SIGN_INK, 0.4)
    c.sink.addStaticBox({ cx: px, cy: y + 0.8, cz: pz, hx: 2.2, hy: 0.9, hz: 0.35, rotY: 0 })
    for (const side of [-1, 1]) {
      const fx = px + 4.2 * side
      const pole = c.layer.builder(fx, pz, c.layer.M.paint)
      pole.cylinder(fx, y - 0.1, pz, 0.07, 0.05, 9.0, 8, true, FLAGPOLE)
    }
  }
}

function depot(c: Ctx, freitag: PlacePoi): DepotSite | null {
  const b = placeBuilding(c.land, freitag)
  const back = freitag.b
  if (!b || !back) return null
  const length = 36
  const depth = 15
  const centre: [number, number] = [back[0] - 4, back[1] - 29]
  const yaw = 0
  const ground = c.land.heightAt(centre[0], centre[1])
  const floor = Math.max(ground, b.f - 0.3)
  const [tx, tz] = toTown(centre[0], centre[1])
  const wall = c.layer.builder(tx, tz, c.layer.M.paint)
  const height = 7.2
  wall.orientedBox(tx, floor + height / 2 - 0.2, tz, length / 2, height / 2 + 0.2, depth / 2, 0, { color: METAL_WALL })
  wall.orientedBox(tx, floor + height + 0.05, tz, length / 2 + 0.3, 0.12, depth / 2 + 0.3, 0, { color: hexRGB(0x7d8184) })
  c.sink.addStaticBox({ cx: tx, cy: floor + height / 2, cz: tz, hx: length / 2, hy: height / 2, hz: depth / 2, rotY: 0 })
  const northZ = centre[1] + depth / 2
  const docks = 7
  for (let i = 0; i < docks; i++) {
    const x = centre[0] - length / 2 + 3 + (i * (length - 6)) / (docks - 1)
    const [dx, dz] = toTown(x, northZ)
    c.layer.lay('dock-door', dx, dz, place(dx, floor, dz, 1, 1, 1, Math.PI), {})
  }
  const [px, pz] = toTown(centre[0], northZ)
  const apron = c.layer.builder(px, pz, c.layer.M.foundation, false)
  apron.box(centre[0] - length / 2, floor - 0.06, -northZ - 7, centre[0] + length / 2, floor + 0.03, -northZ, { color: [1, 1, 1] })
  wallPacks(c.layer, { e: { ax: centre[0] - length / 2, az: -northZ, bx: centre[0] + length / 2, bz: -northZ, nx: 0, nz: -1, len: length, at: 0 }, t: 0, floor }, 4, 5.0)
  addSign(c, "FREITAG'S FREIGHT DEPOT", centre[0], -northZ, floor + 5.2, 9, 0.9, [0, -1], SIGN_BOARD, SIGN_INK, 0.35)
  return { dock: { x: centre[0], z: northZ + 1 }, face: [0, 1], x: centre[0], z: centre[1], yaw, length, depth }
}

export function buildBusinesses(layer: PlaceLayer, signs: Signs, sink: StaticSink, land: TelloLand): BusinessesBuilt {
  const out: BusinessesBuilt = { fuelStations: 0, pumps: 0, canopies: 0, signs: 0, depot: null }
  const c: Ctx = { land, layer, signs, sink, out }
  const done = new Set<number>()
  existingCanopies(c)
  const canopyBuildings = land.doc.buildings.filter((b) => b.k === 'canopy')
  const hasCanopy = (x: number, z: number) => canopyBuildings.some((b) => Math.hypot(b.r[0][0] - x, b.r[0][1] - z) < 14)
  for (const poi of land.doc.pois as PlacePoi[]) {
    const i = poi.i
    if (poi.k === 'fuel' && FUEL_NAMES.has(poi.n) && i !== undefined && !done.has(i)) {
      done.add(i)
      fuelStation(c, poi, hasCanopy)
    } else if (poi.n === "Freitag's Food Center") {
      groceryStore(c, poi)
      out.depot = depot(c, poi)
    } else if (poi.n === "Drew's Lakeside Bar & Grill") lakeside(c, poi)
    else if (poi.n === 'Yahooz Sports Bar & Grill') yahooz(c, poi)
    else if (poi.n === "Foxtails Gentlemen's Club") foxtails(c, poi)
    else if (poi.n === 'Marquette County Sheriff Department') sheriff(c, poi)
  }
  return out
}
