/**
 * Rapier world for Fox Lake's town (first written for Fox Plains 2), the same rules as Fox Plains so a car
 * handles identically in both: 60 Hz fixed steps, render interpolation of
 * tracked bodies, the same collision-group matrix, per-lot collider sets that
 * are swapped when a house changes, and static colliders streamed on only
 * near things that move (STREAM_RADIUS of you, your vehicles and the camera).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';

export const CG = {
  GROUND: 1 << 0, STATIC: 1 << 1, VEHICLE: 1 << 2, CHARACTER: 1 << 3, REMOTE: 1 << 4, PROP: 1 << 5, DECK: 1 << 6,
} as const;

export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);

export const MASK = {
  ground: groups(CG.GROUND, 0xffff),
  static: groups(CG.STATIC, 0xffff),
  prop: groups(CG.PROP, CG.VEHICLE | CG.CHARACTER),
  vehicle: groups(CG.VEHICLE, CG.GROUND | CG.STATIC | CG.VEHICLE | CG.CHARACTER | CG.REMOTE | CG.PROP),
  trailer: groups(CG.VEHICLE | CG.DECK, CG.GROUND | CG.STATIC | CG.VEHICLE | CG.CHARACTER | CG.REMOTE | CG.PROP),
  character: groups(CG.CHARACTER, CG.GROUND | CG.STATIC | CG.VEHICLE | CG.REMOTE | CG.PROP),
  remote: groups(CG.REMOTE, CG.VEHICLE | CG.CHARACTER),
  remoteTrailer: groups(CG.REMOTE | CG.DECK, CG.VEHICLE | CG.CHARACTER),
  wheelRay: groups(CG.VEHICLE, CG.GROUND | CG.STATIC | CG.PROP | CG.DECK),
  cameraRay: groups(CG.CHARACTER, CG.GROUND | CG.STATIC),
  pick: groups(CG.CHARACTER, CG.GROUND | CG.STATIC | CG.PROP),
};

export interface StaticBox { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; rotY?: number; prop?: boolean }

export const STREAM_RADIUS = 72;
const STREAM_HYSTERESIS = 20;
const STREAM_CELL = 64;
const STREAM_EVERY = 0.2;
const STREAM_JUMP = 40;

/** A static solid as a walker sees it: a box (turned `rotY` about y) or an upright cylinder. */
export type Solid =
  | { kind: 'box'; cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; rotY: number }
  | { kind: 'cyl'; cx: number; cy: number; cz: number; hy: number; r: number };

interface StaticEntry { c: RAPIER.Collider; x: number; z: number; r: number; on: boolean; cell: string; solid: Solid | null }
interface Tracked { body: RAPIER.RigidBody; obj: TransformNode; prevP: Vector3; currP: Vector3; prevQ: Quaternion; currQ: Quaternion }


export class Physics {
  readonly R = RAPIER;
  readonly world: RAPIER.World;
  private tracked: Tracked[] = [];
  private lotColliders = new Map<string, RAPIER.Collider[]>();
  private preStep: ((dt: number) => void)[] = [];
  private statics = new Map<string, Set<StaticEntry>>();
  private byCollider = new Map<number, StaticEntry>();
  private active = new Set<StaticEntry>();
  private fresh: StaticEntry[] = [];
  private streamed = false;
  private sinceStream = 0;
  private lastFocus: { x: number; z: number }[] = [];

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.integrationParameters.numSolverIterations = 8;
  }

  onPreStep(fn: (dt: number) => void): () => void {
    this.preStep.push(fn);
    return () => { this.preStep = this.preStep.filter(f => f !== fn); };
  }

  step(dt: number) {
    for (const t of this.tracked) { t.prevP.copyFrom(t.currP); t.prevQ.copyFrom(t.currQ); }
    for (const fn of this.preStep) fn(dt);
    this.world.timestep = dt;
    this.world.step();
    for (const t of this.tracked) {
      const p = t.body.translation(), q = t.body.rotation();
      t.currP.set(p.x, p.y, p.z); t.currQ.set(q.x, q.y, q.z, q.w);
    }
  }

  interpolate(alpha: number) {
    for (const t of this.tracked) {
      Vector3.LerpToRef(t.prevP, t.currP, alpha, t.obj.position);
      Quaternion.SlerpToRef(t.prevQ, t.currQ, alpha, t.obj.rotationQuaternion!);
    }
  }

  track(body: RAPIER.RigidBody, obj: TransformNode) {
    const p = body.translation(), q = body.rotation();
    const P = new Vector3(p.x, p.y, p.z), Q = new Quaternion(q.x, q.y, q.z, q.w);
    this.tracked.push({ body, obj, prevP: P.clone(), currP: P, prevQ: Q.clone(), currQ: Q });
    obj.position.copyFrom(P);
    obj.rotationQuaternion = Q.clone();
  }

  snapTracked(body: RAPIER.RigidBody) {
    const t = this.tracked.find(x => x.body === body);
    if (!t) return;
    const p = body.translation(), q = body.rotation();
    t.currP.set(p.x, p.y, p.z); t.prevP.copyFrom(t.currP);
    t.currQ.set(q.x, q.y, q.z, q.w); t.prevQ.copyFrom(t.currQ);
  }

  untrack(body: RAPIER.RigidBody) { this.tracked = this.tracked.filter(t => t.body !== body); }

  vehicleShape(hx: number, hy: number, hz: number) {
    const r = Math.min(0.12, hx * 0.2, hy * 0.45, hz * 0.2);
    return RAPIER.ColliderDesc.roundCuboid(hx - r, hy - r, hz - r, r);
  }

  addGround(halfSize: number) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(halfSize, 0.5, halfSize).setFriction(1.0).setCollisionGroups(MASK.ground), body);
  }

  private register(c: RAPIER.Collider, x: number, z: number, r: number, solid: Solid | null = null) {
    const cell = `${Math.floor(x / STREAM_CELL)},${Math.floor(z / STREAM_CELL)}`;
    const e: StaticEntry = { c, x, z, r, on: true, cell, solid };
    let set = this.statics.get(cell);
    if (!set) this.statics.set(cell, (set = new Set()));
    set.add(e);
    this.byCollider.set(c.handle, e);
    this.active.add(e);
    this.fresh.push(e);
    return c;
  }

  private unregister(c: RAPIER.Collider) {
    const e = this.byCollider.get(c.handle);
    if (!e) return;
    this.byCollider.delete(c.handle);
    this.statics.get(e.cell)?.delete(e);
    this.active.delete(e);
  }

  private setOn(e: StaticEntry, on: boolean) {
    if (e.on === on) return;
    e.on = on;
    e.c.setEnabled(on);
    if (on) this.active.add(e); else this.active.delete(e);
  }

  private near(e: StaticEntry, pts: readonly { x: number; z: number }[], reach: number) {
    for (const p of pts) {
      const d = reach + e.r, dx = e.x - p.x, dz = e.z - p.z;
      if (dx * dx + dz * dz < d * d) return true;
    }
    return false;
  }

  private enableAround(pts: readonly { x: number; z: number }[], reach: number) {
    let changed = false;
    for (const p of pts) {
      const r = reach + STREAM_CELL;
      const x0 = Math.floor((p.x - r) / STREAM_CELL), x1 = Math.floor((p.x + r) / STREAM_CELL);
      const z0 = Math.floor((p.z - r) / STREAM_CELL), z1 = Math.floor((p.z + r) / STREAM_CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const set = this.statics.get(`${cx},${cz}`);
        if (set) for (const e of set) if (!e.on && this.near(e, [p], reach)) { this.setOn(e, true); changed = true; }
      }
    }
    return changed;
  }

  stream(points: readonly { x: number; z: number }[], dt: number) {
    if (!points.length) return;
    this.sinceStream += dt;
    let jumped = points.length !== this.lastFocus.length;
    for (let i = 0; !jumped && i < points.length; i++) jumped = Math.hypot(points[i].x - this.lastFocus[i].x, points[i].z - this.lastFocus[i].z) > STREAM_JUMP;
    if (this.streamed && !jumped && !this.fresh.length && this.sinceStream < STREAM_EVERY) return;
    this.sinceStream = 0;
    this.streamed = true;
    this.lastFocus.length = points.length;
    for (let i = 0; i < points.length; i++) { const f = this.lastFocus[i] ??= { x: 0, z: 0 }; f.x = points[i].x; f.z = points[i].z; }
    for (const e of this.fresh) if (this.byCollider.has(e.c.handle) && !this.near(e, points, STREAM_RADIUS)) this.setOn(e, false);
    this.fresh.length = 0;
    for (const e of this.active) if (!this.near(e, points, STREAM_RADIUS + STREAM_HYSTERESIS)) this.setOn(e, false);
    this.enableAround(points, STREAM_RADIUS);
  }

  wake(x: number, z: number, reach = 30) {
    if (this.enableAround([{ x, z }], reach)) this.world.updateSceneQueries?.();
  }

  streamStats() { return { on: this.active.size, total: this.byCollider.size }; }

  addStaticBox(b: StaticBox): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(Math.max(0.01, b.hx), Math.max(0.01, b.hy), Math.max(0.01, b.hz))
      .setTranslation(b.cx, b.cy, b.cz)
      .setFriction(0.8)
      .setCollisionGroups(b.prop ? MASK.prop : MASK.static);
    if (b.rotY) {
      const s = Math.sin(b.rotY / 2), c = Math.cos(b.rotY / 2);
      desc.setRotation({ x: 0, y: s, z: 0, w: c });
    }
    const solid: Solid | null = b.prop ? null : { kind: 'box', cx: b.cx, cy: b.cy, cz: b.cz, hx: b.hx, hy: b.hy, hz: b.hz, rotY: b.rotY ?? 0 };
    return this.register(this.world.createCollider(desc), b.cx, b.cz, Math.hypot(b.hx, b.hz), solid);
  }

  /** A box from min/max corners. */
  addStaticAABB(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, prop = false) {
    return this.addStaticBox({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, hx: Math.abs(x1 - x0) / 2, hy: Math.abs(y1 - y0) / 2, hz: Math.abs(z1 - z0) / 2, prop });
  }

  addStaticCylinder(x: number, y: number, z: number, halfH: number, r: number) {
    return this.register(this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfH, r).setTranslation(x, y, z).setCollisionGroups(MASK.static)), x, z, r, { kind: 'cyl', cx: x, cy: y, cz: z, hy: halfH, r });
  }

  /**
   * A fixed heightfield: `heights[i + j * (n + 1)]` is the height at column i
   * (along +x) and row j (along +z) of an n x n grid `size` metres across,
   * centred on (cx, cz).
   */
  addHeightfield(n: number, size: number, heights: Float32Array, cx: number, cz: number) {
    const cols = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) cols[i * (n + 1) + j] = heights[i + j * (n + 1)];
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, 0, cz));
    this.world.createCollider(RAPIER.ColliderDesc.heightfield(n, n, cols, { x: size, y: 1, z: size }).setFriction(1.0).setCollisionGroups(MASK.ground), body);
  }

  /** Static solids that might touch a circle of radius `r` around (x, z), on or off. */
  solidsNear(x: number, z: number, r: number, out: Solid[] = []): Solid[] {
    out.length = 0;
    const x0 = Math.floor((x - r - 12) / STREAM_CELL), x1 = Math.floor((x + r + 12) / STREAM_CELL);
    const z0 = Math.floor((z - r - 12) / STREAM_CELL), z1 = Math.floor((z + r + 12) / STREAM_CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const set = this.statics.get(`${cx},${cz}`);
      if (!set) continue;
      for (const e of set) if (e.solid && (e.x - x) ** 2 + (e.z - z) ** 2 < (e.r + r) ** 2) out.push(e.solid);
    }
    return out;
  }

  private solidScratch: Solid[] = [];

  /**
   * Pushes a standing walker (feet at `y`, `height` tall, radius `r`) out of
   * every static solid it overlaps, in the horizontal plane. Returns true when
   * it moved. Low solids (a curb, a step under 0.45 m) don't block.
   */
  pushOut(p: { x: number; z: number }, y: number, r: number, height = 1.75): boolean {
    let moved = false;
    for (const s of this.solidsNear(p.x, p.z, r, this.solidScratch)) {
      const top = s.cy + s.hy, bottom = s.cy - s.hy;
      if (top < y + 0.45 || bottom > y + height) continue;
      if (s.kind === 'cyl') {
        const dx = p.x - s.cx, dz = p.z - s.cz, d = Math.hypot(dx, dz), min = s.r + r;
        if (d < min && d > 1e-5) { p.x = s.cx + (dx / d) * min; p.z = s.cz + (dz / d) * min; moved = true; }
        continue;
      }
      const c = Math.cos(s.rotY), sn = Math.sin(s.rotY);
      const dx = p.x - s.cx, dz = p.z - s.cz;
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
      const px = s.hx + r - Math.abs(lx), pz = s.hz + r - Math.abs(lz);
      if (px <= 0 || pz <= 0) continue;
      let nx = lx, nz = lz;
      if (px < pz) nx = Math.sign(lx || 1) * (s.hx + r); else nz = Math.sign(lz || 1) * (s.hz + r);
      p.x = s.cx + nx * c + nz * sn;
      p.z = s.cz - nx * sn + nz * c;
      moved = true;
    }
    return moved;
  }

  private walkerShape: RAPIER.Capsule | null = null;
  private walkerKey = '';
  private readonly vehicleHits: RAPIER.Collider[] = [];

  /**
   * Pushes a standing walker (feet at `y`, `height` tall, radius `r`) out of
   * every vehicle it overlaps, yours and the neighbours' (vehicles move, so
   * they aren't among the static solids), in the horizontal plane. Returns
   * true when it moved. A walker standing on a vehicle isn't pushed off.
   */
  pushOutVehicles(p: { x: number; z: number }, y: number, r: number, height = 1.75): boolean {
    const half = Math.max(0.05, height / 2 - r);
    const key = `${half}|${r}`;
    if (!this.walkerShape || this.walkerKey !== key) { this.walkerShape = new RAPIER.Capsule(half, r); this.walkerKey = key; }
    const shape = this.walkerShape;
    const pos = { x: p.x, y: y + height / 2, z: p.z }, rot = { x: 0, y: 0, z: 0, w: 1 };
    const hits = this.vehicleHits;
    hits.length = 0;
    this.world.intersectionsWithShape(pos, rot, shape, c => { hits.push(c); return true; }, undefined, groups(CG.CHARACTER, CG.VEHICLE | CG.REMOTE));
    let moved = false;
    for (const c of hits) {
      const contact = c.contactShape(shape, pos, rot, 0);
      if (!contact || contact.distance >= 0) continue;
      const n = contact.normal1, h = Math.hypot(n.x, n.z);
      if (h < 0.35) continue;
      const push = Math.min(1, -contact.distance / h);
      pos.x += (n.x / h) * push;
      pos.z += (n.z / h) * push;
      moved = true;
    }
    p.x = pos.x;
    p.z = pos.z;
    return moved;
  }

  /** True when a circle of radius `r` at (x, z), from `y` up, overlaps a static solid taller than a curb. */
  blocked(x: number, z: number, y: number, r: number): boolean {
    const probe = { x, z };
    return this.pushOut(probe, y, r, 1.4);
  }

  setLotColliders(lotId: string, boxes: StaticBox[]) {
    for (const c of this.lotColliders.get(lotId) ?? []) { this.unregister(c); this.world.removeCollider(c, false); }
    this.lotColliders.set(lotId, boxes.map(b => this.addStaticBox(b)));
  }

  private ray: RAPIER.Ray | null = null;
  rayDistance(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, max: number, mask = MASK.cameraRay): number {
    const ray = this.ray ??= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    ray.origin.x = origin.x; ray.origin.y = origin.y; ray.origin.z = origin.z;
    ray.dir.x = dir.x; ray.dir.y = dir.y; ray.dir.z = dir.z;
    const hit = this.world.castRay(ray, max, true, undefined, mask);
    if (!hit) return max;
    const h = hit as unknown as { timeOfImpact?: number; toi?: number };
    return h.timeOfImpact ?? h.toi ?? max;
  }
}
