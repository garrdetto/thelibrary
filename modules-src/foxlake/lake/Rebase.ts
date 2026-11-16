import type { MapDoc, MapGrids } from '../../tello/data/MapData'
import type { TelloLand } from '../../tello/region'

/** Lake Montello's surface above Tello's base (238.71 m over the 228 m base), less a centimetre so the water grid never reads zero (no water). */
export const LAKE_LEVEL = 10.7

interface WithDecks {
  decks: { y: number }[]
}

/**
 * Moves every height in Montello's map down by `level` metres, so Lake Montello's surface sits at y = 0.01 like Rack &
 * Reel's water at y = 0: the rod, the bobber, the boat, the dock and the carp all work on it as they do on Bear Paw
 * Lake. Run once on a land after its constructor (which levels its own streets and the Fox River's channel against the
 * surveyed heights). Heights below Lake Montello go negative, so the grids become signed.
 */
export function rebaseLand(land: TelloLand, level = LAKE_LEVEL): TelloLand {
  rebaseGrids(land.grids, level)
  rebaseDoc(land.doc, level)
  for (const deck of (land as unknown as WithDecks).decks) deck.y -= level
  return land
}

/**
 * The ground and water grids moved down by `level` metres, as signed centimetres (water 0 stays "no water"). The grids
 * are rewritten in their own memory as signed values when every moved height fits, so the 4 m grids (34 MB each) are not
 * held twice; the unsigned arrays they were must not be read afterwards.
 */
export function rebaseGrids(grids: MapGrids, level: number): void {
  const cm = Math.round(level * 100)
  grids.ground = shifted(grids.ground, cm, false) as unknown as Uint16Array
  grids.water = shifted(grids.water, cm, true) as unknown as Uint16Array
}

function shifted(src: ArrayLike<number>, cm: number, water: boolean): Int16Array {
  let fits = src instanceof Uint16Array
  if (fits) for (let k = 0; k < src.length; k++) if (src[k] - cm > 32767) { fits = false; break }
  const out = fits ? new Int16Array((src as Uint16Array).buffer, (src as Uint16Array).byteOffset, src.length) : new Int16Array(src.length)
  for (let k = 0; k < out.length; k++) {
    const v = src[k]
    if (water && !v) {
      out[k] = 0
      continue
    }
    const moved = v - cm
    out[k] = water && moved === 0 ? 1 : moved
  }
  return out
}

export function rebaseDoc(doc: MapDoc, level: number): void {
  const r = (v: number) => Math.round((v - level) * 100) / 100
  for (const b of doc.buildings) {
    b.f = r(b.f)
    b.l = r(b.l)
  }
  for (const b of doc.bridges) b.y = r(b.y)
  for (const lot of doc.lots) lot.f = r(lot.f)
  doc.frame.base = Math.round((doc.frame.base + level) * 100) / 100
}
