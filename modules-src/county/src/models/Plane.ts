/**
 * The Skylark: an original two-seat high-wing trainer. A smooth lofted
 * fuselage from spinner to tail cone with crisp windows and a cheat-line
 * stripe on its quads, a tapered wing with a real airfoil section (rounded
 * leading edge, sharp trailing edge, dihedral) braced by struts, a swept fin,
 * spring-steel main gear and a nose leg with wheel pants, and nav, strobe and
 * beacon lights. The propeller, elevator and rudder are separate entities so
 * they can turn.
 *
 * Frame: nose toward +X, up +Y, right wing +Z; the wheels rest on y = 0.
 */
import * as pc from 'playcanvas';
import type { RGB } from '../../../foxplains2/src/core/Geo';
import { bevelBox, circle, gridSurface, place, prism, sweep, type V2, type V3 } from '../core/Shapes';
import { Batch } from '../core/Batch';
import type { Kit } from '../style/Kit';
import { PALETTE } from '../../config';

export interface PlaneLivery { body: RGB; stripe: RGB; accent: RGB; glass: RGB }
export const SKYLARK_LIVERY: PlaneLivery = { body: PALETTE.heliWhite, stripe: [0.12, 0.36, 0.68], accent: [0.94, 0.62, 0.12], glass: PALETTE.glassCanopy };

interface Station { x: number; cy: number; hw: number; hh: number; n: number }
const STATIONS: Station[] = [
  { x: 2.36, cy: 1.27, hw: 0.05, hh: 0.05, n: 2 },
  { x: 2.22, cy: 1.27, hw: 0.36, hh: 0.33, n: 2.2 },
  { x: 1.85, cy: 1.3, hw: 0.5, hh: 0.47, n: 2.6 },
  { x: 1.25, cy: 1.36, hw: 0.55, hh: 0.56, n: 3.0 },
  { x: 0.75, cy: 1.43, hw: 0.57, hh: 0.66, n: 3.2 },
  { x: -0.4, cy: 1.44, hw: 0.57, hh: 0.66, n: 3.2 },
  { x: -1.3, cy: 1.42, hw: 0.48, hh: 0.56, n: 3.0 },
  { x: -2.6, cy: 1.47, hw: 0.3, hh: 0.36, n: 2.6 },
  { x: -4.3, cy: 1.55, hw: 0.16, hh: 0.21, n: 2.3 },
  { x: -5.55, cy: 1.6, hw: 0.08, hh: 0.12, n: 2.1 },
  { x: -5.7, cy: 1.6, hw: 0.02, hh: 0.03, n: 2 },
];

function station(x: number): Station {
  const s = STATIONS;
  if (x >= s[0].x) return s[0];
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1];
    if (x <= a.x && x >= b.x) {
      const t = (a.x - x) / (a.x - b.x), u = t * t * (3 - 2 * t), l = (p: number, q: number) => p + (q - p) * u;
      return { x, cy: l(a.cy, b.cy), hw: l(a.hw, b.hw), hh: l(a.hh, b.hh), n: l(a.n, b.n) };
    }
  }
  return s[s.length - 1];
}

const sgnPow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);
const naca = (x: number, t: number) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);

export const WING = { y: 2.08, le: 0.78, root: 1.62, tip: 1.28, half: 5.05, taperFrom: 2.6, dihedral: 0.026, thickness: 0.13 };

export interface PlaneModel { root: pc.Entity; prop: pc.Entity; elevator: pc.Entity; rudder: pc.Entity; lights: { nav: pc.Material; beacon: pc.Material }; triangles: number }

export function buildPlane(device: pc.GraphicsDevice, kit: Kit, livery: PlaneLivery = SKYLARK_LIVERY): PlaneModel {
  const B = new Batch(kit), paint = B.get('paint'), metal = B.get('metal'), satin = B.get('satin'), rubber = B.get('matte');

  const ROWS = 72, COLS = 48, x0 = STATIONS[0].x, x1 = STATIONS[STATIONS.length - 1].x;
  const grid: V3[][] = [], meta: { x: number; s: number[]; c: number[] }[] = [];
  for (let i = 0; i <= ROWS; i++) {
    const x = x1 + ((x0 - x1) * i) / ROWS, st = station(x), row: V3[] = [], sn: number[] = [], cs: number[] = [];
    for (let j = 0; j < COLS; j++) {
      const a = (j / COLS) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), e = 2 / st.n;
      const hh = sa < 0 ? st.hh * 0.9 : st.hh;
      row.push([x, st.cy + hh * sgnPow(sa, e), st.hw * sgnPow(ca, e)]);
      sn.push(sa); cs.push(ca);
    }
    grid.push(row); meta.push({ x, s: sn, c: cs });
  }
  const colorAt = (i: number, j: number): RGB => {
    const x = (meta[i].x + meta[i + 1].x) / 2, sa = meta[i].s[(j + 0.5) | 0], ca = Math.abs(meta[i].c[(j + 0.5) | 0]);
    const windshield = x > 0.72 && x < 1.32 && sa > 0.35 && !(ca < 0.06 && sa > 0.9);
    const side = x > -0.95 && x < 0.66 && sa > 0.18 && sa < 0.86 && ca > 0.35 && Math.abs(x + 0.15) > 0.05;
    const rear = x > -1.75 && x < -1.05 && sa > 0.3 && sa < 0.85 && ca > 0.3;
    if (windshield || side || rear) return livery.glass;
    if (sa > -0.22 && sa < 0.0 && x < 1.9 && x > -5.2) return livery.stripe;
    if (sa > -0.34 && sa <= -0.22 && x < 1.9 && x > -5.2) return livery.accent;
    if (x > 2.05) return livery.stripe;
    return livery.body;
  };
  gridSurface(paint, grid, { color: colorAt });

  const SPAN = 40, AIR = 28;
  const wingGrid: V3[][] = [];
  for (let i = 0; i <= SPAN; i++) {
    const z = -WING.half + (2 * WING.half * i) / SPAN, az = Math.abs(z);
    const chord = az < WING.taperFrom ? WING.root : WING.root + (WING.tip - WING.root) * ((az - WING.taperFrom) / (WING.half - WING.taperFrom));
    const le = WING.le - (WING.root - chord) * 0.25, y0 = WING.y + az * WING.dihedral;
    const tipRound = az > WING.half - 0.35 ? Math.sqrt(Math.max(0.05, 1 - ((az - (WING.half - 0.35)) / 0.36) ** 2)) : 1;
    const row: V3[] = [];
    for (let j = 0; j < AIR; j++) {
      const t = (j / AIR) * Math.PI * 2, xc = (1 + Math.cos(t)) / 2, up = Math.sin(t) >= 0;
      const yt = naca(Math.max(1e-4, xc), WING.thickness) * chord * tipRound;
      row.push([le - xc * chord, y0 + (up ? yt * 1.15 : -yt * 0.8), z]);
    }
    wingGrid.push(row);
  }
  gridSurface(paint, wingGrid, { color: (i, j) => {
    const az = Math.abs(-WING.half + (2 * WING.half * (i + 0.5)) / SPAN), t = ((j + 0.5) / AIR) * Math.PI * 2;
    return az > WING.half - 0.7 && Math.sin(t) > -0.2 ? livery.stripe : livery.body;
  } });
  for (const end of [0, SPAN]) {
    const ring = wingGrid[end], cx = ring.reduce((s, p) => s + p[0], 0) / AIR, cy = ring.reduce((s, p) => s + p[1], 0) / AIR, nz = end ? 1 : -1;
    const c = paint.vertex(cx, cy, ring[0][2], 0, 0, nz, 0, 0, livery.stripe);
    const vs = ring.map(p => paint.vertex(p[0], p[1], p[2], 0, 0, nz, 0, 0, livery.stripe));
    for (let k = 0; k < AIR; k++) if (end) paint.tri(c, vs[(k + 1) % AIR], vs[k]); else paint.tri(c, vs[k], vs[(k + 1) % AIR]);
  }

  for (const s of [-1, 1]) {
    const strut: V2[] = [[-0.09, 0.025], [0.09, 0.025], [0.09, -0.025], [-0.09, -0.025]];
    sweep(metal, [[0.05, 0.95, s * 0.52], [0.12, WING.y - 0.08 + 2.55 * WING.dihedral, s * 2.55]], strut, { color: livery.body, up: [1, 0, 0] });
    sweep(metal, [[-0.3, 0.86, s * 0.48], [-0.3, 0.42, s * 0.92], [-0.3, 0.3, s * 1.06]], circle(0.035, 8), { color: PALETTE.metalGrey });
    rubber.transform(place(-0.3, 0.28, s * 1.15, 0, 0, Math.PI / 2));
    rubber.lathe([[0.08, -0.07], [0.22, -0.075], [0.28, -0.04], [0.28, 0.04], [0.22, 0.075], [0.08, 0.07]], 20, true, PALETTE.rubber);
    rubber.transform(null);
    paint.transform(place(-0.28, 0.36, s * 1.15));
    paint.blob(0, 0, 0, 0.58, 0.26, 0.13, 10, 0, livery.body);
    paint.transform(null);
  }
  sweep(metal, [[1.55, 0.95, 0], [1.6, 0.5, 0], [1.55, 0.24, 0]], circle(0.04, 8), { color: PALETTE.metalGrey });
  rubber.transform(place(1.55, 0.22, 0, 0, 0, Math.PI / 2));
  rubber.lathe([[0.06, -0.06], [0.17, -0.065], [0.22, -0.035], [0.22, 0.035], [0.17, 0.065], [0.06, 0.06]], 18, true, PALETTE.rubber);
  rubber.transform(null);
  paint.transform(place(1.57, 0.29, 0));
  paint.blob(0, 0, 0, 0.45, 0.21, 0.11, 10, 0, livery.body);
  paint.transform(null);

  const stab: V2[] = [[-4.85, -1.7], [-5.35, -1.7], [-5.35, 1.7], [-4.85, 1.7], [-4.55, 0.5], [-4.55, -0.5]];
  prism(paint, stab, 1.55, 1.62, { r: 0.03, seg: 1, color: livery.body });
  const fin: V2[] = [[-4.35, 1.66], [-5.42, 1.66], [-5.55, 2.98], [-5.08, 2.98]];
  prism(paint, fin, -0.05, 0.05, { r: 0.025, seg: 2, color: livery.stripe, at: place(0, 0, 0, 0, -Math.PI / 2) });
  sweep(metal, [[-1.0, 1.95, 0], [-1.0, 2.25, 0]], circle(0.012, 6), { color: PALETTE.metalDark });
  bevelBox(satin, 0.08, 0.06, 0.25, 0.02, { color: PALETTE.metalDark, seg: 1, at: place(1.6, 0.86, 0.3) });

  const nav = kit.glow('plane-nav', [1, 1, 1], 0.6, 2.4), beacon = kit.glow('plane-beacon', [1, 0.2, 0.15], 0.5, 3);
  const nb = B.get(nav);
  for (const [z, c] of [[WING.half + 0.02, PALETTE.navGreen], [-WING.half - 0.02, PALETTE.navRed]] as const) {
    nb.transform(place(WING.le - 0.2, WING.y + WING.half * WING.dihedral, z));
    nb.blob(0, 0, 0, 0.07, 0.05, 0.05, 4, 0, c);
    nb.transform(null);
  }
  nb.transform(place(-5.72, 1.62, 0)); nb.blob(0, 0, 0, 0.05, 0.05, 0.05, 6, 0, [1, 1, 1]); nb.transform(null);
  const bb = B.get(beacon);
  bb.transform(place(-5.3, 3.02, 0)); bb.blob(0, 0, 0, 0.07, 0.05, 0.05, 7, 0, PALETTE.navRed); bb.transform(null);

  let triangles = B.triangles;
  const root = B.build(device, 'skylark');

  const E = new Batch(kit);
  bevelBox(E.get('paint'), 0.44, 0.05, 3.36, 0.02, { color: livery.body, at: place(-0.22, 0, 0) });
  triangles += E.triangles;
  const elevator = E.build(device, 'elevator');
  elevator.setLocalPosition(-5.36, 1.585, 0);

  const Rd = new Batch(kit);
  prism(Rd.get('paint'), [[0, 0], [-0.42, 0.05], [-0.4, 1.28], [0, 1.3]], -0.04, 0.04, { r: 0.02, seg: 1, color: livery.stripe, at: place(0, 0, 0, 0, -Math.PI / 2) });
  triangles += Rd.triangles;
  const rudder = Rd.build(device, 'rudder');
  rudder.setLocalPosition(-5.44, 1.68, 0);

  const P = new Batch(kit), pm = P.get('paint'), pmetal = P.get('metal');
  pm.transform(place(0, 0, 0, 0, 0, -Math.PI / 2));
  pm.lathe([[0.16, 0], [0.16, 0.06], [0.13, 0.2], [0.07, 0.3], [0, 0.34]], 18, true, livery.stripe);
  pm.transform(null);
  for (const s of [-1, 1]) {
    const blade = place(0.02, s * 0.45, 0, s * 0.25);
    bevelBox(pmetal, 0.04, 0.82, 0.13, 0.02, { color: PALETTE.metalDark, seg: 2, at: blade });
    bevelBox(pmetal, 0.042, 0.1, 0.132, 0.02, { color: PALETTE.padYellow, seg: 2, at: new pc.Mat4().mul2(blade, place(0, s * 0.38, 0)) });
  }
  triangles += P.triangles;
  const prop = P.build(device, 'propeller');
  prop.setLocalPosition(2.4, 1.27, 0);

  const holder = new pc.Entity('plane');
  for (const e of [root, elevator, rudder, prop]) holder.addChild(e);
  return { root: holder, prop, elevator, rudder, lights: { nav, beacon }, triangles };
}
