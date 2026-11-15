/**
 * The developer panel's teleport list: Fox Lake's points of interest in scene
 * coordinates (+x east, +z north; the same frame as `host.player`). To add a
 * place, add a row. Town places are worked out from the shared town layout,
 * which is in town coordinates (`town(...)` converts); lake-country places are
 * where Rack & Reel puts its landmarks on Fox Lake's terrain (the dock's land
 * end, Fox Outfitters' door, Wild Man's camp, the foot of each stand's ladder).
 * tests/dev.test.ts checks that every place is on dry ground inside the world
 * and that the lake-country ones still match the game's own landmark finders.
 *
 * Montello's places (`montelloPlaces`) come from Tello's baked map, so they are
 * only offered once the map has loaded: front doors where the map has them,
 * otherwise the landmark itself. Places outside Montello's playable area (the
 * city limits) are left out. tests/montello-places.test.ts checks them.
 */
import { BODY_SHOP } from '../../maplestreet/shared/BodyShop'
import { CIVIC, CURVES, DEPOT, SHOP_DOORS, SPAWN, TOWN_SQUARE_RECT } from '../../maplestreet/shared/WorldLayout'
import { MONTELLO_LOTS } from '../../maplestreet/shared/MontelloPlaces'
import type { TelloLand } from '../../tello/region'
import { CASINO } from '../casino/CasinoLayout'
import { CONNECTOR, townToScene } from '../region'

export type PlaceArea = 'Fox Plains' | 'Lake country' | 'Montello'

export const PLACE_AREAS: readonly PlaceArea[] = ['Fox Plains', 'Lake country', 'Montello']

export interface Place {
  id: string
  label: string
  area: PlaceArea
  x: number
  z: number
}

function town(id: string, label: string, x: number, z: number, area: PlaceArea = 'Fox Plains'): Place {
  const p = townToScene(x, 0, z)
  return { id, label, area, x: p.x, z: p.z }
}

function lake(id: string, label: string, x: number, z: number): Place {
  return { id, label, area: 'Lake country', x, z }
}

const SHOP_LABELS: Record<string, string> = { motors: 'Maple Motors', threads: 'Maple Threads', gas: 'Gas & Go' }
const willow = CURVES[0].pts[Math.floor(CURVES[0].pts.length / 2)]

export const FOX_LAKE_PLACES: Place[] = [
  town('depot', 'Freight depot (town spawn)', SPAWN.x, SPAWN.z - 4),
  town('depot-pad', 'Freight depot loading pad', DEPOT.padX, DEPOT.padZ + 4),
  ...SHOP_DOORS.map((d) => town(`shop-${d.id}`, SHOP_LABELS[d.id] ?? d.name, d.x, d.z)),
  town('casino', 'Northwoods Lodge Casino & Bar', CASINO.door.x, CASINO.z0 - 4),
  town('bodyshop', BODY_SHOP.name, BODY_SHOP.x, BODY_SHOP.frontZ + 5),
  ...CIVIC.map((b) => town(`civic-${b.id}`, b.name, b.x, b.z + b.d / 2 + 4)),
  town('commons', 'Maple Commons (town square)', TOWN_SQUARE_RECT.cx, TOWN_SQUARE_RECT.cz - TOWN_SQUARE_RECT.sz / 2 - 3),
  town('willow', 'Willow Bend', willow.x, willow.z),
  lake('county-road-town', 'County road at East Ave', CONNECTOR.end.x, CONNECTOR.end.z),
  lake('county-road-lake', 'County road at the interstate', CONNECTOR.start.x, CONNECTOR.start.z),
  lake('outfitters', 'Fox Outfitters (front door)', 121.3, -110.3),
  lake('dock', 'The dock', 109.1, -94.9),
  lake('wild-man', "Wild Man's camp", 75.8, -93.2),
  lake('stand-1', 'Ladder stand 1 (north-east)', 301.3, 91.4),
  lake('stand-2', 'Ladder stand 2 (east)', 343.9, -0.9),
  lake('stand-3', 'Ladder stand 3 (nearest the dock)', 210.3, -28.4),
  lake('blind', 'Ground blind (south)', 64.9, -188.3),
]

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
  { id: 'mt-bp', label: 'BP & True Value', poi: 'BP' },
]

/**
 * Montello's teleports on the loaded map, in scene coordinates. `highway` is where State Highway 23 comes into the
 * city from Fox Plains (the end of the corridor's road), when there is one.
 */
export function montelloPlaces(land: TelloLand, highway?: { x: number; z: number }): Place[] {
  const out: Place[] = []
  const add = (id: string, label: string, mx: number, mz: number) => {
    if (!land.playable(mx, mz)) return
    out.push({ id, label, area: 'Montello', x: land.toSceneX(mx), z: land.toSceneZ(mz) })
  }
  if (highway) out.push({ id: 'mt-highway-23', label: 'Highway 23 into Montello', area: 'Montello', x: highway.x, z: highway.z })
  for (const spot of MONTELLO_SPOTS) {
    const poi = land.doc.pois.find((p) => p.n === spot.poi)
    if (!poi) continue
    const [x, z] = poi.d ? [poi.d[0], poi.d[1]] : [poi.x, poi.z]
    add(spot.id, spot.label, x, z)
  }
  const lot = MONTELLO_LOTS[0]
  if (lot) {
    const front = lot.front === '+z' ? lot.z + lot.d / 2 + 3 : lot.z - lot.d / 2 - 3
    out.push(town('mt-lots', 'House lots for sale (Forest Lane)', lot.x, front, 'Montello'))
  }
  return out
}
