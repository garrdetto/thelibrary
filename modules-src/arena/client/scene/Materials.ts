import type { Scene } from '@babylonjs/core/scene'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { surfaceTextures, type SurfaceSpec } from './Textures'

export interface ArenaMaterials {
  floor: PBRMaterial
  hull: PBRMaterial
  panel: PBRMaterial
  cover: PBRMaterial
  trim: PBRMaterial
  marking: PBRMaterial
  markingBlue: PBRMaterial
  markingRed: PBRMaterial
  energyBlue: PBRMaterial
  energyRed: PBRMaterial
  energyWhite: PBRMaterial
  armorBlue: PBRMaterial
  armorRed: PBRMaterial
  visor: PBRMaterial
  gunmetal: PBRMaterial
}

interface SurfaceOptions {
  metallic: number
  roughness: number
  texture?: SurfaceSpec
}

function surface(scene: Scene, name: string, albedo: string, options: SurfaceOptions): PBRMaterial {
  const material = new PBRMaterial(name, scene)
  material.albedoColor = options.texture ? Color3.White() : Color3.FromHexString(albedo).toLinearSpace()
  material.metallic = options.metallic
  material.roughness = options.roughness
  if (options.texture) {
    const textures = surfaceTextures(scene, name, options.texture)
    material.albedoTexture = textures.albedo
    material.bumpTexture = textures.normal
    material.bumpTexture.level = 0.9
  }
  return material
}

function light(scene: Scene, name: string, color: string, strength: number): PBRMaterial {
  const material = new PBRMaterial(name, scene)
  material.albedoColor = Color3.Black()
  material.metallic = 0
  material.roughness = 0.4
  material.emissiveColor = Color3.FromHexString(color).toLinearSpace()
  material.emissiveIntensity = strength
  return material
}

const rgb = (hex: string): [number, number, number] => {
  const color = Color3.FromHexString(hex)
  return [color.r * 255, color.g * 255, color.b * 255]
}

export function createMaterials(scene: Scene): ArenaMaterials {
  return {
    floor: surface(scene, 'arena-floor', '#8d8b84', {
      metallic: 0.05,
      roughness: 0.82,
      texture: { pattern: 'deck', base: rgb('#8f8d86'), accent: rgb('#6f6a5e'), grime: 0.35, seed: 11, bump: 2.2 },
    }),
    hull: surface(scene, 'arena-hull', '#8c949b', {
      metallic: 0.2,
      roughness: 0.55,
      texture: { pattern: 'plates', base: rgb('#98a0a6'), accent: rgb('#7a8187'), grime: 0.28, seed: 23, bump: 2.6 },
    }),
    panel: surface(scene, 'arena-panel', '#bfc4c8', {
      metallic: 0.35,
      roughness: 0.42,
      texture: { pattern: 'ribs', base: rgb('#c8ccd0'), accent: rgb('#a6abb0'), grime: 0.2, seed: 37, bump: 2.4 },
    }),
    cover: surface(scene, 'arena-cover', '#6f7a50', {
      metallic: 0.1,
      roughness: 0.62,
      texture: { pattern: 'crate', base: rgb('#7a8656'), accent: rgb('#5e6842'), grime: 0.35, seed: 41, bump: 2.8 },
    }),
    trim: surface(scene, 'arena-trim', '#5a6168', {
      metallic: 0.55,
      roughness: 0.4,
      texture: { pattern: 'brushed', base: rgb('#626a72'), grime: 0.12, seed: 53, bump: 1 },
    }),
    marking: surface(scene, 'arena-marking', '#d8d2b8', { metallic: 0, roughness: 0.7 }),
    markingBlue: surface(scene, 'arena-marking-blue', '#3d6fc4', { metallic: 0, roughness: 0.7 }),
    markingRed: surface(scene, 'arena-marking-red', '#b8443a', { metallic: 0, roughness: 0.7 }),
    energyBlue: light(scene, 'arena-energy-blue', '#5aa8ff', 1.6),
    energyRed: light(scene, 'arena-energy-red', '#ff5a48', 1.6),
    energyWhite: light(scene, 'arena-energy-white', '#cfe8ff', 1.3),
    armorBlue: surface(scene, 'arena-armor-blue', '#3d5fa8', { metallic: 0.45, roughness: 0.42 }),
    armorRed: surface(scene, 'arena-armor-red', '#a83a32', { metallic: 0.45, roughness: 0.42 }),
    visor: surface(scene, 'arena-visor', '#20262c', { metallic: 1, roughness: 0.08 }),
    gunmetal: surface(scene, 'arena-gunmetal', '#2b2f33', { metallic: 0.8, roughness: 0.38 }),
  }
}
