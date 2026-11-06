/** Session controller: owns the match and round state, turns input into swings, runs the authority for solo and host play, replays host shots on guests, and exposes plain state for index.ts to draw. */
import type { RoomStatus } from '../../../engine'
import type { ModuleConfig } from '../config'
import type { ClubId, RoundMode, ShotKind } from '../tuning'
import { sampleAt, simulateShot, type ShotParams, type ShotResult } from '../systems/BallFlight'
import type { SwingMoment } from '../systems/GolferRig'
import { createCameraState, setCameraMode, stepCamera, type CameraMode, type CameraPose, type CameraState } from '../systems/Camera'
import { suggestClub } from '../systems/ClubAdvice'
import { courseFor } from '../systems/Course'
import {
  applyShot,
  createMatch,
  currentCourseHole,
  pickHoles,
  placements,
  playerById,
  removePlayer,
  shotParamsFor,
  shotRejection,
  shotSeed,
  windSeedsFor,
  type MatchEvent,
  type MatchState,
  type MatchUpdate,
  type Placement,
  type PlayerSeat,
  type SwingInput,
} from '../systems/Match'
import type { FairwayMessage } from '../systems/Protocol'
import { saveRecord, type FairwayBoard } from '../systems/Records'
import { MENU, reduceRound, tickRound, type RoundEvent, type RoundState } from '../systems/Round'
import { effectivePower, type MeterState } from '../systems/SwingMeter'
import { horizontalDistance, yawTowards, type Vec3 } from '../systems/Vector'
import { OnlineRoom } from './OnlineRoom'
import { holeOutMessage, scorecardModel, type ShotPlanView } from './Presenters'
import { ShotPlan, type ShotPreview } from './ShotPlan'
import type { Screens } from '../ui/Screens'

export interface InputFrame {
  swing: boolean
  swingDown: boolean
  swingReleased: boolean
  menu: boolean
  aim: number
  clubUp: boolean
  clubDown: boolean
  spinUp: boolean
  spinDown: boolean
  power: number
  shotNext: boolean
  shotPick: ShotKind | null
  orbiting: boolean
  orbitDx: number
  orbitDy: number
}

/** Where and how to draw the golfer this frame: the ball it stands to, the aim, the club and the moment of the swing. */
export interface GolferView extends SwingMoment {
  ball: Vec3
  yaw: number
}

interface LastSwing {
  playerId: string
  yaw: number
  club: ClubId
  shot: ShotKind
  power: number
}

export interface PlayHooks {
  screens: Screens
  toast(message: string): void
  notifyBoard(board: FairwayBoard): void
  /** The course hole on screen changed: rebuild the hole scene with this tee and target. */
  showHole(holeIndex: number, tee: Vec3, target: Vec3): void
  celebrate(active: boolean): void
}

export interface BallView {
  id: string
  previous: Vec3
  current: Vec3
  visible: boolean
}

export class Play {
  round: RoundState = MENU
  match: MatchState | null = null
  shown: MatchState | null = null
  aimYaw = Math.PI
  clubIndex = 0
  spin = 0
  readonly plan = new ShotPlan()
  camera: CameraState
  private clock = 0
  private lastSwing: LastSwing | null = null
  previousPose: CameraPose
  readonly online: OnlineRoom
  private mode: RoundMode = 'solo'
  private awaitingShot = false
  private viewHole = -1
  private lastPhase: RoundState['phase'] = 'menu'
  private balls = new Map<string, { previous: Vec3; current: Vec3 }>()
  private lobbyRoster: readonly PlayerSeat[] = []
  private lobbyHostId = ''
  private lobbyStatus: string
  private dropTimers = new Map<string, number>()
  private finalPlacements: Placement[] | null = null
  private recordedFinish = false

  constructor(
    private readonly config: ModuleConfig,
    private readonly self: PlayerSeat,
    private readonly signedIn: boolean,
    private readonly hooks: PlayHooks,
  ) {
    const course = courseFor(0)
    const tee = course.teePosition()
    this.camera = setCameraMode(createCameraState({ position: [tee[0], tee[1] + config.camera.previewHeight, tee[2]], lookAt: course.pinPosition() }), 'preview')
    this.previousPose = this.camera.pose
    this.lobbyStatus = config.presenters.lobbyIdle
    this.online = new OnlineRoom(config.room.format, config.engine.net, self, config.match.maxPlayers, {
      roster: (players, hostId) => {
        this.lobbyRoster = players
        this.lobbyHostId = hostId
        if (!this.online.isHost && this.online.room.status === 'connected') this.lobbyStatus = config.presenters.lobbyConnected
        this.renderLobby()
      },
      status: (status, detail) => this.onRoomStatus(status, detail),
      lateJoin: (peerId, seat) => {
        const timer = this.dropTimers.get(seat.id)
        if (timer) {
          clearTimeout(timer)
          this.dropTimers.delete(seat.id)
        }
        if (this.match) this.online.sendTo(peerId, { type: 'state', state: this.match })
      },
      dropped: (playerId) => {
        if (!this.match || !playerById(this.match, playerId)) return
        this.dropTimers.set(
          playerId,
          window.setTimeout(() => {
            this.dropTimers.delete(playerId)
            if (!this.match) return
            this.adoptAuthority(removePlayer(this.match, playerId))
          }, config.room.dropAfterSeconds * 1000),
        )
      },
      message: (message, from) => this.onMessage(message, from),
    })
    this.online.bridgeHub(async () => {
      this.openLobby()
      await this.hostRoom()
    })
    if (this.online.autoJoinFromQuery()) {
      this.lobbyStatus = config.presenters.lobbyJoining
      this.openLobby()
    }
    hooks.showHole(0, tee, course.pinPosition())
    this.viewHole = 0
  }

  get localTurn(): boolean {
    return !!this.shown && this.shown.current === this.self.id && !this.awaitingShot
  }

  get club(): ClubId {
    return this.config.clubs[this.clubIndex].id
  }

  get localId(): string {
    return this.self.id
  }

  /** The player whose ball the camera and HUD follow: the one in flight, else the one to play, else the local player. */
  focusPlayer(): string | null {
    if (this.round.phase === 'flight' || this.round.phase === 'resting') return this.round.playerId
    return this.shown?.current ?? this.shown?.players.find((player) => player.id === this.self.id)?.id ?? this.shown?.players[0]?.id ?? null
  }

  ballViews(): BallView[] {
    if (!this.shown) return []
    const hidden = this.round.phase === 'holeOut' || this.round.phase === 'scorecard' || this.round.phase === 'finished'
    const views: BallView[] = []
    for (const player of this.shown.players) {
      const entry = this.balls.get(player.id)
      if (!entry) continue
      const flying = (this.round.phase === 'flight' || this.round.phase === 'resting') && this.round.playerId === player.id
      views.push({ id: player.id, previous: entry.previous, current: entry.current, visible: flying || (!hidden && !player.holed && !player.pickedUp) })
    }
    return views
  }

  flightShot(): { shot: ShotResult; step: number } | null {
    if (this.round.phase === 'flight') return { shot: this.round.shot, step: this.round.step }
    if (this.round.phase === 'resting') return { shot: this.round.shot, step: this.round.shot.samples.length / 3 - 1 }
    return null
  }

  meter(): MeterState | null {
    return this.round.phase === 'swinging' && this.localTurn ? this.round.meter : this.round.phase === 'swinging' && this.awaitingShot ? this.round.meter : null
  }

  showsAim(): boolean {
    return (this.round.phase === 'aiming' || this.round.phase === 'swinging') && this.localTurn
  }

  private localLie() {
    return this.shown ? playerById(this.shown, this.self.id)?.lie : undefined
  }

  /** The swing as it stands for the local player, struck perfectly at the given power. */
  private plannedParams(power: number): ShotParams | null {
    if (!this.shown || !playerById(this.shown, this.self.id)) return null
    return shotParamsFor(this.shown, this.self.id, { yaw: this.aimYaw, club: this.club, power, curve: 0, spin: this.spin, push: 0, shot: this.plan.shot })
  }

  /** Perfect-strike preview while aiming or swinging: at the planned power, the live power while the ring grows, then the locked power. */
  preview(): ShotPreview | null {
    if (!this.showsAim() || !this.shown) return null
    const meter = this.round.phase === 'swinging' ? this.round.meter : null
    const power = meter && meter.phase !== 'idle' ? meter.power : this.plan.power
    const params = this.plannedParams(power)
    return params ? this.plan.preview(params, power, courseFor(params.hole)) : null
  }

  planView(): ShotPlanView | null {
    if (!this.showsAim()) return null
    const putting = this.localLie() === 'green' || this.club === 'putter'
    const preview = this.preview()
    return {
      shot: putting ? null : this.plan.shot,
      power: this.plan.power,
      distance: preview ? preview.distance : null,
      spinRpm: preview && !putting ? preview.result.spinRpm : null,
      editable: this.round.phase === 'aiming',
    }
  }

  /**
   * The golfer for this frame. While a player aims it stands at address to their ball; the local swing follows the meter
   * (backswing with the power ring, held at the top through path, contact and rhythm, downswing on the strike); during
   * the flight it plays the follow-through from where the shot was struck, then holds the finish.
   */
  golferView(): GolferView | null {
    const shown = this.shown
    if (!shown) return null
    const phase = this.round.phase
    if (phase === 'flight' || phase === 'resting') {
      const shot = this.round.shot
      const origin = sampleAt(shot, 0)
      const mine = this.lastSwing && this.lastSwing.playerId === this.round.playerId ? this.lastSwing : null
      const player = playerById(shown, this.round.playerId)
      const club = mine?.club ?? suggestClub(horizontalDistance(origin, shot.landing ?? shot.rest), player?.lie ?? 'fairway')
      const progress = phase === 'flight' ? (this.round.step * shot.stepSeconds) / this.config.golferTiming.followSeconds : 1
      return {
        ball: origin,
        yaw: mine?.yaw ?? yawTowards(origin, shot.landing ?? shot.rest),
        club,
        shot: mine?.shot ?? 'full',
        stage: 'follow',
        progress,
        amount: mine?.power ?? 1,
        time: this.clock,
      }
    }
    if (phase !== 'aiming' && phase !== 'swinging') return null
    const player = shown.current ? playerById(shown, shown.current) : undefined
    if (!player || player.holed || player.pickedUp) return null
    const local = player.id === this.self.id
    const pin = courseFor(currentCourseHole(shown)).pinPosition()
    const club: ClubId = local ? (player.lie === 'green' ? 'putter' : this.club) : suggestClub(horizontalDistance(player.ball, pin), player.lie)
    const base = { ball: player.ball, yaw: local ? this.aimYaw : yawTowards(player.ball, pin), club, shot: local && club !== 'putter' ? this.plan.shot : ('full' as ShotKind), time: this.clock }
    const meter = phase === 'swinging' ? this.round.meter : null
    if (!meter || meter.phase === 'idle') return { ...base, stage: 'address', progress: 0, amount: 1 }
    switch (meter.phase) {
      case 'power':
        return { ...base, stage: 'back', progress: 1, amount: meter.power }
      case 'path':
      case 'contact':
      case 'rhythm':
        return { ...base, stage: 'top', progress: 1, amount: meter.power }
      default:
        return { ...base, stage: 'down', progress: meter.strike / this.config.meter.strikeSeconds, amount: meter.power }
    }
  }

  /** Starts a solo round or a closest-to-the-pin session. */
  startLocal(mode: 'solo' | 'pin'): void {
    const seed = Math.floor(Math.random() * 0xffffffff) >>> 0
    const holes = pickHoles(mode, seed)
    this.beginMatch(mode, createMatch({ mode, holes, windSeeds: windSeedsFor(holes, seed), matchSeed: seed, players: [this.self] }))
  }

  openLobby(): void {
    this.hooks.screens.show('lobby')
    this.renderLobby()
  }

  async hostRoom(): Promise<void> {
    if (this.online.isHost && this.online.room.open) return
    this.lobbyStatus = this.config.presenters.lobbyHosting
    this.renderLobby()
    try {
      await this.online.host()
      this.lobbyStatus = this.config.presenters.lobbyFull
    } catch (error) {
      this.lobbyStatus = this.config.presenters.lobbyError(error instanceof Error ? error.message : String(error))
    }
    this.renderLobby()
  }

  async joinRoom(code: string): Promise<void> {
    this.lobbyStatus = this.config.presenters.lobbyJoining
    this.renderLobby()
    try {
      await this.online.join(code)
    } catch (error) {
      this.lobbyStatus = this.config.presenters.lobbyError(error instanceof Error ? error.message : String(error))
    }
    this.renderLobby()
  }

  /** Host only: deals the holes and wind seeds, then sends start and the opening state to every guest. */
  startOnline(): void {
    if (!this.online.isHost) return
    const seed = Math.floor(Math.random() * 0xffffffff) >>> 0
    const holes = pickHoles('online', seed)
    const seeds = windSeedsFor(holes, seed)
    const players = this.online.roster()
    const match = createMatch({ mode: 'online', holes, windSeeds: seeds, matchSeed: seed, players })
    this.online.markStarted()
    this.online.broadcast({ type: 'start', holes, seeds, matchSeed: seed, players })
    this.online.broadcast({ type: 'state', state: match })
    this.beginMatch('online', match)
  }

  leaveToMenu(): void {
    this.online.close()
    for (const timer of this.dropTimers.values()) clearTimeout(timer)
    this.dropTimers.clear()
    this.match = null
    this.shown = null
    this.balls.clear()
    this.awaitingShot = false
    this.round = MENU
    this.lobbyRoster = []
    this.lobbyStatus = this.config.presenters.lobbyIdle
    this.hooks.celebrate(false)
    this.hooks.screens.setBanner(null)
    this.hooks.screens.show('start')
    this.hooks.screens.refreshBoard()
    const course = courseFor(0)
    this.hooks.showHole(0, course.teePosition(), course.pinPosition())
    this.viewHole = 0
    this.camera = setCameraMode(this.camera, 'preview')
  }

  dispatch(event: RoundEvent): void {
    this.round = reduceRound(this.round, event)
    this.onPhaseChange()
  }

  togglePause(): void {
    const screens = this.hooks.screens
    if (this.round.phase === 'menu') return
    if (screens.current() === 'pause') screens.show(null)
    else if (screens.current() === null) screens.show('pause')
  }

  showScorecardFromPause(): void {
    if (!this.shown) return
    this.hooks.screens.setScorecard({ ...scorecardModel(this.config, this.shown, false), continueLabel: null })
    this.hooks.screens.show('scorecard')
  }

  /** One fixed step of play: input, the round clock, the authority, the camera and the ball positions. */
  step(dt: number, input: InputFrame): void {
    this.clock += dt
    if (input.menu) this.togglePause()
    const overlay = this.hooks.screens.current()
    const frozen = overlay === 'pause' && this.mode !== 'online'
    let clicked = input.swing && overlay === null

    if (!frozen && overlay === null) {
      if (this.round.phase === 'preview' && clicked) {
        this.dispatch({ type: 'skipPreview' })
        clicked = false
      } else if (this.round.phase === 'aiming' && this.localTurn) {
        this.handleAimInput(dt, input)
        if (clicked) {
          this.dispatch({ type: 'swingPressed' })
          clicked = false
        }
      }
    }

    if (!frozen && this.round.phase !== 'menu') {
      const button = { pressed: clicked, released: input.swingReleased, down: input.swingDown && overlay === null }
      const tick = tickRound(this.round, dt, button, this.config.camera.previewSeconds)
      this.round = tick.state
      if (tick.applied) this.applyShown(tick.applied)
      if (tick.swing && !this.awaitingShot && this.shown?.current === this.self.id) this.launchLocal(tick.swing)
      this.onPhaseChange()
    }

    this.stepBalls()
    this.stepCamera(dt, input)
  }

  private handleAimInput(dt: number, input: InputFrame): void {
    this.aimYaw += input.aim * this.config.aim.turnRate * dt
    const lie = this.shown ? playerById(this.shown, this.self.id)?.lie : undefined
    if (lie !== 'green') {
      if (input.clubUp) this.changeClub(-1)
      if (input.clubDown) this.changeClub(1)
    }
    if (input.spinUp) this.changeSpin(1)
    if (input.spinDown) this.changeSpin(-1)
    if (input.power) this.plan.nudge(input.power * this.config.aim.powerRate * dt)
    if (input.shotPick) this.selectShot(input.shotPick)
    else if (input.shotNext) this.cycleShot()
  }

  changeClub(delta: number): void {
    if (!this.showsAim()) return
    const lie = this.localLie()
    if (lie === 'green') return
    const last = this.config.clubs.length - 1
    const before = this.clubIndex
    this.clubIndex = Math.max(0, Math.min(last, this.clubIndex + delta))
    if (this.clubIndex !== before) this.replan()
  }

  changePower(delta: number): void {
    if (!this.showsAim() || this.round.phase !== 'aiming') return
    this.plan.nudge(delta * this.config.aim.powerStep)
  }

  selectShot(kind: ShotKind): void {
    if (!this.showsAim() || this.round.phase !== 'aiming' || this.localLie() === 'green' || this.club === 'putter') return
    if (this.plan.select(kind)) this.replan()
  }

  cycleShot(): void {
    if (!this.showsAim() || this.round.phase !== 'aiming' || this.localLie() === 'green' || this.club === 'putter') return
    this.plan.next()
    this.replan()
  }

  private replan(): void {
    const params = this.plannedParams(1)
    if (params) this.plan.replan(params, courseFor(params.hole))
  }

  changeSpin(delta: number): void {
    if (!this.showsAim()) return
    this.spin = Math.max(-1, Math.min(1, Math.round((this.spin + delta * this.config.aim.spinStep) * 100) / 100))
  }

  setSpin(value: number): void {
    if (!this.showsAim() || this.round.phase !== 'aiming' || !Number.isFinite(value)) return
    this.spin = Math.max(-1, Math.min(1, Math.round(value * 100) / 100))
  }

  selectClub(club: ClubId): void {
    const index = this.config.clubs.findIndex((entry) => entry.id === club)
    if (index < 0 || this.round.phase !== 'aiming') return
    this.changeClub(index - this.clubIndex)
  }

  nudgeAim(direction: number): void {
    if (!this.showsAim()) return
    this.aimYaw += direction * this.config.aim.turnRate * this.config.aim.nudgeSeconds
  }

  private beginMatch(mode: RoundMode, match: MatchState): void {
    this.mode = mode
    this.match = match
    this.shown = match
    this.finalPlacements = null
    this.recordedFinish = false
    this.awaitingShot = false
    this.balls.clear()
    this.hooks.screens.show(null)
    this.dispatch({ type: 'begin', mode })
  }

  private launchLocal(meter: MeterState): void {
    if (!this.match) return
    const swing: SwingInput = { yaw: this.aimYaw, club: this.club, power: effectivePower(meter), curve: meter.curve, spin: this.spin, push: meter.push, shot: this.plan.shot }
    this.lastSwing = { playerId: this.self.id, yaw: this.aimYaw, club: this.localLie() === 'green' ? 'putter' : this.club, shot: this.plan.shot, power: meter.power }
    this.awaitingShot = true
    if (this.mode !== 'online' || this.online.isHost) {
      this.resolveShot(this.self.id, swing)
      return
    }
    const params = shotParamsFor(this.match, this.self.id, swing)
    this.online.broadcast({ type: 'shot', playerId: this.self.id, params, seed: shotSeed(this.match, this.self.id) })
  }

  /**
   * Authority path (solo, closest to the pin, online host). Rejects shots out of turn, rebuilds the parameters from the
   * authoritative state so a guest cannot move its own ball, flies the shot with the shared seed, applies it to the
   * match and, online, broadcasts the shot (so every peer replays it), the new state and, at the end, the placements.
   */
  private resolveShot(playerId: string, swing: SwingInput): void {
    if (!this.match || shotRejection(this.match, playerId)) return
    const params = shotParamsFor(this.match, playerId, swing)
    const seed = shotSeed(this.match, playerId)
    const result = simulateShot(params, seed)
    const update = applyShot(this.match, playerId, result)
    this.match = update.state
    this.startFlight(playerId, result, update)
    if (this.mode !== 'online') return
    this.online.broadcast({ type: 'shot', playerId, params, seed })
    this.online.broadcast({ type: 'state', state: update.state })
    if (update.state.finished) {
      const ranking = placements(update.state)
      this.finalPlacements = ranking
      this.online.broadcast({ type: 'finish', placements: ranking })
    }
    const turn = update.events.find((event): event is Extract<MatchEvent, { type: 'turn' }> => event.type === 'turn')
    if (turn) this.online.broadcast({ type: 'turn', playerId: turn.playerId })
  }

  private startFlight(playerId: string, shot: ShotResult, pending: MatchUpdate | null): void {
    this.awaitingShot = false
    this.dispatch({ type: 'launch', playerId, shot, pending })
  }

  /** Guest replay: fly the host's shot locally from its parameters and seed, and predict the update until the host's state arrives. */
  private replayShot(playerId: string, params: ShotParams, seed: number): void {
    const result = simulateShot(params, seed)
    const update = this.match ? applyShot(this.match, playerId, result) : null
    if (update) this.match = update.state
    this.startFlight(playerId, result, update)
  }

  /**
   * Peer message handler. Host: only "shot" is acted on (from the sender's own seat). Guests: "start" builds the same
   * match as the host from the shared seeds, "shot" replays a flight, "state" replaces the local prediction with the
   * host's snapshot (immediately when idle, or once the ball comes to rest), "turn" and "finish" update the UI and records.
   */
  private onMessage(message: FairwayMessage, from: string | null): void {
    if (this.online.isHost) {
      if (message.type === 'shot' && from) this.resolveShot(from, message.params)
      return
    }
    switch (message.type) {
      case 'start': {
        const match = createMatch({ mode: 'online', holes: message.holes, windSeeds: message.seeds, matchSeed: message.matchSeed, players: message.players })
        this.beginMatch('online', match)
        return
      }
      case 'shot':
        this.replayShot(message.playerId, message.params, message.seed)
        return
      case 'state':
        this.receiveState(message.state)
        return
      case 'turn':
        if (message.playerId === this.self.id) this.hooks.toast(this.config.hud.yourTurn)
        return
      case 'finish':
        this.finalPlacements = message.placements
        this.recordFinish()
        return
      default:
        return
    }
  }

  private receiveState(state: MatchState): void {
    if (!this.shown || this.round.phase === 'menu') {
      const spectating = !state.players.some((player) => player.id === this.self.id)
      this.beginMatch('online', state)
      if (spectating) this.hooks.toast(this.config.presenters.spectating)
      return
    }
    this.match = state
    if (this.round.phase === 'flight' || this.round.phase === 'resting') {
      const events = this.round.pending?.events ?? []
      this.dispatch({ type: 'resolved', update: { state, events } })
      return
    }
    const holeChanged = currentCourseHole(state) !== currentCourseHole(this.shown) || state.holeIndex !== this.shown.holeIndex
    this.shown = state
    if (holeChanged && this.round.phase !== 'holeOut' && this.round.phase !== 'scorecard') this.dispatch({ type: 'begin', mode: 'online' })
  }

  private adoptAuthority(update: MatchUpdate): void {
    this.match = update.state
    if (this.mode === 'online' && this.online.isHost) this.online.broadcast({ type: 'state', state: update.state })
    if (this.round.phase !== 'flight' && this.round.phase !== 'resting') this.shown = update.state
  }

  /** The ball has come to rest: switch the shown state and announce what happened. */
  private applyShown(update: MatchUpdate): void {
    this.shown = update.state
    const copy = this.config.hud
    for (const event of update.events) {
      const mine = 'playerId' in event && event.playerId === this.self.id
      const name = 'playerId' in event ? (playerById(update.state, event.playerId)?.name ?? '') : ''
      const prefix = mine || this.mode !== 'online' ? '' : `${name}: `
      switch (event.type) {
        case 'penalty':
          this.hooks.toast(prefix + (event.reason === 'water' ? copy.water : copy.out))
          break
        case 'pickedUp':
          this.hooks.toast(prefix + copy.pickedUp)
          break
        case 'holed':
          this.hooks.toast(prefix + (event.holeInOne ? copy.holeInOne : holeOutMessage(this.config, event.strokes, event.par)))
          if (event.holeInOne) this.hooks.celebrate(true)
          break
        case 'pin':
          if (event.holeInOne) {
            this.hooks.toast(copy.holeInOne)
            this.hooks.celebrate(true)
          } else if (event.metres !== null) {
            const yards = (event.metres / this.config.metresPerYard).toFixed(1)
            this.hooks.toast(copy.pinResult(event.metres.toFixed(2), yards))
          }
          if (mine && this.signedIn && event.metres !== null) {
            const hole = this.config.holes[event.hole]
            void saveRecord('pin', event.metres * 100, { hole: hole?.number, holeName: hole?.name, holeInOne: event.holeInOne }, this.hooks.notifyBoard)
          }
          break
        case 'turn':
          if (event.playerId === this.self.id && this.mode === 'online') this.hooks.toast(copy.yourTurn)
          break
        case 'finished':
          if (this.mode === 'online' && this.online.isHost) this.finalPlacements = placements(update.state)
          this.recordFinish()
          break
        default:
          break
      }
    }
  }

  private recordFinish(): void {
    if (this.recordedFinish || !this.signedIn) return
    const state = this.match ?? this.shown
    if (!state || !state.finished) return
    if (this.mode === 'solo') {
      const player = playerById(state, this.self.id)
      if (!player) return
      this.recordedFinish = true
      const scores = player.strokes.map((value) => value ?? 0)
      void saveRecord('round', scores.reduce((sum, value) => sum + value, 0), { holes: state.holes.map((index) => this.config.holes[index].number), scores }, this.hooks.notifyBoard)
      return
    }
    if (this.mode === 'online') {
      const ranking = this.finalPlacements ?? placements(state)
      const mine = ranking.find((row) => row.id === this.self.id)
      if (!mine) return
      this.recordedFinish = true
      void saveRecord(
        'match',
        mine.place,
        { holes: state.holes.map((index) => this.config.holes[index].number), lobby: this.online.code, placements: ranking.map((row) => ({ name: row.name, place: row.place, total: row.total })) },
        this.hooks.notifyBoard,
      )
    }
  }

  private onPhaseChange(): void {
    const phase = this.round.phase
    if (phase === this.lastPhase) return
    const previous = this.lastPhase
    this.lastPhase = phase
    const screens = this.hooks.screens
    if (previous === 'scorecard' && screens.current() === 'scorecard') screens.show(null)
    switch (phase) {
      case 'preview':
        this.prepareHole()
        this.hooks.celebrate(false)
        this.camera = setCameraMode(this.camera, 'preview')
        break
      case 'aiming':
        this.prepareTurn()
        break
      case 'flight':
        this.camera = setCameraMode(this.camera, 'tracking')
        break
      case 'scorecard':
        if (this.shown) {
          screens.setScorecard(scorecardModel(this.config, this.shown, this.round.phase === 'scorecard' && this.round.finished))
          screens.show('scorecard')
        }
        break
      case 'finished':
        if (this.shown) {
          screens.setScorecard(scorecardModel(this.config, this.match ?? this.shown, true))
          screens.show('scorecard')
        }
        this.recordFinish()
        break
      default:
        break
    }
  }

  private prepareHole(): void {
    if (!this.shown) return
    const holeIndex = currentCourseHole(this.shown)
    const course = courseFor(holeIndex)
    const tee = course.teeFor(this.shown.mode)
    if (holeIndex !== this.viewHole) {
      this.hooks.showHole(holeIndex, tee, course.pinPosition())
      this.viewHole = holeIndex
    }
    this.balls.clear()
  }

  /** New turn: aim at the pin (or down the first leg of a long hole from the tee) and pick the club for that distance. */
  private prepareTurn(): void {
    if (!this.shown) return
    const playerId = this.shown.current
    const player = playerId ? playerById(this.shown, playerId) : undefined
    this.hooks.screens.setBanner(this.mode === 'online' && player && player.id !== this.self.id ? this.config.hud.waiting(player.name) : null)
    if (!player) return
    const course = courseFor(currentCourseHole(this.shown))
    const hole = course.hole
    const pin = course.pinPosition()
    const longTee = player.teeShot && hole.par > 3 && this.shown.mode !== 'pin'
    const target: Vec3 = longTee ? [hole.route[1][0], 0, hole.route[1][1]] : pin
    this.aimYaw = yawTowards(player.ball, target)
    this.spin = 0
    if (player.id === this.self.id) {
      const distance = horizontalDistance(player.ball, target)
      const club = suggestClub(distance, player.lie)
      this.clubIndex = Math.max(0, this.config.clubs.findIndex((entry) => entry.id === club))
      const params = this.plannedParams(1)
      if (params) this.plan.reset(params, distance, horizontalDistance(player.ball, pin), course)
    }
    this.camera = setCameraMode(this.camera, player.lie === 'green' ? 'green' : 'follow')
  }

  private stepBalls(): void {
    if (!this.shown) return
    const flight = this.flightShot()
    for (const player of this.shown.players) {
      let position = player.ball
      let previous: Vec3 | null = null
      if (flight && (this.round.phase === 'flight' || this.round.phase === 'resting') && this.round.playerId === player.id) {
        position = sampleAt(flight.shot, flight.step)
        previous = sampleAt(flight.shot, flight.step - 1)
      }
      const entry = this.balls.get(player.id)
      if (!entry) this.balls.set(player.id, { previous: previous ?? position, current: position })
      else this.balls.set(player.id, { previous: previous ?? entry.current, current: position })
    }
  }

  private stepCamera(dt: number, input: InputFrame): void {
    this.previousPose = this.camera.pose
    const holeIndex = this.shown ? currentCourseHole(this.shown) : 0
    const course = courseFor(holeIndex)
    const focus = this.focusPlayer()
    const ball = (focus ? this.balls.get(focus)?.current : undefined) ?? (this.shown ? course.teeFor(this.shown.mode) : course.teePosition())
    const route: Vec3[] = course.hole.route.map((point) => [point[0], course.heightAt(point[0], point[1]), point[1]])
    let aimYaw = this.aimYaw
    if (!this.showsAim() && focus && this.shown) {
      const player = playerById(this.shown, focus)
      if (player) aimYaw = yawTowards(player.ball, course.pinPosition())
    }
    const mode: CameraMode | null = this.round.phase === 'menu' ? 'preview' : null
    if (mode && this.camera.mode !== mode) this.camera = setCameraMode(this.camera, mode)
    this.camera = stepCamera(
      this.camera,
      {
        ball,
        pin: course.pinPosition(),
        aimYaw,
        orbitDx: input.orbiting ? input.orbitDx : 0,
        orbitDy: input.orbiting ? input.orbitDy : 0,
        route,
        groundAt: course.heightAt,
      },
      dt,
    )
    if (this.round.phase === 'menu' && this.camera.mode !== 'preview') this.camera = setCameraMode(this.camera, 'preview')
  }

  private onRoomStatus(status: RoomStatus, detail?: string): void {
    const copy = this.config.presenters
    if (status === 'connected' && !this.online.isHost) this.lobbyStatus = copy.lobbyConnected
    else if (status === 'disconnected') this.lobbyStatus = copy.lobbyLost
    else if (status === 'error') this.lobbyStatus = copy.lobbyError(detail ?? status)
    else if (status === 'open' && this.online.isHost) this.lobbyStatus = copy.lobbyFull
    this.renderLobby()
  }

  private renderLobby(): void {
    const copy = this.config.presenters
    const hosting = this.online.isHost && this.online.room.open
    const roster = (hosting ? this.online.roster() : this.lobbyRoster).map((seat) => ({
      name: seat.name,
      tag: [seat.id === (hosting ? this.self.id : this.lobbyHostId) ? copy.hostTag : '', seat.id === this.self.id ? copy.youTag : ''].filter(Boolean).join(' · '),
    }))
    this.hooks.screens.setLobby({
      status: this.lobbyStatus,
      code: this.online.room.open || this.online.room.status === 'connecting' ? this.online.code : null,
      roster,
      canStart: hosting && this.round.phase === 'menu',
      connected: hosting || this.online.room.status === 'connected' || this.online.room.status === 'connecting',
    })
  }

  dispose(): void {
    for (const timer of this.dropTimers.values()) clearTimeout(timer)
    this.dropTimers.clear()
    this.online.dispose()
  }
}
