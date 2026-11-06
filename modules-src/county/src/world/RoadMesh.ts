/**
 * Meshes for the road network, all from the shared cross-section in
 * `shared/Roads.ts`: the carriageway, a curb with a bevelled top edge, the
 * grass verge (or a concrete apron where the curb is cut for a driveway or a
 * crosswalk ramp), the jointed sidewalk and a skirt that tucks its outer edge
 * into the ground. Junctions get one flat surface fanned from the node and
 * the same layers swept along their curb returns, so every seam is shared.
 * Markings (centre lines, edge lines, crosswalks, stop bars) go to their own
 * builder so they can be left out of the colliders.
 */
import type { MeshBuilder, RGB } from '../../../foxplains2/src/core/Geo';
import { CURB, crossHeight, vergeEnd, walkEnd, type CornerPt, type Edge, type Junction, type RoadNet, type Widths } from '../../shared/Roads';
import { PALETTE } from '../../config';

export interface RoadBuilders { asphalt: MeshBuilder; curb: MeshBuilder; grass: MeshBuilder; concrete: MeshBuilder; marks: MeshBuilder }

type P3 = [number, number, number];
const JOINT = 1.5, JOINT_W = 0.03, SKIRT = 0.4, BEVEL = 0.035, MARK_Y = 0.006;

/** A quad a-b-c-d with per-corner normals, wound so it faces along `face`. */
function quad(b: MeshBuilder, p: P3[], n: P3[], c: RGB, face: P3) {
  const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
  const vx = p[3][0] - p[0][0], vy = p[3][1] - p[0][1], vz = p[3][2] - p[0][2];
  const flip = (uy * vz - uz * vy) * face[0] + (uz * vx - ux * vz) * face[1] + (ux * vy - uy * vx) * face[2] < 0;
  const i = p.map((q, k) => b.vertex(q[0], q[1], q[2], n[k][0], n[k][1], n[k][2], q[0] * 0.25, q[2] * 0.25, c));
  if (flip) { b.tri(i[0], i[2], i[1]); b.tri(i[0], i[3], i[2]); } else { b.tri(i[0], i[1], i[2]); b.tri(i[0], i[2], i[3]); }
}

interface Frame { x: number; z: number; nx: number; nz: number; y: number; up: P3; w: Widths; cut: number }

/** The curb, verge or apron, sidewalk and skirt between two consecutive frames along a curb line (normal pointing away from the road). */
function sideLayers(B: RoadBuilders, a: Frame, b: Frame, joint: boolean) {
  const at = (f: Frame, d: number, y: number): P3 => [f.x + f.nx * d, f.y + y, f.z + f.nz * d];
  const out = (f: Frame): P3 => [f.nx, 0, f.nz], inn = (f: Frame): P3 => [-f.nx, 0, -f.nz];
  const curbTop = (f: Frame) => crossHeight(f.w, CURB.width / 2, f.cut);
  const r = (f: Frame) => Math.min(BEVEL, curbTop(f) * 0.5);
  const bev = (f: Frame): P3 => { const l = Math.hypot(f.nx, 1, f.nz); return [-f.nx / l, 1 / l, -f.nz / l]; };
  const up: P3 = [0, 1, 0];
  quad(B.curb, [at(a, 0, 0), at(b, 0, 0), at(b, 0, curbTop(b) - r(b)), at(a, 0, curbTop(a) - r(a))], [inn(a), inn(b), inn(b), inn(a)], PALETTE.curb, inn(a));
  quad(B.curb, [at(a, 0, curbTop(a) - r(a)), at(b, 0, curbTop(b) - r(b)), at(b, r(b), curbTop(b)), at(a, r(a), curbTop(a))], [bev(a), bev(b), bev(b), bev(a)], PALETTE.curb, bev(a));
  quad(B.curb, [at(a, r(a), curbTop(a)), at(b, r(b), curbTop(b)), at(b, CURB.width, curbTop(b)), at(a, CURB.width, curbTop(a))], [a.up, b.up, b.up, a.up], PALETTE.curb, up);
  const ve = (f: Frame) => vergeEnd(f.w), we = (f: Frame) => walkEnd(f.w);
  const apron = a.cut > 0 || b.cut > 0;
  quad(apron ? B.concrete : B.grass, [at(a, CURB.width, curbTop(a)), at(b, CURB.width, curbTop(b)), at(b, ve(b), crossHeight(b.w, ve(b), b.cut)), at(a, ve(a), crossHeight(a.w, ve(a), a.cut))], [a.up, b.up, b.up, a.up], apron ? PALETTE.concrete : [PALETTE.grass[0] * 0.88, PALETTE.grass[1] * 0.88, PALETTE.grass[2] * 0.88], up);
  quad(B.concrete, [at(a, ve(a), crossHeight(a.w, ve(a))), at(b, ve(b), crossHeight(b.w, ve(b))), at(b, we(b), crossHeight(b.w, we(b))), at(a, we(a), crossHeight(a.w, we(a)))], [a.up, b.up, b.up, a.up], joint ? PALETTE.joint : PALETTE.concreteLight, up);
  quad(B.concrete, [at(a, we(a), crossHeight(a.w, we(a))), at(b, we(b), crossHeight(b.w, we(b))), at(b, we(b), crossHeight(b.w, we(b)) - SKIRT), at(a, we(a), crossHeight(a.w, we(a)) - SKIRT)], [out(a), out(b), out(b), out(a)], PALETTE.concrete, out(a));
}

function upNormal(net: RoadNet, e: Edge, s: number, tx: number, tz: number): P3 {
  const g = net.elevAt(e, s + 0.5) - net.elevAt(e, s - 0.5);
  const l = Math.hypot(g, 1);
  return [(-g * tx) / l, 1 / l, (-g * tz) / l];
}

/** Stations along an edge piece: every 2 m, every sidewalk joint, and both ends of every cut and flare, so no strip has a T-junction. */
function stations(e: Edge, s0: number, s1: number) {
  const set = new Set<number>([s0, s1]);
  for (let s = Math.ceil(s0 / 2) * 2; s < s1; s += 2) set.add(s);
  for (let s = Math.ceil(s0 / JOINT) * JOINT; s < s1; s += JOINT) { set.add(s - JOINT_W / 2); set.add(s + JOINT_W / 2); }
  for (const c of e.cuts) for (const d of [-c.width / 2 - c.flare, -c.width / 2, c.width / 2, c.width / 2 + c.flare]) set.add(c.s + d);
  return [...set].filter(s => s >= s0 && s <= s1).sort((a, b) => a - b).filter((s, i, l) => i === 0 || s - l[i - 1] > 1e-4);
}

/** The carriageway, both sides' curbs and sidewalks, and the markings of an edge between stations `s0` and `s1` (inside its trims). */
export function buildEdgePiece(B: RoadBuilders, net: RoadNet, e: Edge, s0: number, s1: number) {
  const ss = stations(e, s0, s1);
  const frames = ss.map(s => {
    const p = net.pointAt(e, s), y = net.elevAt(e, s), up = upNormal(net, e, s, p.tx, p.tz);
    return { s, p, y, up };
  });
  const asphalt = PALETTE.asphalt;
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i], b = frames[i + 1], h = e.cls.half;
    const pt = (f: typeof a, lat: number): P3 => [f.p.x - f.p.tz * lat, f.y, f.p.z + f.p.tx * lat];
    quad(B.asphalt, [pt(a, -h), pt(b, -h), pt(b, h), pt(a, h)], [a.up, b.up, b.up, a.up], asphalt, [0, 1, 0]);
    const mid = (a.s + b.s) / 2, joint = Math.abs(mid - Math.round(mid / JOINT) * JOINT) < JOINT_W;
    for (const side of [1, -1] as const) {
      const frame = (f: typeof a): Frame => {
        const nx = -f.p.tz * side, nz = f.p.tx * side;
        return { x: f.p.x + nx * h, z: f.p.z + nz * h, nx, nz, y: f.y, up: f.up, w: e.cls, cut: net.cutAt(e, side, f.s) };
      };
      sideLayers(B, frame(a), frame(b), joint);
    }
  }
  buildMarkings(B.marks, net, e, s0, s1);
}

function markStrip(b: MeshBuilder, net: RoadNet, e: Edge, s0: number, s1: number, lat0: number, lat1: number, c: RGB) {
  for (let s = s0; s < s1 - 1e-6;) {
    const t = Math.min(s1, s + 2);
    const pa = net.pointAt(e, s), pb = net.pointAt(e, t), ya = net.elevAt(e, s) + MARK_Y, yb = net.elevAt(e, t) + MARK_Y;
    const at = (p: typeof pa, y: number, lat: number): P3 => [p.x - p.tz * lat, y, p.z + p.tx * lat];
    const n: P3 = [0, 1, 0];
    quad(b, [at(pa, ya, lat0), at(pb, yb, lat0), at(pb, yb, lat1), at(pa, ya, lat1)], [n, n, n, n], c, n);
    s = t;
  }
}

function buildMarkings(b: MeshBuilder, net: RoadNet, e: Edge, s0: number, s1: number) {
  const lo = Math.max(s0, ...e.crossings.filter(c => c < e.len / 2).map(c => c + 3.2), e.trim[0]);
  const hi = Math.min(s1, ...e.crossings.filter(c => c >= e.len / 2).map(c => c - 3.2), e.len - e.trim[1]);
  if (e.cls.centre === 'dash') {
    for (let s = Math.ceil(lo / 9) * 9; s + 3 <= hi; s += 9) markStrip(b, net, e, s, s + 3, -0.06, 0.06, PALETTE.laneYellow);
  } else if (hi > lo) {
    markStrip(b, net, e, lo, hi, -0.17, -0.07, PALETTE.laneYellow);
    markStrip(b, net, e, lo, hi, 0.07, 0.17, PALETTE.laneYellow);
  }
  if (e.cls.edgeLines && hi > lo) for (const side of [1, -1]) markStrip(b, net, e, lo, hi, side * (e.cls.half - 0.35), side * (e.cls.half - 0.23), PALETTE.laneWhite);
  for (const c of e.crossings) {
    if (c + 1.2 < s0 || c - 1.2 > s1) continue;
    const h = e.cls.half - 0.3;
    for (let lat = -h; lat + 0.45 <= h + 1e-6; lat += 0.9) markStrip(b, net, e, c - 1.2, c + 1.2, lat, lat + 0.45, PALETTE.laneWhite);
    const atStart = c < e.len / 2, side = atStart ? 1 : -1, sb = atStart ? c + 2 : c - 2.4;
    markStrip(b, net, e, sb, sb + 0.4, side > 0 ? 0.2 : -e.cls.half + 0.3, side > 0 ? e.cls.half - 0.3 : -0.2, PALETTE.laneWhite);
  }
}

/** A junction: the flat carriageway fanned from the node, and the curb layers along each corner. */
export function buildJunction(B: RoadBuilders, j: Junction) {
  const n: P3 = [0, 1, 0], y = j.elev, c = PALETTE.asphalt;
  const ctr = B.asphalt.vertex(j.x, y, j.z, 0, 1, 0, j.x * 0.25, j.z * 0.25, c);
  const ring = j.surface.map(p => B.asphalt.vertex(p[0], y, p[1], 0, 1, 0, p[0] * 0.25, p[1] * 0.25, c));
  for (let i = 0; i < ring.length; i++) {
    const a = j.surface[i], b = j.surface[(i + 1) % ring.length];
    const cross = (a[1] - j.z) * (b[0] - j.x) - (a[0] - j.x) * (b[1] - j.z);
    if (Math.abs(cross) < 1e-9) continue;
    if (cross > 0) B.asphalt.tri(ctr, ring[i], ring[(i + 1) % ring.length]); else B.asphalt.tri(ctr, ring[(i + 1) % ring.length], ring[i]);
  }
  for (const corner of j.corners) {
    const frames = corner.path.map((p: CornerPt): Frame => ({ x: p.x, z: p.z, nx: p.nx, nz: p.nz, y, up: n, w: { half: 0, verge: p.w.verge, walk: p.w.walk }, cut: 0 }));
    for (let i = 0; i < frames.length - 1; i++) sideLayers(B, frames[i], frames[i + 1], false);
  }
}
