/** Balls in play: who gets to the ball and when, catches, errors, throws and every runner's race to the next bag, plus a timeline the renderer plays back. */
import { BASES, BASE_PATH, FIELDER_HOME, distance2, horizontalDistance, isBeyondBags, isFairAngle, sprayAngle } from './field'
import { type BallPath, judgeFair } from './flight'
import type { Rng } from './random'
import { TUNING } from './tuning'
import type { FieldPosition, Ratings, Sample, Vec3 } from './types'

export interface Defender {
  pos: FieldPosition
  id: string
  ratings: Ratings
}

export interface RunnerInfo {
  id: string
  speed: number
  /** 0 for the batter, otherwise the base the runner starts on. */
  from: number
  stealing: boolean
}

export interface PlayContext {
  outs: number
  batter: RunnerInfo
  runners: RunnerInfo[]
  bunt: boolean
  infieldFly: boolean
  defense: Defender[]
}

export type BattedType = 'ground' | 'line' | 'fly' | 'popup' | 'bunt'

export interface RunnerResult {
  id: string
  from: number
  to: number
  out: boolean
  force: boolean
  time: number
  /** True when the runner moved up only because of an error. */
  onError: boolean
}

export interface Credit {
  pos: FieldPosition
  kind: 'PO' | 'A' | 'E'
}

export type PlayKind = 'caught' | 'foulCaught' | 'foul' | 'groundout' | 'hit' | 'homer' | 'groundRule' | 'error' | 'fielderChoice' | 'infieldFly'

export interface TimelineTrack {
  id: string
  kind: 'ball' | 'fielder' | 'runner'
  keys: Sample[]
}

export interface Timeline {
  duration: number
  tracks: TimelineTrack[]
  marks: { t: number; text: string }[]
}

export interface PlayOutcome {
  kind: PlayKind
  battedType: BattedType
  hitBases: number
  runners: RunnerResult[]
  fielder: FieldPosition | null
  credits: Credit[]
  errorOn: FieldPosition | null
  sacFly: boolean
  sacBunt: boolean
  doublePlay: boolean
  description: string
  timeline: Timeline
}

const INFIELD: ReadonlySet<FieldPosition> = new Set(['P', 'C', '1B', '2B', '3B', 'SS'])
const POSITION_NAME: Readonly<Record<FieldPosition, string>> = {
  P: 'pitcher', C: 'catcher', '1B': 'first', '2B': 'second', '3B': 'third', SS: 'short', LF: 'left', CF: 'center', RF: 'right',
}
const FIELD_NAME: Readonly<Record<FieldPosition, string>> = {
  P: 'the pitcher', C: 'the catcher', '1B': 'first base', '2B': 'second base', '3B': 'third base', SS: 'shortstop', LF: 'left field', CF: 'center field', RF: 'right field',
}
const BASE_NAME = ['home', 'first', 'second', 'third', 'home']

function runnerTopSpeed(speed: number): number {
  return TUNING.runner.baseSpeed + TUNING.runner.speedRange * (speed / 100)
}

/** Seconds to cover `distance` from a standing start with the given top speed and acceleration. */
export function runTime(distance: number, top: number, accel: number): number {
  if (distance <= 0) return 0
  const ramp = (top * top) / (2 * accel)
  return distance >= ramp ? distance / top + top / (2 * accel) : Math.sqrt((2 * distance) / accel)
}

/** Runner clock to reach base `to` from base `from` (bases 0–4), starting `start` seconds after contact. */
export function runnerArrival(runner: RunnerInfo, to: number, start: number): number {
  const lead = TUNING.runner.lead[runner.from] ?? 0
  const legs = to - runner.from
  if (legs <= 0) return start
  const distance = legs * BASE_PATH - lead - (runner.from === 0 ? 1 : 0)
  const rounding = Math.max(0, legs - 1) * TUNING.runner.rounding
  const box = runner.from === 0 ? TUNING.runner.batterBox : 0
  return start + box + runTime(distance, runnerTopSpeed(runner.speed), TUNING.runner.accel) + rounding
}

function fielderTop(ratings: Ratings): number {
  return TUNING.fielder.baseSpeed + TUNING.fielder.speedRange * (ratings.speed / 100)
}

function throwSpeed(ratings: Ratings): number {
  return TUNING.throwing.base + TUNING.throwing.arm * (ratings.arm / 100)
}

function transfer(ratings: Ratings): number {
  return TUNING.throwing.transfer - TUNING.throwing.transferSkill * (ratings.fielding / 100)
}

function throwTime(from: { x: number; z: number }, to: { x: number; z: number }, ratings: Ratings): number {
  const distance = distance2(from, to)
  const relay = distance > TUNING.throwing.relayOver ? TUNING.throwing.relay : 0
  const arc = distance > 45 ? 0.9 : 1
  return distance / (throwSpeed(ratings) * arc) + relay
}

interface Intercept {
  defender: Defender
  index: number
  time: number
  slack: number
  air: boolean
}

function classify(path: BallPath, bunt: boolean): BattedType {
  if (bunt) return 'bunt'
  const launch = path.launch.launch
  if (launch < 10) return 'ground'
  if (launch < 25) return 'line'
  if (launch < 50) return 'fly'
  return 'popup'
}

function findIntercepts(path: BallPath, defense: Defender[], playable: (sample: Sample) => boolean, bunt: boolean): { air: Intercept | null; airStretch: Intercept | null; ground: Intercept | null } {
  const tune = TUNING.fielder
  let air: Intercept | null = null
  let airStretch: Intercept | null = null
  let ground: Intercept | null = null
  const samples = path.samples
  const groundStart = path.firstGround < 0 ? samples.length : path.firstGround
  const open = new Uint8Array(samples.length)
  for (let index = 0; index < samples.length; index++) open[index] = playable(samples[index]) ? 1 : 0
  for (const defender of defense) {
    const home = FIELDER_HOME[defender.pos]
    const top = fielderTop(defender.ratings)
    const liner = path.launch.launch >= 8 && path.launch.launch < 25 && !INFIELD.has(defender.pos)
    const reactionAir = tune.reaction + (defender.pos === 'C' ? 0.15 : defender.pos === 'P' ? 0.25 : 0) + (liner ? tune.linerRead : 0)
    const reactionGround = (bunt && (defender.pos === 'C' || defender.pos === 'P') ? 0.3 : tune.groundReaction) + (defender.pos === 'C' && !bunt ? 0.4 : 0)
    let bestAir: Intercept | null = null
    let bestStretch: Intercept | null = null
    for (let index = 1; index < groundStart; index++) {
      const sample = samples[index]
      if (sample.y > tune.airReach + 0.5 || !open[index]) continue
      const reach = sample.y <= tune.airReach ? tune.reach : tune.reach * 0.5
      const need = reactionAir + runTime(Math.max(0, distance2(home, sample) * tune.route - reach), top, tune.accel)
      const slack = sample.t - need
      if (slack >= 0 && sample.y <= tune.airReach) {
        if (!bestAir) bestAir = { defender, index, time: sample.t, slack, air: true }
      } else if (slack >= -tune.stretch && (!bestStretch || slack > bestStretch.slack)) {
        bestStretch = { defender, index, time: sample.t, slack, air: true }
      }
    }
    if (bestAir && (!air || bestAir.slack > air.slack)) air = bestAir
    if (!bestAir && bestStretch && (!airStretch || bestStretch.slack > airStretch.slack)) airStretch = bestStretch
    for (let index = Math.max(1, groundStart); index < samples.length; index++) {
      const sample = samples[index]
      if (!open[index]) continue
      const infielder = INFIELD.has(defender.pos)
      const reach = infielder ? tune.reach + (sample.t < 2.2 ? tune.dive * 0.5 : 0) : tune.reach
      const need = reactionGround + runTime(Math.max(0, distance2(home, sample) * (infielder ? 1 : tune.groundRoute) - reach), top, tune.accel)
      if (sample.t - need >= 0) {
        if (!ground || sample.t < ground.time) ground = { defender, index, time: sample.t, slack: sample.t - need, air: false }
        break
      }
    }
  }
  if (!ground && samples.length > 1) {
    const last = samples[samples.length - 1]
    let best: Intercept | null = null
    for (const defender of defense) {
      if (INFIELD.has(defender.pos)) continue
      const need = tune.reaction + runTime(distance2(FIELDER_HOME[defender.pos], last), fielderTop(defender.ratings), tune.accel)
      const time = Math.max(need, last.t)
      if (!best || time < best.time) best = { defender, index: samples.length - 1, time, slack: 0, air: false }
    }
    ground = best
  }
  return { air, airStretch, ground }
}

function directionLabel(point: { x: number; z: number }): string {
  const spray = sprayAngle(point)
  if (spray < -32) return 'down the left-field line'
  if (spray < -12) return 'to left'
  if (spray < -4) return 'to left-center'
  if (spray <= 4) return 'to center'
  if (spray <= 12) return 'to right-center'
  if (spray <= 32) return 'to right'
  return 'down the right-field line'
}

function coverFor(base: number, fielder: FieldPosition, at: { x: number; z: number }): FieldPosition {
  if (base === 1) return fielder === '1B' && distance2(at, BASES[1]) > 4 ? 'P' : '1B'
  if (base === 2) return fielder === 'SS' || fielder === '3B' || at.x < 0 ? '2B' : 'SS'
  if (base === 3) return fielder === '3B' ? 'SS' : '3B'
  return fielder === 'C' ? 'P' : 'C'
}

class TimelineBuilder {
  readonly tracks = new Map<string, TimelineTrack>()
  readonly marks: { t: number; text: string }[] = []
  duration = 0

  key(id: string, kind: TimelineTrack['kind'], t: number, p: Vec3): void {
    let track = this.tracks.get(id)
    if (!track) {
      track = { id, kind, keys: [] }
      this.tracks.set(id, track)
    }
    const last = track.keys[track.keys.length - 1]
    if (last && t < last.t) t = last.t
    track.keys.push({ t, x: p.x, y: p.y, z: p.z })
    this.duration = Math.max(this.duration, t)
  }

  ballPath(samples: readonly Sample[], until: number): void {
    for (const sample of samples) {
      if (sample.t > until) break
      this.key('ball', 'ball', sample.t, sample)
    }
  }

  throwBall(from: Vec3, to: Vec3, start: number, arrive: number): void {
    const distance = distance2(from, to)
    const apex = Math.min(7, 0.6 + distance * 0.06)
    for (let step = 0; step <= 8; step++) {
      const f = step / 8
      this.key('ball', 'ball', start + (arrive - start) * f, { x: from.x + (to.x - from.x) * f, y: 1.4 + Math.sin(Math.PI * f) * apex * (distance > 30 ? 1 : 0.3), z: from.z + (to.z - from.z) * f })
    }
  }

  fielderRun(pos: FieldPosition, target: Vec3, reaction: number, arrive: number): void {
    const home = FIELDER_HOME[pos]
    this.key(pos, 'fielder', 0, home)
    this.key(pos, 'fielder', Math.min(reaction, arrive), home)
    this.key(pos, 'fielder', arrive, target)
  }

  runner(result: RunnerResult, runner: RunnerInfo, start: number): void {
    const from = BASES[runner.from]
    this.key(runner.id, 'runner', 0, from)
    const lead = TUNING.runner.lead[runner.from] ?? 0
    const along = runner.from === 0 ? null : towards(BASES[runner.from], BASES[(runner.from + 1) % 4], lead)
    if (along) this.key(runner.id, 'runner', 0, along)
    const end = Math.min(result.to, 4)
    if (end === runner.from) {
      this.key(runner.id, 'runner', Math.max(start, 0.6), along ?? from)
      this.key(runner.id, 'runner', Math.max(start, 0.6) + 1.2, from)
      return
    }
    const legs = end - runner.from
    const total = Math.max(result.time - start, 0.1)
    for (let leg = 1; leg <= legs; leg++) {
      const base = BASES[(runner.from + leg) % 4]
      this.key(runner.id, 'runner', start + (total * leg) / legs, result.out && leg === legs ? towards(BASES[(runner.from + leg - 1) % 4], base, BASE_PATH - 0.8) : base)
    }
  }

  build(): Timeline {
    return { duration: this.duration + 0.6, tracks: [...this.tracks.values()], marks: this.marks.sort((a, b) => a.t - b.t) }
  }
}

function towards(a: Vec3, b: Vec3, metres: number): Vec3 {
  const length = distance2(a, b) || 1
  return { x: a.x + ((b.x - a.x) * metres) / length, y: 0, z: a.z + ((b.z - a.z) * metres) / length }
}

function baseAt(base: number): Vec3 {
  return BASES[base % 4]
}

interface Race {
  runner: RunnerInfo
  target: number
  force: boolean
  start: number
  arrive: number
}

/** Resolve a ball put in play. */
export function resolveBallInPlay(path: BallPath, context: PlayContext, rng: Rng, playableFoul: (sample: Sample) => boolean): PlayOutcome {
  const timeline = new TimelineBuilder()
  const battedType = classify(path, context.bunt)
  const fairness = judgeFair(path, isBeyondBags)
  const defense = context.defense
  const byPos = (pos: FieldPosition) => defense.find((item) => item.pos === pos) ?? defense[0]
  const playable = (sample: Sample) => (isFairAngle(sample) ? true : playableFoul(sample))
  const intercepts = findIntercepts(path, defense, playable, context.bunt)
  const allRunners = [context.batter, ...context.runners]
  const outcome = (partial: Partial<PlayOutcome> & Pick<PlayOutcome, 'kind' | 'description' | 'runners'>): PlayOutcome => ({
    battedType,
    hitBases: 0,
    fielder: null,
    credits: [],
    errorOn: null,
    sacFly: false,
    sacBunt: false,
    doublePlay: false,
    timeline: timeline.build(),
    ...partial,
  })
  const holdAll = (time: number) => context.runners.map((runner) => ({ id: runner.id, from: runner.from, to: runner.from, out: false, force: false, time, onError: false }))

  if (path.end === 'homer' && fairness === 'fair') {
    const fence = path.samples[path.fenceIndex]
    timeline.ballPath(path.samples, Infinity)
    const results = allRunners.map((runner) => ({ id: runner.id, from: runner.from, to: 4, out: false, force: false, time: runnerArrival(runner, 4, 0) + 3.5, onError: false }))
    for (const [index, runner] of allRunners.entries()) timeline.runner(results[index], runner, 0.3)
    timeline.marks.push({ t: fence.t, text: 'Gone!' })
    const feet = Math.round(horizontalDistance(fence) / 0.3048)
    return outcome({ kind: 'homer', hitBases: 4, runners: results, description: `Homered ${directionLabel(fence)}, ${feet} feet.` })
  }

  const air = intercepts.air
  let caughtInAir: Intercept | null = null
  if (air) caughtInAir = rng.chance(TUNING.errors.drop * (1.6 - air.defender.ratings.fielding / 100)) ? null : air
  if (!caughtInAir && intercepts.airStretch) {
    const stretch = intercepts.airStretch
    const p = (1 + stretch.slack / TUNING.fielder.stretch) * (0.35 + 0.45 * (stretch.defender.ratings.fielding / 100))
    if (rng.chance(p)) caughtInAir = stretch
  }
  const infieldFlyCalled = context.infieldFly && battedType === 'popup' && fairness === 'fair' && path.firstGround >= 0 && horizontalDistance(path.samples[path.firstGround]) < 50

  if (caughtInAir || infieldFlyCalled) {
    const catcher = caughtInAir?.defender ?? byPos(path.samples[Math.max(0, path.firstGround)].x > 0 ? '2B' : 'SS')
    const catchSample = caughtInAir ? path.samples[caughtInAir.index] : path.samples[path.firstGround]
    const catchTime = catchSample.t
    const foul = !isFairAngle(catchSample)
    timeline.ballPath(path.samples, catchTime)
    timeline.fielderRun(catcher.pos, { x: catchSample.x, y: 0, z: catchSample.z }, TUNING.fielder.reaction, catchTime)
    timeline.marks.push({ t: catchTime, text: caughtInAir && caughtInAir.slack < 0 ? 'What a catch!' : 'Caught.' })
    const credits: Credit[] = [{ pos: catcher.pos, kind: 'PO' }]
    const results: RunnerResult[] = [{ id: context.batter.id, from: 0, to: 0, out: true, force: false, time: catchTime, onError: false }]
    const outsAfter = context.outs + 1
    let doublePlay = false
    let sacFly = false
    for (const runner of [...context.runners].sort((a, b) => b.from - a.from)) {
      const origin = baseAt(runner.from)
      if (outsAfter >= 3) {
        results.push({ id: runner.id, from: runner.from, to: runner.from, out: false, force: false, time: catchTime, onError: false })
        continue
      }
      if (runner.stealing && battedType === 'line') {
        const back = catchTime + transfer(catcher.ratings) + throwTime(catchSample, origin, catcher.ratings)
        const returning = catchTime + 0.25 + runTime(TUNING.runner.lead[runner.from] + 9, runnerTopSpeed(runner.speed), TUNING.runner.accel)
        if (back < returning && !doublePlay) {
          doublePlay = true
          const cover = coverFor(runner.from, catcher.pos, catchSample)
          credits.push({ pos: catcher.pos, kind: 'A' }, { pos: cover, kind: 'PO' })
          results.push({ id: runner.id, from: runner.from, to: runner.from, out: true, force: false, time: back, onError: false })
          timeline.throwBall(catchSample, origin, catchTime + 0.3, back)
          timeline.marks.push({ t: back, text: 'Doubled off!' })
          continue
        }
      }
      const tagFrom = runner.from
      const next = tagFrom + 1
      const occupiedAhead = results.some((item) => !item.out && item.to === next && item.id !== runner.id)
      const deep = horizontalDistance(catchSample) > 60
      if ((tagFrom === 3 || (tagFrom === 2 && deep && catchSample.x > -10)) && !occupiedAhead && isFairAngle(catchSample)) {
        const runnerTime = catchTime + 0.1 + runTime(BASE_PATH, runnerTopSpeed(runner.speed), TUNING.runner.accel)
        const throwArrive = catchTime + transfer(catcher.ratings) + throwTime(catchSample, baseAt(next), catcher.ratings) + 0.15
        const margin = throwArrive - runnerTime
        const threshold = tagFrom === 3 ? (outsAfter === 2 ? -0.25 : -0.05) : 0.35
        if (margin > threshold) {
          const out = margin + rng.normal(0, TUNING.closePlay) < 0
          results.push({ id: runner.id, from: tagFrom, to: next, out, force: false, time: out ? throwArrive : runnerTime, onError: false })
          if (out) {
            doublePlay = true
            credits.push({ pos: catcher.pos, kind: 'A' }, { pos: next === 4 ? 'C' : coverFor(next, catcher.pos, catchSample), kind: 'PO' })
          } else if (next === 4) sacFly = true
          timeline.throwBall(catchSample, baseAt(next), catchTime + 0.35, throwArrive)
          continue
        }
      }
      results.push({ id: runner.id, from: tagFrom, to: tagFrom, out: false, force: false, time: catchTime, onError: false })
    }
    for (const result of results.slice(1)) {
      const runner = context.runners.find((item) => item.id === result.id)
      if (runner) timeline.runner(result, runner, catchTime)
    }
    if (doublePlay && sacFly) sacFly = false
    const where = foul ? 'in foul ground' : directionLabel(catchSample)
    const verb = infieldFlyCalled ? 'Infield fly, batter out:' : battedType === 'line' ? 'Lined out' : battedType === 'popup' ? 'Popped out' : battedType === 'ground' || battedType === 'bunt' ? 'Lined out' : 'Flied out'
    const description = infieldFlyCalled ? `${verb} popped up to ${POSITION_NAME[catcher.pos]}.` : `${verb} to ${FIELD_NAME[catcher.pos]}${foul ? ' ' + where : ''}${doublePlay ? ', double play' : ''}${sacFly ? ', run scores on the sacrifice fly' : ''}.`
    return outcome({ kind: infieldFlyCalled ? 'infieldFly' : foul ? 'foulCaught' : 'caught', runners: results, fielder: catcher.pos, credits, doublePlay, sacFly, description })
  }

  if (fairness === 'foul') {
    timeline.ballPath(path.samples, Infinity)
    return outcome({ kind: 'foul', runners: holdAll(0), description: 'Foul ball.' })
  }

  if (path.end === 'groundRule') {
    timeline.ballPath(path.samples, Infinity)
    const results = allRunners.map((runner) => ({ id: runner.id, from: runner.from, to: Math.min(4, runner.from + 2), out: false, force: false, time: runnerArrival(runner, Math.min(4, runner.from + 2), 0.2), onError: false }))
    for (const [index, runner] of allRunners.entries()) timeline.runner(results[index], runner, 0.2)
    return outcome({ kind: 'groundRule', hitBases: 2, runners: results, description: `Ground-rule double ${directionLabel(path.samples[path.fenceIndex])}.` })
  }

  const ground = intercepts.ground
  if (!ground) {
    timeline.ballPath(path.samples, Infinity)
    return outcome({ kind: 'foul', runners: holdAll(0), description: 'Foul ball.' })
  }
  const fielder = ground.defender
  const fieldSample = path.samples[ground.index]
  const fieldTime = ground.time + (INFIELD.has(fielder.pos) ? 0 : TUNING.fielder.gather)
  const fieldAt: Vec3 = { x: fieldSample.x, y: 0, z: fieldSample.z }
  timeline.ballPath(path.samples, fieldTime)
  timeline.fielderRun(fielder.pos, fieldAt, TUNING.fielder.groundReaction, fieldTime)

  const isInfieldPlay = INFIELD.has(fielder.pos) && horizontalDistance(fieldSample) < 48
  const airborneDelay = (runner: RunnerInfo) => {
    if (runner.from === 0) return 0
    if (runner.stealing) return -0.5
    if (context.outs === 2) return 0.05
    if (battedType === 'ground' || battedType === 'bunt') return TUNING.runner.reaction
    const landing = path.firstGround >= 0 ? path.samples[path.firstGround].t : fieldTime
    return Math.max(TUNING.runner.reaction, landing - 1.6)
  }

  const fieldError = rng.chance(TUNING.errors.fielding * (1.7 - fielder.ratings.fielding / 100) * (isInfieldPlay ? 1 : 0.35))

  if (isInfieldPlay) {
    return resolveInfieldPlay()
  }
  return resolveOutfieldPlay()

  function resolveInfieldPlay(): PlayOutcome {
    const occupied = new Set(context.runners.map((runner) => runner.from))
    const forced = (base: number) => {
      for (let b = 1; b <= base; b++) if (!occupied.has(b)) return false
      return true
    }
    const races: Race[] = []
    const claimed = new Set<number>()
    for (const runner of [...context.runners].sort((a, b) => b.from - a.from)) {
      const isForced = forced(runner.from)
      let advance = isForced || context.outs === 2 || runner.stealing
      if (!advance && runner.from === 2) advance = fieldAt.x > 3 || context.bunt
      if (!advance && runner.from === 3) advance = context.bunt ? false : rng.chance(0.4 + runner.speed / 300)
      if (advance && runner.from + 1 < 4 && claimed.has(runner.from + 1)) advance = false
      const target = advance ? runner.from + 1 : runner.from
      claimed.add(target)
      races.push({ runner, target, force: isForced, start: airborneDelay(runner), arrive: 0 })
    }
    races.unshift({ runner: context.batter, target: 1, force: true, start: 0, arrive: 0 })
    for (const race of races) race.arrive = runnerArrival(race.runner, race.target, race.start)

    const credits: Credit[] = []
    const results = new Map<string, RunnerResult>()
    const setResult = (race: Race, out: boolean, time: number, onError = false) => results.set(race.runner.id, { id: race.runner.id, from: race.runner.from, to: race.target, out, force: race.force, time, onError })

    if (fieldError) {
      credits.push({ pos: fielder.pos, kind: 'E' })
      for (const race of races) {
        if (race.target === race.runner.from && race.force === false) setResult(race, false, fieldTime + 1.5)
        else setResult(race, false, race.arrive + 0.6, true)
      }
      timeline.marks.push({ t: fieldTime, text: 'Error!' })
      finishRunners(races, results)
      return outcome({ kind: 'error', runners: [...results.values()], fielder: fielder.pos, credits, errorOn: fielder.pos, description: `Reached on an error by ${FIELD_NAME[fielder.pos]}.` })
    }

    const release = fieldTime + transfer(fielder.ratings) + (fielder.pos === 'C' || fielder.pos === 'P' ? 0.12 : 0)
    const throwArrive = (base: number) => {
      const target = baseAt(base)
      if (distance2(fieldAt, target) < 3.5 && base !== 4) return fieldTime + runTime(distance2(fieldAt, target), fielderTop(fielder.ratings), TUNING.fielder.accel) + 0.1
      return release + throwTime(fieldAt, target, fielder.ratings)
    }
    const margin = (race: Race) => race.arrive - (throwArrive(race.target) + (race.force ? 0 : 0.16)) + rng.normal(0, TUNING.closePlay)
    const moving = races.filter((race) => race.target > race.runner.from)
    const batterRace = races[0]
    const leadForce = moving.filter((race) => race.force && race.runner.from > 0).sort((a, b) => b.target - a.target)[0]
    const scoring = moving.find((race) => race.target === 4)

    let outRace: Race | null = null
    let throwBase = 1
    let doublePlay = false
    const bad = rng.chance(TUNING.errors.throwing * (1.5 - fielder.ratings.arm / 100))
    if (scoring && context.outs < 2 && !scoring.force && margin(scoring) > 0.25) {
      outRace = scoring
    } else if (scoring && scoring.force && margin(scoring) > 0) {
      outRace = scoring
    } else if (leadForce && margin(leadForce) > 0 && !context.bunt) {
      outRace = leadForce
    } else if (margin(batterRace) > 0) {
      outRace = batterRace
    }
    if (outRace) throwBase = outRace.target

    if (bad) {
      credits.push({ pos: fielder.pos, kind: 'E' })
      for (const race of races) {
        race.target = Math.min(4, race.runner.from + 2)
        race.arrive = runnerArrival(race.runner, race.target, race.start) + 0.5
        setResult(race, false, race.arrive, race.runner.from === 0 || race.target > race.runner.from + 1)
      }
      timeline.throwBall(fieldAt, { x: baseAt(throwBase).x + 6, y: 0, z: baseAt(throwBase).z - 6 }, release, release + 0.8)
      timeline.marks.push({ t: release + 0.8, text: 'Throwing error!' })
      finishRunners(races, results)
      return outcome({ kind: 'error', runners: [...results.values()], fielder: fielder.pos, credits, errorOn: fielder.pos, description: `Reached on a throwing error by ${FIELD_NAME[fielder.pos]}.` })
    }

    for (const race of races) setResult(race, false, race.arrive)
    if (outRace) {
      const arrive = throwArrive(outRace.target)
      setResult(outRace, true, arrive)
      const cover = distance2(fieldAt, baseAt(outRace.target)) < 3.5 && outRace.target !== 4 ? fielder.pos : coverFor(outRace.target, fielder.pos, fieldAt)
      if (cover === fielder.pos) credits.push({ pos: fielder.pos, kind: 'PO' })
      else credits.push({ pos: fielder.pos, kind: 'A' }, { pos: cover, kind: 'PO' })
      timeline.throwBall(fieldAt, baseAt(outRace.target), release, arrive)
      if (outRace !== batterRace && outRace.force && context.outs < 2 && outRace.target === 2) {
        const pivotDefender = byPos(cover)
        const relay = arrive + TUNING.throwing.pivot * (1.35 - pivotDefender.ratings.fielding / 200) + throwTime(baseAt(2), baseAt(1), pivotDefender.ratings)
        if (batterRace.arrive - relay + rng.normal(0, TUNING.closePlay) > 0) {
          doublePlay = true
          setResult(batterRace, true, relay)
          credits.push({ pos: cover, kind: 'A' }, { pos: '1B', kind: 'PO' })
          timeline.throwBall(baseAt(2), baseAt(1), arrive + 0.5, relay)
        }
      }
    } else {
      timeline.throwBall(fieldAt, baseAt(1), release, throwArrive(1))
    }

    finishRunners(races, results)
    const batterResult = results.get(context.batter.id)!
    const otherOut = [...results.values()].some((result) => result.out && result.id !== context.batter.id)
    const fieldName = FIELD_NAME[fielder.pos]
    if (batterResult.out) {
      const advanced = [...results.values()].some((result) => result.id !== context.batter.id && !result.out && result.to > result.from)
      const sacBunt = context.bunt && advanced && context.outs < 2 && !doublePlay
      const description = doublePlay
        ? `Grounded into a double play, ${POSITION_NAME[fielder.pos]} to ${POSITION_NAME[coverFor(2, fielder.pos, fieldAt)]} to first.`
        : sacBunt
          ? `Sacrifice bunt, ${POSITION_NAME[fielder.pos]} to first.`
          : `${context.bunt ? 'Bunted' : 'Grounded'} out to ${fieldName}.`
      return outcome({ kind: 'groundout', runners: [...results.values()], fielder: fielder.pos, credits, doublePlay, sacBunt, description })
    }
    if (otherOut) {
      const out = [...results.values()].find((result) => result.out)!
      return outcome({ kind: 'fielderChoice', runners: [...results.values()], fielder: fielder.pos, credits, description: `Fielder's choice to ${fieldName}, runner out at ${BASE_NAME[out.to]}.` })
    }
    return outcome({ kind: 'hit', hitBases: 1, runners: [...results.values()], fielder: fielder.pos, credits, description: `${context.bunt ? 'Bunt single' : 'Infield single'} to ${fieldName}.` })
  }

  function resolveOutfieldPlay(): PlayOutcome {
    const results = new Map<string, RunnerResult>()
    const credits: Credit[] = []
    const races: Race[] = []
    const extra = fieldError ? 1.6 : 0
    const release = fieldTime + transfer(fielder.ratings) + 0.15 + extra
    const defenseTime = (base: number) => release + throwTime(fieldAt, baseAt(base), fielder.ratings) + 0.15
    const ordered = [...allRunners].sort((a, b) => b.from - a.from)
    let ceiling = 5
    for (const runner of ordered) {
      const start = airborneDelay(runner)
      let target = Math.min(runner.from + 1, ceiling - 1)
      for (let base = target + 1; base <= Math.min(4, ceiling - 1); base++) {
        const want = base === runner.from + 1 ? 0 : base === 4 ? (context.outs === 2 ? 0.05 : 0.2) : base === 3 ? 0.15 : 0.05
        if (runnerArrival(runner, base, start) + want < defenseTime(base)) target = base
        else break
      }
      if (target >= 4) ceiling = 5
      else ceiling = target
      races.push({ runner, target, force: false, start, arrive: runnerArrival(runner, target, start) })
    }
    for (const race of races) results.set(race.runner.id, { id: race.runner.id, from: race.runner.from, to: race.target, out: false, force: false, time: race.arrive, onError: fieldError && race.target > race.runner.from + 1 })

    const contested = races.filter((race) => race.target > race.runner.from && !(race.runner.from === 0 && race.target === 1)).sort((a, b) => b.target - a.target)
    let thrownOut: Race | null = null
    for (const race of contested) {
      const margin = race.arrive - defenseTime(race.target) + rng.normal(0, TUNING.closePlay * 1.4)
      if (margin > 0) {
        thrownOut = race
        break
      }
    }
    const throwTarget = thrownOut?.target ?? (contested[0]?.target ?? 2)
    const arrive = defenseTime(throwTarget)
    timeline.throwBall(fieldAt, baseAt(throwTarget), release, arrive)
    if (thrownOut) {
      results.set(thrownOut.runner.id, { id: thrownOut.runner.id, from: thrownOut.runner.from, to: thrownOut.target, out: true, force: false, time: arrive, onError: false })
      credits.push({ pos: fielder.pos, kind: 'A' }, { pos: coverFor(thrownOut.target, fielder.pos, fieldAt), kind: 'PO' })
      timeline.marks.push({ t: arrive, text: 'Thrown out!' })
    }
    if (fieldError) {
      credits.push({ pos: fielder.pos, kind: 'E' })
      timeline.marks.push({ t: fieldTime, text: 'Bobbled!' })
    }
    finishRunners(races, results)
    const batter = results.get(context.batter.id)!
    const bases = batter.out ? Math.max(1, batter.to - 1) : Math.min(batter.to, 4)
    const hitBases = fieldError ? Math.max(1, bases - 1) : bases
    const word = hitBases >= 4 ? 'Inside-the-park home run' : hitBases === 3 ? 'Tripled' : hitBases === 2 ? 'Doubled' : 'Singled'
    const outNote = thrownOut ? (thrownOut.runner.from === 0 ? `, thrown out trying for ${BASE_NAME[thrownOut.target]}` : `, runner thrown out at ${BASE_NAME[thrownOut.target]}`) : ''
    return outcome({
      kind: 'hit',
      hitBases,
      runners: [...results.values()],
      fielder: fielder.pos,
      credits,
      errorOn: fieldError ? fielder.pos : null,
      description: `${word} ${directionLabel(fieldSample)}${outNote}${fieldError ? `, extra base on an error by ${FIELD_NAME[fielder.pos]}` : ''}.`,
    })
  }

  function finishRunners(races: Race[], results: Map<string, RunnerResult>): void {
    for (const race of races) {
      const result = results.get(race.runner.id)
      if (result) timeline.runner(result, race.runner, Math.max(0, race.start))
    }
  }
}
