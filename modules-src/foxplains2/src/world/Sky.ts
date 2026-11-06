/**
 * Day and night. The clock follows the authority (24 real minutes per day,
 * the same sun path as Fox Plains: rises in the east at 6:00, sets in the
 * west at 18:00). It drives:
 *  - a sky dome shader (gradient, sun and moon discs, drifting clouds, stars)
 *  - the sun (or moon) as one directional light with cascaded shadows
 *  - image-based lighting: a small cube of the same sky, re-baked into an
 *    env atlas every quarter hour, so ambient light and reflections change
 *    color through dawn, noon, dusk and night
 *  - exponential fog in the horizon color, and exposure that opens up after dark
 */
import * as pc from 'playcanvas';
import type { Renderer, Quality } from '../core/Renderer';

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
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += vn(p) * a; p = p * 2.07 + vec2(3.1, 1.7); a *= 0.5; } return s; }

void main(void) {
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
  gl_FragColor = vec4(gammaCorrectOutput(toneMap(col)), 1.0);
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

const ENV_SIZE = 48;
/** Cube face directions, in the order +X −X +Y −Y +Z −Z. */
const FACE = (f: number, u: number, v: number): V3 => [
  [1, -v, -u], [-1, -v, u], [u, 1, v], [u, -1, -v], [u, -v, 1], [-u, -v, -1],
][f] as V3;

export class Sky {
  hours = 9;
  night = 0;
  dayK = 1;
  private dusk = 0;
  readonly sunDir = new pc.Vec3();
  readonly light: pc.Entity;
  private dome: pc.Entity;
  private mat: pc.ShaderMaterial;
  private time = 0;
  private envHours = -10;
  private envNight = -1;
  private env: { cube: pc.Texture; source: pc.Texture; atlas: pc.Texture } | null = null;
  private zenith: V3 = ZENITH_DAY;
  private horizon: V3 = HORIZON_DAY;
  private sunColor: V3 = SUN_DAY;
  private moonDir = new pc.Vec3();
  private cover = 0.38;
  private q = new pc.Quat();

  constructor(private r: Renderer) {
    const app = r.app;
    this.mat = new pc.ShaderMaterial({ uniqueName: 'FoxSkyDome', vertexGLSL: SKY_VS, fragmentGLSL: SKY_FS, attributes: { aPosition: pc.SEMANTIC_POSITION } });
    this.mat.cull = pc.CULLFACE_FRONT;
    this.mat.depthWrite = false;
    this.mat.update();
    this.dome = new pc.Entity('sky');
    this.dome.addComponent('render', { type: 'sphere', material: this.mat, castShadows: false, receiveShadows: false, layers: [r.skyLayer.id] });
    this.dome.setLocalScale(1600, 1600, 1600);
    app.root.addChild(this.dome);

    this.light = new pc.Entity('sun');
    this.light.addComponent('light', {
      type: 'directional', castShadows: true, shadowBias: 0.22, normalOffsetBias: 0.06, cascadeDistribution: 0.62,
      shadowUpdateMode: pc.SHADOWUPDATE_REALTIME, affectSpecularity: true,
    });
    app.root.addChild(this.light);
    this.applyQuality(r.quality);
    r.onQuality(q => this.applyQuality(q));

    const fog = app.scene.fog;
    fog.type = pc.FOG_EXP2;
    fog.density = 0.0011;
    app.scene.skyboxIntensity = 1;
    // Seed a varying cloud cover per real day so the sky isn't always the same.
    const day = Math.floor(Date.now() / 86_400_000);
    this.cover = 0.28 + ((day * 2654435761) % 1000) / 1000 * 0.3;
    this.update(0, r.camera.getPosition(), 1440);
  }

  private applyQuality(q: Quality) {
    const s = this.r.spec, l = this.light.light!;
    l.numCascades = s.cascades;
    l.shadowResolution = s.shadowRes;
    l.shadowDistance = s.shadowDistance;
    l.shadowType = q === 'low' ? pc.SHADOW_PCF3_32F : pc.SHADOW_PCF5_32F;
  }

  /** `serverHours`, when known, gently pulls the local clock toward the authority. */
  update(dt: number, camPos: pc.Vec3, dayLengthSec: number, serverHours?: number) {
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
    this.moonDir.copy(this.sunDir).mulScalar(-1);
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
    m.setParameter('uCover', this.cover);
    this.dome.setPosition(camPos);

    // Sun by day, moon by night: one light, so the light count (and every shader) never changes.
    const l = this.light.light!;
    const dir = elev > -0.05 ? this.sunDir : this.moonDir;
    if (elev > -0.05) {
      l.color = new pc.Color(this.sunColor[0], this.sunColor[1], this.sunColor[2]);
      l.intensity = 3.2 * dayK + 0.06;
    } else {
      l.color = new pc.Color(MOON[0], MOON[1], MOON[2]);
      l.intensity = 0.3 + 0.6 * smooth(-elev, 0.05, 0.3);
    }
    // A directional light shines down its local −Y: turn −Y onto −dir.
    this.q.setFromDirections(pc.Vec3.DOWN, new pc.Vec3(-dir.x, -dir.y, -dir.z));
    this.light.setRotation(this.q);

    const scene = this.r.app.scene;
    const fogCol = mix3(this.horizon, [0.5, 0.56, 0.62], 0.25 * dayK);
    scene.fog.color = new pc.Color(fogCol[0], fogCol[1], fogCol[2]);
    scene.fog.density = 0.00085 + dusk * 0.0006 + night * 0.0004;
    scene.exposure = 1.0 + night * 1.5;
    scene.ambientLight.set(0.015 + 0.09 * night, 0.02 + 0.1 * night, 0.03 + 0.14 * night);

    let dh = Math.abs(this.hours - this.envHours);
    if (dh > 12) dh = 24 - dh;
    if (dh > 0.25 || Math.abs(night - this.envNight) > 0.05) this.bakeEnvironment();
  }

  /** The sky (without clouds and stars) into a small cube, then PlayCanvas's prefiltered env atlas. */
  private bakeEnvironment() {
    this.envHours = this.hours; this.envNight = this.night;
    const device = this.r.device, S = ENV_SIZE;
    const faces: Uint8Array[] = [];
    const sun = this.sunDir, z = this.zenith, h = this.horizon, g = mix3(h, [0.1, 0.12, 0.09], 0.6), sc = this.sunColor;
    const sunUp = smooth(sun.y, -0.08, 0.02);
    for (let f = 0; f < 6; f++) {
      const px = new Uint8Array(S * S * 4);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = FACE(f, ((x + 0.5) / S) * 2 - 1, ((y + 0.5) / S) * 2 - 1);
        const l = Math.hypot(d[0], d[1], d[2]); const dx = d[0] / l, dy = d[1] / l, dz = d[2] / l;
        let c = mix3(h, z, Math.pow(Math.max(0, dy), 0.42));
        if (dy < 0) c = mix3(c, g, smooth(-dy, 0, 0.15));
        const sd = Math.max(0, dx * sun.x + dy * sun.y + dz * sun.z);
        const glow = (Math.pow(sd, 6) * 0.35 + Math.pow(sd, 32) * 0.6) * sunUp;
        c = [c[0] + sc[0] * glow, c[1] + sc[1] * glow, c[2] + sc[2] * glow];
        const i = (y * S + x) * 4;
        // Stored at half scale (and doubled by skyboxIntensity) so bright dawn glow doesn't clip.
        for (let k = 0; k < 3; k++) px[i + k] = Math.min(255, Math.pow(Math.min(1, c[k] * 0.5), 1 / 2.2) * 255);
        px[i + 3] = 255;
      }
      faces.push(px);
    }
    const cube = new pc.Texture(device, { name: 'sky-env', cubemap: true, width: S, height: S, format: pc.PIXELFORMAT_SRGBA8, mipmaps: false, levels: [faces] as unknown as Uint8Array[][], addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
    const source = pc.EnvLighting.generateLightingSource(cube, { size: 64 });
    const atlas = pc.EnvLighting.generateAtlas(source, { size: 256 });
    this.r.app.scene.envAtlas = atlas;
    if (this.env) { this.env.cube.destroy(); this.env.source.destroy(); this.env.atlas.destroy(); }
    this.env = { cube, source, atlas };
    this.r.app.scene.skyboxIntensity = 2 * (0.6 + this.dayK * 0.4 + this.dusk * 0.45 + this.night * 0.45);
  }

  get clockLabel() {
    const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60);
    return `${((h + 11) % 12) + 1}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }
}
