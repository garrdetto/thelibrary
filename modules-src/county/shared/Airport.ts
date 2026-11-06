/**
 * The airport's paved surfaces on the level plateau east of town: runway
 * 09/27 (1,360 × 30 m), a parallel taxiway with three connectors, the apron
 * with three helipads, the trainer's parking spot and the AI traffic's stands,
 * the terminal, control tower, hangar and windsock, reached from Main Street
 * by Airport Road. North is −Z, east +X.
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
/** The terminal (landside south, glass front on the apron), control tower, hangar (door north onto its own pad) and windsock. */
export const TERMINAL: Rect = { x0: 622, z0: 86, x1: 706, z1: 112 };
export const TOWER = { x: 842, z: 102 };
export const HANGAR_AT = { x: 762, z: 99, w: 26, d: 22 };
export const WINDSOCK_AT = { x: 1200, z: -120 };
/** Where the trainer is parked: on the apron, nose south toward the taxiway. */
export const PLANE_STAND = { x: 660, z: 10, heading: Math.PI };

export const PAVED: Rect[] = [
  { x0: RUNWAY.x0, z0: RUNWAY.z - RUNWAY.width / 2, x1: RUNWAY.x1, z1: RUNWAY.z + RUNWAY.width / 2 },
  { x0: TAXIWAY.x0 - TAXIWAY.width / 2, z0: TAXIWAY.z - TAXIWAY.width / 2, x1: TAXIWAY.x1 + TAXIWAY.width / 2, z1: TAXIWAY.z + TAXIWAY.width / 2 },
  ...CONNECTORS.map(x => rect(x, (RUNWAY.z + RUNWAY.width / 2 + TAXIWAY.z - TAXIWAY.width / 2) / 2, TAXIWAY.width, TAXIWAY.z - TAXIWAY.width / 2 - (RUNWAY.z + RUNWAY.width / 2) + 0.02)),
  rect(APRON_LINK.x, (TAXIWAY.z + TAXIWAY.width / 2 + APRON.z0) / 2, APRON_LINK.width, APRON.z0 - (TAXIWAY.z + TAXIWAY.width / 2) + 0.02),
  APRON,
  { x0: HANGAR_AT.x - HANGAR_AT.w / 2 + 1, z0: APRON.z1 - 0.02, x1: HANGAR_AT.x + HANGAR_AT.w / 2 - 1, z1: HANGAR_AT.z - HANGAR_AT.d / 2 + 0.5 },
];

export const onPaving = (x: number, z: number) => PAVED.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
