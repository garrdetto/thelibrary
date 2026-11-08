/**
 * Residents: the same scanned male and female bodies as Fox Plains
 * (public/modules/maplestreet/{male,female}.glb), recolored by AvatarShader
 * (a material plugin that keeps the scan's shading and swaps each region's
 * colour, with the wardrobe's patterns in rest-pose space).
 *
 * Each body loads once; every resident is a clone that shares its geometry
 * and textures and gets its own skeleton. Looks are materials cached by look
 * (reference-counted and freed when the last wearer leaves), all on one
 * compiled shader, so a new neighbor never compiles anything. Stand-ins
 * shown while a scan streams in share one capsule, one sphere and a small
 * colour cache, so neighbors walking in and out of range allocate nothing on
 * the GPU. Poses are procedural (src/avatar/Gait.ts of Fox Plains): walk and
 * run cycles, idle breathing and seated driving.
 */
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { instantiate, type Assets, type ModelInstance } from '../core/Assets';
import { R as gfx, shareGeometry } from '../core/Geo';
import { lin3, pbr, shallowClone } from '../core/Tex';
import { AvatarPlugin, type AvatarLook } from './AvatarShader';
import { gaitFrequency, gaitPose, runBlend } from '../../../maplestreet/src/avatar/Gait';
import { RIG } from '../../../maplestreet/src/avatar/RigData';
import { defaultLook, lookKey, PATTERNS, WARDROBE_BY_ID, type Body, type Look } from '../../../maplestreet/shared/Wardrobe';

const SIDES = ['L', 'R'] as const;
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function linHex(hex: string): number[] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
}
const lum = (rgb: [number, number, number]) => Math.max(0.004, 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]));
const baseName = (n: string) => n.replace(/#\d+$/, '');

function shaderLook(L: Look): AvatarLook {
  const pat = (id: string) => PATTERNS.indexOf(WARDROBE_BY_ID[id]?.pattern ?? 'solid');
  return {
    skin: linHex(L.skin), hair: linHex(L.hairColor), eyes: linHex(L.eyes), tee: linHex(L.tee),
    top1: linHex(L.topColor), top2: linHex(L.topColor2), pants1: linHex(L.pantsColor), pants2: linHex(L.pantsColor2),
    shoes1: linHex(L.shoesColor), shoes2: linHex(L.shoesColor2), pat: [pat(L.top), pat(L.pants), pat(L.shoes)],
  };
}

interface BodyKit {
  body: Body;
  container: AssetContainer;
  source: PBRMaterial;
  mask: RawTexture;
  rig: number[]; refA: number[]; refB: number[];
  hipY: number;
  armDown: number;
  looks: Map<string, { m: PBRMaterial; n: number }>;
}

/** Loads each scanned body once and hands out look materials. */
export class AvatarKits {
  private kits = new Map<Body, Promise<BodyKit | null>>();
  constructor(private assets: Assets, private scene: Scene) {}

  get(body: Body) {
    let p = this.kits.get(body);
    if (!p) { p = this.load(body).catch(e => { console.warn('[foxplains2] avatar unavailable:', e); return null; }); this.kits.set(body, p); }
    return p;
  }

  private async load(body: Body): Promise<BodyKit | null> {
    const [container, mask] = await Promise.all([this.assets.container(`/modules/maplestreet/${body}.glb`), this.mask(`/modules/maplestreet/${body}-mask.png`)]);
    if (!container) return null;
    const skinned = container.meshes.find(m => m.skeleton && m.getTotalVertices() > 0) as Mesh | undefined;
    if (!skinned?.material) return null;
    if (!skinned.isVerticesDataPresent('restPos')) {
      const pos = skinned.getVerticesData(VertexBuffer.PositionKind, true, true);
      if (pos) skinned.setVerticesData('restPos', new Float32Array(pos), false, 3);
    }
    const probe = instantiate(container, `${body}-probe`, false);
    probe.root.computeWorldMatrix(true);
    const J: Record<string, Vector3> = {};
    for (const n of probe.root.getDescendants(false)) {
      const t = n as TransformNode;
      if (!t.getAbsolutePosition) continue;
      t.computeWorldMatrix(true);
      J[baseName(t.name)] = t.getAbsolutePosition().clone();
    }
    probe.entries.dispose();
    probe.root.dispose();
    const rig = RIG[body];
    const v = (k: string) => J[k] ?? Vector3.Zero();
    const arm = v('lowerArmL').subtract(v('upperArmL'));
    const src = skinned.material as PBRMaterial;
    return {
      body, container, source: src, mask,
      rig: [Math.abs(v('upperArmL').x), v('upperArmL').y, v('lowerLegL').y, v('footL').y],
      refA: [lum(rig.mean.skin), lum(rig.mean.hair), lum(rig.mean.jacket), lum(rig.mean.tee)],
      refB: [lum(rig.mean.pants), lum(rig.mean.shoes), lum(rig.mean.soles), lum(rig.mean.eyes)],
      hipY: v('upperLegL').y,
      armDown: Math.max(0, Math.atan2(Math.abs(arm.x), -arm.y) - 0.13),
      looks: new Map(),
    };
  }

  /** The material for one look (shared with everyone wearing the same thing). */
  acquire(kit: BodyKit, look: Look): { key: string; m: PBRMaterial } {
    const key = lookKey(look) ?? 'default';
    let e = kit.looks.get(key);
    if (!e) {
      const m = shallowClone(kit.source, `avatar-${kit.body}-${kit.looks.size}`);
      m.metallic = 0; m.roughness = 0.79; m.metallicTexture = null;
      const p = new AvatarPlugin(m, kit.mask, shaderLook(look));
      p.rig = kit.rig; p.refA = kit.refA; p.refB = kit.refB;
      e = { m, n: 0 };
      kit.looks.set(key, e);
    }
    e.n++;
    return { key, m: e.m };
  }

  release(kit: BodyKit, key: string) {
    const e = kit.looks.get(key);
    if (!e || --e.n > 0) return;
    kit.looks.delete(key);
    e.m.dispose(false, false);
  }

  private async mask(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mask ${res.status}`);
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    const data = new Uint8Array(g.getImageData(0, 0, c.width, c.height).data.buffer);
    bmp.close();
    const t = new RawTexture(data, c.width, c.height, Constants.TEXTUREFORMAT_RGBA, this.scene, false, false, Texture.NEAREST_SAMPLINGMODE);
    t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
    t.name = url;
    return t;
  }
}

/** Shared geometry and a colour cache for the stand-in bodies. */
let standIn: { capsule: Mesh; sphere: Mesh; mats: Map<string, PBRMaterial> } | null = null;
function standInKit(scene: Scene) {
  if (standIn) return standIn;
  const capsule = CreateCapsule('standin-capsule', { height: 1, radius: 0.5, tessellation: 12, subdivisions: 1, capSubdivisions: 4 }, scene);
  const sphere = CreateSphere('standin-sphere', { diameter: 1, segments: 10 }, scene);
  capsule.setEnabled(false); sphere.setEnabled(false);
  standIn = { capsule, sphere, mats: new Map() };
  return standIn;
}
function standInMat(scene: Scene, hex: string) {
  const k = standInKit(scene);
  let m = k.mats.get(hex);
  if (!m) { m = pbr(`standin-${hex}`, scene); m.albedoColor = lin3(parseInt(hex.slice(1), 16)); m.roughness = 0.75; k.mats.set(hex, m); }
  return m;
}

/** Simple primitive body shown until the scan streams in (or if it can't load). */
class StandIn {
  readonly root: TransformNode;
  private legs: TransformNode[] = [];
  private arms: TransformNode[] = [];
  private parts: { mesh: Mesh; slot: 'skin' | 'top' | 'pants' | 'hair' }[] = [];
  private phase = 0;
  readonly hipY = 0.9;

  constructor(private scene: Scene, look: Look) {
    const k = standInKit(scene);
    this.root = new TransformNode('stand-in', scene);
    const part = (parent: TransformNode, src: Mesh, slot: 'skin' | 'top' | 'pants' | 'hair', x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const m = shareGeometry(src, 'standin-part', parent);
      m.position.set(x, y, z); m.scaling.set(sx, sy, sz);
      gfx().addCaster(m);
      this.parts.push({ mesh: m, slot });
      return m;
    };
    part(this.root, k.capsule, 'top', 0, 1.22, 0, 0.42, 0.82, 0.3);
    part(this.root, k.sphere, 'skin', 0, 1.68, 0, 0.26, 0.28, 0.26);
    part(this.root, k.sphere, 'hair', 0, 1.74, -0.02, 0.27, 0.18, 0.27);
    for (const x of [-0.1, 0.1]) {
      const pivot = new TransformNode('leg', scene); pivot.parent = this.root; pivot.position.set(x, 0.92, 0);
      part(pivot, k.capsule, 'pants', 0, -0.44, 0, 0.15, 0.86, 0.15);
      this.legs.push(pivot);
    }
    for (const x of [-0.27, 0.27]) {
      const pivot = new TransformNode('arm', scene); pivot.parent = this.root; pivot.position.set(x, 1.42, 0);
      part(pivot, k.capsule, 'top', 0, -0.3, 0, 0.12, 0.62, 0.12);
      this.arms.push(pivot);
    }
    this.setLook(look);
  }

  setLook(look: Look) {
    const hex = { skin: look.skin, top: look.topColor, pants: look.pantsColor, hair: look.hairColor };
    for (const p of this.parts) p.mesh.material = standInMat(this.scene, hex[p.slot]);
  }

  animate(dt: number, speed: number, seated: boolean) {
    if (seated) {
      for (const l of this.legs) l.rotation.x = -80 * Math.PI / 180;
      for (const a of this.arms) a.rotation.x = -55 * Math.PI / 180;
      return;
    }
    this.phase = (this.phase + dt * gaitFrequency(speed)) % 1;
    const g = gaitPose(this.phase, speed);
    this.legs[0].rotation.x = -g.legL.hip;
    this.legs[1].rotation.x = -g.legR.hip;
    this.arms[0].rotation.x = g.armL.arm;
    this.arms[1].rotation.x = g.armR.arm;
  }

  dispose() { this.root.dispose(false, false); }
}

const _qx = new Quaternion(), _qy = new Quaternion(), _qz = new Quaternion(), _q = new Quaternion();
const AX = new Vector3(1, 0, 0), AY = new Vector3(0, 1, 0), AZ = new Vector3(0, 0, 1);

interface BoneRef { node: TransformNode; rest: Quaternion; pos: Vector3 }

/** One resident's body: a skeleton clone of the shared scan plus a procedural pose. */
export class Avatar {
  readonly root: TransformNode;
  private stub: StandIn | null;
  private model: ModelInstance | null = null;
  private kit: BodyKit | null = null;
  private lookMat: string | null = null;
  private mesh: AbstractMesh | null = null;
  private bones: Record<string, BoneRef> = {};
  private wanted: Body;
  private phase = 0;
  private t = Math.random() * 10;
  private straddle = false;
  private seat: { x: number; y: number; z: number } | null = null;
  private disposed = false;
  seated = false;
  look: Look;

  constructor(private kits: AvatarKits, scene: Scene, look: Look | string) {
    this.look = typeof look === 'string' ? { ...defaultLook('male'), topColor: look } : look;
    this.wanted = this.look.body;
    this.root = new TransformNode('avatar', scene);
    this.stub = new StandIn(scene, this.look);
    this.stub.root.parent = this.root;
    this.loadModel();
  }

  get hipY() { return this.kit?.hipY ?? this.stub?.hipY ?? 0.9; }

  private loadModel() {
    const body = this.wanted;
    void this.kits.get(body).then(kit => {
      if (!kit || this.disposed || this.wanted !== body) return;
      this.dropModel();
      const inst = instantiate(kit.container, `avatar-${body}`, true);
      inst.root.parent = this.root;
      this.model = inst;
      this.kit = kit;
      this.mesh = inst.root.getChildMeshes(false).find(m => m.skeleton) ?? null;
      for (const m of inst.root.getChildMeshes(false)) { gfx().addCaster(m); (m as Mesh).useVertexColors = false; }
      this.bones = {};
      for (const n of inst.root.getDescendants(false)) {
        const t = n as TransformNode;
        if (!t.position || t === inst.root) continue;
        t.rotationQuaternion ??= Quaternion.FromEulerVector(t.rotation);
        this.bones[baseName(t.name)] = { node: t, rest: t.rotationQuaternion.clone(), pos: t.position.clone() };
      }
      this.applyLook();
      if (this.stub) { this.stub.dispose(); this.stub = null; }
      if (this.seat) this.root.position.set(this.seat.x, this.seat.y - this.hipY, this.seat.z);
      gfx().warm(1);
    });
  }

  private dropModel() {
    if (this.kit && this.lookMat) this.kits.release(this.kit, this.lookMat);
    this.lookMat = null;
    if (this.model) { this.model.entries.dispose(); this.model.root.dispose(false, false); }
    this.model = null; this.mesh = null; this.bones = {};
  }

  setLook(look: Look) {
    this.look = look;
    this.stub?.setLook(look);
    if (look.body !== this.wanted) { this.wanted = look.body; this.loadModel(); return; }
    this.applyLook();
  }

  private applyLook() {
    const kit = this.kit, mesh = this.mesh;
    if (!kit || !mesh) return;
    const next = kit && this.kits.acquire(kit, this.look);
    if (this.lookMat) this.kits.release(kit, this.lookMat);
    this.lookMat = next.key;
    mesh.material = next.m;
  }

  /** Seat = hip position in the vehicle's chassis frame (vehicles face +X). */
  sitIn(vehicleRoot: TransformNode, seat: { x: number; y: number; z: number; straddle?: boolean }) {
    this.root.parent = vehicleRoot;
    this.seat = seat;
    this.root.position.set(seat.x, seat.y - this.hipY, seat.z);
    this.root.rotationQuaternion = null;
    this.root.rotation.set(0, Math.PI / 2, 0);
    this.straddle = !!seat.straddle;
    this.seated = true;
  }

  standIn(parent: TransformNode, footY: number) {
    this.root.parent = parent;
    this.seat = null;
    this.root.position.set(0, footY, 0);
    this.root.rotationQuaternion = null;
    this.root.rotation.set(0, 0, 0);
    this.seated = false;
  }

  private rot(name: string, x: number, y: number, z: number) {
    const b = this.bones[name];
    if (!b) return;
    Quaternion.RotationAxisToRef(AX, x, _qx);
    Quaternion.RotationAxisToRef(AY, y, _qy);
    Quaternion.RotationAxisToRef(AZ, z, _qz);
    _qx.multiplyToRef(_qy, _q);
    _q.multiplyToRef(_qz, _q);
    b.rest.multiplyToRef(_q, b.node.rotationQuaternion!);
  }

  animate(dt: number, speed: number, seated = this.seated) {
    if (!this.kit) { this.stub?.animate(dt, speed, seated); return; }
    const k = this.kit;
    this.t += dt;
    const breathe = Math.sin(this.t * 1.7) * 0.012;
    const hips = this.bones.hips;
    if (seated) {
      for (const s of SIDES) {
        const sign = s === 'L' ? 1 : -1;
        this.rot(`upperLeg${s}`, this.straddle ? -1.1 : -1.45, 0, sign * (this.straddle ? 0.3 : 0.06));
        this.rot(`lowerLeg${s}`, this.straddle ? 1.25 : 1.4, 0, 0);
        this.rot(`foot${s}`, this.straddle ? -0.1 : 0.1, 0, 0);
        this.rot(`upperArm${s}`, -0.95, 0, -sign * k.armDown * 0.72);
        this.rot(`lowerArm${s}`, -0.55, 0, 0);
      }
      this.rot('spine', -0.06, 0, 0);
      this.rot('chest', breathe, 0, 0);
      this.rot('hips', 0, 0, 0);
      if (hips) hips.node.position.copyFrom(hips.pos);
      return;
    }
    this.phase = (this.phase + dt * gaitFrequency(speed)) % 1;
    const g = gaitPose(this.phase, speed);
    const run = runBlend(speed);
    for (const s of SIDES) {
      const sign = s === 'L' ? 1 : -1;
      const Lg = s === 'L' ? g.legL : g.legR, A = s === 'L' ? g.armL : g.armR;
      this.rot(`upperLeg${s}`, -Lg.hip, 0, 0);
      this.rot(`lowerLeg${s}`, Lg.knee, 0, 0);
      this.rot(`foot${s}`, Lg.ankle, 0, 0);
      const idle = Math.sin(this.t * 0.9) * 0.015;
      this.rot(`upperArm${s}`, A.arm, 0, -sign * (k.armDown * (1 - run * 0.25) - idle));
      this.rot(`lowerArm${s}`, -A.elbow, 0, 0);
      this.rot(`hand${s}`, 0, 0, 0);
    }
    this.rot('hips', 0, g.twist * 0.5, 0);
    this.rot('spine', g.lean, 0, 0);
    this.rot('chest', breathe + g.lean * 0.3, -g.twist, 0);
    this.rot('neck', 0, 0, 0);
    this.rot('head', g.headPitch, g.twist * 0.3, 0);
    if (hips) hips.node.position.set(hips.pos.x, hips.pos.y + g.hipBob, hips.pos.z);
  }

  dispose() {
    this.disposed = true;
    this.dropModel();
    this.stub?.dispose();
    this.stub = null;
    this.root.dispose(false, false);
  }
}
