/**
 * What a vehicle looks like, for the player's own vehicles and everyone
 * else's. Every view is built in the chassis frame (x forward, y up,
 * z right) with its wheels as separate steer/spin nodes.
 *
 *  - Built-in kinds (truck, sedan, coupe, hdtruck, golfcart, atv, mower,
 *    zeroturn, trailer) use the library's optimized bodies in
 *    public/models/maplestreet/vehicles/. Their wheel pivots are found at the
 *    axle positions from shared/Vehicles.ts and re-hung on our own wheel nodes;
 *    the clear-coated material takes the owner's paint, emissive materials
 *    become head- and tail-lamps.
 *  - `custom:` kinds (the bundled Maple Hauler and friends, and anything the
 *    admin publishes) place the record's .glb by its model transform, take the
 *    paint by material name or color key (shared/PaintMask.ts), and get our
 *    procedural wheels and lamp lenses.
 *
 * Memory: bodies are clones sharing one upload per model; wheel geometry is
 * shared per wheel size; the only per-vehicle GPU objects are its paint and
 * lamp materials, which `destroy` frees, so neighbor traffic driving in and
 * out of range never accumulates materials.
 */
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Geometry } from '@babylonjs/core/Meshes/geometry';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { MeshBuilder, hostRoot, R as gfx, shareGeometry } from '../core/Geo';
import { lin3, pbr, shallowClone } from '../core/Tex';
import { meshesOf, type Assets, type ModelInstance, instantiate } from '../core/Assets';
import { BODY_EXTENTS, TUNING, type VehicleTuning } from '../../../maplestreet/shared/Vehicles';
import { BUNDLED_VEHICLES } from '../../../maplestreet/shared/BundledVehicles';
import { customVehicleRecord, type CustomVehicleRecord } from '../../../maplestreet/shared/CustomVehicles';
import { lampTriangles, type LampDepth, type LampSize, type Shape } from '../../../maplestreet/shared/Shapes';
import { carStyleKey, type CarStyle } from '../../../maplestreet/shared/Cars';
import { recolorPixels } from '../../../maplestreet/shared/PaintMask';
import { mowerMaterials, mowerMeshes, mowerSharedMaterials, type MowerPart } from './MowerModel';
import { carEnvTexture } from './CarEnv';
import { addLamps3d, cutBehindLamps } from './LampView';
import { lamps3d } from '../../../maplestreet/shared/LampCut';
import { PAINT_FINISH, dressPaint, smoothScanNormals, type PaintJob } from './CarPaint';

/** Built-in kinds drawn from primitives rather than a .glb. */
const PROCEDURAL = new Set<string>();

/**
 * Built-in kinds that draw with one of the realistic scanned bodies
 * (shared/BundledVehicles.ts) instead of their low-poly model. Physics stay
 * the built-in's; the scan is scaled to the built-in's body length, centred on
 * its axles and lowered so its wheel arches sit on the built-in wheel centres.
 */
const STAND_INS: Record<string, string> = {
  sedan: 'bundled-meridian-sedan',
  coupe: 'bundled-lakeshore-coupe',
  truck: 'bundled-bulwark-4x4',
  hdtruck: 'bundled-ironhorn-crew-cab',
};

function standIn(kind: string, tuning: VehicleTuning): CustomVehicleRecord | null {
  const id = STAND_INS[kind], ext = BODY_EXTENTS[kind as keyof typeof BODY_EXTENTS];
  if (!id || !ext) return null;
  const rec = customVehicleRecord(`custom:${id}`) ?? BUNDLED_VEHICLES.find(r => r.id === id);
  if (!rec) return null;
  const B = rec.physics, s = (ext.front - ext.rear) / (2 * B.chassis.hx);
  const bMid = (B.axles[0].x + B.axles[B.axles.length - 1].x) / 2, tMid = (tuning.axles[0].x + tuning.axles[tuning.axles.length - 1].x) / 2;
  const bY = B.wheelY - B.suspension.rest, tY = tuning.wheelY - tuning.suspension.rest;
  const at = (p: { x: number; y: number; z: number }) => ({ x: tMid + s * (p.x - bMid), y: tY + s * (p.y - bY), z: s * p.z });
  return {
    ...rec,
    model: { ...rec.model, ...at(rec.model), scale: rec.model.scale * s },
    lights: { head: rec.lights.head.map(at), tail: rec.lights.tail.map(at) },
    physics: { ...B, axles: B.axles.map(a => ({ ...a, x: tMid + s * (a.x - bMid), radius: a.radius * s, width: a.width * s, halfTrack: a.halfTrack * s })) },
  };
}

const texturesOf = (m: PBRMaterial): (BaseTexture | null)[] => [m.albedoTexture, m.bumpTexture, m.metallicTexture, m.ambientTexture, m.emissiveTexture];

/**
 * Uploaded bodies draw exactly as authored (geometry, color, normal, metal and
 * roughness maps untouched), like classic Fox Plains' CustomVehicleModels:
 * only their textures get 8x anisotropic filtering so panels stay crisp at
 * grazing angles.
 */
const sharpened = new WeakSet<BaseTexture>();
function sharpenScan(model: TransformNode) {
  for (const mesh of meshesOf(model)) {
    const m = mesh.material;
    if (!(m instanceof PBRMaterial)) continue;
    for (const t of texturesOf(m)) {
      if (!t || sharpened.has(t)) continue;
      sharpened.add(t);
      t.anisotropicFilteringLevel = 8;
    }
  }
}

/** `lift` raises the wheel above the axle line when the model draws it there (wheels split out in Blender keep their own centre). */
export interface WheelView { steer: TransformNode; spin: TransformNode; axle: number; side: number; caster: boolean; lift: number }

export interface VehicleView {
  readonly kind: string;
  readonly tuning: VehicleTuning;
  readonly root: TransformNode;
  readonly wheels: WheelView[];
  head: PBRMaterial[];
  tail: PBRMaterial[];
  styleKey: string;
  setStyle(style: CarStyle | null | undefined): void;
  setLamps(night: number, braking: boolean): void;
  destroy(): void;
}

/** Paint finishes: low metal so bodies read as painted steel under a glossy clear coat (which keeps the bright HDR highlights), not chrome. */
const FINISH = { gloss: { metal: 0.02, gloss: 0.84, cc: 1 }, metallic: { metal: 0.16, gloss: 0.78, cc: 1 }, matte: { metal: 0, gloss: 0.28, cc: 0 } } as const;
/** Most metal an authored (uploaded or built-in) body panel may keep; chrome trim on rims is ours and unaffected. */
const BODY_METAL_CAP = 0.25;
const hex = (h: string | number) => { const n = typeof h === 'number' ? h : parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as [number, number, number]; };

function opaque(m: PBRMaterial) {
  m.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
  m.alpha = 1;
  m.useAlphaFromAlbedoTexture = false;
  m.opacityTexture = null;
  m.backFaceCulling = true;
  m.disableDepthWrite = false;
  return m;
}

let sharedMats: { rubber: PBRMaterial; rim: PBRMaterial } | null = null;
function wheelMats() {
  if (sharedMats) return sharedMats;
  const scene = gfx().scene;
  const rubber = opaque(pbr('tire-rubber', scene)); rubber.albedoColor = new Color3(0.0035, 0.0035, 0.004); rubber.metallic = 0; rubber.roughness = 0.72;
  const rim = opaque(pbr('rim-metal', scene)); rim.metallic = 0.9; rim.roughness = 0.24;
  sharedMats = { rubber, rim };
  return sharedMats;
}

/**
 * One tire mesh and one rim-and-hub mesh per wheel size: two draw calls a
 * wheel. Both are closed surfaces of revolution (sidewalls, rounded shoulders,
 * a dished rim face with spokes and a hub), built around +Y and turned onto
 * the axle; the rim's outer face is on +Z, and left wheels turn it outward.
 * The meshes here are disabled templates; wheels draw clones that share them.
 */
const wheelMeshes = new Map<string, { tire: Mesh; rim: Mesh }>();
function wheelMesh(radius: number, width: number) {
  const key = `${radius.toFixed(3)}|${width.toFixed(3)}`;
  let w = wheelMeshes.get(key);
  if (w) return w;
  const axleZ = Matrix.RotationX(Math.PI / 2);
  const R = radius, h = width / 2, Ri = R * 0.64;
  const tire = new MeshBuilder().transform(axleZ);
  tire.lathe([
    [Ri, -h * 0.9], [R * 0.78, -h], [R * 0.92, -h * 0.97], [R * 0.975, -h * 0.84], [R, -h * 0.6],
    [R, h * 0.6], [R * 0.975, h * 0.84], [R * 0.92, h * 0.97], [R * 0.78, h], [Ri, h * 0.9],
  ], 36, true);
  tire.lathe([[Ri * 0.99, h * 0.9], [Ri * 0.99, -h * 0.9]], 36, true);
  const rim = new MeshBuilder().transform(axleZ);
  rim.color = [0.66, 0.68, 0.71];
  rim.lathe([[Ri * 1.04, h * 0.92], [Ri * 0.96, h * 0.99], [Ri * 0.88, h * 0.93], [Ri * 0.8, h * 0.8], [Ri * 0.34, h * 0.72], [Ri * 0.28, h * 0.84]], 32, false);
  rim.color = [0.2, 0.21, 0.23];
  rim.lathe([[Ri * 0.28, h * 0.84], [Ri * 0.2, h * 0.98], [0.0001, h * 1.02]], 20, true);
  rim.lathe([[0.0001, -h * 0.8], [Ri * 0.97, -h * 0.8], [Ri * 0.97, h * 0.92]], 28, false);
  rim.color = [0.6, 0.62, 0.65];
  for (let i = 0; i < 5; i++) {
    rim.transform(Matrix.RotationY((i * 72 * Math.PI) / 180).multiply(axleZ));
    rim.box(Ri * 0.3, h * 0.7, -Ri * 0.07, Ri * 0.84, h * 0.86, Ri * 0.07);
  }
  const t = tire.toMesh(`tire-${key}`), r = rim.toMesh(`rim-${key}`, true);
  t.setEnabled(false); r.setEnabled(false);
  w = { tire: t, rim: r };
  wheelMeshes.set(key, w);
  return w;
}

/** A drawable clone of a template mesh (shared geometry) under `parent`. */
function cloneOf(src: Mesh, parent: TransformNode, material: Material, cast = true) {
  const m = shareGeometry(src, src.name, parent);
  m.material = material;
  m.isPickable = false;
  m.receiveShadows = true;
  if (cast) gfx().addCaster(m);
  return m;
}

const isGlass = (m: PBRMaterial) => m.transparencyMode === PBRMaterial.PBRMATERIAL_ALPHABLEND || m.transparencyMode === PBRMaterial.PBRMATERIAL_ALPHATESTANDBLEND;
const GLASS_NAME = /glass|window|windshield|windscreen|glazing/i;
/** Lamp lenses glow; they stay as authored instead of turning into window glass. */
const glowing = (m: PBRMaterial) => !!m.emissiveTexture || m.emissiveColor.r + m.emissiveColor.g + m.emissiveColor.b > 0.05;

/**
 * glTF materials as they come out of the asset pipeline: palette-merged, so a
 * blended material is a whole greenhouse of glass and every opaque one still
 * carries the palette's alpha. Opaque parts are forced opaque with depth
 * writes and back-face culling (no sorting against the glass) and keep at most
 * BODY_METAL_CAP of metal. Every window (blended materials, and opaque ones
 * named as glass or windows) is replaced by clear glass: a nearly colourless,
 * mostly see-through dielectric whose sky reflections don't fade with its
 * alpha. Shared materials are fixed once.
 */
const fixed = new WeakSet<Material>();
const glassMats = new WeakSet<Material>();
function fixModelMaterials(model: TransformNode) {
  for (const mesh of meshesOf(model)) {
    const m = mesh.material;
    if (!(m instanceof PBRMaterial)) continue;
    const glass = glassMats.has(m) || (!fixed.has(m) && (isGlass(m) || GLASS_NAME.test(m.name)) && !glowing(m));
    if (glass) (mesh as Mesh).useVertexColors = false;
    if (fixed.has(m)) continue;
    fixed.add(m);
    if (!glass) {
      opaque(m);
      m.metallic = Math.min(m.metallic ?? 1, BODY_METAL_CAP);
      continue;
    }
    glassMats.add(m);
    clearGlass(m);
  }
}

function clearGlass(m: PBRMaterial) {
  m.opacityTexture = null;
  m.albedoTexture = null;
  m.useAlphaFromAlbedoTexture = false;
  m.albedoColor = new Color3(0.82, 0.88, 0.9);
  m.metallicTexture = null; m.reflectivityTexture = null; m.microSurfaceTexture = null; m.bumpTexture = null;
  m.metallic = 0; m.roughness = 0.03;
  m.alpha = 0.14;
  m.useRadianceOverAlpha = true; m.useSpecularOverAlpha = true;
  m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  m.backFaceCulling = true;
  m.needDepthPrePass = true;
  const env = carEnvTexture();
  if (env) m.reflectionTexture = env;
}

/**
 * Recolored copies of textures keyed by texture, key color, tolerance and paint, shared by every vehicle painted
 * alike and disposed when the last one using a copy is repainted or removed.
 */
const paintCache = new Map<string, { tex: Promise<Texture | null>; users: number }>();
function maskedTexture(map: BaseTexture, key: string, tolerance: number, paint: string): { id: string; tex: Promise<Texture | null> } {
  const size = map.getSize();
  const id = `${map.uniqueId}|${size.width}x${size.height}|${key}|${tolerance}|${paint}`;
  let entry = paintCache.get(id);
  if (!entry) {
    const tex = (async () => {
      const px = await map.readPixels(0, 0, null, true, true);
      if (!px || !size.width) return null;
      const data = new Uint8ClampedArray(px.buffer, px.byteOffset, px.byteLength);
      const copy = new Uint8ClampedArray(data);
      const [r, g, b] = hex(paint);
      recolorPixels(copy, key, tolerance, [r * 255, g * 255, b * 255]);
      const t = new RawTexture(new Uint8Array(copy.buffer), size.width, size.height, Constants.TEXTUREFORMAT_RGBA, gfx().scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
      t.gammaSpace = map.gammaSpace;
      t.anisotropicFilteringLevel = 8;
      const src = map as Texture;
      t.wrapU = src.wrapU; t.wrapV = src.wrapV;
      return t;
    })().catch(() => null);
    entry = { tex, users: 0 };
    paintCache.set(id, entry);
  }
  entry.users++;
  return { id, tex: entry.tex };
}

function releasePaint(id: string): void {
  const entry = paintCache.get(id);
  if (!entry || --entry.users > 0) return;
  paintCache.delete(id);
  void entry.tex.then(t => t?.dispose());
}

/**
 * The built-in bodies model the whole greenhouse, roof included, as one glass
 * mesh. Faces that point up (the roof panel) are moved to the end of the index
 * buffer once per geometry; each vehicle then draws that tail as a second
 * submesh with its body paint, so the cab has a solid top and only the
 * windows stay glass.
 */
const roofSplits = new WeakMap<Geometry, number | null>();
function roofSplit(mesh: Mesh, rot: Quaternion): number | null {
  const geo = mesh.geometry;
  if (!geo) return null;
  if (roofSplits.has(geo)) return roofSplits.get(geo)!;
  let out: number | null = null;
  const idx = mesh.getIndices(), nrm = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (idx && nrm) {
    const n = new Vector3(), roof: number[] = [], glass: number[] = [];
    for (let i = 0; i + 2 < idx.length; i += 3) {
      n.set(0, 0, 0);
      for (let k = 0; k < 3; k++) { const j = idx[i + k] * 3; n.x += nrm[j]; n.y += nrm[j + 1]; n.z += nrm[j + 2]; }
      n.normalize().rotateByQuaternionToRef(rot, n);
      (n.y > 0.72 ? roof : glass).push(idx[i], idx[i + 1], idx[i + 2]);
    }
    if (roof.length && glass.length) {
      geo.setIndices(glass.concat(roof), geo.getTotalVertices());
      out = glass.length;
    }
  }
  roofSplits.set(geo, out);
  return out;
}

const close = (a: number, b: number, eps = 0.08) => Math.abs(a - b) < eps;

class View implements VehicleView {
  readonly root: TransformNode;
  readonly wheels: WheelView[] = [];
  head: PBRMaterial[] = [];
  tail: PBRMaterial[] = [];
  styleKey = '\u0000';
  private model: ModelInstance | null = null;
  private paintMats: PBRMaterial[] = [];
  private paintSources = new Map<PBRMaterial, BaseTexture | null>();
  /** Scanned body materials dressed as real paint (CarPaint.ts); they take their colour as a uniform, not a recoloured picture. */
  private jobs: PaintJob[] = [];
  /** Lamps with no outline of their own: plain glowing blocks at the markers. By day they would only hide the lamps the scan already shows, so they draw when lit. */
  private plainLamps: { mesh: Mesh; tail: boolean }[] = [];
  /** The shared recolored texture each paint material holds (released on repaint or destroy). */
  private readonly heldPaint = new Map<PBRMaterial, string>();
  /** Materials this view made (paint copies, lamps, multi-materials): freed in `destroy`. */
  private owned: Material[] = [];
  private style: CarStyle | null = null;
  /** The record whose body this view draws (a published vehicle, or a built-in's realistic stand-in). */
  private rec: CustomVehicleRecord | null = null;
  private lampState = '';
  private destroyed = false;

  constructor(readonly kind: string, readonly tuning: VehicleTuning) {
    this.root = new TransformNode(`vehicle-${kind}`, gfx().scene);
    this.root.parent = hostRoot();
  }

  /** Wheel nodes per axle; `axles` overrides where they sit and how big they draw (realistic stand-in bodies). */
  addWheels(custom: boolean, axles = this.tuning.axles) {
    const P = this.tuning, M = wheelMats(), scene = gfx().scene;
    const env = carEnvTexture();
    if (env && M.rim.reflectionTexture !== env) { M.rim.reflectionTexture = env; M.rubber.reflectionTexture = env; }
    axles.forEach((a, ai) => {
      for (const side of [1, -1]) {
        const steer = new TransformNode('wheel', scene);
        steer.parent = this.root;
        steer.position.set(a.x, P.wheelY - P.suspension.rest, a.halfTrack * side);
        const spin = new TransformNode('spin', scene);
        spin.parent = steer;
        if (custom) {
          const w = wheelMesh(a.radius, a.width);
          const holder = new TransformNode('tire', scene);
          holder.parent = spin;
          if (side < 0) holder.rotation.y = Math.PI;
          cloneOf(w.tire, holder, M.rubber, false);
          cloneOf(w.rim, holder, M.rim, false);
        }
        this.wheels.push({ steer, spin, axle: ai, side, caster: !!a.caster, lift: 0 });
      }
    });
  }

  /**
   * Wheels split out of a scan in Blender (`wheel-<n>` nodes, origin at the wheel's centre: scripts/blender/vehicle-fix.py)
   * hang on the nearest steer/spin pivot, which moves to that centre, so each wheel turns on its own axle where the
   * model drew it instead of wobbling around the physics axle.
   */
  private hangSplitWheels(model: TransformNode): boolean {
    const P = this.tuning, base = P.wheelY - P.suspension.rest;
    const split = model.getChildMeshes(false).filter(m => /^wheel-\d+/.test(m.name) && m.getTotalVertices() > 0);
    if (!split.length) return false;
    const free = [...this.wheels];
    for (const mesh of split) {
      const p = mesh.position;
      let best = -1, bestD = Infinity;
      free.forEach((w, i) => {
        const a = P.axles[w.axle];
        if (Math.sign(p.z || 1) !== w.side) return;
        const d = Math.abs(p.x - a.x) + Math.abs(p.z - a.halfTrack * w.side);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best < 0) continue;
      const w = free.splice(best, 1)[0];
      w.lift = p.y - base;
      w.steer.position.set(p.x, base + w.lift, p.z);
      mesh.parent = w.spin;
      mesh.position.setAll(0);
    }
    return true;
  }

  /** Built-in body: wheel pivots at the axles move onto our spin nodes; the rest is the body. */
  fillBuiltin(inst: ModelInstance) {
    const model = inst.root, P = this.tuning;
    const pivots: TransformNode[] = [];
    const split = this.hangSplitWheels(model);
    for (const node of split ? [] : model.getDescendants(false)) {
      const n = node as TransformNode;
      if (!n.position || n === model) continue;
      const p = n.position;
      for (const w of this.wheels) {
        const a = P.axles[w.axle];
        if (close(p.x, a.x) && close(p.z, a.halfTrack * w.side) && close(p.y, P.wheelY - P.suspension.rest, 0.2) && n.getChildren().length && !pivots.includes(n)) {
          pivots.push(n);
          for (const c of [...n.getChildren()]) (c as TransformNode).parent = w.spin;
        }
      }
    }
    for (const p of pivots) p.parent = null;
    for (const p of pivots) p.dispose(true, false);
    fixModelMaterials(model);
    this.adopt(inst);
    this.splitRoof(model);
    const seen = new Set<Material>();
    for (const mesh of [...meshesOf(model), ...this.wheels.flatMap(w => w.spin.getChildMeshes(false))]) {
      const m = mesh.material;
      if (!(m instanceof PBRMaterial)) continue;
      if (m.clearCoat.isEnabled && m.clearCoat.intensity > 0) { const c = this.own(m, seen); if (!this.paintMats.includes(c)) this.paintMats.push(c); }
      else if (m.emissiveColor.r + m.emissiveColor.g + m.emissiveColor.b > 0.05 || m.emissiveTexture) {
        const c = this.own(m, seen);
        const e = c.emissiveColor;
        const red = e.r > e.g * 2.6 && e.r > e.b * 2.6;
        const amber = e.r > 0.3 && e.g > 0.08 && e.b < 0.03;
        if (red) { if (!this.tail.includes(c)) this.tail.push(c); } else if (!amber && !this.head.includes(c)) this.head.push(c);
      }
    }
    this.applyStyle();
  }

  /** Up-facing faces of glass greenhouse meshes draw with the body paint (a second submesh). */
  private splitRoof(model: TransformNode) {
    const meshes = meshesOf(model);
    const paint = meshes.map(m => m.material).find(m => m instanceof PBRMaterial && m.clearCoat.isEnabled && m.clearCoat.intensity > 0) as PBRMaterial | undefined;
    if (!paint) return;
    const parent = model.parent;
    model.parent = null;
    model.computeWorldMatrix(true);
    for (const mesh of meshes) {
      const mat = mesh.material;
      if (!(mat instanceof PBRMaterial) || !isGlass(mat) || !(mesh instanceof Mesh)) continue;
      mesh.computeWorldMatrix(true);
      const rot = new Quaternion();
      mesh.getWorldMatrix().decompose(undefined, rot, undefined);
      const glassCount = roofSplit(mesh, rot);
      if (glassCount === null) continue;
      const total = mesh.getTotalIndices(), verts = mesh.getTotalVertices();
      const multi = new MultiMaterial(`${mesh.name}-glass-roof`, gfx().scene);
      multi.subMaterials.push(mat, paint);
      this.owned.push(multi);
      mesh.material = multi;
      mesh.subMeshes = [];
      new SubMesh(0, 0, verts, 0, glassCount, mesh);
      new SubMesh(1, 0, verts, glassCount, total - glassCount, mesh);
    }
    model.parent = parent;
  }

  /** Published body placed by the record's model transform, paint by material or color key, plus lamp lenses. */
  fillCustom(inst: ModelInstance | null, r: CustomVehicleRecord) {
    this.rec = r;
    const scene = gfx().scene;
    const holder = new TransformNode('body', scene);
    holder.position.set(r.model.x, r.model.y, r.model.z);
    holder.rotation.y = (r.model.yaw * Math.PI) / 180;
    holder.scaling.setAll(r.model.scale);
    if (inst) { sharpenScan(inst.root); fixModelMaterials(inst.root); inst.root.parent = holder; }
    else {
      const c = r.physics.chassis, s = 1 / r.model.scale;
      const box = CreateBox('body-box', { size: 1 }, scene);
      box.scaling.set(c.hx * 2 * s, c.hy * 2.4 * s, c.hz * 2 * s);
      box.position.set(-r.model.x * s, (-r.model.y + c.hy * 0.6) * s, -r.model.z * s);
      box.parent = holder;
      gfx().addCaster(box);
    }
    this.adopt(inst, holder);
    const seen = new Set<Material>();
    if (inst && r.paint.mode !== 'none') {
      for (const mesh of meshesOf(inst.root)) {
        const m = mesh.material;
        if (!(m instanceof PBRMaterial)) continue;
        if (r.paint.mode === 'material' && m.name.replace(/#\d+$/, '') !== r.paint.material) continue;
        if (r.paint.mode === 'color' && !m.albedoTexture) continue;
        const src = m.albedoTexture;
        const c = this.own(m, seen);
        if (!this.paintMats.includes(c)) { this.paintMats.push(c); this.paintSources.set(c, src); }
      }
    }
    if (inst) this.dressScan(inst.root, r, seen);
    const lamp = (pts: { x: number; y: number; z: number }[], color: [number, number, number], list: PBRMaterial[], sx: number, sy: number, sz: number, shape?: Shape, size?: LampSize, depth?: LampDepth, out = 1) => {
      if (!pts.length) return;
      const mat = pbr(`lamp-${this.kind}`, scene);
      mat.albedoColor = lin3([color[0] * 0.3, color[1] * 0.3, color[2] * 0.3]); mat.emissiveColor = lin3(color); mat.emissiveIntensity = 0; mat.roughness = 0.1;
      mat.zOffset = -2; mat.zOffsetUnits = -4;
      list.push(mat);
      this.owned.push(mat);
      const mb = new MeshBuilder();
      for (const p of pts) for (const side of (p.z === 0 ? [1] : [1, -1]) as (1 | -1)[]) {
        if (!shape) { mb.box(p.x - sx / 2, p.y - sy / 2, p.z * side - sz / 2, p.x + sx / 2, p.y + sy / 2, p.z * side + sz / 2); continue; }
        const t = lampTriangles(p, shape, side, size, depth, out);
        for (let i = 0; i < t.length; i += 9) {
          const a = [t[i], t[i + 1], t[i + 2]], b = [t[i + 3], t[i + 4], t[i + 5]], c = [t[i + 6], t[i + 7], t[i + 8]];
          const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
          const l = Math.hypot(nx, ny, nz) || 1;
          const i0 = mb.vertex(a[0], a[1], a[2], nx / l, ny / l, nz / l, 0, 0);
          mb.vertex(b[0], b[1], b[2], nx / l, ny / l, nz / l, 1, 0);
          mb.vertex(c[0], c[1], c[2], nx / l, ny / l, nz / l, 0, 1);
          mb.tri(i0, i0 + 1, i0 + 2);
        }
      }
      const mesh = mb.toMesh('lamps');
      mesh.material = mat;
      mesh.parent = this.root;
      mesh.receiveShadows = false;
      if (!shape) { mesh.setEnabled(false); this.plainLamps.push({ mesh, tail: out < 0 }); }
    };
    const lamps = lamps3d(r.lights, r.lampShapes);
    if (inst && lamps.length) cutBehindLamps(meshesOf(inst.root).filter((m): m is Mesh => m instanceof Mesh), lamps, this.root, `${r.id}|${r.updatedAt}`);
    addLamps3d(this.root, lamps, this.head, this.tail, this.owned);
    if (r.lampShapes?.headStyle?.kind !== '3d') lamp(r.lights.head, [1, 0.96, 0.86], this.head, 0.05, 0.11, 0.24, r.lampShapes?.head, r.lampShapes?.headSize, r.lampShapes?.headDepth, 1);
    if (r.lampShapes?.tailStyle?.kind !== '3d') lamp(r.lights.tail, [1, 0.08, 0.06], this.tail, 0.05, 0.12, 0.2, r.lampShapes?.tail, r.lampShapes?.tailSize, r.lampShapes?.tailDepth, -1);
    this.applyStyle();
  }

  /** A scanned body (one textured mesh) gets real paint: an even colour under a clear coat, and smooth normals (CarPaint.ts). */
  private dressScan(model: TransformNode, r: CustomVehicleRecord, seen: Set<Material>) {
    if (r.paint.mode === 'material') return;
    const exact = r.paint.mode === 'color';
    for (const mesh of meshesOf(model)) {
      const m = mesh.material;
      if (!(mesh instanceof Mesh) || !(m instanceof PBRMaterial) || !m.albedoTexture || glassMats.has(m) || glowing(m)) continue;
      const src = this.paintSources.get(m) ?? m.albedoTexture;
      smoothScanNormals(mesh, Math.cbrt(Math.abs(mesh.computeWorldMatrix(true).determinant())));
      const c = this.own(m, seen);
      if (this.jobs.some(j => j.material === c)) continue;
      this.jobs.push(dressPaint(c, src, { color: exact ? r.paint.key : r.paint.color, tolerance: r.paint.tolerance, exact }, () => !this.destroyed));
    }
  }

  /** The riding mower, built from primitives (MowerModel.ts) instead of a downloaded body. */
  fillMower() {
    const mats = mowerMaterials(), S = mowerSharedMaterials();
    const mat: Record<MowerPart, Material> = { ...S, paint: mats.paint, head: mats.head, tail: mats.tail };
    const holder = new TransformNode('mower-body', gfx().scene);
    for (const [part, mesh] of mowerMeshes()) cloneOf(mesh, holder, mat[part], part !== 'head' && part !== 'tail');
    this.adopt(null, holder);
    this.owned.push(mats.paint, mats.head, mats.tail);
    this.paintMats.push(mats.paint);
    this.head.push(mats.head);
    this.tail.push(mats.tail);
    this.applyStyle();
  }

  private adopt(inst: ModelInstance | null, holder: TransformNode | null = null) {
    const node = holder ?? inst?.root ?? null;
    if (!node) return;
    this.model = inst;
    node.parent = this.root;
    if (inst) for (const m of meshesOf(inst.root)) gfx().addCaster(m);
    if (this.destroyed) this.destroy();
  }

  /** A per-vehicle copy of a material (so one car's paint or brake lights don't change another's). */
  private own(m: PBRMaterial, seen: Set<Material>) {
    if (seen.has(m)) return m;
    const c = shallowClone(m, `${m.name}-own`);
    const env = carEnvTexture();
    if (env) c.reflectionTexture = env;
    seen.add(c);
    this.owned.push(c);
    const swap = (mesh: AbstractMesh) => {
      if (mesh.material === m) mesh.material = c;
      else if (mesh.material instanceof MultiMaterial) { const i = mesh.material.subMaterials.indexOf(m); if (i >= 0) mesh.material.subMaterials[i] = c; }
    };
    for (const mesh of this.root.getChildMeshes(false)) swap(mesh);
    return c;
  }

  setStyle(style: CarStyle | null | undefined) {
    const key = carStyleKey(style ?? null);
    if (key === this.styleKey) return;
    this.styleKey = key;
    this.style = style ?? null;
    this.applyStyle();
  }

  private applyStyle() {
    const s = this.style, P = this.tuning;
    const rec = this.rec ?? customVehicleRecord(this.kind);
    const factory = `#${P.paint.toString(16).padStart(6, '0')}`;
    /** A car still wearing its scan's own colour (never repainted) shows the showroom colour, so a change to that reaches cars saved before it. */
    const stock = !!s?.color && rec?.paint.mode === 'color' && s.color.toLowerCase() === rec.paint.key.toLowerCase();
    const color = s?.color && !stock ? s.color : factory;
    const f = FINISH[s?.finish ?? 'metallic'] ?? FINISH.metallic;
    const wear = Math.min(1, Math.max(0, s?.damage ?? 0));
    const [r, g, b] = hex(color);
    const key = this.styleKey;
    const paintable = rec?.paint.mode === 'color';
    for (const j of this.jobs) j.paint(paintable ? color : null, PAINT_FINISH[s?.finish ?? 'metallic'] ?? PAINT_FINISH.metallic, wear);
    for (const m of this.paintMats) {
      if (this.jobs.some(j => j.material === m)) continue;
      const src = this.paintSources.get(m) ?? null;
      const held = this.heldPaint.get(m);
      if (rec?.paint.mode === 'color' && src) {
        const painted = maskedTexture(src, rec.paint.key, rec.paint.tolerance, color);
        this.heldPaint.set(m, painted.id);
        void painted.tex.then(t => {
          if (t && !this.destroyed && this.styleKey === key) m.albedoTexture = t;
          if (held) releasePaint(held);
        });
      } else if (rec?.paint.mode === 'material' && src) {
        m.albedoColor = lin3([r, g, b]);
      } else {
        m.albedoTexture = null;
        if (held) {
          this.heldPaint.delete(m);
          releasePaint(held);
        }
        const k = 1 - wear * 0.25;
        m.albedoColor = lin3([r * k + 0.44 * (1 - k), g * k + 0.42 * (1 - k), b * k + 0.39 * (1 - k)]);
      }
      m.metallicTexture = null;
      m.metallic = f.metal * (1 - wear * 0.4);
      m.roughness = 1 - Math.max(0.1, f.gloss - wear * 0.35) * 0.96;
      m.clearCoat.isEnabled = true;
      m.clearCoat.intensity = f.cc * (1 - wear * 0.8);
      m.clearCoat.roughness = 0.08;
    }
  }

  setLamps(night: number, braking: boolean) {
    const key = `${night > 0.3 ? 1 : 0}${braking ? 1 : 0}`;
    if (key === this.lampState) return;
    this.lampState = key;
    for (const l of this.plainLamps) l.mesh.setEnabled(night > 0.3 || (l.tail && braking));
    for (const m of this.head) m.emissiveIntensity = night > 0.3 ? 4 : 0.05;
    for (const m of this.tail) m.emissiveIntensity = braking ? 6 : night > 0.3 ? 2 : 0.25;
  }

  destroy() {
    this.destroyed = true;
    this.model?.entries.dispose();
    this.model = null;
    this.root.dispose(false, false);
    for (const m of this.owned) m.dispose(false, false);
    this.owned.length = 0;
    this.paintMats.length = 0;
    this.jobs.length = 0;
    this.paintSources.clear();
    for (const id of this.heldPaint.values()) releasePaint(id);
    this.heldPaint.clear();
  }
}

/**
 * Babylon's glTF loader hangs a model under `__root__` turned 180° and mirrored in z, to bring glTF's right-handed
 * axes into Babylon's left-handed scene; together that is x -> -x. Vehicles are built in the town's own right-handed
 * chassis frame (x forward, like the glTF file, the vehicle editor and Fox Plains), which the town root mirrors into
 * the scene once, so that extra flip drew every body back to front: nose at the tail, wheels off their arches and the
 * game's lamp lenses poking out of the trunk. Vehicle models keep the file's axes instead.
 */
function authoredFrame(inst: ModelInstance) {
  for (const node of inst.entries.rootNodes) {
    if (!node.name.startsWith('__root__') || !(node instanceof TransformNode)) continue;
    node.rotationQuaternion = Quaternion.Identity();
    node.rotation.setAll(0);
    node.scaling.setAll(1);
  }
}

export class VehicleModels {
  constructor(private assets: Assets) {}

  /** Starts loading every model a kind needs (call early for the vehicles you own); resolves once it has. */
  preload(kind: string): Promise<unknown> {
    const tuning = TUNING[kind] ?? TUNING.sedan;
    const rec = customVehicleRecord(kind) ?? standIn(kind, tuning);
    if (!rec && PROCEDURAL.has(kind)) return Promise.resolve();
    return this.assets.container(rec ? rec.modelUrl : `/models/maplestreet/vehicles/${kind}.glb`);
  }

  /** A view for `kind`, ready at once (the body fills in when its model has loaded). */
  build(kind: string, style?: CarStyle | null): VehicleView {
    const tuning = TUNING[kind] ?? TUNING.sedan;
    const view = new View(kind, tuning);
    const rec = customVehicleRecord(kind) ?? standIn(kind, tuning);
    const procedural = !rec && PROCEDURAL.has(kind);
    view.addWheels(!!rec || procedural, rec?.physics.axles);
    view.setStyle(style ?? null);
    if (procedural) { view.fillMower(); return view; }
    const url = rec ? rec.modelUrl : `/models/maplestreet/vehicles/${TUNING[kind] ? kind : 'sedan'}.glb`;
    const fill = (c: Parameters<typeof instantiate>[0] | null) => {
      if ((view as unknown as { destroyed: boolean }).destroyed) return;
      const inst = c ? instantiate(c, url, true) : null;
      if (inst) authoredFrame(inst);
      if (rec) view.fillCustom(inst, rec);
      else if (inst) view.fillBuiltin(inst);
      gfx().warm?.(1);
    };
    const ready = this.assets.ready(url);
    if (ready !== undefined) fill(ready);
    else void this.assets.container(url).then(fill);
    return view;
  }
}
