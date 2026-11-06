// Admin-made car bodies from /api/shorttrack-cars. Each one is placed in the stock car's frame and
// drives on the stock car's physics; this file only loads, prepares and dresses the model.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { recolorPixels } from '../maplestreet/shared/PaintMask';
import { STOCK_CAR, carIdOf, carVehicleKey } from './shared/CustomCars';
import { numberAnchors, numberPlanes, placementMatrix } from './shared/carSurface';

export const CUSTOM_CARS = new Map();
const assets = new Map();
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** Lists published cars (and, for the administrator, drafts). Never throws: no list means no custom cars. */
export async function loadCustomCars() {
  try {
    const r = await fetch('/api/shorttrack-cars?drafts=1', { credentials: 'same-origin' });
    if (!r.ok) return [];
    const { cars } = await r.json();
    CUSTOM_CARS.clear();
    for (const c of cars || []) CUSTOM_CARS.set(c.id, c);
    return [...CUSTOM_CARS.values()];
  } catch { return []; }
}

export const customCarEntries = () => [...CUSTOM_CARS.values()].filter(c => c.active).map(c => [carVehicleKey(c.id), { name: c.name, desc: c.blurb || 'A custom body', draft: c.status === 'draft' }]);

/** The prepared car for a `custom:<id>` vehicle if it has finished loading. */
export function customCarReady(veh) {
  const id = carIdOf(veh || '');
  const a = id && assets.get(id);
  return a && !(a instanceof Promise) ? a : null;
}

/** Loads and prepares a custom car; resolves to null if it doesn't exist or can't load. */
export function ensureCustomCar(veh) {
  const id = carIdOf(veh || ''), rec = id && CUSTOM_CARS.get(id);
  if (!rec) return Promise.resolve(null);
  const have = assets.get(id);
  if (have) return have instanceof Promise ? have : Promise.resolve(have);
  const p = loader.loadAsync(rec.modelUrl).then(gltf => { const a = prepare(rec, gltf.scene); assets.set(id, a); return a; })
    .catch(() => { assets.delete(id); return null; });
  assets.set(id, p);
  return p;
}

function floatAttr(attr) {
  const n = attr.count, k = attr.itemSize, out = new Float32Array(n * k);
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) out[i * k + j] = attr.getComponent(i, j);
  return new THREE.BufferAttribute(out, k);
}

// Bakes every mesh into the car frame, keeps position/normal/uv/color only and merges per material.
function prepare(rec, scene) {
  scene.updateMatrixWorld(true);
  const place = placementMatrix(rec.model), byMat = new Map();
  scene.traverse(o => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const src = o.geometry, g = new THREE.BufferGeometry(), n = src.attributes.position.count;
    g.setAttribute('position', floatAttr(src.attributes.position));
    if (src.attributes.normal) g.setAttribute('normal', floatAttr(src.attributes.normal));
    g.setAttribute('uv', src.attributes.uv ? floatAttr(src.attributes.uv) : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const c = new Float32Array(n * 3);
    if (src.attributes.color) { const sc = src.attributes.color; for (let i = 0; i < n; i++) { c[i * 3] = sc.getX(i); c[i * 3 + 1] = sc.getY(i); c[i * 3 + 2] = sc.getZ(i); } } else c.fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setIndex(src.index ? Array.from(src.index.array) : [...Array(n).keys()]);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(place, o.matrixWorld));
    if (!g.attributes.normal) g.computeVertexNormals();
    const list = byMat.get(o.material) || []; list.push(g); byMat.set(o.material, list);
  });
  const parts = [];
  for (const [mat, list] of byMat) {
    const geo = list.length > 1 ? mergeGeometries(list) : list[0];
    if (!geo) continue;
    geo.computeBoundingSphere();
    if (mat.map) mat.map.userData.shared = true;
    parts.push({ geo, mat });
  }
  if (!parts.length) throw new Error('empty car model');
  const probe = new THREE.Group();
  for (const p of parts) probe.add(new THREE.Mesh(p.geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
  const anchors = numberAnchors(probe, rec.numbers);
  return { rec, parts, anchors, masks: new Map() };
}

function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

function maskedMap(a, map, color) {
  const key = `${map.uuid}|${color}`;
  if (a.masks.has(key)) return a.masks.get(key);
  const img = map.image;
  if (!img || !img.width) return null;
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, cv.width, cv.height);
  recolorPixels(px.data, a.rec.paint.key, a.rec.paint.tolerance, hexRgb(color)); g.putImageData(px, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = map.colorSpace; t.flipY = map.flipY; t.wrapS = map.wrapS; t.wrapT = map.wrapT; t.anisotropy = 8; t.userData.shared = true;
  a.masks.set(key, t);
  return t;
}

function paintFor(a, src, primary) {
  const m = src.clone(), p = a.rec.paint;
  m.vertexColors = true;
  if (p.mode === 'material' && src.name === p.material) m.color.set(primary);
  if (p.mode === 'color' && src.map) { const t = maskedMap(a, src.map, primary); if (t) m.map = t; }
  return m;
}

// Wheels from the stock car (scaled to the custom radius and width), or plain tyres if it hasn't loaded.
function addWheels(g, a, carAsset) {
  const tire = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.92 });
  const rim = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.8 });
  const mats = [tire, tire, tire, tire, rim, tire], wheels = [];
  const stock = carAsset ? carAsset.filter(p => p.center) : [];
  a.rec.axles.forEach((ax, i) => {
    for (const side of [1, -1]) {
      const front = i === 0, pivot = new THREE.Group();
      pivot.position.set(ax.x, ax.radius, side * ax.halfTrack); g.add(pivot);
      const base = stock.find(p => (p.center[0] > 0) === front && Math.sign(p.center[2]) === side);
      let w;
      if (base) {
        const ref = STOCK_CAR.axles[i];
        w = new THREE.Mesh(base.geo.clone(), mats);
        w.scale.set(ax.radius / ref.radius, ax.radius / ref.radius, ax.width / ref.width);
      } else {
        w = new THREE.Group();
        const t = new THREE.Mesh(new THREE.CylinderGeometry(ax.radius, ax.radius, ax.width, 28).rotateX(Math.PI / 2), tire);
        const r = new THREE.Mesh(new THREE.CylinderGeometry(ax.radius * 0.62, ax.radius * 0.62, ax.width * 1.02, 20).rotateX(Math.PI / 2), rim);
        w.add(t, r);
      }
      w.traverse(o => { if (o.isMesh) o.castShadow = true; });
      pivot.add(w);
      wheels.push({ pivot, w, front, spinZ: true });
    }
  });
  return wheels;
}

/**
 * Builds the car the same shape as `buildStockCar` returns, so racing, damage and lights treat it the same.
 * `ctx`: { modelScale, carAsset, crisp, envTex, envK }.
 */
export function buildCustomCar(a, lv, ctx) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const g = new THREE.Group(); g.rotation.y = -Math.PI / 2; g.scale.setScalar(ctx.modelScale); body.add(g);
  const paints = [], deform = [];
  let bodyMesh = null;
  for (const p of a.parts) {
    const mat = paintFor(a, p.mat, lv.primary);
    const mesh = new THREE.Mesh(p.geo.clone(), mat); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
    bodyMesh = bodyMesh || mesh;
    deform.push({ geo: mesh.geometry, orig: Float32Array.from(mesh.geometry.attributes.position.array), scuff: true });
    if (mat.isMeshStandardMaterial) { mat.envMap = ctx.envTex; mat.envMapIntensity = ctx.envK; paints.push(mat); }
  }
  const wheels = addWheels(g, a, ctx.carAsset);
  const brakeMat = new THREE.MeshPhysicalMaterial({ color: 0x5a0008, emissive: 0xff1a26, emissiveIntensity: 0.2, roughness: 0.1, clearcoat: 1 });
  const tl = a.rec.lights.tail;
  if (tl) for (const side of [1, -1]) { const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.24), brakeMat); lamp.position.set(tl.x, tl.y, tl.z * side); g.add(lamp); }
  const bumperF = new THREE.Group(), bumperR = new THREE.Group(); body.add(bumperF, bumperR);
  return { root, body, bodyMesh, orig: deform[0]?.orig, deform, wheels, bumperF, bumperR, paints, light: null, brakeMat, tm: true, tmg: g, car: true, custom: a, modelScale: ctx.modelScale, crisp: !!ctx.crisp, numbers: null };
}

/**
 * Replaces the car's race numbers. `art(canvas)` draws the number and returns its art or null;
 * `size(spot, art)` gives [w, h] in metres; `material(canvas)` makes the decal material.
 */
export function mountCustomNumbers(m, lv, { art, size, material, spot, fontOk }) {
  const N = m.numbers;
  if (N) {
    for (const d of N.meshes) { m.tmg.remove(d); d.geometry.dispose(); }
    N.mat.map.dispose(); N.mat.dispose();
    m.deform = m.deform.filter(p => !N.meshes.some(d => d.geometry === p.geo)); m.paints = m.paints.filter(p => p !== N.mat); m.numbers = null;
  }
  if (lv.pace || !lv.number) return;
  const cv = document.createElement('canvas'), drawn = art(cv);
  if (!drawn) return;
  const mat = material(cv), meshes = [], on = { door: lv.numDoors, roof: lv.numRoof, tail: lv.numTail }, nums = m.custom.rec.numbers;
  for (const p of numberPlanes(m.custom.anchors)) {
    if (!on[p.spot] || !nums[p.spot]) continue;
    const [w, h] = size(spot(nums[p.spot].h), drawn);
    const geo = new THREE.PlaneGeometry(w, h).applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rotation)), new THREE.Vector3(1, 1, 1)));
    const d = new THREE.Mesh(geo, mat); d.receiveShadow = true; m.tmg.add(d); meshes.push(d);
    m.deform.push({ geo, orig: Float32Array.from(geo.attributes.position.array) });
  }
  m.paints.push(mat);
  m.numbers = { meshes, mat, art: drawn, fontOk };
}
