/**
 * The standalone page's cameras: a chase camera that swings round behind the rig (drag or hold the arrow keys to look round, wheel
 * to zoom; it eases back behind after a moment, or straight away when the arrow keys are let go; never dips under the ground), an in-cab driver's eye, and the lot builder's top-down orbit. Life Sim
 * keeps Rack & Reel's own camera, so nothing outside the standalone host depends on this file.
 */
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import type { Camera } from '@babylonjs/core/Cameras/camera'
import type { ArcRotateCameraPointersInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput'
import '@babylonjs/core/Culling/ray'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'
import type { TruckModel } from '../shared/Catalog'
import type { BuildView } from './BuildMode'

export type CameraMode = 'chase' | 'cab' | 'build'

export interface FollowSubject {
  x: number
  y: number
  z: number
  heading: number
  /** Length of the whole rig (truck plus trailer), so the chase distance fits it. */
  span: number
  /** The driver's eye in world space. */
  eye: { x: number; y: number; z: number }
  speed: number
}

const LOOK_HOLD = 2.2
const RETURN_RATE = 1.6
/** Arrow-key look speeds (radians per second) and how fast the view swings back once the keys are let go. */
export const KEY_YAW_RATE = 2.2
export const KEY_PITCH_RATE = 1.1
export const KEY_RETURN_RATE = 7

/** Arrow keys held this frame: yaw -1 (right) … 1 (left), pitch -1 (down) … 1 (up). */
export interface LookInput {
  yaw: number
  pitch: number
}

export interface LookState {
  yawOffset: number
  pitch: number
  /** True while the view is swinging back to the rest view after the arrow keys were let go. */
  returning: boolean
}

/**
 * One frame of arrow-key looking: held keys turn the view (yaw wraps within ±π), and once they are let go the view eases
 * quickly back to straight behind (`restPitch`). Returns true while the keys own the view. Renderer-free.
 */
export function stepKeyLook(state: LookState, input: LookInput, dt: number, restPitch: number, minPitch: number): boolean {
  if (input.yaw !== 0 || input.pitch !== 0) {
    state.yawOffset += input.yaw * KEY_YAW_RATE * dt
    if (state.yawOffset > Math.PI) state.yawOffset -= Math.PI * 2
    if (state.yawOffset < -Math.PI) state.yawOffset += Math.PI * 2
    state.pitch = Math.min(1.25, Math.max(minPitch, state.pitch + input.pitch * KEY_PITCH_RATE * dt))
    state.returning = true
    return true
  }
  if (!state.returning) return false
  const k = 1 - Math.exp(-KEY_RETURN_RATE * dt)
  state.yawOffset -= state.yawOffset * k
  state.pitch += (restPitch - state.pitch) * k
  if (Math.abs(state.yawOffset) < 0.002 && Math.abs(state.pitch - restPitch) < 0.002) {
    state.yawOffset = 0
    state.pitch = restPitch
    state.returning = false
  }
  return true
}

/** Where the driver's eyes are in the truck's own frame (driver on the +X side). */
export function driverEye(model: TruckModel): { x: number; y: number; z: number } {
  const z = model.hoodLength > 0 ? model.frontZ - model.hoodLength - 1.05 : model.frontZ - 0.95
  return { x: 0.55, y: model.cabHeight - 0.72, z }
}

const NO_LOOK: LookInput = { yaw: 0, pitch: 0 }

export class CameraRig {
  readonly drive: FreeCamera
  readonly build: ArcRotateCamera
  mode: CameraMode = 'chase'
  private yawOffset = 0
  private pitch = 0.32
  private distance = 1
  private lookTimer = 0
  private dragging = false
  private lastX = 0
  private lastY = 0
  private readonly position = new Vector3()
  private readonly target = new Vector3()
  private readonly desired = new Vector3()
  private initialised = false
  private readonly look: LookState = { yawOffset: 0, pitch: 0.32, returning: false }
  private readonly cleanup: (() => void)[] = []

  constructor(private readonly scene: Scene, canvas: HTMLCanvasElement, private readonly heightAt: (x: number, z: number) => number) {
    this.drive = new FreeCamera('trucksim-drive', new Vector3(0, 10, -20), scene)
    this.drive.minZ = 0.15
    this.drive.maxZ = 6000
    this.drive.fov = 0.9
    this.drive.inputs.clear()
    this.build = new ArcRotateCamera('trucksim-build', -Math.PI / 2, 0.9, 120, Vector3.Zero(), scene)
    this.build.minZ = 0.5
    this.build.maxZ = 6000
    this.build.lowerRadiusLimit = 25
    this.build.upperRadiusLimit = 300
    this.build.lowerBetaLimit = 0.2
    this.build.upperBetaLimit = 1.35
    this.build.wheelDeltaPercentage = 0.02
    this.build.panningSensibility = 40
    scene.activeCamera = this.drive
    const down = (e: PointerEvent) => {
      if (this.mode === 'build' || e.button !== 0) return
      this.dragging = true
      this.lastX = e.clientX
      this.lastY = e.clientY
    }
    const move = (e: PointerEvent) => {
      if (!this.dragging) return
      const dx = e.clientX - this.lastX
      const dy = e.clientY - this.lastY
      this.lastX = e.clientX
      this.lastY = e.clientY
      this.yawOffset -= dx * 0.005
      this.pitch = Math.min(1.25, Math.max(this.mode === 'cab' ? -0.6 : 0.05, this.pitch + dy * 0.004))
      this.lookTimer = LOOK_HOLD
      this.look.returning = false
    }
    const up = () => { this.dragging = false }
    const wheel = (e: WheelEvent) => {
      if (this.mode !== 'chase') return
      this.distance = Math.min(2.6, Math.max(0.45, this.distance * (1 + Math.sign(e.deltaY) * 0.08)))
    }
    canvas.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    canvas.addEventListener('wheel', wheel, { passive: true })
    this.cleanup.push(() => {
      canvas.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      canvas.removeEventListener('wheel', wheel)
    })
  }

  get active(): Camera {
    return this.mode === 'build' ? this.build : this.drive
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return
    if (this.mode === 'build') this.build.detachControl()
    this.mode = mode
    this.yawOffset = 0
    this.pitch = mode === 'cab' ? 0.05 : 0.32
    this.look.returning = false
    this.initialised = false
    if (mode === 'build') this.build.attachControl(true)
    this.scene.activeCamera = this.active
  }

  /** C: chase ⇄ cab. */
  toggleView(): CameraMode {
    this.setMode(this.mode === 'chase' ? 'cab' : 'chase')
    return this.mode
  }

  /** Frames the builder camera over a rectangle (a lot). */
  focusBuild(x: number, z: number, extent: number): void {
    this.build.target.set(x, this.heightAt(x, z), z)
    this.build.radius = Math.max(60, extent * 1.1)
  }

  update(dt: number, subject: FollowSubject, keys: LookInput = NO_LOOK): void {
    if (this.mode === 'build') return
    const rest = this.mode === 'cab' ? 0.05 : 0.32
    this.look.yawOffset = this.yawOffset
    this.look.pitch = this.pitch
    if (stepKeyLook(this.look, this.dragging ? NO_LOOK : keys, dt, rest, this.mode === 'cab' ? -0.6 : 0.05)) {
      this.yawOffset = this.look.yawOffset
      this.pitch = this.look.pitch
      this.lookTimer = 0
    } else if (this.lookTimer > 0) this.lookTimer -= dt
    else if (!this.dragging) {
      const k = 1 - Math.exp(-RETURN_RATE * dt * Math.min(1, 0.25 + Math.abs(subject.speed) / 8))
      this.yawOffset -= this.yawOffset * k
      if (this.mode === 'chase') this.pitch += (0.32 - this.pitch) * k * 0.5
    }
    if (this.mode === 'cab') {
      const yaw = subject.heading + this.yawOffset
      this.drive.position.set(subject.eye.x, subject.eye.y, subject.eye.z)
      this.target.set(subject.eye.x + Math.sin(yaw) * 10, subject.eye.y - Math.sin(this.pitch) * 10 - 0.6, subject.eye.z + Math.cos(yaw) * 10)
      this.drive.setTarget(this.target)
      return
    }
    const yaw = subject.heading + Math.PI + this.yawOffset
    const range = (9 + subject.span * 0.75) * this.distance
    const flat = Math.cos(this.pitch) * range
    this.desired.set(subject.x + Math.sin(yaw) * flat, subject.y + 2.4 + Math.sin(this.pitch) * range, subject.z + Math.cos(yaw) * flat)
    const floor = this.heightAt(this.desired.x, this.desired.z) + 1.6
    if (this.desired.y < floor) this.desired.y = floor
    if (!this.initialised) {
      this.position.copyFrom(this.desired)
      this.initialised = true
    } else {
      const k = 1 - Math.exp(-7 * dt)
      this.position.x += (this.desired.x - this.position.x) * k
      this.position.y += (this.desired.y - this.position.y) * k
      this.position.z += (this.desired.z - this.position.z) * k
    }
    this.drive.position.copyFrom(this.position)
    this.target.set(subject.x, subject.y + 2.2, subject.z)
    this.drive.setTarget(this.target)
  }

  dispose(): void {
    for (const fn of this.cleanup) fn()
    this.build.detachControl()
    this.drive.dispose()
    this.build.dispose()
  }
}

/**
 * The lot builder's view through the standalone page's orbit camera: middle-drag turns it, right-drag pans, the wheel zooms, and
 * the scene is the session's right-handed frame, so picks need no conversion.
 */
export function cameraBuildView(scene: Scene, canvas: HTMLCanvasElement, cameras: CameraRig): BuildView {
  cameras.setMode('build')
  const pointers = cameras.build.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined
  if (pointers) pointers.buttons = [1, 2]
  return {
    focus: (x, z, extent) => cameras.focusBuild(x, z, extent),
    pick: (clientX, clientY, groundY) => {
      const rect = canvas.getBoundingClientRect()
      const ray = scene.createPickingRay(clientX - rect.left, clientY - rect.top, Matrix.Identity(), cameras.build, false)
      if (Math.abs(ray.direction.y) < 1e-4) return null
      const t = (groundY - ray.origin.y) / ray.direction.y
      if (t <= 0) return null
      return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t }
    },
    spin: (radians) => {
      cameras.build.alpha += radians
    },
    release: () => {
      if (pointers) pointers.buttons = [0, 1, 2]
      cameras.setMode('chase')
    },
  }
}
