/**
 * Look-development ground: flat, gently mottled grass around the street and
 * airfield, rising into rolling wooded hills toward the horizon so the view
 * from height has depth. Heights come from `groundHeight`, a pure function
 * that Phase 1's terrain will replace.
 */
import type * as pc from 'playcanvas';
import { MeshBuilder, meshEntity, type RGB } from '../../../foxplains2/src/core/Geo';
import { fbm } from '../../shared/Noise';
import { PALETTE } from '../../config';

const FLAT = { x0: -160, x1: 220, z0: -110, z1: 140 };

export function groundHeight(x: number, z: number) {
  const dx = Math.max(FLAT.x0 - x, 0, x - FLAT.x1), dz = Math.max(FLAT.z0 - z, 0, z - FLAT.z1);
  const d = Math.hypot(dx, dz);
  const ramp = Math.min(1, d / 600);
  const k = ramp * ramp * (3 - 2 * ramp);
  return k * (fbm(x / 700 + 3.1, z / 700 - 1.7, 4) * 150 - 20) + Math.min(d, 120) * 0.04;
}

export function buildGround(device: pc.GraphicsDevice, material: pc.Material) {
  const b = new MeshBuilder();
  const half = 3000;
  const step = (v: number) => (Math.abs(v) < 400 ? 8 : 40);
  const coords: number[] = [];
  for (let v = -half; v <= half + 0.1; v += step(v)) coords.push(v);
  const N = coords.length;
  const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const color = (x: number, z: number, h: number): RGB => {
    const n = fbm(x / 70, z / 70, 3), m = fbm(x / 420 + 9, z / 420 + 4, 3);
    let c = mix(PALETTE.grass, PALETTE.meadow, Math.max(0, Math.min(1, (m - 0.45) * 2.4)));
    c = mix(c, PALETTE.forestFloor, Math.max(0, Math.min(1, (0.42 - n) * 2.5)));
    const hill = Math.min(1, Math.max(0, h / 90));
    c = mix(c, PALETTE.forestFloor, hill * 0.6);
    const k = 0.94 + (n - 0.5) * 0.16;
    return [c[0] * k, c[1] * k, c[2] * k];
  };
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = coords[i], z = coords[j], h = groundHeight(x, z), e = 1;
    const nx = groundHeight(x - e, z) - groundHeight(x + e, z), nz = groundHeight(x, z - e) - groundHeight(x, z + e);
    const l = Math.hypot(nx, 2 * e, nz);
    b.vertex(x, h, z, nx / l, (2 * e) / l, nz / l, x / 8, z / 8, color(x, z, h));
  }
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
    const a = i * N + j, c = a + N;
    b.idx.push(a, a + 1, c + 1, a, c + 1, c);
  }
  return meshEntity('ground', [{ mesh: b.toMesh(device, true), material }], { cast: false });
}
