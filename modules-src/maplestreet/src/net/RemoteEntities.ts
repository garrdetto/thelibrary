/**
 * Other players, neighbor traffic and their vehicles, rendered ~120 ms in the
 * past and interpolated between authority snapshots (classic entity
 * interpolation, smooth at 15 Hz updates regardless of jitter).
 *
 * Every remote vehicle is first of all data: a snapshot buffer the authority
 * keeps filling (NpcTraffic in shared/Npc.ts simulates neighbor traffic for
 * the whole town on the host, whether or not anyone can see it). Only
 * vehicles within VEHICLE_SPAWN_R of the player get a view: the 3D shell,
 * wheels, lights and a kinematic collider so your truck bumps into theirs.
 * Past VEHICLE_DESPAWN_R the view goes back to a per-kind pool (removed from
 * the scene, collider disabled), so it costs no draw calls, no shadow work
 * and no physics. When the vehicle comes back into range a pooled view is
 * placed at the exact interpolated position, heading, steering and speed the
 * snapshots give for that moment, so it picks up mid-motion.
 *
 * Neighbor walkers and drivers (ids starting with `npc-`) are virtual the same
 * way: their avatar is created the first time one is near, and taken out of
 * the scene (and out of skeletal animation) while far away or while their car
 * is virtual. Real players on foot are always drawn.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import type { PlayerSnap, VehicleSnap } from '../../shared/Protocol';
import { noNormalsMRT } from '../core/Engine';
import { mergeStatic } from '../core/Merge';
import { Avatar } from '../physics/Character';
import { lookKey } from '../../shared/Wardrobe';
import { MASK, Physics } from '../physics/Physics';
import { makeLights, paintFor, PRESETS, tintGlass, wheelForCar, type VehicleLights, type VehiclePreset } from '../physics/VehiclePresets';
import { carStyleKey, tuneEffects, type CarStyle, type OwnedCar } from '../../shared/Cars';
import { applyDents } from '../physics/Dents';
import { VehicleDoors } from '../physics/VehicleDoors';
import type { PartRig } from '../physics/CutParts';

const INTERP_DELAY_MS = 120;
/** Vehicles get a 3D view inside this radius (m) and lose it past the despawn radius. */
export const VEHICLE_SPAWN_R = 200;
export const VEHICLE_DESPAWN_R = 240;
/** Neighbor walkers, same idea; people are small, so the radius is shorter. */
export const WALKER_SPAWN_R = 110;
export const WALKER_DESPAWN_R = 140;
const V_SPAWN2 = VEHICLE_SPAWN_R ** 2, V_DESPAWN2 = VEHICLE_DESPAWN_R ** 2;
const W_SPAWN2 = WALKER_SPAWN_R ** 2, W_DESPAWN2 = WALKER_DESPAWN_R ** 2;

/** The two snapshots bracketing a render time, and how far between them it is. Reused, never reallocated. */
interface Sample<T> { a: T; b: T; k: number }

class SnapBuffer<T extends { x: number; y: number; z: number }> {
  private buf: { t: number; s: T }[] = [];
  push(t: number, s: T) {
    if (this.buf.length && t <= this.buf[this.buf.length - 1].t) return;
    this.buf.push({ t, s });
    if (this.buf.length > 30) this.buf.shift();
  }
  /** Fills `out` with the snapshots bracketing render time t. False when nothing has arrived yet. */
  sample(t: number, out: Sample<T>): boolean {
    const b = this.buf;
    if (!b.length) return false;
    if (t <= b[0].t) { out.a = out.b = b[0].s; out.k = 0; return true; }
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= t) {
        const span = b[i].t - b[i - 1].t || 1;
        out.a = b[i - 1].s; out.b = b[i].s; out.k = Math.min(1, (t - b[i - 1].t) / span);
        return true;
      }
    }
    out.a = out.b = b[b.length - 1].s; out.k = 0;
    return true;
  }
  get latest() { return this.buf.length ? this.buf[this.buf.length - 1].s : null; }
}

const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const isNpc = (id: string) => id.startsWith('npc-');

/** Everything that makes a vehicle visible and solid. Pooled per kind and reused across vehicles. */
interface VehicleView {
  kind: VehicleSnap['kind']; root: THREE.Group; wheels: { g: THREE.Group; steer: boolean; spin: number }[]; lights: VehicleLights; doors: VehicleDoors | null; body: RAPIER.RigidBody;
  /** Body mesh and the one paint material it shares with the doors; rebuilt when the car's look changes. */
  shell: THREE.Group; paint: THREE.MeshPhysicalMaterial; styleKey: string;
}
/** A remote vehicle: always its snapshot data, plus a view while it is near. */
interface RemoteVehicle { kind: VehicleSnap['kind']; owner: string; buf: SnapBuffer<VehicleSnap>; seen: number; view: VehicleView | null; fresh: boolean; style: CarStyle | null }

/** What a right-click on someone else's vehicle shows. */
export interface RemoteVehicleInfo { kind: VehicleSnap['kind']; label: string; ownerName: string; distance: number }
interface RemotePlayer {
  name: string; color: string; npc: boolean; look: PlayerSnap['look'];
  avatar: Avatar | null; label: THREE.Sprite | null; lookKey: string;
  buf: SnapBuffer<PlayerSnap>; seen: number;
  /** The vehicle root the avatar sits in, or null when standing in the scene or hidden. */
  seatRoot: THREE.Object3D | null;
  shown: boolean;
}

function nameSprite(name: string, color: string) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(15,18,24,0.7)'; g.beginPath(); g.roundRect(6, 6, 500, 84, 40); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc(52, 48, 18, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = '600 44px system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillText(name, 86, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(noNormalsMRT(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true })));
  s.scale.set(1.9, 0.36, 1);
  return s;
}

export class RemoteEntities {
  private players = new Map<string, RemotePlayer>();
  private vehicles = new Map<string, RemoteVehicle>();
  /** Idle vehicle views by kind: out of the scene, collider disabled. */
  private pool = new Map<string, VehicleView[]>();
  private clockOffset: number | null = null;
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private vs: Sample<VehicleSnap> = { a: null!, b: null!, k: 0 };
  private ps: Sample<PlayerSnap> = { a: null!, b: null!, k: 0 };
  private vec = { x: 0, y: 0, z: 0 };
  private rot = { x: 0, y: 0, z: 0, w: 1 };

  constructor(private scene: THREE.Scene, private physics: Physics, private selfId: () => string | null) {}

  ingest(time: number, players: PlayerSnap[], vehicles: VehicleSnap[]) {
    const offset = time - Date.now();
    this.clockOffset = this.clockOffset === null ? offset : this.clockOffset * 0.95 + offset * 0.05;
    const me = this.selfId(), now = performance.now();

    for (const p of players) {
      if (p.id === me) continue;
      let rp = this.players.get(p.id);
      if (!rp) {
        rp = { name: p.name, color: p.color, npc: isNpc(p.id), look: p.look, avatar: null, label: null, lookKey: lookKey(p.look), buf: new SnapBuffer(), seen: now, seatRoot: null, shown: false };
        this.players.set(p.id, rp);
        // Real neighbors appear right away; simulated ones only once someone is near them.
        if (!rp.npc) this.showStanding(rp);
      }
      this.ownerNames.set(p.id, p.name);
      const key = lookKey(p.look);
      if (p.look && key !== rp.lookKey) { rp.lookKey = key; rp.look = p.look; rp.avatar?.setLook(p.look); }
      rp.buf.push(time, p); rp.seen = now;
    }
    for (const v of vehicles) {
      if (v.owner === me) continue;
      let rv = this.vehicles.get(v.id);
      if (!rv) { rv = { kind: v.kind, owner: v.owner, buf: new SnapBuffer(), seen: now, view: null, fresh: false, style: null }; this.vehicles.set(v.id, rv); }
      rv.style = v.style ?? null;
      if (rv.view && rv.view.styleKey !== carStyleKey(rv.style)) this.restyle(rv.view, rv.style);
      rv.buf.push(time, v); rv.seen = now;
    }
    // Despawn anything not seen for 3 s.
    for (const [id, rp] of this.players) if (now - rp.seen > 3000) this.removePlayer(id);
    for (const [id, rv] of this.vehicles) if (now - rv.seen > 3000) this.removeVehicle(id);
  }

  // ---------------------------------------------------------------- vehicle views (pooled)

  private buildView(kind: VehicleSnap['kind']): VehicleView {
    const P = PRESETS[kind] ?? PRESETS.sedan, R = this.physics.R;
    const root = new THREE.Group();
    const lights = makeLights();
    const paint = paintFor(P, null);
    const doors = VehicleDoors.for(kind, paint, P.seat.z);
    if (doors) root.add(doors.group);
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    this.physics.world.createCollider(this.physics.vehicleShape(P.chassis.hx, P.chassis.hy, P.chassis.hz).setFriction(0.3).setCollisionGroups(P.tongue ? MASK.remoteTrailer : MASK.remote), body);
    const view: VehicleView = { kind, root, wheels: [], lights, doors, body, shell: new THREE.Group(), paint, styleKey: '-' };
    this.restyle(view, null);
    return view;
  }

  /** Dress a view as one particular car: its paint (shared with the doors), dents, tint, rims and lift. */
  private restyle(view: VehicleView, style: CarStyle | null) {
    const P: VehiclePreset = PRESETS[view.kind] ?? PRESETS.sedan;
    view.paint.copy(paintFor(P, style));
    view.paint.needsUpdate = true;
    view.root.remove(view.shell);
    const shell = view.shell = P.build(view.paint, view.lights);
    tintGlass(shell, style?.tint);
    mergeStatic(shell, { flatten: () => true });
    applyDents(shell, style?.dents);
    shell.userData.onFill = () => applyDents(shell, style?.dents);
    shell.traverse(o => (o.castShadow = true));
    view.root.add(shell);
    for (const w of view.wheels) view.root.remove(w.g);
    const tune = tuneEffects(style as OwnedCar | null);
    view.wheels = [];
    for (const a of P.axles) for (const side of [1, -1]) {
      const g = new THREE.Group(), spin = wheelForCar(P, a.radius, a.width, style, tune.tireScale);
      g.add(spin); g.position.set(a.x, P.wheelY - (P.suspension.rest + tune.lift) * 0.8, a.halfTrack * side);
      g.traverse(o => (o.castShadow = true));
      view.root.add(g); view.wheels.push({ g, steer: a.steer, spin: 0 });
    }
    view.styleKey = carStyleKey(style);
  }

  private acquire(rv: RemoteVehicle) {
    const view = this.pool.get(rv.kind)?.pop() ?? this.buildView(rv.kind);
    if (view.styleKey !== carStyleKey(rv.style)) this.restyle(view, rv.style);
    view.body.setEnabled(true);
    this.scene.add(view.root);
    rv.view = view;
    rv.fresh = true;            // teleport the collider on its first pose instead of sweeping it across town
  }

  private release(rv: RemoteVehicle) {
    const view = rv.view;
    if (!view) return;
    // Anyone seated in it leaves the scene with it; they come back when it does.
    for (const rp of this.players.values()) if (rp.seatRoot === view.root) this.hide(rp);
    view.root.removeFromParent();
    view.body.setEnabled(false);
    let list = this.pool.get(view.kind);
    if (!list) this.pool.set(view.kind, (list = []));
    list.push(view);
    rv.view = null;
  }

  // ---------------------------------------------------------------- avatars (lazy)

  private ensureAvatar(rp: RemotePlayer): Avatar {
    if (!rp.avatar) {
      rp.avatar = new Avatar(rp.look ?? rp.color);
      rp.label = nameSprite(rp.name, rp.color);
      rp.label.position.y = 2.15;
      rp.avatar.root.add(rp.label);
    }
    return rp.avatar;
  }
  private showStanding(rp: RemotePlayer) {
    this.ensureAvatar(rp).standIn(this.scene, 0);
    rp.seatRoot = null; rp.shown = true;
  }
  private hide(rp: RemotePlayer) {
    rp.avatar?.root.removeFromParent();
    rp.seatRoot = null; rp.shown = false;
  }

  // ---------------------------------------------------------------- removal

  removePlayer(id: string) {
    this.ownerNames.delete(id);
    const rp = this.players.get(id); if (!rp) return;
    rp.avatar?.dispose(); this.players.delete(id);
  }
  removeVehicle(id: string) {
    const rv = this.vehicles.get(id); if (!rv) return;
    this.release(rv);
    this.vehicles.delete(id);
  }
  removeOwner(sessionId: string) {
    this.removePlayer(sessionId);
    for (const [id] of this.vehicles) if (id.startsWith(`${sessionId}:`)) this.removeVehicle(id);
  }

  // ---------------------------------------------------------------- per frame

  /** `focus` is the player (or the build-mode target): proximity is measured from it. */
  update(dt: number, night: number, focus: THREE.Vector3) {
    if (this.clockOffset === null) return;
    const t = Date.now() + this.clockOffset - INTERP_DELAY_MS;
    const fx = focus.x, fz = focus.z;

    for (const rv of this.vehicles.values()) {
      // Proximity runs on the newest authoritative position: the vehicle keeps
      // moving in the data even while it has no view.
      const last = rv.buf.latest;
      if (!last) continue;
      const dx = last.x - fx, dz = last.z - fz, d2 = dx * dx + dz * dz;
      if (!rv.view) { if (d2 < V_SPAWN2) this.acquire(rv); else continue; }
      else if (d2 > V_DESPAWN2) { this.release(rv); continue; }

      const view = rv.view!;
      const s = this.vs;
      if (!rv.buf.sample(t, s)) continue;
      const { a, b, k } = s;
      view.root.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      this.q.set(a.qx, a.qy, a.qz, a.qw); this.q2.set(b.qx, b.qy, b.qz, b.qw);
      view.root.quaternion.slerpQuaternions(this.q, this.q2, k);
      const speed = a.speed + (b.speed - a.speed) * k, steer = a.steer + (b.steer - a.steer) * k;
      for (const w of view.wheels) {
        w.g.rotation.y = w.steer ? steer : 0;
        w.spin -= (speed * dt) / 0.35;
        w.g.children[0].rotation.z = w.spin;
      }
      this.doorsOf(view)?.update(dt, speed);
      view.lights.head.emissiveIntensity = night > 0.3 ? 3 : 0;
      view.lights.tail.emissiveIntensity = night > 0.3 ? 1.2 : 0.15;
      const p = view.root.position, q = view.root.quaternion;
      const v = this.vec, r = this.rot;
      v.x = p.x; v.y = p.y; v.z = p.z; r.x = q.x; r.y = q.y; r.z = q.z; r.w = q.w;
      if (rv.fresh) { view.body.setTranslation(v, true); view.body.setRotation(r, true); rv.fresh = false; }
      view.body.setNextKinematicTranslation(v);
      view.body.setNextKinematicRotation(r);
    }

    for (const rp of this.players.values()) {
      const s = this.ps;
      if (!rp.buf.sample(t, s)) continue;
      const { a, b, k } = s;
      // Drivers sit in their seat, hands on the wheel, and ride along with the vehicle.
      const veh = b.vehicleId ? this.vehicles.get(b.vehicleId) ?? null : null;
      if (veh) {
        if (!veh.view) { if (rp.shown) this.hide(rp); continue; }      // their car is virtual: so are they
        if (rp.seatRoot !== veh.view.root) {
          this.ensureAvatar(rp).sitIn(veh.view.root, (PRESETS[veh.kind] ?? PRESETS.sedan).seat);
          rp.seatRoot = veh.view.root; rp.shown = true;
          this.doorsOf(veh.view)?.pulseDriver();
        }
        rp.avatar!.root.visible = true;
        rp.avatar!.animate(dt, 0, true);
        continue;
      }
      if (rp.npc) {
        const dx = b.x - fx, dz = b.z - fz, d2 = dx * dx + dz * dz;
        if (rp.shown && !rp.seatRoot ? d2 > W_DESPAWN2 : d2 > W_SPAWN2) { if (rp.shown) this.hide(rp); continue; }
      }
      if (rp.seatRoot) { const seat = this.viewOf(rp.seatRoot); if (seat) this.doorsOf(seat)?.pulseDriver(); }
      if (!rp.shown || rp.seatRoot) this.showStanding(rp);
      const av = rp.avatar!;
      av.root.visible = !b.vehicleId;
      av.root.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      av.root.rotation.y = lerpAngle(a.yaw, b.yaw, k);
      av.animate(dt, a.speed + (b.speed - a.speed) * k, false);
    }
  }

  /** The view's built-in doors, or a published model's cut-out parts once it has loaded. */
  private doorsOf(view: VehicleView): VehicleDoors | PartRig | null {
    return view.doors ?? (view.shell.userData.partRig as PartRig | undefined) ?? null;
  }

  private viewOf(root: THREE.Object3D) {
    for (const v of this.vehicles.values()) if (v.view?.root === root) return v.view;
    return null;
  }

  /** The nearest other player's (or neighbor's) vehicle under a ray, for the right-click menu. */
  pickVehicle(ray: THREE.Raycaster, maxDistance = 80): RemoteVehicleInfo | null {
    const near = [...this.vehicles.values()].filter(v => v.view);
    const roots = near.map(v => v.view!.root);
    for (const r of roots) r.updateMatrixWorld(true);
    const hit = ray.intersectObjects(roots, true)[0];
    if (!hit || hit.distance > maxDistance) return null;
    for (const v of near) {
      let o: THREE.Object3D | null = hit.object;
      while (o && o !== v.view!.root) o = o.parent;
      if (!o) continue;
      const P = PRESETS[v.kind] ?? PRESETS.sedan;
      return { kind: v.kind, label: P.label, ownerName: this.ownerNames.get(v.owner) ?? 'A neighbor', distance: hit.distance };
    }
    return null;
  }

  private ownerNames = new Map<string, string>();

  clear() {
    for (const id of [...this.players.keys()]) this.removePlayer(id);
    for (const id of [...this.vehicles.keys()]) this.removeVehicle(id);
  }

  get count() { return this.players.size; }

  /** Counts for the dev overlay and tests. */
  stats() {
    let rendered = 0, pooled = 0, avatars = 0, shown = 0;
    for (const v of this.vehicles.values()) if (v.view) rendered++;
    for (const l of this.pool.values()) pooled += l.length;
    for (const p of this.players.values()) { if (p.avatar) avatars++; if (p.shown) shown++; }
    return { vehicles: this.vehicles.size, rendered, pooled, players: this.players.size, avatars, shown };
  }
}
