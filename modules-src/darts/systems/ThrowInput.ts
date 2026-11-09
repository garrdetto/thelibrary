/** The throw gesture. Press on the board to aim (the reticle follows while the pointer moves slowly; touch aims a little above the finger), then flick upward and let go: the upward flick speed sets the launch speed, the sideways drift yaws the dart and a wobbly path makes the release less steady. Keyboard: arrows aim (Shift for fine steps), hold Space and release in the green band. */
import * as THREE from 'three/webgpu'
import { config } from '../config'
import { BULL_HEIGHT } from '../shared/Board'
import type { ThrowIntent } from '../shared/interfaces'
import { IDEAL_SPEED, MAX_AIM, MAX_SPEED, MAX_YAW, MIN_SPEED } from '../shared/Physics'

export interface ThrowInputHandlers {
  aim(x: number, y: number): void
  /** Live launch speed while a flick or a Space charge is under way, null when idle. */
  power(speed: number | null): void
  release(intent: ThrowIntent): void
}

interface Sample {
  t: number
  x: number
  y: number
}

const gesture = config.gesture

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function speedFromFlick(heightsPerSecond: number): number {
  return clamp(gesture.speedBase + gesture.speedGain * heightsPerSecond, MIN_SPEED, MAX_SPEED)
}

/** Charge meter for the keyboard throw: 0 → 1 → 0 over `chargeSeconds`, mapped so the middle of the swing is the ideal speed. */
export function speedFromCharge(seconds: number): number {
  const phase = (seconds / gesture.chargeSeconds) % 1
  const c = phase < 0.5 ? phase * 2 : 2 - phase * 2
  return IDEAL_SPEED * (0.78 + 0.44 * c)
}

export class ThrowInput {
  enabled = false
  aimX = 0
  aimY = 0.103
  private samples: Sample[] = []
  private pointerId: number | null = null
  private flicking = false
  private charging = false
  private chargeStart = 0
  private chargeFrame = 0
  private readonly raycaster = new THREE.Raycaster()
  private readonly ndc = new THREE.Vector2()
  private readonly hit = new THREE.Vector3()
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

  constructor(
    private readonly element: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly handlers: ThrowInputHandlers,
  ) {
    element.addEventListener('pointerdown', this.onDown)
    element.addEventListener('pointermove', this.onMove)
    element.addEventListener('pointerup', this.onUp)
    element.addEventListener('pointercancel', this.onCancel)
    addEventListener('keydown', this.onKeyDown)
    addEventListener('keyup', this.onKeyUp)
  }

  setAim(x: number, y: number): void {
    this.aimX = clamp(x, -MAX_AIM, MAX_AIM)
    this.aimY = clamp(y, -MAX_AIM, MAX_AIM)
    this.handlers.aim(this.aimX, this.aimY)
  }

  private boardPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.element.getBoundingClientRect()
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null
    return { x: this.hit.x, y: this.hit.y - BULL_HEIGHT }
  }

  private aimFrom(event: PointerEvent): void {
    const offset = event.pointerType === 'touch' || event.pointerType === 'pen' ? gesture.touchAimOffsetPx : 0
    const point = this.boardPoint(event.clientX, event.clientY - offset)
    if (point) this.setAim(point.x, point.y)
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (!this.enabled || this.pointerId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return
    if ((event.target as HTMLElement | null)?.closest?.('button, input, select, a, [data-ui]')) return
    event.preventDefault()
    this.pointerId = event.pointerId
    try { this.element.setPointerCapture(event.pointerId) } catch { /* not capturable */ }
    this.flicking = false
    this.samples = [{ t: event.timeStamp, x: event.clientX, y: event.clientY }]
    this.aimFrom(event)
  }

  private upwardSpeed(now: number): { vy: number; vx: number } {
    const height = Math.max(1, this.element.clientHeight)
    const cutoff = now - gesture.sampleWindowMs
    const recent = this.samples.filter((sample) => sample.t >= cutoff)
    if (recent.length < 2) return { vy: 0, vx: 0 }
    const first = recent[0]
    const last = recent[recent.length - 1]
    const dt = Math.max(0.008, (last.t - first.t) / 1000)
    return { vy: -(last.y - first.y) / height / dt, vx: (last.x - first.x) / height / dt }
  }

  private readonly onMove = (event: PointerEvent): void => {
    if (!this.enabled) return
    if (this.pointerId === null) {
      if (event.pointerType === 'mouse') this.aimFrom(event)
      return
    }
    if (event.pointerId !== this.pointerId) return
    this.samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY })
    const cutoff = event.timeStamp - 400
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift()
    const { vy } = this.upwardSpeed(event.timeStamp)
    if (!this.flicking && vy < gesture.aimFreezeSpeed) {
      this.aimFrom(event)
      this.handlers.power(null)
      return
    }
    this.flicking = true
    this.handlers.power(speedFromFlick(Math.max(0, vy)))
  }

  /** How shaky the flick was: the spread of its segment directions, 0 (straight) to 1. */
  private wobble(now: number): number {
    const flick = this.samples.filter((sample) => sample.t >= now - 220)
    if (flick.length < 4) return 0.1
    const angles: number[] = []
    for (let i = 1; i < flick.length; i++) {
      const dx = flick[i].x - flick[i - 1].x
      const dy = flick[i].y - flick[i - 1].y
      if (Math.hypot(dx, dy) > 1.5) angles.push(Math.atan2(dx, -dy))
    }
    if (angles.length < 3) return 0.1
    const mean = angles.reduce((sum, value) => sum + value, 0) / angles.length
    const spread = Math.sqrt(angles.reduce((sum, value) => sum + (value - mean) ** 2, 0) / angles.length)
    return clamp(spread / 0.45, 0, 1)
  }

  private readonly onUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return
    this.samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY })
    const { vy, vx } = this.upwardSpeed(event.timeStamp)
    const wobble = this.wobble(event.timeStamp)
    this.reset()
    if (!this.enabled || vy < gesture.minFlick) return
    const yaw = clamp(Math.atan2(vx, vy) * gesture.yawGain, -MAX_YAW, MAX_YAW)
    this.handlers.release({ aimX: this.aimX, aimY: this.aimY, speed: speedFromFlick(vy), yaw, wobble })
  }

  private readonly onCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.reset()
  }

  private reset(): void {
    if (this.pointerId !== null) {
      try { this.element.releasePointerCapture(this.pointerId) } catch { /* released */ }
    }
    this.pointerId = null
    this.flicking = false
    this.samples = []
    this.handlers.power(null)
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || (event.target as HTMLElement | null)?.closest?.('input, select, textarea')) return
    const step = event.shiftKey ? gesture.keyboardFineM : gesture.keyboardStepM
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const move = moves[event.code]
    if (move) {
      event.preventDefault()
      this.setAim(this.aimX + move[0], this.aimY + move[1])
      return
    }
    if (event.code === 'Space' && !event.repeat && !(event.target as HTMLElement | null)?.closest?.('button')) {
      event.preventDefault()
      this.charging = true
      this.chargeStart = performance.now()
      const tick = () => {
        if (!this.charging) return
        this.handlers.power(speedFromCharge((performance.now() - this.chargeStart) / 1000))
        this.chargeFrame = requestAnimationFrame(tick)
      }
      tick()
    }
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || !this.charging) return
    event.preventDefault()
    this.charging = false
    cancelAnimationFrame(this.chargeFrame)
    this.handlers.power(null)
    if (!this.enabled) return
    const speed = speedFromCharge((performance.now() - this.chargeStart) / 1000)
    this.handlers.release({ aimX: this.aimX, aimY: this.aimY, speed, yaw: 0, wobble: 0.15 })
  }

  /** Stops a Space charge or a held pointer (the turn moved on). */
  interrupt(): void {
    this.charging = false
    cancelAnimationFrame(this.chargeFrame)
    this.reset()
  }

  dispose(): void {
    this.interrupt()
    this.element.removeEventListener('pointerdown', this.onDown)
    this.element.removeEventListener('pointermove', this.onMove)
    this.element.removeEventListener('pointerup', this.onUp)
    this.element.removeEventListener('pointercancel', this.onCancel)
    removeEventListener('keydown', this.onKeyDown)
    removeEventListener('keyup', this.onKeyUp)
  }
}
