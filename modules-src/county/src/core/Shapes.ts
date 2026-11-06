/**
 * Shape helpers for the clipart look, built on Fox Plains 2's MeshBuilder.
 *
 * Everything here has softened edges so highlights run along them the way
 * they do in polished 3D clipart: bevelled boxes, extruded outlines with a
 * rounded top edge, profiles swept along a path and smooth lofted grids
 * (fuselages, hulls) whose colors can change per quad for crisp panel lines.
 *
 * Each helper takes an optional placement matrix and owns the builder's
 * transform while it runs.
 */
import * as pc from 'playcanvas';
import { MeshBuilder, type RGB } from '../../../foxplains2/src/core/Geo';

export type V2 = [number, number];
export type V3 = [number, number, number];

const deg = pc.math.RAD_TO_DEG;

/** Placement matrix: translate, then yaw (about Y), pitch (about X) and roll (about Z), in radians. */
export function place(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1) {
  const q = new pc.Quat().setFromEulerAngles(pitch * deg, yaw * deg, roll * deg);
  return new pc.Mat4().setTRS(new pc.Vec3(x, y, z), q, new pc.Vec3(sx, sy, sz));
}

function within(b: MeshBuilder, m: pc.Mat4 | undefined, fn: () => void) {
  b.transform(m ?? null);
  fn();
  b.transform(null);
}

function edgeCoords(h: number, r: number, seg: number) {
  if (r <= 1e-4) return [-h, h];
  const out: number[] = [];
  for (let t = 0; t <= seg; t++) out.push(-h + (r * t) / seg);
  for (let t = 0; t <= seg; t++) out.push(h - r + (r * t) / seg);
  return out;
}

export interface BevelOpts { color?: RGB; seg?: number; skipBottom?: boolean; at?: pc.Mat4 }

/** Box of full size sx × sy × sz centered on the origin of `at`, every edge and corner rounded by `r`. */
export function bevelBox(b: MeshBuilder, sx: number, sy: number, sz: number, r: number, o: BevelOpts = {}) {
  const h: V3 = [sx / 2, sy / 2, sz / 2];
  r = Math.max(0, Math.min(r, h[0], h[1], h[2]));
  const seg = r > 1e-4 ? (o.seg ?? 2) : 0;
  const c = o.color ?? b.color;
  const inner: V3 = [h[0] - r, h[1] - r, h[2] - r];
  within(b, o.at, () => {
    for (let k = 0; k < 3; k++) for (const s of [1, -1]) {
      if (k === 1 && s < 0 && o.skipBottom) continue;
      const i = (k + 1) % 3, j = (k + 2) % 3;
      const ui = edgeCoords(h[i], r, seg), vj = edgeCoords(h[j], r, seg);
      const base = b.vertexCount;
      for (const a of ui) for (const d of vj) {
        const p: V3 = [0, 0, 0];
        p[k] = s * h[k]; p[i] = a; p[j] = d;
        const q: V3 = [Math.max(-inner[0], Math.min(inner[0], p[0])), Math.max(-inner[1], Math.min(inner[1], p[1])), Math.max(-inner[2], Math.min(inner[2], p[2]))];
        let nx = p[0] - q[0], ny = p[1] - q[1], nz = p[2] - q[2];
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        b.vertex(q[0] + nx * r, q[1] + ny * r, q[2] + nz * r, nx, ny, nz, a, d, c);
      }
      const nv = vj.length;
      for (let x = 0; x < ui.length - 1; x++) for (let y = 0; y < nv - 1; y++) {
        const a0 = base + x * nv + y, a1 = a0 + nv, a2 = a1 + 1, a3 = a0 + 1;
        if (s > 0) b.idx.push(a0, a1, a2, a0, a2, a3); else b.idx.push(a0, a2, a1, a0, a3, a2);
      }
    }
  });
}

/** Rounds every corner of a closed outline with an arc of radius `rc`. */
export function roundOutline(pts: V2[], rc: number, seg = 4): V2[] {
  if (rc <= 0) return pts;
  const out: V2[] = [];
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const p = pts[k], a = pts[(k + n - 1) % n], c = pts[(k + 1) % n];
    const d1x = a[0] - p[0], d1z = a[1] - p[1], l1 = Math.hypot(d1x, d1z);
    const d2x = c[0] - p[0], d2z = c[1] - p[1], l2 = Math.hypot(d2x, d2z);
    const r = Math.min(rc, l1 / 2.05, l2 / 2.05);
    const s: V2 = [p[0] + (d1x / l1) * r, p[1] + (d1z / l1) * r];
    const e: V2 = [p[0] + (d2x / l2) * r, p[1] + (d2z / l2) * r];
    for (let t = 0; t <= seg; t++) {
      const u = t / seg, w = 1 - u;
      out.push([w * w * s[0] + 2 * w * u * p[0] + u * u * e[0], w * w * s[1] + 2 * w * u * p[1] + u * u * e[1]]);
    }
  }
  return out;
}

function signedArea(pts: V2[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

/** Ear-clipping triangulation of a simple polygon; returns index triples into `pts`. */
export function triangulate(pts: V2[]): number[] {
  const idx = pts.map((_, i) => i);
  if (signedArea(pts) < 0) idx.reverse();
  const out: number[] = [];
  const inside = (p: V2, a: V2, b: V2, c: V2) => {
    const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
    const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = pts[ia], bb = pts[ib], c = pts[ic];
      if ((bb[0] - a[0]) * (c[1] - a[1]) - (bb[1] - a[1]) * (c[0] - a[0]) <= 1e-9) continue;
      if (idx.some(j => j !== ia && j !== ib && j !== ic && inside(pts[j], a, bb, c))) continue;
      out.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

export interface PrismOpts { color?: RGB; r?: number; seg?: number; bottom?: boolean; at?: pc.Mat4 }

/**
 * Outline (x, z) extruded from y0 to y1 with a rounded top edge of radius `r`.
 * Walls are smooth where the outline turns gently (rounded corners) and
 * crisp where it turns sharply.
 */
export function prism(b: MeshBuilder, outline: V2[], y0: number, y1: number, o: PrismOpts = {}) {
  const pts = signedArea(outline) < 0 ? [...outline].reverse() : outline;
  const n = pts.length, c = o.color ?? b.color;
  const r = Math.max(0, Math.min(o.r ?? 0, (y1 - y0) * 0.5));
  const seg = r > 1e-4 ? (o.seg ?? 3) : 0;
  const en: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
    en.push([dz / l, -dx / l]);
  }
  const miter: V2[] = pts.map((_, i) => {
    const a = en[(i + n - 1) % n], bb = en[i];
    const k = 1 + a[0] * bb[0] + a[1] * bb[1];
    return k < 0.05 ? bb : [(a[0] + bb[0]) / k, (a[1] + bb[1]) / k];
  });
  const smoothAt = pts.map((_, i) => { const a = en[(i + n - 1) % n], bb = en[i]; return a[0] * bb[0] + a[1] * bb[1] > 0.82; });
  const rings: { inset: number; y: number; ny: number; nh: number }[] = [{ inset: 0, y: y0, ny: 0, nh: 1 }];
  for (let t = 0; t <= seg; t++) {
    const th = seg ? (t / seg) * Math.PI / 2 : 0;
    rings.push({ inset: r - r * Math.cos(th), y: y1 - r + r * Math.sin(th), ny: Math.sin(th), nh: Math.cos(th) });
  }
  within(b, o.at, () => {
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      const base = b.vertexCount;
      for (const rg of rings) for (const v of [i, i1]) {
        const p = pts[v], m = miter[v];
        const nn = smoothAt[v] ? (() => { const l = Math.hypot(m[0], m[1]) || 1; return [m[0] / l, m[1] / l]; })() : en[i];
        b.vertex(p[0] - m[0] * rg.inset, rg.y, p[1] - m[1] * rg.inset, nn[0] * rg.nh, rg.ny, nn[1] * rg.nh, 0, rg.y, c);
      }
      for (let k = 0; k < rings.length - 1; k++) {
        const a0 = base + k * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
        b.idx.push(a0, b1, a1, a0, b0, b1);
      }
    }
    const top: V2[] = pts.map((p, v) => [p[0] - miter[v][0] * r, p[1] - miter[v][1] * r]);
    const tris = triangulate(top);
    const tb = b.vertexCount;
    for (const p of top) b.vertex(p[0], y1, p[1], 0, 1, 0, p[0], p[1], c);
    for (let k = 0; k < tris.length; k += 3) b.idx.push(tb + tris[k], tb + tris[k + 2], tb + tris[k + 1]);
    if (o.bottom) {
      const bb = b.vertexCount;
      for (const p of pts) b.vertex(p[0], y0, p[1], 0, -1, 0, p[0], p[1], c);
      for (let k = 0; k < tris.length; k += 3) b.idx.push(bb + tris[k], bb + tris[k + 1], bb + tris[k + 2]);
    }
  });
}

export interface SweepOpts { color?: RGB; closed?: boolean; caps?: boolean; up?: V3; at?: pc.Mat4 }

/**
 * Sweeps a 2D profile (side, up) along a 3D path: trims, gutters, curbs,
 * railings, skid tubes. Walk a closed profile counter-clockwise so it faces out.
 */
export function sweep(b: MeshBuilder, path: V3[], profile: V2[], o: SweepOpts = {}) {
  if (path.length < 2) return;
  const c = o.color ?? b.color, np = profile.length;
  const closed = o.closed ?? true;
  const upRef = new pc.Vec3(...(o.up ?? [0, 1, 0]));
  const pn: V2[] = profile.map((_, k) => {
    let nx = 0, ny = 0;
    const segs = closed ? [(k + np - 1) % np, k] : [k - 1, k].filter(s => s >= 0 && s < np - 1);
    for (const s of segs) {
      const a = profile[s], q = profile[(s + 1) % np];
      const dx = q[0] - a[0], dy = q[1] - a[1], l = Math.hypot(dx, dy) || 1;
      nx += dy / l; ny += -dx / l;
    }
    const l = Math.hypot(nx, ny) || 1;
    return [nx / l, ny / l];
  });
  const t = new pc.Vec3(), side = new pc.Vec3(), up = new pc.Vec3();
  within(b, o.at, () => {
    const base = b.vertexCount;
    let dist = 0;
    for (let i = 0; i < path.length; i++) {
      const a = path[Math.max(0, i - 1)], q = path[Math.min(path.length - 1, i + 1)];
      t.set(q[0] - a[0], q[1] - a[1], q[2] - a[2]).normalize();
      side.cross(t, upRef);
      if (side.length() < 1e-4) side.set(1, 0, 0);
      side.normalize();
      up.cross(side, t).normalize();
      if (i > 0) dist += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
      const p = path[i];
      profile.forEach((pr, k) => {
        const n = pn[k];
        b.vertex(
          p[0] + side.x * pr[0] + up.x * pr[1], p[1] + side.y * pr[0] + up.y * pr[1], p[2] + side.z * pr[0] + up.z * pr[1],
          side.x * n[0] + up.x * n[1], side.y * n[0] + up.y * n[1], side.z * n[0] + up.z * n[1], k / np, dist, c);
      });
    }
    const ring = closed ? np : np - 1;
    for (let i = 0; i < path.length - 1; i++) for (let k = 0; k < ring; k++) {
      const k1 = (k + 1) % np;
      const a0 = base + i * np + k, a1 = base + i * np + k1, b0 = a0 + np, b1 = a1 + np;
      b.idx.push(a0, b0, b1, a0, b1, a1);
    }
    if (o.caps && closed) {
      for (const [i, s] of [[0, -1], [path.length - 1, 1]] as const) {
        const a = path[Math.max(0, i - 1)], q = path[Math.min(path.length - 1, i + 1)];
        t.set(q[0] - a[0], q[1] - a[1], q[2] - a[2]).normalize();
        const first = base + i * np;
        const cb = b.vertexCount;
        for (let k = 0; k < np; k++) {
          const v = first + k;
          b.vertex(b.pos[v * 3], b.pos[v * 3 + 1], b.pos[v * 3 + 2], t.x * s, t.y * s, t.z * s, 0, 0, c);
        }
        for (let k = 1; k < np - 1; k++) {
          if (s > 0) b.idx.push(cb, cb + k, cb + k + 1); else b.idx.push(cb, cb + k + 1, cb + k);
        }
      }
    }
  });
}

/** Closed circle profile for `sweep` (tubes, railings, skids). */
export const circle = (r: number, seg = 10): V2[] => Array.from({ length: seg }, (_, i) => { const a = (i / seg) * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r] as V2; });

/** Rounded rectangle profile for `sweep` (trims, fascia boards, curbs). */
export function roundRect(w: number, h: number, r: number, seg = 3, ox = 0, oy = 0): V2[] {
  return roundOutline([[ox - w / 2, oy - h / 2], [ox + w / 2, oy - h / 2], [ox + w / 2, oy + h / 2], [ox - w / 2, oy + h / 2]], r, seg);
}

export interface GridOpts { wrap?: boolean; at?: pc.Mat4; color?: (i: number, j: number) => RGB; flipped?: boolean }

/**
 * A smooth surface from a grid of points (rows along the length, columns
 * around). Normals come from the grid itself; with `color`, each quad takes
 * one color so panel and window edges stay crisp along grid lines.
 */
export function gridSurface(b: MeshBuilder, grid: V3[][], o: GridOpts = {}) {
  const R = grid.length, C = grid[0].length, wrap = o.wrap ?? true;
  const at = (i: number, j: number) => grid[Math.max(0, Math.min(R - 1, i))][wrap ? (j + C) % C : Math.max(0, Math.min(C - 1, j))];
  const nrm: V3[][] = grid.map((row, i) => row.map((_, j) => {
    const a = at(i + 1, j), bq = at(i - 1, j), cq = at(i, j + 1), d = at(i, j - 1);
    const u: V3 = [a[0] - bq[0], a[1] - bq[1], a[2] - bq[2]], v: V3 = [cq[0] - d[0], cq[1] - d[1], cq[2] - d[2]];
    let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    if (o.flipped) { nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }));
  const cols = wrap ? C : C - 1;
  within(b, o.at, () => {
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < cols; j++) {
      const j1 = (j + 1) % C;
      const c = o.color ? o.color(i, j) : b.color;
      const corners: [number, number][] = [[i, j], [i + 1, j], [i + 1, j1], [i, j1]];
      const base = b.vertexCount;
      for (const [ii, jj] of corners) { const p = grid[ii][jj], n = nrm[ii][jj]; b.vertex(p[0], p[1], p[2], n[0], n[1], n[2], jj / C, ii / R, c); }
      if (o.flipped) b.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  });
}

/** Soft contact shading: darkens vertices added since `start` that sit close above `baseY`. */
export function contactShade(b: MeshBuilder, start: number, baseY: number, reach = 0.6, strength = 0.32) {
  for (let v = start; v < b.vertexCount; v++) {
    const h = Math.max(0, b.pos[v * 3 + 1] - baseY);
    const k = 1 - strength * Math.exp(-h / reach);
    b.col[v * 3] *= k; b.col[v * 3 + 1] *= k; b.col[v * 3 + 2] *= k;
  }
}
