/**
 * Procedural surfaces: every texture in the town is painted at start-up from
 * seeded noise (no image downloads), each with a matching normal map so the
 * PBR lighting picks out asphalt grain, brick courses, siding laps and
 * shingle rows. Geometry carries UVs in metres; each material's `tile` says
 * how many metres one copy of its texture covers.
 */
import * as pc from 'playcanvas';

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

interface Painted { color: Uint8ClampedArray; height: Float32Array; w: number; h: number }
type Painter = (x: number, y: number, u: number, v: number) => [number, number, number, number];   // r g b (0..1 sRGB), height

function paint(size: number, fn: Painter): Painted {
  const color = new Uint8ClampedArray(size * size * 4), height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b, hgt] = fn(x, y, x / size, y / size);
    const i = y * size + x;
    color[i * 4] = r * 255; color[i * 4 + 1] = g * 255; color[i * 4 + 2] = b * 255; color[i * 4 + 3] = 255;
    height[i] = hgt;
  }
  return { color, height, w: size, h: size };
}

function normalsFrom(p: Painted, strength: number) {
  const { w, h, height } = p;
  const out = new Uint8ClampedArray(w * h * 4);
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

function texture(device: pc.GraphicsDevice, name: string, data: Uint8ClampedArray, w: number, h: number, srgb: boolean) {
  const t = new pc.Texture(device, {
    name, width: w, height: h, format: srgb ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8, mipmaps: true,
    addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR, anisotropy: 8,
  });
  const px = t.lock();
  px.set(data);
  t.unlock();
  return t;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const C = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const lerp3 = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul3 = (a: number[], k: number): [number, number, number] => [clamp01(a[0] * k), clamp01(a[1] * k), clamp01(a[2] * k)];

// ---------------------------------------------------------------- surface recipes

type Recipe = { size: number; tile: number; bump: number; gloss: number; metal?: number; paint: Painter };

const R: Record<string, () => Recipe> = {
  grass: () => ({ size: 256, tile: 7, bump: 1.4, gloss: 0.12, paint: (_x, _y, u, v) => {
    const n = fbm(u, v, 8, 5, 3), m = fbm(u, v, 3, 3, 9), blade = hash(_x, _y, 5);
    const c = lerp3(lerp3(C(0x445f2e), C(0x667f40), n), C(0x8a8656), Math.max(0, m - 0.6) * 1.3);
    return [...mul3(c, 0.86 + blade * 0.24), n * 0.6 + blade * 0.4] as [number, number, number, number];
  } }),
  lawn: () => ({ size: 256, tile: 4, bump: 1.6, gloss: 0.14, paint: (_x, _y, u, v) => {
    const n = fbm(u, v, 10, 4, 21), blade = hash(_x, _y, 8);
    const c = lerp3(C(0x4c7432), C(0x678c42), n);
    return [...mul3(c, 0.84 + blade * 0.28), blade] as [number, number, number, number];
  } }),
  asphalt: () => ({ size: 512, tile: 6, bump: 0.9, gloss: 0.34, paint: (x, y, u, v) => {
    const n = fbm(u, v, 6, 4, 31), patch = fbm(u, v, 2, 3, 37), grit = hash(x, y, 2), stone = grit > 0.96 ? 0.07 : grit < 0.04 ? -0.04 : 0;
    const k = 0.25 + n * 0.035 + (patch - 0.5) * 0.05 + stone + (grit - 0.5) * 0.025;
    return [k, k * 1.005, k * 1.025, grit * 0.5 + n * 0.5];
  } }),
  concrete: () => ({ size: 256, tile: 2, bump: 1.6, gloss: 0.22, paint: (x, y, u, v) => {
    const n = fbm(u, v, 6, 4, 41), sp = hash(x, y, 4);
    const joint = Math.min(x, y, 255 - x, 255 - y) < 2 ? -0.18 : 0;
    const k = 0.66 + n * 0.1 + (sp - 0.5) * 0.05 + joint;
    return [k, k * 0.99, k * 0.96, n * 0.5 + sp * 0.2 + joint * 2];
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
function facade(device: pc.GraphicsDevice, kind: 'office' | 'brick' | 'store') {
  const CW = 96, CH = 120, NX = 4, NY = 4, W = CW * NX, H = CH * NY;
  const color = new Uint8ClampedArray(W * H * 4), glow = new Uint8ClampedArray(W * H * 4), height = new Float32Array(W * H);
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
  const p: Painted = { color, height, w: W, h: H };
  return {
    map: texture(device, `facade-${kind}`, color, W, H, true),
    normal: texture(device, `facade-${kind}-n`, normalsFrom(p, 3), W, H, false),
    glow: texture(device, `facade-${kind}-glow`, glow, W, H, true),
  };
}

// ---------------------------------------------------------------- material library

export interface MatOpts { color?: number | [number, number, number]; gloss?: number; metal?: number; vcolor?: boolean; emissive?: number; emissiveIntensity?: number; opacity?: number; twoSided?: boolean; tile?: number; bump?: number }

export class Mats {
  private textures = new Map<string, { map: pc.Texture; normal: pc.Texture; recipe: Recipe }>();
  private mats = new Map<string, pc.StandardMaterial>();
  /** Materials whose emissive follows night (windows, lamp bulbs). */
  readonly nightGlow: { m: pc.StandardMaterial; k: number }[] = [];

  constructor(private device: pc.GraphicsDevice) {}

  private surface(kind: string) {
    let t = this.textures.get(kind);
    if (!t) {
      const recipe = R[kind]();
      const p = paint(recipe.size, recipe.paint);
      t = { map: texture(this.device, kind, p.color, p.w, p.h, true), normal: texture(this.device, `${kind}-n`, normalsFrom(p, recipe.bump), p.w, p.h, false), recipe };
      this.textures.set(kind, t);
    }
    return t;
  }

  /** A textured PBR surface, optionally tinted (`color`) or vertex-colored. Cached by name. */
  textured(name: string, kind: keyof typeof R, o: MatOpts = {}) {
    const hit = this.mats.get(name);
    if (hit) return hit;
    const t = this.surface(kind as string);
    const m = new pc.StandardMaterial();
    m.name = name;
    m.useMetalness = true;
    m.metalness = o.metal ?? t.recipe.metal ?? 0;
    m.gloss = o.gloss ?? t.recipe.gloss;
    m.diffuseMap = t.map;
    m.normalMap = t.normal;
    m.bumpiness = o.bump ?? 1;
    const tile = 1 / (o.tile ?? t.recipe.tile);
    m.diffuseMapTiling = new pc.Vec2(tile, tile);
    m.normalMapTiling = new pc.Vec2(tile, tile);
    this.tint(m, o);
    m.update();
    this.mats.set(name, m);
    return m;
  }

  /** A plain PBR color. Cached by name. */
  plain(name: string, o: MatOpts = {}) {
    const hit = this.mats.get(name);
    if (hit) return hit;
    const m = new pc.StandardMaterial();
    m.name = name;
    m.useMetalness = true;
    m.metalness = o.metal ?? 0;
    m.gloss = o.gloss ?? 0.35;
    this.tint(m, o);
    m.update();
    this.mats.set(name, m);
    return m;
  }

  private tint(m: pc.StandardMaterial, o: MatOpts) {
    if (o.color !== undefined) {
      const c = typeof o.color === 'number' ? C(o.color) : o.color;
      m.diffuse.set(c[0], c[1], c[2]);
    }
    if (o.vcolor) { m.diffuseVertexColor = true; m.diffuseVertexColorChannel = 'rgb'; (m as unknown as { vertexColorGamma: boolean }).vertexColorGamma = true; }
    if (o.emissive !== undefined) {
      const e = C(o.emissive);
      m.emissive.set(e[0], e[1], e[2]);
      m.emissiveIntensity = o.emissiveIntensity ?? 1;
    }
    if (o.opacity !== undefined && o.opacity < 1) {
      m.opacity = o.opacity;
      m.blendType = pc.BLEND_NORMAL;
      m.depthWrite = false;
    }
    if (o.twoSided) m.cull = pc.CULLFACE_NONE;
  }

  /** Downtown facades: window grid per storey and bay, windows glow after dark. Vertex colors tint the walls. */
  facade(kind: 'office' | 'brick' | 'store') {
    const name = `facade-${kind}`;
    const hit = this.mats.get(name);
    if (hit) return hit;
    const f = facade(this.device, kind);
    const m = new pc.StandardMaterial();
    m.name = name;
    m.useMetalness = true; m.metalness = 0.05; m.gloss = kind === 'office' ? 0.6 : 0.35;
    m.diffuseMap = f.map; m.normalMap = f.normal; m.bumpiness = 0.8;
    m.diffuseVertexColor = true; m.diffuseVertexColorChannel = 'rgb'; (m as unknown as { vertexColorGamma: boolean }).vertexColorGamma = true;
    m.emissiveMap = f.glow; m.emissive.set(1, 0.82, 0.58); m.emissiveIntensity = 0;
    const tiling = new pc.Vec2(1 / 12, 1 / 14.4);
    m.diffuseMapTiling = tiling; m.normalMapTiling = tiling; m.emissiveMapTiling = tiling;
    m.update();
    this.mats.set(name, m);
    this.nightGlow.push({ m, k: 1.6 });
    return m;
  }

  /** Glass: dark, glossy, a little see-through. */
  glass(name = 'glass', tint = 0x9fb8c8, opacity = 0.42) {
    const hit = this.mats.get(name);
    if (hit) return hit;
    const m = new pc.StandardMaterial();
    m.name = name;
    m.useMetalness = true; m.metalness = 0.1; m.gloss = 0.94;
    const c = C(tint); m.diffuse.set(c[0] * 0.4, c[1] * 0.4, c[2] * 0.4);
    m.opacity = opacity; m.blendType = pc.BLEND_NORMAL; m.depthWrite = false;
    m.specularityFactor = 1;
    m.update();
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

  setNight(night: number) {
    for (const g of this.nightGlow) {
      const v = night * g.k;
      if (Math.abs(g.m.emissiveIntensity - v) > 0.01) { g.m.emissiveIntensity = v; g.m.update(); }
    }
  }
}
