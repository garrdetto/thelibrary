// Admin-made car bodies from /api/shorttrack-cars. Each one is placed in the stock car's frame and
// drives on the stock car's physics; this file only loads, prepares and dresses the model.
// Every custom car wears the driver's full Garage livery (shared/carRepaint.ts): the main colour
// always, plus paint schemes, sponsor logos and numbers unless the admin turned them off.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STOCK_CAR, carIdOf, carVehicleKey, carGarage, paintMode } from './shared/CustomCars';
import { bakeLivery, boundsOf, liveryUvs, meshArea, paintWeight, tintPixels } from './shared/carRepaint';
import { clearGroups, clearMask, clearPixels, cutClear } from './shared/carClear';
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

export const customCarEntries = () => [...CUSTOM_CARS.values()].filter(c => c.active).map(c => [carVehicleKey(c.id), { name: c.name, desc: c.blurb || 'A custom body', draft: c.status === 'draft', garage: carGarage(c) }]);

/** The Garage options for a vehicle key: everything for the truck and stock car, the admin's choice for custom cars. */
export function vehicleGarage(veh) {
  const id = carIdOf(veh || ''), rec = id && CUSTOM_CARS.get(id);
  return rec ? carGarage(rec) : carGarage({});
}

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
  markPaintTargets(rec, parts);
  const bounds = boundsOf(parts.map(p => p.geo.attributes.position.array));
  for (const p of parts) if (p.paint === 'texture') markClear(p, bounds);
  const probe = new THREE.Group();
  for (const p of parts) probe.add(new THREE.Mesh(p.geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
  const anchors = numberAnchors(probe, rec.numbers);
  return { rec, parts, anchors, bounds };
}

// Windows and the rear spoiler of a textured body stay clear: their texels are cut out of the painted
// body and drawn again, tinted and see-through, by a second material over the same triangles
// (body-only triangles, then shared ones, then clear-only ones, as two overlapping groups).
function markClear(part, bounds) {
  const map = part.mat.map, img = map && map.image;
  if (!img || !img.width) return;
  const { cv, g, px } = pixelsOf(img), geo = part.geo;
  const m = clearMask({ texture: px, positions: geo.attributes.position.array, uvs: geo.attributes.uv.array, index: geo.index ? geo.index.array : null, bounds, flipY: map.flipY });
  if (!m) return;
  const order = clearGroups(geo.index ? geo.index.array : null, m.triangles);
  geo.setIndex(new THREE.BufferAttribute(order.index, 1));
  geo.clearGroups();
  geo.addGroup(order.body.start, order.body.count, 0);
  geo.addGroup(order.clear.start, order.clear.count, 1);
  const look = new ImageData(clearPixels(m, cv.width, cv.height), cv.width, cv.height);
  g.putImageData(look, 0, 0);
  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = map.flipY; texture.wrapS = map.wrapS; texture.wrapT = map.wrapT; texture.anisotropy = 8;
  texture.userData.shared = true;
  part.clear = { mask: m, texture };
}

function clearMaterial(part) {
  return new THREE.MeshPhysicalMaterial({ map: part.clear.texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 });
}

const seeThrough = m => (m.transparent && m.opacity < 0.9) || (m.transmission ?? 0) > 0.2;
function colorNear(c, key, tolerance) {
  const k = new THREE.Color(key), d = Math.hypot(c.r - k.r, c.g - k.g, c.b - k.b) / Math.sqrt(3);
  return d <= tolerance;
}

// Which parts take the livery. Textured parts are baked in their own UVs; untextured ones are made
// non-indexed so each triangle can take its own livery-atlas UVs.
function markPaintTargets(rec, parts) {
  const p = rec.paint, mode = paintMode(p);
  for (const part of parts) part.area = meshArea(part.geo.attributes.position.array, part.geo.index ? part.geo.index.array : null);
  let plain = [];
  if (mode === 'body') {
    for (const part of parts) if (part.mat.map && !seeThrough(part.mat)) part.paint = 'texture';
    // Untextured bodies: the biggest opaque material and any of the same colour (glass, chrome and trim keep theirs).
    const solid = parts.filter(q => !q.mat.map && !seeThrough(q.mat) && q.mat.color).sort((a, b) => b.area - a.area);
    if (solid[0]) { const c = '#' + solid[0].mat.color.getHexString(); plain = solid.filter(q => colorNear(q.mat.color, c, 0.12)); }
  } else if (mode === 'material') {
    for (const part of parts) if (part.mat.name === p.material) { if (part.mat.map) part.paint = 'texture'; else plain.push(part); }
  } else if (mode === 'color') {
    for (const part of parts) {
      if (part.mat.map) { part.paint = 'texture'; part.weight = paintWeight(p.key, p.tolerance); }
      else if (part.mat.color && colorNear(part.mat.color, p.key, p.tolerance)) plain.push(part);
    }
  }
  for (const part of plain) {
    part.paint = 'plain';
    if (part.geo.index) { const g = part.geo.toNonIndexed(); g.computeBoundingSphere(); part.geo.dispose(); part.geo = g; }
  }
}

function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

function pixelsOf(img) {
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  return { cv, g, px: g.getImageData(0, 0, cv.width, cv.height) };
}

// The part's own texture with the livery baked into it (owned by this car, disposed with it).
function bakedMap(a, part, primary, livery) {
  const map = part.mat.map, img = map.image;
  if (!img || !img.width) return null;
  const { cv, g, px } = pixelsOf(img), weight = part.weight || paintWeight(null, 0), rgb = hexRgb(primary);
  if (livery) {
    const L = livery.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, livery.canvas.width, livery.canvas.height);
    const geo = part.geo;
    bakeLivery({ texture: px, livery: livery.base || L, decals: livery.base ? livery.decals : null, geo: a.geo || null, regions: livery.regions, bounds: a.bounds, flipY: map.flipY, weight, fallback: rgb,
      parts: [{ positions: geo.attributes.position.array, normals: geo.attributes.normal ? geo.attributes.normal.array : null, uvs: geo.attributes.uv.array, index: geo.index ? geo.index.array : null }] });
  } else tintPixels(px.data, rgb, weight);
  if (part.clear) cutClear(px.data, part.clear.mask);
  g.putImageData(px, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = map.colorSpace; t.flipY = map.flipY; t.wrapS = map.wrapS; t.wrapT = map.wrapT; t.anisotropy = 8;
  return t;
}

function paintFor(a, part, lv, livery) {
  const src = part.mat, m = src.clone();
  m.vertexColors = true;
  if (part.paint === 'texture') {
    const t = bakedMap(a, part, lv.primary, livery);
    if (t) { m.map = t; m.color.set(0xffffff); if (part.clear) { m.alphaTest = 0.5; m.transparent = false; } }
  }
  else if (part.paint === 'plain') {
    if (livery) {
      if (!part.liveryUv) part.liveryUv = new THREE.BufferAttribute(liveryUvs(part.geo.attributes.position.array, livery.regions, a.bounds), 2);
      if (!livery.texture) { livery.texture = new THREE.CanvasTexture(plainAtlas(a, livery)); livery.texture.colorSpace = THREE.SRGBColorSpace; livery.texture.flipY = false; livery.texture.anisotropy = 8; }
      m.map = livery.texture; m.color.set(0xffffff);
    } else m.color.set(lv.primary);
  }
  return m;
}

// Untextured parts share one copy of the livery atlas per car, repainted along their seams from 3D like the
// stock car (shared/liveryWrap.ts) so the art meets cleanly and logos cross from one face to the next whole.
function plainAtlas(a, livery) {
  const src = livery.canvas;
  if (!livery.base || !livery.decals) return src;
  const plain = a.parts.filter(p => p.paint === 'plain');
  for (const p of plain) if (!p.liveryUv) p.liveryUv = new THREE.BufferAttribute(liveryUvs(p.geo.attributes.position.array, livery.regions, a.bounds), 2);
  if (!plain.length) return src;
  const W = src.width, H = src.height;
  if (!a.plainPlan || a.plainPlan.width !== W) {
    a.plainPlan = planAtlas(plain.map(p => {
      const f = toLiveryFrame(p.geo.attributes.position.array, p.geo.attributes.normal ? p.geo.attributes.normal.array : null, a.bounds);
      return { positions: f.positions, normals: f.normals, uvs: p.liveryUv.array, index: null };
    }), livery.regions, a.geo || null, STOCK_BOUNDS, W, H);
  }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, W, H);
  applyAtlas(a.plainPlan, img, wrapContext({ regions: livery.regions, base: livery.base, decals: livery.decals, geo: a.geo || null, bounds: STOCK_BOUNDS }));
  g.putImageData(img, 0, 0);
  return cv;
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
 * `ctx`: { modelScale, carAsset, crisp, envTex, envK, livery }. `livery(lv)` returns the Garage livery drawn
 * in the stock car's atlas as `{ canvas, regions }`, or null if the stock car's layout isn't loaded.
 */
export function buildCustomCar(a, lv, ctx) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const g = new THREE.Group(); g.rotation.y = -Math.PI / 2; g.scale.setScalar(ctx.modelScale); body.add(g);
  const paints = [], deform = [];
  const livery = a.parts.some(p => p.paint) && ctx.livery ? ctx.livery(lv) : null;
  let bodyMesh = null;
  const painted = [];
  for (const p of a.parts) {
    const mat = paintFor(a, p, lv, livery);
    const geo = p.geo.clone();
    if (p.paint === 'plain' && p.liveryUv && mat.map) geo.setAttribute('uv', p.liveryUv.clone());
    const clear = p.clear && mat.alphaTest > 0 ? clearMaterial(p) : null;
    const mesh = new THREE.Mesh(geo, clear ? [mat, clear] : mat); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
    if (p.paint) painted.push({ part: p, mat });
    bodyMesh = bodyMesh || mesh;
    deform.push({ geo: mesh.geometry, orig: Float32Array.from(mesh.geometry.attributes.position.array), scuff: true });
    for (const s of clear ? [mat, clear] : [mat]) if (s.isMeshStandardMaterial) { s.envMap = ctx.envTex; s.envMapIntensity = ctx.envK; paints.push(s); }
  }
  const wheels = addWheels(g, a, ctx.carAsset);
  const brakeMat = new THREE.MeshPhysicalMaterial({ color: 0x5a0008, emissive: 0xff1a26, emissiveIntensity: 0.2, roughness: 0.1, clearcoat: 1 });
  const tl = a.rec.lights.tail;
  if (tl) for (const side of [1, -1]) { const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.24), brakeMat); lamp.position.set(tl.x, tl.y, tl.z * side); g.add(lamp); }
  const bumperF = new THREE.Group(), bumperR = new THREE.Group(); body.add(bumperF, bumperR);
  return { root, body, bodyMesh, orig: deform[0]?.orig, deform, wheels, bumperF, bumperR, paints, light: null, brakeMat, tm: true, tmg: g, car: true, custom: a, painted, liveryOn: !!livery, modelScale: ctx.modelScale, crisp: !!ctx.crisp, numbers: null };
}

/** Repaints a built custom car in place with a new livery (painted-on numbers changed, or their font arrived). */
export function repaintCustomCar(m, lv, livery) {
  if (!livery) return;
  for (const { part, mat } of m.painted) {
    if (part.paint !== 'texture' && part.paint !== 'plain') continue;
    const fresh = paintFor(m.custom, part, lv, livery), old = mat.map;
    mat.map = fresh.map; fresh.dispose(); mat.needsUpdate = true;
    if (old && old !== mat.map && !old.userData.shared) old.dispose();
  }
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
