/**
 * Level of detail.
 *
 * `lods` is one registry for everything that changes detail with distance from
 * the camera. An entry has an anchor (any Object3D: its world position is the
 * point measured from), a list of switch distances and an `apply(level)`
 * callback, so the same system drives very different swaps:
 *
 *   - `swapObjects`: show one of several prepared objects (the cut, opening
 *     vehicle model up close, simplified meshes farther out, a box impostor at
 *     the horizon);
 *   - `swapGeometry`: one mesh, several geometries (avatars keep their skeleton,
 *     material and animation; only the index buffer gets coarser).
 *
 * Simplified geometry is built at runtime with meshoptimizer from the model
 * that is already loaded (`simplifiedGeometry`): the vertex buffers are shared
 * with the full-detail geometry and only a smaller index buffer is added, so a
 * level costs almost no memory and no extra download. Results are cached per
 * source geometry, so every copy of a model shares them.
 *
 * `update(camera)` runs once per frame and allocates nothing: distances come
 * straight from matrixWorld, and a level only changes when the distance
 * crosses its threshold by more than HYSTERESIS (so nothing flickers at the
 * boundary). Detached anchors (pooled vehicles, hidden walkers) are skipped.
 */
import * as THREE from 'three/webgpu';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

/** Fraction of a threshold a distance must pass before the level changes back. */
const HYSTERESIS = 0.12;

export interface LodEntry {
  readonly anchor: THREE.Object3D;
  /** Ascending; level i is used while distance < distances[i], the last level beyond. */
  readonly distances: readonly number[];
  readonly apply: (level: number) => void;
  level: number;
}

function inScene(o: THREE.Object3D) {
  let x: THREE.Object3D | null = o;
  while (x.parent) x = x.parent;
  return (x as THREE.Scene).isScene === true;
}

export class LodSystem {
  private entries = new Set<LodEntry>();
  /** Counts per level from the last update (dev overlay and tests). */
  readonly counts: number[] = [];

  add(anchor: THREE.Object3D, distances: readonly number[], apply: (level: number) => void): LodEntry {
    const e: LodEntry = { anchor, distances, apply, level: -1 };
    this.entries.add(e);
    return e;
  }

  remove(e: LodEntry | null | undefined) { if (e) this.entries.delete(e); }

  /** Drops every entry anchored at or under `root` (call when an object is thrown away). */
  removeUnder(root: THREE.Object3D) {
    for (const e of this.entries) {
      for (let x: THREE.Object3D | null = e.anchor; x; x = x.parent) if (x === root) { this.entries.delete(e); break; }
    }
  }

  get size() { return this.entries.size; }

  update(camera: THREE.Camera) {
    const ce = camera.matrixWorld.elements, cx = ce[12], cy = ce[13], cz = ce[14];
    this.counts.fill(0);
    for (const e of this.entries) {
      if (!e.anchor.parent || !inScene(e.anchor)) continue;
      const m = e.anchor.matrixWorld.elements;
      const dx = m[12] - cx, dy = m[13] - cy, dz = m[14] - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const level = levelFor(e.distances, d, e.level);
      if (level !== e.level) { e.level = level; e.apply(level); }
      this.counts[level] = (this.counts[level] ?? 0) + 1;
    }
  }
}

/** The level for distance `d`, sticking to `current` until a threshold is passed by HYSTERESIS. */
export function levelFor(distances: readonly number[], d: number, current: number) {
  let level = distances.length;
  for (let i = 0; i < distances.length; i++) if (d < distances[i]) { level = i; break; }
  if (current < 0 || level === current) return level;
  // Moving out: only once past the current band's far edge by the margin.
  if (level > current && d < distances[current] * (1 + HYSTERESIS)) return current;
  // Moving in: only once inside the next-nearer band's edge by the margin.
  if (level < current && d > distances[current - 1] * (1 - HYSTERESIS)) return current;
  return level;
}

/** The game's one LOD registry. */
export const lods = new LodSystem();

// ---------------------------------------------------------------- swap helpers

/** Level i shows objects[i] and hides the others (a null slot shows nothing at that level). */
export function swapObjects(objects: readonly (THREE.Object3D | null)[]) {
  return (level: number) => {
    const show = objects[Math.min(level, objects.length - 1)];
    for (const o of objects) if (o) o.visible = o === show;
  };
}

/** Level i draws `mesh` with geos[i] (missing entries fall back to the nearest coarser-or-finer one that exists). */
export function swapGeometry(mesh: THREE.Mesh, geos: readonly (THREE.BufferGeometry | null)[]) {
  return (level: number) => {
    for (let i = Math.min(level, geos.length - 1); i >= 0; i--) {
      const g = geos[i];
      if (g) { if (mesh.geometry !== g) mesh.geometry = g; return; }
    }
  };
}

// ---------------------------------------------------------------- building levels

const simplified = new Map<string, Promise<THREE.BufferGeometry | null>>();

/**
 * A coarser version of an indexed geometry with about `targetTriangles`
 * triangles. Vertex attributes are shared with `src` (positions, normals,
 * UVs, skin weights: everything), only the index is new, so it works for
 * skinned meshes and keeps texture seams. Resolves null when `src` is already
 * small enough or can't be simplified.
 */
export function simplifiedGeometry(src: THREE.BufferGeometry, targetTriangles: number): Promise<THREE.BufferGeometry | null> {
  const key = `${src.uuid}|${targetTriangles}`;
  let p = simplified.get(key);
  if (!p) {
    p = MeshoptSimplifier.ready.then(() => {
      const pos = src.getAttribute('position');
      if (!pos) return null;
      const index = src.index ? Uint32Array.from(src.index.array as ArrayLike<number>) : Uint32Array.from({ length: pos.count }, (_, i) => i);
      const tris = index.length / 3;
      if (tris <= targetTriangles * 1.25) return null;
      // meshopt wants plain float positions (models here are often quantized int16).
      const flat = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { flat[i * 3] = pos.getX(i); flat[i * 3 + 1] = pos.getY(i); flat[i * 3 + 2] = pos.getZ(i); }
      const [out] = MeshoptSimplifier.simplify(index, flat, 3, targetTriangles * 3, 0.05, ['Prune']);
      if (out.length < 3 || out.length >= index.length) return null;
      const g = new THREE.BufferGeometry();
      for (const name of Object.keys(src.attributes)) g.setAttribute(name, src.getAttribute(name));
      g.setIndex(new THREE.BufferAttribute(pos.count > 65535 ? out : Uint16Array.from(out), 1));
      g.boundingBox = src.boundingBox; g.boundingSphere = src.boundingSphere;
      if (!g.boundingSphere) { src.computeBoundingSphere(); g.boundingSphere = src.boundingSphere; }
      g.name = `${src.name || 'geometry'} lod ${targetTriangles}`;
      return g;
    }).catch(err => { console.warn('[lod] simplify failed', err); return null; });
    simplified.set(key, p);
  }
  return p;
}

/**
 * A copy of `source` in which every mesh draws a simplified geometry (same
 * materials, same transforms). Meshes that are already small keep theirs.
 */
export async function lowPolyCopy(source: THREE.Object3D, targetTriangles: number): Promise<THREE.Group> {
  const out = new THREE.Group();
  source.updateMatrixWorld(true);
  const inv = source.matrixWorld.clone().invert();
  const meshes: THREE.Mesh[] = [];
  source.traverse(o => { if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.Mesh); });
  const total = meshes.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3, 0) || 1;
  for (const m of meshes) {
    const tris = (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
    const geo = (await simplifiedGeometry(m.geometry, Math.max(64, Math.round(targetTriangles * (tris / total))))) ?? m.geometry;
    const copy = new THREE.Mesh(geo, m.material);
    copy.matrixAutoUpdate = false;
    copy.matrix.multiplyMatrices(inv, m.matrixWorld);
    copy.castShadow = m.castShadow; copy.receiveShadow = m.receiveShadow;
    out.add(copy);
  }
  return out;
}

/**
 * The last resort for the far distance: a box (or an upright plane facing the
 * sides) the size of `source`'s bounds, in its average color. Good from far
 * enough that the object is a few pixels tall.
 */
export function impostor(source: THREE.Object3D, color: THREE.ColorRepresentation, shape: 'box' | 'plane' = 'box'): THREE.Mesh {
  source.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(source, true);
  const inv = new THREE.Matrix4().copy(source.matrixWorld).invert();
  box.applyMatrix4(inv);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const geo = shape === 'box' ? new THREE.BoxGeometry(size.x, size.y * 0.8, size.z) : new THREE.PlaneGeometry(size.x, size.y * 0.8).rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, impostorMaterial(color));
  mesh.position.copy(center);
  mesh.position.y -= size.y * 0.1;
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

const impostorMats = new Map<string, THREE.MeshStandardMaterial>();
function impostorMaterial(color: THREE.ColorRepresentation) {
  const c = new THREE.Color(color), key = c.getHexString();
  let m = impostorMats.get(key);
  if (!m) impostorMats.set(key, (m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.3 })));
  return m;
}
