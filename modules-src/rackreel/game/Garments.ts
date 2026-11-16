/**
 * Clothes drawn from the body's own shape instead of painted textures: every outfit is a function from a point on the
 * hunter (where it is on the torso, how far down the arm or the leg, how much of it is hand or foot) to a colour. The
 * painter (`Tailor.ts`) runs it for every texel of the body's texture atlas, so patterns, hems, cuffs, collars and
 * numbers follow the body across the atlas's seams and nothing smears. Renderer-free and deterministic.
 */

export type RGB = [number, number, number]

/** One point on the body, in the model's frame at its reference pose: metres, y up, the hunter facing +z, his left at +x. */
export interface BodyPoint {
  x: number
  y: number
  z: number
  /** Metres along the arm from the shoulder joint (negative over the shoulder, past `arm` on the hand). */
  armT: number
  /** Metres down the leg from the hip joint. */
  legT: number
  /** Skin weights summed per region, 0..1. */
  wArm: number
  wHand: number
  wFoot: number
  /** Distance from the arm's bones (the nearer arm). */
  armD: number
}

/** Heights and lengths of this body, measured once from its joints and mesh. */
export interface BodyFrame {
  /** Shoulder joints' height and their distance from the middle. */
  shoulderY: number
  shoulderX: number
  /** Where the upper garment's mesh meets the neck (its highest point at the front). */
  collarY: number
  /** The neck's radius just above the neckline, round the neck joint at (`neckX`, `neckZ`). */
  neckR: number
  neckX: number
  neckZ: number
  /** Where the upper and lower garments meet. */
  hemY: number
  /** Shoulder to wrist, and the elbow along it. */
  arm: number
  elbow: number
  /** Hip joint to ankle, and the knee along it. */
  leg: number
  knee: number
  ankleY: number
  /** Average colour of the scanned hands, for bare arms and legs. */
  skin: RGB
}

/** Writes the colour at a point into `out`; `hand` and `boot` are the scanned hands' and boots' colours there. */
export type Shade = (p: BodyPoint, f: BodyFrame, out: RGB, hand: RGB, boot: RGB) => void

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v)
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const mix = (out: RGB, c: RGB, k: number) => {
  out[0] += (c[0] - out[0]) * k
  out[1] += (c[1] - out[1]) * k
  out[2] += (c[2] - out[2]) * k
}
const set = (out: RGB, c: RGB, k = 1) => {
  out[0] = c[0] * k
  out[1] = c[1] * k
  out[2] = c[2] * k
}
const hex = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]

function hash(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/** Smooth 3D value noise, 0..1. */
export function noise(x: number, y: number, z: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const w = zf * zf * (3 - 2 * zf)
  const a = hash(xi, yi, zi) + (hash(xi + 1, yi, zi) - hash(xi, yi, zi)) * u
  const b = hash(xi, yi + 1, zi) + (hash(xi + 1, yi + 1, zi) - hash(xi, yi + 1, zi)) * u
  const c = hash(xi, yi, zi + 1) + (hash(xi + 1, yi, zi + 1) - hash(xi, yi, zi + 1)) * u
  const d = hash(xi, yi + 1, zi + 1) + (hash(xi + 1, yi + 1, zi + 1) - hash(xi, yi + 1, zi + 1)) * u
  const e = a + (b - a) * v
  const g = c + (d - c) * v
  return e + (g - e) * w
}

const fbm = (x: number, y: number, z: number) => noise(x, y, z) * 0.55 + noise(x * 2.1, y * 2.1, z * 2.1) * 0.3 + noise(x * 4.3, y * 4.3, z * 4.3) * 0.15

/** Fine fabric grain: a light, even mottle so flat colours read as cloth. */
function grain(p: BodyPoint, out: RGB, amount: number, scale = 260): void {
  const n = 1 + (noise(p.x * scale, p.y * scale, p.z * scale) - 0.5) * amount + (noise(p.x * 41, p.y * 41, p.z * 41) - 0.5) * amount * 0.5
  out[0] *= n
  out[1] *= n
  out[2] *= n
}

type Fabric = (p: BodyPoint, out: RGB) => void

const solid = (c: RGB, amount = 0.07): Fabric => (p, out) => {
  set(out, c)
  grain(p, out, amount)
}
const heather = (c: RGB): Fabric => (p, out) => {
  set(out, c)
  const n = noise(p.x * 520, p.y * 90, p.z * 520)
  const k = 0.86 + n * 0.26
  out[0] *= k
  out[1] *= k
  out[2] *= k
}
const denim = (c: RGB, fade = 0.12): Fabric => (p, out) => {
  set(out, c)
  const twill = Math.sin((p.y * 1.0 + p.x * 0.6 + p.z * 0.6) * 1700) * 0.04
  const streak = (noise(p.x * 180, p.y * 9, p.z * 180) - 0.5) * 0.22
  const worn = smooth(0.4, 0.8, fbm(p.x * 9, p.y * 5, p.z * 9)) * fade
  const k = 1 + twill + streak + worn
  out[0] *= k
  out[1] *= k
  out[2] *= k * 0.98
}
const plaid = (a: RGB, b: RGB, line: RGB): Fabric => (p, out) => {
  const bx = Math.sin(p.x * 52 + p.z * 52) > 0.25 ? 1 : 0
  const by = Math.sin(p.y * 52) > 0.25 ? 1 : 0
  set(out, a)
  if (bx && by) set(out, b)
  else if (bx || by) mix(out, b, 0.55)
  const thin = Math.abs(Math.sin(p.y * 104 + 1.3)) < 0.06 || Math.abs(Math.sin((p.x + p.z) * 104 + 1.3)) < 0.06
  if (thin) mix(out, line, 0.6)
  grain(p, out, 0.1)
}
const camo = (cols: RGB[]): Fabric => (p, out) => {
  const n = fbm(p.x * 9 + 3.1, p.y * 7, p.z * 9 - 1.7)
  const m = fbm(p.x * 14 - 5, p.y * 11 + 2, p.z * 14)
  set(out, cols[0])
  if (n > 0.52) set(out, cols[1])
  if (m > 0.58) set(out, cols[2])
  if (n < 0.36) set(out, cols[3])
  grain(p, out, 0.09)
}
const knit = (c: RGB): Fabric => (p, out) => {
  set(out, c)
  const around = Math.atan2(p.x, p.z)
  const rib = Math.abs(Math.sin(around * 70 + p.x * 40)) * 0.1
  const cable = Math.abs(p.x) < 0.11 && p.z > 0 ? Math.abs(Math.sin(p.y * 90 + Math.abs(p.x) * 60)) * 0.12 : 0
  const k = 0.93 + rib - cable * 0.6
  out[0] *= k
  out[1] *= k
  out[2] *= k
  grain(p, out, 0.06)
}
const mesh = (c: RGB): Fabric => (p, out) => {
  set(out, c)
  const holes = noise(p.x * 900, p.y * 900, p.z * 900) > 0.72 ? 0.9 : 1
  out[0] *= holes
  out[1] *= holes
  out[2] *= holes
  grain(p, out, 0.05)
}

/** How a top is cut: sleeve length (metres from the shoulder, 0 = sleeveless), and the trims. */
interface TopCut {
  fabric: Fabric
  /** Sleeve length in metres; `long` reaches the wrist. */
  sleeve: number | 'long'
  /** Sleeveless with a deep armhole (tank, jersey). */
  armhole?: number
  /** Depth of the neckline below the collar at the front. */
  scoop?: number
  rib?: RGB
  collar?: RGB
  placket?: RGB
  buttons?: RGB
  pocket?: 'kangaroo' | 'chest'
  strings?: RGB
  open?: Fabric
  trim?: RGB
  number?: Glyphs
  numberColor?: RGB
  numberEdge?: RGB
  raglan?: Fabric
  quilt?: boolean
  /** Tucked in: the waist line sits at the belt instead of the shirt hanging over it. */
  tuck?: boolean
  /** Buttons or a zip all the way down the front. */
  full?: boolean
}

/** Digits drawn into a small alpha grid by the host (canvas text), sampled in the jersey's front and back planes. */
export interface Glyphs {
  size: number
  alpha: Uint8Array
}

const SKIN_SHADOW: RGB = [0.82, 0.8, 0.8]

/** Bare skin (arms, legs, a deep neckline): the hands' own colour with a soft mottle. */
function skin(p: BodyPoint, f: BodyFrame, out: RGB): void {
  set(out, f.skin)
  const n = (fbm(p.x * 40, p.y * 40, p.z * 40) - 0.5) * 0.08
  out[0] *= 1 + n
  out[1] *= 1 + n * 1.1
  out[2] *= 1 + n * 1.2
}

function glyph(g: Glyphs, u: number, v: number): number {
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0
  return g.alpha[Math.floor(v * g.size) * g.size + Math.floor(u * g.size)] / 255
}

/** The sleeve end in metres along the arm, or null when the top has no sleeve there (bare from the armhole). */
function sleeveEnd(cut: TopCut, f: BodyFrame): number {
  return cut.sleeve === 'long' ? f.arm - 0.012 : cut.sleeve
}

function makeTop(cut: TopCut): Shade {
  return (p, f, out, hand) => {
    const ax = Math.abs(p.x)
    if (p.armT > f.arm + 0.035 && p.wHand > 0.8) {
      set(out, hand)
      return
    }
    if (p.armT > f.arm - 0.012 && (p.wHand > 0.3 || p.armD < 0.06)) {
      skin(p, f, out)
      if (p.armT > f.arm + 0.015) mix(out, hand, smooth(f.arm + 0.015, f.arm + 0.035, p.armT) * smooth(0.6, 0.85, p.wHand))
      return
    }
    const onArm = p.wArm > 0.6 || (p.armT > 0.05 && p.armD < 0.075)
    const end = sleeveEnd(cut, f)
    if (onArm && p.armT > end) {
      skin(p, f, out)
      const cuffShadow = smooth(end + 0.025, end, p.armT)
      if (end > 0) mix(out, [out[0] * SKIN_SHADOW[0], out[1] * SKIN_SHADOW[1], out[2] * SKIN_SHADOW[2]], cuffShadow)
      return
    }
    if (cut.armhole) {
      const dy = (p.y - (f.shoulderY - cut.armhole * 0.55)) / cut.armhole
      const dz = p.z / (p.z < 0 ? 0.15 : 0.1)
      const outside = ax > f.shoulderX - 0.075
      if ((outside && dy * dy + dz * dz < 1) || (onArm && end <= 0)) {
        skin(p, f, out)
        return
      }
    }
    const fromCollar = f.collarY - p.y
    const neckR = Math.hypot(p.x - f.neckX, p.z - f.neckZ)
    if (fromCollar < 0.008 && !onArm && neckR < f.neckR + 0.03 + Math.max(0, -fromCollar - 0.02) * 4) {
      skin(p, f, out)
      return
    }
    if (cut.scoop && p.z > 0.02) {
      const depth = cut.scoop * clamp(1 - (ax / 0.11) ** 2)
      if (fromCollar < depth - 0.012 && fromCollar > -0.05) {
        skin(p, f, out)
        return
      }
    }
    const raglanSleeve = cut.raglan && (onArm || ax > f.shoulderX - 0.07 + (f.shoulderY - p.y) * 0.9) && p.y > f.shoulderY - 0.17
    ;(raglanSleeve ? cut.raglan! : cut.fabric)(p, out)
    if (cut.open && p.z > 0.04 && ax < 0.06 && fromCollar < 0.45) cut.open(p, out)
    if (cut.quilt) {
      const q = Math.abs(Math.sin(p.y * 45))
      if (q < 0.08) {
        out[0] *= 0.8
        out[1] *= 0.8
        out[2] *= 0.8
      }
    }
    if (onArm && end > 0 && p.armT > end - 0.022) {
      if (cut.rib) set(out, cut.rib)
      out[0] *= 0.9
      out[1] *= 0.9
      out[2] *= 0.9
    }
    if (cut.trim && cut.armhole) {
      const dy = (p.y - (f.shoulderY - cut.armhole * 0.55)) / cut.armhole
      const dz = p.z / (p.z < 0 ? 0.15 : 0.1)
      const r = dy * dy + dz * dz
      if (ax > f.shoulderX - 0.09 && r < 1.45) set(out, cut.trim)
    }
    if (cut.scoop && cut.trim && p.z > 0.02) {
      const depth = cut.scoop * clamp(1 - (ax / 0.11) ** 2)
      if (fromCollar < depth + 0.012) set(out, cut.trim)
    }
    if (fromCollar < 0.032 && !cut.scoop && neckR < f.neckR + 0.055) {
      if (cut.collar) set(out, cut.collar)
      else if (cut.rib) set(out, cut.rib)
      out[0] *= 0.93
      out[1] *= 0.93
      out[2] *= 0.93
    }
    if (cut.placket && p.z > 0.05 && ax < 0.016 && fromCollar < (cut.pocket === 'chest' || cut.full ? 0.6 : 0.13)) {
      mix(out, cut.placket, 0.6)
      if (ax > 0.013) mix(out, [0, 0, 0], 0.25)
      if (cut.buttons && ax < 0.006 && Math.abs(((fromCollar - 0.04) % 0.085) - 0.0425) > 0.035) set(out, cut.buttons)
    }
    if (cut.pocket === 'kangaroo' && p.z > 0.03 && ax < 0.14 && p.y > f.hemY + 0.03 && p.y < f.hemY + 0.19) {
      out[0] *= 0.94
      out[1] *= 0.94
      out[2] *= 0.94
      const edge = Math.abs(ax - 0.14 + (p.y - f.hemY - 0.03) * 0.25) < 0.006 || Math.abs(p.y - f.hemY - 0.19) < 0.005
      if (edge) {
        out[0] *= 0.8
        out[1] *= 0.8
        out[2] *= 0.8
      }
    }
    if (cut.pocket === 'chest' && p.z > 0.05 && p.x > 0.04 && p.x < 0.13 && fromCollar > 0.11 && fromCollar < 0.22) {
      const edge = p.x < 0.046 || p.x > 0.124 || fromCollar < 0.116 || fromCollar > 0.214 || Math.abs(fromCollar - 0.14) < 0.004
      if (edge) {
        out[0] *= 0.82
        out[1] *= 0.82
        out[2] *= 0.82
      }
    }
    if (cut.strings && p.z > 0.06 && Math.abs(ax - 0.04) < 0.005 && fromCollar < 0.2) set(out, cut.strings)
    if (cut.number && !onArm) {
      const front = p.z > 0.03
      const back = p.z < -0.03
      if (front || back) {
        const w = front ? 0.15 : 0.22
        const top = front ? f.collarY - 0.14 : f.collarY - 0.12
        const u = (front ? -p.x : p.x) / w + 0.5
        const v = (top - p.y) / (w * 0.9)
        const edge = glyph(cut.number, u, v)
        const fill = glyph(cut.number, (u - 0.5) * 1.12 + 0.5, (v - 0.5) * 1.12 + 0.5)
        if (cut.numberEdge && edge > 0.5) set(out, cut.numberEdge)
        if (fill > 0.5) set(out, cut.numberColor ?? [1, 1, 1])
      }
    }
    if (p.y < f.hemY + 0.02) {
      out[0] *= 0.9
      out[1] *= 0.9
      out[2] *= 0.9
    }
  }
}

/** A vest drawn over whatever top is under it (torso only, open down the front). */
function withVest(top: Shade, fabric: Fabric, pockets: boolean): Shade {
  return (p, f, out, hand, boot) => {
    const ax = Math.abs(p.x)
    const onArm = p.wArm > 0.5 || (p.armT > 0.03 && p.armD < 0.08) || p.wHand > 0.3
    const opening = p.z > 0.05 && ax < 0.03 + Math.max(0, p.y - (f.collarY - 0.22)) * 0.6
    const armhole = ax > f.shoulderX - 0.06 && p.y > f.shoulderY - 0.2
    if (onArm || opening || armhole || f.collarY - p.y < 0.02) {
      top(p, f, out, hand, boot)
      return
    }
    fabric(p, out)
    if (pockets && p.z > 0.05 && ax > 0.05 && ax < 0.16 && p.y > f.hemY + 0.06 && p.y < f.hemY + 0.32) {
      const row = (p.y - f.hemY - 0.06) % 0.09
      if (row < 0.006 || Math.abs(ax - 0.105) < 0.003) {
        out[0] *= 0.75
        out[1] *= 0.75
        out[2] *= 0.75
      }
    }
    if (ax < 0.034 + Math.max(0, p.y - (f.collarY - 0.22)) * 0.6 && p.z > 0.04) {
      out[0] *= 0.8
      out[1] *= 0.8
      out[2] *= 0.8
    }
  }
}

type Shoe = 'boots' | 'sneakers' | 'hightops' | 'rubber'

interface BottomCut {
  fabric: Fabric
  /** Leg length covered in metres down from the hip joint; `full` reaches the shoe. */
  length: number | 'full'
  shoe: Shoe
  belt?: RGB
  band?: RGB
  stripe?: RGB
  cuff?: boolean
  socks?: RGB
  sockHeight?: number
  cargo?: boolean
  pockets?: boolean
}

const WHITE: RGB = [0.92, 0.92, 0.9]

function shoe(kind: Shoe, p: BodyPoint, f: BodyFrame, out: RGB, boot: RGB): boolean {
  const top = kind === 'hightops' ? f.ankleY + 0.04 : kind === 'rubber' ? f.ankleY + 0.12 : f.ankleY - 0.035
  if (kind === 'boots') {
    if (p.y > f.ankleY + 0.05) return false
    set(out, boot)
    return true
  }
  if (p.y > top) return false
  if (kind === 'rubber') {
    set(out, [0.2, 0.23, 0.16])
    grain(p, out, 0.05)
    if (p.y < 0.025) set(out, [0.12, 0.1, 0.08])
    return true
  }
  set(out, WHITE)
  grain(p, out, 0.05)
  if (p.y < 0.03) set(out, kind === 'hightops' ? [0.85, 0.85, 0.83] : [0.62, 0.52, 0.38])
  else if (p.y < 0.036) set(out, [0.4, 0.4, 0.42])
  if (p.z > 0.02 && Math.abs(Math.abs(p.x) - 0.13) < 0.018 && p.y > 0.05 && p.y < top - 0.005 && Math.sin(p.y * 600) > 0.3) set(out, [0.95, 0.95, 0.95])
  if (kind === 'hightops' && p.y > 0.05 && Math.abs(p.z + 0.01) < 0.03) set(out, [0.75, 0.12, 0.12])
  return true
}

function makeBottom(cut: BottomCut): Shade {
  return (p, f, out, hand, boot) => {
    if (shoe(cut.shoe, p, f, out, boot)) return
    const end = cut.length === 'full' ? f.leg + 0.2 : cut.length
    if (p.legT > end) {
      const sock = cut.socks && p.y < f.ankleY + (cut.sockHeight ?? 0.06)
      if (sock) {
        set(out, cut.socks!)
        grain(p, out, 0.08, 400)
        if (p.y > f.ankleY + (cut.sockHeight ?? 0.06) - 0.012) {
          out[0] *= 0.9
          out[1] *= 0.9
          out[2] *= 0.9
        }
        return
      }
      skin(p, f, out)
      if (p.legT < end + 0.02) {
        out[0] *= 0.86
        out[1] *= 0.86
        out[2] *= 0.86
      }
      return
    }
    cut.fabric(p, out)
    if (cut.cuff && p.y < f.ankleY + 0.07) {
      out[0] *= 0.88
      out[1] *= 0.88
      out[2] *= 0.88
    }
    if (cut.length !== 'full' && p.legT > end - 0.02) {
      out[0] *= 0.88
      out[1] *= 0.88
      out[2] *= 0.88
    }
    const belt = f.hemY - p.y
    if (cut.belt && belt < 0.035 && belt > -0.03) {
      set(out, cut.belt)
      grain(p, out, 0.1)
      if (p.z > 0.06 && Math.abs(p.x) < 0.025 && belt > 0.006 && belt < 0.03) set(out, [0.7, 0.66, 0.55])
    } else if (cut.band && belt < 0.045 && belt > -0.03) {
      set(out, cut.band)
      grain(p, out, 0.06)
    }
    if (cut.stripe && Math.abs(Math.abs(p.x) - 0.17 - (f.hemY - p.y) * 0.02) < 0.012 && Math.abs(p.z) < 0.04) set(out, cut.stripe)
    if (cut.pockets && p.z > 0.04 && Math.abs(Math.abs(p.x) - 0.12 + (belt - 0.04) * 0.5) < 0.003 && belt > 0.04 && belt < 0.14) {
      out[0] *= 0.78
      out[1] *= 0.78
      out[2] *= 0.78
    }
    if (cut.cargo && Math.abs(p.z) < 0.06 && p.legT > 0.2 && p.legT < 0.32 && Math.abs(p.x) > 0.13) {
      const edge = p.legT < 0.206 || p.legT > 0.314 || Math.abs(p.z) > 0.054 || Math.abs(p.legT - 0.235) < 0.003
      out[0] *= edge ? 0.78 : 0.95
      out[1] *= edge ? 0.78 : 0.95
      out[2] *= edge ? 0.78 : 0.95
    }
  }
}

const NAVY = hex(0x1f2a44)
const RED = hex(0xb3222a)
const BLAZE = hex(0xf26a1b)

/** Every top in the catalog, keyed by jacket id. Jerseys take their number from `JERSEY_NUMBERS`. */
export const JERSEY_NUMBERS: Record<string, string> = { 'jacket-jersey-red': '23', 'jacket-jersey-white': '8', 'jacket-jersey-blue': '33' }

export function topCut(id: string, glyphs: (text: string) => Glyphs): TopCut {
  switch (id) {
    case 'jacket-camo': return { fabric: camo([hex(0x5b5a3c), hex(0x3d3a26), hex(0x2a261b), hex(0x7a6e4c)]), sleeve: 'long', collar: hex(0x3a3424), placket: hex(0x3a3424), rib: hex(0x3a3424), full: true }
    case 'jacket-flannel': return { fabric: plaid(hex(0xa3262a), hex(0x2b1a1a), hex(0x1c1414)), sleeve: 'long', collar: hex(0x8c1f23), placket: hex(0x7d1c20), buttons: hex(0xd8d0bc), pocket: 'chest' }
    case 'jacket-canvas': return { fabric: solid(hex(0xa7834f), 0.12), sleeve: 'long', collar: hex(0x4a3020), placket: hex(0x8e6d40), buttons: hex(0x3a2a1a), pocket: 'chest', rib: hex(0x8e6d40) }
    case 'jacket-blaze': return { fabric: solid(BLAZE, 0.06), sleeve: 'long', rib: hex(0x2a2a2a), collar: hex(0x2a2a2a), placket: hex(0xd85d16), quilt: true, full: true }
    case 'jacket-angler': return { fabric: heather(hex(0x8fb4cc)), sleeve: 'long', collar: hex(0x7d9fb6), placket: hex(0x7d9fb6), buttons: hex(0xe8e8e8), full: true, pocket: 'chest' }
    case 'jacket-tank': return { fabric: heather(hex(0x9a9a98)), sleeve: 0, armhole: 0.16, scoop: 0.09, trim: hex(0x888886) }
    case 'jacket-tee-white': return { fabric: solid(hex(0xeeeeea), 0.05), sleeve: 0.2, rib: hex(0xe4e4e0) }
    case 'jacket-tee-black': return { fabric: solid(hex(0x1e1e20), 0.08), sleeve: 0.2, rib: hex(0x1a1a1c) }
    case 'jacket-tee-navy': return { fabric: solid(NAVY, 0.07), sleeve: 0.2, rib: hex(0x1b243b) }
    case 'jacket-tee-heather': return { fabric: heather(hex(0x8f9092)), sleeve: 0.2, rib: hex(0x838486) }
    case 'jacket-hoodie-grey': return { fabric: heather(hex(0x8c8d90)), sleeve: 'long', rib: hex(0x7e7f82), pocket: 'kangaroo', strings: hex(0xe6e6e6), collar: hex(0x77787b) }
    case 'jacket-hoodie-black': return { fabric: solid(hex(0x202024), 0.08), sleeve: 'long', rib: hex(0x1a1a1e), pocket: 'kangaroo', strings: hex(0xcfcfcf), collar: hex(0x18181b) }
    case 'jacket-oxford': return { fabric: (p, out) => { set(out, hex(0x9fc0e0)); if (Math.sin((p.x + p.z) * 900) > 0.6) mix(out, [1, 1, 1], 0.4); grain(p, out, 0.04) }, sleeve: 'long', collar: hex(0xa8c6e4), placket: hex(0x95b6d6), buttons: hex(0xf2f2f2), pocket: 'chest', tuck: true }
    case 'jacket-polo': return { fabric: mesh(hex(0x22573b)), sleeve: 0.17, collar: hex(0x1d4d33), placket: hex(0x1b4730), buttons: hex(0xe8e8e0), rib: hex(0x1d4d33) }
    case 'jacket-denim': return { fabric: denim(hex(0x4f73a0), 0.2), sleeve: 'long', collar: hex(0x46689a), placket: hex(0x41618f), buttons: hex(0xb08a4a), pocket: 'chest', open: solid(hex(0xeeeeea), 0.05) }
    case 'jacket-sweater': return { fabric: knit(hex(0xe2d6bd)), sleeve: 'long', rib: hex(0xd5c8ae) }
    case 'jacket-jersey-red': return { fabric: mesh(RED), sleeve: 0, armhole: 0.2, scoop: 0.12, trim: hex(0xf2f2f2), number: glyphs('23'), numberColor: hex(0xf6f6f6), numberEdge: hex(0x1d1d1d) }
    case 'jacket-jersey-white': return { fabric: mesh(hex(0xf1f1ee)), sleeve: 0, armhole: 0.2, scoop: 0.12, trim: NAVY, number: glyphs('8'), numberColor: NAVY, numberEdge: hex(0xc9a227) }
    case 'jacket-jersey-blue': return { fabric: mesh(hex(0x1f4fa8)), sleeve: 0, armhole: 0.2, scoop: 0.12, trim: hex(0xf0c419), number: glyphs('33'), numberColor: hex(0xf6f6f6), numberEdge: hex(0xf0c419) }
    case 'jacket-raglan': return { fabric: solid(hex(0xeeeeea), 0.05), raglan: solid(hex(0x1d2b4d), 0.07), sleeve: 0.42, rib: hex(0x1d2b4d) }
    case 'jacket-longsleeve': return { fabric: heather(hex(0x6f7a5c)), sleeve: 'long', rib: hex(0x646e52) }
    default: return { fabric: solid(hex(0x777777)), sleeve: 0.2 }
  }
}

export function bottomCut(id: string): BottomCut {
  switch (id) {
    case 'pants-camo': return { fabric: camo([hex(0x5b5a3c), hex(0x3d3a26), hex(0x2a261b), hex(0x7a6e4c)]), length: 'full', shoe: 'boots', belt: hex(0x2a2018), cargo: true }
    case 'pants-jeans': return { fabric: denim(hex(0x4e6f98), 0.2), length: 'full', shoe: 'boots', belt: hex(0x3d2a1a), pockets: true }
    case 'pants-waders': return { fabric: solid(hex(0x4b4d36), 0.05), length: 'full', shoe: 'rubber', band: hex(0x3a3b2a) }
    case 'pants-blaze': return { fabric: solid(BLAZE, 0.06), length: 'full', shoe: 'boots', band: hex(0xd85d16) }
    case 'pants-khaki': return { fabric: solid(hex(0xb9a57e), 0.07), length: 'full', shoe: 'boots', belt: hex(0x4a321e), pockets: true }
    case 'pants-darkjeans': return { fabric: denim(hex(0x25324f), 0.08), length: 'full', shoe: 'sneakers', belt: hex(0x2a1d14), pockets: true }
    case 'pants-chinos': return { fabric: solid(hex(0xa88a5e), 0.07), length: 'full', shoe: 'sneakers', belt: hex(0x3a2516), pockets: true }
    case 'pants-joggers': return { fabric: heather(hex(0x8a8b8e)), length: 'full', shoe: 'sneakers', band: hex(0x7a7b7e), cuff: true }
    case 'pants-shorts': return { fabric: solid(hex(0xb4a078), 0.08), length: 0.31, shoe: 'sneakers', belt: hex(0x4a321e), cargo: true, socks: WHITE, sockHeight: 0.03 }
    case 'pants-bball-red': return { fabric: mesh(RED), length: 0.4, shoe: 'hightops', band: hex(0xf2f2f2), stripe: hex(0xf2f2f2), socks: WHITE, sockHeight: 0.12 }
    case 'pants-bball-blue': return { fabric: mesh(hex(0x1f4fa8)), length: 0.4, shoe: 'hightops', band: hex(0xf0c419), stripe: hex(0xf0c419), socks: WHITE, sockHeight: 0.12 }
    case 'pants-bball-white': return { fabric: mesh(hex(0xf1f1ee)), length: 0.4, shoe: 'hightops', band: NAVY, stripe: NAVY, socks: WHITE, sockHeight: 0.12 }
    case 'pants-gym': return { fabric: solid(hex(0x2a2c31), 0.06), length: 0.2, shoe: 'sneakers', band: hex(0x1d1f23), stripe: hex(0xd9d9d9), socks: WHITE, sockHeight: 0.03 }
    case 'pants-jorts': return { fabric: denim(hex(0x5a7ea8), 0.25), length: 0.27, shoe: 'sneakers', belt: hex(0x3d2a1a), pockets: true, socks: WHITE, sockHeight: 0.03 }
    default: return { fabric: solid(hex(0x555555)), length: 'full', shoe: 'boots' }
  }
}

/** How far below the garments' seam the top's hem hangs (over the belt), or above it when tucked in. */
const HANG = 0.035
const TUCK = 0.012

/**
 * The outfit's two textures. Both are painted from one shade split at a straight waist line (the shirt's hem, over or
 * tucked into the trousers), so the scan's sawtoothed seam between the two meshes never shows; each key names both
 * garments.
 */
export function garments(wear: string[], glyphs: (text: string) => Glyphs): { top: Shade; bottom: Shade; topKey: string; bottomKey: string } {
  const jacket = wear.find((w) => w.startsWith('jacket-')) ?? 'jacket-tee-heather'
  const cut = topCut(jacket, glyphs)
  const parts = garmentParts(wear, glyphs)
  const waist = (f: BodyFrame) => (cut.tuck ? f.hemY + TUCK : f.hemY - HANG)
  const both: Shade = (p, f, out, hand, boot) => (p.y >= waist(f) || p.wArm + p.wHand > 0.3 ? parts.top : parts.bottom)(p, f, out, hand, boot)
  const key = `${parts.topKey}|${parts.bottomKey}`
  return { top: both, bottom: both, topKey: key, bottomKey: key }
}

function garmentParts(wear: string[], glyphs: (text: string) => Glyphs): { top: Shade; bottom: Shade; topKey: string; bottomKey: string } {
  const jacket = wear.find((w) => w.startsWith('jacket-')) ?? 'jacket-tee-heather'
  const vest = wear.find((w) => w.startsWith('vest-')) ?? 'vest-none'
  const pants = wear.find((w) => w.startsWith('pants-')) ?? 'pants-jeans'
  let top = makeTop(topCut(jacket, glyphs))
  const vested = vest !== 'vest-none' && jacket !== 'jacket-blaze'
  if (vested && vest === 'vest-blaze') top = withVest(top, solid(BLAZE, 0.06), false)
  if (vested && vest === 'vest-fishing') top = withVest(top, solid(hex(0x8d8466), 0.1), true)
  return { top, bottom: makeBottom(bottomCut(pants)), topKey: vested ? `${jacket}+${vest}` : jacket, bottomKey: pants }
}
