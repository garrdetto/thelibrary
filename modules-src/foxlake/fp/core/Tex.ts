/**
 * Procedural surfaces: every texture in the town is painted at start-up from
 * seeded noise (no image downloads), each with a matching normal map and a
 * roughness map so the PBR lighting picks out asphalt grain, brick courses,
 * siding laps and shingle rows. Geometry carries UVs in metres; each
 * material's `tile` says how many metres one copy of its texture covers.
 *
 * GPU side: one upload per surface (sRGB colour with hardware mipmaps and
 * anisotropic filtering, linear normal and roughness/metal maps); materials
 * that tile the same surface at another scale share that upload through a
 * texture view, so the whole town is a few dozen textures.
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import type { InternalTexture } from '@babylonjs/core/Materials/Textures/internalTexture';
import { GroundPlugin, type GroundLook } from './GroundShader';
import { toLinear } from './Geo';

// ---------------------------------------------------------------- noise

function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
/** Tileable value noise on a `period`-cell lattice. */
function vnoise(x: number, y: number, period: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a: number) => ((a % period) + period) % period;
  const a = hash(w(xi), w(yi), s), b = hash(w(xi + 1), w(yi), s), c = hash(w(xi), w(yi + 1), s), d = hash(w(xi + 1), w(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Tileable fractal noise in 0..1; (x, y) in 0..1 over the texture. */
function fbm(x: number, y: number, base: number, oct: number, s: number) {
  let sum = 0, amp = 0.5, f = base, tot = 0;
  for (let i = 0; i < oct; i++) { sum += vnoise(x * f, y * f, f, s + i * 17) * amp; tot += amp; amp *= 0.5; f *= 2; }
  return sum / tot;
}

// ---------------------------------------------------------------- painting

interface Painted { color: Uint8Array; height: Float32Array; gloss: Float32Array; glossMean: number; w: number; h: number }
/** r g b (0..1 sRGB), height, and optionally gloss (0..1, a multiplier on the recipe's gloss; default from height: crevices are rougher). */
type Painter = (x: number, y: number, u: number, v: number) => [number, number, number, number] | [number, number, number, number, number];

function paint(size: number, fn: Painter): Painted {
  const color = new Uint8Array(size * size * 4), height = new Float32Array(size * size), gloss = new Float32Array(size * size);
  let sum = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = fn(x, y, x / size, y / size);
    const i = y * size + x;
    color[i * 4] = clamp01(p[0]) * 255; color[i * 4 + 1] = clamp01(p[1]) * 255; color[i * 4 + 2] = clamp01(p[2]) * 255; color[i * 4 + 3] = 255;
    height[i] = p[3];
    const g = clamp01(p[4] ?? 0.72 + 0.28 * clamp01(p[3]));
    gloss[i] = g;
    sum += g;
  }
  return { color, height, gloss, glossMean: sum / (size * size), w: size, h: size };
}

/** World-scale noise for the ground plugin (GroundShader.ts): R blend between two reads, G brightness drift, B dry or worn patches. */
function macroNoise(scene: Scene) {
  const size = 256, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4;
    data[i] = fbm(u, v, 4, 4, 301) * 255;
    data[i + 1] = fbm(u, v, 6, 4, 302) * 255;
    data[i + 2] = clamp01((fbm(u, v, 3, 5, 303) - 0.5) * 1.8 + 0.5) * 255;
    data[i + 3] = 255;
  }
  return texture(scene, 'ground-macro', data, size, size, false, 4);
}

function normalsFrom(p: Pick<Painted, 'height' | 'w' | 'h'>, strength: number) {
  const { w, h, height } = p;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const hx = height[y * w + ((x + 1) % w)] - height[y * w + ((x - 1 + w) % w)];
    const hy = height[((y + 1) % h) * w + x] - height[((y - 1 + h) % h) * w + x];
    let nx = -hx * strength, ny = hy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return out;
}

/** What a surface keeps after upload: only the gloss channel, for roughness maps made later at other gloss levels. */
interface GlossOnly { gloss: Float32Array; glossMean: number; w: number; h: number }

/** Roughness in G and metalness in B (the metallic-roughness texture layout), for one material gloss level. */
function roughnessMap(p: GlossOnly, gloss: number, metal: number) {
  const out = new Uint8Array(p.w * p.h * 4), k = gloss / p.glossMean, m = metal > 0 ? 255 : 0;
  for (let i = 0; i < p.gloss.length; i++) {
    out[i * 4] = 255;
    out[i * 4 + 1] = clamp01(1 - Math.min(1, k * p.gloss[i]) * 0.96) * 255;
    out[i * 4 + 2] = m;
    out[i * 4 + 3] = 255;
  }
  return out;
}

let anisotropy = 8;
/** Anisotropic filtering for every surface texture made from now on (the quality tier sets it at start-up). */
export function setAnisotropy(n: number) { anisotropy = n; }

function texture(scene: Scene, name: string, data: Uint8Array, w: number, h: number, srgb: boolean, aniso = anisotropy) {
  const t = new RawTexture(data, w, h, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE, undefined, srgb);
  t.name = name;
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = aniso;
  t.gammaSpace = false;
  return t;
}

/** Another Texture object on the same GPU upload, with its own tiling. */
function view(src: Texture, tile: number, name: string) {
  const t = new Texture(null, src.getScene());
  t.name = name;
  const internal = src.getInternalTexture() as InternalTexture;
  internal.incrementReferences();
  (t as unknown as { _texture: InternalTexture })._texture = internal;
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = src.anisotropicFilteringLevel;
  t.gammaSpace = src.gammaSpace;
  t.uScale = t.vScale = 1 / tile;
  return t;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const C = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const lerp3 = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul3 = (a: number[], k: number): [number, number, number] => [clamp01(a[0] * k), clamp01(a[1] * k), clamp01(a[2] * k)];
/** An sRGB hex colour as a linear Color3 (PBR albedo and emissive are linear). */
export const lin3 = (hex: number | readonly [number, number, number]) => { const c = typeof hex === 'number' ? C(hex) : hex; return new Color3(toLinear(c[0]), toLinear(c[1]), toLinear(c[2])); };

// ---------------------------------------------------------------- surface recipes

type Recipe = { size: number; tile: number; bump: number; gloss: number; metal?: number; paint: Painter };

const R: Record<string, () => Recipe> = {
  // Wild grass: clumps, bright blade tips, dark soil showing between, drier tufts.
  grass: () => ({ size: 512, tile: 6, bump: 1.7, gloss: 0.22, paint: (x, y, u, v) => {
    const n = fbm(u, v, 6, 5, 3), clump = fbm(u, v, 20, 3, 4), m = fbm(u, v, 3, 3, 9), blade = hash(x, y, 5), streak = hash(x >> 1, y, 6);
    let c = lerp3(C(0x3d5a29), C(0x6a8642), n);
    c = lerp3(c, C(0x8d8a56), Math.max(0, m - 0.58) * 1.6);
    const tip = blade > 0.84 ? 0.15 : 0, gap = blade < 0.07 ? -0.24 : 0;
    const k = 0.8 + clump * 0.22 + tip + gap + (streak - 0.5) * 0.1;
    return [...mul3(c, k), clamp01(0.35 + clump * 0.35 + tip * 2 + gap * 1.5), clamp01(0.45 + blade * 0.55 + gap * 2)] as [number, number, number, number, number];
  } }),
  // Lawn: finer and denser than the wild grass, a touch bluer.
  lawn: () => ({ size: 512, tile: 3.2, bump: 1.9, gloss: 0.24, paint: (x, y, u, v) => {
    const n = fbm(u, v, 10, 4, 21), clump = fbm(u, v, 32, 3, 23), blade = hash(x, y, 8), streak = hash(x, y >> 1, 9);
    const c = lerp3(C(0x436f2f), C(0x6a9446), n);
    const tip = blade > 0.86 ? 0.13 : 0, gap = blade < 0.05 ? -0.2 : 0;
    const k = 0.82 + clump * 0.18 + tip + gap + (streak - 0.5) * 0.08;
    return [...mul3(c, k), clamp01(0.4 + clump * 0.3 + tip * 2 + gap * 1.5), clamp01(0.5 + blade * 0.5 + gap * 2)] as [number, number, number, number, number];
  } }),
  // Asphalt: dark binder, light aggregate stones that catch the light, pits, hairline cracks.
  asphalt: () => ({ size: 512, tile: 5, bump: 1.25, gloss: 0.4, paint: (x, y, u, v) => {
    const n = fbm(u, v, 6, 4, 31), patch = fbm(u, v, 2, 3, 37), stone = hash(x >> 1, y >> 1, 2), fine = hash(x, y, 3);
    let k = 0.19 + n * 0.03 + (patch - 0.5) * 0.04 + (fine - 0.5) * 0.03, h = 0.35 + n * 0.2, g = 0.62;
    if (stone > 0.88) { k += 0.07 + fine * 0.1; h = 0.85; g = 0.95; }
    else if (stone < 0.1) { k -= 0.04; h = 0.12; g = 0.35; }
    if (Math.abs(fbm(u, v, 4, 4, 39) - 0.5) < 0.004 && fbm(u, v, 3, 2, 41) > 0.62) { k *= 0.82; h = 0.1; g = 0.4; }
    return [k, k * 1.01, k * 1.03, h, g];
  } }),
  concrete: () => ({ size: 256, tile: 2, bump: 1.6, gloss: 0.24, paint: (x, y, u, v) => {
    const n = fbm(u, v, 6, 4, 41), sp = hash(x, y, 4);
    const joint = Math.min(x, y, 255 - x, 255 - y) < 2 ? -0.18 : 0;
    const k = 0.66 + n * 0.1 + (sp - 0.5) * 0.05 + joint;
    return [k, k * 0.99, k * 0.96, n * 0.5 + sp * 0.2 + joint * 2, clamp01(0.6 + sp * 0.4 + joint * 2)];
  } }),
  curb: () => ({ size: 128, tile: 1, bump: 1, gloss: 0.2, paint: (x, y, u, v) => { const k = 0.72 + fbm(u, v, 4, 3, 44) * 0.1 + (hash(x, y, 5) - 0.5) * 0.04; return [k, k, k * 0.97, k]; } }),
  gravel: () => ({ size: 256, tile: 3, bump: 3, gloss: 0.1, paint: (x, y, u, v) => {
    const n = fbm(u, v, 24, 3, 51), s = hash(Math.floor(x / 3), Math.floor(y / 3), 6);
    const k = 0.36 + n * 0.2 + s * 0.12;
    return [k * 1.02, k, k * 0.92, n * 0.6 + s * 0.4];
  } }),
  dirt: () => ({ size: 256, tile: 5, bump: 1.5, gloss: 0.08, paint: (_x, _y, u, v) => { const n = fbm(u, v, 8, 5, 61); return [...lerp3(C(0x6b5236), C(0x8f7350), n), n] as [number, number, number, number]; } }),
  brick: () => ({ size: 256, tile: 2.4, bump: 2.5, gloss: 0.12, paint: (_x, _y, u, v) => {
    const rows = 32, cols = 8;
    const row = Math.floor(v * rows), off = (row % 2) * 0.5, col = Math.floor(u * cols + off);
    const fu = (u * cols + off) % 1, fv = (v * rows) % 1;
    const mortar = fu < 0.05 || fv < 0.14;
    const tone = hash(col, row, 7);
    const n = fbm(u, v, 16, 3, 71);
    if (mortar) { const k = 0.75 + n * 0.08; return [k, k * 0.97, k * 0.92, 0]; }
    const k = 0.8 + tone * 0.35 + n * 0.12 - 0.15;
    return [clamp01(k), clamp01(k * 0.98), clamp01(k * 0.95), 0.6 + n * 0.4];
  } }),
  siding: () => ({ size: 256, tile: 2.4, bump: 2.2, gloss: 0.3, paint: (_x, _y, u, v) => {
    const laps = 12, f = (v * laps) % 1;
    const shade = 0.86 + f * 0.16 - (f > 0.94 ? 0.25 : 0);
    const grain = fbm(u * 0.2, v, 64, 2, 81) * 0.05;
    const k = shade + grain;
    return [clamp01(k), clamp01(k), clamp01(k), f];
  } }),
  boards: () => ({ size: 256, tile: 2.4, bump: 2, gloss: 0.26, paint: (_x, _y, u, v) => {
    const n = 8, f = (u * n) % 1, batten = f < 0.12;
    const k = (batten ? 1.02 : 0.92) + fbm(u, v * 0.2, 32, 2, 85) * 0.06;
    return [clamp01(k), clamp01(k), clamp01(k), batten ? 1 : 0.2];
  } }),
  stucco: () => ({ size: 256, tile: 2, bump: 2.6, gloss: 0.1, paint: (x, y, u, v) => { const n = fbm(u, v, 16, 4, 91), s = hash(x, y, 9); const k = 0.86 + n * 0.12 + (s - 0.5) * 0.06; return [k, k, k, n * 0.8 + s * 0.2]; } }),
  stone: () => ({ size: 256, tile: 2.4, bump: 3.2, gloss: 0.14, paint: (_x, _y, u, v) => {
    const rows = 7, row = Math.floor(v * rows), fv = (v * rows) % 1;
    const w = 3 + Math.floor(hash(row, 0, 3) * 3), off = hash(row, 1, 3);
    const fu = (u * w + off) % 1, col = Math.floor(u * w + off);
    const mortar = fu < 0.05 || fv < 0.07 || fu > 0.97;
    const tone = hash(col, row, 11), n = fbm(u, v, 12, 4, 101);
    if (mortar) return [0.42, 0.4, 0.37, 0];
    const k = 0.55 + tone * 0.3 + n * 0.15;
    return [k, k * 0.97, k * 0.92, 0.5 + n * 0.5];
  } }),
  shingles: () => ({ size: 256, tile: 2, bump: 3, gloss: 0.12, paint: (_x, _y, u, v) => {
    const rows = 10, row = Math.floor(v * rows), off = (row % 2) * 0.5, fv = (v * rows) % 1;
    const tabs = 6, col = Math.floor(u * tabs + off), fu = (u * tabs + off) % 1;
    const tone = hash(col, row, 13), n = fbm(u, v, 32, 3, 111);
    const k = 0.62 + tone * 0.28 + n * 0.18 - (fu < 0.03 ? 0.3 : 0) - (fv > 0.9 ? 0.25 : 0);
    return [clamp01(k), clamp01(k), clamp01(k), fv * 0.8 + n * 0.2];
  } }),
  roofFlat: () => ({ size: 256, tile: 4, bump: 2, gloss: 0.08, paint: (x, y, u, v) => { const n = fbm(u, v, 12, 4, 121), s = hash(x, y, 12); const k = 0.38 + n * 0.12 + s * 0.06; return [k, k, k * 1.02, n * 0.5 + s * 0.5]; } }),
  planks: () => ({ size: 256, tile: 2, bump: 1.4, gloss: 0.5, paint: (_x, _y, u, v) => {
    const n = 8, row = Math.floor(v * n), fv = (v * n) % 1, off = hash(row, 2, 5);
    const seam = fv < 0.04 || ((u + off) % 0.5) < 0.006;
    const grain = fbm((u + off) * 0.25, v * 4, 32, 3, 131 + row);
    const k = 0.8 + grain * 0.3 + hash(row, 3, 5) * 0.12 - (seam ? 0.35 : 0);
    return [clamp01(k), clamp01(k), clamp01(k), seam ? 0 : 0.6];
  } }),
  herringbone: () => ({ size: 256, tile: 1.6, bump: 1.2, gloss: 0.5, paint: (_x, _y, u, v) => {
    const s = 8, a = u * s, b = v * s, k2 = Math.floor((a + b) / 2), l = (a - b) / 2;
    const flip = (Math.floor(l) + k2) % 2 === 0;
    const along = flip ? (a + b) % 2 : ((a - b) % 2 + 2) % 2;
    const tone = hash(Math.floor(a), Math.floor(b), 15), seam = along < 0.06;
    const k = 0.78 + tone * 0.25 - (seam ? 0.3 : 0);
    return [clamp01(k), clamp01(k), clamp01(k), seam ? 0 : 0.5];
  } }),
  tile: () => ({ size: 256, tile: 1.2, bump: 1.8, gloss: 0.7, paint: (x, y) => { const g = (x % 64) < 3 || (y % 64) < 3; const k = g ? 0.6 : 0.94 + hash(x >> 6, y >> 6, 17) * 0.05; return [k, k, k, g ? 0 : 1]; } }),
  subway: () => ({ size: 256, tile: 1.2, bump: 1.6, gloss: 0.8, paint: (x, y) => { const row = y >> 4, g = (y % 16) < 2 || ((x + (row % 2) * 16) % 32) < 2; const k = g ? 0.7 : 0.97; return [k, k, k, g ? 0 : 1]; } }),
  marble: () => ({ size: 256, tile: 2.4, bump: 0.4, gloss: 0.85, paint: (_x, _y, u, v) => { const n = fbm(u, v, 4, 6, 141), vein = Math.abs(Math.sin((u + n * 2.2) * 12)); const k = 0.93 - Math.pow(1 - vein, 14) * 0.35; return [k, k, k * 1.01, 0.5]; } }),
  carpet: () => ({ size: 256, tile: 1.5, bump: 1.5, gloss: 0.02, paint: (x, y, u, v) => { const n = fbm(u, v, 32, 3, 151), s = hash(x, y, 19); const k = 0.85 + n * 0.1 + s * 0.08; return [k, k, k, s]; } }),
  slate: () => ({ size: 256, tile: 1.6, bump: 2.4, gloss: 0.3, paint: (x, y, u, v) => { const g = (x % 128) < 3 || (y % 128) < 3; const n = fbm(u, v, 8, 4, 161); const k = g ? 0.3 : 0.42 + n * 0.16 + hash(x >> 7, y >> 7, 21) * 0.1; return [k, k * 1.02, k * 1.06, g ? 0 : n]; } }),
  deck: () => ({ size: 256, tile: 2, bump: 2, gloss: 0.25, paint: (_x, _y, u, v) => { const n = 7, f = (u * n) % 1, gap = f < 0.06; const g = fbm(u * 4, v * 0.3, 32, 3, 171); const k = gap ? 0.25 : 0.8 + g * 0.25; return [k, k, k, gap ? 0 : 0.6]; } }),
  patio: () => ({ size: 256, tile: 1.8, bump: 2.2, gloss: 0.2, paint: (x, y, u, v) => { const g = (x % 85) < 3 || (y % 85) < 3; const n = fbm(u, v, 10, 3, 181); const k = g ? 0.45 : 0.72 + n * 0.12 + hash(Math.floor(x / 85), Math.floor(y / 85), 23) * 0.08; return [k, k * 0.97, k * 0.92, g ? 0 : n]; } }),
  damask: () => ({ size: 256, tile: 1, bump: 0.4, gloss: 0.2, paint: (_x, _y, u, v) => { const d = Math.abs(Math.sin(u * Math.PI * 4) * Math.sin(v * Math.PI * 4)); const k = d > 0.6 ? 0.82 : 1; return [k, k, k, d]; } }),
  stripe: () => ({ size: 256, tile: 1, bump: 0.2, gloss: 0.2, paint: (_x, _y, u) => { const k = (u * 10) % 1 < 0.5 ? 1 : 0.86; return [k, k, k, 0]; } }),
  woodPanel: () => ({ size: 256, tile: 1.6, bump: 1.4, gloss: 0.4, paint: (_x, _y, u, v) => { const n = 5, f = (u * n) % 1, seam = f < 0.03; const g = fbm(u * 3, v * 0.3, 32, 3, 191); const k = seam ? 0.45 : 0.78 + g * 0.25; return [k, k, k, seam ? 0 : 0.7]; } }),
  bark: () => ({ size: 128, tile: 1.2, bump: 3, gloss: 0.08, paint: (_x, _y, u, v) => { const n = fbm(u * 4, v * 0.5, 16, 4, 201); const k = 0.6 + n * 0.5; return [clamp01(k), clamp01(k), clamp01(k), n]; } }),
  garage: () => ({ size: 256, tile: 1, bump: 2, gloss: 0.4, paint: (_x, _y, _u, v) => { const f = (v * 4) % 1; const k = 0.92 + (f < 0.06 ? -0.25 : f > 0.94 ? 0.06 : 0); return [k, k, k, f]; } }),
  metal: () => ({ size: 128, tile: 2, bump: 0.6, gloss: 0.55, metal: 0.8, paint: (_x, _y, u, v) => { const n = fbm(u * 6, v, 16, 3, 211); const k = 0.85 + n * 0.12; return [k, k, k, n]; } }),
};

// ---------------------------------------------------------------- facade windows

/**
 * A storefront / office facade: four bays (3 m) by four storeys (3.6 m) per
 * tile, each window with its own blinds and its own chance of being lit after
 * dark (an emissive mask), so a lit street doesn't glow in one flat pattern.
 */
function facade(scene: Scene, kind: 'office' | 'brick' | 'store') {
  const CW = 96, CH = 120, NX = 4, NY = 4, W = CW * NX, H = CH * NY;
  const color = new Uint8Array(W * H * 4), glow = new Uint8Array(W * H * 4), height = new Float32Array(W * H);
  const seed = kind === 'office' ? 3 : kind === 'brick' ? 7 : 11;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bx = Math.floor(x / CW), by = Math.floor(y / CH), u = (x % CW) / CW, v = (y % CH) / CH, i = y * W + x;
    const lit = hash(bx, by, seed) < (kind === 'office' ? 0.55 : 0.42);
    const warm = hash(bx, by, seed + 1), blind = hash(bx, by, seed + 2);
    const win = kind === 'office' ? u > 0.06 && u < 0.94 && v > 0.12 && v < 0.88 : u > 0.2 && u < 0.8 && v > 0.22 && v < 0.78;
    const mull = kind === 'office' ? Math.abs(u - 0.5) < 0.015 || Math.abs(v - 0.5) < 0.012 : Math.abs(u - 0.5) < 0.02;
    let r: number, g: number, b: number, hgt = 0.5;
    if (win && !mull) {
      const top = kind === 'office' ? 0.12 : 0.22, span = kind === 'office' ? 0.76 : 0.56;
      const shade = (v - top) / span < blind * 0.6;
      const sky = 1 - v * 0.45;
      if (shade) { r = 0.62; g = 0.6; b = 0.56; } else { r = 0.2 * sky + 0.05; g = 0.28 * sky + 0.06; b = 0.36 * sky + 0.08; }
      hgt = 0;
      if (lit) {
        const k = shade ? 0.55 : 1;
        glow[i * 4] = 255 * k; glow[i * 4 + 1] = (175 + warm * 60) * k; glow[i * 4 + 2] = (110 + warm * 110) * k;
      }
    } else if (win && mull) { r = g = b = 0.2; hgt = 0.3; }
    else {
      const n = fbm(x / W, y / H, 8, 3, 221);
      const frame = kind === 'office' ? 0.82 : 0.9;
      const sill = kind !== 'office' && v > 0.78 && v < 0.83 && u > 0.17 && u < 0.83;
      r = g = b = frame + n * 0.1 + (sill ? 0.1 : 0);
      hgt = sill ? 1 : 0.5 + n * 0.3;
      if (kind === 'brick') { const row = Math.floor(v * 24), fv = (v * 24) % 1, fu = (u * 6 + (row % 2) * 0.5) % 1; const m = fu < 0.05 || fv < 0.12; r = g = b = m ? 0.75 : 0.85 + hash(Math.floor(u * 6 + (row % 2) * 0.5) + bx * 7, row + by * 31, 3) * 0.2; hgt = m ? 0 : 0.6; }
    }
    color[i * 4] = clamp01(r) * 255; color[i * 4 + 1] = clamp01(g) * 255; color[i * 4 + 2] = clamp01(b) * 255; color[i * 4 + 3] = 255;
    glow[i * 4 + 3] = 255;
    height[i] = hgt;
  }
  const p: Pick<Painted, 'height' | 'w' | 'h'> = { height, w: W, h: H };
  return {
    map: texture(scene, `facade-${kind}`, color, W, H, true),
    normal: texture(scene, `facade-${kind}-n`, normalsFrom(p, 3), W, H, false),
    glow: texture(scene, `facade-${kind}-glow`, glow, W, H, true),
  };
}

// ---------------------------------------------------------------- material library

/**
 * Gloss rule (AGENTS.md, Fox Lake): surfaces that shouldn't shine (road, concrete, ground, brick, wood, roofing,
 * cloth) get no gloss at all, and surfaces that should (tile, marble, varnished floors, metal, paint) get
 * `GLOSS_SHARE` of the gloss they would normally have. Water and glass keep theirs (`keepGloss`, `glass()`).
 */
export const GLOSS_SHARE = 0.15;
const MATTE_SURFACES = new Set(['grass', 'lawn', 'asphalt', 'concrete', 'curb', 'gravel', 'dirt', 'brick', 'siding', 'boards', 'stucco', 'stone', 'shingles', 'roofFlat', 'carpet', 'slate', 'deck', 'patio', 'damask', 'stripe', 'bark', 'garage']);
/** The gloss a surface kind is drawn with under the gloss rule. */
export function surfaceGloss(kind: string, gloss: number): number { return MATTE_SURFACES.has(kind) ? 0 : gloss * GLOSS_SHARE; }
/** Roughness for a plain material's normal gloss, under the gloss rule. */
export function ruledRoughness(gloss: number, keep = false): number { return 1 - gloss * (keep ? 1 : GLOSS_SHARE) * 0.96; }

export interface MatOpts { keepGloss?: boolean; color?: number | [number, number, number]; gloss?: number; metal?: number; vcolor?: boolean; emissive?: number; emissiveIntensity?: number; opacity?: number; twoSided?: boolean; tile?: number; bump?: number; unlit?: boolean }

interface Surface { painted: GlossOnly; map: RawTexture; normal: RawTexture; recipe: Recipe; rough: Map<string, RawTexture> }

/** A plain PBR material with the town's defaults (opaque, metallic-roughness, image processing in post). */
export function pbr(name: string, scene: Scene) {
  const m = new PBRMaterial(name, scene);
  m.metallic = 0;
  m.roughness = ruledRoughness(0.42);
  m.useRadianceOverAlpha = true;
  m.useSpecularOverAlpha = true;
  m.enableSpecularAntiAliasing = true;
  return m;
}

const TEXTURE_SLOTS = ['albedoTexture', 'ambientTexture', 'opacityTexture', 'reflectionTexture', 'emissiveTexture', 'reflectivityTexture', 'metallicTexture', 'microSurfaceTexture', 'bumpTexture', 'lightmapTexture', 'refractionTexture', 'metallicReflectanceTexture', 'reflectanceTexture'] as const;
const SUB_SLOTS: [string, string[]][] = [['clearCoat', ['texture', 'textureRoughness', 'bumpTexture', 'tintTexture']], ['sheen', ['texture', 'textureRoughness']], ['anisotropy', ['texture']], ['iridescence', ['texture', 'thicknessTexture']], ['subSurface', ['thicknessTexture', 'refractionIntensityTexture', 'translucencyIntensityTexture', 'translucencyColorTexture']]];

/**
 * A copy of a PBR material that shares the original's textures. Babylon's
 * clone also clones every texture object; per-vehicle paint and per-look
 * avatar materials come and go as neighbors drive and walk by, and those
 * texture copies were never freed with them.
 */
export function shallowClone(src: PBRMaterial, name: string): PBRMaterial {
  const c = src.clone(name) as PBRMaterial;
  const swap = (from: Record<string, unknown>, to: Record<string, unknown>, key: string) => {
    const t = to[key] as { dispose?: () => void } | null | undefined;
    if (t && t !== from[key]) { to[key] = from[key]; t.dispose?.(); }
  };
  for (const k of TEXTURE_SLOTS) swap(src as unknown as Record<string, unknown>, c as unknown as Record<string, unknown>, k);
  for (const [sub, keys] of SUB_SLOTS) {
    const a = (src as unknown as Record<string, Record<string, unknown>>)[sub], b = (c as unknown as Record<string, Record<string, unknown>>)[sub];
    if (a && b) for (const k of keys) swap(a, b, k);
  }
  return c;
}

export class Mats {
  private surfaces = new Map<string, Surface>();
  private macroTex: RawTexture | null = null;
  private mats = new Map<string, PBRMaterial>();
  /** Materials whose emissive follows night (windows, lamp bulbs). */
  readonly nightGlow: { m: PBRMaterial; k: number }[] = [];
  private lastNight = -1;

  constructor(readonly scene: Scene) {}

  private surface(kind: string) {
    let t = this.surfaces.get(kind);
    if (!t) {
      const recipe = R[kind]();
      const p = paint(recipe.size, recipe.paint);
      t = {
        painted: { gloss: p.gloss, glossMean: p.glossMean, w: p.w, h: p.h },
        map: texture(this.scene, kind, p.color, p.w, p.h, true),
        normal: texture(this.scene, `${kind}-n`, normalsFrom(p, recipe.bump), p.w, p.h, false),
        recipe,
        rough: new Map(),
      };
      this.surfaces.set(kind, t);
    }
    return t;
  }

  private roughTex(kind: string, s: Surface, gloss: number, metal: number) {
    const key = `${gloss.toFixed(3)}|${metal > 0 ? 1 : 0}`;
    let t = s.rough.get(key);
    if (!t) { t = texture(this.scene, `${kind}-r${key}`, roughnessMap(s.painted, gloss, metal), s.painted.w, s.painted.h, false); s.rough.set(key, t); }
    return t;
  }

  /** The world-scale noise the ground plugin reads. */
  macro() { return (this.macroTex ??= macroNoise(this.scene)); }

  /** A textured surface with the ground plugin: no visible repeat, macro drift, worn or dry patches (GroundShader.ts). */
  ground(name: string, kind: keyof typeof R, look: GroundLook, o: MatOpts = {}, mow: Texture | null = null) {
    const hit = this.mats.get(name);
    if (hit) return hit;
    const m = this.textured(name, kind, o);
    new GroundPlugin(m, look, this.macro(), mow);
    return m;
  }

  /** A textured PBR surface, optionally tinted (`color`) or vertex-colored. Cached by name. */
  textured(name: string, kind: keyof typeof R, o: MatOpts = {}) {
    const hit = this.mats.get(name);
    if (hit) return hit;
    const s = this.surface(kind as string);
    const m = pbr(name, this.scene);
    const tile = o.tile ?? s.recipe.tile;
    const metal = o.metal ?? s.recipe.metal ?? 0;
    const gloss = o.keepGloss ? (o.gloss ?? s.recipe.gloss) : surfaceGloss(kind as string, o.gloss ?? s.recipe.gloss);
    m.albedoTexture = view(s.map, tile, `${name}-a`);
    m.bumpTexture = view(s.normal, tile, `${name}-n`);
    m.bumpTexture.level = o.bump ?? 1;
    m.metallicTexture = view(this.roughTex(kind as string, s, gloss, metal), tile, `${name}-r`);
    m.useRoughnessFromMetallicTextureGreen = true;
    m.useMetallnessFromMetallicTextureBlue = true;
    m.useAmbientOcclusionFromMetallicTextureRed = false;
    m.metallic = metal;
    m.roughness = 1;
    this.tint(m, o);
    this.mats.set(name, m);
    return m;
  }

  /** A plain PBR color. Cached by name. */
  plain(name: string, o: MatOpts = {}) {
    const hit = this.mats.get(name);
    if (hit) return hit;
    const m = pbr(name, this.scene);
    m.metallic = o.metal ?? 0;
    m.roughness = ruledRoughness(o.gloss ?? 0.35, o.keepGloss);
    this.tint(m, o);
    this.mats.set(name, m);
    return m;
  }

  private tint(m: PBRMaterial, o: MatOpts) {
    m.albedoColor = o.color !== undefined ? lin3(o.color) : new Color3(1, 1, 1);
    if (o.emissive !== undefined) {
      m.emissiveColor = lin3(o.emissive);
      m.emissiveIntensity = o.emissiveIntensity ?? 1;
    }
    if (o.opacity !== undefined && o.opacity < 1) {
      m.alpha = o.opacity;
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    } else m.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
    if (o.twoSided) { m.backFaceCulling = false; m.twoSidedLighting = true; }
    if (o.unlit) m.unlit = true;
  }

  /** Downtown facades: window grid per storey and bay, windows glow after dark. Vertex colors tint the walls. */
  facade(kind: 'office' | 'brick' | 'store') {
    const name = `facade-${kind}`;
    const hit = this.mats.get(name);
    if (hit) return hit;
    const f = facade(this.scene, kind);
    const m = pbr(name, this.scene);
    m.metallic = 0.05; m.roughness = ruledRoughness(kind === 'office' ? 0.65 : 0.4);
    const tile = (t: RawTexture) => { t.uScale = 1 / 12; t.vScale = 1 / 14.4; return t; };
    m.albedoTexture = tile(f.map); m.bumpTexture = tile(f.normal); m.bumpTexture.level = 0.8;
    m.emissiveTexture = tile(f.glow); m.emissiveColor = new Color3(1, 0.65, 0.3); m.emissiveIntensity = 0;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
    this.mats.set(name, m);
    this.nightGlow.push({ m, k: 1.6 });
    return m;
  }

  /** Glass: dark, glossy, a little see-through; reflections keep their strength whatever the alpha. */
  glass(name = 'glass', tint = 0x9fb8c8, opacity = 0.42) {
    const hit = this.mats.get(name);
    if (hit) return hit;
    const m = pbr(name, this.scene);
    m.metallic = 0.1; m.roughness = 0.06;
    m.albedoColor = lin3(tint).scale(0.4);
    m.alpha = opacity; m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    this.mats.set(name, m);
    return m;
  }

  /** A warm glow that turns on after dark (lamp bulbs, porch lights). */
  glow(name: string, color: number, k = 6) {
    const hit = this.mats.get(name);
    if (hit) return hit;
    const m = this.plain(name, { color: 0xf8f4ea, gloss: 0.6, emissive: color, emissiveIntensity: 0 });
    this.nightGlow.push({ m, k });
    return m;
  }

  /** A canvas texture (signs): uploaded once with mipmaps. */
  canvasTexture(name: string, canvas: HTMLCanvasElement) {
    const t = new DynamicTexture(name, canvas, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    t.update(false);
    t.anisotropicFilteringLevel = anisotropy;
    t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
    return t;
  }

  setNight(night: number) {
    if (Math.abs(night - this.lastNight) < 0.005) return;
    this.lastNight = night;
    for (const g of this.nightGlow) g.m.emissiveIntensity = night * g.k;
  }

  /** Every cached material (warm-up and debugging). */
  all(): Material[] { return [...this.mats.values()]; }
}
