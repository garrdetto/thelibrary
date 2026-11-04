/** Pose builders for the fisherman: driving, sitting, standing, and the fishing motions (cast, wait, hook-set, fight, net and show the catch). Positions are character space: feet at y 0, facing -Z, the angler's right hand toward +X. */
import { restPose } from '../scene/Character'
import type { Pose } from '../scene/Character'
import { qEuler } from '../scene/RigMath'
import type { V3 } from '../scene/RigMath'
import { clamp, smoothstep } from '../shared/Random'

export type FishingPhase = 'idle' | 'cast' | 'wait' | 'bite' | 'fight' | 'land' | 'show'

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpV = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

function breathe(pose: Pose, time: number, amount = 1): void {
  const b = Math.sin(time * 1.6) * 1.2 * amount
  pose.chest = qEuler(-b * 0.6, 0, 0)
}

export function seatedLegs(pose: Pose, seatHeight: number, spread = 0.13): void {
  pose.hipsOffset = [0, seatHeight + 0.1 - 0.922, 0.04]
  pose.hipsRotation = qEuler(-6, 0, 0)
  pose.legL = { target: [-spread - 0.02, 0.09, -0.36], pole: [-0.15, 0.4, -1] }
  pose.legR = { target: [spread + 0.02, 0.09, -0.36], pole: [0.15, 0.4, -1] }
}

export function standingLegs(pose: Pose, time: number, sway = 1): void {
  const s = Math.sin(time * 0.7) * 0.012 * sway
  pose.hipsOffset = [s, -0.015, 0]
  pose.legL = { target: [-0.17, 0.09, -0.02], pole: [0, 0, -1] }
  pose.legR = { target: [0.17, 0.09, 0.03], pole: [0, 0, -1] }
}

export function drivePose(time: number, wheel: V3, steer: number, seatHeight: number): Pose {
  const pose = restPose()
  seatedLegs(pose, seatHeight)
  pose.spine = qEuler(4, 0, 0)
  breathe(pose, time, 0.6)
  const angle = -steer * 0.9
  const r = 0.16
  const hand = (side: number): V3 => {
    const a = angle + (side < 0 ? Math.PI : 0)
    return [wheel[0] + Math.cos(a) * r, wheel[1] + Math.sin(a) * r * 0.85, wheel[2] + Math.sin(a) * r * 0.45]
  }
  pose.armL = { target: hand(-1), pole: [-1, -0.6, 0.4] }
  pose.armR = { target: hand(1), pole: [1, -0.6, 0.4] }
  pose.head = qEuler(-4, steer * 12, 0)
  return pose
}

export function sitPose(time: number, seatHeight: number): Pose {
  const pose = restPose()
  seatedLegs(pose, seatHeight)
  pose.spine = qEuler(6, 0, 0)
  breathe(pose, time)
  pose.armL = { target: [-0.17, seatHeight + 0.18, -0.3], pole: [-1, -0.4, 0.5] }
  pose.armR = { target: [0.17, seatHeight + 0.18, -0.3], pole: [1, -0.4, 0.5] }
  pose.head = qEuler(Math.sin(time * 0.21) * 4, Math.sin(time * 0.13) * 20, 0)
  return pose
}

export function standPose(time: number): Pose {
  const pose = restPose()
  standingLegs(pose, time)
  breathe(pose, time)
  pose.armL = { target: [-0.24, 0.98, 0.0], pole: [-0.5, 0, 1] }
  pose.armR = { target: [0.24, 0.98, 0.0], pole: [0.5, 0, 1] }
  pose.head = qEuler(0, Math.sin(time * 0.17) * 25, 0)
  return pose
}

export interface FishingAnim {
  phase: FishingPhase
  /** Seconds into the phase. */
  t: number
  /** 0..1 fight strength (rod load). */
  load: number
  /** Side-to-side fish pull, -1..1. */
  pull: number
  seated: boolean
  seatHeight: number
}

/** Rod grip (right hand) and reel hand (left) targets with the rod's pitch and yaw in character space. */
export interface RodPose {
  pose: Pose
  rodPitch: number
  rodYaw: number
  reel: number
}

export function fishingPose(time: number, a: FishingAnim): RodPose {
  const pose = restPose()
  if (a.seated) seatedLegs(pose, a.seatHeight)
  else standingLegs(pose, time, a.phase === 'fight' ? 2 : 1)
  breathe(pose, time, a.phase === 'fight' ? 2 : 1)
  const base: V3 = a.seated ? [0.12, a.seatHeight + 0.42, -0.34] : [0.14, 1.06, -0.3]
  let grip = base
  let rodPitch = 28, rodYaw = 6, reel = 0
  let spine = 4, twist = 0
  switch (a.phase) {
    case 'idle':
    case 'wait': {
      const twitch = a.phase === 'wait' ? Math.max(0, Math.sin(time * 0.9) - 0.94) * 30 : 0
      rodPitch = 24 + twitch * 0.4
      reel = a.phase === 'wait' ? time * 0.3 : 0
      break
    }
    case 'cast': {
      const t = a.t
      if (t < 0.55) {
        const k = smoothstep(0, 0.55, t)
        rodPitch = lerp(28, 115, k)
        grip = lerpV(base, [base[0] + 0.05, base[1] + 0.32, base[2] + 0.22], k)
        twist = -12 * k
      } else if (t < 0.85) {
        const k = smoothstep(0.55, 0.85, t)
        rodPitch = lerp(115, 12, k)
        grip = lerpV([base[0] + 0.05, base[1] + 0.32, base[2] + 0.22], [base[0], base[1] + 0.05, base[2] - 0.18], k)
        twist = lerp(-12, 8, k)
        spine = lerp(4, 14, k)
      } else {
        const k = smoothstep(0.85, 1.6, t)
        rodPitch = lerp(12, 22, k)
        grip = lerpV([base[0], base[1] + 0.05, base[2] - 0.18], base, k)
        spine = lerp(14, 4, k)
      }
      break
    }
    case 'bite': {
      const k = smoothstep(0, 0.25, a.t)
      rodPitch = lerp(22, 78, k)
      grip = lerpV(base, [base[0], base[1] + 0.22, base[2] + 0.1], k)
      spine = lerp(4, -6, k)
      break
    }
    case 'fight': {
      const pump = Math.sin(time * 1.4) * 0.5 + 0.5
      rodPitch = 45 + pump * 25 - a.load * 15
      rodYaw = a.pull * 22
      grip = [base[0] + a.pull * 0.05, base[1] + 0.1 + pump * 0.08, base[2] + 0.05]
      spine = -4 - a.load * 6
      twist = a.pull * 10
      reel = time * (2 + (1 - pump) * 4)
      break
    }
    case 'land': {
      const k = smoothstep(0, 1, a.t)
      rodPitch = lerp(60, 80, k)
      grip = [base[0] + 0.05, base[1] + 0.25, base[2] + 0.12]
      spine = lerp(-4, 22, k)
      break
    }
    case 'show': {
      rodPitch = 82
      grip = [0.28, 1.25, 0.05]
      spine = 2
      break
    }
  }
  pose.spine = qEuler(spine, twist * 0.5, 0)
  pose.chest = qEuler(spine * 0.4, twist * 0.5, 0)
  pose.head = qEuler(clamp(-rodPitch * 0.08 + 10, -10, 18), -twist * 0.6, 0)
  pose.armR = { target: grip, pole: [1, -0.7, 0.6] }
  const reelHand: V3 = a.phase === 'show'
    ? [-0.12, 1.12, -0.38]
    : [grip[0] - 0.12 + Math.cos(reel * 6) * 0.03, grip[1] - 0.06 + Math.sin(reel * 6) * 0.03, grip[2] - 0.08]
  pose.armL = { target: reelHand, pole: [-1, -0.6, 0.4] }
  return { pose, rodPitch, rodYaw, reel }
}
