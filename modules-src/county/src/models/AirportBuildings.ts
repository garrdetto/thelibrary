/**
 * The airport's buildings: a two-storey terminal with a glass curtain wall on
 * the apron side, a landside entrance canopy and a lit name board; a control
 * tower with a tapered shaft, an eight-sided glass cab, a gallery and a
 * rotating green-and-white beacon; the ribbed hangar from look development,
 * turned to face its pad; and a windsock whose striped sock swings downwind
 * and fills with the wind. Collider boxes for each building.
 */
import * as pc from 'playcanvas';
import type { RGB } from '../../../foxplains2/src/core/Geo';
import { bevelBox, circle, place, prism, sweep, type V2 } from '../core/Shapes';
import { Batch } from '../core/Batch';
import type { Kit } from '../style/Kit';
import { buildHangar, hangarSign, HANGAR } from './Airfield';
import { ELEV, HANGAR_AT, TERMINAL, TOWER, WINDSOCK_AT } from '../../shared/Airport';
import type { StaticBox } from '../../../foxplains2/src/physics/Physics';
import { PALETTE } from '../../config';

export interface AirportBuildings { root: pc.Entity; beacon: pc.Entity; sock: pc.Entity; signs: pc.StandardMaterial[]; colliders: StaticBox[] }

const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

function terminal(B: Batch, lit: pc.Material) {
  const T = TERMINAL, w = T.x1 - T.x0, d = T.z1 - T.z0, cx = (T.x0 + T.x1) / 2, cz = (T.z0 + T.z1) / 2, y = ELEV;
  const wall: RGB = [0.86, 0.87, 0.88], trim: RGB = [0.3, 0.36, 0.44], glass = PALETTE.windowGlass;
  const satin = B.get('satin'), matte = B.get('matte'), metal = B.get('metal');
  bevelBox(matte, w + 1, 0.4, d + 1, 0.05, { color: PALETTE.foundation, skipBottom: true, at: place(cx, y + 0.2, cz) });
  bevelBox(satin, w, 9, d, 0.12, { color: wall, skipBottom: true, at: place(cx, y + 4.9, cz) });
  for (const storey of [0, 1]) {
    const y0 = y + 0.9 + storey * 4.1;
    bevelBox(B.get('glass'), w - 4, 3.2, 0.2, 0.05, { color: glass, at: place(cx, y0 + 1.6, T.z0 - 0.04) });
    bevelBox(B.get(lit), w - 4.2, 3.0, 0.1, 0.03, { color: shade(glass, 0.8), seg: 1, at: place(cx, y0 + 1.6, T.z0 + 0.08) });
    for (let x = T.x0 + 2; x <= T.x1 - 2 + 1e-6; x += 3) bevelBox(metal, 0.14, 3.3, 0.3, 0.04, { color: trim, seg: 1, at: place(x, y0 + 1.6, T.z0 - 0.12) });
    bevelBox(metal, w - 3.8, 0.16, 0.32, 0.05, { color: trim, seg: 1, at: place(cx, y0 + 3.25, T.z0 - 0.12) });
    for (let x = T.x0 + 4; x < T.x1 - 3; x += 6) bevelBox(B.get(lit), 3.6, 2.0, 0.1, 0.03, { color: glass, seg: 1, at: place(x + 1.8, y0 + 1.8, T.z1 + 0.04) });
  }
  bevelBox(satin, w + 1.4, 0.7, d + 1.4, 0.12, { color: trim, at: place(cx, y + 9.6, cz) });
  for (const [dx, dz] of [[-20, -3], [-8, 4], [14, -2]]) bevelBox(metal, 4, 1.6, 3, 0.15, { color: PALETTE.metalGrey, at: place(cx + dx, y + 10.6, cz + dz) });
  bevelBox(satin, 22, 0.35, 6, 0.1, { color: trim, at: place(cx, y + 4.3, T.z1 + 3) });
  for (const s of [-1, 1]) sweep(metal, [[cx + s * 10, y + 0.3, T.z1 + 5.6], [cx + s * 10, y + 4.15, T.z1 + 5.6]], circle(0.16, 12), { color: PALETTE.metalGrey });
  bevelBox(B.get('glass'), 6, 3.2, 0.2, 0.05, { color: glass, at: place(cx, y + 2.0, T.z1 + 0.05) });
  bevelBox(matte, 24, 0.12, 8, 0.03, { color: PALETTE.concreteLight, skipBottom: true, at: place(cx, y + 0.06, T.z1 + 4.5) });
}

function tower(B: Batch, lit: pc.Material) {
  const { x, z } = TOWER, y = ELEV, wall: RGB = [0.88, 0.88, 0.86], trim: RGB = [0.3, 0.36, 0.44];
  const satin = B.get('satin'), metal = B.get('metal');
  bevelBox(satin, 12, 4.2, 10, 0.1, { color: wall, skipBottom: true, at: place(x, y + 2.1, z + 2) });
  bevelBox(B.get(lit), 9, 1.4, 0.1, 0.03, { color: PALETTE.windowGlass, seg: 1, at: place(x, y + 2.6, z - 3.04) });
  satin.transform(place(x, y, z));
  satin.lathe([[2.6, 0], [2.6, 0.4], [2.3, 1], [1.9, 20], [2.2, 21.2], [3.2, 21.8], [3.2, 22.2]], 24, true, wall);
  satin.transform(null);
  const oct: V2[] = Array.from({ length: 8 }, (_, k) => { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; return [x + Math.cos(a) * 3.6, z + Math.sin(a) * 3.6] as V2; });
  prism(B.get('glass'), oct, y + 22.2, y + 25.2, { color: PALETTE.glassCanopy });
  for (const [px, pz] of oct) sweep(metal, [[px, y + 22.2, pz], [px, y + 25.2, pz]], circle(0.08, 8), { color: trim });
  const roof: V2[] = Array.from({ length: 8 }, (_, k) => { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; return [x + Math.cos(a) * 4.4, z + Math.sin(a) * 4.4] as V2; });
  prism(satin, roof, y + 25.2, y + 25.8, { r: 0.12, seg: 2, color: trim });
  const rail: [number, number, number][] = [...roof, roof[0]].map(([px, pz]) => [px + (px - x) * 0.05, y + 23, pz + (pz - z) * 0.05]);
  sweep(metal, rail, circle(0.05, 6), { color: PALETTE.metalGrey, closed: true });
  sweep(metal, [[x, y + 25.8, z], [x, y + 29.5, z]], circle(0.07, 8), { color: PALETTE.metalGrey });
}

function windsock(device: pc.GraphicsDevice, kit: Kit) {
  const P = new Batch(kit), metal = P.get('paint');
  const { x, z } = WINDSOCK_AT;
  sweep(metal, [[x, ELEV, z], [x, ELEV + 6, z]], circle(0.08, 10), { color: PALETTE.trimWhite });
  metal.transform(place(x, ELEV + 6.05, z));
  metal.lathe([[0.42, 0], [0.42, 0.06], [0.06, 0.1]], 16, true, PALETTE.trimWhite);
  metal.transform(null);
  bevelBox(P.get('matte'), 3, 0.1, 3, 0.03, { color: PALETTE.concrete, skipBottom: true, at: place(x, ELEV + 0.05, z) });
  const S = new Batch(kit), cloth = S.get('foliage');
  for (let k = 0; k < 5; k++) {
    const x0 = k * 0.7, r0 = 0.45 - k * 0.055, r1 = 0.45 - (k + 1) * 0.055;
    cloth.transform(place(0, 0, 0, 0, 0, -Math.PI / 2));
    cloth.lathe([[r0, x0], [r1, x0 + 0.7]], 16, false, k % 2 ? PALETTE.trimWhite : PALETTE.windsockOrange);
    cloth.transform(null);
  }
  const sock = S.build(device, 'sock');
  sock.setLocalPosition(x, ELEV + 6, z);
  const root = P.build(device, 'windsock');
  root.addChild(sock);
  sock.setPosition(x, ELEV + 6, z);
  return { root, sock };
}

export function buildAirportBuildings(device: pc.GraphicsDevice, kit: Kit): AirportBuildings {
  const lit = kit.glow('airport-window', [1, 0.86, 0.62], 0.05, 1.3);
  const B = new Batch(kit);
  terminal(B, lit);
  tower(B, lit);
  const mark = B.mark();
  buildHangar(B, lit);
  B.move(mark, new pc.Mat4().mul2(place(HANGAR_AT.x, ELEV, HANGAR_AT.z, Math.PI), place(-HANGAR.x, 0, -HANGAR.z)));
  const root = new pc.Entity('airport-buildings');
  root.addChild(B.build(device, 'airport-buildings'));

  const signs: pc.StandardMaterial[] = [];
  const term = hangarSign(device, 'Kestrel County Airport', 24);
  term.entity.setPosition((TERMINAL.x0 + TERMINAL.x1) / 2, ELEV + 11.2, TERMINAL.z0 + 0.4);
  term.entity.setEulerAngles(0, 180, 0);
  root.addChild(term.entity); signs.push(term.material);

  const beaconB = new Batch(kit);
  const green = kit.glow('beacon-green', [0.3, 1, 0.45], 1.2, 8), white = kit.glow('beacon-white', [1, 1, 1], 1.2, 8);
  bevelBox(beaconB.get(green), 0.5, 0.4, 0.3, 0.1, { color: [0.6, 1, 0.7], at: place(0.3, 0, 0) });
  bevelBox(beaconB.get(white), 0.5, 0.4, 0.3, 0.1, { color: [1, 1, 1], at: place(-0.3, 0, 0) });
  const beacon = beaconB.build(device, 'beacon', { cast: false });
  beacon.setPosition(TOWER.x, ELEV + 29.8, TOWER.z);
  root.addChild(beacon);

  const ws = windsock(device, kit);
  root.addChild(ws.root);

  const h = HANGAR_AT;
  const colliders: StaticBox[] = [
    { cx: (TERMINAL.x0 + TERMINAL.x1) / 2, cy: ELEV + 5, cz: (TERMINAL.z0 + TERMINAL.z1) / 2, hx: (TERMINAL.x1 - TERMINAL.x0) / 2, hy: 5, hz: (TERMINAL.z1 - TERMINAL.z0) / 2 },
    { cx: TOWER.x, cy: ELEV + 2.1, cz: TOWER.z + 2, hx: 6, hy: 2.1, hz: 5 },
    { cx: TOWER.x, cy: ELEV + 13, cz: TOWER.z, hx: 2.3, hy: 13, hz: 2.3 },
    { cx: h.x, cy: ELEV + 4.5, cz: h.z + h.d / 2, hx: h.w / 2, hy: 4.5, hz: 0.3 },
    { cx: h.x - h.w / 2, cy: ELEV + 4.5, cz: h.z, hx: 0.3, hy: 4.5, hz: h.d / 2 },
    { cx: h.x + h.w / 2, cy: ELEV + 4.5, cz: h.z, hx: 0.3, hy: 4.5, hz: h.d / 2 },
    { cx: h.x, cy: ELEV + 9.2, cz: h.z, hx: h.w / 2, hy: 1.2, hz: h.d / 2 },
  ];
  return { root, beacon, sock: ws.sock, signs, colliders };
}
