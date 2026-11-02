/**
 * Real 3D grass: tens of thousands of instanced blade clumps in a disc around
 * the camera, swaying in the wind (TSL vertex animation). Positions come from
 * a world-anchored jittered grid, so blades never "swim" as you move. Clumps
 * on a lot take their color from the lawn's mow map, so freshly cut stripes
 * show up as short, light-and-dark blades; uncut lawns and open fields grow tall.
 * Roads, sidewalks, driveways, floors, pools and downtown stay clear.
 */
import * as THREE from 'three/webgpu';
import { cos, float, instanceIndex, positionLocal, sin, time, uv, vec3 } from 'three/tsl';
import { floorKey, objectCells, WorldState } from '../../shared/BuildRules';
import { CURB_CUTS, DEPOT, DOWNTOWN, drivewayRect, GAS_STATION, RectXZ, ROADS, SIDEWALKS, WORLD_HALF } from '../../shared/WorldLayout';
import type { Lawn } from './Lawn';

const RADIUS = 34;
const SPACING = 0.42;               // ~5.7 clumps per m²
const REBUILD_DIST = 3;
/** Yard items with a hard or planted surface: no blades poke through them. */
const COVERS = new Set(['court', 'hotTub', 'divingBoard', 'doghouse', 'flowerBed', 'patioSet', 'grill', 'trampoline']);

function hash(x: number, z: number) {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clumpGeometry() {
  // Three crossed, tapered, slightly bent blades. uv.y = 0 at the root, 1 at the tip.
  const pos: number[] = [], uvs: number[] = [], col: number[] = [];
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI + 0.3;
    const ca = Math.cos(a), sa = Math.sin(a);
    const lean = 0.08 + b * 0.03;
    const seg = [[0, 0.055], [0.45, 0.04], [0.8, 0.022], [1, 0]];
    for (let i = 0; i < seg.length - 1; i++) {
      const [y0, w0] = seg[i], [y1, w1] = seg[i + 1];
      const l0 = lean * y0 * y0, l1 = lean * y1 * y1;
      const p = (y: number, w: number, l: number, s: number) => [ca * w * s - sa * l, y, sa * w * s + ca * l];
      const A = p(y0, w0, l0, -1), B = p(y0, w0, l0, 1), C = p(y1, w1, l1, 1), D = p(y1, w1, l1, -1);
      pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      uvs.push(0, y0, 1, y0, 1, y1, 0, y0, 1, y1, 0, y1);
      for (const y of [y0, y0, y1, y0, y1, y1]) { const k = 0.45 + 0.55 * y; col.push(k * 0.85, k, k * 0.7); }
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
  private lawnRevs = '';
  private worldVersion = -1;
  private readonly blocked: RectXZ[];
  private readonly max: number;

  constructor(scene: THREE.Scene, private lawns: Map<string, Lawn>, private world: () => WorldState | null, quality = 1) {
    this.max = Math.round((Math.PI * RADIUS * RADIUS) / (SPACING * SPACING) * quality);
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    // Wind: bend grows with the square of height; each clump has its own phase.
    const phase = instanceIndex.toFloat().mul(0.618);
    const bend = uv().y.mul(uv().y);
    const sway = vec3(sin(time.mul(1.7).add(phase)).mul(0.07).add(sin(time.mul(0.6).add(phase.mul(0.13))).mul(0.05)), float(0), cos(time.mul(1.3).add(phase)).mul(0.04));
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
      ...ROADS, ...SIDEWALKS, ...CURB_CUTS,
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
        let height: number;
        const lawn = lawns.find(l => l.contains(x, z));
        if (lawn) {
          if (drive.some(d => inRect(d, x, z, 0.1))) continue;
          const b = world?.builds[lawn.lot.id];
          const fx = Math.floor(x), fz = Math.floor(z);
          if (covered.has(`${fx}|${fz}`)) continue;
          if (b && (b.floors[floorKey(0, fx, fz)] || Object.values(b.pools).some(pl => fx >= pl.x0 - 0.3 && fx < pl.x1 + 0.3 && fz >= pl.z0 - 0.3 && fz < pl.z1 + 0.3))) continue;
          const mowed = lawn.sample(x, z, rgb);
          height = mowed ? 0.07 + h1 * 0.03 : 0.2 + h2 * 0.14;
          col.setRGB(rgb[0] * 1.15, rgb[1] * 1.15, rgb[2] * 1.15);
        } else {
          height = 0.24 + h1 * 0.22;
          col.setHSL(0.22 + h2 * 0.06, 0.42 + h1 * 0.15, 0.3 + h2 * 0.1);
        }
        q.setFromAxisAngle(up, h1 * Math.PI * 2);
        const wScale = 0.8 + h2 * 0.5;
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
