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

function canvasTex(size: number, seed: number, draw: Draw, srgb = true): THREE.CanvasTexture {
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
  g.fillStyle = '#3b3c3e'; g.fillRect(0, 0, s, s);
  noise(g, s, rnd, 60000, 0.12, true); noise(g, s, rnd, 40000, 0.2, false);
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
      case 'brick_red':    return { material: this.std(T(3, brick), 0.9), tile: 1.2 };
      case 'stucco_sand':  return { material: this.std(T(4, stucco), 0.95), tile: 1.5 };
      case 'stone':        return { material: this.std(T(5, stone), 0.9), tile: 1.6 };
      case 'interior':     return { material: this.std(T(6, drywall), 0.9), tile: 2.0 };
      case 'oak':          return { material: this.std(T(7, planks(32, 52)), 0.55), tile: 2.0 };
      case 'walnut':       return { material: this.std(T(8, planks(22, 28)), 0.5), tile: 2.0 };
      case 'tile':         return { material: this.std(T(9, tile), 0.35), tile: 1.2 };
      case 'carpet':       return { material: this.std(T(10, carpet), 1.0), tile: 1.0 };
      case 'slate':        return { material: this.std(T(11, slate), 0.6), tile: 1.8 };
      case 'concrete':     return { material: this.std(T(12, concrete), 0.85), tile: 2.5 };
      case 'foundation':   return { material: this.std(T(13, concrete), 0.9, { color: 0xb8b4ad }), tile: 2.5 };
      case 'asphalt':      return { material: this.std(T(14, asphalt), 0.92), tile: 4 };
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
