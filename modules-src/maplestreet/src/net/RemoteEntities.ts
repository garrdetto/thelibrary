/**
 * Other players and their vehicles, rendered ~120 ms in the past and
 * interpolated between authority snapshots (classic entity interpolation —
 * smooth at 15 Hz updates regardless of jitter). Remote vehicles also get a
 * kinematic collider so your truck physically bumps into your neighbor's.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import type { PlayerSnap, VehicleSnap } from '../../shared/Protocol';
import { noNormalsMRT } from '../core/Engine';
import { mergeStatic } from '../core/Merge';
import { Avatar } from '../physics/Character';
import { lookKey } from '../../shared/Wardrobe';
import { MASK, Physics } from '../physics/Physics';
import { wheelFor, makeLights, paintFor, PRESETS, VehicleLights } from '../physics/VehiclePresets';
import { carStyleKey } from '../../shared/Cars';
import { applyDents } from '../physics/Dents';

const INTERP_DELAY_MS = 120;

class SnapBuffer<T extends { x: number; y: number; z: number }> {
  private buf: { t: number; s: T }[] = [];
  push(t: number, s: T) {
    if (this.buf.length && t <= this.buf[this.buf.length - 1].t) return;
    this.buf.push({ t, s });
    if (this.buf.length > 30) this.buf.shift();
  }
  /** Returns [a, b, alpha] bracketing render time t. */
  sample(t: number): [T, T, number] | null {
    const b = this.buf;
    if (!b.length) return null;
    if (t <= b[0].t) return [b[0].s, b[0].s, 0];
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= t) {
        const span = b[i].t - b[i - 1].t || 1;
        return [b[i - 1].s, b[i].s, Math.min(1, (t - b[i - 1].t) / span)];
      }
    }
    const last = b[b.length - 1].s;
    return [last, last, 0];
  }
  get latest() { return this.buf[this.buf.length - 1]?.s ?? null; }
}

const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

interface RemotePlayer { avatar: Avatar; label: THREE.Sprite; buf: SnapBuffer<PlayerSnap>; seen: number; seatedIn: RemoteVehicle | null; lookKey: string }
interface RemoteVehicle { kind: VehicleSnap['kind']; root: THREE.Group; shell: THREE.Group; styleKey: string; wheels: { g: THREE.Group; steer: boolean; spin: number }[]; lights: VehicleLights; body: RAPIER.RigidBody; buf: SnapBuffer<VehicleSnap>; seen: number }

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
  private clockOffset: number | null = null;
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();

  constructor(private scene: THREE.Scene, private physics: Physics, private selfId: () => string | null) {}

  ingest(time: number, players: PlayerSnap[], vehicles: VehicleSnap[]) {
    const offset = time - Date.now();
    this.clockOffset = this.clockOffset === null ? offset : this.clockOffset * 0.95 + offset * 0.05;
    const me = this.selfId(), now = performance.now();

    for (const p of players) {
      if (p.id === me) continue;
      let rp = this.players.get(p.id);
      if (!rp) {
        rp = { avatar: new Avatar(p.look ?? p.color), label: nameSprite(p.name, p.color), buf: new SnapBuffer(), seen: now, seatedIn: null, lookKey: lookKey(p.look) };
        rp.label.position.y = 2.15;
        rp.avatar.root.add(rp.label);
        rp.avatar.standIn(this.scene, 0);
        this.players.set(p.id, rp);
      }
      const key = lookKey(p.look);
      if (p.look && key !== rp.lookKey) { rp.lookKey = key; rp.avatar.setLook(p.look); }
      rp.buf.push(time, p); rp.seen = now;
    }
    for (const v of vehicles) {
      if (v.owner === me) continue;
      let rv = this.vehicles.get(v.id);
      if (!rv) { rv = this.spawnVehicle(v); this.vehicles.set(v.id, rv); }
      else if (carStyleKey(v.style) !== rv.styleKey) this.restyleVehicle(rv, v);
      rv.buf.push(time, v); rv.seen = now;
    }
    // Despawn anything not seen for 3 s.
    for (const [id, rp] of this.players) if (now - rp.seen > 3000) this.removePlayer(id);
    for (const [id, rv] of this.vehicles) if (now - rv.seen > 3000) this.removeVehicle(id);
  }

  private spawnVehicle(v: VehicleSnap): RemoteVehicle {
    const P = PRESETS[v.kind] ?? PRESETS.sedan, R = this.physics.R;
    const root = new THREE.Group();
    const lights = makeLights();
    const shell = P.build(paintFor(P, v.style), lights);
    mergeStatic(shell);
    applyDents(shell, v.style?.dents);
    shell.userData.onFill = () => applyDents(shell, v.style?.dents);
    root.add(shell);
    const wheels: RemoteVehicle['wheels'] = [];
    for (const a of P.axles) for (const side of [1, -1]) {
      const g = new THREE.Group(); const spin = wheelFor(P, a.radius, a.width);
      g.add(spin); g.position.set(a.x, P.wheelY - P.suspension.rest * 0.8, a.halfTrack * side);
      root.add(g); wheels.push({ g, steer: a.steer, spin: 0 });
    }
    root.traverse(o => (o.castShadow = true));
    this.scene.add(root);
    const body = this.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(v.x, v.y, v.z));
    this.physics.world.createCollider(R.ColliderDesc.cuboid(P.chassis.hx, P.chassis.hy, P.chassis.hz).setCollisionGroups(MASK.remote), body);
    return { kind: v.kind, root, shell, styleKey: carStyleKey(v.style), wheels, lights, body, buf: new SnapBuffer(), seen: performance.now() };
  }

  private restyleVehicle(rv: RemoteVehicle, v: VehicleSnap) {
    const P = PRESETS[rv.kind] ?? PRESETS.sedan;
    rv.root.remove(rv.shell);
    const shell = rv.shell = P.build(paintFor(P, v.style), rv.lights);
    mergeStatic(shell);
    applyDents(shell, v.style?.dents);
    shell.userData.onFill = () => applyDents(shell, v.style?.dents);
    rv.shell.traverse(o => (o.castShadow = true));
    rv.root.add(rv.shell);
    rv.styleKey = carStyleKey(v.style);
  }

  removePlayer(id: string) {
    const rp = this.players.get(id); if (!rp) return;
    rp.avatar.dispose(); this.players.delete(id);
  }
  removeVehicle(id: string) {
    const rv = this.vehicles.get(id); if (!rv) return;
    for (const rp of this.players.values()) if (rp.seatedIn === rv) { rp.avatar.standIn(this.scene, 0); rp.seatedIn = null; }
    this.scene.remove(rv.root); this.physics.world.removeRigidBody(rv.body); this.vehicles.delete(id);
  }
  removeOwner(sessionId: string) {
    this.removePlayer(sessionId);
    for (const [id] of this.vehicles) if (id.startsWith(`${sessionId}:`)) this.removeVehicle(id);
  }

  update(dt: number, night: number) {
    if (this.clockOffset === null) return;
    const t = Date.now() + this.clockOffset - INTERP_DELAY_MS;

    for (const rp of this.players.values()) {
      const s = rp.buf.sample(t); if (!s) continue;
      const [a, b, k] = s;
      // Drivers sit in their seat, hands on the wheel, and ride along with the vehicle.
      const veh = b.vehicleId ? this.vehicles.get(b.vehicleId) ?? null : null;
      if (veh) {
        if (rp.seatedIn !== veh) { rp.avatar.sitIn(veh.root, (PRESETS[veh.kind] ?? PRESETS.sedan).seat); rp.seatedIn = veh; }
        rp.avatar.root.visible = true;
        rp.avatar.animate(dt, 0, true);
        continue;
      }
      if (rp.seatedIn) { rp.avatar.standIn(this.scene, 0); rp.seatedIn = null; }
      rp.avatar.root.visible = !b.vehicleId;
      rp.avatar.root.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      rp.avatar.root.rotation.y = lerpAngle(a.yaw, b.yaw, k);
      rp.avatar.animate(dt, a.speed + (b.speed - a.speed) * k, false);
    }
    for (const rv of this.vehicles.values()) {
      const s = rv.buf.sample(t); if (!s) continue;
      const [a, b, k] = s;
      rv.root.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      this.q.set(a.qx, a.qy, a.qz, a.qw); this.q2.set(b.qx, b.qy, b.qz, b.qw);
      rv.root.quaternion.slerpQuaternions(this.q, this.q2, k);
      const speed = a.speed + (b.speed - a.speed) * k, steer = a.steer + (b.steer - a.steer) * k;
      for (const w of rv.wheels) {
        w.g.rotation.y = w.steer ? steer : 0;
        w.spin -= (speed * dt) / 0.35;
        w.g.children[0].rotation.z = w.spin;
      }
      rv.lights.head.emissiveIntensity = night > 0.3 ? 3 : 0;
      rv.lights.tail.emissiveIntensity = night > 0.3 ? 1.2 : 0.15;
      const p = rv.root.position, q = rv.root.quaternion;
      rv.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      rv.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
  }

  clear() {
    for (const id of [...this.players.keys()]) this.removePlayer(id);
    for (const id of [...this.vehicles.keys()]) this.removeVehicle(id);
  }

  get count() { return this.players.size; }
}
