/** Procedural animation clips on the shared skeleton. A clip maps a phase (0–1 through the move, or a running cycle) to bone rotations relative to the rest T-pose; the Animator blends them. Angles are radians, Euler XYZ in each bone's parent frame. Right-handed versions are authored; `mirror` flips them for lefties. */
import type { BoneName } from './Rig'

export type Euler3 = readonly [number, number, number]
export type Pose = Partial<Record<BoneName, Euler3>>

const smooth = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<BoneName>
  for (const key of keys) {
    const x = a[key] ?? [0, 0, 0]
    const y = b[key] ?? [0, 0, 0]
    out[key] = [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)]
  }
  return out
}

/** Keyframed clip: [phase, pose] pairs, eased between neighbours. */
function keyed(frames: readonly (readonly [number, Pose])[]) {
  return (t: number): Pose => {
    if (t <= frames[0][0]) return frames[0][1]
    for (let index = 1; index < frames.length; index++) {
      const [at, pose] = frames[index]
      if (t <= at) {
        const [from, previous] = frames[index - 1]
        return lerpPose(previous, pose, smooth((t - from) / (at - from)))
      }
    }
    return frames[frames.length - 1][1]
  }
}

const ARMS_DOWN: Pose = { 'arm.L': [0, 0, -1.25], 'arm.R': [0, 0, 1.25], 'forearm.L': [0, -0.25, 0], 'forearm.R': [0, 0.25, 0] }

export function idle(time: number): Pose {
  const breathe = Math.sin(time * 1.6) * 0.02
  return { ...ARMS_DOWN, spine: [breathe, 0, 0], chest: [breathe, 0, 0], 'arm.L': [0.05, 0, -1.25 + breathe], 'arm.R': [0.05, 0, 1.25 - breathe] }
}

export function ready(time: number): Pose {
  const sway = Math.sin(time * 3) * 0.03
  return {
    spine: [0.35, 0, 0], chest: [0.2, 0, 0], neck: [-0.45, 0, 0],
    'thigh.L': [-0.75, 0, -0.18], 'thigh.R': [-0.75, 0, 0.18], 'shin.L': [1.15, 0, 0], 'shin.R': [1.15, 0, 0], 'foot.L': [-0.4, 0, 0], 'foot.R': [-0.4, 0, 0],
    'arm.L': [-0.9, 0.2, -0.9 + sway], 'arm.R': [-0.9, -0.2, 0.9 - sway], 'forearm.L': [0, -0.9, 0], 'forearm.R': [0, 0.9, 0],
  }
}

export function crouch(): Pose {
  return {
    spine: [0.25, 0, 0], chest: [0.1, 0, 0], neck: [-0.3, 0, 0],
    'thigh.L': [-1.5, 0, -0.45], 'thigh.R': [-1.5, 0, 0.45], 'shin.L': [2.3, 0, 0], 'shin.R': [2.3, 0, 0], 'foot.L': [-0.7, 0, 0], 'foot.R': [-0.7, 0, 0],
    'arm.L': [-1.1, 0.3, -0.6], 'arm.R': [-0.4, 0, 1.1], 'forearm.L': [0, -1.2, 0], 'forearm.R': [0, 1.0, 0],
  }
}

/** Running cycle: `phase` advances one full stride per cycle; `effort` 0 (jog) to 1 (sprint). */
export function run(phase: number, effort: number): Pose {
  const a = Math.sin(phase * Math.PI * 2)
  const b = Math.sin(phase * Math.PI * 2 + Math.PI)
  const reach = 0.55 + effort * 0.35
  const knee = (s: number) => 0.25 + Math.max(0, -s) * (1.1 + effort * 0.6)
  return {
    spine: [0.15 + effort * 0.15, 0, 0], chest: [0.05, a * 0.12, 0], neck: [-0.15 - effort * 0.1, 0, 0],
    'thigh.L': [-a * reach, 0, 0], 'thigh.R': [-b * reach, 0, 0], 'shin.L': [knee(a), 0, 0], 'shin.R': [knee(b), 0, 0], 'foot.L': [0.2 * a, 0, 0], 'foot.R': [0.2 * b, 0, 0],
    'arm.L': [b * reach * 0.9, 0, -1.3], 'arm.R': [a * reach * 0.9, 0, 1.3], 'forearm.L': [0, -1.4, 0], 'forearm.R': [0, 1.4, 0],
  }
}

/** Right-handed batting stance; the bat sits in the right hand over the back shoulder. */
export const stance: Pose = {
  hips: [0, 0.2, 0], spine: [0.15, 0.15, 0], chest: [0, 0.2, 0], neck: [-0.1, -0.85, 0],
  'thigh.L': [-0.25, 0, -0.25], 'thigh.R': [-0.35, 0, 0.25], 'shin.L': [0.45, 0, 0], 'shin.R': [0.55, 0, 0],
  'arm.R': [-0.2, -0.9, 0.5], 'forearm.R': [0, 1.9, 0.3], 'hand.R': [0, 0, -0.4],
  'arm.L': [-0.3, 0.9, -0.2], 'forearm.L': [0, -1.6, 0],
}

export const swing = keyed([
  [0, stance],
  [0.25, { ...stance, 'thigh.L': [-0.45, 0, -0.3], 'shin.L': [0.3, 0, 0], hips: [0, 0.1, 0] }],
  [0.55, { hips: [0, -0.9, 0], spine: [0.2, -0.4, 0], chest: [0, -0.6, 0], neck: [-0.1, 0.2, 0], 'thigh.L': [-0.2, 0, -0.3], 'thigh.R': [-0.25, 0, 0.35], 'shin.L': [0.1, 0, 0], 'shin.R': [0.7, 0, 0], 'foot.R': [0.3, 0, 0], 'arm.R': [-1.3, -0.2, 0.3], 'forearm.R': [0, 0.3, 0], 'hand.R': [0, 0, -0.1], 'arm.L': [-1.2, 0.3, -0.3], 'forearm.L': [0, -0.2, 0] }],
  [1, { hips: [0, -1.3, 0], spine: [0.1, -0.6, 0], chest: [0, -0.8, 0], neck: [-0.1, 0.5, 0], 'thigh.L': [-0.15, 0, -0.3], 'thigh.R': [-0.15, 0, 0.35], 'shin.R': [0.9, 0, 0], 'foot.R': [0.5, 0, 0], 'arm.R': [-0.6, 1.2, 1.0], 'forearm.R': [0, 1.0, 0], 'arm.L': [-0.4, 1.2, -0.6], 'forearm.L': [0, -1.4, 0] }],
])

export const bunt = keyed([
  [0, stance],
  [0.35, { hips: [0, -0.8, 0], spine: [0.35, -0.6, 0], neck: [-0.4, 0.4, 0], 'thigh.L': [-0.5, 0, -0.25], 'thigh.R': [-0.5, 0, 0.25], 'shin.L': [0.8, 0, 0], 'shin.R': [0.8, 0, 0], 'arm.R': [-1.3, 0, 0.5], 'forearm.R': [0, 0.6, 0], 'arm.L': [-1.3, 0, -0.5], 'forearm.L': [0, -0.6, 0], 'hand.R': [0, 0, 1.4] }],
  [1, { hips: [0, -0.8, 0], spine: [0.35, -0.6, 0], neck: [-0.4, 0.4, 0], 'thigh.L': [-0.5, 0, -0.25], 'thigh.R': [-0.5, 0, 0.25], 'shin.L': [0.8, 0, 0], 'shin.R': [0.8, 0, 0], 'arm.R': [-1.3, 0, 0.5], 'forearm.R': [0, 0.6, 0], 'arm.L': [-1.3, 0, -0.5], 'forearm.L': [0, -0.6, 0], 'hand.R': [0, 0, 1.4] }],
])

/** Right-handed delivery from the windup: rock, leg kick, stride, release at 0.72, follow-through. */
export const pitch = keyed([
  [0, { ...ARMS_DOWN, 'arm.L': [-0.6, 0, -0.9], 'arm.R': [-0.6, 0, 0.9], 'forearm.L': [0, -1.6, 0], 'forearm.R': [0, 1.6, 0] }],
  [0.3, { hips: [0, -1.4, 0], spine: [0, 0, 0.15], neck: [0, 1.2, 0], 'thigh.L': [-1.6, 0, 0], 'shin.L': [1.8, 0, 0], 'thigh.R': [0, 0, 0.05], 'arm.L': [-0.6, 0.2, -0.8], 'arm.R': [-0.6, -0.2, 0.8], 'forearm.L': [0, -1.7, 0], 'forearm.R': [0, 1.7, 0] }],
  [0.55, { hips: [0, -1.1, 0], spine: [0.1, -0.4, 0.1], neck: [0, 1.4, 0], 'thigh.L': [-0.7, 0, -0.5], 'shin.L': [0.4, 0, 0], 'thigh.R': [0.2, 0, 0.3], 'shin.R': [0.6, 0, 0], 'arm.L': [0, 0.8, -1.4], 'arm.R': [-1.7, -0.5, 1.2], 'forearm.R': [0, 1.6, 0], 'forearm.L': [0, -0.6, 0] }],
  [0.64, { hips: [0, -0.56, 0], spine: [0.32, 0.04, 0.05], chest: [0.11, 0.22, 0], neck: [-0.16, 0.53, 0], 'thigh.L': [-0.86, 0, -0.42], 'shin.L': [0.56, 0, 0], 'thigh.R': [0.34, 0, 0.3], 'shin.R': [0.76, 0, 0], 'arm.L': [-0.11, 0.04, -1.18], 'forearm.L': [0, -0.93, 0], 'arm.R': [-0.9, -0.6, -1.3], 'forearm.R': [0, 1.2, 0] }],
  [0.72, { hips: [0, -0.1, 0], spine: [0.5, 0.4, 0], chest: [0.2, 0.4, 0], neck: [-0.3, -0.2, 0], 'thigh.L': [-1.0, 0, -0.35], 'shin.L': [0.7, 0, 0], 'thigh.R': [0.45, 0, 0.3], 'shin.R': [0.9, 0, 0], 'arm.L': [-0.2, -0.6, -1.0], 'forearm.L': [0, -1.2, 0], 'arm.R': [-0.1, -1.6, -1.1], 'forearm.R': [0, 0.4, 0] }],
  [1, { hips: [0, 0.3, 0], spine: [0.7, 0.6, 0], chest: [0.3, 0.3, 0], neck: [-0.5, -0.3, 0], 'thigh.L': [-0.9, 0, -0.3], 'shin.L': [0.8, 0, 0], 'thigh.R': [0.3, 0, 0.2], 'shin.R': [1.4, 0, 0], 'arm.L': [0.3, -0.4, -1.2], 'forearm.L': [0, -1.3, 0], 'arm.R': [0.9, -0.1, -1.2], 'forearm.R': [0, 1.6, 0] }],
])

export const throwBall = keyed([
  [0, { spine: [0.2, 0.4, 0], 'arm.R': [0.4, 0.4, 0.3], 'forearm.R': [0, 1.8, 0.5], 'arm.L': [-1.2, 0.5, -0.6], 'thigh.L': [-0.5, 0, -0.3], 'shin.L': [0.4, 0, 0] }],
  [0.45, { spine: [0.45, -0.3, 0], chest: [0.1, -0.4, 0], 'arm.R': [-1.5, 0.2, 0.6], 'forearm.R': [0, 0.6, 0], 'arm.L': [-0.3, -0.5, -1.1], 'forearm.L': [0, -1.3, 0], 'thigh.L': [-0.7, 0, -0.3], 'shin.L': [0.5, 0, 0], 'thigh.R': [0.3, 0, 0.2], 'shin.R': [0.8, 0, 0] }],
  [1, { ...ARMS_DOWN, spine: [0.3, -0.4, 0], 'arm.R': [-0.4, -1.0, 1.1] }],
])

export const catchHigh = keyed([
  [0, { ...ARMS_DOWN }],
  [0.4, { spine: [0.05, 0, 0], 'arm.L': [-2.6, 0.3, -0.3], 'forearm.L': [0, -0.3, 0], 'arm.R': [-2.2, -0.3, 0.4], 'forearm.R': [0, 0.5, 0], neck: [0.3, 0, 0] }],
  [1, { ...ARMS_DOWN, 'arm.L': [-1.2, 0.4, -0.7], 'forearm.L': [0, -1.4, 0] }],
])

export const catchLow = keyed([
  [0, { ...ARMS_DOWN }],
  [0.4, { spine: [0.9, 0, 0], chest: [0.3, 0, 0], neck: [-0.6, 0, 0], 'thigh.L': [-1.0, 0, -0.35], 'thigh.R': [-1.0, 0, 0.35], 'shin.L': [1.4, 0, 0], 'shin.R': [1.4, 0, 0], 'foot.L': [-0.5, 0, 0], 'foot.R': [-0.5, 0, 0], 'arm.L': [-0.4, 0.4, -0.6], 'forearm.L': [0, -0.4, 0], 'arm.R': [-0.4, -0.4, 0.6], 'forearm.R': [0, 0.4, 0] }],
  [1, { ...ARMS_DOWN, spine: [0.3, 0, 0] }],
])

/** Feet-first slide: the body leans back, the lead leg extends and the hips drop (the Animator lowers the root). */
export const slide = keyed([
  [0, run(0.25, 1)],
  [0.3, { spine: [-0.9, 0, 0], chest: [-0.2, 0, 0], neck: [0.7, 0, 0], 'thigh.L': [-1.3, 0, 0], 'shin.L': [0.05, 0, 0], 'thigh.R': [-0.8, 0, 0.1], 'shin.R': [1.6, 0, 0], 'arm.L': [-2.3, 0, -0.4], 'arm.R': [-2.3, 0, 0.4] }],
  [1, { spine: [-0.9, 0, 0], chest: [-0.2, 0, 0], neck: [0.7, 0, 0], 'thigh.L': [-1.3, 0, 0], 'shin.L': [0.05, 0, 0], 'thigh.R': [-0.8, 0, 0.1], 'shin.R': [1.6, 0, 0], 'arm.L': [-2.3, 0, -0.4], 'arm.R': [-2.3, 0, 0.4] }],
])

export function celebrate(time: number): Pose {
  const hop = Math.abs(Math.sin(time * 6))
  return { 'arm.L': [-2.8, 0, -0.3 - hop * 0.2], 'arm.R': [-2.8, 0, 0.3 + hop * 0.2], 'forearm.L': [0, -0.3, 0], 'forearm.R': [0, 0.3, 0], 'thigh.L': [-0.3 * hop, 0, 0], 'thigh.R': [-0.3 * hop, 0, 0], 'shin.L': [0.6 * hop, 0, 0], 'shin.R': [0.6 * hop, 0, 0] }
}

const SWAP: Partial<Record<BoneName, BoneName>> = {}
for (const part of ['shoulder', 'arm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe'] as const) {
  SWAP[`${part}.L` as BoneName] = `${part}.R` as BoneName
  SWAP[`${part}.R` as BoneName] = `${part}.L` as BoneName
}

/** Left-handed version of a right-handed pose: swap sides and negate the y and z rotations. */
export function mirror(pose: Pose): Pose {
  const out: Pose = {}
  for (const [key, value] of Object.entries(pose) as [BoneName, Euler3][]) out[SWAP[key] ?? key] = [value[0], -value[1], -value[2]]
  return out
}
