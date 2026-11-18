/** Animals kept on the property at once: 12 is 50 % more deer than the old 8. */
export const HERD_SIZE = 12
export const HERD_SPAWN_MIN = 90
export const HERD_SPAWN_MAX = 260
export const HERD_DESPAWN = 380
/** A downed animal nobody walks up to tag is cleared after this long once everyone is out of range. */
export const ABANDONED_DOWN_SECONDS = 600
/** Every five minutes the deer run off the scene and a fresh batch enters at random spots. */
export const HERD_TURNOVER_SECONDS = 300
/** A deer that has been told to leave is gone after this long, or once it is `LEAVE_GONE` metres away. */
export const LEAVE_SECONDS = 25
export const LEAVE_GONE = 170
export const BEAR_SHARE = 0.12
/** Share of new groups that are a lone buck: 0.52 is 30 % more bucks than the old 0.4. */
export const BUCK_SHARE = 0.52
export const PANIC_DISTANCE = 18
export const SAFE_DISTANCE = 150
export const ALARM_RADIUS = 45

export type DeerMood = 'graze' | 'walk' | 'alert' | 'flee' | 'wounded' | 'down'

/**
 * What a calm animal is doing on top of its mood: `look` stands with its head up scanning round, `court` is a buck
 * walking up behind a doe, `mount` is the buck mounted on her and `stand` is the doe holding still for him.
 */
export type IdleAct = 'none' | 'look' | 'court' | 'mount' | 'stand'
export const IDLE_ACTS: readonly IdleAct[] = ['none', 'look', 'court', 'mount', 'stand']
/** A buck only goes courting a calm doe this close. */
export const COURT_RANGE = 45
/** Chance a calm buck with a doe in range goes to her when he next stirs. */
export const COURT_CHANCE = 0.3
/** How long a mount lasts, in seconds (from, to). */
export const MOUNT_SECONDS: readonly [number, number] = [3.5, 7]
/** The buck rears this far nose-up while mounted, pivoting on his hips. */
export const MOUNT_PITCH = -0.55
export const HIP = { y: 1.0, z: -0.45 }

export type IdleChoice = 'walk' | 'look' | 'graze' | 'court'

/** What a calm deer or bear does next once it has grazed a while: wander off, stand looking round, keep feeding, or (a buck with a doe nearby) go courting. */
export function nextIdle(roll: number, courtRoll: number, canCourt: boolean): IdleChoice {
  if (canCourt && courtRoll < COURT_CHANCE) return 'court'
  if (roll < 0.45) return 'walk'
  if (roll < 0.75) return 'look'
  return 'graze'
}

/** How far behind the doe's own position the buck stands to mount her, so his hips are just behind her tail. */
export function mountOffset(buckScale: number, doeScale: number): number {
  return 0.8 * doeScale + 0.25 + HIP.z * buckScale
}

/** How far the buck's root moves (up, forward, model frame, before scale) when he rears to `pitch`, so his hips stay where they were. */
export function hipLift(pitch: number): { y: number; z: number } {
  const c = Math.cos(pitch)
  const s = Math.sin(pitch)
  return { y: HIP.y - (HIP.y * c - HIP.z * s), z: HIP.z - (HIP.y * s + HIP.z * c) }
}

export interface Senses {
  distance: number
  noise: number
  approaching: boolean
  cover: number
  hearing: number
}

export function detectRadius(s: Pick<Senses, 'noise' | 'cover' | 'hearing'>): number {
  return (14 + 72 * s.noise) * s.hearing * (1 - 0.45 * s.cover)
}

/**
 * False when `react` gives the same answer whatever the cover is, so the caller can skip working the cover out: the
 * animal is down, wounded or already running, inside the panic ring, or further away than it could notice anyone in
 * the open. Call it with `s.cover` at 0.
 */
export function coverMatters(mood: DeerMood, s: Senses): boolean {
  if (mood === 'down' || mood === 'wounded' || mood === 'flee') return false
  return s.distance >= PANIC_DISTANCE && s.distance < (14 + 72 * s.noise) * s.hearing
}

export function react(mood: DeerMood, s: Senses, alertLeft: number): 'flee' | 'alert' | 'calm' | 'keep' {
  if (mood === 'down' || mood === 'wounded') return 'keep'
  if (mood === 'flee') return s.distance > SAFE_DISTANCE ? 'calm' : 'keep'
  if (s.distance < PANIC_DISTANCE) return 'flee'
  const r = detectRadius(s)
  if (mood === 'alert') {
    if (s.distance < r * 0.6 || (s.approaching && s.distance < r)) return 'flee'
    if (alertLeft <= 0) return s.distance < r ? 'flee' : 'calm'
    return 'keep'
  }
  return s.distance < r ? 'alert' : 'keep'
}

export function fleeSpeed(t: number, buck: boolean): number {
  const burst = buck ? 14 : 13
  const cruise = buck ? 9 : 8.5
  return cruise + (burst - cruise) * Math.exp(-t / 2.5)
}
