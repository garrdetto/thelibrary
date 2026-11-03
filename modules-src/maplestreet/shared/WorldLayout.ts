/**
 * Deterministic town layout shared by client and server so both agree on lot
 * bounds, roads, shops and points of interest. Units: meters, Y up. Grid cell
 * = 1 m, so lot coordinates are integer grid coordinates as well.
 *
 *   West: freight depot ── Residential ring (60 lots on ten streets) ── East: downtown
 *
 * The original 20 lots (N1–N10, S1–S10) keep their ids and positions; the
 * outer blocks (N11–N30, S11–S30) were added behind them, one row per new
 * street, so saved worlds pick them up as empty lots.
 */
import { GRID_AREA, GRID_BUILDINGS, GRID_EAST, GRID_ROADS, GRID_SIDEWALKS, GRID_Z } from './DowntownGrid';

export interface LotDef {
  id: string;
  x: number; z: number;   // min corner (grid vertex)
  w: number; d: number;   // size in cells
  front: '+z' | '-z';     // which edge faces its street
}

export interface RectXZ { cx: number; cz: number; sx: number; sz: number }

export const LOT_W = 32;
export const LOT_D = 40;
export const LOTS_PER_SIDE = 5;
export const ROAD_W = 10;
export const SIDEWALK_W = 2;
export const WORLD_HALF = 640;

const ROW_X0 = -(LOT_W * LOTS_PER_SIDE) / 2;          // -80
const MAIN_FRONT = 7;                                 // lots start just past the sidewalk
const ALLEY_Z = MAIN_FRONT + LOT_D + 7;               // 54: centerline of the back streets
const BACK_FRONT = ALLEY_Z + 5;                       // 59
const AVE_X = -ROW_X0 + 7;                            // 87: side avenues
const BLOCK = LOT_D + 12;                             // 52: from one residential street to the next
const OUTER_STREETS = 4;                              // new streets on each side beyond North/South St
/** Centerlines of the outer residential streets (positive side; mirrored for the north). */
const OUTER_Z = Array.from({ length: OUTER_STREETS }, (_, i) => ALLEY_Z + BLOCK * (i + 1));   // 106, 158, 210, 262
const FAR_Z = OUTER_Z[OUTER_STREETS - 1];
const DOWNTOWN_X0 = 104, DOWNTOWN_X1 = 252;

/**
 * Twenty lots: N1–N5 / S1–S5 face Main Street, N6–N10 / S6–S10 face the
 * North and South streets from the far side.
 */
export function makeLots(): LotDef[] {
  const lots: LotDef[] = [];
  for (let i = 0; i < LOTS_PER_SIDE; i++) {
    const x = ROW_X0 + i * LOT_W;
    lots.push({ id: `N${i + 1}`, x, z: -MAIN_FRONT - LOT_D, w: LOT_W, d: LOT_D, front: '+z' });
    lots.push({ id: `S${i + 1}`, x, z: MAIN_FRONT, w: LOT_W, d: LOT_D, front: '-z' });
    lots.push({ id: `N${i + 6}`, x, z: -BACK_FRONT - LOT_D, w: LOT_W, d: LOT_D, front: '+z' });
    lots.push({ id: `S${i + 6}`, x, z: BACK_FRONT, w: LOT_W, d: LOT_D, front: '-z' });
  }
  // Outer blocks: each new street has one row of lots on its far side, facing it.
  OUTER_Z.forEach((streetZ, row) => {
    for (let i = 0; i < LOTS_PER_SIDE; i++) {
      const x = ROW_X0 + i * LOT_W, n = 11 + row * LOTS_PER_SIDE + i;
      lots.push({ id: `N${n}`, x, z: -streetZ - 5 - LOT_D, w: LOT_W, d: LOT_D, front: '+z' });
      lots.push({ id: `S${n}`, x, z: streetZ + 5, w: LOT_W, d: LOT_D, front: '-z' });
    }
  });
  return lots;
}

export const ROADS: RectXZ[] = [
  { cx: (GRID_EAST - 150) / 2, cz: 0, sx: GRID_EAST + 150, sz: ROAD_W },                 // Main Street (depot → downtown grid)
  { cx: -AVE_X, cz: 0, sx: ROAD_W, sz: FAR_Z * 2 + ROAD_W },                           // West Ave (runs the length of the neighborhood)
  { cx: AVE_X, cz: 0, sx: ROAD_W, sz: FAR_Z * 2 + ROAD_W },                            // East Ave
  { cx: 0, cz: -ALLEY_Z, sx: AVE_X * 2 + ROAD_W, sz: ROAD_W },                          // North Street
  { cx: (GRID_EAST - AVE_X - ROAD_W / 2) / 2, cz: ALLEY_Z, sx: GRID_EAST + AVE_X + ROAD_W / 2, sz: ROAD_W }, // South Street (on through the downtown grid)
  { cx: (AVE_X - ROAD_W / 2 + GRID_EAST) / 2, cz: -ALLEY_Z, sx: GRID_EAST - AVE_X + ROAD_W / 2, sz: ROAD_W }, // Commerce St (downtown back)
  { cx: DOWNTOWN_X1 + 8, cz: 0, sx: ROAD_W, sz: GRID_Z[GRID_Z.length - 1] * 2 + ROAD_W }, // Market Ave (west edge of the grid)
  ...OUTER_Z.flatMap(z => [
    { cx: 0, cz: -z, sx: AVE_X * 2 + ROAD_W, sz: ROAD_W },
    { cx: 0, cz: z, sx: AVE_X * 2 + ROAD_W, sz: ROAD_W },
  ]),
  ...GRID_ROADS.map(r => r.rect),
];

/** Street names, in ROADS order. */
export const ROAD_NAMES = ['Main St', 'West Ave', 'East Ave', 'North St', 'South St', 'Commerce St', 'Market Ave', 'Birch St', 'Aspen St', 'Cedar St', 'Dogwood St', 'Elm St', 'Fir St', 'Hazel St', 'Juniper St', ...GRID_ROADS.map(r => r.name)];

/** Which edge of a sidewalk faces its road; without one the road is toward Main Street (z = 0). */
export type RoadSide = '+x' | '-x' | '+z' | '-z';
export type Sidewalk = RectXZ & { road?: RoadSide };

/**
 * Residential sidewalks in the 2 m strips the layout already leaves clear:
 * behind the back yards along every street, and on the lot side of West and
 * East Ave between the cross streets (stopping short of the corners so no
 * two slabs overlap).
 */
function residentialSidewalks(): Sidewalk[] {
  const out: Sidewalk[] = [];
  const streets = [ALLEY_Z, ...OUTER_Z];
  for (const z of streets) for (const sign of [1, -1]) {
    out.push({ cx: 0, cz: sign * (z - 6), sx: AVE_X * 2 - ROAD_W, sz: SIDEWALK_W, road: sign > 0 ? '+z' : '-z' });
  }
  const crossings = [0, ...streets];
  for (let i = 0; i < crossings.length - 1; i++) {
    const z0 = crossings[i] + ROAD_W / 2, z1 = crossings[i + 1] - ROAD_W / 2 - SIDEWALK_W;
    for (const sign of [1, -1]) for (const side of [1, -1]) {
      out.push({ cx: side * (AVE_X - ROAD_W / 2 - SIDEWALK_W / 2), cz: sign * (z0 + z1) / 2, sx: SIDEWALK_W, sz: z1 - z0, road: side > 0 ? '+x' : '-x' });
    }
  }
  return out;
}

export const SIDEWALKS: Sidewalk[] = [
  { cx: 0, cz: -6, sx: -ROW_X0 * 2, sz: SIDEWALK_W },
  { cx: 0, cz: 6, sx: -ROW_X0 * 2, sz: SIDEWALK_W },
  { cx: (DOWNTOWN_X0 + DOWNTOWN_X1) / 2, cz: -7, sx: DOWNTOWN_X1 - DOWNTOWN_X0, sz: 4 },  // wide downtown sidewalks
  { cx: 136, cz: -60, sx: 64, sz: 2 },                                                   // in front of the fire and police stations
  // South downtown sidewalk, split by the two curb cuts into the gas station (x 111–119 and 129–137).
  { cx: (DOWNTOWN_X0 + 111) / 2, cz: 7, sx: 111 - DOWNTOWN_X0, sz: 4 },
  { cx: 124, cz: 7, sx: 10, sz: 4 },
  { cx: (137 + DOWNTOWN_X1) / 2, cz: 7, sx: DOWNTOWN_X1 - 137, sz: 4 },
  ...residentialSidewalks(),
  ...GRID_SIDEWALKS,
];

/** Driveway aprons where the curb is dropped so cars can leave the street (beyond the lot driveways). */
export const CURB_CUTS: RectXZ[] = [
  { cx: 115, cz: 7, sx: 8, sz: 4 },            // Gas & Go entrance
  { cx: 133, cz: 7, sx: 8, sz: 4 },            // Gas & Go exit
  { cx: -128, cz: -7, sx: 20, sz: 4 },         // freight depot yard
  { cx: 94, cz: -18, sx: 4, sz: 16 },          // Maple Motors display lot off East Ave
  { cx: 118, cz: -60, sx: 18, sz: 4 },         // fire station apron onto Commerce St
  { cx: 154, cz: -60, sx: 8, sz: 4 },          // police station lot
];

export type ShopKind = 'gas' | 'dealer' | 'diner' | 'cafe' | 'grocery' | 'hardware' | 'bank' | 'clothing';

/** Buildings that are scenery: no shop door. */
export const SCENERY_KINDS = ['office', 'apartments', 'fire', 'police', 'retail', 'hotel', 'cinema', 'townhall', 'library'] as const;
export type SceneryKind = (typeof SCENERY_KINDS)[number];
export const isShopKind = (kind: Building['kind']): kind is ShopKind => !(SCENERY_KINDS as readonly string[]).includes(kind);

/** A building downtown. Shops have a door you walk (or drive) up to. */
export interface Building {
  id: string;
  name: string;
  kind: ShopKind | SceneryKind;
  x: number; z: number; w: number; d: number;   // footprint center + size
  h: number;                                    // height (m)
  facing: '+z' | '-z';                          // storefront side (toward Main Street)
  color: string;
  /** Grid buildings: lighter facades, detailed only on the street front and on ends that face an avenue. */
  lite?: boolean;
  ends?: { w: boolean; e: boolean };
}

const N = -9, S = 9;                         // storefront lines just behind the wide sidewalks
const bld = (id: string, name: string, kind: Building['kind'], x: number, w: number, d: number, h: number, side: 'n' | 's', color: string): Building =>
  ({ id, name, kind, x, w, d, h, facing: side === 'n' ? '+z' : '-z', z: side === 'n' ? N - d / 2 : S + d / 2, color });

export const BUILDINGS: Building[] = [
  bld('motors', 'Maple Motors', 'dealer', 128, 26, 18, 7, 'n', '#d9dde2'),
  bld('diner', 'Corner Diner', 'diner', 152, 14, 14, 6, 'n', '#b8463a'),
  bld('apt1', 'Elm Court Apartments', 'apartments', 170, 18, 16, 16, 'n', '#a77a5c'),
  bld('bank', 'First Neighbors Savings & Loan', 'bank', 192, 20, 16, 11, 'n', '#d8d1c2'),
  bld('office1', 'Maple Tower', 'office', 216, 18, 18, 26, 'n', '#7d8b99'),
  bld('threads', 'Maple Threads', 'clothing', 239, 18, 14, 8, 'n', '#e3d6c4'),
  bld('cafe', 'Bean There Café', 'cafe', 240, 14, 12, 7, 's', '#3f6b5a'),
  bld('grocery', 'Fresh Market', 'grocery', 210, 28, 20, 7, 's', '#e8e3d4'),
  bld('hardware', 'Maple Hardware', 'hardware', 182, 20, 18, 8, 's', '#c96f2c'),
  bld('apt2', 'Willow Lofts', 'apartments', 160, 16, 14, 13, 's', '#8a6a55'),
  ...GRID_BUILDINGS,
];

/**
 * Civic buildings on the north side of Commerce St, just behind downtown:
 * a fire station with apparatus bays and a police station. Not shops.
 */
const CIVIC_FRONT = -ALLEY_Z - 7;            // -61: building line behind Commerce St's north sidewalk
export const CIVIC: Building[] = [
  { id: 'fire', name: 'Maple Street Fire Station 1', kind: 'fire', x: 118, w: 24, d: 20, h: 9, facing: '+z', z: CIVIC_FRONT - 10, color: '#9b3b2e' },
  { id: 'police', name: 'Maple Street Police', kind: 'police', x: 154, w: 26, d: 18, h: 10, facing: '+z', z: CIVIC_FRONT - 9, color: '#c9c3b5' },
];


/** Gas station on the downtown corner: canopy over four pumps plus a mini-mart. */
export const GAS_STATION = {
  id: 'gas', name: 'Gas & Go',
  canopy: { x: 124, z: 24, w: 22, d: 12 },
  pumps: [{ x: 117, z: 21 }, { x: 117, z: 27 }, { x: 131, z: 21 }, { x: 131, z: 27 }],
  store: { x: 124, z: 40, w: 16, d: 9 },
  door: { x: 124, z: 35.2 },
};

export interface ShopDoor { id: string; kind: ShopKind; name: string; x: number; z: number }

/** Interaction points: stand (or park) within SHOP_RADIUS of a door to use the shop. */
export const SHOP_DOORS: ShopDoor[] = [
  ...BUILDINGS.filter(b => isShopKind(b.kind)).map(b => ({
    id: b.id, kind: b.kind as ShopKind, name: b.name, x: b.x, z: b.facing === '+z' ? b.z + b.d / 2 + 1.5 : b.z - b.d / 2 - 1.5,
  })),
  { id: 'gas', kind: 'gas', name: GAS_STATION.name, x: GAS_STATION.door.x, z: GAS_STATION.door.z },
];
export const SHOP_RADIUS = 6;
export const PUMP_RADIUS = 4.5;

export const BANK = (() => { const b = BUILDINGS.find(x => x.id === 'bank')!; return { x: b.x, z: b.z, w: b.w, d: b.d, doorX: b.x, doorZ: b.z + b.d / 2 + 1.5, zoneR: SHOP_RADIUS }; })();
export const DEPOT = { x: -128, z: -22, w: 22, d: 14, padX: -128, padZ: -11, zoneR: 6 };
export const SPAWN = { x: -112, z: 9 };

/** Half-extent of the built-up area (forest stays out of it). */
export const TOWN_HALF = { x: AVE_X + 8, z: FAR_Z + 5 + LOT_D + 6 };
export const DOWNTOWN = { x0: DOWNTOWN_X0, x1: DOWNTOWN_X1 + 14, z0: -ALLEY_Z - 6, z1: 52 };
/** The civic block behind downtown (fire and police), kept clear of trees and grass. */
export const CIVIC_BLOCK: RectXZ = { cx: 136, cz: -76, sx: 72, sz: 34 };
/** Everything the town map and minimap should show. */
export const MAP_BOUNDS = { x0: -158, x1: GRID_AREA.x1 + 6, z0: -TOWN_HALF.z, z1: TOWN_HALF.z };
export { GRID_AREA, GRID_BLOCKS, TOWN_SQUARE, TOWN_SQUARE_RECT } from './DowntownGrid';
export const STREETS = { ALLEY_Z, AVE_X, ROW_X0, MAIN_FRONT, BACK_FRONT, OUTER_Z, FAR_Z };

/** Each lot's concrete driveway: 4 m wide at the left of the frontage, 12 m deep. */
export function drivewayRect(lot: LotDef): RectXZ {
  const frontZ = lot.front === '+z' ? lot.z + lot.d : lot.z;
  const dir = lot.front === '+z' ? -1 : 1;
  return { cx: lot.x + 4, cz: frontZ + dir * 4, sx: 4, sz: 12 };
}
