/** League-wide totals over many headless contests, used by the calibration test and future season simulation. */
import { Contest, type ContestSetup } from './contest'
import { TEAMS } from './league'
import { Rng } from './random'
import type { TeamBox } from './scorebook'

export interface LeagueTotals {
  contests: number
  pa: number
  ab: number
  h: number
  doubles: number
  triples: number
  hr: number
  bb: number
  so: number
  hbp: number
  sf: number
  sb: number
  cs: number
  runs: number
  outs: number
  errors: number
  pitches: number
  fly: number
  flyHomers: number
  ground: number
  line: number
  popup: number
  swings: number
  whiffs: number
  doublePlays: number
  extraInnings: number
}

export function emptyTotals(): LeagueTotals {
  return { contests: 0, pa: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, bb: 0, so: 0, hbp: 0, sf: 0, sb: 0, cs: 0, runs: 0, outs: 0, errors: 0, pitches: 0, fly: 0, flyHomers: 0, ground: 0, line: 0, popup: 0, swings: 0, whiffs: 0, doublePlays: 0, extraInnings: 0 }
}

function addBox(totals: LeagueTotals, box: TeamBox): void {
  for (const line of box.batting) {
    totals.ab += line.ab
    totals.h += line.h
    totals.doubles += line.d
    totals.triples += line.t
    totals.hr += line.hr
    totals.bb += line.bb
    totals.so += line.so
    totals.hbp += line.hbp
    totals.sf += line.sf
    totals.sb += line.sb
    totals.cs += line.cs
    totals.pa += line.ab + line.bb + line.hbp + line.sf + line.sh
  }
  for (const line of box.pitching) {
    totals.outs += line.outs
    totals.pitches += line.pitches
  }
  totals.runs += box.runs
  totals.errors += box.errors
}

export function addContest(totals: LeagueTotals, contest: Contest): void {
  totals.contests++
  addBox(totals, contest.teams[0].box)
  addBox(totals, contest.teams[1].box)
  totals.fly += contest.tally.fly
  totals.flyHomers += contest.tally.flyHomers
  totals.ground += contest.tally.ground
  totals.line += contest.tally.line
  totals.popup += contest.tally.popup
  totals.swings += contest.tally.swings
  totals.whiffs += contest.tally.whiffs
  totals.doublePlays += contest.tally.doublePlays
  if (contest.inning > contest.setup.innings) totals.extraInnings++
}

export function mergeTotals(into: LeagueTotals, from: LeagueTotals): LeagueTotals {
  for (const key of Object.keys(into) as (keyof LeagueTotals)[]) into[key] += from[key]
  return into
}

export interface LeagueSummary {
  avg: number
  obp: number
  slg: number
  runsPerNine: number
  hrPerFly: number
  kRate: number
  bbRate: number
  hrRate: number
  babip: number
  pitchesPerNine: number
  groundShare: number
  whiffRate: number
  sbPerContest: number
  errorsPerContest: number
}

export function summarize(totals: LeagueTotals): LeagueSummary {
  const singles = totals.h - totals.doubles - totals.triples - totals.hr
  const nines = totals.outs / 27
  const battedOuts = totals.ab - totals.so - totals.hr + totals.sf
  const inPlay = totals.ground + totals.line + totals.fly + totals.popup
  return {
    avg: totals.h / totals.ab,
    obp: (totals.h + totals.bb + totals.hbp) / (totals.ab + totals.bb + totals.hbp + totals.sf),
    slg: (singles + 2 * totals.doubles + 3 * totals.triples + 4 * totals.hr) / totals.ab,
    runsPerNine: totals.runs / nines,
    hrPerFly: totals.flyHomers / Math.max(1, totals.fly),
    kRate: totals.so / totals.pa,
    bbRate: totals.bb / totals.pa,
    hrRate: totals.hr / totals.pa,
    babip: (totals.h - totals.hr) / Math.max(1, battedOuts),
    pitchesPerNine: totals.pitches / nines,
    groundShare: totals.ground / Math.max(1, inPlay),
    whiffRate: totals.whiffs / Math.max(1, totals.swings),
    sbPerContest: totals.sb / totals.contests,
    errorsPerContest: totals.errors / totals.contests,
  }
}

/** Plays `count` AI-vs-AI nine-inning contests between seeded random pairs of clubs, starting from `seed`. */
export function simulateLeague(count: number, seed: number, start = 0, options: Partial<ContestSetup> = {}): LeagueTotals {
  const totals = emptyTotals()
  for (let index = start; index < start + count; index++) {
    const rng = new Rng(seed + index * 7919)
    const away = rng.pick(TEAMS).id
    let home = rng.pick(TEAMS).id
    while (home === away) home = rng.pick(TEAMS).id
    const contest = new Contest({ seed: seed + index, away, home, innings: 9, dh: true, autoRunner: false, mercy: false, ...options })
    contest.simulate(5000)
    addContest(totals, contest)
  }
  return totals
}
