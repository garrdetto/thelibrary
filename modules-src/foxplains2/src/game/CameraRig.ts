/**
 * Third-person camera: orbits the focus (right-drag or the arrow keys,
 * wheel to zoom), swings in behind the vehicle you drive unless you've just
 * looked around, and pulls in front of walls and trees with a physics ray.
 * `yaw` is the heading the camera looks along (0 = +Z), the same convention
 * Fox Plains uses for spawning and Go Home.
 */
import * as pc from 'playcanvas';
import type { Input } from '../../../maplestreet/src/core/Input';
import { MASK, type Physics } from '../physics/Physics';

const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
const dampAngle = (a: number, b: number, l: number, dt: number) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * (1 - Math.exp(-l * dt)); };

export class CameraRig {
  yaw = 0;
  pitch = 0.32;
  dist = 6;
  private zoom = 1;
  private lookedAround = 0;
  private cur = new pc.Vec3();
  private aim = new pc.Vec3();
  private pulled = 99;
  private dir = { x: 0, y: 0, z: 0 };

  constructor(private camera: pc.Entity, private input: Input, private physics: Physics) {}

  basis() {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return { fwd: { x: s, z: c }, right: { x: -c, z: s } };
  }

  update(dt: number, focus: { x: number; y: number; z: number }, o: { dist: number; height: number; chaseYaw?: number }) {
    const I = this.input;
    let orbit = 0, tilt = 0;
    if (I.mouseHeld(2)) { orbit -= I.pointer.dx * 0.005; tilt += I.pointer.dy * 0.004; }
    if (I.isDown('ArrowLeft')) orbit -= dt * 1.8;
    if (I.isDown('ArrowRight')) orbit += dt * 1.8;
    if (I.isDown('ArrowUp')) tilt -= dt * 1.1;
    if (I.isDown('ArrowDown')) tilt += dt * 1.1;
    if (orbit || tilt) this.lookedAround = 2.5;
    this.yaw += orbit;
    this.pitch = Math.min(1.35, Math.max(-0.12, this.pitch + tilt));
    if (I.pointer.wheel) this.zoom = Math.min(2.6, Math.max(0.45, this.zoom * (1 + I.pointer.wheel * 0.1)));
    this.lookedAround = Math.max(0, this.lookedAround - dt);
    if (o.chaseYaw !== undefined && this.lookedAround <= 0) this.yaw = dampAngle(this.yaw, o.chaseYaw, 2.4, dt);
    this.dist = damp(this.dist, o.dist * this.zoom, 6, dt);

    this.aim.set(focus.x, focus.y + o.height * 0.55, focus.z);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dx = -Math.sin(this.yaw) * cp, dy = sp, dz = -Math.cos(this.yaw) * cp;
    const want = this.dist + o.height * 0.25;
    const d = this.dir; d.x = dx; d.y = dy; d.z = dz;
    const hit = this.physics.rayDistance(this.aim, d, want, MASK.cameraRay);
    const reach = Math.max(1.2, hit - 0.3);
    this.pulled = reach < this.pulled ? reach : damp(this.pulled, reach, 3, dt);
    const r = Math.min(want, this.pulled);
    const tx = this.aim.x + dx * r, ty = Math.max(0.4, this.aim.y + dy * r), tz = this.aim.z + dz * r;
    const jx = this.cur.x - tx, jy = this.cur.y - ty, jz = this.cur.z - tz;
    if (this.cur.lengthSq() === 0 || jx * jx + jy * jy + jz * jz > 3600) this.cur.set(tx, ty, tz);
    else this.cur.set(damp(this.cur.x, tx, 14, dt), damp(this.cur.y, ty, 14, dt), damp(this.cur.z, tz, 14, dt));
    this.camera.setPosition(this.cur);
    this.camera.lookAt(this.aim);
  }

  /** Jump straight to the right place (after a teleport). */
  snap() { this.cur.set(0, 0, 0); this.pulled = 99; }
}
