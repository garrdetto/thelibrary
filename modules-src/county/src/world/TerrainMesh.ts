/**
 * A chunk of ground from a height grid: smooth normals from the grid, clean
 * grass colours mottled toward meadow and forest floor, mown lawns on lots,
 * and a skirt round the edge that hides cracks against neighbours drawn at a
 * different level of detail. Triangles split along (i, j)–(i+1, j+1), as
 * `Terrain.gridHeight` assumes.
 */
import type * as pc from 'playcanvas';
import { MeshBuilder, meshEntity, type RGB } from '../../../foxplains2/src/core/Geo';
import { fbm } from '../../shared/Noise';
import { pointInPoly, type RoadNet } from '../../shared/Roads';
import { PALETTE } from '../../config';

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sat = (v: number) => Math.max(0, Math.min(1, v));

export function groundColor(net: RoadNet, x: number, z: number, slope: number): RGB {
  const n = fbm(x / 70, z / 70, 3), m = fbm(x / 420 + 9, z / 420 + 4, 3), wood = fbm(x / 320 + 4.2, z / 320 - 1.3, 4);
  let c = mix(PALETTE.grass, PALETTE.meadow, sat((m - 0.45) * 2.4));
  c = mix(c, PALETTE.forestFloor, sat((wood - 0.55) * 6));
  c = mix(c, PALETTE.forestFloor, sat((0.42 - n) * 2.5) * 0.6);
  c = mix(c, [0.52, 0.5, 0.4], sat((slope - 0.45) * 2));
  if (net.lotsNear(x, z).some(l => pointInPoly(l.poly, x, z))) c = mix(c, PALETTE.grass, 0.6);
  const fine = fbm(x / 6.5 + 3, z / 6.5 - 8, 2);
  c = mix(c, PALETTE.grassDark, sat((0.55 - fine) * 1.6) * 0.45);
  const k = 0.86 + (n - 0.5) * 0.12 + (fine - 0.5) * 0.08;
  return [c[0] * k, c[1] * k, c[2] * k];
}

export function buildTerrainChunk(device: pc.GraphicsDevice, material: pc.Material, net: RoadNet, h: Float32Array, x0: number, z0: number, n: number, step: number, drop = 0, name = 'ground') {
  const b = new MeshBuilder(), w = n + 1;
  const H = (i: number, j: number) => h[Math.max(0, Math.min(n, j)) * w + Math.max(0, Math.min(n, i))] - drop;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    const dx = (H(i + 1, j) - H(i - 1, j)) / ((Math.min(n, i + 1) - Math.max(0, i - 1)) * step);
    const dz = (H(i, j + 1) - H(i, j - 1)) / ((Math.min(n, j + 1) - Math.max(0, j - 1)) * step);
    const l = Math.hypot(dx, 1, dz);
    b.vertex(x, H(i, j), z, -dx / l, 1 / l, -dz / l, x / 8, z / 8, groundColor(net, x, z, Math.hypot(dx, dz)));
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * w + i;
    b.tri(a, a + w + 1, a + 1);
    b.tri(a, a + w, a + w + 1);
  }
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) ring.push([i, 0]);
  for (let j = 0; j < n; j++) ring.push([n, j]);
  for (let i = n; i > 0; i--) ring.push([i, n]);
  for (let j = n; j > 0; j--) ring.push([0, j]);
  const skirt = ring.map(([i, j]) => {
    const k = j * w + i;
    return b.vertex(b.pos[k * 3], b.pos[k * 3 + 1] - Math.max(2, step * 0.6), b.pos[k * 3 + 2], b.nrm[k * 3], b.nrm[k * 3 + 1], b.nrm[k * 3 + 2], 0, 0, [b.col[k * 3], b.col[k * 3 + 1], b.col[k * 3 + 2]] as RGB);
  });
  for (let q = 0; q < ring.length; q++) {
    const [i0, j0] = ring[q], [i1, j1] = ring[(q + 1) % ring.length];
    const t0 = j0 * w + i0, t1 = j1 * w + i1, s0 = skirt[q], s1 = skirt[(q + 1) % ring.length];
    b.tri(t0, s0, s1); b.tri(t0, s1, t1);
  }
  return meshEntity(name, [{ mesh: b.toMesh(device, true), material }], { cast: false });
}

/** A Rapier heightfield's heights for the grid: column-major, rows along Z. */
export function heightfieldData(h: Float32Array, n: number) {
  const w = n + 1, out = new Float32Array(w * w);
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) out[i * w + j] = h[j * w + i];
  return out;
}
