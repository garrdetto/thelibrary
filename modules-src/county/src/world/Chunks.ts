/**
 * Streams the 4 × 4 km county in 256 m chunks around a set of focus points
 * (the camera, the player and their vehicles):
 *
 * - far: every chunk's ground at 8 m, loaded once and kept;
 * - mid (within `MID_R`): the roads, distant house massings and coarse trees;
 * - near (within `NEAR_R`): 2 m ground, full houses, fine trees, lamps and
 *   mailboxes, and the colliders (a ground heightfield, the road surfaces,
 *   house boxes and tree trunks).
 *
 * Heights come from worker threads; meshes are built by small jobs run under
 * a per-frame time budget so streaming never stalls a frame. A low backdrop
 * reaches beyond the map edge to the horizon.
 */
import * as pc from 'playcanvas';
import { Batch } from '../core/Batch';
import type { Kit } from '../style/Kit';
import { baseHeight, WORLD } from '../../shared/Base';
import type { County } from '../../shared/County';
import { MASK, type Physics } from '../../../foxplains2/src/physics/Physics';
import { MeshBuilder, meshEntity } from '../../../foxplains2/src/core/Geo';
import { Heights } from './Heights';
import { buildTerrainBlock, buildTerrainChunk, groundColor, heightfieldData } from './TerrainMesh';
import { buildEdgePiece, buildJunction, type RoadBuilders } from './RoadMesh';
import { buildHouseMass, buildLotHouse, houseColliders } from './LotMesh';
import { countryTrees, fixtures, streetTrees, yardTrees, type Rect } from './Scatter';
import { TreeField, TreeKit, type TreePlace } from './TreeKit';
import { streetLamp, mailbox } from '../models/Street';
import { place } from '../core/Shapes';
import { PALETTE } from '../../config';

export const CHUNK = 256;
const N_CHUNKS = Math.ceil((WORLD.half * 2) / CHUNK) + 1;
const ORIGIN = -(N_CHUNKS * CHUNK) / 2;
const NEAR_R = 230, NEAR_DROP = 320, MID_R = 950, MID_DROP = 1080;
const NEAR_STEP = 2, FAR_STEP = 8, FAR_SINK = 0.45, PER = 4, N_BLOCKS = Math.ceil(N_CHUNKS / PER);

interface Piece { edge: number; s0: number; s1: number }
interface Chunk {
  i: number; j: number; rect: Rect; pieces: Piece[]; junctions: number[]; lots: number[];
  mid: { root: pc.Entity; roadSoup: { pos: Float32Array; idx: Uint32Array }; masses: pc.Entity | null } | null; midPending: boolean;
  near: { root: pc.Entity; ground: pc.Entity; colliders: unknown[] } | null; nearPending: boolean;
  staticsAdded: boolean;
  trees: { mid: TreePlace[]; near: TreePlace[] } | null;
}

type Job = { priority: number; run: () => void };

export class Chunks {
  readonly root = new pc.Entity('county');
  private chunks: Chunk[] = [];
  private heights: Heights;
  private trees: TreeField;
  private jobs: Job[] = [];
  private lit: pc.Material;
  private bulb: pc.Material;
  private focus: { x: number; z: number }[] = [];
  private blocks: (ReturnType<typeof buildTerrainBlock> | null)[] = Array(N_BLOCKS * N_BLOCKS).fill(null);
  private blockPending: boolean[] = Array(N_BLOCKS * N_BLOCKS).fill(false);
  private farHoles = true;

  constructor(private app: pc.AppBase, private kit: Kit, private county: County, private physics: Physics | null) {
    this.heights = new Heights(county.terrain);
    this.trees = new TreeField(new TreeKit(app.graphicsDevice, kit), app.graphicsDevice);
    this.lit = kit.glow('window', [1, 0.78, 0.5], 0, 1.4);
    this.bulb = kit.glow('bulb', [1, 0.86, 0.6], 0.15, 6);
    app.root.addChild(this.root);
    this.root.addChild(this.trees.root);
    for (let j = 0; j < N_CHUNKS; j++) for (let i = 0; i < N_CHUNKS; i++) {
      const x0 = ORIGIN + i * CHUNK, z0 = ORIGIN + j * CHUNK;
      this.chunks.push({ i, j, rect: { x0, z0, x1: x0 + CHUNK, z1: z0 + CHUNK }, pieces: [], junctions: [], lots: [], mid: null, midPending: false, near: null, nearPending: false, staticsAdded: false, trees: null });
    }
    this.assign();
    this.root.addChild(this.backdrop());
  }

  private at(x: number, z: number) {
    const i = Math.floor((x - ORIGIN) / CHUNK), j = Math.floor((z - ORIGIN) / CHUNK);
    return i >= 0 && j >= 0 && i < N_CHUNKS && j < N_CHUNKS ? this.chunks[j * N_CHUNKS + i] : null;
  }

  private assign() {
    const { net } = this.county;
    for (const e of net.edges) {
      const lo = e.trim[0], hi = e.len - e.trim[1], n = Math.max(1, Math.ceil((hi - lo) / 48));
      for (let k = 0; k < n; k++) {
        const s0 = lo + ((hi - lo) * k) / n, s1 = lo + ((hi - lo) * (k + 1)) / n, p = net.pointAt(e, (s0 + s1) / 2);
        this.at(p.x, p.z)?.pieces.push({ edge: e.id, s0, s1 });
      }
    }
    for (const j of net.junctions.values()) this.at(j.x, j.z)?.junctions.push(j.node);
    for (const l of net.lots) this.at(l.origin[0], l.origin[1])?.lots.push(l.id);
  }

  private backdrop() {
    const b = new MeshBuilder(), step = 128, R = 7000, n = Math.round((R * 2) / step), w = n + 1;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = -R + i * step, z = -R + j * step, h = baseHeight(x, z) - FAR_SINK;
      const dx = (baseHeight(x + 8, z) - baseHeight(x - 8, z)) / 16, dz = (baseHeight(x, z + 8) - baseHeight(x, z - 8)) / 16, l = Math.hypot(dx, 1, dz);
      b.vertex(x, h, z, -dx / l, 1 / l, -dz / l, 0, 0, groundColor(this.county.net, x, z, Math.hypot(dx, dz)));
    }
    const lim = -ORIGIN;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const cx = -R + (i + 0.5) * step, cz = -R + (j + 0.5) * step;
      if (Math.abs(cx) < lim && Math.abs(cz) < lim) continue;
      const a = j * w + i;
      b.tri(a, a + w + 1, a + 1); b.tri(a, a + w, a + w + 1);
    }
    return meshEntity('backdrop', [{ mesh: b.toMesh(this.app.graphicsDevice, true), material: this.kit.finish.ground }], { cast: false });
  }

  private dist(c: Chunk) {
    let d = Infinity;
    for (const f of this.focus) d = Math.min(d, Math.hypot(Math.max(c.rect.x0 - f.x, 0, f.x - c.rect.x1), Math.max(c.rect.z0 - f.z, 0, f.z - c.rect.z1)));
    return d;
  }

  private job(priority: number, run: () => void) { this.jobs.push({ priority, run }); }

  get busy() { return this.jobs.length + this.heights.pending; }

  /** Updates which chunks are loaded at which detail for these focus points, and runs build jobs for up to `budgetMs`. */
  update(focus: { x: number; z: number }[], budgetMs = 7) {
    this.focus = focus;
    for (const c of this.chunks) {
      const d = this.dist(c);
      if (d < MID_R && !c.mid && !c.midPending) this.loadMid(c, d);
      if (d > MID_DROP && c.mid) this.dropMid(c);
      if (d < NEAR_R && !c.near && !c.nearPending) this.loadNear(c, d);
      if (d > NEAR_DROP && c.near) this.dropNear(c);
    }
    for (let k = 0; k < this.blocks.length; k++) if (!this.blocks[k] && !this.blockPending[k]) this.loadBlock(k);
    if (this.farHoles) { this.farHoles = false; this.blocks.forEach((b, k) => b && this.cutHoles(b, k)); }
    this.heights.tick();
    const t0 = performance.now();
    this.jobs.sort((a, b) => a.priority - b.priority);
    while (this.jobs.length && performance.now() - t0 < budgetMs) this.jobs.shift()!.run();
    this.trees.flush();
  }

  private loadBlock(k: number) {
    this.blockPending[k] = true;
    const bi = k % N_BLOCKS, bj = Math.floor(k / N_BLOCKS), x0 = ORIGIN + bi * PER * CHUNK, z0 = ORIGIN + bj * PER * CHUNK, n = (PER * CHUNK) / FAR_STEP;
    const d = Math.min(...this.focus.map(f => Math.hypot(Math.max(x0 - f.x, 0, f.x - x0 - PER * CHUNK), Math.max(z0 - f.z, 0, f.z - z0 - PER * CHUNK))), 1e5);
    void this.heights.request(x0, z0, n, FAR_STEP, 1000 + d).then(h => this.job(1000 + d, () => {
      const b = buildTerrainBlock(this.app.graphicsDevice, this.kit.finish.ground, this.county.net, h, x0, z0, n, FAR_STEP, PER, FAR_SINK, `far-${bi}-${bj}`);
      this.cutHoles(b, k);
      this.root.addChild(b.entity);
      this.blocks[k] = b;
    }));
  }

  /** Leaves out the distant ground wherever a chunk is drawn in detail. */
  private cutHoles(b: ReturnType<typeof buildTerrainBlock>, k: number) {
    const bi = k % N_BLOCKS, bj = Math.floor(k / N_BLOCKS);
    b.show((ci, cj) => {
      const i = bi * PER + ci, j = bj * PER + cj;
      return !(i < N_CHUNKS && j < N_CHUNKS && this.chunks[j * N_CHUNKS + i].near);
    });
  }
  private chunkTrees(c: Chunk) {
    if (!c.trees) {
      const near = [...streetTrees(this.county, c.rect), ...yardTrees(this.county, c.rect), ...countryTrees(this.county, c.rect)];
      c.trees = { near, mid: near };
    }
    return c.trees;
  }

  private loadMid(c: Chunk, d: number) {
    c.midPending = true;
    this.job(d, () => {
      if (!c.midPending) return;
      const { net } = this.county;
      const roads = new Batch(this.kit);
      const B: RoadBuilders = { asphalt: roads.get('satin'), curb: roads.get('satin'), grass: roads.get('ground'), concrete: roads.get('matte'), marks: roads.get('plastic') };
      for (const p of c.pieces) buildEdgePiece(B, net, net.edges[p.edge], p.s0, p.s1);
      for (const id of c.junctions) buildJunction(B, net.junctions.get(id)!);
      const roadSoup = roads.soup([this.kit.finish.plastic]);
      const root = new pc.Entity(`mid-${c.i}-${c.j}`);
      root.addChild(roads.build(this.app.graphicsDevice, 'roads', { cast: false }));
      const masses = new Batch(this.kit);
      for (const id of c.lots) if (net.lots[id].house >= 0) buildHouseMass(masses, net.lots[id]);
      const m = c.lots.length ? masses.build(this.app.graphicsDevice, 'house-masses') : null;
      if (m) { m.enabled = !c.near; root.addChild(m); }
      if (!c.near) this.trees.set(`${c.i},${c.j}`, 'mid', this.chunkTrees(c).mid);
      this.root.addChild(root);
      c.mid = { root, roadSoup, masses: m };
      c.midPending = false;
    });
  }

  private dropMid(c: Chunk) {
    if (c.near) this.dropNear(c);
    c.mid?.root.destroy();
    this.trees.set(`${c.i},${c.j}`, 'mid', null);
    c.mid = null;
    c.midPending = false;
  }

  private loadNear(c: Chunk, d: number) {
    c.nearPending = true;
    const n = CHUNK / NEAR_STEP;
    void this.heights.request(c.rect.x0, c.rect.z0, n, NEAR_STEP, d).then(h => {
      if (!c.nearPending) return;
      const { net } = this.county;
      const root = new pc.Entity(`near-${c.i}-${c.j}`);
      const parts: { ground?: pc.Entity } = {};
      this.job(this.dist(c), () => {
        if (!c.nearPending) return;
        parts.ground = buildTerrainChunk(this.app.graphicsDevice, this.kit.finish.ground, net, h, c.rect.x0, c.rect.z0, n, NEAR_STEP, 0, `ground-${c.i}-${c.j}`);
        root.addChild(parts.ground);
      });
      const houses = new Batch(this.kit);
      for (const id of c.lots) if (net.lots[id].house >= 0) this.job(this.dist(c) + 1, () => { if (c.nearPending) buildLotHouse(houses, net, net.lots[id], this.lit); });
      this.job(this.dist(c) + 2, () => {
        if (!c.nearPending || !c.mid) { if (c.nearPending) { c.nearPending = false; } return; }
        for (const f of fixtures(this.county, c.rect)) {
          const mark = houses.mark();
          if (f.kind === 'lamp') streetLamp(houses, 0, 0, 1, this.bulb); else mailbox(houses, 0, 0, PALETTE.mailboxBlue);
          houses.move(mark, place(f.x, f.y, f.z, (f.yaw * Math.PI) / 180));
        }
        root.addChild(houses.build(this.app.graphicsDevice, 'houses'));
        this.trees.set(`${c.i},${c.j}`, 'near', this.chunkTrees(c).near);
        this.trees.set(`${c.i},${c.j}`, 'mid', null);
        this.root.addChild(root);
        const colliders = this.addColliders(c, h, n);
        c.near = { root, ground: parts.ground!, colliders };
        c.nearPending = false;
        if (c.mid?.masses) c.mid.masses.enabled = false;
        this.farHoles = true;
      });
    });
  }

  private dropNear(c: Chunk) {
    c.nearPending = false;
    if (!c.near) return;
    c.near.root.destroy();
    if (this.physics) for (const col of c.near.colliders) this.physics.world.removeCollider(col as never, false);
    c.near = null;
    if (c.mid?.masses) c.mid.masses.enabled = true;
    this.trees.set(`${c.i},${c.j}`, 'near', null);
    if (c.mid) this.trees.set(`${c.i},${c.j}`, 'mid', this.chunkTrees(c).mid);
    this.farHoles = true;
  }

  private addColliders(c: Chunk, h: Float32Array, n: number) {
    const P = this.physics;
    if (!P) return [];
    const R = P.R, out: unknown[] = [];
    const size = n * NEAR_STEP;
    const hf = R.ColliderDesc.heightfield(n, n, heightfieldData(h, n), { x: size, y: 1, z: size })
      .setTranslation(c.rect.x0 + size / 2, 0, c.rect.z0 + size / 2).setCollisionGroups(MASK.ground).setFriction(0.9);
    out.push(P.world.createCollider(hf));
    const soup = c.mid?.roadSoup;
    if (soup && soup.idx.length) out.push(P.world.createCollider(R.ColliderDesc.trimesh(soup.pos, soup.idx).setCollisionGroups(MASK.ground).setFriction(1)));
    if (!c.staticsAdded) {
      c.staticsAdded = true;
      const { net } = this.county;
      for (const id of c.lots) if (net.lots[id].house >= 0) for (const b of houseColliders(net.lots[id])) P.addStaticBox(b);
      for (const t of this.chunkTrees(c).near) P.addStaticCylinder(t.x, t.y + 1.5, t.z, 1.5, t.kind === 'spruce' ? 0.3 : 0.28 * (t.h / 10));
    }
    return out;
  }

  /** Whether the ground and roads under (x, z) have colliders yet. */
  solidAt(x: number, z: number) { return !!this.at(x, z)?.near; }
}
