/**
 * Draw-call reduction for static detail: bakes every plain mesh under `root`
 * into one merged mesh per material (multi-material meshes are split by their
 * groups first). A storefront with sixty awnings, signs and planters, or a
 * truck body with a hundred trim pieces, becomes a handful of draws. Materials
 * are kept by reference, so night glow and paint changes keep working.
 */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute } from 'three/tsl';

function slice(g: THREE.BufferGeometry, start: number, count: number) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color', 'surface']) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    out.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize));
  }
  return out;
}

/** Non-indexed float copy in `m`'s space with only the attributes every merged batch shares. */
function normalized(src: THREE.BufferGeometry, m: THREE.Matrix4, withColor: boolean) {
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'surface' && !(withColor && name === 'color')) g.deleteAttribute(name);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const count = g.getAttribute('position').count;
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  // Vertex-colored materials keep their colors; a piece without them is white, which is how it looked.
  if (withColor && !g.getAttribute('color')) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  // Quantized glTF (KHR_mesh_quantization) stores normalized int16/int8 data; transforming it in
  // place would clamp every coordinate to ±1, so everything is unpacked to plain floats first.
  for (const name of ['position', 'normal', 'uv', 'color', 'surface']) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    const size = name === 'color' ? 3 : a.itemSize;
    if (a.array instanceof Float32Array && !a.normalized && size === a.itemSize) continue;
    const out = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) out[i * size + c] = a.getComponent(i, c);
    g.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  g.applyMatrix4(m);
  return g;
}

export function mergeStatic(root: THREE.Object3D, opts: { flatten?: (m: THREE.Material) => boolean } = {}) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean }>();
  const consumed: THREE.Mesh[] = [];
  // Anything under an object marked `userData.keep` (models that load later, meshes other code
  // still moves or swaps) is left exactly as it is.
  const kept = (o: THREE.Object3D) => { for (let x: THREE.Object3D | null = o; x && x !== root; x = x.parent) if (x.userData.keep) return true; return false; };
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh || !mesh.visible || kept(mesh)) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const withColor = mats.some(m => !!(m as THREE.Material & { vertexColors?: boolean }).vertexColors);
    const rel = inv.clone().multiply(mesh.matrixWorld);
    const g = normalized(mesh.geometry, rel, withColor);
    const parts: [THREE.Material, THREE.BufferGeometry][] = [];
    if (Array.isArray(mesh.material)) {
      const groups = mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: g.getAttribute('position').count, materialIndex: 0 }];
      for (const gr of groups) {
        const mat = mesh.material[gr.materialIndex ?? 0];
        if (mat) parts.push([mat, slice(g, gr.start, Math.min(gr.count, g.getAttribute('position').count - gr.start))]);
      }
    } else parts.push([mesh.material, g]);
    for (const [srcMat, geo] of parts) {
      const flat = opts.flatten?.(srcMat) ? flatFor(srcMat) : null;
      const mat = flat ?? srcMat;
      if (flat) paint(geo, srcMat as THREE.MeshStandardMaterial);
      else if (!(mat as THREE.Material & { vertexColors?: boolean }).vertexColors && geo.getAttribute('color')) geo.deleteAttribute('color');
      // Pieces already drawn by a shared flat material (merged wheels, say) bring their surface data along.
      if (!isFlat(mat) && geo.getAttribute('surface')) geo.deleteAttribute('surface');
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
    // Never lose geometry: if a batch can't be merged, its pieces are drawn one by one.
    for (const geo of merged ? [merged] : b.geos) {
      const mesh = new THREE.Mesh(geo, b.mat);
      mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
      root.add(mesh);
    }
    if (merged) b.geos.forEach(g => g.dispose());
  }
  // Empty helper groups left behind are harmless but cost traversal time.
  const empty: THREE.Object3D[] = [];
  root.traverse(o => { if (o !== root && !(o as THREE.Mesh).isMesh && o.children.length === 0 && o.type === 'Group' && !o.userData.keep) empty.push(o); });
  for (const o of empty) o.removeFromParent();
}

/**
 * Non-destructive version for content that is re-batched as it changes: one
 * world-space mesh per material for every plain mesh under `sources` (which
 * are left untouched). Subtrees marked `userData.keep` are skipped; the caller
 * draws those itself.
 */
const MAP_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'lightMap', 'envMap'] as const;
const flatMats = new Map<string, THREE.MeshStandardNodeMaterial>();
const flatSet = new Set<THREE.Material>();
const isFlat = (m: THREE.Material) => flatSet.has(m);

/**
 * A plain-colored MeshStandardMaterial (no textures, opaque, not glowing) can
 * be drawn by one shared material that reads its color, roughness and
 * metalness from the vertices (`color` and `surface` attributes): every
 * paint, wood, tile and metal finish of a street of houses becomes one draw,
 * and each surface still shades exactly as its own material did.
 * Returns that shared material, or null.
 */
function flatFor(m: THREE.Material): THREE.MeshStandardNodeMaterial | null {
  const s = m as THREE.MeshStandardMaterial;
  if (s.type !== 'MeshStandardMaterial' || s.transparent || s.opacity < 1 || s.vertexColors || s.alphaTest > 0 || s.wireframe) return null;
  if (MAP_SLOTS.some(k => (s as unknown as Record<string, unknown>)[k])) return null;
  // Anything with an emissive color may be lit up later (lamps, windows at night), so it keeps its own material.
  if (s.emissive && (s.emissive.r || s.emissive.g || s.emissive.b)) return null;
  if (s.polygonOffset || s.depthWrite === false || s.colorWrite === false || s.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return null;
  const key = `${s.side}|${s.flatShading ? 1 : 0}|${s.envMapIntensity.toFixed(3)}|${s.fog ? 1 : 0}`;
  let f = flatMats.get(key);
  if (!f) {
    f = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, vertexColors: true, side: s.side, flatShading: s.flatShading, envMapIntensity: s.envMapIntensity, fog: s.fog });
    const surface = attribute('surface', 'vec2');
    f.roughnessNode = surface.x;
    f.metalnessNode = surface.y;
    f.name = `flat ${key}`;
    flatMats.set(key, f);
    flatSet.add(f);
  }
  return f;
}

/** Bakes a plain material's color, roughness and metalness into the vertices for flatFor's shared material. */
function paint(geo: THREE.BufferGeometry, m: THREE.MeshStandardMaterial) {
  const n = geo.getAttribute('position').count, col = new Float32Array(n * 3), surf = new Float32Array(n * 2);
  const c = m.color;
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    surf[i * 2] = m.roughness; surf[i * 2 + 1] = m.metalness;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('surface', new THREE.BufferAttribute(surf, 2));
}

export interface MergeCopyOptions {
  /** View distance of each source mesh; batches never mix view distances. */
  viewDistance?: (mesh: THREE.Mesh) => number;
  /** Materials that may be folded into a shared vertex-colored one (see flatFor). Default: none. */
  flatten?: (m: THREE.Material) => boolean;
}

export function mergeCopies(sources: readonly THREE.Object3D[], opts: MergeCopyOptions = {}): THREE.Group {
  const viewDistance = opts.viewDistance;
  const out = new THREE.Group();
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean; view: number | undefined }>();
  for (const src of sources) {
    src.updateMatrixWorld(true);
    const stack: THREE.Object3D[] = [src];
    while (stack.length) {
      const o = stack.pop()!;
      if (o.userData.keep || !o.visible) continue;
      for (const c of o.children) stack.push(c);
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) continue;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const withColor = mats.some(m => !!(m as THREE.Material & { vertexColors?: boolean }).vertexColors);
      const view = viewDistance?.(mesh);
      const g = normalized(mesh.geometry, mesh.matrixWorld, withColor);
      const parts: [THREE.Material, THREE.BufferGeometry][] = [];
      if (Array.isArray(mesh.material)) {
        const groups = mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: g.getAttribute('position').count, materialIndex: 0 }];
        for (const gr of groups) {
          const mat = mesh.material[gr.materialIndex ?? 0];
          if (mat) parts.push([mat, slice(g, gr.start, Math.min(gr.count, g.getAttribute('position').count - gr.start))]);
        }
        g.dispose();
      } else parts.push([mesh.material, g]);
      for (const [srcMat, geo] of parts) {
        const flat = opts.flatten?.(srcMat) ? flatFor(srcMat) : null;
        const mat = flat ?? srcMat;
        if (flat) paint(geo, srcMat as THREE.MeshStandardMaterial);
        else if (!(mat as THREE.Material & { vertexColors?: boolean }).vertexColors && geo.getAttribute('color')) geo.deleteAttribute('color');
        // Pieces already drawn by a shared flat material (merged wheels, say) bring their surface data along.
        if (!isFlat(mat) && geo.getAttribute('surface')) geo.deleteAttribute('surface');
        const key = `${mat.uuid}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}|${view ?? ''}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { mat, geos: [], cast: mesh.castShadow, receive: mesh.receiveShadow, view }));
        b.geos.push(geo);
      }
    }
  }
  for (const b of buckets.values()) {
    const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    for (const geo of merged ? [merged] : b.geos) {
      const mesh = new THREE.Mesh(geo, b.mat);
      mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
      if (b.view !== undefined) mesh.userData.viewDistance = b.view;
      out.add(mesh);
    }
    if (merged && b.geos.length > 1) b.geos.forEach(g => g.dispose());
  }
  return out;
}
