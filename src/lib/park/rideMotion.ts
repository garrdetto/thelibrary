import { mat4 } from './gl'
import type { Mat4 } from './gl'
import type { CustomRideMotion } from '../../../server/park/index.mjs'

/** The clock a flat ride animates from (see `RideAnim` in models.ts). */
export type MotionClock = { spin: number; timer: number; running: boolean; speed: number }

export const MOTION_INFO: Record<CustomRideMotion['type'], { label: string; hint: string; thrill: number }> = {
  none: { label: 'Static', hint: 'Nothing moves. Good for walk-through attractions and play areas.', thrill: 0 },
  spin: { label: 'Spin', hint: 'The moving part turns around the vertical axis, like a carousel or spinning cups.', thrill: 0.35 },
  swing: { label: 'Swing', hint: 'The moving part rocks back and forth from the pivot, like a swinging ship.', thrill: 0.75 },
  wheel: { label: 'Wheel', hint: 'The moving part rolls over a horizontal axle through the pivot, like a big wheel.', thrill: 0.25 },
  drop: { label: 'Drop', hint: 'The moving part climbs slowly, holds at the top and plunges, like a drop tower.', thrill: 1 },
  bob: { label: 'Bob', hint: 'The moving part rises and falls gently, like a bouncing kiddie ride.', thrill: 0.2 },
}

/** Height the drop motion climbs to at `amount`, in metres. */
export const dropTravel = (motion: CustomRideMotion, height: number) => motion.amount * Math.max(2, (height - motion.split) * 0.85)

function dropHeight(timer: number, rideTime: number, travel: number) {
  const t = Math.max(0, timer) / Math.max(1, rideTime)
  if (t < 0.55) return travel * (t / 0.55)
  if (t < 0.66) return travel
  if (t < 0.72) return travel * (1 - Math.pow((t - 0.66) / 0.06, 2))
  return 0
}

const smooth = (u: number) => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t) }

/** Extra height from `motion.rise`: climbs over the first fifth of the ride, holds, and settles back before it ends. */
export function riseHeight(motion: CustomRideMotion, clock: MotionClock, rideTime: number) {
  if (!motion.rise || !clock.running || motion.type === 'none') return 0
  const u = Math.max(0, clock.timer) / Math.max(1, rideTime)
  return motion.rise * (u < 0.8 ? smooth(u / 0.2) : 1 - smooth((u - 0.8) / 0.15))
}

/** How far the main moving part is above its resting place right now (rise plus drop or bob). */
export function mainLift(motion: CustomRideMotion, clock: MotionClock, rideTime: number, height: number) {
  const own = motion.type === 'drop' || motion.type === 'bob' ? motionCore(motion, clock, rideTime, height)[14] : 0
  return riseHeight(motion, clock, rideTime) + own
}

/** Transform for the moving part in ride-local park space (Z up, metres). */
export function motionMatrix(motion: CustomRideMotion, clock: MotionClock, rideTime: number, height: number): Mat4 {
  const rise = riseHeight(motion, clock, rideTime)
  const core = motionCore(motion, clock, rideTime, height)
  return rise ? mat4.multiply(mat4.translation(0, 0, rise), core) : core
}

function motionCore(motion: CustomRideMotion, clock: MotionClock, rideTime: number, height: number): Mat4 {
  const [px, py, pz] = motion.pivot
  const around = (rotation: Mat4) => mat4.chain(mat4.translation(px, py, pz), rotation, mat4.translation(-px, -py, -pz))
  const s = motion.speed
  switch (motion.type) {
    case 'spin': return around(mat4.rotZ(clock.spin * s))
    case 'wheel': return around(motion.axis === 'x' ? mat4.rotX(clock.spin * 0.3 * s) : mat4.rotY(clock.spin * 0.3 * s))
    case 'swing': {
      const angle = clock.running ? Math.sin(clock.spin * 0.9 * s) * motion.amount * 1.4 * Math.min(1, clock.timer * 0.08) : 0
      return around(motion.axis === 'x' ? mat4.rotX(angle) : mat4.rotY(angle))
    }
    case 'drop': return mat4.translation(0, 0, clock.running ? dropHeight(clock.timer * s, rideTime, dropTravel(motion, height)) : 0)
    case 'bob': return mat4.translation(0, 0, clock.running ? (Math.sin(clock.spin * 1.6 * s) * 0.5 + 0.5) * motion.amount * 2 : 0)
    default: return mat4.identity()
  }
}
