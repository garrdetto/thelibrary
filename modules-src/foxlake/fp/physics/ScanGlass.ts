/**
 * Clear glass for scanned vehicles. A Meshy or photo scan has its windows
 * painted into the body texture, so they read as flat dark panels. Each body
 * triangle is classified once per geometry: it is a window when its texture
 * under it is glass-coloured (dark and grey, or a grey-blue sky reflection),
 * it sits in the greenhouse band of the body (above the beltline, below the
 * roof), faces sideways rather than up or down, and on the sides faces
 * outward. Lone hits are dropped and small gaps filled across shared edges.
 * The window triangles move to the end of the index buffer and draw as a
 * second submesh in clear glass; a clone of the body draws only its back
 * faces in a dark upholstery colour, which is the cab's interior seen through
 * the glass.
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

/** The greenhouse band, as a fraction of the body's height from its lowest point. */
const BAND = { low: 0.55, high: 0.95 } as const;
const MIN_WINDOW_TRIS = 24;
/** The cab interior is drawn from the body's upper part only (from this fraction of its height) and only as long as the windows, so gaps in a scan's bed, hood or sills don't show it. */
const INTERIOR_FROM = 0.42;
/**
 * Where each triangle's texture is read (barycentric weights): its centre and three points pulled in from the
 * corners, never the corners themselves, which sit on the atlas islands' edges next to dark padding.
 */
const INSIDE = [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]] as const;
/** The smallest window pane kept, in square metres of the body. */
const MIN_PANE_AREA = 0.06;

interface Mask {
  width: number;
  height: number;
  glass: Uint8Array;
}

const masks = new Map<string, Promise<Mask | null>>();

/** 1 where a texel looks like window glass. */
export function glassTexel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sat = max > 0 ? (max - min) / max : 0;
  if (lum < 0.2 && sat < 0.38) return true;
  return lum < 0.5 && sat < 0.42 && b >= r + 0.02 && b >= g - 0.02;
}

function maskOf(tex: BaseTexture): Promise<Mask | null> {
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
      return { width: size.width, height: size.height, glass };
    })().catch(() => null);
    masks.set(id, m);
  }
  return m;
}

function sample(mask: Mask, u: number, v: number): number {
  const x = Math.min(mask.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * mask.width)));
  const y = Math.min(mask.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * mask.height)));
  return mask.glass[y * mask.width + x];
}

/** The window triangles of one geometry (by triangle index), or null when it has no clear greenhouse. */
const splits = new WeakMap<Geometry, Split | null>();

/** Index counts after the reorder: [lower body][upper body][glass]. */
interface Split {
  lower: number;
  body: number;
}

/**
 * Reorders `mesh`'s index buffer so window triangles come last and returns how many indices are body, or null when
 * the mesh has no windows. `toBody` maps the mesh's local positions into the vehicle's chassis frame (x forward, y up).
 */
function split(mesh: Mesh, mask: Mask, toBody: Matrix, bounds: { min: Vector3; max: Vector3 }): Split | null {
  const geo = mesh.geometry;
  if (!geo) return null;
  if (splits.has(geo)) return splits.get(geo)!;
  const idx = mesh.getIndices();
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const uv = mesh.getVerticesData(VertexBuffer.UVKind);
  const nv = mesh.getVerticesData(VertexBuffer.NormalKind);
  let out: Split | null = null;
  if (idx && pos && uv && nv) {
    const tris = idx.length / 3;
    const n = pos.length / 3;
    const world = new Float32Array(n * 3);
    const p = new Vector3();
    for (let i = 0; i < n; i++) {
      Vector3.TransformCoordinatesFromFloatsToRef(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], toBody, p);
      world[i * 3] = p.x; world[i * 3 + 1] = p.y; world[i * 3 + 2] = p.z;
    }
    const height = bounds.max.y - bounds.min.y || 1;
    const midZ = (bounds.min.z + bounds.max.z) / 2;
    const candidate = new Uint8Array(tris);
    const area = new Float32Array(tris);
    const hits = new Uint8Array(tris);
    const nrm = new Vector3(), vn = new Vector3(), e1 = new Vector3(), e2 = new Vector3();
    for (let t = 0; t < tris; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
      e1.set(world[b * 3] - world[a * 3], world[b * 3 + 1] - world[a * 3 + 1], world[b * 3 + 2] - world[a * 3 + 2]);
      e2.set(world[c * 3] - world[a * 3], world[c * 3 + 1] - world[a * 3 + 1], world[c * 3 + 2] - world[a * 3 + 2]);
      area[t] = Vector3.Cross(e1, e2).length() / 2;
      const cy = (world[a * 3 + 1] + world[b * 3 + 1] + world[c * 3 + 1]) / 3;
      const h = (cy - bounds.min.y) / height;
      if (h < BAND.low || h > BAND.high) continue;
      nrm.set(0, 0, 0);
      for (const k of [a, b, c]) {
        Vector3.TransformNormalFromFloatsToRef(nv[k * 3], nv[k * 3 + 1], nv[k * 3 + 2], toBody, vn);
        nrm.addInPlace(vn);
      }
      const len = nrm.length();
      if (len < 1e-9) continue;
      nrm.scaleInPlace(1 / len);
      if (Math.abs(nrm.y) > 0.82) continue;
      const cz = (world[a * 3 + 2] + world[b * 3 + 2] + world[c * 3 + 2]) / 3;
      if (Math.abs(nrm.z) > 0.55 && nrm.z * (cz - midZ) <= 0) continue;
      candidate[t] = 1;
      let n = 0;
      for (const [wa, wb, wc] of INSIDE) n += sample(mask, uv[a * 2] * wa + uv[b * 2] * wb + uv[c * 2] * wc, uv[a * 2 + 1] * wa + uv[b * 2 + 1] * wb + uv[c * 2 + 1] * wc);
      hits[t] = n;
    }
    const nb = neighbours(idx, world, n);
    const win = new Uint8Array(tris);
    for (let t = 0; t < tris; t++) if (candidate[t] && hits[t] >= INSIDE.length - 1) win[t] = 1;
    clean(win, nb);
    dropSpecks(win, nb, area);
    let count = 0;
    for (let t = 0; t < tris; t++) count += win[t];
    if (count >= MIN_WINDOW_TRIS) {
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
        const h = ((world[a * 3 + 1] + world[b * 3 + 1] + world[c * 3 + 1]) / 3 - bounds.min.y) / height;
        const x = (world[a * 3] + world[b * 3] + world[c * 3]) / 3;
        (win[t] ? glass : h < INTERIOR_FROM || x < cab0 || x > cab1 ? lower : upper).push(a, b, c);
      }
      geo.setIndices(lower.concat(upper, glass), geo.getTotalVertices());
      out = { lower: lower.length, body: lower.length + upper.length };
    }
  }
  splits.set(geo, out);
  return out;
}

/** Triangles sharing an edge (vertices welded by position, since scans split them along UV seams). */
function neighbours(idx: ArrayLike<number>, world: Float32Array, verts: number): number[][] {
  const weld = new Int32Array(verts);
  const seen = new Map<string, number>();
  for (let i = 0; i < verts; i++) {
    const key = `${Math.round(world[i * 3] * 400)},${Math.round(world[i * 3 + 1] * 400)},${Math.round(world[i * 3 + 2] * 400)}`;
    let w = seen.get(key);
    if (w === undefined) { w = i; seen.set(key, i); }
    weld[i] = w;
  }
  const tris = idx.length / 3;
  const edges = new Map<string, number[]>();
  for (let t = 0; t < tris; t++) {
    for (let e = 0; e < 3; e++) {
      const a = weld[idx[t * 3 + e]], b = weld[idx[t * 3 + ((e + 1) % 3)]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let list = edges.get(key);
      if (!list) edges.set(key, (list = []));
      list.push(t);
    }
  }
  const nb: number[][] = Array.from({ length: tris }, () => []);
  for (const list of edges.values()) for (const t of list) for (const u of list) if (u !== t) nb[t].push(u);
  return nb;
}

/** Drops window triangles with no window neighbour and fills body triangles mostly ringed by windows, twice. */
function clean(win: Uint8Array, nb: number[][]): void {
  const tris = win.length;
  for (let pass = 0; pass < 2; pass++) {
    const next = win.slice();
    for (let t = 0; t < tris; t++) {
      let w = 0;
      for (const u of nb[t]) w += win[u];
      if (win[t] && w === 0) next[t] = 0;
      else if (!win[t] && nb[t].length >= 2 && w >= nb[t].length - 1 && w >= 2) next[t] = 1;
    }
    win.set(next);
  }
}

/** Drops connected window patches smaller than a hand (dark smudges and trim on the body, not panes). */
function dropSpecks(win: Uint8Array, nb: number[][], area: Float32Array): void {
  const seen = new Uint8Array(win.length);
  const stack: number[] = [];
  const patch: number[] = [];
  for (let t = 0; t < win.length; t++) {
    if (!win[t] || seen[t]) continue;
    patch.length = 0;
    let total = 0;
    stack.push(t);
    seen[t] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      patch.push(k);
      total += area[k];
      for (const u of nb[k]) if (win[u] && !seen[u]) { seen[u] = 1; stack.push(u); }
    }
    if (total < MIN_PANE_AREA) for (const k of patch) win[k] = 0;
  }
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

export interface Glazed {
  /** Materials this call made for the vehicle (the multi-materials), to dispose with it. */
  owned: Material[];
  /** Interior clones, disposed with the vehicle's root. */
  interiors: Mesh[];
}

/**
 * Glazes a scanned body under `holder` (the record's model transform, in the chassis frame). `textures` is each
 * body mesh's original colour map (before any repaint). Resolves once the masks are read; does nothing for meshes
 * already disposed or without windows.
 */
export async function glazeScan(holder: TransformNode, textures: Map<Mesh, BaseTexture>, alive: () => boolean): Promise<Glazed> {
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
    const mask = read[i];
    const m = toBody.get(mesh);
    if (!mask || !m || mesh.isDisposed()) return;
    const cut = split(mesh, mask, m, bounds);
    if (cut === null) return;
    const body = cut.body;
    const scene = mesh.getScene();
    const total = mesh.getTotalIndices();
    const verts = mesh.getTotalVertices();
    const paint = mesh.material;
    if (!paint || paint instanceof MultiMaterial) return;
    const multi = new MultiMaterial(`${mesh.name}-glazed`, scene);
    multi.subMaterials.push(paint, clearGlass(scene));
    result.owned.push(multi);
    mesh.material = multi;
    mesh.subMeshes = [];
    new SubMesh(0, 0, verts, 0, body, mesh);
    new SubMesh(1, 0, verts, body, total - body, mesh);
    const inside = mesh.clone(`${mesh.name}-cabin`, mesh.parent, true) as Mesh;
    inside.material = cabin(scene);
    inside.subMeshes = [];
    new SubMesh(0, 0, verts, cut.lower, body - cut.lower, inside);
    inside.receiveShadows = false;
    inside.isPickable = false;
    result.interiors.push(inside);
  });
  return result;
}
