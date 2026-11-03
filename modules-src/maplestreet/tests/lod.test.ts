import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three/webgpu';
import { levelFor, LodSystem, simplifiedGeometry, swapGeometry, swapObjects } from '../src/core/Lod';
import { WorldChunks } from '../src/world/WorldChunks';

test('LOD levels follow distance, with hysteresis at every boundary', () => {
  const d = [10, 40];
  assert.equal(levelFor(d, 5, -1), 0);
  assert.equal(levelFor(d, 25, -1), 1);
  assert.equal(levelFor(d, 90, -1), 2);
  // Just past a threshold the current level holds; well past it, it changes.
  assert.equal(levelFor(d, 10.5, 0), 0);
  assert.equal(levelFor(d, 12, 0), 1);
  assert.equal(levelFor(d, 9.5, 1), 1);
  assert.equal(levelFor(d, 8.5, 1), 0);
  assert.equal(levelFor(d, 5, 2), 0, 'a teleport jumps straight to the right level');
});

test('the registry swaps objects by camera distance and skips detached anchors', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const anchor = new THREE.Group();
  const hi = new THREE.Object3D(), lo = new THREE.Object3D(), box = new THREE.Object3D();
  anchor.add(hi, lo, box);
  scene.add(anchor, camera);
  const reg = new LodSystem();
  reg.add(anchor, [20, 100], swapObjects([hi, lo, box]));
  const at = (z: number) => { anchor.position.set(0, 0, z); scene.updateMatrixWorld(true); reg.update(camera); };
  at(-5);
  assert.deepEqual([hi.visible, lo.visible, box.visible], [true, false, false]);
  at(-60);
  assert.deepEqual([hi.visible, lo.visible, box.visible], [false, true, false]);
  at(-300);
  assert.deepEqual([hi.visible, lo.visible, box.visible], [false, false, true]);
  anchor.removeFromParent();
  at(-5);
  assert.equal(box.visible, true, 'a detached (pooled) object keeps its level until it is back in the scene');
  assert.deepEqual(reg.counts.filter(Boolean), []);
});

test('simplified geometry shares the vertex buffers and has far fewer triangles', async () => {
  const src = new THREE.SphereGeometry(1, 128, 96);
  const before = src.index!.count / 3;
  const lo = await simplifiedGeometry(src, 1000);
  assert.ok(lo, 'simplified');
  const after = lo!.index!.count / 3;
  assert.ok(after <= 1300 && after > 100, `${before} → ${after} triangles`);
  assert.equal(lo!.getAttribute('position'), src.getAttribute('position'), 'positions are shared, not copied');
  assert.equal(await simplifiedGeometry(src, 1000), lo, 'cached per source geometry');
  assert.equal(await simplifiedGeometry(new THREE.BoxGeometry(), 1000), null, 'already small enough');
  const mesh = new THREE.Mesh(src);
  swapGeometry(mesh, [src, lo])(1);
  assert.equal(mesh.geometry, lo);
  swapGeometry(mesh, [src, null, null])(2);
  assert.equal(mesh.geometry, src, 'a level that is not ready yet falls back to the nearest finer one');
});

test('chunk parts outside the view and the shadow box are hidden; shadow casters behind you stay', () => {
  const scene = new THREE.Scene();
  const chunks = new WorldChunks(scene);
  const src = new THREE.Group();
  const mk = (x: number, z: number, cast: boolean) => { const m = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4)); m.position.set(x, 2, z); m.castShadow = cast; src.add(m); };
  mk(0, -100, true);     // ahead
  mk(0, 40, true);       // behind, within the sun's shadow box
  mk(0, 40, false);      // never mind: merged with the caster above (same cell, same material)
  mk(800, 300, true);    // far off to the side, beyond every view distance
  scene.add(src);
  chunks.adopt(src);
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 2000);
  camera.position.set(0, 2, 0);
  camera.lookAt(0, 2, -10);
  chunks.update(camera.position, 0);
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  const c = sun.shadow.camera as THREE.OrthographicCamera;
  c.left = c.bottom = -55; c.right = c.top = 55; c.near = 1; c.far = 400; c.updateProjectionMatrix();
  sun.position.set(60, 160, 40); sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  chunks.cull(camera, sun);
  const stats = chunks.stats();
  assert.equal(stats.on, 2, 'the far part is out of range entirely');
  assert.equal(stats.visible, 2, 'ahead is in view; behind is kept for its shadow');
  chunks.cull(camera, null);
  assert.equal(chunks.stats().visible, 1, 'without shadows only what is in view is drawn');
});
