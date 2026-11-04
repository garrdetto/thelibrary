/** Turns a Look into per-vertex colours and fitted bind-pose positions for the scanned fisherman: sleeves and legs are tailored to the limb, the parka's hood and pockets fold away for summer tops, and hats swap the beanie for hair. */
import { HAIR_COLORS, PALETTE, SKIN_TONES, hexToRgb } from '../shared/Wardrobe'
import type { Look, PaletteColor } from '../shared/Wardrobe'
import { clamp, smoothstep, valueNoise } from '../shared/Random'

export const PART = { face: 0, hat: 1, hair: 2, beard: 3, collar: 4, torso: 5, hood: 6, upperArm: 7, forearm: 8, hand: 9, thigh: 10, shin: 11, bootShaft: 12, foot: 13 } as const

export interface BodyData {
  positions: Float32Array
  region: Uint8Array
  ao: Uint8Array
  adjacency: Uint32Array[]
  /** Joint centres in scan space (x left, y up from the hips, z forward), as the fitting rules are written. */
  joints: Record<string, [number, number, number]>
}

type Rgb = [number, number, number]

const FEET = 0.952
const rgb = (c: PaletteColor): Rgb => hexToRgb(PALETTE[c])
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const scale = (a: Rgb, s: number): Rgb => [a[0] * s, a[1] * s, a[2] * s]
const near = (b: number, target: number, width: number) => {
  const d = Math.abs(((b - target + 384) % 256) - 128)
  return d < width
}

export function buildAdjacency(count: number, indices: Uint16Array | Uint32Array): Uint32Array[] {
  const sets: Set<number>[] = Array.from({ length: count }, () => new Set())
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2]
    sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b)
  }
  return sets.map(s => Uint32Array.from(s))
}

function closestOnSegment(p: Rgb, a: number[], b: number[]): Rgb {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const t = clamp(((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / (ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2]), 0, 1)
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]
}

function pullTo(p: Rgb, axis: Rgb, radius: number, strength: number): Rgb {
  const d: Rgb = [p[0] - axis[0], p[1] - axis[1], p[2] - axis[2]]
  const r = Math.hypot(d[0], d[1], d[2])
  if (r <= radius || r === 0) return p
  const target = radius + (r - radius) * (1 - strength)
  const s = target / r
  return [axis[0] + d[0] * s, axis[1] + d[1] * s, axis[2] + d[2] * s]
}

const sleeveEnd: Record<string, number> = { parka: 2, hoodie: 2, flannel: 2, fishing: 2, jersey: 2, tee: 0.27, tank: -1 }
const legEnd: Record<string, number> = { cargo: 2, jeans: 2, sweatpants: 2, joggers: 2, shorts: 0.42, boardshorts: 0.47, athletic: 0.36 }

export interface FittedBody {
  positions: Float32Array
  colors: Uint8Array
}

export function fitBody(body: BodyData, look: Look): FittedBody {
  const count = body.positions.length / 3
  const skin = hexToRgb(SKIN_TONES[look.skin])
  const hair = hexToRgb(HAIR_COLORS[look.hair])
  const top = rgb(look.topColor)
  const accent = rgb(look.topAccent)
  const bottom = rgb(look.bottomColor)
  const shoe = rgb(look.shoeColor)
  const hat = rgb(look.hatColor)
  const glove: Rgb = [0.16, 0.17, 0.18]
  const j = body.joints
  const offsets = new Float32Array(count * 3)
  const colors = new Uint8Array(count * 4)
  const bulky = look.top === 'parka'
  const hooded = look.top === 'parka' || look.top === 'hoodie'
  const sleeve = sleeveEnd[look.top]
  const leg = legEnd[look.bottom]

  for (let v = 0; v < count; v++) {
    const gx = body.positions[v * 3], gy = body.positions[v * 3 + 1], gz = body.positions[v * 3 + 2]
    const x = -gx, y = gy - FEET, z = -gz
    const part = body.region[v * 4]
    const right = body.region[v * 4 + 1] === 1
    const a = body.region[v * 4 + 2] / 255
    const b = body.region[v * 4 + 3]
    const side = right ? 'R' : 'L'
    let c: Rgb = skin
    let p: Rgb = [x, y, z]
    const grain = 0.94 + 0.12 * valueNoise(x * 90, (y + z) * 90, 7)

    switch (part) {
      case PART.face:
        c = skin
        break
      case PART.beard: {
        const center = Math.abs(x) < 0.03
        const lip = y > 0.752
        if (look.facialHair === 'full') c = scale(hair, 0.92)
        else if (look.facialHair === 'short') { c = scale(hair, 0.95); p = pullTo(p, [0, y, 0.03], 0.11, 0.6) }
        else if (look.facialHair === 'goatee') { c = center || (lip && Math.abs(x) < 0.045) ? hair : skin; p = pullTo(p, [0, y, 0.03], 0.105, center ? 0.3 : 0.85) }
        else if (look.facialHair === 'mustache') { c = lip && Math.abs(x) < 0.045 ? hair : skin; p = pullTo(p, [0, y, 0.03], 0.105, lip ? 0.2 : 0.85) }
        else if (look.facialHair === 'stubble') { c = mix(skin, hair, 0.38); p = pullTo(p, [0, y, 0.03], 0.105, 0.85) }
        else { c = skin; p = pullTo(p, [0, y, 0.03], 0.105, 0.85) }
        break
      }
      case PART.hat:
        if (look.hat === 'beanie') {
          const rib = y < 0.885 ? 0.9 + 0.1 * Math.abs(Math.sin(Math.atan2(x, z) * 60)) : 1
          c = scale(hat, rib)
        } else {
          c = scale(hair, 0.95)
          const centre: Rgb = [0, 0.83, 0.025]
          const d: Rgb = [(x - centre[0]) / 0.09, (y - centre[1]) / 0.1, (z - centre[2]) / 0.1]
          const r = Math.hypot(d[0], d[1], d[2])
          if (r > 1) {
            const s = 1 + (r - 1) * 0.15
            p = [centre[0] + (d[0] / r) * s * 0.09, centre[1] + (d[1] / r) * s * 0.1, centre[2] + (d[2] / r) * s * 0.1]
          }
        }
        break
      case PART.hair:
        c = hair
        break
      case PART.collar:
        if (look.top === 'parka') c = scale(accent, 0.9 + 0.1 * Math.abs(Math.sin(y * 140)))
        else { c = skin; p = pullTo(p, [0, y, 0.01], 0.058, 0.85) }
        break
      case PART.torso:
      case PART.hood: {
        c = torsoColor(look, top, accent, x, y, z, b, part === PART.hood)
        if (part === PART.hood && !hooded) {
          if (y > 0.6) p = pullTo([x, Math.min(y, 0.62 + (y - 0.62) * 0.35), z], [0, Math.min(y, 0.62 + (y - 0.62) * 0.35), -0.005], 0.085, 0.9)
          if (look.top === 'tank' || look.top === 'tee' || look.top === 'jersey') if (y > 0.585) c = skin
        }
        if (look.top === 'tank') {
          const strap = Math.abs(x) > 0.055 && Math.abs(x) < 0.1
          if ((y > 0.5 && Math.abs(x) > 0.1) || (y > 0.555 && !strap)) c = skin
        } else if ((look.top === 'tee' || look.top === 'jersey') && y > 0.585 && Math.abs(x) < 0.075 && z > -0.02) c = skin
        if (!bulky) {
          const t = smoothstep(-0.05, 0.05, y)
          const half = [0.165 + 0.02 * smoothstep(0.1, 0.4, y), 0.122 + 0.01 * smoothstep(0.1, 0.4, y)]
          const cx = 0, cz = 0.0
          const ex = (x - cx) / half[0], ez = (z - cz) / half[1]
          const r = Math.hypot(ex, ez)
          const strength = look.top === 'hoodie' ? 0.55 : 0.85
          if (r > 1 && y < 0.6) {
            const s = (1 + (r - 1) * (1 - strength * t)) / r
            p = [cx + (x - cx) * s, y, cz + (z - cz) * s]
          }
        }
        break
      }
      case PART.upperArm:
      case PART.forearm: {
        const covered = a < sleeve
        const shoulder = j['upperArm' + side], wrist = j['hand' + side]
        const axis = closestOnSegment(p, shoulder, wrist)
        const radius = 0.047 - 0.012 * clamp(a / 0.83, 0, 1)
        if (covered) {
          c = sleeveColor(look, top, accent, a, b, x, y, z)
          if (!bulky) p = pullTo(p, axis, radius + (look.top === 'hoodie' ? 0.02 : 0.012), look.top === 'hoodie' ? 0.45 : 0.7)
        } else {
          c = skin
          p = pullTo(p, axis, radius, 0.88)
        }
        break
      }
      case PART.hand: {
        const wrist = j['hand' + side], tip = j['handEnd' + side]
        if (look.gloves) c = glove
        else { c = skin; p = pullTo(p, closestOnSegment(p, wrist, tip), 0.03, 0.35) }
        break
      }
      case PART.thigh:
      case PART.shin:
      case PART.bootShaft: {
        const hip = j['thigh' + side], knee = j['shin' + side], ankle = j['foot' + side]
        const axis = part === PART.thigh ? closestOnSegment(p, hip, knee) : closestOnSegment(p, knee, ankle)
        const isBoot = part === PART.bootShaft && (look.shoes === 'boots' || (look.shoes === 'hikers' && y < -0.73))
        if (isBoot) {
          c = look.shoes === 'boots' ? scale(shoe, 0.95) : scale(shoe, 0.85)
          if (look.shoes === 'hikers') p = pullTo(p, axis, 0.06, 0.6)
          break
        }
        const covered = a < leg
        if (covered) {
          c = legColor(look, bottom, a, b, x, y, z)
          const fit = look.bottom === 'cargo' ? 0 : look.bottom === 'jeans' ? 0.7 : look.bottom === 'joggers' ? 0.75 : look.bottom === 'sweatpants' ? 0.45 : 0.55
          const radius = (part === PART.thigh ? 0.082 : 0.062) + (look.bottom === 'sweatpants' ? 0.012 : 0)
          if (fit > 0) p = pullTo(p, axis, radius, fit)
          if (part === PART.bootShaft) p = pullTo(p, axis, 0.058, 0.8)
        } else {
          c = skin
          p = pullTo(p, axis, part === PART.thigh ? 0.068 : 0.048 - 0.008 * clamp((a - 0.5) * 2, 0, 1), 0.9)
        }
        break
      }
      case PART.foot: {
        const sole = y < -0.925
        if (look.shoes === 'boots') c = sole ? [0.12, 0.12, 0.12] : scale(shoe, 0.95)
        else if (look.shoes === 'hikers') c = sole ? [0.15, 0.13, 0.11] : y < -0.9 ? scale(shoe, 0.7) : shoe
        else if (look.shoes === 'sneakers') c = sole ? [0.95, 0.95, 0.94] : near(b, 64, 14) && y > -0.92 ? [0.95, 0.95, 0.94] : shoe
        else c = sole ? [0.92, 0.9, 0.86] : shoe
        if (look.shoes !== 'boots') {
          const ankle = j['foot' + side]
          const centre: Rgb = [ankle[0], -0.9, 0.04]
          p = [centre[0] + (x - centre[0]) * 0.93, y, centre[2] + (z - centre[2]) * 0.95]
        }
        break
      }
    }
    offsets[v * 3] = -p[0] - gx
    offsets[v * 3 + 1] = p[1] + FEET - gy
    offsets[v * 3 + 2] = -p[2] - gz
    const ao = body.ao[v] / 255
    const shade = ao * grain
    colors[v * 4] = Math.round(clamp(c[0] * shade, 0, 1) * 255)
    colors[v * 4 + 1] = Math.round(clamp(c[1] * shade, 0, 1) * 255)
    colors[v * 4 + 2] = Math.round(clamp(c[2] * shade, 0, 1) * 255)
    colors[v * 4 + 3] = 255
  }

  let current = offsets
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(current.length)
    for (let v = 0; v < count; v++) {
      const ns = body.adjacency[v]
      let sx = current[v * 3] * 2, sy = current[v * 3 + 1] * 2, sz = current[v * 3 + 2] * 2
      for (let k = 0; k < ns.length; k++) { const n = ns[k]; sx += current[n * 3]; sy += current[n * 3 + 1]; sz += current[n * 3 + 2] }
      const w = ns.length + 2
      next[v * 3] = sx / w; next[v * 3 + 1] = sy / w; next[v * 3 + 2] = sz / w
    }
    current = next
  }
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < positions.length; i++) positions[i] = body.positions[i] + current[i]
  return { positions, colors }
}

function torsoColor(look: Look, top: Rgb, accent: Rgb, x: number, y: number, z: number, b: number, hood: boolean): Rgb {
  switch (look.top) {
    case 'parka':
      return hood ? scale(top, 0.95) : top
    case 'hoodie':
      return y < 0.12 && z > 0.05 && Math.abs(x) < 0.12 && y > -0.02 ? scale(top, 0.9) : top
    case 'flannel': {
      const bx = (x + 1) / 0.075 % 1, by = (y + 1) / 0.075 % 1
      const lineX = bx < 0.28 ? 1 : 0, lineY = by < 0.28 ? 1 : 0
      const thin = (bx > 0.55 && bx < 0.6) || (by > 0.55 && by < 0.6) ? 1 : 0
      let c = mix(top, scale(top, 0.45), (lineX + lineY) * 0.3)
      if (lineX && lineY) c = mix(c, accent, 0.5)
      if (thin) c = mix(c, [0.9, 0.88, 0.82], 0.45)
      return c
    }
    case 'fishing':
      return z < -0.06 && y > 0.42 && y < 0.5 ? scale(top, 0.82) : top
    case 'jersey':
      return near(b, 64, 18) || near(b, 192, 18) ? accent : top
    case 'tee':
      return top
    case 'tank':
      return y > 0.53 ? scale(top, 0.92) : top
  }
}

function sleeveColor(look: Look, top: Rgb, accent: Rgb, a: number, b: number, x: number, y: number, z: number): Rgb {
  if (look.top === 'jersey') return a < 0.3 ? accent : near(b, 0, 12) ? accent : top
  if (look.top === 'flannel') return torsoColor(look, top, accent, x, y, z, b, false)
  if (look.top === 'tee' && a > 0.22) return scale(top, 0.92)
  if (look.top === 'parka' && a > 0.76) return scale(top, 0.8)
  if (look.top === 'hoodie' && a > 0.78) return scale(top, 0.88)
  return top
}

function legColor(look: Look, bottom: Rgb, a: number, b: number, x: number, y: number, z: number): Rgb {
  switch (look.bottom) {
    case 'jeans': {
      const fade = near(b, 0, 40) && a > 0.15 && a < 0.6 ? 0.18 : 0
      const twill = 0.94 + 0.06 * Math.abs(Math.sin((x + y) * 900))
      return scale(mix(bottom, [0.75, 0.8, 0.88], fade), twill)
    }
    case 'sweatpants':
      return a > 0.92 ? scale(bottom, 0.85) : scale(bottom, 0.95 + 0.05 * valueNoise(x * 300, y * 300, 3))
    case 'joggers':
      return near(b, 64, 9) ? [0.95, 0.95, 0.94] : a > 0.92 ? scale(bottom, 0.8) : bottom
    case 'athletic':
      return near(b, 64, 10) ? [0.95, 0.95, 0.94] : bottom
    case 'boardshorts': {
      const band = near(b, 64, 22) ? 1 : 0
      const wave = Math.sin(y * 70 + Math.cos(z * 60) * 2) > 0.6 ? 1 : 0
      return band ? [0.95, 0.94, 0.9] : wave ? scale(bottom, 0.7) : bottom
    }
    case 'shorts':
      return a > 0.38 ? scale(bottom, 0.9) : bottom
    case 'cargo':
      return z > 0.02 && near(b, 64, 30) && a > 0.25 && a < 0.45 ? scale(bottom, 0.88) : bottom
  }
}
