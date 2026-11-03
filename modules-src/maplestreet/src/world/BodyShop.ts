/**
 * Maple Body & Wheel: a three-bay garage you drive into. Block walls on three
 * sides with steel dividers between the bays, a flat roof, roll-up doors
 * parked up under the header, a lit sign, painted bay lines, a two-post lift
 * and a tool chest per bay, and a concrete apron out to Commerce St. Only the
 * walls, dividers and posts collide, so cars drive straight in.
 */
import * as THREE from 'three/webgpu';
import { BODY_SHOP, BODY_SHOP_BAYS } from '../../shared/BodyShop';
import type { MaterialLibrary } from '../core/Materials';
import type { Physics } from '../physics/Physics';

function signTexture(text: string) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1c2a3a'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#f2b544'; g.fillRect(0, 108, c.width, 20);
  g.fillStyle = '#f4f1ea'; g.font = '700 68px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.toUpperCase(), c.width / 2, 58);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildBodyShop(physics: Physics, mats: MaterialLibrary) {
  const S = BODY_SHOP, g = new THREE.Group(), glows: THREE.MeshStandardMaterial[] = [];
  const block = new THREE.MeshStandardMaterial({ color: 0xc9c4b8, roughness: 0.92 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3d4650, roughness: 0.5, metalness: 0.6 });
  const door = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.45, metalness: 0.3 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c12e, roughness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.45, metalness: 0.3 });
  const concrete = mats.get('concrete').material, roof = mats.get('flatroof').material;
  const add = (mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, collide = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z); m.castShadow = sy > 0.1; m.receiveShadow = true; g.add(m);
    if (collide) physics.addStaticBox({ cx: x, cy: y, cz: z, hx: sx / 2, hy: sy / 2, hz: sz / 2 });
    return m;
  };

  const wall = 0.4, back = S.z - S.d / 2, front = S.frontZ, x0 = S.x - S.w / 2, x1 = S.x + S.w / 2, H = S.h;
  add(concrete, S.w, 0.06, S.d, S.x, 0.03, S.z);
  add(concrete, S.w + 4, 0.05, 7, S.x, 0.025, front + 3.5);
  add(block, S.w, H, wall, S.x, H / 2, back + wall / 2, true);
  add(block, wall, H, S.d, x0 + wall / 2, H / 2, S.z, true);
  add(block, wall, H, S.d, x1 - wall / 2, H / 2, S.z, true);
  add(roof, S.w + 0.4, 0.35, S.d + 0.4, S.x, H + 0.17, S.z);

  // Front header over the open bays, with the sign and the roll-up doors parked up under it.
  const headerH = 1.6, clear = H - headerH;
  add(block, S.w, headerH, wall, S.x, H - headerH / 2, front - wall / 2);
  const signMat = new THREE.MeshStandardMaterial({ map: signTexture(S.name), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0, roughness: 0.6 });
  signMat.emissiveMap = signMat.map;
  glows.push(signMat);
  add(signMat, S.w * 0.72, 1.05, 0.12, S.x, H - headerH / 2, front + 0.08);

  const inner = S.w - wall * 2, bayW = inner / 3;
  for (let i = 1; i < 3; i++) {
    const x = x0 + wall + bayW * i;
    add(steel, 0.3, clear, 0.3, x, clear / 2, front - 0.3, true);
    add(block, 0.3, H, S.d * 0.55, x, H / 2, back + S.d * 0.275, true);
  }
  for (const [i, bay] of BODY_SHOP_BAYS.entries()) {
    for (let k = 0; k < 6; k++) add(door, bayW - 0.5, 0.16, 0.6, bay.x, clear - 0.15 - k * 0.02, front - 0.6 - k * 0.55);
    for (const side of [-1, 1]) add(yellow, 0.1, 0.012, bay.d, bay.x + side * (bay.w / 2), 0.07, bay.z);
    add(yellow, bay.w, 0.012, 0.1, bay.x, 0.07, bay.z - bay.d / 2);
    for (const side of [-1, 1]) {
      add(steel, 0.32, 3.6, 0.32, bay.x + side * (bay.w / 2 - 0.35), 1.8, bay.z - 1, true);
      add(yellow, 0.36, 0.25, 0.36, bay.x + side * (bay.w / 2 - 0.35), 3.4, bay.z - 1);
    }
    add(red, 1.1, 1.1, 0.55, bay.x + (i % 2 ? -1 : 1) * (bay.w / 2 - 0.9), 0.55, back + wall + 0.4, true);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xf7f4e8, emissive: 0xfff6dc, emissiveIntensity: 0, roughness: 0.3 });
    glows.push(lampMat);
    add(lampMat, 0.5, 0.06, bay.d * 0.7, bay.x, H - 0.05, bay.z);
  }
  return { group: g, glows };
}
