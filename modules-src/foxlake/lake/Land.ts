import { TelloLand } from '../../tello/region'
import type { MapDoc, MapGrids } from '../../tello/data/MapData'
import type { WorldEdits } from '../../tello/edits/WorldEdits'
import { MONTELLO_AT } from '../region'
import { rebaseLand } from './Rebase'

/**
 * Montello's land as Fox Lake plays it: placed at `MONTELLO_AT`, with the World Editor's published `edits` replayed on
 * the surveyed heights and then Lake Montello's surface moved to y = 0 (`rebaseLand`).
 */
export function foxLakeLand(doc: MapDoc, grids: MapGrids, edits?: WorldEdits | null): TelloLand {
  return rebaseLand(new TelloLand(doc, grids, MONTELLO_AT, edits))
}
