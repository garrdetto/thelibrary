// Merges rigid meshes under a root into one mesh per material, so the track scenery and each race truck's shell cost
// one draw call per material instead of one per piece (and the same again in the shadow pass). Only meshes that can
// merge without any visible change are touched: same material, shadow flags, render order, culling, layers and vertex
// layout, with their transform relative to the root baked in. Instanced meshes, sprites, lines, skinned or morphing
// meshes, multi-material meshes (a single material ignores geometry groups, so those merge) and anything under `exclude` (moving or deforming parts) are left alone. Run it before
// the root is first rendered, so no GPU buffers exist for the replaced geometries.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _inverse = new THREE.Matrix4();
const _local = new THREE.Matrix4();

function layoutKey(geometry) {
  const parts = [];
  for (const name of Object.keys(geometry.attributes).sort()) {
    const a = geometry.attributes[name];
    if (a.isInterleavedBufferAttribute) return null;
    parts.push(`${name}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.array.constructor.name}`);
  }
  return `${parts.join(',')}|${geometry.index ? 'i' : 'n'}`;
}

function mergeable(mesh) {
  if (!mesh.isMesh || mesh.isInstancedMesh || mesh.isSkinnedMesh || mesh.isBatchedMesh || mesh.children.length) return false;
  if (Array.isArray(mesh.material) || !mesh.material) return false;
  const g = mesh.geometry;
  if (!g?.attributes?.position || Object.keys(g.morphAttributes).length) return false;
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
  return mesh.onBeforeRender === THREE.Object3D.prototype.onBeforeRender;
}

function flipWinding(geometry) {
  const index = geometry.index;
  if (!index) return false;
  const a = index.array;
  for (let i = 0; i + 2 < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
  return true;
}

function visibleUnder(object, root) {
  for (let o = object; o && o !== root; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Merges rigid meshes under `root` (in root space); returns { before, after } mesh counts. */
export function batchStatic(root, exclude = []) {
  root.updateMatrixWorld(true);
  _inverse.copy(root.matrixWorld).invert();
  const skip = new Set();
  for (const part of exclude) part?.traverse((o) => skip.add(o));

  const buckets = new Map();
  root.traverse((o) => {
    if (o === root || skip.has(o) || !mergeable(o) || !visibleUnder(o, root)) return;
    const layout = layoutKey(o.geometry);
    if (!layout) return;
    const key = [o.material.uuid, o.castShadow, o.receiveShadow, o.renderOrder, o.frustumCulled, o.layers.mask, layout].join('|');
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(o);
  });

  let before = 0, after = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const parts = [], used = [];
    for (const mesh of list) {
      _local.multiplyMatrices(_inverse, mesh.matrixWorld);
      const g = mesh.geometry.clone();
      g.clearGroups();
      g.applyMatrix4(_local);
      if (_local.determinant() < 0 && mesh.material.side !== THREE.DoubleSide && !flipWinding(g)) continue;
      parts.push(g);
      used.push(mesh);
    }
    if (used.length < 2) continue;
    const geometry = mergeGeometries(parts, false);
    if (!geometry) continue;
    const first = used[0];
    const batch = new THREE.Mesh(geometry, first.material);
    batch.name = 'static-batch';
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.renderOrder = first.renderOrder;
    batch.frustumCulled = first.frustumCulled;
    batch.layers.mask = first.layers.mask;
    root.add(batch);
    for (const mesh of used) mesh.removeFromParent();
    before += used.length;
    after += 1;
  }
  return { before, after };
}
