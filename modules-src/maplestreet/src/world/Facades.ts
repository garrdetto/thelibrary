/**
 * Downtown facades. Each building gets a wall style (brick, limestone,
 * stucco, metal panel, glass curtain wall or corrugated industrial) and a
 * window layout shared by the painted texture and the 3D trim, so sills,
 * lintels, string courses and storefront mullions line up with the windows
 * drawn on the wall. A third canvas carries roughness (G) and metalness (B),
 * so glass is glossy and reflects the sky while masonry stays matte.
 */
import * as THREE from 'three/webgpu';
import type { Building } from '../../shared/WorldLayout';

export type FacadeStyle = 'brick' | 'stone' | 'stucco' | 'panel' | 'curtain' | 'industrial';

export function styleOf(b: Building): FacadeStyle {
  if (b.id === 'depot') return 'industrial';
  if (b.kind === 'office') return 'curtain';
  if (b.kind === 'bank') return 'stone';
  if (b.kind === 'dealer' || b.kind === 'grocery' || b.kind === 'gas') return 'panel';
  if (b.kind === 'cafe') return 'stucco';
  return 'brick';
}

export const FLOOR_H = 3.4;

export interface Win { u0: number; u1: number; v0: number; v1: number }
export interface Storefront { v0: number; v1: number; top: number; mullions: number[]; door: { u0: number; u1: number } }
export interface Bay { u0: number; u1: number; v1: number }
export interface FacadeLayout { w: number; h: number; style: FacadeStyle; groundH: number; floors: number[]; windows: Win[]; store: Storefront | null; bays: Bay[]; lobby: { u0: number; u1: number; v1: number } | null }

const isShop = (b: Building) => b.kind !== 'office' && b.kind !== 'apartments';

/** Window and storefront positions in metres (u from the face's left edge, v from the ground). Symmetric, so face direction doesn't matter. */
export function facadeLayout(b: Building, w: number, h: number, front: boolean): FacadeLayout {
  const style = styleOf(b);
  const shop = isShop(b);
  const groundH = style === 'curtain' ? 4.5 : shop ? Math.min(h, 4.2) : 4;
  const floors: number[] = [];
  for (let y = groundH; y + FLOOR_H <= h - 0.4; y += FLOOR_H) floors.push(y);
  const windows: Win[] = [];
  const grid = (spacing: number, ww: number, v0: number, v1: number, margin = 1) => {
    const n = Math.max(1, Math.floor((w - margin * 2 + (spacing - ww)) / spacing));
    const span = (n - 1) * spacing + ww;
    for (let i = 0; i < n; i++) { const u0 = (w - span) / 2 + i * spacing; windows.push({ u0, u1: u0 + ww, v0, v1 }); }
  };
  if (style === 'curtain') {
    for (const y of floors) grid(1.5, 1.42, y + 0.95, y + FLOOR_H - 0.12, 0.3);
  } else if (style === 'industrial') {
    if (!front) grid(4, 1.6, h - 2.4, h - 1.4, 1.5);
  } else if (style === 'panel') {
    if (!front && h > 5) grid(3.4, 1.4, 2.6, 3.4, 1.4);
  } else {
    const ww = style === 'stone' ? 1.25 : 1.15, wh = style === 'stone' ? 2.1 : 1.75;
    for (const y of floors) grid(style === 'stone' ? 2.5 : 2.4, ww, y + 0.85, y + 0.85 + wh, 1.1);
    // One-storey shops still get a row of upper windows in the sign band's absence.
    if (!floors.length && !front && h > 5) grid(2.8, 1.0, 2.2, 3.4, 1.6);
  }
  let store: Storefront | null = null;
  const bays: Bay[] = [];
  let lobby: FacadeLayout['lobby'] = null;
  if (front && shop) {
    const top = Math.min(groundH, 3.25);
    const v0 = 0.45, v1 = Math.min(2.85, top - 0.3);
    const mullions: number[] = [];
    const margin = 0.5, spacing = 2.2;
    const n = Math.max(1, Math.round((w - margin * 2) / spacing));
    for (let i = 0; i <= n; i++) mullions.push(margin + ((w - margin * 2) * i) / n);
    store = { v0, v1, top, mullions, door: { u0: w / 2 - 0.55, u1: w / 2 + 0.55 } };
  } else if (front && style === 'industrial') {
    for (const u of [w * 0.28, w * 0.55, w * 0.8]) bays.push({ u0: u - 1.7, u1: u + 1.7, v1: 4.2 });
  } else if (front) {
    lobby = { u0: w / 2 - 1.6, u1: w / 2 + 1.6, v1: style === 'curtain' ? groundH - 0.2 : 2.9 };
  }
  return { w, h, style, groundH, floors, windows, store, bays, lobby };
}

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

const shade = (hex: string, k: number) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return `#${c.getHexString()}`; };

/** Albedo, night glow and roughness/metalness canvases for one face. */
export function facadeTextures(b: Building, L: FacadeLayout, seed: number) {
  const ppm = Math.min(40, 2048 / Math.max(L.w, L.h));
  const W = Math.max(64, Math.round(L.w * ppm)), H = Math.max(64, Math.round(L.h * ppm));
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const albedo = mk(), glow = mk(), orm = mk();
  const g = albedo.getContext('2d')!, e = glow.getContext('2d')!, o = orm.getContext('2d')!;
  const R = rng(seed);
  const X = (u: number) => u * ppm, Y = (v: number) => H - v * ppm;
  const rect = (ctx: CanvasRenderingContext2D, u0: number, v0: number, u1: number, v1: number) => ctx.fillRect(X(u0), Y(v1), (u1 - u0) * ppm, (v1 - v0) * ppm);
  const rough = (u0: number, v0: number, u1: number, v1: number, r: number, m = 0) => { o.fillStyle = `rgb(0,${Math.round(r * 255)},${Math.round(m * 255)})`; rect(o, u0, v0, u1, v1); };

  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  rough(0, 0, L.w, L.h, L.style === 'panel' ? 0.55 : 0.92, L.style === 'panel' ? 0.35 : 0);

  // ---- wall material (brick is pulled toward a fired-clay red so painted storefront colors still read as brick)
  const base = L.style === 'brick' ? `#${new THREE.Color(b.color).lerp(new THREE.Color('#8a4f3c'), 0.45).getHexString()}` : b.color;
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  if (L.style === 'brick') {
    g.fillStyle = shade('#b9b0a2', 0.95); g.fillRect(0, 0, W, H);
    const ch = 0.077 * ppm, bl = 0.215 * ppm;
    for (let r = 0, y = H; y > -ch; r++, y -= ch) {
      for (let x = (r % 2) * -bl / 2; x < W; x += bl) {
        const k = 0.86 + R() * 0.22;
        g.fillStyle = shade(base, k);
        g.fillRect(x + 0.5, y - ch + 0.6, bl - 1, ch - 0.9);
      }
    }
  } else if (L.style === 'stone') {
    const ch = 0.6 * ppm, bl = 1.2 * ppm;
    g.fillStyle = shade(base, 0.82); g.fillRect(0, 0, W, H);
    for (let r = 0, y = H; y > -ch; r++, y -= ch) {
      for (let x = (r % 2) * -bl / 2; x < W; x += bl) { g.fillStyle = shade(base, 0.93 + R() * 0.1); g.fillRect(x + 1, y - ch + 1, bl - 2, ch - 2); }
    }
    // Rusticated base
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = H; y > Y(L.groundH); y -= ch) g.fillRect(0, y - 2, W, 2);
  } else if (L.style === 'stucco') {
    for (let i = 0; i < W * H * 0.15; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${R() * 0.05})`; g.fillRect(R() * W, R() * H, 2, 2); }
  } else if (L.style === 'panel') {
    for (let u = 0; u < L.w; u += 1.0) { g.fillStyle = 'rgba(0,0,0,0.16)'; rect(g, u, 0, u + 0.02, L.h); g.fillStyle = 'rgba(255,255,255,0.08)'; rect(g, u + 0.02, 0, u + 0.05, L.h); }
    for (let v = 1.2; v < L.h; v += 2.4) { g.fillStyle = 'rgba(0,0,0,0.12)'; rect(g, 0, v, L.w, v + 0.02); }
  } else if (L.style === 'industrial') {
    for (let u = 0; u < L.w; u += 0.2) {
      const grd = g.createLinearGradient(X(u), 0, X(u + 0.2), 0);
      grd.addColorStop(0, 'rgba(0,0,0,0.18)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(0,0,0,0.18)');
      g.fillStyle = grd; rect(g, u, 0, u + 0.2, L.h);
    }
    g.fillStyle = '#6b6f73'; rect(g, 0, 0, L.w, 0.9);           // concrete knee wall
  } else if (L.style === 'curtain') {
    g.fillStyle = shade(base, 0.55); g.fillRect(0, 0, W, H);     // dark spandrel glass
    rough(0, 0, L.w, L.h, 0.25, 0.5);
  }
  // Weathering: soot streaks under the cornice and a darker plinth.
  const grime = g.createLinearGradient(0, 0, 0, H * 0.25);
  grime.addColorStop(0, 'rgba(0,0,0,0.16)'); grime.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grime; g.fillRect(0, 0, W, H * 0.25);
  if (L.style !== 'curtain') { g.fillStyle = 'rgba(0,0,0,0.12)'; rect(g, 0, 0, L.w, 0.35); }

  // ---- string courses
  if (L.style === 'brick' || L.style === 'stone' || L.style === 'stucco') {
    for (const f of L.floors) { g.fillStyle = shade('#ddd6c8', 1); rect(g, 0, f - 0.06, L.w, f + 0.06); g.fillStyle = 'rgba(0,0,0,0.25)'; rect(g, 0, f - 0.09, L.w, f - 0.06); }
  }

  // ---- windows
  const trimCol = L.style === 'brick' ? '#efe9dd' : L.style === 'curtain' ? '#3b444c' : '#3a3632';
  for (const w of L.windows) {
    const { u0, u1, v0, v1 } = w;
    if (L.style !== 'curtain') {
      g.fillStyle = L.style === 'brick' ? '#d8cfbf' : shade(base, 1.08); rect(g, u0 - 0.1, v1, u1 + 0.1, v1 + 0.2);    // lintel
      g.fillStyle = '#d8cfbf'; rect(g, u0 - 0.08, v0 - 0.08, u1 + 0.08, v0);                                         // sill
      g.fillStyle = 'rgba(0,0,0,0.4)'; rect(g, u0 - 0.03, v0, u1 + 0.03, v1 + 0.01);                                  // reveal shadow
    }
    // Glass: sky reflection fading to the dim room behind.
    const grd = g.createLinearGradient(0, Y(v1), 0, Y(v0));
    grd.addColorStop(0, `hsl(${205 + R() * 10}, 28%, ${42 + R() * 10}%)`); grd.addColorStop(0.55, `hsl(210, 22%, ${22 + R() * 8}%)`); grd.addColorStop(1, 'hsl(215, 18%, 16%)');
    g.fillStyle = grd; rect(g, u0 + 0.05, v0 + 0.05, u1 - 0.05, v1 - 0.05);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.moveTo(X(u0 + 0.05), Y(v1 - 0.05)); g.lineTo(X(u0 + (u1 - u0) * 0.45), Y(v1 - 0.05)); g.lineTo(X(u0 + 0.05), Y(v0 + (v1 - v0) * 0.4)); g.fill();
    rough(u0 + 0.05, v0 + 0.05, u1 - 0.05, v1 - 0.05, 0.06, L.style === 'curtain' ? 0.6 : 0.15);
    // Blinds or curtains in about half of them.
    const lit = R() < 0.5;
    const blind = R();
    if (L.style !== 'curtain' && blind < 0.45) {
      const drop = (v1 - v0) * (0.2 + R() * 0.5);
      g.fillStyle = `hsl(40, 20%, ${70 + R() * 15}%)`; rect(g, u0 + 0.05, v1 - 0.05 - drop, u1 - 0.05, v1 - 0.05);
      g.fillStyle = 'rgba(0,0,0,0.12)'; for (let v = v1 - 0.08; v > v1 - drop; v -= 0.05) rect(g, u0 + 0.05, v, u1 - 0.05, v + 0.01);
    } else if (L.style !== 'curtain' && blind < 0.7) {
      g.fillStyle = `hsl(${R() * 360}, 25%, 55%)`; rect(g, u0 + 0.05, v0 + 0.05, u0 + 0.28, v1 - 0.05); rect(g, u1 - 0.28, v0 + 0.05, u1 - 0.05, v1 - 0.05);
    }
    // Frame and meeting rail
    g.strokeStyle = trimCol; g.lineWidth = Math.max(1, 0.05 * ppm);
    g.strokeRect(X(u0 + 0.025), Y(v1 - 0.025), (u1 - u0 - 0.05) * ppm, (v1 - v0 - 0.05) * ppm);
    if (L.style === 'curtain') { g.fillStyle = trimCol; rect(g, u0 - 0.04, v0 - 0.95, u0, v1 + 0.12); }
    else { g.fillStyle = trimCol; rect(g, u0, (v0 + v1) / 2 - 0.025, u1, (v0 + v1) / 2 + 0.025); }
    if (lit) {
      e.fillStyle = `hsl(${34 + R() * 14}, ${70 + R() * 20}%, ${48 + R() * 22}%)`; rect(e, u0 + 0.05, v0 + 0.05, u1 - 0.05, v1 - 0.05);
      if (blind < 0.45) { e.fillStyle = 'rgba(0,0,0,0.45)'; rect(e, u0 + 0.05, (v0 + v1) / 2, u1 - 0.05, v1 - 0.05); }
    }
  }

  // ---- storefront
  const S = L.store;
  if (S) {
    g.fillStyle = '#2a2d30'; rect(g, 0.35, 0, L.w - 0.35, S.top);                           // frame field
    g.fillStyle = shade(base, 0.6); rect(g, 0.35, 0, L.w - 0.35, S.v0);                     // bulkhead
    // Interior seen through the glass: ceiling lights, back wall, shelving.
    const gi = g.createLinearGradient(0, Y(S.v1), 0, Y(S.v0));
    gi.addColorStop(0, '#5e6b74'); gi.addColorStop(0.35, '#3d454b'); gi.addColorStop(1, '#2a2f33');
    g.fillStyle = gi; rect(g, 0.4, S.v0, L.w - 0.4, S.v1);
    for (let u = 0.8; u < L.w - 0.8; u += 1.6) { g.fillStyle = 'rgba(255,248,225,0.55)'; rect(g, u, S.v1 - 0.2, u + 0.8, S.v1 - 0.14); }
    for (let u = 0.6; u < L.w - 1; u += 0.9 + R() * 0.8) {
      const sh = 0.6 + R() * 0.9;
      g.fillStyle = `hsl(${R() * 360}, ${8 + R() * 18}%, ${26 + R() * 18}%)`; rect(g, u, S.v0 + 0.1, u + 0.5 + R() * 0.4, S.v0 + 0.1 + sh);
    }
    g.fillStyle = 'rgba(255,255,255,0.13)';
    for (let u = 0.4; u < L.w; u += 2.6) { g.beginPath(); g.moveTo(X(u), Y(S.v1)); g.lineTo(X(u + 1.1), Y(S.v1)); g.lineTo(X(u + 0.2), Y(S.v0)); g.lineTo(X(u - 0.9), Y(S.v0)); g.fill(); }
    rough(0.4, S.v0, L.w - 0.4, S.top - 0.05, 0.05, 0.1);
    // Transom
    g.fillStyle = '#4a5964'; rect(g, 0.4, S.v1 + 0.06, L.w - 0.4, S.top - 0.06);
    // Door: glass with a push bar
    g.fillStyle = '#1f2326'; rect(g, S.door.u0 - 0.05, 0, S.door.u1 + 0.05, S.v1 + 0.05);
    g.fillStyle = '#4a5560'; rect(g, S.door.u0 + 0.06, 0.12, S.door.u1 - 0.06, S.v1 - 0.06);
    g.fillStyle = '#c0c4c8'; rect(g, S.door.u0 + 0.12, 1.0, S.door.u1 - 0.12, 1.05);
    e.fillStyle = '#ffd9a0'; rect(e, 0.4, S.v0, L.w - 0.4, S.top - 0.06);
    e.fillStyle = '#fff4dc'; for (let u = 0.8; u < L.w - 0.8; u += 1.6) rect(e, u, S.v1 - 0.2, u + 0.8, S.v1 - 0.14);
    e.fillStyle = '#000'; rect(e, S.door.u0 - 0.05, 0, S.door.u1 + 0.05, 0.12);
  }
  for (const bay of L.bays) {
    g.fillStyle = '#2b2d2f'; rect(g, bay.u0 - 0.12, 0, bay.u1 + 0.12, bay.v1 + 0.12);
    for (let v = 0; v < bay.v1; v += 0.3) { g.fillStyle = v % 0.6 < 0.3 ? '#a9adb1' : '#9a9ea2'; rect(g, bay.u0, v, bay.u1, v + 0.28); }
    g.fillStyle = '#e0b400'; rect(g, bay.u0 - 0.25, 0, bay.u0 - 0.12, 1.2); rect(g, bay.u1 + 0.12, 0, bay.u1 + 0.25, 1.2);
    rough(bay.u0, 0, bay.u1, bay.v1, 0.45, 0.6);
  }
  if (L.lobby) {
    const lb = L.lobby;
    g.fillStyle = '#26292c'; rect(g, lb.u0 - 0.1, 0, lb.u1 + 0.1, lb.v1 + 0.1);
    const gl = g.createLinearGradient(0, Y(lb.v1), 0, 0);
    gl.addColorStop(0, '#62717c'); gl.addColorStop(1, '#30373c');
    g.fillStyle = gl; rect(g, lb.u0, 0.05, lb.u1, lb.v1);
    g.fillStyle = '#26292c'; rect(g, (lb.u0 + lb.u1) / 2 - 0.03, 0, (lb.u0 + lb.u1) / 2 + 0.03, lb.v1);
    rough(lb.u0, 0, lb.u1, lb.v1, 0.05, 0.15);
    e.fillStyle = '#ffe0b0'; rect(e, lb.u0, 0.05, lb.u1, lb.v1);
  }

  const tex = (c: HTMLCanvasElement, srgb: boolean) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  return { map: tex(albedo, true), emissive: tex(glow, true), orm: tex(orm, false) };
}

/** 3D trim that matches the painted layout: sills, lintels, string courses, mullions, quoins. Returns boxes in face space. */
export interface FaceBox { u0: number; u1: number; v0: number; v1: number; out: number; depth: number; mat: 'trim' | 'dark' | 'wall' | 'metal' }

export function faceTrim(L: FacadeLayout): FaceBox[] {
  const out: FaceBox[] = [];
  const masonry = L.style === 'brick' || L.style === 'stone' || L.style === 'stucco';
  if (masonry) {
    for (const w of L.windows) {
      out.push({ u0: w.u0 - 0.1, u1: w.u1 + 0.1, v0: w.v0 - 0.08, v1: w.v0, out: 0.1, depth: 0.12, mat: 'trim' });
      out.push({ u0: w.u0 - 0.12, u1: w.u1 + 0.12, v0: w.v1, v1: w.v1 + 0.2, out: 0.05, depth: 0.08, mat: 'trim' });
    }
    for (const f of L.floors) out.push({ u0: 0, u1: L.w, v0: f - 0.07, v1: f + 0.07, out: 0.06, depth: 0.08, mat: 'trim' });
    if (L.style !== 'stucco') for (const u of [0, L.w - 0.42]) out.push({ u0: u, u1: u + 0.42, v0: 0, v1: L.h, out: 0.06, depth: 0.1, mat: 'wall' });
  }
  if (L.style === 'curtain') {
    for (let u = 0.3 - 0.04; u <= L.w - 0.25; u += 1.5) out.push({ u0: u, u1: u + 0.08, v0: L.groundH, v1: L.h, out: 0.14, depth: 0.16, mat: 'metal' });
    for (const f of L.floors) out.push({ u0: 0, u1: L.w, v0: f + 0.9, v1: f + 0.96, out: 0.05, depth: 0.06, mat: 'metal' });
  }
  const S = L.store;
  if (S) {
    out.push({ u0: 0.35, u1: L.w - 0.35, v0: 0, v1: S.v0, out: 0.06, depth: 0.1, mat: 'dark' });
    for (const m of S.mullions) if (m < S.door.u0 - 0.1 || m > S.door.u1 + 0.1) out.push({ u0: m - 0.04, u1: m + 0.04, v0: S.v0, v1: S.top, out: 0.05, depth: 0.08, mat: 'dark' });
    out.push({ u0: 0.35, u1: L.w - 0.35, v0: S.v1, v1: S.v1 + 0.07, out: 0.05, depth: 0.08, mat: 'dark' });
    out.push({ u0: S.door.u0 - 0.08, u1: S.door.u0, v0: 0, v1: S.v1, out: 0.05, depth: 0.08, mat: 'dark' });
    out.push({ u0: S.door.u1, u1: S.door.u1 + 0.08, v0: 0, v1: S.v1, out: 0.05, depth: 0.08, mat: 'dark' });
  }
  if (L.lobby) {
    const lb = L.lobby;
    out.push({ u0: lb.u0 - 0.6, u1: lb.u1 + 0.6, v0: lb.v1 + 0.15, v1: lb.v1 + 0.35, out: 1.6, depth: 1.6, mat: 'metal' });   // entrance canopy
  }
  return out;
}
