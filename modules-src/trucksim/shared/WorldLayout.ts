/**
 * The county map: highway loop, Main Street and County Road crossing at Millbrook, connectors to every work site, the sites
 * with their work zones, and the sixteen player lots on Haulers Row. Renderer-free and shared with the Worker (job distances).
 * Everything is axis-aligned; a zone's `heading` is the way a parked truck faces, `(sin h, 0, cos h)`.
 */

export const WORLD_SIZE = 4096
export const WORLD_HALF = WORLD_SIZE / 2
export const CHUNK_SIZE = 256
export const CHUNKS_PER_SIDE = WORLD_SIZE / CHUNK_SIZE

export type RoadKind = 'highway' | 'road' | 'gravel' | 'street'

export interface Road {
  id: string
  name: string
  kind: RoadKind
  width: number
  points: [number, number][]
  loop?: boolean
}

export type ZoneKind =
  | 'dumpLoad' | 'dumpUnload'
  | 'tankLoad' | 'tankUnload'
  | 'flatLoad' | 'flatUnload'
  | 'grainLoad' | 'grainUnload'
  | 'reeferDock'
  | 'equipPickup' | 'equipDrop'
  | 'fuel' | 'service' | 'dealer' | 'wash'

export type SiteKind =
  | 'dealership' | 'truckStop' | 'fuelStation' | 'quarry' | 'construction' | 'equipmentYard' | 'refinery' | 'farm'
  | 'elevator' | 'coldStorage' | 'distribution' | 'steelMill' | 'lumberYard' | 'buildingSupply' | 'town' | 'lotDistrict'

export interface Zone {
  id: string
  site: string
  kind: ZoneKind
  label: string
  x: number
  z: number
  w: number
  d: number
  heading: number
  /** Where the site's machine, spout, arm or forklift works from, or (equipment drop) where the machine must be parked. */
  equipment?: { x: number; z: number; heading: number }
  /** Reefer docks: the door centre on the building face; the trailer's rear must stop here. */
  dock?: { x: number; z: number }
}

export interface Site {
  id: string
  name: string
  kind: SiteKind
  x: number
  z: number
  w: number
  d: number
  zones: Zone[]
}

export interface LotSpec {
  index: number
  /** Minimum corner (world). */
  x: number
  z: number
  w: number
  d: number
  side: 'west' | 'east'
  /** Where the lot meets Haulers Row (world), the driveway centre. */
  gate: { x: number; z: number }
}

export const LOT_W = 120
export const LOT_D = 90
export const LOT_COUNT = 16
/** Montello's lots (Haulers Lane, `shared/montello/MontelloWorld.ts`) are numbered from here, so lot numbers never clash between worlds. */
export const MONTELLO_LOT_BASE = 100
export const MONTELLO_LOT_COUNT = 16

/** True for a lot number some world has: Haulers Row's 0–15 or Haulers Lane's 100–115. */
export function knownLotIndex(index: number): boolean {
  return Number.isInteger(index) && ((index >= 0 && index < LOT_COUNT) || (index >= MONTELLO_LOT_BASE && index < MONTELLO_LOT_BASE + MONTELLO_LOT_COUNT))
}
export const HAULERS_ROW_X = -900
/** Extra land is bought in strips this deep, added at the back of the lot (away from Haulers Row). */
export const LAND_STRIP_M = 30
export const MAX_LAND_STRIPS = 4
/** The deepest a lot can grow (from the road back). */
export const LOT_MAX_W = LOT_W + LAND_STRIP_M * MAX_LAND_STRIPS

const HALF_PI = Math.PI / 2

function roundedLoop(half: number, radius: number, stepDeg = 7.5): [number, number][] {
  const points: [number, number][] = []
  const corners: [number, number, number][] = [
    [half - radius, half - radius, 0],
    [-(half - radius), half - radius, 90],
    [-(half - radius), -(half - radius), 180],
    [half - radius, -(half - radius), 270],
  ]
  for (const [cx, cz, start] of corners) {
    for (let a = start; a <= start + 90 + 1e-6; a += stepDeg) {
      const r = (a * Math.PI) / 180
      points.push([Math.round((cx + Math.cos(r) * radius) * 100) / 100, Math.round((cz + Math.sin(r) * radius) * 100) / 100])
    }
  }
  return points
}

export const ROADS: Road[] = [
  { id: 'loop', name: 'County Loop Highway', kind: 'highway', width: 16, points: roundedLoop(1500, 250), loop: true },
  { id: 'main', name: 'Main Street', kind: 'road', width: 11, points: [[-1500, 0], [-1290, 0], [-900, 0], [-560, 0], [-420, 0], [0, 0], [190, 0], [420, 0], [620, 0], [900, 0], [1150, 0], [1500, 0]] },
  { id: 'county', name: 'County Road', kind: 'road', width: 11, points: [[0, -1500], [0, 0], [0, 1160], [0, 1500]] },
  { id: 'haulers', name: 'Haulers Row', kind: 'road', width: 12, points: [[HAULERS_ROW_X, 0], ...Array.from({ length: 8 }, (_, row) => [HAULERS_ROW_X, 117 + row * 96] as [number, number]), [HAULERS_ROW_X, 960], [-1050, 960]] },
  { id: 'quarry-rd', name: 'Quarry Road', kind: 'gravel', width: 10, points: [[0, 1160], [200, 1160]] },
  { id: 'oak-rd', name: 'Oak Hollow Drive', kind: 'gravel', width: 9, points: [[900, 0], [900, 520]] },
  { id: 'route9-rd', name: 'Route 9 Access', kind: 'road', width: 10, points: [[1150, 0], [1150, -560]] },
  { id: 'riverside-rd', name: 'Riverside Avenue', kind: 'road', width: 10, points: [[-560, 0], [-560, -850]] },
  { id: 'refinery-rd', name: 'Refinery Road', kind: 'road', width: 11, points: [[1500, 900], [1560, 900]] },
  { id: 'hansen-rd', name: 'Hansen Lane', kind: 'gravel', width: 8, points: [[-1500, 1250], [-1650, 1250]] },
  { id: 'miller-rd', name: 'Miller Lane', kind: 'gravel', width: 8, points: [[-360, 1500], [-360, 1620]] },
  { id: 'cold-rd', name: 'Cold Storage Way', kind: 'road', width: 11, points: [[1050, 1500], [1050, 1210], [1100, 1210]] },
  { id: 'dc-rd', name: 'Market Street', kind: 'road', width: 11, points: [[-1150, -1500], [-1150, -1250]] },
  { id: 'steel-rd', name: 'Ironworks Road', kind: 'road', width: 11, points: [[1500, -1150], [1560, -1150]] },
  { id: 'lumber-rd', name: 'Pine Valley Road', kind: 'gravel', width: 9, points: [[-1500, -500], [-1630, -500]] },
  { id: 'supply-rd', name: 'Depot Road', kind: 'road', width: 10, points: [[420, 0], [420, -680]] },
  { id: 'dealer-dr', name: 'Big Rig Motors drive', kind: 'street', width: 10, points: [[-420, 0], [-420, -30]] },
  { id: 'fuel-dr', name: 'Fuel & Go drive', kind: 'street', width: 10, points: [[190, 0], [190, -35]] },
  { id: 'truckstop-dr', name: 'Travel Center drive', kind: 'street', width: 12, points: [[-1290, 0], [-1290, -35]] },
  { id: 'yard-dr', name: 'Heavy Iron drive', kind: 'street', width: 10, points: [[620, 0], [620, -75]] },
  { id: 'st-1', name: 'Elm Street', kind: 'street', width: 8, points: [[-120, -200], [-120, 200]] },
  { id: 'st-2', name: 'Oak Street', kind: 'street', width: 8, points: [[120, -30], [120, 200]] },
  { id: 'st-3', name: 'First Avenue', kind: 'street', width: 8, points: [[-200, 120], [200, 120]] },
  { id: 'st-4', name: 'Second Avenue', kind: 'street', width: 8, points: [[-200, -120], [0, -120]] },
]

function zone(site: string, id: string, kind: ZoneKind, label: string, x: number, z: number, w: number, d: number, heading: number, extra: Partial<Zone> = {}): Zone {
  return { id: `${site}:${id}`, site, kind, label, x, z, w, d, heading, ...extra }
}

export const SITES: Site[] = [
  {
    id: 'dealer', name: 'Big Rig Motors', kind: 'dealership', x: -420, z: -75, w: 150, d: 90,
    zones: [zone('dealer', 'desk', 'dealer', 'Sales desk', -420, -45, 30, 16, Math.PI)],
  },
  {
    id: 'truckstop', name: 'Crossroads Travel Center', kind: 'truckStop', x: -1290, z: -95, w: 170, d: 120,
    zones: [
      zone('truckstop', 'fuel', 'fuel', 'Diesel lanes', -1300, -65, 36, 22, HALF_PI),
      zone('truckstop', 'tank', 'tankUnload', 'Underground tank fill', -1240, -130, 24, 10, HALF_PI, { equipment: { x: -1240, z: -138, heading: 0 } }),
      zone('truckstop', 'service', 'service', 'Truck service bay', -1345, -130, 20, 14, HALF_PI),
      zone('truckstop', 'wash', 'wash', 'Truck wash lane', -1298, -127, 26, 9, HALF_PI),
    ],
  },
  {
    id: 'fuelgo', name: 'Main Street Fuel & Go', kind: 'fuelStation', x: 190, z: -65, w: 80, d: 60,
    zones: [
      zone('fuelgo', 'fuel', 'fuel', 'Diesel pumps', 185, -55, 26, 14, HALF_PI),
      zone('fuelgo', 'tank', 'tankUnload', 'Underground tank fill', 205, -84, 20, 8, HALF_PI, { equipment: { x: 205, z: -90, heading: 0 } }),
    ],
  },
  {
    id: 'quarry', name: 'Bluestone Quarry', kind: 'quarry', x: 360, z: 1160, w: 320, d: 260,
    zones: [
      zone('quarry', 'bay1', 'dumpLoad', 'Excavator bay', 310, 1150, 22, 8, HALF_PI, { equipment: { x: 310, z: 1166, heading: Math.PI } }),
      zone('quarry', 'bay2', 'dumpLoad', 'Loader bay', 410, 1150, 22, 8, HALF_PI, { equipment: { x: 410, z: 1172, heading: Math.PI } }),
    ],
  },
  {
    id: 'oak', name: 'Oak Hollow Subdivision', kind: 'construction', x: 900, z: 620, w: 240, d: 200,
    zones: [
      zone('oak', 'dump', 'dumpUnload', 'Fill area', 860, 600, 20, 20, 0),
      zone('oak', 'equip', 'equipDrop', 'Equipment staging', 960, 610, 12, 40, 0, { equipment: { x: 988, z: 605, heading: 0 } }),
      zone('oak', 'flat', 'flatUnload', 'Material drop', 900, 682, 30, 14, HALF_PI, { equipment: { x: 900, z: 696, heading: Math.PI } }),
    ],
  },
  {
    id: 'route9', name: 'Route 9 Overpass', kind: 'construction', x: 1150, z: -650, w: 220, d: 180,
    zones: [
      zone('route9', 'dump', 'dumpUnload', 'Embankment fill', 1100, -640, 20, 20, Math.PI),
      zone('route9', 'equip', 'equipDrop', 'Equipment staging', 1210, -650, 12, 40, Math.PI, { equipment: { x: 1238, z: -650, heading: Math.PI } }),
      zone('route9', 'flat', 'flatUnload', 'Material drop', 1150, -712, 30, 14, HALF_PI, { equipment: { x: 1150, z: -726, heading: 0 } }),
    ],
  },
  {
    id: 'riverside', name: 'Riverside Plaza', kind: 'construction', x: -560, z: -950, w: 240, d: 200,
    zones: [
      zone('riverside', 'dump', 'dumpUnload', 'Site fill', -610, -930, 20, 20, Math.PI),
      zone('riverside', 'equip', 'equipDrop', 'Equipment staging', -500, -950, 12, 40, Math.PI, { equipment: { x: -472, z: -950, heading: Math.PI } }),
      zone('riverside', 'flat', 'flatUnload', 'Material drop', -560, -1012, 30, 14, HALF_PI, { equipment: { x: -560, z: -1026, heading: 0 } }),
    ],
  },
  {
    id: 'yard', name: 'Heavy Iron Rentals', kind: 'equipmentYard', x: 620, z: -135, w: 180, d: 120,
    zones: [zone('yard', 'pickup', 'equipPickup', 'Lowboy staging', 645, -135, 12, 40, Math.PI, { equipment: { x: 595, z: -140, heading: Math.PI } })],
  },
  {
    id: 'refinery', name: 'Prairie Gulf Refinery', kind: 'refinery', x: 1760, z: 900, w: 400, d: 360,
    zones: [
      zone('refinery', 'rack1', 'tankLoad', 'Loading rack lane 1', 1660, 880, 30, 8, HALF_PI, { equipment: { x: 1655, z: 885, heading: 0 } }),
      zone('refinery', 'rack2', 'tankLoad', 'Loading rack lane 2', 1660, 920, 30, 8, HALF_PI, { equipment: { x: 1655, z: 925, heading: 0 } }),
    ],
  },
  {
    id: 'hansen', name: 'Hansen Farms', kind: 'farm', x: -1760, z: 1250, w: 220, d: 200,
    zones: [zone('hansen', 'bins', 'grainLoad', 'Grain bin spout', -1720, 1240, 26, 8, -HALF_PI, { equipment: { x: -1720, z: 1240, heading: 0 } })],
  },
  {
    id: 'miller', name: 'Miller Grain Farm', kind: 'farm', x: -360, z: 1720, w: 240, d: 200,
    zones: [zone('miller', 'bins', 'grainLoad', 'Grain bin spout', -340, 1700, 8, 26, 0, { equipment: { x: -340, z: 1700, heading: 0 } })],
  },
  {
    id: 'elevator', name: 'County Co-op Elevator', kind: 'elevator', x: -1150, z: 960, w: 200, d: 160,
    zones: [zone('elevator', 'pit', 'grainUnload', 'Receiving pit', -1110, 960, 26, 8, -HALF_PI, { equipment: { x: -1110, z: 960, heading: 0 } })],
  },
  {
    id: 'cold', name: 'Northland Cold Storage', kind: 'coldStorage', x: 1150, z: 1260, w: 240, d: 180,
    zones: [1110, 1130, 1150].map((x, i) => zone('cold', `dock${i + 1}`, 'reeferDock', `Dock door ${i + 1}`, x, 1259, 5, 18, Math.PI, { dock: { x, z: 1268 } })),
  },
  {
    id: 'dc', name: 'Fresh Market Distribution', kind: 'distribution', x: -1150, z: -1160, w: 260, d: 200,
    zones: [-1190, -1170, -1150].map((x, i) => zone('dc', `dock${i + 1}`, 'reeferDock', `Dock door ${i + 1}`, x, -1139, 5, 18, Math.PI, { dock: { x, z: -1130 } })),
  },
  {
    id: 'steel', name: 'Ironworks Steel', kind: 'steelMill', x: 1760, z: -1150, w: 400, d: 300,
    zones: [zone('steel', 'bay', 'flatLoad', 'Crane bay', 1680, -1150, 30, 14, HALF_PI, { equipment: { x: 1680, z: -1150, heading: 0 } })],
  },
  {
    id: 'lumber', name: 'Pine Valley Lumber', kind: 'lumberYard', x: -1760, z: -500, w: 260, d: 220,
    zones: [zone('lumber', 'bay', 'flatLoad', 'Loading bay', -1720, -500, 30, 14, -HALF_PI, { equipment: { x: -1720, z: -516, heading: 0 } })],
  },
  {
    id: 'supply', name: 'Builders Depot', kind: 'buildingSupply', x: 420, z: -760, w: 220, d: 160,
    zones: [zone('supply', 'bay', 'flatUnload', 'Receiving yard', 420, -770, 30, 14, HALF_PI, { equipment: { x: 420, z: -786, heading: 0 } })],
  },
  { id: 'town', name: 'Millbrook', kind: 'town', x: 0, z: 40, w: 440, d: 440, zones: [] },
  { id: 'row', name: 'Haulers Row', kind: 'lotDistrict', x: HAULERS_ROW_X, z: 453, w: 2 * (LOT_MAX_W + 12), d: 786, zones: [] },
]

export const LOTS: LotSpec[] = Array.from({ length: LOT_COUNT }, (_, index) => {
  const side = index % 2 === 0 ? 'west' : 'east'
  const row = Math.floor(index / 2)
  const x = side === 'west' ? HAULERS_ROW_X - 10 - LOT_W : HAULERS_ROW_X + 10
  const z = 72 + row * 96
  return { index, x, z, w: LOT_W, d: LOT_D, side, gate: { x: side === 'west' ? x + LOT_W : x, z: z + LOT_D / 2 } }
})

/** Haulers Row and the elevator share one flattened district so the long row of lots and its road sit level. */
export const DISTRICT = { x: -905, z: 550, w: 710, d: 1000 }

/** Crop fields around the farms (drawn as rows, slower off-road grip). */
export const FIELDS: { x: number; z: number; w: number; d: number; crop: 'corn' | 'soybeans' | 'wheat' }[] = [
  { x: -1760, z: 1475, w: 220, d: 230, crop: 'corn' },
  { x: -1760, z: 1025, w: 220, d: 230, crop: 'wheat' },
  { x: -630, z: 1720, w: 280, d: 200, crop: 'soybeans' },
  { x: -90, z: 1720, w: 260, d: 200, crop: 'corn' },
]

export const SITE_BY_ID: Record<string, Site> = Object.fromEntries(SITES.map((s) => [s.id, s]))
export const ZONE_BY_ID: Record<string, Zone> = Object.fromEntries(SITES.flatMap((s) => s.zones).map((z) => [z.id, z]))
export const ALL_ZONES: Zone[] = SITES.flatMap((s) => s.zones)

export function zonesOfKind(kind: ZoneKind): Zone[] {
  return ALL_ZONES.filter((z) => z.kind === kind)
}

/** True when the point lies inside the zone's rectangle grown by `margin` metres. */
export function inZone(zone: Zone, x: number, z: number, margin = 0): boolean {
  return Math.abs(x - zone.x) <= zone.w / 2 + margin && Math.abs(z - zone.z) <= zone.d / 2 + margin
}

export function inRect(rect: { x: number; z: number; w: number; d: number }, x: number, z: number, margin = 0): boolean {
  return Math.abs(x - rect.x) <= rect.w / 2 + margin && Math.abs(z - rect.z) <= rect.d / 2 + margin
}

/**
 * A lot grown by `strips` of bought land at its back. West-side lots grow toward −X, so their minimum corner moves; build items
 * are kept in road-anchored coordinates by `shared/Actions.ts` (it shifts them when a west lot grows), so this is the one place
 * that turns a lot and its strips into a rectangle.
 */
export function lotExtent(lot: LotSpec, strips: number): LotSpec {
  const extra = Math.max(0, Math.min(MAX_LAND_STRIPS, Math.floor(strips))) * LAND_STRIP_M
  if (extra === 0) return lot
  return { ...lot, x: lot.side === 'west' ? lot.x - extra : lot.x, w: lot.w + extra }
}

export function lotAt(x: number, z: number): LotSpec | null {
  return LOTS.find((lot) => x >= lot.x && x <= lot.x + lot.w && z >= lot.z && z <= lot.z + lot.d) ?? null
}

/** Signed smallest difference between two headings, in (-π, π]. */
export function headingDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d <= -Math.PI) d += Math.PI * 2
  return d
}

/** Where a new driver starts before they have a lot: the shoulder of Haulers Row facing north. */
export const DEFAULT_SPAWN = { x: HAULERS_ROW_X + 3, z: 30, heading: 0 }

export function lotSpawn(lot: LotSpec): { x: number; z: number; heading: number } {
  const inward = lot.side === 'west' ? -1 : 1
  return { x: lot.gate.x + inward * 25, z: lot.gate.z, heading: lot.side === 'west' ? HALF_PI : -HALF_PI }
}
