/**
 * Real 3D grass: instanced clumps of thin blades around the camera, stirring
 * in the wind (TSL vertex animation). Positions come from a world-anchored
 * jittered grid, so blades never "swim" as you move. On a lot every clump
 * follows the lawn: freshly cut it stands about 4 cm tall and leans the way
 * the mower pushed it, then over five in-game days it grows back to about
 * 11 cm and straightens up. The lean is real geometry, and the blades are
 * shaded by how they lean relative to the camera, so mowing stripes (and
 * crossed diamond patterns) read in 3D and fade as the grass grows. Open
 * fields grow to knee-high meadow; the public verges along Willow Bend are
 * kept short. Roads, sidewalks, driveways, floors, pools and downtown stay clear.
 *
 * Performance layout (chunked instancing):
 *
 *   - The field is cut into TILE × TILE m tiles on a world grid. A tile is one
 *     InstancedMesh; every tile shares one material and one pair of clump
 *     geometries, so the GPU sees a short run of identical draws (no state
 *     changes) and three.js frustum-culls each tile on its own bounding sphere,
 *     so nothing behind the camera is drawn. Tiles are pooled and reused.
 *   - Only tiles within the draw radius around the focus are loaded. New tiles
 *     are laid out within a small per-frame time budget, nearest first, so
 *     walking or driving never re-lays the whole field in one frame.
 *   - Within a tile, clumps are stored sorted by a stable per-clump random rank.
 *     Density falls with distance (DENSITY_FULL → MIN_DENSITY at the radius), so
 *     thinning a far tile is just a smaller `mesh.count`: no upload. The vertex
 *     shader uses the same density curve to shrink each clump to nothing just
 *     before it is dropped, and fades the outer rim, so there is no popping.
 *   - Tiles past LOD_DIST swap to a one-segment clump (half the triangles).
 *   - A lawn change (a mower pass, growth, a house edit) re-lays only the tiles
 *     the change touched.
 */
import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, clamp, cos, dot, float, length, max, min, mix, normalize, normalViewGeometry, positionLocal, positionWorld, sin, smoothstep, time, uniform, uv, vec2, vec3 } from 'three/tsl';
import { floorKey, objectCells, WorldState } from '../../shared/BuildRules';
import { bladeHeight } from '../../shared/Mowing';
import { CIVIC_BLOCK, CURB_CUTS, curveDistance, DEPOT, DOWNTOWN, drivewayRect, GAS_STATION, GRID_BLOCKS, RectXZ, ROAD_W, ROADS, SIDEWALKS, TOWN_SQUARE, WORLD_HALF } from '../../shared/WorldLayout';
import type { LawnSample } from './Lawn';
import type { Lawn } from './Lawn';

const SPACING = 0.32;               // ~10 clumps (40 blades) per m² at full density
/** Tile edge, metres: exactly 25 grid cells, so a cell never straddles two tiles. */
const TILE = 8;
const CELLS = Math.round(TILE / SPACING);
const CAPACITY = CELLS * CELLS;
/** Draw radius at quality 1 (was a hard 30 m disc at full density everywhere). */
const RADIUS = 26;
/** Full density inside this distance; it then thins linearly to MIN_DENSITY at the radius. */
const DENSITY_FULL = 9;
const MIN_DENSITY = 0.3;
/** Rank band over which a clump shrinks to nothing before it is dropped. */
const FADE_BAND = 0.08;
/** Outer rim (metres) where every remaining clump shrinks into the ground. */
const EDGE_FADE = 4;
/** Tiles whose nearest point is farther than this use the one-segment clump. */
const LOD_DIST = 14;
const LOD_HYSTERESIS = 1.5;
/** A tile is released only this far past the radius, so walking along the edge doesn't thrash. */
const UNLOAD_PAD = TILE * 0.75;
/** Re-check which tiles are wanted once the focus moved this far. */
const STREAM_EPS = 1;
/**
 * Layout time per frame (ms), nearest tiles first; at least one new tile always
 * goes in. The first frame lays out everything in range. One tile is ~0.1–0.3 ms.
 */
const LAYOUT_BUDGET_MS = 2;
/** Lawn changes (a cut, growth) re-lay their tiles at most this often. */
const RELAY_MS = 250;
const RELAYS_PER_FRAME = 6;
/** Tallest meadow clump (m), plus sway, for tile bounding spheres. */
const MAX_HEIGHT = 0.5;
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

/**
 * Four thin blades fanned around the root, each a tapered strip with its own
 * height, lean and tint. uv.y = 0 at the root, 1 at the tip. `detailed` gives
 * two segments per blade (16 triangles); the far LOD uses one (8 triangles).
 */
function clumpGeometry(detailed: boolean) {
  const pos: number[] = [], uvs: number[] = [], col: number[] = [];
  const blades = [
    { a: 0.3, h: 1.0, lean: 0.022, off: [0.01, 0.0], tint: [0.82, 1.0, 0.62] },
    { a: 1.25, h: 0.82, lean: -0.018, off: [-0.012, 0.008], tint: [0.9, 1.0, 0.58] },
    { a: 2.15, h: 0.92, lean: 0.026, off: [0.004, -0.013], tint: [0.78, 0.95, 0.6] },
    { a: 2.85, h: 0.7, lean: -0.012, off: [-0.006, -0.004], tint: [0.95, 1.0, 0.55] },
  ];
  // Far blades are a touch wider so a thinned field still covers the ground.
  const seg = detailed ? [[0, 0.011], [0.55, 0.008], [1, 0]] : [[0, 0.014], [1, 0]];
  for (const bl of blades) {
    const ca = Math.cos(bl.a), sa = Math.sin(bl.a);
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
const rectOverlaps = (r: RectXZ, x0: number, z0: number, x1: number, z1: number, pad: number) =>
  r.cx + r.sx / 2 + pad > x0 && r.cx - r.sx / 2 - pad < x1 && r.cz + r.sz / 2 + pad > z0 && r.cz - r.sz / 2 - pad < z1;
const rectCovers = (r: RectXZ, x0: number, z0: number, x1: number, z1: number, pad: number) =>
  r.cx - r.sx / 2 - pad <= x0 && r.cx + r.sx / 2 + pad >= x1 && r.cz - r.sz / 2 - pad <= z0 && r.cz + r.sz / 2 + pad >= z1;
const tileKey = (tx: number, tz: number) => (tx + 1024) * 4096 + (tz + 1024);
const cellKey = (x: number, z: number) => (x + 4096) * 8192 + (z + 4096);
/** Distance from (x, z) to the nearest point of an axis-aligned box. */
const boxDist = (x: number, z: number, x0: number, z0: number, x1: number, z1: number) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));

interface Tile {
  key: number;
  tx: number; tz: number;
  x0: number; z0: number;
  readonly mesh: THREE.InstancedMesh;
  readonly near: THREE.BufferGeometry;
  readonly far: THREE.BufferGeometry;
  /** Per clump: blade lean direction (x, z), stripe strength, lean distance at the tip (m). */
  readonly mow: THREE.InstancedBufferAttribute;
  /** Per clump: stable random rank in 0..1, ascending through the buffer. */
  readonly rank: THREE.InstancedBufferAttribute;
  readonly color: THREE.InstancedBufferAttribute;
  total: number;
  laid: boolean;
  dirty: boolean;
  far_: boolean;
  dist: number;
}

interface PoolRect { x0: number; x1: number; z0: number; z1: number }

export class Grass {
  /** Parent of every tile mesh (hide it to hide all grass). */
  readonly root = new THREE.Group();
  private readonly material: THREE.MeshStandardNodeMaterial;
  private readonly nearBase: THREE.BufferGeometry;
  private readonly farBase: THREE.BufferGeometry;
  private readonly tiles = new Map<number, Tile>();
  private readonly pool: Tile[] = [];
  private readonly order: Tile[] = [];
  private readonly blocked: RectXZ[];
  private readonly origin = uniform(new THREE.Vector3(1e9, 0, 1e9));
  private readonly radiusU = uniform(RADIUS);
  private radius = RADIUS;
  private streamedAt = new THREE.Vector2(1e9, 1e9);
  private worldVersion = -1;
  private covered = new Set<number>();
  private lastRelay = 0;
  private primed = false;
  private nowDays = 0;
  private readonly dirtyBox = [0, 0, 0, 0];
  // Layout scratch (one tile's worth), reused for every tile.
  private readonly sx = new Float32Array(CAPACITY * 14);
  private readonly sortIdx = new Uint16Array(CAPACITY);
  private readonly sample: LawnSample = { growth: 1, dx: 0, dz: 0, strength: 0 };
  private readonly col = new THREE.Color();

  constructor(scene: THREE.Scene, private lawns: Map<string, Lawn>, private world: () => WorldState | null, quality = 1) {
    this.root.name = 'grass';
    this.root.matrixAutoUpdate = false;
    scene.add(this.root);
    this.nearBase = clumpGeometry(true);
    this.farBase = clumpGeometry(false);
    this.material = this.buildMaterial();
    this.setQuality(quality);
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

  /**
   * Quality 1 is the full field; lower values pull the draw radius in (area
   * scales with quality), e.g. 0.7 on the WebGL2 fallback.
   */
  setQuality(q: number) {
    this.radius = RADIUS * Math.sqrt(THREE.MathUtils.clamp(q, 0.3, 1.5));
    this.radiusU.value = this.radius;
    this.streamedAt.set(1e9, 1e9);
  }

  /** Density (0..1) the field keeps at distance d. Mirrors the vertex shader. */
  private densityAt(d: number) {
    const full = Math.min(DENSITY_FULL, this.radius * 0.5);
    const t = THREE.MathUtils.clamp((d - full) / (this.radius - full), 0, 1);
    return 1 + (MIN_DENSITY - 1) * t;
  }

  private buildMaterial() {
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const mow = attribute('grassMow', 'vec4');
    const rank = attribute('grassRank', 'float');
    // Wind: bend grows with the square of height; each clump has its own phase.
    // Mowed blades also lean the way the mower pushed them (less the taller they grow).
    const phase = rank.mul(9301.0);
    const bend = uv().y.mul(uv().y);
    const sway = vec3(sin(time.mul(1.9).add(phase)).mul(0.012).add(sin(time.mul(0.55).add(phase.mul(0.13))).mul(0.01)), float(0), cos(time.mul(1.4).add(phase)).mul(0.008));
    const lean = vec3(mow.x.mul(mow.w), mow.w.mul(mow.w).mul(-8), mow.y.mul(mow.w));
    // Distance LOD. Tiles sit at the origin, so the instanced position is in world space.
    const p = positionLocal;
    const d = length(vec2(p.x, p.z).sub(vec2(this.origin.x, this.origin.z)));
    const full = min(this.radiusU.mul(0.5), float(DENSITY_FULL));
    const density = mix(float(1), float(MIN_DENSITY), clamp(d.sub(full).div(this.radiusU.sub(full)), 0, 1));
    // A clump shrinks into the ground as the density passes its rank (CPU drops it right after),
    // and everything left shrinks away over the outer rim, so the edge never pops.
    const keep = clamp(density.sub(rank).div(FADE_BAND), 0, 1).mul(float(1).sub(smoothstep(this.radiusU.sub(EDGE_FADE), this.radiusU, d)));
    const bent = p.add(sway.add(lean).mul(bend).mul(keep));
    mat.positionNode = vec3(bent.x, bent.y.mul(keep), bent.z);
    // Stripes: blades leaning away from the camera look light, toward it dark.
    const toCam = cameraPosition.sub(positionWorld);
    const flat = vec2(toCam.x, toCam.z);
    const side = length(flat).div(max(length(toCam), float(1e-3)));
    // Blades light like the turf they belong to from either side (no flipped, dark back faces).
    mat.normalNode = normalViewGeometry;
    mat.colorNode = vec3(float(1).sub(dot(vec2(mow.x, mow.y), normalize(flat)).mul(mow.z).mul(side).mul(0.42)));
    return mat;
  }

  private makeTile(): Tile {
    const mow = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
    const rank = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    const color = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    for (const a of [mow, rank, color]) a.setUsage(THREE.DynamicDrawUsage);
    const share = (base: THREE.BufferGeometry) => {
      const g = new THREE.BufferGeometry();
      for (const name of ['position', 'uv', 'color', 'normal']) g.setAttribute(name, base.getAttribute(name));
      g.setAttribute('grassMow', mow);
      g.setAttribute('grassRank', rank);
      return g;
    };
    const near = share(this.nearBase), far = share(this.farBase);
    const mesh = new THREE.InstancedMesh(near, this.material, CAPACITY);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = color;
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.SQRT1_2 * TILE + SPACING + 0.2);
    // Raycasts never need individual blades.
    mesh.raycast = () => {};
    return { key: 0, tx: 0, tz: 0, x0: 0, z0: 0, mesh, near, far, mow, rank, color, total: 0, laid: false, dirty: false, far_: false, dist: 0 };
  }

  /** Streams tiles, applies lawn changes and sets each tile's density and LOD for this frame. */
  update(focus: THREE.Vector3, nowDays: number) {
    this.nowDays = nowDays;
    this.origin.value.set(focus.x, 0, focus.z);

    // House edits (floors, pools, yard items) only change lots: re-lay loaded lawn tiles.
    const w = this.world();
    if ((w?.version ?? -1) !== this.worldVersion) {
      this.worldVersion = w?.version ?? -1;
      this.rebuildCovered(w);
      for (const l of this.lawns.values()) this.markDirty(l.lot.x, l.lot.z, l.lot.x + l.lot.w, l.lot.z + l.lot.d);
    }
    // Mower passes and growth: only the tiles the change touched.
    const box = this.dirtyBox;
    for (const l of this.lawns.values()) if (l.takeDirty(box)) this.markDirty(box[0], box[1], box[2], box[3]);

    if (Math.hypot(this.streamedAt.x - focus.x, this.streamedAt.y - focus.z) > STREAM_EPS) this.stream(focus.x, focus.z);

    // Distances, then lay out the nearest pending tiles first.
    const order = this.order;
    order.length = 0;
    for (const t of this.tiles.values()) {
      t.dist = boxDist(focus.x, focus.z, t.x0, t.z0, t.x0 + TILE, t.z0 + TILE);
      if (!t.laid || t.dirty) order.push(t);
    }
    if (order.length) {
      order.sort((a, b) => a.dist - b.dist);
      const now = performance.now();
      const relayDue = now - this.lastRelay >= RELAY_MS;
      const budget = this.primed ? LAYOUT_BUDGET_MS : Infinity;
      let fresh = 0, relays = RELAYS_PER_FRAME, relaid = false;
      for (const t of order) {
        if (!t.laid) {
          if (fresh > 0 && performance.now() - now > budget) continue;
          this.layout(t, w);
          fresh++;
        } else if (relayDue && relays-- > 0) { this.layout(t, w); relaid = true; }
      }
      if (relaid) this.lastRelay = now;
      this.primed = true;
    }

    // Per-tile density (a smaller count, no upload) and geometry LOD.
    for (const t of this.tiles.values()) {
      if (!t.laid) { t.mesh.visible = false; continue; }
      const n = t.dist >= this.radius ? 0 : this.countBelow(t, this.densityAt(t.dist));
      t.mesh.count = n;
      t.mesh.visible = n > 0;
      const far = t.far_ ? t.dist > LOD_DIST - LOD_HYSTERESIS : t.dist > LOD_DIST + LOD_HYSTERESIS;
      if (far !== t.far_) { t.far_ = far; t.mesh.geometry = far ? t.far : t.near; }
    }
  }

  /** Clumps kept at this density: ranks are sorted, so it's a binary search. */
  private countBelow(t: Tile, density: number) {
    const r = t.rank.array as Float32Array;
    let lo = 0, hi = t.total;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (r[mid] < density) lo = mid + 1; else hi = mid; }
    return lo;
  }

  private markDirty(x0: number, z0: number, x1: number, z1: number) {
    const tx0 = Math.floor((x0 - 0.2) / TILE), tx1 = Math.floor((x1 + 0.2) / TILE);
    const tz0 = Math.floor((z0 - 0.2) / TILE), tz1 = Math.floor((z1 + 0.2) / TILE);
    for (let tx = tx0; tx <= tx1; tx++) for (let tz = tz0; tz <= tz1; tz++) {
      const t = this.tiles.get(tileKey(tx, tz));
      if (t && t.laid) t.dirty = true;
    }
  }

  /** Loads tiles that came into range and releases ones well past it. */
  private stream(fx: number, fz: number) {
    this.streamedAt.set(fx, fz);
    const keep = this.radius + UNLOAD_PAD;
    for (const t of this.tiles.values()) {
      if (boxDist(fx, fz, t.x0, t.z0, t.x0 + TILE, t.z0 + TILE) > keep) {
        this.tiles.delete(t.key);
        this.root.remove(t.mesh);
        t.mesh.visible = false;
        t.laid = false;
        this.pool.push(t);
      }
    }
    const r = this.radius;
    const tx0 = Math.floor((fx - r) / TILE), tx1 = Math.floor((fx + r) / TILE);
    const tz0 = Math.floor((fz - r) / TILE), tz1 = Math.floor((fz + r) / TILE);
    for (let tx = tx0; tx <= tx1; tx++) for (let tz = tz0; tz <= tz1; tz++) {
      const x0 = tx * TILE, z0 = tz * TILE;
      if (boxDist(fx, fz, x0, z0, x0 + TILE, z0 + TILE) >= r) continue;
      if (Math.abs(x0 + TILE / 2) > WORLD_HALF + TILE || Math.abs(z0 + TILE / 2) > WORLD_HALF + TILE) continue;
      const key = tileKey(tx, tz);
      if (this.tiles.has(key)) continue;
      const t = this.pool.pop() ?? this.makeTile();
      t.key = key; t.tx = tx; t.tz = tz; t.x0 = x0; t.z0 = z0;
      t.laid = false; t.dirty = false; t.total = 0;
      t.mesh.boundingSphere!.center.set(x0 + TILE / 2, MAX_HEIGHT / 2, z0 + TILE / 2);
      this.tiles.set(key, t);
      this.root.add(t.mesh);
    }
  }

  private rebuildCovered(world: WorldState | null) {
    const covered = this.covered;
    covered.clear();
    if (!world) return;
    for (const id in world.builds) {
      const objs = world.builds[id].objects;
      for (const oid in objs) if (objs[oid].level === 0 && COVERS.has(objs[oid].catalogId)) for (const [cx, cz] of objectCells(objs[oid]).cells) covered.add(cellKey(cx, cz));
    }
  }

  /** Lays out one tile: every clump of its grid cells, sorted by rank. */
  private layout(t: Tile, world: WorldState | null) {
    t.laid = true;
    t.dirty = false;
    const x0 = t.x0, z0 = t.z0, x1 = x0 + TILE, z1 = z0 + TILE;
    const pad = 0.15 + SPACING;
    const blocked = this.blocked.filter(b => rectOverlaps(b, x0, z0, x1, z1, pad));
    let n = 0;
    if (!blocked.some(b => rectCovers(b, x0, z0, x1, z1, -pad))) {
      const lawns = [...this.lawns.values()].filter(l => l.lot.x < x1 + 1 && l.lot.x + l.lot.w > x0 - 1 && l.lot.z < z1 + 1 && l.lot.z + l.lot.d > z0 - 1);
      const pools: PoolRect[] = [];
      for (const l of lawns) {
        const b = world?.builds[l.lot.id];
        if (b) for (const id in b.pools) { const pl = b.pools[id]; pools.push({ x0: pl.x0 - 0.3, x1: pl.x1 + 0.3, z0: pl.z0 - 0.3, z1: pl.z1 + 0.3 }); }
      }
      // Tiles well clear of the curved streets skip the per-clump curve lookup.
      const nearCurve = curveDistance(x0 + TILE / 2, z0 + TILE / 2) < ROAD_W / 2 + 18 + TILE;
      const sx = this.sx, sample = this.sample, col = this.col;
      const gx0 = Math.round(x0 / SPACING), gz0 = Math.round(z0 / SPACING);
      for (let i = 0; i < CELLS; i++) {
        for (let j = 0; j < CELLS; j++) {
          const gx = gx0 + i, gz = gz0 + j;
          const h1 = hash(gx, gz), h2 = hash(gz + 7, gx - 3);
          const x = (gx + h1 - 0.5) * SPACING, z = (gz + h2 - 0.5) * SPACING;
          if (Math.abs(x) > WORLD_HALF - 2 || Math.abs(z) > WORLD_HALF - 2) continue;
          let hit = false;
          for (let k = 0; k < blocked.length; k++) if (inRect(blocked[k], x, z, 0.15)) { hit = true; break; }
          if (hit) continue;
          const toCurve = nearCurve ? curveDistance(x, z) : Infinity;
          if (toCurve < ROAD_W / 2 + 0.25) continue;
          let height: number;
          let mdx = 0, mdz = 0, mstr = 0, mlean = 0;
          let lawn: Lawn | undefined;
          for (let k = 0; k < lawns.length; k++) if (lawns[k].contains(x, z)) { lawn = lawns[k]; break; }
          if (lawn) {
            const b = world?.builds[lawn.lot.id];
            const fx = Math.floor(x), fz = Math.floor(z);
            if (this.covered.has(cellKey(fx, fz))) continue;
            if (b && b.floors[floorKey(0, fx, fz)]) continue;
            let inPool = false;
            for (let k = 0; k < pools.length; k++) { const pl = pools[k]; if (fx >= pl.x0 && fx < pl.x1 && fz >= pl.z0 && fz < pl.z1) { inPool = true; break; } }
            if (inPool) continue;
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
          const o = n * 14;
          sx[o] = x; sx[o + 1] = z; sx[o + 2] = height; sx[o + 3] = h1 * Math.PI * 2; sx[o + 4] = 0.85 + h2 * 0.35;
          sx[o + 5] = col.r; sx[o + 6] = col.g; sx[o + 7] = col.b;
          sx[o + 8] = mdx; sx[o + 9] = mdz; sx[o + 10] = mstr; sx[o + 11] = mlean;
          // Stable, independent of h1/h2: the same clumps thin out first every time.
          sx[o + 12] = hash(gx * 3 + 11, gz * 5 - 17);
          this.sortIdx[n] = n;
          n++;
        }
      }
    }
    // Sort by rank so "keep the first N" is the thinning rule.
    const idx = this.sortIdx.subarray(0, n).sort((a, b) => this.sx[a * 14 + 12] - this.sx[b * 14 + 12]);
    const mat = t.mesh.instanceMatrix.array as Float32Array;
    const colors = t.color.array as Float32Array, mow = t.mow.array as Float32Array, ranks = t.rank.array as Float32Array;
    const sx = this.sx;
    for (let i = 0; i < n; i++) {
      const o = idx[i] * 14;
      const c = Math.cos(sx[o + 3]), s = Math.sin(sx[o + 3]), w = sx[o + 4], h = sx[o + 2];
      // T · Ry(yaw) · S(w, h, w), column-major.
      const e = i * 16;
      mat[e] = c * w; mat[e + 1] = 0; mat[e + 2] = -s * w; mat[e + 3] = 0;
      mat[e + 4] = 0; mat[e + 5] = h; mat[e + 6] = 0; mat[e + 7] = 0;
      mat[e + 8] = s * w; mat[e + 9] = 0; mat[e + 10] = c * w; mat[e + 11] = 0;
      mat[e + 12] = sx[o]; mat[e + 13] = 0.01; mat[e + 14] = sx[o + 1]; mat[e + 15] = 1;
      colors[i * 3] = sx[o + 5]; colors[i * 3 + 1] = sx[o + 6]; colors[i * 3 + 2] = sx[o + 7];
      mow[i * 4] = sx[o + 8]; mow[i * 4 + 1] = sx[o + 9]; mow[i * 4 + 2] = sx[o + 10]; mow[i * 4 + 3] = sx[o + 11];
      ranks[i] = sx[o + 12];
    }
    t.total = n;
    if (n > 0) {
      // Only the used part of each buffer goes to the GPU.
      for (const [a, size] of [[t.mesh.instanceMatrix, 16], [t.color, 3], [t.mow, 4], [t.rank, 1]] as const) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * size);
        a.needsUpdate = true;
      }
    }
  }

  /** Counts for the dev console and the headless perf probe. */
  stats() {
    let laid = 0, drawn = 0, instances = 0, far = 0, capacity = 0;
    for (const t of this.tiles.values()) {
      if (t.laid) laid++;
      if (t.mesh.visible) { drawn++; instances += t.mesh.count; if (t.far_) far++; }
      capacity += t.total;
    }
    return { radius: +this.radius.toFixed(1), tiles: this.tiles.size, laid, drawn, farLod: far, instances, laidClumps: capacity, pooled: this.pool.length };
  }
}
