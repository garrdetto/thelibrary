import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addCrash, cleanCar, conditionEffects, crashDamage, defaultCar, factoryColor, MAX_DENTS } from '../shared/Cars';
import { newAccount, normalizeAccount, type Account } from '../shared/Economy';
import type { ServerMsg, VehicleSnap } from '../shared/Protocol';
import { NeighborhoodLogic } from '../shared/RoomLogic';
import { SHOP_DOORS } from '../shared/WorldLayout';
import { registerCustomVehicles } from '../shared/CustomVehicles';
import { STARTER_TRUCK } from '../shared/Economy';

// The starter pickup is a bundled vehicle, registered like every authority does before a world loads.
registerCustomVehicles([]);

function town() {
  const sent: ServerMsg[] = [];
  const logic = new NeighborhoodLogic({ send: (_id, msg) => { sent.push(msg); }, broadcast: msg => { sent.push(msg); } }, null, { unlimitedMoney: true });
  logic.join('s1', { key: 'buyer-key', name: 'Buyer', color: '#3a7bd5' });
  const account = () => logic.accounts['buyer-key'];
  const standAt = (x: number, z: number, vehicles: Partial<VehicleSnap>[] = []) => logic.message('s1', {
    t: 'state',
    p: { id: 's1', name: 'Buyer', color: '#3a7bd5', x, y: 0, z, yaw: 0, speed: 0, vehicleId: null },
    v: vehicles.map(v => ({ id: 'v', owner: 's1', kind: STARTER_TRUCK, x, y: 0, z, qx: 0, qy: 0, qz: 0, qw: 1, steer: 0, speed: 0, hitchedTo: null, ...v })) as VehicleSnap[],
  });
  return { logic, sent, account, standAt };
}

const dealer = SHOP_DOORS.find(d => d.kind === 'dealer')!;

test('starter vehicles and old saves get their factory paint', () => {
  const fresh = newAccount('id1', 'k1', 'New', '#ffffff');
  for (const k of fresh.garage) assert.deepEqual(fresh.cars[k], defaultCar(k));
  const old = { ...fresh, cars: undefined } as unknown as Account;
  normalizeAccount(old);
  assert.deepEqual(old.cars[STARTER_TRUCK], { color: factoryColor(STARTER_TRUCK), finish: 'metallic', damage: 0, dents: [], tint: 0, rims: { style: 'factory', size: 0, finish: 'silver' }, lift: 0, perf: { engine: 0, exhaust: 0, brakes: 0, tires: 0 } });
});

test('malformed paint falls back to the factory look', () => {
  assert.deepEqual(cleanCar({ color: 'red', finish: 'chrome' }, 'sedan'), defaultCar('sedan'));
  assert.deepEqual(cleanCar({ color: '#ABCDEF', finish: 'matte' }, 'sedan'), { color: '#abcdef', finish: 'matte', damage: 0, dents: [], tint: 0, rims: { style: 'factory', size: 0, finish: 'silver' }, lift: 0, perf: { engine: 0, exhaust: 0, brakes: 0, tires: 0 } });
});

test('buying at Maple Motors keeps the chosen color and finish', () => {
  const { logic, account, standAt } = town();
  standAt(dealer.x, dealer.z);
  logic.message('s1', { t: 'buy', shop: dealer.id, item: 'sedan', car: { color: '#1f5fae', finish: 'matte' } });
  assert.ok(account().garage.includes('sedan'));
  assert.deepEqual(account().cars.sedan, { color: '#1f5fae', finish: 'matte', damage: 0, dents: [], tint: 0, rims: { style: 'factory', size: 0, finish: 'silver' }, lift: 0, perf: { engine: 0, exhaust: 0, brakes: 0, tires: 0 } });
});

test('a purchase without a valid color gets the factory paint', () => {
  const { logic, account, standAt } = town();
  standAt(dealer.x, dealer.z);
  logic.message('s1', { t: 'buy', shop: dealer.id, item: 'coupe', car: { color: 'javascript:alert(1)', finish: 'gloss' } as never });
  assert.deepEqual(account().cars.coupe, { color: factoryColor('coupe'), finish: 'gloss', damage: 0, dents: [], tint: 0, rims: { style: 'factory', size: 0, finish: 'silver' }, lift: 0, perf: { engine: 0, exhaust: 0, brakes: 0, tires: 0 } });
});

test('vehicle snapshots carry the owner’s paint, never the client’s claim', () => {
  const { logic, sent, standAt } = town();
  standAt(dealer.x, dealer.z);
  logic.message('s1', { t: 'buy', shop: dealer.id, item: 'sedan', car: { color: '#b3171d', finish: 'gloss' } });
  standAt(0, 0, [{ kind: 'sedan', style: { color: '#00ff00', finish: 'matte' } }, { kind: 'golfcart' }]);
  logic.tick(1);
  const snap = [...sent].reverse().find((m): m is Extract<ServerMsg, { t: 'snap' }> => m.t === 'snap');
  assert.ok(snap, 'a snapshot was broadcast');
  assert.deepEqual(snap.vehicles.find(v => v.kind === 'sedan')?.style, { color: '#b3171d', finish: 'gloss', damage: 0, dents: [], tint: 0, rims: { style: 'factory', size: 0, finish: 'silver' }, lift: 0, perf: { engine: 0, exhaust: 0, brakes: 0, tires: 0 } });
  assert.equal(snap.vehicles.find(v => v.kind === 'golfcart')?.style, null, 'a test drive shows factory paint');
});

test('crashes add damage and dents where the car was hit', () => {
  assert.equal(crashDamage(3), 0, 'hard braking is not a crash');
  assert.ok(Math.abs(crashDamage(13) - 0.25) < 0.01, 'a ~30 mph wall hit costs about a quarter');
  assert.equal(crashDamage(100), 0.5, 'one crash costs at most half');
  const car = defaultCar('sedan');
  addCrash(car, 13, { x: 2.3, y: 0.1, z: 0.4 });
  assert.equal(car.dents.length, 1);
  assert.equal(car.dents[0].x, 2.3);
  addCrash(car, 13, { x: 2.35, y: 0.1, z: 0.45 });
  assert.equal(car.dents.length, 1, 'a second hit nearby deepens the same dent');
  for (let i = 0; i < 20; i++) addCrash(car, 10, { x: -5.5 + i * 0.55, y: 0, z: -1 });
  assert.equal(car.dents.length, MAX_DENTS);
  assert.equal(car.damage, 1);
  const wrecked = conditionEffects(1);
  assert.ok(wrecked.engine < 0.7 && wrecked.grip < 0.85 && wrecked.pull > 0);
  assert.deepEqual(conditionEffects(0), { engine: 1, grip: 1, pull: 0 });
});

test('the authority only damages cars the player owns and has out, at most every 400 ms', () => {
  const { logic, account, standAt } = town();
  standAt(0, 0, [{ kind: STARTER_TRUCK }]);
  logic.message('s1', { t: 'crash', kind: 'sedan', dv: 20, at: { x: 2, y: 0, z: 0 } });
  assert.equal(account().cars.sedan, undefined, 'not owned');
  logic.message('s1', { t: 'crash', kind: 'mower', dv: 20, at: { x: 1, y: 0, z: 0 } });
  assert.equal(account().cars.mower?.damage, 0, 'owned but not out');
  logic.message('s1', { t: 'crash', kind: STARTER_TRUCK, dv: 13, at: { x: 2.8, y: 0.2, z: 0 } });
  const after = account().cars[STARTER_TRUCK]!.damage;
  assert.ok(after > 0.2);
  logic.message('s1', { t: 'crash', kind: STARTER_TRUCK, dv: 13, at: { x: -2.8, y: 0.2, z: 0 } });
  assert.equal(account().cars[STARTER_TRUCK]!.damage, after, 'the same crash reported twice counts once');
  logic.message('s1', { t: 'crash', kind: STARTER_TRUCK, dv: 1e9, at: { x: 1e9, y: -1e9, z: Number.NaN } } as never);
  const dents = account().cars[STARTER_TRUCK]!.dents;
  assert.ok(dents.every(d => Math.abs(d.x) <= 6 && Math.abs(d.y) <= 4 && Math.abs(d.z) <= 3 && Number.isFinite(d.z)));
});

test('a new car leaves the lot undamaged even if the request says otherwise', () => {
  const { logic, account, standAt } = town();
  standAt(dealer.x, dealer.z);
  logic.message('s1', { t: 'buy', shop: dealer.id, item: 'atv', car: { color: '#1f5fae', finish: 'gloss', damage: 1, dents: [{ x: 0, y: 0, z: 0, depth: 0.2 }] } });
  assert.deepEqual(account().cars.atv, { color: '#1f5fae', finish: 'gloss', damage: 0, dents: [], tint: 0, rims: { style: 'factory', size: 0, finish: 'silver' }, lift: 0, perf: { engine: 0, exhaust: 0, brakes: 0, tires: 0 } });
});
