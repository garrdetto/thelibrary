/**
 * Your own vehicles: the Fox Plains raycast vehicle on Rapier's
 * DynamicRayCastVehicleController, line for line the same drive model
 * (steering rate and grip-limited lock, Ackermann, pedal ramps, torque curve,
 * engine braking, zero-turn yaw, roll damping, aero drag, crash detection,
 * trailer ball joint) so a car in Fox Plains 2 handles exactly like the same
 * car in Fox Plains. The view comes from VehicleModels.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MASK, type Physics } from './Physics';
import type { VehicleModels, VehicleView } from './VehicleModels';
import { TUNING, wheelbaseOf, type VehicleTuning } from '../../../maplestreet/shared/Vehicles';
import type { VehicleSnap } from '../../../maplestreet/shared/Protocol';
import { conditionEffects, CRASH_MIN_DV, tuneEffects, type CarStyle, type OwnedCar } from '../../../maplestreet/shared/Cars';

export interface DriveInput { throttle: number; steer: number; brake: number; handbrake: boolean }

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const _xyz = { x: 0, y: 0, z: 0 };
const xyz = (x: number, y: number, z: number) => { _xyz.x = x; _xyz.y = y; _xyz.z = z; return _xyz; };
const _towed: DriveInput = { throttle: 0, steer: 0, brake: 0, handbrake: false };
const _q = new Quaternion(), _v = new Vector3(), _w = new Vector3();
const _empty: DriveInput = { throttle: 0, steer: 0, brake: 0, handbrake: false };

/** Chassis point struck, from the local direction of the speed change (same as Fox Plains' Dents.impactPoint). */
function impactPoint(c: { hx: number; hy: number; hz: number }, lx: number, lz: number) {
  const l = Math.hypot(lx, lz) || 1, dx = -lx / l, dz = -lz / l;
  const k = Math.min(Math.abs(dx) > 1e-4 ? c.hx / Math.abs(dx) : Infinity, Math.abs(dz) > 1e-4 ? c.hz / Math.abs(dz) : Infinity);
  return { x: dx * k, y: c.hy * 0.4, z: dz * k };
}

export class Vehicle {
  readonly preset: VehicleTuning;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly ctrl: RAPIER.DynamicRayCastVehicleController;
  readonly view: VehicleView;
  private steerAngle = 0;
  private pedal = 0;
  private readonly wheelbase: number;
  input: DriveInput = { throttle: 0, steer: 0, brake: 0, handbrake: false };
  trailer: Vehicle | null = null;
  towedBy: Vehicle | null = null;
  private joint: RAPIER.ImpulseJoint | null = null;
  private unsubscribe: () => void;
  private cond = conditionEffects(0);
  private tune = tuneEffects(null);
  private readonly pullSide: number;
  onImpact: ((dv: number, at: { x: number; y: number; z: number }) => void) | null = null;
  private lastVel = { x: 0, z: 0 };
  private quietSteps = 2;
  private casterYaw = 0;
  fuel = Infinity;
  tank = Infinity;
  private mpm = 0;

  constructor(private physics: Physics, models: VehicleModels, kind: string, readonly id: string, pos: { x: number; y: number; z: number }, yaw: number, style?: CarStyle | null) {
    const P = TUNING[kind];
    if (!P) throw new Error(`Unknown vehicle ${kind}`);
    this.preset = P;
    const R = physics.R;
    this.wheelbase = wheelbaseOf(P) || 2.5;
    this.pullSide = [...id].reduce((h, c) => h + c.charCodeAt(0), 0) % 2 ? 1 : -1;
    const c = P.chassis;
    const s = Math.sin(yaw / 2), co = Math.cos(yaw / 2);
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y + c.hy + P.suspension.rest + 0.3, pos.z).setRotation({ x: 0, y: s, z: 0, w: co })
        .setLinearDamping(0.05).setAngularDamping(0.6).setCanSleep(false),
    );
    const sx = c.hx * 2, sy = c.hy * 2, sz = c.hz * 2, m = P.mass;
    this.collider = physics.world.createCollider(
      physics.vehicleShape(c.hx, c.hy, c.hz)
        .setMassProperties(m, { x: 0, y: P.comY, z: 0 }, { x: (m / 12) * (sy * sy + sz * sz), y: (m / 12) * (sx * sx + sz * sz), z: (m / 12) * (sx * sx + sy * sy) }, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.3)
        .setCollisionGroups(P.tongue ? MASK.trailer : MASK.vehicle),
      this.body,
    );
    this.ctrl = physics.world.createVehicleController(this.body);
    P.axles.forEach(a => {
      for (const side of [1, -1]) {
        const idx = this.ctrl.numWheels();
        this.ctrl.addWheel({ x: a.x, y: P.wheelY, z: a.halfTrack * side }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, P.suspension.rest, a.radius);
        this.ctrl.setWheelSuspensionStiffness(idx, P.suspension.stiffness);
        this.ctrl.setWheelSuspensionCompression(idx, P.suspension.compression);
        this.ctrl.setWheelSuspensionRelaxation(idx, P.suspension.relaxation);
        this.ctrl.setWheelMaxSuspensionTravel(idx, P.suspension.travel);
        this.ctrl.setWheelMaxSuspensionForce(idx, P.mass * 9.81 * 3);
        this.ctrl.setWheelFrictionSlip(idx, a.caster ? 0.15 : P.frictionSlip);
        this.ctrl.setWheelSideFrictionStiffness(idx, a.caster ? 0.02 : P.sideStiffness);
      }
    });
    this.view = models.build(kind, style ?? null);
    physics.track(this.body, this.view.root);
    this.unsubscribe = physics.onPreStep(dt => this.preStep(dt));
  }

  get kind() { return this.preset.kind; }
  get root(): TransformNode { return this.view.root; }
  get speed() { return this.ctrl.currentVehicleSpeed(); }
  get empty() { return this.fuel <= 0 && this.preset.engineForce > 0; }

  restyle(style: CarStyle | null) { this.view.setStyle(style); }

  setCar(car: OwnedCar | null) {
    const P = this.preset;
    this.cond = conditionEffects(car?.damage ?? 0);
    this.tune = tuneEffects(car);
    let i = 0;
    for (const a of P.axles) for (let s = 0; s < 2; s++, i++) {
      this.ctrl.setWheelFrictionSlip(i, (a.caster ? 0.15 : P.frictionSlip) * this.cond.grip * this.tune.grip);
      this.ctrl.setWheelRadius(i, a.radius * this.tune.tireScale);
      this.ctrl.setWheelSuspensionRestLength(i, Math.max(0.05, P.suspension.rest + this.tune.lift));
    }
    for (const w of this.view.wheels) w.spin.scaling.set(this.tune.tireScale, this.tune.tireScale, 1);
  }

  setFuel(level: number, tank: number, mpg: number, scale: number) {
    this.fuel = level; this.tank = tank;
    this.mpm = mpg > 0 ? scale / (mpg * 1609.34) : 0;
  }

  quiet(steps = 3) { this.quietSteps = Math.max(this.quietSteps, steps); }

  private local(x: number, y: number, z: number, inverse = false) {
    const r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    if (inverse) _q.conjugateInPlace();
    _v.set(x, y, z).rotateByQuaternionToRef(_q, _w);
    return _w;
  }

  private checkImpact() {
    const lv = this.body.linvel();
    const dx = lv.x - this.lastVel.x, dz = lv.z - this.lastVel.z;
    this.lastVel.x = lv.x; this.lastVel.z = lv.z;
    if (this.quietSteps > 0) { this.quietSteps--; return; }
    const dv = Math.hypot(dx, dz);
    if (dv <= CRASH_MIN_DV || !this.onImpact) return;
    const l = this.local(dx, 0, dz, true);
    this.quiet(20);
    this.onImpact(dv, impactPoint(this.preset.chassis, l.x, l.z));
  }

  private preStep(dt: number) {
    const P = this.preset;
    this.checkImpact();
    const speed = this.speed;
    const raw = this.towedBy ? (_towed.brake = this.towedBy.input.brake, _towed) : this.input;
    let inp = raw;
    if (this.empty) { _empty.steer = raw.steer; _empty.brake = raw.brake; _empty.handbrake = raw.handbrake; _empty.throttle = 0; inp = _empty; }
    if (this.mpm && Math.abs(inp.throttle) > 0.05) this.fuel = Math.max(0, this.fuel - Math.abs(speed) * dt * this.mpm * (0.6 + 0.4 * Math.abs(inp.throttle)) - dt * this.mpm * 2);

    const v = Math.abs(speed);
    const gripLock = Math.atan((this.wheelbase * 8.5) / Math.max(1, v * v));
    const limit = Math.min(P.maxSteer, Math.max(P.maxSteer * 0.12, gripLock));
    const target = (inp.steer + (v > 2 ? this.cond.pull * this.pullSide : 0)) * limit;
    const turnRate = P.maxSteer * (2.6 - Math.min(1.5, v * 0.06));
    const centerRate = P.maxSteer * (1.4 + Math.min(2.4, v * 0.18));
    const rate = (inp.steer === 0 || Math.sign(inp.steer) !== Math.sign(this.steerAngle) && this.steerAngle !== 0 ? Math.max(turnRate, centerRate) : turnRate) * dt;
    this.steerAngle += clamp(target - this.steerAngle, -rate, rate);

    const pedalRate = dt * 3.2;
    this.pedal += clamp(inp.throttle - this.pedal, -pedalRate * 1.6, pedalRate);
    const pedal = Math.abs(inp.throttle) < 0.01 && Math.abs(this.pedal) < 0.05 ? 0 : this.pedal;

    const brakeForce = P.brake * this.tune.brake, power = P.engineForce * this.cond.engine * this.tune.engine, top = P.topSpeed * this.tune.topSpeed;
    let engine = 0, brake = inp.brake * brakeForce;
    const torque = (u: number) => Math.max(0, 1 - u) ** 0.6 * (1 + 0.25 * Math.max(0, 1 - u * 3));
    if (pedal > 0) {
      if (speed < -0.6) brake = Math.max(brake, brakeForce * pedal);
      else engine = power * pedal * torque(speed / top);
    } else if (pedal < 0) {
      if (speed > 0.6) brake = Math.max(brake, brakeForce * -pedal * (0.55 + 0.45 * Math.min(1, -pedal * 1.4)));
      else engine = power * pedal * 0.4 * Math.max(0, 1 + speed / (top * 0.22));
    } else if (P.engineForce > 0) {
      brake = Math.max(brake, P.brake * (v > 2 ? 0.035 : 0.12));
    }

    if (P.zeroTurn) {
      const av = this.body.angvel();
      const wantYaw = inp.steer * (1.9 - Math.min(1, Math.abs(speed) / P.topSpeed) * 0.8);
      const yaw = av.y + clamp(wantYaw - av.y, -8 * dt, 8 * dt);
      this.body.setAngvel(xyz(av.x * 0.9, yaw, av.z * 0.9), true);
      if (inp.throttle === 0 && Math.abs(inp.steer) > 0) brake = Math.min(brake, P.brake * 0.02);
    }

    const r = this.body.rotation();
    const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
    if (upY > 0.3) {
      const av = this.body.angvel();
      const k = Math.min(1, 6 * dt);
      const fwd = this.local(1, 0, 0);
      const pitchRate = av.x * -fwd.z + av.z * fwd.x;
      const rollRate = av.x * fwd.x + av.z * fwd.z;
      this.body.setAngvel(xyz(av.x - (rollRate * fwd.x - pitchRate * fwd.z) * k * 0.35, av.y, av.z - (rollRate * fwd.z + pitchRate * fwd.x) * k * 0.35), true);
    }

    const tanD = Math.tan(this.steerAngle);
    let i = 0;
    for (const a of P.axles) {
      for (let s = 0; s < 2; s++, i++) {
        const side = s === 0 ? 1 : -1;
        const ack = Math.abs(tanD) < 1e-4 ? 0 : Math.atan(this.wheelbase / (this.wheelbase / tanD + side * a.halfTrack));
        this.ctrl.setWheelSteering(i, a.steer ? ack : 0);
        this.ctrl.setWheelEngineForce(i, a.drive ? engine : 0);
        const hb = inp.handbrake && !a.steer ? P.brake * 1.5 : 0;
        this.ctrl.setWheelBrake(i, Math.max(brake, hb));
        if (!a.steer && !a.caster && P.engineForce > 0) this.ctrl.setWheelSideFrictionStiffness(i, inp.handbrake && v > 3 ? P.sideStiffness * 0.45 : P.sideStiffness);
      }
    }

    const lv = this.body.linvel();
    const vmag = Math.hypot(lv.x, lv.z);
    if (vmag > 1) {
      const k = 0.0009 * P.mass * vmag * dt;
      this.body.applyImpulse(xyz(-lv.x * k, 0, -lv.z * k), true);
    }
    this.ctrl.updateVehicle(dt, undefined, MASK.wheelRay);
  }

  /** Per frame: wheels follow suspension, steering and spin; lamps follow night and the brake. */
  updateVisuals(night: number, braking: boolean) {
    const P = this.preset;
    const wheels = this.view.wheels;
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      const len = this.ctrl.wheelSuspensionLength(i) ?? P.suspension.rest;
      w.steer.position.y = P.wheelY - len + w.lift;
      w.steer.rotation.y = w.caster ? this.casterAngle() : this.ctrl.wheelSteering(i) ?? 0;
      w.spin.rotation.z = -(this.ctrl.wheelRotation(i) ?? 0);
    }
    this.view.setLamps(night, braking);
  }

  private casterAngle() {
    const v = this.body.linvel();
    const l = this.local(v.x, 0, v.z, true);
    if (l.x * l.x + l.z * l.z > 0.04) this.casterYaw = Math.atan2(-l.z, l.x);
    return this.casterYaw;
  }

  forward(out = new Vector3()) {
    const r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _v.set(1, 0, 0).rotateByQuaternionToRef(_q, out);
    return out;
  }

  /** World position of a chassis point, from the live physics pose. */
  localToWorld(x: number, y: number, z: number, out = new Vector3()) {
    const t = this.body.translation(), r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _v.set(x, y, z).rotateByQuaternionToRef(_q, out);
    return out.addInPlaceFromFloats(t.x, t.y, t.z);
  }

  get position() { const t = this.body.translation(); return { x: t.x, y: t.y, z: t.z }; }

  reset() {
    this.quiet();
    const t = this.body.translation(), f = this.forward();
    const yaw = Math.atan2(-f.z, f.x);
    this.body.setTranslation({ x: t.x, y: t.y + 1.2, z: t.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.physics.snapTracked(this.body);
  }

  place(x: number, z: number, yaw: number) {
    this.quiet();
    this.body.setTranslation({ x, y: this.preset.chassis.hy + this.preset.suspension.rest + 0.6, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.physics.snapTracked(this.body);
  }

  canHitch(tr: Vehicle) {
    if (!this.preset.hitch || !tr.preset.tongue || this.trailer || tr.towedBy) return false;
    const a = this.localToWorld(this.preset.hitch.x, this.preset.hitch.y, 0);
    const b = tr.localToWorld(tr.preset.tongue.x, tr.preset.tongue.y, 0);
    return Vector3.Distance(a, b) < 3.5;
  }

  hitch(tr: Vehicle) {
    this.quiet(); tr.quiet();
    const R = this.physics.R, h = this.preset.hitch!, tg = tr.preset.tongue!;
    const r = this.body.rotation();
    const rot = new Quaternion(r.x, r.y, r.z, r.w);
    const ball = this.localToWorld(h.x, h.y, 0);
    const offset = new Vector3(tg.x, tg.y, 0).rotateByQuaternionToRef(rot, new Vector3());
    const p = ball.subtract(offset);
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
    return { id: this.id, owner, kind: this.preset.kind, x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w, steer: this.steerAngle, speed: this.speed, hitchedTo: this.towedBy?.id ?? null };
  }

  dispose() {
    this.unhitch();
    this.towedBy?.unhitch();
    this.physics.untrack(this.body);
    this.physics.world.removeVehicleController(this.ctrl);
    this.physics.world.removeRigidBody(this.body);
    this.unsubscribe();
    this.view.destroy();
  }
}
