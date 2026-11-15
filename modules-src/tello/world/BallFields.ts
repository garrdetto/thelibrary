/**
 * Montello's ball fields, courts and track, from the pitch records the bake read off the aerial photo: the school's
 * baseball diamond and the two softball diamonds at the Lake Montello park (`FieldPlan.ts` fits the diamond to the
 * record). Each diamond gets its dirt skin and base paths with the grass diamond inside them, a dirt circle at home
 * and round every base, mown outfield stripes, a warning track along the fence, chalked foul lines and batter's boxes,
 * a raised mound with the pitcher's plate, the bases and home plate, a backstop with wings behind the plate, dugouts
 * and bleachers down the lines, and a chain-link fence along the foul lines and round the outfield (Blender
 * `fields-kit.glb`). Tennis and basketball courts get a coloured surface, lines and a tall fence; the school's running
 * track an oval of red surface in lanes.
 */
import { hexRGB } from '../../foxlake/fp/core/Geo'
import type { TelloLand } from '../region'
import type { Decals } from './Decals'
import { alongYaw, bearingFromHome, dir, faceYaw, insideDiamond, planField, type FieldPlan, type PitchRecord, type Pt } from './FieldPlan'
import { place } from './Kit'
import type { PlaceLayer } from './PlaceLayer'
import type { StaticSink } from './Sink'

export interface FieldsBuilt { diamonds: number; courts: number; tracks: number; fencePanels: number }

const FENCE_TOP = hexRGB(0xd9a21b)
const GALV = hexRGB(0x8a8f93)
const DIRT = hexRGB(0xa88a62)
const ALUMINIUM = hexRGB(0xa7adb1)
const DUGOUT_ROOF = hexRGB(0x5d6165)
const BLOCK = hexRGB(0xc9c4b8)
const BENCH = hexRGB(0x7a5b3c)
const PANEL = 3

export function buildBallFields(decals: Decals, layer: PlaceLayer, sink: StaticSink, land: TelloLand): FieldsBuilt {
  const out: FieldsBuilt = { diamonds: 0, courts: 0, tracks: 0, fencePanels: 0 }
  for (const pitch of (land.doc.pitches ?? []) as PitchRecord[]) {
    const plan = planField(pitch)
    if (plan) {
      diamond(decals, layer, sink, land, plan, out)
      out.diamonds++
    } else if (pitch.s === 'tennis' || pitch.s === 'basketball') {
      court(decals, layer, sink, land, pitch, out)
      out.courts++
    } else if (pitch.s === 'athletics') {
      track(decals, pitch)
      out.tracks++
    }
  }
  return out
}

const town = (p: Pt): [number, number] => [p[0], -p[1]]

function fencePanel(layer: PlaceLayer, sink: StaticSink, land: TelloLand, a: Pt, b: Pt, out: FieldsBuilt, tall: number): void {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz)
  if (len < 0.3) return
  const [tx, tz] = town(a)
  const y = land.heightAt(a[0], a[1])
  const yaw = alongYaw(dx / len, dz / len)
  layer.lay('fence-panel', tx, tz, place(tx, y, tz, len / PANEL, tall, 1, yaw), { trim: FENCE_TOP, metal: GALV })
  const mx = (a[0] + b[0]) / 2
  const mz = (a[1] + b[1]) / 2
  sink.addStaticBox({ cx: mx, cy: land.heightAt(mx, mz) + 0.6 * tall, cz: -mz, hx: len / 2, hy: 0.6 * tall, hz: 0.06, rotY: yaw })
  out.fencePanels++
}

function fenceLine(layer: PlaceLayer, sink: StaticSink, land: TelloLand, pts: Pt[], out: FieldsBuilt, tall = 1): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / PANEL))
    for (let k = 0; k < n; k++) {
      const p0: Pt = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]
      const p1: Pt = [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n]
      fencePanel(layer, sink, land, p0, p1, out, tall)
    }
  }
}

function diamond(decals: Decals, layer: PlaceLayer, sink: StaticSink, land: TelloLand, f: FieldPlan, out: FieldsBuilt): void {
  const { home, mound, heading, outfield } = f
  const d = dir(heading)
  const lateral: Pt = [-d[1], d[0]]
  const inset = f.softball ? 1.9 : 2.2
  const bounds = { x0: mound[0] - f.infield - 2, z0: mound[1] - f.infield - 2, x1: mound[0] + f.infield + 2, z1: mound[1] + f.infield + 2 }
  const skin = (x: number, z: number) => Math.hypot(x - mound[0], z - mound[1]) <= f.infield
  const grass = (x: number, z: number) =>
    insideDiamond(f, x, z, inset) &&
    Math.hypot(x - mound[0], z - mound[1]) > 3.2 &&
    Math.hypot(x - home[0], z - home[1]) > 4.9 &&
    ![f.first, f.second, f.third].some((b) => Math.hypot(x - b[0], z - b[1]) < 2.2)
  const homeDirt = (x: number, z: number) => Math.hypot(x - home[0], z - home[1]) <= (f.softball ? 4.2 : 4.9)
  decals.fill('dirt', bounds, 0.8, (x, z) => (skin(x, z) && !grass(x, z)) || homeDirt(x, z), 0.06)
  const sector = (x: number, z: number) => Math.abs(bearingFromHome(f, x, z)) <= Math.PI / 4 - 0.04
  const bandWidth = f.softball ? 3 : 4
  const right: Pt = [Math.cos(heading), -Math.sin(heading)]
  const reach = { x0: home[0] - outfield, z0: home[1] - outfield, x1: home[0] + outfield, z1: home[1] + outfield }
  decals.fill(
    'mow',
    reach,
    2,
    (x, z) => {
      const dist = Math.hypot(x - home[0], z - home[1])
      if (dist < f.baseline * 1.6 || dist > outfield - 5 || !sector(x, z)) return false
      return Math.floor(((x - home[0]) * right[0] + (z - home[1]) * right[1]) / bandWidth) % 2 === 0
    },
    0.05,
  )
  if (!f.softball) {
    decals.fill(
      'track',
      reach,
      1.5,
      (x, z) => {
        const dist = Math.hypot(x - home[0], z - home[1])
        return dist > outfield - 4.6 && dist <= outfield - 0.2 && Math.abs(bearingFromHome(f, x, z)) <= Math.PI / 4 + 0.015
      },
      0.06,
    )
  }
  for (const sign of [-1, 1]) {
    const dirn = dir(heading + (sign * Math.PI) / 4)
    decals.line('chalk', home[0], home[1], home[0] + dirn[0] * outfield, home[1] + dirn[1] * outfield, 0.12, 0.1, 3)
  }
  for (const sign of [-1, 1]) {
    const cx = home[0] + lateral[0] * sign * 1.1
    const cz = home[1] + lateral[1] * sign * 1.1
    const corner = (a: number, b: number): Pt => [cx + lateral[0] * a + d[0] * b, cz + lateral[1] * a + d[1] * b]
    const box = [corner(-0.6, -0.9), corner(0.6, -0.9), corner(0.6, 0.9), corner(-0.6, 0.9)]
    for (let i = 0; i < 4; i++) decals.line('chalk', box[i][0], box[i][1], box[(i + 1) % 4][0], box[(i + 1) % 4][1], 0.08, 0.1, 3)
  }
  const [mx, mz] = town(mound)
  const my = land.heightAt(mound[0], mound[1])
  layer.builder(mx, mz, layer.M.dirt, false).cylinder(mx, my - 0.04, mz, f.softball ? 2.4 : 2.75, f.softball ? 1.5 : 1.9, 0.3, 14, true, DIRT)
  layer.lay('rubber', mx, mz, place(mx, my + 0.27, mz, 1, 1, 1, faceYaw(d[0], d[1])), { trim: hexRGB(0xf2f0ea) })
  for (const base of [f.first, f.second, f.third]) {
    const [bx, bz] = town(base)
    layer.lay('base', bx, bz, place(bx, land.heightAt(base[0], base[1]) + 0.04, bz, 1, 1, 1, -(heading + Math.PI / 4)), {})
  }
  const [hx, hz] = town(home)
  layer.lay('plate', hx, hz, place(hx, land.heightAt(home[0], home[1]) + 0.05, hz, 1, 1, 1, faceYaw(d[0], d[1])), {})
  const [bsx, bsz] = town(f.backstop)
  const bsy = land.heightAt(f.backstop[0], f.backstop[1])
  layer.lay('backstop', bsx, bsz, place(bsx, bsy, bsz, 1, 1, 1, faceYaw(d[0], d[1])), { metal: GALV })
  const wing = 3.65
  sink.addStaticBox({ cx: bsx, cy: bsy + 3, cz: bsz, hx: wing, hy: 3, hz: 0.08, rotY: alongYaw(lateral[0], lateral[1]) })
  for (const sign of [-1, 1]) {
    const c: Pt = [f.backstop[0] + lateral[0] * sign * wing, f.backstop[1] + lateral[1] * sign * wing]
    const tip: Pt = [c[0] + d[0] * 2.75 + lateral[0] * sign * 2.75, c[1] + d[1] * 2.75 + lateral[1] * sign * 2.75]
    sink.addStaticBox({ cx: (c[0] + tip[0]) / 2, cy: bsy + 3, cz: -(c[1] + tip[1]) / 2, hx: Math.hypot(tip[0] - c[0], tip[1] - c[1]) / 2, hy: 3, hz: 0.08, rotY: alongYaw(tip[0] - c[0], tip[1] - c[1]) })
  }
  const scale = f.softball ? 0.75 : 1
  for (const dug of [f.firstDugout, f.thirdDugout]) {
    const [dx, dz] = town(dug.at)
    const y = land.heightAt(dug.at[0], dug.at[1])
    layer.lay('dugout', dx, dz, place(dx, y, dz, scale, 1, 1, faceYaw(dug.face[0], dug.face[1])), { stone: BLOCK, metal: DUGOUT_ROOF, wood: BENCH })
    sink.addStaticBox({ cx: dx - dug.face[0] * 1.3, cy: y + 1.1, cz: dz + dug.face[1] * 1.3, hx: 4.5 * scale, hy: 1.1, hz: 1.3, rotY: alongYaw(-dug.face[1], dug.face[0]) })
  }
  for (const [at, face] of [[f.firstBleacher, f.firstDugout.face], [f.thirdBleacher, f.thirdDugout.face]] as [Pt, Pt][]) {
    const [bx, bz] = town(at)
    const y = land.heightAt(at[0], at[1])
    layer.lay('bleacher', bx, bz, place(bx, y, bz, 1, 1, 1, faceYaw(face[0], face[1])), { metal: ALUMINIUM })
    sink.addStaticBox({ cx: bx - face[0] * 1.6, cy: y + 1, cz: bz + face[1] * 1.6, hx: 2.3, hy: 1, hz: 1.6, rotY: alongYaw(-face[1], face[0]) })
  }
  const arc: Pt[] = []
  const steps = Math.max(8, Math.round((outfield * Math.PI) / 2 / PANEL))
  for (let i = 0; i <= steps; i++) {
    const a = heading - Math.PI / 4 + (Math.PI / 2) * (i / steps)
    arc.push([home[0] + Math.sin(a) * outfield, home[1] + Math.cos(a) * outfield])
  }
  fenceLine(layer, sink, land, arc, out)
  for (const sign of [-1, 1]) {
    const dirn = dir(heading + (sign * Math.PI) / 4)
    const side: Pt = sign > 0 ? [Math.cos(heading + Math.PI / 4), -Math.sin(heading + Math.PI / 4)] : [-Math.cos(heading - Math.PI / 4), Math.sin(heading - Math.PI / 4)]
    const a: Pt = [home[0] + dirn[0] * f.fenceFrom + side[0] * 1.2, home[1] + dirn[1] * f.fenceFrom + side[1] * 1.2]
    const b: Pt = [home[0] + dirn[0] * outfield + side[0] * 1.2, home[1] + dirn[1] * outfield + side[1] * 1.2]
    fenceLine(layer, sink, land, [a, b], out)
  }
}

function court(decals: Decals, layer: PlaceLayer, sink: StaticSink, land: TelloLand, pitch: PitchRecord, out: FieldsBuilt): void {
  const p = pitch.p
  if (p.length < 8) return
  const c: [number, number][] = [[p[0], p[1]], [p[2], p[3]], [p[4], p[5]], [p[6], p[7]]]
  decals.quad('court', c, 0.07)
  for (let i = 0; i < 4; i++) {
    const a = c[i]
    const b = c[(i + 1) % 4]
    const la = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n: Pt = [-(b[1] - a[1]) / la, (b[0] - a[0]) / la]
    const sign = ((c[0][0] + c[2][0]) / 2 - (a[0] + b[0]) / 2) * n[0] + ((c[0][1] + c[2][1]) / 2 - (a[1] + b[1]) / 2) * n[1] > 0 ? 1 : -1
    decals.line('chalk', a[0] + n[0] * sign * 0.9, a[1] + n[1] * sign * 0.9, b[0] + n[0] * sign * 0.9, b[1] + n[1] * sign * 0.9, 0.07, 0.09, 4)
  }
  decals.line('chalk', (c[0][0] + c[3][0]) / 2, (c[0][1] + c[3][1]) / 2, (c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2, 0.07, 0.09, 4)
  fenceLine(layer, sink, land, [...c, c[0]], out, 3)
}

function track(decals: Decals, pitch: PitchRecord): void {
  const p = pitch.p
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i + 1 < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1])
  }
  const w = x1 - x0
  const h = z1 - z0
  const alongZ = h >= w
  const radius = (Math.min(w, h) - 8) / 2
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const half = Math.max(0, (Math.max(w, h) - 8) / 2 - radius)
  for (let lane = 0; lane < 4; lane++) {
    const rr = radius - lane * 1.22
    const pts: [number, number][] = []
    const seg = 28
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI * (i / seg)
      pts.push(alongZ ? [cx + Math.cos(a) * rr, cz + half + Math.sin(a) * rr] : [cx + half + Math.sin(a) * rr, cz + Math.cos(a) * rr])
    }
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI + Math.PI * (i / seg)
      pts.push(alongZ ? [cx + Math.cos(a) * rr, cz - half + Math.sin(a) * rr] : [cx - half + Math.sin(a) * rr, cz + Math.cos(a) * rr])
    }
    decals.path('track', pts, 1.22, 0.06, true)
    decals.path('chalk', pts, 0.06, 0.08, true)
  }
}
