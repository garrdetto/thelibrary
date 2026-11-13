/**
 * The four semi-trailers, built from primitives in each trailer's chassis frame (x forward, y up, z right, the road
 * at y = -rideHeight), sized to shared/FleetVehicles.ts so wheels, kingpin and landing gear line up with the physics.
 *
 * Every trailer shares the running gear of a real one: two I-beam main rails with crossmembers, the upper coupler
 * plate and kingpin, red and blue gladhands and the 7-way box on the nose, two-speed landing gear with a crank and
 * sand shoes, a sliding tandem (slider rails, axle tubes, air springs, shocks and brake chambers), mud flaps on
 * hangers, the rear impact guard, tail and marker lamps and red/white conspicuity tape.
 *
 *  - Dry van: aluminium posts and rails over white sheet sides, a roof bow line, a front wall with corner caps,
 *    swing doors with four lock rods, cam keepers and hinges, and side skirts.
 *  - Flatbed: an apitong-look plank deck in steel side rails with stake pockets and winches.
 *  - Log trailer: a centre beam with five bunks and tall stakes.
 *  - Fuel tanker: an elliptical stainless barrel with bands, domed heads, a railed catwalk with four manholes, a rear
 *    ladder, belly valves and piping, hose tubes and a placard holder.
 *
 * Loads (`trailerCargo`) are separate meshes switched on with the job: lumber bundles under yellow straps, steel
 * beams, pallets of building supplies, or a stack of logs chained to the bunks; the van and the tanker carry theirs
 * out of sight. Geometry is built once per kind and every trailer draws clones of it.
 */
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder, R as gfx } from '../core/Geo';
import { lin3, pbr as basePbr } from '../core/Tex';
import { TUNING, rideHeight } from '../../../maplestreet/shared/Vehicles';
import { COUPLING_HEIGHT, type SemiTrailerKind } from '../../../maplestreet/shared/FleetVehicles';

export type TrailerPart = 'paint' | 'aluminum' | 'steel' | 'chrome' | 'rubber' | 'wood' | 'tape' | 'amber' | 'tail' | 'dark' | 'bark' | 'log' | 'strap' | 'wrap' | 'red' | 'blue' | 'gravel';
export type CargoKind = 'lumber' | 'steel' | 'pallets' | 'logs' | 'gravel';

type Builders = Partial<Record<TrailerPart, MeshBuilder>>;

let shared: Record<Exclude<TrailerPart, 'paint' | 'tail'>, PBRMaterial> | null = null;

function pbr(name: string, rgb: [number, number, number], metal: number, gloss: number) {
  const m = basePbr(name, gfx().scene);
  m.albedoColor = lin3(rgb);
  m.metallic = metal;
  m.roughness = 1 - gloss * 0.96;
  m.transparencyMode = PBRMaterial.PBRMATERIAL_OPAQUE;
  return m;
}

/** Materials every trailer shares. */
export function trailerSharedMaterials() {
  shared ??= {
    aluminum: pbr('trl-aluminum', [0.78, 0.79, 0.8], 0.85, 0.62),
    steel: pbr('trl-steel', [0.06, 0.062, 0.065], 0.4, 0.42),
    chrome: pbr('trl-stainless', [0.72, 0.73, 0.75], 0.85, 0.66),
    rubber: pbr('trl-rubber', [0.025, 0.025, 0.027], 0, 0.25),
    wood: pbr('trl-wood', [0.42, 0.27, 0.15], 0, 0.3),
    tape: pbr('trl-tape', [0.92, 0.92, 0.92], 0, 0.7),
    amber: emissive('trl-amber', [1, 0.55, 0.08], 0.6),
    dark: pbr('trl-dark', [0.12, 0.12, 0.13], 0.2, 0.35),
    bark: pbr('trl-bark', [0.24, 0.18, 0.12], 0, 0.15),
    log: pbr('trl-log-end', [0.78, 0.62, 0.4], 0, 0.2),
    strap: pbr('trl-strap', [0.95, 0.72, 0.08], 0, 0.35),
    wrap: pbr('trl-wrap', [0.86, 0.85, 0.8], 0, 0.45),
    red: pbr('trl-gladhand-red', [0.75, 0.06, 0.05], 0.3, 0.6),
    gravel: pbr('trl-gravel', [0.46, 0.43, 0.38], 0, 0.08),
    blue: pbr('trl-gladhand-blue', [0.05, 0.18, 0.7], 0.3, 0.6),
  };
  return shared;
}

function emissive(name: string, c: [number, number, number], k: number) {
  const m = pbr(name, [c[0] * 0.35, c[1] * 0.35, c[2] * 0.35], 0, 0.9);
  m.emissiveColor = lin3(c);
  m.emissiveIntensity = k;
  return m;
}

/** Per-trailer materials: the body paint (owner colour) and the tail lamps (brake lights). */
export function trailerMaterials(kind: SemiTrailerKind) {
  const P = TUNING[kind];
  const c = P.paint;
  const paint = pbr(`trl-paint-${kind}`, [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255], 0.1, 0.7);
  paint.clearCoat.isEnabled = true;
  paint.clearCoat.intensity = 0.6;
  const tail = emissive(`trl-tail-${kind}`, [1, 0.06, 0.04], 0.05);
  return { paint, tail };
}

interface Frame {
  hx: number;
  /** Road height in the chassis frame. */
  ground: number;
  /** Underside of the deck or floor. */
  floor: number;
  /** Kingpin plate underside (the fifth wheel's top). */
  coupler: number;
  axles: number[];
  legs: number;
  width: number;
}

function frameOf(kind: SemiTrailerKind, floorHeight: number): Frame {
  const P = TUNING[kind];
  const ride = rideHeight(P);
  const axles = P.axles.filter(a => !a.leg).map(a => a.x);
  const leg = P.axles.find(a => a.leg)!;
  return { hx: P.chassis.hx, ground: -ride, floor: floorHeight - ride, coupler: COUPLING_HEIGHT - ride, axles, legs: leg.x, width: 2.59 };
}

const get = (B: Builders, k: TrailerPart) => (B[k] ??= new MeshBuilder());

/** Main rails, crossmembers, coupler, landing gear, slider tandem, mud flaps, rear guard, lamps and tape. */
function runningGear(B: Builders, f: Frame, o: { crossmembers: boolean; railDepth: number }) {
  const S = get(B, 'steel'), A = get(B, 'aluminum'), R = get(B, 'rubber');
  const { hx, ground, floor } = f;
  const y0 = floor - o.railDepth;
  for (const z of [-0.5, 0.5]) {
    S.box(-hx + 0.4, y0, z - 0.06, hx - 0.25, y0 + 0.012, z + 0.06);
    S.box(-hx + 0.4, y0, z - 0.006, hx - 0.25, floor, z + 0.006);
    S.box(-hx + 0.4, floor - 0.012, z - 0.06, hx - 0.25, floor, z + 0.06);
  }
  if (o.crossmembers) for (let x = -hx + 0.35; x < hx - 0.2; x += 0.42) S.box(x - 0.035, floor - 0.1, -f.width / 2 + 0.04, x + 0.035, floor, f.width / 2 - 0.04);
  S.box(hx - 1.7, f.coupler, -1.1, hx - 0.05, f.coupler + 0.02, 1.1);
  S.cylinder(hx - 0.92, f.coupler - 0.07, 0, 0.045, 0.045, 0.07, 14);
  S.cylinder(hx - 0.92, f.coupler - 0.09, 0, 0.065, 0.065, 0.025, 14);
  get(B, 'red').tube([hx + 0.01, floor + 0.45, -0.25], [hx + 0.12, floor + 0.45, -0.25], 0.04, 10);
  get(B, 'blue').tube([hx + 0.01, floor + 0.45, -0.38], [hx + 0.12, floor + 0.45, -0.38], 0.04, 10);
  get(B, 'dark').box(hx, floor + 0.55, 0.15, hx + 0.08, floor + 0.7, 0.32);

  const lx = f.legs;
  const foot = ground + 0.36;
  for (const z of [-0.55, 0.55]) {
    A.box(lx - 0.075, foot + 0.32, z - 0.075, lx + 0.075, floor - 0.02, z + 0.075);
    A.box(lx - 0.06, foot + 0.05, z - 0.06, lx + 0.06, foot + 0.4, z + 0.06);
    S.box(lx - 0.16, foot, z - 0.14, lx + 0.16, foot + 0.05, z + 0.14);
    A.tube([lx, floor - 0.25, z], [lx - 0.6, floor - 0.02, z], 0.03, 8);
  }
  A.tube([lx, foot + 0.6, -0.55], [lx, foot + 0.6, 0.55], 0.025, 8);
  A.box(lx - 0.09, foot + 0.75, 0.47, lx + 0.09, foot + 0.95, 0.66);
  S.tube([lx, foot + 0.85, 0.66], [lx, foot + 0.85, 0.95], 0.016, 6);
  S.tube([lx, foot + 0.85, 0.95], [lx, foot + 0.55, 0.95], 0.016, 6);
  get(B, 'dark').tube([lx - 0.04, foot + 0.55, 0.95], [lx + 0.12, foot + 0.55, 0.95], 0.022, 8);

  const wheelY = ground + 0.5;
  const front = Math.max(...f.axles) + 0.75, back = Math.min(...f.axles) - 0.75;
  for (const z of [-0.5, 0.5]) S.box(back, floor - 0.42, z - 0.05, front, floor - 0.25, z + 0.05);
  for (const x of f.axles) {
    S.tube([x, wheelY, -0.86], [x, wheelY, 0.86], 0.065, 14);
    for (const z of [-0.5, 0.5]) {
      S.box(x - 0.55, wheelY - 0.08, z - 0.06, x + 0.25, wheelY + 0.02, z + 0.06);
      get(B, 'dark').cylinder(x - 0.42, wheelY + 0.02, z, 0.13, 0.13, floor - 0.42 - wheelY - 0.02, 14);
      S.tube([x + 0.18, wheelY, z], [x + 0.3, floor - 0.3, z], 0.03, 8);
      get(B, 'dark').tube([x, wheelY + 0.12, z * 1.25], [x + 0.18, wheelY + 0.12, z * 1.25], 0.09, 12);
    }
  }
  const flapX = Math.min(...f.axles) - 0.62;
  for (const s of [-1, 1]) {
    R.box(flapX - 0.01, ground + 0.22, s * 0.92 - 0.3, flapX + 0.01, ground + 0.92, s * 0.92 + 0.3);
    S.box(flapX - 0.04, ground + 0.9, s * 0.92 - 0.3, flapX + 0.04, ground + 0.96, s * 0.92 + 0.3);
    S.tube([flapX, ground + 0.95, s * 0.62], [flapX + 0.4, floor - 0.42, s * 0.5], 0.025, 8);
  }

  const rear = -hx + 0.25;
  S.box(rear - 0.1, ground + 0.48, -1.1, rear + 0.02, ground + 0.6, 1.1);
  for (const z of [-0.5, 0.5]) S.box(rear - 0.06, ground + 0.58, z - 0.05, rear + 0.04, floor, z + 0.05);
  get(B, 'tape').box(rear - 0.105, ground + 0.5, -1.08, rear - 0.1, ground + 0.58, 1.08);
  const T = get(B, 'tail');
  for (const s of [-1, 1]) for (const k of [0, 1, 2]) T.tube([-hx - 0.005, floor - 0.12, s * (1.12 - k * 0.14)], [-hx - 0.03, floor - 0.12, s * (1.12 - k * 0.14)], 0.05, 14);
  for (const s of [-1, 1]) for (const k of [0, 1, 2]) get(B, 'red').tube([-hx - 0.005, floor - 0.12, s * (0.12 - k * 0.12)], [-hx - 0.02, floor - 0.12, s * (0.12 - k * 0.12)], 0.025, 10);
}

/** Red and white reflective tape along both sides at `y`, red on the stripes' even slots. */
function tape(B: Builders, f: Frame, y: number, from: number, to: number) {
  for (const s of [-1, 1]) for (let x = from, k = 0; x < to - 0.1; x += 0.3, k++) {
    const target = k % 2 ? get(B, 'tape') : get(B, 'red');
    target.box(x, y - 0.025, s * (f.width / 2 + 0.003) - 0.002, Math.min(to, x + 0.3), y + 0.025, s * (f.width / 2 + 0.003) + 0.002);
  }
}

function markers(B: Builders, f: Frame, y: number) {
  const A = get(B, 'amber');
  for (const s of [-1, 1]) {
    A.box(f.hx - 0.3, y - 0.03, s * (f.width / 2) - 0.02, f.hx - 0.2, y + 0.03, s * (f.width / 2) + 0.02);
    A.box(-0.05, y - 0.03, s * (f.width / 2) - 0.02, 0.05, y + 0.03, s * (f.width / 2) + 0.02);
    get(B, 'tail').box(-f.hx + 0.2, y - 0.03, s * (f.width / 2) - 0.02, -f.hx + 0.3, y + 0.03, s * (f.width / 2) + 0.02);
  }
}

function dryVan(B: Builders) {
  const f = frameOf('dryvan', 1.22);
  runningGear(B, f, { crossmembers: true, railDepth: 0.32 });
  const P = get(B, 'paint'), A = get(B, 'aluminum'), D = get(B, 'dark'), C = get(B, 'chrome');
  const { hx, floor } = f;
  const top = floor + 2.84;
  const w = f.width / 2;
  A.box(-hx, floor - 0.02, -w, hx, floor + 0.24, w);
  for (const s of [-1, 1]) {
    P.box(-hx + 0.12, floor + 0.24, s * w - 0.012, hx - 0.06, top - 0.14, s * w + 0.012);
    for (let x = -hx + 0.42; x < hx - 0.2; x += 0.61) A.box(x - 0.035, floor + 0.24, s * (w + 0.012) - 0.008, x + 0.035, top - 0.14, s * (w + 0.012) + 0.008);
    for (const y of [floor + 0.95, floor + 1.75]) A.box(-hx + 0.12, y - 0.015, s * (w + 0.014) - 0.004, hx - 0.06, y + 0.015, s * (w + 0.014) + 0.004);
  }
  A.box(-hx, top - 0.14, -w - 0.02, hx, top, w + 0.02);
  P.box(-hx + 0.05, top - 0.02, -w + 0.02, hx - 0.05, top + 0.01, w - 0.02);
  for (let x = -hx + 0.6; x < hx; x += 1.2) A.box(x - 0.01, top + 0.01, -w + 0.05, x + 0.01, top + 0.02, w - 0.05);
  P.box(hx - 0.06, floor + 0.24, -w + 0.02, hx, top - 0.14, w - 0.02);
  for (const s of [-1, 1]) A.box(hx - 0.1, floor - 0.02, s * w - 0.1 * s - 0.06, hx + 0.01, top, s * w + 0.01 * s);
  for (const y of [floor + 0.8, floor + 1.6, floor + 2.4]) A.box(hx - 0.005, y - 0.03, -w + 0.1, hx + 0.012, y + 0.03, w - 0.1);
  const r = -hx;
  A.box(r - 0.02, floor - 0.02, -w - 0.02, r + 0.16, floor + 0.12, w + 0.02);
  A.box(r - 0.02, top - 0.24, -w - 0.02, r + 0.16, top, w + 0.02);
  for (const s of [-1, 1]) A.box(r - 0.02, floor, s * w - 0.14 * s, r + 0.16, top, s * w + 0.02 * s);
  const doorW = w - 0.14;
  for (const s of [-1, 1]) {
    P.box(r - 0.03, floor + 0.12, s > 0 ? 0.004 : -doorW, r, top - 0.24, s > 0 ? doorW : -0.004);
    for (const zr of [0.22, 0.62]) {
      const z = s * zr;
      C.tube([r - 0.06, floor + 0.14, z], [r - 0.06, top - 0.26, z], 0.016, 8);
      for (const y of [floor + 0.18, top - 0.3]) D.box(r - 0.08, y - 0.04, z - 0.04, r - 0.02, y + 0.04, z + 0.04);
      D.box(r - 0.11, floor + 1.15, z - 0.012, r - 0.05, floor + 1.25, z + 0.11 * s);
    }
    for (const y of [floor + 0.35, floor + 1.05, floor + 1.75, floor + 2.45]) D.box(r - 0.05, y - 0.05, s * doorW - 0.18 * s, r, y + 0.05, s * doorW + 0.05 * s);
  }
  tape(B, f, floor + 0.12, -hx + 0.2, hx - 0.2);
  for (const s of [-1, 1]) get(B, 'tape').box(r - 0.035, top - 0.2, s * w - 0.3 * s, r - 0.03, top - 0.17, s * w);
  markers(B, f, top - 0.08);
  const skirtY0 = f.ground + 0.42;
  for (const s of [-1, 1]) {
    D.box(f.legs - 0.5, skirtY0, s * (w - 0.1) - 0.006, Math.max(...f.axles) + 0.85, floor - 0.04, s * (w - 0.1) + 0.006);
    for (let x = f.legs - 0.3; x < Math.max(...f.axles) + 0.7; x += 1.4) get(B, 'steel').tube([x, floor - 0.06, s * (w - 0.12)], [x, skirtY0 + 0.1, s * (w - 0.12)], 0.012, 6);
  }
}

function flatbed(B: Builders) {
  const f = frameOf('flatbed', 1.52 - 0.08);
  runningGear(B, f, { crossmembers: true, railDepth: 0.5 });
  const W = get(B, 'wood'), S = get(B, 'steel'), A = get(B, 'aluminum');
  const { hx, floor } = f;
  const deck = floor + 0.08;
  const w = f.width / 2;
  for (let z = -w + 0.12, k = 0; z < w - 0.11; z += 0.152, k++) W.box(-hx + 0.08, floor, z, hx - 0.04, deck - (k % 3) * 0.002, z + 0.142);
  for (const s of [-1, 1]) {
    A.box(-hx, floor - 0.15, s * w - (s > 0 ? 0.12 : 0), hx, deck + 0.02, s * w + (s > 0 ? 0 : 0.12));
    A.box(-hx, floor - 0.04, s * (w + 0.01) - 0.015, hx, floor + 0.0, s * (w + 0.01) + 0.015);
    for (let x = -hx + 0.35; x < hx - 0.2; x += 0.61) S.box(x - 0.05, floor - 0.12, s * (w + 0.02) - 0.03, x + 0.05, deck + 0.01, s * (w + 0.02) + 0.03);
  }
  for (let x = -hx + 1.0; x < hx - 1.5; x += 1.22) {
    S.cylinder(x, floor - 0.16, w - 0.12, 0.07, 0.07, 0.04, 10);
    S.tube([x, floor - 0.11, w - 0.2], [x, floor - 0.11, w - 0.02], 0.06, 12);
  }
  A.box(hx - 0.05, floor, -w, hx + 0.03, deck + 0.18, w);
  tape(B, f, floor - 0.08, -hx + 0.2, hx - 0.2);
  markers(B, f, floor - 0.06);
}

function logger(B: Builders) {
  const f = frameOf('logger', 1.4 - 0.25);
  runningGear(B, f, { crossmembers: false, railDepth: 0.38 });
  const S = get(B, 'steel'), P = get(B, 'paint');
  const { hx, floor } = f;
  S.box(-hx + 0.2, floor - 0.3, -0.18, hx - 0.1, floor + 0.25, 0.18);
  const bunks = [hx - 1.9, hx - 4.6, -0.6, -hx + 3.0, -hx + 0.9];
  for (const x of bunks) {
    P.box(x - 0.11, floor + 0.25, -1.27, x + 0.11, floor + 0.42, 1.27);
    for (const s of [-1, 1]) {
      P.box(x - 0.08, floor + 0.42, s * 1.18 - 0.07, x + 0.08, floor + 2.25, s * 1.18 + 0.07);
      P.box(x - 0.1, floor + 2.22, s * 1.18 - 0.09, x + 0.1, floor + 2.28, s * 1.18 + 0.09);
    }
    S.box(x - 0.09, floor + 0.25, -0.2, x + 0.09, floor + 0.3, 0.2);
  }
  P.box(hx - 0.25, floor + 0.25, -1.1, hx - 0.05, floor + 1.6, 1.1);
  for (let y = floor + 0.4; y < floor + 1.6; y += 0.2) S.box(hx - 0.27, y, -1.08, hx - 0.23, y + 0.06, 1.08);
  tape(B, f, floor - 0.1, -hx + 0.3, hx - 0.3);
  markers(B, f, floor + 0.32);
}

function tanker(B: Builders) {
  const f = frameOf('tanker', 1.35);
  runningGear(B, f, { crossmembers: false, railDepth: 0.25 });
  const C = get(B, 'chrome'), A = get(B, 'aluminum'), D = get(B, 'dark'), S = get(B, 'steel');
  const { hx, floor } = f;
  const cy = floor + 1.08;
  const hw = 1.22, hh = 1.06;
  const body = (b: MeshBuilder, x0: number, x1: number, r: number) => {
    b.transform(Matrix.Scaling(1, 1, hw / hh).multiply(Matrix.RotationZ(-Math.PI / 2)).multiply(Matrix.Translation(0, cy, 0)));
    b.lathe([[r * 0.0001, x0 - 0.42], [r * 0.55, x0 - 0.36], [r * 0.88, x0 - 0.2], [r, x0], [r, x1], [r * 0.88, x1 + 0.2], [r * 0.55, x1 + 0.36], [r * 0.0001, x1 + 0.42]], 40, true);
    b.transform(null);
  };
  body(C, -hx + 0.7, hx - 0.85, hh);
  for (let x = -hx + 1.3; x < hx - 1.0; x += 1.55) {
    C.transform(Matrix.Scaling(1, 1, hw / hh).multiply(Matrix.RotationZ(-Math.PI / 2)).multiply(Matrix.Translation(0, cy, 0)));
    C.lathe([[hh, x - 0.04], [hh + 0.025, x - 0.03], [hh + 0.025, x + 0.03], [hh, x + 0.04]], 40, false);
    C.transform(null);
  }
  const roof = cy + hh;
  A.box(-hx + 1.2, roof - 0.02, -0.38, hx - 1.4, roof + 0.03, 0.38);
  for (let x = -hx + 1.3; x < hx - 1.4; x += 0.12) A.box(x, roof + 0.03, -0.36, x + 0.03, roof + 0.045, 0.36);
  for (const s of [-1, 1]) {
    for (let x = -hx + 1.3; x < hx - 1.3; x += 1.1) A.tube([x, roof + 0.03, s * 0.42], [x, roof + 0.5, s * 0.42], 0.018, 6);
    A.tube([-hx + 1.3, roof + 0.5, s * 0.42], [hx - 1.4, roof + 0.5, s * 0.42], 0.02, 6);
    A.tube([-hx + 1.3, roof + 0.3, s * 0.42], [hx - 1.4, roof + 0.3, s * 0.42], 0.015, 6);
  }
  for (let k = 0; k < 4; k++) {
    const x = -hx + 2.0 + k * ((2 * hx - 3.6) / 3);
    C.cylinder(x, roof + 0.03, 0, 0.32, 0.3, 0.16, 20);
    C.cylinder(x, roof + 0.19, 0, 0.3, 0.2, 0.06, 20);
    D.cylinder(x + 0.2, roof + 0.19, 0.15, 0.04, 0.04, 0.08, 8);
  }
  const lx = -hx + 0.55;
  for (const s of [-0.22, 0.22]) A.box(lx - 0.02, f.ground + 0.6, s - 0.02, lx + 0.02, roof + 0.5, s + 0.02);
  for (let y = f.ground + 0.7; y < roof + 0.4; y += 0.3) A.tube([lx, y, -0.22], [lx, y, 0.22], 0.016, 6);
  for (const x of [-1.2, 1.4, hx - 3.2]) {
    S.box(x - 0.35, cy - hh - 0.45, -0.35, x + 0.35, cy - hh * 0.96, 0.35);
    C.tube([x, cy - hh - 0.42, -0.35], [x, cy - hh - 0.42, -1.05], 0.05, 12);
    D.cylinder(x, cy - hh - 0.53, -1.05, 0.08, 0.08, 0.18, 12);
  }
  C.tube([-hx + 1.8, cy - hh - 0.42, -0.35], [hx - 3.0, cy - hh - 0.42, -0.35], 0.06, 12);
  for (const s of [-1, 1]) {
    A.tube([-hx + 1.4, floor - 0.05, s * 1.05], [Math.min(...f.axles) - 0.7, floor - 0.05, s * 1.05], 0.075, 12);
    A.tube([Math.max(...f.axles) + 0.8, floor - 0.05, s * 1.05], [f.legs - 0.4, floor - 0.05, s * 1.05], 0.075, 12);
  }
  get(B, 'tape').box(hx - 0.52, cy - 0.25, -0.27, hx - 0.5, cy + 0.27, 0.27);
  get(B, 'red').box(hx - 0.525, cy - 0.17, -0.17, hx - 0.52, cy + 0.17, 0.17);
  tape(B, f, floor - 0.04, -hx + 1.4, hx - 1.6);
  markers(B, f, floor - 0.02);
}

const BUILDERS: Record<SemiTrailerKind, (B: Builders) => void> = { dryvan: dryVan, flatbed, logger, tanker };

const meshCache = new Map<SemiTrailerKind, Map<TrailerPart, Mesh>>();

/** Template meshes for one trailer kind (built once, disabled; trailers draw clones). */
export function trailerMeshes(kind: SemiTrailerKind): Map<TrailerPart, Mesh> {
  let parts = meshCache.get(kind);
  if (parts) return parts;
  const B: Builders = {};
  BUILDERS[kind](B);
  parts = new Map();
  for (const [k, b] of Object.entries(B) as [TrailerPart, MeshBuilder][]) {
    if (b.empty) continue;
    const mesh = b.toMesh(`trl-${kind}-${k}`);
    mesh.setEnabled(false);
    parts.set(k, mesh);
  }
  meshCache.set(kind, parts);
  return parts;
}

// ---------------------------------------------------------------- loads

const cargoCache = new Map<string, Map<TrailerPart, Mesh>>();

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function lumber(B: Builders, f: Frame, deck: number) {
  const W = get(B, 'wood'), M = get(B, 'wrap'), T = get(B, 'strap');
  const L = 4.9;
  for (let row = 0, x = f.hx - 0.4; row < 3; row++, x -= L + 0.1) {
    for (let k = 0; k < 2; k++) {
      const z0 = k ? 0.06 : -1.22;
      for (let tier = 0; tier < 2; tier++) {
        const y = deck + 0.1 + tier * 0.82;
        M.box(x - L, y, z0, x, y + 0.75, z0 + 1.16);
        for (let zz = z0 + 0.02; zz < z0 + 1.14; zz += 0.05) for (let yy = y + 0.02; yy < y + 0.74; yy += 0.1) W.box(x + 0.0, yy, zz, x + 0.012, yy + 0.085, zz + 0.04);
        W.box(x - L - 0.012, y + 0.02, z0 + 0.02, x - L, y + 0.73, z0 + 1.14);
        get(B, 'steel').box(x - L + 0.3, y - 0.1, z0, x - L + 0.4, y, z0 + 1.16);
        get(B, 'steel').box(x - 0.4, y - 0.1, z0, x - 0.3, y, z0 + 1.16);
      }
    }
    for (const sx of [x - 0.8, x - L / 2, x - L + 0.8]) {
      T.box(sx - 0.025, deck + 1.72, -1.28, sx + 0.025, deck + 1.74, 1.28);
      for (const s of [-1, 1]) T.box(sx - 0.025, deck - 0.1, s * 1.3 - 0.004, sx + 0.025, deck + 1.74, s * 1.3 + 0.004);
    }
  }
}

function steelBeams(B: Builders, f: Frame, deck: number) {
  const S = get(B, 'steel'), D = get(B, 'dark'), T = get(B, 'strap');
  const L = 12.2;
  const x1 = f.hx - 0.6, x0 = x1 - L;
  for (const x of [x0 + 1, x0 + L / 2, x1 - 1]) get(B, 'wood').box(x - 0.05, deck, -1.25, x + 0.05, deck + 0.1, 1.25);
  for (let tier = 0; tier < 3; tier++) for (let k = 0; k < 4 - tier % 2; k++) {
    const z = -0.95 + k * 0.62 + (tier % 2) * 0.31;
    const y = deck + 0.1 + tier * 0.32;
    const b = tier === 1 ? D : S;
    b.box(x0, y, z - 0.15, x1, y + 0.02, z + 0.15);
    b.box(x0, y + 0.02, z - 0.01, x1, y + 0.28, z + 0.01);
    b.box(x0, y + 0.28, z - 0.15, x1, y + 0.3, z + 0.15);
  }
  for (const sx of [x0 + 1.2, x0 + L / 3, x0 + (2 * L) / 3, x1 - 1.2]) {
    T.box(sx - 0.025, deck + 1.0, -1.28, sx + 0.025, deck + 1.02, 1.28);
    for (const s of [-1, 1]) T.box(sx - 0.025, deck - 0.1, s * 1.3 - 0.004, sx + 0.025, deck + 1.02, s * 1.3 + 0.004);
  }
}

function pallets(B: Builders, f: Frame, deck: number) {
  const W = get(B, 'wood'), M = get(B, 'wrap'), D = get(B, 'dark'), T = get(B, 'strap');
  const rnd = seeded(7);
  for (let x = f.hx - 0.4; x > -f.hx + 1.3; x -= 1.3) for (const z0 of [-1.22, 0.02]) {
    W.box(x - 1.2, deck, z0, x, deck + 0.14, z0 + 1.2);
    const h = 0.7 + rnd() * 0.7;
    const kind = rnd();
    if (kind < 0.4) M.box(x - 1.17, deck + 0.14, z0 + 0.03, x - 0.03, deck + 0.14 + h, z0 + 1.17);
    else if (kind < 0.7) for (let yy = deck + 0.14; yy < deck + 0.14 + h; yy += 0.24) D.box(x - 1.15, yy, z0 + 0.05, x - 0.05, yy + 0.22, z0 + 1.15);
    else for (let yy = deck + 0.14, k = 0; yy < deck + 0.14 + h; yy += 0.18, k++) get(B, 'aluminum').box(x - 1.15 + (k % 2) * 0.02, yy, z0 + 0.04, x - 0.05, yy + 0.16, z0 + 1.16);
  }
  for (let x = f.hx - 1.0; x > -f.hx + 1.3; x -= 2.6) {
    T.box(x - 0.025, deck + 1.58, -1.28, x + 0.025, deck + 1.6, 1.28);
    for (const s of [-1, 1]) T.box(x - 0.025, deck - 0.1, s * 1.3 - 0.004, x + 0.025, deck + 1.6, s * 1.3 + 0.004);
  }
}

function logs(B: Builders, f: Frame, deck: number) {
  const K = get(B, 'bark'), E = get(B, 'log'), S = get(B, 'steel');
  const rnd = seeded(11);
  const x1 = f.hx - 0.3, x0 = -f.hx - 0.4;
  const rows = [[-0.88, -0.44, 0, 0.44, 0.88], [-0.66, -0.22, 0.22, 0.66], [-0.44, 0, 0.44], [-0.22, 0.22]];
  rows.forEach((row, tier) => {
    for (const z of row) {
      const r = 0.2 + rnd() * 0.05;
      const y = deck + 0.22 + tier * 0.4;
      const a = x0 + rnd() * 0.4, b = x1 - rnd() * 0.4;
      K.tube([a, y, z], [b, y, z], r, 14, false);
      E.tube([a - 0.002, y, z], [a, y, z], r * 0.97, 14, true);
      E.tube([b, y, z], [b + 0.002, y, z], r * 0.97, 14, true);
    }
  });
  for (const x of [f.hx - 2.6, -0.1, -f.hx + 2.2]) {
    S.tube([x, deck + 1.75, -1.18], [x, deck + 1.75, 1.18], 0.015, 6);
    for (const s of [-1, 1]) S.tube([x, deck + 1.75, s * 1.18], [x, deck + 0.4, s * 1.2], 0.015, 6);
  }
}

/** The load meshes for a trailer kind and cargo (built once, disabled). */
export function trailerCargo(kind: SemiTrailerKind, cargo: CargoKind): Map<TrailerPart, Mesh> | null {
  if (kind === 'dryvan' || kind === 'tanker' || cargo === 'gravel') return null;
  const key = `${kind}:${cargo}`;
  let parts = cargoCache.get(key);
  if (parts) return parts;
  const f = frameOf(kind, kind === 'flatbed' ? 1.44 : 1.15);
  const deck = kind === 'flatbed' ? f.floor + 0.08 : f.floor + 0.42;
  const B: Builders = {};
  if (kind === 'logger' || cargo === 'logs') logs(B, f, deck);
  else if (cargo === 'steel') steelBeams(B, f, deck);
  else if (cargo === 'pallets') pallets(B, f, deck);
  else lumber(B, f, deck);
  parts = new Map();
  for (const [k, b] of Object.entries(B) as [TrailerPart, MeshBuilder][]) {
    if (b.empty) continue;
    const mesh = b.toMesh(`trl-cargo-${key}-${k}`);
    mesh.setEnabled(false);
    parts.set(k, mesh);
  }
  cargoCache.set(key, parts);
  return parts;
}
