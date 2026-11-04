/** Local presentation flow for every mode as one discriminated union: menu → preview → aiming → swinging → flight → resting → (nextTurn | holeOut) → scorecard → finished. */
import { tuning, type RoundMode } from '../tuning'
import { sampleCount, type ShotResult } from './BallFlight'
import type { MatchEvent, MatchUpdate } from './Match'
import { idleMeter, stepMeter, type MeterState } from './SwingMeter'

export type RoundState =
  | { phase: 'menu' }
  | { phase: 'preview'; mode: RoundMode; elapsed: number }
  | { phase: 'aiming'; mode: RoundMode }
  | { phase: 'swinging'; mode: RoundMode; meter: MeterState }
  | { phase: 'flight'; mode: RoundMode; playerId: string; shot: ShotResult; step: number; pending: MatchUpdate | null }
  | { phase: 'resting'; mode: RoundMode; playerId: string; shot: ShotResult; elapsed: number; pending: MatchUpdate | null }
  | { phase: 'nextTurn'; mode: RoundMode; elapsed: number; events: MatchEvent[] }
  | { phase: 'holeOut'; mode: RoundMode; elapsed: number; events: MatchEvent[]; celebrate: boolean }
  | { phase: 'scorecard'; mode: RoundMode; finished: boolean; elapsed: number }
  | { phase: 'finished'; mode: RoundMode }

export type RoundEvent =
  | { type: 'begin'; mode: RoundMode }
  | { type: 'skipPreview' }
  | { type: 'readyToAim' }
  | { type: 'swingPressed' }
  | { type: 'launch'; playerId: string; shot: ShotResult; pending: MatchUpdate | null }
  | { type: 'resolved'; update: MatchUpdate }
  | { type: 'continue' }
  | { type: 'menu' }

export interface TickResult {
  state: RoundState
  /** Set on the step the swing meter finishes, so the caller can launch the shot from it. */
  swing: MeterState | null
  /** Events applied to the shown match state on this step (they arrive when the ball comes to rest). */
  applied: MatchUpdate | null
}

export const MENU: RoundState = { phase: 'menu' }

function settle(mode: RoundMode, update: MatchUpdate): RoundState {
  const holeDone = update.events.some((event) => event.type === 'holeComplete')
  if (holeDone) {
    const celebrate = update.events.some((event) => (event.type === 'holed' || event.type === 'pin') && event.holeInOne)
    return { phase: 'holeOut', mode, elapsed: 0, events: update.events, celebrate }
  }
  return { phase: 'nextTurn', mode, elapsed: 0, events: update.events }
}

/** Discrete transitions driven by the player or the network. Events that do not apply to the current phase are ignored. */
export function reduceRound(state: RoundState, event: RoundEvent): RoundState {
  switch (event.type) {
    case 'begin':
      return { phase: 'preview', mode: event.mode, elapsed: 0 }
    case 'menu':
      return MENU
    case 'skipPreview':
      return state.phase === 'preview' ? { phase: 'aiming', mode: state.mode } : state
    case 'readyToAim':
      return state.phase === 'nextTurn' || state.phase === 'preview' ? { phase: 'aiming', mode: state.mode } : state
    case 'swingPressed':
      return state.phase === 'aiming' ? { phase: 'swinging', mode: state.mode, meter: stepMeter(idleMeter(), true, 0) } : state
    case 'launch':
      return state.phase === 'menu' || state.phase === 'finished' ? state : { phase: 'flight', mode: state.mode, playerId: event.playerId, shot: event.shot, step: 0, pending: event.pending }
    case 'resolved':
      if (state.phase === 'flight' || state.phase === 'resting') return { ...state, pending: event.update }
      return state
    case 'continue':
      if (state.phase === 'scorecard') return state.finished ? { phase: 'finished', mode: state.mode } : { phase: 'preview', mode: state.mode, elapsed: 0 }
      if (state.phase === 'holeOut') return { phase: 'scorecard', mode: state.mode, finished: state.events.some((item) => item.type === 'finished'), elapsed: 0 }
      return state
  }
}

/**
 * Time-driven transitions, one fixed step at a time. The meter advances while swinging; flight plays one sample per
 * step; the shown match state switches only once the ball is at rest and the authoritative update is known, so a guest
 * waiting on the host simply lingers in "resting". Preview ends after the camera fly-over, holeOut after its banner.
 */
export function tickRound(state: RoundState, dt: number, swingClicked: boolean, previewSeconds: number): TickResult {
  const timing = tuning.timing
  switch (state.phase) {
    case 'preview': {
      const elapsed = state.elapsed + dt
      if (elapsed >= previewSeconds) return { state: { phase: 'aiming', mode: state.mode }, swing: null, applied: null }
      return { state: { ...state, elapsed }, swing: null, applied: null }
    }
    case 'swinging': {
      const meter = stepMeter(state.meter, swingClicked, dt)
      return { state: { ...state, meter }, swing: meter.phase === 'done' ? meter : null, applied: null }
    }
    case 'flight': {
      const step = state.step + 1
      if (step >= sampleCount(state.shot) - 1) {
        return { state: { phase: 'resting', mode: state.mode, playerId: state.playerId, shot: state.shot, elapsed: 0, pending: state.pending }, swing: null, applied: null }
      }
      return { state: { ...state, step }, swing: null, applied: null }
    }
    case 'resting': {
      const elapsed = state.elapsed + dt
      if (elapsed >= timing.restSeconds && state.pending) return { state: settle(state.mode, state.pending), swing: null, applied: state.pending }
      return { state: { ...state, elapsed }, swing: null, applied: null }
    }
    case 'nextTurn': {
      const elapsed = state.elapsed + dt
      if (elapsed >= timing.nextTurnSeconds) return { state: { phase: 'aiming', mode: state.mode }, swing: null, applied: null }
      return { state: { ...state, elapsed }, swing: null, applied: null }
    }
    case 'holeOut': {
      const elapsed = state.elapsed + dt
      const limit = state.celebrate ? timing.celebrationSeconds : timing.holeOutSeconds
      if (elapsed >= limit) return { state: reduceRound(state, { type: 'continue' }), swing: null, applied: null }
      return { state: { ...state, elapsed }, swing: null, applied: null }
    }
    case 'scorecard': {
      const elapsed = state.elapsed + dt
      if (state.mode === 'online' && !state.finished && elapsed >= timing.scorecardSeconds) return { state: reduceRound(state, { type: 'continue' }), swing: null, applied: null }
      return { state: { ...state, elapsed }, swing: null, applied: null }
    }
    default:
      return { state, swing: null, applied: null }
  }
}
