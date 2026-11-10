/** Plays a whole match between computer players in one go, through the same rules, choices and physics as a match on screen, for tournament matches nobody wants to watch. Deterministic for a given `rng`. */
import { cpuThrow } from './Cpu'
import type { GameState, MatchConfig } from './interfaces'
import { throwDart } from './Physics'
import { applyThrow, createMatch, currentPlayer, nextTurn, standings, type SeatSpec } from './Rules'
import type { Rng } from './Rng'

const DART_LIMIT = 6000

export function simulateMatch(config: MatchConfig, seats: readonly SeatSpec[], rng: Rng): GameState {
  let state = createMatch('sim', config, seats.map((seat) => ({ ...seat, cpu: true, cpuLevel: seat.cpuLevel ?? 'league' })))
  for (let darts = 0; darts < DART_LIMIT && state.status !== 'finished'; darts++) {
    if (state.status !== 'playing') {
      state = nextTurn(state).state
      continue
    }
    const player = currentPlayer(state)
    const choice = cpuThrow(state, player, rng)
    const { impact } = throwDart(choice.intent, player.cpuLevel, rng)
    state = applyThrow(state, player.id, impact.dart).state
  }
  if (state.status !== 'finished') state = { ...state, status: 'finished', winnerId: standings(state)[0].id }
  return state
}
