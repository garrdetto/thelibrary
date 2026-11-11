import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Scene } from '@babylonjs/core/scene'
import { woodSample } from './SurfacePatterns'

/** Wood surfaces built in the page, so flat colours read as timber instead of plastic. */

const WOOD_W = 512
const WOOD_H = 256

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
