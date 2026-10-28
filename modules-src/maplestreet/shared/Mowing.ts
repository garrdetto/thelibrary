/**
 * Lawn coverage model. Real lawn stripes come from grass blades being bent
 * toward or away from the viewer, so the shade depends only on mowing
 * direction. We store one shade code per 1 m cell (0 = uncut).
 */
import type { MowStroke } from './Protocol';
import type { LotDef } from './WorldLayout';

export type Shade = 0 | 1 | 2 | 3 | 4;

export function stripeShade(hx: number, hz: number): Shade {
  if (Math.abs(hz) >= Math.abs(hx)) return hz >= 0 ? 1 : 2;   // front/back stripes
  return hx >= 0 ? 3 : 4;                                      // cross-cut stripes
}

/** Cells touched by a stroke (sampled on a 0.4 m lattice across the deck). */
export function strokeCells(lot: LotDef, s: MowStroke): number[] {
  const out = new Set<number>();
  const len = Math.hypot(s.hx, s.hz) || 1;
  const fx = s.hx / len, fz = s.hz / len;     // forward
  const rx = -fz, rz = fx;                    // right
  for (let a = -s.len / 2; a <= s.len / 2 + 1e-6; a += 0.4) {
    for (let b = -s.width / 2; b <= s.width / 2 + 1e-6; b += 0.4) {
      const x = Math.floor(s.x + fx * a + rx * b) - lot.x;
      const z = Math.floor(s.z + fz * a + rz * b) - lot.z;
      if (x >= 0 && z >= 0 && x < lot.w && z < lot.d) out.add(z * lot.w + x);
    }
  }
  return [...out];
}

export const encodeCoverage = (c: Uint8Array) => Array.from(c).join('');
export const decodeCoverage = (s: string, n: number) => {
  const c = new Uint8Array(n);
  for (let i = 0; i < Math.min(n, s.length); i++) c[i] = s.charCodeAt(i) - 48;
  return c;
};
