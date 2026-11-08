/**
 * MeshBuilder: accumulates triangles (positions, normals, UVs and optional
 * sRGB vertex colors) and turns them into one Babylon mesh. Everything static
 * in the town is built this way and merged per material and per chunk, so a
 * street of houses or a downtown block is a handful of draw calls; static
 * meshes freeze their world matrices and bounds so the per-frame cost is one
 * frustum test each.
 *
 * UVs on boxes are world-space (metres × `uv`), so textures keep their real
 * size whatever the box size. An optional transform places parts (wheels,
 * lamp heads, tree canopies) without leaving the builder.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Node } from '@babylonjs/core/node';
import type { Renderer } from './Renderer';

export type RGB = [number, number, number];
const WHITE: RGB = [1, 1, 1];

let renderer: Renderer | null = null;
/** The one renderer every builder draws into (set once at start-up). */
export function setRenderer(r: Renderer) { renderer = r; }
export function R(): Renderer { if (!renderer) throw new Error('renderer not ready'); return renderer; }

export function hexRGB(hex: string | number): RGB {
  const n = typeof hex === 'number' ? hex : parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scaleRGB = (a: RGB, k: number): RGB => [Math.min(1, a[0] * k), Math.min(1, a[1] * k), Math.min(1, a[2] * k)];
/** sRGB channel (0..1) to linear. */
export const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Euler angles in degrees (applied X, then Y, then Z about fixed axes, like the old engine's helpers). */
export function quatDeg(x: number, y: number, z: number, out = new Quaternion()) {
  const d = Math.PI / 180;
  const qx = Quaternion.RotationAxis(Vector3.Right(), x * d), qy = Quaternion.RotationAxis(Vector3.Up(), y * d), qz = Quaternion.RotationAxis(Vector3.Forward(true), z * d);
  qz.multiplyToRef(qy, out);
  out.multiplyToRef(qx, out);
  return out;
}

/** Translation, rotation (quaternion) and uniform-or-vector scale. */
export function trs(x: number, y: number, z: number, q: Quaternion = Quaternion.Identity(), s = 1) {
  return Matrix.Compose(new Vector3(s, s, s), q, new Vector3(x, y, z));
}

const _v = new Vector3(), _n = new Vector3();

/**
 * Builders wind front faces counter-clockwise (the GL convention the shapes
 * were written in); Babylon meshes treat clockwise as front, even in a
 * right-handed scene, so every triangle is emitted with two corners swapped.
 */
function babylonWinding(idx: number[], vertexCount: number) {
  const out = vertexCount > 65535 ? new Uint32Array(idx.length) : new Uint16Array(idx.length);
  for (let i = 0; i + 2 < idx.length; i += 3) { out[i] = idx[i]; out[i + 1] = idx[i + 2]; out[i + 2] = idx[i + 1]; }
  return out as unknown as Uint32Array;
}

export interface BoxOpts { uv?: number; color?: RGB; skipBottom?: boolean; skipTop?: boolean; uvOffset?: [number, number] }

export class MeshBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  uv1: number[] = [];
  /** When set, vertices also get a second UV from their world XZ: (x * sx + ox, z * sz + oz). */
  uv1Map: [number, number, number, number] | null = null;
  private hasUv1 = false;
  col: number[] = [];
  idx: number[] = [];
  /** Current vertex color (sRGB 0..1). */
  color: RGB = WHITE;
  private m: Matrix | null = null;
  private nm = new Matrix();

  get empty() { return this.idx.length === 0; }
  get vertexCount() { return this.pos.length / 3; }

  /** Applies `m` to every vertex added until `transform(null)`. */
  transform(m: Matrix | null) {
    this.m = m;
    if (m) { m.invertToRef(this.nm); this.nm.transposeToRef(this.nm); }
    return this;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: RGB = this.color) {
    if (this.m) {
      Vector3.TransformCoordinatesFromFloatsToRef(x, y, z, this.m, _v); x = _v.x; y = _v.y; z = _v.z;
      Vector3.TransformNormalFromFloatsToRef(nx, ny, nz, this.nm, _n); _n.normalize(); nx = _n.x; ny = _n.y; nz = _n.z;
    }
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(u, v); this.col.push(c[0], c[1], c[2]);
    const m1 = this.uv1Map;
    if (m1) { this.uv1.push(x * m1[2] + m1[0], z * m1[3] + m1[1]); this.hasUv1 = true; } else this.uv1.push(0, 0);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }

  /** Quad a-b-c-d (counter-clockwise seen from the front) with a flat normal. */
  quad(p: number[][], n: number[], uvs: number[][], c: RGB = this.color) {
    const i = this.vertex(p[0][0], p[0][1], p[0][2], n[0], n[1], n[2], uvs[0][0], uvs[0][1], c);
    this.vertex(p[1][0], p[1][1], p[1][2], n[0], n[1], n[2], uvs[1][0], uvs[1][1], c);
    this.vertex(p[2][0], p[2][1], p[2][2], n[0], n[1], n[2], uvs[2][0], uvs[2][1], c);
    this.vertex(p[3][0], p[3][1], p[3][2], n[0], n[1], n[2], uvs[3][0], uvs[3][1], c);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** Quad from four points with the normal computed from them. */
  face(a: number[], b: number[], c: number[], d: number[], uvs: number[][], col: RGB = this.color) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.quad([a, b, c, d], [nx, ny, nz], uvs, col);
  }

  /** Axis-aligned box with world-space UVs. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o: BoxOpts = {}) {
    const s = o.uv ?? 1, c = o.color ?? this.color;
    const [ou, ov] = o.uvOffset ?? [0, 0];
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    this.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[-z1 * s + ou, y0 * s + ov], [-z0 * s + ou, y0 * s + ov], [-z0 * s + ou, y1 * s + ov], [-z1 * s + ou, y1 * s + ov]], c);
    this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[z0 * s + ou, y0 * s + ov], [z1 * s + ou, y0 * s + ov], [z1 * s + ou, y1 * s + ov], [z0 * s + ou, y1 * s + ov]], c);
    this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[x0 * s + ou, y0 * s + ov], [x1 * s + ou, y0 * s + ov], [x1 * s + ou, y1 * s + ov], [x0 * s + ou, y1 * s + ov]], c);
    this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[-x1 * s + ou, y0 * s + ov], [-x0 * s + ou, y0 * s + ov], [-x0 * s + ou, y1 * s + ov], [-x1 * s + ou, y1 * s + ov]], c);
    if (!o.skipTop) this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[x0 * s, z1 * s], [x1 * s, z1 * s], [x1 * s, z0 * s], [x0 * s, z0 * s]], c);
    if (!o.skipBottom) this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [[x0 * s, z0 * s], [x1 * s, z0 * s], [x1 * s, z1 * s], [x0 * s, z1 * s]], c);
  }

  /** Box centered at (cx, cy, cz), turned `yaw` radians about +Y. */
  orientedBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number, o: BoxOpts = {}) {
    const prev = this.m;
    let m = trs(cx, cy, cz, Quaternion.RotationAxis(Vector3.Up(), yaw));
    if (prev) m = m.multiply(prev);
    this.transform(m);
    this.box(-hx, -hy, -hz, hx, hy, hz, o);
    this.transform(prev);
  }

  /** Horizontal rectangle at height y (top-facing), world UVs. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, uv = 1, c: RGB = this.color) {
    this.quad([[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], [0, 1, 0], [[x0 * uv, z1 * uv], [x1 * uv, z1 * uv], [x1 * uv, z0 * uv], [x0 * uv, z0 * uv]], c);
  }

  /** Vertical cylinder (or cone with r1 ≠ r0) from y0 to y1 around (x, z). */
  cylinder(x: number, y0: number, z: number, r0: number, r1: number, h: number, seg = 10, caps = true, c: RGB = this.color) {
    const base = this.vertexCount;
    const slope = (r0 - r1) / h;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const l = Math.hypot(1, slope);
      this.vertex(x + ca * r0, y0, z + sa * r0, ca / l, slope / l, sa / l, i / seg, 0, c);
      this.vertex(x + ca * r1, y0 + h, z + sa * r1, ca / l, slope / l, sa / l, i / seg, 1, c);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    if (caps && r1 > 0.001) {
      const ctr = this.vertex(x, y0 + h, z, 0, 1, 0, 0.5, 0.5, c);
      const ring = this.vertexCount;
      for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; this.vertex(x + Math.cos(a) * r1, y0 + h, z + Math.sin(a) * r1, 0, 1, 0, 0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2, c); }
      for (let i = 0; i < seg; i++) this.idx.push(ctr, ring + i + 1, ring + i);
    }
  }

  /** Low-poly blob (subdivided octahedron pushed to an ellipsoid) with a little noise: tree canopies, shrubs. */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, seed = 1, rough = 0.12, c: RGB = this.color, N = 3) {
    const dirs: number[][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const faces = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
    let s = seed * 9301 + 49297;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s / 2147483647) * 2 - 1; };
    const cache = new Map<string, number>();
    const at = (p: number[]) => {
      const l = Math.hypot(p[0], p[1], p[2]);
      const d = [p[0] / l, p[1] / l, p[2] / l];
      const key = d.map(v => v.toFixed(4)).join(',');
      let i = cache.get(key);
      if (i === undefined) {
        const k = 1 + rnd() * rough;
        const nx = d[0] / rx, ny = d[1] / ry, nz = d[2] / rz, nl = Math.hypot(nx, ny, nz);
        const shade = 0.62 + 0.38 * (d[1] * 0.5 + 0.5) + rnd() * 0.06;
        i = this.vertex(cx + d[0] * rx * k, cy + d[1] * ry * k, cz + d[2] * rz * k, nx / nl, ny / nl, nz / nl, d[0] * 0.5 + 0.5, d[2] * 0.5 + 0.5, [c[0] * shade, c[1] * shade, c[2] * shade]);
        cache.set(key, i);
      }
      return i;
    };
    for (const f of faces) {
      const [A, B, C] = f.map(i => dirs[i]);
      const p = (i: number, j: number) => { const k = N - i - j; return [(A[0] * k + B[0] * i + C[0] * j) / N, (A[1] * k + B[1] * i + C[1] * j) / N, (A[2] * k + B[2] * i + C[2] * j) / N]; };
      for (let i = 0; i < N; i++) for (let j = 0; j < N - i; j++) {
        this.tri(at(p(i, j)), at(p(i + 1, j)), at(p(i, j + 1)));
        if (i + j < N - 1) this.tri(at(p(i + 1, j)), at(p(i + 1, j + 1)), at(p(i, j + 1)));
      }
    }
  }

  /**
   * Surface of revolution about +Y from a (radius, y) profile. Walking the
   * profile toward +Y on the outside faces outward. `smooth` shares normals
   * between profile segments; otherwise every segment is lit flat (crisp rims).
   */
  lathe(profile: number[][], seg = 24, smooth = true, c: RGB = this.color) {
    const segN = (k: number) => { const dr = profile[k + 1][0] - profile[k][0], dy = profile[k + 1][1] - profile[k][1], l = Math.hypot(dr, dy) || 1; return [dy / l, -dr / l]; };
    const rows: { r: number; y: number; nr: number; ny: number; v: number }[][] = [];
    if (smooth) {
      rows.push(profile.map((p, j) => {
        let nr = 0, ny = 0;
        for (const k of [j - 1, j]) if (k >= 0 && k < profile.length - 1) { const n = segN(k); nr += n[0]; ny += n[1]; }
        const l = Math.hypot(nr, ny) || 1;
        return { r: p[0], y: p[1], nr: nr / l, ny: ny / l, v: j / (profile.length - 1) };
      }));
    } else {
      for (let k = 0; k < profile.length - 1; k++) {
        const n = segN(k);
        rows.push([k, k + 1].map(j => ({ r: profile[j][0], y: profile[j][1], nr: n[0], ny: n[1], v: j / (profile.length - 1) })));
      }
    }
    for (const row of rows) {
      const n = row.length, base = this.vertexCount;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        for (const p of row) this.vertex(p.r * ca, p.y, p.r * sa, p.nr * ca, p.ny, p.nr * sa, i / seg, p.v, c);
      }
      for (let i = 0; i < seg; i++) for (let j = 0; j < n - 1; j++) {
        const a = base + i * n + j, b = a + 1, d = a + n, cc = d + 1;
        this.idx.push(a, b, cc, a, cc, d);
      }
    }
  }

  /**
   * Rounded-rectangle sections strung along +X (rings sorted by x), smooth
   * around each section and capped at both ends: hoods, seats, decks, bags.
   */
  loft(rings: { x: number; cy: number; cz?: number; hw: number; hh: number; r: number }[], corner = 4, caps = true, c: RGB = this.color) {
    const ringPts = (g: (typeof rings)[number]) => {
      const out: { y: number; z: number; ny: number; nz: number; u: number }[] = [];
      const r = Math.min(g.r, g.hw, g.hh), cz = g.cz ?? 0;
      const centers = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
      centers.forEach(([sz, sy], q) => {
        for (let j = 0; j <= corner; j++) {
          const t = (q + j / corner) * Math.PI / 2, ct = Math.cos(t), st = Math.sin(t);
          out.push({ z: cz + sz * (g.hw - r) + r * ct, y: g.cy + sy * (g.hh - r) + r * st, ny: st, nz: ct, u: (q + j / corner) / 4 });
        }
      });
      return out;
    };
    const all = rings.map(ringPts), n = all[0].length;
    const base = this.vertexCount;
    rings.forEach((g, i) => { for (const p of all[i]) this.vertex(g.x, p.y, p.z, 0, p.ny, p.nz, p.u, g.x, c); });
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const a = base + i * n + k, b = base + (i + 1) * n + k, cc = base + (i + 1) * n + k1, d = base + i * n + k1;
      this.idx.push(a, b, cc, a, cc, d);
    }
    if (!caps) return;
    for (const [i, s] of [[0, -1], [rings.length - 1, 1]]) {
      const g = rings[i], pts = all[i];
      const ctr = this.vertex(g.x, g.cy, g.cz ?? 0, s, 0, 0, 0.5, 0.5, c);
      const ring = this.vertexCount;
      for (const p of pts) this.vertex(g.x, p.y, p.z, s, 0, 0, 0.5 + p.nz / 2, 0.5 + p.ny / 2, c);
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        if (s > 0) this.idx.push(ctr, ring + k1, ring + k); else this.idx.push(ctr, ring + k, ring + k1);
      }
    }
  }

  /** Round tube from a to b (pipes, steering columns, frame bars). */
  tube(a: number[], b: number[], r: number, seg = 10, caps = true, c: RGB = this.color) {
    const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    if (len < 1e-5) return;
    d.scaleInPlace(1 / len);
    let q: Quaternion;
    const axis = Vector3.Cross(Vector3.Up(), d);
    if (axis.length() < 1e-6) q = d.y < 0 ? Quaternion.RotationAxis(Vector3.Right(), Math.PI) : Quaternion.Identity();
    else q = Quaternion.RotationAxis(axis.normalize(), Math.acos(Math.max(-1, Math.min(1, d.y))));
    const prev = this.m;
    let m = trs(a[0], a[1], a[2], q);
    if (prev) m = m.multiply(prev);
    this.transform(m);
    this.cylinder(0, 0, 0, r, r, len, seg, caps, c);
    if (caps) {
      const ctr = this.vertex(0, 0, 0, 0, -1, 0, 0.5, 0.5, c), ring = this.vertexCount;
      for (let i = 0; i <= seg; i++) { const t = (i / seg) * Math.PI * 2; this.vertex(Math.cos(t) * r, 0, Math.sin(t) * r, 0, -1, 0, 0.5 + Math.cos(t) / 2, 0.5 + Math.sin(t) / 2, c); }
      for (let i = 0; i < seg; i++) this.idx.push(ctr, ring + i, ring + i + 1);
    }
    this.transform(prev);
  }

  /** Torus around +Y (steering wheels, rims of round lids). */
  torus(R: number, r: number, seg = 24, side = 8, c: RGB = this.color) {
    const base = this.vertexCount;
    for (let i = 0; i <= seg; i++) {
      const u = (i / seg) * Math.PI * 2, cu = Math.cos(u), su = Math.sin(u);
      for (let j = 0; j <= side; j++) {
        const v = (j / side) * Math.PI * 2, cv = Math.cos(v), sv = Math.sin(v);
        this.vertex(cu * (R + r * cv), r * sv, su * (R + r * cv), cu * cv, sv, su * cv, i / seg, j / side, c);
      }
    }
    const n = side + 1;
    for (let i = 0; i < seg; i++) for (let j = 0; j < side; j++) {
      const a = base + i * n + j, b = a + 1, cc = a + n + 1, d = a + n;
      this.idx.push(a, b, cc, a, cc, d);
    }
  }

  /** Ribbon along a polyline on the ground: width `w`, at height y, UVs u across (0..1) and v along (metres × uv). */
  ribbon(pts: { x: number; z: number }[], w0: number, w1: number, y: number, uv = 1, c: RGB = this.color) {
    if (pts.length < 2) return;
    let dist = 0;
    let prev = -1;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      if (i > 0) dist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const p = pts[i];
      const l0 = this.vertex(p.x + nx * w0, y, p.z + nz * w0, 0, 1, 0, 0, dist * uv, c);
      this.vertex(p.x + nx * w1, y, p.z + nz * w1, 0, 1, 0, 1, dist * uv, c);
      if (prev >= 0) {
        if (w1 > w0) this.idx.push(prev, prev + 1, l0, prev + 1, l0 + 1, l0);
        else this.idx.push(prev, l0, prev + 1, prev + 1, l0, l0 + 1);
      }
      prev = l0;
    }
  }

  /** Vertical wall strip along a polyline (curbs on curved streets). */
  wallStrip(pts: { x: number; z: number }[], off: number, y0: number, y1: number, uv = 1, flip = false, c: RGB = this.color) {
    let dist = 0, prev = -1;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      let nx = -dz / l, nz = dx / l;
      const px = pts[i].x + nx * off, pz = pts[i].z + nz * off;
      if (flip) { nx = -nx; nz = -nz; }
      if (i > 0) dist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const v0 = this.vertex(px, y0, pz, nx, 0, nz, dist * uv, y0 * uv, c);
      this.vertex(px, y1, pz, nx, 0, nz, dist * uv, y1 * uv, c);
      if (prev >= 0) {
        if (!flip) this.idx.push(prev, v0, prev + 1, prev + 1, v0, v0 + 1);
        else this.idx.push(prev, prev + 1, v0, prev + 1, v0 + 1, v0);
      }
      prev = v0;
    }
  }

  /** Appends another builder's triangles. */
  append(o: MeshBuilder) {
    const base = this.vertexCount;
    for (let i = 0; i < o.pos.length; i++) this.pos.push(o.pos[i]);
    for (let i = 0; i < o.nrm.length; i++) this.nrm.push(o.nrm[i]);
    for (let i = 0; i < o.uv.length; i++) this.uv.push(o.uv[i]);
    for (let i = 0; i < o.uv1.length; i++) this.uv1.push(o.uv1[i]);
    for (let i = 0; i < o.col.length; i++) this.col.push(o.col[i]);
    this.hasUv1 ||= o.hasUv1;
    for (const i of o.idx) this.idx.push(i + base);
  }

  /** Raw vertex data (vertex colors converted to linear, as the PBR shader expects). */
  vertexData(colors = false, uv1Kind: string | null = VertexBuffer.UV2Kind): { data: VertexData; extra: { kind: string; data: Float32Array; stride: number } | null } {
    const d = new VertexData();
    d.positions = new Float32Array(this.pos);
    d.normals = new Float32Array(this.nrm);
    d.uvs = new Float32Array(this.uv);
    d.indices = babylonWinding(this.idx, this.vertexCount);
    let extra: { kind: string; data: Float32Array; stride: number } | null = null;
    if (this.hasUv1 && uv1Kind) {
      if (uv1Kind === VertexBuffer.UV2Kind) d.uvs2 = new Float32Array(this.uv1);
      else extra = { kind: uv1Kind, data: new Float32Array(this.uv1), stride: 2 };
    }
    if (colors) {
      const c = new Float32Array((this.col.length / 3) * 4);
      for (let i = 0, j = 0; i < this.col.length; i += 3, j += 4) { c[j] = toLinear(this.col[i]); c[j + 1] = toLinear(this.col[i + 1]); c[j + 2] = toLinear(this.col[i + 2]); c[j + 3] = 1; }
      d.colors = c;
    }
    return { data: d, extra };
  }

  /** A new mesh with this geometry (not yet given a material or parent). */
  toMesh(name: string, colors = false, uv1Kind: string | null = VertexBuffer.UV2Kind): Mesh {
    const mesh = new Mesh(name, R().scene);
    const { data, extra } = this.vertexData(colors, uv1Kind);
    data.applyToMesh(mesh, false);
    if (extra) mesh.setVerticesData(extra.kind, extra.data, false, extra.stride);
    mesh.isPickable = false;
    return mesh;
  }
}

export interface PartOpts { cast?: boolean; receive?: boolean; static?: boolean; uv1Kind?: string }
export interface Part { mesh: Mesh; material: Material }

/** Gives a built mesh its material, shadow settings and (for static meshes) frozen matrices and bounds. */
export function finishMesh(mesh: Mesh, material: Material, opts: PartOpts = {}) {
  mesh.material = material;
  mesh.receiveShadows = opts.receive ?? true;
  if (opts.cast ?? true) R().addCaster(mesh);
  if (opts.static) { mesh.computeWorldMatrix(true); mesh.freezeWorldMatrix(); mesh.doNotSyncBoundingInfo = true; }
  return mesh;
}

/** A node holding one mesh per (mesh, material) pair. */
export function meshEntity(name: string, parts: Part[], opts: PartOpts = {}): TransformNode {
  const node = new TransformNode(name, R().scene);
  for (const p of parts) { finishMesh(p.mesh, p.material, { ...opts, static: false }); p.mesh.parent = node; }
  return node;
}

/**
 * A new mesh drawing `src`'s geometry (one GPU upload shared by all of them).
 * Unlike Mesh.clone this shares nothing else, so thin instances and instance
 * caches stay per mesh.
 */
export function shareGeometry(src: Mesh, name: string, parent: Node | null = null) {
  const m = new Mesh(name, src.getScene());
  src.geometry?.applyToMesh(m);
  m.parent = parent;
  m.isPickable = false;
  return m;
}

/** Disposes a node and the meshes under it (materials and textures stay: they are shared). */
export function disposeNode(n: Node | null | undefined) { n?.dispose(false, false); }

/** Layer that only shadow maps see: the main camera's mask leaves it out. */
export const SHADOW_ONLY_LAYER = 0x10000000;

let proxyMat: Material | null = null;
/**
 * Merges static shadow casters into one depth-only mesh per cell. The shadow
 * pass draws these instead of every textured part, so a block of buildings
 * costs one draw per cascade; the camera never sees them.
 */
export class ShadowProxies {
  private cells = new Map<string, { pos: number[]; nrm: number[]; idx: number[] }>();
  constructor(private cell = 128) {}

  /** Adds a builder's triangles to the proxy of the cell holding (x, z). */
  add(x: number, z: number, b: MeshBuilder) { this.addTo(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`, b); }

  addTo(key: string, b: MeshBuilder) {
    let c = this.cells.get(key);
    if (!c) this.cells.set(key, (c = { pos: [], nrm: [], idx: [] }));
    const base = c.pos.length / 3;
    for (let i = 0; i < b.pos.length; i++) { c.pos.push(b.pos[i]); c.nrm.push(b.nrm[i]); }
    for (let i = 0; i < b.idx.length; i++) c.idx.push(b.idx[i] + base);
  }

  /** Builds the proxies (static, shadow-only casters) under `parent`; returns them. */
  flush(parent: TransformNode | null, name: string): Mesh[] {
    const scene = R().scene, out: Mesh[] = [];
    proxyMat ??= (() => { const m = new StandardMaterial('shadow-proxy', scene); m.disableLighting = true; return m; })();
    for (const [key, c] of this.cells) {
      if (!c.idx.length) continue;
      const mesh = new Mesh(`${name}-shadow:${key}`, scene);
      const d = new VertexData();
      d.positions = new Float32Array(c.pos); d.normals = new Float32Array(c.nrm);
      d.indices = babylonWinding(c.idx, c.pos.length / 3);
      d.applyToMesh(mesh, false);
      mesh.parent = parent;
      mesh.layerMask = SHADOW_ONLY_LAYER;
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      mesh.material = proxyMat;
      mesh.computeWorldMatrix(true); mesh.freezeWorldMatrix(); mesh.doNotSyncBoundingInfo = true;
      R().addCaster(mesh);
      out.push(mesh);
    }
    this.cells.clear();
    return out;
  }
}

/**
 * Builders keyed by (chunk, material): `get(x, z, mat)` returns the builder
 * for the cell holding (x, z). `flush` turns them into static meshes; parts
 * that cast shadows go into per-cell shadow proxies instead of casting
 * themselves.
 */
export class ChunkedBuilders {
  private map = new Map<string, { b: MeshBuilder; mat: Material; colors: boolean; cast: boolean; uv1Kind?: string; cell: string }>();
  constructor(private cell = 128) {}
  get(x: number, z: number, mat: Material, opts: { colors?: boolean; cast?: boolean; uv1Kind?: string } = {}) {
    const cell = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    const key = `${cell}|${mat.uniqueId}|${opts.cast ?? true}`;
    let e = this.map.get(key);
    if (!e) this.map.set(key, (e = { b: new MeshBuilder(), mat, colors: !!opts.colors, cast: opts.cast ?? true, uv1Kind: opts.uv1Kind, cell }));
    return e.b;
  }
  flush(parent: TransformNode, name: string) {
    const proxies = new ShadowProxies(this.cell);
    for (const [key, e] of this.map) {
      if (e.b.empty) continue;
      const mesh = e.b.toMesh(`${name}:${key}`, e.colors, e.uv1Kind ?? VertexBuffer.UV2Kind);
      mesh.parent = parent;
      finishMesh(mesh, e.mat, { cast: false, static: true });
      if (e.cast) proxies.addTo(e.cell, e.b);
    }
    proxies.flush(parent, name);
    this.map.clear();
  }
}
