import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CYCLE, FLEET, TRAFFIC_TYPES, finalDecision, goAroundKey, trafficPose, cycleAt } from '../shared/AirTraffic';
import { ELEV, HELIPADS, PLANE_STAND, RUNWAY, onPaving } from '../shared/Airport';

const DAY = [0, 86400 * 3 + 1234];

test('the same moment always puts every plane in the same place', () => {
  for (const f of FLEET) for (const t of [10, 4321.5, 99999]) assert.deepEqual(trafficPose(f, t), trafficPose(f, t));
});

test('planes move smoothly while they are in view', () => {
  for (const f of FLEET) {
    const fast = TRAFFIC_TYPES[f.type].climb + 5;
    for (const start of DAY) {
      let prev = trafficPose(f, start);
      for (let t = start + 0.5; t < start + CYCLE * 2; t += 0.5) {
        const p = trafficPose(f, t);
        if (p.visible && prev.visible) {
          const d = Math.hypot(p.pos[0] - prev.pos[0], p.pos[1] - prev.pos[1], p.pos[2] - prev.pos[2]);
          assert.ok(d <= fast * 0.5 + 0.5, `${f.id} jumped ${d.toFixed(1)} m at ${t} (${prev.phase} → ${p.phase})`);
          const turn = Math.abs(Math.atan2(Math.sin(p.yaw - prev.yaw), Math.cos(p.yaw - prev.yaw)));
          assert.ok(turn < 0.6, `${f.id} snapped ${turn.toFixed(2)} rad at ${t} (${prev.phase} → ${p.phase})`);
        }
        prev = p;
      }
    }
  }
});

test('finals follow a 3° glide slope to the threshold', () => {
  for (const f of FLEET) for (let t = f.offset + 5; t < f.offset + CYCLE; t += 1) {
    const p = trafficPose(f, t);
    if (p.phase !== 'final') continue;
    const thr = p.yaw === 0 || Math.cos(p.yaw) > 0 ? RUNWAY.x0 : RUNWAY.x1;
    const dist = Math.abs(p.pos[0] - thr), slope = (p.pos[1] - ELEV - 15) / dist;
    if (dist > 50) assert.ok(Math.abs(slope - Math.tan((3 * Math.PI) / 180)) < 0.002, `${f.id} slope ${slope.toFixed(4)}`);
  }
});

test('the runway is only ever used by one plane at a time', () => {
  for (let t = 0; t < 86400; t += 2) {
    const users = FLEET.filter(f => trafficPose(f, t).runway);
    assert.ok(users.length <= 1, `${users.map(u => u.id).join(', ')} on the runway at ${t}`);
  }
});

test('on the ground the planes stay on the paving and park clear of each other', () => {
  for (const f of FLEET) for (let t = 0; t < CYCLE * 2; t += 1) {
    const p = trafficPose(f, t);
    if (p.visible && p.ground) assert.ok(onPaving(p.pos[0], p.pos[2]), `${f.id} off the paving at ${p.pos[0].toFixed(0)}, ${p.pos[2].toFixed(0)} (${p.phase})`);
  }
  const stands = [...FLEET.map(f => ({ ...f.stand, r: TRAFFIC_TYPES[f.type].span / 2 + 3 })), { x: PLANE_STAND.x, z: PLANE_STAND.z, r: 8 }, ...HELIPADS.map(h => ({ x: h.x, z: h.z, r: h.r + 2 }))];
  for (let i = 0; i < stands.length; i++) for (let k = i + 1; k < stands.length; k++) {
    const a = stands[i], b = stands[k];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > a.r + b.r, `stands ${i} and ${k} overlap`);
  }
});

test('a go-around climbs away instead of landing', () => {
  const f = FLEET[0], { cycle } = cycleAt(f, f.offset + 10), set = new Set([goAroundKey(f, cycle)]);
  let lowest = Infinity;
  for (let t = f.offset + 60; t < f.offset + 400; t += 1) { const p = trafficPose(f, t, set); if (p.visible) lowest = Math.min(lowest, p.pos[1]); }
  assert.ok(lowest > ELEV + 10, `went down to ${(lowest - ELEV).toFixed(1)} m`);
  assert.ok(finalDecision(f, f.offset + 10));
});
