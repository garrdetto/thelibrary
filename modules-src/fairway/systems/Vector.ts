/** Plain 3D vector math on readonly tuples, used by the flight integrator, camera and match systems. */

export type Vec3 = readonly [number, number, number]

export const ZERO: Vec3 = [0, 0, 0]
export const UP: Vec3 = [0, 1, 0]

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}

export function addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2])
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a)
  return len > 1e-9 ? [a[0] / len, a[1] / len, a[2] / len] : ZERO
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2])
}

/** Unit heading on the ground plane for yaw ψ: (sin ψ, 0, cos ψ). Yaw grows counter-clockwise seen from above. */
export function headingVector(yaw: number): Vec3 {
  return [Math.sin(yaw), 0, Math.cos(yaw)]
}

/** Right-hand side of a heading: heading × up = (−cos ψ, 0, sin ψ). Turning right by δ gives yaw ψ − δ. */
export function rightVector(yaw: number): Vec3 {
  return [-Math.cos(yaw), 0, Math.sin(yaw)]
}

/** Yaw that points from a toward b on the ground plane. */
export function yawTowards(a: Vec3 | readonly [number, number], b: Vec3 | readonly [number, number]): number {
  const ax = a[0]
  const az = a.length === 3 ? (a as Vec3)[2] : a[1]
  const bx = b[0]
  const bz = b.length === 3 ? (b as Vec3)[2] : b[1]
  return Math.atan2(bx - ax, bz - az)
}
