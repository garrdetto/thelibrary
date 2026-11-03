/**
 * Rapier world wrapper.
 *  - fixed-step stepping (driven by FixedLoop at 60 Hz)
 *  - render interpolation for tracked bodies (prev/curr pose, lerp by alpha)
 *  - collision-group matrix
 *  - per-lot static collider sets that are swapped whenever a house changes
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

  addStaticBox(b: StaticBox): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
      .setTranslation(b.cx, b.cy, b.cz)
      .setFriction(0.8)
      .setCollisionGroups(b.prop ? MASK.prop : MASK.static);
    if (b.rotY) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rotY);
      desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
    return this.world.createCollider(desc);
  }

  addStaticCylinder(x: number, y: number, z: number, halfH: number, r: number) {
    return this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfH, r).setTranslation(x, y, z).setCollisionGroups(MASK.static));
  }

  /** Replace every collider belonging to one lot (called after each rebuild). */
  setLotColliders(lotId: string, boxes: StaticBox[]) {
    for (const c of this.lotColliders.get(lotId) ?? []) this.world.removeCollider(c, false);
    this.lotColliders.set(lotId, boxes.map(b => this.addStaticBox(b)));
  }

  /** Distance along a ray to the first static hit, or `max`. */
  rayDistance(origin: THREE.Vector3, dir: THREE.Vector3, max: number, mask = MASK.cameraRay): number {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRay(ray, max, true, undefined, mask);
    if (!hit) return max;
    const h = hit as unknown as { timeOfImpact?: number; toi?: number };
    return h.timeOfImpact ?? h.toi ?? max;
  }
}
