/**
 * Admin-published vehicles in the page (shared/CustomVehicles.ts). Before any
 * mode starts, the list is fetched from /api/maplestreet-vehicles (cached for
 * offline solo play), registered with the shared rules, and turned into
 * PRESETS entries whose body is the published .glb placed in the chassis
 * frame, with the game's own wheels, lamps and paint.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { customVehicleKind, isValidVehicleRecord, registerCustomVehicles, tuningFromRecord, type CustomVehicleRecord } from '../../shared/CustomVehicles';
import { recolorPixels } from '../../shared/PaintMask';
import { store } from '../core/Storage';
import { assetListUrl, devDrafts } from '../core/DevMode';
import { buildWheel, PRESETS, type VehicleLights } from './VehiclePresets';

const CACHE_KEY = 'maplestreet/custom-vehicles/v1';
const LIST_TIMEOUT_MS = 5000;
const PRELOAD_WAIT_MS = 10000;

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const scenes = new Map<string, Promise<THREE.Object3D | null>>();
const ready = new Map<string, THREE.Object3D | null>();
const placeholderMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.7, transparent: true, opacity: 0.5 });

async function fetchList(): Promise<CustomVehicleRecord[] | null> {
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIST_TIMEOUT_MS);
  try {
    const res = await fetch(assetListUrl('/api/maplestreet-vehicles'), { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { vehicles?: unknown; drafts?: unknown };
    if (data.drafts === true) devDrafts.allowed = true;
    const list = Array.isArray(data.vehicles) ? data.vehicles.filter(isValidVehicleRecord) : null;
    devDrafts.vehicles = list?.filter(r => r.status === 'draft').length ?? 0;
    for (const r of list ?? []) if (r.status === 'draft') devDrafts.ids.add(r.id);
    return list;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function loadScene(url: string): Promise<THREE.Object3D | null> {
  let p = scenes.get(url);
  if (!p) {
    p = loader.loadAsync(url).then(g => g.scene).catch(e => { console.warn('[maplestreet] vehicle model failed:', url, e); return null; });
    scenes.set(url, p);
    void p.then(s => ready.set(url, s));
  }
  return p;
}

/** Registers published vehicles (or the cached list when offline) and preloads their models. */
export async function loadCustomVehicles(): Promise<void> {
  const fresh = await fetchList();
  if (fresh) store.set(CACHE_KEY, JSON.stringify(fresh.filter(r => r.status !== 'draft')));
  const list = fresh ?? (store.json<unknown[]>(CACHE_KEY) ?? []).filter(isValidVehicleRecord);
  await installVehicles(list);
}

/** Registers records with the rules and the renderer; resolves when their models load (or after a timeout). */
export async function installVehicles(list: CustomVehicleRecord[]): Promise<void> {
  const records = registerCustomVehicles(list);
  for (const r of records) installPreset(r);
  const loads = records.flatMap(r => [loadScene(r.modelUrl), ...(r.wheelUrl ? [loadScene(r.wheelUrl)] : [])]);
  if (!loads.length) return;
  await Promise.race([Promise.allSettled(loads), new Promise(r => setTimeout(r, PRELOAD_WAIT_MS))]);
}

function installPreset(r: CustomVehicleRecord) {
  const kind = customVehicleKind(r.id);
  PRESETS[kind] = {
    ...tuningFromRecord(r),
    build: (paint, lights) => buildBody(r, paint, lights),
    ...(r.wheelUrl ? { wheel: (radius: number, width: number) => buildCustomWheel(r.wheelUrl!, radius, width) } : {}),
  };
}

function buildBody(r: CustomVehicleRecord, paint: THREE.Material, lights: VehicleLights): THREE.Group {
  const g = new THREE.Group();
  const holder = new THREE.Group();
  holder.position.set(r.model.x, r.model.y, r.model.z);
  holder.rotation.y = THREE.MathUtils.degToRad(r.model.yaw);
  holder.scale.setScalar(r.model.scale);
  g.add(holder);
  const fill = (scene: THREE.Object3D | null) => {
    holder.clear();
    if (!scene) { holder.add(placeholder(r)); return; }
    const copy = cloneSkinned(scene);
    applyPaint(copy, r, paint);
    copy.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    holder.add(copy);
    (g.userData.onFill as (() => void) | undefined)?.();
  };
  if (ready.has(r.modelUrl)) fill(ready.get(r.modelUrl)!);
  else { holder.add(placeholder(r)); void loadScene(r.modelUrl).then(fill); }
  addLamps(g, r.lights.head, lights.head, 0.05, 0.11, 0.24);
  addLamps(g, r.lights.tail, lights.tail, 0.05, 0.12, 0.2);
  return g;
}

function placeholder(r: CustomVehicleRecord) {
  const c = r.physics.chassis, s = 1 / r.model.scale;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(c.hx * 2 * s, c.hy * 2.4 * s, c.hz * 2 * s), placeholderMat);
  mesh.position.set(-r.model.x * s, (-r.model.y + c.hy * 0.6) * s, -r.model.z * s);
  return mesh;
}

function addLamps(g: THREE.Group, points: { x: number; y: number; z: number }[], mat: THREE.Material, sx: number, sy: number, sz: number) {
  for (const p of points) for (const side of p.z === 0 ? [1] : [1, -1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(p.x, p.y, p.z * side);
    g.add(m);
  }
}

const paintCache = new Map<string, THREE.Texture>();

/** Applies the vehicle color to the published paint region (a material, or texels near a key color). */
function applyPaint(root: THREE.Object3D, r: CustomVehicleRecord, paint: THREE.Material) {
  if (r.paint.mode === 'none') return;
  const color = (paint as THREE.MeshStandardMaterial).color ?? new THREE.Color(r.paint.color);
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map(m => {
      const src = m as THREE.MeshStandardMaterial;
      if (r.paint.mode === 'material') {
        if (src.name !== r.paint.material) return src;
        if (!src.map) return paint;
        const c = src.clone(); c.color = color.clone(); return c;
      }
      if (!src.map?.image) return src;
      const tex = maskedTexture(src.map, r.paint.key, r.paint.tolerance, color);
      if (!tex) return src;
      const c = src.clone(); c.map = tex; return c;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
}

/**
 * Recolors every texel within `tolerance` (0–1, RGB distance) of the key
 * color, keeping its shading: new = paint × (texel luminance ÷ key luminance).
 */
export function maskedTexture(map: THREE.Texture, key: string, tolerance: number, paint: THREE.Color): THREE.Texture | null {
  const id = `${map.uuid}|${key}|${tolerance}|${paint.getHexString()}`;
  const hit = paintCache.get(id);
  if (hit) return hit;
  const img = map.image as CanvasImageSource & { width: number; height: number };
  if (!img?.width || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const hex = paint.getHex();
  recolorPixels(data.data, key, tolerance, [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]);
  ctx.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = map.colorSpace; tex.flipY = map.flipY; tex.wrapS = map.wrapS; tex.wrapT = map.wrapT; tex.channel = map.channel;
  paintCache.set(id, tex);
  return tex;
}

/** A published wheel model scaled to the axle's diameter and width, axle along +Z. */
function buildCustomWheel(url: string, radius: number, width: number): THREE.Group {
  const g = new THREE.Group();
  const fill = (scene: THREE.Object3D | null) => {
    g.clear();
    if (!scene) { g.add(buildWheel(radius, width)); return; }
    const copy = cloneSkinned(scene);
    const box = new THREE.Box3().setFromObject(copy), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const axle = size.x <= size.y && size.x <= size.z ? 'x' : size.y <= size.z ? 'y' : 'z';
    const inner = new THREE.Group();
    copy.position.sub(center);
    inner.add(copy);
    if (axle === 'x') inner.rotation.y = Math.PI / 2;
    if (axle === 'y') inner.rotation.x = Math.PI / 2;
    const dia = axle === 'x' ? Math.max(size.y, size.z) : axle === 'y' ? Math.max(size.x, size.z) : Math.max(size.x, size.y);
    const thick = size[axle];
    const across = (radius * 2) / Math.max(1e-3, dia);
    inner.scale.set(across, across, across);
    inner.scale[axle] = width / Math.max(1e-3, thick);
    const wrap = new THREE.Group();
    wrap.add(inner);
    wrap.traverse(o => { o.castShadow = true; });
    g.add(wrap);
  };
  if (ready.has(url)) fill(ready.get(url)!);
  else { g.add(buildWheel(radius, width)); void loadScene(url).then(fill); }
  return g;
}
