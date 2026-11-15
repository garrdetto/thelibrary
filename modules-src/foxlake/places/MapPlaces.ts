/**
 * What Fox Lake adds to Montello's map of places: the counters that have no mapped business of their own (Maple Threads,
 * the body shop, the freight depot, the outfitter's counter, the casino) get a row in the baked `pois`, so the map lists
 * them, draws their dot and gives directions to them (the shop doors and gas stations are mapped already). The club
 * building Foxtails stands in is rebuilt as the casino, so Tello draws only its street sign.
 */
import { MONTELLO_DEPOT, MONTELLO_SHOPS } from '../../maplestreet/shared/MontelloPlaces'
import type { MapDoc, Poi } from '../../tello/data/MapData'
import { REPLACED_BUILDINGS } from '../../tello/world/Businesses'
import { CASINO, SITE, localToTown } from '../casino/CasinoLayout'

const FOXTAILS = "Foxtails Gentlemen's Club"

function row(name: string, type: string, townX: number, townZ: number, street: string, facing: number): Poi {
  return { n: name, k: 'shop', t: type, x: townX, z: -townZ, s: street, d: [townX, -townZ, facing] }
}

export function registerMapPlaces(doc: MapDoc): void {
  if (doc.pois.some((p) => p.n === SITE.name)) return
  REPLACED_BUILDINGS.add(FOXTAILS)
  for (const shop of MONTELLO_SHOPS) {
    if (shop.kind === 'clothing') doc.pois.push(row(shop.name, 'shop:clothes', shop.x, shop.z, shop.street, 0))
    else if (shop.kind === 'bodyshop') doc.pois.push(row(shop.name, 'shop:car_repair', shop.x, shop.z, shop.street, 0))
    else if (shop.kind === 'outfitter') doc.pois.push(row('Fox Outfitters', 'shop:outdoor', shop.x, shop.z, shop.street, 0))
  }
  if (MONTELLO_DEPOT) doc.pois.push(row(MONTELLO_DEPOT.name, 'depot', MONTELLO_DEPOT.x, MONTELLO_DEPOT.z, '', 0))
  const door = localToTown(CASINO.door.x, CASINO.z0)
  doc.pois.push(row(SITE.name, 'amenity:casino', door.x, door.z, 'State Highway 23', SITE.yaw))
}
