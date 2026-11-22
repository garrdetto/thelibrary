/**
 * The four materials the open world draws with, owned by the world renderer and shared by every chunk: terrain, roads, foliage
 * (trees, poles, wires) and signs. They are vertex-coloured `PBRMaterial`s so the ground is lit in the same linear HDR model as the
 * trucks, under the gloss rule: roughness 1, metallic 0, no specular lobe (F0 0, specular intensity 0) and no environment
 * reflection, so nothing on the ground, the roads or the trees ever shines; the sun and the hemispheric sky light do all the work.
 * The road material carries a depth offset so ribbons stay on top of the ground at any distance; the sign material samples the
 * site-sign atlas when there is one.
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Scene } from '@babylonjs/core/scene'
import type { SignAtlas } from './PropsSigns'

export interface WorldMaterials {
  terrain: PBRMaterial
  road: PBRMaterial
  foliage: PBRMaterial
  sign: PBRMaterial
  dispose(): void
}

/** A vertex-coloured, completely matte material (the gloss rule for ground, roads, gravel, foliage, wood and paint-free metal posts). */
export function matteMaterial(scene: Scene, name: string): PBRMaterial {
  const material = new PBRMaterial(name, scene)
  material.albedoColor = Color3.White()
  material.metallic = 0
  material.roughness = 1
  material.metallicF0Factor = 0
  material.specularIntensity = 0
  material.environmentIntensity = 0
  material.directIntensity = 1
  material.maxSimultaneousLights = 4
  return material
}

export function createWorldMaterials(scene: Scene, atlas: SignAtlas): WorldMaterials {
  const terrain = matteMaterial(scene, 'trucksim-terrain')
  const road = matteMaterial(scene, 'trucksim-road')
  road.zOffset = -2
  road.zOffsetUnits = -4
  const foliage = matteMaterial(scene, 'trucksim-foliage')
  const sign = matteMaterial(scene, 'trucksim-sign')
  if (atlas.texture) sign.albedoTexture = atlas.texture
  return {
    terrain,
    road,
    foliage,
    sign,
    dispose() {
      terrain.dispose()
      road.dispose()
      foliage.dispose()
      sign.dispose(false, false)
    },
  }
}
