import { MeshBuilder, STRIDE, hexColor } from './gl'
import type { Vec3 } from './gl'
import { C } from './models'
import type { RideModel } from './models'
import { SLOT, LIGHTS, GLOW, bulb, bulbRing, bulbRun, neonTube, neonFrame } from './neon'

type Remap = { color: Vec3; slot: number; any?: boolean }
const key = (c: Vec3) => (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255)

/** Moves surfaces of the given base colors onto color slots (white base so the slot color shows as picked). */
function slotify(b: MeshBuilder, remaps: Remap[]) {
  const table = new Map(remaps.map(r => [key(r.color), r]))
  const d = b.data
  for (let i = 0; i < d.length; i += STRIDE) {
    if (d[i + 10] === 20) continue
    const r = table.get(key([d[i + 6], d[i + 7], d[i + 8]]))
    if (!r || (!r.any && d[i + 9] > 0.5)) continue
    d[i + 6] = 1; d[i + 7] = 1; d[i + 8] = 1; d[i + 9] = SLOT[r.slot]
  }
}

const R = (hex: string | Vec3, slot: number, any = false): Remap => ({ color: typeof hex === 'string' ? hexColor(hex) : hex, slot, any })

const REMAPS: Record<string, Remap[]> = {
  carousel: [R(C.white, 3), R('#b9824f', 4, true), R(C.gold, 5), R('#c9a27a', 5)],
  teacups: [R(C.white, 3), R('#7fb9d8', 4, true), R(C.gold, 5)],
  ferris: [R('#f0f0f0', 3, true), R(C.white, 4), R(C.dark, 5)],
  swings: [R(C.red, 3), R(C.blue, 4), R(C.gold, 5)],
  bumper: [R(C.white, 3), R(C.dark, 4), R(C.gold, 5)],
  ship: [R('#7a4a2c', 3), R(C.dark, 4), R('#b98a5c', 5), R('#5b341c', 3)],
  dropTower: [R(C.gold, 3), R(C.red, 4), R(C.dark, 5)],
  topSpin: [R(C.red, 3), R(C.white, 4, true), R(C.stone, 5)],
  karts: [R('#3b3e44', 3), R('#5f9f45', 4), R(C.red, 5)],
  pool: [R(C.cream, 3), R('#6ccaf5', 4), R('#36a3e0', 4), R(C.white, 5), R(C.red, 0)],
  waterslide: [R(C.cream, 3), R(C.wood, 3), R('#f2c94c', 5)],
  zipper: [R(C.white, 3, true), R(C.steel, 4), R(C.gold, 5)],
}

const ring = (r: number, z: number, n = 48): Vec3[] => Array.from({ length: n + 1 }, (_, i) => { const a = i / n * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r, z] as Vec3 })

/** Footprint-edge marquee: chase bulbs around the pad plus a glow tube. */
function padLights(b: MeshBuilder, w: number, h: number, round: number) {
  if (round > 0) {
    bulbRing(b, null, 0, 0, 0.45, round + 0.15, Math.round(round * 7), 0.09, LIGHTS, 4, 0, 0)
    neonTube(b, ring(round + 0.32, 0.12), 0.06, GLOW, 5)
    return
  }
  const W = w * 2 - 0.25, H = h * 2 - 0.25
  const corners: Vec3[] = [[-W, -H, 0.35], [W, -H, 0.35], [W, H, 0.35], [-W, H, 0.35]]
  for (let i = 0; i < 4; i++) {
    const a = corners[i], c = corners[(i + 1) % 4], len = Math.hypot(c[0] - a[0], c[1] - a[1])
    bulbRun(b, null, a, c, Math.max(4, Math.round(len * 1.6)), 0.08, LIGHTS, len / 6, i * 0.25, 0)
  }
  neonTube(b, [...corners.map(p => [p[0], p[1], 0.1] as Vec3), [corners[0][0], corners[0][1], 0.1]], 0.05, GLOW, 5)
}

const ROUND: Record<string, number> = { carousel: 5.4, teacups: 5.6, swings: 5.6, dropTower: 4.8, zipper: 7.5 }

function rideSpecific(kind: string, m: RideModel, w: number, h: number) {
  const base = m.base, part = (i: number) => m.parts[i]?.builder
  if (kind === 'carousel') {
    const top = part(0)!
    bulbRing(top, null, 0, 0, 4.0, 5.38, 48, 0.1, LIGHTS, 4, 0, 1)
    bulbRing(top, null, 0, 0, 4.6, 5.38, 48, 0.1, LIGHTS, 4, 0.06, 1)
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; bulbRun(top, null, [Math.cos(a) * 5.2, Math.sin(a) * 5.2, 4.7], [Math.cos(a) * 0.5, Math.sin(a) * 0.5, 6.5], 7, 0.08, GLOW, 1, 0, 0) }
    bulb(top, null, 0, 0, 7.25, 0.22, GLOW)
  } else if (kind === 'teacups') {
    bulbRing(part(0)!, null, 0, 0, 0.62, 5.0, 40, 0.09, GLOW, 5, 0, 0)
    neonTube(base, ring(5.65, 0.42), 0.06, LIGHTS, 5)
  } else if (kind === 'ferris') {
    const wheel = part(0)!
    for (const y of [-1.55, 1.55]) {
      for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; bulb(wheel, null, Math.cos(a) * 7.4, y, Math.sin(a) * 7.4, 0.12, LIGHTS, (i * 4 / 40) % 1, 0) }
      for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; for (let i = 1; i <= 5; i++) { const r = i / 5 * 7.1; bulb(wheel, null, Math.cos(a) * r, y, Math.sin(a) * r, 0.09, GLOW, (i / 5) % 1, 0) } }
    }
    bulb(wheel, null, 0, 1.7, 0, 0.35, GLOW)
    bulb(wheel, null, 0, -1.7, 0, 0.35, GLOW)
  } else if (kind === 'swings') {
    const crown = part(0)!
    bulbRing(crown, null, 0, 0, 9.5, 3.65, 36, 0.11, LIGHTS, 3, 0, 1)
    bulbRing(crown, null, 0, 0, 10.0, 3.3, 32, 0.1, LIGHTS, 3, 0.1, 1)
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; bulbRun(crown, null, [Math.cos(a) * 3.15, Math.sin(a) * 3.15, 10.15], [Math.cos(a) * 0.4, Math.sin(a) * 0.4, 11.6], 6, 0.08, GLOW, 1, 0, 0) }
    bulbRun(base, null, [0.62, 0, 0.6], [0.47, 0, 10.2], 18, 0.09, GLOW, 2, 0, 0)
    bulbRun(base, null, [-0.62, 0, 0.6], [-0.47, 0, 10.2], 18, 0.09, GLOW, 2, 0.5, 0)
  } else if (kind === 'bumper') {
    const S = w * 2 - 0.4, z = 4.3, E = S + 0.32
    const c: Vec3[] = [[-E, -E, z], [E, -E, z], [E, E, z], [-E, E, z]]
    for (let i = 0; i < 4; i++) bulbRun(base, null, c[i], c[(i + 1) % 4], 26, 0.1, LIGHTS, 3, i * 0.25, 0)
    neonFrame(base, 0, 0, 3.95, S * 2 - 0.4, S * 2 - 0.4, 0.06, GLOW, 0.8)
    for (const x of [-S + 0.3, S - 0.3]) for (const y of [-S + 0.3, S - 0.3]) bulbRun(base, null, [x, y, 0.5], [x, y, 3.8], 9, 0.08, GLOW, 1, 0, 0)
  } else if (kind === 'ship') {
    const hull = part(0)!
    for (const s of [-1, 1]) bulbRun(hull, null, [-6.8, s * 2.35, -6.35], [6.8, s * 2.35, -6.35], 26, 0.1, LIGHTS, 3, 0, 0)
    bulbRun(hull, null, [-3, 0.15, -3], [0, 0.15, -0.2], 8, 0.08, GLOW, 1, 0, 0)
    bulbRun(hull, null, [3, 0.15, -3], [0, 0.15, -0.2], 8, 0.08, GLOW, 1, 0, 0)
    for (const x of [-1.5, 1.5]) for (const y of [-4.5, 4.5]) bulbRun(base, null, [x * 2.2, y, 0.6], [0, y * 0.9, 10.6], 14, 0.09, GLOW, 1, 0, 0)
  } else if (kind === 'dropTower') {
    for (const [x, y] of [[0.85, 0.85], [-0.85, 0.85], [0.85, -0.85], [-0.85, -0.85]] as const) bulbRun(base, null, [x, y, 0.6], [x, y, 36.2], 44, 0.11, LIGHTS, 3, 0, 0)
    for (let z = 4; z < 36; z += 4) neonFrame(base, 0, 0, z, 1.72, 1.72, 0.05, GLOW, 0.2)
    bulbRing(base, null, 0, 0, 36.5, 1.45, 16, 0.12, GLOW, 2, 0, 0)
    bulb(base, null, 0, 0, 38.8, 0.3, LIGHTS)
    bulbRing(part(0)!, null, 0, 0, 1.05, 2.85, 28, 0.1, LIGHTS, 2, 0, 0)
  } else if (kind === 'topSpin') {
    const arm = part(0)!, gondola = part(1)!
    for (const y of [-3.3, 3.3]) { bulbRun(arm, null, [0.32, y, -0.1], [0.32, y, -5], 10, 0.09, LIGHTS, 1, 0, 0); bulbRun(arm, null, [-0.32, y, -0.1], [-0.32, y, -5], 10, 0.09, LIGHTS, 1, 0.5, 0) }
    bulbRun(gondola, null, [1.12, -2.7, 0.75], [1.12, 2.7, 0.75], 16, 0.09, GLOW, 2, 0, 0)
    bulbRun(gondola, null, [-1.12, -2.7, 0.75], [-1.12, 2.7, 0.75], 16, 0.09, GLOW, 2, 0.5, 0)
    for (const y of [-3.4, 3.4]) for (const x of [-0.62, 0.62]) bulbRun(base, null, [x, y, 0.6], [x, y, 7.6], 12, 0.09, GLOW, 1, 0, 0)
  } else if (kind === 'karts') {
    neonFrame(base, 0, -0.2, 2.72, 4.1, 2.1, 0.06, GLOW, 0.4)
    bulbRun(base, null, [-2, -1.25, 2.6], [2, -1.25, 2.6], 12, 0.09, LIGHTS, 1, 0, 0)
  } else if (kind === 'pool') {
    const W = w * 2 - 0.3, H = h * 2 - 0.3, pw = W - 2.4, ph = H - 2.6
    neonFrame(base, 0, 0, 0.3, pw * 2 - 0.4, ph * 2 - 0.4, 0.07, GLOW, 0.3)
  } else if (kind === 'waterslide') {
    const S = w * 2 - 0.3, tx = -S + 2.4, ty = -S + 2.4
    for (const dx of [-1.25, 1.25]) bulbRun(base, null, [tx + dx, ty - 1.25, 0.5], [tx + dx, ty - 1.25, 12.4], 16, 0.09, LIGHTS, 2, 0, 0)
    neonFrame(base, tx, ty, 12.8, 3.1, 3.1, 0.06, GLOW, 0.3)
  } else if (kind === 'zipper') {
    const wheel = part(0)!
    const pointOnFrame = (a: number): Vec3 => { const x = Math.cos(a), z = Math.sin(a), e = 0.58; return [4.1 * Math.sign(x) * Math.abs(x) ** e, 0, 5.4 * Math.sign(z) * Math.abs(z) ** e] }
    for (const y of [-1.28, 1.28]) for (let i = 0; i < 40; i++) { const p = pointOnFrame(i / 40 * Math.PI * 2); bulb(wheel, null, p[0], y, p[2], 0.11, LIGHTS, (i * 3 / 40) % 1, 0) }
    for (const y of [-1.3, 1.3]) for (const x of [-4.7, 4.7]) bulbRun(base, null, [x, y + Math.sign(y) * 0.38, 0.7], [0, y + Math.sign(y) * 0.38, 8.2], 14, 0.09, GLOW, 1, 0, 0)
  }
  void h
}

/** Adds color slots and neon lights to a flat or water ride model. */
export function decorateRide(kind: string, m: RideModel, w: number, h: number) {
  if (kind === 'gravitron') return m
  const remaps = REMAPS[kind]
  if (remaps) { slotify(m.base, remaps); for (const p of m.parts) slotify(p.builder, remaps) }
  rideSpecific(kind, m, w, h)
  padLights(m.base, w, h, ROUND[kind] ?? 0)
  return m
}
