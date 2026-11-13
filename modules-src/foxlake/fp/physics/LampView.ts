/**
 * Three-dimensional head- and tail-lamps in Fox Lake (shared/Lamps3d.ts): a
 * chrome reflector bowl with bulbs, a clear or red lens and a dark trim ring,
 * and the body's own surface cut away behind each lens so the scan's
 * painted-on lamp never shows through.
 *
 * Six small meshes a vehicle at most: one trim mesh and one reflector mesh
 * for all its lamps, and a lens and a bulb mesh each for the front and the
 * back. Lens, trim and reflector materials are shared by every vehicle; only
 * the bulbs' glow belongs to the vehicle, because it follows its lights.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Geometry } from '@babylonjs/core/Meshes/geometry';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder, R as gfx } from '../core/Geo';
import { lin3, pbr } from '../core/Tex';
import { lampParts, type LampMesh } from '../../../maplestreet/shared/Lamps3d';
import { cutTriangles, lampCuts, type Lamp3d } from '../../../maplestreet/shared/LampCut';
import { carEnvTexture } from './CarEnv';

interface Shared { bezel: PBRMaterial; housing: PBRMaterial; lensHead: PBRMaterial; lensTail: PBRMaterial }
const shared = new WeakMap<Scene, Shared>();

function materials(scene: Scene): Shared {
  let s = shared.get(scene);
  if (!s) {
    const bezel = pbr('lamp-bezel', scene);
    bezel.albedoColor = new Color3(0.012, 0.012, 0.014); bezel.metallic = 0.6; bezel.roughness = 0.32;
    const housing = pbr('lamp-reflector', scene);
    housing.albedoColor = new Color3(0.9, 0.9, 0.92); housing.metallic = 1; housing.roughness = 0.12;
    const lens = (name: string, tint: Color3, alpha: number) => {
      const m = pbr(name, scene);
      m.albedoColor = tint; m.metallic = 0; m.roughness = 0.04; m.alpha = alpha;
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
      m.backFaceCulling = false;
      return m;
    };
    s = { bezel, housing, lensHead: lens('lamp-lens-clear', new Color3(0.86, 0.9, 0.92), 0.16), lensTail: lens('lamp-lens-red', new Color3(0.55, 0.01, 0.01), 0.62) };
    shared.set(scene, s);
  }
  const env = carEnvTexture();
  if (env) for (const m of [s.bezel, s.housing, s.lensHead, s.lensTail]) if (m.reflectionTexture !== env) m.reflectionTexture = env;
  return s;
}

function append(mb: MeshBuilder, part: LampMesh, color: [number, number, number]) {
  const p = part.positions, n = part.normals;
  for (let i = 0; i + 8 < p.length; i += 9) {
    const a = mb.vertex(p[i], p[i + 1], p[i + 2], n[i], n[i + 1], n[i + 2], 0, 0, color);
    mb.vertex(p[i + 3], p[i + 4], p[i + 5], n[i + 3], n[i + 4], n[i + 5], 1, 0, color);
    mb.vertex(p[i + 6], p[i + 7], p[i + 8], n[i + 6], n[i + 7], n[i + 8], 0, 1, color);
    mb.tri(a, a + 1, a + 2);
  }
}

const cutDone = new WeakMap<Geometry, string>();

/**
 * Removes the body's triangles behind each lens. The cut is the same for every vehicle drawing one record, so it is
 * made once per shared geometry. `chassis` is the node the lamps live in (the vehicle's root).
 */
export function cutBehindLamps(meshes: readonly Mesh[], lamps: readonly Lamp3d[], chassis: TransformNode, key: string): void {
  const cuts = lampCuts(lamps);
  if (!cuts.length) return;
  chassis.computeWorldMatrix(true);
  const inv = chassis.getWorldMatrix().clone().invert();
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    if (!geo || cutDone.get(geo) === key) continue;
    cutDone.set(geo, key);
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind), idx = mesh.getIndices();
    if (!pos || !idx) continue;
    const kept = cutTriangles(pos, idx, mesh.computeWorldMatrix(true).multiply(inv).asArray(), cuts);
    if (kept) geo.setIndices(kept, geo.getTotalVertices());
  }
}

/** Builds a vehicle's 3D lamps under `root`. The bulbs' glow materials go on `head` / `tail` (and `owned`, to be freed with the vehicle). */
export function addLamps3d(root: TransformNode, lamps: readonly Lamp3d[], head: PBRMaterial[], tail: PBRMaterial[], owned: Material[]): void {
  if (!lamps.length) return;
  const scene = gfx().scene;
  const S = materials(scene);
  const bezel = new MeshBuilder(), housing = new MeshBuilder();
  const lens = { head: new MeshBuilder(), tail: new MeshBuilder() }, glow = { head: new MeshBuilder(), tail: new MeshBuilder() };
  const has = { head: false, tail: false };
  for (const l of lamps) {
    const parts = lampParts(l.p, l.shape, l.side, l.size, l.depth, l.facing, l.style);
    has[l.kind] = true;
    append(bezel, parts.bezel, [1, 1, 1]);
    append(housing, parts.housing, l.kind === 'head' ? [1, 1, 1] : [0.85, 0.12, 0.1]);
    append(lens[l.kind], parts.lens, [1, 1, 1]);
    append(glow[l.kind], parts.glow, [1, 1, 1]);
  }
  const put = (mb: MeshBuilder, name: string, material: Material, colors = false) => {
    const mesh = mb.toMesh(name, colors);
    mesh.material = material;
    mesh.parent = root;
    mesh.receiveShadows = false;
    return mesh;
  };
  put(bezel, 'lamp-bezels', S.bezel);
  put(housing, 'lamp-reflectors', S.housing, true);
  for (const kind of ['head', 'tail'] as const) {
    if (!has[kind]) continue;
    const color: [number, number, number] = kind === 'head' ? [1, 0.96, 0.86] : [1, 0.08, 0.06];
    const bulb = pbr(`lamp-bulb-${kind}`, scene);
    bulb.albedoColor = lin3([color[0] * 0.5, color[1] * 0.5, color[2] * 0.5]); bulb.emissiveColor = lin3(color); bulb.emissiveIntensity = 0; bulb.roughness = 0.2;
    (kind === 'head' ? head : tail).push(bulb);
    owned.push(bulb);
    put(glow[kind], `lamp-bulbs-${kind}`, bulb);
    put(lens[kind], `lamp-lens-${kind}`, kind === 'head' ? S.lensHead : S.lensTail);
  }
}
