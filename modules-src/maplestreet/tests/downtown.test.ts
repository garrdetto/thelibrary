import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRID_BUILDINGS, GRID_BLOCKS, GRID_SIDEWALKS, TOWN_SQUARE } from '../shared/DowntownGrid';
import { BUILDINGS, CIVIC, DEPOT, GAS_STATION, MAP_BOUNDS, ROADS, SHOP_DOORS, SIDEWALKS, WORLD_HALF, type RectXZ } from '../shared/WorldLayout';
import { roadRoute, routeLength } from '../src/game/RoadRoute';

type Box = { id: string; x0: number; x1: number; z0: number; z1: number };
const overlap = (a: Box, b: Box) => a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6;
const fromRect = (id: string, r: RectXZ): Box => ({ id, x0: r.cx - r.sx / 2, x1: r.cx + r.sx / 2, z0: r.cz - r.sz / 2, z1: r.cz + r.sz / 2 });
const fromBuilding = (b: { id: string; x: number; z: number; w: number; d: number }): Box => ({ id: b.id, x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 });

test('grid buildings fill their blocks without touching streets, sidewalks or each other', () => {
  const B = GRID_BUILDINGS.map(fromBuilding);
  assert.equal(new Set(B.map(b => b.id)).size, B.length, 'ids are unique');
  const streets = [...ROADS.map((r, i) => fromRect(`road${i}`, r)), ...SIDEWALKS.map((r, i) => fromRect(`walk${i}`, r))];
  for (let i = 0; i < B.length; i++) {
    for (let j = i + 1; j < B.length; j++) assert.ok(!overlap(B[i], B[j]), `${B[i].id} overlaps ${B[j].id}`);
    for (const s of streets) assert.ok(!overlap(B[i], s), `${B[i].id} sits on ${s.id}`);
    const blk = GRID_BLOCKS.find(k => B[i].x0 >= k.x0 - 1e-6 && B[i].x1 <= k.x1 + 1e-6 && B[i].z0 >= k.z0 - 1e-6 && B[i].z1 <= k.z1 + 1e-6);
    assert.ok(blk && blk !== TOWN_SQUARE, `${B[i].id} stands inside a building block`);
  }
  for (const blk of GRID_BLOCKS) {
    if (blk === TOWN_SQUARE) continue;
    for (const facing of ['-z', '+z'] as const) {
      const row = GRID_BUILDINGS.filter(b => b.facing === facing && b.x > blk.x0 && b.x < blk.x1 && b.z > blk.z0 && b.z < blk.z1);
      assert.equal(row.reduce((a, b) => a + b.w, 0), blk.x1 - blk.x0, `block ${blk.col},${blk.row} ${facing} frontage is continuous`);
    }
  }
  for (const b of [...BUILDINGS, ...CIVIC]) if (!GRID_BUILDINGS.includes(b)) for (const g of B) assert.ok(!overlap(fromBuilding(b), g), `${g.id} overlaps ${b.id}`);
});

test('the grid adds scenery, not shops, and keeps its landmarks', () => {
  assert.ok(GRID_BUILDINGS.length >= 60 && GRID_BUILDINGS.length <= 110, `${GRID_BUILDINGS.length} buildings`);
  for (const id of ['townhall', 'cinema', 'library', 'hotel']) assert.ok(GRID_BUILDINGS.some(b => b.id === id), id);
  assert.ok(!SHOP_DOORS.some(d => GRID_BUILDINGS.some(b => b.id === d.id)), 'no grid building has a shop door');
  assert.ok(GRID_BUILDINGS.every(b => b.lite && b.w >= 10 && b.h >= 6));
  assert.ok(!GRID_BUILDINGS.some(b => overlap(fromBuilding(b), { id: 'square', ...TOWN_SQUARE })), 'Maple Commons stays open');
});

test('the grid sits inside the world and on the map', () => {
  for (const s of GRID_SIDEWALKS) assert.ok(s.cx + s.sx / 2 < MAP_BOUNDS.x1 && s.cx + s.sx / 2 < WORLD_HALF - 20);
  const gas = fromRect('gas', { cx: GAS_STATION.store.x, cz: GAS_STATION.store.z, sx: GAS_STATION.store.w, sz: GAS_STATION.store.d });
  for (const r of ROADS) assert.ok(!overlap(fromRect('road', r), gas), 'roads stay off the gas station');
});

test('deliveries can route from the depot to the far side of the grid', () => {
  const hall = GRID_BUILDINGS.find(b => b.id === 'hotel')!;
  const goal = { x: hall.x, z: hall.facing === '+z' ? hall.z + hall.d / 2 + 2 : hall.z - hall.d / 2 - 2 };
  const route = roadRoute({ x: DEPOT.padX, z: DEPOT.padZ }, goal);
  assert.ok(route.length > 2);
  const straight = Math.hypot(goal.x - DEPOT.padX, goal.z - DEPOT.padZ);
  assert.ok(routeLength(route) < straight * 1.6, `route ${routeLength(route)} m vs ${straight} m straight`);
});
