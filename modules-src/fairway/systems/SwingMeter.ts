/** Four-input swing meter as a pure state machine, advanced once per fixed step with the swing button's state: hold for power, tap for path, click-and-hold for contact, release for rhythm. */
import { tuning, type MeterSpec } from '../tuning'

export type MeterPhase = 'idle' | 'power' | 'path' | 'contact' | 'rhythm' | 'strike' | 'done'

export interface SwingButton {
  pressed: boolean
  released: boolean
  down: boolean
}

export interface MeterState {
  phase: MeterPhase
  /** Outer ring: grows while the button is held, locked on release. */
  power: number
  /** Cursor progress between the marks: 0 → 1 runs top to bottom on the path pass, then bottom to top on the contact pass. */
  cursor: number
  /** Inner rhythm ring: grows from the centre and reaches its mark at 1. */
  ring: number
  /** Seconds into the downswing after the rhythm release. */
  strike: number
  /** Cursor − mark at the path tap: negative is early (pull), positive late (push); null until tapped. */
  pathError: number | null
  /** Cursor − mark at the contact click: negative is early (closed face, hook), positive late (open face, slice). */
  contactError: number | null
  /** Ring − mark at the rhythm release: negative is early, positive late. */
  rhythmError: number | null
  /** Start-line miss in [−1, 1]: negative pulls left, positive pushes right. */
  push: number
  /** Clubface miss in [−1, 1]: negative hooks left, positive slices right. */
  curve: number
  /** Fraction of distance lost to a mistimed rhythm release, up to maxRhythmLoss. */
  rhythmLoss: number
  /** True when the cursor or ring ran past its mark and the input was taken for the player. */
  overran: boolean
}

export function idleMeter(): MeterState {
  return { phase: 'idle', power: 0, cursor: 0, ring: 0, strike: 0, pathError: null, contactError: null, rhythmError: null, push: 0, curve: 0, rhythmLoss: 0, overran: false }
}

/** The meter right after the swing button goes down: the power ring starts to grow. */
export function startMeter(): MeterState {
  return { ...idleMeter(), phase: 'power' }
}

/**
 * Maps a timing error to a miss in [0, 1]. Inside the perfect zone z·W it is 0; outside it grows as
 * m = ((|e| − z·W) / (W − z·W))^p, clamped to 1, with W the window and p the miss curve.
 */
export function missMagnitude(error: number, window: number, perfect: number, curve: number): number {
  const zone = perfect * window
  const miss = Math.abs(error)
  if (miss <= zone) return 0
  return Math.min(1, Math.pow((miss - zone) / Math.max(1e-6, window - zone), curve))
}

export function signedMiss(error: number, spec: MeterSpec = tuning.meter): number {
  const magnitude = missMagnitude(error, spec.window, spec.perfectZone, spec.missCurve)
  return error < 0 && magnitude > 0 ? -magnitude : magnitude
}

export function rhythmLossFor(error: number, spec: MeterSpec = tuning.meter): number {
  return spec.maxRhythmLoss * missMagnitude(error, spec.rhythmWindow, spec.rhythmPerfect, spec.missCurve)
}

/** Power that reaches the ball: the locked power less the rhythm loss. */
export function effectivePower(meter: MeterState): number {
  return meter.power * (1 - meter.rhythmLoss)
}

/**
 * Advances the meter by one fixed step.
 *   idle    → power    when the button goes down.
 *   power   → path     on release (power locks), or at the cap while still held.
 *   path    → contact  on a tap: pathError = cursor − 1 sets the push or pull. Running past the overrun is a full push.
 *   contact → rhythm   on a click: contactError = cursor − 1 sets the face (curve). Running past the overrun is a full
 *                      slice and skips rhythm with the full loss, because the button was never held.
 *   rhythm  → strike   on release: rhythmError = ring − 1 sets the distance loss. Holding past the overrun is a full loss.
 *   strike  → done     after the downswing time, when the ball is struck.
 */
export function stepMeter(state: MeterState, button: SwingButton, dt: number, spec: MeterSpec = tuning.meter): MeterState {
  switch (state.phase) {
    case 'idle':
      return button.pressed ? startMeter() : state
    case 'power': {
      if (!button.down) return { ...state, phase: 'path', cursor: 0 }
      const power = Math.min(spec.powerCap, state.power + spec.powerRate * dt)
      if (power >= spec.powerCap) return { ...state, phase: 'path', power, cursor: 0 }
      return { ...state, power }
    }
    case 'path': {
      if (button.pressed) {
        const pathError = state.cursor - 1
        return { ...state, phase: 'contact', cursor: 0, pathError, push: signedMiss(pathError, spec) }
      }
      const cursor = state.cursor + dt / spec.pathSeconds
      if (cursor > 1 + spec.overrun) return { ...state, phase: 'contact', cursor: 0, pathError: spec.overrun, push: 1, overran: true }
      return { ...state, cursor }
    }
    case 'contact': {
      if (button.pressed) {
        const contactError = state.cursor - 1
        return { ...state, phase: 'rhythm', ring: 0, contactError, curve: signedMiss(contactError, spec) }
      }
      const cursor = state.cursor + dt / spec.contactSeconds
      if (cursor > 1 + spec.overrun) {
        return { ...state, phase: 'strike', cursor, contactError: spec.overrun, curve: 1, rhythmError: -1, rhythmLoss: spec.maxRhythmLoss, overran: true, strike: 0 }
      }
      return { ...state, cursor }
    }
    case 'rhythm': {
      if (!button.down) {
        const rhythmError = state.ring - 1
        return { ...state, phase: 'strike', strike: 0, rhythmError, rhythmLoss: rhythmLossFor(rhythmError, spec) }
      }
      const ring = state.ring + dt / spec.rhythmSeconds
      if (ring > 1 + spec.rhythmOverrun) return { ...state, phase: 'strike', strike: 0, ring, rhythmError: spec.rhythmOverrun, rhythmLoss: spec.maxRhythmLoss, overran: true }
      return { ...state, ring }
    }
    case 'strike': {
      const strike = state.strike + dt
      return strike >= spec.strikeSeconds ? { ...state, phase: 'done', strike: spec.strikeSeconds } : { ...state, strike }
    }
    case 'done':
      return state
  }
}
