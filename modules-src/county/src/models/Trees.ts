/**
 * Trees with species-correct silhouettes, made of many small leaf clumps
 * rather than one big ball: a spreading oak and a rounder maple on visible
 * branching trunks, and a spruce of drooping, jagged tiers. Clumps are lit
 * from above and darken toward the inside, the way clipart foliage reads.
 */
import type { MeshBuilder, RGB } from '../../../foxplains2/src/core/Geo';
import type { Batch } from '../core/Batch';
import { rng } from '../core/Noise';
import { PALETTE } from '../../config';

const tint = (c: RGB, k: number, warm = 0): RGB => [Math.min(1, c[0] * k + warm), Math.min(1, c[1] * k + warm * 0.6), Math.min(1, c[2] * k)];

const OCTA = { dirs: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], faces: [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]] };

/**
 * One leaf clump: a subdivided octahedron with gentle, smoothly varying lumps
 * (not random spikes), flattened a little, lit from above with a soft
 * underside so a crown of many clumps reads as foliage rather than balloons.
 */
export function leafClump(b: MeshBuilder, cx: number, cy: number, cz: number, r: number, seed: number, color: RGB, N = 3) {
  const p1 = (seed * 1.37) % 6.28, p2 = (seed * 2.11) % 6.28, p3 = (seed * 0.73) % 6.28;
  const cache = new Map<string, number>();
  const at = (p: number[]) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    const dx = p[0] / l, dy = p[1] / l, dz = p[2] / l;
    const key = `${dx.toFixed(4)},${dy.toFixed(4)},${dz.toFixed(4)}`;
    let i = cache.get(key);
    if (i === undefined) {
      const lump = 1 + 0.13 * Math.sin(dx * 4.1 + p1) * Math.sin(dy * 3.3 + p2) + 0.08 * Math.sin(dz * 5.2 + p3 + dx * 2);
      const ry = r * 0.8;
      const ny = dy / 0.8, nl = Math.hypot(dx, ny, dz);
      const light = 0.66 + 0.4 * (dy * 0.5 + 0.5);
      i = b.vertex(cx + dx * r * lump, cy + dy * ry * lump, cz + dz * r * lump, dx / nl, ny / nl, dz / nl, dx * 0.5 + 0.5, dz * 0.5 + 0.5, [color[0] * light, color[1] * light, color[2] * light]);
      cache.set(key, i);
    }
    return i;
  };
  for (const f of OCTA.faces) {
    const [A, B, C] = f.map(k => OCTA.dirs[k]);
    const p = (i: number, j: number) => { const k = N - i - j; return [(A[0] * k + B[0] * i + C[0] * j) / N, (A[1] * k + B[1] * i + C[1] * j) / N, (A[2] * k + B[2] * i + C[2] * j) / N]; };
    for (let i = 0; i < N; i++) for (let j = 0; j < N - i; j++) {
      b.tri(at(p(i, j)), at(p(i + 1, j)), at(p(i, j + 1)));
      if (i + j < N - 1) b.tri(at(p(i + 1, j)), at(p(i + 1, j + 1)), at(p(i, j + 1)));
    }
  }
}

export interface BroadleafShape { spread: number; crown: number; trunk: number; clumps: number; clumpSize: number; leaf: RGB }

export const OAK: BroadleafShape = { spread: 0.44, crown: 0.3, trunk: 0.42, clumps: 96, clumpSize: 0.066, leaf: PALETTE.oakLeaf };
export const MAPLE: BroadleafShape = { spread: 0.34, crown: 0.37, trunk: 0.38, clumps: 84, clumpSize: 0.064, leaf: PALETTE.mapleLeaf };

export function broadleaf(B: Batch, x: number, z: number, h: number, seed: number, s: BroadleafShape) {
  const r = rng(seed);
  const bark = B.get('matte'), leaves = B.get('foliage');
  const th = h * s.trunk, r0 = h * 0.034;
  bark.cylinder(x, 0, z, r0 * 1.25, r0 * 0.75, th, 12, false, PALETTE.bark);
  const cy = th + h * s.crown * 0.75, R = h * s.spread, Ry = h * s.crown;
  const limbs = 5 + Math.floor(r() * 2);
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + r() * 0.6, el = 0.55 + r() * 0.35;
    const sy = th * (0.78 + r() * 0.2), len = R * (0.75 + r() * 0.25);
    const ex = x + Math.cos(a) * Math.cos(el) * len, ez = z + Math.sin(a) * Math.cos(el) * len, ey = sy + Math.sin(el) * len;
    bark.tube([x, sy, z], [ex, ey, ez], r0 * 0.42, 7, false, PALETTE.bark);
    for (let k = 0; k < 2; k++) {
      const b2 = a + (k ? 0.5 : -0.5), l2 = len * 0.45;
      bark.tube([ex, ey, ez], [ex + Math.cos(b2) * l2, ey + l2 * 0.6, ez + Math.sin(b2) * l2], r0 * 0.22, 5, false, PALETTE.bark);
    }
  }
  for (let i = 0; i < 8; i++) {
    const a = r() * Math.PI * 2, f = r() * 0.4;
    const cr = h * s.clumpSize * 2.2;
    leafClump(leaves, x + Math.cos(a) * R * f, cy + (r() - 0.3) * Ry * 0.4, z + Math.sin(a) * R * f, cr, seed * 31 + i, tint(s.leaf, 0.58));
  }
  for (let i = 0; i < s.clumps; i++) {
    let dx = 0, dy = 0, dz = 0;
    do { dx = r() * 2 - 1; dy = r() * 2 - 1; dz = r() * 2 - 1; } while (dx * dx + dy * dy + dz * dz > 1 || dy < -0.55);
    const l = Math.hypot(dx, dy, dz) || 1, f = 0.7 + 0.3 * Math.sqrt(l);
    dx /= l; dy /= l; dz /= l;
    const lobe = 1 + 0.18 * Math.sin(Math.atan2(dz, dx) * 3 + seed);
    const cr = h * s.clumpSize * (0.7 + r() * 0.55);
    const light = 0.72 + 0.32 * (dy * 0.5 + 0.5) + (f - 0.85) * 0.5 + (r() - 0.5) * 0.08;
    leafClump(leaves, x + dx * R * f * lobe, cy + dy * Ry * f, z + dz * R * f * lobe, cr, seed * 97 + i, tint(s.leaf, light, (r() - 0.5) * 0.03));
  }
}

function skirt(b: MeshBuilder, x: number, z: number, y: number, rad: number, tierH: number, seed: number) {
  const r = rng(seed), N = 18, base = b.vertexCount;
  const top = PALETTE.spruce;
  b.vertex(x, y + tierH, z, 0, 1, 0, 0.5, 0.5, tint(top, 0.78));
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (r() - 0.5) * 0.12;
    const tip = i % 2 === 0;
    const rr = rad * (tip ? 1.06 + r() * 0.08 : 0.8 + r() * 0.05);
    const yy = y - (tip ? 0.14 * rad : 0);
    const ca = Math.cos(a), sa = Math.sin(a);
    const nl = Math.hypot(tierH, rad);
    b.vertex(x + ca * rr, yy, z + sa * rr, (ca * tierH) / nl, rad / nl, (sa * tierH) / nl, 0, 0, tint(top, tip ? 1.12 : 0.92));
  }
  for (let i = 0; i < N; i++) b.tri(base, base + 1 + ((i + 1) % N), base + 1 + i);
  const under = b.vertexCount;
  b.vertex(x, y + tierH * 0.3, z, 0, -1, 0, 0.5, 0.5, tint(top, 0.45));
  for (let i = 0; i < N; i++) {
    const p = (base + 1 + i) * 3;
    b.vertex(b.pos[p], b.pos[p + 1], b.pos[p + 2], 0, -1, 0, 0, 0, tint(top, 0.6));
  }
  for (let i = 0; i < N; i++) b.tri(under, under + 1 + i, under + 1 + ((i + 1) % N));
}

export function spruce(B: Batch, x: number, z: number, h: number, seed: number) {
  const r = rng(seed);
  B.get('matte').cylinder(x, 0, z, h * 0.028, h * 0.01, h * 0.95, 9, false, PALETTE.bark);
  const leaves = B.get('foliage');
  const T = 8, R = h * 0.25;
  for (let k = 0; k < T; k++) {
    const t = k / (T - 1);
    const y = h * 0.1 + t * h * 0.74;
    const rad = R * Math.pow(1 - t * 0.92, 0.95) + 0.2;
    skirt(leaves, x, z, y, rad, h * 0.17 * (1 - t * 0.3), seed * 13 + k + Math.floor(r() * 7));
  }
}
