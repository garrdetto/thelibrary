/**
 * Deterministic neighborhood layout shared by client and server so both agree
 * on lot bounds, roads and points of interest. Units: meters, Y up.
 * Grid cell = 1 m, so lot coordinates are integer grid coordinates as well.
 */
export interface LotDef {
  id: string;
  x: number; z: number;   // min corner (grid vertex)
  w: number; d: number;   // size in cells
  front: '+z' | '-z';     // which edge faces the main street
}

export interface RectXZ { cx: number; cz: number; sx: number; sz: number }

export const LOT_W = 24;
export const LOT_D = 30;
export const LOTS_PER_SIDE = 5;
export const ROAD_W = 10;
export const SIDEWALK_W = 2;
export const WORLD_HALF = 260;

export function makeLots(): LotDef[] {
  const lots: LotDef[] = [];
  for (let i = 0; i < LOTS_PER_SIDE; i++) {
    const x = -60 + i * LOT_W;
    lots.push({ id: `N${i + 1}`, x, z: -7 - LOT_D, w: LOT_W, d: LOT_D, front: '+z' });
    lots.push({ id: `S${i + 1}`, x, z: 7, w: LOT_W, d: LOT_D, front: '-z' });
  }
  return lots;
}

/** Ring road + main street extending to the bank (east) and depot (west). */
export const ROADS: RectXZ[] = [
  { cx: 0, cz: 0, sx: 230, sz: ROAD_W },     // Main Street
  { cx: -67, cz: 0, sx: ROAD_W, sz: 98 },    // West Ave
  { cx: 67, cz: 0, sx: ROAD_W, sz: 98 },     // East Ave
  { cx: 0, cz: -44, sx: 144, sz: ROAD_W },   // North Alley
  { cx: 0, cz: 44, sx: 144, sz: ROAD_W },    // South Alley
];

/** Raised sidewalks along Main Street in front of the lots. */
export const SIDEWALKS: RectXZ[] = [
  { cx: 0, cz: -6, sx: 120, sz: SIDEWALK_W },
  { cx: 0, cz: 6, sx: 120, sz: SIDEWALK_W },
];

export const BANK = { x: 100, z: -22, w: 18, d: 14, doorX: 100, doorZ: -13.5, zoneR: 5 };
export const DEPOT = { x: -100, z: -22, w: 22, d: 14, padX: -100, padZ: -11, zoneR: 6 };
export const SPAWN = { x: -88, z: 9 };
