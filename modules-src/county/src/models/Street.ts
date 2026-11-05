/**
 * A residential street at real dimensions along +X: an 8 m road with a dashed
 * center line and edge lines, rounded curbs broken at driveways, a grass
 * strip, a 1.8 m sidewalk of jointed slabs, lamp posts with warm lanterns,
 * mailboxes, a hydrant, a picket fence and mowed lawn stripes.
 */
import * as pc from 'playcanvas';
import type { RGB } from '../../../foxplains2/src/core/Geo';
import { bevelBox, circle, place, prism, roundRect, sweep, type V2 } from '../core/Shapes';
import type { Batch } from '../core/Batch';
import { sub } from './Parts';
import { leafClump } from './Trees';
import { PALETTE } from '../../config';

export const STREET = { x0: -70, x1: 66, roadZ0: 16, roadZ1: 24, walkZ0: 10.5, walkZ1: 12.3, curb: 0.25 };

export function buildStreet(B: Batch, driveways: [number, number][]) {
  const S = STREET, satin = B.get('satin'), matte = B.get('matte');
  const len = S.x1 - S.x0, cx = (S.x0 + S.x1) / 2;
  bevelBox(satin, len, 0.08, S.roadZ1 - S.roadZ0, 0.02, { color: PALETTE.asphalt, skipBottom: true, at: place(cx, 0.04, (S.roadZ0 + S.roadZ1) / 2) });
  const mid = (S.roadZ0 + S.roadZ1) / 2;
  for (let x = S.x0 + 2; x < S.x1 - 3; x += 9) bevelBox(satin, 3, 0.012, 0.13, 0.004, { color: PALETTE.laneYellow, seg: 1, at: place(x + 1.5, 0.085, mid) });
  for (const z of [S.roadZ0 + 0.4, S.roadZ1 - 0.4]) bevelBox(satin, len - 0.4, 0.012, 0.12, 0.004, { color: PALETTE.laneWhite, seg: 1, at: place(cx, 0.085, z) });

  const curbProfile = roundRect(S.curb, 0.2, 0.05, 3, 0, 0.1);
  for (const [z, gaps] of [[S.roadZ0 - S.curb / 2, driveways], [S.roadZ1 + S.curb / 2, [] as [number, number][]]] as const) {
    let x = S.x0;
    for (const [g0, g1] of [...gaps, [S.x1, S.x1] as [number, number]].sort((a, b) => a[0] - b[0])) {
      if (g0 - x > 0.3) sweep(satin, [[x, 0, z], [g0, 0, z]], curbProfile, { color: PALETTE.curb, caps: true });
      x = g1;
    }
  }
  for (const [g0, g1] of driveways) bevelBox(matte, g1 - g0, 0.1, S.roadZ0 - S.walkZ1, 0.03, { color: PALETTE.concrete, skipBottom: true, at: place((g0 + g1) / 2, 0.05, (S.walkZ1 + S.roadZ0) / 2) });

  const slab = 1.5, wz = (S.walkZ0 + S.walkZ1) / 2, farZ = S.roadZ1 + S.curb + 3.2;
  for (const [z, w] of [[wz, S.walkZ1 - S.walkZ0], [farZ, 1.8]] as const) {
    bevelBox(matte, len, 0.1, w - 0.02, 0.02, { color: PALETTE.joint, seg: 1, skipBottom: true, at: place(cx, 0.05, z) });
    for (let x = S.x0; x < S.x1 - 0.1; x += slab) bevelBox(matte, slab - 0.03, 0.12, w, 0.025, { color: PALETTE.concreteLight, seg: 1, skipBottom: true, at: place(x + slab / 2, 0.06, z) });
  }
}

export function streetLamp(B: Batch, x: number, z: number, faceZ: number, bulb: pc.Material) {
  const metal = B.get('paint');
  const c = PALETTE.lampPost;
  const at = place(x, 0, z);
  metal.transform(at);
  metal.lathe([[0.2, 0], [0.2, 0.08], [0.15, 0.14], [0.11, 0.5], [0.075, 0.62]], 16, true, c);
  metal.transform(null);
  sweep(metal, [[x, 0.6, z], [x, 4.4, z]], circle(0.07, 10), { color: c });
  const arm: [number, number, number][] = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; arm.push([x, 4.4 + Math.sin(t * Math.PI / 2) * 0.35, z + faceZ * t * 1.1]); }
  sweep(metal, arm, circle(0.045, 8), { color: c });
  const head = sub(at, 0, 4.55, faceZ * 1.15);
  bevelBox(metal, 0.5, 0.12, 0.5, 0.05, { color: c, at: sub(head, 0, 0.12, 0) });
  bevelBox(B.get(bulb), 0.34, 0.26, 0.34, 0.06, { color: PALETTE.bulbWarm, at: sub(head, 0, -0.08, 0) });
  bevelBox(metal, 0.4, 0.05, 0.4, 0.02, { color: c, at: sub(head, 0, -0.23, 0) });
  return new pc.Vec3(x, 4.4, z + faceZ * 1.15);
}

export function mailbox(B: Batch, x: number, z: number, color: RGB) {
  const paint = B.get('paint'), matte = B.get('matte');
  bevelBox(matte, 0.1, 1.05, 0.1, 0.02, { color: PALETTE.trimWhite, at: place(x, 0.525, z) });
  bevelBox(paint, 0.24, 0.26, 0.5, 0.1, { color, at: place(x, 1.18, z) });
  bevelBox(paint, 0.03, 0.14, 0.04, 0.01, { color: PALETTE.hydrantRed, seg: 1, at: place(x + 0.135, 1.24, z - 0.12) });
}

export function hydrant(B: Batch, x: number, z: number) {
  const paint = B.get('paint');
  paint.transform(place(x, 0, z));
  paint.lathe([[0.16, 0], [0.16, 0.06], [0.12, 0.09], [0.12, 0.55], [0.15, 0.58], [0.15, 0.62], [0.11, 0.66], [0.08, 0.74], [0.03, 0.8], [0, 0.81]], 18, true, PALETTE.hydrantRed);
  paint.transform(null);
  for (const s of [-1, 1]) sweep(paint, [[x + s * 0.1, 0.42, z], [x + s * 0.2, 0.42, z]], circle(0.045, 10), { color: PALETTE.hydrantRed, caps: true });
  sweep(paint, [[x, 0.38, z + 0.1], [x, 0.38, z + 0.2]], circle(0.06, 10), { color: PALETTE.trimWhite, caps: true });
}

/** White picket fence from (x0, z) to (x1, z). */
export function picketFence(B: Batch, x0: number, x1: number, z: number) {
  const satin = B.get('satin');
  const picket: V2[] = [[-0.045, 0], [0.045, 0], [0.045, 0.92], [0, 1.0], [-0.045, 0.92]];
  for (let x = x0 + 0.06; x <= x1; x += 0.15) prism(satin, picket, -0.012, 0.012, { color: PALETTE.trimWhite, r: 0.008, seg: 1, at: place(x, 0, z, 0, -Math.PI / 2) });
  for (const y of [0.25, 0.72]) bevelBox(satin, x1 - x0, 0.07, 0.035, 0.012, { color: PALETTE.trimWhite, seg: 1, at: place((x0 + x1) / 2, y, z - 0.03) });
  for (let x = x0; x <= x1 + 0.01; x += 2.4) {
    bevelBox(satin, 0.1, 1.05, 0.1, 0.02, { color: PALETTE.trimWhite, at: place(x, 0.525, z - 0.02) });
    satin.transform(place(x, 1.05, z - 0.02));
    satin.blob(0, 0.03, 0, 0.065, 0.06, 0.065, 2, 0, PALETTE.trimWhite);
    satin.transform(null);
  }
}

/** Freshly mowed stripes: alternating light and dark bands `band` metres wide along X. */
export function lawnStripes(B: Batch, x0: number, z0: number, x1: number, z1: number, band = 1.1) {
  const ground = B.get('ground');
  for (let z = z0, k = 0; z < z1 - 0.01; z += band, k++) {
    const zb = Math.min(z1, z + band);
    ground.flat(x0, z, x1, zb, 0.012, 1, k % 2 ? PALETTE.grassLight : PALETTE.grass);
  }
}

/** A low shrub of small leaf clumps against a foundation. */
export function shrub(B: Batch, x: number, z: number, size: number, seed: number) {
  const leaves = B.get('foliage');
  let s = Math.max(1, Math.floor(seed));
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2, d = r() * size * 0.5, cr = size * (0.2 + r() * 0.12);
    const k = 0.8 + r() * 0.3;
    leafClump(leaves, x + Math.cos(a) * d, cr * 0.7 + r() * size * 0.35, z + Math.sin(a) * d, cr, seed + i, [PALETTE.grassDark[0] * k, PALETTE.grassDark[1] * k, PALETTE.grassDark[2] * k]);
  }
}
