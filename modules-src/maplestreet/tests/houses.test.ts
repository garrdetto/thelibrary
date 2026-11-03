import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOp, emptyBuild, makeWorld, type WorldState } from '../shared/BuildRules';
import type { Extra, PlanId } from '../shared/HousePlans';
import { buildHouse, NEIGHBOR_HOUSES, SEED_VERSION, seedNeighborhood, upgradeSeed } from '../shared/Seed';
import { drivewayRect, makeLots } from '../shared/WorldLayout';

const PLANS: PlanId[] = ['classic', 'ranch', 'colonial', 'craftsman', 'modern', 'cape', 'duplex'];
const EXTRAS: Extra[] = ['pool', 'hoop', 'court', 'swings', 'trampoline', 'hotTub', 'doghouse', 'garden'];

test('every house plan builds cleanly on lots facing either way', () => {
  for (const plan of PLANS) for (const lotId of ['N2', 'S2', 'N30', 'S30']) for (const stories of [1, 2] as const) for (const extra of EXTRAS) {
    const world = makeWorld(makeLots());
    world.lots[lotId].owner = 'npc-test';
    const failed = buildHouse(world, { lotId, owner: 'npc-test', name: 'Test', plan, look: { wall: 'brick_red', floor: 'oak', fence: 'privacy', stories, extras: [extra] } });
    assert.deepEqual(failed, [], `${plan} on ${lotId} with ${extra}`);
  }
});

test('house floors stay off the driveway', () => {
  const world = makeWorld(makeLots());
  seedNeighborhood(world);
  for (const spec of NEIGHBOR_HOUSES) {
    const lot = world.lots[spec.lotId];
    const d = drivewayRect(lot);
    for (const f of Object.values(world.builds[spec.lotId].floors)) {
      const inside = f.gx + 0.5 > d.cx - d.sx / 2 && f.gx + 0.5 < d.cx + d.sx / 2 && f.gz + 0.5 > d.cz - d.sz / 2 && f.gz + 0.5 < d.cz + d.sz / 2;
      assert.ok(!inside, `${spec.lotId} (${spec.plan}) has a floor on its driveway at ${f.gx},${f.gz}`);
    }
  }
});

test('a fresh neighborhood seeds every starter house and leaves lots to buy', () => {
  const world = makeWorld(makeLots());
  seedNeighborhood(world);
  assert.equal(world.seedVersion, SEED_VERSION);
  const lots = Object.values(world.lots);
  assert.equal(new Set(NEIGHBOR_HOUSES.map(s => s.lotId)).size, NEIGHBOR_HOUSES.length);
  for (const spec of NEIGHBOR_HOUSES) {
    assert.equal(world.lots[spec.lotId].owner, spec.owner);
    assert.ok(Object.keys(world.builds[spec.lotId].roofs).length > 0, `${spec.lotId} has a roof`);
  }
  assert.ok(new Set(NEIGHBOR_HOUSES.map(s => s.plan)).size >= 6, 'uses most of the plans');
  assert.ok(lots.filter(l => !l.owner).length >= 30, 'at least half the lots stay for sale');
});

test('upgrading an older world keeps players’ lots and rebuilds the neighbors’', () => {
  const world: WorldState = makeWorld(makeLots());
  world.lots.N2.owner = 'npc-hendricks'; world.lots.N2.ownerName = 'Hendricks';
  applyOp(world, { op: 'walls', lotId: 'N2', level: 0, style: 'stone', segs: [{ gx: world.lots.N2.x + 1, gz: world.lots.N2.z + 1, dir: 'x' }] }, 'npc-hendricks', 'Hendricks');
  world.lots.N6.owner = 'player-1'; world.lots.N6.ownerName = 'Sam';
  applyOp(world, { op: 'walls', lotId: 'N6', level: 0, style: 'stone', segs: [{ gx: world.lots.N6.x + 1, gz: world.lots.N6.z + 1, dir: 'x' }] }, 'player-1', 'Sam');
  world.builds.N9 = emptyBuild();
  applyOp(world, { op: 'buyLot', lotId: 'N9' }, 'player-2', 'Ana');

  const changed = upgradeSeed(world);
  assert.equal(world.seedVersion, SEED_VERSION);
  assert.ok(changed.includes('N2'), 'the old neighbor house is rebuilt');
  assert.ok(!changed.includes('N6') && !changed.includes('N9'), 'player lots are skipped');
  assert.equal(world.lots.N6.owner, 'player-1');
  assert.equal(Object.keys(world.builds.N6.walls).length, 1);
  assert.equal(world.lots.N9.owner, 'player-2');
  assert.ok(Object.keys(world.builds.N2.walls).length > 20);
  assert.deepEqual(upgradeSeed(world), [], 'runs once');
});
