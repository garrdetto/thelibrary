/**
 * Procedural furniture & fixtures keyed by catalog id. Each builder returns a
 * group whose origin is the footprint CENTER at floor level, facing +Z (the
 * side a person uses it from). Wall décor hugs the wall behind (local -Z) and
 * ceiling fixtures hang from the ceiling. Tintable items take their main
 * material from the design-tool swatch.
 */
import * as THREE from 'three/webgpu';
import { CATALOG, SWATCHES } from '../../shared/Catalog';

const cache = new Map<string, THREE.MeshStandardMaterial>();
const mat = (color: number | string, rough = 0.7, metal = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
  const key = `${color}|${rough}|${metal}|${JSON.stringify(extra)}`;
  let m = cache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: metal, ...extra }); cache.set(key, m); }
  return m;
};
const C = {
  wood: mat(0x8a5d3b, 0.55), darkWood: mat(0x4a2f1f, 0.5), lightWood: mat(0xc4a27a, 0.6),
  white: mat(0xf2f0ec, 0.35), steel: mat(0xc8ccd0, 0.25, 1), black: mat(0x1c1c1e, 0.4), linen: mat(0xe9e4da, 0.9),
  ceramic: mat(0xfafafa, 0.15), counterTop: mat(0x3b3b3e, 0.25), screen: mat(0x0b0b0d, 0.1, 0.4),
  leaf: mat(0x3d6b2e, 0.8), pot: mat(0xa45a3a, 0.8), glass: mat(0xbfd6de, 0.05, 0.1, { transparent: true, opacity: 0.35 }),
  chrome: mat(0xdadada, 0.12, 1), stone: mat(0x8d877d, 0.9), brass: mat(0xc9a14a, 0.3, 1), rubber: mat(0x1a1a1a, 0.9),
  water: mat(0x2aa6d4, 0.05, 0.1, { emissive: 0x0a3a50, emissiveIntensity: 0.3 }), court: mat(0x3a6b8a, 0.85), courtKey: mat(0x8a3a32, 0.85), line: mat(0xf5f5f5, 0.6),
  flowers: [mat(0xd8434f, 0.7), mat(0xf2c12e, 0.7), mat(0xa25cc9, 0.7), mat(0xf5f5f5, 0.7)],
  lampShade: new THREE.MeshStandardMaterial({ color: 0xf6eedc, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.9 }),
  bulb: new THREE.MeshStandardMaterial({ color: 0xfffaf0, emissive: 0xffe0b0, emissiveIntensity: 0, roughness: 0.3 }),
};

/** Lamp shades glow at night: Game sets emissiveIntensity from DayNight.night. */
export const NIGHT_GLOW_MATERIALS = [C.lampShade, C.bulb];

type B = (g: THREE.Group, P: THREE.MeshStandardMaterial) => void;
function box(g: THREE.Object3D, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  mesh.position.set(x, y + sy / 2, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh;
}
function cyl(g: THREE.Object3D, m: THREE.Material, rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.position.set(x, y + h / 2, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh;
}
function ball(g: THREE.Object3D, m: THREE.Material, r: number, x: number, y: number, z: number, sy = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m);
  mesh.position.set(x, y, z); mesh.scale.y = sy; mesh.castShadow = true; g.add(mesh); return mesh;
}
const legs = (g: THREE.Group, m: THREE.Material, w: number, d: number, h: number, r = 0.025) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, m, r, r, h, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), 8);
};
const cushionSofa = (g: THREE.Group, P: THREE.Material, seats: number) => {
  const W = seats * 0.86 + 0.36;
  box(g, C.darkWood, W, 0.12, 0.85, 0, 0.06, 0);
  box(g, P, W - 0.1, 0.22, 0.8, 0, 0.18, 0.02);
  for (let i = 0; i < seats; i++) box(g, P, 0.84, 0.14, 0.62, (i - (seats - 1) / 2) * 0.86, 0.4, 0.08);
  box(g, P, W - 0.1, 0.48, 0.2, 0, 0.4, -0.32);
  for (const x of [-W / 2 + 0.09, W / 2 - 0.09]) box(g, P, 0.18, 0.38, 0.82, x, 0.4, 0.02);
  for (let i = 0; i < Math.min(2, seats); i++) box(g, mat(0xd9cdb4, 0.95), 0.42, 0.38, 0.12, (i ? 1 : -1) * (W / 2 - 0.5), 0.55, -0.18);
};
const bedFrame = (g: THREE.Group, P: THREE.Material, w: number, l: number, z0: number) => {
  box(g, C.darkWood, w + 0.08, 0.3, l, 0, 0.1, z0);
  box(g, C.linen, w, 0.24, l - 0.1, 0, 0.4, z0 + 0.02);
  box(g, P, w + 0.04, 0.06, l * 0.62, 0, 0.62, z0 + l * 0.18);
  for (const x of w > 1.2 ? [-w / 4, w / 4] : [0]) box(g, C.white, w > 1.2 ? 0.6 : 0.7, 0.14, 0.36, x, 0.63, z0 - l / 2 + 0.3);
  box(g, C.darkWood, w + 0.12, 1.1, 0.08, 0, 0, z0 - l / 2 - 0.02);
  legs(g, C.darkWood, w, l, 0.1, 0.03);
};
const plantBlob = (g: THREE.Group, n: number, y0: number, spread: number, size: number) => {
  for (let i = 0; i < n; i++) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(size * (0.8 + (i % 3) * 0.2), 1), C.leaf);
    leaf.position.set(Math.cos(i * 2.4) * spread, y0 + (i % 4) * size * 0.6, Math.sin(i * 2.4) * spread); leaf.scale.y = 0.8; leaf.castShadow = true; g.add(leaf);
  }
};

const BUILDERS: Record<string, B> = {
  // ------------------------------------------------------------ living
  sofa: (g, P) => cushionSofa(g, P, 3),
  loveseat: (g, P) => cushionSofa(g, P, 2),
  armchair: (g, P) => {
    box(g, P, 0.86, 0.4, 0.84, 0, 0.08, 0);
    box(g, P, 0.86, 0.62, 0.18, 0, 0.48, -0.33);
    for (const x of [-0.37, 0.37]) { box(g, P, 0.14, 0.26, 0.8, x, 0.48, 0); box(g, P, 0.16, 0.28, 0.18, x, 0.9, -0.33); }
    legs(g, C.darkWood, 0.8, 0.8, 0.08, 0.02);
  },
  recliner: (g, P) => {
    box(g, P, 0.9, 0.42, 0.9, 0, 0.06, 0); box(g, P, 0.9, 0.7, 0.24, 0, 0.42, -0.34);
    for (const x of [-0.4, 0.4]) box(g, P, 0.16, 0.36, 0.86, x, 0.42, 0);
    box(g, P, 0.6, 0.12, 0.3, 0, 0.3, 0.55);
  },
  coffeeTable: (g, P) => { box(g, P === C.wood ? C.wood : P, 1.2, 0.05, 0.6, 0, 0.4, 0); box(g, C.darkWood, 1.1, 0.03, 0.5, 0, 0.12, 0); legs(g, C.darkWood, 1.2, 0.6, 0.4); ball(g, mat(0xd4c3a0, 0.5), 0.07, 0.3, 0.5, 0); },
  endTable: (g, P) => { box(g, P, 0.55, 0.55, 0.5, 0, 0.05, 0); legs(g, C.darkWood, 0.55, 0.5, 0.05); cyl(g, C.brass, 0.06, 0.1, 0.3, 0, 0.6, 0); cyl(g, C.lampShade, 0.12, 0.18, 0.24, 0, 0.9, 0, 20); },
  tvStand: g => {
    box(g, C.darkWood, 1.8, 0.5, 0.45, 0, 0, -0.2);
    box(g, C.black, 0.4, 0.04, 0.2, 0, 0.5, -0.25);
    box(g, C.black, 1.45, 0.84, 0.05, 0, 0.6, -0.3);
    box(g, C.screen, 1.4, 0.79, 0.01, 0, 0.625, -0.27);
    box(g, C.black, 0.6, 0.08, 0.1, 0, 0.52, -0.05);
  },
  wallTv: g => { box(g, C.black, 1.65, 0.95, 0.05, 0, 1.0, -0.44); box(g, C.screen, 1.6, 0.9, 0.01, 0, 1.025, -0.415); },
  bookshelf: (g, P) => {
    box(g, P, 0.9, 1.95, 0.04, 0, 0, -0.36);
    for (const x of [-0.43, 0.43]) box(g, P, 0.04, 1.95, 0.32, x, 0, -0.22);
    for (let i = 0; i < 5; i++) {
      box(g, P, 0.86, 0.03, 0.32, 0, 0.02 + i * 0.47, -0.22);
      if (i < 4) for (let k = 0; k < 9; k++) {
        const h = 0.22 + ((k * 37) % 11) / 60;
        box(g, mat([0x8c2f2f, 0x2f4f8c, 0x3f6b3a, 0xd9b44a, 0x5a3d6b][(k + i) % 5], 0.8), 0.07, h, 0.22, -0.36 + k * 0.09, 0.05 + i * 0.47, -0.22);
      }
    }
  },
  fireplace: g => {
    box(g, C.stone, 1.8, 1.25, 0.5, 0, 0, -0.25);
    box(g, C.black, 0.9, 0.7, 0.05, 0, 0.12, 0.0);
    box(g, mat(0xff8a2a, 0.5, 0, { emissive: 0xff5a00, emissiveIntensity: 1.2 }), 0.6, 0.2, 0.06, 0, 0.16, 0.02);
    box(g, C.darkWood, 2.0, 0.08, 0.6, 0, 1.25, -0.22);
    cyl(g, C.brass, 0.06, 0.06, 0.25, -0.6, 1.33, -0.25); cyl(g, C.brass, 0.06, 0.06, 0.25, 0.6, 1.33, -0.25);
  },
  piano: g => {
    box(g, C.black, 1.5, 1.25, 0.55, 0, 0, -0.2);
    box(g, C.black, 1.5, 0.08, 0.3, 0, 0.72, 0.18);
    box(g, C.white, 1.36, 0.02, 0.16, 0, 0.8, 0.16);
    for (let i = 0; i < 24; i++) box(g, C.black, 0.025, 0.02, 0.09, -0.62 + i * 0.054, 0.81, 0.12);
    box(g, C.black, 0.8, 0.45, 0.35, 0, 0, 0.75);
  },
  // ------------------------------------------------------------ kitchen & dining
  counter: (g, P) => { box(g, P, 0.98, 0.86, 0.6, 0, 0, -0.18); box(g, C.counterTop, 1.0, 0.04, 0.64, 0, 0.88, -0.16); box(g, C.steel, 0.3, 0.02, 0.02, 0, 0.75, 0.13); box(g, P, 0.98, 0.7, 0.35, 0, 1.45, -0.3); },
  sinkCounter: (g, P) => {
    box(g, P, 0.98, 0.86, 0.6, 0, 0, -0.18); box(g, C.counterTop, 1.0, 0.04, 0.64, 0, 0.88, -0.16);
    box(g, C.steel, 0.55, 0.02, 0.4, 0, 0.9, -0.15); cyl(g, C.chrome, 0.015, 0.015, 0.3, 0, 0.92, -0.38); box(g, C.chrome, 0.03, 0.03, 0.18, 0, 1.2, -0.3);
    box(g, P, 0.98, 0.7, 0.35, 0, 1.45, -0.3);
  },
  stove: g => {
    box(g, C.steel, 0.76, 0.9, 0.62, 0, 0, -0.18);
    box(g, C.black, 0.6, 0.38, 0.01, 0, 0.3, 0.135);
    box(g, C.black, 0.76, 0.02, 0.62, 0, 0.9, -0.18);
    for (const x of [-0.18, 0.18]) for (const z of [-0.32, -0.04]) cyl(g, C.black, 0.09, 0.09, 0.015, x, 0.92, z, 20);
    box(g, C.steel, 0.76, 0.3, 0.45, 0, 1.6, -0.25);
  },
  fridge: g => { box(g, C.steel, 0.86, 1.8, 0.72, 0, 0, -0.12); box(g, C.black, 0.86, 0.01, 0.01, 0, 1.12, 0.245); for (const y of [0.55, 1.4]) box(g, C.steel, 0.03, 0.35, 0.04, 0.35, y, 0.27); },
  dishwasher: g => { box(g, C.steel, 0.6, 0.86, 0.6, 0, 0, -0.18); box(g, C.counterTop, 1.0, 0.04, 0.64, 0, 0.88, -0.16); box(g, C.black, 0.5, 0.06, 0.02, 0, 0.75, 0.12); },
  island: (g, P) => { box(g, P, 1.9, 0.88, 0.9, 0, 0, 0); box(g, mat(0xe8e4dc, 0.2), 2.0, 0.05, 1.0, 0, 0.88, 0); for (const x of [-0.6, 0, 0.6]) cyl(g, C.brass, 0.08, 0.12, 0.2, x, 2.3, 0); },
  barStool: (g, P) => { cyl(g, P, 0.2, 0.2, 0.06, 0, 0.7, 0, 20); cyl(g, C.steel, 0.02, 0.02, 0.7, 0, 0, 0); cyl(g, C.steel, 0.18, 0.2, 0.02, 0, 0.25, 0, 20); },
  diningSet: (g, P) => {
    box(g, P, 1.5, 0.05, 0.95, 0, 0.72, 0); legs(g, C.darkWood, 1.5, 0.95, 0.72, 0.03);
    for (const [x, z, r] of [[-0.4, 0.7, Math.PI], [0.4, 0.7, Math.PI], [-0.4, -0.7, 0], [0.4, -0.7, 0]] as const) {
      const ch = new THREE.Group(); ch.position.set(x, 0, z); ch.rotation.y = r; g.add(ch);
      box(ch, P, 0.44, 0.04, 0.44, 0, 0.45, 0); box(ch, P, 0.44, 0.5, 0.04, 0, 0.49, -0.2); legs(ch, C.darkWood, 0.44, 0.44, 0.45, 0.018);
    }
    cyl(g, mat(0x9aa7b0, 0.2), 0.08, 0.06, 0.25, 0, 0.77, 0);
  },
  sideboard: (g, P) => { box(g, P, 1.8, 0.8, 0.45, 0, 0.1, -0.25); legs(g, C.darkWood, 1.8, 0.45, 0.1); for (const x of [-0.6, 0, 0.6]) box(g, C.brass, 0.12, 0.02, 0.02, x, 0.6, 0.0); },
  // ------------------------------------------------------------ bath
  toilet: g => { cyl(g, C.ceramic, 0.2, 0.16, 0.4, 0, 0, 0.08, 20); box(g, C.ceramic, 0.42, 0.38, 0.18, 0, 0.4, -0.25); box(g, C.ceramic, 0.38, 0.03, 0.45, 0, 0.4, 0.06); },
  bathtub: g => { box(g, C.ceramic, 1.7, 0.55, 0.78, 0, 0, 0); box(g, mat(0xdfe8ec, 0.05), 1.5, 0.02, 0.6, 0, 0.53, 0); cyl(g, C.chrome, 0.02, 0.02, 0.25, -0.75, 0.55, 0); },
  shower: g => {
    box(g, C.ceramic, 0.95, 0.06, 0.95, 0, 0, 0);
    box(g, C.glass, 0.02, 2.0, 0.95, 0.47, 0.06, 0); box(g, C.glass, 0.95, 2.0, 0.02, 0, 0.06, 0.47);
    cyl(g, C.chrome, 0.012, 0.012, 1.2, -0.38, 0.9, -0.42); cyl(g, C.chrome, 0.1, 0.1, 0.02, -0.3, 2.0, -0.35, 20);
  },
  vanity: (g, P) => { box(g, P, 0.8, 0.82, 0.5, 0, 0, -0.22); box(g, C.ceramic, 0.82, 0.05, 0.52, 0, 0.82, -0.21); cyl(g, C.chrome, 0.015, 0.015, 0.2, 0, 0.87, -0.38); box(g, mat(0xcfe3ec, 0.02, 1), 0.7, 0.8, 0.02, 0, 1.1, -0.47); },
  doubleVanity: (g, P) => {
    box(g, P, 1.8, 0.82, 0.5, 0, 0, -0.22); box(g, mat(0xe8e4dc, 0.2), 1.82, 0.05, 0.52, 0, 0.82, -0.21);
    for (const x of [-0.45, 0.45]) { cyl(g, C.chrome, 0.015, 0.015, 0.2, x, 0.87, -0.38); box(g, mat(0xcfe3ec, 0.02, 1), 0.7, 0.8, 0.02, x, 1.1, -0.47); }
  },
  // ------------------------------------------------------------ bedroom, study, kids
  bed: (g, P) => bedFrame(g, P, 1.55, 2.1, 0.1),
  twinBed: (g, P) => bedFrame(g, P, 0.95, 1.95, 0.0),
  bunkBed: (g, P) => {
    for (const y of [0, 1.0]) { box(g, C.lightWood, 0.95, 0.12, 1.95, 0, 0.25 + y, 0); box(g, C.linen, 0.9, 0.16, 1.85, 0, 0.37 + y, 0); box(g, P, 0.94, 0.05, 1.2, 0, 0.53 + y, 0.3); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, C.lightWood, 0.07, 1.7, 0.07, sx * 0.45, 0, sz * 0.94);
    for (let i = 0; i < 4; i++) box(g, C.lightWood, 0.04, 0.04, 0.4, 0.5, 0.35 + i * 0.3, 0.7);
  },
  nightstand: (g, P) => { box(g, P, 0.5, 0.5, 0.42, 0, 0.08, 0); box(g, C.steel, 0.12, 0.02, 0.02, 0, 0.42, 0.22); legs(g, C.darkWood, 0.5, 0.42, 0.08); cyl(g, C.steel, 0.05, 0.08, 0.04, 0.1, 0.58, 0); cyl(g, C.lampShade, 0.1, 0.13, 0.18, 0.1, 0.8, 0); cyl(g, C.steel, 0.01, 0.01, 0.2, 0.1, 0.6, 0); },
  dresser: (g, P) => { box(g, P, 1.6, 0.9, 0.5, 0, 0.06, -0.2); for (let i = 0; i < 3; i++) for (const x of [-0.4, 0.4]) box(g, C.steel, 0.14, 0.02, 0.02, x, 0.3 + i * 0.27, 0.06); legs(g, C.darkWood, 1.6, 0.5, 0.06); },
  wardrobe: (g, P) => { box(g, P, 1.6, 2.05, 0.6, 0, 0.05, -0.18); box(g, C.black, 0.01, 1.9, 0.01, 0, 0.1, 0.125); for (const x of [-0.08, 0.08]) box(g, C.brass, 0.02, 0.3, 0.03, x, 1.0, 0.13); },
  desk: (g, P) => {
    box(g, P, 1.4, 0.04, 0.65, 0, 0.72, -0.15); legs(g, C.darkWood, 1.4, 0.65, 0.72, 0.025);
    const ch = new THREE.Group(); ch.position.set(0, 0, 0.35); g.add(ch);
    cyl(ch, C.black, 0.24, 0.24, 0.08, 0, 0.45, 0, 18); box(ch, C.black, 0.45, 0.5, 0.06, 0, 0.55, 0.22); cyl(ch, C.steel, 0.025, 0.025, 0.45, 0, 0, 0);
    box(g, mat(0xd7c8aa, 0.6), 0.3, 0.03, 0.22, -0.4, 0.76, -0.2);
  },
  computer: (g, P) => {
    BUILDERS.desk(g, P);
    box(g, C.black, 0.7, 0.42, 0.04, 0, 0.9, -0.35); box(g, mat(0x1b2a4a, 0.1, 0, { emissive: 0x3060ff, emissiveIntensity: 0.4 }), 0.66, 0.38, 0.01, 0, 0.92, -0.33);
    box(g, C.black, 0.22, 0.45, 0.45, 0.55, 0.76, -0.2); box(g, C.black, 0.45, 0.02, 0.15, 0, 0.76, -0.05);
  },
  toyChest: (g, P) => { box(g, P, 0.9, 0.45, 0.5, 0, 0, 0); box(g, C.lightWood, 0.94, 0.05, 0.54, 0, 0.45, 0); ball(g, mat(0xe74c3c, 0.5), 0.1, 0.25, 0.6, 0.05); },
  // ------------------------------------------------------------ décor & lighting
  plant: g => { cyl(g, C.pot, 0.2, 0.15, 0.35, 0, 0, 0, 20); cyl(g, C.darkWood, 0.02, 0.03, 0.7, 0, 0.35, 0); plantBlob(g, 9, 0.95, 0.2, 0.17); },
  tallPlant: g => {
    cyl(g, mat(0xe8e2d6, 0.6), 0.18, 0.15, 0.3, 0, 0, 0, 20);
    for (let i = 0; i < 9; i++) { const l = box(g, C.leaf, 0.06, 0.8 + (i % 3) * 0.15, 0.015, Math.cos(i) * 0.06, 0.3, Math.sin(i) * 0.06); l.rotation.set(Math.sin(i) * 0.25, i, Math.cos(i) * 0.2); }
  },
  rugSmall: (g, P) => { box(g, P, 1.9, 0.012, 1.9, 0, 0.005, 0); box(g, C.linen, 1.7, 0.013, 1.7, 0, 0.005, 0).scale.set(1, 1, 1); box(g, P, 1.5, 0.014, 1.5, 0, 0.005, 0); },
  rugLarge: (g, P) => { box(g, P, 2.9, 0.012, 1.9, 0, 0.005, 0); box(g, C.linen, 2.7, 0.013, 1.7, 0, 0.005, 0); box(g, P, 2.5, 0.014, 1.5, 0, 0.005, 0); },
  painting: (g, P) => {
    box(g, C.darkWood, 0.8, 0.6, 0.04, 0, 1.35, -0.43);
    const c = document.createElement('canvas'); c.width = 128; c.height = 96;
    const x = c.getContext('2d')!;
    const sky = x.createLinearGradient(0, 0, 0, 96); sky.addColorStop(0, '#f2c27a'); sky.addColorStop(1, '#88a9c9');
    x.fillStyle = sky; x.fillRect(0, 0, 128, 96); x.fillStyle = '#' + P.color.getHexString(); x.beginPath(); x.moveTo(0, 70); x.lineTo(40, 40); x.lineTo(70, 60); x.lineTo(100, 35); x.lineTo(128, 60); x.lineTo(128, 96); x.lineTo(0, 96); x.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const art = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
    art.position.set(0, 1.65, -0.405); g.add(art);
  },
  mirror: g => { box(g, C.brass, 0.6, 0.9, 0.03, 0, 1.15, -0.44); box(g, mat(0xd9e6ec, 0.02, 1), 0.52, 0.82, 0.01, 0, 1.19, -0.42); },
  wallClock: g => {
    const f = cyl(g, C.white, 0.18, 0.18, 0.04, 0, 1.85, -0.44, 28); f.rotation.x = Math.PI / 2; f.position.set(0, 2.0, -0.44);
    box(g, C.black, 0.012, 0.12, 0.01, 0, 1.98, -0.415); box(g, C.black, 0.09, 0.012, 0.01, 0.04, 2.0, -0.415);
  },
  shelf: (g, P) => { box(g, P, 0.9, 0.04, 0.22, 0, 1.4, -0.39); box(g, mat(0x3f6b3a, 0.8), 0.12, 0.18, 0.12, -0.25, 1.44, -0.39); box(g, mat(0x2f4f8c, 0.8), 0.25, 0.2, 0.15, 0.2, 1.44, -0.39); },
  floorLamp: g => { cyl(g, C.black, 0.16, 0.18, 0.03, 0, 0, 0, 20); cyl(g, C.steel, 0.012, 0.012, 1.45, 0, 0.03, 0); cyl(g, C.lampShade, 0.17, 0.24, 0.3, 0, 1.4, 0, 24); },
  ceilingLight: g => { cyl(g, C.white, 0.22, 0.25, 0.05, 0, 2.66, 0, 24); cyl(g, C.bulb, 0.2, 0.2, 0.02, 0, 2.64, 0, 24); },
  chandelier: g => {
    cyl(g, C.brass, 0.01, 0.01, 0.5, 0, 2.25, 0); cyl(g, C.brass, 0.3, 0.3, 0.03, 0, 2.25, 0, 24);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; cyl(g, C.bulb, 0.03, 0.02, 0.1, Math.cos(a) * 0.3, 2.28, Math.sin(a) * 0.3, 8); cyl(g, C.glass, 0.06, 0.04, 0.12, Math.cos(a) * 0.3, 2.3, Math.sin(a) * 0.3, 10); }
  },
  stairs: (g, P) => {
    // 12 treads rising toward the back (local -Z), stringers and a handrail.
    const steps = 12, run = 4 / steps, rise = 3 / steps;
    for (let k = 0; k < steps; k++) {
      box(g, P, 0.96, 0.05, run + 0.02, 0, (k + 1) * rise - 0.05, 2 - (k + 0.5) * run);
      box(g, C.white, 0.96, rise - 0.05, 0.02, 0, k * rise, 2 - k * run - 0.01);
    }
    for (const x of [-0.5, 0.5]) {
      const s = box(g, C.white, 0.05, 0.3, 4.6, x, 1.35, 0); s.rotation.x = Math.atan2(3, 4);
    }
    const rail = box(g, C.darkWood, 0.05, 0.05, 4.8, 0.5, 2.2, 0); rail.rotation.x = Math.atan2(3, 4);
    for (let k = 0; k < steps; k += 2) box(g, C.white, 0.025, 0.9, 0.025, 0.5, (k + 1) * rise, 2 - (k + 0.5) * run);
  },
  // ------------------------------------------------------------ outdoor & activities
  grill: g => { box(g, C.black, 0.7, 0.4, 0.5, 0, 0.6, 0); box(g, C.black, 0.7, 0.18, 0.5, 0, 1.0, -0.04); legs(g, C.steel, 0.7, 0.5, 0.6); box(g, C.steel, 0.4, 0.03, 0.03, 0, 1.08, 0.25); },
  patioSet: (g, P) => {
    cyl(g, mat(0x2a2a2a, 0.4, 0.6), 0.55, 0.55, 0.04, 0, 0.7, 0, 32); cyl(g, mat(0x2a2a2a, 0.4, 0.6), 0.03, 0.03, 0.7, 0, 0, 0);
    cyl(g, mat(0x2a2a2a, 0.4, 0.6), 0.02, 0.02, 2.2, 0, 0.74, 0);
    const um = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.4, 8, 1, true), P === C.wood ? mat(0xc84a3a, 0.9) : P); um.position.y = 2.75; um.castShadow = true; g.add(um);
    for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + Math.PI / 4; box(g, mat(0x2a2a2a, 0.4, 0.6), 0.42, 0.04, 0.42, Math.cos(a) * 0.75, 0.44, Math.sin(a) * 0.75); }
  },
  lounger: (g, P) => {
    box(g, C.white, 0.7, 0.08, 1.8, 0, 0.28, 0.1); box(g, P, 0.62, 0.06, 1.2, 0, 0.36, 0.35);
    const back = box(g, P, 0.62, 0.06, 0.7, 0, 0.5, -0.6); back.rotation.x = -0.7;
    legs(g, C.white, 0.7, 1.8, 0.28);
  },
  hotTub: g => {
    box(g, mat(0x6b4a33, 0.7), 1.95, 0.9, 1.95, 0, 0, 0);
    box(g, C.water, 1.6, 0.02, 1.6, 0, 0.82, 0);
    box(g, mat(0xd8d0c0, 0.5), 1.95, 0.06, 0.18, 0, 0.88, 0.89); box(g, mat(0xd8d0c0, 0.5), 1.95, 0.06, 0.18, 0, 0.88, -0.89);
    box(g, mat(0xd8d0c0, 0.5), 0.18, 0.06, 1.95, 0.89, 0.88, 0); box(g, mat(0xd8d0c0, 0.5), 0.18, 0.06, 1.95, -0.89, 0.88, 0);
  },
  hoop: g => {
    cyl(g, C.black, 0.06, 0.07, 3.05, 0, 0, -0.35);
    box(g, C.white, 1.1, 0.75, 0.04, 0, 2.7, -0.3); box(g, mat(0xd64a2a, 0.5), 0.45, 0.3, 0.045, 0, 2.85, -0.29);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.012, 8, 24), mat(0xff6a1a, 0.4, 0.5)); rim.rotation.x = Math.PI / 2; rim.position.set(0, 3.05, -0.02); g.add(rim);
    const net = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.14, 0.4, 12, 1, true), mat(0xffffff, 0.9, 0, { transparent: true, opacity: 0.5, side: THREE.DoubleSide })); net.position.set(0, 2.85, -0.02); g.add(net);
    ball(g, mat(0xd8692a, 0.6), 0.12, 0.35, 0.12, 0.2);
  },
  court: g => {
    box(g, C.court, 7, 0.03, 8, 0, 0, 0);
    box(g, C.courtKey, 3.6, 0.034, 4.6, 0, 0, -1.7);
    for (const [sx, sz, x, z] of [[7, 0.06, 0, 3.97], [7, 0.06, 0, -3.97], [0.06, 8, 3.47, 0], [0.06, 8, -3.47, 0], [3.6, 0.06, 0, 0.6], [0.06, 4.6, 1.8, -1.7], [0.06, 4.6, -1.8, -1.7]] as const) box(g, C.line, sx, 0.036, sz, x, 0, z);
    const arc = new THREE.Mesh(new THREE.RingGeometry(2.95, 3.0, 40, 1, 0, Math.PI).rotateX(-Math.PI / 2), C.line); arc.position.set(0, 0.038, -3.9); arc.rotation.y = Math.PI; g.add(arc);
    const hoop = new THREE.Group(); hoop.position.set(0, 0, -3.7); g.add(hoop); BUILDERS.hoop(hoop, C.court);
  },
  swingSet: (g, P) => {
    for (const x of [-1.4, 1.4]) { const a = box(g, P, 0.08, 2.4, 0.08, x, 0, -0.5); a.rotation.x = 0.35; const b2 = box(g, P, 0.08, 2.4, 0.08, x, 0, 0.5); b2.rotation.x = -0.35; }
    const top = cyl(g, P, 0.05, 0.05, 2.9, 0, 2.2, 0); top.rotation.z = Math.PI / 2; top.position.y = 2.24;
    for (const x of [-0.6, 0.6]) { cyl(g, C.steel, 0.008, 0.008, 1.7, x - 0.18, 0.5, 0); cyl(g, C.steel, 0.008, 0.008, 1.7, x + 0.18, 0.5, 0); box(g, C.black, 0.45, 0.04, 0.2, x, 0.48, 0); }
  },
  trampoline: g => {
    const mat2 = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.04, 40), C.black); mat2.position.y = 0.85; g.add(mat2);
    const pad = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.08, 8, 40), mat(0x2e7dd1, 0.6)); pad.rotation.x = Math.PI / 2; pad.position.y = 0.87; g.add(pad);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; cyl(g, C.steel, 0.03, 0.03, 0.87, Math.cos(a) * 1.4, 0, Math.sin(a) * 1.4); }
  },
  divingBoard: g => { box(g, C.stone, 0.6, 0.3, 0.6, 0, 0, -0.65); const b2 = box(g, mat(0x3a8fd1, 0.4), 0.5, 0.06, 1.9, 0, 0.32, 0.1); b2.rotation.x = -0.04; },
  bench: (g, P) => { box(g, P, 1.7, 0.06, 0.45, 0, 0.44, 0); box(g, P, 1.7, 0.4, 0.05, 0, 0.62, -0.2); for (const x of [-0.75, 0.75]) box(g, C.black, 0.06, 0.44, 0.45, x, 0, 0); },
  lampPost: g => { cyl(g, C.black, 0.07, 0.1, 2.3, 0, 0, 0); cyl(g, C.black, 0.15, 0.1, 0.1, 0, 2.3, 0); cyl(g, C.lampShade, 0.12, 0.16, 0.3, 0, 2.4, 0, 12); cyl(g, C.black, 0.18, 0.12, 0.06, 0, 2.7, 0); },
  shrub: g => { for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32 + (i % 2) * 0.1, 1), C.leaf); s.position.set(Math.cos(i) * 0.15, 0.35 + (i % 3) * 0.12, Math.sin(i * 1.7) * 0.15); s.castShadow = true; g.add(s); } },
  flowerBed: (g, P) => {
    box(g, P === C.wood ? C.darkWood : P, 1.9, 0.18, 0.8, 0, 0, 0); box(g, mat(0x3b2a1e, 0.95), 1.8, 0.04, 0.7, 0, 0.17, 0);
    for (let i = 0; i < 18; i++) { cyl(g, C.leaf, 0.01, 0.01, 0.2, -0.8 + (i % 9) * 0.2, 0.2, i < 9 ? -0.15 : 0.15, 4); ball(g, C.flowers[i % 4], 0.06, -0.8 + (i % 9) * 0.2, 0.42, i < 9 ? -0.15 : 0.15); }
  },
  tree: g => { cyl(g, mat(0x5a4330, 0.95), 0.08, 0.14, 2.2, 0, 0, 0); plantBlob(g, 8, 2.5, 0.5, 0.55); },
  doghouse: (g, P) => {
    box(g, P, 0.9, 0.6, 0.9, 0, 0, 0);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.45, 4), mat(0x5a3020, 0.8)); roof.position.y = 0.82; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);
    box(g, C.black, 0.35, 0.4, 0.02, 0, 0, 0.45);
  },
};

export function buildFurniture(catalogId: string, tint = 0): THREE.Group {
  const g = new THREE.Group();
  const item = CATALOG[catalogId];
  const defaults: Record<string, number> = { sofa: 0x6b7b8c, loveseat: 0x6b7b8c, armchair: 0xb89b72, recliner: 0x5a4636, bed: 0x6b7b8c, twinBed: 0x7d8c6b, bunkBed: 0x2e7dd1, rugSmall: 0x8b3a3a, rugLarge: 0x2e3a55, painting: 0x3f5e46, flowerBed: 0x6b4a33, doghouse: 0xb5651d, patioSet: 0xc84a3a, lounger: 0x2e7dd1, toyChest: 0xd9b44a };
  const base = tint > 0 ? SWATCHES[tint] : defaults[catalogId] ?? (item?.func === 'storage' || item?.func === 'surfaces' ? 0x8a5d3b : 0x6b7b8c);
  const P = (catalogId === 'counter' || catalogId === 'sinkCounter' || catalogId === 'island') && tint === 0 ? C.white
    : catalogId === 'stairs' && tint === 0 ? C.wood
    : catalogId === 'coffeeTable' && tint === 0 ? C.wood
    : mat(base, 0.8);
  (BUILDERS[catalogId] ?? ((x: THREE.Group) => box(x, mat(0xff00ff), item?.w ?? 1, 0.5, item?.d ?? 1, 0, 0, 0)))(g, P);
  g.userData.catalogId = catalogId;
  return g;
}
