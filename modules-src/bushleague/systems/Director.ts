/** Runs a contest on screen: pre-pitch decisions, the human pitching meter or batting cursor, the pitch in flight, play-back of the sim's timeline, the broadcast-style camera moves and the final box score. */
import * as THREE from 'three/webgpu'
import type { App, Input, PostChain } from '../../../engine'
import {
  BASES,
  Contest,
  PITCH_SPECS,
  PLATE_FRONT,
  pciRadius,
  pitchPath,
  strikeZone,
  type ContestSetup,
  type Hand,
  type PitchIntent,
  type PitchOutcome,
  type Sample,
  type SwingIntent,
  type SwingType,
  type ThrownPitch,
  type Timeline,
} from '../sim'
import type { Action, ModuleConfig } from '../config'
import type { Actors } from '../view/Actors'
import { toWorld } from '../view/space'
import type { Screens, SetupChoice } from '../ui/Screens'
import type { Broadcast } from '../ui/Broadcast'
import type { BallparkAudio } from './Audio'
import { marksBetween, sampleKeys, tracksOf } from './Playback'

type Stage = 'idle' | 'between' | 'aim' | 'meter' | 'windup' | 'flight' | 'play' | 'replay' | 'final'
type View = 'batting' | 'centerfield'

/** Broadcast pieces the director cues: overlays, sound and the post chain's depth of field for replays. */
export interface Presentation {
  broadcast: Broadcast
  audio: BallparkAudio
  post: PostChain
}

const HOMER_CALLS = ['Get out the plunger, that ball is GONE!', 'Kiss it goodbye! Somebody tell the parking lot!', 'Way back... and that one is outta here!', 'Holy cow pie, that is a home run!']
const VENDOR_CALLS = ['Hot dogs! Get your hot dogs!', 'Peanuts! Cold drinks! Nachos the size of your head!', 'Sunflower seeds! Spit responsibly!']
const REPLAY_MARKS = new Set(['What a catch!', 'Thrown out!', 'Doubled off!', 'Gone!'])

interface CameraPose {
  position: THREE.Vector3
  target: THREE.Vector3
  fov: number
}

const PLATE_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), PLATE_FRONT)

export interface DirectorHooks {
  onContest(contest: Contest, choice: SetupChoice): void
  onFinal(contest: Contest): void
}

/** Ballpark reactions the director triggers; index.ts points them at the current field and crowd. */
export interface Scenery {
  excite(level: number): void
  startWave(): void
  celebrate(kind: 'homer' | 'final'): void
  scuff(x: number, z: number, radius: number, strength: number, angle?: number, length?: number): void
}

/** Where in the pitch clip the ball leaves the hand, and where in the swing clip the bat crosses the plate. */
const RELEASE_AT = 0.72
const CONTACT_AT = 0.55

const BASE_SPOTS: readonly { x: number; z: number }[] = [1, 2, 3].map((base) => ({ x: BASES[base].x, z: BASES[base].z }))

export class Director {
  contest: Contest | null = null
  stage: Stage = 'idle'
  private choice: SetupChoice | null = null
  private humans = new Set<0 | 1>()
  private view: View = 'batting'
  private lastBatter: string | null = null
  private chargedFor: string | null = null
  private replayOf: { timeline: Timeline; outcome: PitchOutcome } | null = null
  private replayed = false
  private clock = 0
  private stageTime = 0
  private thrown: ThrownPitch | null = null
  private flight: Sample[] = []
  private flightScale = 1
  private swingPress: { at: number; type: SwingType } | null = null
  private outcome: PitchOutcome | null = null
  private pending: PitchOutcome | null = null
  private timeline: Timeline | null = null
  private playEnd = 0
  private lastMark = 0
  private cursor = { x: 0, y: 0.75 }
  private pitchIndex = 0
  private meterPhase: 1 | 2 = 1
  private meterValue = 0
  private effort = 0
  private stealArmed = false
  private seed = 1
  private readonly camera: CameraPose = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50 }
  private readonly goal: CameraPose = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50 }
  private readonly raycaster = new THREE.Raycaster()
  private readonly hit = new THREE.Vector3()

  constructor(
    private readonly app: App,
    private readonly input: Input<Action>,
    private readonly actors: Actors,
    private readonly screens: Screens,
    private readonly config: ModuleConfig,
    private readonly hooks: DirectorHooks,
    private readonly scenery: Scenery,
    private readonly presentation: Presentation,
  ) {
    this.setPose('overview', true)
  }

  private readonly scuffed = new Set<string>()
  private footClock = 0

  start(choice: SetupChoice, seed: number): Contest {
    this.choice = choice
    this.seed = seed
    const away = choice.side === 'away' ? choice.team : choice.opponent
    const home = choice.side === 'away' ? choice.opponent : choice.team
    this.humans = new Set(choice.side === 'away' ? [0] : choice.side === 'home' ? [1] : choice.side === 'both' ? [0, 1] : [])
    const human = (side: 0 | 1) => this.humans.has(side)
    const skill = (side: 0 | 1) => (human(side) || this.humans.size === 0 ? 0 : choice.level.skill)
    const pci = (side: 0 | 1) => (human(side) ? choice.level.pci * (choice.assist ? this.config.assist.pci : 1) : 1)
    const setup: ContestSetup = { seed, away, home, innings: choice.innings, dh: choice.dh, autoRunner: choice.autoRunner, mercy: choice.mercy, aiSkill: [skill(0), skill(1)], pciScale: [pci(0), pci(1)] }
    this.contest = new Contest(setup)
    this.flightScale = choice.level.pace
    this.view = this.humans.size === 0 ? 'centerfield' : 'batting'
    this.stealArmed = false
    this.lastBatter = null
    this.replayOf = null
    document.body.classList.toggle('is-color-safe', choice.colorSafe)
    this.actors.trailEnabled = choice.trail
    this.actors.bind(this.contest)
    this.hooks.onContest(this.contest, choice)
    this.presentation.broadcast.start(this.contest)
    this.presentation.audio.organ()
    this.screens.resetLog()
    this.screens.hidePitch()
    this.screens.say(`${this.contest.teams[0].roster.team.city} ${this.contest.teams[0].roster.team.name} at ${this.contest.teams[1].roster.team.city} ${this.contest.teams[1].roster.team.name}`, 3)
    this.resetScene()
    this.enter('between')
    return this.contest
  }

  rematch(): Contest | null {
    if (!this.choice) return null
    return this.start(this.choice, this.seed + 1)
  }

  private get humanBatting(): boolean {
    return !!this.contest && this.humans.has(this.contest.battingSide)
  }

  private get humanPitching(): boolean {
    return !!this.contest && this.humans.has(this.contest.fieldingSide)
  }
  private enter(stage: Stage): void {
    this.stage = stage
    this.stageTime = 0
  }

  private resetScene(): void {
    const contest = this.contest!
    this.actors.setScene(contest, this.batterHand())
    this.scenery.scuff(this.batterHand() === 'R' ? -0.8 : 0.8, 0.25, 0.35, 0.35)
    this.actors.setZone(contest.batter.height)
    this.actors.setBall(null)
    this.actors.setGhost(false)
    this.actors.setCursor(false)
    this.screens.updateBug(contest)
    this.screens.setSteal(this.stealArmed)
    this.screens.setHint(`${this.humanPitching ? this.config.copy.controlsPitching : this.humanBatting ? this.config.copy.controlsBatting : this.config.copy.controlsWatching} · ${this.config.copy.controlsCommon}`)
    this.setPose(this.humanPitching ? 'pitching' : this.view)
    if (this.humanPitching && (this.batterHand() === 'L') === this.goal.position.x > 0) this.goal.position.x *= -1
    this.presentation.broadcast.updateStats(contest)
    this.presentation.broadcast.refreshTicker(contest)
    const batter = contest.batter
    if (batter.id !== this.lastBatter) {
      this.lastBatter = batter.id
      this.presentation.broadcast.introduce(contest, batter, this.config.timing.introSeconds)
      if (contest.battingSide === 1) this.presentation.audio.say(`Now batting for ${contest.offense.roster.team.city}, number ${batter.number}, ${batter.first} ${batter.last}!`)
    }
    const scoring = !!contest.bases[2] || !!contest.bases[3]
    if (contest.battingSide === 1 && scoring && this.chargedFor !== batter.id) {
      this.chargedFor = batter.id
      this.presentation.audio.charge()
      this.scenery.excite(0.45)
    }
  }

  private batterHand(): Hand {
    const contest = this.contest!
    const bats = contest.batter.bats
    return bats === 'S' ? (contest.pitcher.throws === 'R' ? 'L' : 'R') : bats
  }

  private setPose(name: 'batting' | 'pitching' | 'overview' | 'centerfield', snap = false): void {
    const pose = this.config.cameras[name]
    toWorld({ x: pose.position[0], y: pose.position[1], z: pose.position[2] }, this.goal.position)
    toWorld({ x: pose.target[0], y: pose.target[1], z: pose.target[2] }, this.goal.target)
    this.goal.fov = pose.fov
    if (snap) {
      this.camera.position.copy(this.goal.position)
      this.camera.target.copy(this.goal.target)
      this.camera.fov = pose.fov
    }
  }

  update(dt: number): void {
    this.clock += dt
    this.stageTime += dt
    this.input.update()
    const contest = this.contest
    if (this.input.pressed('mute')) this.presentation.broadcast.say(this.presentation.audio.toggleMute() ? 'Sound off' : 'Sound on', 1.2)
    if (this.input.pressed('stats')) this.presentation.broadcast.toggleStats(contest)
    if (contest && this.stage !== 'final' && this.stage !== 'idle') {
      if (this.input.pressed('steal') && this.humanBatting) {
        this.stealArmed = !this.stealArmed
        this.screens.setSteal(this.stealArmed)
      }
      if (this.input.pressed('camera') && !this.humanPitching && this.stage !== 'play' && this.stage !== 'replay') {
        this.view = this.view === 'batting' ? 'centerfield' : 'batting'
        this.setPose(this.view)
      }
      if (this.input.pressed('replay') && this.replayOf && (this.stage === 'between' || this.stage === 'aim')) this.startReplay(true)
      switch (this.stage) {
        case 'between':
          this.updateBetween(contest)
          break
        case 'aim':
        case 'meter':
          this.updateAim(contest, dt)
          break
        case 'windup':
          this.updateWindup(dt)
          break
        case 'flight':
          this.updateFlight(contest, dt)
          break
        case 'play':
          this.updatePlay(contest, dt)
          break
        case 'replay':
          this.updateReplay(contest, dt)
          break
      }
    }
    this.updateCamera(dt)
  }

  private updateBetween(contest: Contest): void {
    if (this.stageTime < this.config.timing.betweenPitches) return
    const suggestion = contest.suggestPrePitch()
    if (this.humanBatting) {
      suggestion.steal = this.stealArmed ? [2, 1].filter((base) => contest.bases[base] && !contest.bases[base + 1]) : []
      suggestion.pinchHit = null
    }
    const pre = contest.prePitch(suggestion)
    if (pre.events.length) this.screens.say(pre.events.join(' '), 2.6)
    if (pre.final) return this.finish()
    if (pre.halfOver) {
      this.halfBreak()
      return
    }
    this.screens.updateBug(contest)
    if (pre.events.length) {
      this.actors.setScene(contest, this.batterHand())
      this.actors.setZone(contest.batter.height)
    }
    if (this.humanPitching) {
      this.pitchIndex = Math.min(this.pitchIndex, contest.pitcher.pitching!.repertoire.length - 1)
      this.screens.showPicker(contest.pitcher.pitching!.repertoire, this.pitchIndex, (index) => this.pickPitch(index))
      this.screens.setMeter(0, null, 'Aim, then click or press Space to start the meter')
      const zone = strikeZone(contest.batter.height)
      this.cursor = { x: 0, y: (zone.top + zone.bottom) / 2 }
      this.enter('aim')
      return
    }
    this.throwPitch(contest.preparePitch(null))
  }

  private pickPitch(index: number): void {
    this.pitchIndex = index
    this.screens.selectPitch(index)
  }

  private moveCursor(dt: number, radius: number): void {
    const pointer = this.input.pointer
    if (pointer.dx || pointer.dy) {
      const ndc = new THREE.Vector2(pointer.x * 2 - 1, -(pointer.y * 2 - 1))
      this.raycaster.setFromCamera(ndc, this.app.camera)
      if (this.raycaster.ray.intersectPlane(PLATE_PLANE, this.hit)) {
        this.cursor.x = this.hit.x
        this.cursor.y = this.hit.y
      }
    }
    const speed = this.config.timing.cursorSpeed * dt
    this.cursor.x += this.input.axis('left', 'right') * speed
    this.cursor.y += this.input.axis('down', 'up') * speed
    this.cursor.x = Math.max(-1, Math.min(1, this.cursor.x))
    this.cursor.y = Math.max(0, Math.min(1.9, this.cursor.y))
    this.actors.setCursor(true, this.cursor.x, this.cursor.y, radius)
  }

  private updateAim(contest: Contest, dt: number): void {
    const repertoire = contest.pitcher.pitching!.repertoire
    const keys: Action[] = ['pitch1', 'pitch2', 'pitch3', 'pitch4', 'pitch5']
    keys.forEach((key, index) => {
      if (index < repertoire.length && this.input.pressed(key)) this.pickPitch(index)
    })
    if (this.stage === 'aim') {
      this.moveCursor(dt, 0.07)
      if (this.input.pressed('swing')) {
        this.meterPhase = 1
        this.meterValue = 0
        this.enter('meter')
      }
      return
    }
    const seconds = this.config.timing.meterSeconds
    if (this.meterPhase === 1) {
      this.meterValue += dt / seconds
      this.screens.setMeter(this.meterValue, null, 'Press again to set the effort')
      if (this.input.pressed('swing') || this.meterValue >= 1) {
        this.effort = Math.min(1, this.meterValue)
        this.meterPhase = 2
      }
      return
    }
    this.meterValue -= dt / seconds
    this.screens.setMeter(this.meterValue, this.effort, 'Stop it on the blue mark for accuracy')
    const pressed = this.input.pressed('swing')
    if (pressed || this.meterValue <= -0.05) {
      const accuracy = pressed ? Math.max(-1, Math.min(1, (this.meterValue - 0.1) / 0.1)) : -1
      const intent: PitchIntent = {
        type: repertoire[this.pitchIndex].type,
        targetX: Math.round(this.cursor.x * 1000),
        targetY: Math.round(this.cursor.y * 1000),
        effort: Math.round(40 + this.effort * 60),
        accuracy: Math.round(accuracy * 100),
      }
      this.screens.hidePicker()
      this.actors.setCursor(false)
      this.throwPitch(contest.preparePitch(intent))
    }
  }

  private throwPitch(thrown: ThrownPitch): void {
    const contest = this.contest!
    this.thrown = thrown
    this.swingPress = null
    this.outcome = null
    this.actors.clearTrail()
    const path = pitchPath({ type: thrown.type, throws: thrown.throws, speed: thrown.speed, release: thrown.release, plate: { x: thrown.plateX, y: thrown.plateY }, wobbleSeed: thrown.wobbleSeed }, contest.air)
    this.flight = path.samples
    this.actors.setGhost(false)
    this.actors.setBall(null)
    this.actors.windup(this.config.timing.windup / RELEASE_AT)
    this.screens.hidePitch()
    this.enter('windup')
  }

  /** Seconds of clip so the bat reaches the zone `swingLag` (scaled for slow pitches) after it starts. */
  private swingDuration(scale: number): number {
    return (this.config.timing.swingLag * scale) / CONTACT_AT
  }

  private get displayScale(): number {
    return this.humanBatting ? this.flightScale : 1.15
  }

  private updateWindup(dt: number): void {
    if (this.humanBatting) this.moveCursor(dt, pciRadius('contact'))
    if (this.humanBatting) this.readSwing(-1)
    if (this.stageTime >= this.config.timing.windup) this.enter('flight')
  }

  private readSwing(flightTime: number): void {
    if (this.swingPress) return
    let type: SwingType | null = null
    if (this.input.pressed('bunt')) type = 'bunt'
    else if (this.input.pressed('power')) type = 'power'
    else if (this.input.pressed('swing')) type = 'contact'
    if (!type) return
    this.swingPress = { at: flightTime, type }
    this.actors.swing(type, type === 'bunt' ? 0.4 : this.swingDuration(this.displayScale))
  }

  private updateFlight(contest: Contest, dt: number): void {
    const thrown = this.thrown!
    const scale = this.displayScale
    const t = this.stageTime / scale
    const arrival = this.flight[this.flight.length - 1].t
    this.actors.setBall(sampleKeys(this.flight, Math.min(t, arrival)))
    const spec = PITCH_SPECS[thrown.type]
    this.actors.spinBall(dt / scale, spec.rpm, thrown.throws === 'R' ? spec.tilt : -spec.tilt)
    this.actors.pushTrail()
    if (this.humanBatting) {
      if (this.choice?.assist && !this.swingPress) {
        const jitter = this.config.assist.aimJitter
        this.cursor.x += (thrown.plateX + Math.sin(this.clock * 7) * jitter - this.cursor.x) * Math.min(1, dt * 6)
        this.cursor.y += (thrown.plateY + Math.cos(this.clock * 5) * jitter - this.cursor.y) * Math.min(1, dt * 6)
        this.actors.setCursor(true, this.cursor.x, this.cursor.y, pciRadius('contact') * (this.contest?.setup.pciScale?.[this.contest.battingSide] ?? 1))
      } else this.moveCursor(dt, pciRadius(this.swingPress?.type ?? 'contact'))
      this.readSwing(t)
    } else if (!this.pending && t >= arrival - this.config.timing.swingLag) {
      this.pending = contest.resolveSwing(null)
      if (this.pending.swing.action === 'swing') this.actors.swing(this.pending.swing.type, this.pending.swing.type === 'bunt' ? 0.4 : this.swingDuration(scale))
    }
    const grace = this.humanBatting ? 0.12 : 0
    if (t < arrival + grace) return

    let swing: SwingIntent | null = null
    if (this.humanBatting) {
      const press = this.swingPress
      if (!press) swing = { action: 'take', type: 'contact', timing: 0, aimX: 0, aimY: 0 }
      else {
        const contactAt = press.at < 0 ? -1 : press.at + this.config.timing.swingLag
        const raw = press.type === 'bunt' ? 0 : (contactAt - arrival) * 1000
        const timing = Math.round(this.choice?.assist && press.at >= 0 ? raw * this.config.assist.timing : raw)
        swing = { action: 'swing', type: press.type, timing, aimX: Math.round(this.cursor.x * 1000), aimY: Math.round(this.cursor.y * 1000) }
      }
    }
    const outcome = this.pending ?? contest.resolveSwing(swing)
    this.pending = null
    const audio = this.presentation.audio
    if (!outcome.batted) {
      this.actors.catchPitch({ x: thrown.plateX, y: thrown.plateY, z: -0.6 })
      if (outcome.call !== 'hbp') audio.glove()
    } else audio.bat(Math.max(0, Math.min(1, (outcome.batted.launch.speed - 20) / 28)))
    if (outcome.events.some((item) => item.startsWith('Strike three, called'))) audio.say('Steee-rike three!', 'umpire')
    if (outcome.play?.kind === 'homer') audio.say(HOMER_CALLS[contest.pitchCount % HOMER_CALLS.length])
    this.outcome = outcome
    this.actors.setCursor(false)
    this.actors.setGhost(true, thrown.plateX, thrown.plateY)
    const call = outcome.call === 'inPlay' ? 'In play' : outcome.call === 'called' ? 'Called strike' : outcome.call === 'swinging' ? 'Swinging strike' : outcome.call === 'foul' ? 'Foul' : outcome.call === 'tip' ? 'Foul tip' : outcome.call === 'hbp' ? 'Hit by pitch' : 'Ball'
    this.screens.showPitch(PITCH_SPECS[thrown.type].short, thrown.mph, call)
    const big = outcome.play?.kind === 'homer' || outcome.events.some((text) => text.startsWith('Strike three')) || outcome.final
    const text = outcome.events.filter((item) => item !== 'Ball.' && item !== 'Called strike.' && item !== 'Swing and a miss.' && item !== 'Foul ball.').join(' ')
    if (text) this.screens.say(text, 3, big)
    this.timeline = outcome.play && outcome.batted ? outcome.play.timeline : null
    this.playEnd = this.timeline ? Math.min(this.timeline.duration, outcome.play?.kind === 'homer' ? 7 : 12) + this.config.timing.afterPlay : this.config.timing.afterPlay
    this.lastMark = 0
    this.replayed = false
    if (this.timeline && outcome.play && outcome.play.kind !== 'foul') this.replayOf = { timeline: this.timeline, outcome }
    if (this.timeline) {
      this.actors.hideBatter()
      this.actors.setGhost(false)
      this.actors.clearTrail()
    }
    this.react(contest, outcome)
    this.scuffed.clear()
    this.screens.updateBug(contest)
    this.enter('play')
  }

  /** Crowd noise and park effects for a pitch's result, from the home crowd's point of view. */
  private react(contest: Contest, outcome: PitchOutcome): void {
    const battingSide = outcome.halfOver ? (contest.battingSide === 0 ? 1 : 0) : contest.battingSide
    const homeBatting = battingSide === 1
    const kind = outcome.play?.kind
    if (kind === 'homer') {
      this.scenery.celebrate('homer')
      this.scenery.excite(homeBatting ? 1 : 0.35)
      return
    }
    if (outcome.final && contest.winner === 1) {
      this.scenery.celebrate('final')
      this.scenery.excite(1)
      return
    }
    if (kind === 'hit' || kind === 'groundRule') this.scenery.excite(homeBatting ? 0.55 + (outcome.play?.hitBases ?? 1) * 0.1 : 0.2)
    else if (outcome.events.some((text) => text.startsWith('Strike three'))) this.scenery.excite(homeBatting ? 0.15 : 0.55)
    else if (outcome.play?.doublePlay) this.scenery.excite(homeBatting ? 0.1 : 0.6)
    else if (outcome.batted && outcome.call === 'inPlay') this.scenery.excite(0.3)
  }

  private updatePlay(contest: Contest, dt: number): void {
    const skip = this.input.pressed('skip')
    const timeline = this.timeline
    if (timeline) {
      const at = this.applyTimeline(timeline, this.stageTime, dt, true)
      if (at) this.followBall(at)
      const outcome = this.outcome
      if (outcome?.play?.kind === 'homer' && this.stageTime > 2.4) this.followRunner(timeline, outcome.pitch.batterId, this.stageTime)
    } else if (this.thrown) {
      this.actors.setBall({ x: this.thrown.plateX, y: this.thrown.plateY, z: PLATE_FRONT - 0.4 - Math.min(0.6, this.stageTime * 2) })
    }
    if (this.stageTime < this.playEnd && !skip) return
    if (!skip && this.worthReplaying()) return this.startReplay(false)
    this.afterPlay(contest)
  }

  private afterPlay(contest: Contest): void {
    const outcome = this.outcome!
    if (outcome.final || contest.phase === 'final') return this.finish()
    if (outcome.halfOver) return this.halfBreak()
    this.resetScene()
    this.enter('between')
  }

  private worthReplaying(): boolean {
    if (!this.choice?.replays || this.replayed || !this.replayOf || this.replayOf.outcome !== this.outcome) return false
    const play = this.outcome?.play
    if (!play) return false
    return play.kind === 'homer' || play.doublePlay || play.hitBases >= 3 || play.timeline.marks.some((mark) => REPLAY_MARKS.has(mark.text))
  }

  private startReplay(onDemand: boolean): void {
    if (!this.replayOf) return
    this.replayed = true
    this.actors.resetReactions()
    this.presentation.broadcast.showReplay(true)
    this.enter('replay')
    this.replayOnDemand = onDemand
  }

  private replayOnDemand = false

  private updateReplay(contest: Contest, dt: number): void {
    const replay = this.replayOf
    const skip = this.input.pressed('skip') || this.input.pressed('replay')
    if (!replay) return this.endReplay(contest)
    const t = this.stageTime * this.config.timing.replaySpeed
    const at = this.applyTimeline(replay.timeline, t, dt * this.config.timing.replaySpeed, false)
    if (at) {
      const ball = toWorld(at)
      const side = toWorld({ x: at.x + 14, y: 1.6 + Math.min(6, at.y * 0.4), z: at.z - 10 })
      this.goal.position.copy(side)
      this.goal.target.copy(ball)
      this.goal.fov = 34
      this.presentation.post.setFocus(this.camera.position.distanceTo(ball), 1)
    }
    if (!skip && t < Math.min(replay.timeline.duration, this.config.timing.replayMax)) return
    this.endReplay(contest)
  }

  private endReplay(contest: Contest): void {
    this.presentation.post.setFocus(10, 0)
    this.presentation.broadcast.showReplay(false)
    if (this.replayOnDemand) {
      this.resetScene()
      this.enter('between')
      return
    }
    this.afterPlay(contest)
  }

  private followBall(at: Sample | { x: number; y: number; z: number }): void {
    const focus = toWorld({ x: at.x, y: Math.min(at.y, 12), z: at.z })
    this.goal.target.lerp(focus, 0.25)
    const back = toWorld({ x: at.x * 0.35, y: 16 + Math.min(18, Math.hypot(at.x, at.z) * 0.12), z: Math.min(at.z * 0.35, 30) - 26 })
    this.goal.position.copy(back)
    this.goal.fov = this.config.cameras.play.fov
  }

  /** Home-run trot: a low camera trailing the batter around the bases. */
  private followRunner(timeline: Timeline, id: string, t: number): void {
    const track = tracksOf(timeline, 'runner').find((item) => item.id === id)
    const at = track ? sampleKeys(track.keys, t) : null
    if (!at) return
    const runner = toWorld(at)
    this.goal.target.copy(runner).setY(1.1)
    this.goal.position.copy(toWorld({ x: at.x * 0.6, y: 3.2, z: at.z * 0.6 - 9 }))
    this.goal.fov = 38
  }

  /** Puts fielders, runners and the ball where the timeline has them at `t`; live play also leaves scuffs. Returns the ball position. */
  private applyTimeline(timeline: Timeline, t: number, dt: number, live: boolean): Sample | { x: number; y: number; z: number } | null {
    {
      for (const track of tracksOf(timeline, 'fielder')) {
        const at = sampleKeys(track.keys, t)
        if (at) this.actors.setFielder(track.id, at, dt)
      }
      this.footClock += dt
      const footprints = live && this.footClock > 0.3
      if (footprints) this.footClock = 0
      for (const track of tracksOf(timeline, 'runner')) {
        const at = sampleKeys(track.keys, t)
        if (!at) continue
        this.actors.setRunner(track.id, at, dt)
        if (!live) continue
        for (const [index, base] of BASE_SPOTS.entries()) {
          const key = `${track.id}:${index}`
          if (!this.scuffed.has(key) && Math.hypot(at.x - base.x, at.z - base.z) < 1.2) {
            this.scuffed.add(key)
            this.scenery.scuff(base.x, base.z, 0.9, 0.7, Math.atan2(at.z, at.x), 1.8)
          }
        }
        if (footprints) this.scenery.scuff(at.x, at.z, 0.22, 0.25)
      }
      if (footprints) {
        for (const track of tracksOf(timeline, 'fielder')) {
          const at = sampleKeys(track.keys, t)
          if (at && Math.hypot(at.x, at.z - 18.44) < 30) this.scenery.scuff(at.x, at.z, 0.2, 0.18)
        }
      }
      const ball = tracksOf(timeline, 'ball')[0]
      const at = ball ? sampleKeys(ball.keys, t) : null
      this.actors.setBall(at)
      if (this.actors.reactToBall(at)) this.presentation.audio.glove()
      const launch = this.outcome?.batted?.launch
      if (launch) this.actors.spinBall(dt, Math.abs(launch.backspin) * 0.25, 0)
      if (live) {
        const marks = marksBetween(timeline, this.lastMark, t)
        if (marks.length) this.screens.say(marks.join(' '), 1.6, true)
        this.lastMark = t
      }
      return at
    }
  }

  private halfBreak(): void {
    const contest = this.contest!
    this.stealArmed = false
    const finishedTop = contest.half === 'bottom'
    this.screens.say(`${finishedTop ? 'Middle' : 'End'} of the ${ordinal(finishedTop ? contest.inning : contest.inning - 1)}`, 2.4, true)
    if (!finishedTop && contest.inning >= 4 && (contest.inning + contest.score[0] + contest.score[1]) % 3 === 0) this.scenery.startWave()
    this.presentation.audio.organ()
    if ((contest.inning + contest.pitchCount) % 3 === 0) this.presentation.audio.say(VENDOR_CALLS[contest.pitchCount % VENDOR_CALLS.length], 'vendor')
    this.resetScene()
    this.enter('between')
    this.stageTime = -1.6
  }

  private finish(): void {
    const contest = this.contest!
    this.enter('final')
    this.screens.hidePicker()
    this.actors.setCursor(false)
    this.screens.updateBug(contest)
    this.screens.showFinal(contest, this.humans.size === 1 ? [...this.humans][0] : null)
    this.presentation.broadcast.say(`That's the final: ${contest.teams[0].roster.team.abbr} ${contest.score[0]}, ${contest.teams[1].roster.team.abbr} ${contest.score[1]}.`, 4)
    if (contest.winner !== null) this.actors.celebrate(contest.teams[contest.winner].roster.team.id)
    this.setPose('overview')
    this.hooks.onFinal(contest)
  }

  private updateCamera(dt: number): void {
    const k = 1 - Math.exp(-dt * (this.stage === 'play' ? 2.4 : 4))
    this.camera.position.lerp(this.goal.position, k)
    this.camera.target.lerp(this.goal.target, k)
    this.camera.fov += (this.goal.fov - this.camera.fov) * k
    this.app.camera.position.copy(this.camera.position)
    this.app.camera.lookAt(this.camera.target)
    if (Math.abs(this.app.camera.fov - this.camera.fov) > 0.01) {
      this.app.camera.fov = this.camera.fov
      this.app.camera.updateProjectionMatrix()
    }
  }

  dispose(): void {
    this.contest = null
  }
}

function ordinal(value: number): string {
  const suffix = value % 100 >= 11 && value % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'
  return `${value}${suffix}`
}
