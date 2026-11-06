/** Pitch types: speed relative to the pitcher's fastball, spin rate and the direction the spin pushes the ball (tilt 0 = up, 90 = arm side, 180 = down). */
import type { PitchType } from './types'

export interface PitchSpec {
  type: PitchType
  label: string
  short: string
  speedDelta: number
  rpm: number
  tilt: number
  efficiency: number
  wobble: number
}

export const PITCH_SPECS: Readonly<Record<PitchType, PitchSpec>> = {
  FF: { type: 'FF', label: 'Four-seam fastball', short: '4-Seam', speedDelta: 0, rpm: 2300, tilt: 20, efficiency: 0.9, wobble: 0 },
  SI: { type: 'SI', label: 'Two-seam sinker', short: 'Sinker', speedDelta: -1, rpm: 2150, tilt: 75, efficiency: 0.85, wobble: 0 },
  FC: { type: 'FC', label: 'Cutter', short: 'Cutter', speedDelta: -2.5, rpm: 2400, tilt: -20, efficiency: 0.45, wobble: 0 },
  SL: { type: 'SL', label: 'Slider', short: 'Slider', speedDelta: -4.5, rpm: 2450, tilt: -110, efficiency: 0.4, wobble: 0 },
  SW: { type: 'SW', label: 'Sweeper', short: 'Sweeper', speedDelta: -6, rpm: 2600, tilt: -95, efficiency: 0.7, wobble: 0 },
  CU: { type: 'CU', label: 'Curveball', short: 'Curve', speedDelta: -8, rpm: 2600, tilt: -165, efficiency: 0.75, wobble: 0 },
  CH: { type: 'CH', label: 'Changeup', short: 'Change', speedDelta: -6.5, rpm: 1750, tilt: 115, efficiency: 0.85, wobble: 0 },
  FS: { type: 'FS', label: 'Splitter', short: 'Splitter', speedDelta: -5.5, rpm: 1400, tilt: 150, efficiency: 0.7, wobble: 0 },
  KN: { type: 'KN', label: 'Knuckleball', short: 'Knuckler', speedDelta: -13, rpm: 120, tilt: 0, efficiency: 0.2, wobble: 0.55 },
}

export const PITCH_ORDER: readonly PitchType[] = ['FF', 'SI', 'FC', 'SL', 'SW', 'CU', 'CH', 'FS', 'KN']

export function isFastball(type: PitchType): boolean {
  return type === 'FF' || type === 'SI' || type === 'FC'
}

export const MPH = 2.23694

export function toMph(metresPerSecond: number): number {
  return metresPerSecond * MPH
}
