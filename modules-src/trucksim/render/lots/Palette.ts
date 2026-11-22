/**
 * Material keys for scenery batches. Fixed names come from the shared `MaterialLibrary` (matte building finishes through its
 * cargo cache, painted metal siding through its paints at about 15 % of normal gloss, glass and steel by name); `p:#hex` and
 * `m:#hex` keys make a painted or matte material this object owns (lot colours the player picks), and `chain` is the
 * translucent chain-link. Every reference taken is given back, and every owned material disposed, by `dispose`.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { Material } from '@babylonjs/core/Materials/material'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { MaterialLibrary, MaterialName } from '../Materials'
import { createPavingTexture } from './PavingTexture'
import type { PavingKind } from './PavingTexture'

/** Matte finishes: concrete, brick, roofing, wood, gravel, dirt and rock never shine. */
export const MATTE_COLORS: Record<string, string> = {
  concrete: '#a8a59d',
  concreteDark: '#7d7b76',
  brick: '#8a4a36',
  brickTan: '#b59a74',
  wood: '#8a6a45',
  woodDark: '#5b4228',
  lumber: '#c9a063',
  roofDark: '#3a3b3e',
  roofRed: '#6b3a30',
  gravel: '#8a847a',
  rock: '#8c8478',
  rockDark: '#6e675c',
  dirt: '#6d5a42',
  siding: '#e3e0d6',
  boardDark: '#1d2024',
  asphalt: '#2f3134',
  lineWhite: '#e8e6df',
  lineYellow: '#d9b02a',
  grain: '#d8b45a',
  coal: '#2c2d2f',
  sand: '#bfae86',
  rust: '#7a4a30',
  grassPatch: '#5d6b3a',
  flagBlue: '#2a4f9a',
  barnRed: '#8a2f26',
  houseBlue: '#7d93a5',
  houseYellow: '#d4c48a',
  houseGreen: '#8aa38a',
  houseTan: '#c8b79a',
  awningRed: '#9a2f2c',
  awningGreen: '#3d6a4a',
  awningBlue: '#2f4f7a',
  plywood: '#c3a56a',
  steelRaw: '#7f858b',
}

/** Painted metal: siding, tanks, doors and equipment. */
export const METAL_COLORS: Record<string, string> = {
  metalGrey: '#a8b0b6',
  metalWhite: '#e6e8ea',
  metalRed: '#8e2f25',
  metalBlue: '#2b4f7a',
  metalGreen: '#3f6b45',
  metalTan: '#b8a888',
  metalYellow: '#d9a520',
  metalDark: '#4a4f55',
  tankWhite: '#e8e8e4',
  tankSilver: '#b9bec3',
  tankRed: '#a3281f',
  safetyOrange: '#d9631c',
}

/** Textured paving tops: the material key, its texture and its colour when no texture can be painted. */
export const PAVING_KEYS: Record<string, { kind: PavingKind; fallback: string }> = {
  paveGravel: { kind: 'gravel', fallback: '#8a847a' },
  paveAsphalt: { kind: 'asphalt', fallback: '#2f3134' },
}

const LIBRARY_NAMES = new Set<string>(['chrome', 'steel', 'darkSteel', 'aluminum', 'rubber', 'glass', 'glassTint', 'plastic', 'lampWhite', 'lampRed', 'lampAmber', 'deck'])

function linear(hex: string): Color3 {
  return Color3.FromHexString(hex).toLinearSpace()
}

/** The materials one scenery owner (a site layer or a lot) uses. */
export class SceneryMaterials {
  private readonly resolved = new Map<string, Material>()
  private readonly held: PBRMaterial[] = []
  private readonly owned: PBRMaterial[] = []
  private disposed = false

  constructor(private readonly scene: Scene, private readonly library: MaterialLibrary) {}

  /** The material for a batch key (cached). */
  get(key: string): Material {
    let material = this.resolved.get(key)
    if (!material) {
      material = this.make(key)
      this.resolved.set(key, material)
    }
    return material
  }

  /** Resolves every fixed palette name now, so building a chunk later creates no materials. */
  warm(): void {
    for (const key of Object.keys(MATTE_COLORS)) this.get(key)
    for (const key of Object.keys(METAL_COLORS)) this.get(key)
    for (const key of LIBRARY_NAMES) this.get(key)
    for (const key of Object.keys(PAVING_KEYS)) this.get(key)
  }

  private make(key: string): Material {
    if (LIBRARY_NAMES.has(key)) return this.library.get(key as MaterialName)
    const matte = MATTE_COLORS[key]
    if (matte) {
      const material = this.library.cargo(matte)
      this.held.push(material)
      return material
    }
    const metal = METAL_COLORS[key]
    if (metal) {
      const material = this.library.paint(metal, 'gloss')
      this.held.push(material)
      return material
    }
    const paving = PAVING_KEYS[key]
    if (paving) {
      const texture = createPavingTexture(this.scene, paving.kind)
      const material = this.own(key, texture ? '#ffffff' : paving.fallback, 1, 0.05)
      if (texture) material.albedoTexture = texture
      material.specularIntensity = 0
      return material
    }
    if (key.startsWith('p:')) return this.own(key, key.slice(2), 0.55, 0.45)
    if (key.startsWith('m:')) return this.own(key, key.slice(2), 0.92, 0.25)
    if (key === 'chain') {
      const material = this.own(key, '#9aa0a6', 0.85, 0.25)
      material.alpha = 0.3
      material.backFaceCulling = false
      return material
    }
    return this.own(key, '#808080', 0.9, 0.25)
  }

  private own(name: string, hex: string, roughness: number, environment: number): PBRMaterial {
    const material = new PBRMaterial(`scenery-${name}`, this.scene)
    material.albedoColor = linear(hex)
    material.metallic = 0
    material.roughness = roughness
    if (roughness >= 0.85) material.metallicF0Factor = 0
    material.environmentIntensity = environment
    this.owned.push(material)
    return material
  }

  /** Gives back every library reference and disposes every owned material. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const material of this.held) this.library.release(material)
    for (const material of this.owned) material.dispose(false, true)
    this.held.length = 0
    this.owned.length = 0
    this.resolved.clear()
  }
}
