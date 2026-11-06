import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRAINER_PLANE as P, UTILITY_HELI as H } from '../shared/Aircraft';
import { attitude, G, RHO, rotate, yawQuat, type V3 } from '../shared/FlightMath';
import { heliForces, newRotor, type FlightEnv, type FlightState, type HeliInfo } from '../shared/HeliFlight';
import { liftCoefficient, newParts, planeForces, type PlaneInfo } from '../shared/PlaneFlight';
import { heliAssist, newHeliAssist, newPlaneAssist, planeAssist, type AssistMode, type PilotInput } from '../shared/FlightAssist';
import { stepBody } from '../shared/FlightSim';
import { landing } from '../shared/Landing';

const calm: FlightEnv = { ground: () => 0, wind: () => [0, 0, 0] };
const DT = 1 / 60;
const none: PilotInput = { fwd: 0, roll: 0, yaw: 0, power: 0, brake: false };
const state = (y: number, vel: V3 = [0, 0, 0], yaw = 0): FlightState => ({ pos: [0, y, 0], vel, rot: yawQuat(yaw), angVel: [0, 0, 0], t: 0 });

function flyHeli(s: FlightState, seconds: number, input: (t: number) => PilotInput, o: { mode?: AssistMode; engine?: boolean; env?: FlightEnv } = {}) {
  const rotor = newRotor(H, true), st = newHeliAssist(), env = o.env ?? calm;
  let info: HeliInfo | null = null, grounded = s.pos[1] <= 0, touchdown = 0, minRpm = 1;
  for (let t = 0; t < seconds; t += DT) {
    const c = heliAssist(H, s, info, rotor, input(t), st, o.mode ?? 'easy', grounded, DT);
    if (o.engine === false) { c.engine = false; c.collective = 0.05; }
    const r = heliForces(H, s, c, rotor, env, DT);
    info = r.info;
    const contact = stepBody(H, s, r.force, r.torque, DT);
    if (contact.grounded && !grounded) touchdown = contact.sink;
    grounded = contact.grounded;
    minRpm = Math.min(minRpm, rotor.rpm);
  }
  return { s, rotor, info: info!, touchdown, grounded, minRpm };
}

function flyPlane(s: FlightState, seconds: number, input: (t: number, s: FlightState, info: PlaneInfo | null) => PilotInput, o: { mode?: AssistMode; throttle?: number; engine?: boolean; flaps?: number } = {}) {
  const parts = newParts(P), st = newPlaneAssist();
  st.throttle = o.throttle ?? 0; st.flaps = o.flaps ?? 0;
  parts.power = st.throttle;
  let info: PlaneInfo | null = null, grounded = s.pos[1] <= 0, maxStall = 0;
  const track: { t: number; x: number; y: number; v: number; stall: number; grounded: boolean }[] = [];
  for (let t = 0; t < seconds; t += DT) {
    const i = input(t, s, info);
    const c = planeAssist(P, s, info, i, st, o.mode ?? 'easy', grounded, DT);
    if (o.engine === false) c.engine = false;
    const r = planeForces(P, s, c, parts, calm, DT);
    info = r.info;
    grounded = stepBody(P, s, r.force, r.torque, DT, c.brake).grounded;
    maxStall = Math.max(maxStall, info.stall);
    track.push({ t, x: Math.hypot(s.pos[0], s.pos[2]), y: s.pos[1], v: info.airspeed, stall: info.stall, grounded });
  }
  return { s, info: info!, track, maxStall };
}

test('the helicopter holds a hover hands-off', () => {
  const { s } = flyHeli(state(30), 20, () => none);
  const a = attitude(s.rot);
  assert.ok(Math.hypot(...s.vel) < 0.5, `drifting ${Math.hypot(...s.vel).toFixed(2)} m/s`);
  assert.ok(Math.abs(s.pos[1] - 30) < 1.5, `height ${s.pos[1].toFixed(1)}`);
  assert.ok(Math.abs(a.pitch) < 0.1 && Math.abs(a.bank) < 0.1);
});

test('ground effect and translational lift add thrust', () => {
  const rotor = newRotor(H, true), c = { collective: 0.5, pitch: 0, roll: 0, pedal: 0, engine: true };
  const low = heliForces(H, state(0.5), c, { ...rotor, tilt: [0, 0] }, calm, DT).info;
  const high = heliForces(H, state(40), c, { ...rotor, tilt: [0, 0] }, calm, DT).info;
  const fast = heliForces(H, state(40, [12, 0, 0]), c, { ...rotor, tilt: [0, 0] }, calm, DT).info;
  assert.ok(low.groundEffect > 1.12 && low.groundEffect <= 1.25, `ground effect ${low.groundEffect.toFixed(3)}`);
  assert.ok(Math.abs(high.groundEffect - 1) < 0.01);
  assert.ok(fast.translational > 1.1, `translational lift ${fast.translational.toFixed(3)}`);
});

test('the assist levels a disturbed helicopter and stops it', () => {
  const s = state(60, [6, -2, 3]);
  s.rot = [Math.sin(0.25), 0, 0, Math.cos(0.25)];
  s.angVel = [0.3, 0.2, -0.2];
  const r = flyHeli(s, 8, () => none);
  const a = attitude(r.s.rot);
  assert.ok(Math.abs(a.bank) < 0.06 && Math.abs(a.pitch) < 0.08, `attitude ${a.bank.toFixed(3)}, ${a.pitch.toFixed(3)}`);
  assert.ok(Math.hypot(...r.s.vel) < 1.5, `still moving ${Math.hypot(...r.s.vel).toFixed(2)} m/s`);
});

test('holding forward flies the helicopter at speed without losing height', () => {
  const r = flyHeli(state(80), 25, t => ({ ...none, fwd: t < 6 ? 1 : 0 }));
  const speed = Math.hypot(r.s.vel[0], r.s.vel[2]);
  assert.ok(speed > 28, `only ${speed.toFixed(1)} m/s`);
  assert.ok(Math.abs(r.s.pos[1] - 80) < 10, `height ${r.s.pos[1].toFixed(1)}`);
});

test('descending to the ground lands softly, and landings are graded', () => {
  const r = flyHeli(state(25), 25, () => ({ ...none, power: -1 }));
  assert.ok(r.grounded, 'never touched down');
  assert.ok(r.touchdown < 1.5, `touched down at ${r.touchdown.toFixed(2)} m/s`);
  assert.equal(landing(H, 1), 'soft');
  assert.equal(landing(H, 3.5), 'hard');
  assert.equal(landing(H, 7), 'crash');
  assert.equal(landing(P, 2), 'soft');
  assert.equal(landing(P, 4), 'hard');
});

test('with the engine off the rotor keeps turning in a descent (autorotation)', () => {
  const r = flyHeli(state(400, [20, 0, 0]), 12, () => none, { engine: false });
  assert.ok(r.minRpm > 0.6, `rotor fell to ${r.minRpm.toFixed(2)}`);
  assert.ok(r.s.vel[1] < -4, 'not descending');
});

test('the same inputs always fly the same path', () => {
  const a = flyHeli(state(50), 6, t => ({ ...none, fwd: t < 3 ? 1 : 0, roll: 0.5 }));
  const b = flyHeli(state(50), 6, t => ({ ...none, fwd: t < 3 ? 1 : 0, roll: 0.5 }));
  assert.deepEqual(a.s, b.s);
});

function stallSpeed(flapCl: number) {
  let best = 0;
  for (let a = 0; a < 0.5; a += 0.002) best = Math.max(best, liftCoefficient(P, a, flapCl).cl);
  return Math.sqrt((2 * P.mass * G) / (RHO * P.area * best));
}

test('the trainer stalls at trainer speeds, slower with flaps', () => {
  const clean = stallSpeed(P.flapCl[0]), full = stallSpeed(P.flapCl[2]);
  assert.ok(clean > 20.5 && clean < 25, `clean stall ${(clean * 1.944).toFixed(0)} kt`);
  assert.ok(clean - full > 2.5, `flaps only lower the stall by ${((clean - full) * 1.944).toFixed(1)} kt`);
});

test('the trainer trims level in cruise hands-off', () => {
  const r = flyPlane(state(600, [48, 0, 0]), 60, () => none, { throttle: 0.62 });
  const a = attitude(r.s.rot);
  assert.ok(Math.abs(r.s.pos[1] - 600) < 25, `height ${r.s.pos[1].toFixed(0)}`);
  assert.ok(r.info.airspeed > 40 && r.info.airspeed < 62, `airspeed ${r.info.airspeed.toFixed(1)}`);
  assert.ok(Math.abs(a.bank) < 0.05, `bank ${a.bank.toFixed(3)}`);
});

test('the trainer takes off in a sensible distance and climbs', () => {
  const r = flyPlane(state(0), 45, (t, s, info) => ({ ...none, fwd: (info?.airspeed ?? 0) > 27 && s.pos[1] < 15 ? -1 : 0 }), { throttle: 1, flaps: 1 });
  const lift = r.track.find(p => !p.grounded && p.y > 0.5);
  assert.ok(lift, 'never left the ground');
  assert.ok(lift.x > 120 && lift.x < 500, `lifted off after ${lift.x.toFixed(0)} m`);
  const last = r.track[r.track.length - 1], mid = r.track[Math.floor(r.track.length * 0.7)];
  const climb = (last.y - mid.y) / (last.t - mid.t);
  assert.ok(climb > 2, `climbing only ${climb.toFixed(2)} m/s`);
});

test('the trainer glides about 9 to 1 with the engine off', () => {
  const r = flyPlane(state(800, [33, 0, 0]), 90, () => none, { engine: false });
  const a = r.track[Math.floor(r.track.length * 0.3)], b = r.track[r.track.length - 1];
  const ratio = (b.x - a.x) / (a.y - b.y);
  assert.ok(ratio > 6.5 && ratio < 12, `glide ratio ${ratio.toFixed(1)}`);
});

test('a stall recovers with the stick forward', () => {
  const r = flyPlane(state(900, [32, 0, 0]), 20, t => ({ ...none, fwd: t < 8 ? -1 : t < 12 ? 1 : 0 }), { mode: 'pro', throttle: 0.2 });
  assert.ok(r.maxStall > 0.5, 'never stalled');
  const end = r.track[r.track.length - 1];
  assert.ok(end.stall < 0.1 && end.v > 25, `still stalled: ${end.stall.toFixed(2)} at ${end.v.toFixed(1)} m/s`);
});

test('in a crosswind the trainer weathervanes its nose into the wind', () => {
  const s = state(300, [40, 0, 0]);
  const windy: FlightEnv = { ground: () => 0, wind: () => [0, 0, -8] };
  const r = planeForces(P, s, { throttle: 0.6, elevator: 0, aileron: 0, rudder: 0, flaps: 0, trim: 0, brake: 0, engine: true }, newParts(P), windy, DT);
  const yaw = rotate([0, 0, 0, 1], r.torque)[1];
  assert.ok(yaw < 0, 'wind from the right should turn the nose right');
});
