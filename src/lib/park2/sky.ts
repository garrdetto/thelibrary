import type { Lighting, Vec3 } from '../park/gl'

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer)

/** IEEE 754 binary16 bits for a float (round to nearest, saturating to the largest finite half). */
export function toHalf(value: number) {
  f32[0] = value
  const x = u32[0], sign = (x >>> 16) & 0x8000
  let exp = ((x >>> 23) & 0xff) - 127 + 15
  let mant = x & 0x7fffff
  if (exp <= 0) {
    if (exp < -10) return sign
    mant |= 0x800000
    const shift = 14 - exp
    return sign | ((mant + (1 << (shift - 1))) >>> shift)
  }
  if (exp >= 31) return sign | 0x7bff
  mant += 0x1000
  if (mant & 0x800000) { mant = 0; exp++; if (exp >= 31) return sign | 0x7bff }
  return sign | (exp << 10) | (mant >>> 13)
}

const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

const HALF_ONE = 0x3c00

/**
 * Fills an RGBA16F equirect (PlayCanvas layout: row 0 is straight up).
 * `base(z)` is the colour for a park-space elevation (z of a unit vector),
 * computed once per row; `glow(sd)` adds light around the sun, where sd is
 * the cosine of the angle to the sun, and is only called above `glowFrom`.
 */
function fillEquirect(out: Uint16Array, width: number, height: number, sun: Vec3, glowFrom: number, base: (z: number) => Vec3, glow: (sd: number) => Vec3) {
  const sinAz = new Float32Array(width), cosAz = new Float32Array(width)
  for (let col = 0; col < width; col++) { const az = (((col + 0.5) / width) * 2 - 1) * Math.PI; sinAz[col] = Math.sin(az); cosAz[col] = Math.cos(az) }
  for (let row = 0; row < height; row++) {
    const el = (1 - ((row + 0.5) / height) * 2) * Math.PI * 0.5
    const ce = Math.cos(el), z = Math.sin(el)
    const c = base(z)
    const r = toHalf(c[0]), g = toHalf(c[1]), b = toHalf(c[2])
    const sunZ = z * sun[2]
    let o = row * width * 4
    for (let col = 0; col < width; col++, o += 4) {
      const sd = ce * sinAz[col] * sun[0] - ce * cosAz[col] * sun[1] + sunZ
      if (sd > glowFrom) {
        const add = glow(sd), fade = smoothstep(glowFrom, glowFrom + 0.15, sd)
        out[o] = toHalf(c[0] + add[0] * fade); out[o + 1] = toHalf(c[1] + add[1] * fade); out[o + 2] = toHalf(c[2] + add[2] * fade)
      } else { out[o] = r; out[o + 1] = g; out[o + 2] = b }
      out[o + 3] = HALF_ONE
    }
  }
}

/** The visible sky, as the classic renderer's sky pass draws it, before tonemapping. */
export function fillSky(out: Uint16Array, width: number, height: number, light: Lighting) {
  const glowOut: Vec3 = [0, 0, 0]
  fillEquirect(out, width, height, light.sunDir, 0.62, z => mix(light.skyBottom, light.skyTop, Math.pow(Math.max(0, z), 0.38)), sd => {
    const s2 = sd * sd, s6 = s2 * s2 * s2
    const scatter = s6 * 0.6, disc = (sd > 0.99 ? Math.pow(sd, 900) * 6 : 0) + (sd > 0.9 ? Math.pow(sd, 60) * 0.12 : 0)
    glowOut[0] = light.sunScatter[0] * scatter + light.sunColor[0] * disc
    glowOut[1] = light.sunScatter[1] * scatter + light.sunColor[1] * disc
    glowOut[2] = light.sunScatter[2] * scatter + light.sunColor[2] * disc
    return glowOut
  })
}

/** Ambient and reflection light: the classic renderer's hemisphere and `envColor`, as an environment. */
export function fillEnvironment(out: Uint16Array, width: number, height: number, light: Lighting) {
  const sky: Vec3 = [light.sky[0] * 1.25, light.sky[1] * 1.25, light.sky[2] * 1.25]
  const ground: Vec3 = [light.ground[0] * 0.6, light.ground[1] * 0.6, light.ground[2] * 0.6]
  const glowOut: Vec3 = [0, 0, 0]
  fillEquirect(out, width, height, light.sunDir, 0.5, z => mix(ground, mix(light.horizon, sky, smoothstep(0, 0.65, z)), smoothstep(-0.18, 0.04, z)), sd => {
    const s2 = sd * sd, glow = s2 * s2 * s2 * s2 * 0.1
    glowOut[0] = light.sunScatter[0] * glow; glowOut[1] = light.sunScatter[1] * glow; glowOut[2] = light.sunScatter[2] * glow
    return glowOut
  })
}

/** The numbers the sky is built from, to decide when and how urgently to rebuild it. */
export function skyVector(light: Lighting) {
  return [...light.sunDir, ...light.skyTop, ...light.horizon, ...light.sky, ...light.ground, ...light.sunColor]
}

/** How far apart two sky vectors are: about 0.02 per in-park minute of daylight drift, 1+ for a jump. */
export function skyDistance(a: number[], b: number[]) {
  let d = 0
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]))
  return d
}
