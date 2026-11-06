/**
 * The clipart sky: a clean gradient dome with a soft sun glow, puffy
 * fair-weather clouds and stars at night, one sun/moon light with cascaded
 * soft shadows, an env atlas baked from the same gradient (so glossy paint
 * and glass reflect the sky) and blue aerial haze that gives distance depth.
 *
 * Same structure as Fox Plains 2's sky, with a brighter, more saturated
 * palette from `LIGHT` in config.ts and a fixed hour set by the page.
 */
import * as pc from 'playcanvas';
import type { Renderer, Quality } from '../core/Renderer';
import { LIGHT } from '../../config';

const SKY_VS = /* glsl */ `
attribute vec3 aPosition;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec3 vDir;
void main(void) {
  vDir = aPosition;
  vec4 p = matrix_viewProjection * (matrix_model * vec4(aPosition, 1.0));
  gl_Position = p.xyww;
}`;

const SKY_FS = /* glsl */ `
#include "gammaPS"
#include "tonemappingPS"
varying vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uNight;
uniform float uTime;
uniform float uCover;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += vn(p) * a; p = p * 2.03 + vec2(3.1, 1.7); a *= 0.5; } return s; }

void main(void) {
  vec3 d = normalize(vDir);
  float y = d.y;
  float up = clamp(y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.5));
  col = mix(col, uGround, smoothstep(0.0, -0.1, y));

  float sd = max(dot(d, uSunDir), 0.0);
  float sunUp = smoothstep(-0.08, 0.02, uSunDir.y);
  col += uSunColor * (pow(sd, 5.0) * 0.16 + pow(sd, 40.0) * 0.4 + pow(sd, 500.0) * 1.6) * sunUp;
  col += uSunColor * smoothstep(0.99955, 0.99975, sd) * 50.0 * sunUp * step(0.0, y);

  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.8, 0.85, 0.98) * smoothstep(0.99962, 0.99978, md) * 2.5 * uNight;
  col += vec3(0.2, 0.25, 0.4) * pow(md, 24.0) * 0.25 * uNight;

  if (uNight > 0.01 && y > 0.0) {
    vec2 g = d.xz / (y + 1.0) * 300.0;
    vec2 c = floor(g);
    float r = h21(c);
    float star = step(0.993, r) * smoothstep(0.35, 0.0, length(fract(g) - 0.5));
    col += vec3(0.88, 0.92, 1.0) * star * uNight * smoothstep(0.02, 0.25, y) * 1.6;
  }

  if (y > 0.0) {
    vec2 cp = d.xz / max(y, 0.05) * 0.45 + vec2(uTime * 0.003, uTime * 0.001);
    float n = fbm(cp * 1.1);
    float puff = smoothstep(1.0 - uCover, 1.0 - uCover + 0.16, n);
    float dens = puff * smoothstep(0.02, 0.18, y);
    float lit = clamp((n - fbm(cp * 1.1 + uSunDir.xz * 0.1)) * 3.0 + 0.6, 0.0, 1.0);
    vec3 cloud = mix(uCloudShade, uCloudLit, lit);
    cloud += uSunColor * pow(sd, 4.0) * 0.3 * sunUp;
    col = mix(col, cloud, dens * 0.95);
  }
  gl_FragColor = vec4(gammaCorrectOutput(toneMap(col)), 1.0);
}`;

type V3 = [number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: readonly number[], b: readonly number[], t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (x: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const ENV_SIZE = 48;
const FACE = (f: number, u: number, v: number): V3 => [
  [1, -v, -u], [-1, -v, u], [u, 1, v], [u, -1, -v], [u, -v, 1], [-u, -v, -1],
][f] as V3;

export class Sky {
  hours = 13;
  night = 0;
  dayK = 1;
  private dusk = 0;
  readonly sunDir = new pc.Vec3();
  readonly light: pc.Entity;
  private dome: pc.Entity;
  private mat: pc.ShaderMaterial;
  private time = 0;
  private bakedHours = -10;
  private env: { cube: pc.Texture; source: pc.Texture; atlas: pc.Texture } | null = null;
  private zenith: V3 = [0, 0, 0];
  private horizon: V3 = [0, 0, 0];
  private sunColor: V3 = [1, 1, 1];
  private moonDir = new pc.Vec3();
  private q = new pc.Quat();

  constructor(private r: Renderer) {
    const app = r.app;
    this.mat = new pc.ShaderMaterial({ uniqueName: 'CountySkyDome', vertexGLSL: SKY_VS, fragmentGLSL: SKY_FS, attributes: { aPosition: pc.SEMANTIC_POSITION } });
    this.mat.cull = pc.CULLFACE_FRONT;
    this.mat.depthWrite = false;
    this.mat.update();
    this.dome = new pc.Entity('sky');
    this.dome.addComponent('render', { type: 'sphere', material: this.mat, castShadows: false, receiveShadows: false, layers: [r.skyLayer.id] });
    this.dome.setLocalScale(4000, 4000, 4000);
    app.root.addChild(this.dome);

    this.light = new pc.Entity('sun');
    this.light.addComponent('light', {
      type: 'directional', castShadows: true, shadowBias: 0.2, normalOffsetBias: 0.05, cascadeDistribution: 0.6,
      shadowUpdateMode: pc.SHADOWUPDATE_REALTIME, affectSpecularity: true,
    });
    app.root.addChild(this.light);
    this.applyQuality(r.quality);
    r.onQuality(q => this.applyQuality(q));
    app.scene.fog.type = pc.FOG_EXP2;
  }

  private applyQuality(q: Quality) {
    const s = this.r.spec, l = this.light.light!;
    l.numCascades = s.cascades;
    l.shadowResolution = s.shadowRes;
    l.shadowDistance = s.shadowDistance;
    l.shadowType = q === 'low' ? pc.SHADOW_PCF3_32F : pc.SHADOW_PCF5_32F;
  }

  setHours(h: number) { this.hours = ((h % 24) + 24) % 24; }

  update(dt: number, camPos: pc.Vec3) {
    this.time += dt;
    const theta = ((this.hours - 6) / 24) * Math.PI * 2;
    const elev = Math.sin(theta);
    this.sunDir.set(Math.cos(theta), elev * 0.9, 0.42).normalize();
    this.moonDir.copy(this.sunDir).mulScalar(-1);
    this.moonDir.y = Math.max(this.moonDir.y, 0.4);
    this.moonDir.normalize();

    const dayK = smooth(elev, -0.08, 0.22);
    const night = 1 - smooth(elev, -0.18, 0.05);
    const dusk = (1 - smooth(Math.abs(elev), 0, 0.3)) * (1 - night * 0.7);
    this.dayK = dayK; this.night = night; this.dusk = dusk;

    this.zenith = mix3(mix3(LIGHT.zenithNight, LIGHT.zenithDay, dayK), LIGHT.zenithDusk, dusk * 0.55);
    this.horizon = mix3(mix3(LIGHT.horizonNight, LIGHT.horizonDay, dayK), LIGHT.horizonDusk, dusk * 0.75);
    this.sunColor = mix3(LIGHT.sunDay, LIGHT.sunDusk, dusk);
    const ground = mix3(this.horizon, [0.18, 0.26, 0.16], 0.5);
    const cloudLit = mix3(mix3([0.06, 0.07, 0.1], [1.12, 1.1, 1.06], dayK), [1.0, 0.66, 0.46], dusk * 0.6);
    const cloudShade = mix3(mix3([0.03, 0.035, 0.05], [0.72, 0.78, 0.88], dayK), [0.52, 0.38, 0.45], dusk * 0.5);

    const m = this.mat;
    m.setParameter('uSunDir', [this.sunDir.x, this.sunDir.y, this.sunDir.z]);
    m.setParameter('uMoonDir', [this.moonDir.x, this.moonDir.y, this.moonDir.z]);
    m.setParameter('uZenith', this.zenith);
    m.setParameter('uHorizon', this.horizon);
    m.setParameter('uGround', ground);
    m.setParameter('uSunColor', this.sunColor);
    m.setParameter('uCloudLit', cloudLit);
    m.setParameter('uCloudShade', cloudShade);
    m.setParameter('uNight', night);
    m.setParameter('uTime', this.time);
    m.setParameter('uCover', LIGHT.cloudCover);
    this.dome.setPosition(camPos);

    const l = this.light.light!;
    const day = elev > -0.05;
    const dir = day ? this.sunDir : this.moonDir;
    if (day) {
      l.color = new pc.Color(this.sunColor[0], this.sunColor[1], this.sunColor[2]);
      l.intensity = LIGHT.sunIntensity * dayK + 0.06;
    } else {
      l.color = new pc.Color(0.58, 0.68, 0.96);
      l.intensity = 0.08 + LIGHT.moonIntensity * smooth(-elev, 0.05, 0.3);
    }
    this.q.setFromDirections(pc.Vec3.DOWN, new pc.Vec3(-dir.x, -dir.y, -dir.z));
    this.light.setRotation(this.q);

    const scene = this.r.app.scene;
    const fogCol = mix3(this.horizon, [0.62, 0.74, 0.88], 0.3 * dayK);
    scene.fog.color = new pc.Color(fogCol[0], fogCol[1], fogCol[2]);
    scene.fog.density = LIGHT.fogDensityDay + dusk * (LIGHT.fogDensityDusk - LIGHT.fogDensityDay) + night * (LIGHT.fogDensityNight - LIGHT.fogDensityDay);
    scene.exposure = 1.0 + night * 0.8;
    scene.ambientLight.set(0.02 + 0.03 * night, 0.025 + 0.035 * night, 0.04 + 0.05 * night);

    if (Math.abs(this.hours - this.bakedHours) > 0.2) this.bakeEnvironment();
  }

  /** The sky gradient without clouds or stars into a small cube, then the prefiltered env atlas. */
  private bakeEnvironment() {
    this.bakedHours = this.hours;
    const device = this.r.device, S = ENV_SIZE;
    const faces: Uint8Array[] = [];
    const sun = this.sunDir, z = this.zenith, h = this.horizon, g = mix3(h, [0.16, 0.24, 0.12], 0.6), sc = this.sunColor;
    const sunUp = smooth(sun.y, -0.08, 0.02);
    for (let f = 0; f < 6; f++) {
      const px = new Uint8Array(S * S * 4);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = FACE(f, ((x + 0.5) / S) * 2 - 1, ((y + 0.5) / S) * 2 - 1);
        const l = Math.hypot(d[0], d[1], d[2]); const dx = d[0] / l, dy = d[1] / l, dz = d[2] / l;
        let c = mix3(h, z, Math.pow(Math.max(0, dy), 0.5));
        if (dy < 0) c = mix3(c, g, smooth(-dy, 0, 0.15));
        const sd = Math.max(0, dx * sun.x + dy * sun.y + dz * sun.z);
        const glow = (Math.pow(sd, 6) * 0.35 + Math.pow(sd, 32) * 0.6) * sunUp;
        c = [c[0] + sc[0] * glow, c[1] + sc[1] * glow, c[2] + sc[2] * glow];
        const i = (y * S + x) * 4;
        for (let k = 0; k < 3; k++) px[i + k] = Math.min(255, Math.pow(Math.min(1, c[k] * 0.5), 1 / 2.2) * 255);
        px[i + 3] = 255;
      }
      faces.push(px);
    }
    const cube = new pc.Texture(device, { name: 'county-sky-env', cubemap: true, width: S, height: S, format: pc.PIXELFORMAT_SRGBA8, mipmaps: false, levels: [faces] as unknown as Uint8Array[][], addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
    const source = pc.EnvLighting.generateLightingSource(cube, { size: 64 });
    const atlas = pc.EnvLighting.generateAtlas(source, { size: 256 });
    this.r.app.scene.envAtlas = atlas;
    if (this.env) { this.env.cube.destroy(); this.env.source.destroy(); this.env.atlas.destroy(); }
    this.env = { cube, source, atlas };
    this.r.app.scene.skyboxIntensity = LIGHT.skyLight * (0.55 + this.dayK * 0.4 + this.dusk * 0.45 + this.night * 0.5);
  }

  get clockLabel() {
    const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60);
    return `${((h + 11) % 12) + 1}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }
}
