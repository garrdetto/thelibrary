/**
 * Draw-call reduction for static detail: bakes every plain mesh under `root`
 * into one merged mesh per material (multi-material meshes are split by their
 * groups first). A storefront with sixty awnings, signs and planters, or a
 * truck body with a hundred trim pieces, becomes a handful of draws. Materials
 * are kept by reference, so night glow and paint changes keep working.
 */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function slice(g: THREE.BufferGeometry, start: number, count: number) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    out.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize));
  }
  return out;
}

function normalized(src: THREE.BufferGeometry, m: THREE.Matrix4) {
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  g.applyMatrix4(m);
  return g;
}

export function mergeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean }>();
  const consumed: THREE.Mesh[] = [];
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh || mesh.userData.keep || !mesh.visible) return;
    const rel = inv.clone().multiply(mesh.matrixWorld);
    const g = normalized(mesh.geometry, rel);
    const parts: [THREE.Material, THREE.BufferGeometry][] = [];
    if (Array.isArray(mesh.material)) {
      const groups = mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: g.getAttribute('position').count, materialIndex: 0 }];
      for (const gr of groups) {
        const mat = mesh.material[gr.materialIndex ?? 0];
        if (mat) parts.push([mat, slice(g, gr.start, Math.min(gr.count, g.getAttribute('position').count - gr.start))]);
      }
    } else parts.push([mesh.material, g]);
    for (const [mat, geo] of parts) {
      const key = `${mat.uuid}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat, geos: [], cast: mesh.castShadow, receive: mesh.receiveShadow }));
      b.geos.push(geo);
    }
    consumed.push(mesh);
  });
  if (consumed.length < 2) return;
  for (const m of consumed) m.removeFromParent();
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    b.geos.forEach(g => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
    root.add(mesh);
  }
  // Empty helper groups left behind are harmless but cost traversal time.
  const empty: THREE.Object3D[] = [];
  root.traverse(o => { if (o !== root && !(o as THREE.Mesh).isMesh && o.children.length === 0 && o.type === 'Group') empty.push(o); });
  for (const o of empty) o.removeFromParent();
}
