/**
 * Day and night. The clock follows the authority (24 real minutes per day,
 * the same sun path as Fox Plains: rises in the east at 6:00, sets in the
 * west at 18:00). It drives:
 *  - a sky dome shader (gradient, sun and moon discs, drifting clouds, stars),
 *    written in WGSL and GLSL, drawn in linear HDR before tone mapping
 *  - the sun (or moon) as one directional light with cascaded shadows; the
 *    casters' bounds are frozen to the town so no frame walks every mesh
 *  - image-based lighting: a small half-float cube of the same sky, rewritten
 *    in place every quarter hour with its irradiance projected straight to
 *    spherical harmonics, so ambient light and reflections change colour
 *    through dawn, noon, dusk and night without allocating new textures
 *  - exponential fog in the horizon colour, and exposure that opens up after dark
 */
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture';
import { SphericalHarmonics, SphericalPolynomial } from '@babylonjs/core/Maths/sphericalPolynomial';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo';
import { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import '@babylonjs/core/Engines/Extensions/engine.rawTexture';
import type { Renderer, Quality } from '../core/Renderer';
import { WORLD_HALF } from '../../../maplestreet/shared/WorldLayout';

const SKY_GLSL_VS = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(void) {
  vDir = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

const SKY_GLSL_FS = `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec4 uParams;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += vn(p) * a; p = p * 2.07 + vec2(3.1, 1.7); a *= 0.5; } return s; }
void main(void) {
  float uNight = uParams.x, uTime = uParams.y, uCover = uParams.z;
  vec3 d = normalize(vDir);
  float y = d.y;
  float up = clamp(y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.42));
  col = mix(col, uGround, smoothstep(0.0, -0.12, y));
  float sd = max(dot(d, uSunDir), 0.0);
  float sunUp = smoothstep(-0.08, 0.02, uSunDir.y);
  col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 48.0) * 0.45 + pow(sd, 600.0) * 2.0) * sunUp;
  col += uSunColor * smoothstep(0.99955, 0.99975, sd) * 60.0 * sunUp * step(0.0, y);
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.75, 0.8, 0.95) * smoothstep(0.99962, 0.99978, md) * 2.5 * uNight;
  col += vec3(0.18, 0.22, 0.34) * pow(md, 30.0) * 0.25 * uNight;
  if (uNight > 0.01 && y > 0.0) {
    vec2 g = d.xz / (y + 1.0) * 300.0;
    vec2 c = floor(g);
    float r = h21(c);
    float star = step(0.9935, r) * smoothstep(0.35, 0.0, length(fract(g) - 0.5));
    float tw = 0.65 + 0.35 * sin(uTime * 2.3 + r * 90.0);
    col += vec3(0.85, 0.9, 1.0) * star * tw * uNight * smoothstep(0.02, 0.25, y) * 1.6;
  }
  if (y > 0.0) {
    vec2 cp = d.xz / max(y, 0.04) * 0.55 + vec2(uTime * 0.0035, uTime * 0.0012);
    float n = fbm(cp * 1.3);
    float dens = smoothstep(1.0 - uCover, 1.0 - uCover + 0.3, n) * smoothstep(0.015, 0.2, y);
    float lit = clamp(n - fbm(cp * 1.3 + uSunDir.xz * 0.12) + 0.55, 0.0, 1.0);
    vec3 cloud = mix(uCloudShade, uCloudLit, lit);
    cloud += uSunColor * pow(sd, 5.0) * 0.35 * sunUp;
    col = mix(col, cloud, dens * 0.9);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const SKY_WGSL_VS = `
attribute position: vec3f;
uniform worldViewProjection: mat4x4f;
varying vDir: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vDir = vertexInputs.position;
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
}`;

const SKY_WGSL_FS = `
varying vDir: vec3f;
uniform uSunDir: vec3f;
uniform uMoonDir: vec3f;
uniform uZenith: vec3f;
uniform uHorizon: vec3f;
uniform uGround: vec3f;
uniform uSunColor: vec3f;
uniform uCloudLit: vec3f;
uniform uCloudShade: vec3f;
uniform uParams: vec4f;
fn h21(q: vec2f) -> f32 { var p = fract(q * vec2f(123.34, 456.21)); p = p + dot(p, p + 45.32); return fract(p.x * p.y); }
fn vn(p: vec2f) -> f32 { let i = floor(p); var f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2f(1.0, 0.0)), f.x), mix(h21(i + vec2f(0.0, 1.0)), h21(i + vec2f(1.0, 1.0)), f.x), f.y); }
fn fbm(q: vec2f) -> f32 { var s = 0.0; var a = 0.5; var p = q; for (var i = 0; i < 5; i++) { s += vn(p) * a; p = p * 2.07 + vec2f(3.1, 1.7); a *= 0.5; } return s; }
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uNight = uniforms.uParams.x; let uTime = uniforms.uParams.y; let uCover = uniforms.uParams.z;
  let d = normalize(fragmentInputs.vDir);
  let y = d.y;
  let up = clamp(y, 0.0, 1.0);
  var col = mix(uniforms.uHorizon, uniforms.uZenith, pow(up, 0.42));
  col = mix(col, uniforms.uGround, smoothstep(0.0, -0.12, y));
  let sd = max(dot(d, uniforms.uSunDir), 0.0);
  let sunUp = smoothstep(-0.08, 0.02, uniforms.uSunDir.y);
  col += uniforms.uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 48.0) * 0.45 + pow(sd, 600.0) * 2.0) * sunUp;
  col += uniforms.uSunColor * smoothstep(0.99955, 0.99975, sd) * 60.0 * sunUp * step(0.0, y);
  let md = max(dot(d, uniforms.uMoonDir), 0.0);
  col += vec3f(0.75, 0.8, 0.95) * smoothstep(0.99962, 0.99978, md) * 2.5 * uNight;
  col += vec3f(0.18, 0.22, 0.34) * pow(md, 30.0) * 0.25 * uNight;
  if (uNight > 0.01 && y > 0.0) {
    let g = d.xz / (y + 1.0) * 300.0;
    let c = floor(g);
    let r = h21(c);
    let star = step(0.9935, r) * smoothstep(0.35, 0.0, length(fract(g) - 0.5));
    let tw = 0.65 + 0.35 * sin(uTime * 2.3 + r * 90.0);
    col += vec3f(0.85, 0.9, 1.0) * star * tw * uNight * smoothstep(0.02, 0.25, y) * 1.6;
  }
  if (y > 0.0) {
    let cp = d.xz / max(y, 0.04) * 0.55 + vec2f(uTime * 0.0035, uTime * 0.0012);
    let n = fbm(cp * 1.3);
    let dens = smoothstep(1.0 - uCover, 1.0 - uCover + 0.3, n) * smoothstep(0.015, 0.2, y);
    let lit = clamp(n - fbm(cp * 1.3 + uniforms.uSunDir.xz * 0.12) + 0.55, 0.0, 1.0);
    var cloud = mix(uniforms.uCloudShade, uniforms.uCloudLit, lit);
    cloud += uniforms.uSunColor * pow(sd, 5.0) * 0.35 * sunUp;
    col = mix(col, cloud, dens * 0.9);
  }
  fragmentOutputs.color = vec4f(col, 1.0);
}`;

type V3 = [number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (x: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const ZENITH_DAY: V3 = [0.12, 0.3, 0.72], HORIZON_DAY: V3 = [0.58, 0.71, 0.86];
const ZENITH_DUSK: V3 = [0.16, 0.18, 0.4], HORIZON_DUSK: V3 = [0.98, 0.5, 0.26];
const ZENITH_NIGHT: V3 = [0.004, 0.007, 0.02], HORIZON_NIGHT: V3 = [0.022, 0.03, 0.055];
const SUN_DAY: V3 = [1, 0.95, 0.86], SUN_DUSK: V3 = [1, 0.55, 0.28];
const MOON: V3 = [0.55, 0.66, 0.95];

const ENV_SIZE = 32;
/** Cube face directions in texture space, in the order +X −X +Y −Y +Z −Z. */
const FACE = (f: number, u: number, v: number): V3 => {
  switch (f) {
    case 0: return [1, -v, -u];
    case 1: return [-1, -v, u];
    case 2: return [u, 1, v];
    case 3: return [u, -1, -v];
    case 4: return [u, -v, 1];
    default: return [-u, -v, -1];
  }
};

/** Float → IEEE half (for the half-float environment cube). */
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function half(v: number) {
  f32[0] = v;
  const x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return s;
  if (e >= 31) return s | 0x7c00;
  return s | (e << 10) | (m >>> 13);
}

export class Sky {
  hours = 9;
  night = 0;
  dayK = 1;
  private dusk = 0;
  readonly sunDir = new Vector3();
  readonly light: DirectionalLight;
  private shadows: CascadedShadowGenerator | null = null;
  private dome: Mesh;
  private mat: ShaderMaterial;
  private time = 0;
  private envHours = -10;
  private envNight = -1;
  private env: RawCubeTexture | null = null;
  private faces: Uint16Array[] = [];
  private zenith: V3 = ZENITH_DAY;
  private horizon: V3 = HORIZON_DAY;
  private sunColor: V3 = SUN_DAY;
  private moonDir = new Vector3();
  private cover = 0.38;
  private readonly _dir = new Vector3();
  private readonly _c = new Color3();
  /** One vector per sky uniform: ShaderMaterial keeps the reference it is given. */
  private readonly u = { zenith: new Vector3(), horizon: new Vector3(), ground: new Vector3(), sun: new Vector3(), cloudLit: new Vector3(), cloudShade: new Vector3() };
  private readonly _p4 = new Vector4(0, 0, 0, 0);
  private readonly casterBounds = new BoundingInfo(new Vector3(-WORLD_HALF, -2, -WORLD_HALF), new Vector3(WORLD_HALF, 60, WORLD_HALF));

  constructor(private r: Renderer) {
    const scene = r.scene;
    const wgsl = r.backend === 'webgpu';
    this.mat = new ShaderMaterial('fox-sky', scene, wgsl ? { vertexSource: SKY_WGSL_VS, fragmentSource: SKY_WGSL_FS } : { vertexSource: SKY_GLSL_VS, fragmentSource: SKY_GLSL_FS }, {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'uSunDir', 'uMoonDir', 'uZenith', 'uHorizon', 'uGround', 'uSunColor', 'uCloudLit', 'uCloudShade', 'uParams'],
      shaderLanguage: wgsl ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
    });
    this.mat.backFaceCulling = false;
    this.mat.disableDepthWrite = true;
    this.mat.depthFunction = Constants.LEQUAL;
    this.dome = CreateSphere('sky', { diameter: 2, segments: 24 }, scene);
    this.dome.material = this.mat;
    this.dome.scaling.setAll(1600);
    this.dome.infiniteDistance = true;
    this.dome.isPickable = false;
    this.dome.alwaysSelectAsActiveMesh = true;
    this.dome.applyFog = false;
    r.excludeFromPrePass(this.mat);

    this.light = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
    this.light.shadowMinZ = 0;
    this.light.shadowMaxZ = 600;
    this.light.autoUpdateExtends = false;
    this.applyQuality(r.quality);
    r.onQuality(q => this.applyQuality(q));
    r.casterListener = (m, add) => {
      const sm = this.shadows?.getShadowMap();
      if (!sm) return;
      if (add) this.shadows!.addShadowCaster(m, false); else this.shadows!.removeShadowCaster(m, false);
    };

    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0011;
    scene.environmentIntensity = 1;
    const day = Math.floor(Date.now() / 86_400_000);
    this.cover = 0.28 + ((day * 2654435761) % 1000) / 1000 * 0.3;
    this.update(0, 1440);
  }

  private applyQuality(q: Quality) {
    const s = this.r.spec;
    this.shadows?.dispose();
    const g = new CascadedShadowGenerator(s.shadowRes, this.light);
    g.numCascades = s.cascades;
    g.lambda = 0.62;
    g.shadowMaxZ = s.shadowDistance;
    g.stabilizeCascades = true;
    g.depthClamp = true;
    g.autoCalcDepthBounds = false;
    g.cascadeBlendPercentage = 0.08;
    g.bias = 0.0012;
    g.normalBias = 0.012;
    g.filter = ShadowGenerator.FILTER_PCF;
    g.filteringQuality = q === 'low' ? ShadowGenerator.QUALITY_LOW : q === 'medium' ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_HIGH;
    g.transparencyShadow = false;
    g.freezeShadowCastersBoundingInfo = true;
    g.shadowCastersBoundingInfo = this.casterBounds;
    const sm = g.getShadowMap();
    if (sm) {
      sm.refreshRate = 1;
      sm.getCustomRenderList = (layer, list, len) => this.cullCascade(g, layer, list, len);
    }
    for (const m of this.r.shadowCasters) g.addShadowCaster(m as AbstractMesh, false);
    this.shadows = g;
  }

  private culled: AbstractMesh[] = [];
  /**
   * Babylon draws every caster into every cascade; this keeps only the ones
   * whose bounding sphere overlaps the cascade's light-space rectangle (the
   * depth range is clamped, so casters between the sun and the cascade still
   * count). Reuses one array: nothing is allocated per frame.
   */
  private cullCascade(g: CascadedShadowGenerator, layer: number, list: Readonly<AbstractMesh[]> | null, len: number) {
    const mtx = g.getCascadeTransformMatrix(layer);
    if (!mtx || !list || this.r.warming) return null;
    const a = mtx.m, out = this.culled;
    const sx = Math.hypot(a[0], a[4], a[8]), sy = Math.hypot(a[1], a[5], a[9]);
    out.length = 0;
    for (let i = 0; i < len; i++) {
      const mesh = list[i];
      if (!mesh.isEnabled() || !mesh.isVisible) continue;
      const bs = mesh.getBoundingInfo().boundingSphere, c = bs.centerWorld, r = bs.radiusWorld;
      const x = c.x * a[0] + c.y * a[4] + c.z * a[8] + a[12];
      const y = c.x * a[1] + c.y * a[5] + c.z * a[9] + a[13];
      if (Math.abs(x) - r * sx > 1 || Math.abs(y) - r * sy > 1) continue;
      out.push(mesh);
    }
    return out;
  }

  /** `serverHours`, when known, gently pulls the local clock toward the authority. */
  update(dt: number, dayLengthSec: number, serverHours?: number) {
    this.time += dt;
    this.hours = (this.hours + (dt * 24) / dayLengthSec) % 24;
    if (serverHours !== undefined) {
      let diff = serverHours - this.hours;
      if (diff > 12) diff -= 24; if (diff < -12) diff += 24;
      this.hours = (this.hours + diff * Math.min(1, dt * 2) + 24) % 24;
    }
    const theta = ((this.hours - 6) / 24) * Math.PI * 2;
    const elev = Math.sin(theta);
    this.sunDir.set(Math.cos(theta), elev * 0.93, 0.38).normalize();
    this.moonDir.copyFrom(this.sunDir).scaleInPlace(-1);
    this.moonDir.y = Math.max(this.moonDir.y, 0.35);
    this.moonDir.normalize();

    const dayK = smooth(elev, -0.08, 0.22);
    const night = 1 - smooth(elev, -0.18, 0.05);
    const dusk = (1 - smooth(Math.abs(elev), 0, 0.3)) * (1 - night * 0.7);
    this.dayK = dayK; this.night = night; this.dusk = dusk;

    this.zenith = mix3(mix3(ZENITH_NIGHT, ZENITH_DAY, dayK), ZENITH_DUSK, dusk * 0.55);
    this.horizon = mix3(mix3(HORIZON_NIGHT, HORIZON_DAY, dayK), HORIZON_DUSK, dusk * 0.75);
    this.sunColor = mix3(SUN_DAY, SUN_DUSK, dusk);
    const ground = mix3(this.horizon, [0.12, 0.13, 0.11], 0.55);
    const cloudLit = mix3(mix3([0.05, 0.06, 0.08], [1.05, 1.03, 1.0], dayK), [1.0, 0.62, 0.42], dusk * 0.6);
    const cloudShade = mix3(mix3([0.02, 0.025, 0.035], [0.55, 0.6, 0.68], dayK), [0.45, 0.3, 0.35], dusk * 0.5);

    const m = this.mat, u = this.u;
    m.setVector3('uSunDir', this.sunDir);
    m.setVector3('uMoonDir', this.moonDir);
    m.setVector3('uZenith', u.zenith.set(...this.zenith));
    m.setVector3('uHorizon', u.horizon.set(...this.horizon));
    m.setVector3('uGround', u.ground.set(...ground));
    m.setVector3('uSunColor', u.sun.set(...this.sunColor));
    m.setVector3('uCloudLit', u.cloudLit.set(...cloudLit));
    m.setVector3('uCloudShade', u.cloudShade.set(...cloudShade));
    m.setVector4('uParams', this._p4.set(night, this.time, this.cover, 0));

    const l = this.light;
    const dir = elev > -0.05 ? this.sunDir : this.moonDir;
    if (elev > -0.05) {
      l.diffuse.set(this.sunColor[0], this.sunColor[1], this.sunColor[2]);
      l.intensity = 3.4 * dayK + 0.06;
    } else {
      l.diffuse.set(MOON[0], MOON[1], MOON[2]);
      l.intensity = 0.3 + 0.6 * smooth(-elev, 0.05, 0.3);
    }
    l.specular.copyFrom(l.diffuse);
    l.direction.copyFrom(this._dir.set(-dir.x, -dir.y, -dir.z));

    const scene = this.r.scene;
    const fogCol = mix3(this.horizon, [0.5, 0.56, 0.62], 0.25 * dayK);
    scene.fogColor.copyFrom(this._c.set(fogCol[0], fogCol[1], fogCol[2]));
    scene.fogDensity = 0.00085 + dusk * 0.0006 + night * 0.0004;
    this.r.setExposure(1.0 + night * 1.5);

    let dh = Math.abs(this.hours - this.envHours);
    if (dh > 12) dh = 24 - dh;
    if (dh > 0.25 || Math.abs(night - this.envNight) > 0.05) this.bakeEnvironment();
  }

  /**
   * The sky (without clouds and stars) into a small half-float cube that is
   * rewritten in place, plus its irradiance as spherical harmonics. Babylon
   * looks cube maps up with z flipped in a right-handed scene, so texture
   * direction (x, y, z) holds the world sky at (x, y, −z).
   */
  private bakeEnvironment() {
    this.envHours = this.hours; this.envNight = this.night;
    const S = ENV_SIZE;
    const sun = this.sunDir, z = this.zenith, h = this.horizon, g = mix3(h, [0.1, 0.12, 0.09], 0.6), sc = this.sunColor;
    const sunUp = smooth(sun.y, -0.08, 0.02);
    const k = 2 * (0.6 + this.dayK * 0.4 + this.dusk * 0.45 + this.night * 0.45);
    const sh = new SphericalHarmonics();
    const dir = new Vector3(), col = new Color3();
    let total = 0;
    if (!this.faces.length) for (let f = 0; f < 6; f++) this.faces.push(new Uint16Array(S * S * 4));
    for (let f = 0; f < 6; f++) {
      const px = this.faces[f];
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = ((x + 0.5) / S) * 2 - 1, v = ((y + 0.5) / S) * 2 - 1;
        const d = FACE(f, u, v);
        const l = Math.hypot(d[0], d[1], d[2]); const tx = d[0] / l, ty = d[1] / l, tz = d[2] / l;
        const dx = tx, dy = ty, dz = -tz;
        let c = mix3(h, z, Math.pow(Math.max(0, dy), 0.42));
        if (dy < 0) c = mix3(c, g, smooth(-dy, 0, 0.15));
        const sd = Math.max(0, dx * sun.x + dy * sun.y + dz * sun.z);
        const glow = (Math.pow(sd, 6) * 0.35 + Math.pow(sd, 32) * 0.6) * sunUp;
        const r = (c[0] + sc[0] * glow) * k, gg = (c[1] + sc[1] * glow) * k, b = (c[2] + sc[2] * glow) * k;
        const i = (y * S + x) * 4;
        px[i] = half(r); px[i + 1] = half(gg); px[i + 2] = half(b); px[i + 3] = half(1);
        const tmp = 1 + u * u + v * v, solid = 4 / (Math.sqrt(tmp) * tmp) * (4 / (S * S));
        sh.addLight(dir.set(tx, ty, tz), col.set(r, gg, b), solid);
        total += solid;
      }
    }
    sh.scaleInPlace((4 * Math.PI) / total);
    sh.convertIncidentRadianceToIrradiance();
    sh.convertIrradianceToLambertianRadiance();
    const scene = this.r.scene;
    if (!this.env) {
      this.env = new RawCubeTexture(scene, this.faces, S, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_HALF_FLOAT, true, false, Constants.TEXTURE_TRILINEAR_SAMPLINGMODE);
      this.env.gammaSpace = false;
      this.env.lodGenerationScale = 0.8;
      scene.environmentTexture = this.env;
    } else this.env.update(this.faces, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_HALF_FLOAT, false);
    this.env.sphericalPolynomial = SphericalPolynomial.FromHarmonics(sh);
  }

  get clockLabel() {
    const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60);
    return `${((h + 11) % 12) + 1}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }
}
