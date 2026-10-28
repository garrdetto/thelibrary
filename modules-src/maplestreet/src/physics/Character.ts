/**
 * On-foot player: kinematic capsule driven by Rapier's KinematicCharacterController
 * (auto-step for porch steps and foundations, slope limits, snap-to-ground,
 * pushes dynamic bodies), plus a procedural humanoid with a walk cycle.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { MASK, Physics } from './Physics';

const HALF_H = 0.55, RADIUS = 0.28;
export const EYE_OFFSET = HALF_H + RADIUS;   // body center → feet

export class Avatar {
  readonly root = new THREE.Group();
  private legL: THREE.Group; private legR: THREE.Group;
  private armL: THREE.Group; private armR: THREE.Group;
  private phase = 0;

  constructor(shirt: string) {
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a77e, roughness: 0.7 });
    const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(shirt), roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2d3440, roughness: 0.9 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x3b2618, roughness: 0.8 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
    };
    const limb = (x: number, y: number) => { const g = new THREE.Group(); g.position.set(x, y, 0); this.root.add(g); return g; };

    add(this.root, new THREE.CapsuleGeometry(0.2, 0.42, 6, 12), cloth, 0, 1.22, 0);          // torso
    add(this.root, new THREE.SphereGeometry(0.13, 20, 16), skin, 0, 1.68, 0);                // head
    add(this.root, new THREE.SphereGeometry(0.135, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 1.7, -0.01);
    add(this.root, new THREE.CylinderGeometry(0.055, 0.06, 0.1, 10), skin, 0, 1.53, 0);      // neck
    this.legL = limb(-0.1, 0.92); this.legR = limb(0.1, 0.92);
    for (const leg of [this.legL, this.legR]) {
      add(leg, new THREE.CapsuleGeometry(0.075, 0.68, 4, 10), pants, 0, -0.42, 0);
      add(leg, new THREE.BoxGeometry(0.11, 0.07, 0.25), shoe, 0, -0.88, 0.05);
    }
    this.armL = limb(-0.27, 1.42); this.armR = limb(0.27, 1.42);
    for (const arm of [this.armL, this.armR]) {
      add(arm, new THREE.CapsuleGeometry(0.06, 0.5, 4, 10), cloth, 0, -0.3, 0);
      add(arm, new THREE.SphereGeometry(0.055, 10, 8), skin, 0, -0.62, 0);
    }
  }

  /**
   * Put the avatar in a vehicle seat (or back on its feet with `parent`).
   * Seat = hip position in the vehicle's chassis space; vehicles face +X.
   */
  sitIn(vehicleRoot: THREE.Object3D, seat: { x: number; y: number; z: number; straddle?: boolean }) {
    vehicleRoot.add(this.root);
    this.root.position.set(seat.x, seat.y - 0.9, seat.z);
    this.root.rotation.set(0, Math.PI / 2, 0);
    this.straddle = !!seat.straddle;
    this.seated = true;
  }
  standIn(parent: THREE.Object3D, footY: number) {
    parent.add(this.root);
    this.root.position.set(0, footY, 0);
    this.root.rotation.set(0, 0, 0);
    this.seated = false;
  }
  seated = false;
  private straddle = false;

  /** speed in m/s; drives stride length and arm swing. */
  animate(dt: number, speed: number, seated = this.seated) {
    if (seated) {
      // Thighs forward, shins down, hands out on the wheel / handlebars.
      this.legL.rotation.x = this.legR.rotation.x = this.straddle ? -1.05 : -1.45;
      this.legL.rotation.z = this.straddle ? 0.28 : 0.04; this.legR.rotation.z = this.straddle ? -0.28 : -0.04;
      this.armL.rotation.x = this.armR.rotation.x = -1.0;
      this.armL.rotation.z = 0.12; this.armR.rotation.z = -0.12;
      return;
    }
    this.legL.rotation.z = this.legR.rotation.z = this.armL.rotation.z = this.armR.rotation.z = 0;
    this.phase += dt * (2 + speed * 2.1);
    const amp = Math.min(0.75, speed * 0.22);
    const s = Math.sin(this.phase) * amp;
    this.legL.rotation.x = s; this.legR.rotation.x = -s;
    this.armL.rotation.x = -s * 0.8; this.armR.rotation.x = s * 0.8;
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
  grounded = false;

  constructor(private physics: Physics, spawn: THREE.Vector3, color: string, scene: THREE.Scene) {
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

    this.avatar = new Avatar(color);
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
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    if (t.y < -20) this.teleport(new THREE.Vector3(t.x, 2, t.z));
  }

  teleport(p: THREE.Vector3) {
    this.body.setTranslation({ x: p.x, y: p.y + EYE_OFFSET + 0.05, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + EYE_OFFSET + 0.05, z: p.z });
    this.vy = 0;
    this.physics.snapTracked(this.body);
  }

  /** Enable/disable collision while seated in a vehicle. */
  setSeated(seated: boolean) {
    this.collider.setEnabled(!seated);
  }

  updateVisual(dt: number, seated: boolean) {
    if (!seated) this.avatar.root.rotation.y = this.yaw;
    this.avatar.animate(dt, this.speed, seated);
  }

  get position() { const t = this.body.translation(); return new THREE.Vector3(t.x, t.y - EYE_OFFSET, t.z); }
}
