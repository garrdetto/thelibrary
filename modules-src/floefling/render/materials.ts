import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Scene } from '@babylonjs/core/scene'

export function matte(scene: Scene, name: string, hex: string, emissive = 0): StandardMaterial {
  const material = new StandardMaterial(name, scene)
  material.diffuseColor = Color3.FromHexString(hex)
  material.specularColor = Color3.Black()
  if (emissive > 0) material.emissiveColor = Color3.FromHexString(hex).scale(emissive)
  return material
}

export function glossy(scene: Scene, name: string, hex: string, shine: number): StandardMaterial {
  const material = matte(scene, name, hex)
  material.specularColor = new Color3(shine, shine, shine)
  material.specularPower = 48
  return material
}

export function flat(scene: Scene, name: string, hex: string): StandardMaterial {
  const material = matte(scene, name, hex)
  material.disableLighting = true
  material.emissiveColor = Color3.FromHexString(hex)
  return material
}
