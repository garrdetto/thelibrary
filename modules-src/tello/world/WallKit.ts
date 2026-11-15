/**
 * Wall helpers shared by the business and commercial builders: a wall (one footprint edge with where along it a door
 * is), quads and boxes laid on it, the glass store front, the entry canopy and wall lights. Town frame (x east, z south).
 */
import { hexRGB, type RGB } from '../../foxlake/fp/core/Geo'
import type { BuildingData } from '../data/MapData'
import { edgesOf, facing, type Edge } from './Buildings'
import { place } from './Kit'
import type { PlaceLayer } from './PlaceLayer'

export const ALUM = hexRGB(0x4a4d52)
export const CANOPY_WHITE = hexRGB(0xe9e7e1)
export const CANOPY_BAND = hexRGB(0x4a4d52)

export interface Wall { e: Edge; t: number; floor: number }

export const toTown = (x: number, z: number): [number, number] => [x, -z]

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

export function wallQuad(b: ReturnType<PlaceLayer['builder']>, w: Wall, t0: number, t1: number, y0: number, y1: number, out: number, color?: RGB): void {
  const e = w.e
  const p0 = at(w, t0, out)
  const p1 = at(w, t1, out)
  facing(b, [[p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]]], [e.nx, 0, e.nz], [[0, 0], [t1 - t0, 0], [t1 - t0, y1 - y0], [0, y1 - y0]], color)
}

export function wallBox(layer: PlaceLayer, w: Wall, t0: number, t1: number, y0: number, y1: number, out0: number, out1: number, color: RGB): void {
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
export function storeFront(layer: PlaceLayer, w: Wall, from: number, to: number, doorWidth: number, band: RGB): void {
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
