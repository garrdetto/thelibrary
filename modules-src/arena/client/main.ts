import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { createEnvironment } from './scene/Environment'
import { createMaterials } from './scene/Materials'
import { ARENA_HALF_LENGTH, ARENA_HALF_WIDTH, buildArena } from './scene/Arena'
import { createTerrain } from './scene/Terrain'
import { createPostProcess } from './scene/PostProcess'
import { createFirstPerson } from './player/FirstPerson'
import { WeaponSystem } from './weapons/WeaponSystem'
import { Hud } from './ui/Hud'
import { Tracker } from './ui/Tracker'
import { Banner } from './ui/Banner'
import { Results } from './ui/Results'
import { Menu, cleanCode, newRoomCode } from './ui/Menu'
import { OnlineMode } from './modes/OnlineMode'
import { RangeMode } from './modes/RangeMode'
import { HordeMode } from './modes/HordeMode'
import { PracticeMode } from './modes/PracticeMode'
import type { ActiveMode, ModeContext, ModeRequest, PlayModeId } from './modes/types'
import { HubBridge } from '../../../engine/net/HubBridge'
import { Scores } from '../../../engine/net/Scores'
import { ARENA_MAX_HEALTH } from '../../../server/arena/protocol.mjs'

const GRAVITY = -20
const MODES: readonly PlayModeId[] = ['open', 'duel', 'squads', 'range', 'horde', 'practice']

async function libraryName(): Promise<string> {
  const given = new URLSearchParams(location.search).get('name')
  if (given && /^[a-zA-Z0-9_-]{3,20}$/.test(given)) return given
  try {
    const response = await fetch('/api/pool-account', { credentials: 'same-origin' })
    if (!response.ok) return 'Guest'
    const data = (await response.json()) as { username?: string; user?: { username?: string } }
    return data.username ?? data.user?.username ?? 'Guest'
  } catch {
    return 'Guest'
  }
}

function initialRequest(search: string): ModeRequest | null {
  const params = new URLSearchParams(search)
  const code = cleanCode(params.get('room') ?? '')
  const mode = params.get('mode') as PlayModeId | null
  if (code) return { mode: mode === 'squads' ? 'squads' : 'duel', code }
  if (mode && MODES.includes(mode)) return { mode }
  if (params.has('solo')) return { mode: 'practice' }
  return null
}

export async function startArena(stage: HTMLElement): Promise<void> {
  const canvas = document.createElement('canvas')
  canvas.id = 'view'
  canvas.tabIndex = 0
  canvas.setAttribute('aria-label', 'Vector Arena 3D view')
  stage.prepend(canvas)

  const engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, true)
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2))

  const scene = new Scene(engine)
  scene.collisionsEnabled = true
  scene.gravity = new Vector3(0, GRAVITY, 0)
  scene.skipPointerMovePicking = true

  const environment = createEnvironment(scene)
  const materials = createMaterials(scene)
  const arena = buildArena(scene, materials, environment.shadows)
  createTerrain(scene, ARENA_HALF_WIDTH, ARENA_HALF_LENGTH)

  const player = createFirstPerson(scene, canvas, arena.spawn(0))
  scene.activeCamera = player.camera
  createPostProcess(scene, player.camera)

  const status = document.getElementById('status')
  const hud = new Hud()
  const banner = new Banner()
  const results = new Results()
  const tracker = new Tracker(document.getElementById('tracker') as HTMLCanvasElement | null)
  hud.setHealth(ARENA_MAX_HEALTH)
  Scores.installGlobal()

  const weapons = new WeaponSystem(scene, player.camera, player, canvas, {
    shoot: () => {},
    team: () => null,
    hit: (_target, headshot) => hud.hit(headshot),
  })
  void weapons.load()

  const playerName = await libraryName()
  let current: ActiveMode | null = null
  let lastRequest: ModeRequest = { mode: 'practice' }

  const ctx: ModeContext = {
    engine,
    scene,
    canvas,
    materials,
    shadows: environment.shadows,
    arena,
    player,
    weapons,
    hud,
    banner,
    results,
    playerName,
    setStatus: text => { if (status) status.textContent = text },
    openMenu: () => menu.show(current !== null),
    restart: () => start(lastRequest),
  }

  const start = (request: ModeRequest) => {
    results.hide()
    current?.dispose()
    current = null
    lastRequest = request
    document.body.dataset.mode = request.mode
    ctx.setStatus('')
    switch (request.mode) {
      case 'open':
      case 'duel':
      case 'squads':
        current = new OnlineMode(ctx, request.mode, request.code ?? null)
        break
      case 'range':
        current = new RangeMode(ctx)
        break
      case 'horde':
        current = new HordeMode(ctx)
        break
      default:
        current = new PracticeMode(ctx)
    }
    canvas.focus()
  }

  const relock = () => {
    if (document.pointerLockElement === canvas) return
    try {
      Promise.resolve(canvas.requestPointerLock?.()).catch(() => {})
    } catch {
      canvas.focus()
    }
  }
  const menu = new Menu(request => start(request), scale => weapons.setSensitivity(scale), relock)

  let wasLocked = false
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas
    const released = wasLocked && !locked
    wasLocked = locked
    if (!released || menu.open || results.open || document.body.classList.contains('loading')) return
    menu.show(current !== null)
  })

  window.addEventListener('keydown', event => {
    if (event.code !== 'KeyM' || event.repeat) return
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    if (menu.open) return
    menu.show(current !== null)
  })
  document.getElementById('prompt-modes')?.addEventListener('click', () => menu.show(current !== null))

  HubBridge.on('tl-host', () => {
    const online = current instanceof OnlineMode ? current : null
    void (online?.hostCode() ?? Promise.resolve(null)).then(code => {
      if (code) {
        HubBridge.post({ type: 'tl-room', code })
        return
      }
      const fresh = newRoomCode()
      menu.hide()
      start({ mode: online?.id === 'squads' ? 'squads' : 'duel', code: fresh })
      HubBridge.post({ type: 'tl-room', code: fresh })
    })
  })

  const first = initialRequest(location.search)
  if (first) start(first)
  else {
    start({ mode: 'practice' })
    menu.show(false)
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let clock = 0
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05)
    clock += dt
    player.update(dt)
    weapons.update(dt)
    current?.update(dt)
    const pose = player.pose()
    tracker.update(dt, current?.contacts() ?? [], pose.x, pose.z, pose.yaw, current?.team() ?? null)
    hud.weapon(weapons.readout())
    if (reduceMotion) return
    arena.rings.forEach((ring, index) => {
      ring.position.y = 4 + index * 1.8 + Math.sin(clock * 1.6 + index) * 0.25
      ring.rotation.x = Math.sin(clock * 0.7 + index) * 0.3
      ring.rotation.z = Math.cos(clock * 0.9 + index) * 0.3
    })
    materials.energyWhite.emissiveIntensity = 1.3 + Math.sin(clock * 2.2) * 0.2
  })

  window.addEventListener('resize', () => engine.resize())
  window.addEventListener('pagehide', () => current?.dispose())
  ;(window as unknown as { __arena?: unknown }).__arena = { engine, scene, player, arena, weapons, get mode() { return current }, start, menu }
  scene.executeWhenReady(() => document.body.classList.remove('loading'))
  engine.runRenderLoop(() => scene.render())
}
