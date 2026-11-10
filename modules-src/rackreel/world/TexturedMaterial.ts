import type { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Scene } from '@babylonjs/core/scene'
import { modelFileUrl } from '../core/ModelLibrary'

const WET = { specular: new Color3(0.42, 0.42, 0.4), power: 72 }

export function texturedMaterial(scene: Scene, file: string, cache: Map<string, Material>): Material {
  const key = `tex:${file}`
  const existing = cache.get(key)
  if (existing) return existing
  const mat = new StandardMaterial(`rr-${file}`, scene)
  const texture = new Texture(modelFileUrl(`${file}.webp`), scene, { noMipmap: false, samplingMode: Texture.TRILINEAR_SAMPLINGMODE })
  texture.anisotropicFilteringLevel = 4
  mat.diffuseTexture = texture
  mat.diffuseColor = Color3.White()
  const wet = file.startsWith('fish-')
  const cloth = file.startsWith('hunter') || file === 'wildman'
  mat.specularColor = wet ? WET.specular : cloth ? new Color3(0.015, 0.015, 0.015) : new Color3(0.05, 0.05, 0.05)
  mat.specularPower = wet ? WET.power : cloth ? 6 : 16
  mat.ambientColor = new Color3(0.3, 0.3, 0.3)
  mat.backFaceCulling = false
  mat.twoSidedLighting = true
  cache.set(key, mat)
  return mat
}
