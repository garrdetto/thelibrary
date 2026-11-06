/**
 * Small vector and quaternion helpers for the flight models, plus the
 * attitude angles and the county's wind. Aircraft body frame: +X nose, +Y up,
 * +Z right wing. A positive rate about +X rolls right, about +Z pitches the
 * nose up, and about +Y yaws the nose left. Compass headings are measured
 * clockwise from +Z (north) toward +X (east).
 */
import { fbm } from './Noise';

export type V3 = [number, number, number];
export type Quat = [number, number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** `v` rotated by unit quaternion `q` (body to world). */
export function rotate(q: Quat, v: V3): V3 {
  const [x, y, z, w] = q;
  const t = scale(cross([x, y, z], v), 2);
  return add(add(v, scale(t, w)), cross([x, y, z], t));
}

/** `v` rotated by the inverse of `q` (world to body). */
export const unrotate = (q: Quat, v: V3) => rotate([-q[0], -q[1], -q[2], q[3]], v);

export function quatMul(a: Quat, b: Quat): Quat {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}

export function quatNorm(q: Quat): Quat { const l = Math.hypot(...q) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }

/** A rotation of `yaw` about +Y (radians, + turns the nose from +X toward -Z). */
export const yawQuat = (yaw: number): Quat => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

export interface Attitude { pitch: number; bank: number; heading: number }

/** Pitch (+ nose up), bank (+ right wing down) and compass heading, in radians. */
export function attitude(q: Quat): Attitude {
  const f = rotate(q, [1, 0, 0]), u = rotate(q, [0, 1, 0]), r = rotate(q, [0, 0, 1]);
  return { pitch: Math.asin(clamp(f[1], -1, 1)), bank: Math.atan2(-r[1], u[1]), heading: (Math.atan2(f[0], -f[2]) + Math.PI * 2) % (Math.PI * 2) };
}

/** Wind at world time `t` seconds (the way the air moves): a slowly turning breeze of 2–7 m/s with gusts. */
export function windAt(t: number): V3 {
  const day = t / 3600;
  const dir = fbm(day * 0.7 + 3.3, 1.7, 2) * Math.PI * 4;
  const speed = 2 + 5 * fbm(day * 1.3 + 8.1, 4.2, 2);
  const gust = 1 + 0.25 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1.1);
  return [Math.sin(dir) * speed * gust, 0, -Math.cos(dir) * speed * gust];
}

export const RHO = 1.225;
export const G = 9.81;
