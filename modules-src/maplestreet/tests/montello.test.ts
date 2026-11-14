import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { FIRE_BASE_PAY, FIRE_HOSE_SECONDS, STARTER_TRUCK } from '../shared/Economy';
import type { Job, ServerMsg, VehicleSnap } from '../shared/Protocol';
import { NeighborhoodLogic } from '../shared/RoomLogic';
import { MONTELLO_DEPOT, MONTELLO_FIRE_STATION, MONTELLO_HOMES, MONTELLO_PUMPS, MONTELLO_SHOPS, MONTELLO_STREETS } from '../shared/MontelloPlaces';
import { registerCustomVehicles } from '../shared/CustomVehicles';
// @ts-expect-error plain ES module script
import { placesSource } from '../../../scripts/montello-places.mjs';

registerCustomVehicles([]);

function town(money = 1_000) {
  const sent: ServerMsg[] = [];
  const logic = new NeighborhoodLogic({ send: (_id, msg) => { sent.push(msg); }, broadcast: msg => { sent.push(msg); } }, null);
  logic.join('s1', { key: 'mt-key', name: 'Visitor', color: '#3a7bd5' });
  const account = () => logic.accounts['mt-key'];
  account().money = money;
  const place = (x: number, z: number, driving = false, vx = x, vz = z) => logic.message('s1', {
    t: 'state',
    p: { id: 's1', name: 'Visitor', color: '#3a7bd5', x, y: 0, z, yaw: 0, speed: 0, vehicleId: driving ? 's1:truck' : null },
    v: [{ id: 's1:truck', owner: 's1', kind: STARTER_TRUCK, x: vx, y: 0, z: vz, qx: 0, qy: 0, qz: 0, qw: 1, steer: 0, speed: 0, hitchedTo: null }] as VehicleSnap[],
  });
  const note = () => [...sent].reverse().find((m): m is Extract<ServerMsg, { t: 'account' }> => m.t === 'account' && !!m.note)?.note ?? '';
  const toast = () => [...sent].reverse().find((m): m is Extract<ServerMsg, { t: 'toast' }> => m.t === 'toast')?.text ?? '';
  const job = () => [...sent].reverse().find((m): m is Extract<ServerMsg, { t: 'job' }> => m.t === 'job') ?? null;
  return { logic, account, place, note, toast, job, sent };
}

test('the Montello table is generated from the baked map and is current', () => {
  const doc = JSON.parse(readFileSync('public/modules/tello/montello.json', 'utf8'));
  assert.equal(readFileSync('modules-src/maplestreet/shared/MontelloPlaces.ts', 'utf8'), placesSource(doc), 'rerun node scripts/montello-places.mjs');
});

test('Montello has its bars, its bank, Kwik Trip with pumps, the fire station and its houses', () => {
  const names = MONTELLO_SHOPS.map(s => s.name);
  for (const n of ['Kwik Trip', 'Tambears', "Weezie's Town Pump", 'Yahooz Sports Bar & Grill', 'Rivers Edge Saloon & Eatery']) assert.ok(names.includes(n), n);
  assert.ok(MONTELLO_SHOPS.some(s => s.kind === 'bank'));
  assert.equal(new Set(MONTELLO_SHOPS.map(s => s.id)).size, MONTELLO_SHOPS.length, 'ids are unique');
  assert.ok(MONTELLO_PUMPS.length >= 4);
  assert.ok(MONTELLO_FIRE_STATION && MONTELLO_DEPOT?.name === 'Kwik Trip');
  assert.equal(MONTELLO_HOMES.length % 3, 0);
  assert.ok(MONTELLO_HOMES.length / 3 > 300, 'hundreds of houses to deliver to');
  for (let i = 2; i < MONTELLO_HOMES.length; i += 3) assert.ok(MONTELLO_STREETS[MONTELLO_HOMES[i]] !== undefined);
  for (const s of MONTELLO_SHOPS) assert.ok(s.z < -1400 && s.z > -3600, `${s.name} lies north of Fox Plains along County Road F`);
});

test('a Montello bar serves you only at its door, and charges for it', () => {
  const { logic, account, place, note } = town(20);
  const bar = MONTELLO_SHOPS.find(s => s.kind === 'bar')!;
  place(0, 0);
  logic.message('s1', { t: 'buy', shop: bar.id, item: 'old-fashioned' });
  assert.match(note(), /Walk up/);
  assert.equal(account().money, 20);
  place(bar.x + 1, bar.z + 1);
  const fun = account().needs.fun;
  logic.message('s1', { t: 'buy', shop: bar.id, item: 'old-fashioned' });
  assert.equal(account().money, 12);
  assert.ok(account().needs.fun > fun);
  logic.message('s1', { t: 'buy', shop: bar.id, item: 'fish-fry' });
  assert.match(note(), /Not enough money/);
});

test('Kwik Trip pumps fill the tank', () => {
  const { logic, account, place, note } = town(500);
  account().fuel[STARTER_TRUCK] = 2;
  place(0, 0);
  logic.message('s1', { t: 'refuel', kind: STARTER_TRUCK, gallons: 10 });
  assert.match(note(), /fuel pump/);
  assert.equal(account().fuel[STARTER_TRUCK], 2);
  const pump = MONTELLO_PUMPS[0];
  place(pump.x + 1, pump.z);
  logic.message('s1', { t: 'refuel', kind: STARTER_TRUCK, gallons: 10 });
  assert.ok(Math.abs(account().fuel[STARTER_TRUCK]! - 12) < 1e-6);
  assert.ok(account().money < 500);
});

test('Kwik Trip deliveries go from the store to a Montello house, in the pickup', () => {
  const { logic, account, place, job, toast } = town();
  const depot = MONTELLO_DEPOT!;
  place(0, 0);
  logic.message('s1', { t: 'jobRequest', kind: 'montello' });
  assert.match(toast(), /Kwik Trip/);
  assert.equal(job(), null);
  place(depot.x + 3, depot.z);
  logic.message('s1', { t: 'jobRequest', kind: 'montello' });
  const j = job()!.job as Job;
  assert.equal(j.area, 'montello');
  assert.equal(j.kind, 'delivery');
  assert.ok(Math.hypot(j.drop.x - depot.x, j.drop.z - depot.z) >= 150);
  place(depot.x + 2, depot.z, true, depot.x + 10, depot.z);
  logic.message('s1', { t: 'jobProgress', jobId: j.id });
  assert.equal((job()!.job as Job).stage, 'toDrop');
  const before = account().money;
  place(j.drop.x, j.drop.z + 12, true, j.drop.x, j.drop.z + 12);
  logic.message('s1', { t: 'jobProgress', jobId: j.id });
  assert.equal(job()!.job, null);
  assert.equal(account().money, before + j.pay);
});

test('fire calls start at the station and pay once the crew has held the hose on scene', () => {
  const { logic, account, place, job } = town();
  const station = MONTELLO_FIRE_STATION!;
  place(station.x, station.z);
  logic.message('s1', { t: 'jobRequest', kind: 'fire' });
  const j = job()!.job as Job;
  assert.equal(j.kind, 'fire');
  assert.ok(j.pay > FIRE_BASE_PAY);
  logic.message('s1', { t: 'jobRequest', kind: 'fire' });
  assert.match(job()!.note ?? '', /Finish the call/);
  logic.message('s1', { t: 'jobProgress', jobId: j.id });
  assert.equal((job()!.job as Job).stage, 'toDrop');
  place(j.drop.x + 10, j.drop.z);
  logic.message('s1', { t: 'jobProgress', jobId: j.id });
  const onScene = job()!.job as Job;
  assert.equal(onScene.stage, 'onScene');
  const before = account().money;
  logic.message('s1', { t: 'jobProgress', jobId: j.id });
  assert.equal(account().money, before, 'the fire is not out yet');
  onScene.since = Date.now() - (FIRE_HOSE_SECONDS + 1) * 1000;
  logic.message('s1', { t: 'jobProgress', jobId: j.id });
  assert.equal(job()!.job, null);
  assert.equal(account().money, before + j.pay);
});
