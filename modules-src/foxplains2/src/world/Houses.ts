/**
 * Every house in town, meshed from the authoritative build data
 * (shared/BuildRules.ts): floors and foundations, walls with each side's
 * finish, doors and windows with trim and glass, fences, gable, hip and flat
 * roofs with overhangs, pools, and the furniture (the library's optimized
 * furniture models in public/models/maplestreet/furniture/, or the admin's
 * published .glb). Each lot is one entity with a mesh per material, rebuilt
 * when a build op touches it; its colliders are swapped with it.
 * Furniture only shows near you (it is all indoors).
 */
import * as pc from 'playcanvas';
import { MeshBuilder, meshEntity, hexRGB, type RGB } from '../core/Geo';
import type { Mats } from '../core/Tex';
import type { Assets } from '../core/Assets';
import { localBounds } from '../core/Assets';
import type { Physics, StaticBox } from '../physics/Physics';
import {
  applyOp, FOUNDATION_H, floorKey, LEVEL_HEIGHT, levelBase, sideFinish, stairwellCells, WALL_HEIGHT, wallKey, wallKindOf,
  type BuildOp, type LotBuild, type Opening, type Roof, type Wall, type WorldState,
} from '../../../maplestreet/shared/BuildRules';
import { CATALOG, footprint } from '../../../maplestreet/shared/Catalog';

const T = 0.16, H = T / 2;
type Paint = { m: pc.Material; c: RGB };
const WHITE_RGB: RGB = [1, 1, 1];
const FURNITURE_RADIUS = 28;

/** Door and window holes on a 1 m segment: along 0..1, height above the floor, and what fills them. */
const HOLES: Record<Exclude<Opening, 'none'>, { a0: number; a1: number; y0: number; y1: number; fill: 'door' | 'glass' | 'frosted' | 'garage' | 'open'; walk: boolean }> = {
  door: { a0: 0.08, a1: 0.92, y0: 0, y1: 2.15, fill: 'door', walk: true },
  glassdoor: { a0: 0.08, a1: 0.92, y0: 0, y1: 2.2, fill: 'glass', walk: true },
  french: { a0: 0.04, a1: 0.96, y0: 0, y1: 2.25, fill: 'glass', walk: true },
  slider: { a0: 0, a1: 1, y0: 0, y1: 2.2, fill: 'glass', walk: true },
  garage: { a0: 0, a1: 1, y0: 0, y1: 2.4, fill: 'garage', walk: false },
  window: { a0: 0.2, a1: 0.8, y0: 0.95, y1: 2.15, fill: 'glass', walk: false },
  picture: { a0: 0.04, a1: 0.96, y0: 0.6, y1: 2.35, fill: 'glass', walk: false },
  tall: { a0: 0.24, a1: 0.76, y0: 0.35, y1: 2.5, fill: 'glass', walk: false },
  clerestory: { a0: 0, a1: 1, y0: 2.15, y1: 2.75, fill: 'glass', walk: false },
  frosted: { a0: 0.3, a1: 0.7, y0: 1.5, y1: 2.1, fill: 'frosted', walk: false },
};

const ROOF_TONES = [0x3b3d42, 0x4a3d34, 0x2f3a46, 0x5a3a2e, 0x46494c, 0x3e4a3c];

function greedy(cells: Set<string>) {
  const pts = [...cells].map(s => s.split('|').map(Number) as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const used = new Set<string>(), out: { x0: number; z0: number; x1: number; z1: number }[] = [];
  const has = (x: number, z: number) => cells.has(`${x}|${z}`) && !used.has(`${x}|${z}`);
  for (const [x, z] of pts) {
    if (used.has(`${x}|${z}`)) continue;
    let x1 = x; while (has(x1 + 1, z)) x1++;
    let z1 = z;
    outer: while (true) { for (let i = x; i <= x1; i++) if (!has(i, z1 + 1)) break outer; z1++; }
    for (let j = z; j <= z1; j++) for (let i = x; i <= x1; i++) used.add(`${i}|${j}`);
    out.push({ x0: x, z0: z, x1: x1 + 1, z1: z1 + 1 });
  }
  return out;
}

export class Houses {
  readonly root = new pc.Entity('houses');
  world: WorldState | null = null;
  private lots = new Map<string, { shell: pc.Entity | null; furniture: pc.Entity | null; cx: number; cz: number }>();
  private pending = new Set<string>();
  private furnTimer = 0;

  constructor(private app: pc.AppBase, private physics: Physics, private mats: Mats, private assets: Assets) {
    app.root.addChild(this.root);
  }

  private get device() { return this.app.graphicsDevice; }

  setWorld(w: WorldState) {
    this.world = w;
    for (const id in w.lots) this.rebuild(id);
  }

  apply(op: BuildOp, actorKey: string, actorName: string) {
    if (!this.world) return;
    applyOp(this.world, op, actorKey, actorName);
    const id = (op as { lotId?: string }).lotId;
    if (id) this.pending.add(id);
  }

  // ------------------------------------------------------------ materials

  /** A wall finish: one vertex-colored material per texture, so a whole house is a handful of draw calls. */
  private finish(f: string): Paint {
    const M = this.mats, t = (kind: Parameters<Mats['textured']>[1]) => M.textured(`h-${kind}`, kind, { vcolor: true });
    const paint = () => M.plain('h-paint', { vcolor: true, gloss: 0.22 });
    const FIN: Record<string, [() => pc.Material, number]> = {
      siding_white: [() => t('siding'), 0xf1eee6], siding_sage: [() => t('siding'), 0x9db199], siding_navy: [() => t('siding'), 0x34465f],
      brick_red: [() => t('brick'), 0xb8573f], brick_white: [() => t('brick'), 0xeae5da], stucco_sand: [() => t('stucco'), 0xdac9a6],
      stone: [() => t('stone'), 0xd2c8b6], board_batten: [() => t('boards'), 0xebe7dd],
      paint_greige: [paint, 0xcfc6b8], paint_sage: [paint, 0xa9b8a0], paint_navy: [paint, 0x3a4a66], paint_blush: [paint, 0xe8c4bc], paint_charcoal: [paint, 0x4a4c50],
      wallpaper_stripe: [() => t('stripe'), 0xe9dcc8], wallpaper_damask: [() => t('damask'), 0xd8c8b0], tile_subway: [() => t('subway'), 0xf4f4f2], panel_wood: [() => t('woodPanel'), 0xa77a50],
    };
    const [mk, c] = FIN[f] ?? [paint, 0xf3f1ec];
    return { m: mk(), c: hexRGB(c) };
  }

  private floorMat(f: string): Paint {
    const M = this.mats, t = (kind: Parameters<Mats['textured']>[1], tile?: number) => M.textured(`hf-${kind}`, kind, { vcolor: true, ...(tile ? { tile } : {}) });
    const FL: Record<string, [() => pc.Material, number]> = {
      oak: [() => t('planks'), 0xc99b64], walnut: [() => t('planks'), 0x6e4a30], herringbone: [() => t('herringbone'), 0xbb8c5c], tile: [() => t('tile'), 0xe8e6e0],
      marble: [() => t('marble'), 0xf2f0ec], carpet: [() => t('carpet'), 0xb8b0a4], slate: [() => t('slate'), 0x7a7e84], deck: [() => t('deck'), 0x9a6e45], patio: [() => t('patio'), 0xcabca6],
    };
    const [mk, c] = FL[f] ?? [() => t('concrete', 3), 0xb2aea6];
    return { m: mk(), c: hexRGB(c) };
  }

  // ------------------------------------------------------------ meshing

  private rebuild(lotId: string) {
    const w = this.world;
    if (!w) return;
    const lot = w.lots[lotId], b = w.builds[lotId];
    const old = this.lots.get(lotId);
    old?.shell?.destroy();
    old?.furniture?.destroy();
    if (!lot || !b) { this.lots.delete(lotId); return; }
    const parts = new Map<pc.Material, MeshBuilder>();
    const get = (m: pc.Material) => { let mb = parts.get(m); if (!mb) parts.set(m, (mb = new MeshBuilder())); return mb; };
    const colliders: StaticBox[] = [];
    const collide = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, prop = false) => {
      colliders.push({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, hx: Math.abs(x1 - x0) / 2, hy: Math.abs(y1 - y0) / 2, hz: Math.abs(z1 - z0) / 2, prop });
    };
    this.floors(b, get, collide);
    for (const k in b.walls) this.wall(b, b.walls[k], get, collide);
    for (const id in b.roofs) this.roof(b, b.roofs[id], get);
    for (const id in b.pools) {
      const p = b.pools[id];
      get(this.mats.plain('pool-water', { color: 0x1f8fb3, gloss: 0.96, metal: 0.05, opacity: 0.82 })).flat(p.x0 + 0.3, p.z0 + 0.3, p.x1 - 0.3, p.z1 - 0.3, 0.06);
      const coping = get(this.mats.textured('f-patio', 'patio', { color: 0xcabca6 }));
      coping.box(p.x0, 0, p.z0, p.x1, 0.1, p.z0 + 0.3); coping.box(p.x0, 0, p.z1 - 0.3, p.x1, 0.1, p.z1);
      coping.box(p.x0, 0, p.z0 + 0.3, p.x0 + 0.3, 0.1, p.z1 - 0.3); coping.box(p.x1 - 0.3, 0, p.z0 + 0.3, p.x1, 0.1, p.z1 - 0.3);
    }
    let shell: pc.Entity | null = null;
    const list = [...parts].filter(([, mb]) => !mb.empty).map(([material, mb]) => ({ mesh: mb.toMesh(this.device, true), material }));
    if (list.length) { shell = meshEntity(`house-${lotId}`, list); this.root.addChild(shell); }
    const furniture = this.furniture(b, collide);
    this.physics.setLotColliders(lotId, colliders);
    this.lots.set(lotId, { shell, furniture, cx: lot.x + lot.w / 2, cz: lot.z + lot.d / 2 });
  }

  private floors(b: LotBuild, get: (m: pc.Material) => MeshBuilder, collide: (...a: [number, number, number, number, number, number]) => void) {
    const byMat = new Map<string, Set<string>>(), byLevel = new Map<number, Set<string>>(), wells = new Map<number, Set<string>>();
    for (const k in b.floors) {
      const f = b.floors[k];
      if (f.level > 0) {
        if (!wells.has(f.level)) wells.set(f.level, stairwellCells(b, f.level));
        if (wells.get(f.level)!.has(`${f.gx}|${f.gz}`)) continue;
      }
      const km = `${f.level}|${f.mat}`;
      if (!byMat.has(km)) byMat.set(km, new Set());
      byMat.get(km)!.add(`${f.gx}|${f.gz}`);
      if (!byLevel.has(f.level)) byLevel.set(f.level, new Set());
      byLevel.get(f.level)!.add(`${f.gx}|${f.gz}`);
    }
    for (const [km, cells] of byMat) {
      const [l, mat] = km.split('|'); const top = levelBase(Number(l));
      const fm = this.floorMat(mat), mb = get(fm.m);
      for (const r of greedy(cells)) mb.box(r.x0, top - 0.03, r.z0, r.x1, top + 0.005, r.z1, { skipBottom: true, color: fm.c });
    }
    const foundation = this.mats.textured('foundation', 'concrete', { color: 0x9c9890, tile: 1.5 });
    const ceiling = this.mats.plain('ceiling', { color: 0xf2f0eb, gloss: 0.15 });
    for (const [level, cells] of byLevel) {
      const top = levelBase(level) - 0.03;
      for (const r of greedy(cells)) {
        if (level === 0) {
          get(foundation).box(r.x0 - 0.04, 0, r.z0 - 0.04, r.x1 + 0.04, top, r.z1 + 0.04, { skipBottom: true, skipTop: true });
          collide(r.x0, 0, r.z0, r.x1, top + 0.03, r.z1);
        } else {
          get(ceiling).box(r.x0, top - 0.24, r.z0, r.x1, top, r.z1, { skipTop: true });
          collide(r.x0, top - 0.24, r.z0, r.x1, top + 0.03, r.z1);
        }
      }
    }
  }

  private wall(b: LotBuild, w: Wall, get: (m: pc.Material) => MeshBuilder, collide: (...a: [number, number, number, number, number, number]) => void) {
    const L = w.level, base = levelBase(L), kind = wallKindOf(w), Ht = WALL_HEIGHT[kind];
    let e0 = 0, e1 = 0;
    if (w.dir === 'x' && kind !== 'railing' && kind !== 'picket') {
      const perp = (gx: number, gz: number) => !!(b.walls[wallKey(L, 'z', gx, gz)] || b.walls[wallKey(L, 'z', gx, gz - 1)]);
      if (perp(w.gx, w.gz)) e0 = H;
      if (perp(w.gx + 1, w.gz)) e1 = H;
    }
    const toWorld = (a0: number, a1: number, y0: number, y1: number, c0: number, c1: number): [number, number, number, number, number, number] =>
      w.dir === 'x' ? [w.gx + a0, base + y0, w.gz + c0, w.gx + a1, base + y1, w.gz + c1] : [w.gx + c0, base + y0, w.gz + a0, w.gx + c1, base + y1, w.gz + a1];
    const matA = this.finish(sideFinish(b, w, 'A')), matB = this.finish(sideFinish(b, w, 'B'));
    const box = (m: pc.Material | Paint, a0: number, a1: number, y0: number, y1: number, c0: number, c1: number) => {
      if (a1 - a0 < 0.001 || y1 - y0 < 0.001) return;
      const [x0, Y0, z0, x1, Y1, z1] = toWorld(a0, a1, y0, y1, c0, c1);
      const p = m instanceof pc.Material ? { m, c: WHITE_RGB } : m;
      get(p.m).box(x0, Y0, z0, x1, Y1, z1, { color: p.c });
    };
    const solid = (a0: number, a1: number, y0: number, y1: number) => {
      box(matA, a0, a1, y0, y1, -H, 0);
      box(matB, a0, a1, y0, y1, 0, H);
    };
    const trimMat = this.mats.plain('trim', { color: 0xf5f3ee, gloss: 0.5 });

    if (kind === 'railing' || kind === 'picket' || kind === 'privacy') {
      const wood = kind === 'privacy' ? this.mats.textured('fence-boards', 'boards', { color: 0xc9b190 }) : kind === 'picket' ? trimMat : this.mats.plain('railing', { color: 0x2d3034, gloss: 0.5, metal: 0.6 });
      box(wood, 0, 0.09, 0, Ht + 0.05, -0.05, 0.05);
      if (kind === 'privacy') box(wood, 0, 1, 0.05, Ht, -0.03, 0.03);
      else {
        box(wood, 0, 1, Ht - 0.12, Ht - 0.04, -0.03, 0.03);
        box(wood, 0, 1, 0.25, 0.31, -0.03, 0.03);
        const step = kind === 'picket' ? 0.14 : 0.12;
        for (let a = 0.12; a < 0.99; a += step) box(wood, a, a + (kind === 'picket' ? 0.08 : 0.025), 0.08, kind === 'picket' ? Ht - (Math.abs(a - 0.5) < 0.2 ? 0 : 0.06) : Ht - 0.1, -0.015, 0.015);
      }
      collide(...toWorld(0, 1, 0, Ht, -0.06, 0.06));
      return;
    }
    if (L === 0) {
      const [x0, , z0, x1, , z1] = toWorld(-e0, 1 + e1, 0, 0, -H - 0.03, H + 0.03);
      get(this.mats.textured('foundation', 'concrete', { color: 0x9c9890, tile: 1.5 })).box(x0, 0, z0, x1, FOUNDATION_H, z1, { skipBottom: true });
    }
    if (kind === 'half') {
      solid(-e0, 1 + e1, 0, Ht);
      box(trimMat, -e0 - 0.02, 1 + e1 + 0.02, Ht, Ht + 0.05, -H - 0.03, H + 0.03);
      collide(...toWorld(-e0, 1 + e1, 0, Ht + 0.05, -H, H));
      return;
    }
    const hole = w.opening !== 'none' ? HOLES[w.opening] : null;
    if (!hole) {
      solid(-e0, 1 + e1, 0, Ht);
      collide(...toWorld(-e0, 1 + e1, 0, Ht, -H, H));
      return;
    }
    const { a0, a1, y0, y1 } = hole;
    solid(-e0, a0, 0, Ht);
    solid(a1, 1 + e1, 0, Ht);
    solid(a0, a1, 0, y0);
    solid(a0, a1, y1, Ht);
    // Colliders: solid around the hole; windows and the garage door stay closed.
    if (hole.walk) {
      collide(...toWorld(-e0, a0, 0, Ht, -H, H));
      collide(...toWorld(a1, 1 + e1, 0, Ht, -H, H));
      collide(...toWorld(a0, a1, y1, Ht, -H, H));
    } else collide(...toWorld(-e0, 1 + e1, 0, Ht, -H, H));
    // Trim around the hole (only where the opening isn't part of a run).
    const runPrev = b.walls[w.dir === 'x' ? wallKey(L, 'x', w.gx - 1, w.gz) : wallKey(L, 'z', w.gx, w.gz - 1)]?.opening === w.opening;
    const runNext = b.walls[w.dir === 'x' ? wallKey(L, 'x', w.gx + 1, w.gz) : wallKey(L, 'z', w.gx, w.gz + 1)]?.opening === w.opening;
    const d = H + 0.025, c = 0.06;
    box(trimMat, a0 - (runPrev && a0 === 0 ? 0 : c), a1 + (runNext && a1 === 1 ? 0 : c), y1, y1 + c, -d, d);
    if (y0 > 0) box(trimMat, a0 - c, a1 + c, y0 - c * 1.2, y0, -d - 0.04, d + 0.04);
    if (!(runPrev && a0 === 0)) box(trimMat, a0 - c, a0, y0, y1, -d, d);
    if (!(runNext && a1 === 1)) box(trimMat, a1, a1 + c, y0, y1, -d, d);
    // Fill.
    if (hole.fill === 'door') {
      box(this.mats.textured('door', 'planks', { color: 0x6b4a2e, tile: 1 }), a0, a1, y0, y1, -0.025, 0.025);
    } else if (hole.fill === 'garage') {
      box(this.mats.textured('garage', 'garage', { color: 0xf0eee8 }), a0, a1, y0, y1, -0.03, 0.03);
    } else {
      const glass = hole.fill === 'frosted' ? this.mats.glass('glass-frosted', 0xf0f4f6, 0.78) : this.mats.glass('glass-house', 0xa9c3d1, 0.38);
      box(glass, a0, a1, y0, y1, -0.012, 0.012);
      const frame = this.mats.plain('window-frame', { color: 0xf2f0ea, gloss: 0.45 });
      if (w.opening !== 'slider' && w.opening !== 'clerestory') box(frame, (a0 + a1) / 2 - 0.02, (a0 + a1) / 2 + 0.02, y0, y1, -0.03, 0.03);
      if (w.opening === 'window' || w.opening === 'tall') box(frame, a0, a1, (y0 + y1) / 2 - 0.02, (y0 + y1) / 2 + 0.02, -0.03, 0.03);
    }
  }

  private roof(b: LotBuild, r: Roof, get: (m: pc.Material) => MeshBuilder) {
    const O = 0.45;
    const x0 = r.x0 - O, x1 = r.x1 + O, z0 = r.z0 - O, z1 = r.z1 + O;
    const y = levelBase(r.level) + LEVEL_HEIGHT;
    const tone = ROOF_TONES[Math.abs([...r.id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % ROOF_TONES.length];
    const shingles = get(this.mats.textured('roof-shingles', 'shingles', { vcolor: true }));
    shingles.color = hexRGB(tone);
    const soffit = get(this.mats.plain('soffit', { color: 0xe9e6de, gloss: 0.2 }));
    soffit.color = WHITE_RGB;
    const style = Object.values(b.walls).find(w => w.level === r.level)?.style ?? 'siding_white';
    const gp = this.finish(style), gableMat = get(gp.m);
    gableMat.color = gp.c;
    const tan = Math.tan((Math.max(5, Math.min(60, r.pitchDeg)) * Math.PI) / 180);
    if (r.style === 'flat') {
      get(this.mats.textured('roof-flat', 'roofFlat')).box(x0 + O * 0.6, y, z0 + O * 0.6, x1 - O * 0.6, y + 0.25, z1 - O * 0.6);
      get(this.mats.plain('trim', { color: 0xf5f3ee, gloss: 0.5 })).box(x0 + O * 0.55, y + 0.25, z0 + O * 0.55, x1 - O * 0.55, y + 0.35, z0 + O * 0.75);
      return;
    }
    const uvOf = (p: number[], along: 'x' | 'z') => [along === 'x' ? p[0] : p[2], p[1] * 1.4 + (along === 'x' ? p[2] : p[0]) * 0.3];
    const slope = (pts: number[][], along: 'x' | 'z') => {
      const [a, bb, c, d] = pts;
      shingles.face(a, bb, c, d, [uvOf(a, along), uvOf(bb, along), uvOf(c, along), uvOf(d, along)]);
      const dn = (p: number[]) => [p[0], p[1] - 0.12, p[2]];
      soffit.face(dn(d), dn(c), dn(bb), dn(a), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    };
    const tri = (m: MeshBuilder, a: number[], bb: number[], c: number[]) => {
      const i = m.vertexCount;
      const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (const p of [a, bb, c]) m.vertex(p[0], p[1], p[2], nx, ny, nz, p[0] + p[2], p[1]);
      m.tri(i, i + 1, i + 2);
    };
    const ridgeX = r.style === 'gable_x' || (r.style === 'hip' && x1 - x0 >= z1 - z0);
    if (r.style === 'gable_x' || r.style === 'gable_z') {
      if (ridgeX) {
        const mz = (z0 + z1) / 2, rise = ((r.z1 - r.z0) / 2) * tan, ry = y + rise + O * tan * 0;
        slope([[x0, y - O * tan, z1], [x1, y - O * tan, z1], [x1, ry, mz], [x0, ry, mz]], 'x');
        slope([[x1, y - O * tan, z0], [x0, y - O * tan, z0], [x0, ry, mz], [x1, ry, mz]], 'x');
        tri(gableMat, [r.x0, y, r.z0], [r.x0, y, r.z1], [r.x0, ry - 0.02, mz]);
        tri(gableMat, [r.x1, y, r.z1], [r.x1, y, r.z0], [r.x1, ry - 0.02, mz]);
      } else {
        const mx = (x0 + x1) / 2, rise = ((r.x1 - r.x0) / 2) * tan, ry = y + rise;
        slope([[x1, y - O * tan, z1], [x1, y - O * tan, z0], [mx, ry, z0], [mx, ry, z1]], 'z');
        slope([[x0, y - O * tan, z0], [x0, y - O * tan, z1], [mx, ry, z1], [mx, ry, z0]], 'z');
        tri(gableMat, [r.x1, y, r.z0], [r.x0, y, r.z0], [mx, ry - 0.02, r.z0]);
        tri(gableMat, [r.x0, y, r.z1], [r.x1, y, r.z1], [mx, ry - 0.02, r.z1]);
      }
      return;
    }
    // Hip: four faces up to a ridge along the long side.
    const short = Math.min(r.x1 - r.x0, r.z1 - r.z0) / 2, rise = short * tan, ry = y + rise, e = y - O * tan;
    const inset = short + O;
    if (ridgeX) {
      const mz = (z0 + z1) / 2, rx0 = x0 + inset, rx1 = x1 - inset;
      slope([[x0, e, z1], [x1, e, z1], [rx1, ry, mz], [rx0, ry, mz]], 'x');
      slope([[x1, e, z0], [x0, e, z0], [rx0, ry, mz], [rx1, ry, mz]], 'x');
      tri(shingles, [x0, e, z0], [x0, e, z1], [rx0, ry, mz]);
      tri(shingles, [x1, e, z1], [x1, e, z0], [rx1, ry, mz]);
    } else {
      const mx = (x0 + x1) / 2, rz0 = z0 + inset, rz1 = z1 - inset;
      slope([[x1, e, z1], [x1, e, z0], [mx, ry, rz0], [mx, ry, rz1]], 'z');
      slope([[x0, e, z0], [x0, e, z1], [mx, ry, rz1], [mx, ry, rz0]], 'z');
      tri(shingles, [x1, e, z0], [x0, e, z0], [mx, ry, rz0]);
      tri(shingles, [x0, e, z1], [x1, e, z1], [mx, ry, rz1]);
    }
  }

  // ------------------------------------------------------------ furniture

  private furniture(b: LotBuild, collide: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, prop?: boolean) => void) {
    const group = new pc.Entity('furniture');
    let any = false;
    for (const id in b.objects) {
      const o = b.objects[id], item = CATALOG[o.catalogId];
      if (!item) continue;
      const { w, d } = footprint(item, o.rot);
      const cx = o.gx + w / 2, cz = o.gz + d / 2;
      const y = levelBase(o.level) - (o.level === 0 && !b.floors[floorKey(0, o.gx, o.gz)] ? FOUNDATION_H : 0);
      const holder = new pc.Entity(o.catalogId);
      holder.setLocalPosition(cx, y, cz);
      holder.setLocalEulerAngles(0, -o.rot * 90, 0);
      group.addChild(holder);
      any = true;
      const url = item.custom ? item.custom.url : `/models/maplestreet/furniture/${o.catalogId}.glb`;
      const custom = item.custom;
      void this.assets.instance(url).then(model => {
        if (!model || holder.parent === null) return;
        for (const r of model.findComponents('render') as pc.RenderComponent[]) { r.castShadows = false; }
        if (custom) {
          const turn = new pc.Entity('turn');
          turn.setLocalEulerAngles(0, custom.yaw * 90, 0);
          const scale = new pc.Entity('scale');
          scale.setLocalScale(custom.scale.x, custom.scale.y, custom.scale.z);
          const box = localBounds(model);
          if (box) model.setLocalPosition(-box.center.x, -(box.center.y - box.halfExtents.y), -box.center.z);
          scale.addChild(model); turn.addChild(scale); holder.addChild(turn);
        } else holder.addChild(model);
      });
      if (o.catalogId === 'stairs') {
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
    if (!any) { group.destroy(); return null; }
    group.enabled = false;
    this.root.addChild(group);
    return group;
  }

  /** Rebuilds lots that changed (batched once a frame) and shows furniture near the focus. */
  update(dt: number, focus: pc.Vec3) {
    for (const id of this.pending) this.rebuild(id);
    this.pending.clear();
    this.furnTimer -= dt;
    if (this.furnTimer > 0) return;
    this.furnTimer = 0.5;
    const r2 = FURNITURE_RADIUS * FURNITURE_RADIUS;
    for (const l of this.lots.values()) if (l.furniture) l.furniture.enabled = (l.cx - focus.x) ** 2 + (l.cz - focus.z) ** 2 < r2;
  }
}
