/**
 * Two-bone arm reach, renderer-free. Puts a palm on a point (a rod butt, a reel knob, a rifle's fore-end, a bow
 * string) by bending the elbow about the forearm's local x axis and swinging the upper arm from the shoulder, with
 * the elbow turned toward a pole direction. Quaternions are [x, y, z, w] in Babylon's convention.
 */

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]

export interface ArmChain {
  /** Elbow pivot in the upper arm's rest frame, relative to the shoulder pivot. */
  elbow: Vec3
  /** Palm centre in the forearm's rest frame, relative to the elbow pivot. */
  palm: Vec3
}

/** Hunter arms measured in Blender from the Meshy rig (game frame, metres): elbow from shoulder, palm from elbow. */
export const HUNTER_ARMS: Record<'L' | 'R', ArmChain> = {
  L: { elbow: [0.0397, -0.2649, -0.008], palm: [-0.0268, -0.3913, 0.0307] },
  R: { elbow: [-0.0395, -0.2635, -0.008], palm: [0.0225, -0.3909, 0.028] },
}

/** Most the elbow folds, radians (the forearm's local x rotation runs from 0, straight, to this). */
export const ELBOW_FOLD = 2.55

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: Vec3) => Math.sqrt(dot(a, a))
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const norm = (a: Vec3): Vec3 => {
  const l = len(a)
  return l > 1e-9 ? scale(a, 1 / l) : [0, -1, 0]
}

export function rotateX(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]
}

export function axisAngle(axis: Vec3, angle: number): Quat {
  const a = norm(axis)
  const s = Math.sin(angle / 2)
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)]
}

export function mulQuat(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

export function rotate(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]]
  const t = scale(cross(u, v), 2)
  return add(add(v, scale(t, q[3])), cross(u, t))
}

/** Shortest rotation taking unit vector `from` onto unit vector `to`. */
export function fromTo(from: Vec3, to: Vec3): Quat {
  const d = dot(from, to)
  if (d < -0.999999) {
    const side = Math.abs(from[0]) < 0.9 ? cross([1, 0, 0], from) : cross([0, 1, 0], from)
    return axisAngle(side, Math.PI)
  }
  const c = cross(from, to)
  const q: Quat = [c[0], c[1], c[2], 1 + d]
  const l = Math.hypot(q[0], q[1], q[2], q[3])
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}

/** Elbow bend (forearm local x rotation, 0 to −ELBOW_FOLD) that puts the palm `reach` metres from the shoulder. */
export function elbowBend(chain: ArmChain, reach: number): number {
  const dist = (angle: number) => len(add(chain.elbow, rotateX(chain.palm, angle)))
  if (reach >= dist(0)) return 0
  if (reach <= dist(-ELBOW_FOLD)) return -ELBOW_FOLD
  let lo = -ELBOW_FOLD
  let hi = 0
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (dist(mid) < reach) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export interface ArmPose {
  upper: Quat
  fore: Quat
  /** How far the palm ends up from the target (0 when it reaches). */
  miss: number
}

/**
 * Solves the arm for a palm target given relative to the shoulder pivot in the shoulder's parent frame (the torso).
 * `pole` is the direction (same frame) the elbow should point toward.
 */
export function solveArm(chain: ArmChain, target: Vec3, pole: Vec3): ArmPose {
  const reach = len(target)
  const bend = elbowBend(chain, reach)
  const fore = axisAngle([1, 0, 0], bend)
  const hand = add(chain.elbow, rotateX(chain.palm, bend))
  const t = norm(target)
  const swing = fromTo(norm(hand), t)
  const elbow = rotate(swing, chain.elbow)
  const e = sub(elbow, scale(t, dot(elbow, t)))
  const p = sub(pole, scale(t, dot(pole, t)))
  let upper = swing
  if (len(e) > 1e-6 && len(p) > 1e-6) {
    const en = norm(e)
    const pn = norm(p)
    const twist = Math.atan2(dot(cross(en, pn), t), dot(en, pn))
    upper = mulQuat(axisAngle(t, twist), swing)
  }
  const reached = rotate(upper, hand)
  return { upper, fore: [fore[0], fore[1], fore[2], fore[3]], miss: len(sub(reached, target)) }
}
