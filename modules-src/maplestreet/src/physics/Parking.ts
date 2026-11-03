/**
 * Finding room for a vehicle. Every time a vehicle is put somewhere (your
 * driveway on arrival, Maple Motors' curb for a test drive, the pumps after a
 * tow) the spot is checked against buildings, props, your other vehicles and
 * everyone else's, and the nearest free spot is used instead when it's taken.
 * A watchdog also lifts parked vehicles that ended up overlapping or resting
 * on another one (a neighbor's car arriving where yours stands) onto free
 * ground nearby, so nothing stays stacked or wedged.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import { CG, Physics } from './Physics';

export interface Footprint { x: number; z: number; yaw: number; hx: number; hz: number }

const BLOCKERS = CG.STATIC | CG.VEHICLE | CG.REMOTE | CG.PROP;
const VEHICLES_ONLY = CG.VEHICLE | CG.REMOTE;

/** Forward (+X) and right (+Z) axes of a yaw about +Y, on the ground plane. */
function axes(yaw: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { fx: c, fz: -s, rx: s, rz: c };
}

/** Separating-axis test for two ground-plane rectangles, grown by `margin` on every side. */
export function footprintsOverlap(a: Footprint, b: Footprint, margin = 0) {
  const A = axes(a.yaw), B = axes(b.yaw);
  const dx = b.x - a.x, dz = b.z - a.z;
  const ahx = a.hx + margin, ahz = a.hz + margin, bhx = b.hx + margin, bhz = b.hz + margin;
  for (const [ax, az] of [[A.fx, A.fz], [A.rx, A.rz], [B.fx, B.fz], [B.rx, B.rz]]) {
    const ra = ahx * Math.abs(A.fx * ax + A.fz * az) + ahz * Math.abs(A.rx * ax + A.rz * az);
    const rb = bhx * Math.abs(B.fx * ax + B.fz * az) + bhz * Math.abs(B.rx * ax + B.rz * az);
    if (Math.abs(dx * ax + dz * az) > ra + rb) return false;
  }
  return true;
}

export class Parking {
  constructor(private physics: Physics) {}

  /** Bring scene queries up to date with colliders created or moved since the last physics step. */
  private refresh() {
    (this.physics.world as unknown as { updateSceneQueries?: () => void }).updateSceneQueries?.();
  }

  private quat(yaw: number) {
    return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  }

  /**
   * True when nothing in `mask` overlaps the box. `exclude` bodies (the vehicle
   * itself, its trailer) are ignored.
   */
  private boxFree(cx: number, cy: number, cz: number, yaw: number, hx: number, hy: number, hz: number, mask: number, exclude: readonly RAPIER.RigidBody[], ignore = 0) {
    const R = this.physics.R, world = this.physics.world;
    const shape = new R.Cuboid(hx, hy, hz);
    let free = true;
    world.intersectionsWithShape({ x: cx, y: cy, z: cz }, this.quat(yaw), shape, (hit: unknown) => {
      const col = (typeof hit === 'number' ? world.getCollider(hit) : hit) as RAPIER.Collider | null;
      if (!col) return true;
      const member = (col.collisionGroups() >>> 16) & 0xffff;
      if (!(member & mask) || (member & ignore)) return true;
      const parent = col.parent();
      if (parent && exclude.includes(parent)) return true;
      free = false;
      return false;
    });
    return free;
  }

  /** Is this ground-plane footprint free of buildings, props and vehicles (ignoring kerbs and the ground)? */
  isClear(f: Footprint, height: number, exclude: readonly RAPIER.RigidBody[] = [], reserved: readonly Footprint[] = [], margin = 0.35) {
    if (reserved.some(r => footprintsOverlap(f, r, margin))) return false;
    const hy = Math.max(0.3, height / 2);
    return this.boxFree(f.x, 0.3 + hy, f.z, f.yaw, f.hx + margin, hy, f.hz + margin, BLOCKERS, exclude);
  }

  /**
   * The nearest free spot to `want` (same heading), trying side-by-side and
   * nose-to-tail slots in widening rings. Falls back to `want` if the whole
   * neighbourhood is full.
   */
  find(want: Footprint, height: number, exclude: readonly RAPIER.RigidBody[] = [], reserved: readonly Footprint[] = [], rings = 5): Footprint {
    this.refresh();
    if (this.isClear(want, height, exclude, reserved)) return want;
    const { fx, fz, rx, rz } = axes(want.yaw);
    const stepSide = want.hz * 2 + 0.9, stepLong = want.hx * 2 + 1.2;
    const slots: { lat: number; lon: number; d: number }[] = [];
    for (let lat = -rings; lat <= rings; lat++) for (let lon = -rings; lon <= rings; lon++) {
      if (!lat && !lon) continue;
      slots.push({ lat, lon, d: Math.hypot(lat * stepSide, lon * stepLong) });
    }
    slots.sort((a, b) => a.d - b.d);
    for (const s of slots) {
      const f = { ...want, x: want.x + rx * s.lat * stepSide + fx * s.lon * stepLong, z: want.z + rz * s.lat * stepSide + fz * s.lon * stepLong };
      if (this.isClear(f, height, exclude, reserved)) return f;
    }
    return want;
  }

  /**
   * True when a parked body overlaps another vehicle or rests on top of one.
   * The box is shrunk sideways (resting contact isn't overlap) and reaches a
   * little below the chassis to catch a car sitting on another car's roof.
   * Trailer beds don't count: riding a mower or cart up onto one is allowed.
   */
  stacked(body: RAPIER.RigidBody, hx: number, hy: number, hz: number, exclude: readonly RAPIER.RigidBody[]) {
    this.refresh();
    const t = body.translation(), r = body.rotation();
    const yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.z * r.z));
    return !this.boxFree(t.x, t.y - 0.12, t.z, yaw, Math.max(0.2, hx - 0.15), hy + 0.12, Math.max(0.15, hz - 0.12), VEHICLES_ONLY, exclude, CG.DECK);
  }
}
