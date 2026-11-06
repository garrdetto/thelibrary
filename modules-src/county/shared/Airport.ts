/**
 * The airport's paved surfaces on the level plateau east of town: runway
 * 09/27 (1,360 × 30 m), a parallel taxiway with three connectors, the apron
 * with three helipads and the trainer's parking spot, reached from Main
 * Street by Airport Road. The rest of the airport (terminal, tower, hangars)
 * comes later. North is −Z, east +X.
 */
import { AIRPORT } from './Base';

export interface Rect { x0: number; z0: number; x1: number; z1: number }

const rect = (cx: number, cz: number, w: number, d: number): Rect => ({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2 });

export const ELEV = AIRPORT.elev;
export const RUNWAY = { x0: 520, x1: 1880, z: -150, width: 30 };
export const TAXIWAY = { x0: 560, x1: 1840, z: -90, width: 15 };
export const CONNECTORS = [560, 1200, 1840];
export const APRON: Rect = { x0: 560, z0: -70, x1: 820, z1: 75 };
export const APRON_LINK = { x: 640, width: 18 };
export const HELIPADS = [{ x: 790, z: 50 }, { x: 790, z: 20 }, { x: 790, z: -10 }].map(p => ({ ...p, r: 8 }));
/** Where the trainer is parked: on the apron, nose south toward the taxiway. */
export const PLANE_STAND = { x: 660, z: 10, heading: Math.PI };

export const PAVED: Rect[] = [
  { x0: RUNWAY.x0, z0: RUNWAY.z - RUNWAY.width / 2, x1: RUNWAY.x1, z1: RUNWAY.z + RUNWAY.width / 2 },
  { x0: TAXIWAY.x0 - TAXIWAY.width / 2, z0: TAXIWAY.z - TAXIWAY.width / 2, x1: TAXIWAY.x1 + TAXIWAY.width / 2, z1: TAXIWAY.z + TAXIWAY.width / 2 },
  ...CONNECTORS.map(x => rect(x, (RUNWAY.z + RUNWAY.width / 2 + TAXIWAY.z - TAXIWAY.width / 2) / 2, TAXIWAY.width, TAXIWAY.z - TAXIWAY.width / 2 - (RUNWAY.z + RUNWAY.width / 2) + 0.02)),
  rect(APRON_LINK.x, (TAXIWAY.z + TAXIWAY.width / 2 + APRON.z0) / 2, APRON_LINK.width, APRON.z0 - (TAXIWAY.z + TAXIWAY.width / 2) + 0.02),
  APRON,
];

export const onPaving = (x: number, z: number) => PAVED.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
