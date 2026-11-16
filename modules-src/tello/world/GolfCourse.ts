/**
 * White Lake Golf Club (and any other course the bake lays out, `doc.golf`): every hole drawn as a course is, from the
 * bake's hole records. Fairways in their mown shape with alternating stripes across the line of play, greens with a
 * collar of fringe and fine stripes of their own, the flagstick in the cup, level tee boxes with blue and white markers,
 * sand bunkers, and at each tee a lettered hole sign (number, par and yards), a ball washer and a bench; a sign at the
 * clubhouse. The rough round them is the bake's mown lawn. Parts come from the Blender fields kit (`golf-flag`,
 * `tee-marker`, `ball-washer`, `golf-bench`, `hole-sign`) and go into the merged builders, so the course adds only a few
 * draw calls. Map coordinates in (x east, z north); the town frame is (x, -z).
 */
import { hexRGB, type RGB } from '../../foxlake/fp/core/Geo'
import type { GolfCourseData, GolfHoleData } from '../data/MapData'
import type { TelloLand } from '../region'
import type { Decals, PaintKind } from './Decals'
import { alongYaw, faceYaw, type Pt } from './FieldPlan'
import { place } from './Kit'
import type { PlaceLayer } from './PlaceLayer'
import type { Signs } from './Signs'
import type { StaticSink } from './Sink'

export interface GolfBuilt { courses: number; holes: number; bunkers: number; flags: number }

/** Mowing stripes across a fairway, and the finer ones on a green (metres). */
const FAIRWAY_STRIPE = 9
const GREEN_STRIPE = 2.4
/** The fringe round each green (metres). */
const FRINGE = 1.6
const FRONT_NINE_FLAG = hexRGB(0xf2c62e)
const BACK_NINE_FLAG = hexRGB(0xc8312b)
const BLUE_TEES = hexRGB(0x2457b5)
const WHITE_TEES = hexRGB(0xf3f1ea)
const WASHER = hexRGB(0x2f6b3a)
const WOOD = hexRGB(0x7a5b3c)
const STONE = hexRGB(0xb9b4a8)
const YARD = 0.9144

const town = (p: Pt): [number, number] => [p[0], -p[1]]

export function buildGolf(decals: Decals, layer: PlaceLayer, signs: Signs, sink: StaticSink, land: TelloLand): GolfBuilt {
  const out: GolfBuilt = { courses: 0, holes: 0, bunkers: 0, flags: 0 }
  for (const course of land.doc.golf ?? []) {
    out.courses++
    for (const hole of course.holes) {
      paintHole(decals, hole)
      dressHole(layer, signs, sink, land, hole, out)
      out.holes++
    }
    for (const bunker of course.bunkers) {
      if (bunker.length < 6) continue
      decals.polygon('sand', bunker, 0.075)
      out.bunkers++
    }
    clubSign(layer, signs, sink, land, course)
  }
  return out
}

/** The fairways, fringe, green and tee box, and their mowing stripes. */
function paintHole(decals: Decals, hole: GolfHoleData): void {
  const line = hole.line
  const n = line.length / 2
  const dx = line[n * 2 - 2] - line[0], dz = line[n * 2 - 1] - line[1]
  const len = Math.hypot(dx, dz) || 1
  const along: Pt = [dx / len, dz / len]
  for (const fw of hole.fw) {
    if (fw.length < 6) continue
    decals.polygon('fairway', fw, 0.05)
    stripes(decals, fw, along, FAIRWAY_STRIPE, 0.06)
  }
  const pin: Pt = [hole.pin[0], hole.pin[1]]
  decals.polygon('fringe', grow(hole.green, pin, FRINGE), 0.065)
  decals.polygon('green', hole.green, 0.072)
  const toPin = lastLeg(hole)
  stripes(decals, hole.green, [-toPin[1], toPin[0]], GREEN_STRIPE, 0.08)
  decals.polygon('tee', hole.box, 0.072)
  stripes(decals, hole.box, [Math.sin(hole.tee[2]), Math.cos(hole.tee[2])], 2, 0.08)
}

/** The direction of the hole's last leg, into the green. */
function lastLeg(hole: GolfHoleData): Pt {
  const p = hole.line
  const n = p.length / 2
  const ax = p[(n - 2) * 2], az = p[(n - 2) * 2 + 1]
  const dx = p[(n - 1) * 2] - ax, dz = p[(n - 1) * 2 + 1] - az
  const l = Math.hypot(dx, dz) || 1
  return [dx / l, dz / l]
}

/** A ring pushed out from `c` by `by` metres (the greens are round enough for this to be the fringe). */
function grow(ring: number[], c: Pt, by: number): number[] {
  const out: number[] = []
  for (let k = 0; k < ring.length; k += 2) {
    const dx = ring[k] - c[0], dz = ring[k + 1] - c[1]
    const l = Math.hypot(dx, dz) || 1
    out.push(ring[k] + (dx / l) * by, ring[k + 1] + (dz / l) * by)
  }
  return out
}

/** Every other band `width` metres wide across direction `u`, clipped to the outline, lighter and darker. */
function stripes(decals: Decals, ring: number[], u: Pt, width: number, lift: number): void {
  let lo = Infinity, hi = -Infinity
  for (let k = 0; k < ring.length; k += 2) {
    const s = ring[k] * u[0] + ring[k + 1] * u[1]
    lo = Math.min(lo, s)
    hi = Math.max(hi, s)
  }
  const start = Math.floor(lo / width)
  for (let b = start; b * width < hi; b++) {
    const piece = clipBand(ring, u, b * width, (b + 1) * width)
    if (piece.length < 6) continue
    const kind: PaintKind = b % 2 === 0 ? 'bright' : 'dark'
    decals.polygon(kind, piece, lift)
  }
}

/** The part of an outline between two lines across `u` (Sutherland-Hodgman on the two half-planes). */
export function clipBand(ring: number[], u: Pt, a: number, b: number): number[] {
  const half = (pts: number[], keep: (s: number) => boolean, at: number): number[] => {
    const out: number[] = []
    const n = pts.length / 2
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const px = pts[i * 2], pz = pts[i * 2 + 1], qx = pts[j * 2], qz = pts[j * 2 + 1]
      const sp = px * u[0] + pz * u[1], sq = qx * u[0] + qz * u[1]
      const inP = keep(sp), inQ = keep(sq)
      if (inP) out.push(px, pz)
      if (inP !== inQ) {
        const t = (at - sp) / (sq - sp)
        out.push(px + (qx - px) * t, pz + (qz - pz) * t)
      }
    }
    return out
  }
  return half(half(ring, (s) => s >= a, a), (s) => s <= b, b)
}

/** The flag, the tee markers, the hole sign, a ball washer and a bench. */
function dressHole(layer: PlaceLayer, signs: Signs, sink: StaticSink, land: TelloLand, hole: GolfHoleData, out: GolfBuilt): void {
  const [px, pz] = town([hole.pin[0], hole.pin[1]])
  const flag = hole.n <= 9 ? FRONT_NINE_FLAG : BACK_NINE_FLAG
  if (layer.lay('golf-flag', px, pz, place(px, land.heightAt(hole.pin[0], hole.pin[1]) + 0.07, pz, 1, 1, 1, 0.6 + hole.n * 0.37), { paint: flag })) out.flags++
  const heading = hole.tee[2]
  const d: Pt = [Math.sin(heading), Math.cos(heading)]
  const right: Pt = [d[1], -d[0]]
  const centre = ringCentre(hole.box)
  const at = (fwd: number, side: number): Pt => [centre[0] + d[0] * fwd + right[0] * side, centre[1] + d[1] * fwd + right[1] * side]
  const marker = (p: Pt, color: RGB) => {
    const [mx, mz] = town(p)
    layer.lay('tee-marker', mx, mz, place(mx, land.heightAt(p[0], p[1]) + 0.07, mz), { paint: color })
  }
  for (const side of [-2.6, 2.6]) {
    marker(at(-3, side), BLUE_TEES)
    marker(at(3.5, side), WHITE_TEES)
  }
  const back = boxReach(hole.box, centre, d)
  const signAt = at(-back - 2.5, -4.5)
  const [sx, sz] = town(signAt)
  const sy = land.heightAt(signAt[0], signAt[1])
  const face: Pt = [-d[0], -d[1]]
  layer.lay('hole-sign', sx, sz, place(sx, sy, sz, 1, 1, 1, faceYaw(face[0], face[1])), { wood: WOOD })
  const yards = Math.round(hole.len / YARD)
  signs.add({ text: `HOLE ${hole.n}  ·  PAR ${hole.par}  ·  ${yards} YDS`, x: sx + face[0] * 0.06, z: sz - face[1] * 0.06, y: sy + 0.6, w: 1.1, h: 0.8, n: [face[0], -face[1]], out: 0.005 })
  sink.addStaticBox({ cx: sx, cy: sy + 0.76, cz: sz, hx: 0.66, hy: 0.76, hz: 0.08, rotY: alongYaw(right[0], right[1]) })
  const washer = at(-back - 2, 4.2)
  const [wx, wz] = town(washer)
  layer.lay('ball-washer', wx, wz, place(wx, land.heightAt(washer[0], washer[1]), wz, 1, 1, 1, faceYaw(-right[0], -right[1])), { paint: WASHER })
  const bench = at(-back - 4.5, 5.2)
  const [bx, bz] = town(bench)
  const by = land.heightAt(bench[0], bench[1])
  layer.lay('golf-bench', bx, bz, place(bx, by, bz, 1, 1, 1, faceYaw(d[0], d[1])), { wood: WOOD, stone: STONE })
  sink.addStaticBox({ cx: bx, cy: by + 0.45, cz: bz, hx: 0.9, hy: 0.45, hz: 0.3, rotY: alongYaw(right[0], right[1]) })
}

function ringCentre(ring: number[]): Pt {
  let x = 0, z = 0
  const n = ring.length / 2
  for (let k = 0; k < ring.length; k += 2) {
    x += ring[k]
    z += ring[k + 1]
  }
  return [x / n, z / n]
}

/** How far the box reaches back from its centre along the line of play. */
function boxReach(ring: number[], c: Pt, d: Pt): number {
  let reach = 0
  for (let k = 0; k < ring.length; k += 2) reach = Math.max(reach, -((ring[k] - c[0]) * d[0] + (ring[k + 1] - c[1]) * d[1]))
  return reach
}

/** The course's name on a big board by the clubhouse, facing the nearest road. */
function clubSign(layer: PlaceLayer, signs: Signs, sink: StaticSink, land: TelloLand, course: GolfCourseData): void {
  const [cx, cz] = course.c
  let best: { d: number; x: number; z: number; w: number } | null = null
  for (const r of land.doc.roads) {
    if (r.k > 1) continue
    const p = r.p
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az
      const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / (dx * dx + dz * dz || 1)))
      const x = ax + dx * t, z = az + dz * t
      const dist = Math.hypot(cx - x, cz - z)
      if (dist < 400 && (!best || dist < best.d)) best = { d: dist, x, z, w: r.w }
    }
  }
  if (!best) return
  const ux = (cx - best.x) / (best.d || 1), uz = (cz - best.z) / (best.d || 1)
  const half = best.w / 2
  const spot: Pt = [best.x + ux * (half + 6), best.z + uz * (half + 6)]
  if (land.clearAt(spot[0], spot[1]) < 1.5) return
  const [sx, sz] = town(spot)
  const sy = land.heightAt(spot[0], spot[1])
  const face: Pt = [-ux, -uz]
  layer.lay('hole-sign', sx, sz, place(sx, sy, sz, 2.6, 1.6, 1, faceYaw(face[0], face[1])), { wood: WOOD })
  signs.add({ text: course.n.toUpperCase(), x: sx + face[0] * 0.1, z: sz - face[1] * 0.1, y: sy + 0.98, w: 2.9, h: 1.3, n: [face[0], -face[1]], out: 0.005 })
  sink.addStaticBox({ cx: sx, cy: sy + 1.2, cz: sz, hx: 1.7, hy: 1.2, hz: 0.12, rotY: alongYaw(-uz, ux) })
}
