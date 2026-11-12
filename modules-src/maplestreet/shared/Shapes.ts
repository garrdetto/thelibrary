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
export interface LampShapes { head?: Shape; tail?: Shape; headSize?: LampSize; tailSize?: LampSize }

export const SHAPE_LIMITS = { minPoints: 3, maxPoints: 32 } as const;
export const LAMP_W = 0.5;
export const LAMP_H = 0.3;
export const LAMP_DEPTH = 0.06;
export const LAMP_SIZE_LIMITS = { min: 0.02, max: 2 } as const;

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
    && (o.headSize === undefined || isLampSize(o.headSize)) && (o.tailSize === undefined || isLampSize(o.tailSize));
};

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
export function lampTriangles(p: { x: number; y: number; z: number }, shape: Shape, side: 1 | -1, size?: LampSize): number[] {
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
