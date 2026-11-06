/**
 * Look-development camera: orbit with the left button or arrow keys, pan
 * with the right button or Shift-drag, zoom with the wheel, and glide to the
 * preset views. Never dips below the ground.
 */
import * as pc from 'playcanvas';
import { VIEWS, type ViewName } from '../../config';
import { groundHeight } from '../models/Ground';

interface Pose { target: pc.Vec3; yaw: number; pitch: number; distance: number }

const wrap = (a: number) => ((a + 540) % 360) - 180;

export class OrbitCamera {
  private pose: Pose = { target: new pc.Vec3(), yaw: 0, pitch: -15, distance: 30 };
  private goal: Pose = { target: new pc.Vec3(), yaw: 0, pitch: -15, distance: 30 };
  private drag: { x: number; y: number; pan: boolean } | null = null;
  private keys = new Set<string>();
  private eye = new pc.Vec3();

  constructor(private cam: pc.Entity, el: HTMLElement) {
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey };
    });
    el.addEventListener('pointermove', e => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      if (this.drag.pan) this.pan(dx, dy);
      else { this.goal.yaw -= dx * 0.3; this.goal.pitch = Math.max(-85, Math.min(5, this.goal.pitch - dy * 0.25)); }
    });
    const end = () => { this.drag = null; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.goal.distance = Math.max(4, Math.min(900, this.goal.distance * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
    addEventListener('keydown', e => this.keys.add(e.key));
    addEventListener('keyup', e => this.keys.delete(e.key));
    addEventListener('blur', () => this.keys.clear());
  }

  private pan(dx: number, dy: number) {
    const k = this.goal.distance * 0.0016, yaw = this.goal.yaw * pc.math.DEG_TO_RAD;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    this.goal.target.x += (-dx * rx + dy * fx) * k;
    this.goal.target.z += (-dx * rz + dy * fz) * k;
  }

  setView(name: ViewName, instant = false) {
    const v = VIEWS[name];
    this.goal.target.set(v.target[0], v.target[1], v.target[2]);
    this.goal.yaw = v.yaw; this.goal.pitch = v.pitch; this.goal.distance = v.distance;
    if (instant) { this.pose.target.copy(this.goal.target); this.pose.yaw = v.yaw; this.pose.pitch = v.pitch; this.pose.distance = v.distance; }
  }

  update(dt: number) {
    const turn = 70 * dt;
    if (this.keys.has('ArrowLeft')) this.goal.yaw += turn;
    if (this.keys.has('ArrowRight')) this.goal.yaw -= turn;
    if (this.keys.has('ArrowUp')) this.goal.pitch = Math.max(-85, this.goal.pitch - turn * 0.6);
    if (this.keys.has('ArrowDown')) this.goal.pitch = Math.min(5, this.goal.pitch + turn * 0.6);
    const k = 1 - Math.exp(-dt * 6);
    const p = this.pose, g = this.goal;
    p.target.lerp(p.target, g.target, k);
    p.yaw += wrap(g.yaw - p.yaw) * k;
    p.pitch += (g.pitch - p.pitch) * k;
    p.distance += (g.distance - p.distance) * k;
    const yaw = p.yaw * pc.math.DEG_TO_RAD, pitch = p.pitch * pc.math.DEG_TO_RAD;
    this.eye.set(
      p.target.x + Math.cos(pitch) * Math.sin(yaw) * p.distance,
      p.target.y - Math.sin(pitch) * p.distance,
      p.target.z + Math.cos(pitch) * Math.cos(yaw) * p.distance,
    );
    this.eye.y = Math.max(this.eye.y, groundHeight(this.eye.x, this.eye.z) + 1.2);
    this.cam.setPosition(this.eye);
    this.cam.lookAt(p.target);
  }

  get position() { return this.eye; }
}
