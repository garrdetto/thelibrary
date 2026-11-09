/** A Sims-style camera: orbit around a target on the ground, pan with drag or keys, zoom with the wheel. */
import * as THREE from 'three/webgpu'

const right = new THREE.Vector3()
const forward = new THREE.Vector3()

export class CameraRig {
  readonly target = new THREE.Vector3()
  yaw = 0
  pitch = 0.85
  distance = 26
  private goal = { target: new THREE.Vector3(), yaw: 0, pitch: 0.85, distance: 26 }
  private keys = new Set<string>()
  bounds = { minX: -80, maxX: 80, minZ: -40, maxZ: 40 }
  minDistance = 6
  maxDistance = 70

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly element: HTMLElement) {
    addEventListener('keydown', this.onKey)
    addEventListener('keyup', this.onKey)
    addEventListener('blur', this.onBlur)
    element.addEventListener('wheel', this.onWheel, { passive: false })
  }

  private readonly onKey = (event: KeyboardEvent) => {
    const t = event.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
    if (event.type === 'keydown') this.keys.add(event.code)
    else this.keys.delete(event.code)
  }

  private readonly onBlur = () => {
    this.keys.clear()
  }

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault()
    this.zoom(event.deltaY > 0 ? 1.12 : 1 / 1.12)
  }

  zoom(factor: number): void {
    this.goal.distance = THREE.MathUtils.clamp(this.goal.distance * factor, this.minDistance, this.maxDistance)
  }

  jump(target: THREE.Vector3, yaw: number, distance: number, pitch = 0.85): void {
    this.goal.target.copy(target)
    this.goal.yaw = yaw
    this.goal.distance = distance
    this.goal.pitch = pitch
    this.target.copy(target)
    this.yaw = yaw
    this.distance = distance
    this.pitch = pitch
  }

  focus(target: THREE.Vector3): void {
    this.goal.target.copy(target)
  }

  rotate(dx: number, dy: number): void {
    this.goal.yaw -= dx * 0.008
    this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch + dy * 0.006, 0.25, 1.45)
  }

  /** Moves the target by a screen-space drag, so the ground follows the pointer. */
  pan(dx: number, dy: number): void {
    const scale = this.goal.distance * 0.0016
    right.set(Math.cos(this.goal.yaw), 0, -Math.sin(this.goal.yaw))
    forward.set(-Math.sin(this.goal.yaw), 0, -Math.cos(this.goal.yaw))
    this.goal.target.addScaledVector(right, -dx * scale).addScaledVector(forward, dy * scale)
    this.clampGoal()
  }

  rotateStep(direction: number): void {
    this.goal.yaw += direction * Math.PI / 4
  }

  private clampGoal(): void {
    const t = this.goal.target
    t.x = THREE.MathUtils.clamp(t.x, this.bounds.minX, this.bounds.maxX)
    t.z = THREE.MathUtils.clamp(t.z, this.bounds.minZ, this.bounds.maxZ)
  }

  update(dt: number): void {
    const speed = this.goal.distance * 0.9 * dt
    right.set(Math.cos(this.goal.yaw), 0, -Math.sin(this.goal.yaw))
    forward.set(-Math.sin(this.goal.yaw), 0, -Math.cos(this.goal.yaw))
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.goal.target.addScaledVector(forward, speed)
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.goal.target.addScaledVector(forward, -speed)
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.goal.target.addScaledVector(right, -speed)
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.goal.target.addScaledVector(right, speed)
    if (this.keys.has('KeyQ')) this.goal.yaw += dt * 1.6
    if (this.keys.has('KeyE')) this.goal.yaw -= dt * 1.6
    if (this.keys.has('Equal') || this.keys.has('NumpadAdd')) this.zoom(1 - dt * 1.5)
    if (this.keys.has('Minus') || this.keys.has('NumpadSubtract')) this.zoom(1 + dt * 1.5)
    this.clampGoal()
    const k = 1 - Math.exp(-dt * 10)
    this.target.lerp(this.goal.target, k)
    this.yaw += (this.goal.yaw - this.yaw) * k
    this.pitch += (this.goal.pitch - this.pitch) * k
    this.distance += (this.goal.distance - this.distance) * k
    const horizontal = Math.cos(this.pitch) * this.distance
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * horizontal,
    )
    this.camera.lookAt(this.target)
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey)
    removeEventListener('keyup', this.onKey)
    removeEventListener('blur', this.onBlur)
    this.element.removeEventListener('wheel', this.onWheel)
  }
}
