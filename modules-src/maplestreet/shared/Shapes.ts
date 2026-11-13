/**
 * Custom outlines for published vehicles. A shape is a polygon drawn in the
 * editor on a unit square (u across, v up), so it follows its part when the
 * part's box is resized. Every shape is mirrored for the other side of the
 * vehicle, which keeps the left and right parts identical.
 *
 * Doors: u is back→front, v is bottom→top of the box (side view).
 * Hood and trunk: u is back→front, v is the centerline (0) to the outer edge (1)
 * of the half width; the other half is the mirror image.
 * Lamps: u runs inner→outer across a LAMP_W plate, v bottom→top over LAMP_H
 * (or the traced lamp's own size in `headSize` / `tailSize`).
 */
export interface ShapePoint { u: number; v: number }
export type Shape = ShapePoint[];
/** Plate size in metres for a lamp traced on the model (missing: LAMP_W × LAMP_H). */
export interface LampSize { w: number; h: number }
/**
 * A traced lamp's surface: LAMP_GRID × LAMP_GRID heights in metres along x
 * (forward), relative to the lamp point, sampled from the model over the
 * lamp's u/v box (row by v, bottom first). The lens then follows the body.
 */
export type LampDepth = number[];
/**
 * How a lamp is built. `flat` (or no style) is the thin glowing plate. `3d` is
 * a real lamp: a reflector bowl recessed into the body with bulbs in it, a
 * domed lens over the opening and a trim ring around its edge.
 */
export interface LampStyle {
  kind: 'flat' | '3d';
  /** How far the middle of the lens stands proud of the body, metres. */
  bulge: number;
  /** How deep the reflector bowl goes behind the body's surface, metres. */
  recess: number;
  /** Width of the trim ring around the lens, metres. It covers the edge of the opening cut into the body. */
  rim: number;
  /** Cut the body's own surface away behind the lens, so none of it shows through the light. */
  cut: boolean;
}
export interface LampShapes { head?: Shape; tail?: Shape; headSize?: LampSize; tailSize?: LampSize; headDepth?: LampDepth; tailDepth?: LampDepth; headStyle?: LampStyle; tailStyle?: LampStyle }

export const LAMP_STYLE_LIMITS = { bulgeMax: 0.08, recessMin: 0.01, recessMax: 0.25, rimMin: 0.004, rimMax: 0.06 } as const;
export const DEFAULT_LAMP_STYLE: LampStyle = { kind: '3d', bulge: 0.012, recess: 0.06, rim: 0.016, cut: true };
/** The outline of a lamp that has none of its own: the whole plate. */
export const LAMP_BOX: Shape = [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }, { u: 0, v: 1 }];

export const isLampStyle = (s: unknown): s is LampStyle => {
  const o = s as LampStyle, L = LAMP_STYLE_LIMITS;
  const within = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  return !!o && typeof o === 'object' && (o.kind === 'flat' || o.kind === '3d') && within(o.bulge, 0, L.bulgeMax)
    && within(o.recess, L.recessMin, L.recessMax) && within(o.rim, L.rimMin, L.rimMax) && typeof o.cut === 'boolean';
};

export const SHAPE_LIMITS = { minPoints: 3, maxPoints: 32 } as const;
export const LAMP_W = 0.5;
export const LAMP_H = 0.3;
export const LAMP_DEPTH = 0.06;
export const LAMP_SIZE_LIMITS = { min: 0.02, max: 2 } as const;
export const LAMP_GRID = 12;
export const LAMP_DEPTH_LIMIT = 1.5;
export const LAMP_PROUD = 0.008;
export const LAMP_SHELL = 0.012;

export const isLampDepth = (d: unknown): d is LampDepth =>
  Array.isArray(d) && d.length === LAMP_GRID * LAMP_GRID && d.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= LAMP_DEPTH_LIMIT);

const isLampSize = (z: unknown): z is LampSize => {
  const o = z as LampSize;
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= LAMP_SIZE_LIMITS.min && n <= LAMP_SIZE_LIMITS.max;
  return !!o && typeof o === 'object' && ok(o.w) && ok(o.h);
};

export function area(s: Shape) {
  let a = 0;
  for (let i = 0; i < s.length; i++) { const p = s[i], q = s[(i + 1) % s.length]; a += p.u * q.v - q.u * p.v; }
  return a / 2;
}

export const isValidShape = (s: unknown): s is Shape =>
  Array.isArray(s) && s.length >= SHAPE_LIMITS.minPoints && s.length <= SHAPE_LIMITS.maxPoints
  && s.every(p => !!p && typeof p === 'object' && Number.isFinite(p.u) && Number.isFinite(p.v) && p.u >= 0 && p.u <= 1 && p.v >= 0 && p.v <= 1)
  && Math.abs(area(s)) > 1e-4;

export const isValidLampShapes = (s: unknown): s is LampShapes => {
  const o = s as LampShapes;
  return !!o && typeof o === 'object' && (o.head === undefined || isValidShape(o.head)) && (o.tail === undefined || isValidShape(o.tail))
    && (o.headSize === undefined || isLampSize(o.headSize)) && (o.tailSize === undefined || isLampSize(o.tailSize))
    && (o.headDepth === undefined || isLampDepth(o.headDepth)) && (o.tailDepth === undefined || isLampDepth(o.tailDepth))
    && (o.headStyle === undefined || isLampStyle(o.headStyle)) && (o.tailStyle === undefined || isLampStyle(o.tailStyle));
};

/** Bilinear height from a depth grid at (u, v) in 0..1. */
export function depthAt(d: LampDepth, u: number, v: number) {
  const n = LAMP_GRID - 1;
  const gu = Math.min(n, Math.max(0, u * n)), gv = Math.min(n, Math.max(0, v * n));
  const i = Math.min(n - 1, Math.floor(gu)), j = Math.min(n - 1, Math.floor(gv));
  const fu = gu - i, fv = gv - j;
  const g = (a: number, b: number) => d[b * LAMP_GRID + a];
  return (g(i, j) * (1 - fu) + g(i + 1, j) * fu) * (1 - fv) + (g(i, j + 1) * (1 - fu) + g(i + 1, j + 1) * fu) * fv;
}

/** Split every triangle (u/v corners) into n² pieces, the same n for all so shared edges match. */
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

/** Even-odd point-in-polygon test. */
export function shapeContains(s: Shape, u: number, v: number) {
  let inside = false;
  for (let i = 0, j = s.length - 1; i < s.length; j = i++) {
    const a = s[i], b = s[j];
    if ((a.v > v) !== (b.v > v) && u < ((b.u - a.u) * (v - a.v)) / (b.v - a.v) + a.u) inside = !inside;
  }
  return inside;
}

/** Ear clipping: triangle index triples into `s` (counter-clockwise). */
export function triangulate(s: Shape): number[] {
  const idx = s.map((_, i) => i);
  if (area(s) < 0) idx.reverse();
  const out: number[] = [];
  const cross = (a: ShapePoint, b: ShapePoint, c: ShapePoint) => (b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u);
  let guard = idx.length * idx.length;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = s[ia], b = s[ib], c = s[ic];
      if (cross(a, b, c) <= 1e-9) continue;
      const blocked = idx.some(k => {
        if (k === ia || k === ib || k === ic) return false;
        const p = s[k];
        return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
      });
      if (blocked) continue;
      out.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) { out.push(idx[0], idx[1], idx[2]); idx.splice(1, 1); }
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

/**
 * A thin plate for one lamp in chassis space (+x forward), as a flat list of
 * triangle corners (x, y, z, …) facing both ways. `side` 1 is the right-hand
 * lamp at the point's z; −1 is its mirror image.
 */
export function lampTriangles(p: { x: number; y: number; z: number }, shape: Shape, side: 1 | -1, size?: LampSize, depth?: LampDepth, facing = 1): number[] {
  if (depth && isLampDepth(depth)) return lampShell(p, shape, side, size, depth, facing);
  const tris = triangulate(shape);
  const w = size?.w ?? LAMP_W, h = size?.h ?? LAMP_H;
  const at = (pt: ShapePoint, x: number) => [x, p.y + (pt.v - 0.5) * h, side * (p.z + (pt.u - 0.5) * w)];
  const front = p.x + LAMP_DEPTH / 2, back = p.x - LAMP_DEPTH / 2;
  const out: number[] = [];
  const push = (...v: number[][]) => { for (const c of v) out.push(c[0], c[1], c[2]); };
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [shape[tris[i]], shape[tris[i + 1]], shape[tris[i + 2]]];
    push(at(a, front), at(b, front), at(c, front), at(c, front), at(b, front), at(a, front));
    push(at(a, back), at(b, back), at(c, back), at(c, back), at(b, back), at(a, back));
  }
  for (let i = 0; i < shape.length; i++) {
    const a = shape[i], b = shape[(i + 1) % shape.length];
    push(at(a, back), at(b, back), at(b, front), at(a, back), at(b, front), at(a, front));
    push(at(b, front), at(b, back), at(a, back), at(a, front), at(b, front), at(a, back));
  }
  return out;
}

/**
 * A lens that follows the body: the outline is split into small triangles and
 * every corner sits on the traced surface, just proud of it (`out` 1 for
 * forward-facing headlights, −1 for taillights), with a thin shell behind.
 */
function lampShell(p: { x: number; y: number; z: number }, shape: Shape, side: 1 | -1, size: LampSize | undefined, depth: LampDepth, out: number): number[] {
  const idx = triangulate(shape);
  const w = size?.w ?? LAMP_W, h = size?.h ?? LAMP_H;
  const tris: ShapePoint[][] = [];
  for (let i = 0; i < idx.length; i += 3) tris.push([shape[idx[i]], shape[idx[i + 1]], shape[idx[i + 2]]]);
  const fine = refine(tris, 1 / (LAMP_GRID - 1));
  const dir = out < 0 ? -1 : 1;
  const at = (pt: ShapePoint, lift: number) => [p.x + depthAt(depth, pt.u, pt.v) + dir * lift, p.y + (pt.v - 0.5) * h, side * (p.z + (pt.u - 0.5) * w)];
  const outer = LAMP_PROUD, inner = LAMP_PROUD - LAMP_SHELL;
  const list: number[] = [];
  const push = (...v: number[][]) => { for (const c of v) list.push(c[0], c[1], c[2]); };
  for (const [a, b, c] of fine) {
    push(at(a, outer), at(b, outer), at(c, outer), at(c, outer), at(b, outer), at(a, outer));
    push(at(a, inner), at(b, inner), at(c, inner), at(c, inner), at(b, inner), at(a, inner));
  }
  const steps = Math.max(1, Math.ceil(LAMP_GRID / 2));
  for (let i = 0; i < shape.length; i++) {
    const s = shape[i], e = shape[(i + 1) % shape.length];
    for (let k = 0; k < steps; k++) {
      const a = { u: s.u + ((e.u - s.u) * k) / steps, v: s.v + ((e.v - s.v) * k) / steps };
      const b = { u: s.u + ((e.u - s.u) * (k + 1)) / steps, v: s.v + ((e.v - s.v) * (k + 1)) / steps };
      push(at(a, inner), at(b, inner), at(b, outer), at(a, inner), at(b, outer), at(a, outer));
      push(at(b, outer), at(b, inner), at(a, inner), at(a, outer), at(b, outer), at(a, inner));
    }
  }
  return list;
}
