/**
 * Motion clips for a skinned rig, renderer-free: sampling a clip at a phase, mixing several into one pose, and choosing
 * the mix for a ground speed (idle, walk, run, the crouched stalk and backing up). The gait clips all start with the
 * same foot reaching forward, so one shared phase drives them and they can be mixed mid-stride. The phase advances with
 * the ground covered, never with the clock, so a planted foot stays planted at any speed.
 */

export interface Clip {
  name: string
  /** Length of one pass, seconds. */
  seconds: number
  frames: number
  loop: boolean
  /** Ground speed the gait was recorded at, m/s (negative backs up, 0 for a clip that stays put). */
  speed: number
  /** Hip position per frame (x, y, z), metres in the rig's frame. */
  hips: Float32Array
  /** Joint turns per frame: `frames` × `joints` quaternions (x, y, z, w) scaled to ±32767. */
  rot: Int16Array
}

export interface Pose {
  joints: number
  /** `joints` quaternions (x, y, z, w). */
  rot: Float32Array
  hips: Float32Array
  weight: number
}

export function createPose(joints: number): Pose {
  return { joints, rot: new Float32Array(joints * 4), hips: new Float32Array(3), weight: 0 }
}

export function resetPose(pose: Pose): void {
  pose.weight = 0
}

/** Adds `clip` at `phase` (0..1 through the clip, wrapping when it loops) to `pose` with `weight`. */
export function addClip(pose: Pose, clip: Clip, phase: number, weight: number): void {
  if (weight <= 0) return
  const n = clip.frames
  const wrapped = clip.loop ? phase - Math.floor(phase) : Math.max(0, Math.min(1, phase))
  const at = clip.loop ? wrapped * n : wrapped * (n - 1)
  const i0 = Math.min(n - 1, Math.floor(at))
  const i1 = clip.loop ? (i0 + 1) % n : Math.min(n - 1, i0 + 1)
  const t = at - i0
  const first = pose.weight === 0
  const out = pose.rot
  const a = i0 * pose.joints * 4
  const b = i1 * pose.joints * 4
  const src = clip.rot
  for (let j = 0; j < pose.joints; j++) {
    const k = j * 4
    const ax = src[a + k]
    const ay = src[a + k + 1]
    const az = src[a + k + 2]
    const aw = src[a + k + 3]
    const flip = ax * src[b + k] + ay * src[b + k + 1] + az * src[b + k + 2] + aw * src[b + k + 3] < 0 ? -1 : 1
    let x = ax + (src[b + k] * flip - ax) * t
    let y = ay + (src[b + k + 1] * flip - ay) * t
    let z = az + (src[b + k + 2] * flip - az) * t
    let w = aw + (src[b + k + 3] * flip - aw) * t
    if (first) {
      out[k] = x * weight
      out[k + 1] = y * weight
      out[k + 2] = z * weight
      out[k + 3] = w * weight
      continue
    }
    if (x * out[k] + y * out[k + 1] + z * out[k + 2] + w * out[k + 3] < 0) {
      x = -x
      y = -y
      z = -z
      w = -w
    }
    out[k] += x * weight
    out[k + 1] += y * weight
    out[k + 2] += z * weight
    out[k + 3] += w * weight
  }
  const h0 = i0 * 3
  const h1 = i1 * 3
  for (let c = 0; c < 3; c++) {
    const v = (clip.hips[h0 + c] + (clip.hips[h1 + c] - clip.hips[h0 + c]) * t) * weight
    pose.hips[c] = first ? v : pose.hips[c] + v
  }
  pose.weight += weight
}

/** Turns the weighted sums into unit quaternions and a hip position. False when nothing was added. */
export function finishPose(pose: Pose): boolean {
  if (pose.weight <= 0) return false
  const out = pose.rot
  for (let k = 0; k < out.length; k += 4) {
    const l = Math.hypot(out[k], out[k + 1], out[k + 2], out[k + 3]) || 1
    out[k] /= l
    out[k + 1] /= l
    out[k + 2] /= l
    out[k + 3] /= l
  }
  for (let c = 0; c < 3; c++) pose.hips[c] /= pose.weight
  return true
}

export type GaitName = 'idle' | 'walk' | 'run' | 'crouchWalk' | 'walkBack'

/** What each gait clip covers: its recorded speed (m/s) and the ground one full cycle spans (metres). */
export interface GaitSet {
  walk: { speed: number; stride: number }
  run: { speed: number; stride: number }
  crouchWalk: { speed: number; stride: number }
  walkBack: { speed: number; stride: number }
}

export interface GaitMix {
  idle: number
  walk: number
  run: number
  crouchWalk: number
  walkBack: number
  /** Cycles per second for the shared gait phase. */
  cadence: number
  /** 0 standing still, 1 once the feet are really stepping. */
  moving: number
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (v: number) => v * v * (3 - 2 * v)

export function gaitSet(clips: Map<string, Clip>): GaitSet {
  const of = (name: string, fallback: number) => {
    const c = clips.get(name)
    const speed = Math.abs(c?.speed ?? 0) || fallback
    return { speed, stride: speed * (c?.seconds ?? 1) }
  }
  return { walk: of('walk', 1.35), run: of('run', 4.5), crouchWalk: of('crouchWalk', 1.1), walkBack: of('walkBack', 1.2) }
}

/**
 * The mix for a ground `speed` (m/s), `crouch` 0..1 and `back` 0..1 (backing away from where the body faces). The
 * weights add up to 1. Below a walk the steps shorten rather than slow to a crawl; between a walk and a run the two
 * are cross-faded into a jog.
 */
export function gaitMix(speed: number, crouch: number, back: number, set: GaitSet, out: GaitMix): GaitMix {
  const v = Math.max(0, speed)
  const c = clamp01(crouch)
  const b = clamp01(back)
  const moving = smooth(clamp01(v / (set.walk.speed * 0.5)))
  const jog = smooth(clamp01((v - set.walk.speed) / (set.run.speed - set.walk.speed)))
  const upright = 1 - c
  const forward = 1 - b
  out.idle = upright * (1 - moving)
  out.walk = upright * moving * forward * (1 - jog)
  out.run = upright * moving * forward * jog
  out.walkBack = upright * moving * b
  out.crouchWalk = c
  out.moving = moving
  const short = 0.6 + 0.4 * clamp01(v / set.walk.speed)
  const crouchShort = 0.6 + 0.4 * clamp01(v / set.crouchWalk.speed)
  const stepping = out.walk + out.run + out.walkBack + out.crouchWalk
  const stride = stepping > 1e-4
    ? (out.walk * set.walk.stride * short + out.run * set.run.stride + out.walkBack * set.walkBack.stride * short + out.crouchWalk * set.crouchWalk.stride * crouchShort) / stepping
    : set.walk.stride
  out.cadence = v > 0.02 ? v / stride : 0
  return out
}

export function createGaitMix(): GaitMix {
  return { idle: 1, walk: 0, run: 0, crouchWalk: 0, walkBack: 0, cadence: 0, moving: 0 }
}

/**
 * Advances the shared gait phase (0..1). While the feet are moving it follows the cadence; once they stop it eases to
 * the nearest moment both feet are down (0 or half way), so a crouched hunter never freezes mid-step.
 */
export function stepPhase(phase: number, mix: GaitMix, dt: number): number {
  if (mix.cadence > 0) {
    const next = phase + mix.cadence * dt
    return next - Math.floor(next)
  }
  const rest = phase < 0.25 ? 0 : phase < 0.75 ? 0.5 : 1
  const eased = phase + (rest - phase) * Math.min(1, dt * 6)
  return eased >= 1 ? eased - 1 : eased
}
