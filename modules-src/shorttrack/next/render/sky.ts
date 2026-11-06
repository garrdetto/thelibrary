import { Constants } from '@babylonjs/core/Engines/constants'
import { Material } from '@babylonjs/core/Materials/material'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'

/** Inputs of three's Preetham `Sky` as the classic module sets them (cloud settings are three's defaults). */
export type SkyParams = { turbidity: number; rayleigh: number; mie: number; mieG: number; sun: [number, number, number] }

const W = 1024
const H = 512

type V3 = [number, number, number]
const v3 = (x: number, y: number, z: number): V3 => [x, y, z]
const fract = (x: number): number => x - Math.floor(x)
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const mix = (a: number, b: number, t: number): number => a + (b - a) * t

function gradient(ix: number, iy: number): [number, number] {
  let p0 = fract(ix * 0.1031), p1 = fract(iy * 0.103), p2 = fract(ix * 0.0973)
  const d = p0 * (p1 + 33.33) + p1 * (p2 + 33.33) + p2 * (p0 + 33.33)
  p0 += d
  p1 += d
  p2 += d
  return [fract((p0 + p1) * p2) * 2 - 1, fract((p0 + p2) * p1) * 2 - 1]
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
  const ga = gradient(ix, iy), gb = gradient(ix + 1, iy), gc = gradient(ix, iy + 1), gd = gradient(ix + 1, iy + 1)
  const a = ga[0] * fx + ga[1] * fy, b = gb[0] * (fx - 1) + gb[1] * fy, c = gc[0] * fx + gc[1] * (fy - 1), d = gd[0] * (fx - 1) + gd[1] * (fy - 1)
  return mix(mix(a, b, ux), mix(c, d, ux), uy) * 1.6
}

function fbm(x: number, y: number, drift: number): number {
  let result = 0, amplitude = 1
  for (let i = 0; i < 4; i++) {
    result += amplitude * noise(x, y)
    amplitude *= 0.5
    x = x * 2 + drift
    y = y * 2 + drift
  }
  return result
}

/** Linear radiance of three's `Sky` (r186 shader, time 0) for one view direction. */
export function makeSkyFunction(p: SkyParams): (d: V3) => V3 {
  const len = Math.hypot(...p.sun)
  const sun: V3 = [p.sun[0] / len, p.sun[1] / len, p.sun[2] / len]
  const cutoffAngle = 1.6110731556870734, steepness = 1.5, EE = 1000
  const sunE = EE * Math.max(0, 1 - Math.exp(-((cutoffAngle - Math.acos(Math.max(-1, Math.min(1, sun[1])))) / steepness)))
  const sunfade = 1 - clamp01(1 - Math.exp(p.sun[1] / 450000))
  const rayleighCoefficient = p.rayleigh - (1 - sunfade)
  const totalRayleigh = v3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5)
  const MieConst = v3(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14)
  const betaR = totalRayleigh.map((t) => t * rayleighCoefficient) as V3
  const c = 0.2 * p.turbidity * 10e-18
  const betaM = MieConst.map((m) => 0.434 * c * m * p.mie) as V3
  const g = p.mieG, g2 = g * g
  const cloudScale = 0.0002, cloudCoverage = 0.4, cloudDensity = 0.4, cloudElevation = 0.5
  const Fex: V3 = [0, 0, 0], Lin: V3 = [0, 0, 0], L0: V3 = [0, 0, 0], tex: V3 = [0, 0, 0], BLUE: V3 = [0, 0.0003, 0.00075]
  return (d) => {
    const zenithAngle = Math.acos(Math.max(0, d[1]))
    const inverse = 1 / (Math.cos(zenithAngle) + 0.15 * Math.pow(93.885 - (zenithAngle * 180) / Math.PI, -1.253))
    const sR = 8.4e3 * inverse, sM = 1.25e3 * inverse
    for (let i = 0; i < 3; i++) Fex[i] = Math.exp(-(betaR[i] * sR + betaM[i] * sM))
    const cosTheta = d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2]
    const rc = cosTheta * 0.5 + 0.5
    const rPhase = 0.05968310365946075 * (1 + rc * rc)
    const mPhase = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * g * cosTheta + g2, 1.5))
    const k = clamp01(Math.pow(1 - sun[1], 5))
    const sundisc = clamp01((cosTheta - 0.9999566769464484) * 50000)
    for (let i = 0; i < 3; i++) {
      const ratio = (betaR[i] * rPhase + betaM[i] * mPhase) / (betaR[i] + betaM[i])
      const base = Math.pow(sunE * ratio * (1 - Fex[i]), 1.5)
      Lin[i] = base * mix(1, Math.pow(sunE * ratio * Fex[i], 0.5), k)
      L0[i] = 0.1 * Fex[i]
      tex[i] = (Lin[i] + L0[i]) * 0.04 + 760 * sundisc * Math.min(sunE * Fex[i], 80) + BLUE[i]
    }
    if (d[1] > 0) {
      const elevation = mix(1, 0.1, cloudElevation)
      const ux = (d[0] / (d[1] * elevation)) * cloudScale, uy = (d[2] / (d[1] * elevation)) * cloudScale
      const cloudNoise = clamp01(fbm(ux * 1000, uy * 1000, 0) * 0.7 + 0.5)
      const region = noise(ux * 300, uy * 300) * 0.37 + 0.5
      const cov = clamp01(cloudCoverage + (region - 0.5) * 0.6)
      const threshold = 1 - cov
      const horizonFade = smoothstep(0, 0.03 + 0.06 * cloudElevation, d[1])
      const cloudMask = smoothstep(threshold, threshold + 0.3, cloudNoise) * horizonFade
      const dayFactor = smoothstep(-0.08, 0.3, sun[1])
      const depth = Math.max(0, cloudNoise - threshold)
      const beer = Math.exp(depth * -4)
      const powder = 1 - beer * beer
      const shade = mix(0.45, 1, clamp01(beer * powder * 2.6))
      const silver = Math.max(0, Math.min(3, 0.51 / Math.pow(1.49 - cosTheta * 1.4, 1.5)))
      const edge = cloudMask * (1 - cloudMask) * 4
      const alpha = (1 - Math.exp(depth * cloudDensity * -12)) * horizonFade
      for (let i = 0; i < 3; i++) {
        const sunColor = sunE * Fex[i] * 0.22 * 0.04
        const skyAmbient = Lin[i] * 0.04 + BLUE[i]
        let cloudColor = skyAmbient + sunColor * shade
        cloudColor += sunColor * silver * edge * 0.6
        cloudColor *= Math.max(dayFactor, 0.03)
        tex[i] -= L0[i] * 0.04 * alpha
        const aerial = mix(tex[i], cloudColor, Fex[i])
        tex[i] = mix(tex[i], aerial, alpha)
      }
    }
    return tex
  }
}

/** Direction for texel row/column: u is azimuth around +y, v runs from the zenith (0) to the nadir (1). */
export function directionAt(u: number, v: number): V3 {
  const phi = u * Math.PI * 2, theta = v * Math.PI
  return [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)]
}

const halfF = new Float32Array(1)
const halfI = new Uint32Array(halfF.buffer)

function toHalf(value: number): number {
  halfF[0] = value
  const x = halfI[0], sign = (x >>> 16) & 0x8000, exp = ((x >>> 23) & 0xff) - 127 + 15, mant = x & 0x7fffff
  if (exp <= 0) return sign
  if (exp >= 31) return sign | 0x7bff
  return sign | (exp << 10) | (mant >>> 13)
}

/** Bakes the day sky into a half-float equirect texture (linear radiance, tone mapped by the frame like any other light). */
export function bakeSky(scene: Scene, params: SkyParams): RawTexture {
  const radiance = makeSkyFunction(params)
  const data = new Uint16Array(W * H * 4)
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const c = radiance(directionAt((col + 0.5) / W, (row + 0.5) / H))
      const o = (row * W + col) * 4
      data[o] = toHalf(Math.min(c[0], 60000))
      data[o + 1] = toHalf(Math.min(c[1], 60000))
      data[o + 2] = toHalf(Math.min(c[2], 60000))
      data[o + 3] = toHalf(1)
    }
  }
  const texture = new RawTexture(data, W, H, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT)
  texture.wrapU = Texture.WRAP_ADDRESSMODE
  texture.wrapV = Texture.CLAMP_ADDRESSMODE
  texture.gammaSpace = false
  return texture
}

/** A dome around the camera drawing `texture` unlit, behind everything else. */
export function skyDome(scene: Scene, texture: RawTexture, radius: number): Mesh {
  const rows = 64, cols = 128, positions: number[] = [], uvs: number[] = [], indices: number[] = []
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const u = c / cols, v = r / rows, d = directionAt(u, v)
      positions.push(d[0] * radius, d[1] * radius, d[2] * radius)
      uvs.push(u, v)
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c, b = a + cols + 1
      indices.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const mesh = new Mesh('sky-day', scene)
  const data = new VertexData()
  data.positions = positions
  data.uvs = uvs
  data.indices = indices
  data.applyToMesh(mesh)
  const mat = new PBRMaterial('sky-day', scene)
  mat.unlit = true
  mat.albedoTexture = texture
  mat.albedoColor = new Color3(1, 1, 1)
  mat.backFaceCulling = false
  mat.disableDepthWrite = true
  mat.fogEnabled = false
  mat.sideOrientation = Material.CounterClockWiseSideOrientation
  mesh.material = mat
  mesh.infiniteDistance = true
  mesh.isPickable = false
  mesh.renderingGroupId = 0
  return mesh
}
