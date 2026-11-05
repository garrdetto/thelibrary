/**
 * The five-seat turbine utility helicopter (an original design) for look
 * development: one smooth lofted skin from nose to tail cone whose quads take
 * paint, livery stripe, belly or tinted glass colors (window and stripe edges
 * follow the grid, so they stay crisp), an engine fairing, skids on curved
 * cross tubes, a four-blade main rotor and a two-blade tail rotor as separate
 * entities so they can spin, a swept fin, a stabilizer with end plates, and
 * nav, beacon and strobe lights.
 *
 * Frame: nose toward +X, up +Y, right side +Z; skids rest on y = 0.
 */
import * as pc from 'playcanvas';
import type { RGB } from '../../../foxplains2/src/core/Geo';
import { bevelBox, circle, gridSurface, place, prism, sweep, type V2, type V3 } from '../core/Shapes';
import { Batch } from '../core/Batch';
import type { Kit } from '../style/Kit';
import { PALETTE } from '../../config';

export interface HeliLivery { body: RGB; stripe: RGB; belly: RGB; glass: RGB }
export const DEFAULT_LIVERY: HeliLivery = { body: PALETTE.heliWhite, stripe: PALETTE.heliRed, belly: PALETTE.heliNavy, glass: PALETTE.glassCanopy };

interface Station { x: number; cy: number; hw: number; hh: number; n: number }
const STATIONS: Station[] = [
  { x: 2.72, cy: 1.36, hw: 0.04, hh: 0.04, n: 2 },
  { x: 2.6, cy: 1.36, hw: 0.36, hh: 0.36, n: 2.1 },
  { x: 2.3, cy: 1.42, hw: 0.6, hh: 0.62, n: 2.3 },
  { x: 1.7, cy: 1.56, hw: 0.78, hh: 0.84, n: 2.7 },
  { x: 0.8, cy: 1.66, hw: 0.84, hh: 0.94, n: 3.0 },
  { x: -0.6, cy: 1.7, hw: 0.84, hh: 0.95, n: 3.1 },
  { x: -1.5, cy: 1.76, hw: 0.78, hh: 0.86, n: 2.9 },
  { x: -2.2, cy: 1.9, hw: 0.56, hh: 0.62, n: 2.5 },
  { x: -2.9, cy: 2.04, hw: 0.32, hh: 0.34, n: 2.1 },
  { x: -4.6, cy: 2.14, hw: 0.2, hh: 0.22, n: 2 },
  { x: -7.2, cy: 2.3, hw: 0.12, hh: 0.14, n: 2 },
  { x: -7.62, cy: 2.32, hw: 0.03, hh: 0.03, n: 2 },
];

function station(x: number): Station {
  const s = STATIONS;
  if (x >= s[0].x) return s[0];
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1];
    if (x <= a.x && x >= b.x) {
      const t = (a.x - x) / (a.x - b.x), u = t * t * (3 - 2 * t);
      const l = (p: number, q: number) => p + (q - p) * u;
      return { x, cy: l(a.cy, b.cy), hw: l(a.hw, b.hw), hh: l(a.hh, b.hh), n: l(a.n, b.n) };
    }
  }
  return s[s.length - 1];
}

const sgnPow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);

export interface HelicopterModel { root: pc.Entity; rotor: pc.Entity; tailRotor: pc.Entity; lights: { nav: pc.Material; beacon: pc.Material }; triangles: number }

export function buildHelicopter(device: pc.GraphicsDevice, kit: Kit, livery: HeliLivery = DEFAULT_LIVERY): HelicopterModel {
  const B = new Batch(kit), paint = B.get('paint'), metal = B.get('metal'), satin = B.get('satin');
  const ROWS = 84, COLS = 56, x0 = STATIONS[0].x, x1 = STATIONS[STATIONS.length - 1].x;
  const grid: V3[][] = [], meta: { x: number; s: number[]; c: number[] }[] = [];
  for (let i = 0; i <= ROWS; i++) {
    const x = x1 + ((x0 - x1) * i) / ROWS, st = station(x), row: V3[] = [], sn: number[] = [], cs: number[] = [];
    for (let j = 0; j < COLS; j++) {
      const a = (j / COLS) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), e = 2 / st.n;
      const hh = sa < 0 ? st.hh * 0.86 : st.hh;
      row.push([x, st.cy + hh * sgnPow(sa, e), st.hw * sgnPow(ca, e)]);
      sn.push(sa); cs.push(ca);
    }
    grid.push(row); meta.push({ x, s: sn, c: cs });
  }
  const colorAt = (i: number, j: number): RGB => {
    const x = (meta[i].x + meta[i + 1].x) / 2, sa = meta[i].s[(j + 0.5) | 0], ca = Math.abs(meta[i].c[(j + 0.5) | 0]);
    const windshield = x > 1.25 && x < 2.42 && sa > -0.1;
    const roofFrame = x > 1.25 && x < 2.42 && ca < 0.08 && sa > 0.6;
    const side = x > -1.05 && x < 1.05 && sa > 0.02 && sa < 0.8 && ca > 0.3;
    const post = Math.abs(x - 0.0) < 0.07;
    const chin = x > 1.9 && x < 2.45 && sa < -0.1 && sa > -0.55 && ca > 0.25;
    if ((windshield && !roofFrame) || (side && !post) || chin) return livery.glass;
    if (sa < -0.8 && x > -2.6) return livery.belly;
    if (sa > -0.42 && sa < -0.18 && x < 2.3 && x > -6.9) return livery.stripe;
    if (x < -6.9) return livery.stripe;
    return livery.body;
  };
  gridSurface(paint, grid, { color: colorAt });

  bevelBox(paint, 2.2, 0.52, 1.05, 0.24, { color: livery.body, at: place(-0.85, 2.7, 0) });
  bevelBox(paint, 1.1, 0.34, 0.8, 0.16, { color: livery.body, at: place(-1.95, 2.58, 0, 0, 0, -0.18) });
  for (const s of [-1, 1]) {
    bevelBox(satin, 0.5, 0.2, 0.06, 0.03, { color: PALETTE.metalDark, at: place(-0.7, 2.72, s * 0.52) });
    sweep(metal, [[-1.7, 2.62, s * 0.3], [-2.15, 2.6, s * 0.42]], circle(0.11, 12), { color: PALETTE.metalDark, caps: true });
    bevelBox(paint, 0.05, 0.05, 0.03, 0.012, { color: PALETTE.metalDark, seg: 1, at: place(0.62, 1.7, s * 0.9) });
  }

  const skid = PALETTE.metalGrey;
  for (const s of [-1, 1]) {
    const z = s * 1.08, path: V3[] = [[-1.75, 0.07, z], [1.45, 0.07, z]];
    for (let k = 1; k <= 6; k++) { const a = (k / 6) * Math.PI * 0.5; path.push([1.45 + Math.sin(a) * 0.32, 0.07 + (1 - Math.cos(a)) * 0.32, z]); }
    sweep(metal, path, circle(0.05, 10), { color: skid, caps: true });
    bevelBox(satin, 0.42, 0.04, 0.18, 0.015, { color: PALETTE.metalDark, seg: 1, at: place(0.55, 0.13, z - s * 0.02) });
  }
  for (const x of [-1.05, 0.95]) {
    const arch: V3[] = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16, z = -1.08 + 2.16 * t;
      arch.push([x, 0.07 + 0.84 * Math.pow(Math.sin(t * Math.PI), 0.45), z]);
    }
    sweep(metal, arch, circle(0.055, 10), { color: skid, up: [1, 0, 0] });
  }

  const fin: V2[] = [[-6.85, 2.25], [-7.55, 2.25], [-7.92, 3.55], [-7.62, 3.62]];
  prism(paint, fin, -0.045, 0.045, { r: 0.03, seg: 2, color: livery.stripe, at: place(0, 0, 0, 0, -Math.PI / 2) });
  const ventral: V2[] = [[-7.0, 2.3], [-7.45, 2.3], [-7.6, 1.75], [-7.42, 1.72]];
  prism(paint, ventral, -0.04, 0.04, { r: 0.02, seg: 2, color: livery.stripe, at: place(0, 0, 0, 0, -Math.PI / 2) });
  bevelBox(paint, 0.55, 0.06, 2.0, 0.025, { color: livery.body, at: place(-6.45, 2.3, 0) });
  for (const s of [-1, 1]) {
    const plate: V2[] = [[-6.25, 2.05], [-6.7, 2.05], [-6.75, 2.6], [-6.4, 2.6]];
    prism(paint, plate, -0.025, 0.025, { r: 0.012, seg: 1, color: livery.stripe, at: place(0, 0, s * 1.0, 0, -Math.PI / 2) });
  }
  sweep(metal, [[-4.2, 1.92, 0], [-4.6, 1.72, 0]], circle(0.012, 6), { color: PALETTE.metalDark });

  const nav = kit.glow('heli-nav', [1, 1, 1], 0.6, 2.4);
  const navB = B.get(nav);
  for (const [z, c] of [[0.9, PALETTE.navGreen], [-0.9, PALETTE.navRed]] as const) {
    navB.transform(place(0.2, 1.08, z));
    navB.blob(0, 0, 0, 0.06, 0.05, 0.06, 4, 0, c);
    navB.transform(null);
  }
  navB.transform(place(-7.62, 2.4, 0));
  navB.blob(0, 0, 0, 0.05, 0.05, 0.05, 6, 0, [1, 1, 1]);
  navB.transform(null);
  const beacon = kit.glow('heli-beacon', [1, 0.2, 0.15], 0.5, 3);
  const bb = B.get(beacon);
  bb.transform(place(-7.75, 3.62, 0));
  bb.blob(0, 0, 0, 0.07, 0.06, 0.07, 7, 0, PALETTE.navRed);
  bb.transform(null);
  B.get('glass').transform(place(2.55, 1.06, 0));
  B.get('glass').blob(0, 0, 0, 0.09, 0.07, 0.12, 8, 0, [0.9, 0.95, 1]);
  B.get('glass').transform(null);

  let triangles = B.triangles;
  const root = B.build(device, 'helicopter');

  const R = new Batch(kit);
  const rm = R.get('paint'), rmetal = R.get('metal');
  rmetal.cylinder(0, 2.92, 0, 0.12, 0.1, 0.42, 14, true, PALETTE.metalDark);
  rmetal.cylinder(0, 3.3, 0, 0.26, 0.22, 0.12, 18, true, PALETTE.metalGrey);
  rmetal.blob(0, 3.47, 0, 0.12, 0.08, 0.12, 9, 0, PALETTE.metalGrey);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    const blade = new pc.Mat4().mul2(place(0, 3.37, 0, a), place(2.85, 0, 0, 0, 0, -0.02));
    bevelBox(rm, 5.1, 0.05, 0.3, 0.022, { color: PALETTE.metalDark, seg: 2, at: blade });
    bevelBox(rm, 0.45, 0.052, 0.302, 0.022, { color: PALETTE.heliWhite, seg: 2, at: new pc.Mat4().mul2(blade, place(2.35, 0, 0)) });
    bevelBox(rmetal, 0.55, 0.09, 0.2, 0.03, { color: PALETTE.metalGrey, at: new pc.Mat4().mul2(place(0, 3.37, 0, a), place(0.3, 0, 0)) });
  }
  triangles += R.triangles;
  const rotor = R.build(device, 'main-rotor');

  const T = new Batch(kit);
  const tm = T.get('paint'), tmetal = T.get('metal');
  tmetal.transform(place(0, 0, 0, 0, Math.PI / 2));
  tmetal.cylinder(0, -0.06, 0, 0.08, 0.06, 0.2, 12, true, PALETTE.metalGrey);
  tmetal.transform(null);
  for (const s of [-1, 1]) {
    bevelBox(tm, 0.12, 0.62, 0.025, 0.01, { color: PALETTE.metalDark, seg: 2, at: place(0, s * 0.36, 0.06) });
    bevelBox(tm, 0.122, 0.12, 0.027, 0.01, { color: PALETTE.heliRed, seg: 2, at: place(0, s * 0.62, 0.06) });
  }
  triangles += T.triangles;
  const tailRotor = T.build(device, 'tail-rotor');
  tailRotor.setLocalPosition(-7.72, 2.42, 0.16);

  const holder = new pc.Entity('heli');
  holder.addChild(root);
  holder.addChild(rotor);
  holder.addChild(tailRotor);
  return { root: holder, rotor, tailRotor, lights: { nav, beacon }, triangles };
}
