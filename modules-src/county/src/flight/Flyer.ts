/**
 * The flyable aircraft in the page: a Rapier body with the shared flight
 * model's forces and torques applied before every physics step, the flight
 * assist between the keys and the controls, and the model's moving parts.
 *
 * - Helicopter: a fuselage box and two capsule skids; skid contact and rotor
 *   strikes are checked with rays.
 * - Plane: fuselage and wing boxes on a Rapier vehicle controller for the
 *   tricycle gear (nose wheel steers with the rudder, brakes on the mains).
 *
 * Touchdowns are graded by sink rate (`shared/Landing.ts`); a crash stops the
 * engine until the aircraft is reset.
 */
import * as pc from 'playcanvas';
import type RAPIER from '@dimforge/rapier3d-compat';
import { MASK, type Physics } from '../../../foxplains2/src/physics/Physics';
import type { Kit } from '../style/Kit';
import type { AircraftSpec } from '../../shared/Aircraft';
import { attitude, rotate, yawQuat, type Quat, type V3 } from '../../shared/FlightMath';
import { heliForces, newRotor, type FlightEnv, type FlightState, type HeliInfo, type HeliRotor } from '../../shared/HeliFlight';
import { newParts, planeForces, type PlaneInfo, type PlaneParts } from '../../shared/PlaneFlight';
import { heliAssist, newHeliAssist, newPlaneAssist, planeAssist, type AssistMode, type HeliAssist, type PilotInput, type PlaneAssist } from '../../shared/FlightAssist';
import { landing, type Landing } from '../../shared/Landing';
import { buildHelicopter, type HelicopterModel } from '../models/Helicopter';
import { buildPlane, type PlaneModel } from '../models/Plane';

export interface FlightReadout {
  kind: 'heli' | 'plane'; airspeed: number; groundSpeed: number; altitude: number; height: number; climb: number; heading: number; pitch: number; bank: number;
  power: number; rpm: number; flaps: number; fuel: number; stall: number; warnings: string[]; grounded: boolean; mode: AssistMode; crashed: boolean;
}

const IDLE: PilotInput = { fwd: 0, roll: 0, yaw: 0, power: 0, brake: false };
const v3 = (v: { x: number; y: number; z: number }): V3 => [v.x, v.y, v.z];

export class Flyer {
  readonly body: RAPIER.RigidBody;
  readonly root: pc.Entity;
  input: PilotInput = { ...IDLE };
  mode: AssistMode = 'easy';
  crashed = false;
  grounded = true;
  occupied = false;
  onEvent: (kind: Landing, text: string) => void = () => {};
  private heli: { rotor: HeliRotor; assist: HeliAssist; info: HeliInfo | null; model: HelicopterModel } | null = null;
  private plane: { parts: PlaneParts; assist: PlaneAssist; info: PlaneInfo | null; model: PlaneModel; ctrl: RAPIER.DynamicRayCastVehicleController } | null = null;
  private unsubscribe: () => void;
  private lastVel: V3 = [0, 0, 0];
  private spin = 0;
  private t = 0;

  constructor(private physics: Physics, device: pc.GraphicsDevice, kit: Kit, readonly spec: AircraftSpec, readonly id: string, pos: { x: number; y: number; z: number }, yaw: number, parent: pc.Entity, private env: FlightEnv) {
    const R = physics.R, q = yawQuat(yaw);
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y + 0.05, pos.z).setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }).setCanSleep(false).setLinearDamping(0.02).setAngularDamping(0.05));
    const b = spec.body, I = spec.inertia;
    physics.world.createCollider(R.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.cx, b.cy, 0).setMassProperties(spec.mass, { x: spec.com[0] - b.cx, y: spec.com[1] - b.cy, z: spec.com[2] }, { x: I[0], y: I[1], z: I[2] }, { x: 0, y: 0, z: 0, w: 1 }).setFriction(0.5).setCollisionGroups(MASK.vehicle), this.body);
    if (spec.kind === 'heli') {
      const s = spec.skids, half = (s.x1 - s.x0) / 2;
      for (const side of [-1, 1]) physics.world.createCollider(R.ColliderDesc.capsule(half, s.r).setTranslation((s.x0 + s.x1) / 2, s.y, side * s.z).setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }).setDensity(0).setFriction(0.9).setCollisionGroups(MASK.vehicle), this.body);
      const model = buildHelicopter(device, kit);
      this.heli = { rotor: newRotor(spec), assist: newHeliAssist(), info: null, model };
      this.root = model.root;
    } else {
      const w = spec.wing;
      physics.world.createCollider(R.ColliderDesc.cuboid(w.hx, w.hy, w.hz).setTranslation(w.cx, w.cy, 0).setDensity(0).setFriction(0.5).setCollisionGroups(MASK.vehicle), this.body);
      const ctrl = physics.world.createVehicleController(this.body);
      spec.wheels.forEach((wh, i) => {
        ctrl.addWheel({ x: wh.x, y: wh.radius + spec.rest, z: wh.z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, spec.rest, wh.radius);
        ctrl.setWheelSuspensionStiffness(i, spec.stiffness);
        ctrl.setWheelSuspensionCompression(i, 3.2);
        ctrl.setWheelSuspensionRelaxation(i, 4.2);
        ctrl.setWheelMaxSuspensionTravel(i, 0.25);
        ctrl.setWheelMaxSuspensionForce(i, spec.mass * 9.81 * 4);
        ctrl.setWheelFrictionSlip(i, wh.brake ? 1.6 : 1.1);
        ctrl.setWheelSideFrictionStiffness(i, 0.9);
      });
      const model = buildPlane(device, kit);
      this.plane = { parts: newParts(spec), assist: newPlaneAssist(), info: null, model, ctrl };
      this.root = model.root;
    }
    parent.addChild(this.root);
    physics.track(this.body, this.root);
    this.unsubscribe = physics.onPreStep(dt => this.preStep(dt));
  }

  get position() { return this.body.translation(); }
  get rotation(): Quat { const r = this.body.rotation(); return [r.x, r.y, r.z, r.w]; }
  forward() { const f = rotate(this.rotation, [1, 0, 0]); return new pc.Vec3(f[0], f[1], f[2]); }
  get seat() { return { x: this.spec.seat[0], y: this.spec.seat[1], z: this.spec.seat[2] }; }

  /** World position of a point in the aircraft's frame. */
  localToWorld(x: number, y: number, z: number) {
    const p = this.position, o = rotate(this.rotation, [x, y, z]);
    return new pc.Vec3(p.x + o[0], p.y + o[1], p.z + o[2]);
  }

  private state(): FlightState {
    return { pos: v3(this.body.translation()), vel: v3(this.body.linvel()), rot: this.rotation, angVel: v3(this.body.angvel()), t: this.t };
  }

  private preStep(dt: number) {
    this.t += dt;
    const s = this.state(), P = this.physics;
    const input = this.occupied && !this.crashed ? this.input : IDLE;
    let force: V3, torque: V3;
    if (this.heli) {
      const h = this.heli, spec = this.spec as Extract<AircraftSpec, { kind: 'heli' }>;
      const skid = this.localToWorld(0, 0.35, 0);
      const down = rotate(s.rot, [0, -1, 0]);
      this.grounded = P.rayDistance({ x: skid.x, y: skid.y, z: skid.z }, { x: down[0], y: down[1], z: down[2] }, 0.55, MASK.wheelRay) < 0.5;
      const c = heliAssist(spec, s, h.info, h.rotor, input, h.assist, this.mode, this.grounded, dt);
      c.engine = c.engine && this.occupied && !this.crashed;
      const r = heliForces(spec, s, c, h.rotor, this.env, dt);
      h.info = r.info; force = r.force; torque = r.torque;
      if (h.rotor.rpm > 0.3 && !this.crashed) {
        const hub = this.localToWorld(spec.hub[0], spec.hub[1], spec.hub[2]);
        for (let k = 0; k < 8; k++) {
          const d = rotate(s.rot, [Math.cos((k / 8) * Math.PI * 2), 0, Math.sin((k / 8) * Math.PI * 2)]);
          if (P.rayDistance(hub, { x: d[0], y: d[1], z: d[2] }, spec.rotorRadius) < spec.rotorRadius * 0.95) { this.crash('The rotor hit something'); break; }
        }
      }
    } else {
      const p = this.plane!, spec = this.spec as Extract<AircraftSpec, { kind: 'plane' }>;
      const c = planeAssist(spec, s, p.info, input, p.assist, this.mode, this.grounded, dt);
      c.engine = this.occupied && !this.crashed;
      const r = planeForces(spec, s, c, p.parts, this.env, dt);
      p.info = r.info; force = r.force; torque = r.torque;
      const ground = Math.hypot(s.vel[0], s.vel[2]);
      spec.wheels.forEach((wh, i) => {
        if (wh.steer) p.ctrl.setWheelSteering(i, -c.rudder * 0.45 * (1 - Math.min(1, ground / 30) * 0.7));
        if (wh.brake) p.ctrl.setWheelBrake(i, (c.brake || (!this.occupied ? 1 : 0)) * 900);
        p.ctrl.setWheelEngineForce(i, 0);
      });
      p.ctrl.updateVehicle(dt, undefined, MASK.wheelRay);
      let contact = false;
      for (let i = 0; i < spec.wheels.length; i++) contact ||= p.ctrl.wheelIsInContact(i);
      this.grounded = contact;
    }
    this.body.resetForces(false);
    this.body.resetTorques(false);
    this.body.addForce({ x: force[0], y: force[1], z: force[2] }, true);
    this.body.addTorque({ x: torque[0], y: torque[1], z: torque[2] }, true);
    this.checkImpact(s, dt);
  }

  private wasGrounded = true;
  private checkImpact(s: FlightState, dt: number) {
    const dv = Math.hypot(s.vel[0] - this.lastVel[0], s.vel[1] - this.lastVel[1], s.vel[2] - this.lastVel[2]);
    if (this.grounded && !this.wasGrounded && !this.crashed && this.occupied && this.t > 2) {
      const sink = -this.lastVel[1], grade = landing(this.spec, sink);
      if (grade === 'crash') this.crash(`Crashed at ${Math.round(sink * 196.85)} ft/min`);
      else if (sink > 0.5) this.onEvent(grade, grade === 'hard' ? `Hard landing: ${Math.round(sink * 196.85)} ft/min` : `Smooth landing: ${Math.round(sink * 196.85)} ft/min`);
    }
    if (dv > 9 && dt > 0 && !this.crashed && this.t > 1) this.crash('Crashed');
    this.wasGrounded = this.grounded;
    this.lastVel = s.vel;
  }

  private crash(text: string) {
    this.crashed = true;
    this.onEvent('crash', `${text}: press R to reset`);
  }

  /** Back upright on the ground at (x, z), engine idle, ready to fly. */
  reset(x: number, y: number, z: number, yaw: number) {
    const q = yawQuat(yaw);
    this.body.setTranslation({ x, y: y + 0.1, z }, true);
    this.body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.physics.snapTracked(this.body);
    this.crashed = false;
    this.lastVel = [0, 0, 0];
    if (this.heli) { this.heli.assist = newHeliAssist(); this.heli.rotor.tilt = [0, 0]; }
    if (this.plane) { this.plane.assist = newPlaneAssist(); }
  }

  toggleFlaps() { if (this.plane) this.plane.assist.flaps = (this.plane.assist.flaps + 1) % 3; }

  readout(groundAt: (x: number, z: number) => number): FlightReadout {
    const s = this.state(), a = attitude(s.rot), wind = this.env.wind(s.t);
    const air = Math.hypot(s.vel[0] - wind[0], s.vel[1] - wind[1], s.vel[2] - wind[2]);
    const warnings: string[] = [];
    if (this.crashed) warnings.push('CRASHED');
    const base = { airspeed: air, groundSpeed: Math.hypot(s.vel[0], s.vel[2]), altitude: s.pos[1], height: s.pos[1] - groundAt(s.pos[0], s.pos[2]), climb: s.vel[1], heading: a.heading, pitch: a.pitch, bank: a.bank, grounded: this.grounded, mode: this.mode, crashed: this.crashed };
    if (this.heli) {
      const h = this.heli;
      if (h.rotor.rpm < 0.9 && this.occupied) warnings.push(h.rotor.rpm < 0.3 ? 'ROTOR STARTING' : 'LOW ROTOR RPM');
      if ((h.info?.ringState ?? 0) > 0.05) warnings.push('SETTLING WITH POWER');
      if (h.rotor.fuel < 20) warnings.push('LOW FUEL');
      return { ...base, kind: 'heli', power: h.assist.collective, rpm: h.rotor.rpm, flaps: 0, fuel: h.rotor.fuel, stall: 0, warnings };
    }
    const p = this.plane!;
    if ((p.info?.stall ?? 0) > 0.05 || ((p.info?.alpha ?? 0) > 0.2 && !this.grounded)) warnings.push('STALL');
    if (p.parts.fuel < 10) warnings.push('LOW FUEL');
    return { ...base, kind: 'plane', power: p.assist.throttle, rpm: p.parts.power, flaps: p.assist.flaps, fuel: p.parts.fuel, stall: p.info?.stall ?? 0, warnings };
  }

  updateVisuals(dt: number) {
    if (this.heli) {
      const m = this.heli.model, rpm = this.heli.rotor.rpm;
      m.rotor.rotateLocal(0, -rpm * 6.6 * 360 * dt, 0);
      m.tailRotor.rotateLocal(0, 0, rpm * 6.6 * 5.6 * 360 * dt);
    } else {
      const p = this.plane!, m = p.model;
      this.spin = (this.spin + (this.occupied && !this.crashed ? 0.25 + p.parts.power * 0.75 : 0) * 38 * 360 * dt) % 360;
      m.prop.setLocalEulerAngles(this.spin, 0, 0);
      m.elevator.setLocalEulerAngles(0, 0, -p.parts.elevator * 22);
      m.rudder.setLocalEulerAngles(0, -p.parts.rudder * 20, 0);
    }
  }

  dispose() {
    this.unsubscribe();
    this.physics.untrack(this.body);
    this.physics.world.removeRigidBody(this.body);
    this.root.destroy();
  }
}
