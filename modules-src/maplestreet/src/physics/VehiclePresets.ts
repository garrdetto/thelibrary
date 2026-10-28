/**
 * Vehicle tuning + procedural body meshes.
 * Convention: chassis local +X = forward, +Y = up, +Z = right.
 * Units are SI (m, kg, N). Brake values are Rapier max brake impulse per wheel per step.
 *
 * The procedural bodies are placeholders with correct proportions; to ship
 * HD vehicles, load a glTF in `build()` and keep the same dimensions.
 */
import * as THREE from 'three/webgpu';
import type { VehicleKind } from '../../shared/Protocol';

export interface VehiclePreset {
  kind: VehicleKind;
  label: string;
  chassis: { hx: number; hy: number; hz: number };
  mass: number;
  comY: number;                       // center-of-mass offset (lower = more stable)
  axles: { x: number; radius: number; width: number; halfTrack: number; steer: boolean; drive: boolean }[];
  wheelY: number;                     // suspension mount height (chassis space)
  suspension: { rest: number; travel: number; stiffness: number; compression: number; relaxation: number };
  frictionSlip: number;
  sideStiffness: number;
  engineForce: number;                // per driven wheel
  topSpeed: number;                   // m/s
  brake: number;
  maxSteer: number;                   // rad
  hitch?: { x: number; y: number };   // tow ball (on towing vehicles)
  tongue?: { x: number; y: number };  // coupler (on trailers)
  mowerDeck?: { x: number; width: number };
  cam: { dist: number; height: number };
  paint: number;
  build(paint: THREE.Material, lights: VehicleLights): THREE.Group;
}

export interface VehicleLights { head: THREE.MeshStandardMaterial; tail: THREE.MeshStandardMaterial }

// ------------------------------------------------------------------ shared mats

const M = {
  chrome: new THREE.MeshStandardMaterial({ color: 0xdadada, metalness: 1, roughness: 0.12 }),
  black: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }),
  plastic: new THREE.MeshStandardMaterial({ color: 0x222326, roughness: 0.75 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1b2630, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.55 }),
  seat: new THREE.MeshStandardMaterial({ color: 0x2a2421, roughness: 0.85 }),
  canvas: new THREE.MeshStandardMaterial({ color: 0xece9e2, roughness: 0.9 }),
  deck: new THREE.MeshStandardMaterial({ color: 0x3e4a3a, roughness: 0.6, metalness: 0.3 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xb7bcc2, metalness: 0.9, roughness: 0.25 }),
};

export function makePaint(color: number) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
}

export function makeLights(): VehicleLights {
  return {
    head: new THREE.MeshStandardMaterial({ color: 0xf2f2ea, emissive: 0xfff4d6, emissiveIntensity: 0, roughness: 0.1 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x7a0b0b, emissive: 0xff1a1a, emissiveIntensity: 0.2, roughness: 0.2 }),
  };
}

function box(g: THREE.Object3D, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z); m.rotation.z = rz;
  m.castShadow = true; m.receiveShadow = true;
  g.add(m); return m;
}
function cyl(g: THREE.Object3D, mat: THREE.Material, r: number, h: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), mat);
  m.position.set(x, y, z);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.castShadow = true; g.add(m); return m;
}
function lampPair(g: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, sx = 0.05, sy = 0.14, sz = 0.3) {
  box(g, mat, sx, sy, sz, x, y, z); box(g, mat, sx, sy, sz, x, y, -z);
}

/**
 * Side-profile extrusion: a closed outline in the X/Y plane (x forward, y up)
 * with real wheel-arch cutouts, extruded across the car's width with a
 * rounded bevel. Gives believable sheet-metal silhouettes from one shape.
 */
function profile(g: THREE.Object3D, mat: THREE.Material, width: number, draw: (sh: THREE.Shape) => void, bevel = 0.05) {
  const sh = new THREE.Shape();
  draw(sh);
  const geo = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 18 });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return m;
}
const arch = (sh: THREE.Shape, x: number, y: number, r: number) => { sh.lineTo(x - r, y); sh.absarc(x, y, r, Math.PI, 0, true); };

export function buildWheel(radius: number, width: number): THREE.Group {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 28, 1), M.rubber);
  tire.rotation.x = Math.PI / 2; tire.castShadow = true; g.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 1.02, 24), M.rim);
  rim.rotation.x = Math.PI / 2; g.add(rim);
  for (let i = 0; i < 5; i++) {                    // spokes make rotation readable
    const s = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.1, radius * 0.12, width * 1.06), M.plastic);
    s.rotation.z = (i / 5) * Math.PI; g.add(s);
  }
  return g;
}

// ------------------------------------------------------------------ presets

export const PRESETS: Record<VehicleKind, VehiclePreset> = {
  truck: {
    kind: 'truck', label: 'Pickup Truck',
    chassis: { hx: 2.7, hy: 0.42, hz: 0.95 }, mass: 2200, comY: -0.5,
    axles: [
      { x: 1.72, radius: 0.42, width: 0.3, halfTrack: 0.86, steer: true, drive: true },
      { x: -1.72, radius: 0.42, width: 0.3, halfTrack: 0.86, steer: false, drive: true },
    ],
    wheelY: -0.18, suspension: { rest: 0.42, travel: 0.28, stiffness: 30, compression: 2.4, relaxation: 3.2 },
    frictionSlip: 2.3, sideStiffness: 1.0, engineForce: 2300, topSpeed: 42, brake: 70, maxSteer: 0.6,
    hitch: { x: -2.95, y: -0.28 }, cam: { dist: 9.5, height: 3.3 }, paint: 0x8b1e1e,
    build(paint, L) {
      const g = new THREE.Group();
      profile(g, paint, 1.86, sh => {                                   // cab, hood and bed floor in one stamping
        sh.moveTo(-2.68, -0.35); arch(sh, -1.72, -0.35, 0.52); arch(sh, 1.72, -0.35, 0.52);
        sh.lineTo(2.72, -0.35); sh.lineTo(2.78, 0.18); sh.lineTo(2.7, 0.5); sh.quadraticCurveTo(2.62, 0.62, 2.4, 0.63);
        sh.lineTo(1.25, 0.7); sh.lineTo(1.18, 0.64); sh.lineTo(-0.38, 0.64); sh.lineTo(-0.38, 0.12); sh.lineTo(-2.68, 0.12); sh.closePath();
      }, 0.06);
      profile(g, M.glass, 1.68, sh => {                                 // greenhouse
        sh.moveTo(-0.32, 0.6); sh.lineTo(-0.28, 1.3); sh.quadraticCurveTo(-0.2, 1.37, 0.0, 1.37); sh.lineTo(0.7, 1.36); sh.lineTo(1.2, 0.66); sh.closePath();
      }, 0.04);
      box(g, paint, 1.06, 0.06, 1.74, 0.21, 1.38, 0);                   // roof skin
      for (const z of [0.86, -0.86]) {
        box(g, paint, 0.07, 0.8, 0.06, 0.96, 1.0, z, 0.62);            // A-pillars
        box(g, paint, 0.1, 0.74, 0.06, 0.42, 1.0, z);                   // B-pillars
        box(g, paint, 0.1, 0.74, 0.06, -0.32, 0.98, z);                 // C-pillars
        box(g, paint, 2.3, 0.5, 0.08, -1.55, 0.37, z * 1.04);           // bed sides
        box(g, M.black, 0.18, 0.12, 0.05, 1.1, 0.9, z * 1.18);          // mirrors
        box(g, M.chrome, 0.2, 0.03, 0.03, 0.5, 0.48, z * 1.08);         // door handles
      }
      box(g, paint, 0.08, 0.5, 1.84, -2.66, 0.37, 0);                    // tailgate
      box(g, M.plastic, 2.25, 0.04, 1.7, -1.55, 0.14, 0);                // bed liner
      box(g, M.chrome, 0.16, 0.22, 1.94, 2.8, -0.2, 0);                  // bumpers
      box(g, M.chrome, 0.16, 0.2, 1.94, -2.74, -0.22, 0);
      box(g, M.black, 0.04, 0.32, 1.0, 2.79, 0.33, 0);                   // grille
      for (let i = 0; i < 4; i++) box(g, M.chrome, 0.03, 0.03, 0.98, 2.81, 0.21 + i * 0.08, 0);
      lampPair(g, L.head, 2.74, 0.38, 0.72, 0.05, 0.18, 0.26);
      lampPair(g, L.tail, -2.71, 0.36, 0.86, 0.05, 0.34, 0.1);
      cyl(g, M.chrome, 0.04, 0.25, -2.95, -0.18, 0, 'y');               // hitch ball stem
      return g;
    },
  },
  sedan: {
    kind: 'sedan', label: 'Sedan',
    chassis: { hx: 2.35, hy: 0.34, hz: 0.9 }, mass: 1450, comY: -0.4,
    axles: [
      { x: 1.42, radius: 0.34, width: 0.24, halfTrack: 0.8, steer: true, drive: true },
      { x: -1.42, radius: 0.34, width: 0.24, halfTrack: 0.8, steer: false, drive: false },
    ],
    wheelY: -0.1, suspension: { rest: 0.32, travel: 0.2, stiffness: 34, compression: 2.6, relaxation: 3.4 },
    frictionSlip: 2.6, sideStiffness: 1.0, engineForce: 2600, topSpeed: 52, brake: 45, maxSteer: 0.55,
    cam: { dist: 8, height: 2.6 }, paint: 0x1f3f6e,
    build(paint, L) {
      const g = new THREE.Group();
      profile(g, paint, 1.8, sh => {
        sh.moveTo(-2.3, -0.28); arch(sh, -1.42, -0.28, 0.43); arch(sh, 1.42, -0.28, 0.43);
        sh.lineTo(2.25, -0.28); sh.quadraticCurveTo(2.42, -0.2, 2.4, 0.05); sh.quadraticCurveTo(2.35, 0.28, 2.15, 0.32);
        sh.lineTo(1.0, 0.44); sh.lineTo(-1.4, 0.44); sh.quadraticCurveTo(-2.15, 0.42, -2.3, 0.3); sh.quadraticCurveTo(-2.42, 0.1, -2.3, -0.28);
      }, 0.08);
      profile(g, M.glass, 1.6, sh => {
        sh.moveTo(1.02, 0.42); sh.quadraticCurveTo(0.55, 0.78, 0.2, 0.9); sh.lineTo(-0.7, 0.9); sh.quadraticCurveTo(-1.2, 0.72, -1.48, 0.42); sh.closePath();
      }, 0.05);
      box(g, paint, 0.92, 0.05, 1.62, -0.25, 0.91, 0);
      for (const z of [0.8, -0.8]) {
        box(g, paint, 0.08, 0.46, 0.05, -0.2, 0.66, z);
        box(g, M.black, 0.15, 0.1, 0.05, 0.95, 0.6, z * 1.15);
        box(g, M.chrome, 0.18, 0.025, 0.03, 0.35, 0.3, z * 1.12);
        box(g, M.chrome, 0.18, 0.025, 0.03, -0.75, 0.3, z * 1.12);
      }
      box(g, M.plastic, 0.12, 0.18, 1.82, 2.38, -0.18, 0); box(g, M.plastic, 0.12, 0.18, 1.82, -2.36, -0.18, 0);
      box(g, M.black, 0.03, 0.12, 0.8, 2.41, 0.04, 0);
      lampPair(g, L.head, 2.3, 0.16, 0.62, 0.06, 0.1, 0.34);
      lampPair(g, L.tail, -2.33, 0.2, 0.64, 0.05, 0.12, 0.3);
      return g;
    },
  },
  golfcart: {
    kind: 'golfcart', label: 'Golf Cart',
    chassis: { hx: 1.25, hy: 0.28, hz: 0.65 }, mass: 450, comY: -0.25,
    axles: [
      { x: 0.84, radius: 0.24, width: 0.2, halfTrack: 0.56, steer: true, drive: false },
      { x: -0.84, radius: 0.24, width: 0.2, halfTrack: 0.56, steer: false, drive: true },
    ],
    wheelY: -0.08, suspension: { rest: 0.24, travel: 0.14, stiffness: 28, compression: 2.2, relaxation: 3.0 },
    frictionSlip: 2.0, sideStiffness: 1.0, engineForce: 520, topSpeed: 8.5, brake: 16, maxSteer: 0.65,
    cam: { dist: 6, height: 2.4 }, paint: 0xf3f1ea,
    build(paint, L) {
      const g = new THREE.Group();
      box(g, paint, 2.45, 0.4, 1.25, 0, 0.05, 0);
      box(g, paint, 0.6, 0.35, 1.2, 1.0, 0.35, 0);                      // front cowl
      box(g, M.seat, 0.6, 0.15, 1.1, -0.2, 0.35, 0);                    // bench
      box(g, M.seat, 0.12, 0.55, 1.1, -0.52, 0.65, 0);                  // backrest
      for (const x of [0.7, -0.75]) for (const z of [0.55, -0.55]) cyl(g, M.chrome, 0.025, 1.45, x, 1.0, z);
      box(g, M.canvas, 1.75, 0.06, 1.3, -0.02, 1.74, 0);                // roof
      cyl(g, M.black, 0.17, 0.03, 0.55, 0.85, 0.28, 'x').rotation.y = 0.5; // steering wheel
      box(g, M.plastic, 0.6, 0.35, 1.0, -1.0, 0.45, 0);                 // bag well
      lampPair(g, L.head, 1.31, 0.35, 0.42, 0.04, 0.09, 0.14);
      lampPair(g, L.tail, -1.24, 0.2, 0.55, 0.04, 0.08, 0.1);
      return g;
    },
  },
  atv: {
    kind: 'atv', label: 'Four-Wheeler',
    chassis: { hx: 1.0, hy: 0.28, hz: 0.55 }, mass: 330, comY: -0.2,
    axles: [
      { x: 0.66, radius: 0.31, width: 0.26, halfTrack: 0.5, steer: true, drive: true },
      { x: -0.66, radius: 0.31, width: 0.28, halfTrack: 0.5, steer: false, drive: true },
    ],
    wheelY: -0.02, suspension: { rest: 0.3, travel: 0.25, stiffness: 24, compression: 2.0, relaxation: 2.6 },
    frictionSlip: 2.8, sideStiffness: 1.1, engineForce: 420, topSpeed: 21, brake: 13, maxSteer: 0.62,
    hitch: { x: -1.2, y: -0.05 }, cam: { dist: 5.5, height: 2.2 }, paint: 0x2f5d2a,
    build(paint, L) {
      const g = new THREE.Group();
      box(g, paint, 1.0, 0.3, 0.8, 0.55, 0.2, 0);                       // front fenders
      box(g, paint, 0.9, 0.3, 0.85, -0.6, 0.2, 0);                      // rear fenders
      box(g, M.seat, 0.75, 0.16, 0.36, -0.15, 0.42, 0);
      box(g, M.plastic, 0.5, 0.3, 0.42, 0.25, 0.35, 0);                 // tank
      cyl(g, M.black, 0.025, 0.85, 0.5, 0.68, 0, 'z');                  // handlebar
      cyl(g, M.black, 0.03, 0.35, 0.45, 0.5, 0, 'y');
      box(g, M.black, 0.5, 0.04, 0.85, 0.85, 0.42, 0);                  // racks
      box(g, M.black, 0.6, 0.04, 0.85, -0.85, 0.42, 0);
      lampPair(g, L.head, 1.02, 0.28, 0.2, 0.04, 0.08, 0.12);
      lampPair(g, L.tail, -1.0, 0.25, 0.3, 0.04, 0.06, 0.08);
      return g;
    },
  },
  mower: {
    kind: 'mower', label: 'Riding Mower',
    chassis: { hx: 0.9, hy: 0.22, hz: 0.48 }, mass: 230, comY: -0.18,
    axles: [
      { x: 0.6, radius: 0.19, width: 0.15, halfTrack: 0.42, steer: true, drive: false },
      { x: -0.55, radius: 0.28, width: 0.22, halfTrack: 0.44, steer: false, drive: true },
    ],
    wheelY: -0.02, suspension: { rest: 0.2, travel: 0.1, stiffness: 30, compression: 2.4, relaxation: 3.0 },
    frictionSlip: 2.2, sideStiffness: 1.0, engineForce: 260, topSpeed: 4.2, brake: 10, maxSteer: 0.75,
    mowerDeck: { x: 0.05, width: 1.1 }, cam: { dist: 5, height: 2.4 }, paint: 0x2c7a2c,
    build(paint, L) {
      const g = new THREE.Group();
      box(g, paint, 0.85, 0.35, 0.75, 0.48, 0.22, 0);                   // hood
      box(g, paint, 0.9, 0.22, 0.8, -0.35, 0.2, 0);
      box(g, M.seat, 0.4, 0.12, 0.45, -0.4, 0.42, 0);
      box(g, M.seat, 0.08, 0.38, 0.45, -0.62, 0.6, 0);
      cyl(g, M.black, 0.15, 0.03, 0.1, 0.72, 0, 'y').rotation.z = 0.5;
      cyl(g, M.black, 0.02, 0.4, 0.15, 0.55, 0, 'y');
      box(g, M.deck, 0.75, 0.14, 1.14, 0.05, -0.18, 0);                 // cutting deck
      box(g, M.black, 0.35, 0.1, 0.18, 0.05, -0.15, 0.62);              // discharge chute
      lampPair(g, L.head, 0.92, 0.25, 0.18, 0.03, 0.06, 0.1);
      return g;
    },
  },
  trailer: {
    kind: 'trailer', label: 'Utility Trailer',
    chassis: { hx: 1.6, hy: 0.16, hz: 0.82 }, mass: 420, comY: -0.05,
    axles: [{ x: -0.25, radius: 0.33, width: 0.2, halfTrack: 0.95, steer: false, drive: false }],
    wheelY: -0.02, suspension: { rest: 0.3, travel: 0.15, stiffness: 32, compression: 2.4, relaxation: 3.2 },
    frictionSlip: 2.0, sideStiffness: 1.0, engineForce: 0, topSpeed: 0, brake: 6, maxSteer: 0,
    tongue: { x: 2.5, y: -0.12 }, cam: { dist: 8, height: 3 }, paint: 0x5a5e63,
    build(paint, L) {
      const g = new THREE.Group();
      box(g, M.wood, 3.2, 0.06, 1.64, 0, 0.16, 0);                      // deck boards
      box(g, paint, 3.2, 0.14, 0.06, 0, 0.06, 0.82); box(g, paint, 3.2, 0.14, 0.06, 0, 0.06, -0.82);
      for (const x of [-1.5, -0.5, 0.5, 1.5]) for (const z of [0.82, -0.82]) box(g, paint, 0.05, 0.45, 0.05, x, 0.4, z);
      box(g, paint, 3.2, 0.05, 0.05, 0, 0.62, 0.82); box(g, paint, 3.2, 0.05, 0.05, 0, 0.62, -0.82);
      box(g, paint, 0.9, 0.06, 0.06, 2.05, -0.06, 0.2, 0).rotation.y = 0.4;   // A-frame tongue
      box(g, paint, 0.9, 0.06, 0.06, 2.05, -0.06, -0.2, 0).rotation.y = -0.4;
      box(g, M.black, 0.2, 0.1, 0.12, 2.5, -0.1, 0);                    // coupler
      box(g, M.black, 0.8, 0.06, 0.25, -0.25, 0.25, 0.95); box(g, M.black, 0.8, 0.06, 0.25, -0.25, 0.25, -0.95); // fenders
      lampPair(g, L.tail, -1.62, 0.1, 0.75, 0.04, 0.08, 0.08);
      return g;
    },
  },
};
