/**
 * Shared PBR materials for every Truck Simulator visual, following the owner's gloss rule: rubber, frame rails, deck plate,
 * mud flaps and cargo have no gloss and no specular (roughness at least 0.85, F0 off); paint and metal keep about 15 % of a
 * normal gloss (paint roughness 0.55, chrome metallic with roughness 0.3, modest environment light); only glass shines.
 * Named materials are created once and kept until `dispose`. Paints (and cargo colours) are cached per key with reference
 * counts: `paint` and `cargo` hand out a reference, `release` gives it back, and `trim` disposes the least recently used ones
 * nobody holds. Lamps that switch per vehicle come from `lampInstance`, which the caller owns and disposes.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { Finish } from '../shared/Catalog'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'

/** Every fixed material name `get` knows. `cargo:<hex>` is accepted as well. */
export type MaterialName =
  | 'chrome' | 'steel' | 'darkSteel' | 'aluminum' | 'rubber' | 'glass' | 'glassTint' | 'plastic' | 'grille' | 'satinBlack'
  | 'lampWhite' | 'lampRed' | 'lampAmber' | 'deck' | 'hoseRed' | 'hoseBlue'

/** Lamp colours for `lampInstance`. */
export type LampColor = 'white' | 'red' | 'amber'

interface KeyedEntry {
  material: PBRMaterial
  refs: number
  used: number
  pinned: boolean
}

const LAMP_COLORS: Record<LampColor, { albedo: string; emissive: string }> = {
  white: { albedo: '#d9dee3', emissive: '#fff4e0' },
  red: { albedo: '#5a0a0a', emissive: '#ff2414' },
  amber: { albedo: '#7a4a0c', emissive: '#ff9a1a' },
}

/** Emissive strengths for lamps: unlit lens glow, running lamp and full brightness. */
export const LAMP_LEVEL = { off: 0.12, running: 0.7, on: 3.2 }

function linear(hex: string): Color3 {
  return Color3.FromHexString(hex).toLinearSpace()
}

/** Shared material cache for one scene. */
export class MaterialLibrary {
  private readonly named = new Map<string, PBRMaterial>()
  private readonly keyed = new Map<string, KeyedEntry>()
  private readonly owners = new Map<PBRMaterial, string>()
  private clock = 0
  private disposed = false

  constructor(private readonly scene: Scene) {}

  /**
   * A fixed material by name (`chrome`, `steel`, `darkSteel`, `aluminum`, `rubber`, `glass`, `glassTint`, `plastic`, `grille`,
   * `satinBlack`, `lampWhite`, `lampRed`, `lampAmber`, `deck`, `hoseRed`, `hoseBlue`), or `cargo:<hex>`, which is pinned
   * (never trimmed) because callers of `get` do not release.
   */
  get(name: MaterialName | `cargo:${string}`): PBRMaterial {
    if (name.startsWith('cargo:')) {
      const entry = this.keyedEntry(`cargo:${name.slice(6).toLowerCase()}`, () => this.makeCargo(name.slice(6)))
      entry.pinned = true
      return entry.material
    }
    let material = this.named.get(name)
    if (!material) {
      material = this.makeNamed(name as MaterialName)
      this.named.set(name, material)
    }
    return material
  }

  /** A body paint for a colour and finish; takes one reference, give it back with `release`. */
  paint(hex: string, finish: Finish): PBRMaterial {
    const key = `paint:${hex.toLowerCase()}:${finish}`
    const entry = this.keyedEntry(key, () => this.makePaint(hex, finish, key))
    entry.refs++
    return entry.material
  }

  /** A matte cargo colour (gravel, sand, grain); takes one reference, give it back with `release`. */
  cargo(hex: string): PBRMaterial {
    const key = `cargo:${hex.toLowerCase()}`
    const entry = this.keyedEntry(key, () => this.makeCargo(hex))
    entry.refs++
    return entry.material
  }

  /** Gives back a reference taken by `paint` or `cargo`. Other materials are ignored. */
  release(material: PBRMaterial | null | undefined): void {
    if (!material) return
    const key = this.owners.get(material)
    if (!key) return
    const entry = this.keyed.get(key)
    if (entry && entry.refs > 0) entry.refs--
  }

  /** How many paint and cargo materials are cached (held or not). */
  get cachedCount(): number {
    return this.keyed.size
  }

  /** References held on a material from `paint`/`cargo` (0 for others). */
  refsOf(material: PBRMaterial): number {
    const key = this.owners.get(material)
    return key ? (this.keyed.get(key)?.refs ?? 0) : 0
  }

  /** Disposes least-recently-used paint and cargo materials nobody holds until at most `maxPaints` remain cached. */
  trim(maxPaints: number): number {
    const free = [...this.keyed.entries()].filter(([, entry]) => entry.refs === 0 && !entry.pinned).sort((a, b) => a[1].used - b[1].used)
    let excess = this.keyed.size - Math.max(0, maxPaints)
    let removed = 0
    for (const [key, entry] of free) {
      if (excess <= 0) break
      this.keyed.delete(key)
      this.owners.delete(entry.material)
      entry.material.dispose(true, true)
      excess--
      removed++
    }
    return removed
  }

  /**
   * A fresh lamp material the caller owns (and must dispose): switch it by setting `emissiveIntensity` between the
   * `LAMP_LEVEL` values.
   */
  lampInstance(color: LampColor, name: string): PBRMaterial {
    const material = this.makeLamp(`${name}-${color}`, color)
    material.emissiveIntensity = LAMP_LEVEL.off
    return material
  }

  /** Disposes every material this library made, held or not. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const material of this.named.values()) material.dispose(true, true)
    for (const entry of this.keyed.values()) entry.material.dispose(true, true)
    this.named.clear()
    this.keyed.clear()
    this.owners.clear()
  }

  private keyedEntry(key: string, make: () => PBRMaterial): KeyedEntry {
    let entry = this.keyed.get(key)
    if (!entry) {
      const material = make()
      entry = { material, refs: 0, used: 0, pinned: false }
      this.keyed.set(key, entry)
      this.owners.set(material, key)
    }
    entry.used = ++this.clock
    return entry
  }

  private base(name: string, albedo: string, metallic: number, roughness: number): PBRMaterial {
    const material = new PBRMaterial(`truck-${name}`, this.scene)
    material.albedoColor = linear(albedo)
    material.metallic = metallic
    material.roughness = roughness
    material.environmentIntensity = 0.45
    return material
  }

  private matte(name: string, albedo: string, roughness = 0.92): PBRMaterial {
    const material = this.base(name, albedo, 0, Math.max(0.85, roughness))
    material.metallicF0Factor = 0
    material.environmentIntensity = 0.25
    return material
  }

  private makePaint(hex: string, finish: Finish, key: string): PBRMaterial {
    if (finish === 'matte') {
      const material = this.base(key, hex, 0, 0.85)
      material.metallicF0Factor = 0.4
      material.environmentIntensity = 0.3
      return material
    }
    if (finish === 'metallic') {
      const material = this.base(key, hex, 0.5, 0.5)
      material.environmentIntensity = 0.5
      return material
    }
    const material = this.base(key, hex, 0, 0.55)
    material.environmentIntensity = 0.45
    return material
  }

  private makeCargo(hex: string): PBRMaterial {
    return this.matte(`cargo:${hex.toLowerCase()}`, hex, 0.96)
  }

  private makeLamp(name: string, color: LampColor): PBRMaterial {
    const spec = LAMP_COLORS[color]
    const material = this.base(name, spec.albedo, 0, 0.25)
    material.emissiveColor = linear(spec.emissive)
    material.emissiveIntensity = LAMP_LEVEL.off
    material.environmentIntensity = 0.6
    return material
  }

  private makeNamed(name: MaterialName): PBRMaterial {
    switch (name) {
      case 'chrome': {
        const material = this.base(name, '#e4e7ea', 1, 0.3)
        material.environmentIntensity = 0.6
        return material
      }
      case 'steel':
        return this.base(name, '#a9afb5', 0.6, 0.55)
      case 'aluminum': {
        const material = this.base(name, '#c9cdd2', 0.9, 0.42)
        material.environmentIntensity = 0.55
        return material
      }
      case 'darkSteel':
        return this.matte(name, '#2a2c2f', 0.88)
      case 'rubber':
        return this.matte(name, '#18191b', 0.95)
      case 'deck':
        return this.matte(name, '#3a3c40', 0.9)
      case 'plastic': {
        const material = this.base(name, '#232528', 0, 0.8)
        material.metallicF0Factor = 0.5
        material.environmentIntensity = 0.3
        return material
      }
      case 'satinBlack': {
        const material = this.base(name, '#1c1d20', 0.3, 0.6)
        material.environmentIntensity = 0.35
        return material
      }
      case 'grille': {
        const material = this.base(name, '#121315', 0.4, 0.7)
        material.environmentIntensity = 0.3
        return material
      }
      case 'glass': {
        const material = this.base(name, '#0e141a', 0, 0.05)
        material.alpha = 0.5
        material.environmentIntensity = 1
        return material
      }
      case 'glassTint': {
        const material = this.base(name, '#06080a', 0, 0.06)
        material.alpha = 0.86
        material.environmentIntensity = 1
        return material
      }
      case 'lampWhite':
        return this.makeLampShared(name, 'white', 0.35)
      case 'lampRed':
        return this.makeLampShared(name, 'red', 0.35)
      case 'lampAmber':
        return this.makeLampShared(name, 'amber', 0.45)
      case 'hoseRed':
        return this.matte(name, '#a3221c', 0.85)
      case 'hoseBlue':
        return this.matte(name, '#1f4f9a', 0.85)
    }
  }

  private makeLampShared(name: string, color: LampColor, level: number): PBRMaterial {
    const material = this.makeLamp(name, color)
    material.emissiveIntensity = level
    return material
  }
}
