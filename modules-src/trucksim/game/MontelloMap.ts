/**
 * Montello for the haul map (`MapDraw.ts`): the baked public roads, Haulers Lane and the site driveways, the outskirts sites and
 * the Haulers Lane lots, in Life Sim's town frame (x east, z south), over a 10 km square round City Hall.
 */
import { HAULERS_LANE, MONTELLO_LOTS, MONTELLO_SITES, montelloDriveways } from '../shared/montello/MontelloWorld'
import { MONTELLO_ROAD_DATA } from '../shared/montello/MontelloRoads'
import type { RoadKind } from '../shared/WorldLayout'
import type { MapRoad, MapSource } from './MapDraw'

const KINDS: RoadKind[] = ['highway', 'road', 'street', 'gravel']
const HALF = 5000

function roads(): MapRoad[] {
  const list: MapRoad[] = MONTELLO_ROAD_DATA.map((entry) => {
    const points: [number, number][] = []
    for (let k = 2; k + 1 < entry.length; k += 2) points.push([entry[k], entry[k + 1]])
    return { kind: KINDS[entry[0]] ?? 'street', width: entry[1], points }
  })
  list.push({ kind: 'street', width: HAULERS_LANE.width, points: [[HAULERS_LANE.x, HAULERS_LANE.z0], [HAULERS_LANE.x, HAULERS_LANE.z1]] })
  for (const drive of montelloDriveways()) list.push({ kind: 'gravel', width: 7, points: drive.points })
  return list
}

export function montelloMapSource(): MapSource {
  return {
    x0: -HALF, z0: -HALF, size: HALF * 2, xWest: false, zNorth: false, pixels: 2048, background: '#2f3b2b',
    roads: roads(), sites: MONTELLO_SITES, lots: MONTELLO_LOTS, minRoadPx: 3.5,
    faint: (site) => site.kind === 'lotDistrict',
  }
}
