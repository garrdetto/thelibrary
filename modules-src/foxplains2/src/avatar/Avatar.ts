/**
 * Residents: the same scanned male and female bodies as Fox Plains
 * (public/modules/maplestreet/{male,female}.glb), recolored by a PlayCanvas
 * shader chunk that keeps the scan's shading and swaps each region's color
 * (skin, hair, eyes, jacket, tee, pants, shoes, soles from the region mask),
 * with the wardrobe's two-color patterns painted in rest-pose model space.
 *
 * The rest-pose position of every vertex rides in the vertex color stream
 * (added to the scan's vertex buffer once per body), so stripes and plaid
 * stay level and sized in real centimetres while the skeleton walks.
 * Every avatar of a body shares one material; each look lives on the mesh
 * instance as parameter overrides, so a new neighbor never compiles a shader.
 * Poses are procedural (src/avatar/Gait.ts of Fox Plains): walk and run
 * cycles, idle breathing and seated driving.
 */
import * as pc from 'playcanvas';
import type { Assets } from '../core/Assets';
import { gaitFrequency, gaitPose, runBlend } from '../../../maplestreet/src/avatar/Gait';
import { RIG, MASK_STEP } from '../../../maplestreet/src/avatar/RigData';
import { defaultLook, PATTERNS, WARDROBE_BY_ID, type Body, type Look } from '../../../maplestreet/shared/Wardrobe';

const RECOLOR_PS = /* glsl */ `
uniform vec3 material_diffuse;
uniform sampler2D uMask;
uniform vec3 uSkin;
uniform vec3 uHair;
uniform vec3 uEyes;
uniform vec3 uTee;
uniform vec3 uTop1;
uniform vec3 uTop2;
uniform vec3 uPants1;
uniform vec3 uPants2;
uniform vec3 uShoes1;
uniform vec3 uShoes2;
uniform vec3 uPat;
uniform vec4 uRig;
uniform vec4 uRefA;
uniform vec4 uRefB;

float avHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float avNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(avHash(i), avHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(avHash(i + vec3(0.0, 1.0, 0.0)), avHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(avHash(i + vec3(0.0, 0.0, 1.0)), avHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(avHash(i + vec3(0.0, 1.0, 1.0)), avHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z) * 2.0 - 1.0;
}
float isPat(float pat, float id) { return step(abs(pat - id), 0.5); }
vec3 patterned(float pat, vec3 c1, vec3 c2, vec3 p) {
  float sideways = p.x + p.z * 0.7;
  float stripes = step(0.5, fract(p.y / 0.085));
  float plaidA = step(0.5, fract(sideways / 0.11)), plaidB = step(0.5, fract(p.y / 0.11));
  float over = max(step(0.93, fract(sideways / 0.11 + 0.25)), step(0.93, fract(p.y / 0.11 + 0.25)));
  float camoN = avNoise(p * 7.5) + avNoise(p * 17.0 + 3.1) * 0.45;
  float camo = smoothstep(0.02, 0.08, camoN), camoDark = smoothstep(0.32, 0.38, camoN);
  float sleeve = smoothstep(uRig.x - 0.01, uRig.x + 0.03, abs(p.x)) * step(p.y, uRig.y + 0.06);
  float twill = (fract((p.x + p.y + p.z) * 260.0) - 0.5) * 0.16 + avNoise(p * 40.0) * 0.12 + 1.0;
  float checker = mod(floor(p.x / 0.022) + floor(p.y / 0.022) + floor(p.z / 0.022), 2.0);
  vec3 col = c1;
  col = mix(col, c2, isPat(pat, 1.0) * stripes);
  vec3 plaid = mix(mix(c1, c2, (plaidA + plaidB) * 0.5), vec3(0.92, 0.9, 0.84), over * 0.35);
  col = mix(col, plaid, isPat(pat, 2.0));
  vec3 camoCol = mix(mix(c1, mix(c1, c2, 0.5) * 1.25, camo), c2, camoDark);
  col = mix(col, camoCol, isPat(pat, 3.0));
  col = mix(col, c2, isPat(pat, 4.0) * sleeve);
  col = mix(col, c1 * twill, isPat(pat, 5.0));
  col = mix(col, mix(c1, c2, checker), isPat(pat, 6.0));
  return col;
}
float detail(float lum, float ref, float k) { return pow(clamp(lum / ref, 0.05, 2.4), k); }
float isRegion(float id, float r) { return step(abs(id - r), 0.5); }

void getAlbedo() {
  vec3 base = {STD_DIFFUSE_TEXTURE_DECODE}(texture2DBias({STD_DIFFUSE_TEXTURE_NAME}, {STD_DIFFUSE_TEXTURE_UV}, {STD_TEXTURE_BIAS})).rgb;
  float id = floor(texture2D(uMask, {STD_DIFFUSE_TEXTURE_UV}).r * (255.0 / ${MASK_STEP}.0) + 0.5);
  vec3 p = vVertexColor.xyz;
  float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
  vec3 skin = uSkin * detail(lum, uRefA.x, 0.85);
  vec3 top = patterned(uPat.x, uTop1, uTop2, p) * detail(lum, uRefA.z, 0.7);
  vec3 tee = uTee * detail(lum, uRefA.w, 0.85);
  vec3 pantsCol = patterned(uPat.y, uPants1, uPants2, p) * detail(lum, uRefB.x, 0.8);
  vec3 shoeUpper = patterned(uPat.z, uShoes1, uShoes2, p) * detail(lum, uRefB.y, 0.75);
  float shorts = isPat(uPat.y, 7.0) * step(p.y, uRig.z - 0.035);
  float highTop = isPat(uPat.z, 8.0) * step(p.y, uRig.w + 0.075);
  vec3 legSkin = uSkin * detail(lum, uRefB.x, 0.45) * 0.95;
  vec3 pants = mix(pantsCol, legSkin, shorts);
  pants = mix(pants, uShoes1 * detail(lum, uRefB.x, 0.7), highTop * (1.0 - shorts));
  vec3 soles = mix(uShoes2 * detail(lum, uRefB.z, 0.6), base, 0.15);
  vec3 o = base;
  o = mix(o, skin, isRegion(id, 1.0));
  o = mix(o, uHair * detail(lum, uRefA.y, 0.9), isRegion(id, 2.0));
  o = mix(o, top, isRegion(id, 3.0));
  o = mix(o, tee, isRegion(id, 4.0));
  o = mix(o, pants, isRegion(id, 5.0));
  o = mix(o, shoeUpper, isRegion(id, 6.0));
  o = mix(o, soles, isRegion(id, 7.0));
  o = mix(o, uEyes * detail(lum, uRefB.w, 0.7), isRegion(id, 8.0));
  dAlbedo = id < 0.5 ? base : o;
}`;

const SIDES = ['L', 'R'] as const;
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function linHex(hex: string): number[] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
}
const lum = (rgb: [number, number, number]) => Math.max(0.004, 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]));

interface BodyKit {
  body: Body;
  container: pc.ContainerResource;
  material: pc.StandardMaterial;
  joints: Record<string, pc.Vec3>;
  hipY: number;
  armDown: number;
}

/** Loads each scanned body once and prepares its shared recolor material. */
export class AvatarKits {
  private kits = new Map<Body, Promise<BodyKit | null>>();
  constructor(private assets: Assets, private device: pc.GraphicsDevice) {}

  get(body: Body) {
    let p = this.kits.get(body);
    if (!p) { p = this.load(body).catch(e => { console.warn('[foxplains2] avatar unavailable:', e); return null; }); this.kits.set(body, p); }
    return p;
  }

  private async load(body: Body): Promise<BodyKit | null> {
    const [container, mask] = await Promise.all([this.assets.container(`/modules/maplestreet/${body}.glb`), this.mask(`/modules/maplestreet/${body}-mask.png`)]);
    if (!container) return null;
    const probe = container.instantiateRenderEntity();
    const render = probe.findComponents('render')[0] as pc.RenderComponent | undefined;
    const mi = render?.meshInstances[0];
    if (!mi || !mi.mesh) return null;
    addRestPositions(this.device, mi.mesh);
    const src = mi.material as pc.StandardMaterial;
    const m = src.clone() as pc.StandardMaterial;
    m.name = `avatar-${body}`;
    m.diffuseVertexColor = true;
    m.diffuseVertexColorChannel = 'rgb';
    (m as unknown as { vertexColorGamma: boolean }).vertexColorGamma = false;
    m.useMetalness = true; m.metalness = 0; m.gloss = 0.22;
    m.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('diffusePS', RECOLOR_PS);
    m.shaderChunksVersion = '2.8';
    m.setParameter('uMask', mask);
    const joints: Record<string, pc.Vec3> = {};
    probe.syncHierarchy();
    probe.forEach(n => { joints[n.name] = n.getPosition().clone(); });
    const rig = RIG[body], J = joints;
    m.setParameter('uRig', [Math.abs(J.upperArmL.x), J.upperArmL.y, J.lowerLegL.y, J.footL.y]);
    m.setParameter('uRefA', [lum(rig.mean.skin), lum(rig.mean.hair), lum(rig.mean.jacket), lum(rig.mean.tee)]);
    m.setParameter('uRefB', [lum(rig.mean.pants), lum(rig.mean.shoes), lum(rig.mean.soles), lum(rig.mean.eyes)]);
    m.update();
    probe.destroy();
    const arm = J.lowerArmL.clone().sub(J.upperArmL);
    return { body, container, material: m, joints, hipY: J.upperLegL.y, armDown: Math.max(0, Math.atan2(Math.abs(arm.x), -arm.y) - 0.13) };
  }

  private async mask(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mask ${res.status}`);
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const t = new pc.Texture(this.device, { name: url, width: bmp.width, height: bmp.height, format: pc.PIXELFORMAT_RGBA8, mipmaps: false, minFilter: pc.FILTER_NEAREST, magFilter: pc.FILTER_NEAREST, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
    t.setSource(bmp as unknown as HTMLImageElement);
    return t;
  }
}

/** Appends a float RGBA vertex-color stream holding each vertex's rest position (once per mesh). */
function addRestPositions(device: pc.GraphicsDevice, mesh: pc.Mesh) {
  const vb = mesh.vertexBuffer as pc.VertexBuffer & { __rest?: boolean };
  if (vb.__rest) return;
  const fmt = vb.getFormat();
  const n = vb.getNumVertices();
  const src = new DataView(vb.lock() as ArrayBuffer);
  const posEl = fmt.elements.find(e => e.name === pc.SEMANTIC_POSITION)!;
  const elements = fmt.elements.filter(e => e.name !== pc.SEMANTIC_COLOR).map(e => ({ semantic: e.name, components: e.numComponents, type: e.dataType, normalize: e.normalize, asInt: e.asInt }));
  elements.push({ semantic: pc.SEMANTIC_COLOR, components: 4, type: pc.TYPE_FLOAT32, normalize: false, asInt: false });
  const next = new pc.VertexFormat(device, elements);
  const out = new ArrayBuffer(next.size * n);
  const dst = new DataView(out);
  const posType = posEl.dataType;
  for (const el of fmt.elements) {
    if (el.name === pc.SEMANTIC_COLOR) continue;
    const to = next.elements.find(e => e.name === el.name)!;
    const bytes = el.size;
    for (let v = 0; v < n; v++) {
      const a = el.offset + v * el.stride, b = to.offset + v * to.stride;
      for (let k = 0; k < bytes; k++) dst.setUint8(b + k, src.getUint8(a + k));
    }
  }
  const col = next.elements.find(e => e.name === pc.SEMANTIC_COLOR)!;
  for (let v = 0; v < n; v++) {
    const a = posEl.offset + v * posEl.stride, b = col.offset + v * col.stride;
    for (let k = 0; k < 3; k++) {
      const value = posType === pc.TYPE_FLOAT32 ? src.getFloat32(a + k * 4, true) : posType === pc.TYPE_INT16 ? src.getInt16(a + k * 2, true) / 32767 : src.getUint16(a + k * 2, true) / 65535;
      dst.setFloat32(b + k * 4, value, true);
    }
    dst.setFloat32(b + 12, 1, true);
  }
  const fresh = new pc.VertexBuffer(device, next, n, { data: out }) as pc.VertexBuffer & { __rest?: boolean };
  fresh.__rest = true;
  mesh.vertexBuffer = fresh;
}

/** Simple primitive body shown until the scan streams in (or if it can't load). */
class StandIn {
  readonly root = new pc.Entity('stand-in');
  private legs: pc.Entity[] = [];
  private arms: pc.Entity[] = [];
  private phase = 0;
  private mats: Record<'skin' | 'top' | 'pants' | 'hair', pc.StandardMaterial>;
  readonly hipY = 0.9;

  constructor(look: Look) {
    const mk = () => { const m = new pc.StandardMaterial(); m.useMetalness = true; m.gloss = 0.25; return m; };
    this.mats = { skin: mk(), top: mk(), pants: mk(), hair: mk() };
    const part = (parent: pc.Entity, type: 'capsule' | 'sphere', m: pc.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const e = new pc.Entity(); e.addComponent('render', { type, material: m }); e.setLocalPosition(x, y, z); e.setLocalScale(sx, sy, sz); parent.addChild(e); return e;
    };
    part(this.root, 'capsule', this.mats.top, 0, 1.22, 0, 0.42, 0.82, 0.3);
    part(this.root, 'sphere', this.mats.skin, 0, 1.68, 0, 0.26, 0.28, 0.26);
    part(this.root, 'sphere', this.mats.hair, 0, 1.74, -0.02, 0.27, 0.18, 0.27);
    for (const x of [-0.1, 0.1]) {
      const pivot = new pc.Entity(); pivot.setLocalPosition(x, 0.92, 0); this.root.addChild(pivot);
      part(pivot, 'capsule', this.mats.pants, 0, -0.44, 0, 0.15, 0.86, 0.15);
      this.legs.push(pivot);
    }
    for (const x of [-0.27, 0.27]) {
      const pivot = new pc.Entity(); pivot.setLocalPosition(x, 1.42, 0); this.root.addChild(pivot);
      part(pivot, 'capsule', this.mats.top, 0, -0.3, 0, 0.12, 0.62, 0.12);
      this.arms.push(pivot);
    }
    this.setLook(look);
  }

  setLook(look: Look) {
    const set = (m: pc.StandardMaterial, hex: string) => { const n = parseInt(hex.slice(1), 16); m.diffuse.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); m.update(); };
    set(this.mats.skin, look.skin); set(this.mats.top, look.topColor); set(this.mats.pants, look.pantsColor); set(this.mats.hair, look.hairColor);
  }

  animate(dt: number, speed: number, seated: boolean) {
    if (seated) {
      for (const l of this.legs) l.setLocalEulerAngles(-80, 0, 0);
      for (const a of this.arms) a.setLocalEulerAngles(-55, 0, 0);
      return;
    }
    this.phase = (this.phase + dt * gaitFrequency(speed)) % 1;
    const g = gaitPose(this.phase, speed);
    this.legs[0].setLocalEulerAngles(-g.legL.hip * pc.math.RAD_TO_DEG, 0, 0);
    this.legs[1].setLocalEulerAngles(-g.legR.hip * pc.math.RAD_TO_DEG, 0, 0);
    this.arms[0].setLocalEulerAngles(g.armL.arm * pc.math.RAD_TO_DEG, 0, 0);
    this.arms[1].setLocalEulerAngles(g.armR.arm * pc.math.RAD_TO_DEG, 0, 0);
  }
}

const _qx = new pc.Quat(), _qy = new pc.Quat(), _qz = new pc.Quat(), _q = new pc.Quat();
const AX = new pc.Vec3(1, 0, 0), AY = new pc.Vec3(0, 1, 0), AZ = new pc.Vec3(0, 0, 1);

/** One resident's body: a skeleton clone of the shared scan plus a procedural pose. */
export class Avatar {
  readonly root = new pc.Entity('avatar');
  private stub: StandIn | null;
  private model: pc.Entity | null = null;
  private mesh: pc.MeshInstance | null = null;
  private kit: BodyKit | null = null;
  private bones: Record<string, { node: pc.GraphNode; rest: pc.Quat; pos: pc.Vec3 }> = {};
  private wanted: Body;
  private phase = 0;
  private t = Math.random() * 10;
  private straddle = false;
  private seat: { x: number; y: number; z: number } | null = null;
  private disposed = false;
  seated = false;
  look: Look;

  constructor(private kits: AvatarKits, look: Look | string) {
    this.look = typeof look === 'string' ? { ...defaultLook('male'), topColor: look } : look;
    this.wanted = this.look.body;
    this.stub = new StandIn(this.look);
    this.root.addChild(this.stub.root);
    this.loadModel();
  }

  get hipY() { return this.kit?.hipY ?? this.stub?.hipY ?? 0.9; }

  private loadModel() {
    const body = this.wanted;
    void this.kits.get(body).then(kit => {
      if (!kit || this.disposed || this.wanted !== body) return;
      this.model?.destroy();
      const e = kit.container.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
      const render = e.findComponents('render')[0] as pc.RenderComponent;
      const mi = render.meshInstances[0];
      mi.material = kit.material;
      this.mesh = mi;
      this.kit = kit;
      this.bones = {};
      e.forEach(n => { this.bones[n.name] = { node: n, rest: n.getLocalRotation().clone(), pos: n.getLocalPosition().clone() }; });
      this.model = e;
      this.root.addChild(e);
      this.applyLook();
      if (this.stub) { this.stub.root.destroy(); this.stub = null; }
      if (this.seat) this.root.setLocalPosition(this.seat.x, this.seat.y - this.hipY, this.seat.z);
    });
  }

  setLook(look: Look) {
    this.look = look;
    this.stub?.setLook(look);
    if (look.body !== this.wanted) { this.wanted = look.body; this.loadModel(); return; }
    this.applyLook();
  }

  private applyLook() {
    const mi = this.mesh, L = this.look;
    if (!mi) return;
    mi.setParameter('uSkin', linHex(L.skin));
    mi.setParameter('uHair', linHex(L.hairColor));
    mi.setParameter('uEyes', linHex(L.eyes));
    mi.setParameter('uTee', linHex(L.tee));
    mi.setParameter('uTop1', linHex(L.topColor));
    mi.setParameter('uTop2', linHex(L.topColor2));
    mi.setParameter('uPants1', linHex(L.pantsColor));
    mi.setParameter('uPants2', linHex(L.pantsColor2));
    mi.setParameter('uShoes1', linHex(L.shoesColor));
    mi.setParameter('uShoes2', linHex(L.shoesColor2));
    const pat = (id: string) => PATTERNS.indexOf(WARDROBE_BY_ID[id]?.pattern ?? 'solid');
    mi.setParameter('uPat', [pat(L.top), pat(L.pants), pat(L.shoes)]);
  }

  /** Seat = hip position in the vehicle's chassis frame (vehicles face +X). */
  sitIn(vehicleRoot: pc.Entity, seat: { x: number; y: number; z: number; straddle?: boolean }) {
    this.root.parent?.removeChild(this.root);
    vehicleRoot.addChild(this.root);
    this.seat = seat;
    this.root.setLocalPosition(seat.x, seat.y - this.hipY, seat.z);
    this.root.setLocalEulerAngles(0, 90, 0);
    this.straddle = !!seat.straddle;
    this.seated = true;
  }

  standIn(parent: pc.Entity, footY: number) {
    this.root.parent?.removeChild(this.root);
    parent.addChild(this.root);
    this.seat = null;
    this.root.setLocalPosition(0, footY, 0);
    this.root.setLocalEulerAngles(0, 0, 0);
    this.seated = false;
  }

  private rot(name: string, x: number, y: number, z: number) {
    const b = this.bones[name];
    if (!b) return;
    _qx.setFromAxisAngle(AX, x * pc.math.RAD_TO_DEG);
    _qy.setFromAxisAngle(AY, y * pc.math.RAD_TO_DEG);
    _qz.setFromAxisAngle(AZ, z * pc.math.RAD_TO_DEG);
    _q.mul2(_qx, _qy).mul(_qz);
    b.node.setLocalRotation(_q.mul2(b.rest, _q));
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
      if (hips) hips.node.setLocalPosition(hips.pos.x, hips.pos.y, hips.pos.z);
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
    if (hips) hips.node.setLocalPosition(hips.pos.x, hips.pos.y + g.hipBob, hips.pos.z);
  }

  dispose() {
    this.disposed = true;
    this.root.destroy();
  }
}
