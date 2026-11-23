/**
 * The three views: cockpit (pilot's eye point with mouse-drag look-around and a slight head lag under G), chase (behind and above,
 * following heading smoothly and pitch partly, orbit with drag and zoom with the wheel) and tower (the airport's tower cab tracking
 * the aircraft with a zoom that keeps it a steady size). `state` is in scene coordinates (world minus the floating origin). One `FreeCamera` is moved by hand each frame; reverse depth keeps the 0.1 m
 * to 90 km range precise.
 */
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'
import type { FlightModel } from '../sim/FlightModel'
import type { InterpolatedState } from '../sim/Simulation'

export type ViewMode = 'cockpit' | 'chase' | 'tower'
export const VIEW_ORDER: ViewMode[] = ['cockpit', 'chase', 'tower']

const tmpForward = new Vector3()
const tmpUp = new Vector3()
const tmpRight = new Vector3()
const tmpTarget = new Vector3()
const tmpEye = new Vector3()

function rotate(q: Quaternion, x: number, y: number, z: number, out: Vector3): Vector3 {
  const ix = q.w * x + q.y * z - q.z * y
  const iy = q.w * y + q.z * x - q.x * z
  const iz = q.w * z + q.x * y - q.y * x
  const iw = -q.x * x - q.y * y - q.z * z
  out.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y
  out.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z
  out.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  return out
}

export class CameraRig {
  readonly camera: FreeCamera
  mode: ViewMode = 'chase'
  private chaseDistance = 16
  private chaseHeading = 0
  private chasePitch = 0.18
  private headLagY = 0
  private readonly orientation = new Quaternion()
  private tower: Vector3 = new Vector3()
  private readonly towerLocal = new Vector3()
  /** World position of the scene origin (floating origin); the tower is given in world metres. */
  originX = 0
  originZ = 0

  constructor(scene: Scene) {
    this.camera = new FreeCamera('takeflight-camera', new Vector3(0, 200, -30), scene)
    this.camera.minZ = 0.1
    this.camera.maxZ = 90000
    this.camera.fov = 1.05
    this.camera.inputs.clear()
    this.camera.rotationQuaternion = new Quaternion()
    scene.activeCamera = this.camera
  }

  /** The tower cab (or replay camera) position in world metres. */
  setTower(x: number, y: number, z: number): void {
    this.tower.set(x, y, z)
  }

  /** Projected size of an object of `size` metres at the aircraft, in pixels, for LOD choice. */
  pixelsFor(state: InterpolatedState, size: number, viewportHeight: number): number {
    const dx = state.x - this.camera.position.x
    const dy = state.y - this.camera.position.y
    const dz = state.z - this.camera.position.z
    const distance = Math.max(0.5, Math.sqrt(dx * dx + dy * dy + dz * dz))
    return (size / distance) * (viewportHeight / (2 * Math.tan(this.camera.fov / 2)))
  }

  update(state: InterpolatedState, aircraft: FlightModel, lookYaw: number, lookPitch: number, zoomSteps: number, dt: number): void {
    const q = this.orientation.set(state.qx, state.qy, state.qz, state.qw)
    if (this.mode === 'cockpit') {
      const eye = aircraft.spec.eye
      this.headLagY += ((-(aircraft.loadFactor - 1) * 0.015) - this.headLagY) * Math.min(1, dt * 6)
      rotate(q, eye[0], eye[1] + this.headLagY, eye[2], tmpEye)
      this.camera.position.set(state.x + tmpEye.x, state.y + tmpEye.y, state.z + tmpEye.z)
      const cy = Math.cos(lookYaw)
      const sy = Math.sin(lookYaw)
      const cp = Math.cos(lookPitch - 0.06)
      const sp = Math.sin(lookPitch - 0.06)
      rotate(q, cy * cp, sp, -sy * cp, tmpForward)
      rotate(q, 0, 1, 0, tmpUp)
      this.camera.fov = 1.15
      this.camera.minZ = 0.05
      this.aim(tmpForward, tmpUp)
      return
    }
    this.camera.minZ = 0.4
    if (this.mode === 'chase') {
      this.chaseDistance = Math.max(7, Math.min(120, this.chaseDistance * Math.pow(1.12, zoomSteps)))
      const heading = (aircraft.heading * Math.PI) / 180
      let delta = heading - this.chaseHeading
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      this.chaseHeading += delta * Math.min(1, dt * 2.2)
      const pitchTarget = 0.12 + Math.max(-0.3, Math.min(0.3, (aircraft.pitch * Math.PI) / 180 * 0.4))
      this.chasePitch += (pitchTarget - this.chasePitch) * Math.min(1, dt * 1.5)
      const yaw = this.chaseHeading + Math.PI + lookYaw
      const pitch = Math.max(-0.2, Math.min(1.4, this.chasePitch + lookPitch))
      const horizontal = Math.cos(pitch) * this.chaseDistance
      tmpEye.set(state.x + Math.sin(yaw) * horizontal, state.y + Math.sin(pitch) * this.chaseDistance + 1.2, state.z - Math.cos(yaw) * horizontal)
      this.camera.position.copyFrom(tmpEye)
      tmpTarget.set(state.x, state.y + 1, state.z)
      tmpTarget.subtractToRef(tmpEye, tmpForward)
      tmpUp.set(0, 1, 0)
      this.camera.fov = 1.0
      this.aim(tmpForward.normalize(), tmpUp)
      return
    }
    this.towerLocal.set(this.tower.x - this.originX, this.tower.y, this.tower.z - this.originZ)
    this.camera.position.copyFrom(this.towerLocal)
    tmpTarget.set(state.x, state.y, state.z)
    tmpTarget.subtractToRef(this.towerLocal, tmpForward)
    const distance = tmpForward.length()
    this.camera.fov = Math.max(0.02, Math.min(1.1, 2 * Math.atan(18 / Math.max(1, distance))))
    tmpUp.set(0, 1, 0)
    this.aim(tmpForward.normalize(), tmpUp)
  }

  private aim(forward: Vector3, up: Vector3): void {
    Vector3.CrossToRef(up, forward, tmpRight)
    if (tmpRight.lengthSquared() < 1e-8) tmpRight.set(1, 0, 0)
    tmpRight.normalize()
    Vector3.CrossToRef(forward, tmpRight, tmpUp)
    Quaternion.FromLookDirectionLHToRef(forward, tmpUp, this.camera.rotationQuaternion as Quaternion)
  }
}
