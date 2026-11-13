/**
 * Three-dimensional head- and tail-lamps for published vehicles (LampStyle
 * `3d` in Shapes.ts). One lamp is four meshes in chassis space (+x forward,
 * +y up, +z right), each a triangle list with smooth normals:
 *
 *  - `housing`: a reflector bowl recessed into the body behind the outline,
 *  - `glow`: the bulbs sitting in the bottom of the bowl (the part that lights),
 *  - `lens`: a clear dome over the opening, standing proud of the body,
 *  - `bezel`: a trim ring around the edge that covers the cut in the body.
 *
 * `lampCutter` says which points of the body lie behind the lens, so each
 * renderer can drop those triangles and the scan's own painted-on lamp never
 * pokes through the new one.
 *
 * Renderer-free: the editor preview (three.js), classic Fox Plains (three.js)
 * and Fox Lake (Babylon) all build their lamp meshes from this.
 */
import { LAMP_GRID, LAMP_H, LAMP_W, depthAt, isLampDepth, shapeContains, triangulate, type LampDepth, type LampSize, type LampStyle, type Shape, type ShapePoint } from './Shapes';

export interface LampMesh { positions: number[]; normals: number[] }
export interface LampParts { lens: LampMesh; bezel: LampMesh; housing: LampMesh; glow: LampMesh }
export interface LampPlace { x: number; y: number; z: number }

interface P2 { U: number; V: number }

const LENS_LIFT = 0.004;
const BEZEL_LIFT = 0.0065;
const BOWL_RINGS = 5;
const BULB_RINGS = 4;
const BULB_SEGMENTS = 14;
const EDGE_STEPS_MAX = 6;

/** Indexed triangles welded by position, turned into a triangle list with averaged normals. */
class Soup {
  private readonly pos: number[] = [];
  private readonly acc: number[] = [];
  private readonly idx: number[] = [];
  private readonly ids = new Map<string, number>();

  vertex(v: number[]): number {
    const key = `${Math.round(v[0] * 1e5)},${Math.round(v[1] * 1e5)},${Math.round(v[2] * 1e5)}`;
    let i = this.ids.get(key);
    if (i === undefined) {
      i = this.pos.length / 3;
      this.ids.set(key, i);
      this.pos.push(v[0], v[1], v[2]);
      this.acc.push(0, 0, 0);
    }
    return i;
  }

  /** Adds a triangle wound to face along (fx, fy, fz). */
  tri(a: number, b: number, c: number, fx: number, fy: number, fz: number): void {
    if (a === b || b === c || a === c) return;
    const p = this.pos;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-18) return;
    if (nx * fx + ny * fy + nz * fz < 0) { const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; }
    this.idx.push(a, b, c);
    for (const i of [a, b, c]) { this.acc[i * 3] += nx; this.acc[i * 3 + 1] += ny; this.acc[i * 3 + 2] += nz; }
  }

  centre(a: number, b: number, c: number): number[] {
    const p = this.pos;
    return [(p[a * 3] + p[b * 3] + p[c * 3]) / 3, (p[a * 3 + 1] + p[b * 3 + 1] + p[c * 3 + 1]) / 3, (p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2]) / 3];
  }

  mesh(): LampMesh {
    const positions: number[] = [], normals: number[] = [];
    for (const i of this.idx) {
      const nx = this.acc[i * 3], ny = this.acc[i * 3 + 1], nz = this.acc[i * 3 + 2];
      const l = Math.hypot(nx, ny, nz) || 1;
      positions.push(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      normals.push(nx / l, ny / l, nz / l);
    }
    return { positions, normals };
  }
}

/** The outline in metres around the lamp point, counter-clockwise, its edges split so rings follow a curved body. */
function outlineOf(shape: Shape, w: number, h: number): { corners: P2[]; ring: P2[] } {
  const corners = shape.map(s => ({ U: (s.u - 0.5) * w, V: (s.v - 0.5) * h }));
  let a = 0;
  for (let i = 0; i < corners.length; i++) { const p = corners[i], q = corners[(i + 1) % corners.length]; a += p.U * q.V - q.U * p.V; }
  if (a < 0) corners.reverse();
  const cell = Math.max(w, h) / (LAMP_GRID - 1);
  const ring: P2[] = [];
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i], q = corners[(i + 1) % corners.length];
    const n = Math.min(EDGE_STEPS_MAX, Math.max(1, Math.ceil(Math.hypot(q.U - p.U, q.V - p.V) / cell)));
    for (let k = 0; k < n; k++) ring.push({ U: p.U + ((q.U - p.U) * k) / n, V: p.V + ((q.V - p.V) * k) / n });
  }
  return { corners, ring };
}

/** Outward unit directions at each point of a counter-clockwise ring, lengthened at corners so an offset keeps its width. */
function ringNormals(ring: P2[]): P2[] {
  const n = ring.length;
  const edge = ring.map((p, i) => {
    const q = ring[(i + 1) % n];
    const l = Math.hypot(q.U - p.U, q.V - p.V) || 1;
    return { U: (q.V - p.V) / l, V: -(q.U - p.U) / l };
  });
  return ring.map((_, i) => {
    const a = edge[(i + n - 1) % n], b = edge[i];
    const l = Math.hypot(a.U + b.U, a.V + b.V);
    if (l < 1e-6) return b;
    const m = { U: (a.U + b.U) / l, V: (a.V + b.V) / l };
    const miter = 1 / Math.max(0.5, m.U * b.U + m.V * b.V);
    return { U: m.U * miter, V: m.V * miter };
  });
}

function edgeDistance(corners: P2[], U: number, V: number): number {
  let best = Infinity;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const dU = b.U - a.U, dV = b.V - a.V;
    const l2 = dU * dU + dV * dV;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((U - a.U) * dU + (V - a.V) * dV) / l2)) : 0;
    best = Math.min(best, Math.hypot(U - (a.U + dU * t), V - (a.V + dV * t)));
  }
  return best;
}

/** Splits triangles in u/v into n² pieces each, the same n for all so shared edges match. */
function refine(tris: ShapePoint[][], max: number): ShapePoint[][] {
  const len = (a: ShapePoint, b: ShapePoint) => Math.hypot(a.u - b.u, a.v - b.v);
  let longest = 0;
  for (const t of tris) longest = Math.max(longest, len(t[0], t[1]), len(t[1], t[2]), len(t[2], t[0]));
  const n = Math.min(12, Math.max(1, Math.ceil(longest / max)));
  if (n === 1) return tris;
  const out: ShapePoint[][] = [];
  for (const [a, b, c] of tris) {
    const at = (i: number, j: number) => ({ u: a.u + ((b.u - a.u) * i + (c.u - a.u) * j) / n, v: a.v + ((b.v - a.v) * i + (c.v - a.v) * j) / n });
    for (let j = 0; j < n; j++) for (let i = 0; i < n - j; i++) {
      out.push([at(i, j), at(i + 1, j), at(i, j + 1)]);
      if (i + j < n - 1) out.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  }
  return out;
}

interface Frame {
  w: number; h: number; dir: 1 | -1;
  corners: P2[]; ring: P2[]; normals: P2[]; centre: P2;
  /** Chassis-space point for a spot on the plate, `lift` metres proud of the body (negative: behind it). */
  at(U: number, V: number, lift: number): number[];
}

function frameOf(p: LampPlace, shape: Shape, side: 1 | -1, size: LampSize | undefined, depth: LampDepth | undefined, facing: number): Frame {
  const w = size?.w ?? LAMP_W, h = size?.h ?? LAMP_H;
  const dir = facing < 0 ? -1 : 1;
  const grid = depth && isLampDepth(depth) ? depth : null;
  const { corners, ring } = outlineOf(shape, w, h);
  const centre = { U: 0, V: 0 };
  for (const c of ring) { centre.U += c.U / ring.length; centre.V += c.V / ring.length; }
  const surface = (U: number, V: number) => grid ? depthAt(grid, U / w + 0.5, V / h + 0.5) : 0;
  return {
    w, h, dir, corners, ring, normals: ringNormals(ring), centre,
    at: (U, V, lift) => [p.x + surface(U, V) + dir * lift, p.y + V, side * (p.z + U)],
  };
}

/**
 * The four meshes of one 3D lamp. `side` 1 is the right-hand lamp at the
 * point's z, −1 its mirror image; `facing` is 1 for headlights and −1 for
 * taillights. A lamp with no outline of its own passes LAMP_BOX and its plate size.
 */
export function lampParts(p: LampPlace, shape: Shape, side: 1 | -1, size: LampSize | undefined, depth: LampDepth | undefined, facing: number, style: LampStyle): LampParts {
  const f = frameOf(p, shape, side, size, depth, facing);
  const { dir, ring, normals, centre } = f;
  const n = ring.length;
  const rimIn = style.rim * 0.65, rimOut = style.rim * 0.35;

  /** A loop of vertices: the outline moved `offset` metres outward, shrunk toward the middle by `scale`, at `lift`. */
  const loop = (soup: Soup, offset: number, scale: number, lift: number) => ring.map((c, i) => {
    const U = centre.U + (c.U + normals[i].U * offset - centre.U) * scale;
    const V = centre.V + (c.V + normals[i].V * offset - centre.V) * scale;
    return soup.vertex(f.at(U, V, lift));
  });
  const axis = f.at(centre.U, centre.V, 0);

  const bezel = new Soup();
  const bezelLoops = [
    loop(bezel, rimOut, 1, -0.002),
    loop(bezel, rimOut * 0.45, 1, BEZEL_LIFT),
    loop(bezel, -rimIn * 0.55, 1, BEZEL_LIFT),
    loop(bezel, -rimIn, 1, 0.0005),
  ];
  for (let k = 0; k + 1 < bezelLoops.length; k++) {
    const A = bezelLoops[k], B = bezelLoops[k + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      bezel.tri(A[i], A[j], B[j], dir, 0, 0);
      bezel.tri(A[i], B[j], B[i], dir, 0, 0);
    }
  }

  const housing = new Soup();
  const bowl: number[][] = [];
  for (let k = 0; k <= BOWL_RINGS; k++) {
    const t = k / BOWL_RINGS;
    bowl.push(loop(housing, -rimIn * 0.9, 1 - 0.6 * Math.pow(t, 1.5), -style.recess * (1 - (1 - t) * (1 - t))));
  }
  const inward = (soup: Soup, a: number, b: number, c: number) => {
    const m = soup.centre(a, b, c);
    soup.tri(a, b, c, dir * 0.2 * Math.max(f.w, f.h), axis[1] - m[1], axis[2] - m[2]);
  };
  for (let k = 0; k < BOWL_RINGS; k++) {
    const A = bowl[k], B = bowl[k + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      inward(housing, A[i], A[j], B[j]);
      inward(housing, A[i], B[j], B[i]);
    }
  }
  const floor = housing.vertex(f.at(centre.U, centre.V, -style.recess));
  const last = bowl[BOWL_RINGS];
  for (let i = 0; i < n; i++) housing.tri(floor, last[i], last[(i + 1) % n], dir, 0, 0);

  const glow = new Soup();
  const radius = Math.max(0.006, Math.min(0.2 * Math.min(f.w, f.h), 0.045, style.recess * 0.75));
  const spots: P2[] = f.w > f.h * 1.7 ? [{ U: -0.16 * f.w, V: 0 }, { U: 0.16 * f.w, V: 0 }]
    : f.h > f.w * 1.7 ? [{ U: 0, V: -0.16 * f.h }, { U: 0, V: 0.16 * f.h }]
    : [{ U: 0, V: 0 }];
  for (const s of spots) {
    const cU = centre.U + s.U, cV = centre.V + s.V;
    const base = -style.recess + 0.001;
    const middle = f.at(cU, cV, base);
    const rings: number[][] = [];
    for (let j = 0; j < BULB_RINGS; j++) {
      const lat = (j / BULB_RINGS) * (Math.PI / 2);
      const r = radius * Math.cos(lat), lift = base + radius * 0.9 * Math.sin(lat);
      rings.push(Array.from({ length: BULB_SEGMENTS }, (_, i) => {
        const a = (i / BULB_SEGMENTS) * Math.PI * 2;
        return glow.vertex(f.at(cU + r * Math.cos(a), cV + r * Math.sin(a), lift));
      }));
    }
    const tip = glow.vertex(f.at(cU, cV, base + radius * 0.9));
    const outward = (a: number, b: number, c: number) => {
      const m = glow.centre(a, b, c);
      glow.tri(a, b, c, m[0] - middle[0] + dir * radius * 0.2, m[1] - middle[1], m[2] - middle[2]);
    };
    for (let j = 0; j + 1 < rings.length; j++) for (let i = 0; i < BULB_SEGMENTS; i++) {
      const k = (i + 1) % BULB_SEGMENTS;
      outward(rings[j][i], rings[j][k], rings[j + 1][k]);
      outward(rings[j][i], rings[j + 1][k], rings[j + 1][i]);
    }
    const top = rings[rings.length - 1];
    for (let i = 0; i < BULB_SEGMENTS; i++) outward(tip, top[i], top[(i + 1) % BULB_SEGMENTS]);
  }

  const lens = new Soup();
  const idx = triangulate(shape);
  const coarse: ShapePoint[][] = [];
  for (let i = 0; i < idx.length; i += 3) coarse.push([shape[idx[i]], shape[idx[i + 1]], shape[idx[i + 2]]]);
  const fine = refine(coarse, 1 / (LAMP_GRID - 1));
  const metric = (q: ShapePoint) => ({ U: (q.u - 0.5) * f.w, V: (q.v - 0.5) * f.h });
  let deepest = 1e-6;
  for (const t of fine) for (const q of t) { const m = metric(q); deepest = Math.max(deepest, edgeDistance(f.corners, m.U, m.V)); }
  const dome = (q: ShapePoint) => {
    const m = metric(q);
    const k = 1 - Math.min(1, edgeDistance(f.corners, m.U, m.V) / deepest);
    return lens.vertex(f.at(m.U, m.V, LENS_LIFT + style.bulge * (1 - k * k)));
  };
  for (const [a, b, c] of fine) lens.tri(dome(a), dome(b), dome(c), dir, 0, 0);

  return { lens: lens.mesh(), bezel: bezel.mesh(), housing: housing.mesh(), glow: glow.mesh() };
}

/**
 * A test for chassis-space points: true where the body lies behind this lamp's
 * lens (inside the outline, a little in from its edge so the trim ring covers
 * the cut, and between the back of the bowl and the top of the lens).
 */
export function lampCutter(p: LampPlace, shape: Shape, side: 1 | -1, size: LampSize | undefined, depth: LampDepth | undefined, facing: number, style: LampStyle): (x: number, y: number, z: number) => boolean {
  const w = size?.w ?? LAMP_W, h = size?.h ?? LAMP_H;
  const dir = facing < 0 ? -1 : 1;
  const grid = depth && isLampDepth(depth) ? depth : null;
  const { corners } = outlineOf(shape, w, h);
  const margin = style.rim * 0.3;
  const behind = style.recess + 0.02, ahead = style.bulge + 0.04;
  return (x, y, z) => {
    const U = side * z - p.z, V = y - p.y;
    if (Math.abs(U) > w / 2 || Math.abs(V) > h / 2) return false;
    const u = U / w + 0.5, v = V / h + 0.5;
    if (!shapeContains(shape, u, v)) return false;
    const along = dir * (x - p.x - (grid ? depthAt(grid, u, v) : 0));
    if (along < -behind || along > ahead) return false;
    return edgeDistance(corners, U, V) >= margin;
  };
}
