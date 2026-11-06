/**
 * The county's road plan as data: named streets between junctions, with the
 * lot runs that front them. Phase 1 holds the town core: Main Street (a
 * collector running east toward the airport), five avenues and three cross
 * streets on a 120 m grid, County Road heading south to the farms, and the
 * curving Ridge Road. Everything else (shapes, heights, lots) is derived.
 */
import type { RoadClassId, V2 } from './Roads';

export interface LotRun { side: 1 | -1; depth: number; minWidth: number }
export interface EdgeDef { a: V2; b: V2; cls: RoadClassId; name: string; via?: V2[]; bend?: number; lots?: LotRun[] }

const AVENUES: [number, string][] = [[-1300, 'Alder Avenue'], [-1180, 'Birch Avenue'], [-1060, 'County Road'], [-940, 'Cedar Avenue'], [-820, 'Dogwood Avenue']];
const STREETS: [number, string][] = [[320, 'Larch Street'], [440, 'Juniper Street'], [560, 'Hawthorn Street']];
const MAIN_Z = 200;
const BOTH: LotRun[] = [{ side: 1, depth: 50, minWidth: 24 }, { side: -1, depth: 50, minWidth: 24 }];

function layout(): EdgeDef[] {
  const edges: EdgeDef[] = [];
  const xs = AVENUES.map(a => a[0]);
  const mainStops = [-1990, ...xs, -640, 600];
  for (let i = 0; i < mainStops.length - 1; i++) {
    const x0 = mainStops[i], x1 = mainStops[i + 1];
    const inTown = x0 >= -1300 && x1 <= -820;
    edges.push({ a: [x0, MAIN_Z], b: [x1, MAIN_Z], cls: 'collector', name: 'Main Street', lots: inTown ? [{ side: 1, depth: 48, minWidth: 22 }] : undefined });
  }
  const zs = [MAIN_Z, ...STREETS.map(s => s[0])];
  for (const [x, name] of AVENUES) {
    for (let i = 0; i < zs.length - 1; i++) edges.push({ a: [x, zs[i]], b: [x, zs[i + 1]], cls: 'residential', name });
  }
  edges.push({ a: [-1060, -1990], b: [-1060, MAIN_Z], cls: 'residential', name: 'County Road' });
  for (const [z, name] of STREETS) {
    for (let i = 0; i < xs.length - 1; i++) edges.push({ a: [xs[i], z], b: [xs[i + 1], z], cls: 'residential', name, lots: BOTH });
  }
  edges.push({ a: [-820, 560], b: [-640, MAIN_Z], via: [[-640, 560]], bend: 130, cls: 'residential', name: 'Ridge Road', lots: [{ side: 1, depth: 40, minWidth: 24 }] });
  return edges;
}

export const LAYOUT: readonly EdgeDef[] = layout();
