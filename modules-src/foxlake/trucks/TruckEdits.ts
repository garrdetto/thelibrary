/**
 * The world edits that make room for Truck Simulator in Montello, merged in front of the published World Editor edits at load
 * (`foxlake/index.ts`): Haulers Lane as a graded street north off State Highway 23 just east of Foxtails, each truck lot and
 * each outskirts site levelled to its own average height and cleared of trees, and every site's driveway as a gravel road from
 * the public road into the site. Built from Truck Simulator's Montello world (`trucksim/shared/montello/MontelloWorld.ts`,
 * Life Sim's town frame) and turned into Tello's map frame (z north = −town z). Heights are map metres read from the grids
 * before any edit, so the result is the same every load. Op ids start with `trucks-`.
 */
import type { MapGrids, MapDoc } from '../../tello/data/MapData'
import type { EditOp } from '../../tello/edits/WorldEdits'
import { HAULERS_LANE, MONTELLO_LOTS, MONTELLO_SITES, montelloDriveways } from '../../trucksim/shared/montello/MontelloWorld'

export const TRUCK_EDIT_PREFIX = 'trucks-'
const LOT_FALLOFF = 10
const SITE_FALLOFF = 14

/** Average ground height (map metres) over a map-frame rectangle, sampled every 8 m. */
function averageHeight(doc: MapDoc, grids: MapGrids, x0: number, z0: number, x1: number, z1: number): number {
  const f = doc.frame
  const side = grids.side
  let sum = 0, n = 0
  for (let x = x0; x <= x1; x += 8) {
    for (let z = z0; z <= z1; z += 8) {
      const i = Math.min(side - 1, Math.max(0, Math.round((x - f.x0) / f.cell)))
      const j = Math.min(side - 1, Math.max(0, Math.round((z - f.z0) / f.cell)))
      sum += grids.ground[j * side + i] / 100
      n++
    }
  }
  return n ? Math.round((sum / n) * 100) / 100 : 0
}

const ring = (x0: number, z0: number, x1: number, z1: number) => [x0, z0, x1, z0, x1, z1, x0, z1]

/** The edits for the lane, the lots, the sites and their driveways. */
export function truckEdits(doc: MapDoc, grids: MapGrids): EditOp[] {
  const ops: EditOp[] = []
  const base = { ts: 0 }
  const laneX = HAULERS_LANE.x
  const laneZ0 = -HAULERS_LANE.z0
  const laneZ1 = -HAULERS_LANE.z1
  ops.push({ ...base, id: `${TRUCK_EDIT_PREFIX}lane-trees`, type: 'trees', mode: 'remove', shape: { k: 'area', ring: ring(laneX - 145, laneZ0, laneX + 145, laneZ1 + 10) } })
  for (const lot of MONTELLO_LOTS) {
    const x0 = lot.x, x1 = lot.x + lot.w
    const z0 = -(lot.z + lot.d), z1 = -lot.z
    ops.push({ ...base, id: `${TRUCK_EDIT_PREFIX}lot-${lot.index}`, type: 'terrain', mode: 'flatten', shape: { k: 'area', ring: ring(x0, z0, x1, z1) }, falloff: LOT_FALLOFF, height: averageHeight(doc, grids, x0, z0, x1, z1), carry: false })
  }
  ops.push({
    ...base, id: `${TRUCK_EDIT_PREFIX}lane`, type: 'road', pts: [laneX, laneZ0, laneX, laneZ1], curve: 0, w: HAULERS_LANE.width, k: 1, n: 'Haulers Lane',
    grade: { shoulder: 2, falloff: 8, smooth: 60 },
  })
  for (const site of MONTELLO_SITES) {
    if (site.w <= 60 || site.kind === 'lotDistrict') continue
    const x0 = site.x - site.w / 2, x1 = site.x + site.w / 2
    const z0 = -(site.z + site.d / 2), z1 = -(site.z - site.d / 2)
    const tag = site.id.split(':')[1]
    ops.push({ ...base, id: `${TRUCK_EDIT_PREFIX}${tag}-trees`, type: 'trees', mode: 'remove', shape: { k: 'area', ring: ring(x0 - 12, z0 - 12, x1 + 12, z1 + 12) } })
    ops.push({ ...base, id: `${TRUCK_EDIT_PREFIX}${tag}-level`, type: 'terrain', mode: 'flatten', shape: { k: 'area', ring: ring(x0, z0, x1, z1) }, falloff: SITE_FALLOFF, height: averageHeight(doc, grids, x0, z0, x1, z1), carry: false })
  }
  montelloDriveways().forEach((drive, i) => {
    const [a, b] = drive.points
    ops.push({ ...base, id: `${TRUCK_EDIT_PREFIX}drive-${i}`, type: 'road', pts: [a[0], -a[1], b[0], -b[1]], curve: 0, w: 7, k: 3, n: 'Driveway', grade: { shoulder: 1, falloff: 5, smooth: 20 } })
  })
  return ops
}
