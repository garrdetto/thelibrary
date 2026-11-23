import { TOSS_GRAVITY as GRAVITY, MAX_LAUNCH_SPEED, SWEET_BONUS, SWEET_SHARE, SWING_DELAY, TOSS_SPEED, TOSS_START_Y, ZONE_HALF, ZONE_Y } from './constants'

export type HitKind = 'homer' | 'pop' | 'grounder' | 'whiff'

export type SwingResult = {
  kind: HitKind
  contactTime: number
  contactY: number
  quality: number
  angleDeg: number
  speed: number
  power: number
}

export function tossHeight(t: number): number {
  return TOSS_START_Y + TOSS_SPEED * t - 0.5 * GRAVITY * t * t
}

export function tossVelocity(t: number): number {
  return TOSS_SPEED - GRAVITY * t
}

export function tossLandTime(): number {
  return (TOSS_SPEED + Math.sqrt(TOSS_SPEED * TOSS_SPEED + 2 * GRAVITY * TOSS_START_Y)) / GRAVITY
}

export function sweetSpotPressTime(): number {
  const a = 0.5 * GRAVITY
  const b = -TOSS_SPEED
  const c = ZONE_Y - TOSS_START_Y
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a) - SWING_DELAY
}

export function resolveSwing(pressTime: number): SwingResult {
  const contactTime = pressTime + SWING_DELAY
  const contactY = tossHeight(contactTime)
  const offset = contactY - ZONE_Y
  const quality = offset / ZONE_HALF
  if (contactY <= 0.15 || Math.abs(quality) > 1) return { kind: 'whiff', contactTime, contactY, quality: Math.max(-1, Math.min(1, quality)), angleDeg: 0, speed: 0, power: 0 }
  const sweet = Math.abs(quality) <= SWEET_SHARE
  const angleDeg = quality >= 0 ? 40 + quality * 34 : 40 + quality * 33
  const falloff = 1 - (quality > 0 ? 0.36 : 0.45) * Math.pow(Math.abs(quality), 1.3)
  const speed = MAX_LAUNCH_SPEED * falloff * (sweet ? SWEET_BONUS : 1)
  const kind: HitKind = sweet ? 'homer' : quality > 0 ? 'pop' : 'grounder'
  return { kind, contactTime, contactY, quality, angleDeg, speed, power: speed / (MAX_LAUNCH_SPEED * SWEET_BONUS) }
}
