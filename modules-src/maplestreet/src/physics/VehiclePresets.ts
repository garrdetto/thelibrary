/**
 * Procedural body meshes for the built-in vehicles (their opening doors are
 * separate leaves, in ./VehicleDoors). Their tuning (sizes,
 * axles, suspension, engine) is plain data in shared/Vehicles.ts so every
 * authority and the admin editor read the same numbers.
 * Convention: chassis local +X = forward, +Y = up, +Z = right.
 */
import * as THREE from 'three/webgpu';
import { BUILTIN_TUNING, type BuiltinVehicleKind, type VehicleTuning } from '../../shared/Vehicles';
import { mergeStatic } from '../core/Merge';
import type { CarStyle, PaintFinish, RimFinish, Rims } from '../../shared/Cars';

export interface VehiclePreset extends VehicleTuning {
  build(paint: THREE.Material, lights: VehicleLights): THREE.Group;
  /** Optional wheel model (published vehicles); the procedural wheel otherwise. */
  wheel?(radius: number, width: number): THREE.Group;
}

export const wheelFor = (P: VehiclePreset, radius: number, width: number) => P.wheel?.(radius, width) ?? buildWheel(radius, width);

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
  amber: new THREE.MeshStandardMaterial({ color: 0xffa21a, emissive: 0xff8a00, emissiveIntensity: 0.6, roughness: 0.3 }),
};

const FINISH: Record<PaintFinish, { metalness: number; roughness: number; clearcoat: number; clearcoatRoughness: number }> = {
  gloss: { metalness: 0.12, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05 },
  metallic: { metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 },
  matte: { metalness: 0.08, roughness: 0.78, clearcoat: 0, clearcoatRoughness: 1 },
};

/** `wear` (0–1, crash damage) dulls the paint: rougher, less clearcoat, a touch grayer. */
export function makePaint(color: number, finish: PaintFinish = 'metallic', wear = 0) {
  const f = FINISH[finish], w = Math.min(1, Math.max(0, wear));
  const c = new THREE.Color(color).lerp(new THREE.Color(0x6f6a64), w * 0.25);
  return new THREE.MeshPhysicalMaterial({ color: c, metalness: f.metalness * (1 - w * 0.4), roughness: Math.min(1, f.roughness + w * 0.35), clearcoat: f.clearcoat * (1 - w * 0.8), clearcoatRoughness: f.clearcoatRoughness });
}

/** Paint for an owned car's style, or the vehicle's factory paint. */
export function paintFor(P: VehicleTuning, style?: CarStyle | null) {
  return style ? makePaint(parseInt(style.color.slice(1), 16), style.finish, style.damage ?? 0) : makePaint(P.paint);
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
  for (const m of g.children) m.castShadow = true;
  mergeStatic(g, { flatten: () => true });
  return g;
}


const RIM_MATS: Record<Exclude<RimFinish, 'body'>, THREE.MeshStandardMaterial> = {
  silver: M.rim,
  chrome: new THREE.MeshStandardMaterial({ color: 0xf2f4f6, metalness: 1, roughness: 0.06 }),
  black: new THREE.MeshStandardMaterial({ color: 0x121314, metalness: 0.5, roughness: 0.28 }),
  gunmetal: new THREE.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.85, roughness: 0.32 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.22 }),
};

/** An aftermarket wheel: the same tire size with a bigger rim (`rims.size`), in one of six styles and finishes. */
export function buildStyledWheel(radius: number, width: number, rims: Rims, bodyColor: string): THREE.Group {
  const g = new THREE.Group();
  const finish = rims.finish === 'body' ? new THREE.MeshStandardMaterial({ color: new THREE.Color(bodyColor), metalness: 0.4, roughness: 0.3 }) : RIM_MATS[rims.finish];
  const r = radius * (0.62 + rims.size * 0.07);
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 32, 1), M.rubber);
  tire.rotation.x = Math.PI / 2; g.add(tire);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width * 1.02, 28), rims.style === 'dish' ? RIM_MATS.chrome : M.black);
  barrel.rotation.x = Math.PI / 2; g.add(barrel);
  const face = (mat: THREE.Material, rr: number, depth: number) => {
    for (const z of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, depth, 28), mat);
      m.rotation.x = Math.PI / 2; m.position.z = z * (width * 0.5 - depth / 2 + 0.012); g.add(m);
    }
  };
  const spokes = (n: number, len: number, thick: number, inner: number, twist = 0) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      for (const z of [-1, 1]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(len, thick, 0.05), finish);
        s.position.set(Math.cos(a) * (inner + len / 2), Math.sin(a) * (inner + len / 2), z * (width * 0.5 + 0.005));
        s.rotation.z = a + twist; g.add(s);
      }
    }
  };
  const ring = (rr: number, tube: number, mat: THREE.Material) => {
    for (const z of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(rr, tube, 8, 32), mat);
      m.position.z = z * (width * 0.5 + 0.01); g.add(m);
    }
  };
  const hub = r * 0.22;
  face(finish, hub, 0.06);
  switch (rims.style) {
    case 'fivespoke': spokes(5, r - hub, r * 0.26, hub); ring(r * 0.97, r * 0.04, finish); break;
    case 'mesh': spokes(14, r - hub, r * 0.07, hub, 0.35); spokes(14, r - hub, r * 0.07, hub, -0.35); ring(r * 0.97, r * 0.04, finish); break;
    case 'dish': ring(r * 0.95, r * 0.07, RIM_MATS.chrome); spokes(6, r * 0.62 - hub, r * 0.2, hub); face(finish, r * 0.64, 0.02); break;
    case 'turbine': spokes(12, r - hub, r * 0.15, hub, 0.6); ring(r * 0.97, r * 0.05, finish); break;
    case 'beadlock': {
      spokes(6, r - hub, r * 0.22, hub); ring(r * 0.93, r * 0.08, finish);
      for (let i = 0; i < 12; i++) for (const z of [-1, 1]) {
        const a = (i / 12) * Math.PI * 2, bolt = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.035, r * 0.035, 0.04, 8), RIM_MATS.chrome);
        bolt.rotation.x = Math.PI / 2; bolt.position.set(Math.cos(a) * r * 0.93, Math.sin(a) * r * 0.93, z * (width * 0.5 + 0.03)); g.add(bolt);
      }
      break;
    }
    default: spokes(5, r - hub, r * 0.18, hub);
  }
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  mergeStatic(g, { flatten: () => true });
  return g;
}

/** The wheel for an owned car: its aftermarket rims, or the vehicle's own wheel, at the tire size its lift calls for. */
export function wheelForCar(P: VehiclePreset, radius: number, width: number, car: CarStyle | null | undefined, tireScale = 1) {
  const rims = car?.rims;
  if (!rims || rims.style === 'factory') return wheelFor(P, radius * tireScale, width * (tireScale > 1 ? 1.08 : 1));
  return buildStyledWheel(radius * tireScale, width * (tireScale > 1 ? 1.08 : 1), rims, car?.color ?? '#888888');
}

const TINT: (THREE.MeshStandardMaterial | null)[] = [null, ...[[0x141c24, 0.7], [0x0d1218, 0.82], [0x07090c, 0.93]].map(([color, opacity]) => new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.05, transparent: true, opacity }))];

/** Swaps the shared window glass for tinted glass (before merging, which groups by material). */
export function tintGlass(body: THREE.Object3D, tint: number | undefined) {
  const mat = TINT[tint ?? 0];
  if (!mat) return;
  body.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.material === M.glass) mesh.material = mat;
    else if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(m => m === M.glass ? mat : m);
  });
}

// ------------------------------------------------------------------ presets

const BUILTIN_PRESETS: Record<BuiltinVehicleKind, VehiclePreset> = {
  truck: {
    ...BUILTIN_TUNING.truck,
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
    ...BUILTIN_TUNING.sedan,
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
      }
      box(g, M.plastic, 0.12, 0.18, 1.82, 2.38, -0.18, 0); box(g, M.plastic, 0.12, 0.18, 1.82, -2.36, -0.18, 0);
      box(g, M.black, 0.03, 0.12, 0.8, 2.41, 0.04, 0);
      lampPair(g, L.head, 2.3, 0.16, 0.62, 0.06, 0.1, 0.34);
      lampPair(g, L.tail, -2.33, 0.2, 0.64, 0.05, 0.12, 0.3);
      return g;
    },
  },
  golfcart: {
    ...BUILTIN_TUNING.golfcart,
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
    ...BUILTIN_TUNING.atv,
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
    ...BUILTIN_TUNING.mower,
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
  hdtruck: {
    ...BUILTIN_TUNING.hdtruck,
    build(paint, L) {
      const g = new THREE.Group();
      profile(g, paint, 2.04, sh => {                                   // tall-nosed full-size body
        sh.moveTo(-3.0, -0.38); arch(sh, -2.0, -0.38, 0.62); arch(sh, 2.0, -0.38, 0.62);
        sh.lineTo(3.06, -0.38); sh.lineTo(3.12, 0.2); sh.lineTo(3.1, 0.86); sh.quadraticCurveTo(3.06, 0.97, 2.9, 0.98);
        sh.lineTo(1.36, 1.04); sh.lineTo(1.28, 1.0); sh.lineTo(-0.86, 1.0); sh.lineTo(-0.86, 0.3); sh.lineTo(-3.0, 0.3); sh.closePath();
      }, 0.07);
      profile(g, M.glass, 1.86, sh => {                                 // crew-cab greenhouse
        sh.moveTo(-0.82, 0.96); sh.lineTo(-0.78, 1.74); sh.quadraticCurveTo(-0.7, 1.82, -0.5, 1.82); sh.lineTo(0.78, 1.8); sh.lineTo(1.3, 1.02); sh.closePath();
      }, 0.04);
      box(g, paint, 1.62, 0.07, 1.92, -0.02, 1.84, 0);                   // roof skin
      for (const x of [-0.3, 0.25, 0.75]) box(g, M.amber, 0.08, 0.05, 0.12, x + 0.02, 1.9, 0);  // roof clearance lamps
      for (const z of [0.95, -0.95]) {
        box(g, paint, 0.07, 0.86, 0.06, 1.05, 1.4, z, 0.6);             // A-pillars
        box(g, paint, 0.12, 0.8, 0.06, 0.35, 1.4, z);                   // B-pillars
        box(g, paint, 0.12, 0.8, 0.06, -0.8, 1.38, z);                  // C-pillars
        box(g, paint, 2.12, 0.66, 0.09, -1.94, 0.66, z * 1.03);         // bed sides
        box(g, M.black, 0.32, 0.26, 0.06, 1.25, 1.22, z * 1.22);        // tow mirrors
        box(g, M.black, 2.5, 0.06, 0.18, 0.2, -0.42, z * 0.98);         // running boards
        for (const x of [2.0, -2.0]) box(g, M.black, 1.36, 0.16, 0.2, x, 0.22, z * 1.0);   // fender flares
      }
      box(g, paint, 0.09, 0.66, 2.04, -2.98, 0.66, 0);                   // tailgate
      box(g, M.plastic, 2.08, 0.04, 1.86, -1.94, 0.32, 0);               // spray-in bed liner
      box(g, M.chrome, 0.2, 0.3, 2.1, 3.16, -0.18, 0);                   // bumpers
      box(g, M.chrome, 0.2, 0.26, 2.1, -3.06, -0.2, 0);
      box(g, M.black, 0.05, 0.56, 1.32, 3.13, 0.55, 0);                  // grille opening
      box(g, M.chrome, 0.07, 0.62, 0.07, 3.15, 0.55, 0.66); box(g, M.chrome, 0.07, 0.62, 0.07, 3.15, 0.55, -0.66);
      for (let i = 0; i < 5; i++) box(g, M.chrome, 0.06, 0.04, 1.3, 3.15, 0.31 + i * 0.12, 0);   // horizontal bars
      lampPair(g, L.head, 3.11, 0.66, 0.84, 0.06, 0.34, 0.22);
      lampPair(g, L.tail, -3.06, 0.66, 0.97, 0.05, 0.5, 0.1);
      cyl(g, M.chrome, 0.05, 0.25, -2.6, -0.3, 0.75, 'x'); cyl(g, M.chrome, 0.05, 0.25, -2.6, -0.3, -0.75, 'x');   // dual exhaust
      cyl(g, M.chrome, 0.045, 0.28, -3.32, -0.24, 0, 'y');               // receiver hitch ball
      return g;
    },
  },
  coupe: {
    ...BUILTIN_TUNING.coupe,
    build(paint, L) {
      const g = new THREE.Group();
      profile(g, paint, 1.94, sh => {                                   // long hood, short deck
        sh.moveTo(-2.42, -0.28); arch(sh, -1.45, -0.28, 0.46); arch(sh, 1.5, -0.28, 0.45);
        sh.lineTo(2.42, -0.26); sh.quadraticCurveTo(2.54, -0.1, 2.5, 0.14); sh.lineTo(2.44, 0.36);
        sh.lineTo(2.25, 0.41); sh.quadraticCurveTo(1.6, 0.47, 0.74, 0.49); sh.lineTo(-1.65, 0.51);
        sh.lineTo(-2.3, 0.49); sh.quadraticCurveTo(-2.5, 0.42, -2.48, 0.28); sh.closePath();
      }, 0.09);
      profile(g, M.glass, 1.6, sh => {                                  // fastback roofline
        sh.moveTo(0.72, 0.47); sh.quadraticCurveTo(0.35, 0.86, 0.02, 0.98); sh.lineTo(-0.75, 0.98); sh.quadraticCurveTo(-1.25, 0.76, -1.7, 0.5); sh.closePath();
      }, 0.05);
      box(g, paint, 0.82, 0.05, 1.62, -0.36, 0.99, 0);
      box(g, paint, 0.9, 0.08, 0.7, 1.45, 0.5, 0);                       // hood bulge
      box(g, M.black, 0.3, 0.06, 0.5, 1.75, 0.53, 0);                    // hood vent
      for (const z of [0.18, -0.18]) box(g, M.black, 4.7, 0.012, 0.16, 0, 0.53, z);      // twin stripes
      box(g, M.black, 0.08, 0.06, 1.7, -2.36, 0.56, 0);                  // spoiler
      for (const z of [0.86, -0.86]) box(g, M.black, 0.08, 0.1, 0.06, -2.36, 0.52, z);
      box(g, M.black, 0.05, 0.22, 1.5, 2.49, 0.18, 0);                   // grille slot
      box(g, L.head, 0.04, 0.05, 1.5, 2.5, 0.32, 0);                     // LED light bar
      lampPair(g, L.head, 2.47, 0.2, 0.7, 0.05, 0.1, 0.22);
      lampPair(g, L.tail, -2.47, 0.33, 0.62, 0.05, 0.1, 0.38);
      for (const z of [0.97, -0.97]) {
        box(g, M.black, 0.15, 0.09, 0.05, 0.8, 0.6, z * 1.08);
      }
      cyl(g, M.chrome, 0.05, 0.2, -2.45, -0.22, 0.55, 'x'); cyl(g, M.chrome, 0.05, 0.2, -2.45, -0.22, -0.55, 'x');
      return g;
    },
  },
  zeroturn: {
    ...BUILTIN_TUNING.zeroturn,
    build(paint, L) {
      const g = new THREE.Group();
      box(g, paint, 1.2, 0.18, 0.9, -0.2, 0.12, 0);                     // engine pan
      box(g, M.black, 0.6, 0.4, 0.75, -0.62, 0.38, 0);                  // engine
      box(g, M.seat, 0.42, 0.12, 0.5, -0.3, 0.46, 0);                   // seat
      box(g, M.seat, 0.08, 0.5, 0.5, -0.52, 0.72, 0);                   // high back
      for (const z of [0.3, -0.3]) {                                   // lap-bar steering levers
        cyl(g, M.black, 0.02, 0.5, 0.05, 0.55, z, 'y');
        cyl(g, M.black, 0.02, 0.28, 0.12, 0.8, z * 0.55, 'z').rotation.y = 0;
      }
      for (const z of [0.42, -0.42]) cyl(g, M.black, 0.03, 1.1, -0.78, 0.95, z, 'y');  // roll bar
      cyl(g, M.black, 0.03, 0.86, -0.78, 1.5, 0, 'z');
      box(g, M.deck, 0.9, 0.16, 1.44, 0.45, -0.12, 0);                  // 54" fabricated deck
      box(g, M.black, 0.3, 0.12, 0.2, 0.45, -0.1, 0.8);                 // discharge chute
      box(g, paint, 0.6, 0.06, 0.6, 0.62, 0.1, 0);                      // footplate
      lampPair(g, L.head, 0.93, 0.2, 0.28, 0.03, 0.06, 0.1);
      return g;
    },
  },
  trailer: {
    ...BUILTIN_TUNING.trailer,
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

/**
 * Every drivable preset, keyed by kind. Built-ins are listed above;
 * published vehicles are added by src/physics/CustomVehicleModels.ts.
 */
export const PRESETS: Record<string, VehiclePreset> = { ...BUILTIN_PRESETS };
