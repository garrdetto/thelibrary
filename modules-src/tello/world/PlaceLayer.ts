/**
 * Lays Blender kit parts (places and fields kits) into merged, chunked builders: pumps, buses, lot lights, dock doors,
 * backstops, dugouts, fence panels. Positions are in Tello's town frame (x east, z south) under the mirrored town root.
 * One layer owns the materials, so every builder of a kind (paint, glass, lit, foundation, garage) is shared.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import type { Matrix } from '@babylonjs/core/Maths/math.vector'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { ChunkedBuilders, hexRGB, type MeshBuilder, type RGB } from '../../foxlake/fp/core/Geo'
import type { Mats } from '../../foxlake/fp/core/Tex'
import type { ModelKit } from './Kit'

const SLOT: Record<string, RGB> = {
  trim: hexRGB(0xf2f0ea),
  wall: hexRGB(0xd9d6cf),
  paint: hexRGB(0xe9e7e1),
  metal: hexRGB(0x6a6e73),
  black: hexRGB(0x1b1c1f),
  bus: hexRGB(0xf0b400),
  door: hexRGB(0x3a2e24),
  wood: hexRGB(0x6b5340),
  brick: hexRGB(0x9a5a48),
  shingle: hexRGB(0x4a4d52),
}
const WHITE: RGB = [1, 1, 1]

export interface PlaceMats {
  paint: Material
  glass: Material
  lit: Material
  foundation: Material
  garage: Material
  dirt: Material
}

export function placeMats(mats: Mats): PlaceMats {
  const lit = mats.plain('t-window-lit', { color: 0x38424b, gloss: 0.8, keepGloss: true, emissive: 0xffc98a, emissiveIntensity: 0 })
  if (!mats.nightGlow.some((g) => g.m === lit)) mats.nightGlow.push({ m: lit, k: 1.7 })
  return {
    paint: mats.plain('h-paint', { vcolor: true, gloss: 0.22 }),
    glass: mats.glass('glass-house', 0xa9c3d1, 0.38),
    lit,
    foundation: mats.textured('foundation', 'concrete', { color: 0x9c9890, tile: 1.5 }),
    garage: mats.textured('garage', 'garage', { color: 0xf0eee8 }),
    dirt: mats.plain('tello-field-dirt', { color: 0xa88a62, gloss: 0 }),
  }
}

export class PlaceLayer {
  readonly chunks: ChunkedBuilders

  constructor(private readonly kit: ModelKit | null, readonly M: PlaceMats, cell = 128) {
    this.chunks = new ChunkedBuilders(cell)
  }

  has(name: string): boolean {
    return !!this.kit?.has(name)
  }

  /** The builder for `material` in the chunk holding town point (x, z). */
  builder(x: number, z: number, material: Material, colors = true, cast = true): MeshBuilder {
    return this.chunks.get(x, z, material, { colors, cast })
  }

  /** Lays part `name` with matrix `m` into the chunk at (x, z); `over` recolours slots (paint, metal, trim...). Returns false when the kit lacks it. */
  lay(name: string, x: number, z: number, m: Matrix, over: Partial<Record<string, RGB>> = {}, litGlass = false): boolean {
    const kit = this.kit
    if (!kit?.has(name)) return false
    const { M } = this
    kit.put(
      name,
      m,
      (slot) => {
        switch (slot) {
          case 'glass':
            return this.builder(x, z, litGlass ? M.lit : M.glass, false, false)
          case 'lit':
            return this.builder(x, z, M.lit, false, false)
          case 'stone':
            return this.builder(x, z, M.foundation, false)
          case 'garage':
            return this.builder(x, z, M.garage, false)
          default:
            return this.builder(x, z, M.paint)
        }
      },
      (slot) => over[slot] ?? SLOT[slot] ?? WHITE,
    )
    return true
  }

  flush(root: TransformNode, name: string): void {
    this.chunks.flush(root, name)
  }
}
