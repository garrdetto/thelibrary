import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NpcTraffic, obstaclesFrom } from '../shared/Npc';
import { NeighborhoodLogic } from '../shared/RoomLogic';
import type { ServerMsg, VehicleSnap } from '../shared/Protocol';
import { gaitFrequency, gaitPose } from '../src/avatar/Gait';

const LEG = 0.45;
const footX = (u: number, speed: number) => { const p = gaitPose(u, speed).legL; return LEG * Math.sin(p.hip) + LEG * Math.sin(p.hip - p.knee); };
const footY = (u: number, speed: number) => { const p = gaitPose(u, speed).legL; return -LEG * Math.cos(p.hip) - LEG * Math.cos(p.hip - p.knee); };

/**
 * Average backward speed of the planted foot. Walking: the middle of the
 * stance phase (the foot is down from heel strike to 60% of the cycle).
 * Running: wherever the foot is within 2 cm of its lowest point.
 */
function stanceFootSpeed(speed: number, running: boolean) {
  const N = 1000, f = gaitFrequency(speed);
  let low = Infinity;
  for (let i = 0; i < N; i++) low = Math.min(low, footY(i / N, speed));
  let sum = 0, n = 0;
  for (let i = 0; i < N; i++) {
    const u = i / N;
    const planted = running ? footY(u, speed) - low < 0.02 : u > 0.1 && u < 0.45;
    if (planted) { sum += -(footX(u + 1 / N, speed) - footX(u, speed)) * N * f; n++; }
  }
  return sum / n;
}

test('walking and running feet keep pace with the ground instead of sliding', () => {
  for (const [speed, running] of [[1.3, false], [2.6, false], [6, true]] as const) {
    const v = stanceFootSpeed(speed, running);
    assert.ok(Math.abs(v - speed) < speed * 0.15, `planted foot moves ${v.toFixed(2)} m/s at ${speed} m/s`);
  }
});

test('the knee is nearly straight at heel strike and bends through the swing', () => {
  for (const speed of [1.3, 2.6]) {
    assert.ok(gaitPose(0, speed).legL.knee < 0.12, 'straight knee as the heel lands');
    assert.ok(gaitPose(0.7, speed).legL.knee > 0.5, 'bent knee mid-swing');
  }
  const run = gaitPose(0.66, 6);
  assert.ok(run.legL.knee > 1.6, 'running tucks the swing leg');
  assert.ok(run.lean > 0.12, 'running leans forward');
  assert.ok(run.armL.elbow > 1.1, 'running bends the elbows');
});

test('standing still holds a neutral pose', () => {
  const g = gaitPose(0.3, 0);
  assert.equal(gaitFrequency(0), 0);
  for (const leg of [g.legL, g.legR]) assert.ok(Math.abs(leg.hip) < 1e-6 && Math.abs(leg.knee) < 1e-6);
});

function truckAcross(x: number, z: number, yaw: number): VehicleSnap {
  return { id: 'p:truck', owner: 'p', kind: 'truck', x, y: 0.94, z, qx: 0, qy: Math.sin(yaw / 2), qz: 0, qw: Math.cos(yaw / 2), steer: 0, speed: 0, hitchedTo: null };
}

test('NPC drivers stop short of a vehicle parked across their lane', () => {
  const probe = new NpcTraffic();
  let at = { x: 0, z: 0, yaw: 0 };
  for (let i = 0; i < 60 * 6; i++) {
    probe.step(1 / 60);
    const v = probe.snapshot().vehicles[0];
    const fx = 1 - 2 * (v.qy ** 2 + v.qz ** 2), fz = 2 * (v.qx * v.qz - v.qw * v.qy);
    at = { x: v.x, z: v.z, yaw: Math.atan2(-fz, fx) + Math.PI / 2 };
  }
  const truck = truckAcross(at.x, at.z, at.yaw);
  const t = new NpcTraffic();
  let closest = Infinity;
  for (let i = 0; i < 60 * 30; i++) {
    t.obstacles = obstaclesFrom([], [truck]);
    t.step(1 / 60);
    const me = t.snapshot().vehicles[0];
    closest = Math.min(closest, Math.hypot(me.x - at.x, me.z - at.z));
  }
  assert.ok(closest > 2.35 + 0.95 + 0.5, `sedan got within ${closest.toFixed(2)} m of the truck`);
});

test('NPC traffic never overlaps itself or gridlocks', () => {
  const t = new NpcTraffic();
  let stillest = 0;
  const still = new Map<string, number>();
  for (let i = 0; i < 60 * 300; i++) {
    t.step(1 / 60);
    if (i % 30) continue;
    const { vehicles } = t.snapshot();
    const obs = obstaclesFrom([], vehicles);
    for (let a = 0; a < obs.length; a++) for (let b = a + 1; b < obs.length; b++) {
      const A = obs[a], B = obs[b];
      assert.ok(Math.hypot(A.x - B.x, A.z - B.z) > Math.min(A.hx, A.hz) + Math.min(B.hx, B.hz), 'two NPC vehicles overlap');
    }
    for (const v of vehicles) {
      const s = Math.abs(v.speed) < 0.05 ? (still.get(v.id) ?? 0) + 0.5 : 0;
      still.set(v.id, s);
      stillest = Math.max(stillest, s);
    }
  }
  assert.ok(stillest < 20, `an NPC sat still for ${stillest} s`);
});

test('reconnecting replaces the old session so its truck is never left behind', () => {
  const sent: ServerMsg[] = [];
  const logic = new NeighborhoodLogic({ send: () => {}, broadcast: m => sent.push(m) }, null, {});
  const state = (x: number) => ({ t: 'state', p: { x, y: 0, z: x, yaw: 0, speed: 0, vehicleId: null }, v: [{ id: 'truck', kind: 'truck', x: 5, y: 1, z: 5, qx: 0, qy: 0, qz: 0, qw: 1, steer: 0, speed: 0, hitchedTo: null }] }) as Parameters<NeighborhoodLogic['message']>[1];
  logic.join('old', { key: 'k1', name: 'Pat', color: '#123456' });
  logic.message('old', state(1));
  logic.join('new', { key: 'k1', name: 'Pat', color: '#123456' });
  logic.message('old', state(1));
  logic.message('new', state(9));
  logic.tick(0.2);
  assert.ok(sent.some(m => m.t === 'left' && m.id === 'old'));
  const snap = sent.filter(m => m.t === 'snap').pop();
  assert.ok(snap && snap.t === 'snap');
  assert.deepEqual(snap.players.map(p => p.id), ['new']);
  assert.deepEqual(snap.vehicles.map(v => v.id), ['new:truck']);
});

test('closing the newer tab brings the older connection back into the world', () => {
  const sent: ServerMsg[] = [];
  const logic = new NeighborhoodLogic({ send: () => {}, broadcast: m => sent.push(m) }, null, {});
  const state = { t: 'state', p: { x: 1, y: 0, z: 1, yaw: 0, speed: 0, vehicleId: null }, v: [] } as unknown as Parameters<NeighborhoodLogic['message']>[1];
  logic.join('first', { key: 'k2', name: 'Lee', color: '#123456' });
  logic.join('second', { key: 'k2', name: 'Lee', color: '#123456' });
  logic.leave('second');
  logic.message('first', state);
  logic.tick(0.2);
  const snap = sent.filter(m => m.t === 'snap').pop();
  assert.ok(snap && snap.t === 'snap');
  assert.deepEqual(snap.players.map(p => p.id), ['first']);
});
