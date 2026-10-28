/**
 * Procedural furniture meshes keyed by catalog id. Each builder returns a
 * group whose origin is the footprint CENTER at floor level, facing +Z
 * (the "front" a Sim would approach from), sized to the catalog footprint.
 */
import * as THREE from 'three/webgpu';
import { CATALOG } from '../../shared/Catalog';

const mat = (color: number, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const C = {
  fabric: mat(0x6b7b8c, 0.95), fabric2: mat(0xb89b72, 0.95), wood: mat(0x8a5d3b, 0.55), darkWood: mat(0x4a2f1f, 0.5),
  white: mat(0xf2f0ec, 0.35), steel: mat(0xc8ccd0, 0.25, 1), black: mat(0x1c1c1e, 0.4), linen: mat(0xe9e4da, 0.9),
  ceramic: mat(0xfafafa, 0.15), counterTop: mat(0x3b3b3e, 0.25), screen: mat(0x0b0b0d, 0.1, 0.4),
  leaf: mat(0x3d6b2e, 0.8), pot: mat(0xa45a3a, 0.8), fence: mat(0xf4f2ec, 0.6), lampShade: new THREE.MeshStandardMaterial({ color: 0xf6eedc, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.9 }),
};

/** Lamp shades glow at night: Game sets emissiveIntensity from DayNight.night. */
export const NIGHT_GLOW_MATERIALS = [C.lampShade];

type B = (g: THREE.Group) => void;
function box(g: THREE.Object3D, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  mesh.position.set(x, y + sy / 2, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh;
}
function cyl(g: THREE.Object3D, m: THREE.Material, rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.position.set(x, y + h / 2, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh;
}
const legs = (g: THREE.Group, m: THREE.Material, w: number, d: number, h: number, r = 0.025) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, m, r, r, h, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), 8);
};

const BUILDERS: Record<string, B> = {
  sofa: g => {
    box(g, C.darkWood, 2.7, 0.12, 0.85, 0, 0.06, 0);
    box(g, C.fabric, 2.6, 0.22, 0.8, 0, 0.18, 0.02);
    for (const x of [-0.85, 0, 0.85]) box(g, C.fabric, 0.84, 0.14, 0.62, x, 0.4, 0.08);   // seat cushions
    box(g, C.fabric, 2.6, 0.48, 0.2, 0, 0.4, -0.32);                                       // back
    for (const x of [-1.3, 1.3]) box(g, C.fabric, 0.18, 0.38, 0.82, x, 0.4, 0.02);         // arms
    for (const x of [-0.8, 0.8]) box(g, C.fabric2, 0.45, 0.4, 0.12, x, 0.55, -0.18);       // throw pillows
  },
  armchair: g => {
    box(g, C.fabric2, 0.86, 0.4, 0.84, 0, 0.08, 0);
    box(g, C.fabric2, 0.86, 0.5, 0.18, 0, 0.48, -0.33);
    for (const x of [-0.37, 0.37]) box(g, C.fabric2, 0.14, 0.26, 0.8, x, 0.48, 0);
    legs(g, C.darkWood, 0.8, 0.8, 0.08, 0.02);
  },
  coffeeTable: g => { box(g, C.wood, 1.2, 0.05, 0.6, 0, 0.4, 0); box(g, C.wood, 1.1, 0.03, 0.5, 0, 0.12, 0); legs(g, C.darkWood, 1.2, 0.6, 0.4); },
  tvStand: g => {
    box(g, C.darkWood, 1.8, 0.5, 0.45, 0, 0, -0.2);
    box(g, C.black, 0.4, 0.04, 0.2, 0, 0.5, -0.25);
    box(g, C.black, 1.45, 0.84, 0.05, 0, 0.6, -0.3);
    box(g, C.screen, 1.4, 0.79, 0.01, 0, 0.625, -0.27);
  },
  bookshelf: g => {
    box(g, C.wood, 0.9, 1.95, 0.04, 0, 0, -0.36);
    for (const x of [-0.43, 0.43]) box(g, C.wood, 0.04, 1.95, 0.32, x, 0, -0.22);
    for (let i = 0; i < 5; i++) {
      box(g, C.wood, 0.86, 0.03, 0.32, 0, 0.02 + i * 0.47, -0.22);
      if (i < 4) for (let k = 0; k < 9; k++) {
        const h = 0.22 + ((k * 37) % 11) / 60;
        box(g, mat([0x8c2f2f, 0x2f4f8c, 0x3f6b3a, 0xd9b44a, 0x5a3d6b][(k + i) % 5], 0.8), 0.07, h, 0.22, -0.36 + k * 0.09, 0.05 + i * 0.47, -0.22);
      }
    }
  },
  bed: g => {
    box(g, C.darkWood, 1.62, 0.3, 2.1, 0, 0.1, 0.1);
    box(g, C.linen, 1.55, 0.25, 2.0, 0, 0.4, 0.12);              // mattress
    box(g, C.fabric, 1.58, 0.06, 1.4, 0, 0.64, 0.42);            // duvet
    for (const x of [-0.4, 0.4]) box(g, C.white, 0.6, 0.14, 0.38, x, 0.65, -0.62);
    box(g, C.darkWood, 1.7, 1.1, 0.08, 0, 0, -0.98);             // headboard
    legs(g, C.darkWood, 1.6, 2.1, 0.1, 0.03);
  },
  nightstand: g => { box(g, C.wood, 0.5, 0.5, 0.42, 0, 0.08, 0); box(g, C.steel, 0.12, 0.02, 0.02, 0, 0.42, 0.22); legs(g, C.darkWood, 0.5, 0.42, 0.08); cyl(g, C.steel, 0.05, 0.08, 0.04, 0.1, 0.58, 0); cyl(g, C.lampShade, 0.1, 0.13, 0.18, 0.1, 0.8, 0); cyl(g, C.steel, 0.01, 0.01, 0.2, 0.1, 0.6, 0); },
  dresser: g => { box(g, C.wood, 1.6, 0.9, 0.5, 0, 0.06, -0.2); for (let i = 0; i < 3; i++) for (const x of [-0.4, 0.4]) box(g, C.steel, 0.14, 0.02, 0.02, x, 0.3 + i * 0.27, 0.06); legs(g, C.darkWood, 1.6, 0.5, 0.06); },
  counter: g => { box(g, C.white, 0.98, 0.86, 0.6, 0, 0, -0.18); box(g, C.counterTop, 1.0, 0.04, 0.64, 0, 0.88, -0.16); box(g, C.steel, 0.3, 0.02, 0.02, 0, 0.75, 0.13); box(g, C.white, 0.98, 0.7, 0.35, 0, 1.45, -0.3); },
  stove: g => {
    box(g, C.steel, 0.76, 0.9, 0.62, 0, 0, -0.18);
    box(g, C.black, 0.6, 0.38, 0.01, 0, 0.3, 0.135);                             // oven glass
    box(g, C.black, 0.76, 0.02, 0.62, 0, 0.9, -0.18);
    for (const x of [-0.18, 0.18]) for (const z of [-0.32, -0.04]) cyl(g, C.black, 0.09, 0.09, 0.015, x, 0.92, z, 20);
  },
  fridge: g => { box(g, C.steel, 0.86, 1.8, 0.72, 0, 0, -0.12); box(g, C.black, 0.86, 0.01, 0.01, 0, 1.12, 0.245); for (const y of [0.55, 1.4]) box(g, C.steel, 0.03, 0.35, 0.04, 0.35, y, 0.27); },
  diningSet: g => {
    box(g, C.wood, 1.5, 0.05, 0.95, 0, 0.72, 0); legs(g, C.darkWood, 1.5, 0.95, 0.72, 0.03);
    for (const [x, z, r] of [[-0.4, 0.7, Math.PI], [0.4, 0.7, Math.PI], [-0.4, -0.7, 0], [0.4, -0.7, 0]] as const) {
      const ch = new THREE.Group(); ch.position.set(x, 0, z); ch.rotation.y = r; g.add(ch);
      box(ch, C.wood, 0.44, 0.04, 0.44, 0, 0.45, 0); box(ch, C.wood, 0.44, 0.5, 0.04, 0, 0.49, -0.2); legs(ch as THREE.Group, C.darkWood, 0.44, 0.44, 0.45, 0.018);
    }
  },
  toilet: g => { cyl(g, C.ceramic, 0.2, 0.16, 0.4, 0, 0, 0.08, 20); box(g, C.ceramic, 0.42, 0.38, 0.18, 0, 0.4, -0.25); box(g, C.ceramic, 0.38, 0.03, 0.45, 0, 0.4, 0.06); },
  bathtub: g => { box(g, C.ceramic, 1.7, 0.55, 0.78, 0, 0, 0); box(g, mat(0xdfe8ec, 0.05), 1.5, 0.02, 0.6, 0, 0.53, 0); cyl(g, C.steel, 0.02, 0.02, 0.25, -0.75, 0.55, 0); },
  vanity: g => { box(g, C.wood, 0.8, 0.82, 0.5, 0, 0, -0.22); box(g, C.ceramic, 0.82, 0.05, 0.52, 0, 0.82, -0.21); cyl(g, C.steel, 0.015, 0.015, 0.2, 0, 0.87, -0.38); box(g, mat(0xcfe3ec, 0.02, 1), 0.7, 0.8, 0.02, 0, 1.1, -0.47); },
  floorLamp: g => { cyl(g, C.black, 0.16, 0.18, 0.03, 0, 0, 0, 20); cyl(g, C.steel, 0.012, 0.012, 1.45, 0, 0.03, 0); cyl(g, C.lampShade, 0.17, 0.24, 0.3, 0, 1.4, 0, 24); },
  plant: g => {
    cyl(g, C.pot, 0.2, 0.15, 0.35, 0, 0, 0, 20); cyl(g, C.darkWood, 0.02, 0.03, 0.7, 0, 0.35, 0);
    for (let i = 0; i < 9; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16 + (i % 3) * 0.04, 10, 8), C.leaf);
      leaf.position.set(Math.cos(i * 2.4) * 0.2, 0.95 + (i % 4) * 0.12, Math.sin(i * 2.4) * 0.2); leaf.scale.y = 0.7; leaf.castShadow = true; g.add(leaf);
    }
  },
  grill: g => { box(g, C.black, 0.7, 0.4, 0.5, 0, 0.6, 0); box(g, C.black, 0.7, 0.18, 0.5, 0, 1.0, -0.04); legs(g, C.steel, 0.7, 0.5, 0.6); box(g, C.steel, 0.4, 0.03, 0.03, 0, 1.08, 0.25); },
  patioSet: g => {
    cyl(g, mat(0x2a2a2a, 0.4, 0.6), 0.55, 0.55, 0.04, 0, 0.7, 0, 32); cyl(g, mat(0x2a2a2a, 0.4, 0.6), 0.03, 0.03, 0.7, 0, 0, 0);
    cyl(g, mat(0x2a2a2a, 0.4, 0.6), 0.02, 0.02, 2.2, 0, 0.74, 0);                         // umbrella pole
    const um = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.4, 8, 1, true), mat(0xc84a3a, 0.9)); um.position.y = 2.75; um.castShadow = true; g.add(um);
    for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + Math.PI / 4; box(g, mat(0x2a2a2a, 0.4, 0.6), 0.42, 0.04, 0.42, Math.cos(a) * 0.75, 0.44, Math.sin(a) * 0.75); }
  },
  fence: g => { for (const x of [-0.375, -0.125, 0.125, 0.375]) { box(g, C.fence, 0.08, 0.92, 0.03, x, 0, 0); } box(g, C.fence, 1.0, 0.07, 0.04, 0, 0.25, -0.03); box(g, C.fence, 1.0, 0.07, 0.04, 0, 0.7, -0.03); },
  shrub: g => { for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32 + (i % 2) * 0.1, 1), C.leaf); s.position.set(Math.cos(i) * 0.15, 0.35 + (i % 3) * 0.12, Math.sin(i * 1.7) * 0.15); s.castShadow = true; g.add(s); } },
};

export function buildFurniture(catalogId: string): THREE.Group {
  const g = new THREE.Group();
  (BUILDERS[catalogId] ?? ((x: THREE.Group) => box(x, mat(0xff00ff), CATALOG[catalogId]?.w ?? 1, 0.5, CATALOG[catalogId]?.d ?? 1, 0, 0, 0)))(g);
  g.userData.catalogId = catalogId;
  return g;
}
