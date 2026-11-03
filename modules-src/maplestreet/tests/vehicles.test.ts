import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three/webgpu';
import { BUNDLED_VEHICLES } from '../shared/BundledVehicles';
import { BRAND_PATTERN, customVehicleKind, CUSTOM_TRAFFIC, DRIVE_TEMPLATES, isValidVehicleRecord, VEHICLE_LIMITS, registerCustomVehicles, type CustomVehicleRecord } from '../shared/CustomVehicles';
import { newAccount, normalizeAccount, SHOP_ITEMS, STARTER_GARAGE, STARTER_TRUCK, VEHICLES } from '../shared/Economy';
import { NpcTraffic } from '../shared/Npc';
import { accelTargetMph, predictDrive, solveDrive } from '../shared/VehicleDrive';
import { BUILTIN_TUNING, rideHeight, TUNING, vehicleRole } from '../shared/Vehicles';
import { dynoKind } from '../src/physics/Dyno';
import { Physics } from '../src/physics/Physics';
import { Vehicle } from '../src/physics/Vehicle';
import { PRESETS } from '../src/physics/VehiclePresets';
import { statSync } from 'node:fs';
import { join } from 'node:path';


export function sampleRecord(id = 'a1b2c3d4-0000-4000-8000-000000000001', overrides: Partial<CustomVehicleRecord> = {}): CustomVehicleRecord {
  const base = BUILTIN_TUNING.sedan;
  const targets = { topSpeedMph: 70, zeroToMph: 60, zeroToSeconds: 11 };
  const engine = solveDrive(base, targets);
  return {
    id, name: 'Test Wagon', modelUrl: `/api/maplestreet-vehicles?model=${id}`, wheelUrl: null, active: true, updatedAt: 1,
    template: 'sedan',
    model: { scale: 1, yaw: 0, x: 0, y: -0.3, z: 0 },
    physics: {
      chassis: { ...base.chassis }, mass: base.mass, comY: base.comY, axles: base.axles.map(a => ({ ...a })), wheelY: base.wheelY,
      suspension: { ...base.suspension }, frictionSlip: base.frictionSlip, sideStiffness: base.sideStiffness,
      engineForce: engine.engineForce, topSpeed: engine.topSpeed, brake: base.brake, maxSteer: base.maxSteer,
      seat: { ...base.seat }, hitch: null, cam: { ...base.cam },
    },
    lights: { head: [{ x: 2.3, y: 0.16, z: 0.62 }], tail: [{ x: -2.33, y: 0.2, z: 0.64 }] },
    paint: { mode: 'none', material: '', key: '#ffffff', tolerance: 0.2, color: '#3366aa' },
    targets,
    dealer: { forSale: true, price: 18_000, fuel: 'gas', tank: 15, mpg: 30 },
    traffic: { enabled: true, driver: 'Test Driver', route: 'ringA', mph: 24 },
    wheelsRemoved: true,
    ...overrides,
  };
}

test('ride height from tuning matches where the physics body settles', async () => {
  const physics = await Physics.create();
  physics.addGround(300);
  const scene = new THREE.Scene();
  for (const [i, k] of DRIVE_TEMPLATES.entries()) {
    const v = new Vehicle(physics, k, k, new THREE.Vector3(-250 + i * 25, 0, 0), 0, scene);
    for (let s = 0; s < 300; s++) physics.step(1 / 60);
    assert.ok(Math.abs(v.body.translation().y - rideHeight(BUILTIN_TUNING[k])) < 0.04, k);
  }
});

test('the drive model predicts the real physics for every built-in car', async () => {
  for (const k of ['truck', 'sedan', 'coupe', 'hdtruck', 'golfcart', 'atv'] as const) {
    const real = await dynoKind(k);
    const p = predictDrive(BUILTIN_TUNING[k], real.targetMph);
    assert.ok(real.time !== null && p.time !== null, k);
    assert.ok(Math.abs(p.time! - real.time!) / real.time! < 0.03, `${k} time ${p.time} vs ${real.time}`);
    assert.ok(Math.abs(p.topMph - real.topMph) < 1.5, `${k} top ${p.topMph} vs ${real.topMph}`);
  }
});

test('solved engine numbers hit the targets on the real physics', async () => {
  const cases = [
    { template: 'sedan' as const, targets: { topSpeedMph: 70, zeroToMph: 60, zeroToSeconds: 11 } },
    { template: 'golfcart' as const, targets: { topSpeedMph: 22, zeroToMph: accelTargetMph(22), zeroToSeconds: 6 } },
  ];
  for (const [i, c] of cases.entries()) {
    const base = BUILTIN_TUNING[c.template];
    const engine = solveDrive(base, c.targets);
    const kind = `custom:solve-${i}`;
    PRESETS[kind] = { ...PRESETS[c.template], ...engine, kind: kind as `custom:${string}` };
    const real = await dynoKind(kind, { targetMph: c.targets.zeroToMph });
    assert.ok(real.time !== null && Math.abs(real.time - c.targets.zeroToSeconds) < 0.35, `${c.template} 0-${c.targets.zeroToMph}: ${real.time}`);
    assert.ok(Math.abs(real.topMph - c.targets.topSpeedMph) < 1.5, `${c.template} top ${real.topMph}`);
  }
});

test('published vehicles register with the dealer, garage, physics and traffic', () => {
  const r = sampleRecord();
  assert.ok(isValidVehicleRecord(r));
  const kind = customVehicleKind(r.id);
  registerCustomVehicles([r]);
  assert.equal(VEHICLES[kind].name, 'Test Wagon');
  assert.equal(TUNING[kind].engineForce, r.physics.engineForce);
  assert.ok(SHOP_ITEMS.dealer.some(i => i.vehicle === kind));
  assert.ok(SHOP_ITEMS.dealer.some(i => i.vehicle === 'coupe'), 'built-ins stay for sale');
  assert.equal(CUSTOM_TRAFFIC.filter(t => t.kind === kind).length, 1);

  const npc = new NpcTraffic();
  npc.step(0.1);
  const snap = npc.snapshot();
  const car = snap.vehicles.find(v => v.kind === kind);
  assert.ok(car, 'traffic driver spawned');
  assert.ok(Math.abs(car!.y - rideHeight(TUNING[kind])) < 1e-6);
  assert.ok(snap.players.some(p => p.name === 'Test Driver'));

  registerCustomVehicles([{ ...r, active: false }]);
  assert.ok(!SHOP_ITEMS.dealer.some(i => i.vehicle === kind), 'retired vehicles leave the dealer');
  assert.ok(VEHICLES[kind], 'retired vehicles stay valid for owners');
  assert.equal(CUSTOM_TRAFFIC.filter(t => t.kind === kind).length, 0);
  npc.step(0.1);
  assert.ok(!npc.snapshot().vehicles.some(v => v.kind === kind), 'retired vehicles leave traffic');
});

test('garages keep published vehicles, even before the catalog loads', () => {
  const acc = newAccount('p1', 'key', 'Neighbor', '#ffffff');
  acc.garage = ['truck', 'custom:ffffffff-0000-4000-8000-00000000abcd', 'bogus' as never, 'custom:../x' as never];
  normalizeAccount(acc);
  assert.ok(acc.garage.includes('custom:ffffffff-0000-4000-8000-00000000abcd'));
  assert.ok(!acc.garage.includes('bogus' as never));
  assert.ok(!acc.garage.includes('custom:../x' as never));
  assert.ok(acc.garage.includes('mower'));
});

test('bundled vehicles are always on the dealer lot, and a published record can replace one', () => {
  registerCustomVehicles([]);
  for (const b of BUNDLED_VEHICLES) {
    assert.ok(isValidVehicleRecord(b), `${b.id} is a valid record`);
    assert.ok(!BRAND_PATTERN.test(b.name), `${b.name} has no real make or model`);
    const kind = customVehicleKind(b.id);
    if (b.dealer.forSale) assert.ok(SHOP_ITEMS.dealer.some(i => i.vehicle === kind && i.price === b.dealer.price), `${b.name} is for sale`);
    else assert.ok(STARTER_GARAGE.includes(kind), `${b.name} is either sold or given to every neighbor`);
    assert.ok(TUNING[kind], `${b.name} has tuning`);
    const file = join(process.cwd(), 'public', b.modelUrl);
    assert.ok(statSync(file).size < VEHICLE_LIMITS.modelBytes, `${b.modelUrl} exists and fits the model limit`);
  }
  const first = BUNDLED_VEHICLES[0];
  registerCustomVehicles([{ ...first, active: false }]);
  assert.ok(!SHOP_ITEMS.dealer.some(i => i.vehicle === customVehicleKind(first.id)), 'a published record with the same id wins');
  registerCustomVehicles([]);
});

test('every new neighbor starts with the Maple Hauler', () => {
  registerCustomVehicles([]);
  const acc = newAccount('p2', 'key', 'Neighbor', '#ffffff');
  assert.equal(STARTER_TRUCK, customVehicleKind('bundled-maple-hauler'));
  assert.ok(acc.garage.includes(STARTER_TRUCK));
  assert.equal(acc.fuel[STARTER_TRUCK], VEHICLES[STARTER_TRUCK].tank);
  assert.equal(vehicleRole(STARTER_TRUCK), 'hauler', 'it can haul deliveries');
  assert.ok(TUNING[STARTER_TRUCK].hitch, 'it can tow the trailer');
  assert.ok(!SHOP_ITEMS.dealer.some(i => i.vehicle === STARTER_TRUCK), 'it is not sold at Maple Motors');
});

test('a bundled vehicle can drive around town as a fleet in several colors', () => {
  registerCustomVehicles([]);
  const kind = customVehicleKind('bundled-lakeshore-coupe');
  const fleet = CUSTOM_TRAFFIC.filter(t => t.kind === kind);
  assert.equal(fleet.length, 6);
  assert.equal(new Set(fleet.map(t => t.paint)).size, 6, 'each car has its own color');
  const npc = new NpcTraffic();
  npc.step(0.1);
  const cars = npc.snapshot().vehicles.filter(v => v.kind === kind);
  assert.equal(cars.length, 6);
  assert.equal(new Set(cars.map(v => v.id)).size, 6);
  assert.ok(cars.every(v => /^#[0-9a-f]{6}$/.test(v.style?.color ?? '')), 'snapshots carry the paint');
  const spread = cars.map(v => `${Math.round(v.x)},${Math.round(v.z)}`);
  assert.equal(new Set(spread).size, 6, 'no two start on the same spot');
});

test('bundled vehicles reach their dyno targets', async () => {
  registerCustomVehicles([]);
  for (const b of BUNDLED_VEHICLES) {
    const kind = customVehicleKind(b.id);
    PRESETS[kind] = { ...PRESETS[b.template], ...TUNING[kind] };
    const real = await dynoKind(kind, { targetMph: b.targets.zeroToMph });
    assert.ok(Math.abs(real.topMph - b.targets.topSpeedMph) < 2, `${b.name} top ${real.topMph}`);
    assert.ok(real.time !== null && Math.abs(real.time - b.targets.zeroToSeconds) < 0.5, `${b.name} 0-${b.targets.zeroToMph}: ${real.time}`);
  }
});

test('merging a compressed (quantized) model keeps its scaled size', async () => {
  const { mergeStatic } = await import('../src/core/Merge');
  const geo = new THREE.BufferGeometry();
  // Two triangles spanning -1..1 stored as normalized Int16, as meshopt/KHR_mesh_quantization models are.
  geo.setAttribute('position', new THREE.BufferAttribute(new Int16Array([-32767, -32767, 0, 32767, -32767, 0, 32767, 32767, 0, -32767, 32767, 0, -32767, -32767, 0, 32767, 32767, 0]), 3, true));
  const body = new THREE.Group();
  const holder = new THREE.Group();
  holder.scale.setScalar(2.5);
  holder.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial()));
  body.add(holder);
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial()));
  mergeStatic(body);
  const box = new THREE.Box3().setFromObject(body);
  assert.ok(box.max.x > 2.4 && box.min.x < -2.4 && box.max.y > 2.4, `merged body keeps its 5 m size (${box.min.x.toFixed(2)}..${box.max.x.toFixed(2)})`);
});
