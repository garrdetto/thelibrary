/**
 * The places along the county road between Fox Plains and the lake country
 * (renderer-free, town coordinates: +x east, +z south toward the lake). The
 * road is East Ave's line south of town (x = 87, 10 m wide). Each place has a
 * building whose front faces the road, a lot (the gravel or asphalt it sits
 * on, reaching to the road's edge) and a door you can walk up to.
 */
import type { RectXZ } from '../../maplestreet/shared/WorldLayout'

export const ROAD_X = 87
export const ROAD_HALF = 5

export type RoadsideKind = 'cabin' | 'gas' | 'motel' | 'bar'

export interface RoadsidePlace {
  id: string
  kind: RoadsideKind
  name: string
  /** Which side of the road: -1 west (front faces +x), 1 east (front faces -x). */
  side: -1 | 1
  /** Along the road (town z) at the building's centre. */
  z: number
  /** Building width along the road and depth away from it, and its centre's distance from the road's centreline. */
  w: number
  d: number
  setback: number
  /** The lot: how far it reaches along the road either side of `z`, and back from the road edge. */
  lotHalf: number
  lotDepth: number
  surface: 'gravel' | 'asphalt'
  /** One line for the map and the on-foot prompt. */
  blurb: string
  color: number
}

export const ROADSIDE: readonly RoadsidePlace[] = [
  { id: 'cabin-birch', kind: 'cabin', name: 'Birch Hollow Cabin', side: -1, z: 348, w: 9, d: 7.5, setback: 24, lotHalf: 9, lotDepth: 30, surface: 'gravel', blurb: 'A log cabin with a screened porch and a woodpile.', color: 0x7a5232 },
  { id: 'tavern', kind: 'bar', name: 'The Rusty Lure Tavern', side: 1, z: 384, w: 18, d: 13, setback: 26, lotHalf: 20, lotDepth: 40, surface: 'gravel', blurb: 'Roadhouse bar: cold beer, pool table, neon in the windows.', color: 0x6b3b22 },
  { id: 'motel', kind: 'motel', name: 'Pine Cone Motel', side: -1, z: 428, w: 40, d: 9, setback: 30, lotHalf: 26, lotDepth: 42, surface: 'asphalt', blurb: 'Twelve rooms, an office and a vacancy sign that never sleeps.', color: 0xd9cbb0 },
  { id: 'cabin-tamarack', kind: 'cabin', name: 'Tamarack Cabin', side: 1, z: 458, w: 8, d: 7, setback: 22, lotHalf: 8, lotDepth: 28, surface: 'gravel', blurb: 'A small hunting cabin with a green tin roof.', color: 0x6e4a2c },
  { id: 'cabin-loon', kind: 'cabin', name: 'Loon Call Cabin', side: -1, z: 492, w: 10, d: 8, setback: 25, lotHalf: 9, lotDepth: 32, surface: 'gravel', blurb: 'A two-room cabin with a stone chimney.', color: 0x845a38 },
  { id: 'gas', kind: 'gas', name: 'Bear Paw Fuel & Bait', side: 1, z: 528, w: 14, d: 10, setback: 34, lotHalf: 24, lotDepth: 46, surface: 'asphalt', blurb: 'Last gas before the lake: fuel, ice, bait and jerky.', color: 0xc23b2a },
]

/** The building's centre (town coordinates) and the yaw that turns its local +z (its front) toward the road. */
export function placeFrame(p: RoadsidePlace): { x: number; z: number; yaw: number } {
  return { x: ROAD_X + p.side * p.setback, z: p.z, yaw: p.side < 0 ? Math.PI / 2 : -Math.PI / 2 }
}

/** Town point from the place's local frame (x along the front, z toward the road). */
export function placeToTown(p: RoadsidePlace, lx: number, lz: number): { x: number; z: number } {
  const f = placeFrame(p)
  const c = Math.cos(f.yaw)
  const s = Math.sin(f.yaw)
  return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c }
}

/** The lot as a town rectangle (from the road's edge back). */
export function lotRect(p: RoadsidePlace): RectXZ {
  const near = ROAD_X + p.side * ROAD_HALF
  const far = near + p.side * p.lotDepth
  return { cx: (near + far) / 2, cz: p.z, sx: Math.abs(far - near), sz: p.lotHalf * 2 }
}

/** Where you stand to use the door: just in front of the building. */
export function doorSpot(p: RoadsidePlace): { x: number; z: number } {
  return placeToTown(p, p.kind === 'motel' ? -p.w / 2 + 3 : 0, p.d / 2 + 1.6)
}

export function roadsideAt(x: number, z: number, pad = 0): RoadsidePlace | null {
  for (const p of ROADSIDE) {
    const r = lotRect(p)
    if (Math.abs(x - r.cx) <= r.sx / 2 + pad && Math.abs(z - r.cz) <= r.sz / 2 + pad) return p
  }
  return null
}
