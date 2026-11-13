import type { Material } from '@babylonjs/core/Materials/material'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Scene } from '@babylonjs/core/scene'
import { modelFileUrl } from '../core/ModelLibrary'
import { microBump } from './MicroBump'

const WET = { specular: new Color3(0.42, 0.42, 0.4), power: 72 }

/** How rough people's surfaces are: cloth, skin and hair return a broad, dull highlight and no mirror image. */
const CLOTH_ROUGHNESS = 0.88
/** How many times the weave repeats across a character's texture, and how deep it reads. */
const WEAVE_REPEAT = 56
const WEAVE_DEPTH = 0.3

let physical = false

/**
 * Host worlds that light from an environment map (Fox Lake) draw people with physically based materials: they take
 * the sky's and the ground's light on their shaded sides instead of a flat ambient colour, and carry a fine cloth
 * weave. Call before the first character loads. Standalone Rack & Reel leaves it off.
 */
export function setPhysicalCharacters(on: boolean): void { physical = on }

const isCloth = (file: string) => file.startsWith('hunter') || file === 'wildman'

/** A person's surface (outfit, skin, hair) as a physically based material around its colour texture. */
export function clothMaterial(scene: Scene, name: string, texture: BaseTexture): PBRMaterial {
  const mat = new PBRMaterial(name, scene)
  mat.albedoTexture = texture
  mat.metallic = 0
  mat.roughness = CLOTH_ROUGHNESS
  const weave = microBump(scene, 'weave').clone()
  weave.uScale = WEAVE_REPEAT
  weave.vScale = WEAVE_REPEAT
  weave.level = WEAVE_DEPTH
  mat.bumpTexture = weave
  mat.backFaceCulling = false
  mat.twoSidedLighting = true
  mat.enableSpecularAntiAliasing = true
  mat.onDisposeObservable.addOnce(() => weave.dispose())
  return mat
}

export function texturedMaterial(scene: Scene, file: string, cache: Map<string, Material>): Material {
  const key = `tex:${file}`
  const existing = cache.get(key)
  if (existing) return existing
  const texture = new Texture(modelFileUrl(`${file}.webp`), scene, { noMipmap: false, samplingMode: Texture.TRILINEAR_SAMPLINGMODE })
  texture.anisotropicFilteringLevel = 8
  let mat: Material
  if (physical && isCloth(file)) mat = clothMaterial(scene, `rr-${file}`, texture)
  else {
    const standard = new StandardMaterial(`rr-${file}`, scene)
    standard.diffuseTexture = texture
    finishTextured(standard, file)
    mat = standard
  }
  cache.set(key, mat)
  return mat
}

/** A material around a texture drawn in code (a mixed head), in the same finish as the loaded ones. */
export function paintedMaterial(scene: Scene, name: string, texture: BaseTexture, file: string): Material {
  if (physical && isCloth(file)) return clothMaterial(scene, name, texture)
  const mat = new StandardMaterial(name, scene)
  mat.diffuseTexture = texture
  finishTextured(mat, file)
  return mat
}

/** The finish every textured part shares: two-sided, with a wet sheen for fish and next to none for cloth and skin. */
export function finishTextured(mat: StandardMaterial, file: string): void {
  mat.diffuseColor = Color3.White()
  const wet = file.startsWith('fish-')
  const cloth = isCloth(file)
  mat.specularColor = wet ? WET.specular : cloth ? new Color3(0.0075, 0.0075, 0.0075) : new Color3(0.05, 0.05, 0.05)
  mat.specularPower = wet ? WET.power : cloth ? 6 : 16
  mat.ambientColor = new Color3(0.3, 0.3, 0.3)
  mat.backFaceCulling = false
  mat.twoSidedLighting = true
}
