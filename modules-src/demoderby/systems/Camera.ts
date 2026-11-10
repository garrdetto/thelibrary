/** Chase camera with a critically damped spring, pointer orbit, a grandstand view and the slow garage turntable. */
import * as THREE from 'three/webgpu'
import type { ModuleConfig } from '../config'

export type CameraMode = 'chase' | 'stand' | 'garage'

const AXES = ['x', 'y', 'z'] as const

export interface ChaseCamera {
  mode: CameraMode
  setMode(mode: CameraMode): void
  orbit(dx: number, dy: number): void
  /** Moves the camera toward the target pose for this frame. */
  update(camera: THREE.PerspectiveCamera, target: THREE.Vector3, heading: THREE.Vector3, dt: number): void
  snap(): void
  /** Moves the grandstand view (used once the Thrill Park stands around the pad, so the view looks across the pad into the park). */
  setStand(position: readonly [number, number, number]): void
}

const spring = { value: 0, velocity: 0 }
const ORIGIN = new THREE.Vector3()
const view = new THREE.Vector3()
const right = new THREE.Vector3()

function springStep(value: number, velocity: number, target: number, stiffness: number, dt: number): typeof spring {
  const error = value - target
  const k = (velocity + stiffness * error) * dt
  const decay = Math.exp(-stiffness * dt)
  spring.value = target + (error + k) * decay
  spring.velocity = (velocity - stiffness * k) * decay
  return spring
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
  let stand: readonly [number, number, number] = spec.standPosition

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
        goal.set(...stand)
        goalLook.copy(target).lerp(ORIGIN, 0.35)
      } else if (api.mode === 'garage') {
        turntable += dt * 0.35
        goal.set(Math.cos(turntable) * 7.2, 2.1, Math.sin(turntable) * 7.2).add(target)
        view.copy(target).sub(goal).setY(0).normalize()
        right.set(-view.z, 0, view.x)
        const landscape = camera.aspect > 1.15
        goalLook.copy(target).addScaledVector(right, landscape ? -2.3 : 0)
        goalLook.y += landscape ? 0.2 : -0.9
      } else {
        const yaw = Math.atan2(heading.x, heading.z) + yawOffset
        const distance = spec.chaseDistance * Math.cos(pitch)
        goal.set(target.x - Math.sin(yaw) * distance, target.y + spec.chaseHeight * (0.6 + pitch), target.z - Math.cos(yaw) * distance)
        goalLook.copy(target).addScaledVector(heading, spec.lookAhead)
        goalLook.y += 0.8
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
        for (const axis of AXES) {
          const p = springStep(position[axis], positionVelocity[axis], goal[axis], stiffness, dt)
          position[axis] = p.value
          positionVelocity[axis] = p.velocity
          const l = springStep(look[axis], lookVelocity[axis], goalLook[axis], stiffness * 1.6, dt)
          look[axis] = l.value
          lookVelocity[axis] = l.velocity
        }
      }
      camera.position.copy(position)
      camera.lookAt(look)
    },
    snap() {
      snapNext = true
    },
    setStand(next) {
      stand = next
      if (api.mode === 'stand') snapNext = true
    },
  }
  return api
}
