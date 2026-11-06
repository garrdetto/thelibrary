/**
 * The look-development corner of the airfield: a 26 × 22 m corrugated-steel
 * hangar with a standing-seam gable roof, a 20 m opening with its sliding
 * leaves pushed aside, clerestory windows and a lit name board; a jointed
 * concrete apron with a yellow lead-in line; a helipad with its touchdown
 * ring, "H" and edge lights; taxiway lights and a striped windsock.
 */
import * as pc from 'playcanvas';
import type { RGB } from '../../../foxplains2/src/core/Geo';
import { MeshBuilder, meshEntity } from '../../../foxplains2/src/core/Geo';
import { bevelBox, circle, gridSurface, place, sweep, type V3 } from '../core/Shapes';
import type { Batch } from '../core/Batch';
import { sub } from './Parts';
import { PALETTE } from '../../config';

export const HANGAR = { x: 100, z: -8, w: 26, d: 22, eave: 8, pitch: (12 * Math.PI) / 180, door: { w: 20, h: 6.6 } };
export const HELIPAD = { x: 100, z: 26, r: 8 };
export const WINDSOCK = { x: 121, z: 40, yaw: 0.6 };

const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

function ribbed(B: Batch, frame: pc.Mat4, x0: number, x1: number, y0: number, y1: number, color: RGB) {
  const satin = B.get('satin'), w = x1 - x0, cx = (x0 + x1) / 2;
  bevelBox(satin, w, y1 - y0, 0.12, 0.03, { color, at: sub(frame, cx, (y0 + y1) / 2, -0.06) });
  for (let x = x0 + 0.25; x < x1 - 0.1; x += 0.5) bevelBox(satin, 0.12, y1 - y0 - 0.04, 0.05, 0.02, { color: shade(color, 1.04), seg: 1, at: sub(frame, x, (y0 + y1) / 2, 0.02) });
}

export function buildHangar(B: Batch, lit: pc.Material) {
  const H = HANGAR, hw = H.w / 2, front = H.z + H.d / 2, back = H.z - H.d / 2;
  const at = place(H.x, 0, H.z);
  const wall = PALETTE.hangarWall, satin = B.get('satin'), matte = B.get('matte');
  bevelBox(matte, H.w + 0.4, 0.3, H.d + 0.4, 0.04, { color: PALETTE.foundation, skipBottom: true, at: sub(at, 0, 0.15, 0) });
  bevelBox(matte, H.w - 0.3, 0.04, H.d - 0.3, 0.01, { color: PALETTE.concreteLight, skipBottom: true, at: sub(at, 0, 0.31, 0) });
  const fw = place(H.x, 0, front), bw = place(H.x, 0, back, Math.PI);
  const lw = place(H.x - hw, 0, H.z, -Math.PI / 2), rw = place(H.x + hw, 0, H.z, Math.PI / 2);
  ribbed(B, bw, -hw, hw, 0.3, H.eave, wall);
  for (const side of [lw, rw]) {
    ribbed(B, side, -H.d / 2, H.d / 2, 0.3, 5.0, wall);
    ribbed(B, side, -H.d / 2, H.d / 2, 6.3, H.eave, wall);
    for (let z = -H.d / 2 + 0.5; z < H.d / 2 - 0.4; z += 2.1) bevelBox(B.get(lit), 1.95, 1.2, 0.05, 0.02, { color: PALETTE.windowGlass, seg: 1, at: sub(side, z + 1.0, 5.65, -0.04) });
    bevelBox(satin, H.d, 0.12, 0.16, 0.03, { color: PALETTE.trimWhite, at: sub(side, 0, 5.0, 0.03) });
    bevelBox(satin, H.d, 0.12, 0.16, 0.03, { color: PALETTE.trimWhite, at: sub(side, 0, 6.3, 0.03) });
  }
  const dw = H.door.w / 2, dh = H.door.h;
  ribbed(B, fw, -hw, -dw, 0.3, H.eave, wall);
  ribbed(B, fw, dw, hw, 0.3, H.eave, wall);
  ribbed(B, fw, -dw, dw, dh + 0.3, H.eave, wall);
  bevelBox(B.get('paint'), H.door.w + 0.6, 0.35, 0.3, 0.05, { color: PALETTE.heliNavy, at: sub(fw, 0, dh + 0.48, 0.1) });
  for (const s of [-1, 1]) for (let k = 0; k < 2; k++) {
    const lx = s * (dw - 1.2 + k * 0.25);
    ribbed(B, sub(fw, 0, 0, -0.35 - k * 0.2), lx - 2.5, lx + 2.5, 0.35, dh + 0.3, shade(wall, 0.94));
  }

  const rise = hw * Math.tan(H.pitch), ridgeY = H.eave + rise, eave = 0.6;
  for (const s of [1, -1]) {
    const L = (hw + eave) / Math.cos(H.pitch);
    const mx = s * (hw + eave) / 2, my = ridgeY - ((hw + eave) / 2) * Math.tan(H.pitch);
    const nx = s * Math.sin(H.pitch), ny = Math.cos(H.pitch);
    const slab = sub(at, mx + nx * 0.08, my + ny * 0.08, 0, 0, 0, -s * H.pitch);
    bevelBox(matte, L, 0.16, H.d + 1.2, 0.04, { color: PALETTE.hangarRoof, at: slab });
    for (let z = -H.d / 2 - 0.3; z <= H.d / 2 + 0.3; z += 0.6) bevelBox(matte, L, 0.06, 0.06, 0.025, { color: shade(PALETTE.hangarRoof, 1.12), seg: 1, at: sub(slab, 0, 0.1, z) });
    bevelBox(satin, 0.08, 0.3, H.d + 1.25, 0.03, { color: PALETTE.trimWhite, at: sub(at, s * (hw + eave), H.eave - eave * Math.tan(H.pitch) - 0.05, 0) });
  }
  bevelBox(matte, 0.4, 0.14, H.d + 1.25, 0.05, { color: shade(PALETTE.hangarRoof, 0.85), at: sub(at, 0, ridgeY + 0.18, 0) });
  for (const [z, n] of [[front, 1], [back, -1]] as const) {
    const base = satin.vertexCount;
    satin.transform(place(H.x, 0, z));
    satin.vertex(-hw, H.eave, 0, 0, 0, n, 0, 0, wall);
    satin.vertex(hw, H.eave, 0, 0, 0, n, 0, 0, wall);
    satin.vertex(0, ridgeY, 0, 0, 0, n, 0, 0, wall);
    satin.transform(null);
    if (n > 0) satin.tri(base, base + 1, base + 2); else satin.tri(base, base + 2, base + 1);
  }
  for (let k = 0; k < 6; k++) {
    const x = -10 + k * 4;
    bevelBox(B.get(lit), 2.4, 0.08, 0.6, 0.03, { color: PALETTE.bulbWarm, seg: 1, at: sub(at, x, H.eave - 0.1, -2) });
  }
  const red = PALETTE.hydrantRed;
  for (let k = 0; k < 4; k++) bevelBox(B.get('paint'), 1.2, 1.8, 0.6, 0.05, { color: k % 2 ? red : shade(red, 0.9), at: sub(at, -11.2 + k * 1.25, 1.2, -H.d / 2 + 0.6) });
  bevelBox(satin, 3.2, 0.9, 0.9, 0.04, { color: PALETTE.metalGrey, at: sub(at, 6, 0.75, -H.d / 2 + 0.7) });
}

/** A canvas name board, `w` metres wide and facing +Z from its origin, lit softly at night. */
export function hangarSign(device: pc.GraphicsDevice, text: string, w = 12) {
  const W = 1024, Hh = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = Hh;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#1d2f57'; g.fillRect(0, 0, W, Hh);
  g.fillStyle = '#f4c430'; g.fillRect(0, Hh - 14, W, 8);
  g.fillStyle = '#f4f5f2';
  g.font = '700 64px "Segoe UI", Roboto, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.toUpperCase(), W / 2, Hh / 2 - 4);
  const tex = new pc.Texture(device, { name: 'county-sign', format: pc.PIXELFORMAT_SRGBA8, mipmaps: true, anisotropy: 8, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
  tex.setSource(canvas);
  const m = new pc.StandardMaterial();
  m.diffuseMap = tex; m.emissiveMap = tex; m.emissive.set(1, 1, 1); m.emissiveIntensity = 0.05;
  m.useMetalness = true; m.metalness = 0; m.gloss = 0.55;
  m.update();
  const h = w / 8;
  const b = new MeshBuilder();
  b.quad([[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  return { entity: meshEntity('hangar-sign', [{ mesh: b.toMesh(device), material: m }], { cast: false }), material: m };
}

export function buildApron(B: Batch, edgeLit: pc.Material, padLit: pc.Material) {
  const matte = B.get('matte'), satin = B.get('satin');
  const x0 = 76, x1 = 124, z0 = HANGAR.z + HANGAR.d / 2 + 0.2, z1 = 46, s = 6;
  bevelBox(matte, x1 - x0 - 0.04, 0.1, z1 - z0 - 0.04, 0.02, { color: PALETTE.joint, seg: 1, skipBottom: true, at: place((x0 + x1) / 2, 0.05, (z0 + z1) / 2) });
  for (let x = x0; x < x1 - 0.1; x += s) for (let z = z0; z < z1 - 0.1; z += s) {
    const k = 0.97 + (((x * 7 + z * 13) % 5) / 5) * 0.05;
    bevelBox(matte, s - 0.05, 0.12, Math.min(s, z1 - z) - 0.05, 0.03, { color: shade(PALETTE.concrete, k), seg: 1, skipBottom: true, at: place(x + s / 2, 0.06, z + Math.min(s, z1 - z) / 2) });
  }
  for (let z = z0 + 1; z < HELIPAD.z - HELIPAD.r - 0.5; z += 1.6) bevelBox(satin, 0.22, 0.012, 0.8, 0.004, { color: PALETTE.padYellow, seg: 1, at: place(HANGAR.x, 0.127, z + 0.4) });
  const P = HELIPAD;
  satin.transform(place(P.x, 0, P.z));
  satin.lathe([[P.r, 0.06], [P.r, 0.12], [P.r - 0.15, 0.17], [0, 0.17]], 64, false, PALETTE.padConcrete);
  satin.transform(place(P.x, 0.172, P.z, 0, 0, 0, 1, 0.08, 1));
  satin.torus(P.r - 1.2, 0.22, 64, 6, PALETTE.padYellow);
  satin.transform(null);
  for (const [w, d, ox] of [[0.7, 4.4, -1.15], [0.7, 4.4, 1.15], [1.6, 0.7, 0]] as const) bevelBox(satin, w, 0.016, d, 0.006, { color: PALETTE.laneWhite, seg: 1, at: place(P.x + ox, 0.178, P.z) });
  const pad = B.get(padLit);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    pad.transform(place(P.x + Math.cos(a) * (P.r + 0.35), 0, P.z + Math.sin(a) * (P.r + 0.35)));
    pad.lathe([[0.09, 0], [0.09, 0.12], [0.07, 0.19], [0, 0.22]], 10, true, PALETTE.navGreen);
    pad.transform(null);
  }
  const edge = B.get(edgeLit);
  for (let x = x0 + 3; x < x1; x += 12) for (const z of [z1 + 0.6]) {
    edge.transform(place(x, 0, z));
    edge.lathe([[0.07, 0], [0.07, 0.28], [0.1, 0.32], [0.06, 0.4], [0, 0.42]], 10, true, [0.35, 0.55, 1]);
    edge.transform(null);
  }
}

export function buildWindsock(B: Batch) {
  const W = WINDSOCK, metal = B.get('metal'), satin = B.get('satin');
  bevelBox(B.get('matte'), 1.2, 0.2, 1.2, 0.05, { color: PALETTE.concrete, at: place(W.x, 0.1, W.z) });
  sweep(metal, [[W.x, 0.2, W.z], [W.x, 6.4, W.z]], circle(0.06, 10), { color: PALETTE.metalGrey });
  const at = place(W.x, 6.1, W.z, W.yaw);
  satin.transform(new pc.Mat4().mul2(at, place(0, 0, 0, 0, 0, Math.PI / 2)));
  satin.torus(0.42, 0.03, 20, 6, PALETTE.metalGrey);
  satin.transform(null);
  const rows: V3[][] = [];
  const N = 30, C = 20, len = 3.4;
  for (let i = 0; i <= N; i++) {
    const t = i / N, r = 0.42 - t * 0.2, droop = -0.35 * t * t, x = t * len;
    const row: V3[] = [];
    for (let j = 0; j < C; j++) {
      const a = (j / C) * Math.PI * 2;
      row.push([x + 0.02, droop + Math.cos(a) * r, Math.sin(a) * r]);
    }
    rows.push(row);
  }
  const band = (i: number) => (Math.floor((i / N) * 5) % 2 ? PALETTE.trimWhite : PALETTE.windsockOrange);
  gridSurface(satin, rows, { at, color: i => band(i), flipped: true });
  gridSurface(satin, rows.map(r => r.map(([x, y, z]) => [x, y * 0.97, z * 0.97] as V3)), { at, color: i => shade(band(i), 0.7) });
}
