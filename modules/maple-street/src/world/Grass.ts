/**
 * Real 3D grass: tens of thousands of instanced tufts of thin, curved blades in a disc around
 * the camera, swaying in the wind (TSL vertex animation). Positions come from
 * a world-anchored jittered grid, so blades never "swim" as you move. Clumps
 * on a lot take their color from the lawn's mow map, so freshly cut stripes
 * show up as short, light-and-dark blades; uncut lawns and open fields grow tall.
 * Roads, sidewalks, driveways, floors, pools and downtown stay clear.
 */
import * as THREE from 'three/webgpu';
import { cos, float, instanceIndex, positionLocal, sin, time, uv, vec3 } from 'three/tsl';
import { floorKey, objectCells, WorldState } from '../../shared/BuildRules';
import { DEPOT, DOWNTOWN, drivewayRect, GAS_STATION, RectXZ, ROADS, SIDEWALKS, WORLD_HALF } from '../../shared/WorldLayout';
import type { Lawn } from './Lawn';

const RADIUS = 34;
const SPACING = 0.42;               // ~5.7 clumps per m²
const REBUILD_DIST = 3;
const BLADES = 6;
/** Beyond this distance clumps thin out (and widen): same coverage, fewer triangles. */
const NEAR = 16;
/** Yard items with a hard or planted surface: no blades poke through them. */
const COVERS = new Set(['court', 'hotTub', 'divingBoard', 'doghouse', 'flowerBed', 'patioSet', 'grill', 'trampoline']);

function hash(x: number, z: number) {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1) on a grid of `cell` metres: patches of greener, drier and taller grass. */
function patch(x: number, z: number, cell: number, seed: number) {
  const fx = x / cell, fz = z / cell, ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz, sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const h = (i: number, j: number) => hash(i * 31 + seed, j * 17 - seed);
  const top = h(ix, iz) + (h(ix + 1, iz) - h(ix, iz)) * sx;
  const bottom = h(ix, iz + 1) + (h(ix + 1, iz + 1) - h(ix, iz + 1)) * sx;
  return top + (bottom - top) * sz;
}

function clumpGeometry() {
  // A tuft of thin, tapered blades that curve outward from a shared root. Every
  // blade has its own facing, lean, height and tint (fixed seed, so all clumps
  // share one mesh). uv.y = 0 at the root, 1 at the tip.
  const pos: number[] = [], uvs: number[] = [], col: number[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const rows = [[0, 1], [0.38, 0.92], [0.72, 0.62]];
  for (let b = 0; b < BLADES; b++) {
    const face = rnd() * Math.PI * 2, leanDir = (b / BLADES) * Math.PI * 2 + rnd() * 0.8;
    const fc = Math.cos(face), fs = Math.sin(face), lc = Math.cos(leanDir), ls = Math.sin(leanDir);
    const root = rnd() * 0.035, rx = lc * root, rz = ls * root;
    const tall = 0.62 + rnd() * 0.38, wide = 0.009 + rnd() * 0.006, lean = 0.025 + rnd() * 0.05;
    // Tint per blade: most are green, a few are lighter, yellower or darker, like a real lawn.
    const tone = rnd(), dry = tone > 0.86 ? 0.22 : 0, dark = tone < 0.18 ? 0.16 : 0;
    const at = (y: number, w: number, side: number) => {
      const bend = lean * y * y, h = y * tall;
      return [rx + lc * bend + fc * w * side, h, rz + ls * bend + fs * w * side];
    };
    const shade = (y: number) => {
      const k = 0.32 + 0.68 * Math.min(1, y * 1.25) - dark;
      const tip = Math.max(0, y - 0.75) * 0.5;
      return [k * (0.78 + dry + tip), k * (1 - dry * 0.15), k * (0.62 - dry * 0.5)];
    };
    for (let i = 0; i < rows.length; i++) {
      const [y0, s0] = rows[i];
      const [y1, s1] = rows[i + 1] ?? [1, 0];
      const w0 = wide * s0, w1 = wide * s1;
      const A = at(y0, w0, -1), B = at(y0, w0, 1), C = at(y1, w1, 1), D = at(y1, w1, -1);
      if (i < rows.length - 1) {
        pos.push(...A, ...B, ...C, ...A, ...C, ...D);
        uvs.push(0, y0, 1, y0, 1, y1, 0, y0, 1, y1, 0, y1);
        for (const y of [y0, y0, y1, y0, y1, y1]) col.push(...shade(y));
      } else {
        pos.push(...A, ...B, ...C);
        uvs.push(0, y0, 1, y0, 0.5, 1);
        for (const y of [y0, y0, 1]) col.push(...shade(y));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Mostly-up normals light the field like a lawn; keeping part of each blade's
  // own normal lets blades catch the light differently, as real grass does.
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i) * 0.55, z = n.getZ(i) * 0.55, l = Math.hypot(x, 1, z);
    n.setXYZ(i, x / l, 1 / l, z / l);
  }
  return g;
}

const inRect = (r: RectXZ, x: number, z: number, pad = 0) => Math.abs(x - r.cx) < r.sx / 2 + pad && Math.abs(z - r.cz) < r.sz / 2 + pad;

export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private center = new THREE.Vector2(1e9, 1e9);
  private lawnRevs = '';
  private worldVersion = -1;
  private readonly blocked: RectXZ[];
  private readonly max: number;

  constructor(scene: THREE.Scene, private lawns: Map<string, Lawn>, private world: () => WorldState | null, quality = 1) {
    this.max = Math.round((Math.PI * RADIUS * RADIUS) / (SPACING * SPACING) * quality);
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.72, side: THREE.DoubleSide });
    // Wind: bend grows with the square of height; each clump has its own phase.
    const phase = instanceIndex.toFloat().mul(0.618);
    const bend = uv().y.mul(uv().y);
    const sway = vec3(sin(time.mul(1.7).add(phase)).mul(0.06).add(sin(time.mul(0.55).add(phase.mul(0.13))).mul(0.06)), float(0), cos(time.mul(1.3).add(phase)).mul(0.035));
    mat.positionNode = positionLocal.add(sway.mul(bend));
    this.mesh = new THREE.InstancedMesh(clumpGeometry(), mat, this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.mesh);
    const g = GAS_STATION;
    this.blocked = [
      ...ROADS, ...SIDEWALKS,
      { cx: (DOWNTOWN.x0 + DOWNTOWN.x1) / 2, cz: (DOWNTOWN.z0 + DOWNTOWN.z1) / 2, sx: DOWNTOWN.x1 - DOWNTOWN.x0 + 6, sz: DOWNTOWN.z1 - DOWNTOWN.z0 + 6 },
      { cx: g.canopy.x, cz: 28, sx: g.canopy.w + 14, sz: 36 },
      { cx: DEPOT.x, cz: DEPOT.z + 6, sx: DEPOT.w + 12, sz: DEPOT.d + 18 },
    ];
  }

  /** Re-lays the field when the camera moves or a lawn / house changes. */
  update(focus: THREE.Vector3) {
    const revs = [...this.lawns.values()].map(l => l.revision).join(',');
    const w = this.world();
    const moved = this.center.distanceTo(new THREE.Vector2(focus.x, focus.z)) > REBUILD_DIST;
    if (!moved && revs === this.lawnRevs && (w?.version ?? -1) === this.worldVersion) return;
    this.lawnRevs = revs;
    this.worldVersion = w?.version ?? -1;
    this.center.set(focus.x, focus.z);
    this.layout(w);
  }

  private layout(world: WorldState | null) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    const rgb: [number, number, number] = [0, 0, 0];
    const lawns = [...this.lawns.values()];
    const drive = lawns.map(l => drivewayRect(l.lot));
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
        const dist = Math.hypot(x - this.center.x, z - this.center.y);
        if (dist > NEAR && hash(gx - 11, gz + 5) > 0.55) continue;
        // Thin blades turn sub-pixel with distance and shimmer, so far tufts widen.
        const spread = (1 + Math.max(0, dist - 8) * 0.07) * (dist > NEAR ? 1.3 : 1);
        const lush = patch(x, z, 7, 3), dryness = patch(x, z, 13, 9);
        let height: number;
        const lawn = lawns.find(l => l.contains(x, z));
        if (lawn) {
          if (drive.some(d => inRect(d, x, z, 0.1))) continue;
          const b = world?.builds[lawn.lot.id];
          const fx = Math.floor(x), fz = Math.floor(z);
          if (covered.has(`${fx}|${fz}`)) continue;
          if (b && (b.floors[floorKey(0, fx, fz)] || Object.values(b.pools).some(pl => fx >= pl.x0 - 0.3 && fx < pl.x1 + 0.3 && fz >= pl.z0 - 0.3 && fz < pl.z1 + 0.3))) continue;
          const mowed = lawn.sample(x, z, rgb);
          height = mowed ? 0.07 + h1 * 0.03 : (0.2 + h2 * 0.14) * (0.85 + lush * 0.3);
          const k = 1.08 + (lush - 0.5) * 0.18;
          col.setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k);
        } else {
          height = (0.22 + h1 * 0.2) * (0.75 + lush * 0.5);
          if (h2 > 0.9 - dryness * 0.12) col.setHSL(0.12 + h1 * 0.04, 0.32 + h2 * 0.1, 0.36 + h1 * 0.06);
          else col.setHSL(0.235 + h2 * 0.04 + (lush - 0.5) * 0.03 - dryness * 0.035, 0.36 + h1 * 0.12, 0.23 + lush * 0.07 + h2 * 0.03);
        }
        q.setFromAxisAngle(up, h1 * Math.PI * 2);
        const wScale = (0.8 + h2 * 0.5) * spread;
        m.compose(p.set(x, 0.01, z), q, s.set(wScale, height, wScale));
        this.mesh.setMatrixAt(n, m);
        this.mesh.setColorAt(n, col);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
