/**
 * Fox Lake houses are built with The Hood's home builder (`modules-src/hood/shared`): walls, doors and windows on a
 * 1 m tile grid, floors, an exterior style (cladding, wainscot, trim, shutters, doors, roof) and features (canopies,
 * porches, pergolas, fences, chimneys), plus The Hood's buy catalog. A home is The Hood's lot layout without the
 * household; it rides on the lot's build record (`LotBuild.hood`) so it saves and syncs with the lot.
 *
 * The Hood's 20 × 24 m grid sits on the Fox Lake lot beside the driveway with its front (grid z = 0) toward the
 * street: `-z` lots keep the grid's axes, `+z` lots turn it half a turn (so it is never mirrored). Pure data and pure
 * functions: the authority validates and applies every step with The Hood's own `applyBuild`.
 */
import { applyBuild, type BuildOp as HoodBuildOp, type BuildResult } from '../../hood/shared/Build';
import { objectDef } from '../../hood/shared/Catalog';
import { D, LotGrid, W, sanitizeFeatures, sanitizeShell, starterLayout, type LotState as HoodLot } from '../../hood/shared/Lot';
import { FEATURE_KINDS } from '../../hood/shared/Style';

export const HOME_W = W;
export const HOME_D = D;
const MAX_OBJECTS = 400;
const MAX_FEATURES = 120;

/** A Fox Lake home: The Hood's lot layout (walls, openings, floors, style, objects, features). */
export type FoxHome = Pick<HoodLot, 'walls' | 'doors' | 'windows' | 'floors' | 'style' | 'objects' | 'nextObjectId' | 'features' | 'nextFeatureId'>;
export type HomeOp = HoodBuildOp | { op: 'start' };
export type { HoodBuildOp };

/** Where the grid lies on a lot: grid (gx, gz) is town (ox + sx·gx, oz + sz·gz). */
export interface HomeFrame { ox: number; oz: number; sx: 1 | -1; sz: 1 | -1 }

interface LotRect { x: number; z: number; w: number; d: number; front: '+z' | '-z' }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function homeFrame(lot: LotRect): HomeFrame {
  const x0 = lot.x + clamp(Math.round((lot.w + 6 - HOME_W) / 2), 6, lot.w - HOME_W);
  const back = clamp(Math.round((lot.d - HOME_D) / 3), 3, lot.d - HOME_D);
  return lot.front === '-z' ? { ox: x0, oz: lot.z + back, sx: 1, sz: 1 } : { ox: x0 + HOME_W, oz: lot.z + lot.d - back, sx: -1, sz: -1 };
}

export function gridToTown(f: HomeFrame, gx: number, gz: number): { x: number; z: number } {
  return { x: f.ox + f.sx * gx, z: f.oz + f.sz * gz };
}

export function townToGrid(f: HomeFrame, x: number, z: number): { gx: number; gz: number } {
  return { gx: (x - f.ox) * f.sx, gz: (z - f.oz) * f.sz };
}

/** Yaw (about +y, radians) that turns grid directions into town directions. */
export function frameYaw(f: HomeFrame): number {
  return f.sx > 0 ? 0 : Math.PI;
}

/** The house a new owner moves into: The Hood's starter home (living room and kitchen, bedroom, bath, a yard). */
export function starterHome(): FoxHome {
  const s = starterLayout();
  return { walls: s.walls, doors: s.doors, windows: s.windows, floors: s.floors, style: s.style, objects: s.objects, nextObjectId: s.nextObjectId, features: s.features, nextFeatureId: s.nextFeatureId };
}

/** A stored or received home, cleaned to valid edges, tiles, catalog items and features (null if it isn't one). */
export function sanitizeHome(input: unknown): FoxHome | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const shell = sanitizeShell(raw);
  const objects = shell.objects
    .filter((o) => o.x >= 0 && o.z >= 0 && o.x < W && o.z < D)
    .map((o) => ({ id: o.id, def: o.def, x: o.x, z: o.z, r: Number.isInteger(o.r) ? ((o.r % 4) + 4) % 4 : 0 }))
    .slice(0, MAX_OBJECTS);
  const features = sanitizeFeatures(raw.features).slice(0, MAX_FEATURES);
  const nextObject = Math.max(Number.isInteger(raw.nextObjectId) ? Number(raw.nextObjectId) : 1, ...objects.map((o) => o.id + 1));
  const nextFeature = Math.max(Number.isInteger(raw.nextFeatureId) ? Number(raw.nextFeatureId) : 1, ...features.map((f) => f.id + 1));
  return { walls: shell.walls, doors: shell.doors, windows: shell.windows, floors: shell.floors, style: shell.style, objects, nextObjectId: nextObject, features, nextFeatureId: nextFeature };
}

const OPS = new Set(['wall', 'room', 'unwall', 'door', 'window', 'unopen', 'floor', 'buy', 'move', 'sell', 'style', 'feature', 'unfeature']);

/**
 * Checks and applies one Hood build step to `home` (mutated on success) with `funds` to spend. The cost is negative
 * for a refund (selling, taking down); the caller moves the money.
 */
export function applyHomeOp(home: FoxHome, op: HoodBuildOp, funds: number): BuildResult {
  if (!op || typeof op !== 'object' || !OPS.has((op as { op: unknown }).op as string)) return { ok: false, error: 'Unknown build step.', cost: 0, tiles: [] };
  if (op.op === 'feature' && !(FEATURE_KINDS as readonly string[]).includes(op.kind)) return { ok: false, error: 'Pick a feature.', cost: 0, tiles: [] };
  if (op.op === 'feature' && home.features.length >= MAX_FEATURES) return { ok: false, error: 'That is plenty of features for one lot.', cost: 0, tiles: [] };
  if (op.op === 'buy' && home.objects.length >= MAX_OBJECTS) return { ok: false, error: 'The lot is full. Sell something first.', cost: 0, tiles: [] };
  if (op.op === 'style' && (!op.patch || typeof op.patch !== 'object')) return { ok: false, error: 'Pick a look.', cost: 0, tiles: [] };
  const grid = new LotGrid(home);
  return applyBuild(home as unknown as HoodLot, grid, op, funds);
}

/** Every catalog item on the home resolves (older saves can name items the catalog no longer has). */
export function homeObjects(home: FoxHome) {
  return home.objects.filter((o) => !!objectDef(o.def));
}
