import { TelloLand } from '../../tello/region'
import type { MapDoc, MapGrids } from '../../tello/data/MapData'
import { MONTELLO_AT } from '../region'
import { rebaseLand } from './Rebase'

/** Montello's land as Fox Lake plays it: placed at `MONTELLO_AT`, with Lake Montello's surface at y = 0 (`rebaseLand`). */
export function foxLakeLand(doc: MapDoc, grids: MapGrids): TelloLand {
  return rebaseLand(new TelloLand(doc, grids, MONTELLO_AT))
}
