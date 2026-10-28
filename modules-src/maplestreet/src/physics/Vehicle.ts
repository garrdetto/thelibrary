/**
 * Raycast-vehicle controller on Rapier's DynamicRayCastVehicleController:
 * per-wheel spring/damper suspension, engine force with speed falloff,
 * speed-sensitive steering, brake/handbrake, aero drag, trailer coupling via
 * a spherical (ball) joint, and interpolated wheel visuals.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import type { VehicleSnap } from '../../shared/Protocol';
import { MASK, Physics } from './Physics';
import { buildWheel, makeLights, makePaint, PRESETS, VehicleLights, VehiclePreset } from './VehiclePresets';

export interface DriveInput { throttle: number; steer: number; brake: number; handbrake: boolean }

interface WheelVis { steer: THREE.Group; spin: THREE.Group; axle: number }

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Vehicle {
  readonly preset: VehiclePreset;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly ctrl: RAPIER.DynamicRayCastVehicleController;
  readonly root = new THREE.Group();
  readonly lights: VehicleLights;
  private wheels: WheelVis[] = [];
  private headlamp: THREE.SpotLight | null = null;
  private steerAngle = 0;
  input: DriveInput = { throttle: 0, steer: 0, brake: 0, handbrake: false };
  trailer: Vehicle | null = null;
  towedBy: Vehicle | null = null;
  private joint: RAPIER.ImpulseJoint | null = null;
  private unsubscribe: () => void = () => {};
  disposed = false;

  constructor(private physics: Physics, kind: VehiclePreset['kind'], readonly id: string, pos: THREE.Vector3, yaw: number, scene: THREE.Scene, color?: number) {
    const R = physics.R, P = (this.preset = PRESETS[kind]);
    const c = P.chassis;
    _q.setFromAxisAngle(_v.set(0, 1, 0), yaw);

    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y + c.hy + P.suspension.rest + 0.3, pos.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setLinearDamping(0.05).setAngularDamping(0.6)
        .setCanSleep(false),
    );
    // Explicit mass properties: low COM + box inertia = planted handling.
    const sx = c.hx * 2, sy = c.hy * 2, sz = c.hz * 2, m = P.mass;
    this.collider = physics.world.createCollider(
      R.ColliderDesc.cuboid(c.hx, c.hy, c.hz)
        .setMassProperties(m, { x: 0, y: P.comY, z: 0 }, { x: (m / 12) * (sy * sy + sz * sz), y: (m / 12) * (sx * sx + sz * sz), z: (m / 12) * (sx * sx + sy * sy) }, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.4)
        .setCollisionGroups(MASK.vehicle),
      this.body,
    );

    this.ctrl = physics.world.createVehicleController(this.body);
    // Rapier defaults: up = Y (index 1), forward = X (index 0) — matches our models.
    P.axles.forEach((a, ai) => {
      for (const side of [1, -1]) {
        const idx = this.wheels.length;
        this.ctrl.addWheel({ x: a.x, y: P.wheelY, z: a.halfTrack * side }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: -1 }, P.suspension.rest, a.radius);
        this.ctrl.setWheelSuspensionStiffness(idx, P.suspension.stiffness);
        this.ctrl.setWheelSuspensionCompression(idx, P.suspension.compression);
        this.ctrl.setWheelSuspensionRelaxation(idx, P.suspension.relaxation);
        this.ctrl.setWheelMaxSuspensionTravel(idx, P.suspension.travel);
        this.ctrl.setWheelMaxSuspensionForce(idx, P.mass * 9.81 * 3);
        this.ctrl.setWheelFrictionSlip(idx, P.frictionSlip);
        this.ctrl.setWheelSideFrictionStiffness(idx, P.sideStiffness);

        const steer = new THREE.Group(), spin = buildWheel(a.radius, a.width);
        steer.add(spin);
        steer.position.set(a.x, P.wheelY - P.suspension.rest, a.halfTrack * side);
        this.root.add(steer);
        this.wheels.push({ steer, spin, axle: ai });
      }
    });

    this.lights = makeLights();
    const body = P.build(makePaint(color ?? P.paint), this.lights);
    this.root.add(body);
    this.root.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(this.root);
    physics.track(this.body, this.root);
    this.unsubscribe = physics.onPreStep(dt => this.preStep(dt));
  }

  get kind() { return this.preset.kind; }
  get speed() { return this.ctrl.currentVehicleSpeed(); }

  /**
   * Mount the single shared headlight cone on this vehicle (or detach it).
   * The light always exists in the scene, so changing cars never changes the
   * light count — which would force every shader to recompile.
   */
  setHeadlamp(light: THREE.SpotLight | null) {
    if (light && this.preset.engineForce > 0) {
      light.position.set(this.preset.chassis.hx, 0.4, 0);
      light.target.position.set(this.preset.chassis.hx + 10, -1.5, 0);
      this.root.add(light, light.target);
      this.headlamp = light;
    } else if (this.headlamp) {
      this.headlamp.intensity = 0;
      this.headlamp = null;
    }
  }

  private preStep(dt: number) {
    const P = this.preset;
    const speed = this.speed;
    const inp = this.towedBy ? { throttle: 0, steer: 0, brake: this.towedBy.input.brake, handbrake: false } : this.input;

    // Speed-sensitive steering with rate limiting (no instant wheel snaps).
    const limit = P.maxSteer / (1 + Math.abs(speed) * 0.045);
    const target = inp.steer * limit;
    const rate = 2.4 * dt;
    this.steerAngle += THREE.MathUtils.clamp(target - this.steerAngle, -rate, rate);

    // Throttle: forward, brake-to-stop, then reverse at 45% force.
    let engine = 0, brake = inp.brake * P.brake;
    if (inp.throttle > 0) {
      if (speed < -0.6) brake = Math.max(brake, P.brake * inp.throttle);
      else engine = P.engineForce * inp.throttle * Math.sqrt(Math.max(0, 1 - speed / P.topSpeed));
    } else if (inp.throttle < 0) {
      if (speed > 0.6) brake = Math.max(brake, P.brake * -inp.throttle);
      else engine = P.engineForce * inp.throttle * 0.45 * Math.max(0, 1 + speed / (P.topSpeed * 0.3));
    } else if (P.engineForce > 0) {
      brake = Math.max(brake, P.brake * 0.04);       // engine braking / rolling resistance
    }

    let i = 0;
    for (const a of P.axles) {
      for (let s = 0; s < 2; s++, i++) {
        this.ctrl.setWheelSteering(i, a.steer ? this.steerAngle : 0);
        this.ctrl.setWheelEngineForce(i, a.drive ? engine : 0);
        const hb = inp.handbrake && !a.steer ? P.brake * 1.5 : 0;
        this.ctrl.setWheelBrake(i, Math.max(brake, hb));
      }
    }

    // Quadratic aero drag: F = -c * |v| * v, applied as an impulse over dt.
    const lv = this.body.linvel();
    const vmag = Math.hypot(lv.x, lv.z);
    if (vmag > 1) {
      const k = 0.0009 * P.mass * vmag * dt;
      this.body.applyImpulse({ x: -lv.x * k, y: 0, z: -lv.z * k }, true);
    }

    this.ctrl.updateVehicle(dt, undefined, MASK.wheelRay);
  }

  /** Per render frame: wheels follow suspension, steering and spin; lamps follow night. */
  updateVisuals(night: number, braking: boolean) {
    const P = this.preset;
    this.wheels.forEach((w, i) => {
      const len = this.ctrl.wheelSuspensionLength(i) ?? P.suspension.rest;
      w.steer.position.y = P.wheelY - len;
      w.steer.rotation.y = this.ctrl.wheelSteering(i) ?? 0;
      w.spin.rotation.z = -(this.ctrl.wheelRotation(i) ?? 0);
    });
    this.lights.head.emissiveIntensity = night > 0.3 ? 3 : 0;
    this.lights.tail.emissiveIntensity = braking ? 4 : night > 0.3 ? 1.2 : 0.15;
    if (this.headlamp) this.headlamp.intensity = night > 0.3 ? 60 : 0;
  }

  forward(out = new THREE.Vector3()) { return out.set(1, 0, 0).applyQuaternion(this.root.quaternion); }

  /** World position of a chassis-local point, from the live physics pose. */
  localToWorld(x: number, y: number, z: number, out = new THREE.Vector3()) {
    const t = this.body.translation(), r = this.body.rotation();
    return out.set(x, y, z).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(_v.set(t.x, t.y, t.z));
  }

  /** Flip back onto the wheels (R key). */
  reset() {
    const t = this.body.translation();
    const yaw = Math.atan2(-this.forward().z, this.forward().x);
    _q.setFromAxisAngle(_v.set(0, 1, 0), yaw);
    this.body.setTranslation({ x: t.x, y: t.y + 1.2, z: t.z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.physics.snapTracked(this.body);
  }

  // ------------------------------------------------------------ trailer

  canHitch(tr: Vehicle) {
    if (!this.preset.hitch || !tr.preset.tongue || this.trailer || tr.towedBy) return false;
    const a = this.localToWorld(this.preset.hitch.x, this.preset.hitch.y, 0);
    const b = tr.localToWorld(tr.preset.tongue.x, tr.preset.tongue.y, 0);
    return a.distanceTo(b) < 3.5;
  }

  /** Snap the trailer into line behind the hitch, then join with a ball joint. */
  hitch(tr: Vehicle) {
    const R = this.physics.R, h = this.preset.hitch!, tg = tr.preset.tongue!;
    const r = this.body.rotation();
    const rot = _q.set(r.x, r.y, r.z, r.w).clone();
    const ball = this.localToWorld(h.x, h.y, 0);
    const offset = new THREE.Vector3(tg.x, tg.y, 0).applyQuaternion(rot);
    const p = ball.sub(offset);
    tr.body.setTranslation({ x: p.x, y: p.y + 0.05, z: p.z }, true);
    tr.body.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true);
    tr.body.setLinvel(this.body.linvel(), true);
    tr.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.physics.snapTracked(tr.body);

    const data = R.JointData.spherical({ x: h.x, y: h.y, z: 0 }, { x: tg.x, y: tg.y, z: 0 });
    this.joint = this.physics.world.createImpulseJoint(data, this.body, tr.body, true);
    (this.joint as unknown as { setContactsEnabled?: (b: boolean) => void }).setContactsEnabled?.(false);
    this.trailer = tr; tr.towedBy = this;
  }

  unhitch() {
    if (!this.joint || !this.trailer) return;
    this.physics.world.removeImpulseJoint(this.joint, true);
    this.trailer.towedBy = null;
    this.trailer = null; this.joint = null;
  }

  snapshot(owner: string): VehicleSnap {
    const t = this.body.translation(), r = this.body.rotation();
    return {
      id: this.id, owner, kind: this.preset.kind,
      x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w,
      steer: this.steerAngle, speed: this.speed, hitchedTo: this.towedBy?.id ?? null,
    };
  }

  dispose(scene: THREE.Scene) {
    this.unhitch();
    this.towedBy?.unhitch();
    this.setHeadlamp(null);
    this.physics.untrack(this.body);
    this.physics.world.removeVehicleController(this.ctrl);
    this.physics.world.removeRigidBody(this.body);
    this.unsubscribe();
    scene.remove(this.root);
    this.disposed = true;
  }
}
