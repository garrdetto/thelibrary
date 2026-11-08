import { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Scene } from '@babylonjs/core/scene'

export type CreatureSurface = 'fur' | 'scales' | 'fin' | 'eye'

const cache = new Map<CreatureSurface, StandardMaterial>()

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Maps {
  size: number
  height: Float32Array
  albedo: Float32Array
  alpha: Float32Array | null
}

function makeTexture(scene: Scene, name: string, size: number, fill: (data: Uint8ClampedArray) => void, wrap: boolean): DynamicTexture {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true)
  const ctx = tex.getContext() as CanvasRenderingContext2D
  const img = ctx.createImageData(size, size)
  fill(img.data)
  ctx.putImageData(img, 0, 0)
  tex.update(false)
  tex.wrapU = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE
  tex.wrapV = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE
  tex.anisotropicFilteringLevel = 8
  return tex
}

function albedoTexture(scene: Scene, name: string, maps: Maps, wrap: boolean): DynamicTexture {
  return makeTexture(scene, name, maps.size, (d) => {
    for (let i = 0; i < maps.size * maps.size; i++) {
      const v = Math.max(0, Math.min(1, maps.albedo[i])) * 255
      d[i * 4] = v
      d[i * 4 + 1] = v
      d[i * 4 + 2] = v
      d[i * 4 + 3] = maps.alpha ? Math.max(0, Math.min(1, maps.alpha[i])) * 255 : 255
    }
  }, wrap)
}

function normalTexture(scene: Scene, name: string, maps: Maps, strength: number, wrap: boolean): DynamicTexture {
  const s = maps.size
  const h = maps.height
  const at = (x: number, y: number) => {
    if (wrap) return h[((y + s) % s) * s + ((x + s) % s)]
    return h[Math.max(0, Math.min(s - 1, y)) * s + Math.max(0, Math.min(s - 1, x))]
  }
  return makeTexture(scene, name, s, (d) => {
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength
        const len = Math.hypot(dx, dy, 1)
        const i = (y * s + x) * 4
        d[i] = (-dx / len * 0.5 + 0.5) * 255
        d[i + 1] = (-dy / len * 0.5 + 0.5) * 255
        d[i + 2] = (1 / len) * 255
        d[i + 3] = 255
      }
    }
  }, wrap)
}

function furMaps(): Maps {
  const size = 512
  const height = new Float32Array(size * size)
  const albedo = new Float32Array(size * size).fill(0.84)
  const r = rng(17)
  const strands = 14000
  for (let n = 0; n < strands; n++) {
    let x = r() * size
    let y = r() * size
    const len = 14 + r() * 26
    const ang = (r() - 0.5) * 0.35
    const dx = Math.cos(ang)
    const dy = Math.sin(ang)
    const tone = 0.68 + r() * 0.42
    const band = r() < 0.55
    for (let s = 0; s < len; s++) {
      const t = s / len
      const ix = ((Math.floor(x) % size) + size) % size
      const iy = ((Math.floor(y) % size) + size) % size
      const k = iy * size + ix
      const hh = 0.45 + 0.55 * (1 - t) * (0.6 + r() * 0.4)
      if (hh > height[k]) {
        height[k] = hh
        let a = tone * (0.85 + 0.25 * (1 - t))
        if (band && t > 0.55 && t < 0.8) a *= 1.25
        if (t > 0.85) a *= 0.8
        albedo[k] = a
      }
      x += dx
      y += dy
    }
  }
  return { size, height, albedo, alpha: null }
}

function scaleMaps(): Maps {
  const size = 512
  const height = new Float32Array(size * size)
  const albedo = new Float32Array(size * size).fill(0.9)
  const r = rng(29)
  const cols = 7
  const rows = 9
  const sx = size / cols
  const sy = size / rows
  const radius = Math.max(sx, sy) * 0.82
  const scales: { cx: number; cy: number; tone: number }[] = []
  for (let c = 0; c < cols; c++) {
    for (let j = 0; j < rows; j++) {
      scales.push({ cx: c * sx + sx * 0.5, cy: j * sy + (c % 2 ? sy * 0.5 : 0), tone: 0.9 + r() * 0.16 })
    }
  }
  scales.sort((a, b) => a.cx - b.cx)
  for (const sc of scales) {
    const x0 = Math.floor(sc.cx - radius)
    const x1 = Math.ceil(sc.cx + radius)
    const y0 = Math.floor(sc.cy - radius)
    const y1 = Math.ceil(sc.cy + radius)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ddx = x - sc.cx
        const ddy = (y - sc.cy) * 1.15
        const d = Math.hypot(ddx, ddy) / radius
        if (d > 1) continue
        const ix = ((x % size) + size) % size
        const iy = ((y % size) + size) % size
        const k = iy * size + ix
        const rim = Math.min(1, (1 - d) * 7)
        const lift = 0.35 + 0.65 * Math.max(0, Math.min(1, (-ddx / radius) * 0.6 + 0.5))
        height[k] = lift * rim
        const ridge = 0.03 * Math.sin(Math.atan2(ddy, -ddx) * 14) * (d > 0.4 ? 1 : 0)
        albedo[k] = sc.tone * (d > 0.86 ? 0.72 : 1.0) + ridge
      }
    }
  }
  return { size, height, albedo, alpha: null }
}

function finMaps(): Maps {
  const size = 256
  const height = new Float32Array(size * size)
  const albedo = new Float32Array(size * size).fill(0.95)
  const alpha = new Float32Array(size * size)
  const r = rng(41)
  const rays = 16
  const ragged = new Float32Array(size)
  for (let y = 0; y < size; y++) ragged[y] = 0.88 + 0.06 * Math.sin(y * 0.21) + 0.04 * r()
  for (let y = 0; y < size; y++) {
    const v = y / (size - 1)
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1)
      const k = y * size + x
      const spread = v * rays
      const near = Math.abs(spread - Math.round(spread))
      const branchOff = u > 0.65 ? Math.abs(Math.abs(spread - Math.round(spread)) - 0.12) : near
      const rayDist = Math.min(near, branchOff)
      const onRay = rayDist < 0.09
      const seg = onRay && Math.abs(((u * 22) % 1) - 0.5) < 0.06
      height[k] = onRay ? 1 - rayDist / 0.09 : 0
      albedo[k] = onRay ? (seg ? 0.55 : 0.78) : 0.98
      let a = onRay ? 0.95 : 0.62
      if (u > ragged[y]) a = 0
      else if (u > ragged[y] - 0.08) a *= (ragged[y] - u) / 0.08 + 0.2
      alpha[k] = a
    }
  }
  return { size, height, albedo, alpha }
}

export function creatureMaterial(scene: Scene, kind: CreatureSurface): StandardMaterial {
  const found = cache.get(kind)
  if (found) return found
  const mat = new StandardMaterial(`creature-${kind}`, scene)
  mat.diffuseColor = Color3.White()
  mat.ambientColor = new Color3(0.3, 0.3, 0.3)
  if (kind === 'fur') {
    const maps = furMaps()
    mat.diffuseTexture = albedoTexture(scene, 'fur-albedo', maps, true)
    mat.bumpTexture = normalTexture(scene, 'fur-normal', maps, 2.4, true)
    mat.bumpTexture.level = 1.1
    mat.specularColor = new Color3(0.035, 0.032, 0.03)
    mat.specularPower = 12
  } else if (kind === 'scales') {
    const maps = scaleMaps()
    mat.diffuseTexture = albedoTexture(scene, 'scale-albedo', maps, true)
    mat.bumpTexture = normalTexture(scene, 'scale-normal', maps, 3.0, true)
    mat.bumpTexture.level = 0.9
    mat.specularColor = new Color3(0.55, 0.55, 0.52)
    mat.specularPower = 72
  } else if (kind === 'fin') {
    const maps = finMaps()
    const tex = albedoTexture(scene, 'fin-albedo', maps, false)
    tex.hasAlpha = true
    mat.diffuseTexture = tex
    mat.useAlphaFromDiffuseTexture = true
    mat.bumpTexture = normalTexture(scene, 'fin-normal', maps, 2.0, false)
    mat.bumpTexture.level = 0.8
    mat.transparencyMode = Material.MATERIAL_ALPHATESTANDBLEND
    mat.alphaCutOff = 0.06
    mat.backFaceCulling = false
    mat.twoSidedLighting = true
    mat.specularColor = new Color3(0.3, 0.3, 0.28)
    mat.specularPower = 48
  } else {
    mat.specularColor = new Color3(1, 1, 1)
    mat.specularPower = 220
  }
  cache.set(kind, mat)
  return mat
}
