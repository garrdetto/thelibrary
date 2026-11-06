/**
 * The road network, derived from the plan in `Layout.ts`: every street's
 * centre line, its graded elevation profile, the junctions with their curb
 * returns, the lots along each street, and the curb cuts for driveways and
 * crosswalk ramps.
 *
 * Every hard surface is defined by one cross-section measured from the curb
 * line (`crossHeight`): the carriageway at the road elevation, a 15 cm curb,
 * a grass verge at curb height and a sidewalk with a 2 % crossfall. Edges are
 * trimmed where their junction's curb returns begin, and the junction surface
 * is built from the same curb-line paths, so roads, junctions, curbs,
 * sidewalks and aprons share their seams exactly and never overlap.
 */
import { LAYOUT, type EdgeDef } from './Layout';
import { smoothBase } from './Base';
import { rng } from './Noise';

export type V2 = [number, number];
export type RoadClassId = 'residential' | 'collector';
export interface Widths { half: number; verge: number; walk: number }
export interface RoadClass extends Widths { radius: number; centre: 'dash' | 'double'; edgeLines: boolean }

export const ROAD_CLASSES: Record<RoadClassId, RoadClass> = {
  residential: { half: 4, verge: 2, walk: 1.8, radius: 6, centre: 'dash', edgeLines: false },
  collector: { half: 5.5, verge: 2.4, walk: 2, radius: 9, centre: 'double', edgeLines: true },
};

export const CURB = { width: 0.15, height: 0.15, cut: 0.02 };
export const CROSSFALL = 0.02;
export const BELOW = 0.25;
export const FLAT_ZONE = 8;
export const MAX_GRADE = 0.06;
export const DRIVE = { width: 5.4, flare: 0.9, setback: 14, garageX: 8.75 };
export const RAMP = { width: 1.8, flare: 0.6, inset: 1.2 };
const STEP = 2, PROF = 4;

export const vergeEnd = (w: Widths) => CURB.width + w.verge;
export const walkEnd = (w: Widths) => vergeEnd(w) + w.walk;
export const rowHalf = (w: Widths) => w.half + walkEnd(w);
export const walkTop = (w: Widths) => CURB.height + CROSSFALL * w.walk;

/** Height above the road surface `delta` metres beyond the curb line; `cut` (0–1) drops the curb and turns the verge into an apron. */
export function crossHeight(w: Widths, delta: number, cut = 0) {
  if (delta <= 0) return 0;
  const curbTop = CURB.height + (CURB.cut - CURB.height) * cut;
  if (delta <= CURB.width) return curbTop;
  const ve = vergeEnd(w);
  if (delta <= ve) return curbTop + (CURB.height - curbTop) * ((delta - CURB.width) / w.verge);
  return CURB.height + CROSSFALL * Math.min(delta - ve, w.walk);
}

export interface Cut { side: 1 | -1; s: number; width: number; flare: number; kind: 'drive' | 'ramp'; lot?: number }
export interface EdgeEnd { edge: number; end: 0 | 1 }
export interface Edge {
  id: number; name: string; clsId: RoadClassId; cls: RoadClass; nodes: [number, number];
  pts: V2[]; S: number[]; tan: V2[]; len: number;
  trim: [number, number]; lotStart: [[number, number], [number, number]];
  prof: number[]; cuts: Cut[]; crossings: number[];
}
export interface CornerPt { x: number; z: number; nx: number; nz: number; w: Widths }
export interface Corner { from: EdgeEnd; to: EdgeEnd; kind: 'fillet' | 'arc'; tFrom: number; tTo: number; path: CornerPt[] }
export interface Junction { node: number; x: number; z: number; elev: number; ends: EdgeEnd[]; corners: Corner[]; surface: V2[]; outline: V2[]; box?: [number, number, number, number] }
export interface Lot { id: number; edge: number; side: 1 | -1; s0: number; s1: number; depth: number; poly: V2[]; drive: number; dir: number; pad: number; yaw: number; origin: V2; house: number; box?: [number, number, number, number] }
export interface RoadQuery { inside: boolean; dist: number; elev: number; top: number }

const rot = (v: V2): V2 => [-v[1], v[0]];
const norm = (x: number, z: number): V2 => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

function roundedPolyline(pts: V2[], radius: number): V2[] {
  const out: V2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], v = pts[i], n = pts[i + 1];
    const d1 = norm(v[0] - p[0], v[1] - p[1]), d2 = norm(n[0] - v[0], n[1] - v[1]);
    const turn = Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]);
    const L = radius * Math.tan(Math.abs(turn) / 2);
    const a: V2 = [v[0] - d1[0] * L, v[1] - d1[1] * L];
    const side = Math.sign(turn), nrm = rot(d1);
    const c: V2 = [a[0] + nrm[0] * radius * side, a[1] + nrm[1] * radius * side];
    const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
    const steps = Math.max(2, Math.ceil((Math.abs(turn) * radius) / 1));
    for (let k = 0; k <= steps; k++) { const t = a0 + (turn * k) / steps; out.push([c[0] + Math.cos(t) * radius, c[1] + Math.sin(t) * radius]); }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function resample(raw: V2[]): { pts: V2[]; S: number[] } {
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const len = cum[cum.length - 1], n = Math.max(1, Math.round(len / STEP));
  const pts: V2[] = [], S: number[] = [];
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const s = (len * i) / n;
    while (k < raw.length - 2 && cum[k + 1] < s) k++;
    const t = (s - cum[k]) / (cum[k + 1] - cum[k] || 1);
    pts.push([raw[k][0] + (raw[k + 1][0] - raw[k][0]) * t, raw[k][1] + (raw[k + 1][1] - raw[k][1]) * t]);
    S.push(s);
  }
  return { pts, S };
}

export class RoadNet {
  readonly nodes: V2[] = [];
  readonly degree: number[] = [];
  readonly edges: Edge[] = [];
  readonly junctions = new Map<number, Junction>();
  readonly lots: Lot[] = [];
  readonly nodeElev: number[] = [];
  private segGrid = new Map<number, number[]>();
  private juncGrid = new Map<number, number[]>();
  private lotGrid = new Map<number, number[]>();
  static readonly CELL = 32;

  constructor(defs: readonly EdgeDef[] = LAYOUT) {
    const key = (p: V2) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
    const ids = new Map<string, number>();
    const node = (p: V2) => { const k = key(p); let id = ids.get(k); if (id === undefined) { id = this.nodes.length; ids.set(k, id); this.nodes.push(p); this.degree.push(0); } return id; };
    for (const d of defs) {
      const a = node(d.a), b = node(d.b);
      this.degree[a]++; this.degree[b]++;
      const raw = d.via ? roundedPolyline([d.a, ...d.via, d.b], d.bend ?? 60) : [d.a, d.b];
      const { pts, S } = resample(raw);
      const tan: V2[] = pts.map((_, i) => {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(pts.length - 1, i + 1)];
        return norm(p1[0] - p0[0], p1[1] - p0[1]);
      });
      this.edges.push({ id: this.edges.length, name: d.name, clsId: d.cls, cls: ROAD_CLASSES[d.cls], nodes: [a, b], pts, S, tan, len: S[S.length - 1], trim: [0, 0], lotStart: [[0, 0], [0, 0]], prof: [], cuts: [], crossings: [] });
    }
    for (let i = 0; i < this.nodes.length; i++) this.nodeElev.push(smoothBase(this.nodes[i][0], this.nodes[i][1]));
    this.buildJunctions();
    for (const e of this.edges) this.buildProfile(e);
    for (const j of this.junctions.values()) this.buildJunctionPaths(j);
    this.buildRamps();
    this.buildLots(defs);
    for (const e of this.edges) e.cuts.sort((a, b) => a.s - b.s);
    this.index();
  }

  pointAt(e: Edge, s: number) {
    const n = e.pts.length;
    s = Math.max(0, Math.min(e.len, s));
    let k = Math.min(n - 2, Math.floor((s / e.len) * (n - 1)));
    while (k > 0 && e.S[k] > s) k--;
    while (k < n - 2 && e.S[k + 1] < s) k++;
    const t = (s - e.S[k]) / (e.S[k + 1] - e.S[k] || 1);
    const p0 = e.pts[k], p1 = e.pts[k + 1], t0 = e.tan[k], t1 = e.tan[k + 1];
    const [tx, tz] = norm(t0[0] + (t1[0] - t0[0]) * t, t0[1] + (t1[1] - t0[1]) * t);
    return { x: p0[0] + (p1[0] - p0[0]) * t, z: p0[1] + (p1[1] - p0[1]) * t, tx, tz };
  }

  /** A point `lat` metres to the side (+1 left of the edge's direction) of the centre line at `s`. */
  offset(e: Edge, s: number, lat: number): V2 {
    const p = this.pointAt(e, s);
    return [p.x - p.tz * lat, p.z + p.tx * lat];
  }

  elevAt(e: Edge, s: number) {
    const f = (Math.max(0, Math.min(e.len, s)) / e.len) * (e.prof.length - 1), k = Math.min(e.prof.length - 2, Math.floor(f));
    return e.prof[k] + (e.prof[k + 1] - e.prof[k]) * (f - k);
  }

  /** Station along the edge measured from one end, as the edge's own `s`. */
  sAt(e: Edge, end: 0 | 1, t: number) { return end === 0 ? t : e.len - t; }

  private outward(ref: EdgeEnd): V2 {
    const e = this.edges[ref.edge];
    const t = ref.end === 0 ? e.tan[0] : e.tan[e.tan.length - 1];
    return ref.end === 0 ? [t[0], t[1]] : [-t[0], -t[1]];
  }

  /** Which side of the edge (in its own direction) lies to the left when looking out of the junction along this end. */
  outLeft(ref: EdgeEnd): 1 | -1 { return ref.end === 0 ? 1 : -1; }

  private buildJunctions() {
    const ends = new Map<number, EdgeEnd[]>();
    for (const e of this.edges) for (const end of [0, 1] as const) {
      const n = e.nodes[end];
      if (!ends.has(n)) ends.set(n, []);
      ends.get(n)!.push({ edge: e.id, end });
    }
    for (const [n, list] of ends) {
      if (list.length < 2) continue;
      const [nx, nz] = this.nodes[n];
      list.sort((a, b) => { const ua = this.outward(a), ub = this.outward(b); return Math.atan2(ua[1], ua[0]) - Math.atan2(ub[1], ub[0]); });
      const corners: Corner[] = [];
      for (let i = 0; i < list.length; i++) {
        const fi = list[i], tj = list[(i + 1) % list.length];
        const ui = this.outward(fi), uj = this.outward(tj);
        let phi = Math.atan2(uj[1], uj[0]) - Math.atan2(ui[1], ui[0]);
        while (phi <= 0) phi += Math.PI * 2;
        const ci = this.edges[fi.edge].cls, cj = this.edges[tj.edge].cls;
        if (phi < Math.PI - 0.05) {
          const R = Math.max(ci.radius, cj.radius), nL = rot(ui), nR: V2 = [uj[1], -uj[0]];
          const r: V2 = [nR[0] * (cj.half + R) - nL[0] * (ci.half + R), nR[1] * (cj.half + R) - nL[1] * (ci.half + R)];
          const det = -(ui[0] * uj[1] - uj[0] * ui[1]);
          const tF = (r[0] * -uj[1] - -uj[0] * r[1]) / det, tT = (ui[0] * r[1] - r[0] * ui[1]) / det;
          corners.push({ from: fi, to: tj, kind: 'fillet', tFrom: tF, tTo: tT, path: [] });
        } else corners.push({ from: fi, to: tj, kind: 'arc', tFrom: 0, tTo: 0, path: [] });
      }
      for (const c of corners) {
        const ef = this.edges[c.from.edge], et = this.edges[c.to.edge];
        ef.trim[c.from.end] = Math.max(ef.trim[c.from.end], c.tFrom);
        et.trim[c.to.end] = Math.max(et.trim[c.to.end], c.tTo);
        ef.lotStart[c.from.end][this.outLeft(c.from) > 0 ? 0 : 1] = c.tFrom;
        et.lotStart[c.to.end][this.outLeft(c.to) > 0 ? 1 : 0] = c.tTo;
      }
      this.junctions.set(n, { node: n, x: nx, z: nz, elev: this.nodeElev[n], ends: list, corners, surface: [], outline: [] });
    }
  }

  /** Where lots may start along `side` at an end, measured from that end (clear of the corner's curb return). */
  lotStartAt(e: Edge, end: 0 | 1, side: 1 | -1) { return e.lotStart[end][side > 0 ? 0 : 1]; }

  private buildProfile(e: Edge) {
    const n = Math.max(2, Math.ceil(e.len / PROF));
    const sAt = (k: number) => (e.len * k) / n;
    const prof: number[] = [], pin: boolean[] = [];
    const [ea, eb] = [this.nodeElev[e.nodes[0]], this.nodeElev[e.nodes[1]]];
    for (let k = 0; k <= n; k++) {
      const s = sAt(k), p = this.pointAt(e, s);
      if (s <= e.trim[0] + FLAT_ZONE) { prof.push(ea); pin.push(true); }
      else if (s >= e.len - e.trim[1] - FLAT_ZONE) { prof.push(eb); pin.push(true); }
      else { prof.push(smoothBase(p.x, p.z)); pin.push(false); }
    }
    for (let it = 0; it < 8; it++) {
      for (let k = 1; k <= n; k++) if (!pin[k]) { const g = MAX_GRADE * (sAt(k) - sAt(k - 1)); prof[k] = Math.max(prof[k - 1] - g, Math.min(prof[k - 1] + g, prof[k])); }
      for (let k = n - 1; k >= 0; k--) if (!pin[k]) { const g = MAX_GRADE * (sAt(k + 1) - sAt(k)); prof[k] = Math.max(prof[k + 1] - g, Math.min(prof[k + 1] + g, prof[k])); }
      for (let k = 1; k < n; k++) if (!pin[k]) prof[k] = prof[k] * 0.5 + (prof[k - 1] + prof[k + 1]) * 0.25;
    }
    e.prof = prof;
  }

  private buildJunctionPaths(j: Junction) {
    const curbPt = (ref: EdgeEnd, t: number, outLeft: boolean): CornerPt => {
      const e = this.edges[ref.edge], s = this.sAt(e, ref.end, t), side = (outLeft ? 1 : -1) * this.outLeft(ref);
      const p = this.pointAt(e, s), nx = -p.tz * side, nz = p.tx * side;
      return { x: p.x + nx * e.cls.half, z: p.z + nz * e.cls.half, nx, nz, w: e.cls };
    };
    for (const c of j.corners) {
      const ef = this.edges[c.from.edge], et = this.edges[c.to.edge];
      const path: CornerPt[] = [];
      const straight = (ref: EdgeEnd, a: number, b: number, outLeft: boolean) => {
        const steps = Math.ceil(Math.abs(b - a) - 1e-9);
        for (let k = 0; k <= steps; k++) path.push(curbPt(ref, steps ? a + ((b - a) * k) / steps : a, outLeft));
      };
      straight(c.from, ef.trim[c.from.end], c.tFrom, true);
      const A = path[path.length - 1], B = curbPt(c.to, c.tTo, false);
      const lerpW = (t: number): Widths => ({ half: 0, verge: ef.cls.verge + (et.cls.verge - ef.cls.verge) * t, walk: ef.cls.walk + (et.cls.walk - ef.cls.walk) * t });
      if (c.kind === 'fillet') {
        const R = Math.max(ef.cls.radius, et.cls.radius);
        const cx = A.x + A.nx * R, cz = A.z + A.nz * R;
        const a0 = Math.atan2(A.z - cz, A.x - cx);
        let a1 = Math.atan2(B.z - cz, B.x - cx);
        while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
        while (a0 - a1 > Math.PI) a1 += Math.PI * 2;
        const steps = Math.max(4, Math.ceil((Math.abs(a1 - a0) * R) / 0.6));
        for (let k = 1; k < steps; k++) {
          const a = a0 + ((a1 - a0) * k) / steps, x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R;
          path.push({ x, z, nx: (cx - x) / R, nz: (cz - z) / R, w: lerpW(k / steps) });
        }
      } else {
        const a0 = Math.atan2(A.z - j.z, A.x - j.x);
        let a1 = Math.atan2(B.z - j.z, B.x - j.x);
        while (a1 < a0) a1 += Math.PI * 2;
        if (a1 - a0 > Math.PI * 2 - 1e-6) a1 = a0;
        const steps = Math.ceil(((a1 - a0) * Math.max(ef.cls.half, et.cls.half)) / 0.6);
        for (let k = 1; k < steps; k++) {
          const t = k / steps, a = a0 + (a1 - a0) * t, r = ef.cls.half + (et.cls.half - ef.cls.half) * t;
          const nx = Math.cos(a), nz = Math.sin(a);
          path.push({ x: j.x + nx * r, z: j.z + nz * r, nx, nz, w: lerpW(t) });
        }
      }
      straight(c.to, c.tTo, et.trim[c.to.end], false);
      c.path = path.filter((p, i) => i === 0 || Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z) > 1e-4);
    }
    j.surface = j.corners.flatMap(c => c.path.map(p => [p.x, p.z] as V2));
    j.outline = j.corners.flatMap(c => c.path.map(p => { const d = walkEnd(p.w); return [p.x + p.nx * d, p.z + p.nz * d] as V2; }));
  }

  private buildLots(defs: readonly EdgeDef[]) {
    const r = rng(7331);
    defs.forEach((d, i) => {
      const e = this.edges[i];
      for (const run of d.lots ?? []) {
        const s0 = this.lotStartAt(e, 0, run.side), s1 = e.len - this.lotStartAt(e, 1, run.side);
        const n = Math.floor((s1 - s0) / run.minWidth);
        if (n < 1) continue;
        const w = (s1 - s0) / n, front = walkEnd(e.cls) + e.cls.half;
        for (let k = 0; k < n; k++) {
          const a = s0 + k * w, b = a + w, mid = (a + b) / 2;
          const steps = Math.max(1, Math.ceil(w / 4));
          const frontPts: V2[] = [], backPts: V2[] = [];
          for (let q = 0; q <= steps; q++) {
            const s = a + ((b - a) * q) / steps;
            frontPts.push(this.offset(e, s, run.side * front));
            backPts.push(this.offset(e, s, run.side * (front + run.depth)));
          }
          const poly = run.side > 0 ? [...frontPts, ...backPts.reverse()] : [...frontPts.reverse(), ...backPts];
          const p = this.pointAt(e, mid);
          const fx = p.tz * run.side, fz = -p.tx * run.side;
          const yaw = Math.atan2(fx, fz);
          const xDot = Math.cos(yaw) * p.tx - Math.sin(yaw) * p.tz;
          const dir = Math.sign(xDot), place = this.placeDrive(e, run.side, a, b, dir), drive = place.s, house = drive - DRIVE.garageX * dir;
          const origin = this.offset(e, house, run.side * (front + DRIVE.setback));
          const pad = this.elevAt(e, drive) + walkTop(e.cls);
          const id = this.lots.length;
          const built = r() < 0.55 && place.ok;
          this.lots.push({ id, edge: e.id, side: run.side, s0: a, s1: b, depth: run.depth, poly, drive, dir, pad, yaw, origin, house: built ? Math.floor(r() * 1e6) : -1 });
          if (built) e.cuts.push({ side: run.side, s: drive, width: DRIVE.width, flare: DRIVE.flare, kind: 'drive', lot: id });
        }
      }
    });
  }

  /** The driveway station for a lot from `a` to `b` whose garage lies toward `dir`: the house (from 5.5 m before to 12 m after its centre along `dir`) stays inside the lot, and the cut keeps clear of the crosswalk ramps. */
  private placeDrive(e: Edge, side: 1 | -1, a: number, b: number, dir: number) {
    const span = DRIVE.width / 2 + DRIVE.flare;
    const [hLo, hHi] = dir > 0 ? [a + 6, b - 12.5] : [a + 12.5, b - 6];
    const lo = Math.max(hLo + DRIVE.garageX * dir, e.trim[0] + span), hi = Math.min(hHi + DRIVE.garageX * dir, e.len - e.trim[1] - span);
    const pref = (a + b) / 2 + 5.5 * dir;
    let best = Math.max(lo, Math.min(hi, pref)), score = -Infinity;
    for (let s = lo; s <= hi + 1e-9; s += 0.25) {
      let clear = 6;
      for (const c of e.cuts) if (c.side === side) clear = Math.min(clear, Math.abs(s - c.s) - span - c.width / 2 - c.flare);
      const v = Math.min(clear, 3) * 10 - Math.abs(s - pref);
      if (v > score) { score = v; best = s; }
    }
    return { s: best, ok: this.clearance(e, side, best, span) >= 1.5 };
  }

  private clearance(e: Edge, side: 1 | -1, s: number, span: number) {
    let clear = Infinity;
    for (const c of e.cuts) if (c.side === side) clear = Math.min(clear, Math.abs(s - c.s) - span - c.width / 2 - c.flare);
    return clear;
  }

  private buildRamps() {
    for (const e of this.edges) for (const end of [0, 1] as const) {
      if (!this.junctions.has(e.nodes[end])) continue;
      const s = this.sAt(e, end, e.trim[end] + RAMP.inset + RAMP.width / 2);
      e.crossings.push(s);
      for (const side of [1, -1] as const) e.cuts.push({ side, s, width: RAMP.width, flare: RAMP.flare, kind: 'ramp' });
    }
  }

  /** How far a curb is cut at station `s` on `side` (0 = full curb, 1 = fully cut), with straight flares. */
  cutAt(e: Edge, side: 1 | -1, s: number) {
    let k = 0;
    for (const c of e.cuts) {
      if (c.side !== side) continue;
      const d = Math.abs(s - c.s) - c.width / 2;
      k = Math.max(k, d <= 0 ? 1 : d >= c.flare ? 0 : 1 - d / c.flare);
    }
    return k;
  }

  private index() {
    const C = RoadNet.CELL, key = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
    const put = <T>(map: Map<number, T[]>, k: number, v: T) => { let l = map.get(k); if (!l) map.set(k, (l = [])); l.push(v); };
    const box = (poly: V2[], m: number, fn: (k: number) => void) => {
      const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
      for (let x = Math.floor((Math.min(...xs) - m) / C); x <= Math.floor((Math.max(...xs) + m) / C); x++)
        for (let z = Math.floor((Math.min(...zs) - m) / C); z <= Math.floor((Math.max(...zs) + m) / C); z++) fn(key(x, z));
    };
    for (const e of this.edges) for (let i = 0; i < e.pts.length - 1; i++) {
      const [ax, az] = e.pts[i], [bx, bz] = e.pts[i + 1];
      const seen = new Set<number>();
      for (const [x, z] of [[ax, az], [bx, bz], [(ax + bx) / 2, (az + bz) / 2]]) { const k = key(Math.floor(x / C), Math.floor(z / C)); if (!seen.has(k)) { seen.add(k); put(this.segGrid, k, e.id * 65536 + i); } }
    }
    for (const j of this.junctions.values()) {
      j.box = bounds(j.outline);
      box(j.outline, 40, k => put(this.juncGrid, k, j.node));
    }
    for (const l of this.lots) {
      l.box = bounds(l.poly);
      box(l.poly, 4, k => put(this.lotGrid, k, l.id));
    }
  }

  private cellKey(x: number, z: number) { return (Math.floor(x / RoadNet.CELL) + 4096) * 8192 + (Math.floor(z / RoadNet.CELL) + 4096); }

  lotsNear(x: number, z: number): Lot[] {
    return (this.lotGrid.get(this.cellKey(x, z)) ?? []).map(i => this.lots[i]);
  }

  /** Nearest station on each edge within reach of (x, z): `lat` is signed (+ left of the edge's direction). */
  nearest(x: number, z: number, reach = 1) {
    const C = RoadNet.CELL;
    const found = new Map<number, { seg: number; t: number; d2: number }>();
    for (let i = -reach; i <= reach; i++) for (let k = -reach; k <= reach; k++) {
      for (const code of this.segGrid.get(this.cellKey(x + i * C, z + k * C)) ?? []) {
        const eid = code >>> 16, seg = code & 65535, e = this.edges[eid];
        const ax = e.pts[seg][0], az = e.pts[seg][1], dx = e.pts[seg + 1][0] - ax, dz = e.pts[seg + 1][1] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        const ex = x - ax - dx * t, ez = z - az - dz * t, d2 = ex * ex + ez * ez;
        const prev = found.get(eid);
        if (!prev || d2 < prev.d2) found.set(eid, { seg, t, d2 });
      }
    }
    const best = new Map<number, { s: number; lat: number; d: number }>();
    for (const [eid, f] of found) {
      const e = this.edges[eid], s = e.S[f.seg] + (e.S[f.seg + 1] - e.S[f.seg]) * f.t, p = this.pointAt(e, s);
      best.set(eid, { s, lat: (x - p.x) * -p.tz + (z - p.z) * p.tx, d: Math.sqrt(f.d2) });
    }
    return best;
  }

  /** Whether (x, z) is inside a street's right of way (road, curb, verge or sidewalk), how far outside it is, and the road elevation and sidewalk height there. */
  query(x: number, z: number): RoadQuery {
    let out: RoadQuery = { inside: false, dist: Infinity, elev: 0, top: 0 };
    for (const [eid, n] of this.nearest(x, z, 1)) {
      const e = this.edges[eid], half = rowHalf(e.cls);
      const lo = e.trim[0], hi = e.len - e.trim[1];
      if (n.s < lo - 1e-6 || n.s > hi + 1e-6) continue;
      const dist = Math.abs(n.lat) - half;
      if (dist <= 0) return { inside: true, dist: 0, elev: this.elevAt(e, n.s), top: walkTop(e.cls) };
      if (dist < out.dist) out = { inside: false, dist, elev: this.elevAt(e, n.s), top: walkTop(e.cls) };
    }
    for (const id of this.juncGrid.get(this.cellKey(x, z)) ?? []) {
      const j = this.junctions.get(id)!, b = j.box!;
      const gap = Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - z, 0, z - b[3]));
      if (gap >= out.dist) continue;
      if (gap === 0 && pointInPoly(j.outline, x, z)) return { inside: true, dist: 0, elev: j.elev, top: walkTop(j.corners[0].path[0].w) };
      const d = polyDistance(j.outline, x, z);
      if (d < out.dist) out = { inside: false, dist: d, elev: j.elev, top: walkTop(this.edges[j.ends[0].edge].cls) };
    }
    return out;
  }
}

/** A point in a lot's house frame: x across the lot, z toward the street, from the front of the house. */
export function lotLocal(l: Lot, x: number, z: number): V2 {
  const c = Math.cos(l.yaw), s = Math.sin(l.yaw), dx = x - l.origin[0], dz = z - l.origin[1];
  return [dx * c - dz * s, dx * s + dz * c];
}

/** The driveway (from the garage door) and front walk (from the porch step) in the house frame: x centre, half width, z where it starts. */
export const PAVING = [{ x: DRIVE.garageX, half: DRIVE.width / 2, z0: -0.5 }, { x: 1.2, half: 0.6, z0: 2.4 }] as const;

/** Whether (x, z) is under a built lot's driveway or front walk (both run from the house to the sidewalk). */
export function onLotPaving(l: Lot, x: number, z: number) {
  if (l.house < 0) return false;
  const [lx, lz] = lotLocal(l, x, z);
  return PAVING.some(p => Math.abs(lx - p.x) <= p.half + 0.05 && lz >= p.z0 - 0.2 && lz <= DRIVE.setback + 0.3);
}

/** Top of a lot's paving at house-frame (lx, lz): the pad at the house, ramping to meet the sidewalk's outer edge wherever it reaches the street. */
export function pavingTop(net: RoadNet, l: Lot, lx: number, lz: number) {
  const e = net.edges[l.edge], s = l.drive + (lx - DRIVE.garageX) * l.dir;
  const front = net.elevAt(e, s) + walkTop(e.cls);
  const t = Math.max(0, Math.min(1, (lz + 0.5) / (DRIVE.setback + 0.5)));
  return l.pad + (front - l.pad) * t;
}

/** [minX, minZ, maxX, maxZ] of a polygon. */
export function bounds(poly: V2[]): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, z] of poly) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); }
  return [a, b, c, d];
}
export function pointInPoly(poly: V2[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function polyDistance(poly: V2[], x: number, z: number) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i], dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
