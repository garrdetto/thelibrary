/**
 * The World Editor's own street furniture (`doc.extras`, left by `applyWorldEdits`): walls and fences along each line it
 * drew and street and lot lights at each pole it placed. `railRuns` is the guardrail list Montello puts up (the
 * automatic runs with the editor's cuts taken out, plus the rails it adds), and `lightCut` tells the lamp builders which
 * of their own lamps a light cut took down.
 *
 * Built in Tello's town frame (map x, height, -map z) under the mirrored town root. A map-frame heading turns a box the
 * right way in the town frame as it is: Babylon's and Rapier's turn about +y sends +x to (cos, -sin), which is the
 * map's (cos, sin) with z flipped. Everything goes into a few merged builders per 256 m cell.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import { Matrix } from '@babylonjs/core/Maths/math.vector'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { ChunkedBuilders, hexRGB, scaleRGB, type BoxOpts, type RGB } from '../../foxlake/fp/core/Geo'
import type { Mats } from '../../foxlake/fp/core/Tex'
import { guardrailRuns, type RailRun } from '../data/RoadFixes'
import { cutRails, inShape } from '../edits/Apply'
import type { WallStyle, WorldExtras } from '../edits/WorldEdits'
import type { TelloLand } from '../region'
import type { StaticSink } from './Sink'

type Wall = WorldExtras['walls'][number]
type Light = WorldExtras['lights'][number]

export interface EditedBuilt { walls: number; pieces: number; pillars: number; lights: number }

/** Wall pieces are about this long, so the top steps with the ground. */
const PIECE = 2
/** A bend sharper than this (radians) gets a pillar. */
const CORNER = 0.26
/** How far under the ground a wall's foot goes, so no gap shows on a slope. */
const FOOT = 0.35
/** Iron bars and fence boards are this far apart (centre to centre). */
const BAR_PITCH = 0.125
const BOARD_PITCH = 0.14
/** Stone courses are about this tall, the stones about this long. */
const COURSE = 0.42
const STONE = 0.62

interface WallLook { body: number; cap: number; pier: number; spread: number }

const LOOK: Record<WallStyle, WallLook> = {
  brick: { body: 0x8e3d2b, cap: 0xd8cebf, pier: 0x80352a, spread: 0.07 },
  stone: { body: 0x857a6a, cap: 0x9a9286, pier: 0x7a6f60, spread: 0.18 },
  block: { body: 0xbab8b1, cap: 0xd0cec7, pier: 0xb0aea7, spread: 0.035 },
  wood: { body: 0x7b5737, cap: 0x6b4b2f, pier: 0x5f432a, spread: 0.1 },
  iron: { body: 0x1a1b1e, cap: 0xd8cebf, pier: 0x8e3d2b, spread: 0.07 },
}

const BLACK = hexRGB(0x1c1e22)
const GALVANISED = hexRGB(0x9a9fa1)
const BRONZE = hexRGB(0x4b4f54)
const CONCRETE = hexRGB(0xa9a7a0)

interface Ctx {
  chunks: ChunkedBuilders
  matte: Material
  metal: Material
  globe: Material
  lens: Material
  sink: StaticSink
  land: TelloLand
  out: EditedBuilt
}

/** True when one of the World Editor's light cuts covers a map point: the street lamp or lot light there is not put up. */
export function lightCut(land: TelloLand, x: number, z: number): boolean {
  const cuts = land.doc.extras?.lightCuts
  return !!cuts?.length && cuts.some((shape) => inShape(shape, x, z))
}

/** The guardrails to put up: the automatic runs (`guardrailRuns`) less the World Editor's cuts, plus the rails it adds (`road` -1). */
export function railRuns(land: TelloLand): RailRun[] {
  const auto = guardrailRuns(land.doc, land)
  const extras = land.doc.extras
  if (!extras || (!extras.railCuts.length && !extras.rails.length)) return auto
  const out: RailRun[] = []
  for (const run of auto) {
    let pieces: WorldExtras['rails'] = [{ side: run.side, pts: run.pts }]
    for (const cut of extras.railCuts) pieces = cutRails(pieces, cut)
    for (const piece of pieces) out.push({ road: run.road, side: piece.side, pts: piece.pts })
  }
  for (const rail of extras.rails) if (rail.pts.length >= 4) out.push({ road: -1, side: rail.side, pts: rail.pts })
  return out
}

/** Walls, fences and lights from the World Editor's edits, solid where they stand. */
export function buildEditedFeatures(root: TransformNode, mats: Mats, sink: StaticSink, land: TelloLand): EditedBuilt {
  const out: EditedBuilt = { walls: 0, pieces: 0, pillars: 0, lights: 0 }
  const extras = land.doc.extras
  if (!extras || (!extras.walls.length && !extras.lights.length)) return out
  const c: Ctx = {
    chunks: new ChunkedBuilders(256),
    matte: mats.plain('tello-edit-matte', { vcolor: true, gloss: 0.12 }),
    metal: mats.plain('tello-edit-metal', { vcolor: true, gloss: 0.4, metal: 0.5 }),
    globe: mats.glow('tello-lamp-globe', 0xffd9a0, 7),
    lens: mats.glow('tello-edit-lens', 0xfff1dc, 9),
    sink,
    land,
    out,
  }
  extras.walls.forEach((wall, w) => buildWall(c, wall, w))
  for (const light of extras.lights) buildLight(c, light)
  c.chunks.flush(root, 'tello-edited')
  return out
}

// ---------------------------------------------------------------- helpers

function rand(a: number, b: number): number {
  const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return h - Math.floor(h)
}

function shade(hex: number, spread: number, a: number, b: number): RGB {
  return scaleRGB(hexRGB(hex), 1 + (rand(a, b) - 0.5) * 2 * spread)
}

/** A box at map (x, z) turned to the map heading `yaw`, into the vertex-coloured builder of its cell. */
function box(c: Ctx, mat: Material, x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw: number, color: RGB, opts: BoxOpts = {}): void {
  c.chunks.get(x, -z, mat, { colors: true }).orientedBox(x, y, -z, hx, hy, hz, yaw, { ...opts, color })
}

/** A glowing lamp lens (no shadow). */
function lensBox(c: Ctx, x: number, y: number, z: number, hx: number, hz: number, yaw: number): void {
  c.chunks.get(x, -z, c.lens, { cast: false }).orientedBox(x, y, -z, hx, 0.012, hz, yaw)
}

/** A solid box from `y0` to `y1` at map (x, z). */
function solid(c: Ctx, x: number, y0: number, y1: number, z: number, hx: number, hz: number, yaw: number): void {
  c.sink.addStaticBox({ cx: x, cy: (y0 + y1) / 2, cz: -z, hx, hy: Math.max(0.05, (y1 - y0) / 2), hz, rotY: yaw })
}

// ---------------------------------------------------------------- walls

interface Leg { ax: number; az: number; len: number; ux: number; uz: number; s0: number }

function legsOf(p: number[]): Leg[] {
  const out: Leg[] = []
  let s = 0
  for (let k = 0; k + 3 < p.length; k += 2) {
    const dx = p[k + 2] - p[k], dz = p[k + 3] - p[k + 1]
    const len = Math.hypot(dx, dz)
    if (len < 0.05) continue
    out.push({ ax: p[k], az: p[k + 1], len, ux: dx / len, uz: dz / len, s0: s })
    s += len
  }
  return out
}

function turn(a: Leg, b: Leg): number {
  return Math.acos(Math.max(-1, Math.min(1, a.ux * b.ux + a.uz * b.uz)))
}

/** The wall's line as points, joined back to the start when it is closed. */
function lineOf(wall: Wall): number[] {
  const p = [...wall.pts]
  if (wall.closed && p.length >= 6 && Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]) > 0.05) p.push(p[0], p[1])
  return p
}

interface Spot { x: number; z: number; yaw: number }

/**
 * One wall: pillars at both ends of an open wall and at every bend, then evenly between them when `posts` is set; the
 * wall itself in pieces about two metres long, the end pieces of each leg pushed out to close the corner; and for wood
 * and iron a post at every joint between the pillars.
 */
function buildWall(c: Ctx, wall: Wall, w: number): void {
  const legs = legsOf(lineOf(wall))
  if (!legs.length) return
  const closed = wall.closed && legs.length >= 3
  const n = legs.length
  const total = legs[n - 1].s0 + legs[n - 1].len
  const look = LOOK[wall.style] ?? LOOK.brick
  const th = Math.max(0.05, wall.th) / 2
  const h = Math.max(0.2, wall.h)
  const turnIn = legs.map((leg, i) => (i > 0 ? turn(legs[i - 1], leg) : closed ? turn(legs[n - 1], leg) : 0))
  const turnOut = legs.map((leg, i) => (i < n - 1 ? turn(leg, legs[i + 1]) : closed ? turn(leg, legs[0]) : 0))
  const corners: number[] = []
  legs.forEach((leg, i) => {
    if ((i === 0 && !closed) || turnIn[i] > CORNER) corners.push(leg.s0)
  })
  if (!corners.length) corners.push(0)
  const stops: number[] = []
  const span = (a: number, b: number) => {
    stops.push(a)
    if (wall.posts <= 0) return
    const k = Math.max(1, Math.round((b - a) / wall.posts))
    for (let i = 1; i < k; i++) stops.push(a + ((b - a) * i) / k)
  }
  if (closed) corners.forEach((s, i) => span(s, i + 1 < corners.length ? corners[i + 1] : corners[0] + total))
  else {
    corners.push(total)
    for (let i = 0; i + 1 < corners.length; i++) span(corners[i], corners[i + 1])
    stops.push(total)
  }
  const at = (s: number): Spot => {
    const t = closed ? ((s % total) + total) % total : Math.max(0, Math.min(total, s))
    let i = 0
    while (i + 1 < n && legs[i + 1].s0 <= t + 1e-6) i++
    const leg = legs[i]
    const d = Math.min(leg.len, t - leg.s0)
    let ux = leg.ux, uz = leg.uz
    const prev = i > 0 ? legs[i - 1] : closed ? legs[n - 1] : null
    if (d < 1e-4 && prev && Math.hypot(prev.ux + ux, prev.uz + uz) > 0.1) {
      ux += prev.ux
      uz += prev.uz
    }
    return { x: leg.ax + leg.ux * d, z: leg.az + leg.uz * d, yaw: Math.atan2(uz, ux) }
  }
  const pillars = stops.map(at)
  for (const [k, p] of pillars.entries()) pillar(c, wall, look, p, h, th, w * 977 + k)
  const joints: Spot[] = []
  legs.forEach((leg, i) => {
    const m = Math.max(1, Math.ceil(leg.len / PIECE - 0.01))
    const step = leg.len / m
    const yaw = Math.atan2(leg.uz, leg.ux)
    const extIn = Math.min(th, th * Math.tan(turnIn[i] / 2))
    const extOut = Math.min(th, th * Math.tan(turnOut[i] / 2))
    for (let j = 0; j < m; j++) {
      const s0 = j * step - (j === 0 ? extIn : 0)
      const s1 = (j + 1) * step + (j === m - 1 ? extOut : 0)
      piece(c, wall, look, leg, s0, s1, yaw, h, th, w * 7919 + i * 131 + j)
      joints.push({ x: leg.ax + leg.ux * j * step, z: leg.az + leg.uz * j * step, yaw })
    }
  })
  if (wall.style === 'wood' || wall.style === 'iron') {
    for (const p of joints) if (!pillars.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.5)) jointPost(c, wall, look, p, h, th)
  }
  c.out.walls++
}

function pillar(c: Ctx, wall: Wall, look: WallLook, p: Spot, h: number, th: number, seed: number): void {
  const g = c.land.heightAt(p.x, p.z)
  const wood = wall.style === 'wood'
  const half = wall.style === 'iron' ? Math.max(0.2, th + 0.1) : wood ? Math.max(0.055, th + 0.02) : th + 0.09
  const top = g + h + (wood ? 0.06 : 0.16)
  box(c, c.matte, p.x, (g - FOOT + top) / 2, p.z, half, (top - g + FOOT) / 2, half, p.yaw, shade(look.pier, look.spread * 0.5, seed, 3))
  if (wall.cap && !wood) box(c, c.matte, p.x, top + 0.04, p.z, half + 0.04, 0.04, half + 0.04, p.yaw, hexRGB(look.cap))
  solid(c, p.x, g - FOOT, top, p.z, half, half, p.yaw)
  c.out.pillars++
}

/** A fence post behind the boards (wood) or a thin iron post between the bars. */
function jointPost(c: Ctx, wall: Wall, look: WallLook, p: Spot, h: number, th: number): void {
  const g = c.land.heightAt(p.x, p.z)
  if (wall.style === 'iron') {
    box(c, c.metal, p.x, (g - FOOT + g + h + 0.03) / 2, p.z, 0.025, (h + 0.03 + FOOT) / 2, 0.025, p.yaw, BLACK)
    return
  }
  const back = Math.min(th, 0.012) + 0.045
  const nx = -Math.sin(p.yaw), nz = Math.cos(p.yaw)
  box(c, c.matte, p.x - nx * back, (g - FOOT + g + h) / 2, p.z - nz * back, 0.045, (h + FOOT) / 2, 0.045, p.yaw, hexRGB(look.pier))
}

/** One stretch of wall from `s0` to `s1` along a leg, its top `h` over the ground at its middle. */
function piece(c: Ctx, wall: Wall, look: WallLook, leg: Leg, s0: number, s1: number, yaw: number, h: number, th: number, seed: number): void {
  const land = c.land
  const { ux, uz } = leg
  const ax = leg.ax + ux * s0, az = leg.az + uz * s0
  const bx = leg.ax + ux * s1, bz = leg.az + uz * s1
  const len = s1 - s0
  if (len < 0.02) return
  const cx = (ax + bx) / 2, cz = (az + bz) / 2
  const low = Math.min(land.heightAt(ax, az), land.heightAt(bx, bz), land.heightAt(cx, cz))
  const g = land.heightAt(cx, cz)
  const foot = low - FOOT
  const top = g + h
  const half = len / 2
  switch (wall.style) {
    case 'stone':
      stones(c, look, cx, cz, ux, uz, yaw, half, th, foot, top, wall.cap, seed)
      break
    case 'wood':
      boards(c, look, cx, cz, ux, uz, yaw, half, th, low - 0.05, top, wall.cap, seed)
      break
    case 'iron':
      bars(c, cx, cz, ux, uz, yaw, half, low - 0.05, g, top)
      break
    default:
      box(c, c.matte, cx, (foot + top) / 2, cz, half, (top - foot) / 2, th, yaw, shade(look.body, look.spread, seed, 1))
      if (wall.cap) box(c, c.matte, cx, top + 0.04, cz, half + 0.02, 0.04, th + 0.035, yaw, hexRGB(look.cap))
  }
  solid(c, cx, foot, top + (wall.cap ? 0.08 : 0), cz, half, Math.max(th, 0.06), yaw)
  c.out.pieces++
}

/** Fieldstone: staggered courses of stones, each its own shade and a little proud of or behind its neighbours. */
function stones(c: Ctx, look: WallLook, cx: number, cz: number, ux: number, uz: number, yaw: number, half: number, th: number, foot: number, top: number, cap: boolean, seed: number): void {
  const len = half * 2
  const courses = Math.max(1, Math.round((top - foot) / COURSE))
  const ch = (top - foot) / courses
  const n = Math.max(1, Math.round(len / STONE))
  for (let r = 0; r < courses; r++) {
    const y0 = foot + r * ch
    const edges = [-half]
    for (let i = 1; i < n + (r % 2); i++) {
      const t = (i - (r % 2) * 0.5) / n + (rand(seed * 13 + r, i) - 0.5) * (0.3 / n)
      if (t > 0.04 && t < 0.96) edges.push(-half + t * len)
    }
    edges.push(half)
    for (let i = 0; i + 1 < edges.length; i++) {
      const u0 = edges[i], u1 = edges[i + 1], um = (u0 + u1) / 2
      const depth = th + (rand(seed * 31 + r, i) - 0.5) * 0.03
      box(c, c.matte, cx + ux * um, y0 + ch / 2, cz + uz * um, (u1 - u0) / 2, ch / 2, depth, yaw, shade(look.body, look.spread, seed + r * 17, i))
    }
  }
  if (cap) box(c, c.matte, cx, top + 0.05, cz, half + 0.03, 0.05, th + 0.05, yaw, shade(look.cap, 0.06, seed, 9))
}

/** A board privacy fence: boards side by side, two rails behind them and a cap board when asked. */
function boards(c: Ctx, look: WallLook, cx: number, cz: number, ux: number, uz: number, yaw: number, half: number, th: number, y0: number, top: number, cap: boolean, seed: number): void {
  const thick = Math.min(th, 0.012)
  const n = Math.max(1, Math.round((half * 2) / BOARD_PITCH))
  const pitch = (half * 2) / n
  for (let i = 0; i < n; i++) {
    const u = -half + pitch * (i + 0.5)
    box(c, c.matte, cx + ux * u, (y0 + top) / 2, cz + uz * u, pitch / 2, (top - y0) / 2, thick, yaw, shade(look.body, look.spread, seed, i))
  }
  const nx = -uz, nz = ux
  const back = thick + 0.02
  for (const y of [y0 + 0.35, top - 0.3]) box(c, c.matte, cx - nx * back, y, cz - nz * back, half, 0.045, 0.02, yaw, hexRGB(look.pier))
  if (cap) box(c, c.matte, cx, top + 0.015, cz, half + 0.01, 0.015, thick + 0.05, yaw, hexRGB(look.cap))
}

/** Black iron fencing: bars standing a hand apart between a low and a top rail, the bars' tips just over the top rail. */
function bars(c: Ctx, cx: number, cz: number, ux: number, uz: number, yaw: number, half: number, y0: number, g: number, top: number): void {
  const n = Math.max(1, Math.round((half * 2) / BAR_PITCH))
  const pitch = (half * 2) / n
  for (let i = 0; i < n; i++) {
    const u = -half + pitch * (i + 0.5)
    box(c, c.metal, cx + ux * u, (y0 + top) / 2, cz + uz * u, 0.009, (top - y0) / 2, 0.009, yaw, BLACK, { skipBottom: true })
  }
  for (const y of [g + 0.12, top - 0.1]) box(c, c.metal, cx, y, cz, half, 0.018, 0.016, yaw, BLACK)
}

// ---------------------------------------------------------------- lights

function buildLight(c: Ctx, light: Light): void {
  const { land } = c
  const x = light.x, z = light.z
  if (!land.inside(x, z)) return
  const g = land.heightAt(x, z)
  const h = Math.max(2, light.h)
  const yaw = light.yaw
  const ux = Math.cos(yaw), uz = Math.sin(yaw)
  switch (light.style) {
    case 'acorn':
      acorn(c, x, z, g, h)
      break
    case 'cobra': {
      const pole = c.chunks.get(x, -z, c.metal, { colors: true })
      pole.cylinder(x, g - 0.1, -z, 0.2, 0.18, 0.6, 10, true, GALVANISED)
      pole.cylinder(x, g + 0.5, -z, 0.12, 0.075, h - 0.5, 10, true, GALVANISED)
      const arm = Math.max(1.2, Math.min(3, h * 0.28))
      const y = g + h - 0.12
      box(c, c.metal, x + ux * (arm / 2), y, z + uz * (arm / 2), arm / 2, 0.04, 0.04, yaw, GALVANISED)
      const hx = x + ux * (arm + 0.32), hz = z + uz * (arm + 0.32)
      box(c, c.metal, hx, y, hz, 0.36, 0.08, 0.15, yaw, GALVANISED)
      box(c, c.metal, hx + ux * 0.4, y - 0.01, hz + uz * 0.4, 0.1, 0.06, 0.11, yaw, GALVANISED)
      lensBox(c, hx + ux * 0.04, y - 0.09, hz + uz * 0.04, 0.27, 0.11, yaw)
      break
    }
    case 'lot':
    case 'double': {
      box(c, c.matte, x, g + 0.15, z, 0.3, 0.45, 0.3, yaw, CONCRETE)
      box(c, c.metal, x, g + 0.6 + (h - 0.6) / 2, z, 0.08, (h - 0.6) / 2, 0.08, yaw, BRONZE)
      for (const side of light.style === 'double' ? [1, -1] : [1]) {
        const sx = ux * side, sz = uz * side
        box(c, c.metal, x + sx * 0.25, g + h - 0.06, z + sz * 0.25, 0.25, 0.03, 0.03, yaw, BRONZE)
        const hx = x + sx * 0.82, hz = z + sz * 0.82
        box(c, c.metal, hx, g + h - 0.02, hz, 0.36, 0.08, 0.24, yaw, BRONZE)
        lensBox(c, hx, g + h - 0.11, hz, 0.31, 0.19, yaw)
      }
      box(c, c.metal, x, g + h + 0.03, z, 0.1, 0.03, 0.1, yaw, BRONZE)
      break
    }
  }
  c.sink.addStaticCylinder(x, g + h / 2, -z, h / 2, 0.16)
  c.out.lights++
}

/** The downtown acorn lamp without its banner and basket: a fluted black base, a slim post and a glowing globe. */
function acorn(c: Ctx, x: number, z: number, g: number, h: number): void {
  const iron = c.chunks.get(x, -z, c.metal, { colors: true })
  iron.cylinder(x, g - 0.05, -z, 0.2, 0.16, 0.6, 10, true, BLACK)
  iron.cylinder(x, g + 0.55, -z, 0.09, 0.07, h - 0.55, 8, true, BLACK)
  iron.cylinder(x, g + h, -z, 0.12, 0.08, 0.12, 8, true, BLACK)
  iron.cylinder(x, g + h + 0.8, -z, 0.09, 0.01, 0.22, 8, true, BLACK)
  const globe = c.chunks.get(x, -z, c.globe, { cast: false })
  globe.transform(Matrix.Translation(x, g + h + 0.12, -z))
  globe.lathe([[0.05, 0], [0.2, 0.12], [0.26, 0.32], [0.24, 0.5], [0.14, 0.64], [0.02, 0.7]], 14)
  globe.transform(null)
}
