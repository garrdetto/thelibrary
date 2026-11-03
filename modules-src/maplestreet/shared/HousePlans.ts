/**
 * Floor plans for the simulated neighbors' houses. Each plan is written in
 * lot-local coordinates and turned into ordinary BuildOps, which the seeder
 * runs through validateOp exactly like a player's build.
 *
 * Local frame: `u` runs along the street (0..lot.w, same direction as world
 * X), `v` runs from the front edge of the lot back (0..lot.d). Rotation 0
 * faces the street. The driveway (drivewayRect) covers u 2..6, v 0..12, and
 * the mailbox, sign, lamp and corner tree stand in the first 2 m, so plans
 * keep their footprints clear of those.
 */
import { BuildOp, FloorMat, Opening, RoofStyle, WallKind, wallKey, WallStyle } from './BuildRules';
import { CATALOG, footprint } from './Catalog';
import type { LotDef } from './WorldLayout';

export type PlanId = 'classic' | 'ranch' | 'colonial' | 'craftsman' | 'modern' | 'cape' | 'duplex';
export type Extra = 'pool' | 'hoop' | 'court' | 'swings' | 'trampoline' | 'hotTub' | 'doghouse' | 'garden';

export interface HouseLook {
  wall: WallStyle;
  roof?: RoofStyle;
  floor: FloorMat;
  fence: 'picket' | 'privacy' | 'none';
  stories?: 1 | 2;
  extras?: Extra[];
}

/** Lot-local build writer: every helper takes local (u, v) and emits world-grid ops. */
export class Plot {
  readonly ops: BuildOp[] = [];
  private readonly flip: boolean;
  private readonly front: number;
  private readonly wallKeys = new Set<string>();
  private n = 0;

  constructor(private readonly lot: LotDef, private readonly owner: string, readonly style: WallStyle) {
    this.flip = lot.front === '-z';
    this.front = this.flip ? lot.z : lot.z + lot.d;
  }

  get width() { return this.lot.w; }
  get depth() { return this.lot.d; }

  /** World Z of the vertex line `v` metres behind the front edge. */
  vz(v: number) { return this.flip ? this.front + v : this.front - v; }
  /** World Z of cell row `v` (row 0 touches the front edge). */
  cz(v: number) { return this.flip ? this.front + v : this.front - v - 1; }
  gx(u: number) { return this.lot.x + u; }

  id() { return `${this.owner.slice(4, 8)}${this.lot.id}${(this.n++).toString(36).padStart(3, '0')}`; }

  private walls(level: number, segs: { gx: number; gz: number; dir: 'x' | 'z' }[], kind?: WallKind, style = this.style) {
    const fresh = segs.filter(s => {
      const k = wallKey(level, s.dir, s.gx, s.gz);
      if (this.wallKeys.has(k)) return false;
      this.wallKeys.add(k);
      return true;
    });
    if (!fresh.length) return;
    const op: Extract<BuildOp, { op: 'walls' }> = { op: 'walls', lotId: this.lot.id, level, style, segs: fresh };
    if (kind && kind !== 'full') op.kind = kind;
    this.ops.push(op);
  }

  /** A wall along the street direction on vertex line `v`, covering cells u0..u1-1. */
  row(level: number, v: number, u0: number, u1: number, kind?: WallKind) {
    this.walls(level, Array.from({ length: u1 - u0 }, (_, i) => ({ gx: this.gx(u0 + i), gz: this.vz(v), dir: 'x' as const })), kind);
  }

  /** A wall running back from the street on vertex column `u`, covering rows v0..v1-1. */
  col(level: number, u: number, v0: number, v1: number, kind?: WallKind) {
    this.walls(level, Array.from({ length: v1 - v0 }, (_, i) => ({ gx: this.gx(u), gz: this.cz(v0 + i), dir: 'z' as const })), kind);
  }

  box(level: number, u0: number, v0: number, u1: number, v1: number) {
    this.row(level, v0, u0, u1); this.row(level, v1, u0, u1);
    this.col(level, u0, v0, v1); this.col(level, u1, v0, v1);
  }

  openRow(level: number, v: number, u: number, opening: Opening) {
    this.ops.push({ op: 'opening', lotId: this.lot.id, key: wallKey(level, 'x', this.gx(u), this.vz(v)), opening });
  }

  openCol(level: number, u: number, v: number, opening: Opening) {
    this.ops.push({ op: 'opening', lotId: this.lot.id, key: wallKey(level, 'z', this.gx(u), this.cz(v)), opening });
  }

  /** Several openings of one kind on a row wall: adjacent sliders, pictures and garage doors join into one unit. */
  openRun(level: number, v: number, us: number[], opening: Opening) { for (const u of us) this.openRow(level, v, u, opening); }

  floor(level: number, u0: number, v0: number, u1: number, v1: number, mat: FloorMat) {
    const za = this.cz(v0), zb = this.cz(v1 - 1);
    this.ops.push({ op: 'floor', lotId: this.lot.id, level, mat, x0: this.gx(u0), x1: this.gx(u1 - 1), z0: Math.min(za, zb), z1: Math.max(za, zb) });
  }

  /** Places an item with its local footprint starting at cell (u, v). Rotation 0 faces the street. */
  obj(catalogId: string, u: number, v: number, rot = 0, level = 0) {
    const r = this.flip ? (rot % 2 === 0 ? (rot + 2) % 4 : rot) : rot;
    const { d } = footprint(CATALOG[catalogId], r);
    this.ops.push({ op: 'object', lotId: this.lot.id, obj: { id: this.id(), catalogId, gx: this.gx(u), gz: this.flip ? this.front + v : this.front - v - d, rot: r, level } });
  }

  roof(level: number, u0: number, v0: number, u1: number, v1: number, style: RoofStyle, pitchDeg: number) {
    const za = this.vz(v0), zb = this.vz(v1);
    this.ops.push({ op: 'roof', lotId: this.lot.id, roof: { id: this.id(), x0: this.gx(u0), x1: this.gx(u1), z0: Math.min(za, zb), z1: Math.max(za, zb), level, style, pitchDeg: style === 'flat' ? 0 : pitchDeg } });
  }

  pool(u0: number, v0: number, u1: number, v1: number) {
    const za = this.vz(v0), zb = this.vz(v1);
    this.ops.push({ op: 'pool', lotId: this.lot.id, pool: { id: this.id(), x0: this.gx(u0), x1: this.gx(u1), z0: Math.min(za, zb), z1: Math.max(za, zb) } });
  }

  /** Fence along the back of the lot and down both sides to `fromV`. */
  backFence(kind: 'picket' | 'privacy', fromV: number) {
    const { w, d } = this.lot;
    this.walls(0, Array.from({ length: w }, (_, i) => ({ gx: this.gx(i), gz: this.vz(d), dir: 'x' as const })), kind);
    for (const u of [0, w]) this.walls(0, Array.from({ length: d - fromV }, (_, i) => ({ gx: this.gx(u), gz: this.cz(fromV + i), dir: 'z' as const })), kind);
  }

  /** A low front fence one metre in, open at the driveway and at the front walk. */
  frontFence(walkU: number) {
    const segs: { gx: number; gz: number; dir: 'x' }[] = [];
    for (let u = 8; u < this.lot.w; u++) if (Math.abs(u + 0.5 - walkU) > 1.5) segs.push({ gx: this.gx(u), gz: this.vz(1), dir: 'x' });
    this.walls(0, segs, 'picket');
  }
}

type Rng = () => number;
const pick = <T>(r: Rng, list: readonly T[]) => list[Math.floor(r() * list.length) % list.length];

// ------------------------------------------------------------------ rooms

function livingRoom(p: Plot, u0: number, v0: number, u1: number) {
  p.obj('sofa', u0 + 1, v0 + 3, 2);
  p.obj('coffeeTable', u0 + 2, v0 + 2, 0);
  p.obj('tvStand', u0 + 2, v0 + 1, 0);
  p.obj('armchair', u1 - 2, v0 + 2, 3);
  p.obj('floorLamp', u0, v0 + 3, 0);
  p.obj('rugLarge', u0 + 1, v0 + 1, 0);
}

function kitchen(p: Plot, u0: number, backV: number, len: number) {
  p.obj('fridge', u0, backV - 1, 0);
  p.obj('counter', u0 + 1, backV - 1, 0);
  p.obj('stove', u0 + 2, backV - 1, 0);
  if (len > 3) p.obj('sinkCounter', u0 + 3, backV - 1, 0);
  if (len > 4) p.obj('counter', u0 + 4, backV - 1, 0);
}

function bedroom(p: Plot, u0: number, v0: number, u1: number, v1: number, level = 0, kids = false) {
  if (kids) { p.obj('twinBed', u0, v1 - 2, 2, level); p.obj('toyChest', u1 - 1, v1 - 1, 0, level); return; }
  p.obj('bed', u0 + 1, v1 - 3, 2, level);
  p.obj('nightstand', u0, v1 - 1, 0, level);
  if (u1 - u0 >= 5) p.obj('nightstand', u0 + 3, v1 - 1, 0, level);
  if (u1 - u0 >= 6) p.obj('dresser', u1 - 2, v0, 2, level);
}

function bath(p: Plot, u0: number, backV: number, level = 0) {
  p.obj('toilet', u0, backV - 1, 0, level);
  p.obj('vanity', u0 + 1, backV - 1, 0, level);
}

// ------------------------------------------------------------------ plans

/** The original starter house: 12 × 10 m, optional second storey. */
function classic(p: Plot, look: HouseLook) {
  const u0 = 10, f = 12, W = 12, D = 10;
  p.floor(0, u0, f, u0 + W, f + 5, look.floor);
  p.floor(0, u0, f + 5, u0 + 7, f + D, 'tile');
  p.floor(0, u0 + 7, f + 5, u0 + W, f + D, 'carpet');
  p.box(0, u0, f, u0 + W, f + D);
  p.row(0, f + 5, u0, u0 + W);
  p.col(0, u0 + 7, f + 5, f + D);
  p.openRow(0, f, u0 + 6, 'door');
  for (const u of [2, 3, 9, 10]) p.openRow(0, f, u0 + u, 'window');
  for (const v of [2, 7]) { p.openCol(0, u0, f + v, 'window'); p.openCol(0, u0 + W, f + v, 'window'); }
  p.openRow(0, f + D, u0 + 3, 'french');
  p.openRun(0, f + D, [u0 + 8, u0 + 9, u0 + 10], 'picture');
  p.openRow(0, f + 5, u0 + 3, 'door'); p.openRow(0, f + 5, u0 + 9, 'door');
  p.obj('sofa', u0 + 4, f + 2, 2); p.obj('coffeeTable', u0 + 5, f + 3, 0); p.obj('tvStand', u0 + 5, f + 4, 0);
  p.obj('armchair', u0 + 1, f + 2, 3); p.obj('bookshelf', u0 + 11, f + 1, 1); p.obj('plant', u0 + 11, f + 4, 0);
  kitchen(p, u0, f + D, 5);
  p.obj('diningSet', u0 + 2, f + 6, 0);
  p.obj('bed', u0 + 9, f + 7, 2); p.obj('nightstand', u0 + 8, f + 9, 0); p.obj('nightstand', u0 + 11, f + 9, 0);
  p.obj('ceilingLight', u0 + 5, f + 2, 0); p.obj('chandelier', u0 + 3, f + 7, 0);
  if (look.stories === 2) {
    p.floor(1, u0, f, u0 + W, f + D, 'carpet');
    p.box(1, u0, f, u0 + W, f + D);
    for (const u of [2, 3, 6, 9, 10]) p.openRow(1, f, u0 + u, 'window');
    for (const u of [3, 9]) p.openRow(1, f + D, u0 + u, 'window');
    for (const v of [2, 7]) { p.openCol(1, u0, f + v, 'window'); p.openCol(1, u0 + W, f + v, 'window'); }
    p.obj('bed', u0 + 2, f + 6, 2, 1); p.obj('dresser', u0 + 9, f + 8, 2, 1); p.obj('bookshelf', u0 + 11, f + 2, 1, 1);
  }
  p.roof(look.stories === 2 ? 1 : 0, u0, f, u0 + W, f + D, look.roof ?? 'gable_x', 32);
  return { u0, u1: u0 + W, f, back: f + D, walkU: u0 + 6.5 };
}

/** Single-storey ranch with a two-car garage at the end of the driveway. */
function ranch(p: Plot, look: HouseLook) {
  const g0 = 2, u0 = 10, u1 = 25, f = 12, back = 22, gBack = 19;
  p.floor(0, g0, f, u0, gBack, 'concrete');
  p.floor(0, u0, f, 18, 17, look.floor);
  p.floor(0, 18, f, u1, 17, 'tile');
  p.floor(0, u0, 17, 16, back, 'carpet');
  p.floor(0, 16, 17, 19, back, 'tile');
  p.floor(0, 19, 17, u1, back, 'carpet');
  p.box(0, u0, f, u1, back);
  p.box(0, g0, f, u0, gBack);
  p.row(0, 17, u0, u1);
  p.col(0, 18, f, 17);
  p.col(0, 16, 17, back); p.col(0, 19, 17, back);
  p.openRun(0, f, [3, 4, 5, 6], 'garage');
  p.openRow(0, f, 8, 'window');
  p.openCol(0, g0, 16, 'window');
  p.openCol(0, u0, 14, 'door');
  p.openRow(0, f, 15, 'glassdoor');
  for (const u of [12, 13, 20, 22]) p.openRow(0, f, u, 'window');
  for (const v of [14, 19]) p.openCol(0, u1, v, 'window');
  p.openRun(0, back, [12, 13], 'window');
  p.openRow(0, back, 17, 'frosted');
  p.openRun(0, back, [21, 22], 'slider');
  p.openRow(0, 17, 12, 'door'); p.openRow(0, 17, 17, 'door'); p.openRow(0, 17, 20, 'door');
  p.openCol(0, 18, 15, 'door');
  livingRoom(p, u0 + 1, f, 18);
  kitchen(p, 19, 17, 5);
  p.obj('diningSet', 20, f + 1, 0);
  bedroom(p, u0, 17, 16, back);
  bath(p, 16, back);
  bedroom(p, 20, 17, u1, back, 0, true);
  p.obj('ceilingLight', 14, f + 2, 0);
  p.roof(0, u0, f, u1, back, look.roof ?? 'hip', 26);
  p.roof(0, g0, f, u0, gBack, 'gable_z', 22);
  return { u0: g0, u1, f, back, walkU: 15.5 };
}

/** Two-storey center-hall colonial with a staircase. */
function colonial(p: Plot, look: HouseLook) {
  const u0 = 10, u1 = 23, f = 13, mid = 18, back = 22;
  p.floor(0, u0, f, 16, mid, look.floor);
  p.floor(0, 16, f, u1, mid, look.floor);
  p.floor(0, u0, mid, u1, back, 'tile');
  p.box(0, u0, f, u1, back);
  p.row(0, mid, u0, u1);
  p.col(0, 16, f, mid);
  p.openRow(0, f, 16, 'door');
  for (const u of [11, 13, 19, 21]) p.openRow(0, f, u, 'tall');
  for (const v of [15, 20]) { p.openCol(0, u0, v, 'window'); p.openCol(0, u1, v, 'window'); }
  p.openRow(0, back, 12, 'window'); p.openRow(0, back, 17, 'french');
  p.openRow(0, mid, 12, 'door'); p.openRow(0, mid, 20, 'door');
  p.openCol(0, 16, 15, 'door');
  livingRoom(p, u0, f, 16);
  p.obj('diningSet', 18, f + 1, 0); p.obj('sideboard', 20, f, 2);
  kitchen(p, 11, back, 5);
  p.obj('island', 13, mid + 1, 0);
  p.obj('stairs', 22, mid, 0);
  p.obj('chandelier', 19, f + 2, 0);

  p.floor(1, u0, f, u1, back, 'carpet');
  p.box(1, u0, f, u1, back);
  p.col(1, 17, f, back);
  p.row(1, mid, 17, u1);
  p.openCol(1, 17, 20, 'door'); p.openRow(1, mid, 19, 'door');
  for (const u of [11, 13, 16, 19, 21]) p.openRow(1, f, u, 'window');
  for (const v of [15, 20]) { p.openCol(1, u0, v, 'window'); p.openCol(1, u1, v, 'window'); }
  p.openRow(1, back, 13, 'window');
  bedroom(p, u0, f, 17, back, 1);
  bedroom(p, 17, f, u1, mid, 1, true);
  p.obj('desk', 18, back - 1, 0, 1); p.obj('bookshelf', 20, back - 1, 0, 1);
  p.roof(1, u0, f, u1, back, look.roof ?? 'hip', 30);
  return { u0, u1, f, back, walkU: 16.5 };
}

/** Bungalow with a deep front porch under the main gable. */
function craftsman(p: Plot, look: HouseLook) {
  const u0 = 11, u1 = 23, porch = 12, f = 15, mid = 20, back = 26;
  p.floor(0, u0, porch, u1, f, 'deck');
  p.floor(0, u0, f, 18, mid, look.floor);
  p.floor(0, 18, f, u1, mid, 'tile');
  p.floor(0, u0, mid, 17, back, 'carpet');
  p.floor(0, 17, mid, 19, back, 'tile');
  p.floor(0, 19, mid, u1, back, 'carpet');
  p.box(0, u0, f, u1, back);
  p.row(0, mid, u0, u1);
  p.col(0, 18, f, mid); p.col(0, 17, mid, back); p.col(0, 19, mid, back);
  p.row(0, porch, u0, 15, 'railing'); p.row(0, porch, 18, u1, 'railing');
  p.col(0, u0, porch, f, 'railing'); p.col(0, u1, porch, f, 'railing');
  p.openRow(0, f, 16, 'door');
  p.openRun(0, f, [12, 13, 14], 'picture');
  p.openRun(0, f, [20, 21], 'window');
  for (const v of [17, 23]) { p.openCol(0, u0, v, 'window'); p.openCol(0, u1, v, 'window'); }
  p.openRun(0, back, [13, 14], 'window'); p.openRow(0, back, 18, 'frosted'); p.openRun(0, back, [20, 21], 'window');
  p.openRow(0, mid, 13, 'door'); p.openRow(0, mid, 18, 'door'); p.openRow(0, mid, 21, 'door');
  p.openCol(0, 18, 17, 'door');
  p.obj('bench', 19, porch, 0); p.obj('plant', u0 + 1, porch, 0); p.obj('tallPlant', 22, porch + 2, 0);
  p.obj('sofa', 12, f + 3, 2); p.obj('coffeeTable', 13, f + 2, 0); p.obj('fireplace', 13, f, 2); p.obj('armchair', 16, f + 1, 3);
  kitchen(p, 18, mid, 5);
  p.obj('diningSet', 20, f + 1, 0);
  bedroom(p, u0, mid, 17, back);
  bath(p, 17, back);
  bedroom(p, 19, mid, u1, back, 0, true);
  p.roof(0, u0, porch, u1, back, look.roof ?? 'gable_x', 30);
  return { u0, u1, f: porch, back, walkU: 16.5 };
}

/** Flat-roofed modern house: a two-storey box beside a single-storey wing. */
function modern(p: Plot, look: HouseLook) {
  const a0 = 9, a1 = 19, f = 13, aBack = 21, b1 = 28, bf = 16, bBack = 24;
  p.floor(0, a0, f, a1, aBack, 'concrete');
  p.floor(0, a1, bf, b1, bBack, look.floor);
  p.box(0, a0, f, a1, aBack);
  p.box(0, a1, bf, b1, bBack);
  p.openRow(0, f, 15, 'glassdoor');
  p.openRun(0, f, [10, 11, 12], 'picture');
  p.openRun(0, f, [17, 18], 'clerestory');
  p.openRun(0, bf, [21, 22, 23, 24, 25], 'picture');
  p.openRun(0, aBack, [11, 12, 13], 'slider');
  p.openRun(0, bBack, [22, 23, 24], 'slider');
  p.openCol(0, a1, 18, 'door');
  p.openCol(0, b1, 20, 'clerestory');
  p.obj('sofa', 21, bf + 4, 2); p.obj('coffeeTable', 22, bf + 3, 0); p.obj('wallTv', 26, bBack - 1, 0); p.obj('recliner', 26, bf + 2, 3); p.obj('tallPlant', 27, bf + 6, 0);
  kitchen(p, a0, aBack, 4);
  p.obj('island', 11, f + 4, 0); p.obj('barStool', 11, f + 3, 0); p.obj('barStool', 12, f + 3, 0);
  p.obj('stairs', 18, f + 1, 0);
  p.floor(1, a0, f, a1, aBack, 'oak');
  p.box(1, a0, f, a1, aBack);
  p.openRun(1, f, [10, 11, 12, 13, 14], 'picture');
  p.openRun(1, aBack, [12, 13], 'window');
  p.openCol(1, a0, 16, 'tall');
  bedroom(p, a0, f, 17, aBack, 1);
  p.obj('desk', 15, f + 1, 2, 1);
  p.roof(1, a0, f, a1, aBack, 'flat', 0);
  p.roof(0, a1, bf, b1, bBack, 'flat', 0);
  return { u0: a0, u1: b1, f, back: bBack, walkU: 15.5 };
}

/** Steep-roofed cape with a picket fence along the front walk. */
function cape(p: Plot, look: HouseLook) {
  const u0 = 10, u1 = 22, f = 13, mid = 17, back = 21;
  p.floor(0, u0, f, u1, mid, look.floor);
  p.floor(0, u0, mid, 15, back, 'carpet');
  p.floor(0, 15, mid, 17, back, 'tile');
  p.floor(0, 17, mid, u1, back, 'tile');
  p.box(0, u0, f, u1, back);
  p.row(0, mid, u0, u1);
  p.col(0, 15, mid, back); p.col(0, 17, mid, back);
  p.openRow(0, f, 16, 'door');
  for (const u of [11, 13, 18, 20]) p.openRow(0, f, u, 'window');
  for (const v of [15, 19]) { p.openCol(0, u0, v, 'window'); p.openCol(0, u1, v, 'window'); }
  p.openRow(0, back, 12, 'window'); p.openRow(0, back, 16, 'frosted'); p.openRow(0, back, 19, 'door');
  p.openRow(0, mid, 12, 'door'); p.openRow(0, mid, 16, 'door'); p.openRow(0, mid, 19, 'door');
  livingRoom(p, u0 + 1, f, u1 - 3);
  p.obj('piano', 19, f, 2);
  bedroom(p, u0, mid, 15, back);
  bath(p, 15, back);
  kitchen(p, 17, back, 4);
  p.obj('diningSet', 18, mid, 0);
  p.frontFence(16.5);
  p.roof(0, u0, f, u1, back, look.roof ?? 'gable_x', 45);
  return { u0, u1, f, back, walkU: 16.5 };
}

/** Side-by-side duplex: two front doors under one long roof. */
function duplex(p: Plot, look: HouseLook) {
  const u0 = 8, u1 = 26, half = 17, f = 13, mid = 18, back = 22;
  p.floor(0, u0, f, u1, mid, look.floor);
  p.floor(0, u0, mid, u1, back, 'tile');
  p.box(0, u0, f, u1, back);
  p.col(0, half, f, back);
  p.row(0, mid, u0, u1);
  p.openRow(0, f, 10, 'door'); p.openRow(0, f, 23, 'door');
  for (const u of [12, 14, 19, 21]) p.openRow(0, f, u, 'window');
  p.openCol(0, u0, 16, 'window'); p.openCol(0, u1, 16, 'window');
  p.openRow(0, back, 11, 'window'); p.openRow(0, back, 14, 'door'); p.openRow(0, back, 19, 'door'); p.openRow(0, back, 22, 'window');
  p.openRow(0, mid, 12, 'door'); p.openRow(0, mid, 21, 'door');
  p.obj('loveseat', 12, f + 3, 2); p.obj('tvStand', 12, f + 1, 0); p.obj('armchair', 15, f + 2, 3);
  p.obj('loveseat', 19, f + 3, 2); p.obj('tvStand', 19, f + 1, 0); p.obj('armchair', 18, f + 2, 1);
  kitchen(p, u0, back, 4);
  kitchen(p, 22, back, 4);
  p.obj('diningSet', 14, mid, 0); p.obj('diningSet', 19, mid, 0);
  p.roof(0, u0, f, u1, back, look.roof ?? 'gable_x', 28);
  return { u0, u1, f, back, walkU: 10.5 };
}

const PLANS: Record<PlanId, (p: Plot, look: HouseLook) => { u0: number; u1: number; f: number; back: number; walkU: number }> = {
  classic, ranch, colonial, craftsman, modern, cape, duplex,
};

// ------------------------------------------------------------------ yard

function yard(p: Plot, look: HouseLook, house: { u0: number; u1: number; f: number; back: number }, r: Rng) {
  const { u0, u1, f, back } = house;
  for (const u of [u0, u0 + 2, u1 - 3, u1 - 1]) if (u >= 7) p.obj('shrub', u, f - 1, 0);
  p.obj('flowerBed', Math.max(8, u0 + 4), f - 2, 0);
  if (r() < 0.6) p.obj('tree', 25 + Math.floor(r() * 3), 6 + Math.floor(r() * 3), 0);

  const patio = back + 1;
  p.floor(0, u0 + 2, patio, u0 + 7, patio + 3, 'patio');
  p.obj('patioSet', u0 + 3, patio, 0);
  p.obj('grill', u0 + 6, patio + 1, 0);

  const yardV = patio + 4;
  const room = p.depth - 1 - yardV;
  for (const extra of look.extras ?? []) {
    if (extra === 'hoop') p.obj('hoop', 3, 10, 0);
    if (extra === 'pool' && room >= 7) {
      p.pool(u0 + 9, yardV, u0 + 9 + Math.min(9, u1 - u0 - 9), yardV + 5);
      p.obj('lounger', u0 + 8, yardV, 0);
    }
    if (extra === 'swings' && room >= 3) p.obj('swingSet', 26, yardV, 0);
    if (extra === 'trampoline' && room >= 4) p.obj('trampoline', 3, yardV, 0);
    if (extra === 'court' && room >= 9) p.obj('court', 2, p.depth - 9, 2);
    if (extra === 'hotTub') p.obj('hotTub', u1 - 3, patio, 0);
    if (extra === 'doghouse') p.obj('doghouse', 29, back - 2, 3);
    if (extra === 'garden') { p.obj('flowerBed', 28, p.depth - 3, 0); p.obj('flowerBed', 26, p.depth - 3, 0); p.obj('bench', 27, p.depth - 5, 2); }
  }
  if (look.fence !== 'none') p.backFence(look.fence, back + 1);
}

/** All the ops for one house, in build order. */
export function planOps(lot: LotDef, owner: string, plan: PlanId, look: HouseLook, r: Rng): BuildOp[] {
  const p = new Plot(lot, owner, look.wall);
  const house = PLANS[plan](p, look);
  yard(p, look, house, r);
  return p.ops;
}

export const WALL_PALETTE: Record<PlanId, readonly WallStyle[]> = {
  classic: ['siding_white', 'siding_sage', 'brick_red', 'board_batten'],
  ranch: ['brick_red', 'brick_white', 'siding_navy', 'stone'],
  colonial: ['brick_red', 'siding_white', 'siding_navy'],
  craftsman: ['board_batten', 'siding_sage', 'stone'],
  modern: ['stucco_sand', 'board_batten', 'siding_navy'],
  cape: ['siding_white', 'siding_sage', 'siding_navy'],
  duplex: ['siding_white', 'brick_white', 'stucco_sand'],
};
export const pickWall = (plan: PlanId, r: Rng) => pick(r, WALL_PALETTE[plan]);
