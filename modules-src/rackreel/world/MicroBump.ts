/**
 * Small tiling normal maps made in code, for the fine surface that keeps a
 * physically based material from reading as smooth plastic: a cloth weave
 * for outfits and a fine grain for rubber and paint. One 128 px texture per
 * kind and scene, shared by every material that uses it.
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import type { Scene } from '@babylonjs/core/scene'

export type MicroKind = 'weave' | 'grain'

const SIZE = 128
const cache = new WeakMap<Scene, Map<MicroKind, Texture>>()

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/** Height in 0..1 at a texel; both patterns repeat exactly over the texture. */
function height(kind: MicroKind, x: number, y: number): number {
  if (kind === 'weave') {
    const threads = 16
    const u = (x / SIZE) * threads, v = (y / SIZE) * threads
    const over = (Math.floor(u) + Math.floor(v)) % 2 === 0
    const along = over ? Math.sin((u % 1) * Math.PI) : Math.sin((v % 1) * Math.PI)
    const across = over ? Math.sin((v % 1) * Math.PI) : Math.sin((u % 1) * Math.PI)
    return 0.25 + 0.6 * along * Math.sqrt(across) + 0.15 * hash(x, y)
  }
  let sum = 0
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += hash((x + dx + SIZE) % SIZE, (y + dy + SIZE) % SIZE)
  return sum / 9
}

/** The shared normal map of a kind. Set `uScale` / `vScale` on a clone-free basis: callers that need another repeat share the texel data through `Texture.clone`. */
export function microBump(scene: Scene, kind: MicroKind): Texture {
  let perScene = cache.get(scene)
  if (!perScene) cache.set(scene, (perScene = new Map()))
  const hit = perScene.get(kind)
  if (hit) return hit
  const data = new Uint8Array(SIZE * SIZE * 4)
  const strength = kind === 'weave' ? 2.4 : 1.6
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const dx = (height(kind, (x + 1) % SIZE, y) - height(kind, (x + SIZE - 1) % SIZE, y)) * strength
    const dy = (height(kind, x, (y + 1) % SIZE) - height(kind, x, (y + SIZE - 1) % SIZE)) * strength
    const l = Math.hypot(dx, dy, 1)
    const i = (y * SIZE + x) * 4
    data[i] = Math.round((-dx / l * 0.5 + 0.5) * 255)
    data[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255)
    data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255)
    data[i + 3] = 255
  }
  const tex = new RawTexture(data, SIZE, SIZE, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE)
  tex.name = `micro-${kind}`
  tex.wrapU = Texture.WRAP_ADDRESSMODE
  tex.wrapV = Texture.WRAP_ADDRESSMODE
  tex.anisotropicFilteringLevel = 4
  tex.gammaSpace = false
  perScene.set(kind, tex)
  return tex
}
