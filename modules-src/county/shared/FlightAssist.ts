/**
 * Flight assist: turns what the pilot asks for into the raw controls of the
 * flight models, so every mode flies the same physics.
 *
 * Easy (default):
 * - Helicopter: W/S set a forward speed (released near zero it hovers in
 *   place), Q/E slide sideways, A/D turn with a coordinated bank, Space/Shift
 *   climb and descend (released, it holds the height). Torque is cancelled.
 * - Plane: W/S move the nose down and up and it holds the attitude you leave,
 *   A/D bank and level the wings when released, the rudder is coordinated,
 *   trim is automatic and the nose is kept below the stall.
 * Pro: the keys move the cyclic, pedals and elevator, ailerons and rudder
 * directly; collective and throttle change at a steady rate.
 */
import type { HeliSpec, PlaneSpec } from './Aircraft';
import { attitude, clamp, dot, G, unrotate, type V3 } from './FlightMath';
import { pedalTrim, type FlightState, type HeliControls, type HeliInfo, type HeliRotor } from './HeliFlight';
import type { PlaneControls, PlaneInfo } from './PlaneFlight';

export type AssistMode = 'easy' | 'pro';

/** Pilot keys, each −1–1: `fwd` (W +, S −), `roll` (D +, A −), `yaw` (E +, Q −), `power` (Space +, Shift −). */
export interface PilotInput { fwd: number; roll: number; yaw: number; power: number; brake: boolean }

export interface HeliAssist { speed: number; vsI: number; vfI: number; hold: number | null; collective: number }
export const newHeliAssist = (): HeliAssist => ({ speed: 0, vsI: 0, vfI: 0, hold: null, collective: 0 });

/** Horizontal velocity along the nose's heading and to its right. */
function headingVelocity(s: FlightState) {
  const h = attitude(s.rot).heading, f: V3 = [Math.sin(h), 0, -Math.cos(h)], r: V3 = [Math.cos(h), 0, Math.sin(h)];
  return { fwd: dot(s.vel, f), right: dot(s.vel, r) };
}

export function heliAssist(spec: HeliSpec, s: FlightState, info: HeliInfo | null, rotor: HeliRotor, input: PilotInput, st: HeliAssist, mode: AssistMode, grounded: boolean, dt: number): HeliControls {
  const att = attitude(s.rot), wb = unrotate(s.rot, s.angVel), engine = rotor.fuel > 0;
  const trim = pedalTrim(spec, info?.thrust ?? 0, rotor.rpm, engine);
  if (mode === 'pro') {
    st.collective = clamp(st.collective + input.power * 0.45 * dt, 0, 1);
    return { collective: st.collective, pitch: input.fwd, roll: input.roll, pedal: clamp(trim + input.yaw * 0.8, -1, 1), engine };
  }
  const v = headingVelocity(s);
  if (input.fwd) st.speed = clamp(st.speed + input.fwd * (input.fwd > 0 ? 6 : 8) * dt, -8, 50);
  else if (Math.abs(st.speed) < 4) st.speed = 0;
  const wantRight = input.yaw * 8;
  const turn = input.roll;
  st.vfI = clamp(st.vfI + 0.012 * (st.speed - v.fwd) * dt, -0.3, 0.3);
  const wantPitch = clamp(-0.06 * (st.speed - v.fwd) - st.vfI, -0.38, 0.3);
  const coordinated = turn * 0.5 * clamp((v.fwd - 8) / 17, 0, 1);
  const wantBank = clamp(0.06 * (wantRight - v.right) + coordinated, -0.45, 0.45);
  let pitch = clamp(2.4 * (att.pitch - wantPitch) + 0.7 * wb[2], -1, 1);
  let roll = clamp(2.4 * (wantBank - att.bank) - 0.7 * wb[0], -1, 1);
  const pedal = clamp(trim + 1.6 * (turn * 0.8 - -wb[1]), -1, 1);

  let wantClimb = input.power * 6;
  if (input.power) st.hold = null;
  else if (st.hold === null) st.hold = s.pos[1];
  if (!input.power && st.hold !== null) wantClimb = clamp(0.5 * (st.hold - s.pos[1]), -3, 3);
  if (info) wantClimb = Math.max(wantClimb, -Math.max(0.6, (info.rotorHeight - spec.hub[1]) * 0.45));
  if (grounded && input.power <= 0 && Math.abs(s.vel[1]) < 1.5) {
    st.vsI = 0; st.hold = null; st.speed = 0;
    return { collective: 0, pitch: 0, roll: 0, pedal: trim, engine };
  }
  if (rotor.rpm < 0.92) return { collective: 0, pitch: grounded ? 0 : pitch, roll: grounded ? 0 : roll, pedal: trim, engine };
  if (grounded) { pitch *= 0.3; roll *= 0.3; }
  const lift = (info ? info.groundEffect * info.translational * (1 - info.ringState) : 1) * Math.max(0.3, Math.cos(att.pitch) * Math.cos(att.bank));
  const need = spec.mass * G / (lift * Math.max(rotor.rpm * rotor.rpm, 0.3));
  const hover = (need / (spec.mass * G) - spec.thrust[0]) / (spec.thrust[1] - spec.thrust[0]);
  st.vsI = clamp(st.vsI + 0.03 * (wantClimb - s.vel[1]) * dt, -0.3, 0.3);
  const collective = clamp(hover + 0.09 * (wantClimb - s.vel[1]) + st.vsI, 0, 1);
  st.collective = collective;
  return { collective, pitch, roll, pedal, engine };
}

export interface PlaneAssist { throttle: number; flaps: number; pitch: number | null; trimI: number; trim: number }
export const newPlaneAssist = (): PlaneAssist => ({ throttle: 0, flaps: 0, pitch: null, trimI: 0, trim: 0 });

export function planeAssist(spec: PlaneSpec, s: FlightState, info: PlaneInfo | null, input: PilotInput, st: PlaneAssist, mode: AssistMode, grounded: boolean, dt: number): PlaneControls {
  st.throttle = clamp(st.throttle + input.power * 0.5 * dt, 0, 1);
  const att = attitude(s.rot), wb = unrotate(s.rot, s.angVel);
  const base = { throttle: st.throttle, flaps: st.flaps, brake: input.brake ? 1 : 0, engine: true };
  if (mode === 'pro' || grounded) {
    st.pitch = null; st.trimI = 0;
    const steer = grounded ? clamp(input.yaw + input.roll * 0.7, -1, 1) : input.yaw;
    return { ...base, elevator: -input.fwd, aileron: input.roll, rudder: steer, trim: st.trim };
  }
  if (st.pitch === null) st.pitch = att.pitch;
  st.pitch = clamp(st.pitch - input.fwd * 0.22 * dt, -0.35, 0.35);
  const stallMargin = (info?.alpha ?? 0) + spec.incidence - (spec.clMax - spec.cl0) / spec.clAlpha + 0.05;
  if (stallMargin > 0) st.pitch = Math.min(st.pitch, att.pitch - stallMargin * 2);
  const wantBank = input.roll * 0.6;
  const err = st.pitch - att.pitch;
  st.trimI = clamp(st.trimI + 0.5 * err * dt, -0.6, 0.6);
  const turnComp = (1 / Math.max(0.5, Math.cos(att.bank)) - 1) * 0.6;
  const elevator = clamp(3 * err - 0.9 * wb[2] + st.trimI + turnComp, -1, 1);
  const aileron = clamp(2.2 * (wantBank - att.bank) - 0.5 * wb[0], -1, 1);
  const rudder = clamp(input.yaw + 2.5 * (info?.beta ?? 0) + 0.15 * aileron, -1, 1);
  return { ...base, elevator, aileron, rudder, trim: 0 };
}
