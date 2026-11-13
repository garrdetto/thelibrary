/**
 * Where a vehicle's 3D lamps go, and which of the body's triangles they hide.
 * Renderer-free, so the editor preview and every game build the same lamps
 * from a published record and cut the same hole behind each lens.
 */
import { lampCutter } from './Lamps3d';
import { LAMP_BOX, LAMP_H, LAMP_W, isLampDepth, type LampDepth, type LampShapes, type LampSize, type LampStyle, type Shape } from './Shapes';

export interface LampPoint { x: number; y: number; z: number }

/** Plate sizes of lamps with no traced outline: the boxes the flat lamps are drawn as. */
export const LAMP_BOX_SIZE: Record<'head' | 'tail', LampSize> = { head: { w: 0.24, h: 0.11 }, tail: { w: 0.2, h: 0.12 } };

export interface Lamp3d {
  kind: 'head' | 'tail';
  p: LampPoint;
  side: 1 | -1;
  shape: Shape;
  size: LampSize | undefined;
  depth: LampDepth | undefined;
  facing: 1 | -1;
  style: LampStyle;
}

/**
 * Every 3D lamp of a vehicle: each marked point on both sides (once on the
 * centreline), with the outline, size and surface `lampParts` builds it from.
 * Lamps without a `3d` style are left to the flat plates.
 */
export function lamps3d(lights: { head: readonly LampPoint[]; tail: readonly LampPoint[] }, shapes: LampShapes | undefined): Lamp3d[] {
  const out: Lamp3d[] = [];
  for (const kind of ['head', 'tail'] as const) {
    const style = kind === 'head' ? shapes?.headStyle : shapes?.tailStyle;
    if (!style || style.kind !== '3d') continue;
    const shape = kind === 'head' ? shapes?.head : shapes?.tail;
    const size = shape ? (kind === 'head' ? shapes?.headSize : shapes?.tailSize) : LAMP_BOX_SIZE[kind];
    const depth = shape ? (kind === 'head' ? shapes?.headDepth : shapes?.tailDepth) : undefined;
    for (const p of lights[kind]) for (const side of (p.z === 0 ? [1] : [1, -1]) as (1 | -1)[]) {
      out.push({ kind, p, side, shape: shape ?? LAMP_BOX, size, depth, facing: kind === 'head' ? 1 : -1, style });
    }
  }
  return out;
}

/** The space behind one lens, with a box around it so most triangles are ruled out cheaply. */
export interface LampCut {
  test(x: number, y: number, z: number): boolean;
  min: [number, number, number];
  max: [number, number, number];
}

/** The cuts of the lamps whose style hides the body behind them. */
export function lampCuts(lamps: readonly Lamp3d[]): LampCut[] {
  return lamps.filter(lamp => lamp.style.cut).map(lamp => {
    const w = lamp.size?.w ?? LAMP_W, h = lamp.size?.h ?? LAMP_H;
    let low = 0, high = 0;
    if (lamp.depth && isLampDepth(lamp.depth)) for (const d of lamp.depth) { low = Math.min(low, d); high = Math.max(high, d); }
    const reach = lamp.style.recess + lamp.style.bulge + 0.08;
    const z = lamp.side * lamp.p.z;
    return {
      test: lampCutter(lamp.p, lamp.shape, lamp.side, lamp.size, lamp.depth, lamp.facing, lamp.style),
      min: [lamp.p.x + low - reach, lamp.p.y - h / 2, z - w / 2],
      max: [lamp.p.x + high + reach, lamp.p.y + h / 2, z + w / 2],
    };
  });
}

/**
 * A mesh's triangle list without the triangles whose centre lies in a cut.
 * `positions` are the mesh's own (x, y, z, …) and `matrix` (4 × 4,
 * column-major) takes them into the chassis frame. Null when nothing is cut.
 */
export function cutTriangles(positions: ArrayLike<number>, index: ArrayLike<number> | null, matrix: ArrayLike<number>, cuts: readonly LampCut[]): Uint32Array | null {
  if (!cuts.length) return null;
  const count = Math.floor((index ? index.length : positions.length / 3) / 3);
  const m = matrix;
  let kept: Uint32Array | null = null, n = 0;
  for (let t = 0; t < count; t++) {
    const a = index ? index[t * 3] : t * 3, b = index ? index[t * 3 + 1] : t * 3 + 1, c = index ? index[t * 3 + 2] : t * 3 + 2;
    const lx = (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3;
    const ly = (positions[a * 3 + 1] + positions[b * 3 + 1] + positions[c * 3 + 1]) / 3;
    const lz = (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3;
    const x = m[0] * lx + m[4] * ly + m[8] * lz + m[12], y = m[1] * lx + m[5] * ly + m[9] * lz + m[13], z = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
    let cut = false;
    for (const k of cuts) {
      if (x < k.min[0] || x > k.max[0] || y < k.min[1] || y > k.max[1] || z < k.min[2] || z > k.max[2]) continue;
      if (k.test(x, y, z)) { cut = true; break; }
    }
    if (cut) {
      if (!kept) {
        kept = new Uint32Array(count * 3);
        for (let i = 0; i < t * 3; i++) kept[i] = index ? index[i] : i;
        n = t * 3;
      }
      continue;
    }
    if (kept) { kept[n++] = a; kept[n++] = b; kept[n++] = c; }
  }
  return kept ? kept.slice(0, n) : null;
}
