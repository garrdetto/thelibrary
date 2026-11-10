import { DetailMapConfiguration } from '@babylonjs/core/Materials/material.detailMapConfiguration'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Scene } from '@babylonjs/core/scene'
import { fabricHeight, woodSample } from './SurfacePatterns'

/** Cloth and wood surfaces built in the page, so flat colours read as fabric and timber instead of plastic. */

const FABRIC_SIZE = 128
const WOOD_W = 512
const WOOD_H = 256

const fabricCache = new WeakMap<Scene, RawTexture>()

/**
 * A tiling woven-cloth detail map (R albedo, G normal Y, B roughness, A normal X, as Babylon's
 * detail maps expect), laid over the garment textures at a fine scale.
 */
function fabricTexture(scene: Scene): RawTexture {
  const cached = fabricCache.get(scene)
  if (cached) return cached
  const n = FABRIC_SIZE
  const h = new Float32Array(n * n)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = fabricHeight(x / n, y / n)
  const data = new Uint8Array(n * n * 4)
  const at = (x: number, y: number) => h[((y + n) % n) * n + ((x + n) % n)]
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2
      const i = (y * n + x) * 4
      data[i] = Math.round(255 * (0.5 + (h[y * n + x] - 0.5) * 0.7))
      data[i + 1] = Math.round(255 * Math.max(0, Math.min(1, 0.5 - dy * 0.5)))
      data[i + 2] = 200
      data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, 0.5 - dx * 0.5)))
    }
  }
  const tex = RawTexture.CreateRGBATexture(data, n, n, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE)
  tex.wrapU = Texture.WRAP_ADDRESSMODE
  tex.wrapV = Texture.WRAP_ADDRESSMODE
  tex.uScale = 7
  tex.vScale = 7
  tex.anisotropicFilteringLevel = 4
  fabricCache.set(scene, tex)
  return tex
}

/** Turns a garment material matte: no sheen, and a fine woven grain in both colour and relief. */
export function applyFabric(mat: StandardMaterial, scene: Scene): void {
  mat.specularColor = new Color3(0.006, 0.0055, 0.005)
  mat.specularPower = 6
  mat.ambientColor = new Color3(0.26, 0.26, 0.26)
  mat.diffuseColor = new Color3(0.9, 0.88, 0.86)
  const detail = (mat as StandardMaterial & { detailMap?: DetailMapConfiguration }).detailMap ?? new DetailMapConfiguration(mat)
  detail.texture = fabricTexture(scene)
  detail.isEnabled = true
  detail.diffuseBlendLevel = 0.6
  detail.bumpLevel = 1
}

function woodTexture(scene: Scene, vertical: boolean, seed: number, tone: [number, number, number]): { color: RawTexture; normal: RawTexture } {
  const w = vertical ? WOOD_H : WOOD_W
  const hgt = vertical ? WOOD_W : WOOD_H
  const color = new Uint8Array(w * hgt * 4)
  const height = new Float32Array(w * hgt)
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const along = vertical ? y / hgt : x / w
      const across = vertical ? x / w : y / hgt
      const s = woodSample(along, across, seed)
      const i = y * w + x
      height[i] = s.height
      color[i * 4] = Math.round(255 * Math.min(1, tone[0] * s.shade))
      color[i * 4 + 1] = Math.round(255 * Math.min(1, tone[1] * s.shade))
      color[i * 4 + 2] = Math.round(255 * Math.min(1, tone[2] * s.shade))
      color[i * 4 + 3] = 255
    }
  }
  const normal = new Uint8Array(w * hgt * 4)
  const at = (x: number, y: number) => height[((y + hgt) % hgt) * w + ((x + w) % w)]
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 3
      const dy = (at(x, y + 1) - at(x, y - 1)) * 3
      const len = Math.hypot(dx, dy, 1)
      const i = (y * w + x) * 4
      normal[i] = Math.round(255 * (0.5 - dx / len * 0.5))
      normal[i + 1] = Math.round(255 * (0.5 - dy / len * 0.5))
      normal[i + 2] = Math.round(255 * (0.5 + 0.5 / len))
      normal[i + 3] = 255
    }
  }
  const make = (data: Uint8Array) => {
    const tex = RawTexture.CreateRGBATexture(data, w, hgt, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE)
    tex.wrapU = Texture.WRAP_ADDRESSMODE
    tex.wrapV = Texture.WRAP_ADDRESSMODE
    tex.anisotropicFilteringLevel = 8
    return tex
  }
  return { color: make(color), normal: make(normal) }
}

/** Weathered dock timber: grain along the board (`vertical` runs it up a post), dull and dry. */
export function woodMaterial(scene: Scene, name: string, vertical: boolean, tone: [number, number, number], seed: number): StandardMaterial {
  const mat = new StandardMaterial(name, scene)
  const { color, normal } = woodTexture(scene, vertical, seed, tone)
  mat.diffuseTexture = color
  mat.bumpTexture = normal
  mat.bumpTexture.level = 0.9
  mat.diffuseColor = Color3.White()
  mat.specularColor = new Color3(0.035, 0.032, 0.028)
  mat.specularPower = 10
  mat.ambientColor = new Color3(0.3, 0.3, 0.3)
  return mat
}
