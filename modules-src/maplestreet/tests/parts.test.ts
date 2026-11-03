import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three/webgpu';
import { isValidParts, isValidVehicleRecord, type VehicleParts } from '../shared/CustomVehicles';
import { cutParts } from '../src/physics/CutParts';
import { sampleRecord } from './vehicles.test';

/** A 4.6 × 1.8 × 1.4 m body made of a finely divided box, so parts have triangles to cut. */
function body() {
  const g = new THREE.Group();
  const holder = new THREE.Group();
  holder.scale.setScalar(0.5);
  holder.position.set(0, -0.1, 0);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(9.2, 2.8, 3.6, 46, 14, 18), new THREE.MeshStandardMaterial());
  holder.add(mesh);
  g.add(holder);
  return { g, mesh };
}

const parts: VehicleParts = {
  doors: [{ front: 0.8, back: -0.2, bottom: -0.6, top: 0.5 }, { front: -0.3, back: -1.1, bottom: -0.6, top: 0.5 }],
  hood: { front: 2.3, back: 1.2, bottom: 0.4, top: 0.7 },
  trunk: { front: -1.5, back: -2.3, bottom: 0.4, top: 0.7 },
};

const triangles = (o: THREE.Object3D) => { let n = 0; o.traverse(m => { const mesh = m as THREE.Mesh; if (mesh.isMesh) n += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3; }); return n; };

test('the marked doors, hood and trunk are cut out into hinged leaves and nothing is lost', () => {
  const { g } = body();
  const before = triangles(g);
  const rig = cutParts(g, parts, 0.9);
  assert.ok(rig);
  assert.ok(rig.hasDoors && rig.hasHood && rig.hasTrunk);
  assert.equal(triangles(g), before, 'every triangle is kept, on the body or a leaf');
  const pivots = g.children.filter(c => c.type === 'Group' && c.children.some(m => (m as THREE.Mesh).isMesh && m.userData.keep));
  assert.equal(pivots.length, 6, 'four doors, a hood and a trunk');
  const hood = pivots.find(p => p.position.x > 1)!;
  assert.ok(Math.abs(hood.position.x - 1.2) < 0.15, 'the hood hinges at its back edge');
  const rightFront = pivots.find(p => p.position.z > 0.5 && p.position.x > 0.5)!;
  assert.ok(Math.abs(rightFront.position.x - 0.8) < 0.15, 'doors hinge at their front edge');
});

test('the rig swings each part the right way and closes everything when the car drives off', () => {
  const { g } = body();
  const rig = cutParts(g, parts, 0.9)!;
  const pivots = g.children.filter(c => c.type === 'Group' && c.children.some(m => m.userData.keep));
  rig.setAll(true); rig.setHood(true); rig.setTrunk(true);
  for (let i = 0; i < 60; i++) rig.update(1 / 30, 0);
  const right = pivots.find(p => p.position.z > 0.5)!, left = pivots.find(p => p.position.z < -0.5)!;
  assert.ok(right.rotation.y > 1 && left.rotation.y < -1, 'doors swing outward on both sides');
  const hood = pivots.find(p => p.position.x > 1)!, trunk = pivots.find(p => p.position.x < -1.4)!;
  assert.ok(hood.rotation.z > 0.8, 'the hood lifts');
  assert.ok(trunk.rotation.z < -0.9, 'the trunk lifts');
  rig.update(1 / 30, 5);
  assert.ok(rig.isOpen, 'a single jolt while parked leaves the doors open');
  for (let i = 0; i < 90; i++) rig.update(1 / 30, 5);
  assert.ok(!rig.isOpen && !rig.hoodOpen && !rig.trunkOpen && Math.abs(right.rotation.y) < 0.01 && Math.abs(hood.rotation.z) < 0.01);
});

test('getting in swings only the driver’s front door', () => {
  const { g } = body();
  const rig = cutParts(g, { doors: [parts.doors[0]], hood: null, trunk: null }, 0.9)!;
  rig.pulseDriver();
  for (let i = 0; i < 10; i++) rig.update(1 / 30, 0);
  const pivots = g.children.filter(c => c.type === 'Group' && c.children.some(m => m.userData.keep));
  const driver = pivots.find(p => p.position.z < 0)!, passenger = pivots.find(p => p.position.z > 0)!;
  assert.ok(Math.abs(driver.rotation.y) > 0.3 && passenger.rotation.y === 0);
});

test('nothing is cut when no parts are marked or none touch the model', () => {
  assert.equal(cutParts(body().g, undefined, 0.9), null);
  assert.equal(cutParts(body().g, { doors: [], hood: null, trunk: null }, 0.9), null);
  assert.equal(cutParts(body().g, { doors: [], hood: { front: 9, back: 8, bottom: 5, top: 6 }, trunk: null }, 0.9), null);
});

test('part boxes are validated on published records', () => {
  assert.ok(isValidParts(parts));
  assert.ok(!isValidParts({ doors: [parts.doors[0], parts.doors[0], parts.doors[0]], hood: null, trunk: null }), 'at most two rows of doors');
  assert.ok(!isValidParts({ doors: [{ front: -1, back: 1, bottom: 0, top: 1 }], hood: null, trunk: null }), 'front must be ahead of back');
  assert.ok(isValidVehicleRecord(sampleRecord()), 'records without parts stay valid');
  assert.ok(isValidVehicleRecord(sampleRecord(undefined, { parts })));
  assert.ok(!isValidVehicleRecord(sampleRecord(undefined, { parts: { doors: 'all', hood: null, trunk: null } as never })));
});
