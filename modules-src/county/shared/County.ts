/** The whole county built once from the plan: the road network and the graded terrain. */
import { RoadNet } from './Roads';
import { Terrain } from './Terrain';

export interface County { net: RoadNet; terrain: Terrain }

let built: County | null = null;

export function county(): County {
  if (!built) { const net = new RoadNet(); built = { net, terrain: new Terrain(net) }; }
  return built;
}
