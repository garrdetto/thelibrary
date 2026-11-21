import { seededRng } from '../../foxlake/casino/math/rng'
import { DollazGame } from './game'

export interface SimulationReport {
  rounds: number
  rtp: number
  hitRate: number
  collectRate: number
  freeRate: number
  pickRate: number
  biggestMultiple: number
}

export function simulate(rounds: number, seed = 1, bet = 100): SimulationReport {
  const game = new DollazGame({ balance: Number.MAX_SAFE_INTEGER / 4 })
  const rng = seededRng(seed)
  let biggest = 0
  for (let round = 0; round < rounds; round++) {
    const played = game.spin(bet, null, rng)
    if (played.win > biggest) biggest = played.win
  }
  const stats = game.snapshot().stats
  return {
    rounds,
    rtp: stats.won / stats.wagered,
    hitRate: stats.hits / stats.spins,
    collectRate: stats.collects / stats.spins,
    freeRate: stats.frees / stats.spins,
    pickRate: stats.picks / stats.spins,
    biggestMultiple: biggest / bet,
  }
}
