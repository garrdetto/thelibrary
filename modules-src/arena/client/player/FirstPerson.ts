import type { Scene } from '@babylonjs/core/scene'
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import '@babylonjs/core/Collisions/collisionCoordinator'

const EYE_HEIGHT = 1.7
const RADIUS = 0.45
const HALF_HEIGHT = 0.9
const WALK_SPEED = 6
const SPRINT_SPEED = 9.5
const JUMP_SPEED = 7.5
const AIR_CONTROL = 0.7
const FALL_LIMIT = -30
const PITCH_LIMIT = 1.45
const COYOTE_TIME = 0.1
const JUMP_BUFFER = 0.12
const GROUND_SNAP = 0.12

export interface FirstPersonPlayer {
  camera: UniversalCamera
  body: Mesh
  readonly grounded: boolean
  readonly moving: number
  alive: boolean
  update(dt: number): void
  respawn(position: Vector3, yaw: number): void
  kick(pitch: number, yaw: number, recover: number): void
  pose(): { x: number; y: number; z: number; yaw: number; pitch: number }
}

export function createFirstPerson(scene: Scene, canvas: HTMLCanvasElement, spawn: { position: Vector3; yaw: number }): FirstPersonPlayer {
  const body = MeshBuilder.CreateBox('player-body', { size: 0.2 }, scene)
  body.isVisible = false
  body.isPickable = false
  body.checkCollisions = false
  body.ellipsoid = new Vector3(RADIUS, HALF_HEIGHT, RADIUS)
  body.ellipsoidOffset = new Vector3(0, HALF_HEIGHT, 0)

  const camera = new UniversalCamera('player-camera', spawn.position.add(new Vector3(0, EYE_HEIGHT, 0)), scene)
  camera.minZ = 0.05
  camera.maxZ = 1200
  camera.fov = 1.15
  camera.inertia = 0
  camera.angularSensibility = 900
  camera.keysUp = []
  camera.keysDown = []
  camera.keysLeft = []
  camera.keysRight = []
  camera.inputs.removeByType('FreeCameraTouchInput')
  camera.attachControl(canvas, true)

  const keys = new Set<string>()
  let verticalSpeed = 0
  let grounded = false
  let sinceGrounded = 0
  let jumpQueued = 0
  let moving = 0
  let alive = true
  let recoilPitch = 0
  let recoilRecover = 10
  let spawnPoint = spawn

  const onKeyDown = (event: KeyboardEvent) => {
    keys.add(event.code)
    if (event.code === 'Space') {
      event.preventDefault()
      if (!event.repeat) jumpQueued = JUMP_BUFFER
    }
  }
  const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', () => keys.clear())

  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) void canvas.requestPointerLock?.()
  })
  document.addEventListener('pointerlockchange', () => {
    document.body.classList.toggle('locked', document.pointerLockElement === canvas)
  })

  const respawn = (position: Vector3, yaw: number) => {
    body.position.copyFrom(position)
    body.computeWorldMatrix(true)
    camera.rotation.set(0, yaw, 0)
    camera.position.set(position.x, position.y + EYE_HEIGHT, position.z)
    verticalSpeed = 0
    recoilPitch = 0
    grounded = false
  }
  respawn(spawn.position, spawn.yaw)

  const wish = new Vector3()
  const step = new Vector3()

  const update = (dt: number) => {
    if (recoilPitch > 0) {
      const back = Math.min(recoilPitch, recoilPitch * Math.min(1, recoilRecover * dt) + 0.0004)
      camera.rotation.x += back
      recoilPitch -= back
    }
    camera.rotation.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, camera.rotation.x))

    const active = alive
    const forward = active ? (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) : 0
    const strafe = active ? (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) : 0
    const yaw = camera.rotation.y
    wish.set(Math.sin(yaw) * forward + Math.cos(yaw) * strafe, 0, Math.cos(yaw) * forward - Math.sin(yaw) * strafe)
    if (wish.lengthSquared() > 1) wish.normalize()
    const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight')
    const speed = sprinting ? SPRINT_SPEED : WALK_SPEED
    const control = grounded ? 1 : AIR_CONTROL

    jumpQueued = Math.max(0, jumpQueued - dt)
    sinceGrounded = grounded ? 0 : sinceGrounded + dt
    if (active && jumpQueued > 0 && sinceGrounded <= COYOTE_TIME && verticalSpeed <= 0) {
      verticalSpeed = JUMP_SPEED
      grounded = false
      sinceGrounded = COYOTE_TIME + 1
      jumpQueued = 0
    }
    verticalSpeed += scene.gravity.y * dt

    const snap = grounded && verticalSpeed <= 0 ? GROUND_SNAP : 0
    const requestedY = verticalSpeed * dt - snap
    step.set(wish.x * speed * control * dt, requestedY, wish.z * speed * control * dt)
    const before = body.position.y
    body.moveWithCollisions(step)
    const movedY = body.position.y - before

    if (verticalSpeed <= 0 && movedY > requestedY + 0.001) {
      grounded = true
      verticalSpeed = 0
    } else if (verticalSpeed > 0 && movedY < requestedY - 0.001) {
      verticalSpeed = 0
      grounded = false
    } else {
      grounded = false
    }
    moving = wish.length() * (sprinting ? 1.4 : 1) * (grounded ? 1 : 0.4)

    if (body.position.y < FALL_LIMIT) respawn(spawnPoint.position, spawnPoint.yaw)
    camera.position.set(body.position.x, body.position.y + EYE_HEIGHT, body.position.z)
  }

  return {
    camera,
    body,
    get grounded() { return grounded },
    get moving() { return moving },
    get alive() { return alive },
    set alive(value: boolean) {
      alive = value
      if (!value) keys.clear()
    },
    update,
    kick(pitch, yaw, recover) {
      camera.rotation.x -= pitch
      camera.rotation.y += yaw
      recoilPitch += pitch
      recoilRecover = recover
    },
    respawn(position, yaw) {
      spawnPoint = { position: position.clone(), yaw }
      respawn(position, yaw)
    },
    pose: () => ({ x: body.position.x, y: body.position.y, z: body.position.z, yaw: camera.rotation.y, pitch: camera.rotation.x }),
  }
}
