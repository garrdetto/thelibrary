import { MeshBuilder, mat4, hexColor } from './gl'
import type { Vec3 } from './gl'
import { C } from './models'
import { FLOOR_HEIGHT } from '../../../server/park/index.mjs'

export type HotelLook = { kind: string; w: number; h: number; floors: number; primary: number; secondary: number; trim: number; roof: string; addons: Record<string, boolean>; front: 0 | 1 | 2 | 3 }

const T = mat4.translation
const GLASS = hexColor('#24384f'), GLASS_LIGHT = hexColor('#6f9cc4'), WATER = hexColor('#3aa7dc'), SAND = hexColor('#e8d29a'), LEAF = hexColor('#4f8f3a'), BARK = hexColor('#6b4a30'), STONE = hexColor('#8f8c86')
const rgb = (n: number): Vec3 => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
const shade = (c: Vec3, f: number): Vec3 => [c[0] * f, c[1] * f, c[2] * f]

function windows(b: MeshBuilder, W: number, H: number, z0: number, floors: number, color: Vec3, spacing = 1.6, inset = 0) {
  for (let f = 0; f < floors; f++) {
    const z = z0 + f * FLOOR_HEIGHT + 1
    for (let x = -W + 1 + inset; x <= W - 1 - inset; x += spacing) { b.box(null, x, -H - 0.02, z, 0.9, 0.06, 1.3, color); b.box(null, x, H + 0.02, z, 0.9, 0.06, 1.3, color) }
    for (let y = -H + 1 + inset; y <= H - 1 - inset; y += spacing) { b.box(null, -W - 0.02, y, z, 0.06, 0.9, 1.3, color); b.box(null, W + 0.02, y, z, 0.06, 0.9, 1.3, color) }
  }
}

function gable(b: MeshBuilder, W: number, H: number, z: number, rise: number, color: Vec3, along: 'x' | 'y' = 'x') {
  if (along === 'x') {
    b.quad(null, [-W - 0.4, -H - 0.4, z], [W + 0.4, -H - 0.4, z], [W + 0.4, 0, z + rise], [-W - 0.4, 0, z + rise], color)
    b.quad(null, [W + 0.4, H + 0.4, z], [-W - 0.4, H + 0.4, z], [-W - 0.4, 0, z + rise], [W + 0.4, 0, z + rise], color)
    b.tri(null, [-W, -H, z], [-W, H, z], [-W, 0, z + rise], shade(color, 0.85))
    b.tri(null, [W, H, z], [W, -H, z], [W, 0, z + rise], shade(color, 0.85))
  } else {
    b.quad(null, [W + 0.4, -H - 0.4, z], [W + 0.4, H + 0.4, z], [0, H + 0.4, z + rise], [0, -H - 0.4, z + rise], color)
    b.quad(null, [-W - 0.4, H + 0.4, z], [-W - 0.4, -H - 0.4, z], [0, -H - 0.4, z + rise], [0, H + 0.4, z + rise], color)
    b.tri(null, [W, -H, z], [-W, -H, z], [0, -H, z + rise], shade(color, 0.85))
    b.tri(null, [-W, H, z], [W, H, z], [0, H, z + rise], shade(color, 0.85))
  }
}

function palm(b: MeshBuilder, x: number, y: number, height = 5) {
  b.cylinder(null, x, y, 0.3, 0.22, 0.14, height, 6, BARK)
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; b.box(mat4.chain(T(x, y, height + 0.2), mat4.rotZ(a), mat4.rotY(0.35)), 1.1, 0, 0, 2.2, 0.5, 0.08, LEAF) }
}

function thatchHut(b: MeshBuilder, x: number, y: number, z: number, size: number, floors: number, wall: Vec3, roof: Vec3, trim: Vec3) {
  const hgt = floors * FLOOR_HEIGHT * 0.85
  b.box(null, x, y, z, size, size, hgt, wall)
  b.box(null, x, y - size / 2 - 0.02, z + 0.2, size * 0.35, 0.06, 1.9, trim)
  b.box(null, x - size * 0.28, y - size / 2 - 0.02, z + hgt - 1.4, size * 0.25, 0.06, 0.8, GLASS)
  b.cylinder(null, x, y, z + hgt, size * 0.9, 0, size * 0.55 + 0.6, 4, roof)
}

function motorInn(b: MeshBuilder, W: number, H: number, l: HotelLook, p: Vec3, s: Vec3, t: Vec3) {
  const top = l.floors * FLOOR_HEIGHT
  b.box(null, 0, 0.6, 0.3, W * 2, H * 2 - 1.2, top, p)
  for (let f = 0; f < l.floors; f++) for (let x = -W + 1.2; x <= W - 1.2; x += 2.2) {
    b.box(null, x, -H + 0.58, 0.3 + f * FLOOR_HEIGHT, 0.9, 0.06, 2.1, s)
    b.box(null, x + 0.8, -H + 0.58, 1.4 + f * FLOOR_HEIGHT, 0.5, 0.06, 0.7, GLASS)
  }
  b.box(null, 0, -H + 0.3, top + 0.3, W * 2, 1.4, 0.15, t)
  for (let x = -W + 0.4; x <= W - 0.4; x += 3) b.box(null, x, -H + 0.1, 0.3, 0.12, 0.12, top, C.white)
  if (l.floors > 1) b.box(null, 0, -H + 0.3, FLOOR_HEIGHT + 0.3, W * 2, 1.2, 0.12, C.white)
  if (l.roof === 'gable') gable(b, W, H - 0.6, top + 0.3, 1.6, s)
  else b.box(null, 0, 0.6, top + 0.3, W * 2 + 0.2, H * 2 - 1, 0.25, t)
  return l.roof === 'gable' ? top + 1.9 : top + 0.55
}

function skylineTower(b: MeshBuilder, W: number, H: number, l: HotelLook, p: Vec3, s: Vec3, t: Vec3) {
  const podium = FLOOR_HEIGHT * 1.5
  b.box(null, 0, 0, 0.3, W * 2, H * 2, podium, t)
  b.box(null, 0, -H - 0.02, 0.6, W * 1.6, 0.06, podium - 0.8, GLASS_LIGHT)
  const tw = W * 0.78, th = H * 0.78, top = podium + l.floors * FLOOR_HEIGHT
  b.box(null, 0, 0, podium + 0.3, tw * 2, th * 2, l.floors * FLOOR_HEIGHT, p)
  for (let f = 0; f < l.floors; f++) {
    const z = podium + 0.3 + f * FLOOR_HEIGHT + 0.9
    b.box(null, 0, 0, z, tw * 2 + 0.08, th * 2 + 0.08, 1.5, GLASS)
    b.box(null, 0, 0, z + 1.5, tw * 2 + 0.1, th * 2 + 0.1, 0.12, s)
  }
  let roofTop = top + 0.3
  if (l.roof === 'crown') { b.box(null, 0, 0, roofTop, tw * 1.6, th * 1.6, 2.2, s); b.box(null, 0, 0, roofTop + 2.2, tw * 1.1, th * 1.1, 1.8, t); roofTop += 4 }
  else if (l.roof === 'spire') { b.box(null, 0, 0, roofTop, tw * 1.2, th * 1.2, 1.4, s); b.cylinder(null, 0, 0, roofTop + 1.4, 0.4, 0.05, 9, 8, t); roofTop += 1.4 }
  else { b.box(null, 0, 0, roofTop, tw * 2 + 0.3, th * 2 + 0.3, 0.4, s); roofTop += 0.4 }
  return roofTop
}

function palmCove(b: MeshBuilder, W: number, H: number, l: HotelLook, p: Vec3, s: Vec3, t: Vec3) {
  b.box(null, 0, 0, 0.05, W * 2, H * 2, 0.25, SAND)
  let k = 0
  const gapX = (W * 2 - 5) / Math.max(1, Math.round((W * 2 - 5) / 8)), gapY = (H * 2 - 5) / Math.max(1, Math.round((H * 2 - 5) / 8))
  for (let x = -W + 2.5; x <= W - 2.4; x += gapX) for (let y = -H + 2.5; y <= H - 2.4; y += gapY) {
    thatchHut(b, x, y, 0.3, 3, l.floors, p, s, t)
    if (k++ % 2 === 0) palm(b, x + 2.1, y + 2.1)
  }
  return l.floors * FLOOR_HEIGHT * 0.85 + 2.6
}

function timberLodge(b: MeshBuilder, W: number, H: number, l: HotelLook, p: Vec3, s: Vec3, t: Vec3) {
  const top = l.floors * FLOOR_HEIGHT
  b.box(null, 0, 0, 0.3, W * 2, H * 2, top, p)
  for (let z = 0.7; z < top; z += 0.55) { b.box(null, 0, -H - 0.03, z, W * 2, 0.06, 0.08, shade(p, 0.7)); b.box(null, 0, H + 0.03, z, W * 2, 0.06, 0.08, shade(p, 0.7)) }
  windows(b, W, H, 0.3, l.floors, GLASS, 2.4, 0.4)
  for (let f = 0; f < l.floors; f++) for (let x = -W + 1.4; x <= W - 1.4; x += 2.4) b.box(null, x, -H - 0.06, 1.2 + f * FLOOR_HEIGHT, 1.1, 0.04, 1.5, t)
  if (l.roof === 'hip') { b.cylinder(mat4.scaling(W / Math.max(W, H), H / Math.max(W, H), 1), 0, 0, top + 0.3, Math.max(W, H) * 1.45, Math.max(W, H) * 0.25, 3, 4, s) }
  else gable(b, W, H, top + 0.3, Math.min(W, H) * 0.9, s, W >= H ? 'x' : 'y')
  b.box(null, W * 0.6, H * 0.2, 0.3, 1.4, 1.4, top + Math.min(W, H) * 0.9 + 1.2, STONE)
  return top + Math.min(W, H) * 0.9 + 1.5
}

function castleKeep(b: MeshBuilder, W: number, H: number, l: HotelLook, p: Vec3, s: Vec3, t: Vec3) {
  const top = l.floors * FLOOR_HEIGHT
  b.box(null, 0, 0, 0.3, W * 2 - 2, H * 2 - 2, top, p)
  windows(b, W - 1, H - 1, 0.3, l.floors, GLASS, 2.6, 0.6)
  for (let x = -W + 1.4; x <= W - 1.4; x += 1.4) for (const y of [-H + 1, H - 1]) b.box(null, x, y, top + 0.3, 0.7, 0.4, 0.8, p)
  for (let y = -H + 1.4; y <= H - 1.4; y += 1.4) for (const x of [-W + 1, W - 1]) b.box(null, x, y, top + 0.3, 0.4, 0.7, 0.8, p)
  for (const x of [-W + 1.3, W - 1.3]) for (const y of [-H + 1.3, H - 1.3]) {
    b.cylinder(null, x, y, 0.3, 1.5, 1.5, top + 2.6, 12, shade(p, 0.93))
    if (l.roof === 'cone') b.cylinder(null, x, y, top + 2.9, 1.8, 0, 3.6, 12, s)
    else for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; if (k % 2 === 0) b.box(null, x + Math.cos(a) * 1.3, y + Math.sin(a) * 1.3, top + 2.9, 0.6, 0.6, 0.8, p) }
  }
  b.box(null, 0, -H + 0.95, 0.3, 2.4, 0.2, 3.4, shade(s, 0.6))
  for (const x of [-W * 0.45, W * 0.45]) { b.box(null, x, -H + 0.9, top - 3.2, 1.2, 0.08, 3, t); b.box(null, x, -H + 0.88, top - 3.2, 1.25, 0.06, 0.4, s) }
  return top + (l.roof === 'cone' ? 6.5 : 3.7)
}

function canopyTreehouses(b: MeshBuilder, W: number, H: number, l: HotelLook, p: Vec3, s: Vec3, t: Vec3) {
  b.box(null, 0, 0, 0.05, W * 2, H * 2, 0.25, hexColor('#6d8f45'))
  const spots: [number, number][] = []
  const gapX = (W * 2 - 5) / Math.max(1, Math.round((W * 2 - 5) / 9)), gapY = (H * 2 - 5) / Math.max(1, Math.round((H * 2 - 5) / 9))
  for (let x = -W + 2.5; x <= W - 2.4; x += gapX) for (let y = -H + 2.5; y <= H - 2.4; y += gapY) spots.push([x, y])
  if (!spots.length) spots.push([0, 0])
  const deck = 6
  for (const [x, y] of spots) {
    b.cylinder(null, x, y, 0.3, 0.7, 0.45, deck + l.floors * FLOOR_HEIGHT + 3, 8, BARK)
    b.cylinder(null, x, y, deck, 2.2, 2.2, 0.25, 10, C.wood)
    thatchHut(b, x, y, deck + 0.25, 2.6, l.floors, p, s, t)
    b.sphere(null, x + 1.4, y - 1.2, deck + l.floors * FLOOR_HEIGHT + 2.6, 2.2, LEAF, 0, 5, 8, 0.8, 0.2)
    b.sphere(null, x - 1.2, y + 1.4, deck + l.floors * FLOOR_HEIGHT + 3.4, 2, shade(LEAF, 0.85), 0, 5, 8, 0.8, 0.2)
  }
  for (let k = 0; k < spots.length - 1; k++) {
    const [ax, ay] = spots[k], [bx, by] = spots[k + 1], len = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax)
    b.box(mat4.chain(T((ax + bx) / 2, (ay + by) / 2, deck + 0.1), mat4.rotZ(ang)), 0, 0, 0, len, 0.7, 0.08, C.wood)
    for (const side of [-0.35, 0.35]) b.box(mat4.chain(T((ax + bx) / 2, (ay + by) / 2, deck + 1), mat4.rotZ(ang)), 0, side, 0, len, 0.04, 0.04, t)
  }
  const [lx, ly] = spots[0]
  for (let z = 0.6; z < deck; z += 0.6) b.box(null, lx - 1.4, ly - 1.4, z, 0.6, 0.1, 0.06, C.wood)
  return deck + l.floors * FLOOR_HEIGHT + 5
}

function lagoonVillas(b: MeshBuilder, W: number, H: number, l: HotelLook, p: Vec3, s: Vec3, t: Vec3) {
  b.box(null, 0, 0, 0.05, W * 2, H * 2, 0.15, SAND)
  b.quad(null, [-W + 0.6, -H + 0.6, 0.32], [W - 0.6, -H + 0.6, 0.32], [W - 0.6, H - 0.6, 0.32], [-W + 0.6, H - 0.6, 0.32], WATER)
  b.box(null, 0, -H + 1.4, 1.2, 1.4, H * 2 - 2.4, 0.2, C.wood)
  b.box(null, 0, -H + 0.9, 1.2, 1.4, 1, 0.2, C.wood)
  const n = Math.max(2, Math.floor((H * 2 - 3) / 4.2))
  for (let k = 0; k < n; k++) for (const side of [-1, 1]) {
    const y = -H + 3.4 + k * 4.2, x = side * Math.min(W - 2.4, 3.6)
    if (y > H - 1.8) continue
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) b.box(null, x + dx * 1.1, y + dy * 1.1, 0.2, 0.18, 0.18, 1.1, C.wood)
    b.box(null, (x + 0) / 2, y, 1.2, Math.abs(x) - 0.4, 0.8, 0.15, C.wood)
    b.box(null, x, y, 1.2, 3, 3, 0.2, C.wood)
    thatchHut(b, x, y, 1.4, 2.6, l.floors, p, s, t)
    b.quad(null, [x + side * 1.6 - 0.6, y - 0.9, 1.36], [x + side * 1.6 + 0.6, y - 0.9, 1.36], [x + side * 1.6 + 0.6, y + 0.9, 1.36], [x + side * 1.6 - 0.6, y + 0.9, 1.36], hexColor('#6fd0ee'))
  }
  return l.floors * FLOOR_HEIGHT * 0.85 + 3.8
}

function neonNights(b: MeshBuilder, W: number, H: number, l: HotelLook, p: Vec3, s: Vec3, t: Vec3) {
  const top = l.floors * FLOOR_HEIGHT
  b.box(null, 0, 0, 0.3, W * 2, H * 2, top, p)
  windows(b, W, H, 0.3, l.floors, hexColor('#f7e6a1'), 1.8, 0.3)
  for (let f = 1; f <= l.floors; f++) { const z = 0.3 + f * FLOOR_HEIGHT - 0.25; b.box(null, 0, 0, z, W * 2 + 0.12, H * 2 + 0.12, 0.12, f % 2 ? s : t) }
  for (const x of [-W, W]) for (const y of [-H, H]) b.cylinder(null, x, y, 0.3, 0.35, 0.35, top, 10, t)
  b.box(null, 0, -H - 0.3, 0.3, W * 1.2, 0.6, 2.6, s)
  b.box(null, 0, 0, top + 0.3, W * 2 + 0.2, H * 2 + 0.2, 0.3, t)
  if (l.roof === 'sign') {
    b.box(null, 0, 0, top + 0.6, 0.4, 0.4, 2.2, C.steel)
    b.box(null, 0, 0, top + 2.8, W * 1.6, 0.4, 2.6, s)
    b.box(null, 0, -0.22, top + 3.3, W * 1.3, 0.06, 1.6, t)
    return top + 5.4
  }
  return top + 0.6
}

const BUILDERS: Record<string, (b: MeshBuilder, W: number, H: number, l: HotelLook, p: Vec3, s: Vec3, t: Vec3) => number> = { motorInn, skylineTower, palmCove, timberLodge, castleKeep, canopyTreehouses, lagoonVillas, neonNights }
const TALL = new Set(['motorInn', 'skylineTower', 'timberLodge', 'castleKeep', 'neonNights'])

export function hotelModel(l: HotelLook): MeshBuilder {
  const b = new MeshBuilder()
  const W = l.w * 2 - 0.25, H = l.h * 2 - 0.25
  const p = rgb(l.primary), s = rgb(l.secondary), t = rgb(l.trim)
  const build = BUILDERS[l.kind] ?? motorInn
  const top = build(b, W, H, l, p, s, t)
  const roofZ = l.kind === 'skylineTower' ? FLOOR_HEIGHT * 1.5 + l.floors * FLOOR_HEIGHT + 0.3 : l.floors * FLOOR_HEIGHT + 0.3
  const flatRoof = TALL.has(l.kind) && (l.roof === 'flat' || l.roof === 'battlement' || l.roof === 'crown' || l.roof === 'sign')
  if (l.addons.pool && TALL.has(l.kind) && flatRoof) {
    const pw = (l.kind === 'skylineTower' ? W * 0.78 : W) * 0.55, ph = (l.kind === 'skylineTower' ? H * 0.78 : H) * 0.5
    const z = roofZ + (l.kind === 'skylineTower' ? 0.4 : 0.25)
    b.box(null, -pw * 0.3, 0, z, pw * 1.3 + 0.4, ph * 1.3 + 0.4, 0.25, C.white)
    b.quad(null, [-pw * 0.3 - pw * 0.65, -ph * 0.65, z + 0.27], [-pw * 0.3 + pw * 0.65, -ph * 0.65, z + 0.27], [-pw * 0.3 + pw * 0.65, ph * 0.65, z + 0.27], [-pw * 0.3 - pw * 0.65, ph * 0.65, z + 0.27], WATER)
  } else if (l.addons.pool) {
    b.box(null, W - 2, H - 2, 0.32, 3, 2.4, 0.06, WATER)
  }
  if (l.addons.sign && l.kind !== 'neonNights') {
    const z = Math.min(top, roofZ + 0.3)
    b.box(null, -W * 0.5, -H - 0.1, z, 0.3, 0.3, 1.4, C.steel)
    b.box(null, -W * 0.5, -H - 0.1, z + 1.4, W * 0.9, 0.3, 1.6, t)
    b.box(null, -W * 0.5, -H - 0.28, z + 1.7, W * 0.7, 0.06, 1, s)
  }
  if (l.addons.balconies && TALL.has(l.kind)) {
    const bw = l.kind === 'skylineTower' ? W * 0.78 : W, bh = l.kind === 'skylineTower' ? H * 0.78 : H, z0 = l.kind === 'skylineTower' ? FLOOR_HEIGHT * 1.5 + 0.3 : 0.3
    for (let f = 1; f < l.floors; f++) for (let x = -bw + 1.2; x <= bw - 1.2; x += 2.4) {
      const z = z0 + f * FLOOR_HEIGHT
      b.box(null, x, -bh - 0.45, z, 1.8, 0.9, 0.12, C.white)
      b.box(null, x, -bh - 0.88, z + 0.12, 1.8, 0.05, 0.8, t)
    }
  }
  if (l.addons.canopy) {
    const [cx, cy, rot] = l.front === 0 ? [W, 0, 0] : l.front === 1 ? [0, H, Math.PI / 2] : l.front === 2 ? [-W, 0, Math.PI] : [0, -H, -Math.PI / 2]
    const m = mat4.chain(T(cx, cy, 0), mat4.rotZ(rot))
    b.box(m, 1.1, 0, 2.7, 2.4, 3, 0.18, s)
    for (const y of [-1.3, 1.3]) b.box(m, 2.2, y, 0.3, 0.12, 0.12, 2.4, C.steel)
  }
  return b
}

export function hotelLook(e: { kind?: string; size?: [number, number]; floors?: number; colors?: { primary: number; secondary: number; trim: number }; roof?: string; addons?: Record<string, boolean>; entrance?: { x: number; y: number } | null; x: number; y: number }, defaults: { primary: number; secondary: number; trim: number }, roof: string): HotelLook {
  const [w, h] = e.size ?? [3, 3]
  let front: 0 | 1 | 2 | 3 = 3
  if (e.entrance) front = e.entrance.x >= e.x + w ? 0 : e.entrance.y >= e.y + h ? 1 : e.entrance.x < e.x ? 2 : 3
  return { kind: e.kind ?? 'motorInn', w, h, floors: e.floors ?? 1, ...(e.colors ?? defaults), roof: e.roof ?? roof, addons: e.addons ?? {}, front }
}
