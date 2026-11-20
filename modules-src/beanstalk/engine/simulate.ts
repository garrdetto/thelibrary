import { BeanstalkEngine } from './engine'

export interface SimulationReport {
  rounds: number
  wagered: number
  won: number
  rtp: number
  hitRate: number
  freeRate: number
  haywireRate: number
  freeShare: number
  biggestMultiple: number
  vinesPerSpin: number
}

export function simulate(rounds: number, seed = 1, bet = 100): SimulationReport {
  const engine = new BeanstalkEngine({ seed, balance: Number.MAX_SAFE_INTEGER / 4 })
  let freeWon = 0
  let biggest = 0
  for (let round = 0; round < rounds; round++) {
    let result = engine.spin(bet)
    let roundWin = result.stepWin
    while (engine.inFeature) {
      result = engine.spin(bet)
      roundWin += result.stepWin
      freeWon += result.stepWin
    }
    if (roundWin > biggest) biggest = roundWin
  }
  const stats = engine.snapshot().stats
  return {
    rounds,
    wagered: stats.wagered,
    won: stats.won,
    rtp: stats.won / stats.wagered,
    hitRate: stats.hits / stats.spins,
    freeRate: stats.freeTriggers / stats.spins,
    haywireRate: stats.haywires / stats.spins,
    freeShare: stats.won ? freeWon / stats.won : 0,
    biggestMultiple: biggest / bet,
    vinesPerSpin: stats.vines / stats.spins,
  }
}
