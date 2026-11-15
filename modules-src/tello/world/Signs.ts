/**
 * Plain-lettering signs for the businesses outside downtown: each sign is requested with where it goes, all are packed
 * into one canvas texture (SignAtlas), then drawn as quads into the merged builders. Dark boards with pale lettering,
 * no logos and no brand colours. Town frame (x east, z south): a sign faces along its outward normal `n`, reading left
 * to right as seen from outside.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import type { ChunkedBuilders, MeshBuilder } from '../../foxlake/fp/core/Geo'
import type { Mats } from '../../foxlake/fp/core/Tex'
import { SignAtlas, type SignRect, type SignRequest } from './SignAtlas'

export interface SignSpot {
  text: string
  /** Centre of the sign (town frame) and its bottom height. */
  x: number
  z: number
  y: number
  w: number
  h: number
  /** Outward normal (town frame). */
  n: [number, number]
  board?: number
  ink?: number
  /** Lift off the wall in metres. */
  out?: number
}

export const SIGN_BOARD = 0x23262b
export const SIGN_INK = 0xf2f0ea

/** A quad facing out along `n` with the atlas rectangle on it, the lettering the right way round. */
export function signQuad(b: MeshBuilder, r: SignRect, s: SignSpot): void {
  const [nx, nz] = s.n
  const tx = nz
  const tz = -nx
  const out = s.out ?? 0.03
  const cx = s.x + nx * out
  const cz = s.z + nz * out
  const hw = s.w / 2
  b.quad(
    [[cx - tx * hw, s.y, cz - tz * hw], [cx + tx * hw, s.y, cz + tz * hw], [cx + tx * hw, s.y + s.h, cz + tz * hw], [cx - tx * hw, s.y + s.h, cz - tz * hw]],
    [nx, 0, nz],
    [[r.u0, r.v1], [r.u1, r.v1], [r.u1, r.v0], [r.u0, r.v0]],
    [1, 1, 1],
  )
}

export class Signs {
  private readonly atlas = new SignAtlas()
  private readonly spots: { id: number; spot: SignSpot }[] = []

  add(spot: SignSpot): void {
    const id = this.atlas.add({ text: spot.text, board: spot.board ?? SIGN_BOARD, ink: spot.ink ?? SIGN_INK, aspect: spot.w / spot.h } satisfies SignRequest)
    this.spots.push({ id, spot })
  }

  get count(): number {
    return this.spots.length
  }

  /** Paints the atlas and puts every sign into its chunk of `chunks`. */
  build(mats: Mats, chunks: ChunkedBuilders, name: string): Material | null {
    if (!this.spots.length) return null
    this.atlas.pack()
    const material = this.atlas.material(mats, name)
    for (const { id, spot } of this.spots) signQuad(chunks.get(spot.x, spot.z, material, { colors: false, cast: false }), this.atlas.rect(id), spot)
    return material
  }
}
