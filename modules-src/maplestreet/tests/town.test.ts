import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, CIVIC, DEPOT, drivewayRect, makeLots, ROAD_NAMES, ROADS, SHOP_DOORS, type RectXZ } from '../shared/WorldLayout';
import { roadRoute, routeLength } from '../src/game/RoadRoute';

type Box = { id: string; x0: number; x1: number; z0: number; z1: number };
const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const fromRect = (id: string, r: RectXZ): Box => ({ id, x0: r.cx - r.sx / 2, x1: r.cx + r.sx / 2, z0: r.cz - r.sz / 2, z1: r.cz + r.sz / 2 });

test('60 lots that never overlap each other, a road or a building', () => {
  const lots = makeLots();
  assert.equal(lots.length, 60);
  assert.equal(new Set(lots.map(l => l.id)).size, 60);
  for (const id of ['N1', 'N10', 'S1', 'S10']) assert.ok(lots.some(l => l.id === id), `original lot ${id} kept`);
  const L = lots.map(l => ({ id: l.id, x0: l.x, x1: l.x + l.w, z0: l.z, z1: l.z + l.d }));
  const R = ROADS.map((r, i) => fromRect(`road${i}`, r));
  const B = [...BUILDINGS, ...CIVIC].map(b => ({ id: b.id, x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 }));
  for (let i = 0; i < L.length; i++) {
    for (let j = i + 1; j < L.length; j++) assert.ok(!overlap(L[i], L[j]), `${L[i].id} overlaps ${L[j].id}`);
    for (const r of R) assert.ok(!overlap(L[i], r), `${L[i].id} sits on ${r.id}`);
    for (const b of B) assert.ok(!overlap(L[i], b), `${b.id} sits on ${L[i].id}`);
  }
  for (const b of B) for (const r of R) assert.ok(!overlap(b, r), `${b.id} sits on ${r.id}`);
  assert.equal(ROAD_NAMES.length, ROADS.length);
});

test('every driveway reaches a street', () => {
  for (const lot of makeLots()) {
    const d = drivewayRect(lot);
    const edgeZ = lot.front === '+z' ? d.cz + d.sz / 2 + 1 : d.cz - d.sz / 2 - 1;
    assert.ok(ROADS.some(r => Math.abs(d.cx - r.cx) < r.sx / 2 && Math.abs(edgeZ - r.cz) < r.sz / 2 + 2), lot.id);
  }
});

test('fire and police stations are not shops', () => {
  assert.ok(!SHOP_DOORS.some(d => d.id === 'fire' || d.id === 'police'));
  assert.deepEqual(CIVIC.map(b => b.kind).sort(), ['fire', 'police']);
});

test('the minimap routes along the streets to the farthest lot', () => {
  const far = makeLots().find(l => l.id === 'N30')!;
  const goal = { x: far.x + 4, z: far.z + far.d };
  const route = roadRoute({ x: DEPOT.padX, z: DEPOT.padZ }, goal);
  assert.ok(route.length > 3);
  const straight = Math.hypot(goal.x - DEPOT.padX, goal.z - DEPOT.padZ);
  const length = routeLength(route);
  assert.ok(length >= straight && length < straight * 2, `route ${length} m vs ${straight} m straight`);
});
