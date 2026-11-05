/**
 * The riding mower, built from primitives in the chassis frame (x forward,
 * y up, z right; wheel centres at y = -0.22, ground near y = -0.45), so it
 * needs no download and lines up with shared/Vehicles.ts exactly: rounded
 * hood with grille and lamps, frame rails and axles, the cutting deck under
 * the middle with its side chute, footboards, dash tower, steering column
 * and wheel, a high-back seat, fenders over the drive wheels and a rear grass
 * catcher with a lid, lift handle and the blower tube from the deck. Wheels
 * are the shared procedural tires (VehicleModels), so all four spin and steer.
 * Geometry is built once and every mower draws clones of it; only the paint
 * and lamp materials are per mower (and are freed with it).
 */
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder, R as gfx, trs, quatDeg } from '../core/Geo';
import { lin3, pbr as basePbr } from '../core/Tex';

export type MowerPart = 'paint' | 'plastic' | 'vinyl' | 'steel' | 'chrome' | 'fabric' | 'head' | 'tail';

export interface MowerMaterials {
  paint: PBRMaterial;
  head: PBRMaterial;
  tail: PBRMaterial;
}

let shared: Record<'plastic' | 'vinyl' | 'steel' | 'chrome' | 'fabric', PBRMaterial> | null = null;

function pbr(name: string, rgb: [number, number, number], metal: number, gloss: number) {
  const m = basePbr(name, gfx().scene);
  m.albedoColor = lin3(rgb);
  m.metallic = metal; m.roughness = 1 - gloss * 0.96;
  m.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
  return m;
}

/** Materials every mower shares (plastic, vinyl, steel, chrome, bag fabric). */
export function mowerSharedMaterials() {
  shared ??= {
    plastic: pbr('mower-plastic', [0.035, 0.037, 0.04], 0, 0.42),
    vinyl: pbr('mower-vinyl', [0.028, 0.028, 0.03], 0, 0.58),
    steel: pbr('mower-steel', [0.32, 0.33, 0.35], 0.85, 0.5),
    chrome: pbr('mower-chrome', [0.9, 0.9, 0.92], 1, 0.88),
    fabric: pbr('mower-fabric', [0.06, 0.065, 0.06], 0, 0.06),
  };
  return shared;
}

/** Fresh per-mower materials: paint (takes the owner's color) and the two lamp lenses. */
export function mowerMaterials(): MowerMaterials {
  const paint = pbr('mower-paint', [0.17, 0.48, 0.17], 0.15, 0.78);
  paint.clearCoat.isEnabled = true; paint.clearCoat.intensity = 1; paint.clearCoat.roughness = 0.1;
  const lens = (name: string, c: [number, number, number]) => {
    const m = pbr(name, [c[0] * 0.3, c[1] * 0.3, c[2] * 0.3], 0, 0.92);
    m.emissiveColor = lin3(c); m.emissiveIntensity = 0.05;
    return m;
  };
  return { paint, head: lens('mower-head', [1, 0.96, 0.86]), tail: lens('mower-tail', [1, 0.08, 0.06]) };
}

/** Geometry per part, built once and shared by every mower (disabled templates: views draw clones). */
let meshCache: Map<MowerPart, Mesh> | null = null;

function buildParts(): Map<MowerPart, Mesh> {
  const B: Record<MowerPart, MeshBuilder> = {
    paint: new MeshBuilder(), plastic: new MeshBuilder(), vinyl: new MeshBuilder(), steel: new MeshBuilder(),
    chrome: new MeshBuilder(), fabric: new MeshBuilder(), head: new MeshBuilder(), tail: new MeshBuilder(),
  };
  const mirror = (fn: (s: number) => void) => { fn(1); fn(-1); };

  // Hood: rounded, sloping down to the nose.
  B.paint.loft([
    { x: 0.12, cy: 0.16, hw: 0.27, hh: 0.21, r: 0.07 },
    { x: 0.35, cy: 0.17, hw: 0.28, hh: 0.2, r: 0.09 },
    { x: 0.7, cy: 0.13, hw: 0.27, hh: 0.16, r: 0.1 },
    { x: 0.9, cy: 0.07, hw: 0.24, hh: 0.11, r: 0.09 },
    { x: 0.965, cy: 0.05, hw: 0.2, hh: 0.08, r: 0.07 },
  ], 5);
  B.plastic.box(0.962, -0.025, -0.14, 0.972, 0.085, 0.14);
  for (let k = 0; k < 5; k++) B.steel.box(0.968, -0.012 + k * 0.02, -0.12, 0.976, -0.004 + k * 0.02, 0.12);
  mirror(s => {
    B.chrome.box(0.94, 0.085, s * 0.12 - 0.055, 0.958, 0.135, s * 0.12 + 0.055);
    B.head.box(0.957, 0.093, s * 0.12 - 0.045, 0.962, 0.127, s * 0.12 + 0.045);
    B.plastic.box(0.45, 0.06, s * 0.281 - 0.004, 0.72, 0.16, s * 0.281 + 0.004);
    for (let k = 0; k < 4; k++) B.steel.box(0.47 + k * 0.06, 0.075, s * 0.284 - 0.003, 0.5 + k * 0.06, 0.145, s * 0.284 + 0.003);
  });
  B.plastic.box(0.93, -0.14, -0.23, 1.0, -0.05, 0.23);
  B.plastic.cylinder(0.3, 0.365, 0, 0.035, 0.03, 0.025, 14, true);

  // Frame rails, front axle, rear transaxle.
  mirror(s => B.steel.box(-0.98, -0.17, s * 0.24, 0.94, -0.08, s * 0.29));
  B.steel.box(0.56, -0.26, -0.37, 0.64, -0.18, 0.37);
  B.steel.box(-0.64, -0.32, -0.26, -0.46, -0.1, 0.26);
  B.steel.tube([-0.55, -0.22, -0.34], [-0.55, -0.22, 0.34], 0.03, 10);

  // Cutting deck with its side discharge chute.
  B.paint.loft([
    { x: -0.24, cy: -0.31, hw: 0.4, hh: 0.045, r: 0.04 },
    { x: -0.18, cy: -0.31, hw: 0.55, hh: 0.05, r: 0.045 },
    { x: 0.33, cy: -0.31, hw: 0.55, hh: 0.05, r: 0.045 },
    { x: 0.4, cy: -0.31, hw: 0.4, hh: 0.045, r: 0.04 },
  ], 4);
  B.plastic.loft([
    { x: -0.02, cy: -0.3, cz: 0.6, hw: 0.08, hh: 0.035, r: 0.02 },
    { x: 0.2, cy: -0.3, cz: 0.6, hw: 0.08, hh: 0.035, r: 0.02 },
  ], 3);
  for (const x of [-0.08, 0.26]) B.chrome.cylinder(x, -0.262, 0, 0.05, 0.04, 0.02, 12, true);
  mirror(s => B.plastic.cylinder(0.36, -0.42, s * 0.5, 0.035, 0.035, 0.05, 10, true));

  // Footboards with rubber treads, dash tower, steering column and wheel.
  mirror(s => {
    B.steel.box(-0.26, -0.08, s * 0.29, 0.14, -0.05, s * 0.5);
    for (let k = 0; k < 6; k++) B.plastic.box(-0.24 + k * 0.065, -0.05, s * 0.31, -0.21 + k * 0.065, -0.04, s * 0.48);
  });
  B.plastic.loft([
    { x: -0.06, cy: 0.22, hw: 0.17, hh: 0.24, r: 0.05 },
    { x: 0.04, cy: 0.23, hw: 0.2, hh: 0.24, r: 0.06 },
    { x: 0.16, cy: 0.18, hw: 0.24, hh: 0.2, r: 0.06 },
  ], 4);
  B.steel.box(-0.07, 0.3, -0.12, -0.055, 0.4, -0.02);
  B.chrome.tube([0.02, 0.42, 0], [-0.1, 0.71, 0], 0.022, 10);
  const col = new Vector3(-0.12, 0.29, 0).normalize();
  const wheelAt = trs(-0.11, 0.73, 0, Quaternion.RotationAxis(new Vector3(0, 0, 1), Math.atan2(-col.x, col.y)));
  B.plastic.transform(wheelAt);
  B.plastic.torus(0.155, 0.018, 28, 8);
  B.plastic.cylinder(0, -0.02, 0, 0.045, 0.04, 0.04, 14, true);
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + Math.PI / 2; B.plastic.tube([0, 0, 0], [Math.cos(a) * 0.15, -0.005, Math.sin(a) * 0.15], 0.012, 6, false); }
  B.plastic.transform(null);

  // Seat: cushion, high back on a tilt, pan and spring post.
  B.vinyl.loft([
    { x: -0.62, cy: 0.37, hw: 0.21, hh: 0.05, r: 0.045 },
    { x: -0.58, cy: 0.375, hw: 0.24, hh: 0.058, r: 0.05 },
    { x: -0.26, cy: 0.37, hw: 0.24, hh: 0.055, r: 0.05 },
    { x: -0.2, cy: 0.36, hw: 0.2, hh: 0.045, r: 0.04 },
  ], 4);
  const back = trs(-0.66, 0.57, 0, quatDeg(0, 0, 13));
  B.vinyl.transform(back);
  B.vinyl.loft([
    { x: -0.04, cy: 0, hw: 0.21, hh: 0.19, r: 0.07 },
    { x: -0.02, cy: 0, hw: 0.23, hh: 0.21, r: 0.08 },
    { x: 0.04, cy: 0, hw: 0.22, hh: 0.2, r: 0.075 },
  ], 4);
  B.vinyl.transform(null);
  B.steel.box(-0.6, 0.29, -0.16, -0.22, 0.32, 0.16);
  B.steel.box(-0.48, 0.2, -0.05, -0.38, 0.29, 0.05);
  mirror(s => B.plastic.tube([-0.22, 0.22, s * 0.3], [-0.16, 0.44, s * 0.33], 0.012, 6));
  mirror(s => B.paint.cylinder(-0.16, 0.44, s * 0.33, 0.022, 0.022, 0.04, 10, true));

  // Rear fender pan over the drive wheels, with arches and tail lamps.
  B.paint.loft([
    { x: -0.99, cy: 0.17, hw: 0.5, hh: 0.03, r: 0.025 },
    { x: -0.94, cy: 0.18, hw: 0.57, hh: 0.035, r: 0.03 },
    { x: -0.2, cy: 0.18, hw: 0.57, hh: 0.035, r: 0.03 },
    { x: -0.11, cy: 0.18, hw: 0.4, hh: 0.035, r: 0.03 },
  ], 4);
  mirror(s => {
    const z0 = s > 0 ? 0.31 : -0.58, z1 = s > 0 ? 0.58 : -0.31;
    const n = 14, R0 = 0.33, R1 = 0.355;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI * (0.06 + 0.88 * i / n), a1 = Math.PI * (0.06 + 0.88 * (i + 1) / n);
      const p = (a: number, R: number) => [-0.55 + Math.cos(a) * R, -0.22 + Math.sin(a) * R];
      const [o0, o1, i0, i1] = [p(a0, R1), p(a1, R1), p(a0, R0), p(a1, R0)];
      const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
      B.paint.face([o0[0], o0[1], z0], [o1[0], o1[1], z0], [o1[0], o1[1], z1], [o0[0], o0[1], z1], uv);
      B.paint.face([i1[0], i1[1], z0], [i0[0], i0[1], z0], [i0[0], i0[1], z1], [i1[0], i1[1], z1], uv);
      const zo = s > 0 ? z1 : z0;
      if (s > 0) B.paint.face([o0[0], o0[1], zo], [o1[0], o1[1], zo], [i1[0], i1[1], zo], [i0[0], i0[1], zo], uv);
      else B.paint.face([i0[0], i0[1], zo], [i1[0], i1[1], zo], [o1[0], o1[1], zo], [o0[0], o0[1], zo], uv);
    }
    B.tail.box(-0.995, 0.14, s * 0.42 - 0.04, -0.985, 0.175, s * 0.42 + 0.04);
  });

  // Grass catcher: bracket, fabric bag, lid with a lift handle, and the blower tube from the chute.
  B.steel.box(-1.04, 0.02, -0.22, -0.97, 0.2, 0.22);
  mirror(s => B.steel.tube([-0.98, 0.0, s * 0.2], [-1.12, 0.06, s * 0.2], 0.014, 6));
  B.fabric.loft([
    { x: -1.46, cy: 0.31, hw: 0.36, hh: 0.21, r: 0.09 },
    { x: -1.42, cy: 0.31, hw: 0.4, hh: 0.25, r: 0.1 },
    { x: -1.08, cy: 0.31, hw: 0.4, hh: 0.25, r: 0.1 },
    { x: -1.04, cy: 0.31, hw: 0.36, hh: 0.21, r: 0.09 },
  ], 5);
  for (let k = 1; k < 4; k++) B.steel.loft([
    { x: -1.42 + k * 0.085, cy: 0.31, hw: 0.405, hh: 0.255, r: 0.1 },
    { x: -1.41 + k * 0.085, cy: 0.31, hw: 0.405, hh: 0.255, r: 0.1 },
  ], 5, false);
  B.paint.loft([
    { x: -1.49, cy: 0.575, hw: 0.4, hh: 0.025, r: 0.02 },
    { x: -1.46, cy: 0.585, hw: 0.43, hh: 0.035, r: 0.03 },
    { x: -1.04, cy: 0.585, hw: 0.43, hh: 0.035, r: 0.03 },
    { x: -1.01, cy: 0.575, hw: 0.4, hh: 0.025, r: 0.02 },
  ], 4);
  B.plastic.tube([-1.4, 0.615, -0.13], [-1.43, 0.69, -0.13], 0.014, 8);
  B.plastic.tube([-1.43, 0.69, -0.13], [-1.43, 0.69, 0.13], 0.016, 8);
  B.plastic.tube([-1.43, 0.69, 0.13], [-1.4, 0.615, 0.13], 0.014, 8);
  const blower = [[0.12, -0.28, 0.66], [-0.12, -0.02, 0.69], [-0.6, 0.27, 0.68], [-1.0, 0.37, 0.48], [-1.1, 0.4, 0.38]];
  for (let i = 0; i < blower.length - 1; i++) B.plastic.tube(blower[i], blower[i + 1], 0.055, 12, i === 0);
  const ball = [[0.0001, -0.055], [0.035, -0.045], [0.055, 0], [0.035, 0.045], [0.0001, 0.055]];
  for (let i = 1; i < blower.length - 1; i++) {
    B.plastic.transform(Matrix.Translation(blower[i][0], blower[i][1], blower[i][2]));
    B.plastic.lathe(ball, 12, true);
    B.plastic.transform(null);
  }
  return new Map((Object.keys(B) as MowerPart[]).filter(k => !B[k].empty).map(k => {
    const mesh = B[k].toMesh(`mower-${k}`);
    mesh.setEnabled(false);
    return [k, mesh] as [MowerPart, Mesh];
  }));
}

export function mowerMeshes() {
  return (meshCache ??= buildParts());
}
