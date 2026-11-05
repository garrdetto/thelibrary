/**
 * On foot: a kinematic capsule on Rapier's KinematicCharacterController
 * (auto-step for porch steps and foundations, slope limits, snap to ground,
 * pushes dynamic bodies), tuned exactly like Fox Plains so walking and
 * running speeds match what neighbors in the original see.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import * as pc from 'playcanvas';
import { MASK, type Physics } from './Physics';
import { Avatar, type AvatarKits } from '../avatar/Avatar';
import type { Look } from '../../../maplestreet/shared/Wardrobe';

const HALF_H = 0.55, RADIUS = 0.28;
export const EYE_OFFSET = HALF_H + RADIUS;

const damp = (a: number, b: number, lambda: number, dt: number) => a + (b - a) * (1 - Math.exp(-lambda * dt));

export class Character {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private ctrl: RAPIER.KinematicCharacterController;
  readonly avatar: Avatar;
  /** Interpolated body centre; the avatar hangs below it at the feet. */
  readonly pivot = new pc.Entity('player');
  yaw = 0;
  private vy = 0;
  speed = 0;
  moveSpeed = 0;
  grounded = false;
  private desired = { x: 0, y: 0, z: 0 };
  private feet = new pc.Vec3();

  constructor(private physics: Physics, spawn: { x: number; y: number; z: number }, look: Look, kits: AvatarKits, parent: pc.Entity) {
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

    this.avatar = new Avatar(kits, look);
    this.avatar.root.setLocalPosition(0, -EYE_OFFSET, 0);
    this.pivot.addChild(this.avatar.root);
    parent.addChild(this.pivot);
    physics.track(this.body, this.pivot);
  }

  /** Fixed step. (mx, mz) is a world-space wish direction of length ≤ 1. */
  step(dt: number, mx: number, mz: number, run: boolean, jump: boolean) {
    const len = Math.hypot(mx, mz);
    const maxSpeed = run ? 6.0 : 2.6;
    this.speed = damp(this.speed, len > 0 ? maxSpeed * Math.min(1, len) : 0, 10, dt);
    if (len > 0.01) {
      let d = Math.atan2(mx, mz) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 12);
    }
    if (this.grounded) this.vy = jump ? 4.6 : -1; else this.vy -= 9.81 * dt;
    const dx = len > 0 ? mx / len : 0, dz = len > 0 ? mz / len : 0;
    const want = this.desired;
    want.x = dx * this.speed * dt; want.y = this.vy * dt; want.z = dz * this.speed * dt;
    this.ctrl.computeColliderMovement(this.collider, want, undefined, MASK.character);
    const m = this.ctrl.computedMovement();
    this.grounded = this.ctrl.computedGrounded();
    this.moveSpeed = damp(this.moveSpeed, dt > 0 ? Math.hypot(m.x, m.z) / dt : 0, 14, dt);
    if (this.moveSpeed < 0.03) this.moveSpeed = 0;
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    if (t.y < -20) this.teleport(t.x, 2, t.z);
  }

  teleport(x: number, y: number, z: number) {
    const p = { x, y: y + EYE_OFFSET + 0.05, z };
    this.body.setTranslation(p, true);
    this.body.setNextKinematicTranslation(p);
    this.vy = 0;
    this.speed = this.moveSpeed = 0;
    this.physics.snapTracked(this.body);
  }

  setSeated(seated: boolean) { this.collider.setEnabled(!seated); }

  updateVisual(dt: number, seated: boolean) {
    if (!seated) this.avatar.root.setLocalEulerAngles(0, this.yaw * pc.math.RAD_TO_DEG, 0);
    this.avatar.animate(dt, this.moveSpeed, seated);
  }

  /** Feet position (one shared vector, refreshed on every read). */
  get position() { const t = this.body.translation(); return this.feet.set(t.x, t.y - EYE_OFFSET, t.z); }
}
