/**
 * Starter houses for the simulated neighbors, so a brand-new neighborhood
 * already has furnished homes, yards and roofs. Every house is produced as
 * ordinary BuildOps and run through validateOp, exactly like a player's.
 */
import { applyOp, BuildOp, FloorMat, Opening, RoofStyle, validateOp, WallStyle, wallKey, WorldState } from './BuildRules';
import { CATALOG, footprint } from './Catalog';

interface HouseSpec { lotId: string; owner: string; name: string; style: WallStyle; roof: RoofStyle; floor: FloorMat; stories: 1 | 2; extras?: ('pool' | 'hoop' | 'court' | 'swings')[] }

export const NEIGHBOR_HOUSES: HouseSpec[] = [
  { lotId: 'N2', owner: 'npc-hendricks', name: 'Hendricks', style: 'siding_white', roof: 'gable_x', floor: 'oak', stories: 1, extras: ['hoop', 'pool'] },
  { lotId: 'N4', owner: 'npc-alvarez', name: 'Alvarez', style: 'brick_red', roof: 'hip', floor: 'herringbone', stories: 2, extras: ['court'] },
  { lotId: 'S2', owner: 'npc-okafor', name: 'Okafor', style: 'siding_sage', roof: 'gable_x', floor: 'oak', stories: 1, extras: ['swings', 'hoop'] },
  { lotId: 'S5', owner: 'npc-lindqvist', name: 'Lindqvist', style: 'stucco_sand', roof: 'flat', floor: 'marble', stories: 1, extras: ['pool'] },
  { lotId: 'N8', owner: 'npc-brennan', name: 'Brennan', style: 'stone', roof: 'gable_x', floor: 'walnut', stories: 2 },
  { lotId: 'S7', owner: 'npc-nakamura', name: 'Nakamura', style: 'board_batten', roof: 'gable_z', floor: 'oak', stories: 1, extras: ['hoop'] },
];

const W = 12, D = 10, SETBACK = 12, X_OFF = 10;

export function seedNeighborhood(world: WorldState) {
  for (const spec of NEIGHBOR_HOUSES) {
    const lot = world.lots[spec.lotId];
    if (!lot || lot.owner) continue;
    lot.owner = spec.owner; lot.ownerName = spec.name;
    for (const op of houseOps(world, spec)) {
      const reason = validateOp(world, op, spec.owner);
      if (reason) { console.warn(`[seed] ${spec.lotId} ${op.op}: ${reason}`); continue; }
      applyOp(world, op, spec.owner, spec.name);
    }
  }
}

function houseOps(world: WorldState, s: HouseSpec): BuildOp[] {
  const lot = world.lots[s.lotId];
  const flip = lot.front === '-z';
  const x0 = lot.x + X_OFF;
  const zF = flip ? lot.z + SETBACK : lot.z + lot.d - SETBACK;   // front wall line
  // Local layout: u runs along the street (0..W), v from the front wall back (0..D).
  const vz = (v: number) => (flip ? zF + v : zF - v);              // vertex line
  const cz = (v: number) => (flip ? zF + v : zF - v - 1);          // cell row
  const ops: BuildOp[] = [];
  const lotId = s.lotId;
  let n = 0;
  const id = () => `${s.owner.slice(4, 8)}${s.lotId}${(n++).toString(36).padStart(3, '0')}`;

  const rowWall = (level: number, v: number, u0: number, u1: number) =>
    ops.push({ op: 'walls', lotId, level, style: s.style, segs: Array.from({ length: u1 - u0 }, (_, i) => ({ gx: x0 + u0 + i, gz: vz(v), dir: 'x' as const })) });
  const colWall = (level: number, u: number, v0: number, v1: number) =>
    ops.push({ op: 'walls', lotId, level, style: s.style, segs: Array.from({ length: v1 - v0 }, (_, i) => ({ gx: x0 + u, gz: cz(v0 + i), dir: 'z' as const })) });
  const openRow = (level: number, v: number, u: number, opening: Opening) => ops.push({ op: 'opening', lotId, key: wallKey(level, 'x', x0 + u, vz(v)), opening });
  const openCol = (level: number, u: number, v: number, opening: Opening) => ops.push({ op: 'opening', lotId, key: wallKey(level, 'z', x0 + u, cz(v)), opening });
  const floor = (level: number, u0: number, v0: number, u1: number, v1: number, mat: FloorMat) =>
    ops.push({ op: 'floor', lotId, level, mat, x0: x0 + u0, x1: x0 + u1 - 1, z0: Math.min(cz(v0), cz(v1 - 1)), z1: Math.max(cz(v0), cz(v1 - 1)) });
  /** Local rot 0 faces the street. A Z-mirror flips even rotations and keeps odd ones. */
  const obj = (catalogId: string, u: number, v: number, rot: number, level = 0) => {
    const r = flip ? (rot % 2 === 0 ? (rot + 2) % 4 : rot) : rot;
    const { d } = footprint(CATALOG[catalogId], r);
    ops.push({ op: 'object', lotId, obj: { id: id(), catalogId, gx: x0 + u, gz: flip ? zF + v : zF - v - d, rot: r, level } });
  };

  // ---- ground floor shell
  floor(0, 0, 0, W, 5, s.floor);                 // living room (front)
  floor(0, 0, 5, 7, D, 'tile');                  // kitchen + dining (back left)
  floor(0, 7, 5, W, D, 'carpet');                // bedroom (back right)
  rowWall(0, 0, 0, W); rowWall(0, D, 0, W);
  colWall(0, 0, 0, D); colWall(0, W, 0, D);
  rowWall(0, 5, 0, W);                           // living / back rooms
  colWall(0, 7, 5, D);                           // kitchen / bedroom

  openRow(0, 0, 6, 'door');
  for (const u of [2, 3, 9, 10]) openRow(0, 0, u, 'window');
  for (const v of [2, 7]) { openCol(0, 0, v, 'window'); openCol(0, W, v, 'window'); }
  openRow(0, D, 3, 'door');                      // back door to the patio
  for (const u of [8, 9, 10]) openRow(0, D, u, 'picture');
  openRow(0, 5, 3, 'door'); openRow(0, 5, 9, 'door');

  // ---- living room
  obj('sofa', 4, 2, 2);
  obj('coffeeTable', 5, 3, 0);
  obj('tvStand', 5, 4, 0);
  obj('armchair', 1, 2, 3);
  obj('bookshelf', 11, 1, 1);
  obj('floorLamp', 1, 4, 0);
  obj('plant', 11, 4, 0);

  // ---- kitchen + dining
  obj('fridge', 0, 9, 0);
  obj('counter', 1, 9, 0); obj('stove', 2, 9, 0); obj('counter', 4, 9, 0); obj('counter', 5, 9, 0);
  obj('diningSet', 2, 6, 0);
  obj('plant', 6, 5, 0);

  // ---- bedroom
  obj('bed', 9, 7, 2);
  obj('nightstand', 8, 9, 0); obj('nightstand', 11, 9, 0);
  obj('dresser', 7, 5, 2);

  if (s.stories === 2) {
    floor(1, 0, 0, W, D, 'carpet');
    rowWall(1, 0, 0, W); rowWall(1, D, 0, W);
    colWall(1, 0, 0, D); colWall(1, W, 0, D);
    for (const u of [2, 3, 6, 9, 10]) openRow(1, 0, u, 'window');
    for (const u of [3, 9]) openRow(1, D, u, 'window');
    for (const v of [2, 7]) { openCol(1, 0, v, 'window'); openCol(1, W, v, 'window'); }
    obj('bed', 2, 6, 2, 1); obj('dresser', 9, 8, 2, 1); obj('bookshelf', 11, 2, 1, 1); obj('armchair', 8, 2, 0, 1);
  }

  const top = s.stories - 1;
  const minZ = Math.min(vz(0), vz(D)), maxZ = Math.max(vz(0), vz(D));
  ops.push({ op: 'roof', lotId, roof: { id: id(), x0, x1: x0 + W, z0: minZ, z1: maxZ, level: top, style: s.roof, pitchDeg: s.roof === 'flat' ? 0 : 32 } });

  // ---- yard
  for (const u of [0, 2, 9, 11]) obj('shrub', u, -1, 0);
  obj('grill', 1, D + 2, 0);
  obj('patioSet', 4, D + 2, 0);
  const backV = flip ? lot.z + lot.d - 1 - zF : zF - lot.z - 1;   // last cell row of the lot
  // Picket fence along the back and both sides of the back yard (a fence-type wall run).
  const backLine = flip ? lot.z + lot.d : lot.z;
  ops.push({ op: 'walls', lotId, level: 0, style: s.style, kind: 'picket', segs: Array.from({ length: lot.w }, (_, i) => ({ gx: lot.x + i, gz: backLine, dir: 'x' as const })) });
  const sideFrom = Math.min(vz(D + 1), backLine), sideTo = Math.max(vz(D + 1), backLine);
  for (const gx of [lot.x, lot.x + lot.w]) ops.push({ op: 'walls', lotId, level: 0, style: s.style, kind: 'picket', segs: Array.from({ length: sideTo - sideFrom }, (_, i) => ({ gx, gz: sideFrom + i, dir: 'z' as const })) });
  void backV;
  obj('plant', -1, 0, 0);
  obj('flowerBed', 7, -2, 0);
  obj('rugLarge', 4, 1, 0);
  obj('painting', 5, 4, 0);
  obj('ceilingLight', 5, 2, 0);
  obj('chandelier', 3, 7, 0);

  for (const extra of s.extras ?? []) {
    if (extra === 'hoop') obj('hoop', -X_OFF + 3, -2, 0);
    if (extra === 'swings') obj('swingSet', 7, D + 6, 0);
    if (extra === 'court') obj('court', 3, D + 5, 2);
    if (extra === 'pool') {
      const z0 = Math.min(vz(D + 5), vz(D + 10)), z1 = Math.max(vz(D + 5), vz(D + 10));
      ops.push({ op: 'pool', lotId, pool: { id: id(), x0: x0 + 2, x1: x0 + 11, z0, z1 } });
      obj('lounger', 12, D + 5, 0); obj('lounger', 12, D + 8, 0);
    }
  }
  return ops;
}
