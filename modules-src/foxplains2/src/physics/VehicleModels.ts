/**
 * What a vehicle looks like, for the player's own vehicles and everyone
 * else's. Every view is built in the chassis frame (x forward, y up,
 * z right) with its wheels as separate steer/spin entities.
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
 */
import * as pc from 'playcanvas';
import { meshEntity, MeshBuilder } from '../core/Geo';
import type { Assets } from '../core/Assets';
import { TUNING, type VehicleTuning } from '../../../maplestreet/shared/Vehicles';
import { customVehicleRecord, type CustomVehicleRecord } from '../../../maplestreet/shared/CustomVehicles';
import { carStyleKey, type CarStyle } from '../../../maplestreet/shared/Cars';
import { recolorPixels } from '../../../maplestreet/shared/PaintMask';
import { mowerMaterials, mowerMeshes, mowerSharedMaterials, type MowerPart } from './MowerModel';

/** Built-in kinds drawn from primitives rather than a .glb. */
const PROCEDURAL = new Set(['mower']);

export interface WheelView { steer: pc.Entity; spin: pc.Entity; axle: number; side: number; caster: boolean }

export interface VehicleView {
  readonly kind: string;
  readonly tuning: VehicleTuning;
  readonly root: pc.Entity;
  readonly wheels: WheelView[];
  head: pc.StandardMaterial[];
  tail: pc.StandardMaterial[];
  styleKey: string;
  setStyle(style: CarStyle | null | undefined): void;
  setLamps(night: number, braking: boolean): void;
  destroy(): void;
}

const FINISH = { gloss: { metal: 0.15, gloss: 0.82, cc: 1 }, metallic: { metal: 0.55, gloss: 0.74, cc: 1 }, matte: { metal: 0.05, gloss: 0.28, cc: 0 } } as const;
const hex = (h: string | number) => { const n = typeof h === 'number' ? h : parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const; };

function opaque(m: pc.StandardMaterial) {
  m.blendType = pc.BLEND_NONE; m.depthWrite = true; m.cull = pc.CULLFACE_BACK;
  m.opacity = 1; m.opacityMap = null; m.alphaTest = 0;
  return m;
}

let sharedMats: { rubber: pc.StandardMaterial; rim: pc.StandardMaterial } | null = null;
function wheelMats() {
  if (sharedMats) return sharedMats;
  const rubber = opaque(new pc.StandardMaterial()); rubber.diffuse.set(0.045, 0.045, 0.048); rubber.useMetalness = true; rubber.metalness = 0; rubber.gloss = 0.3; rubber.update();
  const rim = opaque(new pc.StandardMaterial()); rim.diffuseVertexColor = true; rim.diffuseVertexColorChannel = 'rgb'; (rim as unknown as { vertexColorGamma: boolean }).vertexColorGamma = true;
  rim.useMetalness = true; rim.metalness = 0.9; rim.gloss = 0.78; rim.update();
  sharedMats = { rubber, rim };
  return sharedMats;
}

/**
 * One tire mesh and one rim-and-hub mesh per wheel size: two draw calls a
 * wheel. Both are closed surfaces of revolution (sidewalls, rounded shoulders,
 * a dished rim face with spokes and a hub), built around +Y and turned onto
 * the axle; the rim's outer face is on +Z, and left wheels turn it outward.
 */
const wheelMeshes = new Map<string, { tire: pc.Mesh; rim: pc.Mesh }>();
function wheelMesh(device: pc.GraphicsDevice, radius: number, width: number) {
  const key = `${radius.toFixed(3)}|${width.toFixed(3)}`;
  let w = wheelMeshes.get(key);
  if (w) return w;
  const axleZ = new pc.Mat4().setFromEulerAngles(90, 0, 0);
  const R = radius, h = width / 2, Ri = R * 0.64;
  const tire = new MeshBuilder().transform(axleZ);
  tire.lathe([
    [Ri, -h * 0.9], [R * 0.78, -h], [R * 0.92, -h * 0.97], [R * 0.975, -h * 0.84], [R, -h * 0.6],
    [R, h * 0.6], [R * 0.975, h * 0.84], [R * 0.92, h * 0.97], [R * 0.78, h], [Ri, h * 0.9],
  ], 36, true);
  // Inner liner so the tire never shows daylight between bead and rim.
  tire.lathe([[Ri * 0.99, h * 0.9], [Ri * 0.99, -h * 0.9]], 36, true);
  const rim = new MeshBuilder().transform(axleZ);
  rim.color = [0.66, 0.68, 0.71];
  rim.lathe([[Ri * 1.04, h * 0.92], [Ri * 0.96, h * 0.99], [Ri * 0.88, h * 0.93], [Ri * 0.8, h * 0.8], [Ri * 0.34, h * 0.72], [Ri * 0.28, h * 0.84]], 32, false);
  rim.color = [0.2, 0.21, 0.23];
  rim.lathe([[Ri * 0.28, h * 0.84], [Ri * 0.2, h * 0.98], [0.0001, h * 1.02]], 20, true);
  rim.lathe([[0.0001, -h * 0.8], [Ri * 0.97, -h * 0.8], [Ri * 0.97, h * 0.92]], 28, false);
  rim.color = [0.6, 0.62, 0.65];
  for (let i = 0; i < 5; i++) {
    rim.transform(new pc.Mat4().mul2(axleZ, new pc.Mat4().setFromEulerAngles(0, i * 72, 0)));
    rim.box(Ri * 0.3, h * 0.7, -Ri * 0.07, Ri * 0.84, h * 0.86, Ri * 0.07);
  }
  w = { tire: tire.toMesh(device), rim: rim.toMesh(device, true) };
  wheelMeshes.set(key, w);
  return w;
}

/**
 * glTF materials as they come out of the asset pipeline: palette-merged, so a
 * BLEND material is a whole greenhouse of glass and every opaque one still
 * carries the palette's alpha as an opacity map. Opaque parts are forced to
 * BLEND_NONE with depth writes and back-face culling (no sorting against the
 * glass); glass becomes a dielectric with reflections that don't fade with
 * its alpha, so windows read as tinted glass instead of holes.
 */
const fixed = new WeakSet<pc.Material>();
function fixModelMaterials(model: pc.Entity) {
  for (const r of model.findComponents('render') as pc.RenderComponent[]) {
    for (const mi of r.meshInstances) {
      const m = mi.material as pc.StandardMaterial;
      if (!(m instanceof pc.StandardMaterial) || fixed.has(m)) continue;
      fixed.add(m);
      if (m.blendType === pc.BLEND_NONE && !m.opacityMap && m.opacity >= 1) { m.cull = pc.CULLFACE_BACK; m.depthWrite = true; m.update(); continue; }
      const glass = m.blendType !== pc.BLEND_NONE;
      if (!glass) { opaque(m); m.update(); continue; }
      m.opacityMap = null;
      m.diffuseMap = null;
      m.diffuseVertexColor = false;
      m.diffuse.set(0.035, 0.045, 0.055);
      m.metalnessMap = null; m.glossMap = null; m.specularMap = null;
      m.useMetalness = true; m.metalness = 0; m.gloss = 0.94; m.specularityFactor = 1;
      m.opacity = 0.86;
      m.opacityFadesSpecular = false;
      m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; m.cull = pc.CULLFACE_BACK;
      m.update();
    }
  }
}

/** Recolored copies of textures keyed by texture, key color, tolerance and paint. */
const paintCache = new Map<string, pc.Texture>();
function maskedTexture(device: pc.GraphicsDevice, map: pc.Texture, key: string, tolerance: number, paint: string): pc.Texture | null {
  const id = `${map.name}|${map.width}x${map.height}|${key}|${tolerance}|${paint}`;
  const hit = paintCache.get(id);
  if (hit) return hit;
  const img = map.getSource() as (CanvasImageSource & { width: number; height: number }) | null;
  if (!img?.width) return null;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const [r, gg, b] = hex(paint);
  recolorPixels(data.data, key, tolerance, [r * 255, gg * 255, b * 255]);
  g.putImageData(data, 0, 0);
  const t = new pc.Texture(device, { name: `${map.name}-paint`, width: c.width, height: c.height, format: map.format, mipmaps: true, addressU: map.addressU, addressV: map.addressV, anisotropy: 8, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR });
  t.setSource(c);
  paintCache.set(id, t);
  return t;
}

/**
 * The built-in bodies model the whole greenhouse, roof included, as one glass
 * mesh. Faces that point up (the roof panel) move to their own index buffer on
 * the same vertices and take the body paint, so the cab has a solid top and
 * only the windows stay glass.
 */
const roofSplits = new WeakMap<pc.Mesh, { glass: pc.Mesh; roof: pc.Mesh } | null>();
function roofSplit(src: pc.Mesh, rot: pc.Quat) {
  if (roofSplits.has(src)) return roofSplits.get(src)!;
  let out: { glass: pc.Mesh; roof: pc.Mesh } | null = null;
  const idx: number[] = [], nrm: number[] = [];
  if (src.indexBuffer[0] && src.primitive[0].base === 0 && src.getIndices(idx) && src.getNormals(nrm)) {
    const n = new pc.Vec3(), roof: number[] = [], glass: number[] = [];
    for (let i = 0; i + 2 < idx.length; i += 3) {
      n.set(0, 0, 0);
      for (let k = 0; k < 3; k++) { const j = idx[i + k] * 3; n.x += nrm[j]; n.y += nrm[j + 1]; n.z += nrm[j + 2]; }
      rot.transformVector(n.normalize(), n);
      (n.y > 0.72 ? roof : glass).push(idx[i], idx[i + 1], idx[i + 2]);
    }
    if (roof.length && glass.length) {
      const fmt = src.indexBuffer[0].format;
      const typed = (a: number[]) => fmt === pc.INDEXFORMAT_UINT32 ? new Uint32Array(a) : fmt === pc.INDEXFORMAT_UINT8 ? new Uint8Array(a) : new Uint16Array(a);
      const part = (list: number[]) => {
        const mesh = new pc.Mesh(src.device);
        mesh.vertexBuffer = src.vertexBuffer;
        mesh.indexBuffer[0] = new pc.IndexBuffer(src.device, fmt, list.length, pc.BUFFER_STATIC, typed(list).buffer);
        mesh.primitive[0] = { type: pc.PRIMITIVE_TRIANGLES, base: 0, baseVertex: 0, count: list.length, indexed: true };
        mesh.aabb = src.aabb;
        // Shared by every vehicle of this kind and by the container's vertex buffer: never freed with one car.
        mesh.incRefCount();
        return mesh;
      };
      out = { glass: part(glass), roof: part(roof) };
    }
  }
  roofSplits.set(src, out);
  return out;
}

function splitRoof(model: pc.Entity) {
  const renders = model.findComponents('render') as pc.RenderComponent[];
  const paint = renders.flatMap(r => r.meshInstances).find(mi => (mi.material as pc.StandardMaterial).clearCoat > 0)?.material;
  if (!paint) return;
  model.syncHierarchy();
  for (const r of renders) {
    for (const mi of r.meshInstances) {
      if ((mi.material as pc.StandardMaterial).blendType === pc.BLEND_NONE || !mi.mesh) continue;
      const split = roofSplit(mi.mesh, mi.node.getRotation());
      if (!split) continue;
      mi.mesh = split.glass;
      // Its own entity at the glass node: reassigning render.meshInstances would destroy the existing ones.
      const roof = meshEntity('roof', [{ mesh: split.roof, material: paint }]);
      mi.node.addChild(roof);
    }
  }
}

const close = (a: number, b: number, eps = 0.08) => Math.abs(a - b) < eps;

class View implements VehicleView {
  readonly root = new pc.Entity('vehicle');
  readonly wheels: WheelView[] = [];
  head: pc.StandardMaterial[] = [];
  tail: pc.StandardMaterial[] = [];
  styleKey = '\u0000';
  private body: pc.Entity | null = null;
  private paintMats: pc.StandardMaterial[] = [];
  private paintSources: { mat: pc.StandardMaterial; map: pc.Texture | null }[] = [];
  private style: CarStyle | null = null;
  private lampState = '';
  private destroyed = false;

  constructor(readonly kind: string, readonly tuning: VehicleTuning, private lib: VehicleModels) {}

  addWheels(custom: boolean) {
    const P = this.tuning, M = wheelMats();
    P.axles.forEach((a, ai) => {
      for (const side of [1, -1]) {
        const steer = new pc.Entity('wheel');
        steer.setLocalPosition(a.x, P.wheelY - P.suspension.rest, a.halfTrack * side);
        const spin = new pc.Entity('spin');
        steer.addChild(spin);
        if (custom) {
          const w = wheelMesh(this.lib.device, a.radius, a.width);
          const e = meshEntity('tire', [{ mesh: w.tire, material: M.rubber }, { mesh: w.rim, material: M.rim }]);
          if (side < 0) e.setLocalEulerAngles(0, 180, 0);
          spin.addChild(e);
        }
        this.root.addChild(steer);
        this.wheels.push({ steer, spin, axle: ai, side, caster: !!a.caster });
      }
    });
  }

  /** Built-in body: wheel pivots at the axles move onto our spin nodes; the rest is the body. */
  fillBuiltin(model: pc.Entity) {
    const P = this.tuning;
    const pivots: pc.GraphNode[] = [];
    model.forEach(n => {
      if (n === model) return;
      const p = n.getLocalPosition();
      for (const w of this.wheels) {
        const a = P.axles[w.axle];
        if (close(p.x, a.x) && close(p.z, a.halfTrack * w.side) && close(p.y, P.wheelY - P.suspension.rest, 0.2) && n.children.length) {
          if (!pivots.includes(n)) {
            pivots.push(n);
            for (const c of [...n.children]) {
              const lp = c.getLocalPosition().clone(), lr = c.getLocalRotation().clone(), ls = c.getLocalScale().clone();
              n.removeChild(c); w.spin.addChild(c);
              c.setLocalPosition(lp); c.setLocalRotation(lr); c.setLocalScale(ls);
            }
          }
        }
      }
    });
    for (const p of pivots) p.parent?.removeChild(p);
    fixModelMaterials(model);
    splitRoof(model);
    this.adopt(model);
    const seen = new Set<pc.Material>();
    for (const r of model.findComponents('render') as pc.RenderComponent[]) {
      for (const mi of r.meshInstances) {
        const m = mi.material as pc.StandardMaterial;
        if (!(m instanceof pc.StandardMaterial)) continue;
        if (m.clearCoat > 0) { const c = this.own(mi, m, seen); this.paintMats.push(c); }
        else if (m.emissive.r + m.emissive.g + m.emissive.b > 0.05 || m.emissiveMap) {
          const c = this.own(mi, m, seen);
          const red = c.emissive.r > c.emissive.g * 1.6 && c.emissive.r > c.emissive.b * 1.6;
          const amber = c.emissive.r > 0.6 && c.emissive.g > 0.3 && c.emissive.b < 0.2;
          if (red) this.tail.push(c); else if (!amber) this.head.push(c);
        }
      }
    }
    this.applyStyle();
  }

  /** Published body placed by the record's model transform, paint by material or color key, plus lamp lenses. */
  fillCustom(model: pc.Entity | null, r: CustomVehicleRecord) {
    const holder = new pc.Entity('body');
    holder.setLocalPosition(r.model.x, r.model.y, r.model.z);
    holder.setLocalEulerAngles(0, r.model.yaw, 0);
    holder.setLocalScale(r.model.scale, r.model.scale, r.model.scale);
    if (model) { fixModelMaterials(model); holder.addChild(model); }
    else {
      const c = r.physics.chassis, s = 1 / r.model.scale;
      const box = new pc.Entity(); box.addComponent('render', { type: 'box' });
      box.setLocalScale(c.hx * 2 * s, c.hy * 2.4 * s, c.hz * 2 * s);
      box.setLocalPosition(-r.model.x * s, (-r.model.y + c.hy * 0.6) * s, -r.model.z * s);
      holder.addChild(box);
    }
    this.adopt(holder);
    const seen = new Set<pc.Material>();
    if (model && r.paint.mode !== 'none') {
      for (const rc of model.findComponents('render') as pc.RenderComponent[]) for (const mi of rc.meshInstances) {
        const m = mi.material as pc.StandardMaterial;
        if (!(m instanceof pc.StandardMaterial)) continue;
        if (r.paint.mode === 'material' && m.name !== r.paint.material) continue;
        if (r.paint.mode === 'color' && !m.diffuseMap) continue;
        const c = this.own(mi, m, seen);
        this.paintMats.push(c);
        this.paintSources.push({ mat: c, map: m.diffuseMap });
      }
    }
    const lamp = (pts: { x: number; y: number; z: number }[], color: [number, number, number], list: pc.StandardMaterial[], sx: number, sy: number, sz: number) => {
      if (!pts.length) return;
      const mat = new pc.StandardMaterial();
      mat.diffuse.set(color[0] * 0.3, color[1] * 0.3, color[2] * 0.3); mat.emissive.set(color[0], color[1], color[2]); mat.emissiveIntensity = 0; mat.gloss = 0.9; mat.useMetalness = true; mat.update();
      list.push(mat);
      const mb = new MeshBuilder();
      for (const p of pts) for (const side of p.z === 0 ? [1] : [1, -1]) mb.box(p.x - sx / 2, p.y - sy / 2, p.z * side - sz / 2, p.x + sx / 2, p.y + sy / 2, p.z * side + sz / 2);
      this.root.addChild(meshEntity('lamps', [{ mesh: mb.toMesh(this.lib.device), material: mat }], { cast: false }));
    };
    lamp(r.lights.head, [1, 0.96, 0.86], this.head, 0.05, 0.11, 0.24);
    lamp(r.lights.tail, [1, 0.08, 0.06], this.tail, 0.05, 0.12, 0.2);
    this.applyStyle();
  }

  /** The riding mower, built from primitives (MowerModel.ts) instead of a downloaded body. */
  fillMower() {
    const mats = mowerMaterials(), S = mowerSharedMaterials();
    const mat: Record<MowerPart, pc.Material> = { ...S, paint: mats.paint, head: mats.head, tail: mats.tail };
    const parts = [...mowerMeshes(this.lib.device)].map(([part, mesh]) => ({ mesh, material: mat[part] }));
    this.adopt(meshEntity('mower-body', parts));
    this.paintMats.push(mats.paint);
    this.head.push(mats.head);
    this.tail.push(mats.tail);
    this.applyStyle();
  }

  private adopt(e: pc.Entity) {
    this.body?.destroy();
    this.body = e;
    this.root.addChild(e);
    if (this.destroyed) e.destroy();
  }

  /** A per-vehicle copy of a material (so one car's paint or brake lights don't change another's). */
  private own(mi: pc.MeshInstance, m: pc.StandardMaterial, seen: Set<pc.Material>) {
    if (seen.has(m)) return m;
    const c = m.clone() as pc.StandardMaterial;
    seen.add(c);
    for (const r of (this.body?.findComponents('render') ?? []) as pc.RenderComponent[]) for (const x of r.meshInstances) if (x.material === m) x.material = c;
    mi.material = c;
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
    const color = s?.color ?? `#${P.paint.toString(16).padStart(6, '0')}`;
    const f = FINISH[s?.finish ?? 'metallic'] ?? FINISH.metallic;
    const wear = Math.min(1, Math.max(0, s?.damage ?? 0));
    const rec = customVehicleRecord(this.kind);
    const [r, g, b] = hex(color);
    for (const m of this.paintMats) {
      const src = this.paintSources.find(p => p.mat === m);
      if (rec?.paint.mode === 'color' && src?.map) {
        const t = maskedTexture(this.lib.device, src.map, rec.paint.key, rec.paint.tolerance, color);
        if (t) m.diffuseMap = t;
      } else if (rec?.paint.mode === 'material' && src?.map) {
        m.diffuse.set(r, g, b);
      } else {
        m.diffuseMap = null;
        const k = 1 - wear * 0.25;
        m.diffuse.set(r * k + 0.44 * (1 - k), g * k + 0.42 * (1 - k), b * k + 0.39 * (1 - k));
      }
      m.useMetalness = true;
      m.metalness = f.metal * (1 - wear * 0.4);
      m.gloss = Math.max(0.1, f.gloss - wear * 0.35);
      m.clearCoat = f.cc * (1 - wear * 0.8);
      m.clearCoatGloss = 0.92;
      m.update();
    }
  }

  setLamps(night: number, braking: boolean) {
    const key = `${night > 0.3 ? 1 : 0}${braking ? 1 : 0}`;
    if (key === this.lampState) return;
    this.lampState = key;
    for (const m of this.head) { m.emissiveIntensity = night > 0.3 ? 4 : 0.05; m.update(); }
    for (const m of this.tail) { m.emissiveIntensity = braking ? 6 : night > 0.3 ? 2 : 0.25; m.update(); }
  }

  destroy() {
    this.destroyed = true;
    this.root.destroy();
  }
}

export class VehicleModels {
  constructor(private assets: Assets, readonly device: pc.GraphicsDevice) {}

  /** Starts loading every model a kind needs (call early for the vehicles you own). */
  preload(kind: string) {
    const rec = customVehicleRecord(kind);
    if (!rec && PROCEDURAL.has(kind)) return;
    void this.assets.container(rec ? rec.modelUrl : `/models/maplestreet/vehicles/${kind}.glb`);
  }

  /** A view for `kind`, ready at once (the body fills in when its model has loaded). */
  build(kind: string, style?: CarStyle | null): VehicleView {
    const tuning = TUNING[kind] ?? TUNING.sedan;
    const view = new View(kind, tuning, this);
    const rec = customVehicleRecord(kind);
    const procedural = !rec && PROCEDURAL.has(kind);
    view.addWheels(!!rec || procedural);
    view.setStyle(style ?? null);
    if (procedural) { view.fillMower(); return view; }
    const url = rec ? rec.modelUrl : `/models/maplestreet/vehicles/${TUNING[kind] ? kind : 'sedan'}.glb`;
    const fill = (c: pc.ContainerResource | null) => {
      const model = c ? c.instantiateRenderEntity({ castShadows: true, receiveShadows: true }) : null;
      if (rec) view.fillCustom(model, rec);
      else if (model) view.fillBuiltin(model);
    };
    const ready = this.assets.ready(url);
    if (ready !== undefined) fill(ready);
    else void this.assets.container(url).then(fill);
    return view;
  }
}
