/** Demo Derby entry: boots the shared engine, builds the fair arena, runs the garage preview, then the heat (player + AI field) with contact damage, the HUD, results and the board; freed on pagehide. */
import * as THREE from 'three/webgpu'
import type RAPIER from '@dimforge/rapier3d-compat'
import { App, Hud, Input, PhysicsWorld, Scores, applyEnvironment, createLighting, createPost, resolveQuality } from '../../engine'
import { aiLevelById, bodyById, config, type Action } from './config'
import { createArena } from './models/Arena'
import { createParticles } from './models/Particles'
import { createSky } from './models/Sky'
import { createBrain, driveAi, type AiBrain } from './systems/Ai'
import { createChaseCamera } from './systems/Camera'
import { Heat } from './systems/Heat'
import { loadLook, opponentLook, saveLook, type CarLook } from './systems/Look'
import { Vehicle } from './systems/Vehicle'
import { createGarage, type HeatSettings, type ResultRow } from './ui/Garage'

declare global {
  interface Window {
    __tlModule?: { app: App; backend: string; tier: string; steps: () => number }
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing #${id}`)
  return element as T
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function ordinal(n: number): string {
  const rem = n % 100
  if (rem >= 11 && rem <= 13) return `${n}th`
  const last = n % 10
  return `${n}${last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'}`
}

/** Renders the sky dome over a dirt disc into a PMREM environment so paint, chrome and glass reflect the fair's sky. */
function bakeEnvironment(app: App): void {
  try {
    const envScene = new THREE.Scene()
    envScene.add(createSky({ ...config.sky, radius: 90 }))
    const ground = new THREE.Mesh(new THREE.CircleGeometry(85, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(config.arena.groundColor) }))
    ground.position.y = -1.5
    envScene.add(ground)
    const pmrem = new THREE.PMREMGenerator(app.renderer)
    const target = pmrem.fromScene(envScene, 0, 0.1, 100)
    const scene = app.scene as THREE.Scene & { environmentIntensity?: number }
    scene.environment = target.texture
    scene.environmentIntensity = 0.55
    app.own({
      dispose() {
        scene.environment = null
        target.dispose()
        pmrem.dispose()
        ground.geometry.dispose()
        ground.material.dispose()
      },
    })
  } catch (error) {
    console.warn('[demoderby] environment bake failed', error)
  }
}

async function boot(): Promise<void> {
  const container = byId<HTMLElement>('stage')
  document.title = `${config.meta.title} · the library`
  document.documentElement.style.setProperty('--module-accent', config.meta.accent)

  const app = await App.create({ container, config: config.engine })
  const quality = resolveQuality(config.engine.quality, app.backend)
  app.setPixelRatioCap(quality.settings.pixelRatioCap)
  app.own(applyEnvironment(app.scene, config.engine.environment))
  const lighting = app.own(createLighting(config.engine.lighting, quality.settings))
  app.graph.add('world', lighting.root)
  app.own(createPost(app, config.engine.post, quality.settings))
  app.graph.add('world', createSky(config.sky))
  bakeEnvironment(app)

  const input = app.own(new Input<Action>(container, config.bindings, config.engine.input))
  const hud = app.own(new Hud(config.engine.hud, config.meta.accent))
  const physics = app.own(await PhysicsWorld.create(config.engine.physics))
  const { rapier, world } = physics
  const events = new rapier.EventQueue(true)
  app.own({ dispose: () => events.free() })

  const arena = app.own(createArena(config.arena))
  app.graph.add('world', arena.root)
  world.createCollider(rapier.ColliderDesc.cuboid(config.arena.groundSize / 2, 0.5, config.arena.groundSize / 2).setTranslation(0, -0.5, 0).setFriction(1))
  for (const barrier of arena.barriers) {
    world.createCollider(rapier.ColliderDesc.cuboid(barrier.half.x, barrier.half.y, barrier.half.z).setTranslation(barrier.position.x, barrier.position.y, barrier.position.z).setFriction(0.4).setRestitution(0.2))
  }
  const dust = app.own(createParticles(config.dust, 0.55, 0.9))
  const smoke = app.own(createParticles(config.smoke, 0.5, 1.6))
  app.graph.add('fx', dust.points)
  app.graph.add('fx', smoke.points)
  const halfL = config.arena.length / 2
  const halfW = config.arena.width / 2

  const chase = createChaseCamera(config.camera)
  const banner = byId<HTMLElement>('banner')
  const healthWrap = byId<HTMLElement>('health')
  const healthBar = byId<HTMLElement>('health-bar')
  const engineBar = byId<HTMLElement>('engine-bar')
  const healthText = byId<HTMLElement>('health-text')
  const engineText = byId<HTMLElement>('engine-text')

  const status = hud.panel('top-left', config.meta.title)
  const showCars = hud.stat(status, 'Still running', '–')
  const showClock = hud.stat(status, 'Heat clock', '0:00')
  const showPoints = hud.stat(status, 'Points', '0')
  const showRate = hud.stat(status, 'Frame rate', '–')
  const hint = hud.panel('bottom-left')
  hint.textContent = config.hud.controlsHint
  hint.style.maxWidth = '340px'
  hint.hidden = true
  status.hidden = true

  let cars: Vehicle[] = []
  let brains = new Map<number, AiBrain>()
  let heat: Heat | null = null
  let preview: Vehicle | null = null
  let nextId = 1
  let heatId = 0
  let scoreSent = false
  let watching = false
  let steps = 0
  let resultsShown = false
  const carColliders = new Set<number>()
  const wheelFilter = (collider: RAPIER.Collider): boolean => !carColliders.has(collider.handle)

  const spawnVehicle = (look: CarLook, isPlayer: boolean, position: THREE.Vector3, yaw: number): Vehicle => {
    const vehicle = new Vehicle(nextId++, look, bodyById(look.body), isPlayer, physics, config.vehicle, position, yaw)
    app.graph.add('props', vehicle.model.root)
    app.graph.add('props', vehicle.model.shadow)
    carColliders.add(vehicle.collider.handle)
    vehicle.sync(1)
    return vehicle
  }
  const removeVehicle = (vehicle: Vehicle): void => {
    carColliders.delete(vehicle.collider.handle)
    vehicle.dispose()
  }

  const clearField = (): void => {
    for (const car of cars) removeVehicle(car)
    cars = []
    brains = new Map()
    heat = null
  }

  const setPreview = (look: CarLook): void => {
    if (preview) removeVehicle(preview)
    preview = spawnVehicle(look, true, new THREE.Vector3(0, 0, 0), Math.PI * 0.15)
  }

  const playerLabel = (car: Vehicle): string => `#${car.look.number} ${bodyById(car.look.body).name.split(' ')[1] ?? ''}`.trim()

  const resultRows = (): ResultRow[] => {
    const list = cars.map((car) => ({ car, place: car.place || 0 }))
    list.sort((a, b) => (a.place || 0.5) - (b.place || 0.5))
    return list.map(({ car }) => ({ place: car.place || 0, label: car.isPlayer ? `${playerLabel(car)} (you)` : playerLabel(car), hits: car.hitsLanded, knockouts: car.knockouts, points: car.points, isPlayer: car.isPlayer }))
  }

  const submitScore = (): void => {
    if (!heat || scoreSent) return
    scoreSent = true
    void Scores.submit(config.meta.id, heat.playerScore(), { key: `heat-${heatId}` })
  }

  const screens = createGarage(loadLook(), {
    onLook(look) {
      saveLook(look)
      setPreview(look)
    },
    onStart(look, settings) {
      saveLook(look)
      startHeat(look, settings)
    },
    onAgain() {
      if (lastSettings && lastLook) startHeat(lastLook, lastSettings)
    },
    onWatch() {
      watching = true
      screens.hideAll()
      chase.setMode('stand')
    },
    onGarage() {
      toGarage()
    },
  })

  let lastLook: CarLook | null = null
  let lastSettings: HeatSettings | null = null

  const toGarage = (): void => {
    clearField()
    watching = false
    resultsShown = false
    banner.hidden = true
    healthWrap.hidden = true
    status.hidden = true
    hint.hidden = true
    chase.setMode('garage')
    setPreview(lastLook ?? loadLook())
    screens.showGarage()
  }

  const startHeat = (look: CarLook, settings: HeatSettings): void => {
    lastLook = look
    lastSettings = settings
    if (preview) {
      removeVehicle(preview)
      preview = null
    }
    clearField()
    heatId++
    scoreSent = false
    watching = false
    resultsShown = false
    const level = aiLevelById(settings.level)
    const count = settings.opponents + 1
    const taken = new Set<string>([look.number])
    const looks: CarLook[] = [look]
    for (let i = 1; i < count; i++) {
      const opponent = opponentLook(heatId * 97 + i * 13 + Date.now() % 1000, taken)
      taken.add(opponent.number)
      looks.push(opponent)
    }
    const ring = config.heat.spawnRing
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.PI / count
      const position = new THREE.Vector3(Math.cos(angle) * halfL * ring, 0, Math.sin(angle) * halfW * ring)
      const yaw = Math.atan2(-position.x, -position.z)
      const car = spawnVehicle(looks[i], i === 0, position, yaw)
      cars.push(car)
      if (i > 0) brains.set(car.id, createBrain(level, heatId * 1000 + i * 7919))
    }
    heat = new Heat(cars, config.damage, config.scoring, config.heat.countdownSeconds, config.heat.finishHoldSeconds)
    screens.hideAll()
    chase.setMode('chase')
    chase.snap()
    status.hidden = false
    hint.hidden = false
    healthWrap.hidden = false
    banner.hidden = false
    banner.classList.remove('is-warn')
    banner.textContent = 'Get set'
    hud.toast(`${count} cars on the pad. Last one running wins.`)
  }

  const showResults = (): void => {
    if (!heat || resultsShown) return
    resultsShown = true
    const player = heat.player
    const finished = heat.state.phase === 'finished'
    const place = player?.place ?? 0
    const title = finished && place === 1 ? 'Last car standing!' : place > 0 ? `You finished ${ordinal(place)} of ${cars.length}` : 'Results'
    const line = player
      ? player.outReason === 'idle'
        ? 'Called out of the heat for 60 seconds without a hit. Keep moving and keep hitting.'
        : player.outReason === 'wrecked'
          ? `Wrecked after ${formatClock(player.survived)} with ${player.hitsLanded} hits landed.`
          : `${player.hitsLanded} hits landed and ${player.knockouts} knockouts in ${formatClock(player.survived)}.`
      : ''
    screens.showResults(title, line, resultRows(), finished ? 'Heat over' : 'You are out', !finished)
    chase.setMode('stand')
  }

  const playerLookAt = new THREE.Vector3()
  const playerHeading = new THREE.Vector3(0, 0, -1)
  const emitVelocity = new THREE.Vector3()
  let dragging = false
  container.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button === 0) dragging = true
  })
  addEventListener('pointerup', () => {
    dragging = false
  })

  app.onFixed((dt) => {
    input.update()
    if (input.pressed('debug')) physics.setDebug(physics.debugEnabled ? null : app.graph.layer('fx'))
    if (input.pressed('camera') && heat) chase.setMode(chase.mode === 'chase' ? 'stand' : 'chase')
    const player = heat?.player ?? preview
    if (heat && player) {
      const running = heat.running
      player.controls.throttle = running ? input.axis('back', 'forward') : 0
      player.controls.steer = running ? input.axis('left', 'right') : 0
      player.controls.brake = running ? input.isDown('brake') : true
      if (input.pressed('reset') && running && player.alive && (player.flippedFor > 0.5 || player.stuck)) player.rightSelf()
      for (const car of cars) {
        if (car.isPlayer) continue
        const brain = brains.get(car.id)
        if (brain && running) driveAi(brain, car, cars, { halfL, halfW }, dt)
        else {
          car.controls.throttle = 0
          car.controls.brake = true
        }
        if (car.alive && car.flippedFor > config.vehicle.flipRecoverSeconds) car.rightSelf()
      }
      if (player.alive && player.flippedFor > config.vehicle.flipRecoverSeconds * 2) player.rightSelf()
    } else if (preview) {
      preview.controls.throttle = 0
      preview.controls.brake = true
    }
    for (const car of cars) car.update(dt, wheelFilter)
    preview?.update(dt, wheelFilter)
    physics.step(dt, events)
    if (heat) {
      heat.resolveContacts(events)
      heat.tick(dt)
      for (const event of heat.drainEvents()) {
        if (event.kind === 'knockout' && event.other) hud.toast(`${event.car.isPlayer ? 'You' : playerLabel(event.car)} knocked out ${event.other.isPlayer ? 'you' : playerLabel(event.other)}`)
        else if (event.kind === 'idle-out') hud.toast(`${event.car.isPlayer ? 'You were' : `${playerLabel(event.car)} was`} called out: no hits in 60 seconds`)
        else if (event.kind === 'hit' && event.car.isPlayer && (event.strength ?? 0) > 0.6) hud.toast(`Big hit on ${event.other ? playerLabel(event.other) : 'a car'}`)
      }
      if (heat.player && !heat.player.alive) submitScore()
      if (heat.state.phase === 'finished') submitScore()
      if ((heat.player && !heat.player.alive && !watching) || heat.state.phase === 'finished') showResults()
    } else {
      events.clear()
    }
    steps++
  })

  app.onFrame((frameSeconds, alpha) => {
    const dt = Math.min(frameSeconds, 0.1)
    const focus = heat?.player ?? preview
    for (const car of cars) car.sync(alpha)
    preview?.sync(alpha)
    if (dragging && (input.pointer.dx || input.pointer.dy)) chase.orbit(input.pointer.dx, input.pointer.dy)
    if (focus) {
      playerLookAt.copy(focus.pos)
      playerHeading.copy(focus.heading)
      lighting.follow(playerLookAt)
    }
    chase.update(app.camera, playerLookAt, playerHeading, dt)
    arena.update(dt)
    for (const car of cars) {
      if (car.alive && car.sideSlip > config.dust.slipSpeed) {
        for (let i = 2; i < 4; i++) {
          const ground = car.wheelGround(i)
          if (ground) dust.emit(ground, emitVelocity.set(0, 0, 0), 0.5)
        }
      } else if (car.alive && Math.abs(car.controls.throttle) > 0.5 && car.speed < 4) {
        const ground = car.wheelGround(2 + Math.floor(Math.random() * 2))
        if (ground) dust.emit(ground, emitVelocity.copy(car.heading).multiplyScalar(-car.controls.throttle * 2), 0.4)
      }
      const smoking = car.alive ? car.engine < config.damage.smokeBelow : car.outReason === 'wrecked'
      if (smoking && Math.random() < (car.alive ? 0.35 : 0.7)) {
        const nose = car.pos.clone().addScaledVector(car.heading, car.spec.length * 0.42)
        nose.y += 0.4
        smoke.emit(nose, emitVelocity.set(0, 0.4, 0), 0.6)
      }
    }
    dust.update(dt)
    smoke.update(dt)
    if (heat) {
      const player = heat.player
      showCars(`${heat.state.alive} of ${cars.length}`)
      showClock(formatClock(heat.state.clock))
      showPoints(heat.playerScore().toLocaleString())
      if (player) {
        healthBar.style.transform = `scaleX(${player.health / 100})`
        engineBar.style.transform = `scaleX(${player.engine / 100})`
        healthText.textContent = String(Math.round(player.health))
        engineText.textContent = String(Math.round(player.engine))
      }
      if (heat.state.phase === 'countdown') {
        banner.hidden = false
        banner.classList.remove('is-warn')
        banner.textContent = heat.state.countdown > 0.6 ? String(Math.ceil(heat.state.countdown)) : 'GO'
      } else if (heat.state.phase === 'running' && player?.alive && player.idle > config.damage.idleOutSeconds - config.damage.idleWarnSeconds) {
        banner.hidden = false
        banner.classList.add('is-warn')
        banner.textContent = `Hit someone: ${Math.ceil(config.damage.idleOutSeconds - player.idle)}`
      } else if (heat.state.phase === 'running' && heat.state.clock < 1.2) {
        banner.textContent = 'GO'
      } else {
        banner.hidden = true
      }
    }
    showRate(app.frameRate ? `${app.frameRate} fps` : '–')
  })

  void fetch(`/api/module-scores?module=${config.meta.id}`, { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : null))
    .then((board: { personalBest?: number | null } | null) => {
      if (board?.personalBest) screens.setBestNote(`Your best heat: ${board.personalBest.toLocaleString()} points`)
    })
    .catch(() => undefined)

  setPreview(loadLook())
  chase.setMode('garage')
  screens.showGarage()
  app.start()
  window.__tlModule = { app, backend: app.backend, tier: quality.tier, steps: () => steps }
  addEventListener(
    'pagehide',
    () => {
      screens.dispose()
      clearField()
      if (preview) removeVehicle(preview)
      app.dispose()
    },
    { once: true },
  )
}

boot().catch((error: unknown) => {
  const stage = document.getElementById('stage')
  if (stage) stage.textContent = 'This learning module could not start on this device.'
  console.error(error)
})
