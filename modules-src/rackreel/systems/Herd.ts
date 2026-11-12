export const HERD_SIZE = 8
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
export const BUCK_SHARE = 0.4
export const PANIC_DISTANCE = 18
export const SAFE_DISTANCE = 150
export const ALARM_RADIUS = 45

export type DeerMood = 'graze' | 'walk' | 'alert' | 'flee' | 'wounded' | 'down'

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
