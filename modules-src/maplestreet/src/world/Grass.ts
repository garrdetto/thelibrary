/**
 * Real 3D grass: tens of thousands of instanced clumps of thin blades in a
 * disc around the camera, stirring in the wind (TSL vertex animation).
 * Positions come from a world-anchored jittered grid, so blades never "swim"
 * as you move. On a lot every clump follows the lawn: freshly cut it stands
 * about 4 cm tall and leans the way the mower pushed it, then over five
 * in-game days it grows back to about 11 cm and straightens up. The lean is
 * real geometry, and the blades are shaded by how they lean relative to the
 * camera, so mowing stripes (and crossed diamond patterns) read in 3D and
 * fade as the grass grows. Open fields grow to knee-high meadow; the public
 * verges along Willow Bend are kept short. Roads, sidewalks, driveways,
 * floors, pools and downtown stay clear.
 */
import * as THREE from 'three/webgpu';
import { cameraPosition, cos, dot, float, instancedDynamicBufferAttribute, instanceIndex, length, max, normalize, normalViewGeometry, positionLocal, positionWorld, sin, time, uv, vec2, vec3, vec4 } from 'three/tsl';
import { floorKey, objectCells, WorldState } from '../../shared/BuildRules';
import { bladeHeight } from '../../shared/Mowing';
import { CIVIC_BLOCK, CURB_CUTS, curveDistance, DEPOT, DOWNTOWN, drivewayRect, GAS_STATION, GRID_BLOCKS, RectXZ, ROAD_W, ROADS, SIDEWALKS, TOWN_SQUARE, WORLD_HALF } from '../../shared/WorldLayout';
import type { LawnSample } from './Lawn';
import type { Lawn } from './Lawn';

const RADIUS = 30;
const SPACING = 0.32;               // ~10 clumps (40 blades) per m²
const REBUILD_DIST = 3;
/** Lawn changes (a cut, growth) re-lay the blades at most this often. */
const RELAY_MS = 250;
/** Yard items with a hard or planted surface: no blades poke through them. */
const COVERS = new Set(['court', 'hotTub', 'divingBoard', 'doghouse', 'flowerBed', 'patioSet', 'grill', 'trampoline']);

function hash(x: number, z: number) {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Slow, smooth value in 0..1 for lush and dry patches a few meters across. */
function patch(x: number, z: number) {
  return 0.5 + 0.22 * Math.sin(x * 0.31 + Math.cos(z * 0.23) * 1.7) + 0.16 * Math.sin(z * 0.47 - x * 0.19) + 0.12 * Math.sin((x - z) * 0.9);
}

function clumpGeometry() {
  // Four thin blades fanned around the root, each a tapered two-segment strip
  // with its own height, lean and tint. uv.y = 0 at the root, 1 at the tip.
  const pos: number[] = [], uvs: number[] = [], col: number[] = [];
  const blades = [
    { a: 0.3, h: 1.0, lean: 0.022, off: [0.01, 0.0], tint: [0.82, 1.0, 0.62] },
    { a: 1.25, h: 0.82, lean: -0.018, off: [-0.012, 0.008], tint: [0.9, 1.0, 0.58] },
    { a: 2.15, h: 0.92, lean: 0.026, off: [0.004, -0.013], tint: [0.78, 0.95, 0.6] },
    { a: 2.85, h: 0.7, lean: -0.012, off: [-0.006, -0.004], tint: [0.95, 1.0, 0.55] },
  ];
  for (const bl of blades) {
    const ca = Math.cos(bl.a), sa = Math.sin(bl.a);
    const seg = [[0, 0.011], [0.55, 0.008], [1, 0]];
    for (let i = 0; i < seg.length - 1; i++) {
      const [y0, w0] = seg[i], [y1, w1] = seg[i + 1];
      const l0 = bl.lean * y0 * y0, l1 = bl.lean * y1 * y1;
      const p = (y: number, w: number, l: number, s: number) => [bl.off[0] + ca * w * s - sa * l, y * bl.h, bl.off[1] + sa * w * s + ca * l];
      const A = p(y0, w0, l0, -1), B = p(y0, w0, l0, 1), C = p(y1, w1, l1, 1), D = p(y1, w1, l1, -1);
      pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      uvs.push(0, y0 * bl.h, 1, y0 * bl.h, 1, y1 * bl.h, 0, y0 * bl.h, 1, y1 * bl.h, 0, y1 * bl.h);
      // Darker, cooler roots (self-shadowing in the thatch) to lighter, warmer tips.
      for (const y of [y0, y0, y1, y0, y1, y1]) { const k = 0.38 + 0.62 * y; col.push(k * bl.tint[0], k * bl.tint[1], k * bl.tint[2] * (1.05 - 0.2 * y)); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Point normals up so blades light like a lawn surface, not like paper cards.
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  return g;
}

const inRect = (r: RectXZ, x: number, z: number, pad = 0) => Math.abs(x - r.cx) < r.sx / 2 + pad && Math.abs(z - r.cz) < r.sz / 2 + pad;

export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private center = new THREE.Vector2(1e9, 1e9);
  private lawnRevs = NaN;
  private worldVersion = -1;
  private readonly blocked: RectXZ[];
  private readonly max: number;
  /** Per clump: blade lean direction (x, z), stripe strength, lean distance at the tip (m). */
  private readonly mow: THREE.InstancedBufferAttribute;
  private lastLayout = 0;
  private nowDays = 0;

  constructor(scene: THREE.Scene, private lawns: Map<string, Lawn>, private world: () => WorldState | null, quality = 1) {
    this.max = Math.round((Math.PI * RADIUS * RADIUS) / (SPACING * SPACING) * quality);
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    this.mow = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 4), 4);
    this.mow.setUsage(THREE.DynamicDrawUsage);
    const mow = instancedDynamicBufferAttribute(this.mow, 'vec4') as unknown as ReturnType<typeof vec4>;
    // Wind: bend grows with the square of height; each clump has its own phase.
    // Mowed blades also lean the way the mower pushed them (less the taller they grow).
    const phase = instanceIndex.toFloat().mul(0.618);
    const bend = uv().y.mul(uv().y);
    const sway = vec3(sin(time.mul(1.9).add(phase)).mul(0.012).add(sin(time.mul(0.55).add(phase.mul(0.13))).mul(0.01)), float(0), cos(time.mul(1.4).add(phase)).mul(0.008));
    mat.positionNode = positionLocal.add(sway.mul(bend)).add(vec3(mow.x.mul(mow.w), mow.w.mul(mow.w).mul(-8), mow.y.mul(mow.w)).mul(bend));
    // Stripes: blades leaning away from the camera look light, toward it dark.
    const toCam = cameraPosition.sub(positionWorld);
    const flat = vec2(toCam.x, toCam.z);
    const side = length(flat).div(max(length(toCam), float(1e-3)));
    // Blades light like the turf they belong to from either side (no flipped, dark back faces).
    mat.normalNode = normalViewGeometry;
    mat.colorNode = vec3(float(1).sub(dot(vec2(mow.x, mow.y), normalize(flat)).mul(mow.z).mul(side).mul(0.42)));
    this.mesh = new THREE.InstancedMesh(clumpGeometry(), mat, this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.mesh);
    const g = GAS_STATION;
    this.blocked = [
      ...ROADS, ...SIDEWALKS, ...CURB_CUTS, ...[...lawns.values()].map(l => drivewayRect(l.lot)),
      { cx: (DOWNTOWN.x0 + DOWNTOWN.x1) / 2, cz: (DOWNTOWN.z0 + DOWNTOWN.z1) / 2, sx: DOWNTOWN.x1 - DOWNTOWN.x0 + 6, sz: DOWNTOWN.z1 - DOWNTOWN.z0 + 6 },
      { cx: g.canopy.x, cz: 28, sx: g.canopy.w + 14, sz: 36 },
      { cx: DEPOT.x, cz: DEPOT.z + 6, sx: DEPOT.w + 12, sz: DEPOT.d + 18 },
      CIVIC_BLOCK,
      ...GRID_BLOCKS.filter(b => b !== TOWN_SQUARE).map(b => ({ cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2, sx: b.x1 - b.x0 + 2, sz: b.z1 - b.z0 + 2 })),
    ];
  }

  /** Re-lays the field when the camera moves or a lawn / house changes. */
  update(focus: THREE.Vector3, nowDays: number) {
    this.nowDays = nowDays;
    // Runs every frame: a numeric signature of the nearby lawns' revisions, no arrays or strings.
    let revs = 0, i = 0;
    for (const l of this.lawns.values()) {
      i++;
      if (this.nearLawn(l, focus.x, focus.z, RADIUS + REBUILD_DIST + 2)) revs = (Math.imul(revs ^ i, 0x9e3779b1) + l.revision) | 0;
    }
    const w = this.world();
    const moved = Math.hypot(this.center.x - focus.x, this.center.y - focus.z) > REBUILD_DIST;
    const changed = revs !== this.lawnRevs || (w?.version ?? -1) !== this.worldVersion;
    if (!moved && !changed) return;
    const t = performance.now();
    if (!moved && t - this.lastLayout < RELAY_MS) return;
    this.lastLayout = t;
    this.lawnRevs = revs;
    this.worldVersion = w?.version ?? -1;
    this.center.set(focus.x, focus.z);
    this.layout(w);
  }

  private nearLawn(l: Lawn, x: number, z: number, r: number) {
    const L = l.lot;
    const dx = Math.max(L.x - x, 0, x - (L.x + L.w)), dz = Math.max(L.z - z, 0, z - (L.z + L.d));
    return dx * dx + dz * dz < r * r;
  }

  private layout(world: WorldState | null) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    const sample: LawnSample = { growth: 1, dx: 0, dz: 0, strength: 0 };
    const mow = this.mow.array as Float32Array;
    const lawns = [...this.lawns.values()].filter(l => this.nearLawn(l, this.center.x, this.center.y, RADIUS + 1));
    const covered = new Set<string>();
    if (world) for (const id in world.builds) {
      const objs = world.builds[id].objects;
      for (const oid in objs) if (objs[oid].level === 0 && COVERS.has(objs[oid].catalogId)) for (const [cx, cz] of objectCells(objs[oid]).cells) covered.add(`${cx}|${cz}`);
    }
    const cx = Math.round(this.center.x / SPACING), cz = Math.round(this.center.y / SPACING);
    const r = Math.ceil(RADIUS / SPACING);
    let n = 0;
    for (let i = -r; i <= r && n < this.max; i++) {
      for (let j = -r; j <= r && n < this.max; j++) {
        if (i * i + j * j > r * r) continue;
        const gx = cx + i, gz = cz + j;
        const h1 = hash(gx, gz), h2 = hash(gz + 7, gx - 3);
        const x = (gx + h1 - 0.5) * SPACING, z = (gz + h2 - 0.5) * SPACING;
        if (Math.abs(x) > WORLD_HALF - 2 || Math.abs(z) > WORLD_HALF - 2) continue;
        if (this.blocked.some(b => inRect(b, x, z, 0.15))) continue;
        const toCurve = curveDistance(x, z);
        if (toCurve < ROAD_W / 2 + 0.25) continue;
        let height: number;
        let mdx = 0, mdz = 0, mstr = 0, mlean = 0;
        const lawn = lawns.find(l => l.contains(x, z));
        if (lawn) {
          const b = world?.builds[lawn.lot.id];
          const fx = Math.floor(x), fz = Math.floor(z);
          if (covered.has(`${fx}|${fz}`)) continue;
          if (b && (b.floors[floorKey(0, fx, fz)] || Object.values(b.pools).some(pl => fx >= pl.x0 - 0.3 && fx < pl.x1 + 0.3 && fz >= pl.z0 - 0.3 && fz < pl.z1 + 0.3))) continue;
          const m = lawn.sample(x, z, sample, this.nowDays);
          const k = 0.92 + patch(x, z) * 0.18 + (h1 - 0.5) * 0.08;
          // Fresh-cut turf is a little lighter and even; grown-out turf is deeper green and shaggier.
          height = bladeHeight(m.growth) * (0.82 + h1 * 0.36) * (1 - 0.18 * m.strength);
          const cut = 1 - m.growth;
          col.setRGB((0.12 + 0.04 * cut) * k, (0.27 + 0.05 * cut) * k, (0.05 + 0.012 * cut) * k);
          mdx = m.dx; mdz = m.dz; mstr = m.strength; mlean = height * 0.6 * m.strength;
        } else if (toCurve < ROAD_W / 2 + 18) {
          // Public verge along the curved streets: the town keeps it short.
          height = 0.06 + h1 * 0.03;
          const pn = patch(x, z);
          col.setHSL(0.24 + pn * 0.03, 0.4 + pn * 0.1, 0.3 + h1 * 0.04);
        } else {
          const pn = patch(x * 0.6, z * 0.6);
          height = 0.12 + pn * 0.14 + h1 * 0.06;
          // Lush hollows read deeper green, dry rises drift toward straw.
          col.setHSL(0.205 + pn * 0.075 + (h2 - 0.5) * 0.015, 0.34 + pn * 0.16, 0.25 + (1 - pn) * 0.07 + h1 * 0.04);
        }
        q.setFromAxisAngle(up, h1 * Math.PI * 2);
        const wScale = 0.85 + h2 * 0.35;
        m.compose(p.set(x, 0.01, z), q, s.set(wScale, height, wScale));
        this.mesh.setMatrixAt(n, m);
        this.mesh.setColorAt(n, col);
        mow[n * 4] = mdx; mow[n * 4 + 1] = mdz; mow[n * 4 + 2] = mstr; mow[n * 4 + 3] = mlean;
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mow.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
