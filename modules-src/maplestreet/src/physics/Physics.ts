/**
 * Rapier world wrapper.
 *  - fixed-step stepping (driven by FixedLoop at 60 Hz)
 *  - render interpolation for tracked bodies (prev/curr pose, lerp by alpha)
 *  - collision-group matrix
 *  - per-lot static collider sets that are swapped whenever a house changes
 *  - static collider streaming: the town has ~10,000 static colliders, and
 *    Rapier pays for every enabled one on every step (broad phase, narrow-phase
 *    pairs with the ground, the scene-query tree). Only the ones within
 *    STREAM_RADIUS of something that moves (you, your vehicles, the camera)
 *    are enabled; the rest wait, disabled, until something comes near.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';

/** Collision membership bits. */
export const CG = {
  GROUND: 1 << 0,
  STATIC: 1 << 1,     // houses, curbs, trees, buildings
  VEHICLE: 1 << 2,
  CHARACTER: 1 << 3,
  REMOTE: 1 << 4,     // kinematic proxies of other players' vehicles
  PROP: 1 << 5,       // furniture
  DECK: 1 << 6,       // trailer beds: the one vehicle surface wheels may roll onto
} as const;

/** Rapier InteractionGroups = (membership << 16) | filter. */
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);

/**
 * Collision matrix (who collides with whom; wheel rays skip vehicles):
 *            GROUND STATIC VEHICLE CHARACTER REMOTE PROP
 * VEHICLE      ✔      ✔       ✔        ✔       ✔     ✔
 * CHARACTER    ✔      ✔       ✔        ·       ✔     ✔
 * REMOTE       ·      ·       ✔        ✔       ·     ·
 */
export const MASK = {
  ground: groups(CG.GROUND, 0xffff),
  static: groups(CG.STATIC, 0xffff),
  prop: groups(CG.PROP, CG.VEHICLE | CG.CHARACTER),
  vehicle: groups(CG.VEHICLE, CG.GROUND | CG.STATIC | CG.VEHICLE | CG.CHARACTER | CG.REMOTE | CG.PROP),
  trailer: groups(CG.VEHICLE | CG.DECK, CG.GROUND | CG.STATIC | CG.VEHICLE | CG.CHARACTER | CG.REMOTE | CG.PROP),
  character: groups(CG.CHARACTER, CG.GROUND | CG.STATIC | CG.VEHICLE | CG.REMOTE | CG.PROP),
  remote: groups(CG.REMOTE, CG.VEHICLE | CG.CHARACTER),
  remoteTrailer: groups(CG.REMOTE | CG.DECK, CG.VEHICLE | CG.CHARACTER),
  /** Wheels stand on the ground, kerbs, props and trailer beds, never on another car, so cars can't climb onto each other. */
  wheelRay: groups(CG.VEHICLE, CG.GROUND | CG.STATIC | CG.PROP | CG.DECK),
  cameraRay: groups(CG.CHARACTER, CG.GROUND | CG.STATIC),
  pick: groups(CG.CHARACTER, CG.GROUND | CG.STATIC | CG.PROP),
};

export interface StaticBox { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; rotY?: number; prop?: boolean }

/** Static colliders farther than this from every focus point are disabled. */
export const STREAM_RADIUS = 160;
/** Extra distance before a collider that is on is switched off again, so edges don't flicker. */
const STREAM_HYSTERESIS = 30;
const STREAM_CELL = 64;
/** Seconds between streaming passes, unless a focus point jumped (teleport) or colliders were added. */
const STREAM_EVERY = 0.2;
const STREAM_JUMP = 40;

interface StaticEntry { c: RAPIER.Collider; x: number; z: number; r: number; on: boolean; cell: string }

interface Tracked {
  body: RAPIER.RigidBody;
  obj: THREE.Object3D;
  prevP: THREE.Vector3; currP: THREE.Vector3;
  prevQ: THREE.Quaternion; currQ: THREE.Quaternion;
}

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

  /** Register a callback that runs before every physics step. Returns an unsubscribe fn. */
  onPreStep(fn: (dt: number) => void): () => void {
    this.preStep.push(fn);
    return () => { this.preStep = this.preStep.filter(f => f !== fn); };
  }

  step(dt: number) {
    for (const t of this.tracked) { t.prevP.copy(t.currP); t.prevQ.copy(t.currQ); }
    for (const fn of this.preStep) fn(dt);
    this.world.timestep = dt;
    this.world.step();
    for (const t of this.tracked) {
      const p = t.body.translation(), q = t.body.rotation();
      t.currP.set(p.x, p.y, p.z); t.currQ.set(q.x, q.y, q.z, q.w);
    }
  }

  /** Writes interpolated poses into the tracked Object3Ds. */
  interpolate(alpha: number) {
    for (const t of this.tracked) {
      t.obj.position.lerpVectors(t.prevP, t.currP, alpha);
      t.obj.quaternion.slerpQuaternions(t.prevQ, t.currQ, alpha);
    }
  }

  track(body: RAPIER.RigidBody, obj: THREE.Object3D) {
    const p = body.translation(), q = body.rotation();
    const P = new THREE.Vector3(p.x, p.y, p.z), Q = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    this.tracked.push({ body, obj, prevP: P.clone(), currP: P, prevQ: Q.clone(), currQ: Q });
  }

  /** Call after teleporting a body so interpolation doesn't smear across the jump. */
  snapTracked(body: RAPIER.RigidBody) {
    const t = this.tracked.find(x => x.body === body);
    if (!t) return;
    const p = body.translation(), q = body.rotation();
    t.currP.set(p.x, p.y, p.z); t.prevP.copy(t.currP);
    t.currQ.set(q.x, q.y, q.z, q.w); t.prevQ.copy(t.currQ);
  }

  untrack(body: RAPIER.RigidBody) { this.tracked = this.tracked.filter(t => t.body !== body); }

  /**
   * A vehicle body's collider: a box with rounded edges, so two vehicles that
   * touch slide off each other instead of snagging on corners.
   */
  vehicleShape(hx: number, hy: number, hz: number) {
    const r = Math.min(0.12, hx * 0.2, hy * 0.45, hz * 0.2);
    return RAPIER.ColliderDesc.roundCuboid(hx - r, hy - r, hz - r, r);
  }

  addGround(halfSize: number) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(halfSize, 0.5, halfSize).setFriction(1.0).setCollisionGroups(MASK.ground), body);
  }

  // ---------------------------------------------------------------- collider streaming

  private register(c: RAPIER.Collider, x: number, z: number, r: number) {
    const cell = `${Math.floor(x / STREAM_CELL)},${Math.floor(z / STREAM_CELL)}`;
    const e: StaticEntry = { c, x, z, r, on: true, cell };
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

  /** Enables every static collider in the cells within `reach` of the points. */
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

  /**
   * Keeps static colliders enabled only near the focus points (called every
   * fixed step; does real work every STREAM_EVERY seconds, at once after a
   * teleport, and whenever colliders were added).
   */
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
    // Deleting the current entry while iterating a Set is safe and avoids copying ~3,000 entries.
    for (const e of this.active) if (!this.near(e, points, STREAM_RADIUS + STREAM_HYSTERESIS)) this.setOn(e, false);
    this.enableAround(points, STREAM_RADIUS);
  }

  /** Switches on the static colliders around a point now (for a query far from the player). */
  wake(x: number, z: number, reach = 30) {
    if (this.enableAround([{ x, z }], reach)) this.world.updateSceneQueries?.();
  }

  /** How many static colliders are switched on, out of how many (dev overlay and tests). */
  streamStats() { return { on: this.active.size, total: this.byCollider.size }; }

  addStaticBox(b: StaticBox): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
      .setTranslation(b.cx, b.cy, b.cz)
      .setFriction(0.8)
      .setCollisionGroups(b.prop ? MASK.prop : MASK.static);
    if (b.rotY) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rotY);
      desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
    return this.register(this.world.createCollider(desc), b.cx, b.cz, Math.hypot(b.hx, b.hz));
  }

  addStaticCylinder(x: number, y: number, z: number, halfH: number, r: number) {
    return this.register(this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfH, r).setTranslation(x, y, z).setCollisionGroups(MASK.static)), x, z, r);
  }

  /** Replace every collider belonging to one lot (called after each rebuild). */
  setLotColliders(lotId: string, boxes: StaticBox[]) {
    for (const c of this.lotColliders.get(lotId) ?? []) { this.unregister(c); this.world.removeCollider(c, false); }
    this.lotColliders.set(lotId, boxes.map(b => this.addStaticBox(b)));
  }

  /** Distance along a ray to the first static hit, or `max`. */
  private ray: RAPIER.Ray | null = null;
  rayDistance(origin: THREE.Vector3, dir: THREE.Vector3, max: number, mask = MASK.cameraRay): number {
    // One Ray reused for every query (the camera casts one each frame).
    const ray = this.ray ??= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    ray.origin.x = origin.x; ray.origin.y = origin.y; ray.origin.z = origin.z;
    ray.dir.x = dir.x; ray.dir.y = dir.y; ray.dir.z = dir.z;
    const hit = this.world.castRay(ray, max, true, undefined, mask);
    if (!hit) return max;
    const h = hit as unknown as { timeOfImpact?: number; toi?: number };
    return h.timeOfImpact ?? h.toi ?? max;
  }
}
