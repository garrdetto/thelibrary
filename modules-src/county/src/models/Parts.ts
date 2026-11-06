/**
 * Small architectural parts shared by buildings: framed windows with
 * mullions, sills and shutters, panel doors, and the matrix helper that
 * places a part on a wall. Wall-local frame: x along the wall, y up, z out.
 */
import * as pc from 'playcanvas';
import type { RGB } from '../../../foxplains2/src/core/Geo';
import { bevelBox, place } from '../core/Shapes';
import type { Batch } from '../core/Batch';
import { PALETTE } from '../../config';

/** `parent` × a local placement. */
export function sub(parent: pc.Mat4, x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0) {
  return new pc.Mat4().mul2(parent, place(x, y, z, yaw, pitch, roll));
}

export interface WindowOpts { panes?: [number, number]; shutters?: RGB | null; lit?: pc.Material | null; trim?: RGB; sill?: boolean }

/** A double-hung window centered at (x, y) on a wall frame, with trim, glass, muntins and a sill. */
export function framedWindow(B: Batch, wall: pc.Mat4, x: number, y: number, w: number, h: number, o: WindowOpts = {}) {
  const trim = o.trim ?? PALETTE.trimWhite, t = 0.11, depth = 0.09;
  const satin = B.get('satin');
  bevelBox(satin, w + 2 * t, t, depth, 0.025, { color: trim, at: sub(wall, x, y + h / 2 + t / 2, depth / 2) });
  bevelBox(satin, w + 2 * t, t, depth, 0.025, { color: trim, at: sub(wall, x, y - h / 2 - t / 2, depth / 2) });
  bevelBox(satin, t, h, depth, 0.025, { color: trim, at: sub(wall, x - w / 2 - t / 2, y, depth / 2) });
  bevelBox(satin, t, h, depth, 0.025, { color: trim, at: sub(wall, x + w / 2 + t / 2, y, depth / 2) });
  const glass = o.lit ? B.get(o.lit) : B.get('glass');
  bevelBox(glass, w, h, 0.03, 0.01, { color: PALETTE.windowGlass, seg: 1, at: sub(wall, x, y, 0.035) });
  const [cols, rows] = o.panes ?? [2, 2];
  const bar = 0.045;
  bevelBox(satin, w, 0.07, 0.05, 0.015, { color: trim, seg: 1, at: sub(wall, x, y, 0.06) });
  for (let c = 1; c < cols; c++) bevelBox(satin, bar, h, 0.04, 0.012, { color: trim, seg: 1, at: sub(wall, x - w / 2 + (w * c) / cols, y, 0.058) });
  for (let r = 1; r < rows; r++) {
    if (rows === 2 && r === 1) continue;
    bevelBox(satin, w, bar, 0.04, 0.012, { color: trim, seg: 1, at: sub(wall, x, y - h / 2 + (h * r) / rows, 0.058) });
  }
  if (o.sill ?? true) bevelBox(satin, w + 2 * t + 0.12, 0.06, 0.16, 0.02, { color: trim, at: sub(wall, x, y - h / 2 - t - 0.03, 0.08) });
  if (o.shutters) {
    const sw = w * 0.42;
    for (const s of [-1, 1]) {
      const sx = x + s * (w / 2 + t + sw / 2 + 0.04);
      bevelBox(satin, sw, h + 2 * t, 0.045, 0.015, { color: o.shutters, at: sub(wall, sx, y, 0.03) });
      for (const k of [-1, 1]) bevelBox(satin, sw * 0.72, (h + 2 * t) * 0.38, 0.02, 0.008, { color: o.shutters.map(c => c * 0.86) as RGB, seg: 1, at: sub(wall, sx, y + k * (h + 2 * t) * 0.23, 0.06) });
    }
  }
}

/** A six-panel entry door with casing, a knob and a transom light. */
export function panelDoor(B: Batch, wall: pc.Mat4, x: number, w: number, h: number, color: RGB, lit: pc.Material | null = null) {
  const paint = B.get('paint'), satin = B.get('satin'), t = 0.13;
  bevelBox(paint, w, h, 0.06, 0.015, { color, at: sub(wall, x, h / 2, 0.03) });
  for (let r = 0; r < 3; r++) for (const c of [-1, 1]) {
    const ph = r === 1 ? h * 0.32 : h * 0.2;
    const py = r === 0 ? h * 0.16 : r === 1 ? h * 0.47 : h * 0.82;
    bevelBox(paint, w * 0.34, ph, 0.025, 0.012, { color: color.map(v => v * 1.08) as RGB, seg: 2, at: sub(wall, x + c * w * 0.21, py, 0.07) });
  }
  bevelBox(satin, w + 2 * t, t, 0.1, 0.03, { color: PALETTE.trimWhite, at: sub(wall, x, h + 0.32 + t / 2, 0.05) });
  for (const s of [-1, 1]) bevelBox(satin, t, h + 0.32, 0.1, 0.03, { color: PALETTE.trimWhite, at: sub(wall, x + s * (w / 2 + t / 2), (h + 0.32) / 2, 0.05) });
  bevelBox(satin, w, 0.05, 0.08, 0.015, { color: PALETTE.trimWhite, seg: 1, at: sub(wall, x, h + 0.025, 0.05) });
  bevelBox(lit ? B.get(lit) : B.get('glass'), w, 0.26, 0.03, 0.01, { color: PALETTE.windowGlass, seg: 1, at: sub(wall, x, h + 0.18, 0.03) });
  const metal = B.get('metal');
  metal.transform(sub(wall, x + w * 0.38, h * 0.47, 0.11));
  metal.blob(0, 0, 0, 0.04, 0.04, 0.04, 5, 0, PALETTE.brass);
  metal.transform(null);
}
