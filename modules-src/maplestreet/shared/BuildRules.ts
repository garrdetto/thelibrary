/**
 * Authoritative house-building model.
 *
 * Everything here is pure data + pure functions with no rendering or network
 * dependencies, so the exact same rules run in three places:
 *   1. the client, to colour build ghosts green/red before sending,
 *   2. the in-browser host (local multi-tab mode),
 *   3. the Colyseus server.
 * The server is the one that matters: a client that skips validation still
 * cannot touch a lot it does not own, because ops are re-validated there.
 *
 * Grid: 1 cell = 1 m. Walls live on grid EDGES (between two vertices),
 * floors and objects live on CELLS.
 */
import { CATALOG, footprint } from './Catalog';
import { COST, LOT_PRICE } from './Economy';
import { LotDef } from './WorldLayout';

export const LEVEL_HEIGHT = 3.0;
export const FOUNDATION_H = 0.25;
export const MAX_LEVEL = 2;           // levels 0..2 (three storeys)
export const MAX_SEGMENTS_PER_OP = 200;

export type WallDir = 'x' | 'z';
export type Opening = 'none' | 'door' | 'window' | 'picture';
export type WallStyle = 'siding_white' | 'siding_sage' | 'brick_red' | 'stucco_sand' | 'stone';
export type FloorMat = 'oak' | 'walnut' | 'tile' | 'carpet' | 'slate' | 'concrete';
export type RoofStyle = 'gable_x' | 'gable_z' | 'flat';

export interface Wall { gx: number; gz: number; dir: WallDir; level: number; style: WallStyle; opening: Opening }
export interface Floor { gx: number; gz: number; level: number; mat: FloorMat }
export interface PlacedObject { id: string; catalogId: string; gx: number; gz: number; rot: number; level: number }
export interface Roof { id: string; x0: number; z0: number; x1: number; z1: number; level: number; style: RoofStyle; pitchDeg: number }

export interface LotBuild {
  walls: Record<string, Wall>;
  floors: Record<string, Floor>;
  objects: Record<string, PlacedObject>;
  roofs: Record<string, Roof>;
}

export interface LotState extends LotDef { owner: string | null; ownerName: string | null }

export interface WorldState {
  lots: Record<string, LotState>;
  builds: Record<string, LotBuild>;
  version: number;
}

export type BuildOp =
  | { op: 'buyLot'; lotId: string }
  | { op: 'walls'; lotId: string; level: number; style: WallStyle; segs: { gx: number; gz: number; dir: WallDir }[] }
  | { op: 'removeWall'; lotId: string; key: string }
  | { op: 'opening'; lotId: string; key: string; opening: Opening }
  | { op: 'floor'; lotId: string; level: number; mat: FloorMat; x0: number; z0: number; x1: number; z1: number }
  | { op: 'removeFloor'; lotId: string; level: number; x0: number; z0: number; x1: number; z1: number }
  | { op: 'object'; lotId: string; obj: PlacedObject }
  | { op: 'removeObject'; lotId: string; id: string }
  | { op: 'roof'; lotId: string; roof: Roof }
  | { op: 'removeRoof'; lotId: string; id: string };

// ---------------------------------------------------------------- keys

export const wallKey = (level: number, dir: WallDir, gx: number, gz: number) => `${level}|${dir}|${gx}|${gz}`;
export const floorKey = (level: number, gx: number, gz: number) => `${level}|${gx}|${gz}`;
export const levelBase = (level: number) => FOUNDATION_H + level * LEVEL_HEIGHT;

export function emptyBuild(): LotBuild {
  return { walls: {}, floors: {}, objects: {}, roofs: {} };
}

export function makeWorld(lots: LotDef[]): WorldState {
  const w: WorldState = { lots: {}, builds: {}, version: 0 };
  for (const l of lots) {
    w.lots[l.id] = { ...l, owner: null, ownerName: null };
    w.builds[l.id] = emptyBuild();
  }
  return w;
}

// ---------------------------------------------------------------- geometry helpers

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
/** Own-property lookup: user-supplied keys like "__proto__" never reach the prototype. */
export const own = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const ID_RE = /^[A-Za-z0-9]{4,40}$/;
const cellIn = (l: LotDef, gx: number, gz: number) => gx >= l.x && gx < l.x + l.w && gz >= l.z && gz < l.z + l.d;
const vertexIn = (l: LotDef, gx: number, gz: number) => gx >= l.x && gx <= l.x + l.w && gz >= l.z && gz <= l.z + l.d;

/** Two cells on either side of a wall edge: [sideA (negative), sideB (positive)]. */
export function wallSides(w: { gx: number; gz: number; dir: WallDir }): [[number, number], [number, number]] {
  return w.dir === 'x'
    ? [[w.gx, w.gz - 1], [w.gx, w.gz]]
    : [[w.gx - 1, w.gz], [w.gx, w.gz]];
}

export function lotAt(world: WorldState, x: number, z: number): LotState | null {
  for (const id in world.lots) {
    const l = world.lots[id];
    if (x >= l.x && x < l.x + l.w && z >= l.z && z < l.z + l.d) return l;
  }
  return null;
}

/** Cells covered by an object, plus internal edges that walls must not cross. */
export function objectCells(o: PlacedObject): { cells: [number, number][]; innerEdges: { gx: number; gz: number; dir: WallDir }[] } {
  const item = CATALOG[o.catalogId];
  const { w, d } = footprint(item, o.rot);
  const cells: [number, number][] = [];
  const innerEdges: { gx: number; gz: number; dir: WallDir }[] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
    cells.push([o.gx + i, o.gz + j]);
    if (i > 0) innerEdges.push({ gx: o.gx + i, gz: o.gz + j, dir: 'z' });
    if (j > 0) innerEdges.push({ gx: o.gx + i, gz: o.gz + j, dir: 'x' });
  }
  return { cells, innerEdges };
}

function occupiedCells(b: LotBuild, level: number, ignoreId?: string): Set<string> {
  const s = new Set<string>();
  for (const id in b.objects) {
    const o = b.objects[id];
    if (o.level !== level || id === ignoreId) continue;
    for (const [x, z] of objectCells(o).cells) s.add(`${x}|${z}`);
  }
  return s;
}

const VALID_STYLES: WallStyle[] = ['siding_white', 'siding_sage', 'brick_red', 'stucco_sand', 'stone'];
const VALID_FLOORS: FloorMat[] = ['oak', 'walnut', 'tile', 'carpet', 'slate', 'concrete'];
const VALID_OPENINGS: Opening[] = ['none', 'door', 'window', 'picture'];
const VALID_ROOFS: RoofStyle[] = ['gable_x', 'gable_z', 'flat'];

// ---------------------------------------------------------------- validation

/**
 * Returns null if `actor` may perform `op`, otherwise a human-readable reason.
 * Ownership is the first gate on every op except buying an unowned lot, which
 * is what makes other players' houses indestructible.
 */
export function validateOp(world: WorldState, op: BuildOp, actor: string): string | null {
  if (!op || typeof op !== 'object') return 'Invalid request';
  const lotId = (op as { lotId: unknown }).lotId;
  if (!own(world.lots, lotId) || !own(world.builds, lotId)) return 'Unknown lot';
  const lot = world.lots[lotId as string];
  const b = world.builds[lot.id];

  if (op.op === 'buyLot') {
    if (lot.owner) return lot.owner === actor ? 'You already own this lot' : 'Lot is owned by another player';
    for (const id in world.lots) if (world.lots[id].owner === actor) return 'You can only own one lot';
    return null;
  }

  if (lot.owner !== actor) return lot.owner ? `This is ${lot.ownerName ?? 'another player'}'s property` : 'Buy this lot before building';

  switch (op.op) {
    case 'walls': {
      if (!isInt(op.level) || op.level < 0 || op.level > MAX_LEVEL) return 'Invalid level';
      if (!VALID_STYLES.includes(op.style)) return 'Invalid wall style';
      if (!Array.isArray(op.segs) || op.segs.length === 0 || op.segs.length > MAX_SEGMENTS_PER_OP) return 'Invalid wall run';
      for (const s of op.segs) {
        if (!s || typeof s !== 'object' || !isInt(s.gx) || !isInt(s.gz) || (s.dir !== 'x' && s.dir !== 'z')) return 'Invalid segment';
        const ex = s.dir === 'x' ? s.gx + 1 : s.gx, ez = s.dir === 'z' ? s.gz + 1 : s.gz;
        if (!vertexIn(lot, s.gx, s.gz) || !vertexIn(lot, ex, ez)) return 'Wall leaves your lot';
        if (b.walls[wallKey(op.level, s.dir, s.gx, s.gz)]) return 'Wall already exists there';
        for (const id in b.objects) {
          const o = b.objects[id];
          if (o.level === op.level && objectCells(o).innerEdges.some(e => e.gx === s.gx && e.gz === s.gz && e.dir === s.dir)) return 'Wall would cut through furniture';
        }
        if (op.level > 0) {
          const below = b.walls[wallKey(op.level - 1, s.dir, s.gx, s.gz)];
          const [a, c] = wallSides(s);
          const floored = b.floors[floorKey(op.level, a[0], a[1])] || b.floors[floorKey(op.level, c[0], c[1])];
          if (!below && !floored) return 'Upper walls need a wall below or a floor beside them';
        }
      }
      return null;
    }
    case 'removeWall':
      return own(b.walls, op.key) ? null : 'No wall there';
    case 'opening': {
      if (!own(b.walls, op.key)) return 'Place a wall first';
      const w = b.walls[op.key];
      if (!VALID_OPENINGS.includes(op.opening)) return 'Invalid opening';
      if (w.opening === op.opening) return 'Already has that opening';
      return null;
    }
    case 'floor':
    case 'removeFloor': {
      if (!isInt(op.level) || op.level < 0 || op.level > MAX_LEVEL) return 'Invalid level';
      if (![op.x0, op.z0, op.x1, op.z1].every(isInt)) return 'Invalid area';
      if (op.op === 'floor' && !VALID_FLOORS.includes(op.mat)) return 'Invalid floor';
      const x0 = Math.min(op.x0, op.x1), x1 = Math.max(op.x0, op.x1);
      const z0 = Math.min(op.z0, op.z1), z1 = Math.max(op.z0, op.z1);
      if (!cellIn(lot, x0, z0) || !cellIn(lot, x1, z1)) return 'Area leaves your lot';
      if (op.op === 'removeFloor') {
        const occ = occupiedCells(b, op.level);
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (occ.has(`${x}|${z}`)) return 'Remove furniture first';
      }
      return null;
    }
    case 'object': {
      const o = op.obj;
      if (!o || typeof o !== 'object' || !own(CATALOG, o.catalogId)) return 'Unknown item';
      const item = CATALOG[o.catalogId];
      if (typeof o.id !== 'string' || !ID_RE.test(o.id)) return 'Invalid id';
      if (own(b.objects, o.id)) return 'Duplicate id';
      if (!isInt(o.gx) || !isInt(o.gz) || !isInt(o.rot) || o.rot < 0 || o.rot > 3) return 'Invalid placement';
      if (!isInt(o.level) || o.level < 0 || o.level > MAX_LEVEL) return 'Invalid level';
      const { cells, innerEdges } = objectCells(o);
      const occ = occupiedCells(b, o.level);
      for (const [x, z] of cells) {
        if (!cellIn(lot, x, z)) return 'Item leaves your lot';
        if (occ.has(`${x}|${z}`)) return 'Space is occupied';
        const hasFloor = !!b.floors[floorKey(o.level, x, z)];
        if ((item.indoor || o.level > 0) && !hasFloor) return 'Needs a floor underneath';
      }
      for (const e of innerEdges) if (b.walls[wallKey(o.level, e.dir, e.gx, e.gz)]) return 'A wall is in the way';
      return null;
    }
    case 'removeObject':
      return own(b.objects, op.id) ? null : 'No such item';
    case 'roof': {
      const r = op.roof;
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !ID_RE.test(r.id)) return 'Invalid id';
      if (own(b.roofs, r.id)) return 'Duplicate id';
      if (!VALID_ROOFS.includes(r.style)) return 'Invalid roof style';
      if (![r.x0, r.z0, r.x1, r.z1].every(isInt) || r.x1 <= r.x0 || r.z1 <= r.z0) return 'Invalid roof area';
      if (!vertexIn(lot, r.x0, r.z0) || !vertexIn(lot, r.x1, r.z1)) return 'Roof leaves your lot';
      if (!isInt(r.level) || r.level < 0 || r.level > MAX_LEVEL) return 'Invalid level';
      if (typeof r.pitchDeg !== 'number' || r.pitchDeg < 0 || r.pitchDeg > 55) return 'Invalid pitch';
      return null;
    }
    case 'removeRoof':
      return own(b.roofs, op.id) ? null : 'No such roof';
  }
  return 'Unknown op';
}

// ---------------------------------------------------------------- cost

/** Positive = charge, negative = refund. */
export function opCost(world: WorldState, op: BuildOp): number {
  const b = world.builds[(op as { lotId: string }).lotId];
  const openingCost = (o: Opening) => (o === 'door' ? COST.door : o === 'window' ? COST.window : o === 'picture' ? COST.picture : 0);
  switch (op.op) {
    case 'buyLot': return LOT_PRICE;
    case 'walls': return op.segs.length * COST.wall;
    case 'removeWall': { const w = b.walls[op.key]; return w ? -Math.round((COST.wall + openingCost(w.opening)) * COST.refundRate) : 0; }
    case 'opening': { const w = b.walls[op.key]; return openingCost(op.opening) - (w ? Math.round(openingCost(w.opening) * COST.refundRate) : 0); }
    case 'floor': {
      let n = 0;
      for (let x = Math.min(op.x0, op.x1); x <= Math.max(op.x0, op.x1); x++)
        for (let z = Math.min(op.z0, op.z1); z <= Math.max(op.z0, op.z1); z++)
          if (b.floors[floorKey(op.level, x, z)]?.mat !== op.mat) n++;
      return n * COST.floorPerCell;
    }
    case 'removeFloor': {
      let n = 0;
      for (let x = Math.min(op.x0, op.x1); x <= Math.max(op.x0, op.x1); x++)
        for (let z = Math.min(op.z0, op.z1); z <= Math.max(op.z0, op.z1); z++)
          if (b.floors[floorKey(op.level, x, z)]) n++;
      return -Math.round(n * COST.floorPerCell * COST.refundRate);
    }
    case 'object': return CATALOG[op.obj.catalogId].price;
    case 'removeObject': { const o = b.objects[op.id]; return o ? -Math.round(CATALOG[o.catalogId].price * COST.refundRate) : 0; }
    case 'roof': return Math.round((op.roof.x1 - op.roof.x0) * (op.roof.z1 - op.roof.z0) * COST.roofPerM2);
    case 'removeRoof': { const r = b.roofs[op.id]; return r ? -Math.round((r.x1 - r.x0) * (r.z1 - r.z0) * COST.roofPerM2 * COST.refundRate) : 0; }
  }
}

// ---------------------------------------------------------------- apply

/** Mutates `world`. Call only after validateOp() returned null. */
export function applyOp(world: WorldState, op: BuildOp, actor: string, actorName: string): void {
  const lot = world.lots[(op as { lotId: string }).lotId];
  const b = world.builds[lot.id];
  world.version++;
  switch (op.op) {
    case 'buyLot': lot.owner = actor; lot.ownerName = actorName; break;
    case 'walls':
      for (const s of op.segs) b.walls[wallKey(op.level, s.dir, s.gx, s.gz)] = { gx: s.gx, gz: s.gz, dir: s.dir, level: op.level, style: op.style, opening: 'none' };
      break;
    case 'removeWall': delete b.walls[op.key]; break;
    case 'opening': b.walls[op.key].opening = op.opening; break;
    case 'floor':
    case 'removeFloor':
      for (let x = Math.min(op.x0, op.x1); x <= Math.max(op.x0, op.x1); x++)
        for (let z = Math.min(op.z0, op.z1); z <= Math.max(op.z0, op.z1); z++) {
          const k = floorKey(op.level, x, z);
          if (op.op === 'floor') b.floors[k] = { gx: x, gz: z, level: op.level, mat: op.mat };
          else delete b.floors[k];
        }
      break;
    case 'object': b.objects[op.obj.id] = { ...op.obj }; break;
    case 'removeObject': delete b.objects[op.id]; break;
    case 'roof': b.roofs[op.roof.id] = { ...op.roof }; break;
    case 'removeRoof': delete b.roofs[op.id]; break;
  }
}
