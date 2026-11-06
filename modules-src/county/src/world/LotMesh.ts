/**
 * What stands on a lot: the full clipart house with its driveway and front
 * walk up close, a simple massing (walls, gable roof, garage) for distant
 * chunks, and the boxes its colliders use. Each house's colours and lit
 * windows come from the lot's seed.
 */
import * as pc from 'playcanvas';
import { bevelBox, prism, type V2 } from '../core/Shapes';
import type { Batch } from '../core/Batch';
import { buildDrive, buildHouse, type HouseStyle } from '../models/House';
import { shrub } from '../models/Street';
import { sub } from '../models/Parts';
import { rng } from '../../shared/Noise';
import { DRIVE, type Lot } from '../../shared/Roads';
import type { StaticBox } from '../../../foxplains2/src/physics/Physics';
import { PALETTE } from '../../config';

const SIDINGS = [PALETTE.sidingCream, PALETTE.sidingSage, PALETTE.sidingBlue, [0.93, 0.9, 0.84], [0.78, 0.74, 0.66], [0.86, 0.8, 0.62]] as const;
const DOORS = [PALETTE.doorNavy, PALETTE.doorRed, PALETTE.trimWhite, PALETTE.shutterGreen] as const;
const ROOFS = [PALETTE.roofSlate, PALETTE.roofRed, [0.36, 0.33, 0.31], [0.3, 0.36, 0.3]] as const;

export function lotStyle(l: Lot, lit: pc.Material): HouseStyle {
  const r = rng(l.house + 1);
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)];
  const door = pick(DOORS);
  return { siding: [...pick(SIDINGS)] as HouseStyle['siding'], door: [...door] as HouseStyle['door'], roof: [...pick(ROOFS)] as HouseStyle['roof'], shutters: r() < 0.6 ? ([...pick(DOORS)] as HouseStyle['siding']) : null, lit, litPattern: Math.floor(r() * 4096) };
}

/** The house's frame: origin at the front of the main block, +Z toward the street, base at the driveway's top. */
export function lotFrame(l: Lot) {
  const m = new pc.Mat4();
  m.setTRS(new pc.Vec3(l.origin[0], l.pad - 0.1, l.origin[1]), new pc.Quat().setFromEulerAngles(0, (l.yaw * 180) / Math.PI, 0), pc.Vec3.ONE);
  return m;
}

export function buildLotHouse(B: Batch, l: Lot, lit: pc.Material) {
  const at = lotFrame(l);
  buildHouse(B, at, lotStyle(l, lit));
  buildDrive(B, at, DRIVE.setback);
  const r = rng(l.house + 77);
  for (const [dx, s] of [[-4.6, 1.2], [-2.6, 1.0], [3.4, 1.1]] as const) {
    if (r() < 0.25) continue;
    const p = at.transformPoint(new pc.Vec3(dx, 0, 0.95));
    shrub(B, p.x, p.z, s, l.house % 97 + dx * 3);
  }
}

/** A distant house: plastered block, gable roof and garage, a few hundred triangles. */
export function buildHouseMass(B: Batch, l: Lot) {
  const at = lotFrame(l), st = lotStyle(l, null as unknown as pc.Material);
  const satin = B.get('satin'), matte = B.get('matte');
  bevelBox(satin, 11, 3.35, 8.5, 0.06, { color: st.siding, seg: 1, skipBottom: true, at: sub(at, 0, 1.675, -4.25) });
  bevelBox(satin, 6.5, 2.9, 6.6, 0.06, { color: st.siding, seg: 1, skipBottom: true, at: sub(at, 8.75, 1.45, -3.3) });
  const pitch = (35 * Math.PI) / 180, half = 4.25, eave = 0.4, rise = half * Math.tan(pitch);
  const gable: V2[] = [[0, -half], [0, half], [-rise, 0]];
  prism(satin, gable, -5.5, 5.5, { color: st.siding, at: sub(at, 0, 3.35, -half, 0, 0, -Math.PI / 2) });
  for (const s of [1, -1]) {
    const L = (half + eave) / Math.cos(pitch), midZ = -half + (s * (half + eave)) / 2, midY = 3.35 + rise - ((half + eave) / 2) * Math.tan(pitch);
    bevelBox(matte, 11.7, 0.16, L, 0.04, { color: st.roof, seg: 1, at: sub(at, 0, midY + Math.cos(pitch) * 0.08, midZ + s * Math.sin(pitch) * 0.08, 0, s * pitch) });
  }
  bevelBox(matte, 7, 0.25, 7.2, 0.05, { color: st.roof, seg: 1, at: sub(at, 8.75, 3.0, -3.3) });
}

/** Collider boxes for a house (main block and garage). */
export function houseColliders(l: Lot): StaticBox[] {
  const at = lotFrame(l), rotY = l.yaw;
  const box = (x: number, z: number, hx: number, hy: number, hz: number): StaticBox => {
    const p = at.transformPoint(new pc.Vec3(x, hy, z));
    return { cx: p.x, cy: p.y, cz: p.z, hx, hy, hz, rotY };
  };
  return [box(0, -4.25, 5.65, 3.3, 4.4), box(8.75, -3.3, 3.3, 1.6, 3.35)];
}
