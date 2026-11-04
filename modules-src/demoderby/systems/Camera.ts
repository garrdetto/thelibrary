/** Chase camera with a critically damped spring, pointer orbit, a grandstand view and the slow garage turntable. */
import * as THREE from 'three/webgpu'
import type { ModuleConfig } from '../config'

export type CameraMode = 'chase' | 'stand' | 'garage'

export interface ChaseCamera {
  mode: CameraMode
  setMode(mode: CameraMode): void
  orbit(dx: number, dy: number): void
  /** Moves the camera toward the target pose for this frame. */
  update(camera: THREE.PerspectiveCamera, target: THREE.Vector3, heading: THREE.Vector3, dt: number): void
  snap(): void
}

function springStep(value: number, velocity: number, target: number, stiffness: number, dt: number): [number, number] {
  const error = value - target
  const k = (velocity + stiffness * error) * dt
  const decay = Math.exp(-stiffness * dt)
  return [target + (error + k) * decay, (velocity - stiffness * k) * decay]
}

export function createChaseCamera(spec: ModuleConfig['camera']): ChaseCamera {
  const position = new THREE.Vector3(0, 6, 14)
  const positionVelocity = new THREE.Vector3()
  const look = new THREE.Vector3()
  const lookVelocity = new THREE.Vector3()
  const goal = new THREE.Vector3()
  const goalLook = new THREE.Vector3()
  let yawOffset = 0
  let pitch = 0.32
  let turntable = 0
  let snapNext = true

  const api: ChaseCamera = {
    mode: 'garage',
    setMode(mode) {
      if (api.mode !== mode) snapNext = true
      api.mode = mode
      if (mode === 'chase') yawOffset = 0
    },
    orbit(dx, dy) {
      yawOffset -= dx * spec.orbitSpeed
      pitch = Math.min(spec.pitchMax, Math.max(spec.pitchMin, pitch + dy * spec.orbitSpeed * 0.7))
    },
    update(camera, target, heading, dt) {
      if (api.mode === 'stand') {
        goal.set(...spec.standPosition)
        goalLook.copy(target).lerp(new THREE.Vector3(0, 0, 0), 0.35)
      } else if (api.mode === 'garage') {
        turntable += dt * 0.35
        goal.set(Math.cos(turntable) * 8.5, 2.6, Math.sin(turntable) * 8.5).add(target)
        goalLook.copy(target).add(new THREE.Vector3(0, 0.2, 0))
      } else {
        const yaw = Math.atan2(heading.x, heading.z) + yawOffset
        const distance = spec.chaseDistance * Math.cos(pitch)
        goal.set(target.x - Math.sin(yaw) * distance, target.y + spec.chaseHeight * (0.6 + pitch), target.z - Math.cos(yaw) * distance)
        goalLook.copy(target).addScaledVector(heading, spec.lookAhead).add(new THREE.Vector3(0, 0.8, 0))
        yawOffset *= Math.max(0, 1 - dt * 0.8)
      }
      if (goal.y < 0.8) goal.y = 0.8
      if (snapNext) {
        position.copy(goal)
        look.copy(goalLook)
        positionVelocity.set(0, 0, 0)
        lookVelocity.set(0, 0, 0)
        snapNext = false
      } else {
        const stiffness = api.mode === 'garage' ? 2.5 : spec.stiffness
        for (const axis of ['x', 'y', 'z'] as const) {
          const [p, pv] = springStep(position[axis], positionVelocity[axis], goal[axis], stiffness, dt)
          position[axis] = p
          positionVelocity[axis] = pv
          const [l, lv] = springStep(look[axis], lookVelocity[axis], goalLook[axis], stiffness * 1.6, dt)
          look[axis] = l
          lookVelocity[axis] = lv
        }
      }
      camera.position.copy(position)
      camera.lookAt(look)
    },
    snap() {
      snapNext = true
    },
  }
  return api
}
