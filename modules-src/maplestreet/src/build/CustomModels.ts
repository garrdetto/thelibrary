/**
 * Admin-published Buy-mode items (shared/CustomItems.ts). The catalog is
 * fetched from /api/maplestreet-items before the game starts, cached for
 * offline play, and each .glb is loaded once and cloned per placement.
 *
 * Instance layout, identical to the admin editor's preview:
 *   wrapper (yaw quarter turns) > scale {x,y,z} > offset (unscaled bounds
 *   centered on X/Z, bottom on the floor) > cloned glTF scene.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CATALOG, type CatalogItem } from '../../shared/Catalog';
import { isValidRecord, registerCustomItems, type CustomItemRecord } from '../../shared/CustomItems';
import { store } from '../core/Storage';
import { assetListUrl, devDrafts } from '../core/DevMode';

const CACHE_KEY = 'maplestreet/custom-items/v1';
const LIST_TIMEOUT_MS = 5000;
const PRELOAD_WAIT_MS = 8000;

type Loaded = { scene: THREE.Object3D; offset: THREE.Vector3 };

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const models = new Map<string, Promise<Loaded | null>>();
const ready = new Map<string, Loaded | null>();
const pending = new Map<string, Set<THREE.Group>>();
const placeholderMat = new THREE.MeshStandardMaterial({ color: 0xf2b544, roughness: 0.8, transparent: true, opacity: 0.45 });

async function fetchList(): Promise<CustomItemRecord[] | null> {
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIST_TIMEOUT_MS);
  try {
    const res = await fetch(assetListUrl('/api/maplestreet-items'), { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: unknown; drafts?: unknown };
    if (data.drafts === true) devDrafts.allowed = true;
    const list = Array.isArray(data.items) ? data.items.filter(isValidRecord) : null;
    devDrafts.items = list?.filter(r => r.status === 'draft').length ?? 0;
    for (const r of list ?? []) if (r.status === 'draft') devDrafts.ids.add(r.id);
    return list;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Registers the published items (or the last cached list when offline) and preloads their models. */
export async function loadCustomCatalog(): Promise<void> {
  const fresh = await fetchList();
  if (fresh) store.set(CACHE_KEY, JSON.stringify(fresh.filter(r => r.status !== 'draft')));
  const list = fresh ?? (store.json<unknown[]>(CACHE_KEY) ?? []).filter(isValidRecord);
  const items = registerCustomItems(list);
  const loads = items.filter(i => !i.hidden).map(i => loadModel(i));
  if (!loads.length) return;
  await Promise.race([Promise.allSettled(loads), new Promise(r => setTimeout(r, PRELOAD_WAIT_MS))]);
}

function loadModel(item: CatalogItem): Promise<Loaded | null> {
  const url = item.custom!.url;
  let p = models.get(url);
  if (!p) {
    p = loader.loadAsync(url).then(gltf => {
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      if (box.isEmpty()) return null;
      const center = box.getCenter(new THREE.Vector3());
      return { scene, offset: new THREE.Vector3(-center.x, -box.min.y, -center.z) };
    }).catch(e => { console.warn('[maplestreet] custom model failed:', item.name, e); return null; });
    models.set(url, p);
    void p.then(loaded => {
      ready.set(url, loaded);
      const groups = pending.get(url);
      pending.delete(url);
      if (groups) for (const g of groups) fill(g, item, loaded);
    });
  }
  return p;
}

/** Resolves once the item's model has loaded or failed (thumbnails wait on it). */
export function whenCustomModelReady(catalogId: string): Promise<unknown> {
  const item = CATALOG[catalogId];
  return item?.custom ? loadModel(item) : Promise.resolve();
}

function instance(loaded: Loaded, item: CatalogItem): THREE.Object3D {
  const { scale } = item.custom!;
  const scaled = new THREE.Group();
  scaled.scale.set(scale.x, scale.y, scale.z);
  const offset = new THREE.Group();
  offset.position.copy(loaded.offset);
  const clone = cloneSkinned(loaded.scene);
  clone.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry = mesh.geometry.clone();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  offset.add(clone);
  scaled.add(offset);
  return scaled;
}

function placeholder(item: CatalogItem): THREE.Object3D {
  const h = Math.max(0.2, item.h || 0.5);
  const turned = item.custom!.yaw % 2 === 1;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry((turned ? item.d : item.w) * 0.9, h, (turned ? item.w : item.d) * 0.9), placeholderMat);
  mesh.position.y = h / 2;
  mesh.userData.customPlaceholder = true;
  return mesh;
}

function fill(g: THREE.Group, item: CatalogItem, loaded: Loaded | null) {
  for (const child of [...g.children]) {
    if (!child.userData.customPlaceholder) continue;
    g.remove(child);
    (child as THREE.Mesh).geometry?.dispose();
  }
  g.add(loaded ? instance(loaded, item) : placeholder(item));
  (g.userData.onCustomFill as ((group: THREE.Group) => void) | undefined)?.(g);
}

/** A placed custom item. Fills in asynchronously if its model is still loading. */
export function buildCustomModel(item: CatalogItem): THREE.Group {
  const g = new THREE.Group();
  g.rotation.y = item.custom!.yaw * (Math.PI / 2);
  const wrapper = new THREE.Group();
  wrapper.add(g);
  wrapper.userData.catalogId = item.id;
  const url = item.custom!.url;
  if (ready.has(url)) {
    const loaded = ready.get(url)!;
    g.add(loaded ? instance(loaded, item) : placeholder(item));
    return wrapper;
  }
  g.add(placeholder(item));
  if (!pending.has(url)) pending.set(url, new Set());
  pending.get(url)!.add(g);
  g.userData.onCustomFill = () => (wrapper.userData.onCustomFill as ((group: THREE.Group) => void) | undefined)?.(wrapper);
  void loadModel(item);
  return wrapper;
}
