/**
 * A plain rigid-body integrator for the flight models, used by the tests in
 * place of Rapier: gravity, forces and torques about the centre of mass with
 * a diagonal body inertia, and flat ground at y = 0 that the aircraft rests
 * on (a sliding, braking contact under its origin, enough for take-off rolls
 * and landings). `pos` is the aircraft's origin, as in the page.
 */
import type { AircraftSpec } from './Aircraft';
import { add, cross, G, quatMul, quatNorm, rotate, scale, unrotate, type V3 } from './FlightMath';
import type { FlightState } from './HeliFlight';

export interface SimContact { grounded: boolean; sink: number }

export function stepBody(spec: AircraftSpec, s: FlightState, force: V3, torque: V3, dt: number, brake = 0): SimContact {
  const I = spec.inertia;
  s.vel = add(s.vel, scale(add(force, [0, -spec.mass * G, 0]), dt / spec.mass));
  const wb = unrotate(s.rot, s.angVel), tb = unrotate(s.rot, torque);
  const gyro = cross(wb, [I[0] * wb[0], I[1] * wb[1], I[2] * wb[2]]);
  const wb2: V3 = [wb[0] + ((tb[0] - gyro[0]) / I[0]) * dt, wb[1] + ((tb[1] - gyro[1]) / I[1]) * dt, wb[2] + ((tb[2] - gyro[2]) / I[2]) * dt];
  s.angVel = rotate(s.rot, wb2);
  const w = s.angVel;
  s.rot = quatNorm(add4(s.rot, scale4(quatMul([w[0], w[1], w[2], 0], s.rot), dt / 2)));
  s.pos = add(s.pos, scale(s.vel, dt));
  s.t += dt;
  let sink = 0, grounded = false;
  if (s.pos[1] <= 0) {
    grounded = true;
    sink = -s.vel[1];
    s.pos[1] = 0;
    if (s.vel[1] < 0) s.vel[1] = 0;
    const vb = unrotate(s.rot, s.vel);
    const roll = (spec.kind === 'plane' ? 0.02 + 0.5 * brake : 0.6) * G * dt;
    vb[0] = Math.sign(vb[0]) * Math.max(0, Math.abs(vb[0]) - roll);
    vb[2] = 0;
    s.vel = rotate(s.rot, [vb[0], s.vel[1], vb[2]]);
    const ab = unrotate(s.rot, s.angVel);
    s.angVel = rotate(s.rot, [ab[0] * 0.5, ab[1] * 0.9, Math.max(0, ab[2]) * 0.5]);
  }
  return { grounded, sink };
}

const add4 = (a: number[], b: number[]) => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]] as [number, number, number, number];
const scale4 = (a: number[], k: number) => [a[0] * k, a[1] * k, a[2] * k, a[3] * k];
