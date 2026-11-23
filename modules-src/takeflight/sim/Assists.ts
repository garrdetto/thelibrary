/**
 * Beginner assists, applied to the pilot's input before it is quantised and handed to the flight model, so a replay records what
 * the aircraft actually received. Auto-trim holds the pitch attitude when the stick is centred by running the trim; stall
 * protection pushes the nose down as the wing nears its critical angle; landing guidance is drawn by the HUD and changes nothing
 * here. Each assist lowers the flight's score multiplier.
 */
import type { ControlInput } from './Controls'
import type { FlightModel } from './FlightModel'
import { clamp, smoothstep } from './SimMath'

export interface AssistSettings {
  autoTrim: boolean
  stallProtection: boolean
  landingGuidance: boolean
}

export const NO_ASSISTS: AssistSettings = { autoTrim: false, stallProtection: false, landingGuidance: false }

/** Score multiplier for the assists in use: 1.0 with none, never below 0.7. */
export function assistMultiplier(settings: AssistSettings): number {
  let multiplier = 1
  if (settings.autoTrim) multiplier -= 0.08
  if (settings.stallProtection) multiplier -= 0.12
  if (settings.landingGuidance) multiplier -= 0.06
  return multiplier < 0.7 ? 0.7 : multiplier
}

/** Modifies `input` in place for the assists in `settings`, reading the aircraft's state. */
export function applyAssists(settings: AssistSettings, aircraft: FlightModel, input: ControlInput): void {
  if (settings.autoTrim && aircraft.wheelLoad <= 0 && aircraft.ias > aircraft.spec.vSpeeds.vs1 * 0.514444) {
    const centred = input.pitch > -0.05 && input.pitch < 0.05
    if (centred && input.trim === 0) {
      const pitchRate = aircraft.wz
      const holdVs = aircraft.verticalSpeed
      const want = pitchRate * 8 + holdVs * 0.02
      input.trim = want < -0.02 ? 1 : want > 0.02 ? -1 : 0
    }
  }
  if (settings.stallProtection && aircraft.wheelLoad <= 0) {
    const spec = aircraft.spec.aero
    const shift = spec.flapStallShift * aircraft.flap
    const limit = spec.stallAlpha + shift
    const push = smoothstep(limit - 4, limit - 0.5, aircraft.alpha)
    if (push > 0) input.pitch = clamp(input.pitch - push * (input.pitch + 0.4), -1, 1)
  }
}
