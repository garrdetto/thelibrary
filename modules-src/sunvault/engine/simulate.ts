import { JACKPOT_TIERS, type HaywireKind, type JackpotTier } from './paytable'
import { SlotEngine, type SpinResult } from './slotEngine'

export interface SimulationReport {
  spins: number
  wagered: number
  returned: number
  rtp: number
  hitRate: number
  sources: { lines: number; scatter: number; collect: number; pick: number; haywire: number; free: number; respin: number }
  freeEvery: number
  respinEvery: number
  collectEvery: number
  haywireEvery: number
  haywires: Record<HaywireKind, number>
  jackpots: Record<JackpotTier, number>
  biggestWinMultiple: number
  standardDeviation: number
}

export interface SimulationProgress {
  done: number
  report: SimulationReport
}

export class Simulation {
  private engine: SlotEngine
  private readonly bet: number
  private spins = 0
  private hits = 0
  private wagered = 0
  private returned = 0
  private sumSquares = 0
  private freeTriggers = 0
  private respinTriggers = 0
  private baseCollects = 0
  private biggest = 0
  private haywires: Record<HaywireKind, number> = { wilds: 0, coins: 0, double: 0 }
  private sources = { lines: 0, scatter: 0, collect: 0, pick: 0, haywire: 0, free: 0, respin: 0 }
  private jackpots: Record<JackpotTier, number> = { mini: 0, minor: 0, major: 0, grand: 0 }

  constructor(seed: number, bet = 100) {
    this.bet = bet
    this.engine = new SlotEngine({ seed, balance: Number.MAX_SAFE_INTEGER / 4 })
  }

  run(count: number): void {
    for (let index = 0; index < count; index++) this.playOne()
  }

  private playOne(): void {
    let result: SpinResult = this.engine.spin(this.bet)
    this.spins++
    this.wagered += this.bet
    let roundWin = 0
    const record = (step: SpinResult) => {
      roundWin += step.stepWin
      for (const award of step.jackpots) this.jackpots[award.tier]++
      if (step.mode === 'respin') {
        this.sources.respin += step.stepWin
        return
      }
      const lines = step.lineWins.reduce((sum, win) => sum + win.win, 0)
      const collect = step.collects.reduce((sum, event) => sum + event.amount, 0)
      if (step.mode === 'free') {
        this.sources.free += step.stepWin
        return
      }
      this.sources.lines += lines
      this.sources.scatter += step.scatter.win
      this.sources.collect += collect
      const pick = step.pick?.amount ?? 0
      this.sources.pick += pick
      if (step.haywire) {
        this.haywires[step.haywire.kind]++
        this.sources.haywire += step.stepWin - (lines + step.scatter.win + collect + pick)
      }
      if (step.collects.length > 0) this.baseCollects++
      if (step.trigger === 'free') this.freeTriggers++
      if (step.trigger === 'respin') this.respinTriggers++
    }
    record(result)
    while (result.state.mode !== 'base') {
      result = this.engine.spin(this.bet)
      record(result)
    }
    if (roundWin > 0) this.hits++
    this.returned += roundWin
    const multiple = roundWin / this.bet
    this.sumSquares += multiple * multiple
    if (multiple > this.biggest) this.biggest = multiple
  }

  report(): SimulationReport {
    const spins = Math.max(1, this.spins)
    const rtp = this.returned / Math.max(1, this.wagered)
    const share = (value: number) => value / Math.max(1, this.wagered)
    const every = (count: number) => (count > 0 ? spins / count : Infinity)
    const jackpots = Object.fromEntries(JACKPOT_TIERS.map((tier) => [tier, this.jackpots[tier]])) as Record<JackpotTier, number>
    return {
      spins: this.spins,
      wagered: this.wagered,
      returned: this.returned,
      rtp,
      hitRate: this.hits / spins,
      sources: {
        lines: share(this.sources.lines),
        scatter: share(this.sources.scatter),
        collect: share(this.sources.collect),
        pick: share(this.sources.pick),
        haywire: share(this.sources.haywire),
        free: share(this.sources.free),
        respin: share(this.sources.respin),
      },
      freeEvery: every(this.freeTriggers),
      respinEvery: every(this.respinTriggers),
      collectEvery: every(this.baseCollects),
      haywireEvery: every(this.haywires.wilds + this.haywires.coins + this.haywires.double),
      haywires: { ...this.haywires },
      jackpots,
      biggestWinMultiple: this.biggest,
      standardDeviation: Math.sqrt(Math.max(0, this.sumSquares / spins - rtp * rtp)),
    }
  }
}

export function simulate(spins: number, seed: number, bet = 100): SimulationReport {
  const simulation = new Simulation(seed, bet)
  simulation.run(spins)
  return simulation.report()
}
