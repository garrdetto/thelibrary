/** Darts entry: boots the shared engine, builds the pub and board, locks the camera to the thrower's eye, wires the throw gesture to a local or online session, plays every dart's flight, keeps the overlay in step, answers the chat's room requests and frees everything on pagehide. */
import * as THREE from 'three/webgpu'
import { App, HubBridge, Scores, applyEnvironment, createLighting, createPost, resolveQuality } from '../../engine'
import { config } from './config'
import { DartsSocket, roomInfo } from './net/Socket'
import { isBoardStyle, type BoardStyle } from './render/BoardTexture'
import { createDartKit, aimDart } from './render/Dart'
import { createPub } from './render/Pub'
import { LocalSession, OnlineSession, type Session } from './session/Session'
import { BULL_HEIGHT, OCHE_DISTANCE, RADII } from './shared/Board'
import type { Announcement, CpuLevel, DartThrow, FlightParams, GameState, MatchConfig, TeamPlay } from './shared/interfaces'
import { RELEASE, aimDirection } from './shared/Physics'
import { TEAM_SIZE, currentPlayer, modeLabel, type SeatSpec } from './shared/Rules'
import { isRoomCode } from './shared/Room'
import { BOARD_NAMES, countsForAverages, legJustEnded, legResults, matchAverages, recordMode } from './shared/Records'
import { simulateMatch } from './shared/QuickSim'
import { createRng, randomSeed } from './shared/Rng'
import {
  ROTATION_NAMES,
  ROUND_NAMES,
  createTournament,
  entrantOf,
  isRotationMode,
  legConfig,
  legOrder,
  legsWon,
  nextTournamentMatch,
  recordTournamentLeg,
  rulesFor,
  type RotationMode,
  type Tournament,
  type TournamentRules,
} from './shared/Tournament'
import { createSounds } from './systems/Sounds'
import { DartFlights } from './systems/DartFlights'
import { ThrowInput } from './systems/ThrowInput'
import { Bracket } from './ui/Bracket'
import { TeamSetup, TournamentSetup, type TeamLineup } from './ui/Lineups'
import { Overlay, playerColor } from './ui/Overlay'
import { RecordBook } from './ui/RecordBook'

declare global {
  interface Window {
    __tlModule?: { app: App; backend: string; tier: string; steps: () => number }
    __darts?: { session: () => Session | null; state: () => GameState | null }
  }
}

const SCORE_MODULE = 'darts'

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing #${id}`)
  return node as T
}

interface Setup {
  match: MatchConfig
  who: 'solo' | 'cpu' | 'local' | 'teams' | 'tournament' | 'online'
  cpuLevel: CpuLevel
  names: string[]
  /** The formats this setup plays: the one picked, or the tournament's game rotation. */
  formats: RotationMode[]
  teamCount: number
  teamSize: number
  teamPlay: TeamPlay
  tourRules: TournamentRules
  randomDraw: boolean
}

function readSetup(form: HTMLFormElement): Setup {
  const data = new FormData(form)
  const board = data.get('board') === 'spider' ? 'spider' : 'steel'
  const who = String(data.get('who') ?? 'solo') as Setup['who']
  const tourRules: TournamentRules = {
    board,
    rotation: [0, 1, 2].map((i) => String(data.get(`tourLeg${i}`) ?? '501')).map((mode) => (isRotationMode(mode) ? mode : '501')),
    doubleIn: data.get('doubleIn') === 'on',
    doubleOut: data.get('doubleOut') === 'on',
    doubleBull: data.get('doubleBull') === 'on',
    cricketScoring: data.get('cricketPoints') === 'on',
    cricketRounds: Number(data.get('cricketRounds') ?? 20),
    countupRounds: Number(data.get('countupRounds') ?? 8),
  }
  const picked = String(data.get('mode') ?? '501')
  const formats: RotationMode[] = who === 'tournament' ? tourRules.rotation : [isRotationMode(picked) ? picked : '501']
  const name = String(data.get('playerName') ?? '').trim().slice(0, 16) || 'You'
  const count = Number(data.get('localCount') ?? 2)
  const names = who === 'local'
    ? Array.from({ length: count }, (_, i) => String(data.get(`name${i}`) ?? '').trim().slice(0, 16) || `Player ${i + 1}`)
    : [name]
  const teamPlay: TeamPlay = data.get('teamPlay') === 'regular' ? 'regular' : 'stacked'
  const tournament = who === 'tournament'
  const match: MatchConfig = { rules: rulesFor(formats[0], tourRules), legsPerSet: tournament ? 1 : Number(data.get('legs') ?? 1), setsToWin: tournament ? 1 : Number(data.get('sets') ?? 1), board }
  if (who === 'teams') match.teamPlay = teamPlay
  return {
    match,
    who,
    cpuLevel: String(data.get('cpuLevel') ?? 'league') as CpuLevel,
    names,
    formats,
    teamCount: Number(data.get('teamCount') ?? 2),
    teamSize: Number(data.get('teamSize') ?? 2) === 1 ? 1 : TEAM_SIZE,
    teamPlay,
    tourRules,
    randomDraw: data.get('randomDraw') === 'on',
  }
}

/** Seats for a team match: one seat per team taking turns on a shared score, or every player in their own seat with the teams' throws interleaved (Red 1, Blue 1, Red 2, Blue 2). */
function teamSeats(teamPlay: TeamPlay, lineups: TeamLineup[]): SeatSpec[] {
  if (teamPlay === 'stacked') return lineups.map((team, i) => ({ id: `t${i + 1}`, name: team.name, team: i, teamName: team.name, members: team.members }))
  const seats: SeatSpec[] = []
  for (let slot = 0; slot < TEAM_SIZE; slot++) {
    lineups.forEach((team, i) => {
      const member = team.members[slot]
      if (member) seats.push({ id: `t${i + 1}p${slot + 1}`, name: member.name, team: i, teamName: team.name, cpu: member.cpu, cpuLevel: member.cpuLevel })
    })
  }
  return seats
}

const TEAM_PLAY_NOTES: Record<TeamPlay, string> = {
  stacked: 'Shared score: teammates take turns on one team score, so in 501 the team checks out together and in Cricket the team closes the numbers together.',
  regular: "Own scores: each player keeps their own score on a team. The team takes the leg when any teammate checks out or closes out Cricket, and at a round limit (Count Up, Cricket) teammates' points are added up.",
}

const BOARD_KEY = 'tl-darts-board-v2'

function savedBoardStyle(): BoardStyle {
  try {
    const value = localStorage.getItem(BOARD_KEY)
    return isBoardStyle(value) ? value : 'spider'
  } catch {
    return 'spider'
  }
}

function saveBoardStyle(style: BoardStyle): void {
  try {
    localStorage.setItem(BOARD_KEY, style)
  } catch {
    /* private mode */
  }
}

const CPU_NAMES:Record<CpuLevel, string> = { pub: 'Pub regular', league: 'League player', county: 'County player', pro: 'Touring pro' }

async function boot(): Promise<void> {
  const container = byId<HTMLDivElement>('stage')
  document.title = `${config.meta.title} · the library`

  const app = await App.create({ container, config: config.engine })
  if (app.backend === 'webgpu') {
    const renderer = app.renderer as unknown as { onDeviceLost: (info: unknown) => void }
    renderer.onDeviceLost = (info) => {
      console.error('Oche Darts: graphics device lost, reloading with WebGL', info)
      const url = new URL(location.href)
      if (url.searchParams.has('webgl')) return
      url.searchParams.set('webgl', '1')
      location.replace(url.toString())
    }
  }
  const quality = resolveQuality(config.engine.quality, app.backend)
  app.setPixelRatioCap(quality.settings.pixelRatioCap)
  app.own(applyEnvironment(app.scene, config.engine.environment))
  const lighting = app.own(createLighting(config.engine.lighting, { ...quality.settings, shadows: false }))
  lighting.follow(new THREE.Vector3(0, BULL_HEIGHT, 0))
  app.graph.add('world', lighting.root)
  app.own(createPost(app, config.engine.post, quality.settings))

  const pub = createPub(app.renderer, app.scene, {
    textureSize: quality.tier === 'low' ? config.board.lowTextureSize : config.board.textureSize,
    shadows: quality.settings.shadows,
    shadowMapSize: Math.min(2048, quality.settings.shadowMapSize),
    style: savedBoardStyle(),
  })
  app.own(pub)
  app.graph.add('world', pub.root)

  const kit = createDartKit()
  kit.setStyle(pub.style)
  app.own(kit)
  void kit.loadModels()
  const flights = new DartFlights(kit, app.graph.layer('props'))
  app.own(flights)
  const sounds = createSounds()
  app.own(sounds)

  const eye = new THREE.Vector3(0, config.camera.eyeHeight, OCHE_DISTANCE + config.camera.distanceBehindOche)
  const lookAt = new THREE.Vector3(0, BULL_HEIGHT - 0.03, 0)
  const fitCamera = () => {
    const camera = app.camera
    const distance = eye.distanceTo(lookAt)
    const half = config.camera.boardHalfExtent
    const aspect = Math.max(0.3, camera.aspect)
    const vertical = aspect >= 1 ? half : half / aspect
    const fov = THREE.MathUtils.clamp((2 * Math.atan(vertical / distance) * 180) / Math.PI, config.camera.minFov, config.camera.maxFov)
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    camera.position.copy(eye)
    camera.lookAt(lookAt)
  }
  fitCamera()

  const reticleMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(config.meta.accent), transparent: true, opacity: 0.9, depthWrite: false })
  const reticleRing = new THREE.RingGeometry(0.0055, 0.0072, 40)
  const reticleDot = new THREE.CircleGeometry(0.0013, 16)
  const reticle = new THREE.Group()
  reticle.add(new THREE.Mesh(reticleRing, reticleMaterial), new THREE.Mesh(reticleDot, reticleMaterial))
  reticle.renderOrder = 5
  app.graph.add('fx', reticle)
  app.own({ dispose() { reticleMaterial.dispose(); reticleRing.dispose(); reticleDot.dispose() } })

  let handColor = config.dart.flightColors[0]
  let hand = kit.create(handColor)
  let handVersion = kit.version
  app.graph.add('props', hand)
  const handWorld = new THREE.Vector3(RELEASE[0], RELEASE[1] + BULL_HEIGHT, RELEASE[2])
  const placeHand = (x: number, y: number) => {
    const dir = aimDirection(x, y)
    hand.position.copy(handWorld)
    aimDart(hand, dir)
  }

  const overlay = new Overlay()
  const book = new RecordBook(byId('avg-panel'))
  app.own(book)
  let session: Session | null = null
  let shown: GameState | null = null
  let localIds: Set<string> | null = null
  let currentSetup: Setup | null = null
  let countUpKey = ''
  let lastLobbyMessage = ''
  let tour: Tournament | null = null
  let tourMatchId: string | null = null
  const tourRng = createRng(randomSeed())
  const bracket = new Bracket()
  const teamSetup = new TeamSetup(byId('team-list'))
  const tourSetup = new TournamentSetup(byId('tour-list'))

  const input = new ThrowInput(container, app.camera, {
    aim(x, y) {
      reticle.position.set(x, y + BULL_HEIGHT, 0.0025)
      placeHand(x, y)
    },
    power(speed) {
      overlay.setPower(speed)
    },
    release(intent) {
      if (!session?.canThrow()) return
      sounds.unlock()
      session.throw(intent)
    },
  })
  app.own(input)
  input.setAim(input.aimX, input.aimY)

  const refreshHand = () => {
    const state = session?.state ?? null
    const can = !!session?.canThrow() && !overlayOpen()
    input.enabled = can
    reticle.visible = can
    hand.visible = can && !flights.inFlight
    const color = state && state.status === 'playing' ? playerColor(state, currentPlayer(state).id) : handColor
    if (color !== handColor || handVersion !== kit.version) {
      handColor = color
      handVersion = kit.version
      const visible = hand.visible
      hand.removeFromParent()
      hand = kit.create(color)
      hand.visible = visible
      app.graph.add('props', hand)
      placeHand(input.aimX, input.aimY)
      reticleMaterial.color.set(color)
    }
  }

  const overlayOpen = () => !overlay.menu.hidden || !overlay.lobby.hidden || !overlay.results.hidden || !overlay.pause.hidden || !overlay.bracket.hidden

  /** Online rooms save their own results; at this screen a match counts when a person throws as Player 1 and it isn't a team match. */
  const ranked = () => {
    if (session?.kind === 'online') return true
    const state = session?.state ?? null
    return !!state && !state.config.teamPlay && state.players.some((player) => player.id === 'p1' && !player.cpu)
  }
  const memberName = (playerId: string): string | null => {
    if (session?.kind === 'online') {
      const seat = (session as OnlineSession).players.find((player) => player.id === playerId)
      return seat?.member ? seat.name : null
    }
    return playerId === 'p1' && book.signedIn ? book.username : null
  }
  const renderAverages = (state: GameState | null = shown) => {
    if (state) {
      const members = state.players.map((player) => memberName(player.id)).filter((name): name is string => !!name)
      book.prepareAverages(state, members)
    }
    book.renderHud(state, (id) => (state ? playerColor(state, id) : ''), memberName, !!state && ranked() && countsForAverages(state))
  }
  book.onChange = () => renderAverages()

  const render = (state: GameState) => {
    shown = state
    overlay.render(state, localIds)
    pub.setDisplay(String(currentPlayer(state).score))
    renderAverages(state)
  }

  /** A local leg that just ended goes to the signed-in player's record book (Player 1 at this screen); online rooms save their own. */
  const recordLeg = (state: GameState) => {
    if (session?.kind !== 'local' || !ranked() || !legJustEnded(state)) return
    book.saveLegs(state, legResults(state), 'p1')
  }

  const announce = (list: Announcement[]) => {
    overlay.announceAll(list)
    if (list.some((item) => item.kind === 'bust')) sounds.bust()
    if (list.some((item) => item.kind === 'oneEighty' || item.kind === 'checkout' || item.kind === 'matchWon')) sounds.cheer()
  }

  const rankedCountUp = (state: GameState): boolean =>
    session?.kind === 'local' && !!currentSetup && ranked() && state.players.length === 1 && state.config.rules.mode === 'countup' && state.config.rules.rounds === 8

  const countUpRun = (): string => (countUpKey ||= `countup-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  const finishNote = (state: GameState): string => {
    const mode = recordMode(state.config)
    const where = `the ${BOARD_NAMES[state.config.board === 'spider' ? 'spider' : 'steel']} record book`
    if (session?.kind === 'online') return mode ? `Signed-in players' legs and averages are saved to ${where}.` : ''
    if (!currentSetup) return ''
    const rules = state.config.rules
    const notes: string[] = []
    if (rankedCountUp(state)) void Scores.submit(SCORE_MODULE, state.players[0].score, { key: countUpRun() })
    countUpKey = ''
    if (state.config.teamPlay) notes.push('Team matches are not saved to the record book.')
    else if (!ranked()) return ''
    else if (mode && book.signedIn) {
      if (countsForAverages(state)) book.saveAverage(state, matchAverages(state).find((average) => average.playerId === 'p1'))
      notes.push(`Saved to ${where}${countsForAverages(state) && rules.mode !== 'countup' ? ', average included' : ''}.`)
    } else if (mode) notes.push('Sign in to the library to save your legs to the record book.')
    return notes.join(' ')
  }

  const events = {
    dart(playerId: string, dart: DartThrow, flight: FlightParams, state: GameState, announcements: Announcement[]) {
      const color = playerColor(state, playerId)
      hand.visible = false
      sounds.whoosh()
      recordLeg(state)
      if (state.status === 'playing' && rankedCountUp(state)) Scores.progress(SCORE_MODULE, state.players[0].score, { key: countUpRun() })
      flights.throw(flight, color, () => {
        sounds.thunk(dart.multiplier === 0)
        render(state)
        announce(announcements)
      })
    },
    turnSwitch(state: GameState, announcements: Announcement[]) {
      flights.clear()
      input.interrupt()
      render(state)
      announce(announcements)
      if (!overlay.results.hidden && state.status === 'playing') overlay.show('none')
      if (!overlay.pause.hidden && state.version === 0) closePause()
    },
    gameOver(state: GameState, announcements: Announcement[]) {
      render(state)
      announce(announcements)
      const note = finishNote(state)
      book.invalidateAverages()
      if (session?.kind === 'online') book.refreshPage(state.config.board === 'spider' ? 'spider' : 'steel', recordMode(state.config), 2500)
      if (tour && tourMatchId && session?.kind === 'local') {
        const matchId = tourMatchId
        window.setTimeout(() => {
          if (session?.state !== state || tourMatchId !== matchId) return
          tourMatchId = null
          const result = state.winnerId ? recordTour(matchId, state.winnerId) : ''
          leaveSession()
          showBracket([result, note].filter(Boolean).join(' '))
        }, 1800)
        return
      }
      window.setTimeout(() => {
        if (session?.state !== state && session?.state?.status !== 'finished') return
        const online = session?.kind === 'online'
        const host = online ? (session as OnlineSession).host : true
        overlay.renderResults(state, [note, online && !host ? 'The host can start a rematch.' : ''].filter(Boolean).join(' '), host)
        overlay.show('results')
      }, 1400)
    },
    state(state: GameState) {
      if (!shown || state.version >= shown.version || state.roomId !== shown.roomId) render(state)
    },
  }

  const leaveSession = () => {
    countUpKey = ''
    session?.dispose()
    session = null
    shown = null
    flights.clear()
    overlay.setRoom(null)
    overlay.hud.hidden = true
    book.renderHud(null, () => '', () => null, false)
  }

  const launchLocal = (match: MatchConfig, seats: SeatSpec[], opening: string) => {
    leaveSession()
    localIds = new Set(seats.filter((seat) => !seat.cpu && !seat.members?.every((member) => member.cpu)).map((seat) => seat.id))
    session = new LocalSession(match, seats, events)
    overlay.show('none')
    overlay.announceAll([{ kind: 'score', text: opening, playerId: seats[0].id }])
  }

  const startLocal = (setup: Setup) => {
    currentSetup = setup
    tour = null
    tourMatchId = null
    if (setup.who === 'tournament') {
      tour = createTournament(setup.tourRules, tourSetup.read(), setup.randomDraw ? tourRng : undefined)
      leaveSession()
      showBracket('The draw is made. Good darts!')
      return
    }
    if (setup.who === 'teams') {
      launchLocal(setup.match, teamSeats(setup.teamPlay, teamSetup.read(setup.teamCount, setup.teamSize)), 'Throw!')
      return
    }
    const seats: SeatSpec[] = setup.names.map((name, i) => ({ id: `p${i + 1}`, name }))
    if (setup.who === 'cpu') seats.push({ id: 'cpu', name: CPU_NAMES[setup.cpuLevel], cpu: true, cpuLevel: setup.cpuLevel })
    launchLocal(setup.match, seats, 'Throw!')
  }

  const showBracket = (note: string) => {
    if (!tour) return
    bracket.render(tour, note)
    overlay.show('bracket')
    const focus = [bracket.play, bracket.watch, bracket.quit].find((button) => !button.hidden)
    focus?.focus()
  }

  const seatOf = (id: string): SeatSpec => {
    const entrant = tour ? entrantOf(tour, id) : null
    return entrant ? { id: entrant.id, name: entrant.name, cpu: entrant.cpu, cpuLevel: entrant.cpuLevel } : { id, name: id }
  }

  /** Records a leg winner in the bracket and says what it meant: a leg, a match, or the whole tournament. */
  const recordTour = (matchId: string, winnerId: string): string => {
    if (!tour) return ''
    tour = recordTournamentLeg(tour, matchId, winnerId)
    const match = tour.matches.find((item) => item.id === matchId)
    const winner = entrantOf(tour, winnerId)
    if (!match || !winner) return ''
    const loserId = match.a === winnerId ? match.b : match.a
    const score = `${legsWon(match, winnerId)}–${legsWon(match, loserId)}`
    if (tour.championId === winnerId) return `${winner.name} wins the final ${score} and the tournament!`
    if (match.winnerId) return `${winner.name} wins the match ${score} and goes through to the ${ROUND_NAMES[match.round + 1]}.`
    const leg = match.legs[match.legs.length - 1]
    return `${winner.name} takes leg ${match.legs.length} (${ROTATION_NAMES[leg.mode]}).`
  }

  const startTourLeg = () => {
    const match = tour ? nextTournamentMatch(tour) : null
    if (!tour || !match) return
    tourMatchId = match.id
    launchLocal(legConfig(tour, match), legOrder(match).map(seatOf), `${ROUND_NAMES[match.round]} · leg ${match.legs.length + 1}`)
  }

  /** Simulates the next match (all computers) leg by leg; returns what happened. */
  const simulateTourMatch = (): string => {
    const match = tour ? nextTournamentMatch(tour) : null
    if (!tour || !match) return ''
    let result = ''
    for (let guard = 0; guard < 5 && tour; guard++) {
      const current = tour.matches.find((item) => item.id === match.id)
      if (!current || current.winnerId) break
      const state = simulateMatch(legConfig(tour, current), legOrder(current).map(seatOf), tourRng)
      if (!state.winnerId) break
      result = recordTour(current.id, state.winnerId)
    }
    return result
  }

  const computerMatch = (): boolean => {
    const match = tour ? nextTournamentMatch(tour) : null
    if (!tour || !match) return false
    return !!entrantOf(tour, match.a)?.cpu && !!entrantOf(tour, match.b)?.cpu
  }

  bracket.play.addEventListener('click', startTourLeg)
  bracket.watch.addEventListener('click', startTourLeg)
  bracket.sim.addEventListener('click', () => showBracket(simulateTourMatch()))
  bracket.simAll.addEventListener('click', () => {
    const results: string[] = []
    while (computerMatch()) results.push(simulateTourMatch())
    showBracket(results.slice(-3).join(' '))
  })
  bracket.quit.addEventListener('click', () => quitToMenu())

  const socket = new DartsSocket()
  let pendingRoom: ((code: string | null) => void) | null = null

  const startOnline = (action: 'create' | 'join', code: string, match: MatchConfig) => {
    leaveSession()
    currentSetup = null
    tour = null
    tourMatchId = null
    const online = new OnlineSession(socket, {
      ...events,
      room(roomCode, you, players, roomConfig) {
        localIds = new Set([you])
        if (roomConfig.board && roomConfig.board !== pub.style) showBoard(roomConfig.board)
        overlay.setRoom(roomCode)
        if (pendingRoom) {
          pendingRoom(roomCode)
          pendingRoom = null
        }
        const state = online.state
        const lobbyNote = players.length < 2 ? 'Waiting for someone to join. Share the code or invite from the chat.' : online.host ? 'Start when everyone is here.' : 'Waiting for the host to start.'
        if (!state) {
          overlay.renderLobby(roomCode, roomConfig.rules ? modeLabel(roomConfig) : '', players, you, online.host, lobbyNote)
          overlay.lobbyError(lastLobbyMessage)
          overlay.show('lobby')
        } else if (state.status !== 'finished' && !overlay.lobby.hidden) {
          overlay.show('none')
          flights.clear()
        } else if (state.status === 'playing' && !overlay.results.hidden) {
          overlay.show('none')
          flights.clear()
        }
      },
      error(message) {
        lastLobbyMessage = message
        if (!overlay.lobby.hidden) overlay.lobbyError(message)
        else if (!overlay.menu.hidden) byId('setup-error').textContent = message
        else overlay.announceAll([{ kind: 'bust', text: message.length > 28 ? 'Connection problem' : message, playerId: '' }])
        if (pendingRoom) {
          pendingRoom(null)
          pendingRoom = null
        }
        if (socket.status === 'closed' && !socket.code) overlay.show('menu')
      },
      restartVotes(requested, needed, by) {
        const state = online.state
        if (by && state && requested.length) {
          const name = by === socket.you ? 'You' : state.players.find((player) => player.id === by)?.name ?? 'A player'
          overlay.announceAll([{ kind: 'score', text: `${name} asked to restart (${requested.length}/${needed})`, playerId: by }])
        }
        refreshPause()
      },
    })
    session = online
    lastLobbyMessage = ''
    if (action === 'create') socket.createRoom(match)
    else socket.joinRoom(code)
  }

  const form = byId<HTMLFormElement>('setup')
  const pausePanel = overlay.pause
  const boardRadios = () => [...document.querySelectorAll<HTMLInputElement>('input[name="board"], input[name="pauseBoard"]')]
  const markBoard = (style: BoardStyle) => {
    for (const radio of boardRadios()) radio.checked = radio.value === style
  }
  markBoard(pub.style)
  let boardTimer = 0
  const showBoard = (style: BoardStyle) => {
    markBoard(style)
    kit.setStyle(style)
    window.clearTimeout(boardTimer)
    boardTimer = window.setTimeout(() => {
      boardTimer = 0
      if (style !== pub.style) pub.setStyle(style)
    }, 30)
  }
  const chooseBoard = (style: BoardStyle) => {
    markBoard(style)
    saveBoardStyle(style)
    boardDefaults(style)
    showBook()
    kit.setStyle(style)
    window.clearTimeout(boardTimer)
    boardTimer = window.setTimeout(() => {
      boardTimer = 0
      if (style !== pub.style) pub.setStyle(style)
    }, 30)
  }
  for (const radio of boardRadios()) {
    radio.addEventListener('change', () => {
      if (radio.checked && isBoardStyle(radio.value)) chooseBoard(radio.value)
    })
  }

  const refreshPause = () => {
    const current = session
    const online = current?.kind === 'online'
    const restart = byId<HTMLButtonElement>('pause-restart')
    const note = byId('pause-note')
    if (online) {
      const live = current as OnlineSession
      const voted = live.restartVotes.includes(socket.you)
      const others = live.restartVotes.filter((id) => id !== socket.you).length
      restart.textContent = voted ? 'Restart requested…' : others ? 'Agree to restart' : 'Request Restart'
      restart.disabled = voted || !live.state || live.state.status === 'finished'
      note.textContent = 'Online matches keep going while this menu is open. A restart needs everyone at the oche to agree.'
    } else {
      restart.textContent = 'Restart'
      restart.disabled = !current
      note.textContent = 'The match is on hold until you resume.'
    }
  }
  const openPause = () => {
    if (!session || overlayOpen()) return
    input.interrupt()
    if (session instanceof LocalSession) session.pause()
    byId('pause-error').textContent = ''
    refreshPause()
    overlay.show('pause')
    byId<HTMLButtonElement>('pause-resume').focus()
  }
  function closePause(): void {
    overlay.show('none')
    if (session instanceof LocalSession) session.resume()
  }
  const quitToMenu = () => {
    tour = null
    tourMatchId = null
    leaveSession()
    byId<HTMLButtonElement>('resume-btn').hidden = true
    showBook(true)
    overlay.show('menu')
  }

  const syncForm = () => {
    const setup = readSetup(form)
    const formats = setup.formats
    const tournament = setup.who === 'tournament'
    byId('format-title').textContent = tournament ? 'Format options' : 'Format'
    byId('format-seg').hidden = tournament
    byId('length-options').hidden = tournament
    byId('x01-options').hidden = !formats.some((mode) => mode === '501' || mode === '301')
    byId('double-bull-option').hidden = new FormData(form).get('board') !== 'spider'
    byId('cricket-options').hidden = !formats.includes('cricket')
    byId('countup-options').hidden = !formats.includes('countup')
    byId('cpu-options').hidden = setup.who !== 'cpu'
    byId('local-options').hidden = setup.who !== 'local'
    byId('team-options').hidden = setup.who !== 'teams'
    byId('tournament-options').hidden = !tournament
    byId('online-options').hidden = setup.who !== 'online'
    byId('name-row').hidden = setup.who === 'local' || setup.who === 'teams' || tournament
    byId('team-play-note').textContent = TEAM_PLAY_NOTES[setup.teamPlay]
    if (setup.who === 'teams') teamSetup.render(setup.teamCount, setup.teamSize)
    if (tournament) tourSetup.render()
    byId('start-btn').textContent = setup.who === 'online' ? 'Open a room' : tournament ? 'Make the draw' : 'Step up'
    const names = byId('names')
    const count = Number((form.elements.namedItem('localCount') as HTMLSelectElement).value)
    while (names.children.length < count) {
      const i = names.children.length
      const field = document.createElement('label')
      field.className = 'd-field'
      field.textContent = `Player ${i + 1}`
      const inputEl = document.createElement('input')
      inputEl.type = 'text'
      inputEl.name = `name${i}`
      inputEl.maxLength = 16
      inputEl.placeholder = `Player ${i + 1}`
      field.append(inputEl)
      names.append(field)
    }
    while (names.children.length > count) names.lastElementChild?.remove()
  }
  const boardDefaults = (style: BoardStyle) => {
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement
    field('doubleOut').checked = style === 'steel'
    field('doubleBull').checked = true
  }
  boardDefaults(pub.style)
  const showBook = (fresh = false) => {
    const setup = readSetup(form)
    void book.show(setup.match.board ?? 'steel', recordMode(setup.match), fresh)
  }
  form.addEventListener('change', () => {
    syncForm()
    showBook()
  })
  syncForm()
  showBook()
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    byId('setup-error').textContent = ''
    const setup = readSetup(form)
    if (setup.who === 'online') startOnline('create', '', setup.match)
    else startLocal(setup)
  })
  byId('join-btn').addEventListener('click', async () => {
    const codeInput = form.elements.namedItem('code') as HTMLInputElement
    const code = codeInput.value.trim().toUpperCase()
    const error = byId('setup-error')
    if (!isRoomCode(code)) {
      error.textContent = 'Room codes are six letters and numbers.'
      return
    }
    error.textContent = 'Checking the room…'
    const info = await roomInfo(code)
    if (!info || !info.open) error.textContent = 'No room with that code. Check it with your friend.'
    else if (info.full) error.textContent = 'That room is full.'
    else {
      error.textContent = ''
      startOnline('join', code, readSetup(form).match)
    }
  })
  byId('menu-btn').addEventListener('click', openPause)
  byId('pause-resume').addEventListener('click', closePause)
  byId('pause-restart').addEventListener('click', () => {
    const current = session
    if (!current) return
    if (current.kind === 'online') {
      ;(current as OnlineSession).requestRestart()
      byId('pause-error').textContent = 'Restart requested. It starts over once everyone agrees.'
      byId<HTMLButtonElement>('pause-restart').disabled = true
      return
    }
    flights.clear()
    countUpKey = ''
    current.rematch()
    overlay.show('none')
    overlay.announceAll([{ kind: 'score', text: 'Restarted', playerId: '' }])
  })
  byId('pause-setup').addEventListener('click', () => {
    const current = session
    byId<HTMLButtonElement>('resume-btn').hidden = !current || current.kind === 'online'
    if (current?.kind === 'online') leaveSession()
    showBook(true)
    overlay.show('menu')
  })
  byId('pause-quit').addEventListener('click', quitToMenu)
  pausePanel.addEventListener('click', (event) => {
    if (event.target === pausePanel) closePause()
  })
  addEventListener(
    'keydown',
    (event) => {
      if (event.code !== 'Escape' && event.code !== 'KeyP') return
      if ((event.target as HTMLElement | null)?.closest?.('input[type="text"], select, textarea')) return
      if (!pausePanel.hidden) {
        event.preventDefault()
        event.stopPropagation()
        closePause()
        return
      }
      if (input.holding || overlayOpen() || !session?.state) return
      event.preventDefault()
      event.stopPropagation()
      openPause()
    },
    true,
  )
  byId('resume-btn').addEventListener('click', () => {
    overlay.show(session && !session.state && session.kind === 'online' ? 'lobby' : 'none')
    if (session instanceof LocalSession) session.resume()
  })
  byId('lobby-leave').addEventListener('click', () => {
    leaveSession()
    overlay.show('menu')
  })
  byId('lobby-start').addEventListener('click', () => (session as OnlineSession | null)?.start?.())
  byId('copy-btn').addEventListener('click', () => {
    void navigator.clipboard?.writeText(socket.code).then(() => overlay.lobbyError('Code copied.')).catch(() => overlay.lobbyError(`Code: ${socket.code}`))
  })
  byId('results-menu').addEventListener('click', () => {
    if (session?.kind === 'online') leaveSession()
    byId<HTMLButtonElement>('resume-btn').hidden = !session
    showBook(true)
    overlay.show('menu')
  })
  byId('results-again').addEventListener('click', () => {
    flights.clear()
    countUpKey = ''
    session?.rematch()
    if (session?.kind === 'local') overlay.show('none')
  })

  HubBridge.on('tl-host', () => {
    if (session?.kind === 'online' && socket.code) {
      HubBridge.post({ type: 'tl-room', code: socket.code })
      return
    }
    pendingRoom = (code) => {
      if (code) HubBridge.post({ type: 'tl-room', code })
    }
    startOnline('create', '', readSetup(form).match)
  })

  const roomParam = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? ''
  if (isRoomCode(roomParam)) startOnline('join', roomParam, readSetup(form).match)

  let steps = 0
  app.onFixed(() => {
    steps++
  })
  const boardEdge = new THREE.Vector3()
  const boardTop = new THREE.Vector3()
  const stageSize = { width: container.clientWidth, height: container.clientHeight }
  const hudSize = { width: overlay.hud.clientWidth, height: overlay.hud.clientHeight }
  let meterKey = ''
  const sizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const target = entry.target === container ? stageSize : hudSize
      target.width = entry.contentRect.width
      target.height = entry.contentRect.height
    }
    meterKey = ''
  })
  sizes.observe(container)
  sizes.observe(overlay.hud)
  app.own({ dispose: () => sizes.disconnect() })
  const placeMeter = () => {
    const rect = stageSize
    if (!rect.width || !rect.height) return
    if (!hudSize.width) {
      hudSize.width = overlay.hud.clientWidth
      hudSize.height = overlay.hud.clientHeight
    }
    const key = `${rect.width}:${rect.height}:${hudSize.width}:${hudSize.height}:${app.camera.fov}`
    if (key === meterKey) return
    meterKey = key
    const radius = RADII.board / 1000
    boardEdge.set(radius, BULL_HEIGHT, 0).project(app.camera)
    boardTop.set(0, BULL_HEIGHT + radius, 0).project(app.camera)
    const x = ((boardEdge.x + 1) / 2) * rect.width
    const y = ((1 - boardEdge.y) / 2) * rect.height
    const top = ((1 - boardTop.y) / 2) * rect.height
    overlay.placeMeter(x, y, (y - top) * 2, hudSize.width, hudSize.height)
  }
  app.onFrame((dt) => {
    fitCamera()
    placeMeter()
    flights.update(Math.min(dt, 0.1))
    refreshHand()
  })

  await app.prewarm()
  app.start()
  window.__tlModule = { app, backend: app.backend, tier: quality.tier, steps: () => steps }
  window.__darts = { session: () => session, state: () => session?.state ?? null }
  addEventListener('pagehide', () => {
    session?.dispose()
    app.dispose()
  }, { once: true })
}

boot().catch((error: unknown) => {
  const stage = document.getElementById('stage')
  if (stage) stage.textContent = 'This learning module could not start on this device.'
  console.error(error)
})
