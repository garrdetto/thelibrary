/**
 * The Phase 0 look-development scene: three houses on a residential street
 * with lawns, trees, lamps and street furniture, and the corner of the
 * airfield with the hangar, apron, helipad, windsock and a parked helicopter.
 * Everything static is batched per finish (one entity per area).
 */
import * as pc from 'playcanvas';
import type { Renderer } from '../core/Renderer';
import { Batch } from '../core/Batch';
import type { Kit } from '../style/Kit';
import { place } from '../core/Shapes';
import { buildHouse, buildDrive, type HouseStyle } from '../models/House';
import { buildStreet, hydrant, lawnStripes, mailbox, picketFence, shrub, streetLamp } from '../models/Street';
import { broadleaf, MAPLE, OAK, spruce } from '../models/Trees';
import { buildApron, buildHangar, buildWindsock, hangarSign, HANGAR, HELIPAD } from '../models/Airfield';
import { buildHelicopter, type HelicopterModel } from '../models/Helicopter';
import { buildGround } from '../models/Ground';
import { rng } from '../../shared/Noise';
import { PALETTE } from '../../config';

export interface LookDevScene { heli: HelicopterModel; lamps: pc.Entity[]; triangles: number; breakdown: Record<string, number>; sign: pc.StandardMaterial }

const HOUSES: { x: number; style: Omit<HouseStyle, 'lit'> }[] = [
  { x: -48, style: { siding: PALETTE.sidingCream, door: PALETTE.doorNavy, roof: PALETTE.roofSlate, shutters: PALETTE.doorNavy, litPattern: 0b101101001011 } },
  { x: -20, style: { siding: PALETTE.sidingSage, door: PALETTE.doorRed, roof: PALETTE.roofSlate, shutters: PALETTE.shutterGreen, litPattern: 0b011010110110 } },
  { x: 8, style: { siding: PALETTE.sidingBlue, door: PALETTE.trimWhite, roof: PALETTE.roofRed, shutters: null, litPattern: 0b110110010101 } },
];

function pointLight(app: pc.AppBase, p: pc.Vec3, color: [number, number, number], range: number) {
  const e = new pc.Entity('lamp-light');
  e.addComponent('light', { type: 'omni', color: new pc.Color(...color), range, intensity: 0, castShadows: false, falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED });
  e.setPosition(p);
  app.root.addChild(e);
  return e;
}

export function buildLookDev(r: Renderer, kit: Kit): LookDevScene {
  const app = r.app, device = r.device;
  const windowLit = kit.glow('window', [1, 0.78, 0.5], 0, 1.4);
  const bulb = kit.glow('bulb', [1, 0.86, 0.6], 0.15, 6);
  const edge = kit.glow('edge', [0.35, 0.55, 1], 0.4, 4);
  const pad = kit.glow('pad', [0.3, 1, 0.45], 0.4, 4);
  let triangles = 0;
  const breakdown: Record<string, number> = {};
  const add = (B: Batch, name: string, opts?: { cast?: boolean }) => { breakdown[name] = B.triangles; triangles += B.triangles; app.root.addChild(B.build(device, name, opts)); };

  app.root.addChild(buildGround(device, kit.finish.ground));

  const street = new Batch(kit);
  const driveways: [number, number][] = HOUSES.map(h => [h.x + 6.05, h.x + 11.45]);
  buildStreet(street, driveways);
  const lamps: pc.Entity[] = [];
  for (const x of [-31, -3, 24, 52]) lamps.push(pointLight(app, streetLamp(street, x, 13.7, 1, bulb), [1, 0.82, 0.58], 16));
  for (const h of HOUSES) mailbox(street, h.x + 5.6, 15.25, PALETTE.mailboxBlue);
  hydrant(street, -16, 15.0);
  picketFence(street, -58, -42.6, 10.15);
  add(street, 'street');

  HOUSES.forEach((h, i) => {
    const B = new Batch(kit);
    const at = place(h.x, 0, 0);
    buildHouse(B, at, { ...h.style, lit: windowLit });
    buildDrive(B, at, 10.5);
    for (const [dx, s] of [[-4.6, 1.2], [-2.6, 1.0], [3.4, 1.1], [-5.2, 0.9]] as const) shrub(B, h.x + dx, 0.95, s, 40 + i * 7 + dx * 3);
    if (i === 1) lawnStripes(B, h.x - 9.5, 2.6, h.x + 0.4, 10.4, 1.1);
    if (i === 1) lawnStripes(B, h.x + 2.0, 2.6, h.x + 5.9, 10.4, 1.1);
    add(B, `house-${i}`);
  });

  const trees = new Batch(kit);
  const r0 = rng(7);
  for (const x of [-58, -27, 0, 27]) broadleaf(trees, x, 14.1, 8.5 + r0() * 1.5, Math.floor(x + 100), MAPLE);
  for (const [x, z] of [[-40, -17], [-6, -19], [20, -16]]) broadleaf(trees, x, z, 11 + r0() * 2, Math.floor(x * 3 + 500), OAK);
  for (let k = 0; k < 26; k++) {
    const x = -90 + r0() * 160, z = -32 - r0() * 60;
    if (r0() < 0.62) spruce(trees, x, z, 12 + r0() * 8, 900 + k); else broadleaf(trees, x, z, 10 + r0() * 4, 1200 + k, r0() < 0.5 ? OAK : MAPLE);
  }
  for (let k = 0; k < 10; k++) {
    const x = -80 + r0() * 140, z = 40 + r0() * 50;
    if (r0() < 0.5) spruce(trees, x, z, 11 + r0() * 7, 1500 + k); else broadleaf(trees, x, z, 10 + r0() * 3, 1600 + k, OAK);
  }
  for (let k = 0; k < 8; k++) spruce(trees, 132 + r0() * 30, -30 + r0() * 80, 13 + r0() * 6, 1700 + k);
  add(trees, 'trees');

  const field = new Batch(kit);
  buildHangar(field, windowLit);
  buildApron(field, edge, pad);
  buildWindsock(field);
  add(field, 'airfield');
  const sign = hangarSign(device, 'Kestrel County Airfield');
  app.root.addChild(sign.entity);
  for (const x of [-6, 6]) lamps.push(pointLight(app, new pc.Vec3(HANGAR.x + x, HANGAR.eave - 0.6, HANGAR.z - 2), [1, 0.9, 0.75], 18));

  const heli = buildHelicopter(device, kit);
  heli.root.setPosition(HELIPAD.x, 0.17, HELIPAD.z);
  heli.root.setEulerAngles(0, 138, 0);
  app.root.addChild(heli.root);
  triangles += heli.triangles;
  breakdown.helicopter = heli.triangles;

  return { heli, lamps, triangles, breakdown, sign: sign.material };
}
