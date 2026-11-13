import type { Scene } from '@babylonjs/core/scene'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'

export interface ArenaMaterials {
  floor: StandardMaterial
  hull: StandardMaterial
  panel: StandardMaterial
  cover: StandardMaterial
  trim: StandardMaterial
  energyBlue: StandardMaterial
  energyRed: StandardMaterial
  energyWhite: StandardMaterial
}

function surface(scene: Scene, name: string, diffuse: string, specular = 0.25, power = 48): StandardMaterial {
  const material = new StandardMaterial(name, scene)
  material.diffuseColor = Color3.FromHexString(diffuse)
  material.specularColor = new Color3(specular, specular, specular)
  material.specularPower = power
  return material
}

function energy(scene: Scene, name: string, glow: string): StandardMaterial {
  const material = new StandardMaterial(name, scene)
  const color = Color3.FromHexString(glow)
  material.diffuseColor = Color3.Black()
  material.specularColor = Color3.Black()
  material.emissiveColor = color
  material.disableLighting = true
  return material
}

export function createMaterials(scene: Scene): ArenaMaterials {
  return {
    floor: surface(scene, 'arena-floor', '#3a4250', 0.18, 32),
    hull: surface(scene, 'arena-hull', '#5b6577', 0.3, 64),
    panel: surface(scene, 'arena-panel', '#8a93a3', 0.35, 64),
    cover: surface(scene, 'arena-cover', '#6f6a5c', 0.2, 24),
    trim: surface(scene, 'arena-trim', '#262c37', 0.5, 96),
    energyBlue: energy(scene, 'arena-energy-blue', '#38e1ff'),
    energyRed: energy(scene, 'arena-energy-red', '#ff4d6a'),
    energyWhite: energy(scene, 'arena-energy-white', '#d8f6ff'),
  }
}
