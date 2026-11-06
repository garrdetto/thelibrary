/** One contest from first pitch to final. Driven by intents (pre-pitch, pitch, swing); outcomes come from the play stream, AI choices from the AI stream, so a seed plus the recorded intents replays it exactly. */
import { chooseAiPitch, chooseAiSwing, type PitchIntent, type PrePitchIntent } from './ai'
import { resolveContact, type SwingIntent } from './contact'
import { BASES, BASE_PATH, PLATE_HALF_WIDTH, inFoulPlayable, strikeZone } from './field'
import { airFor, battedBallPath, pitchFlightTime, releasePoint, type Air, type BallPath } from './flight'
import { resolveBallInPlay, runTime, type Defender, type PlayOutcome, type RunnerInfo } from './fielding'
import { parkById } from './league'
import { PITCH_SPECS, toMph } from './pitches'
import { Rng, hashSeed } from './random'
import { buildRoster, fullName, shortName } from './roster'
import { emptyBatting, emptyPitching, emptyTeamBox, fieldingLine, type BattingLine, type PitchingLine, type PlayLogEntry, type TeamBox } from './scorebook'
import { TUNING } from './tuning'
import { FIELD_POSITIONS, type FieldPosition, type Half, type Hand, type LineupPosition, type Park, type Player, type PitchType, type Roster, type Side, type Vec3, type Wind } from './types'

export type { PitchIntent, PrePitchIntent } from './ai'
export type { SwingIntent } from './contact'

export interface ContestSetup {
  seed: number
  away: string
  home: string
  innings: 3 | 6 | 9
  dh: boolean
  autoRunner: boolean
  mercy: boolean
  park?: string
  /** Batting-practice pitches: every pitch crosses exactly at its target (rule drills, Home Run Derby). */
  practice?: boolean
}

export type InputRecord = { kind: 'pre'; intent: PrePitchIntent } | { kind: 'pitch'; intent: PitchIntent } | { kind: 'swing'; intent: SwingIntent }

export interface ThrownPitch {
  number: number
  type: PitchType
  speed: number
  mph: number
  plateX: number
  plateY: number
  release: Vec3
  throws: Hand
  pitcherId: string
  batterId: string
  inZone: boolean
  flightTime: number
  wobbleSeed: number
  grade: number
  intent: PitchIntent
}

export type PitchCall = 'ball' | 'called' | 'swinging' | 'foul' | 'tip' | 'inPlay' | 'hbp'

export interface PitchOutcome {
  pitch: ThrownPitch
  swing: SwingIntent
  call: PitchCall
  batted: BallPath | null
  play: PlayOutcome | null
  events: string[]
  plateAppearanceOver: boolean
  halfOver: boolean
  final: boolean
  runs: number
}

export interface PreOutcome {
  events: string[]
  halfOver: boolean
  final: boolean
}

interface SlotPlayer {
  id: string
  pos: LineupPosition
}

interface PitcherState {
  pitches: number
  entered: { inning: number; outs: number; lead: number; save: boolean }
  starter: boolean
  holdEligible: boolean
  blown: boolean
}

interface BaseRunner {
  id: string
  pitcherId: string
  earned: boolean
  stealing: boolean
}

interface TeamState {
  roster: Roster
  players: Map<string, Player>
  order: SlotPlayer[]
  next: number
  defense: Record<FieldPosition, string>
  pitcherId: string
  bench: string[]
  bullpen: string[]
  removed: Set<string>
  warming: { id: string; progress: number } | null
  visits: number
  box: TeamBox
  pitcherState: Map<string, PitcherState>
}

export type ContestPhase = 'pre' | 'pitch' | 'swing' | 'final'

const LINEUP_ORDER: readonly LineupPosition[] = ['CF', 'SS', 'RF', '1B', 'DH', '3B', 'LF', 'C', '2B']

export class Contest {
  readonly setup: ContestSetup
  readonly park: Park
  readonly wind: Wind
  readonly air: Air
  readonly teams: [TeamState, TeamState]
  readonly log: InputRecord[] = []
  readonly plays: PlayLogEntry[] = []
  phase: ContestPhase = 'pre'
  inning = 1
  half: Half = 'top'
  outs = 0
  balls = 0
  strikes = 0
  score: [number, number] = [0, 0]
  bases: (BaseRunner | null)[] = [null, null, null, null]
  winner: Side | null = null
  pitchCount = 0
  /** Times two runners were resolved onto the same base; always 0 unless the fielding resolver has a bug. */
  collisions = 0
  readonly tally = { inPlay: 0, ground: 0, line: 0, fly: 0, popup: 0, flyHomers: 0, fouls: 0, swings: 0, whiffs: 0, doublePlays: 0 }
  lastPitch: ThrownPitch | null = null
  private readonly aiRng: Rng
  private readonly playRng: Rng
  private errorOuts = 0
  private lastType: PitchType | null = null
  private pendingSteal: number[] = []
  private winCandidate: [string | null, string | null] = [null, null]
  private loseCandidate: [string | null, string | null] = [null, null]

  constructor(setup: ContestSetup) {
    this.setup = setup
    this.park = parkById(setup.park ?? buildRoster(setup.home).team.park)
    const windRng = new Rng(hashSeed(setup.seed, 0x77))
    const base = this.park.wind
    this.wind = { speed: Math.max(0, base.speed + windRng.normal(0, 1.4)), toward: base.toward + windRng.normal(0, 50) }
    this.air = airFor(this.park, this.wind)
    this.aiRng = new Rng(hashSeed(setup.seed, 0xa1))
    this.playRng = new Rng(hashSeed(setup.seed, 0x91a7))
    const starterRng = new Rng(hashSeed(setup.seed, 0x5a))
    this.teams = [this.buildTeam(setup.away, starterRng.int(0, 4)), this.buildTeam(setup.home, starterRng.int(0, 4))]
  }

  private buildTeam(teamId: string, starterIndex: number): TeamState {
    const roster = buildRoster(teamId)
    const players = new Map<string, Player>()
    for (const player of [...roster.hitters, ...roster.pitchers]) players.set(player.id, player)
    const starters = roster.hitters.slice(0, 9)
    const pitcher = roster.pitchers[starterIndex]
    const defense = {} as Record<FieldPosition, string>
    for (const player of starters) if (player.position !== 'DH') defense[player.position as FieldPosition] = player.id
    defense.P = pitcher.id
    const order: SlotPlayer[] = LINEUP_ORDER.map((pos) => {
      const player = starters.find((item) => item.position === pos)!
      return { id: player.id, pos }
    })
    const bench = roster.hitters.slice(9).map((player) => player.id)
    if (!this.setup.dh) {
      const dh = order.findIndex((slot) => slot.pos === 'DH')
      bench.push(order[dh].id)
      order.splice(dh, 1)
      order.push({ id: pitcher.id, pos: 'P' })
    }
    const box = emptyTeamBox(teamId)
    for (const slot of order) box.batting.push(emptyBatting(slot.id, shortName(players.get(slot.id)!), slot.pos))
    box.pitching.push(emptyPitching(pitcher.id, shortName(pitcher)))
    const pitcherState = new Map<string, PitcherState>()
    pitcherState.set(pitcher.id, { pitches: 0, entered: { inning: 1, outs: 0, lead: 0, save: false }, starter: true, holdEligible: false, blown: false })
    return {
      roster,
      players,
      order,
      next: 0,
      defense,
      pitcherId: pitcher.id,
      bench,
      bullpen: roster.pitchers.filter((item, index) => index >= 5 && item.id !== pitcher.id).map((item) => item.id),
      removed: new Set(),
      warming: null,
      visits: 0,
      box,
      pitcherState,
    }
  }

  get battingSide(): Side {
    return this.half === 'top' ? 0 : 1
  }

  get fieldingSide(): Side {
    return this.half === 'top' ? 1 : 0
  }

  get offense(): TeamState {
    return this.teams[this.battingSide]
  }

  get defenseTeam(): TeamState {
    return this.teams[this.fieldingSide]
  }

  player(id: string): Player {
    return this.teams[0].players.get(id) ?? this.teams[1].players.get(id)!
  }

  get batter(): Player {
    const offense = this.offense
    return offense.players.get(offense.order[offense.next].id)!
  }

  get pitcher(): Player {
    return this.defenseTeam.players.get(this.defenseTeam.pitcherId)!
  }

  get onDeck(): Player {
    const offense = this.offense
    return offense.players.get(offense.order[(offense.next + 1) % offense.order.length].id)!
  }

  runnerOn(base: number): Player | null {
    const runner = this.bases[base]
    return runner ? this.player(runner.id) : null
  }

  fatigue(id = this.defenseTeam.pitcherId): number {
    const state = this.defenseTeam.pitcherState.get(id) ?? this.offense.pitcherState.get(id)
    const pitcher = this.player(id).pitching
    if (!state || !pitcher) return 0
    const free = TUNING.fatigue.freePitches + pitcher.stamina * TUNING.fatigue.perStamina
    return Math.max(0, state.pitches - free) / TUNING.fatigue.scale
  }

  pitchesThrown(id = this.defenseTeam.pitcherId): number {
    return this.defenseTeam.pitcherState.get(id)?.pitches ?? 0
  }

  private batterHand(): Hand {
    const batter = this.batter
    if (batter.bats !== 'S') return batter.bats
    return this.pitcher.throws === 'R' ? 'L' : 'R'
  }

  private lead(side: Side): number {
    return this.score[side] - this.score[side === 0 ? 1 : 0]
  }

  private runnersOn(): number {
    return (this.bases[1] ? 1 : 0) + (this.bases[2] ? 1 : 0) + (this.bases[3] ? 1 : 0)
  }

  private batLine(id: string): BattingLine {
    const box = this.teams[0].players.has(id) ? this.teams[0].box : this.teams[1].box
    let line = box.batting.find((item) => item.id === id)
    if (!line) {
      line = emptyBatting(id, shortName(this.player(id)), 'PH')
      box.batting.push(line)
    }
    return line
  }

  private pitchLine(id: string): PitchingLine {
    const box = this.teams[0].players.has(id) ? this.teams[0].box : this.teams[1].box
    let line = box.pitching.find((item) => item.id === id)
    if (!line) {
      line = emptyPitching(id, shortName(this.player(id)))
      box.pitching.push(line)
    }
    return line
  }

  private note(text: string): void {
    this.plays.push({ inning: this.inning, half: this.half, outs: this.outs, batter: fullName(this.batter), pitcher: fullName(this.pitcher), text, score: [this.score[0], this.score[1]] })
  }

  /** AI suggestion for the pre-pitch decisions of both clubs (steals for the offense; pickoffs, bullpen and pitching changes for the defense; pinch hitters). */
  suggestPrePitch(): PrePitchIntent {
    const rng = this.aiRng
    const intent: PrePitchIntent = { steal: [], pickoff: 0, change: null, warm: null, pinchHit: null }
    const defense = this.defenseTeam
    const fatigue = this.fatigue()
    const state = defense.pitcherState.get(defense.pitcherId)!
    const pitchLine = this.pitchLine(defense.pitcherId)
    const lead = this.lead(this.fieldingSide)
    const lateInning = this.inning >= this.setup.innings
    const closerId = defense.roster.pitchers[5].id
    const closerReady = defense.bullpen.includes(closerId) && !defense.removed.has(closerId)
    const saveSpot = lateInning && lead > 0 && lead <= 3 && this.outs === 0 && this.balls === 0 && this.strikes === 0 && this.runnersOn() === 0

    if (!defense.warming && defense.bullpen.length) {
      if (fatigue > 0.25 || pitchLine.r >= 4 || (saveSpot && closerReady && defense.pitcherId !== closerId)) {
        intent.warm = saveSpot && closerReady ? closerId : defense.bullpen[0]
      }
    }
    const warm = defense.warming
    const ready = warm && warm.progress >= 1
    const atBoundary = this.balls === 0 && this.strikes === 0
    if (atBoundary && warm && (ready || fatigue > 1.1)) {
      const reliefDue = !state.starter && pitchLine.outs >= 3 && state.entered.inning < this.inning
      if (fatigue > 0.5 || pitchLine.r >= 5 || reliefDue || (saveSpot && warm.id === closerId)) intent.change = warm.id
    }

    const offense = this.offense
    const due = this.batter
    if (!this.setup.dh && due.position === 'P' && this.inning >= Math.ceil(this.setup.innings * 0.66) && atBoundary && (this.runnersOn() > 0 || this.lead(this.battingSide) < 0)) {
      const best = offense.bench.filter((id) => !offense.removed.has(id)).sort((a, b) => this.player(b).ratings.contact + this.player(b).ratings.power - this.player(a).ratings.contact - this.player(a).ratings.power)[0]
      if (best) intent.pinchHit = best
    }

    for (const base of [2, 1]) {
      const runner = this.bases[base]
      if (!runner || this.bases[base + 1] || (this.outs === 2 && base === 2)) continue
      const margin = this.stealMargin(base, runner.id)
      if (margin < TUNING.steal.minMargin) continue
      const chance = TUNING.steal.attempt * Math.min(3, (margin - TUNING.steal.minMargin) / 0.1 + 0.5) * (base === 2 ? 0.4 : 1)
      if (rng.chance(chance)) intent.steal.push(base)
    }
    if (this.bases[1] && !this.bases[2] && rng.chance(TUNING.pickoff.attempt * (this.player(this.bases[1].id).ratings.speed / 60))) intent.pickoff = 1
    return intent
  }

  suggestPitch(): PitchIntent {
    return chooseAiPitch({ pitcher: this.pitcher, batter: this.batter, balls: this.balls, strikes: this.strikes, outs: this.outs, runnersOn: this.runnersOn(), fatigue: this.fatigue(), lastType: this.lastType }, this.aiRng)
  }

  suggestSwing(): SwingIntent {
    const pitch = this.lastPitch!
    const sacrifice = !this.setup.dh && this.batter.position === 'P' && this.outs < 2 && (this.bases[1] !== null || this.bases[2] !== null) && !this.bases[3]
    return chooseAiSwing({ batter: this.batter, pitcher: this.pitcher, balls: this.balls, strikes: this.strikes, outs: this.outs, bases: [null, this.runnerOn(1), this.runnerOn(2), this.runnerOn(3)], plateX: pitch.plateX, plateY: pitch.plateY, speed: pitch.speed, type: pitch.type, grade: pitch.grade, sacrifice }, this.aiRng)
  }

  prePitch(intent: PrePitchIntent | null = null): PreOutcome {
    if (this.phase !== 'pre') throw new Error(`prePitch during ${this.phase}`)
    const resolved = intent ?? this.suggestPrePitch()
    this.log.push({ kind: 'pre', intent: { ...resolved, steal: [...resolved.steal] } })
    const events: string[] = []
    const defense = this.defenseTeam
    const offense = this.offense

    if (resolved.warm && defense.bullpen.includes(resolved.warm) && !defense.removed.has(resolved.warm)) {
      if (!defense.warming || defense.warming.id !== resolved.warm) defense.warming = { id: resolved.warm, progress: 0 }
    }
    if (resolved.change && resolved.change !== defense.pitcherId && defense.bullpen.includes(resolved.change) && !defense.removed.has(resolved.change)) {
      this.changePitcher(resolved.change)
      events.push(`Pitching change: ${fullName(this.pitcher)} comes in.`)
      this.note(events[events.length - 1])
    }
    if (resolved.pinchHit && offense.bench.includes(resolved.pinchHit) && !offense.removed.has(resolved.pinchHit)) {
      const out = offense.order[offense.next]
      offense.removed.add(out.id)
      offense.bench = offense.bench.filter((id) => id !== resolved.pinchHit)
      offense.order[offense.next] = { id: resolved.pinchHit, pos: out.pos }
      const line = this.batLine(resolved.pinchHit)
      line.pos = 'PH'
      events.push(`${fullName(this.player(resolved.pinchHit))} pinch-hits for ${fullName(this.player(out.id))}.`)
      this.note(events[events.length - 1])
    }

    if (this.runnersOn() > 0 && this.playRng.chance(TUNING.balk)) {
      this.pitchLine(defense.pitcherId).bk++
      this.advanceAll(1)
      events.push('Balk! Every runner moves up a base.')
      this.note(events[events.length - 1])
      if (this.isFinal()) return { events, halfOver: false, final: this.finish() }
    }

    if (resolved.pickoff && this.bases[resolved.pickoff]) {
      const runner = this.bases[resolved.pickoff]!
      const speed = this.player(runner.id).ratings.speed
      if (this.playRng.chance(TUNING.pickoff.out * (speed / 70))) {
        const cover = resolved.pickoff === 1 ? '1B' : resolved.pickoff === 2 ? 'SS' : '3B'
        fieldingLine(defense.box, defense.pitcherId).a++
        fieldingLine(defense.box, defense.defense[cover]).po++
        this.bases[resolved.pickoff] = null
        events.push(`${fullName(this.player(runner.id))} is picked off ${resolved.pickoff === 1 ? 'first' : resolved.pickoff === 2 ? 'second' : 'third'}!`)
        this.note(events[events.length - 1])
        this.recordOuts(1, defense.pitcherId)
        if (this.outs >= 3) {
          const final = this.endHalf(false)
          return { events, halfOver: true, final }
        }
      } else {
        events.push('Throw over to first. Back in safely.')
      }
    }
    this.pendingSteal = resolved.steal.filter((base) => this.bases[base] && !this.bases[base + 1])
    this.phase = 'pitch'
    return { events, halfOver: false, final: false }
  }

  private changePitcher(id: string): void {
    const defense = this.defenseTeam
    const old = defense.pitcherId
    const oldState = defense.pitcherState.get(old)
    if (oldState?.holdEligible && !oldState.blown && this.lead(this.fieldingSide) > 0 && this.pitchLine(old).outs > (oldState.entered.outs ?? 0)) {
      this.pitchLine(old).decisions.push('H')
    }
    defense.removed.add(old)
    defense.bullpen = defense.bullpen.filter((item) => item !== id)
    defense.pitcherId = id
    defense.defense.P = id
    defense.warming = null
    const slot = defense.order.findIndex((item) => item.id === old)
    if (slot >= 0) defense.order[slot] = { id, pos: 'P' }
    const lead = this.lead(this.fieldingSide)
    const save = lead > 0 && lead <= 3
    defense.pitcherState.set(id, { pitches: 0, entered: { inning: this.inning, outs: 0, lead, save }, starter: false, holdEligible: save, blown: false })
    this.pitchLine(id)
  }

  preparePitch(intent: PitchIntent | null = null): ThrownPitch {
    if (this.phase !== 'pitch') throw new Error(`preparePitch during ${this.phase}`)
    const resolved = intent ?? this.suggestPitch()
    this.log.push({ kind: 'pitch', intent: { ...resolved } })
    const pitcher = this.pitcher
    const pitching = pitcher.pitching!
    const grade = pitching.repertoire.find((item) => item.type === resolved.type)?.grade ?? 30
    const type = pitching.repertoire.some((item) => item.type === resolved.type) ? resolved.type : pitching.repertoire[0].type
    const fatigue = this.fatigue()
    const effortFactor = resolved.effort >= 90 ? 1.35 : resolved.effort <= 55 ? 0.82 : 1
    const accuracyFactor = 0.55 + (Math.abs(resolved.accuracy) / 100) * 1.6
    const sigma = (TUNING.control.base + TUNING.control.skill * (1 - pitching.control / 100)) * (1 + fatigue * TUNING.control.fatigue) * effortFactor * (intent && resolved.accuracy !== 0 ? accuracyFactor : 1)
    const bias = (resolved.accuracy / 100) * 0.08
    const exact = this.setup.practice === true
    const plateX = resolved.targetX / 1000 + (exact ? 0 : this.playRng.normal(bias, sigma))
    const plateY = resolved.targetY / 1000 + (exact ? 0 : this.playRng.normal(0, sigma))
    const speed = pitching.velocity + PITCH_SPECS[type].speedDelta + ((resolved.effort - 75) / 25) * 1.2 - Math.min(1.5, fatigue) * TUNING.fatigue.velocityLoss + this.playRng.normal(0, 0.35)
    const release = releasePoint(pitcher.throws, pitcher.height)
    const zone = strikeZone(this.batter.height)
    const inZone = Math.abs(plateX) <= PLATE_HALF_WIDTH + 0.037 && plateY >= zone.bottom - 0.037 && plateY <= zone.top + 0.037
    this.pitchCount++
    const thrown: ThrownPitch = {
      number: this.pitchCount,
      type,
      speed,
      mph: Math.round(toMph(speed)),
      plateX,
      plateY,
      release,
      throws: pitcher.throws,
      pitcherId: pitcher.id,
      batterId: this.batter.id,
      inZone,
      flightTime: pitchFlightTime(speed, release),
      wobbleSeed: this.playRng.int(0, 999999),
      grade,
      intent: resolved,
    }
    this.lastPitch = thrown
    this.lastType = type
    const state = this.defenseTeam.pitcherState.get(pitcher.id)!
    state.pitches++
    this.pitchLine(pitcher.id).pitches++
    if (this.defenseTeam.warming) this.defenseTeam.warming.progress += 0.12
    for (const runner of this.bases) if (runner) runner.stealing = this.pendingSteal.includes(this.bases.indexOf(runner))
    this.phase = 'swing'
    return thrown
  }

  resolveSwing(intent: SwingIntent | null = null): PitchOutcome {
    if (this.phase !== 'swing' || !this.lastPitch) throw new Error(`resolveSwing during ${this.phase}`)
    const swing = intent ?? this.suggestSwing()
    this.log.push({ kind: 'swing', intent: { ...swing } })
    const pitch = this.lastPitch
    const rng = this.playRng
    const events: string[] = []
    const batter = this.batter
    const pitcherId = this.defenseTeam.pitcherId
    const pLine = this.pitchLine(pitcherId)
    const sideBefore = this.battingSide
    const scoreBefore = this.score[sideBefore]
    let call: PitchCall = 'ball'
    let batted: BallPath | null = null
    let play: PlayOutcome | null = null
    let paOver = false
    const hand = this.batterHand()
    const zoneCall = (): 'ball' | 'called' => {
      const zone = strikeZone(batter.height)
      const noise = TUNING.umpire.noise
      const x = pitch.plateX + rng.normal(0, noise)
      const y = pitch.plateY + rng.normal(0, noise)
      return Math.abs(x) <= PLATE_HALF_WIDTH + 0.037 && y >= zone.bottom - 0.037 && y <= zone.top + 0.037 ? 'called' : 'ball'
    }

    if (swing.action === 'take') {
      const inside = hand === 'R' ? -pitch.plateX : pitch.plateX
      const hbp = TUNING.hbp
      if (inside > hbp.inside && inside < hbp.inside + hbp.depth && pitch.plateY > 0.35 && pitch.plateY < 1.75 && rng.chance(hbp.chance)) call = 'hbp'
      else call = zoneCall()
    } else {
      const contact = resolveContact({ swing, plateX: pitch.plateX, plateY: pitch.plateY, pitchSpeed: pitch.speed, pitchGrade: pitch.grade, stuff: this.pitcher.pitching!.stuff, batter: batter.ratings, batterHand: hand }, rng)
      if (contact.result === 'miss') call = 'swinging'
      else if (contact.result === 'tip') call = 'tip'
      else {
        batted = battedBallPath(contact.launch, this.park, this.air)
        const runners: RunnerInfo[] = []
        for (const base of [1, 2, 3]) {
          const runner = this.bases[base]
          if (runner) runners.push({ id: runner.id, speed: this.player(runner.id).ratings.speed, from: base, stealing: runner.stealing })
        }
        const defense: Defender[] = FIELD_POSITIONS.map((pos) => ({ pos, id: this.defenseTeam.defense[pos], ratings: this.player(this.defenseTeam.defense[pos]).ratings }))
        const infieldFly = this.outs < 2 && !!this.bases[1] && !!this.bases[2]
        play = resolveBallInPlay(batted, { outs: this.outs, batter: { id: batter.id, speed: batter.ratings.speed, from: 0, stealing: false }, runners, bunt: swing.type === 'bunt', infieldFly, defense }, rng, (sample) => inFoulPlayable(this.park, sample))
        call = play.kind === 'foul' ? 'foul' : 'inPlay'
      }
    }

    if (call !== 'ball' && call !== 'hbp') pLine.strikes++
    if (swing.action === 'swing') this.tally.swings++
    if (call === 'swinging') this.tally.whiffs++
    if (call === 'foul' || call === 'tip') this.tally.fouls++
    if (call === 'inPlay' && batted && play) {
      const launch = batted.launch.launch
      this.tally.inPlay++
      if (play.doublePlay) this.tally.doublePlays++
      if (play.kind !== 'foulCaught') {
        if (launch >= 50) this.tally.popup++
        else if (launch >= 22) this.tally.fly++
        else if (launch >= 10) this.tally.line++
        else this.tally.ground++
        if (play.kind === 'homer' && launch >= 22 && launch < 50) this.tally.flyHomers++
      }
    }

    if (call === 'inPlay' && play) {
      paOver = true
      this.applyPlay(play, events)
    } else if (call === 'hbp') {
      paOver = true
      pLine.hbp++
      pLine.bf++
      this.batLine(batter.id).hbp++
      events.push('Hit by pitch.')
      this.forceAdvance(batter.id, events, true)
      this.note(`${fullName(batter)} is hit by the pitch.`)
    } else if (call === 'foul' || call === 'tip') {
      if (call === 'tip' && this.strikes === 2 && rng.chance(0.62)) {
        events.push('Foul tip, caught. Strike three!')
        paOver = true
        this.strikeout(pitch, events, true)
      } else if (swing.type === 'bunt' && this.strikes === 2) {
        events.push('Foul bunt with two strikes: strike three.')
        paOver = true
        this.strikeout(pitch, events, true)
      } else {
        if (this.strikes < 2) this.strikes++
        events.push(call === 'tip' ? 'Foul tip.' : 'Foul ball.')
      }
    } else if (call === 'swinging' || call === 'called') {
      this.strikes++
      if (this.strikes >= 3) {
        paOver = true
        events.push(call === 'swinging' ? 'Strike three, swinging.' : 'Strike three, called.')
        this.strikeout(pitch, events, call === 'swinging')
      } else events.push(call === 'swinging' ? 'Swing and a miss.' : 'Called strike.')
    } else {
      this.balls++
      if (this.balls >= 4) {
        paOver = true
        pLine.bb++
        pLine.bf++
        this.batLine(batter.id).bb++
        events.push('Ball four.')
        this.forceAdvance(batter.id, events, true)
        this.note(`${fullName(batter)} walks.`)
      } else events.push('Ball.')
    }

    const live = call === 'ball' || call === 'called' || call === 'swinging'
    const walked = call === 'ball' && paOver
    if (live && !walked && this.outs < 3 && !this.isFinal()) this.wildPitchCheck(pitch, events)
    if (live && !walked && this.outs < 3 && !this.isFinal()) this.resolveSteals(pitch, events)
    for (const runner of this.bases) if (runner) runner.stealing = false
    this.pendingSteal = []

    let halfOver = false
    let final = false
    if (this.isFinal()) final = this.finish()
    else if (this.outs >= 3) {
      halfOver = true
      final = this.endHalf(paOver)
    } else if (paOver) {
      this.nextBatter()
    }
    if (!final && !halfOver) this.phase = 'pre'
    return { pitch, swing, call, batted, play, events, plateAppearanceOver: paOver, halfOver, final, runs: this.score[sideBefore] - scoreBefore }
  }

  private strikeout(pitch: ThrownPitch, events: string[], swinging: boolean): void {
    const batter = this.batter
    const defense = this.defenseTeam
    const pLine = this.pitchLine(defense.pitcherId)
    pLine.so++
    pLine.bf++
    const line = this.batLine(batter.id)
    line.so++
    line.ab++
    const catcher = this.player(defense.defense.C)
    const dirt = pitch.plateY < 0.18
    const dropped = this.playRng.chance(dirt ? TUNING.droppedThird.dirt : TUNING.droppedThird.clean * (1.5 - catcher.ratings.fielding / 100))
    if (dropped && (!this.bases[1] || this.outs === 2) && this.playRng.chance(dirt ? 0.3 : 0.15)) {
      events.push('Dropped third strike! The batter beats the throw to first.')
      if (dirt) pLine.wp++
      else fieldingLine(defense.box, defense.defense.C).e++
      this.note(`${fullName(batter)} strikes out but reaches on a dropped third strike.`)
      this.forceAdvance(batter.id, events, false, false)
      return
    }
    if (dropped && (!this.bases[1] || this.outs === 2)) {
      events.push('Dropped third strike; the catcher throws to first in time.')
      fieldingLine(defense.box, defense.defense.C).a++
      fieldingLine(defense.box, defense.defense['1B']).po++
    } else {
      fieldingLine(defense.box, defense.defense.C).po++
    }
    this.note(`${fullName(batter)} strikes out ${swinging ? 'swinging' : 'looking'}.`)
    this.recordOuts(1, defense.pitcherId)
  }

  private wildPitchCheck(pitch: ThrownPitch, events: string[]): void {
    if (this.runnersOn() === 0) return
    const tune = TUNING.wildPitch
    const wild = pitch.plateY < tune.dirt || Math.abs(pitch.plateX) > tune.wide
    if (!wild) return
    const catcher = this.player(this.defenseTeam.defense.C)
    if (this.playRng.chance(tune.block + 0.35 * (catcher.ratings.fielding / 100))) return
    const passed = pitch.plateY >= tune.dirt && Math.abs(pitch.plateX) < tune.wide + 0.15
    if (!passed) this.pitchLine(this.defenseTeam.pitcherId).wp++
    events.push(passed ? 'Passed ball! The runners move up.' : 'Wild pitch! The runners move up.')
    this.note(passed ? 'Passed ball; runners advance.' : 'Wild pitch; runners advance.')
    for (const runner of this.bases) if (runner) runner.stealing = false
    this.advanceAll(1)
  }

  /** Seconds the defense has in hand on a steal of the next base from `base` (positive favours the runner). */
  stealMargin(base: number, runnerId: string, pitch: ThrownPitch | null = null): number {
    const tune = TUNING.steal
    const catcher = this.player(this.defenseTeam.defense.C)
    const pitcher = this.pitcher
    const player = this.player(runnerId)
    const top = TUNING.runner.baseSpeed + TUNING.runner.speedRange * (player.ratings.speed / 100)
    const runnerTime = tune.jump + runTime(BASE_PATH - tune.lead - (base === 2 ? tune.secondLead : 0) - 0.6, top, TUNING.runner.accel * 1.6)
    const pop = tune.pop - tune.popArm * (catcher.ratings.arm / 100) - (base === 2 ? 0.3 : 0)
    const delivery = tune.delivery - (pitcher.throws === 'L' && base === 1 ? -0.1 : 0) + (pitch ? (pitch.speed < 38 ? 0.08 : 0) : 0)
    const takeOff = pitch && (pitch.plateY < 0.3 || Math.abs(pitch.plateX) > 0.45) ? 0.15 : 0
    return delivery + pop + takeOff + tune.tag - runnerTime
  }

  private resolveSteals(pitch: ThrownPitch, events: string[]): void {
    const catcher = this.player(this.defenseTeam.defense.C)
    for (const base of [2, 1]) {
      const runner = this.bases[base]
      if (!runner || !runner.stealing || this.bases[base + 1]) continue
      const player = this.player(runner.id)
      const safe = this.stealMargin(base, runner.id, pitch) + this.playRng.normal(0, TUNING.steal.noise) > 0
      const offense = this.offense
      const name = fullName(player)
      if (safe) {
        this.bases[base + 1] = runner
        this.bases[base] = null
        const line = offense.box.batting.find((item) => item.id === runner.id)
        if (line) line.sb++
        events.push(`${name} steals ${base === 1 ? 'second' : 'third'}!`)
        this.note(`${name} steals ${base === 1 ? 'second' : 'third'}.`)
      } else {
        this.bases[base] = null
        const line = offense.box.batting.find((item) => item.id === runner.id)
        if (line) line.cs++
        fieldingLine(this.defenseTeam.box, catcher.id).a++
        fieldingLine(this.defenseTeam.box, this.defenseTeam.defense[base === 1 ? 'SS' : '3B']).po++
        events.push(`${name} is caught stealing ${base === 1 ? 'second' : 'third'}.`)
        this.note(`${name} caught stealing ${base === 1 ? 'second' : 'third'}.`)
        this.recordOuts(1, this.defenseTeam.pitcherId)
        if (this.outs >= 3) return
      }
    }
  }

  /** Walk, hit batsman or a batter reaching on a dropped third strike: only forced runners move. */
  private forceAdvance(batterId: string, events: string[], rbiOnScore: boolean, earned = true): void {
    const pitcherId = this.defenseTeam.pitcherId
    const incoming: BaseRunner = { id: batterId, pitcherId, earned, stealing: false }
    let carry: BaseRunner | null = incoming
    for (let base = 1; base <= 3 && carry; base++) {
      const occupant: BaseRunner | null = this.bases[base]
      this.bases[base] = carry
      carry = occupant
    }
    if (carry) {
      this.scoreRun(carry, rbiOnScore ? batterId : null)
      events.push(`${fullName(this.player(carry.id))} scores.`)
    }
  }

  private advanceAll(count: number): void {
    for (let base = 3; base >= 1; base--) {
      const runner = this.bases[base]
      if (!runner) continue
      this.bases[base] = null
      const to = base + count
      if (to >= 4) this.scoreRun(runner, null)
      else this.bases[to] = runner
    }
  }

  private scoreRun(runner: BaseRunner, rbiBatter: string | null, homer = false): void {
    if (this.phase === 'final' && !homer) return
    const side = this.battingSide
    this.score[side]++
    const box = this.teams[side].box
    const inningIndex = this.inning - 1
    while (box.lineScore.length <= inningIndex) box.lineScore.push(0)
    box.lineScore[inningIndex]++
    box.runs = this.score[side]
    const line = box.batting.find((item) => item.id === runner.id)
    if (line) line.r++
    if (rbiBatter) this.batLine(rbiBatter).rbi++
    const responsible = this.pitchLine(runner.pitcherId)
    responsible.r++
    const earned = runner.earned && this.outs + this.errorOuts < 3
    if (earned) responsible.er++
    this.trackLead(runner)
    if (this.half === 'bottom' && this.inning >= this.setup.innings && this.score[1] > this.score[0]) this.phase = 'final'
  }

  private trackLead(runner: BaseRunner): void {
    const side = this.battingSide
    const other: Side = side === 0 ? 1 : 0
    const lead = this.score[side] - this.score[other]
    const defense = this.defenseTeam
    const pitcherState = defense.pitcherState.get(defense.pitcherId)
    if (lead === 0 && pitcherState?.entered.save && !pitcherState.blown) {
      pitcherState.blown = true
      pitcherState.holdEligible = false
      this.pitchLine(defense.pitcherId).decisions.push('BS')
    }
    if (lead === 1) {
      this.winCandidate[side] = this.teams[side].pitcherId
      this.loseCandidate[other] = runner.pitcherId
      this.winCandidate[other] = null
    }
  }

  private recordOuts(count: number, pitcherId: string): void {
    this.outs += count
    this.pitchLine(pitcherId).outs += count
  }

  private applyPlay(play: PlayOutcome, events: string[]): void {
    const batter = this.batter
    const offense = this.offense
    const defense = this.defenseTeam
    const pitcherId = defense.pitcherId
    const pLine = this.pitchLine(pitcherId)
    const bLine = this.batLine(batter.id)
    pLine.bf++
    events.push(play.description)

    for (const credit of play.credits) {
      const line = fieldingLine(defense.box, defense.defense[credit.pos])
      if (credit.kind === 'PO') line.po++
      else if (credit.kind === 'A') line.a++
      else {
        line.e++
        defense.box.errors++
      }
    }
    const isHit = play.kind === 'hit' || play.kind === 'homer' || play.kind === 'groundRule'
    if (isHit) {
      bLine.h++
      offense.box.hits++
      pLine.h++
      if (play.hitBases === 2) bLine.d++
      if (play.hitBases === 3) bLine.t++
      if (play.hitBases >= 4) {
        bLine.hr++
        pLine.hr++
      }
    }
    if (play.sacFly) bLine.sf++
    else if (play.sacBunt) bLine.sh++
    else bLine.ab++
    if (play.kind === 'error' && play.errorOn) this.errorOuts++

    const outsBefore = this.outs
    const results = [...play.runners].sort((a, b) => a.time - b.time)
    const outsOnPlay = results.filter((result) => result.out)
    let cutoff = Infinity
    let noRuns = false
    if (outsBefore + outsOnPlay.length >= 3) {
      const third = outsOnPlay[2 - outsBefore]
      cutoff = third.time
      noRuns = third.force || third.from === 0
    }
    const previous = this.bases
    const nextBases: (BaseRunner | null)[] = [null, null, null, null]
    const batterRunner: BaseRunner = { id: batter.id, pitcherId, earned: play.kind !== 'error' && !(play.kind === 'fielderChoice' && play.errorOn), stealing: false }
    const rbiAllowed = play.kind !== 'error' && !play.doublePlay
    let outs = 0
    for (const result of results) {
      const runner = result.from === 0 ? batterRunner : previous[result.from]
      if (!runner) continue
      if (result.out) {
        outs++
        continue
      }
      if (result.to >= 4) {
        if (noRuns || result.time > cutoff) continue
        this.scoreRun(runner, rbiAllowed || play.kind === 'homer' ? batter.id : null, play.kind === 'homer')
        continue
      }
      if (nextBases[result.to]) this.collisions++
      nextBases[result.to] = runner
    }
    this.bases = nextBases
    this.recordOuts(outs, pitcherId)
    this.note(play.description)
  }

  private isFinal(): boolean {
    return this.phase === 'final'
  }

  private nextBatter(): void {
    const offense = this.offense
    offense.next = (offense.next + 1) % offense.order.length
    this.balls = 0
    this.strikes = 0
  }

  /** Close out a half-inning; returns true when the contest is over. The batter at the plate leads off next time when the third out came on the bases. */
  private endHalf(plateAppearanceOver: boolean): boolean {
    const offense = this.offense
    offense.box.leftOnBase += this.runnersOn()
    const inningIndex = this.inning - 1
    while (offense.box.lineScore.length <= inningIndex) offense.box.lineScore.push(0)
    if (plateAppearanceOver) offense.next = (offense.next + 1) % offense.order.length
    this.outs = 0
    this.balls = 0
    this.strikes = 0
    this.errorOuts = 0
    this.bases = [null, null, null, null]
    const last = this.setup.innings
    const mercyInning = Math.ceil(last * 0.6)
    if (this.half === 'top') {
      if (this.inning >= last && this.score[1] > this.score[0]) return this.finish()
      if (this.setup.mercy && this.inning >= mercyInning && this.score[1] - this.score[0] >= 10) return this.finish()
      this.half = 'bottom'
    } else {
      if (this.inning >= last && this.score[0] !== this.score[1]) return this.finish()
      if (this.setup.mercy && this.inning >= mercyInning && Math.abs(this.score[0] - this.score[1]) >= 10) return this.finish()
      this.half = 'top'
      this.inning++
    }
    this.startHalf()
    return false
  }

  private startHalf(): void {
    this.phase = 'pre'
    const offense = this.offense
    const defense = this.defenseTeam
    if (defense.removed.has(defense.pitcherId) && defense.bullpen.length) {
      const pinchSlot = defense.order.findIndex((slot) => slot.pos === 'P')
      const reliever = defense.bullpen[0]
      this.changePitcher(reliever)
      if (pinchSlot >= 0) {
        defense.removed.add(defense.order[pinchSlot].id)
        defense.order[pinchSlot] = { id: reliever, pos: 'P' }
      }
    }
    for (const [index, slot] of defense.order.entries()) {
      if (slot.pos === 'P' && slot.id !== defense.pitcherId) defense.order[index] = { id: defense.pitcherId, pos: 'P' }
    }
    const pitcherSlot = defense.order.findIndex((slot) => slot.id === defense.pitcherId)
    if (!this.setup.dh && pitcherSlot < 0) {
      const phSlot = defense.order.findIndex((slot) => slot.pos === 'P')
      if (phSlot >= 0) defense.order[phSlot] = { id: defense.pitcherId, pos: 'P' }
    }
    for (const slot of defense.order) {
      if (slot.pos !== 'P' && slot.pos !== 'DH') defense.defense[slot.pos as FieldPosition] = slot.id
    }
    if (this.inning > this.setup.innings && this.setup.autoRunner) {
      const previous = offense.order[(offense.next + offense.order.length - 1) % offense.order.length]
      this.bases[2] = { id: previous.id, pitcherId: defense.pitcherId, earned: false, stealing: false }
      this.note(`Extra innings: ${fullName(this.player(previous.id))} starts on second base.`)
    }
  }

  private finish(): boolean {
    this.phase = 'final'
    this.winner = this.score[0] > this.score[1] ? 0 : 1
    for (const [side, team] of this.teams.entries()) {
      const box = team.box
      const played = side === 0 || this.half === 'bottom' ? this.inning : this.inning - 1
      while (box.lineScore.length < played) box.lineScore.push(0)
    }
    this.assignDecisions()
    this.note(`Final: ${this.teams[0].roster.team.abbr} ${this.score[0]}, ${this.teams[1].roster.team.abbr} ${this.score[1]}.`)
    return true
  }

  private assignDecisions(): void {
    const winner = this.winner!
    const loser: Side = winner === 0 ? 1 : 0
    const winTeam = this.teams[winner]
    const starterOutsNeeded = Math.ceil((this.setup.innings * 5) / 9) * 3
    let winId = this.winCandidate[winner] ?? winTeam.box.pitching[0].id
    const winState = winTeam.pitcherState.get(winId)
    if (winState?.starter && this.pitchLine(winId).outs < starterOutsNeeded && winTeam.box.pitching.length > 1) {
      const relievers = winTeam.box.pitching.slice(1)
      winId = relievers.reduce((best, line) => (line.outs > best.outs ? line : best), relievers[0]).id
    }
    this.pitchLine(winId).decisions.push('W')
    const loseId = this.loseCandidate[loser] ?? this.teams[loser].box.pitching[0].id
    this.pitchLine(loseId).decisions.push('L')
    const finisher = winTeam.pitcherId
    const finisherState = winTeam.pitcherState.get(finisher)
    const finisherLine = this.pitchLine(finisher)
    if (finisher !== winId && finisherState && !finisherState.starter && !finisherState.blown && ((finisherState.entered.save && finisherLine.outs >= 3) || finisherLine.outs >= 9)) {
      finisherLine.decisions.push('S')
      finisherLine.decisions = finisherLine.decisions.filter((item) => item !== 'H')
    }
    for (const team of this.teams) {
      const starter = team.box.pitching[0]
      starter.qualityStart = starter.outs >= Math.ceil((this.setup.innings * 6) / 9) * 3 && starter.er <= Math.ceil((this.setup.innings * 3) / 9)
    }
  }

  /** Lets the AI make every remaining choice for one pitch. */
  autoPitch(): PitchOutcome | PreOutcome {
    if (this.phase === 'pre') {
      const pre = this.prePitch()
      if (pre.halfOver || pre.final) return pre
    }
    if (this.phase === 'pitch') this.preparePitch()
    return this.resolveSwing()
  }

  simulate(maxPitches = 2000): void {
    let guard = 0
    while (this.phase !== 'final' && guard++ < maxPitches) this.autoPitch()
  }

  box(): { away: TeamBox; home: TeamBox; score: [number, number]; inning: number; final: boolean } {
    return { away: this.teams[0].box, home: this.teams[1].box, score: [this.score[0], this.score[1]], inning: this.inning, final: this.phase === 'final' }
  }

  baseCoordinates(base: number): Vec3 {
    return BASES[base % 4]
  }
}

/** Plays back a recorded input log against a fresh contest with the same setup. */
export function replay(setup: ContestSetup, log: readonly InputRecord[]): Contest {
  const contest = new Contest(setup)
  for (const record of log) {
    if (record.kind === 'pre') contest.prePitch(record.intent)
    else if (record.kind === 'pitch') contest.preparePitch(record.intent)
    else contest.resolveSwing(record.intent)
  }
  return contest
}
