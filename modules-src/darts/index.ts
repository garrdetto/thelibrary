/** Oche Darts entry: boots the shared engine, builds the pub and board, locks the camera to the thrower's eye, wires the throw gesture to a local or online session, plays every dart's flight, keeps the overlay in step, answers the chat's room requests and frees everything on pagehide. */
import * as THREE from 'three/webgpu'
import { App, HubBridge, Scores, applyEnvironment, createLighting, createPost, resolveQuality } from '../../engine'
import { config } from './config'
import { DartsSocket, roomInfo } from './net/Socket'
import { createDartKit, aimDart } from './render/Dart'
import { createPub } from './render/Pub'
import { LocalSession, OnlineSession, type Session } from './session/Session'
import { BULL_HEIGHT, OCHE_DISTANCE } from './shared/Board'
import type { Announcement, CpuLevel, DartThrow, FlightParams, GameState, MatchConfig, ModeConfig } from './shared/interfaces'
import { RELEASE, aimDirection, type SpreadLevel } from './shared/Physics'
import { currentPlayer, modeLabel, type SeatSpec } from './shared/Rules'
import { isRoomCode } from './shared/Room'
import { createSounds } from './systems/Sounds'
import { DartFlights } from './systems/DartFlights'
import { ThrowInput } from './systems/ThrowInput'
import { Overlay, playerColor } from './ui/Overlay'

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
  who: 'solo' | 'cpu' | 'local' | 'online'
  cpuLevel: CpuLevel
  spread: SpreadLevel
  names: string[]
}

function readSetup(form: HTMLFormElement): Setup {
  const data = new FormData(form)
  const mode = String(data.get('mode') ?? '501')
  let rules: ModeConfig
  if (mode === 'cricket') rules = { mode: 'cricket', scoring: data.get('cricketPoints') === 'on', roundLimit: Number(data.get('cricketRounds') ?? 20) }
  else if (mode === 'countup') rules = { mode: 'countup', rounds: Number(data.get('countupRounds') ?? 8) }
  else rules = { mode: 'x01', start: mode === '301' ? 301 : 501, doubleIn: data.get('doubleIn') === 'on', doubleOut: data.get('doubleOut') === 'on' }
  const who = String(data.get('who') ?? 'solo') as Setup['who']
  const name = String(data.get('playerName') ?? '').trim().slice(0, 16) || 'You'
  const count = Number(data.get('localCount') ?? 2)
  const names = who === 'local'
    ? Array.from({ length: count }, (_, i) => String(data.get(`name${i}`) ?? '').trim().slice(0, 16) || `Player ${i + 1}`)
    : [name]
  return {
    match: { rules, legsPerSet: Number(data.get('legs') ?? 1), setsToWin: Number(data.get('sets') ?? 1) },
    who,
    cpuLevel: String(data.get('cpuLevel') ?? 'league') as CpuLevel,
    spread: String(data.get('spread') ?? 'normal') as SpreadLevel,
    names,
  }
}

const CPU_NAMES: Record<CpuLevel, string> = { pub: 'Pub regular', league: 'League player', county: 'County player', pro: 'Touring pro' }

async function boot(): Promise<void> {
  const container = byId<HTMLDivElement>('stage')
  document.title = `${config.meta.title} · the library`

  const app = await App.create({ container, config: config.engine })
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
  })
  app.own(pub)
  app.graph.add('world', pub.root)

  const kit = createDartKit()
  app.own(kit)
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
  app.graph.add('props', hand)
  const handWorld = new THREE.Vector3(RELEASE[0], RELEASE[1] + BULL_HEIGHT, RELEASE[2])
  const placeHand = (x: number, y: number) => {
    const dir = aimDirection(x, y)
    hand.position.copy(handWorld)
    aimDart(hand, dir)
  }

  const overlay = new Overlay()
  let session: Session | null = null
  let shown: GameState | null = null
  let localIds: Set<string> | null = null
  let currentSetup: Setup | null = null
  let lastLobbyMessage = ''

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
    if (state && state.status === 'playing') {
      const color = playerColor(state, currentPlayer(state).id)
      if (color !== handColor) {
        handColor = color
        hand.removeFromParent()
        hand = kit.create(color)
        app.graph.add('props', hand)
        placeHand(input.aimX, input.aimY)
        reticleMaterial.color.set(color)
      }
    }
  }

  const overlayOpen = () => !overlay.menu.hidden || !overlay.lobby.hidden || !overlay.results.hidden

  const render = (state: GameState) => {
    shown = state
    overlay.render(state, localIds)
  }

  const announce = (list: Announcement[]) => {
    overlay.announceAll(list)
    if (list.some((item) => item.kind === 'bust')) sounds.bust()
    if (list.some((item) => item.kind === 'oneEighty' || item.kind === 'checkout' || item.kind === 'matchWon')) sounds.cheer()
  }

  const finishNote = (state: GameState): string => {
    if (session?.kind !== 'local' || !currentSetup) return ''
    const rules = state.config.rules
    const solo = state.players.length === 1
    if (solo && rules.mode === 'countup' && rules.rounds === 8) {
      if (currentSetup.spread === 'easy') return 'Easy steadiness is not ranked; play on Normal or Hard to post a record.'
      void Scores.submit(SCORE_MODULE, state.players[0].score)
      return 'Saved to the Count Up record board if you are signed in.'
    }
    return ''
  }

  const events = {
    dart(playerId: string, dart: DartThrow, flight: FlightParams, state: GameState, announcements: Announcement[]) {
      const color = playerColor(state, playerId)
      hand.visible = false
      sounds.whoosh()
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
    },
    gameOver(state: GameState, announcements: Announcement[]) {
      render(state)
      announce(announcements)
      window.setTimeout(() => {
        if (session?.state !== state && session?.state?.status !== 'finished') return
        const online = session?.kind === 'online'
        const host = online ? (session as OnlineSession).host : true
        overlay.renderResults(state, finishNote(state) || (online && !host ? 'The host can start a rematch.' : ''), host)
        overlay.show('results')
      }, 1400)
    },
    state(state: GameState) {
      if (!shown || state.version >= shown.version || state.roomId !== shown.roomId) render(state)
    },
  }

  const leaveSession = () => {
    session?.dispose()
    session = null
    shown = null
    flights.clear()
    overlay.setRoom(null)
    overlay.hud.hidden = true
  }

  const startLocal = (setup: Setup) => {
    leaveSession()
    currentSetup = setup
    const seats: SeatSpec[] = setup.names.map((name, i) => ({ id: `p${i + 1}`, name }))
    if (setup.who === 'cpu') seats.push({ id: 'cpu', name: CPU_NAMES[setup.cpuLevel], cpu: true, cpuLevel: setup.cpuLevel })
    localIds = setup.who === 'cpu' ? new Set(seats.filter((seat) => !seat.cpu).map((seat) => seat.id)) : null
    session = new LocalSession(setup.match, seats, setup.spread, events)
    overlay.show('none')
    overlay.announceAll([{ kind: 'score', text: 'Throw!', playerId: seats[0].id }])
  }

  const socket = new DartsSocket()
  let pendingRoom: ((code: string | null) => void) | null = null

  const startOnline = (action: 'create' | 'join', code: string, match: MatchConfig) => {
    leaveSession()
    currentSetup = null
    const online = new OnlineSession(socket, {
      ...events,
      room(roomCode, you, players, roomConfig) {
        localIds = new Set([you])
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
    })
    session = online
    lastLobbyMessage = ''
    if (action === 'create') socket.createRoom(match)
    else socket.joinRoom(code)
  }

  const form = byId<HTMLFormElement>('setup')
  const syncForm = () => {
    const setup = readSetup(form)
    const mode = setup.match.rules.mode
    byId('x01-options').hidden = mode !== 'x01'
    byId('cricket-options').hidden = mode !== 'cricket'
    byId('countup-options').hidden = mode !== 'countup'
    byId('cpu-options').hidden = setup.who !== 'cpu'
    byId('local-options').hidden = setup.who !== 'local'
    byId('online-options').hidden = setup.who !== 'online'
    byId('steady-row').hidden = setup.who === 'online'
    byId('name-field').hidden = setup.who === 'local'
    byId('start-btn').textContent = setup.who === 'online' ? 'Open a room' : 'Step up'
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
  form.addEventListener('change', syncForm)
  syncForm()
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
  byId('menu-btn').addEventListener('click', () => {
    byId<HTMLButtonElement>('resume-btn').hidden = !session
    overlay.show('menu')
  })
  byId('resume-btn').addEventListener('click', () => overlay.show(session && !session.state && session.kind === 'online' ? 'lobby' : 'none'))
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
    overlay.show('menu')
  })
  byId('results-again').addEventListener('click', () => {
    flights.clear()
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
  app.onFrame((dt) => {
    fitCamera()
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
