import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeGlassRuns, encodeGlassRuns, isValidVehicleGlass, lassoTriangles, pointInPolygon, tracedFlags, type VehicleGlass } from '../shared/VehicleGlass';
import { tidyWindows } from '../shared/WindowDetect';
import { isValidVehicleRecord } from '../shared/CustomVehicles';
import { vehicleGlassSchema, vehicleSpecSchema } from '../../../src/server/maplestreet-vehicles';
import { sampleRecord } from './vehicles.test';

/** A flat n × n grid of 0.1 m cells in the x/y plane, two triangles per cell (cell (i, j) is triangles 2(j·n+i) and +1). */
function grid(n: number) {
  const positions: number[] = [], indices: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) positions.push(i * 0.1, j * 0.1, 0);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    indices.push(a, b, c, b, d, c);
  }
  return { positions, indices };
}
const cell = (n: number, i: number, j: number) => 2 * (j * n + i);
const sum = (flags: ArrayLike<number>) => Array.from(flags).reduce((a, f) => a + f, 0);

test('glass runs round-trip and refuse malformed or overlong lists', () => {
  const flags = new Uint8Array(500);
  flags.fill(1, 5, 10); flags.fill(1, 16, 18); flags[499] = 1;
  const runs = encodeGlassRuns(flags);
  assert.equal(runs, '5.5.6.2.dd.1');
  assert.deepEqual(decodeGlassRuns(runs, 500), flags);
  assert.equal(encodeGlassRuns(new Uint8Array(40)), '');
  assert.equal(sum(decodeGlassRuns('', 40)!), 0);
  assert.equal(decodeGlassRuns('5.5.6.2.dd.1', 499), null, 'runs past the end');
  assert.equal(decodeGlassRuns('5.5.6', 500), null, 'odd number of values');
  assert.equal(decodeGlassRuns('5.0', 500), null, 'empty run');
  assert.equal(decodeGlassRuns('5,5', 500), null, 'wrong separator');
  const all = new Uint8Array(70_000).map((_, i) => (i % 3 === 0 ? 1 : 0));
  assert.deepEqual(decodeGlassRuns(encodeGlassRuns(all), all.length), all);
});

test('traced glass is only used for the mesh and model it was saved for', () => {
  const flags = new Uint8Array(12); flags.fill(1, 2, 6);
  const glass: VehicleGlass = { v: 1, parts: [{ mesh: 1, tris: 12, verts: 30, runs: encodeGlassRuns(flags) }] };
  assert.ok(isValidVehicleGlass(glass));
  assert.deepEqual(tracedFlags(glass, 1, 12, 30), flags);
  assert.equal(tracedFlags(glass, 0, 12, 30), null, 'another mesh');
  assert.equal(tracedFlags(glass, 1, 13, 30), null, 'a changed model');
  assert.equal(tracedFlags(glass, 1, 12, 31), null, 'a changed model');
  assert.equal(tracedFlags(undefined, 1, 12, 30), null);
  assert.ok(!isValidVehicleGlass({ v: 1, parts: [glass.parts[0], glass.parts[0]] }), 'one part per mesh');
  assert.ok(!isValidVehicleGlass({ v: 2, parts: [] }));
  assert.ok(!isValidVehicleGlass({ v: 1, parts: [{ mesh: 0, tris: 4, verts: 6, runs: '3.2' }] }), 'runs past the mesh');
});

test('the server keeps traced glass in the spec and refuses broken lists', () => {
  const flags = new Uint8Array(100); flags.fill(1, 10, 40);
  const glass: VehicleGlass = { v: 1, parts: [{ mesh: 0, tris: 100, verts: 80, runs: encodeGlassRuns(flags) }] };
  assert.ok(vehicleGlassSchema.safeParse(glass).success);
  assert.ok(!vehicleGlassSchema.safeParse({ v: 1, parts: [{ mesh: 0, tris: 10, verts: 80, runs: encodeGlassRuns(flags) }] }).success);
  assert.ok(!vehicleGlassSchema.safeParse({ v: 1, parts: [{ mesh: 0, tris: 100, verts: 80, runs: 'A.B' }] }).success);
  assert.ok(!vehicleGlassSchema.safeParse({ v: 1, parts: [], extra: true }).success);
  const { id: _id, name: _name, modelUrl: _m, wheelUrl: _w, hdUrl: _h, active: _a, status: _s, updatedAt: _u, ...spec } = sampleRecord();
  const parsed = vehicleSpecSchema.safeParse({ ...spec, glass });
  assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues[0]));
  assert.deepEqual(parsed.data?.glass, glass);
  assert.ok(isValidVehicleRecord({ ...sampleRecord(), glass }), 'records with glass still register');
});

test('a lasso picks only the camera-facing triangles whose centres are inside the loop', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.ok(pointInPolygon(5, 5, square));
  assert.ok(!pointInPolygon(11, 5, square));
  const notch = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 2 }, { x: 0, y: 10 }];
  assert.ok(!pointInPolygon(5, 8, notch), 'concave loops work');
  const screen = new Float32Array([5, 5, 20, 5, 6, 6, NaN, NaN, 2, 2]);
  const facing = new Uint8Array([1, 1, 0, 1, 1]);
  const flags = new Uint8Array(5);
  assert.equal(lassoTriangles(screen, facing, square, flags, 'add'), 2);
  assert.deepEqual([...flags], [1, 0, 0, 0, 1]);
  assert.equal(lassoTriangles(screen, facing, square, flags, 'add'), 0, 'already glass');
  assert.equal(lassoTriangles(screen, facing, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], flags, 'remove'), 1);
  assert.deepEqual([...flags], [1, 0, 0, 0, 0]);
  assert.equal(lassoTriangles(screen, facing, square.slice(0, 2), flags, 'add'), 0, 'a loop needs three points');
});

test('tidying drops specks and fills small holes without moving pane edges', () => {
  const n = 12, mesh = grid(n);
  const flags = new Uint8Array(n * n * 2);
  for (let j = 2; j < 8; j++) for (let i = 2; i < 8; i++) flags.fill(1, cell(n, i, j), cell(n, i, j) + 2);
  flags[cell(n, 4, 4)] = 0; flags[cell(n, 4, 4) + 1] = 0;
  flags[cell(n, 5, 6)] = 0;
  flags.fill(1, cell(n, 10, 10), cell(n, 10, 10) + 2);
  const pane = new Uint8Array(flags.length);
  for (let j = 2; j < 8; j++) for (let i = 2; i < 8; i++) pane.fill(1, cell(n, i, j), cell(n, i, j) + 2);
  assert.equal(tidyWindows(mesh, flags), 5);
  assert.deepEqual(flags, pane, 'the speck is gone, both holes are filled and the edges are where they were');
  assert.equal(tidyWindows(mesh, flags), 0, 'tidying twice changes nothing');
  const holed = Uint8Array.from(pane);
  holed[cell(n, 4, 4)] = 0; holed[cell(n, 4, 4) + 1] = 0;
  assert.equal(tidyWindows(mesh, holed, { maxHoleArea: 0.005 }), 0, 'holes bigger than the limit stay');
  const body = new Uint8Array(flags.length);
  for (let t = 0; t < body.length; t++) body[t] = pane[t] ? 0 : 1;
  assert.equal(tidyWindows(mesh, body, { minPatchArea: 0 }), 0, 'a pane-sized opening is not a hole');
});
