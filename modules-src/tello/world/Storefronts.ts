/**
 * Downtown Montello's storefronts: the street front of every store building
 * on West and East Montello Street gets a real commercial front over its
 * walls (data/Downtown.ts says how each looks): an upper storey of brick,
 * stucco or paint with tall windows under arched or flat hoods, a bracketed
 * or corbelled cornice, and a street storey of display windows and a door, a
 * log front or stone veneer, with awnings, painted sign boards and hanging
 * signs. One-storey buildings get a false front, as small towns do.
 *
 * Built in Tello's town frame (x east, z south) under the mirrored town root.
 * Each front is laid out in its own frame: x along the front, y up from the
 * floor, z out toward the street.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { ChunkedBuilders, hexRGB, type MeshBuilder, type RGB } from '../../foxlake/fp/core/Geo'
import type { Mats } from '../../foxlake/fp/core/Tex'
import type { BuildingData } from '../data/MapData'
import { DOWNTOWN_BOX, DOWNTOWN_STREETS, FRONT_REACH, defaultFront, knownFronts, type FrontStyle } from '../data/Downtown'
import type { TelloLand } from '../region'
import { place, type ModelKit } from './Kit'
import { SignAtlas, type SignRect } from './SignAtlas'


interface Front extends FrontPlan {
  floor: number
  sign: number
  blade: number
  marquee: number
}

/** Distance from (x, z) to a polyline (flat x, z pairs, map coordinates) and the direction of its nearest segment. */
function nearestOn(p: number[], x: number, z: number): { d: number; tx: number; tz: number } {
  let best = { d: Infinity, tx: 1, tz: 0 }
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3]
    const ex = bx - ax, ez = bz - az
    const l2 = ex * ex + ez * ez || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2))
    const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t))
    if (d < best.d) {
      const l = Math.sqrt(l2)
      best = { d, tx: ex / l, tz: ez / l }
    }
  }
  return best
}

/** The building's edge that faces one of the downtown streets, in map coordinates, with its outward normal. */
function streetEdge(b: BuildingData, streets: { n: string; p: number[] }[]): { ax: number; az: number; bx: number; bz: number; nx: number; nz: number; len: number; dist: number; street: string } | null {
  const p = b.p
  const n = p.length / 2
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]
  }
  const s = area > 0 ? 1 : -1
  let best: ReturnType<typeof streetEdge> = null
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1]
    const ex = bx - ax, ez = bz - az
    const len = Math.hypot(ex, ez)
    if (len < 3) continue
    const nx = (s * ez) / len, nz = (-s * ex) / len
    const mx = (ax + bx) / 2, mz = (az + bz) / 2
    for (const { n: name, p: line } of streets) {
      const near = nearestOn(line, mx, mz)
      if (near.d > FRONT_REACH) continue
      const along = Math.abs(near.tx * ex + near.tz * ez) / len
      if (along < 0.75) continue
      // The street must lie out in front of the wall.
      const probe = nearestOn(line, mx + nx * near.d, mz + nz * near.d)
      if (probe.d > near.d * 0.6) continue
      const score = near.d - len * 0.05
      if (!best || score < best.dist) best = { ax, az, bx, bz, nx, nz, len, dist: score, street: name }
    }
  }
  return best
}

export interface DowntownStats { fronts: number; signs: number }

export interface FrontPlan {
  b: BuildingData
  style: FrontStyle
  /** Town-frame start of the front (its left end seen from the street), unit direction along it, and length. */
  ax: number
  az: number
  dx: number
  dz: number
  len: number
  /** Top of the front above the floor. */
  height: number
  /** The street it faces. */
  street: string
  /** Which end of the front holds the corner turret, if it has one. */
  turret: 'left' | 'right' | null
}

/** Which downtown buildings get a storefront, which wall it goes on and how it looks (no geometry). */
export function planFronts(land: TelloLand): FrontPlan[] {
  const streets = land.doc.roads.filter((r) => DOWNTOWN_STREETS.includes(r.n)).map((r) => ({ n: r.n, p: r.p }))
  const cross = land.doc.roads.filter((r) => r.k <= 2)
  const out: FrontPlan[] = []
  const box = DOWNTOWN_BOX
  for (const b of land.doc.buildings) {
    if (b.k !== 'store' && b.k !== 'civic') continue
    const [cx, cz] = b.r[0]
    if (cx < box.x0 || cx > box.x1 || cz < box.z0 || cz > box.z1) continue
    const known = knownFronts(cx, cz)
    const wanted = known.length ? known.map((k) => ({ style: k.style, lines: k.street ? streets.filter((l) => l.n === k.street) : streets })) : [{ style: defaultFront(b.s, b.n), lines: streets }]
    for (const w of wanted) {
      const edge = streetEdge(b, w.lines)
      if (!edge) continue
      const style = w.style
      // Town frame: z flips. Order the ends so the front's own +z points out toward the street.
      let ax = edge.ax, az = -edge.az, bx = edge.bx, bz = -edge.bz
      const nx = edge.nx, nz = -edge.nz
      if (-(bz - az) * nx + (bx - ax) * nz < 0) [ax, az, bx, bz] = [bx, bz, ax, az]
      const len = edge.len
      const height = style.house ? Math.max(2.8, b.h) : b.h >= 6 ? Math.min(b.h + 0.5, 12) : Math.max(b.h + 0.6, 4.6)
      let turret: FrontPlan['turret'] = null
      if (style.turret === 'left' || style.turret === 'right') turret = style.turret
      else if (style.turret === 'auto') {
        // The end nearer the cross street (any other through street), in map coordinates.
        const others = cross.filter((r) => r.n !== edge.street).map((r) => r.p)
        const reach = (x: number, z: number) => Math.min(...others.map((p) => nearestOn(p, x, -z).d))
        turret = reach(ax, az) <= reach(bx, bz) ? 'left' : 'right'
      }
      out.push({ b, style, ax, az, dx: (bx - ax) / len, dz: (bz - az) / len, len, height, street: edge.street, turret })
    }
  }
  return out
}

/** The sign board's width on a front. */
function signWidth(len: number, text: string): number {
  return Math.min(len - 0.8, Math.max(3, text.length * 0.42))
}

/** The Blender detail kit while fronts are being built (null: the simpler built-in shapes). */
let KIT: ModelKit | null = null
const KIT_COLORS = { stone: hexRGB(0xd9d1c0), door: hexRGB(0x3a2e24), shingle: hexRGB(0x6c6862), metal: hexRGB(0x1c1e22) }

export function buildStorefronts(root: TransformNode, mats: Mats, land: TelloLand, kit: ModelKit | null = null): DowntownStats {
  KIT = kit
  const atlas = new SignAtlas()
  const fronts: Front[] = planFronts(land).map((p) => ({
    ...p,
    floor: p.b.f,
    sign: p.style.sign ? atlas.add({ ...p.style.sign, aspect: signWidth(p.len, p.style.sign.text) / 0.62 }) : -1,
    marquee: p.style.marquee ? atlas.add({ text: p.style.marquee, board: 0x23232a, ink: 0xfff1c4, aspect: (p.len * 0.6) / 0.5 }) : -1,
    blade: p.style.blade ? atlas.add({ ...p.style.blade, aspect: 1.25 / 0.78 }) : -1,
  }))
  atlas.pack()
  const M = {
    brick: mats.textured('h-brick', 'brick', { vcolor: true }),
    stucco: mats.textured('tello-stucco', 'stucco', { vcolor: true }),
    stone: mats.textured('tello-stone', 'stone', { vcolor: true }),
    siding: mats.textured('h-siding', 'siding', { vcolor: true }),
    boards: mats.textured('h-boards', 'boards', { vcolor: true }),
    metal: mats.textured('t-metal-wall', 'metal', { vcolor: true, tile: 2.2, metal: 0.25, gloss: 0.35 }),
    iron: mats.plain('tello-lamp-iron', { color: 0x1c1e22, gloss: 0.3 }),
    paint: mats.plain('h-paint', { vcolor: true, gloss: 0.22 }),
    logs: mats.textured('tello-logs', 'planks', { vcolor: true, tile: 1.2 }),
    shingles: mats.textured('roof-shingles', 'shingles', { vcolor: true }),
    lit: mats.plain('t-window-lit', { color: 0x38424b, gloss: 0.8, keepGloss: true, emissive: 0xffc98a, emissiveIntensity: 0 }),
    signs: atlas.count ? atlas.material(mats, 'tello-storefront-signs') : null,
  }
  const chunks = new ChunkedBuilders(128)
  for (const f of fronts) buildFront(f, chunks, M, atlas)
  KIT = null
  chunks.flush(root, 'tello-storefronts')
  return { fronts: fronts.length, signs: atlas.count }
}

function groundHeight(height: number): number {
  return Math.max(3.6, Math.min(4.6, height * 0.46))
}

type Mat = { brick: Material; stucco: Material; stone: Material; siding: Material; boards: Material; metal: Material; iron: Material; paint: Material; logs: Material; shingles: Material; lit: Material; signs: Material | null }

/** The builders for one front, all laid out in its frame. */
class FrontKit {
  private readonly used = new Set<MeshBuilder>()
  constructor(private readonly chunks: ChunkedBuilders, private readonly at: { x: number; z: number }, private readonly frame: Matrix) {}

  get(m: Material, colors = true): MeshBuilder {
    const b = this.chunks.get(this.at.x, this.at.z, m, { colors })
    if (!this.used.has(b)) {
      this.used.add(b)
      b.transform(this.frame)
    }
    return b
  }

  done(): void {
    for (const b of this.used) b.transform(null)
  }
}

/** Lays a kit part into the front (true when the kit has it); trim-slot surfaces take `trim`. */
function kitPut(kit: FrontKit, M: Mat, name: string, m: Matrix, trim: RGB): boolean {
  if (!KIT?.has(name)) return false
  KIT.put(
    name,
    m,
    (slot) => (slot === 'stone' ? kit.get(M.stone) : slot === 'metal' ? kit.get(M.iron, false) : slot === 'shingle' ? kit.get(M.shingles) : kit.get(M.paint)),
    (slot) => (slot === 'stone' ? KIT_COLORS.stone : slot === 'door' ? KIT_COLORS.door : slot === 'shingle' ? KIT_COLORS.shingle : slot === 'metal' ? KIT_COLORS.metal : trim),
  )
  return true
}

function darker(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k]
}

/** A flat rectangle facing +z in the front's frame (UVs in metres). */
function panel(b: MeshBuilder, x0: number, y0: number, x1: number, y1: number, z: number, c?: RGB): void {
  b.quad([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], c)
}

/** A sign face from the atlas, facing +z. */
function signFace(b: MeshBuilder, r: SignRect, x0: number, y0: number, x1: number, y1: number, z: number): void {
  b.quad([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [0, 0, 1], [[r.u0, r.v1], [r.u1, r.v1], [r.u1, r.v0], [r.u0, r.v0]])
}

/** A half-ring band over an arched window, facing +z, with its outer rim. */
function archBand(b: MeshBuilder, cx: number, cy: number, r0: number, r1: number, z0: number, z1: number, c: RGB, seg = 9): void {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI, a1 = ((i + 1) / seg) * Math.PI
    const p = (a: number, r: number, z: number) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]
    b.quad([p(a1, r0, z1), p(a0, r0, z1), p(a0, r1, z1), p(a1, r1, z1)], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], c)
    const am = (a0 + a1) / 2
    b.quad([p(a1, r1, z1), p(a0, r1, z1), p(a0, r1, z0), p(a1, r1, z0)], [Math.cos(am), Math.sin(am), 0], [[0, 0], [1, 0], [1, 1], [0, 1]], c)
  }
}

/** A half-disc of glass over an arched window, facing +z. */
function halfDisc(b: MeshBuilder, cx: number, cy: number, r: number, z: number, seg = 9, c0?: RGB): void {
  const col = c0 ?? b.color
  const c = b.vertex(cx, cy, z, 0, 0, 1, cx, cy, col)
  const ring: number[] = []
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r
    ring.push(b.vertex(x, y, z, 0, 0, 1, x, y, col))
  }
  for (let i = 0; i < seg; i++) b.tri(c, ring[i], ring[i + 1])
}

function buildFront(f: Front, chunks: ChunkedBuilders, M: Mat, atlas: SignAtlas): void {
  const s = f.style
  const yaw = Math.atan2(-f.dz, f.dx)
  const frame = Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Up(), yaw), new Vector3(f.ax, f.floor, f.az))
  const kit = new FrontKit(chunks, { x: f.ax + f.dx * f.len * 0.5, z: f.az + f.dz * f.len * 0.5 }, frame)
  const L = f.len
  const H = f.height
  const two = s.house ? H >= 5.2 : f.b.h >= 6
  const g = s.streetStorey ?? (s.house ? (two ? Math.min(3.0, H * 0.5) : H) : two ? groundHeight(H) : H - 0.95)
  const wall = hexRGB(s.wall)
  const trim = hexRGB(s.trim)
  const base = hexRGB(s.groundColor ?? 0x6f6d68)
  const upperMat = s.upper === 'brick' ? M.brick : s.upper === 'stucco' ? M.stucco : s.upper === 'stone' ? M.stone : s.upper === 'siding' ? M.siding : M.paint
  const trimB = kit.get(M.paint)

  // Upper wall (or the false front above a one-storey shop).
  if (H - g > 0.05) panel(kit.get(upperMat), 0, g, L, H, 0.05, wall)
  // Corner piers run the full height in the wall's own finish (corner boards on a house).
  if (s.house) {
    trimB.box(0, 0, 0, 0.16, H, 0.1, { color: trim })
    trimB.box(L - 0.16, 0, 0, L, H, 0.1, { color: trim })
  } else {
    kit.get(upperMat).box(0, 0, 0.0, 0.32, H, 0.14, { color: darker(wall, 0.93) })
    kit.get(upperMat).box(L - 0.32, 0, 0.0, L, H, 0.14, { color: darker(wall, 0.93) })
  }

  // Upper windows.
  if (two) {
    const room = H - g
    const bays = s.windows ?? (s.house ? Math.max(2, Math.round((L - 0.6) / 2.6)) : Math.max(1, Math.floor((L - 0.8) / 1.65)))
    const step = (L - 0.64) / bays
    const ww = s.windowWidth ? Math.min(s.windowWidth, step * 0.8) : Math.min(0.95, step * 0.56)
    const sill = g + Math.min(0.85, room * 0.18)
    const wh = Math.min(s.blind ? 2.2 : 2.0, room - (sill - g) - 1.25)
    const bayAt = s.bay === 'right' ? bays - 1 : s.bay ? 0 : -1
    const turretEnd = f.turret === 'left' ? 0 : f.turret === 'right' ? L : null
    for (let i = 0; i < bays; i++) {
      const cx = 0.32 + step * (i + 0.5)
      if (turretEnd !== null && Math.abs(cx - turretEnd) < 2.1) continue
      if (i === bayAt && bays > 2) {
        bayWindow(kit, M, cx, step, sill, wh, trim)
        continue
      }
      upperWindow(kit, M, cx, ww, sill, wh, s.hoods, trim, wall, s.upper, s.blind)
    }
    if (turretEnd !== null) turret(kit, M, turretEnd, g, H, s, trim, wall)
    if (s.balcony) balcony(kit, M, L * s.balcony[0], L * s.balcony[1], g, s.plinth?.height ?? 0)
  }

  // Cornice and the band under it (a plain fascia on a house), and the theatre's stepped parapet.
  if (s.house) trimB.box(-0.05, H - 0.2, 0, L + 0.05, H, 0.16, { color: trim })
  else cornice(kit, M, L, H, s, trim, wall)
  if (s.parapet === 'stepped') steppedParapet(kit, M, L, H, wall, trim)

  // Street storey.
  const piers = s.pierColor !== undefined ? hexRGB(s.pierColor) : base
  if (s.ground === 'porch') porchFront(kit, M, L, g, wall, trim)
  else if (s.plinth) terrace(kit, M, L, g, s, base, trim)
  else if (s.ground === 'logs') logFront(kit, M, L, g, base, trim)
  else if (s.ground === 'stone') stoneFront(kit, M, L, g, base, trim)
  else if (s.ground === 'boards') boardFront(kit, M, L, g, base, piers, trim)
  else shopFront(kit, M, L, g, base, trim, s.ground === 'brick' ? M.brick : null, s, two)

  // Awning, then the sign: on the awning's slope, or a board over the display windows.
  let signY = g - 0.86
  let signZ = 0.17
  if (s.awning) {
    const ac = hexRGB(s.awning.color)
    const [s0, s1] = s.awning.span ?? [0, 1]
    const ax0 = Math.max(0, L * s0), ax1 = Math.min(L, L * s1)
    if (s.awning.kind === 'panel') {
      const mt = kit.get(M.metal)
      const top = g + 1.05, low = g - 0.3, out = 0.55
      mt.face([ax0 + 0.05, low, out], [ax1 - 0.05, low, out], [ax1 - 0.05, top, 0.12], [ax0 + 0.05, top, 0.12], [[0, 0], [ax1 - ax0, 0], [ax1 - ax0, 1.4], [0, 1.4]], ac)
      mt.face([ax1 - 0.05, low, out], [ax0 + 0.05, low, out], [ax0 + 0.05, low, 0.12], [ax1 - 0.05, low, 0.12], [[0, 0], [ax1 - ax0, 0], [ax1 - ax0, 0.5], [0, 0.5]], darker(ac, 0.6))
      trimB.box(ax0, top - 0.02, 0.04, ax1, top + 0.08, 0.2, { color: darker(ac, 0.8) })
      if (s0 > 0.01 || s1 < 0.99) signY = g - 0.86
      else signY = -1
    } else if (s.awning.kind === 'mansard') {
      const sh = kit.get(M.shingles)
      const top = g + 0.62, low = g - 0.34, out = 1.25
      sh.face([0.1, low, out], [L - 0.1, low, out], [L - 0.1, top, 0.12], [0.1, top, 0.12], [[0, 0], [L, 0], [L, 1.6], [0, 1.6]], ac)
      sh.face([L - 0.1, low, out], [0.1, low, out], [0.1, low, 0.12], [L - 0.1, low, 0.12], [[0, 0], [L, 0], [L, 1.2], [0, 1.2]], darker(ac, 0.7))
      for (const x of [0.1, L - 0.1]) {
        const sgn = x < L / 2 ? -1 : 1
        const pts = [[x, low, 0.12], [x, low, out], [x, top, 0.12]]
        const ordered = sgn < 0 ? pts : [pts[0], pts[2], pts[1]]
        const i = sh.vertex(ordered[0][0], ordered[0][1], ordered[0][2], sgn, 0, 0, 0, 0, darker(ac, 0.85))
        sh.vertex(ordered[1][0], ordered[1][1], ordered[1][2], sgn, 0, 0, 1, 0, darker(ac, 0.85))
        sh.vertex(ordered[2][0], ordered[2][1], ordered[2][2], sgn, 0, 0, 0, 1, darker(ac, 0.85))
        sh.tri(i, i + 1, i + 2)
      }
      trimB.box(0.05, low - 0.12, out - 0.04, L - 0.05, low + 0.02, out + 0.06, { color: darker(trim, 0.8) })
      signY = -1
    } else {
      const stripe = s.awning.stripe !== undefined ? hexRGB(s.awning.stripe) : null
      const n = stripe ? Math.max(2, Math.round((ax1 - ax0) / 0.36)) : 1
      for (let i = 0; i < n; i++) {
        const x0 = ax0 + ((ax1 - ax0) * i) / n, x1 = ax0 + ((ax1 - ax0) * (i + 1)) / n
        const c = stripe && i % 2 ? stripe : ac
        trimB.face([x0, g - 0.42, 1.45], [x1, g - 0.42, 1.45], [x1, g + 0.18, 0.1], [x0, g + 0.18, 0.1], [[0, 0], [1, 0], [1, 1], [0, 1]], c)
        trimB.box(x0, g - 0.66, 1.4, x1, g - 0.42, 1.48, { color: darker(c, 0.9) })
        trimB.face([x1, g - 0.42, 1.45], [x0, g - 0.42, 1.45], [x0, g + 0.18, 0.1], [x1, g + 0.18, 0.1], [[0, 0], [1, 0], [1, 1], [0, 1]], darker(c, 0.7))
      }
      if (s0 > 0.01 || s1 < 0.99) signY = g - 0.86
      else {
        signY = g + (two ? 0.25 : 0.2)
        signZ = 0.12
      }
    }
  }
  if (s.signAt === 'top') {
    signY = H - 1.75
    signZ = 0.14
  }
  if (f.marquee >= 0 && M.signs) marquee(kit, M, atlas.rect(f.marquee), L, g)
  if (f.sign >= 0 && M.signs) {
    const r = atlas.rect(f.sign)
    const w = signWidth(L, s.sign?.text ?? '')
    const x0 = (L - w) / 2
    if (signY >= 0 && (two || signY + 0.62 <= H - 0.3)) {
      trimB.box(x0 - 0.08, signY - 0.06, 0.04, x0 + w + 0.08, signY + 0.68, signZ, { color: hexRGB(s.sign!.board) })
      signFace(kit.get(M.signs, false), r, x0, signY, x0 + w, signY + 0.62, signZ + 0.006)
    } else if (s.awning?.kind === 'mansard') {
      const top = g + 0.62, low = g - 0.34, out = 1.25
      const t0 = 0.22, t1 = 0.82
      const p = (t: number) => [low + (top - low) * t, out + (0.12 - out) * t]
      const [ya, za] = p(t0)
      const [yb, zb] = p(t1)
      const lift = 0.02
      const nb = kit.get(M.signs, false)
      nb.face([x0, ya + lift, za + lift], [x0 + w, ya + lift, za + lift], [x0 + w, yb + lift, zb + lift], [x0, yb + lift, zb + lift], [[r.u0, r.v1], [r.u1, r.v1], [r.u1, r.v0], [r.u0, r.v0]])
    }
  }
  if (f.blade >= 0 && M.signs) bladeSign(kit, M, atlas.rect(f.blade), L, g, two, hexRGB(s.blade!.board), trim)
  kit.done()
}

function upperWindow(kit: FrontKit, M: Mat, cx: number, w: number, sill: number, h: number, hoods: 'arch' | 'flat', trim: RGB, wall: RGB, upper: FrontStyle['upper'], blind = false): void {
  const t = kit.get(M.paint)
  const glass = blind ? kit.get(M.brick) : kit.get(M.lit, false)
  const x0 = cx - w / 2, x1 = cx + w / 2
  const arch = hoods === 'arch'
  const rect = arch ? h - w / 2 : h
  const fill = blind ? hexRGB(0x5a2e28) : undefined
  panel(glass, x0, sill, x1, sill + rect, 0.07, fill)
  if (arch) halfDisc(glass, cx, sill + rect, w / 2, 0.07, 18, fill)
  if (KIT?.has('window')) {
    kitPut(kit, M, 'window', place(cx, sill, 0.07, w, rect / 1.6, 1), trim)
    kitPut(kit, M, 'sill', place(cx, sill - 0.09, 0.05, (w + 0.3) / 1.3, 1, 1), trim)
    if (arch) kitPut(kit, M, 'hood-arch', place(cx, sill + rect, 0.05, w, w, 1), upper === 'brick' ? darker(wall, 0.82) : trim)
    else kitPut(kit, M, 'hood-flat', place(cx, sill + h + 0.02, 0.03, w, 1, 1), trim)
    return
  }
  t.box(x0 - 0.07, sill, 0.04, x0, sill + rect, 0.13, { color: trim })
  t.box(x1, sill, 0.04, x1 + 0.07, sill + rect, 0.13, { color: trim })
  t.box(x0 - 0.04, sill + rect * 0.5 - 0.03, 0.05, x1 + 0.04, sill + rect * 0.5 + 0.03, 0.11, { color: trim })
  t.box(x0 - 0.16, sill - 0.12, 0.0, x1 + 0.16, sill, 0.2, { color: trim })
  if (arch) {
    archBand(t, cx, sill + rect, w / 2, w / 2 + (upper === 'brick' ? 0.2 : 0.16), 0.04, 0.16, upper === 'brick' ? darker(wall, 0.82) : trim)
    t.box(cx - 0.08, sill + rect + w / 2 - 0.02, 0.04, cx + 0.08, sill + rect + w / 2 + 0.2, 0.19, { color: trim })
  } else {
    t.box(x0 - 0.2, sill + h, 0.0, x1 + 0.2, sill + h + 0.26, 0.18, { color: trim })
    t.box(x0 - 0.26, sill + h + 0.26, 0.0, x1 + 0.26, sill + h + 0.34, 0.24, { color: trim })
  }
}

function bayWindow(kit: FrontKit, M: Mat, cx: number, step: number, sill: number, h: number, trim: RGB): void {
  const t = kit.get(M.paint)
  const glass = kit.get(M.lit, false)
  const w = Math.min(2.2, step * 1.6)
  const d = 0.7
  const x0 = cx - w / 2 + step * 0.3, x1 = x0 + w
  const y0 = sill - 0.35, y1 = sill + h + 0.15
  t.box(x0 - 0.1, y0 - 0.25, 0, x1 + 0.1, y0, d + 0.12, { color: trim })
  t.box(x0 - 0.15, y1, 0, x1 + 0.15, y1 + 0.32, d + 0.18, { color: trim })
  panel(glass, x0 + 0.12, y0 + 0.2, x1 - 0.12, y1 - 0.12, d + 0.01)
  t.box(x0, y0, d - 0.04, x0 + 0.12, y1, d + 0.04, { color: trim })
  t.box(x1 - 0.12, y0, d - 0.04, x1, y1, d + 0.04, { color: trim })
  t.box(x0, y0, d - 0.04, x1, y0 + 0.2, d + 0.04, { color: trim })
  t.box(x0, y1 - 0.12, d - 0.04, x1, y1, d + 0.04, { color: trim })
  t.box(x0, y0, 0, x0 + 0.1, y1, d, { color: trim })
  t.box(x1 - 0.1, y0, 0, x1, y1, d, { color: trim })
}

function cornice(kit: FrontKit, M: Mat, L: number, H: number, s: FrontStyle, trim: RGB, wall: RGB): void {
  const t = kit.get(M.paint)
  if (s.cornice === 'corbel') {
    const brick = kit.get(M.brick)
    const tone = darker(wall, 0.9)
    brick.box(-0.05, H - 0.28, 0, L + 0.05, H, 0.32, { color: tone })
    brick.box(0, H - 0.5, 0, L, H - 0.28, 0.2, { color: tone })
    brick.box(0, H - 0.68, 0, L, H - 0.5, 0.11, { color: tone })
    for (let x = 0.2; x < L - 0.1; x += 0.36) brick.box(x, H - 0.82, 0.04, x + 0.18, H - 0.68, 0.11, { color: tone })
    if (s.band) {
      const panels = Math.max(1, Math.round((L - 0.6) / 2.1))
      const pw = (L - 0.6) / panels
      for (let i = 0; i < panels; i++) {
        const x0 = 0.3 + i * pw + 0.18, x1 = 0.3 + (i + 1) * pw - 0.18
        panel(brick, x0, H - 1.55, x1, H - 1.0, 0.058, hexRGB(s.band))
        brick.box(x0 - 0.1, H - 1.62, 0, x1 + 0.1, H - 1.55, 0.1, { color: tone })
        brick.box(x0 - 0.1, H - 1.0, 0, x1 + 0.1, H - 0.93, 0.1, { color: tone })
      }
    }
    return
  }
  if (s.cornice === 'brackets' && KIT?.has('cornice')) {
    const n = Math.max(1, Math.round(L / 1.2))
    const seg = (L + 0.16) / n
    for (let i = 0; i < n; i++) kitPut(kit, M, 'cornice', place(-0.08 + i * seg, H - 0.52, 0, seg, 1, 1), trim)
    const nb = Math.max(2, Math.round(L / 1.25))
    for (let i = 0; i <= nb; i++) kitPut(kit, M, 'bracket', place(Math.min(L - 0.12, Math.max(0.12, (L * i) / nb)), H - 0.34, 0), trim)
    t.box(0, H - 0.9, 0, L, H - 0.52, 0.06, { color: trim })
    if (s.band) t.box(0, H - 1.12, 0.05, L, H - 0.9, 0.09, { color: hexRGB(s.band) })
    return
  }
  if (s.cornice === 'simple') {
    t.box(-0.04, H - 0.24, 0, L + 0.04, H, 0.2, { color: trim })
    t.box(0, H - 0.42, 0, L, H - 0.24, 0.1, { color: trim })
  } else {
    t.box(-0.08, H - 0.34, 0, L + 0.08, H, 0.42, { color: trim })
    t.box(0, H - 0.5, 0, L, H - 0.34, 0.2, { color: trim })
    for (let x = 0.12; x < L - 0.05; x += 0.26) t.box(x, H - 0.62, 0.05, x + 0.11, H - 0.5, 0.17, { color: trim })
    const n = Math.max(2, Math.round(L / 1.25))
    for (let i = 0; i <= n; i++) {
      const x = Math.min(L - 0.16, Math.max(0.04, (L * i) / n - 0.06))
      t.box(x, H - 0.9, 0.04, x + 0.13, H - 0.34, 0.36, { color: trim })
    }
  }
  if (s.band) t.box(0, H - 1.12, 0.05, L, H - 0.9, 0.09, { color: hexRGB(s.band) })
}

/**
 * The street storey of a shop: display windows on a kick plate between corner piers, an entry in the middle of each
 * shop bay (one bay per seven or eight metres of front, or where `doors` puts them from the owner's photos), and on a
 * two-storey building the narrow door to the stairs up, at one end (`stairDoor`).
 */
function shopFront(kit: FrontKit, M: Mat, L: number, g: number, base: RGB, trim: RGB, brick: Material | null, s: FrontStyle, two: boolean): void {
  const t = kit.get(M.paint)
  const glass = kit.get(M.lit, false)
  const pierMat = brick ? kit.get(brick) : t
  pierMat.box(0, 0, 0, 0.42, g, 0.18, { color: base })
  pierMat.box(L - 0.42, 0, 0, L, g, 0.18, { color: base })
  if (KIT?.has('pilaster-shaft')) {
    for (const x of [0.21, L - 0.21]) {
      kitPut(kit, M, 'pilaster-base', place(x, 0, 0.18), trim)
      kitPut(kit, M, 'pilaster-shaft', place(x, 0.3, 0.18, 1, Math.max(0.2, g - 0.56), 1), trim)
      kitPut(kit, M, 'pilaster-cap', place(x, g - 0.26, 0.18), trim)
    }
  }
  if (brick) panel(kit.get(brick), 0.42, 0, L - 0.42, g, 0.06, base)
  const top = g - 0.95
  const doors = entryPlan(L, s, two)
  // Display windows in every run between doors.
  let from = 0.42
  for (const d of [...doors, { x: L - 0.42 + 0.1 + 0.5, w: 1, stair: false }]) {
    const x0 = from, x1 = d.x - d.w / 2 - 0.12
    from = d.x + d.w / 2 + 0.12
    if (x1 - x0 < 0.4) continue
    t.box(x0, 0, 0.0, x1, 0.55, 0.16, { color: base })
    panel(glass, x0 + 0.06, 0.55, x1 - 0.06, top, 0.09)
    t.box(x0, 0.55, 0.06, x1, 0.62, 0.17, { color: trim })
    t.box(x0, top - 0.06, 0.06, x1, top + 0.02, 0.15, { color: trim })
    t.box(x0, top - 0.62, 0.08, x1, top - 0.56, 0.14, { color: trim })
    const panes = Math.max(1, Math.round((x1 - x0) / 1.6))
    for (let i = 1; i < panes; i++) {
      const x = x0 + ((x1 - x0) * i) / panes
      t.box(x - 0.04, 0.55, 0.07, x + 0.04, top, 0.15, { color: trim })
    }
  }
  for (const d of doors) {
    const d0 = d.x - d.w / 2, d1 = d.x + d.w / 2
    t.box(d0 - 0.12, 0, 0.0, d0, top, 0.18, { color: trim })
    t.box(d1, 0, 0.0, d1 + 0.12, top, 0.18, { color: trim })
    if (d.stair) {
      // The stair door: solid, panelled, with a transom light over it.
      panel(t, d0, 0, d1, 2.2, 0.075, hexRGB(0x4a3a2c))
      t.box(d0 + 0.1, 0.25, 0.08, d1 - 0.1, 0.95, 0.1, { color: hexRGB(0x5a4836) })
      t.box(d0 + 0.1, 1.15, 0.08, d1 - 0.1, 2.0, 0.1, { color: hexRGB(0x5a4836) })
    } else if (KIT?.has('door')) {
      panel(glass, d0 + 0.1, 1.0, d1 - 0.1, 2.15, 0.07)
      kitPut(kit, M, 'door', place(d.x, 0, 0.075, d.w / 0.98, 1, 1), trim)
    } else {
      panel(t, d0, 0, d1, 2.25, 0.075, hexRGB(0x3a2e24))
      panel(glass, d0 + 0.18, 1.0, d1 - 0.18, 2.0, 0.08)
    }
    t.box(d0, 2.25, 0.04, d1, 2.37, 0.16, { color: trim })
    if (top - 2.45 > 0.2) panel(glass, d0 + 0.05, 2.4, d1 - 0.05, top - 0.08, 0.09)
  }
  t.box(0.42, top, 0.04, L - 0.42, g, 0.1, { color: darker(base, 1.1) })
}

/** Where a shop front's doors go, left to right seen from the street. */
export function entryPlan(L: number, s: FrontStyle, two: boolean): { x: number; w: number; stair: boolean }[] {
  const out: { x: number; w: number; stair: boolean }[] = []
  let a = 0.42, b = L - 0.42
  const stair = two && L >= 5.5 ? s.stairDoor ?? 'left' : 'none'
  if (stair === 'left') {
    out.push({ x: a + 0.12 + 0.45, w: 0.9, stair: true })
    a += 1.25
  } else if (stair === 'right') {
    out.push({ x: b - 0.12 - 0.45, w: 0.9, stair: true })
    b -= 1.25
  }
  const bays = Math.max(1, Math.round((b - a) / 7.5))
  const shares = s.doors ?? Array.from({ length: bays }, (_v, i) => (a + ((b - a) * (i + 0.5)) / bays) / L)
  for (const share of shares) out.push({ x: Math.min(b - 0.65, Math.max(a + 0.65, share * L)), w: 1.05, stair: false })
  return out.sort((p, q) => p.x - q.x)
}

/** Yahooz's front: round logs laid up the street storey, windows and the door set in them. */
function logFront(kit: FrontKit, M: Mat, L: number, g: number, wood: RGB, trim: RGB): void {
  const logs = kit.get(M.logs)
  const glass = kit.get(M.lit, false)
  const t = kit.get(M.paint)
  const r = 0.13
  for (let y = 0.14, k = 0; y < g - 0.05; y += 0.25, k++) logs.tube([0.05, y, 0.17], [L - 0.05, y, 0.17], r, 8, true, darker(wood, k % 2 ? 0.92 : 1))
  const doorX = L * 0.62
  const z = 0.31
  for (const [x0, x1] of [[0.6, Math.max(1.4, doorX - 1.2)], [doorX + 0.95, L - 0.6]]) {
    if (x1 - x0 < 0.6) continue
    panel(glass, x0, 0.9, x1, g - 0.85, z)
    t.box(x0 - 0.1, 0.8, z - 0.03, x1 + 0.1, 0.9, z + 0.08, { color: darker(wood, 0.6) })
    t.box(x0 - 0.1, g - 0.85, z - 0.03, x1 + 0.1, g - 0.75, z + 0.08, { color: darker(wood, 0.6) })
    t.box(x0 - 0.1, 0.9, z - 0.03, x0, g - 0.85, z + 0.08, { color: darker(wood, 0.6) })
    t.box(x1, 0.9, z - 0.03, x1 + 0.1, g - 0.85, z + 0.08, { color: darker(wood, 0.6) })
  }
  panel(t, doorX - 0.5, 0, doorX + 0.5, 2.2, z, hexRGB(0x4a3424))
  panel(glass, doorX - 0.32, 1.1, doorX + 0.32, 1.95, z + 0.005)
  t.box(doorX - 0.6, 2.2, z - 0.03, doorX + 0.6, 2.32, z + 0.08, { color: darker(wood, 0.6) })
  t.box(0, g - 0.12, 0, L, g + 0.02, 0.34, { color: trim })
}

/** Stone veneer with smaller windows and a door (the supper club's street storey). */
function stoneFront(kit: FrontKit, M: Mat, L: number, g: number, stone: RGB, trim: RGB): void {
  const st = kit.get(M.stone)
  const glass = kit.get(M.lit, false)
  const t = kit.get(M.paint)
  panel(st, 0, 0, L, g, 0.08, stone)
  st.box(0, 0, 0, L, 0.4, 0.2, { color: darker(stone, 0.85) })
  const n = Math.max(2, Math.floor((L - 1.5) / 1.5))
  const doorI = Math.min(n - 1, 1)
  for (let i = 0; i < n; i++) {
    const cx = 0.75 + ((L - 1.5) * (i + 0.5)) / n
    if (i === doorI) {
      panel(t, cx - 0.5, 0, cx + 0.5, 2.3, 0.09, hexRGB(0x3a2a20))
      t.box(cx - 0.62, 2.3, 0.05, cx + 0.62, 2.45, 0.2, { color: darker(stone, 0.75) })
      continue
    }
    const w = 0.92
    panel(glass, cx - w / 2, 1.0, cx + w / 2, Math.min(2.6, g - 0.75), 0.09)
    t.box(cx - w / 2 - 0.08, 0.86, 0.06, cx + w / 2 + 0.08, 1.0, 0.24, { color: darker(stone, 0.78) })
    t.box(cx - w / 2 - 0.08, Math.min(2.6, g - 0.75), 0.06, cx + w / 2 + 0.08, Math.min(2.6, g - 0.75) + 0.14, 0.22, { color: darker(stone, 0.78) })
  }
  t.box(0, g - 0.1, 0, L, g + 0.04, 0.3, { color: trim })
}

/** A board hung from an iron bracket out over the sidewalk, lettered on both sides. */
function bladeSign(kit: FrontKit, M: Mat, r: SignRect, L: number, g: number, two: boolean, board: RGB, trim: RGB): void {
  const t = kit.get(M.paint)
  const x = Math.min(L - 0.6, 0.8)
  const y = two ? g + 0.55 : g - 0.1
  const iron = hexRGB(0x1e1f22)
  t.box(x - 0.03, y - 0.03, 0.05, x + 0.03, y + 0.03, 1.75, { color: iron })
  t.box(x - 0.03, y - 0.5, 0.05, x + 0.03, y, 0.12, { color: iron })
  const z0 = 0.35, z1 = 1.6, y0 = y - 0.95, y1 = y - 0.12
  t.box(x - 0.04, y0, z0, x + 0.04, y1, z1, { color: board })
  t.box(x - 0.05, y1, z0 - 0.04, x + 0.05, y1 + 0.05, z1 + 0.04, { color: trim })
  const s = kit.get(M.signs!, false)
  const uv = [[r.u0, r.v1], [r.u1, r.v1], [r.u1, r.v0], [r.u0, r.v0]]
  const m = 0.05
  s.quad([[x + m, y0 + 0.04, z1 - 0.04], [x + m, y0 + 0.04, z0 + 0.04], [x + m, y1 - 0.04, z0 + 0.04], [x + m, y1 - 0.04, z1 - 0.04]], [1, 0, 0], uv)
  s.quad([[x - m, y0 + 0.04, z0 + 0.04], [x - m, y0 + 0.04, z1 - 0.04], [x - m, y1 - 0.04, z1 - 0.04], [x - m, y1 - 0.04, z0 + 0.04]], [-1, 0, 0], uv)
}

/** Vertical boards between corner piers, with two or three windows and a door (the plainer Main Street shops). */
function boardFront(kit: FrontKit, M: Mat, L: number, g: number, boards: RGB, piers: RGB, trim: RGB): void {
  const bd = kit.get(M.boards)
  const t = kit.get(M.paint)
  const glass = kit.get(M.lit, false)
  t.box(0, 0, 0, 0.42, g, 0.2, { color: piers })
  t.box(L - 0.42, 0, 0, L, g, 0.2, { color: piers })
  t.box(0.42, 0, 0, L - 0.42, 0.45, 0.16, { color: piers })
  panel(bd, 0.42, 0.45, L - 0.42, g - 0.25, 0.08, boards)
  const n = Math.max(2, Math.min(4, Math.round((L - 0.84) / 2.6)))
  const doorI = Math.floor(n / 2)
  for (let i = 0; i < n; i++) {
    const cx = 0.42 + ((L - 0.84) * (i + 0.5)) / n
    if (i === doorI) {
      panel(t, cx - 0.48, 0.45, cx + 0.48, 2.5, 0.09, hexRGB(0x3c4438))
      panel(glass, cx - 0.3, 1.5, cx + 0.3, 2.3, 0.095)
      t.box(cx - 0.6, 0.45, 0.04, cx - 0.48, 2.62, 0.16, { color: trim })
      t.box(cx + 0.48, 0.45, 0.04, cx + 0.6, 2.62, 0.16, { color: trim })
      t.box(cx - 0.6, 2.5, 0.04, cx + 0.6, 2.62, 0.16, { color: trim })
      continue
    }
    const w = 1.15, y0 = 1.1, y1 = Math.min(2.4, g - 0.6)
    panel(glass, cx - w / 2, y0, cx + w / 2, y1, 0.09)
    t.box(cx - w / 2 - 0.08, y0 - 0.08, 0.05, cx + w / 2 + 0.08, y0, 0.17, { color: trim })
    t.box(cx - w / 2 - 0.08, y1, 0.05, cx + w / 2 + 0.08, y1 + 0.08, 0.15, { color: trim })
    t.box(cx - w / 2 - 0.08, y0, 0.05, cx - w / 2, y1, 0.15, { color: trim })
    t.box(cx + w / 2, y0, 0.05, cx + w / 2 + 0.08, y1, 0.15, { color: trim })
  }
  t.box(0.42, g - 0.25, 0.02, L - 0.42, g, 0.14, { color: trim })
}

/** A raised terrace: a rock-faced stone wall out in front with an iron railing, the street storey's windows behind it. */
function terrace(kit: FrontKit, M: Mat, L: number, g: number, s: FrontStyle, wallColor: RGB, trim: RGB): void {
  const p = s.plinth!
  const st = kit.get(M.stone)
  const iron = kit.get(M.iron, false)
  const t = kit.get(M.paint)
  const glass = kit.get(M.lit, false)
  const out = 1.9
  const stone = hexRGB(p.color)
  st.box(-0.1, -0.6, 0, L + 0.1, p.height, out, { color: stone })
  st.box(-0.16, p.height, -0.02, L + 0.16, p.height + 0.1, out + 0.06, { color: darker(stone, 1.1) })
  const top = p.height + 0.1
  iron.box(0, top + 0.95, out - 0.08, L, top + 1.0, out - 0.03)
  iron.box(0, top + 0.12, out - 0.08, L, top + 0.16, out - 0.03)
  for (let x = 0.1; x <= L; x += 0.14) iron.box(x - 0.012, top + 0.16, out - 0.07, x + 0.012, top + 0.95, out - 0.04)
  panel(kit.get(M.brick), 0.32, top, L - 0.32, g, 0.06, wallColor)
  const n = Math.max(2, Math.floor((L - 1) / 2.2))
  for (let i = 0; i < n; i++) {
    const cx = 0.5 + ((L - 1) * (i + 0.5)) / n
    const w = 0.9, y0 = top + 0.7, y1 = Math.min(g - 0.35, y0 + 1.9)
    panel(glass, cx - w / 2, y0, cx + w / 2, y1, 0.08)
    t.box(cx - w / 2 - 0.07, y0, 0.05, cx - w / 2, y1, 0.14, { color: trim })
    t.box(cx + w / 2, y0, 0.05, cx + w / 2 + 0.07, y1, 0.14, { color: trim })
    t.box(cx - w / 2 - 0.14, y0 - 0.1, 0.0, cx + w / 2 + 0.14, y0, 0.18, { color: trim })
    t.box(cx - w / 2 - 0.16, y1, 0.0, cx + w / 2 + 0.16, y1 + 0.2, 0.16, { color: trim })
  }
}

/** An iron balcony along the upper storey: a deck, railings, and posts down to the terrace or the walk. */
function balcony(kit: FrontKit, M: Mat, x0: number, x1: number, g: number, base: number): void {
  const iron = kit.get(M.iron, false)
  const y = g + 0.08, d = 1.35
  iron.box(x0, y - 0.12, 0, x1, y, d)
  iron.box(x0, y + 0.95, d - 0.05, x1, y + 1.0, d)
  iron.box(x0, y + 0.95, 0, x0 + 0.05, y + 1.0, d)
  iron.box(x1 - 0.05, y + 0.95, 0, x1, y + 1.0, d)
  for (let x = x0 + 0.08; x < x1; x += 0.13) iron.box(x - 0.012, y, d - 0.04, x + 0.012, y + 0.95, d - 0.01)
  const posts = Math.max(2, Math.round((x1 - x0) / 2.6) + 1)
  for (let i = 0; i < posts; i++) {
    const x = x0 + 0.05 + ((x1 - x0 - 0.1) * i) / (posts - 1)
    iron.box(x - 0.04, base, d - 0.08, x + 0.04, y - 0.12, d)
  }
}

/** A corner turret on the upper storey: an eight-sided shingled tower on a corbel, windows on its outer faces, a spire. */
function turret(kit: FrontKit, M: Mat, end: number, g: number, H: number, s: FrontStyle, trim: RGB, wall: RGB): void {
  const side = end === 0 ? -1 : 1
  const r = 1.45
  const cx = end + side * 0.3, cz = 0.45
  const body = kit.get(M.shingles)
  const t = kit.get(M.paint)
  const glass = kit.get(M.lit, false)
  const skin = hexRGB(s.turretColor ?? s.wall)
  t.cylinder(cx, g - 0.85, cz, 0.22, r + 0.05, 1.0, 8, false, darker(wall, 0.9))
  t.cylinder(cx, g + 0.12, cz, r + 0.12, r + 0.12, 0.16, 8, true, trim)
  body.cylinder(cx, g + 0.28, cz, r, r, H - g - 0.3, 8, true, skin)
  t.cylinder(cx, H - 0.1, cz, r + 0.16, r + 0.16, 0.34, 8, true, trim)
  if (!kitPut(kit, M, 'turret-roof', place(cx, H + 0.24, cz, r + 0.2, 3.2, r + 0.2), trim)) {
    kit.get(M.shingles).cylinder(cx, H + 0.24, cz, r + 0.22, 0.04, 3.2, 8, true, hexRGB(0x6c6862))
    kit.get(M.iron, false).cylinder(cx, H + 3.3, cz, 0.035, 0.01, 1.3, 6, true)
  }
  const outward = Math.atan2(1, side)
  const apothem = r * Math.cos(Math.PI / 8) + 0.015
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2
    let da = Math.abs(a - outward) % (Math.PI * 2)
    if (da > Math.PI) da = Math.PI * 2 - da
    if (da > 1.25) continue
    const nx = Math.cos(a), nz = Math.sin(a)
    const rx = nz, rz = -nx
    const px = cx + nx * apothem, pz = cz + nz * apothem
    const w = 0.42, y0 = g + 0.9, y1 = Math.min(H - 0.6, y0 + 1.7)
    glass.face([px - rx * w, y0, pz - rz * w], [px + rx * w, y0, pz + rz * w], [px + rx * w, y1, pz + rz * w], [px - rx * w, y1, pz - rz * w], [[0, 0], [1, 0], [1, 1], [0, 1]])
    t.orientedBox(px + nx * 0.06, y0 - 0.05, pz + nz * 0.06, w + 0.08, 0.05, 0.08, Math.PI / 2 - a, { color: trim })
  }
}

/** A house's street storey: siding, double-hung windows and a door behind a full-width front porch. */
function porchFront(kit: FrontKit, M: Mat, L: number, g: number, wall: RGB, trim: RGB): void {
  const sd = kit.get(M.siding)
  const t = kit.get(M.paint)
  const glass = kit.get(M.lit, false)
  const top = Math.min(g, 3.0)
  panel(sd, 0.16, 0, L - 0.16, top, 0.05, wall)
  const n = Math.max(2, Math.round((L - 0.6) / 2.4))
  const doorI = n > 2 ? 1 : 0
  for (let i = 0; i < n; i++) {
    const cx = 0.3 + ((L - 0.6) * (i + 0.5)) / n
    if (i === doorI) {
      panel(t, cx - 0.46, 0.55, cx + 0.46, 2.6, 0.07, hexRGB(0x4a3326))
      panel(glass, cx - 0.26, 1.7, cx + 0.26, 2.4, 0.075)
      t.box(cx - 0.58, 0.55, 0.03, cx - 0.46, 2.72, 0.13, { color: trim })
      t.box(cx + 0.46, 0.55, 0.03, cx + 0.58, 2.72, 0.13, { color: trim })
      t.box(cx - 0.58, 2.6, 0.03, cx + 0.58, 2.72, 0.13, { color: trim })
      continue
    }
    const w = 0.9, y0 = 1.05, y1 = Math.min(top - 0.35, 2.55)
    panel(glass, cx - w / 2, y0, cx + w / 2, y1, 0.07)
    t.box(cx - w / 2, (y0 + y1) / 2 - 0.03, 0.06, cx + w / 2, (y0 + y1) / 2 + 0.03, 0.1, { color: trim })
    t.box(cx - w / 2 - 0.1, y0, 0.03, cx - w / 2, y1, 0.12, { color: trim })
    t.box(cx + w / 2, y0, 0.03, cx + w / 2 + 0.1, y1, 0.12, { color: trim })
    t.box(cx - w / 2 - 0.14, y0 - 0.1, 0.0, cx + w / 2 + 0.14, y0, 0.16, { color: trim })
    t.box(cx - w / 2 - 0.12, y1, 0.03, cx + w / 2 + 0.12, y1 + 0.14, 0.14, { color: trim })
  }
  // The porch: deck, steps, posts, railing and a low roof.
  const deck = kit.get(M.boards)
  const d = 2.3, deckY = 0.55, roofLow = Math.min(top - 0.1, 2.75), roofHigh = Math.min(top + 0.35, roofLow + 0.4)
  deck.box(0.2, deckY - 0.18, 0.05, L - 0.2, deckY, d, { color: hexRGB(0x8c8174) })
  const doorX = 0.3 + ((L - 0.6) * (doorI + 0.5)) / n
  deck.box(doorX - 0.7, 0, d, doorX + 0.7, deckY - 0.2, d + 0.6, { color: hexRGB(0x8c8174) })
  const posts = Math.max(3, Math.round((L - 0.4) / 2.2) + 1)
  for (let i = 0; i < posts; i++) {
    const x = 0.32 + ((L - 0.64) * i) / (posts - 1)
    t.box(x - 0.07, deckY, d - 0.2, x + 0.07, roofLow, d - 0.06, { color: trim })
  }
  for (const [x0, x1] of [[0.32, doorX - 0.65], [doorX + 0.65, L - 0.32]]) {
    if (x1 - x0 < 0.3) continue
    t.box(x0, deckY + 0.88, d - 0.17, x1, deckY + 0.94, d - 0.09, { color: trim })
    t.box(x0, deckY + 0.08, d - 0.16, x1, deckY + 0.13, d - 0.1, { color: trim })
    for (let x = x0 + 0.12; x < x1; x += 0.14) t.box(x - 0.018, deckY + 0.13, d - 0.15, x + 0.018, deckY + 0.88, d - 0.11, { color: trim })
  }
  const roof = kit.get(M.shingles)
  const roofColor = hexRGB(0x4b3d35)
  roof.face([0.05, roofLow, d + 0.25], [L - 0.05, roofLow, d + 0.25], [L - 0.05, roofHigh, 0.05], [0.05, roofHigh, 0.05], [[0, 0], [L, 0], [L, d], [0, d]], roofColor)
  roof.face([L - 0.05, roofLow, d + 0.25], [0.05, roofLow, d + 0.25], [0.05, roofHigh, 0.05], [L - 0.05, roofHigh, 0.05], [[0, 0], [L, 0], [L, d], [0, d]], darker(roofColor, 0.8))
  t.box(0.05, roofLow - 0.2, d + 0.12, L - 0.05, roofLow, d + 0.27, { color: trim })
}

/** A parapet stepping up over the middle of the front, capped in a lighter course. */
function steppedParapet(kit: FrontKit, M: Mat, L: number, H: number, wall: RGB, trim: RGB): void {
  const br = kit.get(M.brick)
  const t = kit.get(M.paint)
  const steps: [number, number, number][] = [[0.14, 0.86, 0.55], [0.3, 0.7, 1.15]]
  for (const [a, b, rise] of steps) {
    br.box(L * a, H - 0.05, 0, L * b, H + rise, 0.32, { color: wall })
    t.box(L * a - 0.06, H + rise, -0.02, L * b + 0.06, H + rise + 0.12, 0.38, { color: trim })
  }
  br.box(L * 0.46, H + 1.15, 0, L * 0.54, H + 1.6, 0.32, { color: wall })
  t.box(L * 0.46 - 0.06, H + 1.6, -0.02, L * 0.54 + 0.06, H + 1.72, 0.38, { color: trim })
}

/** A theatre marquee over the doors: a dark canopy lit underneath, with lettering across its face. */
function marquee(kit: FrontKit, M: Mat, r: SignRect, L: number, g: number): void {
  const t = kit.get(M.paint)
  const lit = kit.get(M.lit, false)
  const x0 = L * 0.2, x1 = L * 0.8
  const y0 = g - 0.15, y1 = g + 0.62, d = 1.75
  t.box(x0, y0, 0, x1, y1, d, { color: hexRGB(0x23232a) })
  lit.quad([[x0 + 0.08, y0 - 0.005, d - 0.08], [x1 - 0.08, y0 - 0.005, d - 0.08], [x1 - 0.08, y0 - 0.005, 0.1], [x0 + 0.08, y0 - 0.005, 0.1]], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]])
  signFace(kit.get(M.signs!, false), r, x0 + 0.1, y0 + 0.1, x1 - 0.1, y1 - 0.1, d + 0.006)
  for (const x of [x0 + 0.12, x1 - 0.12]) t.box(x - 0.03, y1, d - 0.2, x + 0.03, g + 2.2, d - 0.14, { color: hexRGB(0x1c1e22) })
}
