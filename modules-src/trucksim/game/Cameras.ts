/**
 * The standalone page's cameras: a chase camera that swings round behind the rig (drag to look round, wheel to zoom, eases back
 * behind after a moment, never dips under the ground), an in-cab driver's eye, and the lot builder's top-down orbit. Life Sim
 * keeps Rack & Reel's own camera, so nothing outside the standalone host depends on this file.
 */
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'
import type { TruckModel } from '../shared/Catalog'

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

/** Where the driver's eyes are in the truck's own frame (driver on the +X side). */
export function driverEye(model: TruckModel): { x: number; y: number; z: number } {
  const z = model.hoodLength > 0 ? model.frontZ - model.hoodLength - 1.05 : model.frontZ - 0.95
  return { x: 0.55, y: model.cabHeight - 0.72, z }
}

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
    this.build.upperRadiusLimit = 220
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

  update(dt: number, subject: FollowSubject): void {
    if (this.mode === 'build') return
    if (this.lookTimer > 0) this.lookTimer -= dt
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
