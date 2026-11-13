/**
 * Clear glass for scanned vehicles. A Meshy or photo scan has its windows
 * painted into the body texture, so they read as flat dark panels. Each body
 * triangle is classified once per geometry by the shared detector
 * (maplestreet/shared/WindowDetect.ts, the same one the vehicle editor uses):
 * glass-coloured texture, in the greenhouse band, facing sideways and, on the
 * sides, outward; then lone hits and small patches are dropped and small holes
 * in a pane filled. When the administrator traced the windows in the
 * developer panel (the vehicle's `glass`, maplestreet/shared/VehicleGlass.ts),
 * that list is used instead.
 *
 * The window triangles move to the end of the index buffer and draw as a
 * second submesh in clear glass; a clone of the body draws only its back
 * faces in a dark upholstery colour, which is the cab's interior seen through
 * the glass.
 *
 * Triangles keep their number from the model file (`rememberTriangles`, called
 * before anything cuts or reorders the index buffer), so traced glass stays on
 * the right faces after the lamp cut and the reorder here. `reglaze` redoes a
 * geometry's split with new flags and updates every mesh drawing it, which is
 * how the trace tool previews its edits.
 */
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Geometry } from '@babylonjs/core/Meshes/geometry';
import type { Material } from '@babylonjs/core/Materials/material';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { detectWindows, isGlassColor, type GlassMask } from '../../../maplestreet/shared/WindowDetect';

/** The cab interior is drawn from the body's upper part only (from this fraction of its height) and only as long as the windows, so gaps in a scan's bed, hood or sills don't show it. */
const INTERIOR_FROM = 0.42;
/**
 * Where each triangle's texture is read: its centre and three points pulled 60 % of the way in from the corners
 * (barycentric 0.6/0.2/0.2), never the corners themselves, which sit on the atlas islands' edges next to dark padding.
 */
const DETECT = { cornerPull: 0.6 } as const;

/** 1 where a texel looks like window glass. */
export const glassTexel = (r: number, g: number, b: number): boolean => isGlassColor(r, g, b);

const masks = new Map<string, Promise<GlassMask | null>>();

function maskOf(tex: BaseTexture): Promise<GlassMask | null> {
  const size = tex.getSize();
  const id = `${tex.uniqueId}|${size.width}x${size.height}`;
  let m = masks.get(id);
  if (!m) {
    m = (async () => {
      const px = await tex.readPixels(0, 0, null, true, true);
      if (!px || !size.width) return null;
      const data = new Uint8Array(px.buffer, px.byteOffset, px.byteLength);
      const glass = new Uint8Array(size.width * size.height);
      for (let i = 0; i < glass.length; i++) glass[i] = glassTexel(data[i * 4] / 255, data[i * 4 + 1] / 255, data[i * 4 + 2] / 255) ? 1 : 0;
      return { width: size.width, height: size.height, data: glass };
    })().catch(() => null);
    masks.set(id, m);
  }
  return m;
}

/** Index counts after the reorder: [lower body][upper body][glass]. */
interface Split {
  lower: number;
  body: number;
}

/** What is known about one shared body geometry. */
interface GeoState {
  /** The index buffer as it came in the model file. */
  pristine: Uint32Array;
  /** Pristine triangle number of each "a,b,c" index triple (built when first needed). */
  ids: Map<string, number> | null;
  /** Positions and normals in the chassis frame, the body's bounds and the colour mask, from the first glazing. */
  frame: { world: Float32Array; normals: Float32Array | null; uvs: Float32Array | null; mask: GlassMask | null; minY: number; height: number; midZ: number } | null;
  /** Glass flags over the pristine triangles, as drawn now. */
  flags: Uint8Array | null;
  /** True when `flags` came from a trace rather than the detector. */
  traced: boolean;
  split: Split | null;
  /** Every mesh that draws this geometry and was glazed (or tried). */
  users: Set<Mesh>;
}

const geos = new WeakMap<Geometry, GeoState>();

/** Keeps each body mesh's file triangle order; call as soon as the model is instanced, before any cut or reorder. */
export function rememberTriangles(meshes: readonly Mesh[]): void {
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    if (!geo || geos.has(geo)) continue;
    const idx = mesh.getIndices();
    if (!idx) continue;
    geos.set(geo, { pristine: Uint32Array.from(idx), ids: null, frame: null, flags: null, traced: false, split: null, users: new Set() });
  }
}

const tripleKey = (a: number, b: number, c: number) => `${a},${b},${c}`;

function idsOf(state: GeoState): Map<string, number> {
  if (state.ids) return state.ids;
  const ids = new Map<string, number>();
  const p = state.pristine;
  for (let t = 0; t * 3 + 2 < p.length; t++) {
    const key = tripleKey(p[t * 3], p[t * 3 + 1], p[t * 3 + 2]);
    if (!ids.has(key)) ids.set(key, t);
  }
  state.ids = ids;
  return ids;
}

/** The body mesh's triangles as the model file numbers them, or null when it was never remembered. */
export function pristineIndices(mesh: Mesh): Uint32Array | null {
  return (mesh.geometry && geos.get(mesh.geometry)?.pristine) || null;
}

/** The glass flags drawn now, over the file's triangles (null before glazing has run), and whether they were traced. */
export function currentGlass(mesh: Mesh): { flags: Uint8Array; traced: boolean } | null {
  const state = mesh.geometry ? geos.get(mesh.geometry) : undefined;
  if (!state?.frame) return null;
  return { flags: state.flags ? Uint8Array.from(state.flags) : new Uint8Array(state.pristine.length / 3), traced: state.traced };
}

/** The detector's flags over the file's triangles, ignoring any trace (null before glazing has run). */
export function detectedGlass(mesh: Mesh): Uint8Array | null {
  const state = mesh.geometry ? geos.get(mesh.geometry) : undefined;
  return state?.frame ? detect(state) : null;
}

/** Chassis-frame positions of the file's vertices (metres), for measuring areas (null before glazing has run). */
export function bodyPositions(mesh: Mesh): Float32Array | null {
  return (mesh.geometry && geos.get(mesh.geometry)?.frame?.world) || null;
}

function measure(mesh: Mesh, toBody: Matrix, bounds: { min: Vector3; max: Vector3 }, mask: GlassMask | null): GeoState['frame'] {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!pos) return null;
  const nv = mesh.getVerticesData(VertexBuffer.NormalKind);
  const uv = mesh.getVerticesData(VertexBuffer.UVKind);
  const n = pos.length / 3;
  const world = new Float32Array(n * 3);
  const normals = nv ? new Float32Array(n * 3) : null;
  const p = new Vector3();
  for (let i = 0; i < n; i++) {
    Vector3.TransformCoordinatesFromFloatsToRef(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], toBody, p);
    world[i * 3] = p.x; world[i * 3 + 1] = p.y; world[i * 3 + 2] = p.z;
    if (normals && nv) {
      Vector3.TransformNormalFromFloatsToRef(nv[i * 3], nv[i * 3 + 1], nv[i * 3 + 2], toBody, p);
      normals[i * 3] = p.x; normals[i * 3 + 1] = p.y; normals[i * 3 + 2] = p.z;
    }
  }
  return { world, normals, uvs: uv ? Float32Array.from(uv) : null, mask, minY: bounds.min.y, height: bounds.max.y - bounds.min.y || 1, midZ: (bounds.min.z + bounds.max.z) / 2 };
}

function detect(state: GeoState): Uint8Array {
  const f = state.frame!;
  if (!f.mask || !f.uvs) return new Uint8Array(state.pristine.length / 3);
  return detectWindows({ positions: f.world, normals: f.normals, uvs: f.uvs, indices: state.pristine, mask: f.mask }, DETECT, { minY: f.minY, maxY: f.minY + f.height, midZ: f.midZ });
}

/** Reorders the geometry's current triangles into [lower body][upper body][glass] for `state.flags`; null when nothing is glass. */
function resplit(geo: Geometry, state: GeoState): Split | null {
  const f = state.frame!, flags = state.flags!;
  const idx = geo.getIndices();
  if (!idx) return null;
  const ids = idsOf(state);
  const world = f.world;
  const tris = idx.length / 3;
  const win = new Uint8Array(tris);
  let count = 0;
  for (let t = 0; t < tris; t++) {
    const id = ids.get(tripleKey(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]));
    if (id !== undefined && flags[id]) { win[t] = 1; count++; }
  }
  if (!count) return null;
  let cab0 = Infinity, cab1 = -Infinity;
  for (let t = 0; t < tris; t++) {
    if (!win[t]) continue;
    for (let e = 0; e < 3; e++) {
      const x = world[idx[t * 3 + e] * 3];
      cab0 = Math.min(cab0, x);
      cab1 = Math.max(cab1, x);
    }
  }
  cab0 -= 0.3;
  cab1 += 0.3;
  const lower: number[] = [], upper: number[] = [], glass: number[] = [];
  for (let t = 0; t < tris; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const h = ((world[a * 3 + 1] + world[b * 3 + 1] + world[c * 3 + 1]) / 3 - f.minY) / f.height;
    const x = (world[a * 3] + world[b * 3] + world[c * 3]) / 3;
    (win[t] ? glass : h < INTERIOR_FROM || x < cab0 || x > cab1 ? lower : upper).push(a, b, c);
  }
  geo.setIndices(lower.concat(upper, glass), geo.getTotalVertices());
  return { lower: lower.length, body: lower.length + upper.length };
}

const glassMats = new WeakMap<Scene, PBRMaterial>();
const cabinMats = new WeakMap<Scene, PBRMaterial>();

function clearGlass(scene: Scene): PBRMaterial {
  const hit = glassMats.get(scene);
  if (hit) return hit;
  const m = new PBRMaterial('scan-glass', scene);
  m.albedoColor = new Color3(0.82, 0.88, 0.9);
  m.metallic = 0;
  m.roughness = 0.03;
  m.alpha = 0.14;
  m.useRadianceOverAlpha = true;
  m.useSpecularOverAlpha = true;
  m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  m.backFaceCulling = false;
  m.needDepthPrePass = true;
  glassMats.set(scene, m);
  return m;
}

function cabin(scene: Scene): PBRMaterial {
  const hit = cabinMats.get(scene);
  if (hit) return hit;
  const m = new PBRMaterial('scan-cabin', scene);
  m.albedoColor = new Color3(0.035, 0.032, 0.03);
  m.metallic = 0;
  m.roughness = 0.85;
  m.backFaceCulling = true;
  m.cullBackFaces = false;
  cabinMats.set(scene, m);
  return m;
}

/** A glazed mesh's multi-material and interior clone. */
interface Dressed { multi: MultiMaterial; paint: Material; inside: Mesh }
const dressed = new WeakMap<Mesh, Dressed>();

function wholeMesh(mesh: Mesh) {
  mesh.subMeshes = [];
  new SubMesh(0, 0, mesh.getTotalVertices(), 0, mesh.getTotalIndices(), mesh);
}

/**
 * Draws `mesh` with `split`: glass as a second submesh and the interior clone, made on first use. `owned` collects new
 * materials and interiors for the vehicle that asked; without it they are freed with the mesh.
 */
function dress(mesh: Mesh, split: Split | null, owned: Glazed | null): void {
  if (mesh.isDisposed()) return;
  const was = dressed.get(mesh);
  const total = mesh.getTotalIndices(), verts = mesh.getTotalVertices();
  if (!split) {
    if (!was) return;
    mesh.material = was.multi.subMaterials[0] ?? was.paint;
    wholeMesh(mesh);
    was.inside.dispose();
    dressed.delete(mesh);
    return;
  }
  let d = was;
  if (!d) {
    const paint = mesh.material;
    if (!paint || paint instanceof MultiMaterial) return;
    const scene = mesh.getScene();
    const multi = new MultiMaterial(`${mesh.name}-glazed`, scene);
    multi.subMaterials.push(paint, clearGlass(scene));
    mesh.material = multi;
    const inside = mesh.clone(`${mesh.name}-cabin`, mesh.parent, true) as Mesh;
    inside.material = cabin(scene);
    inside.receiveShadows = false;
    inside.isPickable = false;
    d = { multi, paint, inside };
    dressed.set(mesh, d);
    if (owned) { owned.owned.push(multi); owned.interiors.push(inside); }
    else mesh.onDisposeObservable.addOnce(() => multi.dispose(false, false));
  }
  mesh.subMeshes = [];
  new SubMesh(0, 0, verts, 0, split.body, mesh);
  new SubMesh(1, 0, verts, split.body, total - split.body, mesh);
  d.inside.subMeshes = [];
  new SubMesh(0, 0, verts, split.lower, split.body - split.lower, d.inside);
}

export interface Glazed {
  /** Materials this call made for the vehicle (the multi-materials), to dispose with it. */
  owned: Material[];
  /** Interior clones, disposed with the vehicle's root. */
  interiors: Mesh[];
}

/**
 * Glazes a scanned body under `holder` (the record's model transform, in the chassis frame). `textures` is each
 * body mesh's original colour map (before any repaint); `traced` holds the administrator's glass for a mesh, over its
 * file triangles, which replaces the detector. Resolves once the masks are read; does nothing for meshes already
 * disposed.
 */
export async function glazeScan(holder: TransformNode, textures: Map<Mesh, BaseTexture>, alive: () => boolean, traced: Map<Mesh, Uint8Array> = new Map()): Promise<Glazed> {
  const result: Glazed = { owned: [], interiors: [] };
  const meshes = [...textures.keys()];
  if (!meshes.length) return result;
  const read = await Promise.all(meshes.map((m) => maskOf(textures.get(m)!)));
  if (!alive()) return result;
  holder.computeWorldMatrix(true);
  const inv = holder.parent ? (holder.parent as TransformNode).getWorldMatrix().clone().invert() : Matrix.Identity();
  const bounds = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
  const toBody = new Map<Mesh, Matrix>();
  for (const mesh of meshes) {
    if (mesh.isDisposed()) continue;
    const m = mesh.computeWorldMatrix(true).multiply(inv);
    toBody.set(mesh, m);
    const b = mesh.getBoundingInfo().boundingBox;
    for (const c of b.vectors) {
      const p = Vector3.TransformCoordinates(c, m);
      bounds.min.minimizeInPlace(p);
      bounds.max.maximizeInPlace(p);
    }
  }
  meshes.forEach((mesh, i) => {
    const m = toBody.get(mesh);
    const geo = mesh.geometry;
    if (!m || !geo || mesh.isDisposed()) return;
    rememberTriangles([mesh]);
    const state = geos.get(geo);
    if (!state) return;
    state.users.add(mesh);
    if (!state.frame) {
      state.frame = measure(mesh, m, bounds, read[i]);
      if (!state.frame) return;
      const mine = traced.get(mesh);
      state.traced = !!mine && mine.length === state.pristine.length / 3;
      state.flags = state.traced ? Uint8Array.from(mine!) : detect(state);
      state.split = resplit(geo, state);
    }
    dress(mesh, state.split, result);
  });
  return result;
}

/**
 * Redraws `mesh`'s geometry with new glass flags over its file triangles (null goes back to the detector) on every
 * vehicle drawing it. Returns false when the mesh was never glazed.
 */
export function reglaze(mesh: Mesh, flags: Uint8Array | null): boolean {
  const geo = mesh.geometry;
  const state = geo ? geos.get(geo) : undefined;
  if (!geo || !state?.frame) return false;
  const tris = state.pristine.length / 3;
  state.traced = !!flags && flags.length === tris;
  state.flags = state.traced ? Uint8Array.from(flags!) : detect(state);
  state.split = resplit(geo, state);
  for (const user of [...state.users]) {
    if (user.isDisposed()) { state.users.delete(user); continue; }
    dress(user, state.split, null);
  }
  return true;
}
