/**
 * Procedural PBR material library. Every texture is generated on a canvas at
 * startup (no asset downloads), tiled in WORLD METERS via `tile` so brick
 * courses and siding laps stay true-to-scale on any wall length.
 *
 * Swap any entry for authored textures (albedo/normal/roughness from e.g.
 * ambientCG / Poly Haven) by replacing `make()` — callers only use `get()`.
 */
import * as THREE from 'three/webgpu';

export interface MatEntry { material: THREE.Material; tile: number }

type Draw = (g: CanvasRenderingContext2D, s: number, rnd: () => number) => void;

function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

export function canvasTex(size: number, seed: number, draw: Draw, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noise(g: CanvasRenderingContext2D, s: number, rnd: () => number, n: number, alpha: number, light = true) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${rnd() * alpha})`;
    g.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

// ------------------------------------------------------------------ patterns

const siding = (base: string): Draw => (g, s, rnd) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  const laps = 8;                                  // 8 laps per 1.2 m tile ≈ 15 cm exposure
  for (let i = 0; i < laps; i++) {
    const y = (i / laps) * s;
    const grd = g.createLinearGradient(0, y, 0, y + s / laps);
    grd.addColorStop(0, 'rgba(0,0,0,0.28)');
    grd.addColorStop(0.08, 'rgba(0,0,0,0.04)');
    grd.addColorStop(0.9, 'rgba(255,255,255,0.06)');
    grd.addColorStop(1, 'rgba(255,255,255,0.0)');
    g.fillStyle = grd; g.fillRect(0, y, s, s / laps);
  }
  noise(g, s, rnd, 3000, 0.05, false);
};

const brick: Draw = (g, s, rnd) => {
  g.fillStyle = '#b9b2a6'; g.fillRect(0, 0, s, s);   // mortar
  const rows = 16, cols = 4;                          // 1.2 m tile: 75 mm courses, 300 mm bricks
  const bh = s / rows, bw = s / cols;
  for (let r = 0; r < rows; r++) for (let c = -1; c < cols; c++) {
    const x = c * bw + (r % 2 ? bw / 2 : 0);
    const h = 8 + rnd() * 10, l = 30 + rnd() * 10;
    g.fillStyle = `hsl(${h},${45 + rnd() * 15}%,${l}%)`;
    g.fillRect(x + 2, r * bh + 2, bw - 4, bh - 4);
  }
  noise(g, s, rnd, 6000, 0.12, false);
};

const stucco: Draw = (g, s, rnd) => {
  g.fillStyle = '#d9c9a8'; g.fillRect(0, 0, s, s);
  noise(g, s, rnd, 20000, 0.08, false); noise(g, s, rnd, 12000, 0.08, true);
};

const stone: Draw = (g, s, rnd) => {
  g.fillStyle = '#6f6a62'; g.fillRect(0, 0, s, s);
  let y = 0;
  while (y < s) {
    const h = s / 10 + rnd() * s / 12;
    let x = -rnd() * 40;
    while (x < s) {
      const w = s / 6 + rnd() * s / 6;
      g.fillStyle = `hsl(${30 + rnd() * 15},${8 + rnd() * 8}%,${42 + rnd() * 18}%)`;
      g.beginPath(); g.roundRect(x + 3, y + 3, w - 6, h - 6, 8); g.fill();
      x += w;
    }
    y += h;
  }
  noise(g, s, rnd, 8000, 0.1, false);
};

const drywall: Draw = (g, s, rnd) => { g.fillStyle = '#ece8e1'; g.fillRect(0, 0, s, s); noise(g, s, rnd, 4000, 0.025, false); };

const planks = (hue: number, light: number): Draw => (g, s, rnd) => {
  const rows = 8;                                      // 2 m tile → 25 cm boards
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * s;
    while (x < s) {
      const len = s * (0.35 + rnd() * 0.4);
      const l = light + (rnd() - 0.5) * 8;
      g.fillStyle = `hsl(${hue + rnd() * 6},${45 + rnd() * 10}%,${l}%)`;
      g.fillRect(x, (r * s) / rows, len, s / rows);
      for (let k = 0; k < 14; k++) {                   // grain
        g.strokeStyle = `rgba(40,20,5,${0.05 + rnd() * 0.08})`;
        const yy = (r * s) / rows + rnd() * (s / rows);
        g.beginPath(); g.moveTo(x, yy); g.bezierCurveTo(x + len * 0.3, yy + 2, x + len * 0.6, yy - 2, x + len, yy); g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x, (r * s) / rows, 2, s / rows);
      x += len;
    }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, (r * s) / rows, s, 2);
  }
};

const tile: Draw = (g, s, rnd) => {
  g.fillStyle = '#c9c4bb'; g.fillRect(0, 0, s, s);
  const n = 4;                                          // 1.2 m tile → 30 cm ceramic
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    g.fillStyle = `hsl(40,${6 + rnd() * 4}%,${86 + rnd() * 6}%)`;
    g.fillRect((i * s) / n + 3, (j * s) / n + 3, s / n - 6, s / n - 6);
  }
  noise(g, s, rnd, 3000, 0.04, false);
};

const carpet: Draw = (g, s, rnd) => { g.fillStyle = '#7d7468'; g.fillRect(0, 0, s, s); noise(g, s, rnd, 40000, 0.12, true); noise(g, s, rnd, 40000, 0.12, false); };

const slate: Draw = (g, s, rnd) => {
  const n = 3;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    g.fillStyle = `hsl(210,${6 + rnd() * 6}%,${24 + rnd() * 10}%)`;
    g.fillRect((i * s) / n, (j * s) / n, s / n, s / n);
    g.fillStyle = '#1b1d20'; g.fillRect((i * s) / n, (j * s) / n, s / n, 3); g.fillRect((i * s) / n, (j * s) / n, 3, s / n);
  }
  noise(g, s, rnd, 9000, 0.07, true);
};

const concrete: Draw = (g, s, rnd) => {
  g.fillStyle = '#a7a49e'; g.fillRect(0, 0, s, s);
  noise(g, s, rnd, 30000, 0.07, false); noise(g, s, rnd, 15000, 0.06, true);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, s, 2); g.fillRect(0, 0, 2, s);   // control joints
};

const asphalt: Draw = (g, s, rnd) => {
  g.fillStyle = '#3d3e40'; g.fillRect(0, 0, s, s);
  // Broad tonal drift so the 8 m tile doesn't read as a repeat.
  for (let i = 0; i < 40; i++) {
    const x = rnd() * s, y = rnd() * s, r = s * (0.08 + rnd() * 0.25);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const v = rnd() < 0.5 ? '0,0,0' : '255,255,255';
    grd.addColorStop(0, `rgba(${v},${0.03 + rnd() * 0.05})`); grd.addColorStop(1, `rgba(${v},0)`);
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Aggregate: pale stones in a dark binder, plus fines.
  for (let i = 0; i < 90000; i++) {
    const l = rnd() < 0.55 ? 58 + rnd() * 28 : 12 + rnd() * 16;
    g.fillStyle = `hsla(${25 + rnd() * 20},${4 + rnd() * 6}%,${l}%,${0.25 + rnd() * 0.45})`;
    const sz = rnd() < 0.08 ? 2 + rnd() * 2 : 1;
    g.fillRect(rnd() * s, rnd() * s, sz, sz);
  }
  // A patched square and a few sealed cracks (glossy black tar lines).
  const px = rnd() * s * 0.6, py = rnd() * s * 0.6, pw = s * (0.15 + rnd() * 0.15), ph = s * (0.1 + rnd() * 0.2);
  g.fillStyle = 'rgba(20,20,22,0.12)'; g.fillRect(px, py, pw, ph);
  g.strokeStyle = 'rgba(10,10,12,0.3)'; g.lineWidth = 2; g.strokeRect(px, py, pw, ph);
  for (let c = 0; c < 5; c++) {
    let x = rnd() * s, y = rnd() * s;
    const ang = rnd() * Math.PI * 2, wide = rnd() < 0.5;
    g.strokeStyle = wide ? 'rgba(12,12,14,0.55)' : 'rgba(18,18,20,0.6)';
    g.lineWidth = wide ? 3 + rnd() * 3 : 1 + rnd();
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 14; k++) { x += Math.cos(ang + (rnd() - 0.5) * 1.4) * s * 0.03; y += Math.sin(ang + (rnd() - 0.5) * 1.4) * s * 0.03; g.lineTo(x, y); }
    g.stroke();
  }
  noise(g, s, rnd, 20000, 0.08, false);
};

const shingles: Draw = (g, s, rnd) => {
  g.fillStyle = '#2c2d30'; g.fillRect(0, 0, s, s);
  const rows = 10;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (s / 8);
    for (let c = -1; c < 4; c++) {
      g.fillStyle = `hsl(20,${4 + rnd() * 6}%,${18 + rnd() * 10}%)`;
      g.fillRect(c * (s / 4) + off + 1, (r * s) / rows, s / 4 - 2, s / rows - 2);
    }
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, ((r + 1) * s) / rows - 3, s, 3);
  }
  noise(g, s, rnd, 20000, 0.12, true);
};

const grass: Draw = (g, s, rnd) => {
  g.fillStyle = '#4d7a2f'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 26000; i++) {
    const x = rnd() * s, y = rnd() * s;
    g.strokeStyle = `hsla(${85 + rnd() * 25},${35 + rnd() * 25}%,${22 + rnd() * 22}%,0.7)`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 5); g.stroke();
  }
};

const bark: Draw = (g, s, rnd) => {
  g.fillStyle = '#5b4632'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 260; i++) {                      // vertical furrows
    const x = rnd() * s, w = 2 + rnd() * 6;
    g.fillStyle = `rgba(${20 + rnd() * 30},${12 + rnd() * 20},${6},${0.3 + rnd() * 0.4})`;
    g.fillRect(x, 0, w, s);
  }
  noise(g, s, rnd, 16000, 0.15, true); noise(g, s, rnd, 16000, 0.2, false);
};

const leaves: Draw = (g, s, rnd) => {
  g.fillStyle = '#6f8f55'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 2600; i++) {                     // overlapping leaf ellipses, light from above
    const x = rnd() * s, y = rnd() * s, r = 4 + rnd() * 9, l = 38 + rnd() * 34;
    g.fillStyle = `hsl(${85 + rnd() * 30},${30 + rnd() * 25}%,${l}%)`;
    g.beginPath(); g.ellipse(x, y, r, r * 0.55, rnd() * Math.PI, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(20,35,10,0.25)'; g.lineWidth = 1; g.stroke();
  }
};

const paint = (base: string): Draw => (g, s, rnd) => { g.fillStyle = base; g.fillRect(0, 0, s, s); noise(g, s, rnd, 5000, 0.03, false); noise(g, s, rnd, 3000, 0.03, true); };

const stripes = (a: string, b: string): Draw => (g, s, rnd) => {
  g.fillStyle = a; g.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += s / 8) { g.fillStyle = b; g.fillRect(x, 0, s / 16, s); g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(x + s / 16, 0, 2, s); }
  noise(g, s, rnd, 3000, 0.03, false);
};

const damask = (a: string, b: string): Draw => (g, s, rnd) => {
  g.fillStyle = a; g.fillRect(0, 0, s, s);
  g.fillStyle = b;
  for (let y = 0; y <= s; y += s / 4) for (let x = (y / (s / 4)) % 2 ? s / 8 : 0; x <= s; x += s / 4) {
    g.beginPath(); g.ellipse(x, y, s / 22, s / 12, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(x, y, s / 12, s / 40, 0, 0, Math.PI * 2); g.fill();
  }
  noise(g, s, rnd, 3000, 0.03, false);
};

const subway: Draw = (g, s, rnd) => {
  g.fillStyle = '#bdbab3'; g.fillRect(0, 0, s, s);
  const rows = 16, cols = 4;
  for (let r = 0; r < rows; r++) for (let c = -1; c < cols; c++) {
    const x = c * (s / cols) + (r % 2 ? s / cols / 2 : 0);
    g.fillStyle = `hsl(40, 10%, ${92 + rnd() * 5}%)`; g.fillRect(x + 2, r * (s / rows) + 2, s / cols - 4, s / rows - 4);
  }
};

const panel: Draw = (g, s, rnd) => {
  g.fillStyle = '#7a5a3e'; g.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += s / 6) {
    g.fillStyle = `hsl(28, 40%, ${30 + rnd() * 8}%)`; g.fillRect(x + 2, 0, s / 6 - 4, s);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, 0, 2, s);
  }
  noise(g, s, rnd, 8000, 0.08, false);
};

const herringbone: Draw = (g, s, rnd) => {
  g.fillStyle = '#5a3a20'; g.fillRect(0, 0, s, s);
  const bw = s / 16, bl = s / 4;
  for (let y = -bl; y < s + bl; y += bw * 2) for (let x = -bl; x < s + bl; x += bl) {
    for (const flip of [0, 1]) {
      g.save(); g.translate(x + (flip ? bl / 2 : 0), y + (flip ? bw : 0)); g.rotate(flip ? -Math.PI / 4 : Math.PI / 4);
      g.fillStyle = `hsl(${28 + rnd() * 8}, ${45 + rnd() * 10}%, ${40 + rnd() * 10}%)`; g.fillRect(0, 0, bl, bw - 2); g.restore();
    }
  }
};

const marble: Draw = (g, s, rnd) => {
  g.fillStyle = '#eceae6'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(90,90,100,${0.08 + rnd() * 0.15})`; g.lineWidth = 0.5 + rnd() * 2;
    g.beginPath(); let x = rnd() * s, y = rnd() * s; g.moveTo(x, y);
    for (let k = 0; k < 8; k++) { x += (rnd() - 0.3) * 90; y += (rnd() - 0.5) * 90; g.lineTo(x, y); }
    g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (const v of [0, s / 2]) { g.fillRect(v, 0, 2, s); g.fillRect(0, v, s, 2); }
};

const deckBoards: Draw = (g, s, rnd) => {
  for (let r = 0; r < 10; r++) {
    g.fillStyle = `hsl(${24 + rnd() * 6}, ${35 + rnd() * 10}%, ${42 + rnd() * 8}%)`; g.fillRect(0, (r * s) / 10, s, s / 10);
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, (r * s) / 10, s, 3);
    for (let k = 0; k < 8; k++) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(rnd() * s, (r * s) / 10 + s / 20, 3, 3); }
  }
  noise(g, s, rnd, 9000, 0.1, false);
};

const pavers: Draw = (g, s, rnd) => {
  g.fillStyle = '#8f8a80'; g.fillRect(0, 0, s, s);
  for (let r = 0; r < 6; r++) for (let c = -1; c < 4; c++) {
    const x = c * (s / 3) + (r % 2 ? s / 6 : 0);
    g.fillStyle = `hsl(35, ${10 + rnd() * 8}%, ${55 + rnd() * 12}%)`; g.fillRect(x + 3, r * (s / 6) + 3, s / 3 - 6, s / 6 - 6);
  }
  noise(g, s, rnd, 9000, 0.08, false);
};

const fenceWood: Draw = (g, s, rnd) => {
  g.fillStyle = '#8b6a4a'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 300; i++) { g.strokeStyle = `rgba(50,30,15,${0.05 + rnd() * 0.1})`; g.beginPath(); const x = rnd() * s; g.moveTo(x, 0); g.lineTo(x + (rnd() - 0.5) * 6, s); g.stroke(); }
};

const poolTile: Draw = (g, s, rnd) => {
  const grd = g.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.75);
  grd.addColorStop(0, '#1f8fbf'); grd.addColorStop(1, '#46b6d8');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
  for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo((i * s) / 8, 0); g.lineTo((i * s) / 8, s); g.stroke(); g.beginPath(); g.moveTo(0, (i * s) / 8); g.lineTo(s, (i * s) / 8); g.stroke(); }
  for (let i = 0; i < 220; i++) {                                  // caustic web
    g.strokeStyle = `rgba(220,250,255,${0.12 + rnd() * 0.22})`; g.lineWidth = 1 + rnd() * 2;
    g.beginPath(); const x = rnd() * s, y = rnd() * s; g.moveTo(x, y); g.quadraticCurveTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 60, x + (rnd() - 0.5) * 80, y + (rnd() - 0.5) * 80); g.stroke();
  }
};

const grassBump: Draw = (g, s, rnd) => {
  g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 30000; i++) {
    const x = rnd() * s, y = rnd() * s, v = Math.floor(rnd() * 255);
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 2, y - 2 - rnd() * 4); g.stroke();
  }
};

// ------------------------------------------------------------------ library

export class MaterialLibrary {
  private cache = new Map<string, MatEntry>();
  readonly grassDetail: THREE.CanvasTexture;
  /** Textures that drift each frame (pool caustics). */
  readonly animated: THREE.Texture[] = [];
  tick(dt: number) { for (const t of this.animated) { t.offset.x += dt * 0.02; t.offset.y += dt * 0.013; } }

  constructor() {
    this.grassDetail = canvasTex(512, 77, grassBump, false);
  }

  get(name: string): MatEntry {
    let e = this.cache.get(name);
    if (!e) { e = this.make(name); this.cache.set(name, e); }
    return e;
  }

  private std(map: THREE.Texture | null, rough: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    const m = new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0, ...opts });
    if (map) { m.bumpMap = map; m.bumpScale = opts.bumpScale ?? 1.2; }
    return m;
  }

  private make(name: string): MatEntry {
    const T = (seed: number, d: Draw) => canvasTex(512, seed, d);
    switch (name) {
      case 'siding_white': return { material: this.std(T(1, siding('#e9e6df')), 0.75), tile: 1.2 };
      case 'siding_sage':  return { material: this.std(T(2, siding('#8f9d84')), 0.75), tile: 1.2 };
      case 'siding_navy':  return { material: this.std(T(20, siding('#2f3e57')), 0.75), tile: 1.2 };
      case 'brick_white':  return { material: this.std(T(21, brick), 0.9, { color: 0xf3efe8 }), tile: 1.2 };
      case 'board_batten': return { material: this.std(T(22, (g, s, rnd) => { g.fillStyle = '#efece6'; g.fillRect(0, 0, s, s); for (let x = 0; x < s; x += s / 4) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, 0, 6, s); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(x + 6, 0, 3, s); } noise(g, s, rnd, 3000, 0.04, false); }), 0.7), tile: 1.6 };
      case 'paint_white':  return { material: this.std(T(23, paint('#ece8e1')), 0.9), tile: 2 };
      case 'paint_greige': return { material: this.std(T(24, paint('#cfc5b4')), 0.9), tile: 2 };
      case 'paint_sage':   return { material: this.std(T(25, paint('#a9b8a0')), 0.9), tile: 2 };
      case 'paint_navy':   return { material: this.std(T(26, paint('#2e3d58')), 0.85), tile: 2 };
      case 'paint_blush':  return { material: this.std(T(27, paint('#e3c2bb')), 0.9), tile: 2 };
      case 'paint_charcoal': return { material: this.std(T(28, paint('#3b3d40')), 0.85), tile: 2 };
      case 'wallpaper_stripe': return { material: this.std(T(29, stripes('#e8e2d2', '#b9c7c0')), 0.9), tile: 1.2 };
      case 'wallpaper_damask': return { material: this.std(T(30, damask('#2f4a43', '#c9b27a')), 0.85), tile: 1.0 };
      case 'tile_subway':  return { material: this.std(T(31, subway), 0.3), tile: 1.2 };
      case 'panel_wood':   return { material: this.std(T(32, panel), 0.65), tile: 1.5 };
      case 'herringbone':  return { material: this.std(T(33, herringbone), 0.5), tile: 1.6 };
      case 'marble':       return { material: this.std(T(34, marble), 0.2), tile: 1.2 };
      case 'deck':         return { material: this.std(T(35, deckBoards), 0.8), tile: 1.6 };
      case 'patio':        return { material: this.std(T(36, pavers), 0.9), tile: 1.8 };
      case 'fence_wood':   return { material: this.std(T(37, fenceWood), 0.85), tile: 1.0 };
      case 'coping':       return { material: this.std(T(38, pavers), 0.8, { color: 0xe8e2d6 }), tile: 1.0 };
      case 'metal_dark':   return { material: new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.35, metalness: 0.8 }), tile: 1 };
      case 'pool_water': {
        const map = T(39, poolTile);
        const m = new THREE.MeshStandardMaterial({ map, roughness: 0.05, metalness: 0.15, emissive: 0x0a3a50, emissiveIntensity: 0.25 });
        this.animated.push(map);
        return { material: m, tile: 4 };
      }
      case 'brick_red':    return { material: this.std(T(3, brick), 0.9), tile: 1.2 };
      case 'stucco_sand':  return { material: this.std(T(4, stucco), 0.95), tile: 1.5 };
      case 'stone':        return { material: this.std(T(5, stone), 0.9), tile: 1.6 };
      case 'interior':
      case 'drywall':      return { material: this.std(T(6, drywall), 0.9), tile: 2.0 };
      case 'oak':          return { material: this.std(T(7, planks(32, 52)), 0.55), tile: 2.0 };
      case 'walnut':       return { material: this.std(T(8, planks(22, 28)), 0.5), tile: 2.0 };
      case 'tile':         return { material: this.std(T(9, tile), 0.35), tile: 1.2 };
      case 'carpet':       return { material: this.std(T(10, carpet), 1.0), tile: 1.0 };
      case 'slate':        return { material: this.std(T(11, slate), 0.6), tile: 1.8 };
      case 'concrete':     return { material: this.std(T(12, concrete), 0.85), tile: 2.5 };
      case 'foundation':   return { material: this.std(T(13, concrete), 0.9, { color: 0xb8b4ad }), tile: 2.5 };
      case 'asphalt':      return { material: this.std(canvasTex(1024, 14, asphalt), 0.88, { bumpScale: 0.8 }), tile: 8 };
      case 'sidewalk':     return { material: this.std(T(15, concrete), 0.85), tile: 1.5 };
      case 'shingle':      return { material: this.std(T(16, shingles), 0.85), tile: 2.0 };
      case 'grass':        return { material: this.std(T(17, grass), 1.0, { bumpScale: 2 }), tile: 3.0 };
      case 'bark':         return { material: this.std(T(18, bark), 0.95, { bumpScale: 3 }), tile: 1 };
      case 'leaves':       return { material: this.std(T(19, leaves), 0.85, { bumpScale: 2.5 }), tile: 1 };
      case 'trim':         return { material: new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.45 }), tile: 1 };
      case 'soffit':       return { material: new THREE.MeshStandardMaterial({ color: 0xdedad2, roughness: 0.8, side: THREE.DoubleSide }), tile: 1 };
      case 'door':         return { material: new THREE.MeshStandardMaterial({ color: 0x5a2e1b, roughness: 0.5 }), tile: 1 };
      case 'metal':        return { material: new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.3, metalness: 1 }), tile: 1 };
      case 'flatroof':     return { material: new THREE.MeshStandardMaterial({ color: 0x55575a, roughness: 0.95 }), tile: 1 };
      case 'glass':        return {
        material: new THREE.MeshStandardMaterial({ color: 0x9fb9c7, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false }),
        tile: 1,
      };
      case 'glass_frosted': return {
        material: new THREE.MeshStandardMaterial({ color: 0xe9eef0, roughness: 0.55, metalness: 0, transparent: true, opacity: 0.82, depthWrite: false }),
        tile: 1,
      };
      case 'shutter':      return { material: new THREE.MeshStandardMaterial({ color: 0x23302a, roughness: 0.55 }), tile: 1 };
      default:             return { material: new THREE.MeshStandardMaterial({ color: 0xff00ff }), tile: 1 };
    }
  }
}

/**
 * Re-project UVs on an (already world-positioned) geometry using a box
 * projection, so texture density is constant in meters.
 */
export function worldBoxUV(geo: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u: number, v: number;
    if (ny >= nx && ny >= nz) { u = x; v = z; }
    else if (nx >= nz) { u = z; v = y; }
    else { u = x; v = y; }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
