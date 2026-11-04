/**
 * Procedural hairstyles and hats that ride on the head bone: long hair is a
 * strand-textured curtain grown from the scalp (the scanned hair is pressed flat under it),
 * buns are knotted spheres, and the three hats are lathed/knit shells.
 * Geometry is built once per body and shared; only materials are per avatar.
 */
import * as THREE from 'three/webgpu';
import type { Body } from '../../shared/Wardrobe';
import { RIG } from './RigData';

let strandTex: THREE.Texture | null = null;
/**
 * Grayscale strand streaks; alpha frays the tips at the bottom. Built straight
 * into a pixel buffer: reading a canvas back (getImageData) forces a GPU
 * readback that stalled the frame the first time long hair came into view.
 */
function strands() {
  if (strandTex) return strandTex;
  const N = 256, data = new Uint8Array(N * N * 4);
  // Columns are uniform top to bottom, so composite one row of streaks, then copy it down.
  const row = new Float32Array(N).fill(0x9a);
  let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 900; i++) {
    const x = r() * N, w = 0.6 + r() * 1.8, v = 90 + r() * 165, a = 0.25 + r() * 0.5;
    for (let col = Math.floor(x); col < Math.min(N, Math.ceil(x + w)); col++) {
      const cover = Math.min(col + 1, x + w) - Math.max(col, x);      // antialiased edges, like fillRect
      const k = a * Math.max(0, Math.min(1, cover));
      row[col] = row[col] * (1 - k) + v * k;
    }
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const o = ((N - 1 - y) * N + x) * 4;                                  // row 0 is the bottom of the texture
    const v = Math.round(row[x]);
    data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
  }
  for (let x = 0; x < N; x++) {
    const cut = 214 + Math.floor(r() * 40);
    for (let y = cut; y < N; y++) data[((N - 1 - y) * N + x) * 4 + 3] = 0;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  strandTex = tex;
  return strandTex;
}

let knitTex: THREE.Texture | null = null;
function knit() {
  if (knitTex) return knitTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, 64, 64);
  for (let x = 0; x < 64; x += 8) { g.fillStyle = '#ffffff'; g.fillRect(x, 0, 4, 64); g.fillStyle = '#9a9a9a'; g.fillRect(x + 5, 0, 2, 64); }
  for (let y = 0; y < 64; y += 4) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, y, 64, 1); }
  knitTex = new THREE.CanvasTexture(c);
  knitTex.wrapS = knitTex.wrapT = THREE.RepeatWrapping;
  knitTex.colorSpace = THREE.SRGBColorSpace;
  return knitTex;
}

/**
 * A surface grown around the hair ellipsoid. Each column (azimuth, 0 = front)
 * runs from the crown over the ellipsoid and then straight down to `bottom`,
 * flaring slightly; the front columns stop at the fringe to leave the face open.
 */
function curtain(body: Body, opts: { bottom: number; faceHalf: number; fringe: number; flare: number; grow: number }) {
  const { c, r } = body === 'female' ? RIG[body].hairShell : RIG[body].scalp;
  const cols = 56, rows = 30;
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  for (let i = 0; i <= cols; i++) {
    const a = -Math.PI + (i / cols) * Math.PI * 2;
    const front = Math.abs(a) < opts.faceHalf;
    const edge = THREE.MathUtils.smoothstep(Math.abs(a), opts.faceHalf, opts.faceHalf + 0.35);
    const maxTheta = front ? opts.fringe : Math.PI / 2;
    const drop = front ? 0 : (c[1] - opts.bottom) * edge;
    const arc = maxTheta * Math.max(r[0], r[2]);
    const total = arc + drop;
    for (let j = 0; j <= rows; j++) {
      const s = (j / rows) * total;
      let x: number, y: number, z: number;
      const sa = Math.sin(a), ca = Math.cos(a);
      if (s <= arc) {
        const th = (s / arc) * maxTheta;
        x = Math.sin(th) * sa * r[0] * opts.grow; z = Math.sin(th) * ca * r[2] * opts.grow; y = Math.cos(th) * r[1] * opts.grow;
      } else {
        const t = (s - arc) / Math.max(drop, 1e-4);
        const k = opts.grow * (1 + opts.flare * t * t);
        x = sa * r[0] * k; z = ca * r[2] * k - 0.025 * t; y = -(s - arc);
      }
      pos.push(c[0] + x, c[1] + y, c[2] + z);
      uvs.push((i / cols) * 6, j / rows);
    }
  }
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const a = i * (rows + 1) + j, b = a + rows + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function bun(body: Body, top: boolean) {
  const { c, r } = RIG[body].hairShell;
  const g = new THREE.SphereGeometry(top ? 0.062 : 0.05, 20, 14);
  g.scale(1, 0.85, 1);
  const knot = new THREE.TorusGeometry(top ? 0.05 : 0.04, 0.018, 8, 20);
  knot.rotateX(Math.PI / 2);
  knot.translate(0, -0.035, 0);
  const at = top ? [c[0], c[1] + r[1] * 0.92, c[2] - r[2] * 0.25] : [c[0], c[1] + r[1] * 0.55, c[2] - r[2] * 0.95];
  for (const geo of [g, knot]) geo.translate(at[0], at[1], at[2]);
  return [g, knot];
}

export type HatKind = 'beanie' | 'cap' | 'bucket';

function hatGeometry(body: Body, kind: HatKind) {
  const { c, r: s0 } = body === 'female' ? RIG[body].hairShell : RIG[body].scalp;
  const k = body === 'female' ? 0.98 : 1.08;
  const r = [s0[0] * k, s0[1] * (body === 'female' ? 0.92 : 1.04), s0[2] * k];
  const parts: { geo: THREE.BufferGeometry; accent: boolean }[] = [];
  const shell = (scale: number, thetaLen: number) => {
    const g = new THREE.SphereGeometry(1, 36, 18, 0, Math.PI * 2, 0, thetaLen);
    g.scale(r[0] * scale, r[1] * scale, r[2] * scale);
    return g;
  };
  if (kind === 'beanie') {
    const crown = shell(1.1, Math.PI * 0.52);
    crown.scale(1, 1.08, 1);
    const cuff = new THREE.CylinderGeometry(1, 1, 0.055, 36, 1, true);
    cuff.scale(r[0] * 1.14, 1, r[2] * 1.14);
    cuff.translate(0, 0.0, 0);
    parts.push({ geo: crown, accent: false }, { geo: cuff, accent: true });
  } else if (kind === 'cap') {
    const crown = shell(1.07, Math.PI * 0.5);
    crown.scale(1, 0.84, 1);
    const brim = new THREE.CylinderGeometry(1, 1, 0.012, 32, 1, false, -Math.PI * 0.42, Math.PI * 0.84);
    brim.scale(r[0] * 1.2, 1, r[2] * 1.75);
    brim.translate(0, 0.004, r[2] * 0.12);
    const button = new THREE.SphereGeometry(0.012, 8, 6);
    button.translate(0, r[1] * 0.99, 0);
    parts.push({ geo: crown, accent: false }, { geo: brim, accent: true }, { geo: button, accent: true });
  } else {
    const prof: THREE.Vector2[] = [];
    const R = Math.max(r[0], r[2]) * 1.1;
    prof.push(new THREE.Vector2(0, r[1] * 0.98), new THREE.Vector2(R * 0.82, r[1] * 0.95), new THREE.Vector2(R * 0.98, r[1] * 0.5), new THREE.Vector2(R * 1.04, 0.0), new THREE.Vector2(R * 1.55, -0.055), new THREE.Vector2(R * 1.6, -0.065));
    const g = new THREE.LatheGeometry(prof, 36);
    g.scale(r[0] / Math.max(r[0], r[2]), 1, r[2] / Math.max(r[0], r[2]));
    const band = new THREE.CylinderGeometry(R * 1.035, R * 1.04, 0.03, 36, 1, true);
    band.scale(r[0] / Math.max(r[0], r[2]), 1, r[2] / Math.max(r[0], r[2]));
    band.translate(0, 0.022, 0);
    parts.push({ geo: g, accent: false }, { geo: band, accent: true });
  }
  // Sit the hat on the head: level with the brow at the front, lower at the back.
  const lift = kind === 'beanie' ? 0.03 : kind === 'cap' ? 0.028 : 0.022;
  for (const p of parts) {
    p.geo.rotateX(-0.16);
    p.geo.translate(c[0], c[1] + lift, c[2] - 0.004);
  }
  return parts;
}

const geoCache = new Map<string, unknown>();
function cached<T>(key: string, make: () => T): T {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key) as T;
}

export interface HeadDressing {
  group: THREE.Group;
  hairMat: THREE.MeshStandardMaterial;
  hatMat: THREE.MeshStandardMaterial;
  hatAccent: THREE.MeshStandardMaterial;
}

/**
 * Builds the extra head meshes for a hairstyle and hat. The returned group is
 * in model (rest) space; the caller parents it to the head bone with the
 * inverse of the head's rest position.
 */
export function dressHead(body: Body, hair: string, hat: HatKind | null, hairColor: string, hatColor: string, hatColor2: string): HeadDressing {
  const group = new THREE.Group();
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, map: strands(), roughness: 0.62, side: THREE.DoubleSide, alphaTest: 0.5 });
  const hatMat = new THREE.MeshStandardMaterial({ color: hatColor, roughness: 0.85, side: THREE.DoubleSide, map: hat === 'beanie' ? knit() : null });
  const hatAccent = new THREE.MeshStandardMaterial({ color: hatColor2, roughness: 0.75, side: THREE.DoubleSide, map: hat === 'beanie' ? knit() : null });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    group.add(m);
  };
  if (hair === 'long') {
    add(cached(`${body}-long`, () => curtain(body, { bottom: RIG[body].scalp.c[1] - (body === 'female' ? 0.36 : 0.3), faceHalf: 0.95, fringe: 0.95, flare: 0.35, grow: body === 'female' ? 1.04 : 1.1 })), hairMat);
  }
  if (hair === 'bun') for (const g of cached(`${body}-bun`, () => bun(body, true))) add(g, hairMat);
  if (hat) for (const p of cached(`${body}-hat-${hat}`, () => hatGeometry(body, hat))) add(p.geo, p.accent ? hatAccent : hatMat);
  return { group, hairMat, hatMat, hatAccent };
}
