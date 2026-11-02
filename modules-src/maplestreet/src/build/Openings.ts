/**
 * Door and window geometry for one 1 m wall segment. Coordinates are wall-
 * local: `a` runs along the wall (0..1), `y` is height above the level's
 * floor and `c` is across the wall (side A is negative, side B positive).
 *
 * Run-aware openings (sliding patio doors, garage doors, clerestory strips,
 * picture windows) look at their neighbours on the same wall line, so two or
 * three adjacent segments read as one wide unit: jambs only at the ends, a
 * slider's fixed half and opening half split across the whole run, and so on.
 */
import * as THREE from 'three/webgpu';
import { LotBuild, Opening, Wall, WALL_STYLES, wallKey, WallStyle } from '../../shared/BuildRules';
import type { MaterialLibrary } from '../core/Materials';

type Box6 = [number, number, number, number, number, number];

export interface OpeningCtx {
  b: LotBuild;
  w: Wall;
  H: number;
  base: number;
  /** Half wall thickness. */
  h: number;
  e0: number;
  e1: number;
  isHidden: boolean;
  cut: number;
  matA: string;
  matB: string;
  mats: MaterialLibrary;
  group: THREE.Group;
  solid(a0: number, a1: number, y0: number, y1: number): void;
  visual(mat: string, a0: number, a1: number, y0: number, y1: number, c0: number, c1: number): void;
  toWorld(a0: number, a1: number, y0: number, y1: number, c0: number, c1: number): Box6;
  collide(...box: Box6): void;
}

export const OPENING_LABEL: Record<Exclude<Opening, 'none'>, string> = {
  door: 'door', window: 'window', picture: 'picture window', slider: 'sliding patio door', french: 'French doors',
  glassdoor: 'glass entry door', tall: 'tall window', clerestory: 'clerestory window', frosted: 'frosted window', garage: 'garage door',
};

const CASING = 0.06;
const isExterior = (f: string) => (WALL_STYLES as string[]).includes(f as WallStyle);

/** -1 when side A faces outdoors, +1 when side B does, 0 when it can't be told (both or neither). */
function outsideSign(ctx: OpeningCtx) {
  const a = isExterior(ctx.matA), b = isExterior(ctx.matB);
  return a && !b ? -1 : b && !a ? 1 : 0;
}

/** Position of this segment within a straight run of the same opening: index and length. */
function runOf(ctx: OpeningCtx) {
  const { b, w } = ctx;
  const same = (k: number) => {
    const key = w.dir === 'x' ? wallKey(w.level, 'x', w.gx + k, w.gz) : wallKey(w.level, 'z', w.gx, w.gz + k);
    return b.walls[key]?.opening === w.opening;
  };
  let before = 0, after = 0;
  while (before < 12 && same(-(before + 1))) before++;
  while (after < 12 && same(after + 1)) after++;
  return { i: before, n: before + 1 + after, first: before === 0, last: after === 0 };
}

/**
 * Places a wall-local object (x = along the wall) at wall-local (a, y, c). Along-Z walls are
 * reached by a quarter turn, which also flips local z, so swing angles are mirrored there to
 * keep doors opening toward the same side of the wall as on along-X walls.
 */
function place(ctx: OpeningCtx, obj: THREE.Object3D, a: number, y: number, c: number) {
  const { w, base } = ctx;
  const holder = new THREE.Group();
  if (w.dir === 'x') holder.position.set(w.gx + a, base + y, w.gz + c);
  else { holder.position.set(w.gx + c, base + y, w.gz + a); holder.rotation.y = -Math.PI / 2; obj.rotation.y = -obj.rotation.y; }
  holder.add(obj);
  holder.userData.level = w.level;
  holder.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  ctx.group.add(holder);
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m;
}

/** A framed leaf (stiles, rails, optional glass with muntins) hinged at local x = 0 and extending toward +x·dir. */
function leaf(mats: MaterialLibrary, width: number, height: number, opts: { frame: string; glassFrom?: number; muntins?: number; panel?: string; dir?: 1 | -1 }) {
  const g = new THREE.Group();
  const dir = opts.dir ?? 1, f = 0.085, t = 0.045;
  const frame = mats.get(opts.frame).material;
  const sx = (x0: number, x1: number) => ({ cx: dir * (x0 + x1) / 2, w: x1 - x0 });
  const bx = (x0: number, x1: number, y0: number, y1: number, mat: THREE.Material, depth = t) => {
    const s = sx(x0, x1); g.add(mesh(new THREE.BoxGeometry(s.w, y1 - y0, depth), mat, s.cx, (y0 + y1) / 2, 0));
  };
  bx(0, f, 0, height, frame); bx(width - f, width, 0, height, frame);
  bx(f, width - f, height - f, height, frame); bx(f, width - f, 0, f * 1.6, frame);
  const gFrom = opts.glassFrom ?? 0;
  if (gFrom > f * 1.6) { bx(f, width - f, f * 1.6, gFrom, mats.get(opts.panel ?? opts.frame).material, t * 0.8); bx(f, width - f, gFrom - 0.05, gFrom, frame); }
  const g0 = Math.max(gFrom, f * 1.6);
  bx(f, width - f, g0, height - f, mats.get('glass').material, 0.012);
  const mu = opts.muntins ?? 0;
  for (let k = 1; k <= mu; k++) { const y = g0 + ((height - f - g0) * k) / (mu + 1); bx(f, width - f, y - 0.012, y + 0.012, frame, 0.03); }
  const handle = mesh(new THREE.BoxGeometry(0.025, 0.16, 0.06), mats.get('metal').material, dir * (width - 0.08), 1.0, 0);
  g.add(handle);
  return g;
}

export function emitOpening(ctx: OpeningCtx) {
  const { w, H, h, e0, e1, isHidden, cut, mats } = ctx;
  const { solid, visual, toWorld, collide } = ctx;
  const trim = (a0: number, a1: number, y0: number, y1: number, depth = h + 0.02, mat = 'trim') => visual(mat, a0, a1, y0, y1, -depth, depth);
  const showLeaf = (head: number) => !isHidden && head < cut;
  /** Wall pieces around a rectangular hole [o0,o1]×[sill,head], extended over the corner joints. */
  const around = (o0: number, o1: number, sill: number, head: number) => {
    if (o0 > 0) solid(-e0, o0, 0, H);
    if (o1 < 1) solid(o1, 1 + e1, 0, H);
    const l = o0 > 0 ? o0 : -e0, r = o1 < 1 ? o1 : 1 + e1;
    if (sill > 0) solid(l, r, 0, sill);
    solid(l, r, head, H);
  };
  const glassPane = (a0: number, a1: number, y0: number, y1: number, c0 = -0.008, c1 = 0.008, mat = 'glass') => {
    visual(mat, a0, a1, y0, y1, c0, c1);
    collide(...toWorld(a0, a1, y0, y1, -0.03, 0.03));
  };
  const windowFrame = (o0: number, o1: number, sill: number, head: number, c = CASING, nose = true) => {
    trim(o0, o0 + c, sill, head, 0.03); trim(o1 - c, o1, sill, head, 0.03);
    trim(o0, o1, head - c, head, 0.03); trim(o0, o1, sill, sill + c, 0.03);
    if (nose) trim(o0 - 0.04, o1 + 0.04, sill - 0.04, sill, h + 0.05);
  };

  switch (w.opening) {
    case 'door': {
      const o0 = 0.06, o1 = 0.94, head = 2.1;
      around(o0, o1, 0, head);
      trim(o0 - CASING, o0, 0, head + CASING); trim(o1, o1 + CASING, 0, head + CASING); trim(o0, o1, head, head + CASING);
      if (showLeaf(head)) {
        const g = new THREE.Group();
        g.add(mesh(new THREE.BoxGeometry(o1 - o0 - 0.01, head - 0.01, 0.045), mats.get('door').material, (o1 - o0) / 2, head / 2, 0));
        g.add(mesh(new THREE.SphereGeometry(0.03, 12, 8), mats.get('metal').material, o1 - o0 - 0.08, 1.0, 0.04));
        // Raised panels
        for (const [y0, y1] of [[0.25, 0.95], [1.15, 1.9]]) for (const x of [0.2, 0.58]) g.add(mesh(new THREE.BoxGeometry(0.26, y1 - y0, 0.06), mats.get('door').material, x, (y0 + y1) / 2, 0));
        g.rotation.y = -1.3;
        place(ctx, g, o0, 0, 0);
      }
      break;
    }
    case 'glassdoor': {
      const o0 = 0.08, o1 = 0.92, head = 2.1, tr0 = 2.18, tr1 = 2.48;
      around(o0, o1, 0, tr1);
      solid(o0, o1, head, tr0);
      trim(o0 - CASING, o0, 0, tr1 + CASING); trim(o1, o1 + CASING, 0, tr1 + CASING); trim(o0, o1, tr1, tr1 + CASING);
      glassPane(o0 + 0.03, o1 - 0.03, tr0, tr1);
      windowFrame(o0, o1, tr0, tr1, 0.04, false);
      if (showLeaf(head)) {
        const g = leaf(mats, o1 - o0 - 0.01, head - 0.01, { frame: 'door', glassFrom: 0.95, muntins: 2 });
        g.rotation.y = -1.25;
        place(ctx, g, o0, 0, 0);
      }
      break;
    }
    case 'french': {
      const o0 = 0.04, o1 = 0.96, head = 2.15;
      around(o0, o1, 0, head);
      trim(o0 - CASING, o0, 0, head + CASING); trim(o1, o1 + CASING, 0, head + CASING); trim(o0, o1, head, head + CASING);
      trim(o0, o1, 0, 0.025, h + 0.02, 'metal_dark');                                 // threshold
      if (showLeaf(head)) {
        const half = (o1 - o0) / 2 - 0.005;
        const l = leaf(mats, half, head - 0.01, { frame: 'trim', muntins: 3 });
        l.rotation.y = -1.35; place(ctx, l, o0, 0, 0);
        const r = leaf(mats, half, head - 0.01, { frame: 'trim', muntins: 3, dir: -1 });
        r.rotation.y = 1.35; place(ctx, r, o1, 0, 0);
      }
      break;
    }
    case 'slider': {
      const run = runOf(ctx), head = 2.15;
      const o0 = run.first ? 0.06 : 0, o1 = run.last ? 0.94 : 1;
      around(o0, o1, 0, head);
      trim(o0, o1, head - 0.07, head, h + 0.01);                                       // head track
      trim(o0, o1, 0, 0.035, h + 0.02, 'metal_dark');                                  // sill track
      if (run.first) trim(o0, o0 + 0.05, 0, head, h + 0.01);
      if (run.last) trim(o1 - 0.05, o1, 0, head, h + 0.01);
      // Fixed panel on the outer track over the first half of the run; the sliding panel is parked behind it.
      const mid = run.n / 2 - run.i;
      const f0 = o0, f1 = Math.min(o1, mid);
      if (f1 > f0 + 0.02) {
        for (const [c0, c1] of [[-0.035, -0.02], [0.02, 0.035]] as const) {
          visual('glass', f0 + 0.03, f1 - 0.01, 0.06, head - 0.08, c0, c1);
          visual('trim', f0, f1, 0.035, 0.11, c0 - 0.005, c1 + 0.005);
          visual('trim', f0, f1, head - 0.14, head - 0.07, c0 - 0.005, c1 + 0.005);
          if (mid <= 1 && mid > 0) visual('trim', f1 - 0.06, f1, 0.035, head - 0.07, c0 - 0.005, c1 + 0.005);   // meeting stiles
        }
        if (mid <= 1 && mid > 0) visual('metal', f1 - 0.1, f1 - 0.075, 0.9, 1.15, 0.035, 0.05);                // pull handle
        collide(...toWorld(f0, f1, 0, head, -0.04, 0.04));
      }
      break;
    }
    case 'garage': {
      const run = runOf(ctx), head = 2.35;
      const o0 = run.first ? 0.1 : 0, o1 = run.last ? 0.9 : 1;
      around(o0, o1, 0, head);
      if (run.first) trim(o0 - 0.08, o0, 0, head + 0.08, h + 0.03);
      if (run.last) trim(o1, o1 + 0.08, 0, head + 0.08, h + 0.03);
      trim(o0, o1, head, head + 0.08, h + 0.03);
      const sec = head / 4;
      visual('metal_dark', o0, o1, 0, sec * 3, -0.02, 0.02);                          // weather seals behind the section joints
      for (let k = 0; k < 4; k++) {
        const y0 = k * sec + 0.008, y1 = (k + 1) * sec - 0.008;
        if (k === 3) {
          // Top section: a row of small lites.
          visual('trim', o0, o1, y0, y0 + 0.12, -0.045, 0.045);
          visual('trim', o0, o1, y1 - 0.1, y1, -0.045, 0.045);
          const lw = (o1 - o0) / 2;
          for (let q = 0; q < 2; q++) {
            const a0 = o0 + q * lw;
            visual('trim', a0, a0 + 0.07, y0, y1, -0.045, 0.045);
            visual('glass', a0 + 0.07, a0 + lw - 0.02, y0 + 0.12, y1 - 0.1, -0.01, 0.01);
          }
          visual('trim', o1 - 0.05, o1, y0, y1, -0.045, 0.045);
        } else {
          visual('trim', o0, o1, y0, y1, -0.04, 0.04);
          // Raised panels on both faces.
          const pw = (o1 - o0) / 2;
          for (let q = 0; q < 2; q++) for (const c of [-1, 1]) visual('trim', o0 + q * pw + 0.07, o0 + (q + 1) * pw - 0.07, y0 + 0.1, y1 - 0.1, c < 0 ? -0.055 : 0.04, c < 0 ? -0.04 : 0.055);
        }
      }
      collide(...toWorld(o0, o1, 0, head, -0.05, 0.05));
      break;
    }
    case 'window': {
      const o0 = 0.12, o1 = 0.88, sill = 0.9, head = 2.15;
      around(o0, o1, sill, head);
      glassPane(o0, o1, sill, head);
      windowFrame(o0, o1, sill, head);
      trim((o0 + o1) / 2 - 0.015, (o0 + o1) / 2 + 0.015, sill, head, 0.025);
      trim(o0, o1, (sill + head) / 2 - 0.015, (sill + head) / 2 + 0.015, 0.025);
      break;
    }
    case 'tall': {
      const o0 = 0.2, o1 = 0.8, sill = 0.55, head = 2.45, mid = (sill + head) / 2;
      around(o0, o1, sill, head);
      glassPane(o0, o1, sill, head);
      windowFrame(o0, o1, sill, head, 0.055);
      trim(o0, o1, mid - 0.03, mid + 0.03, 0.035);                                       // meeting rail
      trim((o0 + o1) / 2 - 0.012, (o0 + o1) / 2 + 0.012, sill, head, 0.022);              // grille
      for (const y of [(sill + mid) / 2, (mid + head) / 2]) trim(o0, o1, y - 0.012, y + 0.012, 0.022);
      trim(o0 - 0.06, o1 + 0.06, head + 0.0, head + 0.12, h + 0.04);                     // crown head
      const out = outsideSign(ctx);
      if (out !== 0) {
        // Louvered shutters either side, on the outside face only.
        const c0 = out < 0 ? -h - 0.045 : h + 0.005, c1 = out < 0 ? -h - 0.005 : h + 0.045;
        for (const [s0, s1] of [[o0 - 0.18, o0 - 0.02], [o1 + 0.02, o1 + 0.18]]) {
          visual('shutter', s0, s1, sill, head, c0, c1);
          for (let y = sill + 0.1; y < head - 0.05; y += 0.09) visual('shutter', s0 + 0.02, s1 - 0.02, y, y + 0.03, out < 0 ? c0 - 0.012 : c0, out < 0 ? c1 : c1 + 0.012);
        }
      }
      break;
    }
    case 'clerestory': {
      const run = runOf(ctx), sill = 1.85, head = 2.55;
      const o0 = run.first ? 0.05 : 0, o1 = run.last ? 0.95 : 1;
      around(o0, o1, sill, head);
      glassPane(o0, o1, sill, head);
      trim(o0, o1, head - 0.05, head, 0.03); trim(o0, o1, sill, sill + 0.05, 0.03);
      trim(o0 - (run.first ? 0.04 : 0), o1 + (run.last ? 0.04 : 0), sill - 0.04, sill, h + 0.04);
      if (run.first) trim(o0, o0 + 0.05, sill, head, 0.03);
      if (run.last) trim(o1 - 0.05, o1, sill, head, 0.03);
      if (!run.first) trim(-0.02, 0.02, sill, head, 0.03);
      break;
    }
    case 'frosted': {
      const o0 = 0.3, o1 = 0.7, sill = 1.4, head = 2.0;
      around(o0, o1, sill, head);
      glassPane(o0, o1, sill, head, -0.01, 0.01, 'glass_frosted');
      windowFrame(o0, o1, sill, head, 0.05);
      break;
    }
    case 'picture': {
      const o0 = 0, o1 = 1, sill = 0.45, head = 2.45;
      around(o0, o1, sill, head);
      glassPane(o0, o1, sill, head);
      windowFrame(o0, o1, sill, head, 0.04);
      break;
    }
    default:
      solid(-e0, 1 + e1, 0, H);
  }
}
