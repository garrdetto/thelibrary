/**
 * Mowable lawn for one lot.
 *
 * A per-lot data texture (4 texels per meter) records, for every spot, which
 * way the blades were pushed by the last pass and how far they have grown
 * back since. The lawn shader turns that into real stripes: blades leaning
 * away from the camera show their long, sunlit sides and look light, blades
 * leaning toward it show their shaded tips and look dark — so the stripes
 * swap shade as you walk around them, fade when you look straight down, and
 * a second pass at an angle leaves a diamond (checkerboard) pattern because
 * each spot keeps part of its old lean. As the grass grows back over five
 * in-game days it gets taller and the stripes melt away.
 *
 * The 1 m cells mirror the authority's state; strokes are also painted
 * locally at full texture resolution, so your own stripes have clean edges.
 */
import * as THREE from 'three/webgpu';
import { cameraPosition, dot, float, length, max, mix, normalize, positionWorld, texture, uv, vec2, vec3 } from 'three/tsl';
import { ageDays, blendLean, byteToAngle, growthOf, LawnCells, mowCells, TICKS_PER_DAY } from '../../shared/Mowing';
import type { MowStroke } from '../../shared/Protocol';
import type { LotDef } from '../../shared/WorldLayout';

const PPM = 4;
/** How much a fully bent stripe brightens or darkens the turf. */
const STRIPE = 0.34;

let albedo: THREE.CanvasTexture | null = null;
/** One tiling turf texture (4 m square) shared by every lawn: thatch, tufts and the odd clover. */
function turfAlbedo() {
  if (albedo) return albedo;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5a8a35'; g.fillRect(0, 0, 256, 256);
  let seed = 7;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 9000; i++) {
    const x = r() * 256, y = r() * 256;
    g.fillStyle = `hsla(${84 + r() * 26},${38 + r() * 22}%,${24 + r() * 22}%,0.55)`;
    g.fillRect(x, y, 1, 1 + r() * 2.5);
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `hsla(${92 + r() * 10},40%,${30 + r() * 8}%,0.35)`;
    g.beginPath(); g.arc(r() * 256, r() * 256, 2 + r() * 3, 0, Math.PI * 2); g.fill();
  }
  albedo = new THREE.CanvasTexture(c);
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = 8;
  return albedo;
}

export interface LawnSample { growth: number; dx: number; dz: number; strength: number }

export class Lawn {
  readonly mesh: THREE.Mesh;
  cells: LawnCells;
  /** Bumped whenever blades should be re-laid (a cut, or the grass growing). */
  revision = 0;
  /** World-space XZ box of everything that changed since `takeDirty()` last ran (NaN = nothing). */
  private dirtyBox = [NaN, NaN, NaN, NaN];
  private readonly tw: number;
  private readonly th: number;
  /** Per texel: in-game day of the last cut (-1 = never), and blade lean angle. */
  private readonly cutAt: Float32Array;
  private readonly lean: Float32Array;
  private readonly data: Uint8Array;
  private readonly tex: THREE.DataTexture;
  private dirty = false;
  private flushTimer = 0;
  private grownTick = -1;
  private anyCut = false;

  constructor(readonly lot: LotDef, detail: THREE.Texture) {
    this.tw = lot.w * PPM; this.th = lot.d * PPM;
    this.cells = { t: new Uint16Array(lot.w * lot.d), a: new Uint8Array(lot.w * lot.d) };
    this.cutAt = new Float32Array(this.tw * this.th).fill(-1);
    this.lean = new Float32Array(this.tw * this.th);
    this.data = new Uint8Array(this.tw * this.th * 4);
    for (let i = 0; i < this.tw * this.th; i++) this.data.set([128, 128, 255, 0], i * 4);
    this.tex = new THREE.DataTexture(this.data, this.tw, this.th, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;

    const geo = new THREE.PlaneGeometry(lot.w, lot.d, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const p = geo.getAttribute('position');
    const uv1 = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv1[i * 2] = (p.getX(i) + lot.x + lot.w / 2) / 1.6; uv1[i * 2 + 1] = (p.getZ(i) + lot.z + lot.d / 2) / 1.6; }
    geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));

    const bump = detail.clone();
    bump.channel = 1;
    bump.needsUpdate = true;
    const mat = new THREE.MeshStandardNodeMaterial({ bumpMap: bump, bumpScale: 2.5, roughness: 0.95 });
    const state = texture(this.tex, vec2(uv().x, uv().y.oneMinus()));
    const dir = state.xy.mul(2).sub(1);
    const growth = state.z;
    const strength = state.w.mul(growth.oneMinus().pow(1.5));
    const toCam = cameraPosition.sub(positionWorld);
    const flat = vec2(toCam.x, toCam.z);
    const side = length(flat).div(max(length(toCam), float(1e-3)));
    const shade = float(1).sub(dot(dir, normalize(flat)).mul(strength).mul(side).mul(STRIPE));
    const tint = mix(vec3(1.07, 1.1, 0.93), vec3(0.86, 0.94, 0.8), growth);
    mat.colorNode = texture(turfAlbedo(), uv(1).mul(0.4)).rgb.mul(tint).mul(shade);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(lot.x + lot.w / 2, 0.015, lot.z + lot.d / 2);
    this.mesh.receiveShadow = true;
  }

  /** Paints one mower pass locally (the authority keeps the matching 1 m cells). */
  mow(s: MowStroke, nowDays: number) {
    mowCells(this.cells, this.lot, s, nowDays);
    const len = Math.hypot(s.hx, s.hz) || 1;
    const fx = s.hx / len, fz = s.hz / len;
    const reach = Math.hypot(s.len, s.width) / 2;
    const x0 = Math.max(0, Math.floor((s.x - reach - this.lot.x) * PPM)), x1 = Math.min(this.tw - 1, Math.ceil((s.x + reach - this.lot.x) * PPM));
    const z0 = Math.max(0, Math.floor((s.z - reach - this.lot.z) * PPM)), z1 = Math.min(this.th - 1, Math.ceil((s.z + reach - this.lot.z) * PPM));
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
      const wx = this.lot.x + (i + 0.5) / PPM - s.x, wz = this.lot.z + (j + 0.5) / PPM - s.z;
      if (Math.abs(wx * fx + wz * fz) > s.len / 2 || Math.abs(-wx * fz + wz * fx) > s.width / 2) continue;
      const k = j * this.tw + i;
      const old = this.cutAt[k] >= 0 ? this.lean[k] : null;
      const g = this.cutAt[k] >= 0 ? growthOf(nowDays - this.cutAt[k]) : 1;
      this.lean[k] = blendLean(s.hx, s.hz, old, g);
      this.cutAt[k] = nowDays;
      this.writeTexel(k, nowDays);
    }
    this.anyCut = true;
    this.dirty = true;
    this.revision++;
    this.markDirty(s.x - reach, s.z - reach, s.x + reach, s.z + reach);
  }

  private markDirty(x0: number, z0: number, x1: number, z1: number) {
    const b = this.dirtyBox;
    if (Number.isNaN(b[0])) { b[0] = x0; b[1] = z0; b[2] = x1; b[3] = z1; return; }
    b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], z0); b[2] = Math.max(b[2], x1); b[3] = Math.max(b[3], z1);
  }

  private markAllDirty() { const l = this.lot; this.markDirty(l.x, l.z, l.x + l.w, l.z + l.d); }

  /**
   * The area whose blades need re-laying since the last call, written into `out`
   * as [x0, z0, x1, z1]; false when nothing changed. Grass only re-lays the tiles
   * a mower pass touched instead of the whole field.
   */
  takeDirty(out: number[]): boolean {
    const b = this.dirtyBox;
    if (Number.isNaN(b[0])) return false;
    out[0] = b[0]; out[1] = b[1]; out[2] = b[2]; out[3] = b[3];
    b[0] = NaN;
    return true;
  }

  /** Restores the authority's cells (on join): each 1 m cell fills its 4 × 4 texels. */
  loadCells(c: LawnCells, nowDays: number) {
    this.cells = c;
    this.anyCut = false;
    for (let cz = 0; cz < this.lot.d; cz++) for (let cx = 0; cx < this.lot.w; cx++) {
      const ci = cz * this.lot.w + cx;
      const age = ageDays(c.t[ci], nowDays);
      const at = Number.isFinite(age) ? nowDays - age : -1;
      if (at >= 0) this.anyCut = true;
      for (let j = 0; j < PPM; j++) for (let i = 0; i < PPM; i++) {
        const k = (cz * PPM + j) * this.tw + cx * PPM + i;
        this.cutAt[k] = at;
        this.lean[k] = byteToAngle(c.a[ci]);
        this.writeTexel(k, nowDays);
      }
    }
    this.grownTick = Math.floor(nowDays * TICKS_PER_DAY);
    this.dirty = true;
    this.revision++;
    this.markAllDirty();
  }

  private writeTexel(k: number, nowDays: number) {
    const o = k * 4, at = this.cutAt[k];
    if (at < 0) { this.data[o] = 128; this.data[o + 1] = 128; this.data[o + 2] = 255; this.data[o + 3] = 0; return; }
    const g = growthOf(nowDays - at);
    if (g >= 1) { this.cutAt[k] = -1; this.data[o + 2] = 255; this.data[o + 3] = 0; return; }
    this.data[o] = Math.round((Math.cos(this.lean[k]) * 0.5 + 0.5) * 255);
    this.data[o + 1] = Math.round((Math.sin(this.lean[k]) * 0.5 + 0.5) * 255);
    this.data[o + 2] = Math.round(g * 255);
    this.data[o + 3] = 255;
  }

  /** Grass height, lean and stripe strength at a world point (the 3D blades follow it). */
  sample(x: number, z: number, out: LawnSample, nowDays: number): LawnSample {
    const i = Math.min(this.tw - 1, Math.max(0, Math.floor((x - this.lot.x) * PPM)));
    const j = Math.min(this.th - 1, Math.max(0, Math.floor((z - this.lot.z) * PPM)));
    const k = j * this.tw + i, at = this.cutAt[k];
    if (at < 0) { out.growth = 1; out.strength = 0; out.dx = 0; out.dz = 0; return out; }
    out.growth = growthOf(nowDays - at);
    out.strength = Math.pow(1 - out.growth, 1.5);
    out.dx = Math.cos(this.lean[k]); out.dz = Math.sin(this.lean[k]);
    return out;
  }

  contains(x: number, z: number) { const l = this.lot; return x >= l.x && x < l.x + l.w && z >= l.z && z < l.z + l.d; }

  /**
   * Uploads changes (throttled to ~10 Hz) and, every 30 in-game minutes, lets
   * the grass grow. Returns true when it spent this frame's growth refresh.
   */
  update(dt: number, nowDays: number, mayRefresh: boolean): boolean {
    this.flushTimer += dt;
    let refreshed = false;
    const tick = Math.floor(nowDays * TICKS_PER_DAY);
    if (mayRefresh && this.anyCut && tick !== this.grownTick) {
      this.grownTick = tick;
      let still = false;
      for (let k = 0; k < this.cutAt.length; k++) if (this.cutAt[k] >= 0) { this.writeTexel(k, nowDays); if (this.cutAt[k] >= 0) still = true; }
      this.anyCut = still;
      this.dirty = true;
      this.revision++;
      this.markAllDirty();
      refreshed = true;
    }
    if (this.dirty && this.flushTimer > 0.1) { this.tex.needsUpdate = true; this.dirty = false; this.flushTimer = 0; }
    return refreshed;
  }
}
