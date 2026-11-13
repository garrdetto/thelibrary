/**
 * Authoritative house-building model (Sims-style build/buy mode).
 *
 * Everything here is pure data + pure functions with no rendering or network
 * dependencies, so the exact same rules run in the client (ghost previews),
 * the in-page hosts and the persistent world server. The server is the one
 * that matters: a client that skips validation still cannot touch a lot it
 * does not own, because every op is re-validated there.
 *
 * Grid: 1 cell = 1 m. Walls, half walls and fences live on grid EDGES; floors,
 * pools and objects live on CELLS; roofs and pools are vertex rectangles.
 */
import { CATALOG, CatalogItem, footprint, SWATCHES } from './Catalog';
import { COST } from './Economy';
import { LotDef, lotPrice } from './WorldLayout';
import { sanitizeHome, type FoxHome } from './HoodHomes';

export const LEVEL_HEIGHT = 3.0;
export const FOUNDATION_H = 0.25;
export const MAX_LEVEL = 2;           // levels 0..2 (three storeys)
export const MAX_SEGMENTS_PER_OP = 240;

export type WallDir = 'x' | 'z';
export type Opening = 'none' | 'door' | 'window' | 'picture' | 'slider' | 'french' | 'glassdoor' | 'tall' | 'clerestory' | 'frosted' | 'garage';
export type WallKind = 'full' | 'half' | 'railing' | 'picket' | 'privacy';
export type WallStyle = 'siding_white' | 'siding_sage' | 'siding_navy' | 'brick_red' | 'brick_white' | 'stucco_sand' | 'stone' | 'board_batten';
export type InteriorFinish = 'paint_white' | 'paint_greige' | 'paint_sage' | 'paint_navy' | 'paint_blush' | 'paint_charcoal' | 'wallpaper_stripe' | 'wallpaper_damask' | 'tile_subway' | 'panel_wood';
export type WallFinish = WallStyle | InteriorFinish;
export type FloorMat = 'oak' | 'walnut' | 'herringbone' | 'tile' | 'marble' | 'carpet' | 'slate' | 'concrete' | 'deck' | 'patio';
export type RoofStyle = 'gable_x' | 'gable_z' | 'hip' | 'flat';

export const WALL_STYLES: WallStyle[] = ['siding_white', 'siding_sage', 'siding_navy', 'brick_red', 'brick_white', 'stucco_sand', 'stone', 'board_batten'];
export const INTERIOR_FINISHES: InteriorFinish[] = ['paint_white', 'paint_greige', 'paint_sage', 'paint_navy', 'paint_blush', 'paint_charcoal', 'wallpaper_stripe', 'wallpaper_damask', 'tile_subway', 'panel_wood'];
export const FLOOR_MATS: FloorMat[] = ['oak', 'walnut', 'herringbone', 'tile', 'marble', 'carpet', 'slate', 'concrete', 'deck', 'patio'];
export const WALL_KINDS: WallKind[] = ['full', 'half', 'railing', 'picket', 'privacy'];
const ROOF_STYLES: RoofStyle[] = ['gable_x', 'gable_z', 'hip', 'flat'];
export const OPENINGS: Opening[] = ['none', 'door', 'window', 'picture', 'slider', 'french', 'glassdoor', 'tall', 'clerestory', 'frosted', 'garage'];

/** Height of each wall kind; only full walls take doors, windows and wall décor. */
export const WALL_HEIGHT: Record<WallKind, number> = { full: LEVEL_HEIGHT, half: 1.05, railing: 1.0, picket: 1.1, privacy: 1.9 };

export interface Wall { gx: number; gz: number; dir: WallDir; level: number; style: WallStyle; opening: Opening; kind?: WallKind; paintA?: WallFinish; paintB?: WallFinish }
export interface Floor { gx: number; gz: number; level: number; mat: FloorMat }
export interface PlacedObject { id: string; catalogId: string; gx: number; gz: number; rot: number; level: number; tint?: number }
export interface Roof { id: string; x0: number; z0: number; x1: number; z1: number; level: number; style: RoofStyle; pitchDeg: number }
export interface Pool { id: string; x0: number; z0: number; x1: number; z1: number }

export interface LotBuild {
  walls: Record<string, Wall>;
  floors: Record<string, Floor>;
  objects: Record<string, PlacedObject>;
  roofs: Record<string, Roof>;
  pools: Record<string, Pool>;
  /** A Fox Lake home built with The Hood's builder (shared/HoodHomes.ts); when set it replaces the walls, floors, objects, roofs and pools above. */
  hood?: FoxHome;
}

export interface LotState extends LotDef { owner: string | null; ownerName: string | null }

export interface WorldState {
  lots: Record<string, LotState>;
  builds: Record<string, LotBuild>;
  version: number;
  /** Which starter-house roster this world was seeded with (shared/Seed.ts); missing means the first. */
  seedVersion?: number;
}

type Seg = { gx: number; gz: number; dir: WallDir };

export type BuildOp =
  | { op: 'buyLot'; lotId: string }
  | { op: 'walls'; lotId: string; level: number; style: WallStyle; kind?: WallKind; segs: Seg[] }
  | { op: 'removeWall'; lotId: string; key: string }
  | { op: 'opening'; lotId: string; key: string; opening: Opening }
  | { op: 'paint'; lotId: string; key: string; side: 'A' | 'B'; finish: WallFinish | 'auto' }
  | { op: 'floor'; lotId: string; level: number; mat: FloorMat; x0: number; z0: number; x1: number; z1: number }
  | { op: 'removeFloor'; lotId: string; level: number; x0: number; z0: number; x1: number; z1: number }
  | { op: 'object'; lotId: string; obj: PlacedObject }
  | { op: 'moveObject'; lotId: string; id: string; gx: number; gz: number; rot: number; level: number }
  | { op: 'tint'; lotId: string; id: string; tint: number }
  | { op: 'removeObject'; lotId: string; id: string }
  | { op: 'roof'; lotId: string; roof: Roof }
  | { op: 'removeRoof'; lotId: string; id: string }
  | { op: 'pool'; lotId: string; pool: Pool }
  | { op: 'removePool'; lotId: string; id: string };

// ---------------------------------------------------------------- keys & helpers

export const wallKey = (level: number, dir: WallDir, gx: number, gz: number) => `${level}|${dir}|${gx}|${gz}`;
export const floorKey = (level: number, gx: number, gz: number) => `${level}|${gx}|${gz}`;
export const levelBase = (level: number) => FOUNDATION_H + level * LEVEL_HEIGHT;
export const wallKindOf = (w: Wall): WallKind => w.kind ?? 'full';

export function emptyBuild(): LotBuild {
  return { walls: {}, floors: {}, objects: {}, roofs: {}, pools: {} };
}

/** Upgrades builds saved before newer fields existed. */
export function normalizeBuild(b: LotBuild): LotBuild {
  b.walls ??= {}; b.floors ??= {}; b.objects ??= {}; b.roofs ??= {}; b.pools ??= {};
  for (const id in b.objects) if (!own(CATALOG, b.objects[id].catalogId)) delete b.objects[id];
  if (b.hood !== undefined) {
    const home = sanitizeHome(b.hood);
    if (home) b.hood = home;
    else delete b.hood;
  }
  return b;
}

export function makeWorld(lots: LotDef[]): WorldState {
  const w: WorldState = { lots: {}, builds: {}, version: 0 };
  for (const l of lots) {
    w.lots[l.id] = { ...l, owner: null, ownerName: null };
    w.builds[l.id] = emptyBuild();
  }
  return w;
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
/** Own-property lookup: user-supplied keys like "__proto__" never reach the prototype. */
export const own = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const ID_RE = /^[A-Za-z0-9]{4,40}$/;
const cellIn = (l: LotDef, gx: number, gz: number) => gx >= l.x && gx < l.x + l.w && gz >= l.z && gz < l.z + l.d;
const vertexIn = (l: LotDef, gx: number, gz: number) => gx >= l.x && gx <= l.x + l.w && gz >= l.z && gz <= l.z + l.d;

/** Two cells on either side of a wall edge: [sideA (negative), sideB (positive)]. */
export function wallSides(w: { gx: number; gz: number; dir: WallDir }): [[number, number], [number, number]] {
  return w.dir === 'x' ? [[w.gx, w.gz - 1], [w.gx, w.gz]] : [[w.gx - 1, w.gz], [w.gx, w.gz]];
}

export function lotAt(world: WorldState, x: number, z: number): LotState | null {
  for (const id in world.lots) {
    const l = world.lots[id];
    if (x >= l.x && x < l.x + l.w && z >= l.z && z < l.z + l.d) return l;
  }
  return null;
}

/** Cells covered by an object, plus internal edges that walls must not cross. */
export function objectCells(o: PlacedObject): { cells: [number, number][]; innerEdges: Seg[] } {
  const item = CATALOG[o.catalogId];
  if (!item) return { cells: [], innerEdges: [] };
  const { w, d } = footprint(item, o.rot);
  const cells: [number, number][] = [];
  const innerEdges: Seg[] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
    cells.push([o.gx + i, o.gz + j]);
    if (i > 0) innerEdges.push({ gx: o.gx + i, gz: o.gz + j, dir: 'z' });
    if (j > 0) innerEdges.push({ gx: o.gx + i, gz: o.gz + j, dir: 'x' });
  }
  return { cells, innerEdges };
}

/** The wall edge behind a wall-mounted object's cell (objects face +Z at rot 0). */
export function backEdge(cx: number, cz: number, rot: number): Seg {
  switch (((rot % 4) + 4) % 4) {
    case 0: return { gx: cx, gz: cz, dir: 'x' };
    case 1: return { gx: cx + 1, gz: cz, dir: 'z' };
    case 2: return { gx: cx, gz: cz + 1, dir: 'x' };
    default: return { gx: cx, gz: cz, dir: 'z' };
  }
}

function occupied(b: LotBuild, level: number, layer: CatalogItem['layer'], ignoreId?: string): Set<string> {
  const s = new Set<string>();
  for (const id in b.objects) {
    const o = b.objects[id];
    const item = CATALOG[o.catalogId];
    if (!item || o.level !== level || id === ignoreId || item.layer !== layer) continue;
    for (const [x, z] of objectCells(o).cells) s.add(layer === 'wall' ? `${x}|${z}|${o.rot}` : `${x}|${z}`);
  }
  return s;
}

function poolCells(b: LotBuild, ignoreId?: string): Set<string> {
  const s = new Set<string>();
  for (const id in b.pools) {
    if (id === ignoreId) continue;
    const p = b.pools[id];
    for (let x = p.x0; x < p.x1; x++) for (let z = p.z0; z < p.z1; z++) s.add(`${x}|${z}`);
  }
  return s;
}

/** Stair footprints carve a stairwell out of the floor above them. */
export function stairwellCells(b: LotBuild, level: number): Set<string> {
  const s = new Set<string>();
  for (const id in b.objects) {
    const o = b.objects[id];
    if (o.catalogId !== 'stairs' || o.level !== level - 1) continue;
    for (const [x, z] of objectCells(o).cells) s.add(`${x}|${z}`);
  }
  return s;
}

function validatePlacement(lot: LotDef, b: LotBuild, o: PlacedObject, ignoreId?: string): string | null {
  const item = CATALOG[o.catalogId];
  if (!isInt(o.gx) || !isInt(o.gz) || !isInt(o.rot) || o.rot < 0 || o.rot > 3) return 'Invalid placement';
  if (!isInt(o.level) || o.level < 0 || o.level > MAX_LEVEL) return 'Invalid level';
  if (o.tint !== undefined && (!isInt(o.tint) || o.tint < 0 || o.tint >= SWATCHES.length)) return 'Invalid color';
  const { cells, innerEdges } = objectCells(o);
  const occ = occupied(b, o.level, item.layer, ignoreId);
  const pools = o.level === 0 ? poolCells(b) : new Set<string>();
  for (const [x, z] of cells) {
    if (!cellIn(lot, x, z)) return 'Item leaves your lot';
    if (occ.has(item.layer === 'wall' ? `${x}|${z}|${o.rot}` : `${x}|${z}`)) return 'Space is occupied';
    if (pools.has(`${x}|${z}`)) return 'That spot is in the pool';
    const hasFloor = !!b.floors[floorKey(o.level, x, z)];
    if ((item.indoor || o.level > 0 || item.layer === 'ceiling') && !hasFloor) return 'Needs a floor underneath';
    if (item.layer === 'wall') {
      const e = backEdge(x, z, o.rot);
      const w = b.walls[wallKey(o.level, e.dir, e.gx, e.gz)];
      if (!w || wallKindOf(w) !== 'full') return 'Hang it on a full-height wall';
      if (w.opening !== 'none') return 'That wall section has a door or window';
    }
  }
  if (item.layer === 'floor') for (const e of innerEdges) if (b.walls[wallKey(o.level, e.dir, e.gx, e.gz)]) return 'A wall is in the way';
  return null;
}

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
      if (!WALL_STYLES.includes(op.style)) return 'Invalid wall style';
      const kind = op.kind ?? 'full';
      if (!WALL_KINDS.includes(kind)) return 'Invalid wall type';
      if (!Array.isArray(op.segs) || op.segs.length === 0 || op.segs.length > MAX_SEGMENTS_PER_OP) return 'Invalid wall run';
      for (const s of op.segs) {
        if (!s || typeof s !== 'object' || !isInt(s.gx) || !isInt(s.gz) || (s.dir !== 'x' && s.dir !== 'z')) return 'Invalid segment';
        const ex = s.dir === 'x' ? s.gx + 1 : s.gx, ez = s.dir === 'z' ? s.gz + 1 : s.gz;
        if (!vertexIn(lot, s.gx, s.gz) || !vertexIn(lot, ex, ez)) return 'Wall leaves your lot';
        if (b.walls[wallKey(op.level, s.dir, s.gx, s.gz)]) return 'Wall already exists there';
        for (const id in b.objects) {
          const o = b.objects[id];
          if (o.level === op.level && CATALOG[o.catalogId]?.layer === 'floor' && objectCells(o).innerEdges.some(e => e.gx === s.gx && e.gz === s.gz && e.dir === s.dir)) return 'Wall would cut through furniture';
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
    case 'removeWall': {
      if (!own(b.walls, op.key)) return 'No wall there';
      const w = b.walls[op.key];
      for (const id in b.objects) {
        const o = b.objects[id];
        if (o.level !== w.level || CATALOG[o.catalogId]?.layer !== 'wall') continue;
        if (objectCells(o).cells.some(([x, z]) => { const e = backEdge(x, z, o.rot); return e.dir === w.dir && e.gx === w.gx && e.gz === w.gz; })) return 'Remove the décor hanging on this wall first';
      }
      return null;
    }
    case 'opening': {
      if (!own(b.walls, op.key)) return 'Place a wall first';
      const w = b.walls[op.key];
      if (!OPENINGS.includes(op.opening)) return 'Invalid opening';
      if (op.opening !== 'none' && wallKindOf(w) !== 'full') return 'Doors and windows need a full-height wall';
      if (w.opening === op.opening) return 'Already has that opening';
      return null;
    }
    case 'paint': {
      if (!own(b.walls, op.key)) return 'No wall there';
      if (op.side !== 'A' && op.side !== 'B') return 'Invalid side';
      if (op.finish !== 'auto' && !WALL_STYLES.includes(op.finish as WallStyle) && !INTERIOR_FINISHES.includes(op.finish as InteriorFinish)) return 'Invalid finish';
      return null;
    }
    case 'floor':
    case 'removeFloor': {
      if (!isInt(op.level) || op.level < 0 || op.level > MAX_LEVEL) return 'Invalid level';
      if (![op.x0, op.z0, op.x1, op.z1].every(isInt)) return 'Invalid area';
      if (op.op === 'floor' && !FLOOR_MATS.includes(op.mat)) return 'Invalid floor';
      const x0 = Math.min(op.x0, op.x1), x1 = Math.max(op.x0, op.x1);
      const z0 = Math.min(op.z0, op.z1), z1 = Math.max(op.z0, op.z1);
      if (!cellIn(lot, x0, z0) || !cellIn(lot, x1, z1)) return 'Area leaves your lot';
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 600) return 'Paint smaller areas at a time';
      if (op.op === 'floor' && op.level === 0) {
        const pools = poolCells(b);
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (pools.has(`${x}|${z}`)) return 'That area has a pool';
      }
      if (op.op === 'removeFloor') {
        for (const layer of ['floor', 'rug', 'ceiling'] as const) {
          const occ = occupied(b, op.level, layer);
          for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (occ.has(`${x}|${z}`)) return 'Remove furniture first';
        }
      }
      return null;
    }
    case 'object': {
      const o = op.obj;
      if (!o || typeof o !== 'object' || !own(CATALOG, o.catalogId)) return 'Unknown item';
      if (CATALOG[o.catalogId].hidden) return 'This item is no longer sold';
      if (typeof o.id !== 'string' || !ID_RE.test(o.id)) return 'Invalid id';
      if (own(b.objects, o.id)) return 'Duplicate id';
      return validatePlacement(lot, b, o);
    }
    case 'moveObject': {
      if (!own(b.objects, op.id)) return 'No such item';
      const o = { ...b.objects[op.id], gx: op.gx, gz: op.gz, rot: op.rot, level: op.level };
      return validatePlacement(lot, b, o, op.id);
    }
    case 'tint': {
      if (!own(b.objects, op.id)) return 'No such item';
      if (!isInt(op.tint) || op.tint < 0 || op.tint >= SWATCHES.length) return 'Invalid color';
      return CATALOG[b.objects[op.id].catalogId].tintable ? null : 'This item has one look';
    }
    case 'removeObject':
      return own(b.objects, op.id) ? null : 'No such item';
    case 'roof': {
      const r = op.roof;
      if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !ID_RE.test(r.id)) return 'Invalid id';
      if (own(b.roofs, r.id)) return 'Duplicate id';
      if (!ROOF_STYLES.includes(r.style)) return 'Invalid roof style';
      if (![r.x0, r.z0, r.x1, r.z1].every(isInt) || r.x1 <= r.x0 || r.z1 <= r.z0) return 'Invalid roof area';
      if (!vertexIn(lot, r.x0, r.z0) || !vertexIn(lot, r.x1, r.z1)) return 'Roof leaves your lot';
      if (!isInt(r.level) || r.level < 0 || r.level > MAX_LEVEL) return 'Invalid level';
      if (typeof r.pitchDeg !== 'number' || r.pitchDeg < 0 || r.pitchDeg > 55) return 'Invalid pitch';
      return null;
    }
    case 'removeRoof':
      return own(b.roofs, op.id) ? null : 'No such roof';
    case 'pool': {
      const p = op.pool;
      if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !ID_RE.test(p.id)) return 'Invalid id';
      if (own(b.pools, p.id)) return 'Duplicate id';
      if (![p.x0, p.z0, p.x1, p.z1].every(isInt) || p.x1 - p.x0 < 2 || p.z1 - p.z0 < 2) return 'Pools are at least 2×2 m';
      if (p.x1 - p.x0 > 14 || p.z1 - p.z0 > 14) return 'Pools can be up to 14×14 m';
      if (!vertexIn(lot, p.x0, p.z0) || !vertexIn(lot, p.x1, p.z1)) return 'Pool leaves your lot';
      const others = poolCells(b);
      const occ = occupied(b, 0, 'floor');
      for (let x = p.x0; x < p.x1; x++) for (let z = p.z0; z < p.z1; z++) {
        if (others.has(`${x}|${z}`)) return 'Overlaps another pool';
        if (b.floors[floorKey(0, x, z)]) return 'Pools go in the yard, not on floors';
        if (occ.has(`${x}|${z}`)) return 'Move the items out of the way first';
        if (x > p.x0 && b.walls[wallKey(0, 'z', x, z)]) return 'A wall crosses the pool';
        if (z > p.z0 && b.walls[wallKey(0, 'x', x, z)]) return 'A wall crosses the pool';
      }
      return null;
    }
    case 'removePool':
      return own(b.pools, op.id) ? null : 'No such pool';
  }
  return 'Unknown op';
}

// ---------------------------------------------------------------- cost

const WALL_COST: Record<WallKind, number> = { full: COST.wall, half: COST.halfWall, railing: COST.railing, picket: COST.fence, privacy: COST.privacyFence };
const openingCost = (o: Opening) => (o === 'none' ? 0 : COST[o]);

/** Positive = charge, negative = refund. */
export function opCost(world: WorldState, op: BuildOp): number {
  const b = world.builds[(op as { lotId: string }).lotId];
  const refund = (n: number) => -Math.round(n * COST.refundRate);
  switch (op.op) {
    case 'buyLot': return world.lots[op.lotId] ? lotPrice(world.lots[op.lotId]) : Infinity;
    case 'walls': return op.segs.length * WALL_COST[op.kind ?? 'full'];
    case 'removeWall': { const w = b.walls[op.key]; return w ? refund(WALL_COST[wallKindOf(w)] + openingCost(w.opening)) : 0; }
    case 'opening': { const w = b.walls[op.key]; return openingCost(op.opening) + (w ? refund(openingCost(w.opening)) : 0); }
    case 'paint': return COST.paint;
    case 'floor': {
      let n = 0;
      for (let x = Math.min(op.x0, op.x1); x <= Math.max(op.x0, op.x1); x++)
        for (let z = Math.min(op.z0, op.z1); z <= Math.max(op.z0, op.z1); z++) {
          const prev = b.floors[floorKey(op.level, x, z)];
          if (!prev) n++;                                        // re-flooring an existing tile is a free finish change
        }
      return n * COST.floorPerCell;
    }
    case 'removeFloor': {
      let n = 0;
      for (let x = Math.min(op.x0, op.x1); x <= Math.max(op.x0, op.x1); x++)
        for (let z = Math.min(op.z0, op.z1); z <= Math.max(op.z0, op.z1); z++)
          if (b.floors[floorKey(op.level, x, z)]) n++;
      return refund(n * COST.floorPerCell);
    }
    case 'object': return CATALOG[op.obj.catalogId].price;
    case 'moveObject': case 'tint': return 0;
    case 'removeObject': { const o = b.objects[op.id]; return o ? refund(CATALOG[o.catalogId].price) : 0; }
    case 'roof': return Math.round((op.roof.x1 - op.roof.x0) * (op.roof.z1 - op.roof.z0) * COST.roofPerM2);
    case 'removeRoof': { const r = b.roofs[op.id]; return r ? refund((r.x1 - r.x0) * (r.z1 - r.z0) * COST.roofPerM2) : 0; }
    case 'pool': return Math.round((op.pool.x1 - op.pool.x0) * (op.pool.z1 - op.pool.z0) * COST.poolPerM2);
    case 'removePool': { const p = b.pools[op.id]; return p ? refund((p.x1 - p.x0) * (p.z1 - p.z0) * COST.poolPerM2) : 0; }
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
      for (const s of op.segs) {
        const w: Wall = { gx: s.gx, gz: s.gz, dir: s.dir, level: op.level, style: op.style, opening: 'none' };
        if (op.kind && op.kind !== 'full') w.kind = op.kind;
        b.walls[wallKey(op.level, s.dir, s.gx, s.gz)] = w;
      }
      break;
    case 'removeWall': delete b.walls[op.key]; break;
    case 'opening': b.walls[op.key].opening = op.opening; break;
    case 'paint': {
      const side = op.side === 'A' ? 'paintA' : 'paintB';
      if (op.finish === 'auto') delete b.walls[op.key][side]; else b.walls[op.key][side] = op.finish;
      break;
    }
    case 'floor':
    case 'removeFloor':
      for (let x = Math.min(op.x0, op.x1); x <= Math.max(op.x0, op.x1); x++)
        for (let z = Math.min(op.z0, op.z1); z <= Math.max(op.z0, op.z1); z++) {
          const k = floorKey(op.level, x, z);
          if (op.op === 'floor') b.floors[k] = { gx: x, gz: z, level: op.level, mat: op.mat };
          else delete b.floors[k];
        }
      break;
    case 'object': {
      const o: PlacedObject = { id: op.obj.id, catalogId: op.obj.catalogId, gx: op.obj.gx, gz: op.obj.gz, rot: op.obj.rot, level: op.obj.level };
      if (op.obj.tint) o.tint = op.obj.tint;
      b.objects[o.id] = o;
      break;
    }
    case 'moveObject': Object.assign(b.objects[op.id], { gx: op.gx, gz: op.gz, rot: op.rot, level: op.level }); break;
    case 'tint': b.objects[op.id].tint = op.tint; break;
    case 'removeObject': delete b.objects[op.id]; break;
    case 'roof': { const r = op.roof; b.roofs[r.id] = { id: r.id, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, level: r.level, style: r.style, pitchDeg: r.pitchDeg }; break; }
    case 'removeRoof': delete b.roofs[op.id]; break;
    case 'pool': { const p = op.pool; b.pools[p.id] = { id: p.id, x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1 }; break; }
    case 'removePool': delete b.pools[op.id]; break;
  }
}

/** Default finish of a wall side: interior paint where that side has a floor, else the exterior style. */
export function sideFinish(b: LotBuild, w: Wall, side: 'A' | 'B'): WallFinish {
  const painted = side === 'A' ? w.paintA : w.paintB;
  if (painted) return painted;
  const [a, c] = wallSides(w);
  const cell = side === 'A' ? a : c;
  return b.floors[floorKey(w.level, cell[0], cell[1])] ? 'paint_white' : w.style;
}
