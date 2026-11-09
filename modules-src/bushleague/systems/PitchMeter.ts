/** The darts-style pitch meter: hold to charge and the level swings 0 → 1 → 0 every two `seconds`; let go to throw. The level sets the effort, and the distance from the green Perfect mark sets the accuracy miss (0 on the mark, up to ±100 well outside the band; soft releases miss one way, overthrown ones the other). */

export interface PitchMeterTuning {
  /** Seconds for the level to climb from empty to full. */
  seconds: number
  /** Centre of the Perfect mark, 0–1. */
  perfect: number
  /** Half-width of the solid green Perfect mark. */
  core: number
  /** Half-width of the whole band, green fading to yellow. */
  band: number
  /** Shorter holds than this go back to aiming instead of throwing. */
  minHold: number
}

export type PitchMeterZone = 'perfect' | 'good' | 'soft' | 'wild'

export function pitchMeterLevel(held: number, seconds: number): number {
  const phase = (held / seconds) % 2
  return phase <= 1 ? phase : 2 - phase
}

export function readPitchMeter(level: number, tuning: PitchMeterTuning): { zone: PitchMeterZone; label: string; accuracy: number } {
  const offset = level - tuning.perfect
  const distance = Math.abs(offset)
  if (distance <= tuning.core) return { zone: 'perfect', label: 'Perfect', accuracy: 0 }
  const miss = distance <= tuning.band ? ((distance - tuning.core) / (tuning.band - tuning.core)) * 50 : 50 + Math.min(1, (distance - tuning.band) / 0.25) * 50
  const accuracy = Math.round(Math.sign(offset) * Math.min(100, miss))
  if (distance <= tuning.band) return { zone: 'good', label: 'Good', accuracy }
  return offset < 0 ? { zone: 'soft', label: 'Too soft', accuracy } : { zone: 'wild', label: 'Overthrown', accuracy }
}
