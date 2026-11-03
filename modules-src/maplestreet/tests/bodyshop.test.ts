import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOrder, BODY_SHOP, BODY_SHOP_BAYS, carValue, cleanOrder, inBay, quote, repairPrice } from '../shared/BodyShop';
import { addCrash, defaultCar, tuneEffects } from '../shared/Cars';
import type { ServerMsg, VehicleSnap } from '../shared/Protocol';
import { NeighborhoodLogic } from '../shared/RoomLogic';
import { BUILDINGS, CIVIC, GAS_STATION, makeLots, ROADS, SHOP_DOORS } from '../shared/WorldLayout';

type Box = { id: string; x0: number; x1: number; z0: number; z1: number };
const box = (id: string, cx: number, cz: number, sx: number, sz: number): Box => ({ id, x0: cx - sx / 2, x1: cx + sx / 2, z0: cz - sz / 2, z1: cz + sz / 2 });
const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

test('the body shop sits on open land and its three bays are inside it', () => {
  const shop = box('bodyshop', BODY_SHOP.x, BODY_SHOP.z, BODY_SHOP.w, BODY_SHOP.d);
  for (const [i, r] of ROADS.entries()) assert.ok(!overlap(shop, box(`road${i}`, r.cx, r.cz, r.sx, r.sz)), `sits on road ${i}`);
  for (const b of [...BUILDINGS, ...CIVIC]) assert.ok(!overlap(shop, box(b.id, b.x, b.z, b.w, b.d)), `overlaps ${b.id}`);
  for (const l of makeLots()) assert.ok(!overlap(shop, box(l.id, l.x + l.w / 2, l.z + l.d / 2, l.w, l.d)), `overlaps lot ${l.id}`);
  assert.ok(!overlap(shop, box('gas', GAS_STATION.canopy.x, GAS_STATION.canopy.z, GAS_STATION.canopy.w, GAS_STATION.canopy.d)));
  assert.equal(BODY_SHOP_BAYS.length, 3);
  for (const b of BODY_SHOP_BAYS) {
    assert.ok(b.w >= 7 && b.d >= 16, 'a bay fits a full-size pickup');
    assert.ok(overlap(box('bay', b.x, b.z, b.w, b.d), shop));
    assert.equal(inBay(b.x, b.z)?.id, b.id);
  }
  assert.equal(inBay(BODY_SHOP.x, BODY_SHOP.frontZ + 5), null, 'the street is not a bay');
  assert.equal(BODY_SHOP.z + BODY_SHOP.d / 2, BODY_SHOP.frontZ);
});

test('prices: repairs scale with damage and the car, upgrades add up, going back to stock costs labor', () => {
  const car = defaultCar('sedan');
  assert.equal(repairPrice('sedan', car), 0);
  addCrash(car, 13, { x: 2.4, y: 0, z: 0 });
  const price = repairPrice('sedan', car);
  assert.ok(price > 300 && price < 1000, `repair ${price}`);
  const truck = defaultCar('hdtruck');
  addCrash(truck, 13, { x: 2.4, y: 0, z: 0 });
  assert.ok(repairPrice('hdtruck', truck) > price, 'the crew cab costs more to fix');
  assert.ok(carValue('truck') > 0, 'the free starter pickup still has a repair value');

  const order = cleanOrder({ perf: { engine: 3 }, rims: { style: 'mesh', size: 2, finish: 'chrome' }, lift: 2, tint: 3 }, defaultCar('truck'));
  const q = quote('truck', defaultCar('truck'), order);
  assert.equal(q.lines.length, 4);
  assert.equal(q.lines.find(l => /Stage 3/.test(l.label))?.price, 1200 + 2600 + 4500);
  const tuned = applyOrder(defaultCar('truck'), order, 'truck');
  const back = quote('truck', tuned, cleanOrder({ perf: { engine: 0 }, lift: 0 }, tuned));
  assert.ok(back.lines.every(l => l.price < 100), 'downgrades cost labor only');
});

test('orders keep only valid changes', () => {
  const car = defaultCar('coupe');
  assert.deepEqual(cleanOrder({ repair: true, tint: 9, lift: 7, perf: { engine: 1.5, brakes: -1 }, rims: { style: 'spinner', size: 1, finish: 'gold' } }, car), {}, 'nothing valid to do on a clean stock car');
  assert.deepEqual(cleanOrder({ color: car.color, finish: car.finish, rims: { style: 'factory', size: 2, finish: 'gold' } }, car), {}, 'no-op paint and factory rims are nothing');
  assert.deepEqual(cleanOrder({ color: '#FF0000' }, car), { color: '#ff0000', finish: car.finish });
});

test('upgrades change the drive: tuned engines pull harder, lifts raise the car and fit bigger tires', () => {
  assert.deepEqual(tuneEffects(defaultCar('sedan')), { engine: 1, topSpeed: 1, brake: 1, grip: 1, lift: 0, tireScale: 1 });
  const tuned = { ...defaultCar('truck'), lift: 3, perf: { engine: 3, exhaust: 1, brakes: 2, tires: 2 } };
  const t = tuneEffects(tuned);
  assert.ok(t.engine > 1.25 && t.topSpeed > 1.1 && t.brake > 1.25);
  assert.ok(t.lift > 0.1 && t.tireScale > 1.1);
  assert.ok(tuneEffects({ ...defaultCar('coupe'), lift: -2 }).lift < 0);
});

function town(money = 50_000) {
  const sent: ServerMsg[] = [];
  const logic = new NeighborhoodLogic({ send: (_id, msg) => { sent.push(msg); }, broadcast: msg => { sent.push(msg); } }, null);
  logic.join('s1', { key: 'shop-key', name: 'Driver', color: '#3a7bd5' });
  const account = () => logic.accounts['shop-key'];
  account().money = money;
  const place = (x: number, z: number, vehicles: Partial<VehicleSnap>[] = []) => logic.message('s1', {
    t: 'state',
    p: { id: 's1', name: 'Driver', color: '#3a7bd5', x, y: 0, z, yaw: 0, speed: 0, vehicleId: null },
    v: vehicles.map(v => ({ id: 'v', owner: 's1', kind: 'truck', x, y: 0, z, qx: 0, qy: 0, qz: 0, qw: 1, steer: 0, speed: 0, hitchedTo: null, ...v })) as VehicleSnap[],
  });
  const note = () => [...sent].reverse().find((m): m is Extract<ServerMsg, { t: 'account' }> => m.t === 'account' && !!m.note)?.note ?? '';
  return { logic, account, place, note };
}

test('repairs and upgrades happen only with the car parked in a bay, and are paid for', () => {
  const { logic, account, place, note } = town();
  const bay = BODY_SHOP_BAYS[1];
  place(0, 0, [{ kind: 'truck', x: 0, z: 0 }]);
  logic.message('s1', { t: 'crash', kind: 'truck', dv: 20, at: { x: 2.8, y: 0, z: 0 } });
  assert.ok(account().cars.truck!.damage > 0.4);

  logic.message('s1', { t: 'service', kind: 'truck', order: { repair: true } });
  assert.match(note(), /Walk up/);
  place(bay.x + 3, BODY_SHOP.frontZ + 4, [{ kind: 'truck', x: 0, z: 0 }]);
  logic.message('s1', { t: 'service', kind: 'truck', order: { repair: true } });
  assert.match(note(), /Park your Work Pickup in one of the bays/);

  place(bay.x + 3, BODY_SHOP.frontZ + 4, [{ kind: 'truck', x: bay.x, z: bay.z }]);
  const before = account().money;
  const cost = repairPrice('truck', account().cars.truck!);
  logic.message('s1', { t: 'service', kind: 'truck', order: { repair: true, perf: { tires: 1 }, rims: { style: 'beadlock', size: 1, finish: 'black' } } });
  assert.equal(account().cars.truck!.damage, 0);
  assert.equal(account().cars.truck!.dents.length, 0);
  assert.equal(account().cars.truck!.perf.tires, 1);
  assert.equal(account().cars.truck!.rims.style, 'beadlock');
  assert.equal(account().money, before - cost - 800 - (1100 + 100 + 200));

  logic.message('s1', { t: 'service', kind: 'sedan', order: { repair: true } });
  assert.equal(account().cars.sedan, undefined, 'cars you do not own are not serviced');
});

test('the shop refuses work you cannot afford', () => {
  const { logic, account, place, note } = town(500);
  const bay = BODY_SHOP_BAYS[0];
  place(bay.x, BODY_SHOP.frontZ + 3, [{ kind: 'truck', x: bay.x, z: bay.z }]);
  logic.message('s1', { t: 'service', kind: 'truck', order: { perf: { engine: 3 } } });
  assert.match(note(), /Not enough money/);
  assert.equal(account().cars.truck!.perf.engine, 0);
  assert.equal(account().money, 500);
});

test('the body shop is not a walk-up shop door', () => {
  assert.ok(!SHOP_DOORS.some(d => d.id === BODY_SHOP.id));
});
