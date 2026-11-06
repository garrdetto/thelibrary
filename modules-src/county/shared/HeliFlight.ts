/**
 * Helicopter flight model: forces and torques from the state and the raw
 * controls, with no physics engine inside, so the page (on a Rapier body),
 * the server and the tests all fly the same machine. Gravity is left to the
 * caller.
 *
 * - Main rotor thrust along the disc, from collective and rotor speed², with
 *   less thrust when climbing fast (inflow), more in ground effect
 *   (Cheeseman–Bennett, capped), translational lift between 4 and 12 m/s,
 *   and a thrust loss with buffeting in the vortex ring state.
 * - Cyclic tilts the disc with a short flapping lag; airspeed blows it back.
 *   Tilt moves the thrust line (hub above the centre of mass) and the rotor
 *   head adds a hinge moment; the rotor damps pitch and roll.
 * - Main rotor torque yaws the body against the tail rotor (pedals); the fin
 *   weathervanes and the stabiliser damps pitch; drag on three areas.
 * - The engine spools the rotor up; with it off the rotor slows unless air
 *   rising through it on the way down keeps it turning (autorotation).
 */
import type { HeliSpec } from './Aircraft';
import { add, clamp, cross, dot, G, len, rotate, RHO, smooth, sub, unrotate, type Quat, type V3 } from './FlightMath';

export interface FlightState { pos: V3; vel: V3; rot: Quat; angVel: V3; t: number }
export interface FlightEnv { ground(x: number, z: number): number; wind(t: number): V3 }

/** Raw controls: collective 0–1; cyclic pitch (+ forward, nose down) and roll (+ right), −1–1; pedals (+ nose right), −1–1. */
export interface HeliControls { collective: number; pitch: number; roll: number; pedal: number; engine: boolean }

/** What the rotor carries between steps: rotor speed (1 = governed), disc tilt (forward, right) and fuel in litres. */
export interface HeliRotor { rpm: number; tilt: [number, number]; fuel: number }

export interface HeliInfo { thrust: number; groundEffect: number; translational: number; ringState: number; rotorHeight: number; airspeed: number; climb: number }

export const newRotor = (spec: HeliSpec, running = false): HeliRotor => ({ rpm: running ? 1 : 0, tilt: [0, 0], fuel: spec.fuel });

/** Thrust for a collective setting at a rotor speed, before inflow and ground effect. */
export const baseThrust = (spec: HeliSpec, collective: number, rpm: number) => spec.mass * G * (spec.thrust[0] + (spec.thrust[1] - spec.thrust[0]) * clamp(collective, 0, 1)) * rpm * rpm;

/** The pedal setting that cancels the main rotor's torque at this thrust (the tail rotor's job in a steady hover). */
export function pedalTrim(spec: HeliSpec, thrust: number, rpm: number, engine: boolean) {
  const r2 = Math.max(rpm * rpm, 0.05), hover = spec.torquePerThrust * spec.mass * G;
  return clamp((hover - (spec.torquePerThrust * thrust * (engine ? 1 : 0.15)) / r2) / spec.tailMax, -1, 1);
}

export function heliForces(spec: HeliSpec, s: FlightState, c: HeliControls, rotor: HeliRotor, env: FlightEnv, dt: number) {
  const q = s.rot, air = sub(s.vel, env.wind(s.t)), vb = unrotate(q, air), wb = unrotate(q, s.angVel);
  const running = c.engine && rotor.fuel > 0;
  const descent = -dot(vb, [0, 1, 0]);
  rotor.rpm = clamp(rotor.rpm + (running ? (1 - rotor.rpm) / spec.spool : -0.025 - 0.08 * c.collective * rotor.rpm + 0.012 * Math.max(0, descent)) * dt, 0, 1.08);
  rotor.fuel = Math.max(0, rotor.fuel - (running ? spec.burn[0] + spec.burn[1] * c.collective * rotor.rpm : 0) * dt);

  const lag = Math.min(1, dt / 0.12);
  const wantA = clamp(c.pitch, -1, 1) * spec.maxTilt[0] - 0.0035 * vb[0], wantB = clamp(c.roll, -1, 1) * spec.maxTilt[1] - 0.0035 * vb[2];
  rotor.tilt[0] += (wantA - rotor.tilt[0]) * lag;
  rotor.tilt[1] += (wantB - rotor.tilt[1]) * lag;
  const [a, b] = rotor.tilt;
  const nb: V3 = [Math.sin(a), Math.cos(a) * Math.cos(b), Math.sin(b)];

  const axial = dot(vb, nb), horiz = Math.hypot(vb[0], vb[2]), V = len(vb);
  const hub = add(s.pos, rotate(q, spec.hub));
  const rotorHeight = hub[1] - env.ground(hub[0], hub[2]), R = spec.rotorRadius;
  const z = Math.max(rotorHeight, 0.05);
  const groundEffect = z > R / 4 ? Math.min(1.25, 1 / (1 - (R / (4 * z)) ** 2)) : 1.25;
  const translational = 1 + 0.12 * smooth(4, 12, horiz);
  const inflow = clamp(1 - 0.04 * axial, 0.6, 1.25);
  const ringState = smooth(4, 7, -axial) * (1 - smooth(5, 9, horiz)) * 0.35;
  const thrust = baseThrust(spec, c.collective, rotor.rpm) * groundEffect * translational * inflow * (1 - ringState);

  const force: V3 = [nb[0] * thrust, nb[1] * thrust, nb[2] * thrust];
  for (let k = 0; k < 3; k++) force[k] -= 0.5 * RHO * spec.drag[k] * vb[k] * Math.abs(vb[k]);
  const r2 = rotor.rpm * rotor.rpm;
  const tail = r2 * (spec.torquePerThrust * spec.mass * G - spec.tailMax * clamp(c.pedal, -1, 1));
  force[2] += tail / spec.tailArm;

  const arm = sub(spec.hub, spec.com);
  const torque = cross(arm, [nb[0] * thrust, nb[1] * thrust, nb[2] * thrust]);
  torque[0] += spec.headStiffness * r2 * b - spec.rotorDamping * rotor.rpm * wb[0];
  torque[2] += -spec.headStiffness * r2 * a - spec.rotorDamping * rotor.rpm * wb[2];
  torque[1] += -spec.torquePerThrust * thrust * (running ? 1 : 0.15) + tail - spec.yawDamping * wb[1] - spec.fin * V * vb[2];
  torque[2] += spec.stab * V * (vb[1] - spec.tailArm * wb[2]);
  torque[0] += ringState * 1800 * Math.sin(s.t * 7.3);
  torque[2] += ringState * 1800 * Math.sin(s.t * 5.1);

  const info: HeliInfo = { thrust, groundEffect, translational, ringState, rotorHeight, airspeed: V, climb: s.vel[1] };
  return { force: rotate(q, force), torque: rotate(q, torque), info };
}
