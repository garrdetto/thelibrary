/**
 * The AI traffic, original designs in the same clipart style as the Skylark:
 * a high-wing regional turboprop (25 m, two four-blade propellers on wing
 * nacelles, T-tail) and a low-wing business jet (16 m, swept wing, two engines
 * on the rear fuselage, T-tail), each with a lofted fuselage carrying its
 * window rows and cheat-line on the quads, airfoil-section wings, gear and
 * lights; plus the flying club's Skylark in its own colours.
 *
 * Frame: nose toward +X, up +Y, right wing +Z; the wheels rest on y = 0.
 */
import * as pc from 'playcanvas';
import type { MeshBuilder, RGB } from '../../../foxplains2/src/core/Geo';
import { bevelBox, circle, gridSurface, place, prism, sweep, type V2, type V3 } from '../core/Shapes';
import { Batch } from '../core/Batch';
import type { Kit } from '../style/Kit';
import { buildPlane } from './Plane';
import type { TrafficKind } from '../../shared/AirTraffic';
import { PALETTE } from '../../config';

export interface TrafficModel { root: pc.Entity; props: pc.Entity[]; landing: pc.Material }

const sgnPow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);
const naca = (x: number, t: number) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);

interface Station { x: number; cy: number; hw: number; hh: number; n: number }

function loft(b: MeshBuilder, stations: Station[], colorAt: (x: number, sa: number, ca: number) => RGB) {
  const ROWS = 96, COLS = 40, x0 = stations[0].x, x1 = stations[stations.length - 1].x;
  const at = (x: number): Station => {
    for (let i = 0; i < stations.length - 1; i++) {
      const a = stations[i], c = stations[i + 1];
      if (x <= a.x && x >= c.x) { const t = (a.x - x) / (a.x - c.x), u = t * t * (3 - 2 * t), l = (p: number, q: number) => p + (q - p) * u; return { x, cy: l(a.cy, c.cy), hw: l(a.hw, c.hw), hh: l(a.hh, c.hh), n: l(a.n, c.n) }; }
    }
    return x > x0 ? stations[0] : stations[stations.length - 1];
  };
  const grid: V3[][] = [], meta: { x: number; s: number[]; c: number[] }[] = [];
  for (let i = 0; i <= ROWS; i++) {
    const x = x1 + ((x0 - x1) * i) / ROWS, st = at(x), row: V3[] = [], sn: number[] = [], cs: number[] = [];
    for (let j = 0; j < COLS; j++) {
      const a = (j / COLS) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), e = 2 / st.n;
      row.push([x, st.cy + st.hh * sgnPow(sa, e), st.hw * sgnPow(ca, e)]);
      sn.push(sa); cs.push(ca);
    }
    grid.push(row); meta.push({ x, s: sn, c: cs });
  }
  gridSurface(b, grid, { color: (i, j) => colorAt((meta[i].x + meta[i + 1].x) / 2, meta[i].s[(j + 0.5) | 0], Math.abs(meta[i].c[(j + 0.5) | 0])) });
}

interface WingOpts { y: number; le: number; root: number; tip: number; half: number; sweep: number; dihedral: number; thickness: number; z0?: number; color: (az: number, upper: boolean) => RGB }

/** A tapered, swept wing (or tailplane) of airfoil section, mirrored left and right, with closed tips. */
function wing(b: MeshBuilder, o: WingOpts) {
  const SPAN = 36, AIR = 24, z0 = o.z0 ?? 0;
  for (const side of [-1, 1]) {
    const grid: V3[][] = [];
    for (let i = 0; i <= SPAN; i++) {
      const f = i / SPAN, az = z0 + (o.half - z0) * f, z = side * az, chord = o.root + (o.tip - o.root) * f;
      const le = o.le - (az - z0) * Math.tan(o.sweep), y0 = o.y + (az - z0) * o.dihedral, round = f > 0.97 ? Math.sqrt(Math.max(0.1, 1 - ((f - 0.97) / 0.031) ** 2)) : 1;
      const row: V3[] = [];
      for (let j = 0; j < AIR; j++) {
        const t = (j / AIR) * Math.PI * 2, xc = (1 + Math.cos(t)) / 2, up = Math.sin(t) >= 0, yt = naca(Math.max(1e-4, xc), o.thickness) * chord * round;
        row.push([le - xc * chord, y0 + (up ? yt * 1.1 : -yt * 0.85), z]);
      }
      grid.push(side > 0 ? row : row);
    }
    if (side < 0) grid.reverse();
    gridSurface(b, grid, { color: (i, j) => o.color(z0 + (o.half - z0) * ((side < 0 ? SPAN - i - 0.5 : i + 0.5) / SPAN), Math.sin(((j + 0.5) / AIR) * Math.PI * 2) > 0) });
    const ring = side > 0 ? grid[SPAN] : grid[0], cx = ring.reduce((s, p) => s + p[0], 0) / AIR, cy = ring.reduce((s, p) => s + p[1], 0) / AIR;
    const c = b.vertex(cx, cy, ring[0][2], 0, 0, side, 0, 0, o.color(o.half, true));
    const vs = ring.map(p => b.vertex(p[0], p[1], p[2], 0, 0, side, 0, 0, o.color(o.half, true)));
    for (let k = 0; k < AIR; k++) if (side > 0) b.tri(c, vs[(k + 1) % AIR], vs[k]); else b.tri(c, vs[k], vs[(k + 1) % AIR]);
  }
}

function wheel(rubber: MeshBuilder, metal: MeshBuilder, x: number, y: number, z: number, r: number) {
  rubber.transform(place(x, y, z, 0, 0, Math.PI / 2));
  rubber.lathe([[r * 0.35, -r * 0.3], [r * 0.8, -r * 0.32], [r, -r * 0.15], [r, r * 0.15], [r * 0.8, r * 0.32], [r * 0.35, r * 0.3]], 18, true, PALETTE.rubber);
  rubber.transform(null);
  bevelBox(metal, r * 0.9, r * 0.9, r * 0.66, r * 0.2, { color: PALETTE.metalGrey, seg: 1, at: place(x, y, z) });
}

function lights(B: Batch, kit: Kit, tips: [V3, V3], tail: V3, beacon: V3) {
  const nav = kit.glow('traffic-nav', [1, 1, 1], 0.6, 2.4), bc = kit.glow('traffic-beacon', [1, 0.2, 0.15], 0.5, 3);
  const nb = B.get(nav);
  for (const [p, c] of [[tips[0], PALETTE.navRed], [tips[1], PALETTE.navGreen], [tail, [1, 1, 1] as RGB]] as const) { nb.transform(place(p[0], p[1], p[2])); nb.blob(0, 0, 0, 0.12, 0.08, 0.08, 4, 0, c); nb.transform(null); }
  const bb = B.get(bc);
  bb.transform(place(beacon[0], beacon[1], beacon[2])); bb.blob(0, 0, 0, 0.12, 0.08, 0.12, 6, 0, PALETTE.navRed); bb.transform(null);
}

function propeller(device: pc.GraphicsDevice, kit: Kit, blades: number, r: number, hub: RGB) {
  const P = new Batch(kit), m = P.get('metal'), p = P.get('paint');
  p.transform(place(0, 0, 0, 0, 0, -Math.PI / 2));
  p.lathe([[0.32, 0], [0.3, 0.2], [0.18, 0.55], [0, 0.72]], 18, true, hub);
  p.transform(null);
  for (let k = 0; k < blades; k++) {
    const a = (k / blades) * Math.PI * 2, blade = new pc.Mat4().mul2(place(0.05, 0, 0, 0, a), place(0, r / 2 + 0.2, 0, 0.3));
    bevelBox(m, 0.06, r, 0.26, 0.03, { color: PALETTE.metalDark, seg: 2, at: blade });
    bevelBox(m, 0.062, 0.18, 0.262, 0.03, { color: PALETTE.padYellow, seg: 2, at: new pc.Mat4().mul2(blade, place(0, r / 2 - 0.1, 0)) });
  }
  return P.build(device, 'propeller');
}

function turboprop(device: pc.GraphicsDevice, kit: Kit, landing: pc.Material): TrafficModel {
  const B = new Batch(kit), paint = B.get('paint'), metal = B.get('metal'), rubber = B.get('matte');
  const body: RGB = [0.96, 0.96, 0.95], stripe: RGB = [0.05, 0.47, 0.55], tailCol: RGB = [0.07, 0.3, 0.45], glass = PALETTE.glassCanopy;
  const ST: Station[] = [
    { x: 12.6, cy: 2.45, hw: 0.08, hh: 0.08, n: 2 }, { x: 12.2, cy: 2.45, hw: 0.75, hh: 0.7, n: 2 }, { x: 11.2, cy: 2.6, hw: 1.2, hh: 1.2, n: 2.1 },
    { x: 9.6, cy: 2.65, hw: 1.38, hh: 1.38, n: 2.15 }, { x: -6.5, cy: 2.65, hw: 1.38, hh: 1.38, n: 2.15 }, { x: -10, cy: 3.2, hw: 0.9, hh: 0.9, n: 2.1 },
    { x: -12.4, cy: 3.8, hw: 0.25, hh: 0.3, n: 2 }, { x: -12.6, cy: 3.85, hw: 0.04, hh: 0.04, n: 2 },
  ];
  loft(paint, ST, (x, sa, ca) => {
    if (x > 10.6 && x < 11.9 && sa > 0.15 && sa < 0.75) return glass;
    const pitch = 0.95, ph = ((x + 20) % pitch) / pitch;
    if (x > -6 && x < 8.8 && sa > 0.22 && sa < 0.48 && ca > 0.6 && ph > 0.25 && ph < 0.72) return glass;
    if (sa > -0.05 && sa < 0.12 && x < 11 && x > -11) return stripe;
    if (x < -7.5 && sa > 0.2) return tailCol;
    return body;
  });
  wing(paint, { y: 4.05, le: 2.0, root: 2.7, tip: 1.6, half: 13.5, sweep: 0.02, dihedral: 0.035, thickness: 0.15, z0: 1.1, color: az => (az > 12.6 ? tailCol : body) });
  for (const s of [-1, 1]) {
    paint.transform(place(1.2, 3.65, s * 4.3, 0, 0, -Math.PI / 2));
    paint.lathe([[0.05, -2.2], [0.55, -1.9], [0.72, -0.8], [0.72, 2.0], [0.5, 3.6], [0.2, 4.2]], 20, true, body);
    paint.transform(null);
    sweep(metal, [[0.4, 3.0, s * 4.3], [0.4, 0.6, s * 4.3]], circle(0.12, 10), { color: PALETTE.metalGrey });
    wheel(rubber, metal, 0.4, 0.45, s * 4.05, 0.45); wheel(rubber, metal, 0.4, 0.45, s * 4.55, 0.45);
  }
  sweep(metal, [[10.4, 1.4, 0], [10.4, 0.35, 0]], circle(0.09, 10), { color: PALETTE.metalGrey });
  wheel(rubber, metal, 10.4, 0.33, -0.22, 0.33); wheel(rubber, metal, 10.4, 0.33, 0.22, 0.33);
  const fin: V2[] = [[-8.3, 3.9], [-12.2, 3.9], [-13.2, 8.4], [-11.4, 8.4]];
  prism(paint, fin, -0.16, 0.16, { r: 0.08, seg: 2, color: tailCol, at: place(0, 0, 0, 0, -Math.PI / 2) });
  wing(paint, { y: 8.3, le: -11.1, root: 1.9, tip: 1.1, half: 4.2, sweep: 0.2, dihedral: 0, thickness: 0.1, color: () => tailCol });
  lights(B, kit, [[1.3, 4.5, -13.5], [1.3, 4.5, 13.5]], [-12.7, 3.85, 0], [-12.3, 8.55, 0]);
  B.get(landing).transform(place(12.3, 1.3, 0)); B.get(landing).blob(0, 0, 0, 0.14, 0.1, 0.14, 6, 0, [1, 1, 0.92]); B.get(landing).transform(null);
  const root = new pc.Entity('turboprop');
  root.addChild(B.build(device, 'turboprop-body'));
  const props = [-1, 1].map(s => { const p = propeller(device, kit, 4, 1.85, stripe); p.setLocalPosition(5.45, 3.65, s * 4.3); root.addChild(p); return p; });
  return { root, props, landing };
}

function jet(device: pc.GraphicsDevice, kit: Kit, landing: pc.Material): TrafficModel {
  const B = new Batch(kit), paint = B.get('paint'), metal = B.get('metal'), rubber = B.get('matte');
  const body: RGB = [0.97, 0.97, 0.96], stripe: RGB = [0.62, 0.12, 0.16], dark: RGB = [0.16, 0.18, 0.24], glass = PALETTE.glassCanopy;
  const ST: Station[] = [
    { x: 7.9, cy: 1.75, hw: 0.05, hh: 0.05, n: 2 }, { x: 7.5, cy: 1.8, hw: 0.42, hh: 0.4, n: 2 }, { x: 6.2, cy: 1.95, hw: 0.86, hh: 0.88, n: 2.05 },
    { x: 4.8, cy: 2.0, hw: 0.98, hh: 1.0, n: 2.1 }, { x: -3.2, cy: 2.0, hw: 0.98, hh: 1.0, n: 2.1 }, { x: -6.2, cy: 2.35, hw: 0.55, hh: 0.6, n: 2.05 },
    { x: -7.9, cy: 2.65, hw: 0.18, hh: 0.2, n: 2 }, { x: -8.05, cy: 2.66, hw: 0.03, hh: 0.03, n: 2 },
  ];
  loft(paint, ST, (x, sa, ca) => {
    if (x > 5.5 && x < 6.6 && sa > 0.2 && sa < 0.85) return glass;
    const ph = ((x + 20) % 1.05) / 1.05;
    if (x > -2.6 && x < 4.2 && sa > 0.12 && sa < 0.42 && ca > 0.6 && ph > 0.3 && ph < 0.7) return glass;
    if (sa > -0.22 && sa < -0.08 && x < 7 && x > -7) return stripe;
    if (sa < -0.75) return dark;
    return body;
  });
  wing(paint, { y: 1.15, le: 1.6, root: 3.0, tip: 1.05, half: 7.75, sweep: 0.42, dihedral: 0.05, thickness: 0.12, z0: 0.75, color: az => (az > 7.2 ? stripe : body) });
  for (const s of [-1, 1]) {
    paint.transform(place(-4.8, 2.45, s * 1.6, 0, 0, -Math.PI / 2));
    paint.lathe([[0.42, -1.3], [0.56, -1.15], [0.6, -0.4], [0.58, 0.9], [0.42, 1.4]], 20, true, body);
    paint.transform(null);
    bevelBox(paint, 1.2, 0.18, 0.7, 0.06, { color: body, at: place(-4.8, 2.35, s * 1.0) });
    sweep(metal, [[0.6, 1.1, s * 1.9], [0.6, 0.35, s * 1.9]], circle(0.08, 10), { color: PALETTE.metalGrey });
    wheel(rubber, metal, 0.6, 0.33, s * 1.9, 0.33);
  }
  sweep(metal, [[5.9, 1.1, 0], [5.9, 0.28, 0]], circle(0.06, 10), { color: PALETTE.metalGrey });
  wheel(rubber, metal, 5.9, 0.25, 0, 0.25);
  const fin: V2[] = [[-5.2, 2.7], [-7.9, 2.7], [-9.3, 5.1], [-8.1, 5.1]];
  prism(paint, fin, -0.12, 0.12, { r: 0.06, seg: 2, color: stripe, at: place(0, 0, 0, 0, -Math.PI / 2) });
  wing(paint, { y: 5.05, le: -7.8, root: 1.45, tip: 0.8, half: 3.0, sweep: 0.5, dihedral: 0, thickness: 0.09, color: () => stripe });
  lights(B, kit, [[-1.2, 1.55, -7.75], [-1.2, 1.55, 7.75]], [-8.1, 2.66, 0], [-9.2, 5.2, 0]);
  B.get(landing).transform(place(5.9, 0.95, 0)); B.get(landing).blob(0, 0, 0, 0.12, 0.08, 0.12, 6, 0, [1, 1, 0.92]); B.get(landing).transform(null);
  const root = new pc.Entity('jet');
  root.addChild(B.build(device, 'jet-body'));
  return { root, props: [], landing };
}

export function buildTraffic(device: pc.GraphicsDevice, kit: Kit, kind: TrafficKind): TrafficModel {
  const landing = kit.glow(`landing-${kind}`, [1, 0.97, 0.88], 0.1, 3);
  if (kind === 'turboprop') return turboprop(device, kit, landing);
  if (kind === 'jet') return jet(device, kit, landing);
  const m = buildPlane(device, kit, { body: [0.97, 0.95, 0.9], stripe: [0.78, 0.14, 0.12], accent: [0.2, 0.2, 0.22], glass: PALETTE.glassCanopy });
  return { root: m.root, props: [m.prop], landing };
}
