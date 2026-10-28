/**
 * Mowable lawn for one lot. A per-lot canvas (8 px/m) acts as the albedo
 * "mow map"; strokes are painted as rotated deck-width rectangles whose shade
 * depends on travel direction — the same physics that makes real stripes.
 * A tiled blade-detail bump map rides on uv1 (texture.channel = 1) so the
 * close-up still reads as grass while uv0 spans the whole lot.
 */
import * as THREE from 'three/webgpu';
import type { LotDef } from '../../shared/WorldLayout';
import { Shade, strokeCells, stripeShade } from '../../shared/Mowing';
import type { MowStroke } from '../../shared/Protocol';

const PPM = 8;
const SHADE_COLORS: Record<Exclude<Shade, 0>, string> = {
  1: '#86b552', 2: '#5a8f34',     // with / against the front-back direction
  3: '#7aac4a', 4: '#62973a',     // cross-cut
};

export class Lawn {
  readonly mesh: THREE.Mesh;
  readonly coverage: Uint8Array;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private dirty = false;
  private flushTimer = 0;

  constructor(readonly lot: LotDef, detail: THREE.Texture) {
    this.canvas.width = lot.w * PPM;
    this.canvas.height = lot.d * PPM;
    this.g = this.canvas.getContext('2d')!;
    this.coverage = new Uint8Array(lot.w * lot.d);
    this.paintUncut();

    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;

    const geo = new THREE.PlaneGeometry(lot.w, lot.d, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const p = geo.getAttribute('position');
    const uv1 = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv1[i * 2] = (p.getX(i) + lot.x) / 1.6; uv1[i * 2 + 1] = (p.getZ(i) + lot.z) / 1.6; }
    geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));

    const bump = detail.clone();
    bump.channel = 1;
    bump.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map: this.tex, bumpMap: bump, bumpScale: 2.5, roughness: 0.95 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(lot.x + lot.w / 2, 0.015, lot.z + lot.d / 2);
    this.mesh.receiveShadow = true;
  }

  private paintUncut() {
    const { g, canvas: c } = this;
    g.fillStyle = '#4f7f2e'; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < c.width * c.height * 0.25; i++) {          // tufty, uneven, slightly yellowed
      g.fillStyle = `hsla(${78 + Math.random() * 30},${35 + Math.random() * 25}%,${22 + Math.random() * 20}%,0.6)`;
      g.fillRect(Math.random() * c.width, Math.random() * c.height, 1, 1 + Math.random() * 2);
    }
  }

  /** Paint a stroke locally; returns number of previously-uncut cells covered. */
  mow(s: MowStroke): number {
    const shade = stripeShade(s.hx, s.hz) as Exclude<Shade, 0>;
    const { g } = this;
    g.save();
    g.translate((s.x - this.lot.x) * PPM, (s.z - this.lot.z) * PPM);
    g.rotate(Math.atan2(s.hz, s.hx));
    g.globalAlpha = 0.85;
    g.fillStyle = SHADE_COLORS[shade];
    g.fillRect((-s.len / 2) * PPM, (-s.width / 2) * PPM, s.len * PPM, s.width * PPM);
    g.restore();
    let fresh = 0;
    for (const idx of strokeCells(this.lot, s)) { if (!this.coverage[idx]) fresh++; this.coverage[idx] = shade; }
    this.dirty = true; this.pixelsStale = true; this.revision++;
    return fresh;
  }

  /** Restore an authoritative coverage grid (on join) as blocky stripes. */
  loadCoverage(c: Uint8Array) {
    this.paintUncut();
    for (let i = 0; i < c.length; i++) {
      if (!c[i]) continue;
      this.coverage[i] = c[i];
      this.g.fillStyle = SHADE_COLORS[c[i] as Exclude<Shade, 0>];
      this.g.fillRect((i % this.lot.w) * PPM, Math.floor(i / this.lot.w) * PPM, PPM, PPM);
    }
    this.dirty = true; this.pixelsStale = true; this.revision++;
  }

  regrow() { this.coverage.fill(0); this.paintUncut(); this.dirty = true; this.pixelsStale = true; this.revision++; }

  private pixels: Uint8ClampedArray | null = null;
  private pixelsStale = true;
  /** Lawn color + whether it's cut at a world point (grass blades follow the stripes). */
  sample(x: number, z: number, out: [number, number, number]): boolean {
    if (this.pixelsStale || !this.pixels) {
      this.pixels = this.g.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
      this.pixelsStale = false;
    }
    const px = Math.min(this.canvas.width - 1, Math.max(0, Math.floor((x - this.lot.x) * PPM)));
    const py = Math.min(this.canvas.height - 1, Math.max(0, Math.floor((z - this.lot.z) * PPM)));
    const i = (py * this.canvas.width + px) * 4;
    out[0] = this.pixels[i] / 255; out[1] = this.pixels[i + 1] / 255; out[2] = this.pixels[i + 2] / 255;
    const cx = Math.floor(x - this.lot.x), cz = Math.floor(z - this.lot.z);
    return this.coverage[cz * this.lot.w + cx] > 0;
  }
  /** Bumped whenever the mow map changes, so dependents can refresh. */
  revision = 0;

  get percentMowed() { let n = 0; for (const v of this.coverage) if (v) n++; return n / this.coverage.length; }

  contains(x: number, z: number) { const l = this.lot; return x >= l.x && x < l.x + l.w && z >= l.z && z < l.z + l.d; }

  /** Texture uploads are throttled to ~10 Hz. */
  update(dt: number) {
    this.flushTimer += dt;
    if (this.dirty && this.flushTimer > 0.1) { this.tex.needsUpdate = true; this.dirty = false; this.flushTimer = 0; }
  }
}
