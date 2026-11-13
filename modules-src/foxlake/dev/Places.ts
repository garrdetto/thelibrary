/**
 * The developer panel's teleport list: Fox Lake's points of interest in scene
 * coordinates (+x east, +z north; the same frame as `host.player`). To add a
 * place, add a row. Town places are worked out from the shared town layout,
 * which is in town coordinates (`town(...)` converts); lake-country places are
 * where Rack & Reel puts its landmarks on Fox Lake's terrain (the dock's land
 * end, Fox Outfitters' door, Wild Man's camp, the foot of each stand's ladder).
 * tests/dev.test.ts checks that every place is on dry ground inside the world
 * and that the lake-country ones still match the game's own landmark finders.
 */
import { BODY_SHOP } from '../../maplestreet/shared/BodyShop'
import { CIVIC, CURVES, DEPOT, SHOP_DOORS, SPAWN, TOWN_SQUARE_RECT } from '../../maplestreet/shared/WorldLayout'
import { CASINO } from '../casino/CasinoLayout'
import { CONNECTOR, townToScene } from '../region'

export interface Place {
  id: string
  label: string
  x: number
  z: number
}

function town(id: string, label: string, x: number, z: number): Place {
  const p = townToScene(x, 0, z)
  return { id, label, x: p.x, z: p.z }
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
  { id: 'county-road-town', label: 'County road at East Ave', x: CONNECTOR.end.x, z: CONNECTOR.end.z },
  { id: 'county-road-lake', label: 'County road at the interstate', x: CONNECTOR.start.x, z: CONNECTOR.start.z },
  { id: 'outfitters', label: 'Fox Outfitters (front door)', x: 121.3, z: -110.3 },
  { id: 'dock', label: 'The dock', x: 109.1, z: -94.9 },
  { id: 'wild-man', label: "Wild Man's camp", x: 75.8, z: -93.2 },
  { id: 'stand-1', label: 'Ladder stand 1 (north-east)', x: 301.3, z: 91.4 },
  { id: 'stand-2', label: 'Ladder stand 2 (east)', x: 343.9, z: -0.9 },
  { id: 'stand-3', label: 'Ladder stand 3 (nearest the dock)', x: 210.3, z: -28.4 },
  { id: 'blind', label: 'Ground blind (south)', x: 64.9, z: -188.3 },
]
