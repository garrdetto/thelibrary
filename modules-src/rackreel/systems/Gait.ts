/** The hunter's walk and run cycle, renderer-free: stride length from speed, hip swing to match the step, and a knee that folds through the swing and straightens to plant the heel. Angles are radians; a negative thigh angle swings the leg forward, a positive knee bends the heel back. */

export const LEG_LENGTH = 0.93

export interface Gait {
  /** Ground covered in one full cycle (two steps), metres. */
  stride: number
  /** 0 standing still, 1 at a full walk or faster. */
  amp: number
  /** Peak thigh swing either side of straight down. */
  thigh: number
  /** Peak knee bend while the leg swings through. */
  knee: number
  /** Knee bend while the foot is planted and taking the weight. */
  load: number
  /** Thighs carried a little forward when running. */
  lean: number
  /** How far the hips drop when the legs are furthest apart, so both feet stay on the ground. */
  drop: number
  /** A slight overall sink into soft knees while moving. */
  sink: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Gait for a speed in m/s; `crouch` 0..1 shortens the stride. */
export function walkGait(speed: number, crouch = 0): Gait {
  const run = clamp(speed / 5, 0, 1)
  const amp = speed > 0.15 ? Math.min(1, speed / 1.2) : 0
  const stride = clamp(1.0 + speed * 0.45, 1.4, 3.2) * (1 - crouch * 0.35)
  const halfStep = stride / 4
  const thigh = clamp(Math.asin(Math.min(0.92, halfStep / LEG_LENGTH)) * 0.85, 0.3, 0.95) * amp
  return {
    stride,
    amp,
    thigh,
    knee: lerp(1.15, 2.0, run) * amp,
    load: lerp(0.24, 0.42, run) * amp,
    lean: run * 0.18 * amp,
    drop: LEG_LENGTH * (1 - Math.cos(thigh)) * 0.6,
    sink: lerp(0.015, 0.05, run) * amp,
  }
}

/** One leg at phase `phase` (radians, the leg is furthest forward at π/2): thigh and knee angles. */
export function legPose(phase: number, g: Gait): { thigh: number; knee: number } {
  const s = Math.sin(phase)
  const c = Math.cos(phase)
  const swingFold = Math.pow(Math.max(0, Math.cos(phase + 0.35)), 1.4)
  const stance = Math.max(0, -c)
  return {
    thigh: -s * g.thigh - g.lean,
    knee: swingFold * g.knee + stance * g.load + g.amp * 0.06,
  }
}
