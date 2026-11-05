/**
 * MeshBuilder: accumulates triangles (positions, normals, UVs and optional
 * sRGB vertex colors) and turns them into one pc.Mesh. Everything static in
 * the town is built this way and merged per material and per chunk, so a
 * street of houses or a downtown block is a handful of draw calls.
 *
 * UVs on boxes are world-space (metres × `uv`), so textures keep their real
 * size whatever the box size. An optional transform places parts (wheels,
 * lamp heads, tree canopies) without leaving the builder.
 */
import * as pc from 'playcanvas';

export type RGB = [number, number, number];
const WHITE: RGB = [1, 1, 1];

export function hexRGB(hex: string | number): RGB {
  const n = typeof hex === 'number' ? hex : parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scaleRGB = (a: RGB, k: number): RGB => [Math.min(1, a[0] * k), Math.min(1, a[1] * k), Math.min(1, a[2] * k)];

const _v = new pc.Vec3(), _n = new pc.Vec3();

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
  private m: pc.Mat4 | null = null;
  private nm = new pc.Mat3();

  get empty() { return this.idx.length === 0; }
  get vertexCount() { return this.pos.length / 3; }

  /** Applies `m` to every vertex added until `transform(null)`. */
  transform(m: pc.Mat4 | null) {
    this.m = m;
    if (m) this.nm.invertMat4(m).transpose();
    return this;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: RGB = this.color) {
    if (this.m) {
      _v.set(x, y, z); this.m.transformPoint(_v, _v); x = _v.x; y = _v.y; z = _v.z;
      _n.set(nx, ny, nz); this.nm.transformVector(_n, _n); _n.normalize(); nx = _n.x; ny = _n.y; nz = _n.z;
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
    // +X / -X
    this.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[-z1 * s + ou, y0 * s + ov], [-z0 * s + ou, y0 * s + ov], [-z0 * s + ou, y1 * s + ov], [-z1 * s + ou, y1 * s + ov]], c);
    this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[z0 * s + ou, y0 * s + ov], [z1 * s + ou, y0 * s + ov], [z1 * s + ou, y1 * s + ov], [z0 * s + ou, y1 * s + ov]], c);
    // +Z / -Z
    this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[x0 * s + ou, y0 * s + ov], [x1 * s + ou, y0 * s + ov], [x1 * s + ou, y1 * s + ov], [x0 * s + ou, y1 * s + ov]], c);
    this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[-x1 * s + ou, y0 * s + ov], [-x0 * s + ou, y0 * s + ov], [-x0 * s + ou, y1 * s + ov], [-x1 * s + ou, y1 * s + ov]], c);
    if (!o.skipTop) this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[x0 * s, z1 * s], [x1 * s, z1 * s], [x1 * s, z0 * s], [x0 * s, z0 * s]], c);
    if (!o.skipBottom) this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [[x0 * s, z0 * s], [x1 * s, z0 * s], [x1 * s, z1 * s], [x0 * s, z1 * s]], c);
  }

  /** Box centered at (cx, cy, cz), turned `yaw` radians about +Y. */
  orientedBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number, o: BoxOpts = {}) {
    const prev = this.m;
    const m = new pc.Mat4().setTRS(new pc.Vec3(cx, cy, cz), new pc.Quat().setFromEulerAngles(0, yaw * pc.math.RAD_TO_DEG, 0), pc.Vec3.ONE);
    if (prev) m.mul2(prev, m);
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
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, seed = 1, rough = 0.12, c: RGB = this.color) {
    const dirs: number[][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const faces = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
    const N = 3;
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
    const d = new pc.Vec3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    if (len < 1e-5) return;
    d.mulScalar(1 / len);
    const q = new pc.Quat();
    const axis = new pc.Vec3().cross(pc.Vec3.UP, d);
    if (axis.length() < 1e-6) q.setFromEulerAngles(d.y < 0 ? 180 : 0, 0, 0);
    else q.setFromAxisAngle(axis.normalize(), Math.acos(Math.max(-1, Math.min(1, d.y))) * pc.math.RAD_TO_DEG);
    const prev = this.m;
    const m = new pc.Mat4().setTRS(new pc.Vec3(a[0], a[1], a[2]), q, pc.Vec3.ONE);
    if (prev) m.mul2(prev, m);
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
    this.pos.push(...o.pos); this.nrm.push(...o.nrm); this.uv.push(...o.uv); this.uv1.push(...o.uv1); this.col.push(...o.col);
    this.hasUv1 ||= o.hasUv1;
    for (const i of o.idx) this.idx.push(i + base);
  }

  toMesh(device: pc.GraphicsDevice, colors = false): pc.Mesh {
    const mesh = new pc.Mesh(device);
    mesh.setPositions(new Float32Array(this.pos));
    mesh.setNormals(new Float32Array(this.nrm));
    mesh.setUvs(0, new Float32Array(this.uv));
    if (this.hasUv1) mesh.setUvs(1, new Float32Array(this.uv1));
    if (colors) {
      const c = new Uint8Array((this.col.length / 3) * 4);
      for (let i = 0, j = 0; i < this.col.length; i += 3, j += 4) { c[j] = this.col[i] * 255; c[j + 1] = this.col[i + 1] * 255; c[j + 2] = this.col[i + 2] * 255; c[j + 3] = 255; }
      mesh.setColors32(c);
    }
    mesh.setIndices(this.vertexCount > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx));
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    return mesh;
  }
}

/** A render entity holding one mesh instance per (mesh, material). */
export function meshEntity(name: string, parts: { mesh: pc.Mesh; material: pc.Material }[], opts: { cast?: boolean; receive?: boolean; layers?: number[] } = {}) {
  const e = new pc.Entity(name);
  const mis = parts.map(p => new pc.MeshInstance(p.mesh, p.material));
  e.addComponent('render', { meshInstances: mis, castShadows: opts.cast ?? true, receiveShadows: opts.receive ?? true, ...(opts.layers ? { layers: opts.layers } : {}) });
  return e;
}

/**
 * Builders keyed by (chunk, material): `get(x, z, mat)` returns the builder
 * for the 128 m cell holding (x, z). `flush` turns them into entities.
 */
export class ChunkedBuilders {
  private map = new Map<string, { b: MeshBuilder; mat: pc.Material; colors: boolean; cast: boolean }>();
  constructor(private cell = 128) {}
  get(x: number, z: number, mat: pc.Material, opts: { colors?: boolean; cast?: boolean } = {}) {
    const key = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}|${mat.id}|${opts.cast ?? true}`;
    let e = this.map.get(key);
    if (!e) this.map.set(key, (e = { b: new MeshBuilder(), mat, colors: !!opts.colors, cast: opts.cast ?? true }));
    return e.b;
  }
  flush(device: pc.GraphicsDevice, parent: pc.Entity, name: string) {
    for (const [key, e] of this.map) {
      if (e.b.empty) continue;
      const ent = meshEntity(`${name}:${key}`, [{ mesh: e.b.toMesh(device, e.colors), material: e.mat }], { cast: e.cast });
      parent.addChild(ent);
    }
    this.map.clear();
  }
}
