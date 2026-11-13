/**
 * Real paint for scanned vehicle bodies. A scan is one mesh with everything
 * painted into one picture: the paint itself comes out blotchy and matte, with
 * lumps in the shading, which reads as watercolour on canvas. Three things
 * fix that, all at load and none of them touching the published file:
 *
 *  - Paint mask: the texels of the body's own colour (the record's paint key,
 *    or the dominant body colour found near its showroom colour) become a
 *    one-channel mask. Where the mask is set the shader (CarPaintPlugin) draws
 *    one even paint colour with only a little of the scan's shading left in,
 *    a smooth surface instead of the scan's bump map, and paint's own gloss.
 *    Trim, grilles, lamps, handles and seams keep the picture as it is.
 *  - Clear coat: the same mask drives a glossy clear layer over the paint that
 *    reflects the vehicle environment (CarEnv) from the geometry's own normal.
 *  - Smooth normals: the scan's vertex normals are averaged across its UV
 *    seams and over a few centimetres of surface, never across an edge
 *    sharper than the crease angle, so reflections run cleanly over a panel
 *    instead of wobbling. Positions don't move.
 *
 * Repainting is a uniform, so every colour of a model shares one picture and
 * one mask.
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { Material } from '@babylonjs/core/Materials/material';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Geometry } from '@babylonjs/core/Meshes/geometry';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { carEnvTexture } from './CarEnv';
import { microBump } from '../../../rackreel/world/MicroBump';

/** How a finish looks: the paint layer's roughness and metal, and the clear coat over it. */
export interface PaintFinish { rough: number; metal: number; coat: number; coatRough: number }
export const PAINT_FINISH: Record<'gloss' | 'metallic' | 'matte', PaintFinish> = {
  gloss: { rough: 0.34, metal: 0.02, coat: 1, coatRough: 0.035 },
  metallic: { rough: 0.3, metal: 0.22, coat: 1, coatRough: 0.05 },
  matte: { rough: 0.62, metal: 0, coat: 0.18, coatRough: 0.5 },
};

/** How much of the scan's own light-and-dark stays in the paint (panel gaps and creases read through; blotches don't). */
const KEEP_SHADING = 0.3;
/** How far the scan's bump map is flattened under the paint. */
const FLATTEN = 0.85;
const AUTO_TOLERANCE = 0.2;
const HINT_REACH = 0.3;
const MIN_SHARE = 0.04;
/** The faint orange-peel grain in the clear coat: how often it repeats across the body picture, and how deep it reads. */
const PEEL_REPEAT = 90;
const PEEL_DEPTH = 0.035;
const CREASE_DEG = 38;
/** The stretch of surface, in metres, that normals are averaged over. */
const SMOOTH_REACH = 0.07;

const GLSL_DEFS = `
#ifdef CARPAINT
uniform sampler2D carPaintMaskSampler;
float cpMask = 0.0;
#endif
`;

const GLSL_MAIN = `
#ifdef CARPAINT
{
  cpMask = texture2D(carPaintMaskSampler, vAlbedoUV).r;
  float cpLum = dot(surfaceAlbedo, vec3(0.2126, 0.7152, 0.0722));
  float cpShade = mix(1.0, clamp(cpLum / max(carPaintLook.x, 0.004), 0.45, 1.3), carPaintLook.y);
  surfaceAlbedo = mix(surfaceAlbedo, carPaintColor * cpShade, cpMask);
  normalW = normalize(mix(normalW, geometricNormalW, cpMask * carPaintLook.z));
}
#endif
`;

const WGSL_DEFS = `
#ifdef CARPAINT
var carPaintMaskSamplerSampler: sampler;
var carPaintMaskSampler: texture_2d<f32>;
#endif
`;

const WGSL_MAIN = `
#ifdef CARPAINT
var cpMask: f32 = 0.0;
{
  cpMask = textureSample(carPaintMaskSampler, carPaintMaskSamplerSampler, fragmentInputs.vAlbedoUV).r;
  let cpLum = dot(surfaceAlbedo, vec3f(0.2126, 0.7152, 0.0722));
  let cpShade = mix(1.0, clamp(cpLum / max(uniforms.carPaintLook.x, 0.004), 0.45, 1.3), uniforms.carPaintLook.y);
  surfaceAlbedo = mix(surfaceAlbedo, uniforms.carPaintColor * cpShade, cpMask);
  normalW = normalize(mix(normalW, geometricNormalW, cpMask * uniforms.carPaintLook.z));
}
#endif
`;

export class CarPaintPlugin extends MaterialPluginBase {
  private maskTex: BaseTexture | null = null;
  /** Paint colour, linear. */
  readonly color: [number, number, number] = [0.5, 0.5, 0.5];
  keyLum = 0.2;
  keep = KEEP_SHADING;
  flatten = FLATTEN;
  rough = PAINT_FINISH.metallic.rough;

  constructor(material: Material) {
    super(material, 'CarPaint', 215, { CARPAINT: false });
    this._enable(true);
  }

  get mask(): BaseTexture | null { return this.maskTex; }
  set mask(t: BaseTexture | null) {
    if (t === this.maskTex) return;
    this.maskTex = t;
    this.markAllDefinesAsDirty();
  }

  override getClassName() { return 'CarPaintPlugin'; }
  override isCompatible() { return true; }

  override prepareDefines(defines: Record<string, unknown>) {
    defines.CARPAINT = !!this.maskTex && !!(this._material as PBRMaterial).albedoTexture;
  }

  override isReadyForSubMesh() { return !this.maskTex || this.maskTex.isReady(); }

  override getSamplers(samplers: string[]) { samplers.push('carPaintMaskSampler'); }

  override getUniforms(shaderLanguage?: ShaderLanguage) {
    const ubo = [{ name: 'carPaintColor', size: 3, type: 'vec3' }, { name: 'carPaintLook', size: 4, type: 'vec4' }];
    return shaderLanguage === ShaderLanguage.WGSL ? { ubo } : { ubo, fragment: '#ifdef CARPAINT\nuniform vec3 carPaintColor;\nuniform vec4 carPaintLook;\n#endif' };
  }

  override bindForSubMesh(ubo: UniformBuffer) {
    ubo.updateFloat3('carPaintColor', this.color[0], this.color[1], this.color[2]);
    ubo.updateFloat4('carPaintLook', this.keyLum, this.keep, this.flatten, this.rough);
    if (this.maskTex) ubo.setTexture('carPaintMaskSampler', this.maskTex);
  }

  override getActiveTextures(list: BaseTexture[]) { if (this.maskTex) list.push(this.maskTex); }

  override getCustomCode(shaderType: string, shaderLanguage?: ShaderLanguage): { [point: string]: string } | null {
    if (shaderType === 'vertex') return null;
    return shaderLanguage === ShaderLanguage.WGSL
      ? {
        CUSTOM_FRAGMENT_DEFINITIONS: WGSL_DEFS,
        CUSTOM_FRAGMENT_UPDATE_ALPHA: WGSL_MAIN,
        '!var roughness: f32=reflectivityOut\\.roughness;': '#ifdef CARPAINT\nvar roughness: f32=mix(reflectivityOut.roughness,uniforms.carPaintLook.w,cpMask);\n#else\nvar roughness: f32=reflectivityOut.roughness;\n#endif\n',
      }
      : {
        CUSTOM_FRAGMENT_DEFINITIONS: GLSL_DEFS,
        CUSTOM_FRAGMENT_UPDATE_ALPHA: GLSL_MAIN,
        '!float roughness=reflectivityOut\\.roughness;': '#ifdef CARPAINT\nfloat roughness=mix(reflectivityOut.roughness,carPaintLook.w,cpMask);\n#else\nfloat roughness=reflectivityOut.roughness;\n#endif\n',
      };
  }
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const parseHex = (h: string): [number, number, number] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const lumOf = (rgb: [number, number, number]) => 0.2126 * toLinear(rgb[0] / 255) + 0.7152 * toLinear(rgb[1] / 255) + 0.0722 * toLinear(rgb[2] / 255);

export interface PaintMask {
  tex: BaseTexture;
  /** The body colour the mask was cut around, sRGB 0–255. */
  key: [number, number, number];
  /** Its linear luminance. */
  keyLum: number;
  /** Share of the picture that is paint. */
  share: number;
}

export interface PaintHint {
  /** `#rrggbb`: the exact key colour (`exact`), or a colour the body is close to. */
  color: string;
  tolerance: number;
  exact: boolean;
}

const masks = new Map<string, Promise<PaintMask | null>>();

function median(hist: Uint32Array, total: number): number {
  let run = 0;
  for (let i = 0; i < 256; i++) { run += hist[i]; if (run * 2 >= total) return i; }
  return 255;
}

/** The body colour of a picture: the median of everything near the hint, else the most common colour that isn't near-black. */
function bodyColor(px: Uint8Array, hint: [number, number, number]): [number, number, number] | null {
  const count = px.length / 4;
  const reach = (HINT_REACH * 441.7) ** 2;
  const near = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let hits = 0;
  for (let i = 0; i < px.length; i += 4) {
    const dr = px[i] - hint[0], dg = px[i + 1] - hint[1], db = px[i + 2] - hint[2];
    if (dr * dr + dg * dg + db * db > reach) continue;
    near[0][px[i]]++; near[1][px[i + 1]]++; near[2][px[i + 2]]++;
    hits++;
  }
  if (hits >= count * MIN_SHARE) return [median(near[0], hits), median(near[1], hits), median(near[2], hits)];
  const bins = new Uint32Array(32768);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i] + px[i + 1] + px[i + 2] < 90) continue;
    bins[((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3)]++;
  }
  let best = 0, at = -1;
  for (let b = 0; b < bins.length; b++) if (bins[b] > best) { best = bins[b]; at = b; }
  if (at < 0 || best < count * 0.01) return null;
  return [((at >> 10) & 31) * 8 + 4, ((at >> 5) & 31) * 8 + 4, (at & 31) * 8 + 4];
}

/** The paint mask of a body's colour picture (shared by every vehicle that draws it), or null when it has no clear body colour. */
export function paintMaskFor(albedo: BaseTexture, hint: PaintHint, scene: Scene): Promise<PaintMask | null> {
  const size = albedo.getSize();
  const id = `${albedo.uniqueId}|${size.width}x${size.height}|${hint.color}|${hint.tolerance}|${hint.exact ? 1 : 0}`;
  let entry = masks.get(id);
  if (!entry) {
    entry = (async (): Promise<PaintMask | null> => {
      const read = await albedo.readPixels(0, 0, null, true, true);
      if (!read || !size.width || !size.height) return null;
      const px = new Uint8Array(read.buffer, read.byteOffset, read.byteLength);
      const key = hint.exact ? parseHex(hint.color) : bodyColor(px, parseHex(hint.color));
      if (!key) return null;
      const limit = ((hint.exact ? hint.tolerance : AUTO_TOLERANCE) * 441.7) ** 2;
      const out = new Uint8Array(size.width * size.height);
      let paint = 0;
      for (let i = 0, o = 0; i < px.length; i += 4, o++) {
        const dr = px[i] - key[0], dg = px[i + 1] - key[1], db = px[i + 2] - key[2];
        const d = dr * dr + dg * dg + db * db;
        if (d > limit) continue;
        const v = Math.min(1, (1 - d / limit) * 3);
        out[o] = Math.round(v * 255);
        if (v > 0.5) paint++;
      }
      const share = paint / out.length;
      if (share < MIN_SHARE) return null;
      const tex = RawTexture.CreateRTexture(out, size.width, size.height, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
      tex.name = 'car-paint-mask';
      tex.anisotropicFilteringLevel = 8;
      const src = albedo as Texture;
      tex.wrapU = src.wrapU; tex.wrapV = src.wrapV;
      return { tex, key, keyLum: lumOf(key), share };
    })().catch(() => null);
    masks.set(id, entry);
  }
  return entry;
}

const smoothed = new WeakSet<Geometry>();

/**
 * Re-averages a scan's vertex normals (once per geometry): the same normal for every copy of a point along a UV seam,
 * then blended with the points around it over about SMOOTH_REACH of surface, stopping at edges sharper than the crease
 * angle. `metresPerUnit` is the mesh's scale in the world.
 */
export function smoothScanNormals(mesh: Mesh, metresPerUnit: number): void {
  const geo = mesh.geometry;
  if (!geo || smoothed.has(geo)) return;
  smoothed.add(geo);
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const idx = mesh.getIndices();
  if (!pos || !idx || idx.length < 3) return;
  const verts = pos.length / 3, tris = Math.floor(idx.length / 3);

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < verts; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const q = 65535 / span;
  const cluster = new Int32Array(verts);
  const seen = new Map<number, number>();
  let clusters = 0;
  for (let i = 0; i < verts; i++) {
    const key = Math.round((pos[i * 3] - minX) * q) + Math.round((pos[i * 3 + 1] - minY) * q) * 65537 + Math.round((pos[i * 3 + 2] - minZ) * q) * 4295098369;
    let c = seen.get(key);
    if (c === undefined) { c = clusters++; seen.set(key, c); }
    cluster[i] = c;
  }

  const face = new Float32Array(tris * 3);
  const unit = new Float32Array(tris * 3);
  let area = 0;
  for (let t = 0; t < tris; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    face[t * 3] = nx; face[t * 3 + 1] = ny; face[t * 3 + 2] = nz;
    if (l > 0) { unit[t * 3] = nx / l; unit[t * 3 + 1] = ny / l; unit[t * 3 + 2] = nz / l; }
    area += l / 2;
  }

  const start = new Int32Array(clusters + 1);
  for (let i = 0; i < tris * 3; i++) start[cluster[idx[i]] + 1]++;
  for (let c = 0; c < clusters; c++) start[c + 1] += start[c];
  const fill = start.slice(0, clusters);
  const list = new Int32Array(tris * 3);
  for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) list[fill[cluster[idx[t * 3 + k]]]++] = t;

  let normals = new Float32Array(verts * 3);
  for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) {
    const v = idx[t * 3 + k] * 3;
    normals[v] += face[t * 3]; normals[v + 1] += face[t * 3 + 1]; normals[v + 2] += face[t * 3 + 2];
  }
  const normalize = (n: Float32Array) => {
    for (let i = 0; i < verts; i++) {
      const l = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
      if (l > 0) { n[i * 3] /= l; n[i * 3 + 1] /= l; n[i * 3 + 2] /= l; }
    }
  };
  normalize(normals);

  const cos = Math.cos((CREASE_DEG * Math.PI) / 180);
  const welded = new Float32Array(verts * 3);
  for (let v = 0; v < verts; v++) {
    const c = cluster[v];
    const mx = normals[v * 3], my = normals[v * 3 + 1], mz = normals[v * 3 + 2];
    let x = 0, y = 0, z = 0;
    for (let j = start[c]; j < start[c + 1]; j++) {
      const t = list[j] * 3;
      if (unit[t] * mx + unit[t + 1] * my + unit[t + 2] * mz < cos) continue;
      x += face[t]; y += face[t + 1]; z += face[t + 2];
    }
    if (x === 0 && y === 0 && z === 0) { x = mx; y = my; z = mz; }
    welded[v * 3] = x; welded[v * 3 + 1] = y; welded[v * 3 + 2] = z;
  }
  normalize(welded);
  normals = welded;

  const edge = Math.sqrt((area / Math.max(1, tris)) * 2.3) * metresPerUnit;
  const passes = Math.min(10, Math.max(2, Math.round(SMOOTH_REACH / Math.max(edge, 1e-4))));
  for (let pass = 0; pass < passes; pass++) {
    const next = new Float32Array(verts * 3);
    for (let v = 0; v < verts; v++) {
      const c = cluster[v];
      const mx = normals[v * 3], my = normals[v * 3 + 1], mz = normals[v * 3 + 2];
      let x = mx, y = my, z = mz;
      for (let j = start[c]; j < start[c + 1]; j++) {
        const t = list[j];
        if (unit[t * 3] * mx + unit[t * 3 + 1] * my + unit[t * 3 + 2] * mz < cos) continue;
        for (let k = 0; k < 3; k++) {
          const u = idx[t * 3 + k] * 3;
          if (normals[u] * mx + normals[u + 1] * my + normals[u + 2] * mz < cos) continue;
          x += normals[u]; y += normals[u + 1]; z += normals[u + 2];
        }
      }
      next[v * 3] = x; next[v * 3 + 1] = y; next[v * 3 + 2] = z;
    }
    normalize(next);
    normals = next;
  }
  mesh.setVerticesData(VertexBuffer.NormalKind, normals, false);
}

/** One body material dressed as paint: `paint` sets its colour (null keeps the scan's own), finish and wear. */
export interface PaintJob {
  readonly material: PBRMaterial;
  paint(hex: string | null, finish: PaintFinish, wear: number): void;
}

/**
 * Dresses a per-vehicle body material (never one shared between vehicles: the plugin has to be added before the
 * material first draws). The paint and clear coat switch on when the mask has been read; until then, and for a body
 * with no clear paint colour, it draws as authored.
 */
export function dressPaint(material: PBRMaterial, albedo: BaseTexture, hint: PaintHint, alive: () => boolean): PaintJob {
  const scene = material.getScene();
  const plugin = new CarPaintPlugin(material);
  let mask: PaintMask | null = null;
  let want: { hex: string | null; finish: PaintFinish; wear: number } = { hex: null, finish: PAINT_FINISH.metallic, wear: 0 };
  const env = carEnvTexture();
  if (env) material.reflectionTexture = env;
  material.enableSpecularAntiAliasing = true;

  const apply = () => {
    if (!mask) return;
    const { hex, finish, wear } = want;
    const rgb = hex ? parseHex(hex) : mask.key;
    plugin.color[0] = toLinear(rgb[0] / 255); plugin.color[1] = toLinear(rgb[1] / 255); plugin.color[2] = toLinear(rgb[2] / 255);
    plugin.keyLum = mask.keyLum;
    plugin.rough = Math.min(1, finish.rough + wear * 0.3);
    plugin.mask = mask.tex;
    const cc = material.clearCoat;
    cc.isEnabled = true;
    cc.intensity = finish.coat * (1 - wear * 0.8);
    cc.roughness = Math.min(1, finish.coatRough + wear * 0.25);
    cc.indexOfRefraction = 1.5;
    cc.texture = mask.tex;
    cc.useRoughnessFromMainTexture = false;
    if (!cc.bumpTexture) {
      const peel = microBump(scene, 'grain').clone();
      peel.uScale = PEEL_REPEAT; peel.vScale = PEEL_REPEAT; peel.level = PEEL_DEPTH;
      cc.bumpTexture = peel;
      material.onDisposeObservable.addOnce(() => peel.dispose());
    }
    material.metallic = Math.max(material.metallic ?? 0, finish.metal);
  };

  void paintMaskFor(albedo, hint, scene).then(m => {
    if (!m || !alive()) return;
    mask = m;
    apply();
  });

  return {
    material,
    paint(hex, finish, wear) { want = { hex, finish, wear }; apply(); },
  };
}
