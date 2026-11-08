/**
 * Distance-based world chunking for the static town.
 *
 * The neighborhood is built once as one big group and every house is a group
 * per lot. `adopt()` / `track()` walk those groups and move each piece into
 * a grid of CHUNK_SIZE cells. Inside a cell, objects are bucketed by how far
 * away they stay worth drawing: a mailbox stops being visible long before an
 * office tower does, so each object gets a view distance from its bounding
 * radius (about 4 px tall on screen, see SCREEN_K) rounded up to one of
 * VIEW_TIERS. One (cell, tier, layer) bucket is a `ChunkPart`, a plain
 * THREE.Group that is either in the scene graph or not.
 *
 * Every frame `update(focus)` compares the focus point with each part's
 * bounds (squared distances, no sqrt, no allocation). Parts that come into
 * range are queued: the first time a part is shown its materials are compiled
 * with `renderer.compileAsync` off the critical path (when a compiler is
 * given; see Prewarm.ts for why there is none with AO on), then it is
 * attached to the scene, a few parts per frame. The first frame a part is
 * attached it is also drawn with frustum culling off, even when it is behind
 * the camera (`warm`), so the main pass, the AO pass and the shadow pass build
 * their pipelines a few parts at a time while it is out of sight, instead of
 * all at once the moment the player turns around. Parts that leave range (plus HYSTERESIS,
 * so walking along a boundary doesn't flicker) are detached at once, which
 * takes them out of the main pass, the shadow pass and scene traversal.
 *
 * World-spanning InstancedMeshes (the woodland, street lamps) are split into
 * one InstancedMesh per INSTANCE_CELL so that frustum and shadow-camera
 * culling, which three.js does per object, can finally skip the trees behind
 * you. Objects too big for any cell (ground plane, merged road slabs) stay
 * where they are and are always drawn.
 *
 * Static parts are merged into one mesh per material once adopted (houses are
 * merged per lot by HouseManager before they are tracked). Colliders are
 * streamed separately by Physics.stream().
 */
import * as THREE from 'three/webgpu';
import { mergeStatic } from '../core/Merge';
import { compileWhole, type Compiler } from '../core/Prewarm';

/** Edge of one grid cell, metres. The world is 1,280 m across, so 20 × 20 cells. */
export const CHUNK_SIZE = 64;
/** Instanced scenery is regrouped on a coarser grid so it stays a few draw calls. */
export const INSTANCE_CELL = 256;
/** Allowed view distances, metres. Fog ends at 900 m, so the last tier is ~70 % fogged. */
export const VIEW_TIERS = [160, 320, 480, 720] as const;
/** View distance = bounding radius × SCREEN_K (≈ 4 px at 800 px, 55° fov). */
const SCREEN_K = 190;
/** A part is detached only this far past its view distance. */
const HYSTERESIS = 24;
/** Parts attached per frame once their materials are ready. */
const ATTACH_PER_FRAME = 8;
/** compileAsync calls in flight at once. */
const MAX_COMPILES = 2;
/** Parts drawn off-screen per frame to build their pipelines before they come into view. */
const WARM_PER_FRAME = 6;
/** Re-test distances when the focus moved this far, or after REFRESH_SEC. */
const MOVE_EPS = 2;
const REFRESH_SEC = 0.5;

type PartState = 'off' | 'queued' | 'compiling' | 'on';

interface ChunkPart {
  readonly key: string;
  readonly group: THREE.Group;
  readonly viewDistance: number;
  /** Squared distances for entering and leaving range. */
  readonly enter2: number;
  readonly leave2: number;
  /** XZ bounds of what the part holds (can reach past its cell). */
  minX: number; minZ: number; maxX: number; maxZ: number;
  minY: number; maxY: number;
  /** World-space bounds for frustum tests (kept in sync with the fields above). */
  readonly box: THREE.Box3;
  /** Whether anything in the part casts a shadow (only those are kept for the shadow pass). */
  casts: boolean;
  state: PartState;
  compiled: boolean;
  /** Drawn at least once with frustum culling off, so every pass has its pipelines. */
  warmed: boolean;
  wanted: boolean;
}

export interface AdoptOptions {
  /** Keeps sources apart inside a cell (static scenery vs. houses that get rebuilt). */
  layer?: string;
  /** Force a view distance instead of deriving it from the object's size. */
  viewDistance?: number;
}


const box = new THREE.Box3();
const sphere = new THREE.Sphere();
const mat = new THREE.Matrix4();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const _col = new THREE.Color();
const _projView = new THREE.Matrix4();
const _view = new THREE.Frustum();
const _grown = new THREE.Box3();
/** Metres added around a part's bounds before frustum tests. */
const CULL_MARGIN = 2;

export function tierFor(radius: number): number {
  const want = radius * SCREEN_K;
  for (const t of VIEW_TIERS) if (want <= t) return t;
  return VIEW_TIERS[VIEW_TIERS.length - 1];
}

function hasLight(o: THREE.Object3D) {
  let found = false;
  o.traverse(c => { if ((c as THREE.Light).isLight) found = true; });
  return found;
}

export class WorldChunks {
  /** Parent of every attached part; sits at the scene origin with an identity transform. */
  readonly root = new THREE.Group();
  private parts = new Map<string, ChunkPart>();
  private list: ChunkPart[] = [];
  private queue: ChunkPart[] = [];
  private compiling = 0;
  private keyed = new Map<string, THREE.Object3D[]>();
  private last = new THREE.Vector3(Infinity, 0, Infinity);
  private sinceRefresh = 0;
  private primed = false;
  private warmQueue: ChunkPart[] = [];
  private warming: ChunkPart[] = [];
  private warmCulled: THREE.Object3D[] = [];

  constructor(private scene: THREE.Scene, private compiler: Compiler | null = null, private camera: THREE.Camera | null = null) {
    this.root.name = 'world-chunks';
    this.root.matrixAutoUpdate = false;
    scene.add(this.root);
  }

  // ---------------------------------------------------------------- building the grid

  /**
   * Moves the children of `source` (recursively, for groups too big for one
   * cell) into chunk parts. World transforms are preserved; objects holding
   * lights, empty objects and anything wider than 1.5 cells stay put.
   */
  adopt(source: THREE.Object3D, opts: AdoptOptions = {}) {
    source.updateMatrixWorld(true);
    const touched = new Set<ChunkPart>();
    this.adoptChildren(source, opts, touched, null);
    for (const p of touched) {
      // Adopted scenery never changes, so each part becomes one draw per material
      // (InstancedMeshes and anything marked userData.keep stay as they are).
      if (!p.key.endsWith(':inst')) mergeStatic(p.group, { flatten: () => true });
      this.fitBounds(p);
    }
    return touched.size;
  }

  /** Dynamic content (a lot's house): adopt it under `key` so `untrack(key)` can take it back out. */
  track(key: string, group: THREE.Object3D) {
    group.updateMatrixWorld(true);
    const touched = new Set<ChunkPart>();
    if (!this.keyed.has(key)) this.keyed.set(key, []);
    this.adoptChildren(group, { layer: 'dynamic' }, touched, key);
    for (const p of touched) {
      this.fitBounds(p);
      // Shares materials with the rest of the town: no compile wait, show it now if in range.
      p.compiled = true;
      if (p.warmed) { p.warmed = false; if (p.state === 'on') this.warmQueue.push(p); }
      if (this.primed && this.inRange(p, this.last.x, this.last.z, p.enter2)) this.show(p);
    }
  }

  /** Removes everything adopted under `key` and returns it (for disposal). */
  untrack(key: string): THREE.Object3D[] {
    const objs = this.keyed.get(key) ?? [];
    this.keyed.delete(key);
    for (const o of objs) o.removeFromParent();
    return objs;
  }

  private adoptChildren(parent: THREE.Object3D, opts: AdoptOptions, touched: Set<ChunkPart>, key: string | null) {
    for (const child of [...parent.children]) this.place(child, opts, touched, key);
  }

  private place(obj: THREE.Object3D, opts: AdoptOptions, touched: Set<ChunkPart>, key: string | null) {
    if ((obj as THREE.Light).isLight || (obj as THREE.Camera).isCamera) return;
    if (hasLight(obj)) { this.adoptChildren(obj, opts, touched, key); return; }
    const im = obj as THREE.InstancedMesh;
    if (im.isInstancedMesh) { this.splitInstanced(im, opts, touched, key); return; }

    box.setFromObject(obj);
    if (box.isEmpty()) return;
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    if (span > (CHUNK_SIZE) * 1.5) {
      // A town-wide group: look inside it. A single huge mesh stays global, except
      // tracked content, whose source group is not in the scene: that goes to the
      // part at its center (the part's bounds grow to cover it).
      if (!(obj as THREE.Mesh).isMesh && obj.children.length) { this.adoptChildren(obj, opts, touched, key); return; }
      if (!key) return;
    }
    box.getBoundingSphere(sphere);
    // A batch merged from many small pieces keeps the view distance of the pieces it was made from.
    const view = (obj.userData.viewDistance as number | undefined) ?? opts.viewDistance ?? tierFor(sphere.radius);
    const part = this.partAt(sphere.center.x, sphere.center.z, CHUNK_SIZE, view, opts.layer ?? 'static');
    part.group.attach(obj);
    touched.add(part);
    if (key) this.keyed.get(key)!.push(obj);
  }

  /** One InstancedMesh per INSTANCE_CELL, same geometry and material, matrices baked to world space. */
  private splitInstanced(im: THREE.InstancedMesh, opts: AdoptOptions, touched: Set<ChunkPart>, key: string | null) {
    if (!im.geometry.boundingSphere) im.geometry.computeBoundingSphere();
    const geoR = im.geometry.boundingSphere!.radius;
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, mat);
      pos.setFromMatrixPosition(mat.premultiply(im.matrixWorld));
      const k = `${Math.floor(pos.x / INSTANCE_CELL)},${Math.floor(pos.z / INSTANCE_CELL)}`;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(i);
    }
    for (const ids of buckets.values()) {
      const out = new THREE.InstancedMesh(im.geometry, im.material, ids.length);
      out.castShadow = im.castShadow; out.receiveShadow = im.receiveShadow;
      out.frustumCulled = im.frustumCulled; out.renderOrder = im.renderOrder;
      out.userData = { ...im.userData };
      let maxScale = 0, cx = 0, cz = 0;
      ids.forEach((src, j) => {
        im.getMatrixAt(src, mat);
        mat.premultiply(im.matrixWorld);
        out.setMatrixAt(j, mat);
        if (im.instanceColor) { im.getColorAt(src, _col); out.setColorAt(j, _col); }
        pos.setFromMatrixPosition(mat); cx += pos.x; cz += pos.z;
        scl.setFromMatrixScale(mat); maxScale = Math.max(maxScale, scl.x, scl.y, scl.z);
      });
      out.instanceMatrix.needsUpdate = true;
      if (out.instanceColor) out.instanceColor.needsUpdate = true;
      out.computeBoundingBox(); out.computeBoundingSphere();
      const view = opts.viewDistance ?? tierFor(geoR * maxScale);
      const part = this.partAt(cx / ids.length, cz / ids.length, INSTANCE_CELL, view, `${opts.layer ?? 'static'}:inst`);
      part.group.add(out);
      touched.add(part);
      if (key) this.keyed.get(key)!.push(out);
    }
    im.removeFromParent();
  }

  private partAt(x: number, z: number, cell: number, view: number, layer: string): ChunkPart {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    const key = `${cell}:${cx},${cz}|${view}|${layer}`;
    let p = this.parts.get(key);
    if (!p) {
      const group = new THREE.Group();
      group.name = `chunk ${key}`;
      group.matrixAutoUpdate = false;
      const leave = view + HYSTERESIS;
      p = { key, group, viewDistance: view, enter2: view * view, leave2: leave * leave,
        // Bounds start empty and grow to what the part holds (fitBounds), so view tests are tight.
        minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity,
        minY: Infinity, maxY: -Infinity, box: new THREE.Box3(), casts: false,
        state: 'off', compiled: !this.compiler, warmed: false, wanted: false };
      this.parts.set(key, p);
      this.list.push(p);
    }
    return p;
  }

  /** Grows a part's bounds to cover everything in it (objects can overhang their cell). */
  private fitBounds(p: ChunkPart) {
    p.group.updateMatrixWorld(true);
    box.setFromObject(p.group);
    if (box.isEmpty()) return;
    p.minX = Math.min(p.minX, box.min.x); p.minZ = Math.min(p.minZ, box.min.z);
    p.maxX = Math.max(p.maxX, box.max.x); p.maxZ = Math.max(p.maxZ, box.max.z);
    p.minY = Math.min(p.minY, box.min.y); p.maxY = Math.max(p.maxY, box.max.y);
    p.box.min.set(p.minX, p.minY, p.minZ); p.box.max.set(p.maxX, p.maxY, p.maxZ);
    let casts = false;
    p.group.traverse(o => { if ((o as THREE.Mesh).isMesh && o.castShadow) casts = true; });
    p.casts = casts;
  }

  // ---------------------------------------------------------------- per frame

  private inRange(p: ChunkPart, x: number, z: number, r2: number) {
    const dx = x < p.minX ? p.minX - x : x > p.maxX ? x - p.maxX : 0;
    const dz = z < p.minZ ? p.minZ - z : z > p.maxZ ? z - p.maxZ : 0;
    return dx * dx + dz * dz < r2;
  }

  /**
   * Call once per frame with the point the player cares about (the character,
   * the vehicle being driven, or the build-mode target). The first call
   * attaches everything in range immediately so the opening frame is complete.
   */
  update(focus: THREE.Vector3, dt: number) {
    this.sinceRefresh += dt;
    const dx = focus.x - this.last.x, dz = focus.z - this.last.z;
    if (this.primed && dx * dx + dz * dz < MOVE_EPS * MOVE_EPS && this.sinceRefresh < REFRESH_SEC) { this.pump(); return; }
    this.sinceRefresh = 0;
    this.last.copy(focus);
    for (const p of this.list) {
      // Enter at the view distance, leave only past view distance + HYSTERESIS.
      p.wanted = this.inRange(p, focus.x, focus.z, p.state === 'off' ? p.enter2 : p.leave2);
      if (p.wanted) {
        if (p.state === 'off') {
          if (!this.primed) this.show(p);
          else { p.state = 'queued'; this.queue.push(p); }
        }
      } else if (p.state === 'on') {
        p.group.removeFromParent();
        p.state = 'off';
      }
    }
    if (this.primed) this.queue.sort((a, b) => this.dist2(a, focus) - this.dist2(b, focus));
    this.primed = true;
    this.pump();
  }

  private dist2(p: ChunkPart, f: THREE.Vector3) {
    const dx = f.x < p.minX ? p.minX - f.x : f.x > p.maxX ? f.x - p.maxX : 0;
    const dz = f.z < p.minZ ? p.minZ - f.z : f.z > p.maxZ ? f.z - p.maxZ : 0;
    return dx * dx + dz * dz;
  }

  private show(p: ChunkPart) {
    if (p.group.parent !== this.root) this.root.add(p.group);
    p.state = 'on';
    p.compiled = true;
    if (!p.warmed) this.warmQueue.push(p);
  }

  /** Works through the queue: compile new parts in the background, attach ready ones a few per frame. */
  private pump() {
    let attached = 0;
    while (this.queue.length && attached < ATTACH_PER_FRAME) {
      const p = this.queue[0];
      if (!p.wanted || p.state !== 'queued') { this.queue.shift(); if (p.state === 'queued') p.state = 'off'; continue; }
      if (p.compiled || !this.compiler || !this.camera) { this.queue.shift(); this.show(p); attached++; continue; }
      if (this.compiling >= MAX_COMPILES) break;
      this.queue.shift();
      p.state = 'compiling';
      this.compiling++;
      compileWhole(this.compiler, p.group, this.camera, this.scene)
        .catch(() => { /* fall through and draw it anyway; the renderer compiles on first use */ })
        .finally(() => {
          this.compiling--;
          p.compiled = true;
          if (p.state !== 'compiling') return;
          if (p.wanted) { p.state = 'queued'; this.queue.unshift(p); } else p.state = 'off';
        });
    }
  }

  // ---------------------------------------------------------------- view culling

  /**
   * Strict per-part frustum culling, run every frame after the camera moved.
   * A part that is attached (in range) but neither in the camera's view nor
   * inside the sun's shadow box is made invisible, so three.js doesn't even
   * walk its children in the main or the shadow pass. Parts in the shadow box
   * stay on when they cast shadows, because their shadows can fall into view
   * from behind the camera. Margins keep edges from popping.
   */
  cull(camera: THREE.Camera, sun: THREE.DirectionalLight | null) {
    camera.updateMatrixWorld();
    _projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _view.setFromProjectionMatrix(_projView);
    let shadow: THREE.Frustum | null = null;
    if (sun?.castShadow) {
      sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
      (sun.shadow as unknown as { updateMatrices(l: THREE.Light): void }).updateMatrices(sun);
      shadow = sun.shadow.getFrustum() as THREE.Frustum;
    }
    this.endWarm();
    let shown = 0, hidden = 0;
    for (const p of this.list) {
      if (p.state !== 'on') continue;
      _grown.copy(p.box).expandByScalar(CULL_MARGIN);
      const vis = _view.intersectsBox(_grown) || (p.casts && !!shadow && shadow.intersectsBox(_grown));
      if (p.group.visible !== vis) p.group.visible = vis;
      if (vis) shown++; else hidden++;
    }
    this.culled = hidden;
    this.beginWarm();
    return shown;
  }

  /**
   * Picks up to WARM_PER_FRAME attached parts that were never drawn and draws
   * them this frame whatever the camera faces: the part is made visible and
   * three.js's per-mesh frustum culling is switched off for its meshes.
   * Off-screen triangles are clipped, so the cost is the pipeline builds that
   * would otherwise land in one frame as the camera turns.
   */
  private beginWarm() {
    let n = 0;
    while (this.warmQueue.length && n < WARM_PER_FRAME) {
      const p = this.warmQueue.shift()!;
      if (p.warmed || p.state !== 'on') continue;
      p.warmed = true;
      p.group.visible = true;
      p.group.traverse(o => { if (o.frustumCulled) { o.frustumCulled = false; this.warmCulled.push(o); } });
      this.warming.push(p);
      n++;
    }
  }

  /** Restores frustum culling on the parts warmed last frame. */
  private endWarm() {
    if (!this.warming.length) return;
    for (const o of this.warmCulled) o.frustumCulled = true;
    this.warmCulled.length = 0;
    this.warming.length = 0;
  }

  private culled = 0;

  /** Counts for the dev overlay and tests. */
  stats() {
    let on = 0, objects = 0, visible = 0;
    for (const p of this.list) if (p.state === 'on') { on++; objects += p.group.children.length; if (p.group.visible) visible++; }
    return { parts: this.list.length, on, visible, frustumCulled: this.culled, queued: this.queue.length, compiling: this.compiling, warming: this.warmQueue.length, attachedObjects: objects };
  }
}

