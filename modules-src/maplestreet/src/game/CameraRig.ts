/**
 * Third-person camera for live mode: mouse orbit (right-drag or pointer lock),
 * scroll zoom, auto-chase behind vehicles when the mouse is idle, and
 * physics ray collision so it never clips into walls.
 */
import * as THREE from 'three/webgpu';
import { Input } from '../core/Input';
import { Physics } from '../physics/Physics';

export class CameraRig {
  yaw = -Math.PI / 2; // radians around Y; camera sits at target + (sin(yaw), , cos(yaw)) * dist
  pitch = 0.32;
  dist = 6;
  private idle = 0;
  private smoothTarget = new THREE.Vector3();
  private initialized = false;

  constructor(private camera: THREE.PerspectiveCamera, private input: Input, private physics: Physics) {}

  update(dt: number, target: THREE.Vector3, opts: { chaseYaw?: number; dist: number; height: number }) {
    const p = this.input.pointer;
    const locked = document.pointerLockElement === this.input.canvas;
    if (locked || this.input.mouseHeld(2)) {
      this.yaw -= p.dx * 0.0035;
      this.pitch = THREE.MathUtils.clamp(this.pitch + p.dy * 0.0025, -0.15, 1.2);
      if (p.dx || p.dy) this.idle = 0;
    }
    // Arrow keys: ← / → orbit around the player, ↑ / ↓ tilt the view
    // up over the top or down toward the horizon. Holding a key keeps turning.
    const orbit = this.input.axis(['ArrowLeft'], ['ArrowRight']);
    const tilt = this.input.axis(['ArrowDown'], ['ArrowUp']);
    if (orbit || tilt) {
      this.yaw += orbit * 1.9 * dt;
      this.pitch = THREE.MathUtils.clamp(this.pitch + tilt * 1.1 * dt, -0.15, 1.25);
      this.idle = 0;
    }
    this.idle += dt;
    this.dist = THREE.MathUtils.clamp(this.dist + p.wheel * 0.8, 2.5, 30);

    if (opts.chaseYaw !== undefined && this.idle > 2.5) {
      const want = opts.chaseYaw + Math.PI;
      const d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
      this.yaw += d * Math.min(1, dt * 2.5);
    }

    if (!this.initialized) { this.smoothTarget.copy(target); this.initialized = true; }
    this.smoothTarget.lerp(target, 1 - Math.exp(-dt * 12));
    const focus = this.smoothTarget.clone().add(new THREE.Vector3(0, opts.height * 0.45, 0));
    const want = Math.max(this.dist, opts.dist * 0.6);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).normalize();
    const free = this.physics.rayDistance(focus, dir, want);
    this.camera.position.copy(focus).addScaledVector(dir, Math.max(1.2, free - 0.3));
    this.camera.lookAt(focus);
  }

  /** Camera-relative XZ basis for on-foot movement. */
  basis() {
    const fwd = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
    const right = new THREE.Vector2(-fwd.y, fwd.x);
    return { fwd, right };
  }
}
