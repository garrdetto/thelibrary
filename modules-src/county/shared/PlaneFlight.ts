/**
 * Small-plane flight model: forces and torques from the state and the raw
 * controls, renderer- and engine-free like the helicopter's. Gravity and the
 * wheels (a Rapier vehicle controller in the page, a simple contact in the
 * tests) are left to the caller.
 *
 * Classic coefficient build-up in stability terms: lift from angle of attack
 * that rounds off at the maximum and falls away past the stall (with a wing
 * drop), flaps that add lift and drag, parasite and induced drag (less of it
 * in ground effect), sideslip force, and roll, pitch and yaw moments from
 * sideslip, rates and the three control surfaces. The propeller's thrust
 * falls with airspeed; at low speed P-factor and torque pull the nose left.
 */
import type { PlaneSpec } from './Aircraft';
import { clamp, RHO, rotate, smooth, sub, unrotate, type V3 } from './FlightMath';
import type { FlightEnv, FlightState } from './HeliFlight';

/** Raw controls: throttle 0–1; elevator (+ nose up), aileron (+ roll right), rudder (+ nose right), −1–1; flap notch 0–2; trim −1–1; brakes 0–1. */
export interface PlaneControls { throttle: number; elevator: number; aileron: number; rudder: number; flaps: number; trim: number; brake: number; engine: boolean }

/** Surface positions (moved at a finite rate), engine power fraction and fuel. */
export interface PlaneParts { elevator: number; aileron: number; rudder: number; flaps: number; power: number; fuel: number }

export interface PlaneInfo { airspeed: number; alpha: number; beta: number; stall: number; lift: number; thrust: number; cl: number }

export const newParts = (spec: PlaneSpec): PlaneParts => ({ elevator: 0, aileron: 0, rudder: 0, flaps: 0, power: 0, fuel: spec.fuel });

/** Lift coefficient at wing angle of attack `aw` with `flapCl` extra, and how far past the stall it is (0–1). */
export function liftCoefficient(spec: PlaneSpec, aw: number, flapCl: number) {
  const lin = spec.cl0 + flapCl + spec.clAlpha * aw, top = spec.clMax + flapCl, bottom = -spec.clMax * 0.8;
  const x = lin / (lin >= 0 ? top : -bottom);
  const soft = Math.abs(x) < 0.85 ? x : Math.sign(x) * (0.85 + 0.15 * Math.tanh((Math.abs(x) - 0.85) / 0.15));
  const pre = soft * (lin >= 0 ? top : -bottom);
  const stallAt = (spec.clMax - spec.cl0) / spec.clAlpha;
  const stall = smooth(stallAt, stallAt + 0.07, Math.abs(aw));
  return { cl: pre + (1.05 * Math.sin(2 * aw) - pre) * stall, stall };
}

export function planeForces(spec: PlaneSpec, s: FlightState, c: PlaneControls, p: PlaneParts, env: FlightEnv, dt: number) {
  const q = s.rot, air = sub(s.vel, env.wind(s.t)), vb = unrotate(q, air), wb = unrotate(q, s.angVel);
  const step = spec.surfaces.rate * dt;
  const toward = (v: number, t: number) => v + clamp(t - v, -step, step);
  p.elevator = toward(p.elevator, clamp(c.elevator, -1, 1));
  p.aileron = toward(p.aileron, clamp(c.aileron, -1, 1));
  p.rudder = toward(p.rudder, clamp(c.rudder, -1, 1));
  p.flaps += clamp(clamp(Math.round(c.flaps), 0, 2) - p.flaps, -dt * 0.5, dt * 0.5);
  const running = c.engine && p.fuel > 0;
  p.power += ((running ? clamp(c.throttle, 0, 1) : 0) - p.power) * Math.min(1, dt / 0.8);
  p.fuel = Math.max(0, p.fuel - (running ? spec.burn[0] + spec.burn[1] * p.power : 0) * dt);

  const V = Math.hypot(vb[0], vb[1], vb[2]), Vs = Math.max(V, 5);
  const thrust = p.power * Math.min(spec.staticThrust, (spec.propEff * spec.power) / Math.max(V, 1));
  const force: V3 = [thrust, 0, 0], torque: V3 = [-0.06 * thrust, 0, 0];
  const lowSpeed = 1 - smooth(10, 40, V);
  torque[1] += spec.pFactor * thrust * lowSpeed;
  if (V < 0.5) return { force: rotate(q, force), torque: rotate(q, torque), info: { airspeed: V, alpha: 0, beta: 0, stall: 0, lift: 0, thrust, cl: 0 } as PlaneInfo };

  const alpha = Math.atan2(-vb[1], vb[0]), beta = Math.asin(clamp(vb[2] / V, -1, 1));
  const fl = Math.floor(p.flaps), fk = p.flaps - fl, flapAt = (arr: number[]) => arr[fl] + ((arr[Math.min(2, fl + 1)] ?? arr[fl]) - arr[fl]) * fk;
  const flapCl = flapAt(spec.flapCl), flapCd = flapAt(spec.flapCd);
  const wingY = rotate(q, [0, spec.wing.cy, 0]);
  const h = Math.max(0.1, s.pos[1] + wingY[1] - env.ground(s.pos[0], s.pos[2]));
  const ge = ((16 * h) / spec.span) ** 2 / (1 + ((16 * h) / spec.span) ** 2);
  const { cl: rawCl, stall } = liftCoefficient(spec, alpha + spec.incidence, flapCl);
  const cl = rawCl * (1 + 0.1 * (1 - ge));
  const ar = (spec.span * spec.span) / spec.area, k = (1 / (Math.PI * spec.oswald * ar)) * ge;
  const cd = spec.cd0 + flapCd + k * cl * cl + 1.2 * Math.sin(alpha) ** 2 * stall;
  const qbar = 0.5 * RHO * V * V, S = spec.area, b = spec.span, ch = spec.chord;

  const lx = -vb[1], ly = vb[0], ll = Math.hypot(lx, ly) || 1;
  force[0] += (qbar * S * cl * lx) / ll - (qbar * S * cd * vb[0]) / V;
  force[1] += (qbar * S * cl * ly) / ll - (qbar * S * cd * vb[1]) / V;
  force[2] += qbar * S * spec.cyBeta * beta - (qbar * S * cd * vb[2]) / V;

  const pr = wb[0], qr = wb[2], rr = -wb[1];
  const da = p.aileron * spec.surfaces.aileron, de = -(p.elevator * spec.surfaces.elevator + clamp(c.trim, -1, 1) * 0.15), dr = -p.rudder * spec.surfaces.rudder;
  const drop = stall * 0.035 * (rr + beta >= 0 ? 1 : -1);
  const L = qbar * S * b * (spec.clBeta * beta + (spec.clP * pr * b) / (2 * Vs) + (spec.clR * rr * b) / (2 * Vs) + spec.clAileron * da + drop);
  const M = qbar * S * ch * (spec.cm0 + spec.cmAlpha * alpha + (spec.cmQ * qr * ch) / (2 * Vs) + spec.cmElevator * de - 0.02 * p.flaps);
  const N = qbar * S * b * (spec.cnBeta * beta + (spec.cnR * rr * b) / (2 * Vs) + spec.cnRudder * dr + spec.cnAileron * da);
  torque[0] += L; torque[1] += -N; torque[2] += M;

  const info: PlaneInfo = { airspeed: V, alpha, beta, stall, lift: qbar * S * cl, thrust, cl };
  return { force: rotate(q, force), torque: rotate(q, torque), info };
}
