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
  const cm = Math.round(level * 100)
  const grids = land.grids as MapGrids & { ground: ArrayLike<number>; water: ArrayLike<number> }
  const ground = new Int16Array(grids.ground.length)
  for (let k = 0; k < ground.length; k++) ground[k] = grids.ground[k] - cm
  const water = new Int16Array(grids.water.length)
  for (let k = 0; k < water.length; k++) {
    if (!grids.water[k]) continue
    const v = grids.water[k] - cm
    water[k] = v === 0 ? 1 : v
  }
  grids.ground = ground as unknown as Uint16Array
  grids.water = water as unknown as Uint16Array
  rebaseDoc(land.doc, level)
  for (const deck of (land as unknown as WithDecks).decks) deck.y -= level
  return land
}

function rebaseDoc(doc: MapDoc, level: number): void {
  const r = (v: number) => Math.round((v - level) * 100) / 100
  for (const b of doc.buildings) {
    b.f = r(b.f)
    b.l = r(b.l)
  }
  for (const b of doc.bridges) b.y = r(b.y)
  for (const lot of doc.lots) lot.f = r(lot.f)
  doc.frame.base = Math.round((doc.frame.base + level) * 100) / 100
}
