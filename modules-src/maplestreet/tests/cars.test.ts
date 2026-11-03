import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanCar, defaultCar, factoryColor } from '../shared/Cars';
import { newAccount, normalizeAccount, type Account } from '../shared/Economy';
import type { ServerMsg, VehicleSnap } from '../shared/Protocol';
import { NeighborhoodLogic } from '../shared/RoomLogic';
import { SHOP_DOORS } from '../shared/WorldLayout';

function town() {
  const sent: ServerMsg[] = [];
  const logic = new NeighborhoodLogic({ send: (_id, msg) => { sent.push(msg); }, broadcast: msg => { sent.push(msg); } }, null, { unlimitedMoney: true });
  logic.join('s1', { key: 'buyer-key', name: 'Buyer', color: '#3a7bd5' });
  const account = () => logic.accounts['buyer-key'];
  const standAt = (x: number, z: number, vehicles: Partial<VehicleSnap>[] = []) => logic.message('s1', {
    t: 'state',
    p: { id: 's1', name: 'Buyer', color: '#3a7bd5', x, y: 0, z, yaw: 0, speed: 0, vehicleId: null },
    v: vehicles.map(v => ({ id: 'v', owner: 's1', kind: 'truck', x, y: 0, z, qx: 0, qy: 0, qz: 0, qw: 1, steer: 0, speed: 0, hitchedTo: null, ...v })) as VehicleSnap[],
  });
  return { logic, sent, account, standAt };
}

const dealer = SHOP_DOORS.find(d => d.kind === 'dealer')!;

test('starter vehicles and old saves get their factory paint', () => {
  const fresh = newAccount('id1', 'k1', 'New', '#ffffff');
  for (const k of fresh.garage) assert.deepEqual(fresh.cars[k], defaultCar(k));
  const old = { ...fresh, cars: undefined } as unknown as Account;
  normalizeAccount(old);
  assert.deepEqual(old.cars.truck, { color: factoryColor('truck'), finish: 'metallic' });
});

test('malformed paint falls back to the factory look', () => {
  assert.deepEqual(cleanCar({ color: 'red', finish: 'chrome' }, 'sedan'), defaultCar('sedan'));
  assert.deepEqual(cleanCar({ color: '#ABCDEF', finish: 'matte' }, 'sedan'), { color: '#abcdef', finish: 'matte' });
});

test('buying at Maple Motors keeps the chosen color and finish', () => {
  const { logic, account, standAt } = town();
  standAt(dealer.x, dealer.z);
  logic.message('s1', { t: 'buy', shop: dealer.id, item: 'sedan', car: { color: '#1f5fae', finish: 'matte' } });
  assert.ok(account().garage.includes('sedan'));
  assert.deepEqual(account().cars.sedan, { color: '#1f5fae', finish: 'matte' });
});

test('a purchase without a valid color gets the factory paint', () => {
  const { logic, account, standAt } = town();
  standAt(dealer.x, dealer.z);
  logic.message('s1', { t: 'buy', shop: dealer.id, item: 'coupe', car: { color: 'javascript:alert(1)', finish: 'gloss' } as never });
  assert.deepEqual(account().cars.coupe, { color: factoryColor('coupe'), finish: 'gloss' });
});

test('vehicle snapshots carry the owner’s paint, never the client’s claim', () => {
  const { logic, sent, standAt } = town();
  standAt(dealer.x, dealer.z);
  logic.message('s1', { t: 'buy', shop: dealer.id, item: 'sedan', car: { color: '#b3171d', finish: 'gloss' } });
  standAt(0, 0, [{ kind: 'sedan', style: { color: '#00ff00', finish: 'matte' } }, { kind: 'golfcart' }]);
  logic.tick(1);
  const snap = [...sent].reverse().find((m): m is Extract<ServerMsg, { t: 'snap' }> => m.t === 'snap');
  assert.ok(snap, 'a snapshot was broadcast');
  assert.deepEqual(snap.vehicles.find(v => v.kind === 'sedan')?.style, { color: '#b3171d', finish: 'gloss' });
  assert.equal(snap.vehicles.find(v => v.kind === 'golfcart')?.style, null, 'a test drive shows factory paint');
});
