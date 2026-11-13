import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { createEnvironment } from './scene/Environment'
import { createMaterials } from './scene/Materials'
import { buildArena } from './scene/Arena'
import { createFirstPerson } from './player/FirstPerson'
import { connectArena, serverAddress } from './net/Connection'
import { RemotePlayers } from './net/RemotePlayers'

const GRAVITY = -20

async function libraryName(): Promise<string> {
  try {
    const response = await fetch('/api/pool-account', { credentials: 'same-origin' })
    if (!response.ok) return 'Guest'
    const data = (await response.json()) as { username?: string; user?: { username?: string } }
    return data.username ?? data.user?.username ?? 'Guest'
  } catch {
    return 'Guest'
  }
}

export async function startArena(stage: HTMLElement): Promise<void> {
  const canvas = document.createElement('canvas')
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
  environment.glow.addExcludedMesh(environment.skybox)

  const player = createFirstPerson(scene, canvas, arena.spawn(0))
  scene.activeCamera = player.camera

  const status = document.getElementById('status')
  const remotes = new RemotePlayers(scene, materials, environment.shadows)
  const address = serverAddress(location.search)
  const connection = address
    ? connectArena(address, await libraryName(), {
        status: text => { if (status) status.textContent = text },
        welcome: team => player.respawn(arena.spawn(team).position, arena.spawn(team).yaw),
        players: list => remotes.sync(list),
        left: id => remotes.remove(id),
      })
    : null
  if (!address && status) status.textContent = 'Solo'

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let clock = 0
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05)
    clock += dt
    player.update(dt)
    remotes.update(dt)
    connection?.send(player.pose())
    if (reduceMotion) return
    arena.rings.forEach((ring, index) => {
      ring.position.y = 4 + index * 1.8 + Math.sin(clock * 1.6 + index) * 0.25
      ring.rotation.x = Math.sin(clock * 0.7 + index) * 0.3
      ring.rotation.z = Math.cos(clock * 0.9 + index) * 0.3
    })
    environment.glow.intensity = 0.8 + Math.sin(clock * 2.2) * 0.12
  })

  window.addEventListener('resize', () => engine.resize())
  window.addEventListener('pagehide', () => connection?.close())
  ;(window as unknown as { __arena?: unknown }).__arena = { engine, scene, player, arena }
  engine.runRenderLoop(() => scene.render())
}
