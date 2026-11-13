import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { createEnvironment } from './scene/Environment'
import { createMaterials } from './scene/Materials'
import { ARENA_HALF_LENGTH, ARENA_HALF_WIDTH, buildArena } from './scene/Arena'
import { createTerrain } from './scene/Terrain'
import { createPostProcess } from './scene/PostProcess'
import { createFirstPerson } from './player/FirstPerson'
import { connectArena, serverAddress, type ArenaConnection } from './net/Connection'
import { RemotePlayers } from './net/RemotePlayers'
import { WeaponSystem } from './weapons/WeaponSystem'
import { Hud } from './ui/Hud'
import { Tracker } from './ui/Tracker'
import { ARENA_MAX_HEALTH } from '../../../server/arena/protocol.mjs'

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
  const tracker = new Tracker(document.getElementById('tracker') as HTMLCanvasElement | null)
  hud.setHealth(ARENA_MAX_HEALTH)
  const remotes = new RemotePlayers(scene, materials, environment.shadows)
  const names = new Map<string, string>()
  const nameOf = (id: string) => names.get(id) ?? 'a player'
  const address = serverAddress(location.search)

  let weapons: WeaponSystem | null = null
  const setAlive = (alive: boolean) => {
    player.alive = alive
    weapons?.setEnabled(alive)
  }

  const connection: ArenaConnection | null = address
    ? connectArena(address, await libraryName(), {
        status: text => { if (status) status.textContent = text },
        welcome: (_team, spawn) => {
          player.respawn(new Vector3(spawn.x, spawn.y, spawn.z), spawn.yaw)
          setAlive(true)
          weapons?.refill()
          hud.setHealth(ARENA_MAX_HEALTH)
        },
        players: list => {
          for (const other of list) names.set(other.id, other.name)
          remotes.sync(list)
        },
        self: self => {
          names.set(self.id, 'you')
          hud.setHealth(self.health)
        },
        left: id => remotes.remove(id),
        shot: shot => {
          const from = new Vector3(shot.origin.x, shot.origin.y - 0.15, shot.origin.z)
          const to = new Vector3(shot.end.x, shot.end.y, shot.end.z)
          weapons?.effects.tracer(from, to)
          weapons?.effects.impact(to, null, false)
        },
        damage: damage => {
          const self = connection?.selfId()
          if (damage.target === self) hud.setHealth(damage.health)
          else if (damage.attacker === self) hud.hit(damage.headshot, damage.health <= 0)
        },
        death: death => {
          const self = connection?.selfId()
          if (death.id === self) {
            setAlive(false)
            hud.setDead(true, nameOf(death.by))
          } else {
            remotes.setAlive(death.id, false)
          }
          hud.announce(`${death.by === self ? 'You' : nameOf(death.by)} eliminated ${death.id === self ? 'you' : nameOf(death.id)}`)
        },
        respawn: respawn => {
          const position = new Vector3(respawn.x, respawn.y, respawn.z)
          if (respawn.id === connection?.selfId()) {
            player.respawn(position, respawn.yaw)
            setAlive(true)
            weapons?.refill()
            hud.setHealth(respawn.health)
            hud.setDead(false)
          } else {
            remotes.teleport(respawn.id, position)
            remotes.setAlive(respawn.id, true)
          }
        },
      })
    : null
  if (!address && status) status.textContent = 'Solo'

  weapons = new WeaponSystem(scene, player.camera, player, canvas, {
    shoot: request => connection?.shoot(request),
    team: () => connection?.team() ?? null,
    hit: (_target, headshot) => hud.hit(headshot),
  })
  void weapons.load()

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let clock = 0
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05)
    clock += dt
    player.update(dt)
    weapons?.update(dt)
    remotes.update(dt)
    const pose = player.pose()
    tracker.update(dt, remotes.contacts(), pose.x, pose.z, pose.yaw, connection?.team() ?? null)
    if (weapons) hud.weapon(weapons.readout())
    connection?.send({ ...pose, action: weapons?.action ?? 'idle', weapon: weapons?.weapon ?? 'assault' })
    if (reduceMotion) return
    arena.rings.forEach((ring, index) => {
      ring.position.y = 4 + index * 1.8 + Math.sin(clock * 1.6 + index) * 0.25
      ring.rotation.x = Math.sin(clock * 0.7 + index) * 0.3
      ring.rotation.z = Math.cos(clock * 0.9 + index) * 0.3
    })
    materials.energyWhite.emissiveIntensity = 1.3 + Math.sin(clock * 2.2) * 0.2
  })

  window.addEventListener('resize', () => engine.resize())
  window.addEventListener('pagehide', () => connection?.close())
  ;(window as unknown as { __arena?: unknown }).__arena = { engine, scene, player, arena, weapons, remotes }
  scene.executeWhenReady(() => document.body.classList.remove('loading'))
  engine.runRenderLoop(() => scene.render())
}
