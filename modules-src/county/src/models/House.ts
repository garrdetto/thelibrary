/**
 * A suburban house at real scale: an 11 × 8.5 m main block with lap siding,
 * corner boards, a 35° gable roof with shingle courses, fascia, rake trim,
 * gutters and downspouts, a brick chimney, a covered porch with a six-panel
 * door, framed double-hung windows with shutters, and an attached two-car
 * garage with a sectional door. The front faces +Z from the origin.
 */
import type * as pc from 'playcanvas';
import type { RGB } from '../../../foxplains2/src/core/Geo';
import { bevelBox, circle, sweep, type V2 } from '../core/Shapes';
import type { Batch } from '../core/Batch';
import { framedWindow, panelDoor, sub } from './Parts';
import { PALETTE } from '../../config';

export interface HouseStyle { siding: RGB; door: RGB; roof: RGB; shutters: RGB | null; lit: pc.Material; litPattern: number }

const W = 11, D = 8.5, BASE = 0.45, WALL = 2.9, PITCH = (35 * Math.PI) / 180, EAVE = 0.45, RAKE = 0.35;
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

function lapWall(B: Batch, wall: pc.Mat4, length: number, y0: number, y1: number, siding: RGB) {
  const satin = B.get('satin');
  bevelBox(satin, length, y1 - y0, 0.1, 0.04, { color: siding, at: sub(wall, 0, (y0 + y1) / 2, -0.05) });
  for (let y = y0 + 0.16; y < y1 - 0.05; y += 0.22) bevelBox(satin, length - 0.02, 0.05, 0.028, 0.012, { color: shade(siding, 0.95), seg: 1, at: sub(wall, 0, y, 0.012) });
}

function gableRoof(B: Batch, at: pc.Mat4, x0: number, x1: number, zFront: number, depth: number, eaveY: number, pitch: number, roof: RGB) {
  const half = depth / 2, rise = half * Math.tan(pitch), ridgeY = eaveY + rise;
  const L = (half + EAVE) / Math.cos(pitch), len = x1 - x0 + 2 * RAKE, cx = (x0 + x1) / 2;
  const satin = B.get('satin'), matte = B.get('matte');
  for (const s of [1, -1]) {
    const midZ = zFront - half + s * (half + EAVE) / 2;
    const midY = ridgeY - ((half + EAVE) / 2) * Math.tan(pitch);
    const ny = Math.cos(pitch), nz = s * Math.sin(pitch);
    const slab = sub(at, cx, midY + ny * 0.08, midZ + nz * 0.08, 0, s * pitch);
    bevelBox(matte, len, 0.16, L, 0.04, { color: shade(roof, 0.9), at: slab });
    for (let k = 0, z = -L / 2 + 0.2; z < L / 2 - 0.05; k++, z += 0.3) {
      bevelBox(matte, len - 0.02, 0.03, 0.34, 0.012, { color: shade(roof, k % 2 ? 1 : 0.95), seg: 1, at: sub(slab, 0, 0.09, s > 0 ? z : -z) });
    }
    const fasciaZ = zFront - half + s * (half + EAVE), fasciaY = eaveY - EAVE * Math.tan(pitch);
    bevelBox(satin, len, 0.22, 0.07, 0.025, { color: PALETTE.trimWhite, at: sub(at, cx, fasciaY, fasciaZ) });
    for (const e of [x0 - RAKE, x1 + RAKE]) bevelBox(satin, 0.07, 0.24, L + 0.02, 0.025, { color: PALETTE.trimWhite, at: sub(sub(at, e, midY + ny * 0.06, midZ + nz * 0.06), 0, 0, 0, 0, s * pitch) });
    const gutter: V2[] = Array.from({ length: 7 }, (_, i) => { const a = Math.PI + (i / 6) * Math.PI; return [Math.cos(a) * 0.07, Math.sin(a) * 0.07] as V2; });
    const gy = fasciaY - 0.02, gz = fasciaZ + s * 0.1;
    sweep(satin, [[x0 - RAKE, gy, gz], [x1 + RAKE, gy, gz]], gutter, { color: PALETTE.trimWhite, closed: false });
  }
  bevelBox(matte, len, 0.12, 0.36, 0.05, { color: shade(roof, 0.8), at: sub(at, cx, ridgeY + 0.15, zFront - half) });
  return ridgeY;
}

function gableEnd(B: Batch, at: pc.Mat4, x: number, side: number, zFront: number, depth: number, eaveY: number, pitch: number, siding: RGB) {
  const satin = B.get('satin');
  const half = depth / 2, ridgeY = eaveY + half * Math.tan(pitch);
  satin.transform(at);
  const a = satin.vertex(x, eaveY, zFront, side, 0, 0, 0, 0, siding);
  satin.vertex(x, eaveY, zFront - depth, side, 0, 0, 0, 0, siding);
  satin.vertex(x, ridgeY, zFront - half, side, 0, 0, 0, 0, siding);
  if (side > 0) satin.tri(a, a + 1, a + 2); else satin.tri(a, a + 2, a + 1);
  satin.transform(null);
  for (let y = eaveY + 0.12; y < ridgeY - 0.25; y += 0.22) {
    const w = (2 * (ridgeY - y)) / Math.tan(pitch) - 0.3;
    if (w > 0.3) bevelBox(satin, 0.028, 0.05, w, 0.012, { color: shade(siding, 0.95), seg: 1, at: sub(at, x + side * 0.012, y, zFront - half) });
  }
  const vy = eaveY + (ridgeY - eaveY) * 0.45;
  bevelBox(satin, 0.1, 0.7, 0.62, 0.03, { color: PALETTE.trimWhite, at: sub(at, x + side * 0.04, vy, zFront - half) });
  for (let k = -2; k <= 2; k++) bevelBox(satin, 0.06, 0.04, 0.5, 0.012, { color: shade(PALETTE.trimWhite, 0.85), seg: 1, at: sub(at, x + side * 0.08, vy + k * 0.11, zFront - half) });
}

export function buildHouse(B: Batch, at: pc.Mat4, style: HouseStyle) {
  const mark = B.mark();
  const { siding, roof } = style;
  const satin = B.get('satin'), matte = B.get('matte'), paint = B.get('paint');
  let windowNo = 0;
  const lit = () => ((style.litPattern >> (windowNo++ % 12)) & 1 ? style.lit : null);

  bevelBox(matte, W + 0.3, BASE, D + 0.3, 0.04, { color: PALETTE.foundation, skipBottom: true, at: sub(at, 0, BASE / 2, -D / 2) });
  const top = BASE + WALL;
  const front = sub(at, 0, 0, 0), back = sub(at, 0, 0, -D, Math.PI);
  const left = sub(at, -W / 2, 0, -D / 2, -Math.PI / 2), right = sub(at, W / 2, 0, -D / 2, Math.PI / 2);
  lapWall(B, front, W, BASE, top, siding);
  lapWall(B, back, W, BASE, top, siding);
  lapWall(B, left, D, BASE, top, siding);
  lapWall(B, right, D, BASE, top, siding);
  for (const [cx, cz] of [[-W / 2, 0], [W / 2, 0], [-W / 2, -D], [W / 2, -D]]) bevelBox(satin, 0.16, WALL, 0.16, 0.03, { color: PALETTE.trimWhite, at: sub(at, cx, BASE + WALL / 2, cz) });
  bevelBox(satin, W + 0.1, 0.16, 0.06, 0.02, { color: PALETTE.trimWhite, at: sub(at, 0, top - 0.08, 0.03) });

  const sh = style.shutters;
  framedWindow(B, front, -3.7, 1.95, 1.0, 1.45, { shutters: sh, lit: lit() });
  framedWindow(B, front, -1.5, 1.95, 1.0, 1.45, { shutters: sh, lit: lit() });
  framedWindow(B, front, 3.7, 1.95, 1.0, 1.45, { shutters: sh, lit: lit() });
  for (const x of [-3.2, 0, 3.2]) framedWindow(B, back, x, 1.95, 1.1, 1.3, { lit: lit() });
  for (const x of [-2, 2]) framedWindow(B, left, x, 1.95, 1.0, 1.4, { lit: lit() });
  panelDoor(B, sub(at, 1.2, BASE, 0), 0, 0.95, 2.1, style.door, lit());

  bevelBox(B.get('matte'), 3.0, BASE, 1.9, 0.04, { color: PALETTE.concreteLight, at: sub(at, 1.2, BASE / 2, 0.95) });
  for (let k = 0; k < 2; k++) bevelBox(B.get('matte'), 1.7, (BASE * (2 - k)) / 3, 0.32, 0.03, { color: PALETTE.concreteLight, at: sub(at, 1.2, (BASE * (2 - k)) / 6, 2.05 + k * 0.32) });
  for (const s of [-1, 1]) {
    const px = 1.2 + s * 1.32;
    bevelBox(satin, 0.24, 0.16, 0.24, 0.03, { color: PALETTE.trimWhite, at: sub(at, px, BASE + 0.08, 1.7) });
    bevelBox(satin, 0.15, 2.55, 0.15, 0.03, { color: PALETTE.trimWhite, at: sub(at, px, BASE + 1.4, 1.7) });
    bevelBox(satin, 0.24, 0.14, 0.24, 0.03, { color: PALETTE.trimWhite, at: sub(at, px, BASE + 2.72, 1.7) });
  }
  bevelBox(satin, 3.1, 0.24, 2.05, 0.04, { color: PALETTE.trimWhite, at: sub(at, 1.2, top + 0.0, 0.9) });
  bevelBox(matte, 3.3, 0.1, 2.25, 0.03, { color: shade(roof, 0.9), at: sub(at, 1.2, top + 0.17, 0.95, 0, 0.12) });

  const ridgeY = gableRoof(B, at, -W / 2, W / 2, 0, D, top, PITCH, roof);
  gableEnd(B, at, -W / 2, -1, 0, D, top, PITCH, siding);
  gableEnd(B, at, W / 2, 1, 0, D, top, PITCH, siding);
  for (const [x, z] of [[-W / 2 - 0.2, 0.52], [W / 2 + 0.2, -D - 0.52]] as const) {
    sweep(satin, [[x, top - 0.25, z], [x, 0.2, z]], circle(0.05, 8), { color: PALETTE.trimWhite });
    sweep(satin, [[x, 0.2, z], [x, 0.08, z + Math.sign(z + 1) * 0.35]], circle(0.05, 8), { color: PALETTE.trimWhite });
  }
  const chim = sub(at, -3.3, 0, -D / 2 - 1.6);
  bevelBox(matte, 0.95, ridgeY - top + 1.2, 0.75, 0.03, { color: PALETTE.brick, at: sub(chim, 0, top + (ridgeY - top + 1.2) / 2, 0) });
  for (let y = top + 0.2; y < ridgeY + 1.1; y += 0.28) bevelBox(matte, 0.97, 0.03, 0.77, 0.01, { color: PALETTE.brickDark, seg: 1, at: sub(chim, 0, y, 0) });
  bevelBox(matte, 1.15, 0.14, 0.95, 0.04, { color: PALETTE.foundation, at: sub(chim, 0, ridgeY + 1.25, 0) });

  const gx = W / 2 + 3.25, gz = -0.5, gd = 7, gw = 6.5, gtop = 0.15 + 2.7;
  bevelBox(matte, gw + 0.2, 0.15, gd + 0.2, 0.03, { color: PALETTE.foundation, skipBottom: true, at: sub(at, gx, 0.075, gz - gd / 2) });
  const gFront = sub(at, gx, 0, gz), gBack = sub(at, gx, 0, gz - gd, Math.PI), gSide = sub(at, gx + gw / 2, 0, gz - gd / 2, Math.PI / 2);
  lapWall(B, gFront, gw, 0.15, gtop, siding);
  lapWall(B, gBack, gw, 0.15, gtop, siding);
  lapWall(B, gSide, gd, 0.15, gtop, siding);
  for (const cz of [gz, gz - gd]) bevelBox(satin, 0.16, 2.7, 0.16, 0.03, { color: PALETTE.trimWhite, at: sub(at, gx + gw / 2, 0.15 + 1.35, cz) });
  gableRoof(B, at, W / 2, gx + gw / 2, gz, gd, gtop, (28 * Math.PI) / 180, roof);
  gableEnd(B, at, gx + gw / 2, 1, gz, gd, gtop, (28 * Math.PI) / 180, siding);
  framedWindow(B, gSide, 0, 1.7, 1.0, 1.0, { panes: [2, 2] });
  const doorW = 5.0, doorH = 2.2, sec = doorH / 4;
  for (let k = 0; k < 4; k++) {
    const y = 0.15 + sec * (k + 0.5);
    bevelBox(paint, doorW, sec - 0.02, 0.06, 0.015, { color: PALETTE.trimWhite, seg: 2, at: sub(gFront, 0, y, 0.03) });
    for (let p = 0; p < 6; p++) {
      const px = -doorW / 2 + doorW / 12 + (p * doorW) / 6;
      if (k === 3) bevelBox(B.get('glass'), doorW / 6 - 0.16, sec - 0.18, 0.03, 0.01, { color: PALETTE.windowGlass, seg: 1, at: sub(gFront, px, y, 0.07) });
      else bevelBox(paint, doorW / 6 - 0.14, sec - 0.16, 0.025, 0.012, { color: shade(PALETTE.trimWhite, 0.96), seg: 2, at: sub(gFront, px, y, 0.07) });
    }
  }
  bevelBox(satin, doorW + 0.3, 0.14, 0.1, 0.03, { color: PALETTE.trimWhite, at: sub(gFront, 0, 0.15 + doorH + 0.07, 0.05) });
  for (const s of [-1, 1]) bevelBox(satin, 0.14, doorH, 0.1, 0.03, { color: PALETTE.trimWhite, at: sub(gFront, s * (doorW / 2 + 0.07), 0.15 + doorH / 2, 0.05) });
  const lampY = 0.15 + doorH + 0.2;
  for (const s of [-1, 1]) bevelBox(satin, 0.16, 0.3, 0.14, 0.04, { color: PALETTE.lampPost, at: sub(gFront, s * (doorW / 2 + 0.45), lampY, 0.1) });
  B.contact(mark, 0, 0.55, 0.22);
}

/** Driveway and front walk slabs with expansion joints, from the house to the sidewalk at `walkEndZ`. */
export function buildDrive(B: Batch, at: pc.Mat4, walkEndZ: number) {
  const matte = B.get('matte');
  const gx = W / 2 + 3.25;
  bevelBox(matte, 5.36, 0.08, walkEndZ + 0.45, 0.02, { color: PALETTE.joint, seg: 1, skipBottom: true, at: sub(at, gx, 0.04, (walkEndZ - 0.5) / 2) });
  for (let z = -0.5; z < walkEndZ - 0.05; z += 3.3) {
    const len = Math.min(3.27, walkEndZ - z - 0.03);
    bevelBox(matte, 5.4, 0.1, len, 0.03, { color: PALETTE.concrete, seg: 1, skipBottom: true, at: sub(at, gx, 0.05, z + len / 2 + 0.015) });
  }
  bevelBox(matte, 1.16, 0.06, walkEndZ - 2.4, 0.02, { color: PALETTE.joint, seg: 1, skipBottom: true, at: sub(at, 1.2, 0.03, (walkEndZ + 2.4) / 2) });
  for (let z = 2.4; z < walkEndZ - 0.05; z += 1.2) {
    const len = Math.min(1.17, walkEndZ - z - 0.03);
    bevelBox(matte, 1.2, 0.08, len, 0.025, { color: PALETTE.concreteLight, seg: 1, skipBottom: true, at: sub(at, 1.2, 0.04, z + len / 2) });
  }
}
