/** Three-click swing meter as a pure state machine, advanced once per fixed step with whether "swing" was pressed. */
import { tuning, type MeterSpec } from '../tuning'

export type MeterPhase = 'idle' | 'climbing' | 'returning' | 'done'

export interface MeterState {
  phase: MeterPhase
  /** Needle position: 0 at the bottom of the arc, 1 at full power; it may dip below 0 past the accuracy line. */
  needle: number
  power: number
  /** needle − accuracyLine at the third click: positive is early (hook), negative is late (slice). */
  accuracy: number
  /** Accuracy mapped through the curve to [−1, 1]: negative hooks left, positive slices right. */
  curve: number
  /** True when the needle ran past the overshoot limit and the swing was taken for the player. */
  overshot: boolean
}

export function idleMeter(): MeterState {
  return { phase: 'idle', needle: 0, power: 0, accuracy: 0, curve: 0, overshot: false }
}

/**
 * Maps the accuracy sample to a signed curve in [−1, 1]. Inside the perfect zone (a fraction of the window) the shot
 * is straight. Outside it the miss grows as m = ((|a| − z·W) / (W − z·W))^p, clamped to 1, with W the accuracy window,
 * z the perfect-zone fraction and p the accuracy curve exponent. Early clicks (a > 0) hook, so the sign flips.
 */
export function accuracyToCurve(accuracy: number, spec: MeterSpec = tuning.meter): number {
  const window = spec.accuracyWindow
  const zone = spec.perfectZone * window
  const miss = Math.abs(accuracy)
  if (miss <= zone) return 0
  const magnitude = Math.min(1, Math.pow((miss - zone) / Math.max(1e-6, window - zone), spec.accuracyCurve))
  return accuracy > 0 ? -magnitude : magnitude
}

/**
 * Advances the meter by one fixed step.
 *   idle      → climbing   on click 1; the needle rises at climbRate (fraction per second).
 *   climbing  → returning  on click 2 (power = min(needle, 1)), or automatically at the climb cap with full power;
 *                          the needle then falls back at returnRate toward the accuracy line.
 *   returning → done       on click 3: accuracy = needle − accuracyLine. If the needle passes the overshoot limit
 *                          first, the swing is taken with the maximum slice (curve = 1).
 * "done" is terminal until the caller resets to idle after launching the shot.
 */
export function stepMeter(state: MeterState, clicked: boolean, dt: number, spec: MeterSpec = tuning.meter): MeterState {
  switch (state.phase) {
    case 'idle':
      return clicked ? { ...idleMeter(), phase: 'climbing' } : state
    case 'climbing': {
      const needle = Math.min(spec.climbCap, state.needle + spec.climbRate * dt)
      if (clicked || needle >= spec.climbCap) return { ...state, phase: 'returning', needle, power: Math.min(1, needle) }
      return { ...state, needle }
    }
    case 'returning': {
      if (clicked) {
        const accuracy = state.needle - spec.accuracyLine
        return { ...state, phase: 'done', accuracy, curve: accuracyToCurve(accuracy, spec) }
      }
      const needle = state.needle - spec.returnRate * dt
      if (needle <= spec.overshootLimit) {
        return { ...state, phase: 'done', needle: spec.overshootLimit, accuracy: spec.overshootLimit - spec.accuracyLine, curve: 1, overshot: true }
      }
      return { ...state, needle }
    }
    case 'done':
      return state
  }
}
