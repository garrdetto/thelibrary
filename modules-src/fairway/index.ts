/** Fairway Nine entry: boots the shared engine, builds the sky, balls, tracer and aim guide, wires input, HUD, screens and the session, steps the systems each fixed step and moves meshes each frame; everything is freed on pagehide. */
import * as THREE from 'three/webgpu'
import { App, HubBridge, Hud, Input, applyEnvironment, createLighting, createPost, resolveQuality } from '../../engine'
import { config, type Action } from './config'
import { createAimGuide } from './models/AimGuide'
import { createBall } from './models/Ball'
import { createSky } from './models/Sky'
import { createTracer } from './models/Tracer'
import { hudModel, boardCopy } from './session/Presenters'
import { Play, type InputFrame } from './session/Play'
import { courseFor } from './systems/Course'
import { currentCourseHole, playerById } from './systems/Match'
import { addScaled, headingVector, lerp, type Vec3 } from './systems/Vector'
import { createGauge } from './ui/Gauge'
import { createHudView } from './ui/HudView'
import { createScreens } from './ui/Screens'
import { createGrassField } from './view/GrassField'
import { createHoleScene, type HoleScene } from './view/HoleScene'

declare global {
  interface Window {
    __tlModule?: { app: App; backend: string; tier: string; steps: () => number }
  }
}

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? localStorage : sessionStorage
  } catch {
    return null
  }
}

/** The locked player name: the library username from ?name=, or a fixed Guest-xxxxx kept for this browser. */
function resolveSeat(): { id: string; name: string; signedIn: boolean } {
  const room = config.room
  const params = new URLSearchParams(location.search)
  const fromHub = params.get('name')?.trim().slice(0, 24)
  const local = storage('local')
  let guest = local?.getItem(room.guestNameKey) ?? ''
  if (!new RegExp(`^${room.guestPrefix}\\d{${room.guestDigits}}$`).test(guest)) {
    guest = `${room.guestPrefix}${String(Math.floor(Math.random() * 10 ** room.guestDigits)).padStart(room.guestDigits, '0')}`
    local?.setItem(room.guestNameKey, guest)
  }
  const session = storage('session')
  let id = session?.getItem(room.playerIdKey) ?? ''
  if (!/^[a-z0-9]{12,40}$/.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 20)
    session?.setItem(room.playerIdKey, id)
  }
  return { id, name: fromHub || guest, signedIn: !!fromHub }
}

async function boot(): Promise<void> {
  const container = document.getElementById('stage')
  if (!container) throw new Error('Missing #stage')
  document.title = `${config.meta.title} · the library`
  document.documentElement.style.setProperty('--module-accent', config.meta.accent)

  const app = await App.create({ container, config: config.engine })
  const quality = resolveQuality(config.engine.quality, app.backend)
  app.setPixelRatioCap(quality.settings.pixelRatioCap)
  app.own(applyEnvironment(app.scene, config.engine.environment))
  const lighting = app.own(createLighting(config.engine.lighting, quality.settings))
  app.graph.add('world', lighting.root)
  app.own(createPost(app, config.engine.post, quality.settings))

  const input = app.own(new Input<Action>(container, config.bindings, config.engine.input))
  const hud = new Hud(config.engine.hud, config.meta.accent)
  const sky = app.graph.add('world', createSky(config.sky))
  const tracer = createTracer(config.tracer)
  app.graph.add('fx', tracer.line)
  const aimGuide = createAimGuide(config.aimGuide)
  app.graph.add('fx', aimGuide.mesh)
  const grass = createGrassField(config.grass, quality.tier)
  app.graph.add('world', grass.model.mesh)

  let holeScene: HoleScene | null = null
  const balls = new Map<string, THREE.Mesh>()
  const ballMesh = (id: string): THREE.Mesh => {
    let mesh = balls.get(id)
    if (!mesh) {
      mesh = app.graph.add('props', createBall({ ...config.ball3d, radius: config.ball.radiusM }))
      balls.set(id, mesh)
    }
    return mesh
  }

  const seat = resolveSeat()
  let play: Play | null = null
  const screens = createScreens(
    {
      chooseMode: (mode) => {
        if (!play) return
        if (mode === 'online') play.openLobby()
        else play.startLocal(mode)
      },
      host: () => void play?.hostRoom(),
      join: (code) => void play?.joinRoom(code),
      startMatch: () => play?.startOnline(),
      leaveLobby: () => play?.leaveToMenu(),
      continueRound: () => {
        if (!play) return
        if (play.round.phase === 'scorecard') play.dispatch({ type: 'continue' })
        else screens.show(null)
      },
      quitToMenu: () => play?.leaveToMenu(),
      resume: () => screens.show(null),
      showScorecard: () => play?.showScorecardFromPause(),
    },
    boardCopy(config),
  )
  app.own(screens)
  const hudView = app.own(
    createHudView(hud, config.hud, config.meta.title, {
      club: (delta) => play?.changeClub(delta),
      aim: (direction) => play?.nudgeAim(direction),
      spin: (delta) => play?.changeSpin(delta),
      menu: () => play?.togglePause(),
    }),
  )
  hudView.setVisible(false)
  const gauge = app.own(createGauge(config.gauge, config.meter, config.hud.readout))

  play = app.own(
    new Play(config, { id: seat.id, name: seat.name }, seat.signedIn, {
      screens,
      toast: (message) => hud.toast(message),
      notifyBoard: (board) => {
        HubBridge.post({ type: 'tl-fairway', board })
        screens.refreshBoard(board)
      },
      showHole: (holeIndex, tee, target) => {
        holeScene?.dispose()
        holeScene = createHoleScene(courseFor(holeIndex), tee, target, config, quality.tier)
        grass.setCourse(courseFor(holeIndex))
        grass.follow(tee[0], tee[2])
        app.graph.add('world', holeScene.root)
        for (const mesh of balls.values()) mesh.visible = false
        tracer.clear()
      },
      celebrate: (active) => holeScene?.flag.setExcitement(active ? config.flag.celebrationBoost : 1),
    }),
  )
  app.own({ dispose: () => holeScene?.dispose() })

  let steps = 0
  const frame: InputFrame = { swing: false, menu: false, aim: 0, clubUp: false, clubDown: false, spinUp: false, spinDown: false, orbiting: false, orbitDx: 0, orbitDy: 0 }
  app.onFixed((dt) => {
    input.update()
    frame.swing = input.pressed('swing')
    frame.menu = input.pressed('menu')
    frame.aim = input.axis('aimRight', 'aimLeft')
    frame.clubUp = input.pressed('clubUp')
    frame.clubDown = input.pressed('clubDown')
    frame.spinUp = input.pressed('spinUp')
    frame.spinDown = input.pressed('spinDown')
    frame.orbiting = input.isDown('orbit')
    frame.orbitDx = input.pointer.dx
    frame.orbitDy = input.pointer.dy
    play?.step(dt, frame)
    steps++
  })

  const lookAt = new THREE.Vector3()
  const focus = new THREE.Vector3()
  app.onFrame((_, alpha) => {
    if (!play) return
    const pose = play.camera.pose
    const before = play.previousPose
    const position = lerp(before.position, pose.position, alpha)
    const target = lerp(before.lookAt, pose.lookAt, alpha)
    app.camera.position.set(position[0], position[1], position[2])
    lookAt.set(target[0], target[1], target[2])
    app.camera.lookAt(lookAt)
    sky.position.copy(app.camera.position)

    const inRound = play.round.phase !== 'menu'
    hudView.setVisible(inRound && screens.current() === null)
    const focusId = play.focusPlayer()
    let focusBall: Vec3 | null = null
    for (const view of play.ballViews()) {
      const mesh = ballMesh(view.id)
      const at = lerp(view.previous, view.current, alpha)
      mesh.position.set(at[0], at[1], at[2])
      mesh.visible = inRound && view.visible
      if (view.id === focusId) focusBall = at
    }
    for (const [id, mesh] of balls) if (!play.shown?.players.some((player) => player.id === id)) mesh.visible = false

    const flight = play.flightShot()
    if (flight) tracer.show(flight.shot.samples, flight.step + 1, 1)
    else tracer.clear()

    const shown = play.shown
    if (shown && focusBall && play.showsAim()) {
      const course = courseFor(currentCourseHole(shown))
      const heading = headingVector(play.aimYaw)
      const points: [number, number, number][] = []
      for (let dot = 1; dot <= config.aimGuide.dots; dot++) {
        const spot = addScaled(focusBall, heading, dot * config.aimGuide.spacing)
        points.push([spot[0], course.heightAt(spot[0], spot[2]) + config.aimGuide.lift, spot[2]])
      }
      aimGuide.place(points)
      aimGuide.mesh.visible = true
    } else {
      aimGuide.mesh.visible = false
    }

    const followed = focusBall ?? target
    grass.follow(followed[0], followed[2])
    focus.set(followed[0], followed[1], followed[2])
    const ahead = headingVector(Math.atan2(target[0] - position[0], target[2] - position[2]))
    focus.x += ahead[0] * config.shadowFollowLead
    focus.z += ahead[2] * config.shadowFollowLead
    lighting.follow(focus)

    if (shown && focusId && focusBall) {
      const player = playerById(shown, focusId)
      if (player) {
        const cameraYaw = Math.atan2(target[0] - position[0], target[2] - position[2])
        const club = focusId === play.localId ? play.club : null
        hudView.update(hudModel(config, shown, player, focusBall, club, player.lie, focusId === play.localId ? play.spin : 0, cameraYaw))
      }
    }
    gauge.draw(screens.current() === null ? play.meter() : null)
  })

  app.start()
  window.__tlModule = { app, backend: app.backend, tier: quality.tier, steps: () => steps }
  addEventListener('pagehide', () => app.dispose(), { once: true })
}

boot().catch((error: unknown) => {
  const stage = document.getElementById('stage')
  if (stage) stage.textContent = config.hud.startError
  console.error(error)
})
