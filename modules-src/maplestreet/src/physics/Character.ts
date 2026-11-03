/**
 * On-foot player: kinematic capsule driven by Rapier's KinematicCharacterController
 * (auto-step for porch steps and foundations, slope limits, snap-to-ground,
 * pushes dynamic bodies), plus the player's avatar.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { MASK, Physics } from './Physics';
import { AvatarModel } from '../avatar/AvatarModel';
import { gaitFrequency, gaitPose } from '../avatar/Gait';
import { loadBody } from '../avatar/AvatarAssets';
import { Body, defaultLook, Look } from '../../shared/Wardrobe';

const HALF_H = 0.55, RADIUS = 0.28;
export const EYE_OFFSET = HALF_H + RADIUS;   // body center → feet

/** Simple stand-in body, shown while the scanned model streams in (or if it can't load). */
class StandIn {
  readonly root = new THREE.Group();
  private legL: THREE.Group; private legR: THREE.Group;
  private armL: THREE.Group; private armR: THREE.Group;
  private phase = 0;
  private cloth: THREE.MeshStandardMaterial;
  private pants: THREE.MeshStandardMaterial;
  private hair: THREE.MeshStandardMaterial;
  private skin: THREE.MeshStandardMaterial;
  readonly hipY = 0.9;

  constructor(look: Look) {
    this.skin = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.7 });
    this.cloth = new THREE.MeshStandardMaterial({ color: look.topColor, roughness: 0.85 });
    this.pants = new THREE.MeshStandardMaterial({ color: look.pantsColor, roughness: 0.9 });
    this.hair = new THREE.MeshStandardMaterial({ color: look.hairColor, roughness: 0.8 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
    };
    const limb = (x: number, y: number) => { const g = new THREE.Group(); g.position.set(x, y, 0); this.root.add(g); return g; };
    add(this.root, new THREE.CapsuleGeometry(0.2, 0.42, 6, 12), this.cloth, 0, 1.22, 0);
    add(this.root, new THREE.SphereGeometry(0.13, 20, 16), this.skin, 0, 1.68, 0);
    add(this.root, new THREE.SphereGeometry(0.135, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2), this.hair, 0, 1.7, -0.01);
    add(this.root, new THREE.CylinderGeometry(0.055, 0.06, 0.1, 10), this.skin, 0, 1.53, 0);
    this.legL = limb(-0.1, 0.92); this.legR = limb(0.1, 0.92);
    for (const leg of [this.legL, this.legR]) {
      add(leg, new THREE.CapsuleGeometry(0.075, 0.68, 4, 10), this.pants, 0, -0.42, 0);
      add(leg, new THREE.BoxGeometry(0.11, 0.07, 0.25), shoe, 0, -0.88, 0.05);
    }
    this.armL = limb(-0.27, 1.42); this.armR = limb(0.27, 1.42);
    for (const arm of [this.armL, this.armR]) {
      add(arm, new THREE.CapsuleGeometry(0.06, 0.5, 4, 10), this.cloth, 0, -0.3, 0);
      add(arm, new THREE.SphereGeometry(0.055, 10, 8), this.skin, 0, -0.62, 0);
    }
  }

  setLook(look: Look) {
    this.skin.color.set(look.skin); this.cloth.color.set(look.topColor);
    this.pants.color.set(look.pantsColor); this.hair.color.set(look.hairColor);
  }

  animate(dt: number, speed: number, seated: boolean, straddle: boolean) {
    if (seated) {
      this.legL.rotation.x = this.legR.rotation.x = straddle ? -1.05 : -1.45;
      this.legL.rotation.z = straddle ? 0.28 : 0.04; this.legR.rotation.z = straddle ? -0.28 : -0.04;
      this.armL.rotation.x = this.armR.rotation.x = -1.0;
      this.armL.rotation.z = 0.12; this.armR.rotation.z = -0.12;
      return;
    }
    this.legL.rotation.z = this.legR.rotation.z = this.armL.rotation.z = this.armR.rotation.z = 0;
    this.phase = (this.phase + dt * gaitFrequency(speed)) % 1;
    const g = gaitPose(this.phase, speed);
    this.legL.rotation.x = -g.legL.hip; this.legR.rotation.x = -g.legR.hip;
    this.armL.rotation.x = g.armL.arm; this.armR.rotation.x = g.armR.arm;
  }

  dispose() { this.root.traverse(o => (o as THREE.Mesh).geometry?.dispose()); }
}

/**
 * A neighbor's body: the scanned male or female model (skinned, recolored by
 * the wardrobe shader, with procedural hairstyles and hats), animated
 * procedurally: walk cycle, idle breathing, and seated driving poses.
 */
export class Avatar {
  readonly root = new THREE.Group();
  private stub: StandIn | null;
  private model: AvatarModel | null = null;
  private wanted: Body;
  private disposed = false;
  private seat: { x: number; y: number; z: number } | null = null;
  look: Look;
  seated = false;
  private straddle = false;

  /** `look` may be a plain shirt color for neighbors whose look hasn't arrived yet. */
  constructor(look: Look | string) {
    this.look = typeof look === 'string' ? { ...defaultLook('male'), topColor: look } : look;
    this.wanted = this.look.body;
    this.stub = new StandIn(this.look);
    this.root.add(this.stub.root);
    this.loadModel();
  }

  private loadModel() {
    const body = this.wanted;
    loadBody(body).then(asset => {
      if (this.disposed || this.wanted !== body) return;
      this.model?.dispose();
      this.model = new AvatarModel(asset, this.look);
      this.root.add(this.model.root);
      if (this.stub) { this.stub.root.removeFromParent(); this.stub.dispose(); this.stub = null; }
      if (this.seat) this.root.position.y = this.seat.y - this.hipY;
    }).catch(err => console.warn('[avatar] model unavailable, keeping the stand-in:', err));
  }

  private get hipY() { return this.model?.hipY ?? this.stub?.hipY ?? 0.9; }

  setLook(look: Look) {
    this.look = look;
    this.stub?.setLook(look);
    if (look.body !== this.wanted) {
      this.wanted = look.body;
      this.loadModel();
      return;
    }
    this.model?.setLook(look);
  }

  /**
   * Put the avatar in a vehicle seat (or back on its feet with `parent`).
   * Seat = hip position in the vehicle's chassis space; vehicles face +X.
   */
  sitIn(vehicleRoot: THREE.Object3D, seat: { x: number; y: number; z: number; straddle?: boolean }) {
    vehicleRoot.add(this.root);
    this.seat = seat;
    this.root.position.set(seat.x, seat.y - this.hipY, seat.z);
    this.root.rotation.set(0, Math.PI / 2, 0);
    this.straddle = !!seat.straddle;
    this.seated = true;
  }
  standIn(parent: THREE.Object3D, footY: number) {
    parent.add(this.root);
    this.seat = null;
    this.root.position.set(0, footY, 0);
    this.root.rotation.set(0, 0, 0);
    this.seated = false;
  }

  /** speed in m/s; drives stride length and arm swing. */
  animate(dt: number, speed: number, seated = this.seated) {
    if (this.model) this.model.pose(dt, speed, seated, this.straddle);
    else this.stub?.animate(dt, speed, seated, this.straddle);
  }

  dispose() {
    this.disposed = true;
    this.root.removeFromParent();
    this.model?.dispose();
    this.stub?.dispose();
  }
}

export class Character {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private ctrl: RAPIER.KinematicCharacterController;
  readonly avatar: Avatar;
  readonly pivot = new THREE.Group();       // interpolated body center
  yaw = 0;
  private vy = 0;
  speed = 0;
  /** How fast the body actually moved (m/s, horizontal): drives the gait and goes to other players. */
  moveSpeed = 0;
  grounded = false;

  constructor(private physics: Physics, spawn: THREE.Vector3, look: Look, scene: THREE.Scene) {
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + EYE_OFFSET + 0.1, spawn.z));
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(HALF_H, RADIUS).setCollisionGroups(MASK.character), this.body);
    this.ctrl = physics.world.createCharacterController(0.02);
    this.ctrl.enableAutostep(0.4, 0.2, true);
    this.ctrl.enableSnapToGround(0.45);
    this.ctrl.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
    this.ctrl.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.ctrl.setApplyImpulsesToDynamicBodies(true);
    this.ctrl.setCharacterMass(80);

    this.avatar = new Avatar(look);
    this.avatar.root.position.y = -EYE_OFFSET;
    this.pivot.add(this.avatar.root);
    scene.add(this.pivot);
    physics.track(this.body, this.pivot);
  }

  /** Fixed-step movement. `move` is a world-space XZ wish direction (length ≤ 1). */
  step(dt: number, move: THREE.Vector2, run: boolean, jump: boolean) {
    const maxSpeed = run ? 6.0 : 2.6;
    const target = move.lengthSq() > 0 ? maxSpeed * Math.min(1, move.length()) : 0;
    this.speed = THREE.MathUtils.damp(this.speed, target, 10, dt);
    if (move.lengthSq() > 0.0001) {
      const desiredYaw = Math.atan2(move.x, move.y);
      let d = desiredYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 12);
    }
    if (this.grounded) { this.vy = jump ? 4.6 : -1; } else { this.vy -= 9.81 * dt; }

    const dir = move.lengthSq() > 0 ? move.clone().normalize() : move;
    const desired = { x: dir.x * this.speed * dt, y: this.vy * dt, z: dir.y * this.speed * dt };
    this.ctrl.computeColliderMovement(this.collider, desired, undefined, MASK.character);
    const m = this.ctrl.computedMovement();
    this.grounded = this.ctrl.computedGrounded();
    this.moveSpeed = THREE.MathUtils.damp(this.moveSpeed, dt > 0 ? Math.hypot(m.x, m.z) / dt : 0, 14, dt);
    if (this.moveSpeed < 0.03) this.moveSpeed = 0;
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    if (t.y < -20) this.teleport(new THREE.Vector3(t.x, 2, t.z));
  }

  teleport(p: THREE.Vector3) {
    this.body.setTranslation({ x: p.x, y: p.y + EYE_OFFSET + 0.05, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + EYE_OFFSET + 0.05, z: p.z });
    this.vy = 0;
    this.speed = this.moveSpeed = 0;
    this.physics.snapTracked(this.body);
  }

  /** Enable/disable collision while seated in a vehicle. */
  setSeated(seated: boolean) {
    this.collider.setEnabled(!seated);
  }

  updateVisual(dt: number, seated: boolean) {
    if (!seated) this.avatar.root.rotation.y = this.yaw;
    this.avatar.animate(dt, this.moveSpeed, seated);
  }

  get position() { const t = this.body.translation(); return new THREE.Vector3(t.x, t.y - EYE_OFFSET, t.z); }
}
