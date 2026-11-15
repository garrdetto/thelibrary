/**
 * What every storefront piece is built with: the merged builders of one front laid out in its own frame (x along the
 * front, y up from the floor, z out toward the street), the storefront materials, the Blender detail kit while the
 * fronts are being built, and the small shapes they share.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import type { Matrix } from '@babylonjs/core/Maths/math.vector'
import { hexRGB, type ChunkedBuilders, type MeshBuilder, type RGB } from '../../foxlake/fp/core/Geo'
import type { ModelKit } from './Kit'
import type { SignRect } from './SignAtlas'

export type Mat = { brick: Material; stucco: Material; stone: Material; siding: Material; boards: Material; metal: Material; iron: Material; paint: Material; logs: Material; shingles: Material; lit: Material; signs: Material | null }

/** The builders for one front, all laid out in its frame. */
export class FrontKit {
  private readonly used = new Set<MeshBuilder>()
  constructor(private readonly chunks: ChunkedBuilders, private readonly at: { x: number; z: number }, private readonly frame: Matrix) {}

  get(m: Material, colors = true): MeshBuilder {
    const b = this.chunks.get(this.at.x, this.at.z, m, { colors })
    if (!this.used.has(b)) {
      this.used.add(b)
      b.transform(this.frame)
    }
    return b
  }

  done(): void {
    for (const b of this.used) b.transform(null)
  }
}

let KIT: ModelKit | null = null
const KIT_COLORS: Record<string, RGB> = { stone: hexRGB(0xd9d1c0), door: hexRGB(0x3a2e24), shingle: hexRGB(0x6c6862), metal: hexRGB(0x1c1e22), glass: hexRGB(0x38424b), brick: hexRGB(0x9a4a36) }

/** The Blender detail kit for the fronts being built (null: the simpler built-in shapes). */
export function useKit(kit: ModelKit | null): void {
  KIT = kit
}

export function hasKit(name: string): boolean {
  return !!KIT?.has(name)
}

/**
 * Lays a kit part into the front (true when the kit has it). Trim-slot surfaces take `trim`; `over` gives other slots
 * their own colour (a bay's panels, a pier's brick, a shingle colour).
 */
export function kitPut(kit: FrontKit, M: Mat, name: string, m: Matrix, trim: RGB, over: Partial<Record<string, RGB>> = {}): boolean {
  if (!KIT?.has(name)) return false
  KIT.put(
    name,
    m,
    (slot) => (slot === 'stone' ? kit.get(M.stone) : slot === 'metal' ? kit.get(M.iron, false) : slot === 'shingle' ? kit.get(M.shingles) : slot === 'glass' ? kit.get(M.lit, false) : slot === 'brick' ? kit.get(M.brick) : kit.get(M.paint)),
    (slot) => over[slot] ?? (slot === 'trim' || slot === 'wall' ? trim : KIT_COLORS[slot] ?? trim),
  )
  return true
}

export function darker(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k]
}

/** A flat rectangle facing +z in the front's frame (UVs in metres). */
export function panel(b: MeshBuilder, x0: number, y0: number, x1: number, y1: number, z: number, c?: RGB): void {
  b.quad([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], c)
}

/** A sign face from the atlas, facing +z. */
export function signFace(b: MeshBuilder, r: SignRect, x0: number, y0: number, x1: number, y1: number, z: number): void {
  b.quad([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [0, 0, 1], [[r.u0, r.v1], [r.u1, r.v1], [r.u1, r.v0], [r.u0, r.v0]])
}

/** An oval sign face from the atlas, facing +z, the sign's rectangle stretched over the oval. */
export function ovalFace(b: MeshBuilder, r: SignRect, cx: number, cy: number, a: number, h: number, z: number, seg = 28): void {
  const uv = (x: number, y: number): [number, number] => [r.u0 + (r.u1 - r.u0) * (0.5 + x / (2 * a)), r.v1 + (r.v0 - r.v1) * (0.5 + y / (2 * h))]
  const c = b.vertex(cx, cy, z, 0, 0, 1, ...uv(0, 0))
  const ring: number[] = []
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2
    const x = Math.cos(t) * a, y = Math.sin(t) * h
    ring.push(b.vertex(cx + x, cy + y, z, 0, 0, 1, ...uv(x, y)))
  }
  for (let i = 0; i < seg; i++) b.tri(c, ring[i], ring[i + 1])
}
