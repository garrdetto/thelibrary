/**
 * The finished ground: natural terrain (`Base.ts`) graded around everything
 * built on it. Inside a street's right of way the ground sits `BELOW` under
 * the hard surfaces, which carry their own meshes and colliders; just outside
 * it the ground meets the sidewalk's outer edge; lots are levelled to their
 * pad; and open ground beside a road is blended into an embankment.
 *
 * The render mesh and the physics heightfields both sample `heightAt` on a
 * regular grid (`GRID` metres), triangulated by `gridHeight`.
 */
import { baseHeight, mix, smoothstep } from './Base';
import { BELOW, pointInPoly, polyDistance, type RoadNet } from './Roads';

export const GRID = 2;

export class Terrain {
  constructor(readonly net: RoadNet) {}

  /** How strongly each nearby lot's pad pulls the ground at (x, z): 1 well inside, 0 three metres outside. */
  private lotPull(x: number, z: number) {
    let sw = 0, sp = 0, max = 0;
    for (const l of this.net.lotsNear(x, z)) {
      const b = l.box!;
      if (x < b[0] - 3 || x > b[2] + 3 || z < b[1] - 3 || z > b[3] + 3) continue;
      const inside = pointInPoly(l.poly, x, z), d = polyDistance(l.poly, x, z);
      const w = smoothstep(-3, 3, inside ? d : -d);
      if (w <= 0) continue;
      sw += w; sp += w * l.pad; max = Math.max(max, w);
    }
    return { k: Math.min(1, max), pad: sw > 0 ? sp / sw : 0 };
  }

  heightAt(x: number, z: number) {
    const q = this.net.query(x, z);
    if (q.inside) return q.elev - BELOW;
    const base = baseHeight(x, z);
    const lot = this.lotPull(x, z);
    let h = lot.k > 0 ? mix(base, lot.pad, lot.k) : base;
    if (q.dist < 40) {
      const target = q.elev + q.top;
      h = mix(h, target, (1 - smoothstep(4, 35, q.dist)) * (1 - lot.k));
      h = mix(h, target, 1 - smoothstep(3, 8, q.dist));
    }
    return h;
  }

  /** Height of the gridded ground mesh at any point: the two triangles of each cell split along its (i, j)–(i+1, j+1) diagonal. */
  gridHeight(x: number, z: number, step = GRID, at: (x: number, z: number) => number = (a, b) => this.heightAt(a, b)) {
    const i = Math.floor(x / step), j = Math.floor(z / step), fx = x / step - i, fz = z / step - j;
    const h00 = at(i * step, j * step), h11 = at((i + 1) * step, (j + 1) * step);
    if (fx >= fz) { const h10 = at((i + 1) * step, j * step); return h00 + (h10 - h00) * fx + (h11 - h10) * fz; }
    const h01 = at(i * step, (j + 1) * step);
    return h00 + (h01 - h00) * fz + (h11 - h01) * fx;
  }
}
