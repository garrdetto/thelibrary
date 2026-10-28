/**
 * StructureMesher — turns a lot's build data into renderable geometry and
 * physics colliders.
 *
 * Walls: every 1 m edge is emitted as two half-thickness skins so each face can
 *   carry its own finish (siding/brick outside, painted drywall inside). Which
 *   side is "inside" is inferred from which adjacent cells have a floor.
 *   Corner joints are closed by extending X-running walls by half a thickness
 *   wherever a perpendicular wall meets them. Doors/windows split the edge
 *   into solid pieces + casing trim + glazing.
 * Floors: greedy-merged rectangles (finish layer + foundation or ceiling slab).
 * Roofs: gable (ridge along X or Z) with overhang, soffit and gable-end infill; or flat.
 *
 * All static geometry is merged per (level, material) → a handful of draw
 * calls per house regardless of size. Colliders are emitted at full height
 * even when the visual is cut away (Sims-style "walls down" in build mode).
 */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CATALOG, footprint } from '../../shared/Catalog';
import { FOUNDATION_H, LEVEL_HEIGHT, levelBase, LotBuild, LotState, Pool, Roof, sideFinish, stairwellCells, Wall, WALL_HEIGHT, wallKey, wallKindOf, floorKey } from '../../shared/BuildRules';
import { MaterialLibrary, worldBoxUV } from '../core/Materials';
import type { StaticBox } from '../physics/Physics';
import { buildFurniture } from './Furniture';

export const WALL_T = 0.16;
const DOOR = { o0: 0.06, o1: 0.94, head: 2.1 };
const WINDOW = { o0: 0.12, o1: 0.88, sill: 0.9, head: 2.15 };
const PICTURE = { o0: 0.0, o1: 1.0, sill: 0.45, head: 2.45 };
const CASING = 0.06;

export interface MeshOptions {
  /** Level whose walls are cut down to `cutHeight`; levels above it are hidden. null = full house. */
  cutLevel: number | null;
  cutHeight: number;
  showRoofs: boolean;
}

/** Minimal triangle soup builder for non-box geometry (roofs). */
class Soup {
  pos: number[] = []; uv: number[] = [];
  tri(a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[]) {
    this.pos.push(...a, ...b, ...c); this.uv.push(...ua, ...ub, ...uc);
  }
  /** Triangle whose winding is fixed so its normal points up (roof faces). */
  triUp(a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vz = c[2] - a[2], vy = c[1] - a[1];
    const ny = uz * vx - ux * vz;
    void uy; void vy;
    if (ny >= 0) this.tri(a, b, c, ua, ub, uc); else this.tri(a, c, b, ua, uc, ub);
  }
  quad(a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[]) {
    this.tri(a, b, c, ua, ub, uc); this.tri(a, c, d, ua, uc, ud);
  }
  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

interface Bucket { geos: THREE.BufferGeometry[]; customUV: boolean }

export class StructureMesher {
  constructor(private mats: MaterialLibrary) {}

  build(lot: LotState, b: LotBuild, opt: MeshOptions): { group: THREE.Group; colliders: StaticBox[] } {
    const buckets = new Map<string, Bucket>();
    const colliders: StaticBox[] = [];
    const group = new THREE.Group();
    group.name = `lot:${lot.id}`;
    const hidden = (level: number) => opt.cutLevel !== null && level > opt.cutLevel;

    const push = (level: number, mat: string, geo: THREE.BufferGeometry, customUV = false) => {
      const key = `${level}|${mat}`;
      let bk = buckets.get(key);
      if (!bk) buckets.set(key, (bk = { geos: [], customUV }));
      bk.geos.push(geo.index ? geo.toNonIndexed() : geo);
    };
    const addBox = (level: number, mat: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
      if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      push(level, mat, g);
    };
    const collide = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, prop = false) => {
      colliders.push({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, hz: (z1 - z0) / 2, prop });
    };

    this.emitFloors(b, hidden, addBox, collide);
    for (const k in b.walls) this.emitWall(b, b.walls[k], opt, hidden, addBox, collide, group);
    for (const k in b.pools) this.emitPool(b.pools[k], addBox, collide, group);
    if (opt.showRoofs) for (const k in b.roofs) if (!hidden(b.roofs[k].level)) this.emitRoof(b, b.roofs[k], push, addBox);

    // Merge each bucket into one mesh.
    for (const [key, bk] of buckets) {
      const [lvl, matName] = key.split('|');
      const merged = mergeGeometries(bk.geos, false);
      bk.geos.forEach(g => g.dispose());
      if (!merged) continue;
      const entry = this.mats.get(matName);
      if (!bk.customUV) worldBoxUV(merged, entry.tile);
      const mesh = new THREE.Mesh(merged, entry.material);
      mesh.castShadow = matName !== 'glass';
      mesh.receiveShadow = true;
      mesh.userData.level = Number(lvl);
      group.add(mesh);
    }

    // Furniture & fixtures, merged per material: a furnished house is a few
    // dozen draw calls instead of hundreds.
    const furniture = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
    for (const id in b.objects) {
      const o = b.objects[id];
      const item = CATALOG[o.catalogId];
      if (!item) continue;
      const { w, d } = footprint(item, o.rot);
      const cx = o.gx + w / 2, cz = o.gz + d / 2, y = levelBase(o.level) - (o.level === 0 && !b.floors[floorKey(0, o.gx, o.gz)] ? FOUNDATION_H : 0);
      if (!hidden(o.level)) {
        const m = buildFurniture(o.catalogId, o.tint ?? 0);
        m.position.set(cx, y, cz);
        m.rotation.y = -o.rot * (Math.PI / 2);
        m.updateMatrixWorld(true);
        m.traverse(node => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mat = mesh.material as THREE.Material;
          let fb = furniture.get(mat.uuid);
          if (!fb) furniture.set(mat.uuid, (fb = { mat, geos: [] }));
          const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
          fb.geos.push(g.index ? g.toNonIndexed() : g);
          mesh.geometry.dispose();
        });
      }
      if (o.catalogId === 'stairs') {
        // 12 treads, 0.25 m rise each, climbing toward the item's back (local -Z).
        const steps = 12, run = 4 / steps, rise = LEVEL_HEIGHT / steps;
        const ang = -o.rot * (Math.PI / 2), ca = Math.cos(ang), sa = Math.sin(ang);
        const tf = (lx: number, lz: number) => [cx + lx * ca + lz * sa, cz - lx * sa + lz * ca];
        for (let k = 0; k < steps; k++) {
          const z0 = 2 - (k + 1) * run, z1 = 2 - k * run;
          const [ax, az] = tf(-0.48, z0), [bx, bz] = tf(0.48, z1);
          collide(Math.min(ax, bx), y, Math.min(az, bz), Math.max(ax, bx), y + (k + 1) * rise, Math.max(az, bz), true);
        }
      } else if (item.solid && item.h > 0) collide(cx - w * 0.45, y, cz - d * 0.45, cx + w * 0.45, y + item.h, cz + d * 0.45, true);
    }
    for (const { mat, geos } of furniture.values()) {
      const merged = mergeGeometries(geos, false);
      geos.forEach(g => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    }
    return { group, colliders };
  }

  // ---------------------------------------------------------------- floors

  private emitFloors(
    b: LotBuild, hidden: (l: number) => boolean,
    addBox: (l: number, m: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void,
    collide: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void,
  ) {
    const byLevelMat = new Map<string, Set<string>>();
    const byLevel = new Map<number, Set<string>>();
    const wells = new Map<number, Set<string>>();
    for (const k in b.floors) {
      const f = b.floors[k];
      if (f.level > 0) {
        if (!wells.has(f.level)) wells.set(f.level, stairwellCells(b, f.level));
        if (wells.get(f.level)!.has(`${f.gx}|${f.gz}`)) continue;            // open stairwell
      }
      const km = `${f.level}|${f.mat}`;
      if (!byLevelMat.has(km)) byLevelMat.set(km, new Set());
      byLevelMat.get(km)!.add(`${f.gx}|${f.gz}`);
      if (!byLevel.has(f.level)) byLevel.set(f.level, new Set());
      byLevel.get(f.level)!.add(`${f.gx}|${f.gz}`);
    }
    for (const [km, cells] of byLevelMat) {
      const [l, mat] = km.split('|'); const level = Number(l);
      if (hidden(level)) continue;
      const top = levelBase(level);
      for (const r of greedyRects(cells)) addBox(level, mat, r.x0, top - 0.03, r.z0, r.x1, top + 0.005, r.z1);
    }
    for (const [level, cells] of byLevel) {
      const top = levelBase(level) - 0.03;
      for (const r of greedyRects(cells)) {
        if (level === 0) {
          if (!hidden(0)) addBox(0, 'foundation', r.x0 - 0.04, 0, r.z0 - 0.04, r.x1 + 0.04, top, r.z1 + 0.04);
          collide(r.x0, 0, r.z0, r.x1, top + 0.03, r.z1);
        } else {
          if (!hidden(level)) addBox(level, 'interior', r.x0, top - 0.24, r.z0, r.x1, top, r.z1);   // ceiling of the level below
          collide(r.x0, top - 0.24, r.z0, r.x1, top + 0.03, r.z1);
        }
      }
    }
  }

  // ---------------------------------------------------------------- walls

  private emitWall(
    b: LotBuild, w: Wall, opt: MeshOptions, hidden: (l: number) => boolean,
    addBox: (l: number, m: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void,
    collide: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void,
    group: THREE.Group,
  ) {
    const L = w.level, base = levelBase(L), kind = wallKindOf(w), H = WALL_HEIGHT[kind];
    const T = WALL_T, h = T / 2;
    const isHidden = hidden(L);
    const cut = opt.cutLevel === L ? opt.cutHeight : Infinity;

    // Joint extension (X-running walls cover the corner block).
    let e0 = 0, e1 = 0;
    if (w.dir === 'x' && kind !== 'railing' && kind !== 'picket') {
      const perp = (gx: number, gz: number) => !!(b.walls[wallKey(L, 'z', gx, gz)] || b.walls[wallKey(L, 'z', gx, gz - 1)]);
      if (perp(w.gx, w.gz)) e0 = h;
      if (perp(w.gx + 1, w.gz)) e1 = h;
    }

    // Side finishes.
    const matA: string = sideFinish(b, w, 'A'), matB: string = sideFinish(b, w, 'B');

    // Map (along a, height y, across c) → world AABB.
    const toWorld = (a0: number, a1: number, y0: number, y1: number, c0: number, c1: number): [number, number, number, number, number, number] =>
      w.dir === 'x'
        ? [w.gx + a0, base + y0, w.gz + c0, w.gx + a1, base + y1, w.gz + c1]
        : [w.gx + c0, base + y0, w.gz + a0, w.gx + c1, base + y1, w.gz + a1];

    const visual = (mat: string, a0: number, a1: number, y0: number, y1: number, c0: number, c1: number) => {
      if (isHidden || y0 >= cut) return;
      const [x0, Y0, z0, x1, Y1, z1] = toWorld(a0, a1, y0, Math.min(y1, cut), c0, c1);
      addBox(L, mat, x0, Y0, z0, x1, Y1, z1);
    };
    const solid = (a0: number, a1: number, y0: number, y1: number) => {
      visual(matA, a0, a1, y0, y1, -h, 0);
      visual(matB, a0, a1, y0, y1, 0, h);
      const [x0, Y0, z0, x1, Y1, z1] = toWorld(a0, a1, y0, y1, -h, h);
      collide(x0, Y0, z0, x1, Y1, z1);
    };
    const trim = (a0: number, a1: number, y0: number, y1: number, depth = h + 0.02) => visual('trim', a0, a1, y0, y1, -depth, depth);

    if (kind !== 'full' && kind !== 'half') {
      this.emitFence(kind, base, isHidden, cut, toWorld, addBox, collide, L);
      return;
    }
    // Level-0 walls get a footing so they never float above the lawn.
    if (L === 0 && !isHidden) {
      const [x0, , z0, x1, , z1] = toWorld(-e0, 1 + e1, 0, 0, -h - 0.03, h + 0.03);
      addBox(0, 'foundation', x0, 0, z0, x1, FOUNDATION_H, z1);
    }

    if (kind === 'half') {
      solid(-e0, 1 + e1, 0, H);
      trim(-e0 - 0.02, 1 + e1 + 0.02, H, H + 0.05, h + 0.03);             // cap rail
      return;
    }
    switch (w.opening) {
      case 'none':
        solid(-e0, 1 + e1, 0, H);
        break;
      case 'door': {
        const { o0, o1, head } = DOOR;
        solid(-e0, o0, 0, H); solid(o1, 1 + e1, 0, H); solid(o0, o1, head, H);
        trim(o0 - CASING, o0, 0, head + CASING); trim(o1, o1 + CASING, 0, head + CASING); trim(o0, o1, head, head + CASING);
        if (!isHidden && head < cut) group.add(this.doorLeaf(w, base, o0, o1, head, L));
        break;
      }
      case 'window':
      case 'picture': {
        const { o0, o1, sill, head } = w.opening === 'window' ? WINDOW : PICTURE;
        solid(-e0, o0, 0, H); solid(o1, 1 + e1, 0, H);
        solid(o0, o1, 0, sill); solid(o0, o1, head, H);
        visual('glass', o0, o1, sill, head, -0.008, 0.008);
        const [gx0, gy0, gz0, gx1, gy1, gz1] = toWorld(o0, o1, sill, head, -0.03, 0.03);
        collide(gx0, gy0, gz0, gx1, gy1, gz1);                                   // can't walk through glass
        const c = w.opening === 'picture' ? 0.04 : CASING;
        trim(o0, o0 + c, sill, head, 0.03); trim(o1 - c, o1, sill, head, 0.03);   // frame
        trim(o0, o1, head - c, head, 0.03); trim(o0, o1, sill, sill + c, 0.03);
        trim(o0 - 0.04, o1 + 0.04, sill - 0.04, sill, h + 0.05);                  // sill nose
        if (w.opening === 'window') {
          trim((o0 + o1) / 2 - 0.015, (o0 + o1) / 2 + 0.015, sill, head, 0.025);  // mullion
          trim(o0, o1, (sill + head) / 2 - 0.015, (sill + head) / 2 + 0.015, 0.025);
        }
        break;
      }
    }
  }

  /** Picket fences, privacy fences and railings: posts + rails + pickets/boards. */
  private emitFence(
    kind: 'railing' | 'picket' | 'privacy', base: number, isHidden: boolean, cut: number,
    toWorld: (a0: number, a1: number, y0: number, y1: number, c0: number, c1: number) => [number, number, number, number, number, number],
    addBox: (l: number, m: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void,
    collide: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void, L: number,
  ) {
    const H = WALL_HEIGHT[kind];
    const mat = kind === 'privacy' ? 'fence_wood' : kind === 'railing' ? 'metal_dark' : 'trim';
    const put = (a0: number, a1: number, y0: number, y1: number, c0: number, c1: number, m = mat) => {
      if (isHidden || y0 >= cut) return;
      const [x0, Y0, z0, x1, Y1, z1] = toWorld(a0, a1, y0, Math.min(y1, cut), c0, c1);
      addBox(L, m, x0, Y0 - base + base, z0, x1, Y1, z1);
    };
    const yb = L === 0 ? -base : 0;                                    // fences stand on the lawn, not the foundation
    put(-0.05, 0.05, yb, H + 0.06, -0.05, 0.05);                       // posts at both ends
    put(0.95, 1.05, yb, H + 0.06, -0.05, 0.05);
    if (kind === 'privacy') {
      for (let a = 0.05; a < 0.95; a += 0.15) put(a, a + 0.14, yb + 0.05, H, -0.012, 0.012);
      put(0, 1, H - 0.08, H - 0.02, -0.035, 0.035, 'fence_wood');
    } else if (kind === 'picket') {
      put(0, 1, yb + 0.25, yb + 0.33, -0.03, 0.0);
      put(0, 1, yb + 0.78, yb + 0.86, -0.03, 0.0);
      for (let a = 0.08; a < 0.95; a += 0.13) { put(a, a + 0.08, yb + 0.05, H - 0.04, 0.0, 0.022); put(a + 0.02, a + 0.06, H - 0.04, H + 0.02, 0.0, 0.022); }
    } else {
      put(0, 1, H - 0.05, H, -0.03, 0.03);                             // handrail
      put(0, 1, 0.08, 0.12, -0.015, 0.015);
      for (let a = 0.1; a < 0.95; a += 0.12) put(a, a + 0.025, 0.12, H - 0.05, -0.0125, 0.0125);
    }
    const [x0, y0, z0, x1, y1, z1] = toWorld(0, 1, yb, H, -0.06, 0.06);
    collide(x0, y0, z0, x1, y1, z1);
  }

  /** In-ground pool look: tiled water with coping stones, ladder and a low safety collider. */
  private emitPool(
    p: Pool,
    addBox: (l: number, m: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void,
    collide: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void,
    group: THREE.Group,
  ) {
    const c = 0.35;
    addBox(0, 'coping', p.x0 - c, 0, p.z0 - c, p.x1 + c, 0.09, p.z0);
    addBox(0, 'coping', p.x0 - c, 0, p.z1, p.x1 + c, 0.09, p.z1 + c);
    addBox(0, 'coping', p.x0 - c, 0, p.z0, p.x0, 0.09, p.z1);
    addBox(0, 'coping', p.x1, 0, p.z0, p.x1 + c, 0.09, p.z1);
    const water = this.mats.get('pool_water');
    const geo = new THREE.PlaneGeometry(p.x1 - p.x0, p.z1 - p.z0).rotateX(-Math.PI / 2);
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (p.x1 - p.x0) / water.tile, uv.getY(i) * (p.z1 - p.z0) / water.tile);
    const surf = new THREE.Mesh(geo, water.material);
    surf.position.set((p.x0 + p.x1) / 2, 0.055, (p.z0 + p.z1) / 2);
    surf.receiveShadow = true;
    surf.userData.level = 0;
    group.add(surf);
    const rail = this.mats.get('metal').material;
    for (const dz of [-0.3, 0.3]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 8, 16, Math.PI), rail);
      r.position.set(p.x0 + 0.05, 0.35, (p.z0 + p.z1) / 2 + dz); r.rotation.y = Math.PI / 2; r.castShadow = true;
      group.add(r);
    }
    collide(p.x0, 0, p.z0, p.x1, 0.7, p.z1);
  }

  /** Doors are their own mesh, shown swung open ~75° so the doorway reads as walkable. */
  private doorLeaf(w: Wall, base: number, o0: number, o1: number, head: number, level: number): THREE.Object3D {
    const width = o1 - o0;
    const pivot = new THREE.Group();
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(width - 0.01, head - 0.01, 0.045), this.mats.get('door').material);
    leaf.position.set(width / 2, head / 2, 0);
    leaf.castShadow = true;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), this.mats.get('metal').material);
    knob.position.set(width - 0.08, 1.0, 0.04);
    pivot.add(leaf, knob);
    if (w.dir === 'x') { pivot.position.set(w.gx + o0, base, w.gz); pivot.rotation.y = -1.3; }
    else { pivot.position.set(w.gx, base, w.gz + o0); pivot.rotation.y = -Math.PI / 2 + 1.3; }
    pivot.userData.level = level;
    return pivot;
  }

  // ---------------------------------------------------------------- roofs

  private emitRoof(
    b: LotBuild, r: Roof,
    push: (l: number, mat: string, g: THREE.BufferGeometry, customUV?: boolean) => void,
    addBox: (l: number, m: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void,
  ) {
    const base = levelBase(r.level) + LEVEL_HEIGHT;
    const O = 0.45;                                   // eave/rake overhang
    if (r.style === 'hip') { this.emitHipRoof(b, r, push, addBox); return; }
    if (r.style === 'flat') {
      addBox(r.level, 'flatroof', r.x0 - 0.2, base, r.z0 - 0.2, r.x1 + 0.2, base + 0.22, r.z1 + 0.2);
      addBox(r.level, 'trim', r.x0 - 0.22, base + 0.12, r.z0 - 0.22, r.x1 + 0.22, base + 0.26, r.z0 - 0.18);
      addBox(r.level, 'trim', r.x0 - 0.22, base + 0.12, r.z1 + 0.18, r.x1 + 0.22, base + 0.26, r.z1 + 0.22);
      return;
    }
    // Work in roof-local coords: u along the ridge, v across it.
    const alongX = r.style === 'gable_x';
    const u0 = alongX ? r.x0 : r.z0, u1 = alongX ? r.x1 : r.z1;
    const v0 = alongX ? r.z0 : r.x0, v1 = alongX ? r.z1 : r.x1;
    const tan = Math.tan((r.pitchDeg * Math.PI) / 180);
    const half = (v1 - v0) / 2, vc = (v0 + v1) / 2;
    const lift = (WALL_T / 2) * tan + 0.06;
    const yEave = base + lift - O * tan, yRidge = base + lift + half * tan;
    const P = (u: number, y: number, v: number) => (alongX ? [u, y, v] : [v, y, u]);
    const slopeLen = Math.hypot(half + O, yRidge - yEave);
    const tile = this.mats.get('shingle').tile;

    const top = new Soup(), under = new Soup(), gable = new Soup();
    const ua = (u0 - O) / tile, ub = (u1 + O) / tile, vs = slopeLen / tile;
    for (const side of [-1, 1]) {
      const vE = side < 0 ? v0 - O : v1 + O;
      const a = P(u0 - O, yEave, vE), bq = P(u1 + O, yEave, vE), c = P(u1 + O, yRidge, vc), d = P(u0 - O, yRidge, vc);
      // Winding chosen so normals face up/out for both slopes and both orientations.
      const flip = (side < 0) !== alongX;
      if (flip) top.quad(a, bq, c, d, [ua, 0], [ub, 0], [ub, vs], [ua, vs]);
      else top.quad(a, d, c, bq, [ua, 0], [ua, vs], [ub, vs], [ub, 0]);
      const dn = (p: number[]) => [p[0], p[1] - 0.1, p[2]];
      if (flip) under.quad(dn(a), dn(d), dn(c), dn(bq), [0, 0], [0, 1], [1, 1], [1, 0]);
      else under.quad(dn(a), dn(bq), dn(c), dn(d), [0, 0], [1, 0], [1, 1], [0, 1]);
    }
    // Gable-end infill triangles (double-sided by emitting both windings).
    const t2 = WALL_T / 2;
    for (const u of [u0 - t2, u1 + t2]) {
      const A = P(u, base, v0 - t2), B = P(u, base, v1 + t2), C = P(u, yRidge - 0.05, vc);
      gable.tri(A, B, C, [0, 0], [1, 0], [0.5, 1]);
      gable.tri(A, C, B, [0, 0], [0.5, 1], [1, 0]);
    }
    const style = Object.values(b.walls).find(w => w.level === r.level)?.style ?? 'siding_white';
    const g1 = top.build(), g2 = under.build(), g3 = gable.build();
    if (g1) push(r.level, 'shingle', g1, true);
    if (g2) push(r.level, 'soffit', g2, true);
    if (g3) push(r.level, style, g3, false);

    // Fascia boards along both eaves + ridge cap.
    for (const v of [v0 - O, v1 + O]) {
      const [x0, , z0] = P(u0 - O, 0, v - 0.03), [x1, , z1] = P(u1 + O, 0, v + 0.03);
      addBox(r.level, 'trim', Math.min(x0, x1), yEave - 0.16, Math.min(z0, z1), Math.max(x0, x1), yEave + 0.02, Math.max(z0, z1));
    }
    const [rx0, , rz0] = P(u0 - O, 0, vc - 0.09), [rx1, , rz1] = P(u1 + O, 0, vc + 0.09);
    addBox(r.level, 'flatroof', Math.min(rx0, rx1), yRidge - 0.02, Math.min(rz0, rz1), Math.max(rx0, rx1), yRidge + 0.06, Math.max(rz0, rz1));
  }

  /** Hip roof: four slopes meeting at a ridge (or a point on square plans), eaves all round. */
  private emitHipRoof(
    b: LotBuild, r: Roof,
    push: (l: number, mat: string, g: THREE.BufferGeometry, customUV?: boolean) => void,
    addBox: (l: number, m: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void,
  ) {
    void b;
    const base = levelBase(r.level) + LEVEL_HEIGHT;
    const O = 0.45, tan = Math.tan((Math.max(15, r.pitchDeg) * Math.PI) / 180);
    const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
    const u0 = alongX ? r.x0 : r.z0, u1 = alongX ? r.x1 : r.z1, v0 = alongX ? r.z0 : r.x0, v1 = alongX ? r.z1 : r.x1;
    const half = (v1 - v0) / 2, vc = (v0 + v1) / 2;
    const lift = (WALL_T / 2) * tan + 0.06;
    const yE = base + lift - O * tan, yR = base + lift + half * tan;
    const P = (u: number, y: number, v: number) => (alongX ? [u, y, v] : [v, y, u]);
    const ra = Math.min(u0 + half, (u0 + u1) / 2), rb = Math.max(u1 - half, (u0 + u1) / 2);
    const E00 = P(u0 - O, yE, v0 - O), E10 = P(u1 + O, yE, v0 - O), E11 = P(u1 + O, yE, v1 + O), E01 = P(u0 - O, yE, v1 + O);
    const R0 = P(ra, yR, vc), R1 = P(rb, yR, vc);
    const tile = this.mats.get('shingle').tile;
    const top = new Soup(), under = new Soup();
    // UVs: u along the eave, v up the slope, so shingle courses run level on every face.
    const face = (pts: number[][], eaveDir: number[], slopeDir: number[]) => {
      const uvOf = (p: number[]) => [(p[0] * eaveDir[0] + p[2] * eaveDir[2]) / tile, (p[0] * slopeDir[0] + p[2] * slopeDir[2] + p[1] * 0.4) / tile];
      const dn = (p: number[]) => [p[0], p[1] - 0.1, p[2]];
      for (let i = 1; i < pts.length - 1; i++) {
        top.triUp(pts[0], pts[i], pts[i + 1], uvOf(pts[0]), uvOf(pts[i]), uvOf(pts[i + 1]));
        under.tri(dn(pts[0]), dn(pts[i + 1]), dn(pts[i]), [0, 0], [1, 0], [0, 1]);
      }
    };
    const ax = alongX ? [1, 0, 0] : [0, 0, 1], ay = alongX ? [0, 0, 1] : [1, 0, 0];
    face([E00, E10, R1, R0], ax, ay);
    face([E11, E01, R0, R1], ax, ay.map(c => -c));
    face([E01, E00, R0], ay, ax);
    face([E10, E11, R1], ay, ax.map(c => -c));
    const g1 = top.build(), g2 = under.build();
    if (g1) push(r.level, 'shingle', g1, true);
    if (g2) push(r.level, 'soffit', g2, true);
    // Fascia boards all the way round
    const [fx0, , fz0] = P(u0 - O, 0, v0 - O), [fx1, , fz1] = P(u1 + O, 0, v1 + O);
    const x0 = Math.min(fx0, fx1), x1 = Math.max(fx0, fx1), z0 = Math.min(fz0, fz1), z1 = Math.max(fz0, fz1);
    addBox(r.level, 'trim', x0, yE - 0.16, z0 - 0.03, x1, yE + 0.02, z0 + 0.03);
    addBox(r.level, 'trim', x0, yE - 0.16, z1 - 0.03, x1, yE + 0.02, z1 + 0.03);
    addBox(r.level, 'trim', x0 - 0.03, yE - 0.16, z0, x0 + 0.03, yE + 0.02, z1);
    addBox(r.level, 'trim', x1 - 0.03, yE - 0.16, z0, x1 + 0.03, yE + 0.02, z1);
  }
}

/** Greedy rectangle cover of a set of "x|z" cells (row runs merged downward). */
export function greedyRects(cells: Set<string>): { x0: number; z0: number; x1: number; z1: number }[] {
  const pts = [...cells].map(s => s.split('|').map(Number) as [number, number]);
  const used = new Set<string>();
  pts.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: { x0: number; z0: number; x1: number; z1: number }[] = [];
  for (const [x, z] of pts) {
    if (used.has(`${x}|${z}`)) continue;
    let x1 = x;
    while (cells.has(`${x1 + 1}|${z}`) && !used.has(`${x1 + 1}|${z}`)) x1++;
    let z1 = z;
    grow: for (;;) {
      for (let i = x; i <= x1; i++) if (!cells.has(`${i}|${z1 + 1}`) || used.has(`${i}|${z1 + 1}`)) break grow;
      z1++;
    }
    for (let i = x; i <= x1; i++) for (let j = z; j <= z1; j++) used.add(`${i}|${j}`);
    out.push({ x0: x, z0: z, x1: x1 + 1, z1: z1 + 1 });
  }
  return out;
}
