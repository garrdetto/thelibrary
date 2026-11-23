/**
 * Montello as a Truck Simulator haul world (id `montello`), in Life Sim's right-handed town frame: x east, z = −(map z), heading
 * `h` faces `(sin h, 0, cos h)` as everywhere else in the module. Downtown is left as it is: the truck lots stand on Haulers Lane,
 * a new lane running north off State Highway 23 just east of Foxtails, out of town; deliveries go to places that are already
 * there (gas stations, the feed mill, the hardware and grocery stores on the south side, the tire shop by Foxtails), named by what
 * they are rather than by brand, and to new sites on open land outside the city limits (found clear of buildings, water and
 * roads by `tools/find-montello-sites`). Renderer-free and shared with the Worker.
 */
import type { HaulWorld } from '../HaulWorld'
import { createRoadNetwork, zoneDistances } from '../RoadGraph'
import type { RoadLine, RoutePath } from '../RoadGraph'
import type { LotSpec, Site, SiteKind, Zone, ZoneKind } from '../WorldLayout'
import { LOT_D, LOT_W, MONTELLO_LOT_BASE, MONTELLO_LOT_COUNT } from '../WorldLayout'
import { MONTELLO_DISTANCES, MONTELLO_DISTANCE_ZONES } from './MontelloDistances'
import { MONTELLO_ROAD_DATA } from './MontelloRoads'

const HALF_PI = Math.PI / 2
/** The baked roads are simplified to within 2 m, so road ends join within a little more than that. */
const JOIN_TOLERANCE = 2.5

/** Haulers Lane: from State Highway 23 (map z 590) north to map z 1450, at map x 2000. */
export const HAULERS_LANE_X = 2000
export const HAULERS_LANE = { x: HAULERS_LANE_X, z0: -590, z1: -1450, width: 10 }

/** Map point (x east, z north) to the town frame. */
function town(x: number, z: number): [number, number] {
  return [x, -z]
}

function zone(site: string, id: string, kind: ZoneKind, label: string, x: number, z: number, w: number, d: number, heading: number, extra: Partial<Zone> = {}): Zone {
  return { id: `montello:${site}:${id}`, site: `montello:${site}`, kind, label, x, z, w, d, heading, ...extra }
}

type ZonePlan = (cx: number, cz: number) => Zone[]

function site(id: string, name: string, kind: SiteKind, mapX: number, mapZ: number, w: number, d: number, zones: ZonePlan): Site {
  const [x, z] = town(mapX, mapZ)
  return { id: `montello:${id}`, name, kind, x, z, w, d, zones: zones(x, z) }
}

/** A building-site layout like the county's: fill area, equipment staging and a material drop. */
const construction = (id: string): ZonePlan => (x, z) => [
  zone(id, 'dump', 'dumpUnload', 'Fill area', x - 40, z - 20, 20, 20, 0),
  zone(id, 'equip', 'equipDrop', 'Equipment staging', x + 60, z - 10, 12, 40, 0, { equipment: { x: x + 88, z: z - 15, heading: 0 } }),
  zone(id, 'flat', 'flatUnload', 'Material drop', x, z + 62, 30, 14, HALF_PI, { equipment: { x, z: z + 76, heading: Math.PI } }),
]

/** A zone beside a building that is already in Montello (found clear by the site finder), as a small site of its own. */
function existing(id: string, name: string, kind: SiteKind, mapX: number, mapZ: number, zones: ZonePlan): Site {
  return site(id, name, kind, mapX, mapZ, 60, 50, zones)
}

export const MONTELLO_SITES: Site[] = [
  site('dealer', 'Eastside Truck Sales', 'dealership', 1980, 460, 150, 90, (x, z) => [zone('dealer', 'desk', 'dealer', 'Sales desk', x - 20, z - 25, 30, 16, Math.PI)]),
  site('plaza', 'Foxtails Truck Plaza', 'truckStop', 1860, 320, 170, 120, (x, z) => [
    zone('plaza', 'fuel', 'fuel', 'Diesel lanes', x - 10, z + 30, 36, 22, HALF_PI),
    zone('plaza', 'tank', 'tankUnload', 'Underground tank fill', x + 50, z - 35, 24, 10, HALF_PI, { equipment: { x: x + 50, z: z - 43, heading: 0 } }),
    zone('plaza', 'service', 'service', 'Truck service bay', x - 55, z - 35, 20, 14, HALF_PI),
    zone('plaza', 'wash', 'wash', 'Truck wash lane', x - 8, z - 32, 26, 9, HALF_PI),
  ]),
  site('yard', 'Eastside Equipment Rental', 'equipmentYard', 1650, 860, 180, 120, (x, z) => [
    zone('yard', 'pickup', 'equipPickup', 'Lowboy staging', x + 25, z, 12, 40, Math.PI, { equipment: { x: x - 25, z: z - 5, heading: Math.PI } }),
  ]),
  site('quarry', 'Fox River Aggregates', 'quarry', 2480, -1280, 320, 260, (x, z) => [
    zone('quarry', 'bay1', 'dumpLoad', 'Excavator bay', x - 50, z - 10, 22, 8, HALF_PI, { equipment: { x: x - 50, z: z + 6, heading: Math.PI } }),
    zone('quarry', 'bay2', 'dumpLoad', 'Loader bay', x + 50, z - 10, 22, 8, HALF_PI, { equipment: { x: x + 50, z: z + 12, heading: Math.PI } }),
  ]),
  site('terminal', 'Marquette Bulk Fuel Terminal', 'refinery', 3120, 920, 260, 200, (x, z) => [
    zone('terminal', 'rack1', 'tankLoad', 'Loading rack lane 1', x - 60, z - 20, 30, 8, HALF_PI, { equipment: { x: x - 65, z: z - 15, heading: 0 } }),
    zone('terminal', 'rack2', 'tankLoad', 'Loading rack lane 2', x - 60, z + 20, 30, 8, HALF_PI, { equipment: { x: x - 65, z: z + 25, heading: 0 } }),
  ]),
  site('cold', 'Lakeland Cold Storage', 'coldStorage', 1980, 1700, 240, 180, (x, z) => [-40, -20, 0].map((dx, i) => zone('cold', `dock${i + 1}`, 'reeferDock', `Dock door ${i + 1}`, x + dx, z - 1, 5, 18, Math.PI, { dock: { x: x + dx, z: z + 8 } }))),
  site('lumber', 'Northwoods Lumber', 'lumberYard', -2080, 320, 260, 220, (x, z) => [
    zone('lumber', 'bay', 'flatLoad', 'Loading bay', x + 40, z, 30, 14, -HALF_PI, { equipment: { x: x + 40, z: z - 16, heading: 0 } }),
  ]),
  site('steel', 'Riverbend Steel Supply', 'steelMill', 1200, -1120, 300, 240, (x, z) => [
    zone('steel', 'bay', 'flatLoad', 'Crane bay', x - 60, z, 30, 14, HALF_PI, { equipment: { x: x - 60, z, heading: 0 } }),
  ]),
  site('farm1', 'Buffalo Lake Farm', 'farm', 920, 2760, 220, 200, (x, z) => [
    zone('farm1', 'bins', 'grainLoad', 'Grain bin spout', x + 40, z - 10, 26, 8, -HALF_PI, { equipment: { x: x + 40, z: z - 10, heading: 0 } }),
  ]),
  site('farm2', 'Carriage Road Farm', 'farm', -1440, 2540, 220, 200, (x, z) => [
    zone('farm2', 'bins', 'grainLoad', 'Grain bin spout', x + 20, z - 20, 8, 26, 0, { equipment: { x: x + 20, z: z - 20, heading: 0 } }),
  ]),
  site('eastridge', 'Eastridge Subdivision', 'construction', 1640, 1560, 240, 200, construction('eastridge')),
  site('westfield', 'Westfield Business Park', 'construction', -1620, -1220, 240, 200, construction('westfield')),
  existing('gas23', 'Highway 23 gas station', 'fuelStation', 917, 395, (x, z) => [
    zone('gas23', 'fuel', 'fuel', 'Diesel pump', x, z, 30, 14, HALF_PI),
    zone('gas23', 'tank', 'tankUnload', 'Underground tank fill', x, z, 24, 10, HALF_PI, { equipment: { x, z: z - 8, heading: 0 } }),
  ]),
  existing('gassouth', 'South Main gas station', 'fuelStation', 220, -891, (x, z) => [
    zone('gassouth', 'tank', 'tankUnload', 'Underground tank fill', x, z, 24, 10, HALF_PI, { equipment: { x, z: z - 7, heading: 0 } }),
  ]),
  existing('gasdowntown', 'Downtown gas station', 'fuelStation', 280, 7, (x, z) => [
    zone('gasdowntown', 'tank', 'tankUnload', 'Underground tank fill', x, z, 22, 9, HALF_PI, { equipment: { x, z: z - 7, heading: 0 } }),
  ]),
  existing('feedmill', 'Feed mill on the Fox River', 'elevator', 244, -645, (x, z) => [
    zone('feedmill', 'pit', 'grainUnload', 'Receiving pit', x, z, 26, 8, HALF_PI, { equipment: { x, z, heading: 0 } }),
  ]),
  existing('hardware', 'South side hardware store', 'buildingSupply', 246, -868, (x, z) => [
    zone('hardware', 'bay', 'flatUnload', 'Receiving yard', x, z, 30, 14, HALF_PI, { equipment: { x, z: z - 16, heading: 0 } }),
  ]),
  existing('grocery', 'South side grocery store', 'distribution', 329, -1314, (x, z) => [
    zone('grocery', 'dock1', 'reeferDock', 'Receiving door', x, z, 5, 18, Math.PI, { dock: { x, z: z + 9 } }),
  ]),
  existing('tires', 'Tire shop by Foxtails', 'truckStop', 1664, 367, (x, z) => [zone('tires', 'service', 'service', 'Tire and repair bay', x, z, 20, 14, HALF_PI)]),
  { id: 'montello:lane', name: 'Haulers Lane', kind: 'lotDistrict', x: HAULERS_LANE_X, z: (HAULERS_LANE.z0 + HAULERS_LANE.z1) / 2, w: 2 * (LOT_W + 12), d: HAULERS_LANE.z0 - HAULERS_LANE.z1, zones: [] },
]

/** Sixteen lots on Haulers Lane, west and east of the lane in rows of two, numbered from `MONTELLO_LOT_BASE`. */
export const MONTELLO_LOTS: LotSpec[] = Array.from({ length: MONTELLO_LOT_COUNT }, (_, i) => {
  const side = i % 2 === 0 ? 'west' : 'east'
  const row = Math.floor(i / 2)
  const x = side === 'west' ? HAULERS_LANE_X - 10 - LOT_W : HAULERS_LANE_X + 10
  const z = HAULERS_LANE.z0 - 60 - LOT_D - row * 96
  return { index: MONTELLO_LOT_BASE + i, x, z, w: LOT_W, d: LOT_D, side, gate: { x: side === 'west' ? x + LOT_W : x, z: z + LOT_D / 2 } }
})

/**
 * Each outskirts site's driveway: from the nearest point on Montello's roads (found by snapping the site's centre to the baked
 * network) into the middle of the site, offsets from the site centre in the town frame. Phase 2 draws them as gravel drives.
 */
export const DRIVEWAY_ENTRIES: Record<string, [number, number]> = {
  'montello:dealer': [-56, -58],
  'montello:plaza': [-68, -71],
  'montello:yard': [102, 1],
  'montello:quarry': [138, -152],
  'montello:terminal': [-114, -135],
  'montello:cold': [-2, 103],
  'montello:lumber': [3, -131],
  'montello:steel': [94, -152],
  'montello:farm1': [129, 11],
  'montello:farm2': [124, 121],
  'montello:eastridge': [120, 19],
  'montello:westfield': [137, -20],
  'montello:feedmill': [-3, 39],
  'montello:tires': [50, 52],
}

/** Montello's public roads and Haulers Lane (no driveways). */
export const MONTELLO_PUBLIC_ROADS: RoadLine[] = [
  ...MONTELLO_ROAD_DATA.map((entry) => {
    const points: [number, number][] = []
    for (let k = 2; k + 1 < entry.length; k += 2) points.push([entry[k], entry[k + 1]])
    return { points }
  }),
  { points: [[HAULERS_LANE_X, HAULERS_LANE.z0], [HAULERS_LANE_X, HAULERS_LANE.z1]] },
]

let driveways: RoadLine[] | null = null

/**
 * The driveways as road lines: each entry is snapped exactly onto the public roads (so the road graph joins it) and runs to the
 * site centre.
 */
export function montelloDriveways(): RoadLine[] {
  if (driveways) return driveways
  const roads = createRoadNetwork(MONTELLO_PUBLIC_ROADS, JOIN_TOLERANCE)
  driveways = MONTELLO_SITES.filter((site) => DRIVEWAY_ENTRIES[site.id]).map((site) => {
    const [dx, dz] = DRIVEWAY_ENTRIES[site.id]
    const approx = [site.x + dx, site.z + dz]
    const snapped = roads.route(approx[0], approx[1], approx[0] + 0.01, approx[1]).points[1] ?? approx
    return { points: [[snapped[0], snapped[1]], [site.x, site.z]] }
  })
  return driveways
}

const network = createRoadNetworkLazy(() => [...MONTELLO_PUBLIC_ROADS, ...montelloDriveways()])

function createRoadNetworkLazy(roads: () => RoadLine[]): { route: (fx: number, fz: number, tx: number, tz: number) => RoutePath } {
  let built: ReturnType<typeof createRoadNetwork> | null = null
  return { route: (fx, fz, tx, tz) => (built ??= createRoadNetwork(roads(), JOIN_TOLERANCE)).route(fx, fz, tx, tz) }
}
const ZONES = MONTELLO_SITES.flatMap((s) => s.zones)
const ZONE_INDEX = new Map(ZONES.map((z) => [z.id, z]))
const SITE_INDEX = new Map(MONTELLO_SITES.map((s) => [s.id, s]))
const LOT_INDEX = new Map(MONTELLO_LOTS.map((lot) => [lot.index, lot]))

/** The drive between two town-frame points on Montello's roads. */
export function montelloRoute(fromX: number, fromZ: number, toX: number, toZ: number): RoutePath {
  return network.route(fromX, fromZ, toX, toZ)
}

/** A new driver without a lot starts on Haulers Lane by the highway, facing north. */
export const MONTELLO_SPAWN = { x: HAULERS_LANE_X + 3, z: HAULERS_LANE.z0 - 20, heading: Math.PI }

const DISTANCE_INDEX = new Map(MONTELLO_DISTANCE_ZONES.map((id, i) => [id, i]))
const graphDistance = zoneDistances(network)

/** Zone-to-zone road metres from the baked table (no graph needed, as in the Worker), else measured on the road graph. */
function routeDistance(from: Zone, to: Zone): number {
  const a = DISTANCE_INDEX.get(from.id)
  const b = DISTANCE_INDEX.get(to.id)
  const baked = a === undefined || b === undefined ? undefined : MONTELLO_DISTANCES[a]?.[b]
  return baked !== undefined && baked > 0 ? baked : graphDistance(from, to)
}

export const MONTELLO: HaulWorld = {
  id: 'montello',
  sites: MONTELLO_SITES,
  zones: ZONES,
  lots: MONTELLO_LOTS,
  lot: (index: number) => LOT_INDEX.get(index),
  zone: (id: string) => ZONE_INDEX.get(id),
  site: (id: string) => SITE_INDEX.get(id),
  zonesOfKind: (kind: ZoneKind) => ZONES.filter((z) => z.kind === kind),
  routeDistance,
}
