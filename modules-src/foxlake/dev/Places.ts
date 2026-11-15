/**
 * The developer panel's teleport list, in scene coordinates (+x east, +z north; the same frame as `host.player`).
 * Montello's places come from Tello's baked map: front doors where the map has them, otherwise the landmark itself;
 * places outside the playable area are left out. The lake places (the dock, the boat, the UTV, Wild Man's camp and
 * the hunting stands) come from the lake site (lake/LakeSite.ts). tests/dev.test.ts checks every place is on dry
 * ground inside the world.
 */
import { MONTELLO_LOTS } from '../../maplestreet/shared/MontelloPlaces'
import type { TelloLand } from '../../tello/region'
import type { LakeSite } from '../lake/LakeSite'
import { townToScene } from '../region'

export type PlaceArea = 'Montello' | 'Lake Montello'

export const PLACE_AREAS: readonly PlaceArea[] = ['Montello', 'Lake Montello']

export interface Place {
  id: string
  label: string
  area: PlaceArea
  x: number
  z: number
}

function town(id: string, label: string, x: number, z: number, area: PlaceArea = 'Montello'): Place {
  const p = townToScene(x, 0, z)
  return { id, label, area, x: p.x, z: p.z }
}

/** Montello's teleports: `poi` is the name of a point of interest on Tello's map (its front door when it has one). */
const MONTELLO_SPOTS: readonly { id: string; label: string; poi: string }[] = [
  { id: 'mt-city-hall', label: 'City Hall, Police & Fire Department', poi: 'Montello City Hall' },
  { id: 'mt-bank', label: 'National Exchange Bank', poi: 'National Exchange Bank & Trust - Montello' },
  { id: 'mt-sheriff', label: 'Marquette County Sheriff', poi: 'Marquette County Sheriff Department' },
  { id: 'mt-weezies', label: "Weezie's Town Pump", poi: "Weezie's Town Pump" },
  { id: 'mt-tambears', label: 'Tambears', poi: 'Tambears' },
  { id: 'mt-yahooz', label: 'Yahooz Sports Bar & Grill', poi: 'Yahooz Sports Bar & Grill' },
  { id: 'mt-candy', label: 'The Montello Candy Store', poi: 'The Montello Candy Store' },
  { id: 'mt-rivers-edge', label: 'Rivers Edge Saloon', poi: 'Rivers Edge Saloon & Eatery' },
  { id: 'mt-oyster', label: 'Oyster Crackers', poi: 'Oyster Crackers' },
  { id: 'mt-theatre', label: 'Montello Theatre', poi: 'Montello Theatre' },
  { id: 'mt-granite-park', label: 'Granite Park & the falls', poi: 'Montello Granite Park' },
  { id: 'mt-cottonwood', label: 'The Montello Cottonwood', poi: 'The Montello Cottonwood' },
  { id: 'mt-water-tower', label: 'Water tower', poi: 'Montello water tower' },
  { id: 'mt-kwik-trip', label: 'Kwik Trip (deliveries)', poi: 'Kwik Trip' },
  { id: 'mt-post-office', label: 'Post Office', poi: 'United States Post Office' },
  { id: 'mt-freitag', label: 'H A Freitag & Son', poi: 'H A Freitag & Son' },
  { id: 'mt-school', label: 'Junior-Senior High School', poi: 'Montello Junior-Senior High School' },
  { id: 'mt-care-center', label: 'Montello Care Center', poi: 'Montello Care Center' },
  { id: 'mt-cafe-hilltop', label: 'Cafe Hilltop', poi: 'Cafe Hilltop' },
  { id: 'mt-dollar-general', label: 'Dollar General', poi: 'Dollar General' },
  { id: 'mt-mobil', label: 'Mobil', poi: 'Mobil' },
  { id: 'mt-rendezvous', label: 'Rendezvous Paddle & Sports', poi: 'Rendezvous Paddle & Sports' },
  { id: 'mt-feed-mill', label: 'Fox River Feed Mill', poi: 'Fox River Feed Mill' },
  { id: 'mt-fishing', label: 'Andy Krakow fishing area', poi: 'Andy Krakow Memorial Fishing Area' },
  { id: 'mt-bp', label: 'BP', poi: 'BP' },
  { id: 'mt-freitags', label: "Freitag's Food Center", poi: "Freitag's Food Center" },
  { id: 'mt-foxtails', label: "Foxtails Gentlemen's Club", poi: "Foxtails Gentlemen's Club" },
  { id: 'mt-lakeside', label: "Drew's Lakeside Bar & Grill", poi: "Drew's Lakeside Bar & Grill" },
]

/** Montello's teleports on the loaded map, in scene coordinates. */
export function montelloPlaces(land: TelloLand): Place[] {
  const out: Place[] = []
  const add = (id: string, label: string, mx: number, mz: number) => {
    if (!land.playable(mx, mz)) return
    out.push({ id, label, area: 'Montello', x: land.toSceneX(mx), z: land.toSceneZ(mz) })
  }
  for (const spot of MONTELLO_SPOTS) {
    const poi = land.doc.pois.find((p) => p.n === spot.poi)
    if (!poi) continue
    const [x, z] = poi.d ? [poi.d[0], poi.d[1]] : [poi.x, poi.z]
    add(spot.id, spot.label, x, z)
  }
  const lot = MONTELLO_LOTS.find((l) => l.id.startsWith('V')) ?? MONTELLO_LOTS[0]
  if (lot) {
    const front = lot.front === '+z' ? lot.z + lot.d / 2 + 3 : lot.z - lot.d / 2 - 3
    out.push(town('mt-lots', 'Parcels for sale', lot.x, front))
  }
  return out
}

/** The lake gameplay's teleports: the dock's land end, the boat, the UTV, Wild Man's camp (beside the dock) and the foot of each stand. */
export function lakePlaces(site: LakeSite): Place[] {
  const at = (id: string, label: string, p: { x: number; z: number }): Place => ({ id, label, area: 'Lake Montello', x: p.x, z: p.z })
  const out = [at('dock', 'The dock', site.dock.start), at('utv', 'The UTV and quad (parking)', site.utv), at('boat', 'The boat (dock end)', site.boat)]
  site.stands.forEach((s, i) => out.push(at(s.kind === 'blind' ? 'blind' : `stand-${i + 1}`, s.kind === 'blind' ? 'Ground blind' : `Ladder stand ${i + 1}`, s)))
  return out
}
