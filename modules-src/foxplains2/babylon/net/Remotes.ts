/**
 * Everyone else in the shared world: neighbors on foot or driving, and the
 * simulated neighbor traffic, drawn about 120 ms in the past and
 * interpolated between authority snapshots (smooth at 15 Hz). Snapshots are
 * the same ones Fox Plains sends and reads, so people in either version see
 * each other. Vehicles only get a view (model, wheels, lamps and a kinematic
 * collider you can bump into) within 200 m; simulated walkers only within 110 m.
 * Real neighbors get a name tag. The per-frame loop reuses its vectors and
 * quaternions and allocates nothing.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MASK, type Physics } from '../physics/Physics';
import type { VehicleModels, VehicleView } from '../physics/VehicleModels';
import { Avatar, type AvatarKits } from '../avatar/Avatar';
import type { Renderer } from '../core/Renderer';
import { TUNING } from '../../../maplestreet/shared/Vehicles';
import { lookKey } from '../../../maplestreet/shared/Wardrobe';
import { VEHICLES } from '../../../maplestreet/shared/Economy';
import type { PlayerSnap, VehicleSnap } from '../../../maplestreet/shared/Protocol';

const INTERP_DELAY_MS = 120;
const V_SPAWN = 200, V_DESPAWN = 240, W_SPAWN = 110, W_DESPAWN = 140, TAG_RANGE = 70;
const isNpc = (id: string) => id.startsWith('npc-');

class SnapBuffer<T> {
  private items: { t: number; s: T }[] = [];
  push(t: number, s: T) {
    if (this.items.length && t <= this.items[this.items.length - 1].t) return;
    this.items.push({ t, s });
    if (this.items.length > 24) this.items.shift();
  }
  get latest() { return this.items.length ? this.items[this.items.length - 1].s : null; }
  sample(t: number): { a: T; b: T; k: number } | null {
    const it = this.items;
    if (!it.length) return null;
    if (t <= it[0].t) return { a: it[0].s, b: it[0].s, k: 0 };
    for (let i = it.length - 1; i > 0; i--) {
      if (it[i - 1].t <= t) {
        if (t >= it[i].t) return { a: it[i].s, b: it[i].s, k: 0 };
        return { a: it[i - 1].s, b: it[i].s, k: (t - it[i - 1].t) / Math.max(1, it[i].t - it[i - 1].t) };
      }
    }
    return { a: it[it.length - 1].s, b: it[it.length - 1].s, k: 0 };
  }
}

interface RemoteVehicle { kind: string; owner: string; buf: SnapBuffer<VehicleSnap>; seen: number; view: VehicleView | null; body: RAPIER.RigidBody | null; fresh: boolean; spin: number[]; style: VehicleSnap['style'] }
interface RemotePlayer { name: string; color: string; npc: boolean; look: PlayerSnap['look']; avatar: Avatar | null; entity: TransformNode; buf: SnapBuffer<PlayerSnap>; seen: number; seatedIn: string | null; tag: HTMLDivElement | null; lookKey: string }

const _p = new Vector3(), _s = new Vector3(), _qa = new Quaternion(), _qb = new Quaternion();
const _pos = { x: 0, y: 0, z: 0 }, _rot = { x: 0, y: 0, z: 0, w: 1 };

export class Remotes {
  private players = new Map<string, RemotePlayer>();
  private vehicles = new Map<string, RemoteVehicle>();
  private clockOffset: number | null = null;
  private root: TransformNode;
  private tags: HTMLDivElement;
  readonly ownerNames = new Map<string, string>();

  constructor(private physics: Physics, private models: VehicleModels, private kits: AvatarKits, private renderer: Renderer, private selfId: () => string | null) {
    this.root = new TransformNode('remotes', renderer.scene);
    this.tags = document.createElement('div');
    this.tags.id = 'tags';
    document.body.appendChild(this.tags);
  }

  get count() { let n = 0; for (const p of this.players.values()) if (!p.npc) n++; return n; }

  ingest(time: number, players: PlayerSnap[], vehicles: VehicleSnap[]) {
    const offset = time - Date.now();
    this.clockOffset = this.clockOffset === null ? offset : this.clockOffset * 0.95 + offset * 0.05;
    const me = this.selfId(), now = performance.now();
    for (const p of players) {
      if (p.id === me) continue;
      let rp = this.players.get(p.id);
      if (!rp) {
        const entity = new TransformNode(`remote-${p.id}`, this.renderer.scene);
        entity.parent = this.root;
        rp = { name: p.name, color: p.color, npc: isNpc(p.id), look: p.look, avatar: null, entity, buf: new SnapBuffer(), seen: now, seatedIn: null, tag: null, lookKey: lookKey(p.look) };
        this.players.set(p.id, rp);
      }
      this.ownerNames.set(p.id, p.name);
      const key = lookKey(p.look);
      if (p.look && key !== rp.lookKey) { rp.lookKey = key; rp.look = p.look; rp.avatar?.setLook(p.look); }
      rp.buf.push(time, p); rp.seen = now;
    }
    for (const v of vehicles) {
      if (v.owner === me) continue;
      let rv = this.vehicles.get(v.id);
      if (!rv) { rv = { kind: v.kind, owner: v.owner, buf: new SnapBuffer(), seen: now, view: null, body: null, fresh: false, spin: [], style: null }; this.vehicles.set(v.id, rv); }
      rv.style = v.style ?? null;
      rv.view?.setStyle(rv.style);
      rv.buf.push(time, v); rv.seen = now;
    }
    for (const [id, rp] of this.players) if (now - rp.seen > 3000) this.removePlayer(id);
    for (const [id, rv] of this.vehicles) if (now - rv.seen > 3000) this.removeVehicle(id);
  }

  removeOwner(sessionId: string) {
    this.removePlayer(sessionId);
    for (const [id] of this.vehicles) if (id.startsWith(`${sessionId}:`)) this.removeVehicle(id);
  }

  clear() {
    for (const id of [...this.players.keys()]) this.removePlayer(id);
    for (const id of [...this.vehicles.keys()]) this.removeVehicle(id);
  }

  private removePlayer(id: string) {
    const rp = this.players.get(id);
    if (!rp) return;
    rp.avatar?.dispose();
    rp.entity.dispose(false, false);
    rp.tag?.remove();
    this.players.delete(id);
  }

  private removeVehicle(id: string) {
    const rv = this.vehicles.get(id);
    if (!rv) return;
    this.release(rv);
    this.vehicles.delete(id);
  }

  private acquire(rv: RemoteVehicle) {
    const R = this.physics.R, P = TUNING[rv.kind] ?? TUNING.sedan;
    rv.view = this.models.build(rv.kind, rv.style);
    rv.view.root.parent = this.root;
    rv.view.root.rotationQuaternion ??= new Quaternion();
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    this.physics.world.createCollider(this.physics.vehicleShape(P.chassis.hx, P.chassis.hy, P.chassis.hz).setCollisionGroups(P.tongue ? MASK.remoteTrailer : MASK.remote), body);
    rv.body = body;
    rv.fresh = true;
    rv.spin = rv.view.wheels.map(() => 0);
  }

  private release(rv: RemoteVehicle) {
    for (const p of this.players.values()) if (p.avatar && p.seatedIn && this.vehicles.get(p.seatedIn) === rv) { p.avatar.dispose(); p.avatar = null; p.seatedIn = null; }
    rv.view?.destroy(); rv.view = null;
    if (rv.body) this.physics.world.removeRigidBody(rv.body);
    rv.body = null;
  }

  /** Name and vehicle of whoever owns the remote vehicle nearest a world point (for the right-click menu). */
  vehicleNear(x: number, z: number, r = 3.5) {
    let best: { name: string; label: string } | null = null, bd = r;
    for (const rv of this.vehicles.values()) {
      if (!rv.view) continue;
      const p = rv.view.root.position, d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = { name: this.ownerNames.get(rv.owner) ?? 'A neighbor', label: VEHICLES[rv.kind]?.name ?? TUNING[rv.kind]?.label ?? 'vehicle' }; }
    }
    return best;
  }

  update(dt: number, night: number, focus: { x: number; z: number }) {
    if (this.clockOffset === null) return;
    const t = Date.now() + this.clockOffset - INTERP_DELAY_MS;
    for (const rv of this.vehicles.values()) {
      const last = rv.buf.latest;
      if (!last) continue;
      const d2 = (last.x - focus.x) ** 2 + (last.z - focus.z) ** 2;
      if (!rv.view) { if (d2 < V_SPAWN * V_SPAWN) this.acquire(rv); else continue; }
      else if (d2 > V_DESPAWN * V_DESPAWN) { this.release(rv); continue; }
      const s = rv.buf.sample(t);
      if (!s || !rv.view || !rv.body) continue;
      const { a, b, k } = s;
      const root = rv.view.root, q = root.rotationQuaternion!;
      root.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      _qa.set(a.qx, a.qy, a.qz, a.qw); _qb.set(b.qx, b.qy, b.qz, b.qw);
      Quaternion.SlerpToRef(_qa, _qb, k, q);
      const speed = a.speed + (b.speed - a.speed) * k, steer = a.steer + (b.steer - a.steer) * k;
      const axles = (TUNING[rv.kind] ?? TUNING.sedan).axles, wheels = rv.view.wheels;
      for (let i = 0; i < wheels.length; i++) {
        const w = wheels[i], ax = axles[w.axle];
        rv.spin[i] -= (speed * dt) / (ax?.radius ?? 0.35);
        w.steer.rotation.y = ax?.steer ? steer : 0;
        w.spin.rotation.z = rv.spin[i];
      }
      rv.view.setLamps(night, false);
      _pos.x = root.position.x; _pos.y = root.position.y; _pos.z = root.position.z;
      _rot.x = q.x; _rot.y = q.y; _rot.z = q.z; _rot.w = q.w;
      if (rv.fresh) { rv.body.setTranslation(_pos, true); rv.body.setRotation(_rot, true); rv.fresh = false; }
      rv.body.setNextKinematicTranslation(_pos);
      rv.body.setNextKinematicRotation(_rot);
    }

    for (const [, rp] of this.players) {
      const s = rp.buf.sample(t);
      if (!s) continue;
      const { a, b, k } = s;
      const vid = b.vehicleId ?? a.vehicleId;
      if (vid) {
        const rv = this.vehicles.get(vid);
        if (rv?.view) {
          if (!rp.avatar) rp.avatar = new Avatar(this.kits, this.renderer.scene, rp.look ?? rp.color);
          if (rp.seatedIn !== vid) { rp.avatar.sitIn(rv.view.root, TUNING[rv.kind]?.seat ?? { x: 0, y: 0.4, z: -0.4 }); rp.seatedIn = vid; }
          rp.avatar.animate(dt, 0, true);
          this.placeTag(rp, rv.view.root.position, 2.4);
        } else {
          if (rp.avatar) { rp.avatar.dispose(); rp.avatar = null; rp.seatedIn = null; }
          this.placeTag(rp, null, 0);
        }
        continue;
      }
      _p.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      const d2 = (_p.x - focus.x) ** 2 + (_p.z - focus.z) ** 2;
      if (rp.npc && !rp.avatar && d2 > W_SPAWN * W_SPAWN) continue;
      if (rp.npc && rp.avatar && d2 > W_DESPAWN * W_DESPAWN) { rp.avatar.dispose(); rp.avatar = null; continue; }
      if (!rp.avatar) rp.avatar = new Avatar(this.kits, this.renderer.scene, rp.look ?? rp.color);
      if (rp.seatedIn !== null || rp.avatar.root.parent !== rp.entity) { rp.avatar.standIn(rp.entity, 0); rp.seatedIn = null; }
      rp.entity.position.copyFrom(_p);
      let dy = b.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      rp.entity.rotation.y = a.yaw + dy * k;
      rp.avatar.animate(dt, a.speed + (b.speed - a.speed) * k, false);
      this.placeTag(rp, _p, 2.05);
    }
  }

  private placeTag(rp: RemotePlayer, at: { x: number; y: number; z: number } | null, lift: number) {
    if (rp.npc) return;
    const cam = this.renderer.camera.position;
    const visible = at && (at.x - cam.x) ** 2 + (at.z - cam.z) ** 2 < TAG_RANGE * TAG_RANGE;
    const screen = visible ? this.renderer.toScreen(_s.set(at.x, at.y + lift, at.z), _s) : null;
    if (!screen) { if (rp.tag) rp.tag.style.display = 'none'; return; }
    if (!rp.tag) {
      rp.tag = document.createElement('div');
      rp.tag.className = 'tag';
      const dot = document.createElement('i'); dot.style.background = rp.color;
      rp.tag.append(dot, document.createTextNode(rp.name));
      this.tags.appendChild(rp.tag);
    }
    rp.tag.style.display = '';
    rp.tag.style.transform = `translate(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px) translate(-50%, -100%)`;
  }
}
