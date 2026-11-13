import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BufferAttribute, BufferGeometry } from 'three';
import { Document, WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { isValidVehicleRecord } from '../shared/CustomVehicles';
import { cutTriangles, lampCuts, lamps3d } from '../shared/LampCut';
import { lampCutter, lampParts } from '../shared/Lamps3d';
import { DEFAULT_LAMP_STYLE, LAMP_BOX, LAMP_GRID, type Shape } from '../shared/Shapes';
import { detectWindows, glassMask, isGlassColor } from '../shared/WindowDetect';
import { findLampOutline } from '../../../src/components/maplestreet/vehicle/lampDetect';
import { lampFromOutline } from '../../../src/components/maplestreet/vehicle/lampTrace';
import { topology } from '../../../src/components/maplestreet/vehicle/meshTopology';
import type * as ModelTools from '../../../src/components/maplestreet/vehicle/modelTools';
import { BUMP_LEVELS, smoothCapped } from '../../../src/components/maplestreet/vehicle/smoothAlgorithms';
import { TEXTURE_QUALITY, type TextureCodec } from '../../../src/components/maplestreet/vehicle/textureEncode';
import { inspectHdPack, inspectModel } from '../../../src/server/gltf-check';
import { sampleRecord } from './vehicles.test';

const CELL = 0.1, TEXELS = 8, ATLAS = 512;
type Rect = { a0: number; a1: number; b0: number; b1: number };
type Face = { name: string; cols: number; rows: number; ox: number; oy: number; at: (a: number, b: number) => number[]; normal: number[]; flip: boolean; paintAs?: string };

/** A 4 × 1.4 × 1.8 m box body whose windows are only painted into its texture, as a scan's are. */
function paintedBody() {
  const BODY = [178, 26, 26], GLASS = [15, 18, 20], SKY = [84, 102, 122], WHITE = [250, 250, 250];
  const faces: Face[] = [
    { name: 'right', cols: 40, rows: 14, ox: 8, oy: 8, at: (a, b) => [-2 + a, b, 0.9], normal: [0, 0, 1], flip: false },
    { name: 'left', cols: 40, rows: 14, ox: 8, oy: 136, at: (a, b) => [-2 + a, b, -0.9], normal: [0, 0, -1], flip: true },
    { name: 'roof', cols: 40, rows: 18, ox: 8, oy: 264, at: (a, b) => [-2 + a, 1.4, -0.9 + b], normal: [0, 1, 0], flip: true },
    { name: 'front', cols: 18, rows: 14, ox: 336, oy: 8, at: (a, b) => [2, b, -0.9 + a], normal: [1, 0, 0], flip: true },
    { name: 'back', cols: 18, rows: 14, ox: 336, oy: 136, at: (a, b) => [-2, b, -0.9 + a], normal: [-1, 0, 0], flip: false },
    { name: 'inner', cols: 40, rows: 14, ox: 8, oy: 8, at: (a, b) => [-2 + a, b, 0.8], normal: [0, 0, -1], flip: true, paintAs: 'right' },
  ];
  const rgba = new Uint8ClampedArray(ATLAS * ATLAS * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  const fill = (face: Face, r: Rect | null, color: number[]) => {
    const x0 = face.ox + Math.round((r ? r.a0 : 0) / CELL) * TEXELS, x1 = face.ox + (r ? Math.round(r.a1 / CELL) : face.cols) * TEXELS;
    const y0 = face.oy + Math.round((r ? r.b0 : 0) / CELL) * TEXELS, y1 = face.oy + (r ? Math.round(r.b1 / CELL) : face.rows) * TEXELS;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = (y * ATLAS + x) * 4; rgba[p] = color[0]; rgba[p + 1] = color[1]; rgba[p + 2] = color[2]; }
  };
  const windows: Record<string, Rect> = {
    right: { a0: 1.2, a1: 2.9, b0: 0.9, b1: 1.2 }, left: { a0: 1.2, a1: 2.9, b0: 0.9, b1: 1.2 },
    front: { a0: 0.2, a1: 1.6, b0: 0.9, b1: 1.2 }, back: { a0: 0.2, a1: 1.6, b0: 0.9, b1: 1.2 },
  };
  for (const face of faces) if (!face.paintAs) fill(face, null, BODY);
  for (const face of faces) if (windows[face.name]) fill(face, windows[face.name], face.name === 'back' ? SKY : GLASS);
  const byName = (name: string) => faces.find(f => f.name === name)!;
  fill(byName('right'), { a0: 2, a1: 2.1, b0: 1, b1: 1.1 }, WHITE);
  fill(byName('roof'), { a0: 1.5, a1: 2.5, b0: 0.5, b1: 1.3 }, GLASS);
  fill(byName('left'), { a0: 0.5, a1: 2.5, b0: 0.1, b1: 0.5 }, GLASS);
  fill(byName('left'), { a0: 0.2, a1: 0.4, b0: 0.9, b1: 1.1 }, GLASS);

  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const expected: number[] = [];
  for (const face of faces) {
    const base = positions.length / 3;
    for (let j = 0; j <= face.rows; j++) for (let i = 0; i <= face.cols; i++) {
      positions.push(...face.at(i * CELL, j * CELL));
      normals.push(...face.normal);
      uvs.push((face.ox + i * TEXELS) / ATLAS, (face.oy + j * TEXELS) / ATLAS);
    }
    const w = windows[face.name];
    for (let j = 0; j < face.rows; j++) for (let i = 0; i < face.cols; i++) {
      const a = base + j * (face.cols + 1) + i, b = a + 1, c = a + face.cols + 1, d = c + 1;
      if (face.flip) indices.push(a, c, b, b, c, d); else indices.push(a, b, c, b, d, c);
      const inside = !!w && (i + 0.5) * CELL > w.a0 && (i + 0.5) * CELL < w.a1 && (j + 0.5) * CELL > w.b0 && (j + 0.5) * CELL < w.b1;
      expected.push(inside ? 1 : 0, inside ? 1 : 0);
    }
  }
  return { mesh: { positions, normals, uvs, indices, mask: glassMask(rgba, ATLAS, ATLAS) }, expected };
}

test('glass colours: dark and unsaturated, or a grey-blue sky reflection', () => {
  assert.ok(isGlassColor(0.06, 0.07, 0.08));
  assert.ok(isGlassColor(0.33, 0.4, 0.48));
  assert.ok(!isGlassColor(0.05, 0.08, 0.3), 'navy paint is not glass');
  assert.ok(!isGlassColor(0.7, 0.1, 0.1));
  assert.ok(!isGlassColor(0.9, 0.9, 0.9));
});

test('painted-on windows are found, and dark paint elsewhere is left alone', () => {
  const { mesh, expected } = paintedBody();
  const flags = detectWindows(mesh);
  assert.equal(flags.length, expected.length);
  let wrong = 0, found = 0;
  for (let t = 0; t < flags.length; t++) { if (flags[t]) found++; if (flags[t] !== expected[t]) wrong++; }
  const wanted = expected.reduce((n, f) => n + f, 0);
  assert.ok(wanted > 300, `the body has ${wanted} window triangles`);
  assert.ok(wrong <= 4, `${wrong} triangles differ from the painted panes (${found} found, ${wanted} painted)`);
  assert.equal(detectWindows(mesh, { minTriangles: 100000 }).reduce((n, f) => n + f, 0), 0, 'too few triangles counts as no windows');
  assert.equal(detectWindows({ ...mesh, mask: null }).reduce((n, f) => n + f, 0), 0, 'no texture, no windows');
});

/** A floor and a wall meeting in a 90° crease along x, 2.5 cm cells, with millimetre lumps and one 3 cm spike. */
function creasedPanel() {
  const n = 40, step = 1 / n;
  let seed = 12345;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  const positions: number[] = [], indices: number[] = [];
  const ideal: { axis: 1 | 2; crease: boolean }[] = [];
  for (const wall of [false, true]) {
    const base = positions.length / 3;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const edge = j === 0 || i === 0 || i === n || j === n;
      const lump = edge ? 0 : random() * 0.003;
      positions.push(i * step, wall ? j * step : lump, wall ? lump : j * step);
      ideal.push({ axis: wall ? 2 : 1, crease: j === 0 && i > 0 && i < n });
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = base + j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      if (wall) indices.push(a, b, c, b, d, c); else indices.push(a, c, b, b, c, d);
    }
  }
  const spike = 20 * (n + 1) + 20;
  positions[spike * 3 + 1] = 0.03;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  return { geometry, ideal, spike };
}

test('smoothing out bumps flattens lumps, keeps the crease and never moves a point past the cap', () => {
  const { geometry, ideal, spike } = creasedPanel();
  const topo = topology(geometry);
  const base = new Float32Array(topo.clusters.length * 3);
  const pos = geometry.getAttribute('position');
  topo.clusters.forEach((verts, c) => { base[c * 3] = pos.getX(verts[0]); base[c * 3 + 1] = pos.getY(verts[0]); base[c * 3 + 2] = pos.getZ(verts[0]); });
  const cap = BUMP_LEVELS.normal.capMm / 1000;
  const result = smoothCapped(topo, base, BUMP_LEVELS.normal.passes, 40, cap);
  const rough = (p: Float32Array) => {
    let sum = 0, count = 0;
    ideal.forEach((v, i) => { const c = topo.clusterOf[i]; if (v.crease || topo.boundary[c] || i === spike) return; sum += p[c * 3 + v.axis] ** 2; count++; });
    return Math.sqrt(sum / count);
  };
  const before = rough(base), after = rough(result.positions);
  assert.ok(after < before * 0.5, `lumps shrink (${(before * 1000).toFixed(2)} mm → ${(after * 1000).toFixed(2)} mm rms)`);
  let far = 0, creaseMove = 0;
  for (let c = 0; c < topo.clusters.length; c++) far = Math.max(far, Math.hypot(result.positions[c * 3] - base[c * 3], result.positions[c * 3 + 1] - base[c * 3 + 1], result.positions[c * 3 + 2] - base[c * 3 + 2]));
  ideal.forEach((v, i) => { if (!v.crease) return; const c = topo.clusterOf[i]; creaseMove = Math.max(creaseMove, Math.hypot(result.positions[c * 3 + 1], result.positions[c * 3 + 2])); });
  assert.ok(far <= cap + 1e-6, `no point moves more than the cap (${(far * 1000).toFixed(3)} mm of ${cap * 1000} mm)`);
  assert.ok(creaseMove < 0.0006, `the crease stays put (${(creaseMove * 1000).toFixed(3)} mm)`);
  const s = topo.clusterOf[spike];
  assert.ok(result.positions[s * 3 + 1] >= 0.03 - cap - 1e-6, 'a 3 cm feature is not flattened: it moves by the cap at most');
  assert.ok(smoothCapped(topo, base, 12, 40, 0.002).largest <= 0.002 + 1e-9);
});

const HEX: Shape = [{ u: 0.05, v: 0.5 }, { u: 0.3, v: 0.05 }, { u: 0.75, v: 0.05 }, { u: 0.97, v: 0.5 }, { u: 0.75, v: 0.95 }, { u: 0.3, v: 0.95 }];
const curved = Array.from({ length: LAMP_GRID * LAMP_GRID }, (_, i) => -0.04 * ((i % LAMP_GRID) / (LAMP_GRID - 1)) ** 2);

test('3D lamps: four solid pieces with unit normals, lens facing out, on both sides', () => {
  for (const [facing, p] of [[1, { x: 2.3, y: 0.2, z: 0.6 }], [-1, { x: -2.3, y: 0.25, z: 0.62 }]] as const) {
    for (const side of [1, -1] as const) for (const [shape, size, depth] of [[LAMP_BOX, { w: 0.24, h: 0.11 }, undefined], [HEX, { w: 0.34, h: 0.16 }, curved]] as const) {
      const parts = lampParts(p, shape, side, size, depth, facing, DEFAULT_LAMP_STYLE);
      for (const name of ['lens', 'bezel', 'housing', 'glow'] as const) {
        const { positions, normals } = parts[name];
        assert.ok(positions.length > 0 && positions.length % 9 === 0 && positions.length === normals.length, `${name} is a triangle list`);
        assert.ok(positions.every(Number.isFinite));
        for (let i = 0; i < normals.length; i += 3) assert.ok(Math.abs(Math.hypot(normals[i], normals[i + 1], normals[i + 2]) - 1) < 1e-3, `${name} normals are unit length`);
      }
      let nx = 0, z = 0;
      const lens = parts.lens;
      for (let i = 0; i < lens.normals.length; i += 3) { nx += lens.normals[i]; z += lens.positions[i + 2]; }
      const count = lens.normals.length / 3;
      assert.ok((nx / count) * facing > 0.8, `the lens faces ${facing > 0 ? 'forward' : 'backward'} (${(nx / count).toFixed(2)})`);
      assert.ok((z / count) * side > 0, 'the lamp is on its own side');

      const cut = lampCutter(p, shape, side, size, depth, facing, DEFAULT_LAMP_STYLE);
      const surface = depth ? depth[Math.floor(LAMP_GRID / 2) * LAMP_GRID + Math.floor(LAMP_GRID / 2)] : 0;
      assert.ok(cut(p.x + surface - facing * 0.01, p.y, side * p.z), 'the body just behind the middle of the lens is cut');
      assert.ok(!cut(p.x, p.y, side * (p.z + size.w)), 'not beside the lamp');
      assert.ok(!cut(p.x, p.y + size.h, side * p.z), 'not above it');
      assert.ok(!cut(p.x - facing * 0.6, p.y, side * p.z), 'not far behind it');
      assert.ok(!cut(p.x + facing * 0.4, p.y, side * p.z), 'not far in front of it');
      assert.ok(!cut(p.x, p.y, -side * p.z), 'not on the other side');
    }
  }
});

test('lamp plans: flat records stay flat, 3D ones cut the body behind the lens only', () => {
  const flat = sampleRecord();
  assert.equal(lamps3d(flat.lights, flat.lampShapes).length, 0);
  const solid = sampleRecord(undefined, { lampShapes: { headStyle: { ...DEFAULT_LAMP_STYLE }, tailStyle: { ...DEFAULT_LAMP_STYLE, cut: false } } });
  assert.ok(isValidVehicleRecord(solid));
  const lamps = lamps3d(solid.lights, solid.lampShapes);
  assert.equal(lamps.length, 4);
  const cuts = lampCuts(lamps);
  assert.equal(cuts.length, 2, 'only the headlights ask for a cut');
  const head = solid.lights.head[0];
  const positions: number[] = [], centres: number[][] = [];
  for (let j = 0; j < 20; j++) for (let i = 0; i < 40; i++) {
    const z = -1 + i * 0.05, y = -0.1 + j * 0.03;
    positions.push(head.x, y, z, head.x, y, z + 0.05, head.x, y + 0.03, z);
    centres.push([y + 0.01, z + 0.05 / 3]);
  }
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const kept = cutTriangles(positions, null, identity, cuts)!;
  assert.ok(kept && kept.length < positions.length / 3);
  const removed = new Set(centres.keys());
  for (let i = 0; i < kept.length; i += 3) removed.delete(kept[i] / 3);
  assert.ok(removed.size >= 4, `${removed.size} triangles hidden`);
  for (const t of removed) {
    const [y, z] = centres[t];
    assert.ok(Math.abs(y - head.y) <= 0.055 + 1e-9 && Math.abs(Math.abs(z) - head.z) <= 0.12 + 1e-9, 'every hidden triangle is inside a headlight box');
  }
  assert.equal(cutTriangles(positions, null, identity, []), null);
});

test('records accept a missing, null or string hdUrl', () => {
  assert.ok(isValidVehicleRecord(sampleRecord()));
  assert.ok(isValidVehicleRecord(sampleRecord(undefined, { hdUrl: null })));
  assert.ok(isValidVehicleRecord(sampleRecord(undefined, { hdUrl: '/api/maplestreet-vehicles?hd=x&v=2' })));
  assert.ok(!isValidVehicleRecord({ ...sampleRecord(), hdUrl: 5 }));
});

function picture(kind: 'head' | 'tail') {
  const width = 480, height = 320;
  const frame = { view: kind === 'head' ? 'front' as const : 'rear' as const, left: -1.2, right: 1.2, top: 1.5, bottom: -0.1 };
  const data = new Uint8ClampedArray(width * height * 4);
  const px = (x: number) => Math.round(((x - frame.left) / 2.4) * width), py = (y: number) => Math.round(((frame.top - y) / 1.6) * height);
  const paint = (x0: number, x1: number, y0: number, y1: number, c: number[], round = false) => {
    for (let y = py(y1); y < py(y0); y++) for (let x = px(x0); x < px(x1); x++) {
      if (round) { const u = (x - (px(x0) + px(x1)) / 2) / ((px(x1) - px(x0)) / 2), v = (y - (py(y0) + py(y1)) / 2) / ((py(y0) - py(y1)) / 2); if (u * u + v * v > 1) continue; }
      const p = (y * width + x) * 4; data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
    }
  };
  paint(-0.9, 0.9, 0, 1.4, [30, 50, 110]);
  return { image: { data, width, height }, frame, paint };
}

test('the light finder outlines the right-hand headlight and taillight, and admits when there is none', () => {
  const front = picture('head');
  assert.equal(findLampOutline(front.image, front.frame, 'head', null), null, 'a plain body has no lamps');
  front.paint(-0.78, -0.48, 0.6, 0.76, [250, 248, 235], true);
  front.paint(0.48, 0.78, 0.6, 0.76, [250, 248, 235], true);
  front.paint(-0.25, 0.25, 0.3, 0.42, [245, 245, 245]);
  const head = findLampOutline(front.image, front.frame, 'head', { x: -0.6, y: -0.7 })!;
  assert.ok(head && head.length >= 3 && head.length <= 16, `${head?.length} corners`);
  const box = (pts: { x: number; y: number }[]) => ({ x0: Math.min(...pts.map(p => p.x)), x1: Math.max(...pts.map(p => p.x)), y0: Math.min(...pts.map(p => p.y)), y1: Math.max(...pts.map(p => p.y)) });
  const hb = box(head);
  assert.ok(Math.abs(hb.x0 + 0.78) < 0.03 && Math.abs(hb.x1 + 0.48) < 0.03 && Math.abs(hb.y0 + 0.76) < 0.03 && Math.abs(hb.y1 + 0.6) < 0.03, JSON.stringify(hb));

  const tris = new Float32Array([2, -1, -2, 2, -1, 2, 2, 3, -2, 2, 3, -2, 2, -1, 2, 2, 3, 2]);
  const lamp = lampFromOutline(head, true, tris, 0.5, 0)!;
  assert.ok(lamp && Math.abs(lamp.point.x - 2) < 0.01 && Math.abs(lamp.point.z - 0.63) < 0.03 && Math.abs(lamp.point.y - (0.68 - 0.5)) < 0.03, JSON.stringify(lamp.point));
  assert.ok(Math.abs(lamp.size.w - 0.3) < 0.04 && Math.abs(lamp.size.h - 0.16) < 0.04 && lamp.depth?.length === LAMP_GRID * LAMP_GRID);

  const rear = picture('tail');
  rear.paint(0.6, 0.85, 0.7, 0.95, [200, 20, 20]);
  rear.paint(-0.85, -0.6, 0.7, 0.95, [200, 20, 20]);
  const tail = box(findLampOutline(rear.image, rear.frame, 'tail', null)!);
  assert.ok(Math.abs(tail.x0 - 0.6) < 0.03 && Math.abs(tail.x1 - 0.85) < 0.03 && Math.abs(tail.y0 + 0.95) < 0.03 && Math.abs(tail.y1 + 0.7) < 0.03, JSON.stringify(tail));
});

test('publishing keeps a 1K base model and puts full-size textures in an HD pack that goes back on by material name', async t => {
  const need = createRequire(join(process.cwd(), 'package.json'));
  const sharp = need('sharp');
  const out = mkdtempSync(join(tmpdir(), 'vehicle-model-tools-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  await need('esbuild').build({ entryPoints: [join(process.cwd(), 'src/components/maplestreet/vehicle/modelTools.ts')], bundle: true, platform: 'browser', format: 'esm', outfile: join(out, 'modelTools.mjs'), logLevel: 'warning', external: ['node:fs', 'node:path'] });
  const { mergeHdPack, shrinkModel } = (await import(pathToFileURL(join(out, 'modelTools.mjs')).href)) as typeof ModelTools;
  const png = (side: number, background: string): Promise<Uint8Array> => sharp({ create: { width: side, height: side, channels: 3, background } }).png().toBuffer().then((b: Buffer) => new Uint8Array(b));
  const codec: TextureCodec = async (image, _type, kind, maxSide) => {
    const out = await sharp(Buffer.from(image)).resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).webp({ quality: Math.round(TEXTURE_QUALITY[kind] * 100) }).toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(out.data), mimeType: 'image/webp', width: out.info.width, height: out.info.height };
  };
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = new Document();
  const buffer = doc.createBuffer();
  const tex = async (name: string, side: number, color: string) => doc.createTexture(name).setImage(await png(side, color)).setMimeType('image/png');
  const paint = doc.createMaterial('paint').setBaseColorTexture(await tex('color', 4096, '#a02020')).setNormalTexture(await tex('normal', 2048, '#8080ff')).setMetallicRoughnessTexture(await tex('orm', 512, '#40c010'));
  const unnamed = doc.createMaterial('').setBaseColorTexture(await tex('second', 2048, '#2040a0'));
  const trim = doc.createMaterial('trim');
  const scene = doc.createScene();
  [paint, unnamed, trim].forEach((material, i) => {
    const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array([i, 0, 0, i + 1, 0, 0, i, 1, 0, i + 1, 1, 0])).setBuffer(buffer);
    const uv = doc.createAccessor().setType('VEC2').setArray(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1])).setBuffer(buffer);
    const index = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 1, 3, 2])).setBuffer(buffer);
    scene.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', position).setAttribute('TEXCOORD_0', uv).setIndices(index).setMaterial(material))));
  });
  const source = await io.writeBinary(doc);

  const { bytes, hd, report } = await shrinkModel(source, { targetTriangles: 150000, maxTexture: 1024, hdTexture: 4096, webp: true }, codec);
  assert.equal(report.trianglesAfter, 6, 'a model under the triangle limit is not simplified');
  assert.equal(report.textureSide, 1024);
  assert.equal(report.hdTextureSide, 4096);
  assert.ok(hd && report.hdBytes === hd.byteLength);
  assert.equal(inspectModel('vehicle.glb', bytes).type, 'model/gltf-binary');
  assert.equal(inspectHdPack(hd!).type, 'model/gltf-binary');
  assert.throws(() => inspectHdPack(bytes), 'a whole model is not an HD pack');

  const sizes = (d: Document) => Object.fromEntries(d.getRoot().listMaterials().map(m => [m.getName(), [m.getBaseColorTexture(), m.getNormalTexture(), m.getMetallicRoughnessTexture()].map(t => t?.getSize()?.[0] ?? 0)]));
  const base = await io.readBinary(bytes);
  assert.deepEqual(sizes(base), { paint: [1024, 1024, 512], material_2: [1024, 0, 0], trim: [0, 0, 0] });
  assert.ok(base.getRoot().listTextures().every(t => t.getMimeType() === 'image/webp'));
  assert.ok(base.getRoot().listExtensionsRequired().some(e => e.extensionName === 'EXT_texture_webp'));
  assert.ok(base.getRoot().listExtensionsRequired().some(e => e.extensionName === 'EXT_meshopt_compression'));

  const pack = await io.readBinary(hd!);
  assert.deepEqual(sizes(pack), { paint: [4096, 2048, 512], material_2: [2048, 0, 0] }, 'same names, full-size textures, textured materials only');
  assert.ok(pack.getRoot().listExtensionsRequired().every(e => e.extensionName === 'EXT_texture_webp'));
  for (const mesh of pack.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) assert.equal(prim.getAttribute('POSITION')!.getCount(), 3);
  assert.ok(hd!.byteLength < 2 * 1024 * 1024);

  const sharpAgain = await io.readBinary(await mergeHdPack(bytes, hd!));
  assert.deepEqual(sizes(sharpAgain), { paint: [4096, 2048, 512], material_2: [2048, 0, 0], trim: [0, 0, 0] });

  const again = await shrinkModel(await mergeHdPack(bytes, hd!), { targetTriangles: 150000, maxTexture: 1024, hdTexture: 4096, webp: true }, async () => { throw new Error('re-encoded a texture that already fits'); }).catch(e => e as Error);
  assert.ok(again instanceof Error, 'the base textures are still fitted from the full-size ones');

  const small = await shrinkModel(source, { targetTriangles: 150000, maxTexture: 1024, hdTexture: 0, webp: true }, codec);
  assert.equal(small.hd, null);
  assert.equal(small.report.textureSide, 1024);
});
