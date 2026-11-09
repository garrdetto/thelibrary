
/** Height of the procedural bobber, waterline to antenna tip, in metres at scale 1. */
export const BOBBER_HEIGHT = 0.114
/** The bobber never shrinks below this fraction of the screen height, so it stays readable at 40 m. */
export const BOBBER_MIN_SCREEN = 0.024
export const BOBBER_MAX_SCALE = 12

/** Scale for the bobber at `distance` metres with a vertical field of view of `fov` radians. */
export function bobberScale(distance: number, fov: number): number {
  const visible = 2 * Math.tan(fov / 2) * Math.max(0, distance)
  const want = (visible * BOBBER_MIN_SCREEN) / BOBBER_HEIGHT
  return Math.min(BOBBER_MAX_SCALE, Math.max(1, want))
}

export interface NibblePlan {
  /** Total nibble time before the bobber goes under. */
  duration: number
  /** Start time of each twitch, seconds from the start of the nibble. */
  twitches: number[]
}

/** A fish mouthing the bait: two to four quick twitches before the take. `rand` returns [0, 1). */
export function planNibble(rand: () => number): NibblePlan {
  const count = 2 + Math.floor(rand() * 3)
  const twitches: number[] = []
  let t = 0.15 + rand() * 0.2
  for (let i = 0; i < count; i++) {
    if (i > 0) t += 0.26 + rand() * 0.24
    twitches.push(t)
  }
  return { duration: t + 0.3 + rand() * 0.2, twitches }
}

/** Downward dip of the bobber, 0..1, for a twitch that started `since` seconds ago. */
export function twitchDip(since: number): number {
  if (since < 0 || since > 0.32) return 0
  if (since < 0.06) return since / 0.06
  return Math.pow(1 - (since - 0.06) / 0.26, 2)
}

/** Depth the bobber is pulled to (negative metres) `t` seconds into a bite. */
export function plungeDepth(t: number): number {
  if (t <= 0) return 0
  const yank = Math.min(1, t / 0.12)
  const settle = Math.sin(t * 9) * 0.02 * Math.exp(-t * 2)
  return -(0.16 * yank * yank) + settle
}

export interface JumpPose {
  /** Height above the water surface, metres. */
  height: number
  /** Nose-up pitch, radians: up on the way out, down on the way back in. */
  pitch: number
  /** 0..1 progress, 1 means back in the water. */
  t: number
}

/** A fish clearing the water: a parabola of `peak` metres over `duration` seconds. */
export function jumpPose(elapsed: number, duration: number, peak: number): JumpPose {
  const t = Math.max(0, Math.min(1, elapsed / duration))
  return { height: 4 * peak * t * (1 - t), pitch: (0.5 - t) * 2.2, t }
}

/** Whether a surge spike should throw the fish out of the water. */
export function shouldJump(surge: number, lastSurge: number, progress: number, cooldown: number, fight: number): boolean {
  if (cooldown > 0) return false
  if (progress < 12 || progress > 92) return false
  const threshold = 22 - Math.min(1, fight) * 8
  return surge >= threshold && lastSurge < threshold
}

/** Rod bend, 0..1, from the fight state. */
export function rodBend(state: string, tension: number, surge: number, clock: number): number {
  switch (state) {
    case 'waiting': return 0.04
    case 'nibble': return 0.06
    case 'bite': return 0.42 + Math.abs(Math.sin(clock * 11)) * 0.18
    case 'reeling': return Math.min(1, 0.12 + (tension / 100) * 0.7 + (surge / 100) * 0.35 + Math.sin(clock * 17) * 0.02 * (tension / 100))
    case 'landing': return 0.55 + Math.sin(clock * 12) * 0.05
    default: return 0
  }
}

/** Reel crank speed, radians per second. Negative means line is peeling off against the drag. */
export function crankSpeed(state: string, holding: boolean, tension: number, surge: number): number {
  if (state === 'retrieving') return 22
  if (state === 'landing') return 9
  if (state !== 'reeling') return 0
  if (surge > 18 && !holding) return -surge * 0.35
  if (holding) return tension > 90 ? 6 : 13
  return 0
}

/** Lift from the water to the rod tip at the end of the fight, eased, for t in 0..1. */
export function landingLift(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2
}

/** Water rings and spray grow more gently than the float, enough to read from across the lake. */
export function effectScale(distance: number, fov: number): number {
  return Math.pow(bobberScale(distance, fov), 0.75)
}
