/**
 * What makes a house a house: the Blender house kit (`tools/build-town-kit.py` -> `house-kit.glb`) laid onto each
 * building from its lidar footprint and measured roof. Windows with casings, sills and muntins (a few lit at night),
 * shutters, an entry door under a porch or on a stoop, garage doors, gutters and a downspout along the eaves, brick
 * chimneys with caps, gable dormers cut to the roof's real pitch and a heat pump by the back wall. Everything goes into
 * the merged builders Buildings.ts already uses, so the details add triangles, not draw calls.
 *
 * Town coordinates (x east, z south) under the mirrored town root; a part's glTF +z points out of the wall it is on.
 */
import type { Matrix } from '@babylonjs/core/Maths/math.vector'
import { hexRGB, type MeshBuilder, type RGB } from '../../foxlake/fp/core/Geo'
import { ROOF, type BuildingData } from '../data/MapData'
import type { TelloLand } from '../region'
import { at, facing, pick, rand, roofBehind, slope, type Edge, type Roof, type V3 } from './Buildings'
import type { ModelKit } from './Kit'
import { place } from './Kit'

export interface HouseBuilders {
  paint: MeshBuilder
  glass: MeshBuilder
  lit: MeshBuilder
  garage: MeshBuilder
  foundation: MeshBuilder
  shingle: MeshBuilder
  brick: MeshBuilder
  wall: MeshBuilder
}

export interface HouseInput {
  b: BuildingData
  edges: Edge[]
  roofs: Roof[]
  floor: number
  tone: RGB
  wall: RGB
}

const TRIMS = [0xf2f0ea, 0xf2f0ea, 0xf2f0ea, 0xe8e2d0, 0xcfd2d4, 0x5d5a54].map(hexRGB)
const DOORS = [0x4a2f22, 0x2e4a3c, 0x6e2a2a, 0x28364f, 0xd8d2c4, 0x3b3b3d, 0x7a5a2e].map(hexRGB)
const SHUTTERS = [0x2b4a3a, 0x1f2a3c, 0x1b1c1f, 0x6a2b2b, 0x3a4a30].map(hexRGB)
const CHIMNEY = [0x9a5a48, 0x8a4f40, 0xb0674c, 0x7c7a74].map(hexRGB)
const GUTTER = [0xf2f0ea, 0xf2f0ea, 0xe3dfd2, 0x4a3a2e, 0x6f7479].map(hexRGB)
const WHITE: RGB = [1, 1, 1]
const BASE: Record<string, RGB> = {
  trim: TRIMS[0],
  paint: TRIMS[0],
  wall: TRIMS[0],
  door: DOORS[0],
  metal: hexRGB(0x2a2c30),
  black: hexRGB(0x1b1c1f),
  wood: hexRGB(0x6b5340),
}

/** The house's front: the wall nearest pavement (at least 2.6 m long), or -1. */
export function frontEdge(edges: Edge[], land: TelloLand): number {
  let front = -1
  let best = Infinity
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    if (e.len < 2.6) continue
    const clear = land.clearAt((e.ax + e.bx) / 2 + e.nx * 4, -((e.az + e.bz) / 2 + e.nz * 4)) - e.len * 0.02
    if (clear < best) {
      best = clear
      front = i
    }
  }
  return front
}

/** A part on a wall: `t` metres along it from its first end, `y` up, `out` metres off it, scaled along the part's own axes. */
function onWall(e: Edge, t: number, y: number, out: number, sx = 1, sy = 1, sz = 1): Matrix {
  const dx = (e.bx - e.ax) / e.len
  const dz = (e.bz - e.az) / e.len
  return place(e.ax + dx * t + e.nx * out, y, e.az + dz * t + e.nz * out, sx, sy, sz, Math.atan2(e.nx, e.nz))
}

function laid(kit: ModelKit, hb: HouseBuilders, name: string, m: Matrix, over: Partial<Record<string, RGB>>, lit = false): void {
  kit.put(
    name,
    m,
    (slot) => (slot === 'glass' ? (lit ? hb.lit : hb.glass) : slot === 'garage' ? hb.garage : slot === 'stone' ? hb.foundation : slot === 'shingle' ? hb.shingle : slot === 'brick' ? hb.brick : hb.paint),
    (slot) => over[slot] ?? BASE[slot] ?? WHITE,
  )
}

/** A window on a side or back wall: a trim frame and a pane, two quads, so a whole town of windows stays cheap. */
function flatWindow(hb: HouseBuilders, e: Edge, mid: number, y: number, half: number, tall: number, trim: RGB, lit: boolean): void {
  const dx = (e.bx - e.ax) / e.len
  const dz = (e.bz - e.az) / e.len
  const quad = (m: MeshBuilder, w: number, y0: number, y1: number, out: number, color?: RGB) => {
    const ox = e.nx * out
    const oz = e.nz * out
    const a = [e.ax + dx * (mid - w) + ox, e.az + dz * (mid - w) + oz]
    const b = [e.ax + dx * (mid + w) + ox, e.az + dz * (mid + w) + oz]
    facing(m, [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], [e.nx, 0, e.nz], [[0, 0], [2 * w, 0], [2 * w, y1 - y0], [0, y1 - y0]], color)
  }
  quad(hb.paint, half + 0.08, y - 0.08, y + tall + 0.08, 0.03, trim)
  quad(lit ? hb.lit : hb.glass, half, y, y + tall, 0.08)
}

/** Windows, the entry door with its porch or stoop and shutters on a house; the garage door on a garage. */
export function dressOpenings(kit: ModelKit, hb: HouseBuilders, inp: HouseInput, front: number): void {
  const { b, edges, roofs, floor } = inp
  const seed = b.s
  const trim = pick(TRIMS, seed, 21)
  if (b.k === 'garage') {
    if (front < 0) return
    const e = edges[front]
    const wallH = roofBehind(roofs, e).eave
    const w = Math.min(e.len - 0.8, e.len > 6.5 ? 4.9 : 2.7)
    if (w < 1) return
    const tall = Math.min(wallH - 0.25, 2.2)
    laid(kit, hb, 'door-garage', onWall(e, e.len / 2, floor, 0.02, w / 2.6, tall / 2.2), { trim })
    return
  }
  const door = pick(DOORS, seed, 22)
  const shutter = rand(seed, 23) < 0.34 ? pick(SHUTTERS, seed, 24) : null
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    if (e.len < 3.2) continue
    const wallH = roofBehind(roofs, e).eave
    if (wallH < 2.35) continue
    const storeys = wallH > 4.9 ? 2 : 1
    const count = Math.max(1, Math.floor((e.len - 0.8) / 3.1))
    const gap = e.len / count
    const doorAt = i === front ? Math.floor(count / 2) : -1
    const porchy = i === front && wallH >= 2.9 && e.len >= 5.2 && rand(seed, 25) < 0.55
    for (let s = 0; s < storeys; s++) {
      const y = floor + 0.95 + s * 2.65
      for (let k = 0; k < count; k++) {
        const mid = gap * (k + 0.5)
        if (s === 0 && k === doorAt) {
          const stoopy = !porchy
          const clamp = Math.min(e.len - 1.9, Math.max(1.9, mid))
          laid(kit, hb, 'door-entry', onWall(e, clamp, floor + 0.12, 0.02, 1, Math.min(1, (wallH - 0.25) / 2.2)), { trim, door })
          if (porchy) {
            const width = Math.min(1.5, Math.max(0.85, Math.min(e.len - 1.0, 4.4) / 3))
            const mx = Math.min(e.len - 1.5 * width - 0.3, Math.max(1.5 * width + 0.3, clamp))
            laid(kit, hb, 'porch', onWall(e, mx, floor + 0.12, 0.02, width, 1), { trim, shingle: inp.tone })
          } else if (stoopy) laid(kit, hb, 'stoop', onWall(e, clamp, floor + 0.12, 0.02), { trim, shingle: inp.tone })
          continue
        }
        const half = rand(seed, i * 13 + k) < 0.3 ? 0.75 : 0.5
        const tall = Math.min(1.25, wallH - (y - floor) - 0.25)
        if (tall < 0.6) continue
        const lit = rand(seed, i * 31 + k * 7 + s) < 0.3
        if (i !== front && e.len < 8) {
          flatWindow(hb, e, mid, y, half, tall, trim, lit)
          continue
        }
        laid(kit, hb, 'window-house', onWall(e, mid, y, 0.02, half * 2, tall / 1.4), { trim }, lit)
        if (shutter && i === front && s === 0 && half < 0.6) for (const side of [-1, 1]) laid(kit, hb, 'shutter', onWall(e, mid + side * (half + 0.3), y, 0.02, 1, tall / 1.4), { door: shutter })
      }
    }
  }
}

/** The rectangle's eave edges (gable: two, hip: four) as gutters with a downspout; chimney and dormers on the main roof. */
export function dressRoof(kit: ModelKit, hb: HouseBuilders, inp: HouseInput, front: number): void {
  const { b, roofs, floor, edges } = inp
  const gutter = pick(GUTTER, b.s, 26)
  roofs.forEach((r, i) => {
    if (r.type === ROOF.flat) return
    const over = b.k === 'shed' ? 0.2 : 0.38
    const first = r.type === ROOF.hip ? r.hx >= r.hz : r.type === ROOF.gableFirst || (r.type !== ROOF.gableSecond && r.hx >= r.hz)
    if (r.type >= ROOF.shedPlusSecond) return
    const L = first ? r.hx : r.hz
    const W = first ? r.hz : r.hx
    const p = (along: number, across: number, y: number): V3 => (first ? at(r, along, across, y) : at(r, across, along, y))
    const fall = (r.ridge - r.eave) / Math.max(0.5, W)
    const low = floor + r.eave - over * fall + i * 0.015
    for (const side of [-1, 1]) {
      const outV = p(0, side, 0)
      const o: [number, number] = [outV[0] - r.cx, outV[2] - r.cz]
      const ol = Math.hypot(o[0], o[1]) || 1
      const nx = o[0] / ol
      const nz = o[1] / ol
      const run = L + over
      const a0 = p(-run, side * (W + over), low)
      const a1 = p(run, side * (W + over), low)
      const tx = nz
      const tz = -nx
      const forward = (a1[0] - a0[0]) * tx + (a1[2] - a0[2]) * tz > 0
      const start = forward ? a0 : a1
      laid(kit, hb, 'gutter', place(start[0], start[1], start[2], run * 2, 1, 1, Math.atan2(nx, nz)), { metal: gutter })
    }
    if (i === 0) {
      const outV = p(0, 1, 0)
      const nx = outV[0] - r.cx
      const nz = outV[2] - r.cz
      const nl = Math.hypot(nx, nz) || 1
      const corner = p(L + over - 0.12, W + over - 0.05, low)
      const down = low - floor - 0.1
      if (down > 1.2) laid(kit, hb, 'downspout', place(corner[0], floor, corner[2], 1, down, 1, Math.atan2(nx / nl, nz / nl)), { metal: gutter })
    }
  })
  const main = roofs[0]
  if (b.k !== 'house' || main.type === ROOF.flat || main.type >= ROOF.shedPlusSecond) return
  if (rand(b.s, 7) < 0.55) chimney(kit, hb, inp)
  if (main.type === ROOF.gableFirst || main.type === ROOF.gableSecond) dormers(kit, hb, inp, front)
  const back = edges.findIndex((e, i) => i !== front && e.len >= 3 && rand(b.s, 40 + i) < 0.5)
  if (back >= 0 && rand(b.s, 41) < 0.3) laid(kit, hb, 'ac-unit', onWall(edges[back], edges[back].len * 0.3, floor, 0.02), {})
}

function chimney(kit: ModelKit, hb: HouseBuilders, inp: HouseInput): void {
  const { b, floor } = inp
  const main = inp.roofs[0]
  const first = main.type === ROOF.gableFirst || (main.type !== ROOF.gableSecond && main.hx >= main.hz)
  const along = (rand(b.s, 8) - 0.5) * (first ? main.hx : main.hz) * 0.9
  const px = main.cx + (first ? main.ux : main.vx) * along
  const pz = main.cz + (first ? main.uz : main.vz) * along
  const rise = main.ridge - main.eave
  const brick = pick(CHIMNEY, b.s, 27)
  const base = floor + main.eave + rise * 0.3
  const top = floor + main.ridge + 0.85
  const corner = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([a, d]): [number, number] => [px + main.ux * a * 0.35 + main.vx * d * 0.35, pz + main.uz * a * 0.35 + main.vz * d * 0.35])
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corner[k]
    const [bx, bz] = corner[(k + 1) % 4]
    facing(hb.brick, [[ax, base, az], [bx, base, bz], [bx, top, bz], [ax, top, az]], [(ax + bx) / 2 - px, 0, (az + bz) / 2 - pz], [[0, 0], [0.7, 0], [0.7, top - base], [0, top - base]], brick)
  }
  laid(kit, hb, 'chimney-cap', place(px, top, pz, 1, 1, 1, main.yaw), { brick })
}

/** A gable dormer on the slope facing the street: front wall, two cheeks and a gable roof meeting the slope exactly. */
function dormers(kit: ModelKit, hb: HouseBuilders, inp: HouseInput, front: number): void {
  const { b, floor, edges } = inp
  if (front < 0 || rand(b.s, 9) > 0.4) return
  const r = inp.roofs[0]
  const alongFirst = r.type === ROOF.gableFirst
  const L = alongFirst ? r.hx : r.hz
  const W = alongFirst ? r.hz : r.hx
  const rise = r.ridge - r.eave
  if (rise < 1.6 || W < 3.2 || L < 3.6) return
  const p = (along: number, across: number, y: number): V3 => (alongFirst ? at(r, along, across, y) : at(r, across, along, y))
  const fe = edges[front]
  const probe = p(0, 1, 0)
  const side = (probe[0] - r.cx) * fe.nx + (probe[2] - r.cz) * fe.nz >= 0 ? 1 : -1
  const s = rise / W
  const ridgeY = floor + r.ridge
  const dh = 1.3
  const dw = 0.85
  const q = W * 0.8
  const yRise = 0.62
  const y0 = ridgeY - s * q
  const yE = y0 + dh
  const yR = yE + dw * yRise
  const c1 = (ridgeY - yE) / s
  const cm = (ridgeY - yR) / s
  if (c1 < 0.5 || cm < 0.2 || q > W - 0.6) return
  const count = L > 6.5 && rand(b.s, 10) < 0.5 ? 2 : 1
  const out = p(0, side, 0)
  const toward: V3 = [out[0] - r.cx, 0, out[2] - r.cz]
  const nl = Math.hypot(toward[0], toward[2]) || 1
  const ox = toward[0] / nl
  const oz = toward[2] / nl
  const tone = inp.tone
  const under = hb.paint
  for (let d = 0; d < count; d++) {
    const t = count === 1 ? (rand(b.s, 11) - 0.5) * L * 0.5 : (d === 0 ? -1 : 1) * L * 0.45
    const along = p(1, 0, 0)
    const alongV: V3 = [along[0] - r.cx, 0, along[2] - r.cz]
    const al = Math.hypot(alongV[0], alongV[2]) || 1
    const wp = (tt: number, c: number, y: number): V3 => p(tt, side * c, y)
    const wall = hb.wall
    facing(wall, [wp(t - dw, q, y0 - 0.1), wp(t + dw, q, y0 - 0.1), wp(t + dw, q, yE), wp(t - dw, q, yE)], toward, [[0, 0], [2 * dw, 0], [2 * dw, dh + 0.1], [0, dh + 0.1]], inp.wall)
    facing(wall, [wp(t - dw, q, yE), wp(t + dw, q, yE), wp(t, q, yR)], toward, [[0, 0], [2 * dw, 0], [dw, yR - yE]], inp.wall)
    for (const e of [-1, 1]) {
      const away: V3 = [(alongV[0] / al) * e, 0, (alongV[2] / al) * e]
      facing(wall, [wp(t + e * dw, q, y0 - 0.1), wp(t + e * dw, q, yE), wp(t + e * dw, c1, yE)], away, [[0, 0], [0, dh], [q - c1, dh]], inp.wall)
    }
    const ov = 0.22
    const yEo = yE - yRise * ov
    const c1o = (ridgeY - yEo) / s
    for (const e of [-1, 1]) {
      const pts: V3[] = [wp(t + e * (dw + ov), q + ov, yEo), wp(t + e * (dw + ov), c1o, yEo), wp(t, cm, yR), wp(t, q + ov, yR)]
      slope(hb.shingle, under, pts, [(alongV[0] / al) * e * 0.6 + ox * 0.2, 1.4, (alongV[2] / al) * e * 0.6 + oz * 0.2], tone)
    }
    const win = wp(t, q, y0 + 0.14)
    laid(kit, hb, 'window-house', place(win[0], win[1], win[2], 1.1, (dh - 0.3) / 1.4, 1, Math.atan2(ox, oz)), { trim: TRIMS[0] }, rand(b.s, 12 + d) < 0.3)
  }
}
