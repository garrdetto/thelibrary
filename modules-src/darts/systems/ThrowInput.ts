/** The throw: click (or touch) and hold on the board to aim, and a power meter swings from soft to hard and back; let go to throw at the speed it shows. Dead centre of the green band flies exactly to the aim point; elsewhere in the band the dart scatters more the further from centre you let go, and outside the band releasing early drops it and late lifts it. Moving while holding fine-tunes the aim (touch aims a little above the finger); right-click, Escape or a cancelled touch drops the throw. Keyboard: arrows aim (Shift for fine steps), hold Space and release. */
import * as THREE from 'three/webgpu'
import { config } from '../config'
import { BULL_HEIGHT } from '../shared/Board'
import type { ThrowIntent } from '../shared/interfaces'
import { IDEAL_SPEED, MAX_AIM, MAX_SPEED, MIN_SPEED } from '../shared/Physics'

export interface ThrowInputHandlers {
  aim(x: number, y: number): void
  /** Live launch speed while the power meter is charging, null when idle. */
  power(speed: number | null): void
  release(intent: ThrowIntent): void
}

const gesture = config.gesture

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** The power meter's position after holding for `seconds`: 0 → 1 → 0 every `chargeSeconds`. */
export function chargeLevel(seconds: number): number {
  const phase = (Math.max(0, seconds) / gesture.chargeSeconds) % 1
  return phase < 0.5 ? phase * 2 : 2 - phase * 2
}

/** Launch speed for a meter level: the bottom of the meter is `chargeLow` × ideal, the top `chargeHigh` × ideal, so the ideal speed sits partway up (the green band). */
export function speedFromLevel(level: number): number {
  const low = IDEAL_SPEED * gesture.chargeLow
  const high = IDEAL_SPEED * gesture.chargeHigh
  return clamp(low + (high - low) * clamp(level, 0, 1), MIN_SPEED, MAX_SPEED)
}

export function speedFromCharge(seconds: number): number {
  return speedFromLevel(chargeLevel(seconds))
}

export class ThrowInput {
  enabled = false
  aimX = 0
  aimY = 0.103
  private pointerId: number | null = null
  private pointerType = 'mouse'
  private charging: 'pointer' | 'key' | null = null
  private chargeStart = 0
  private chargeFrame = 0
  /** The speed the meter is showing right now, so a release throws exactly what the player saw rather than a frame later. */
  private shownSpeed: number | null = null
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
    element.addEventListener('contextmenu', this.onContext)
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

  /** Starts the power meter: it swings 0 → full → 0 every `chargeSeconds` until the hold ends. */
  private startCharge(kind: 'pointer' | 'key'): void {
    this.charging = kind
    this.chargeStart = performance.now()
    const tick = () => {
      if (!this.charging) return
      this.shownSpeed = speedFromCharge((performance.now() - this.chargeStart) / 1000)
      this.handlers.power(this.shownSpeed)
      this.chargeFrame = requestAnimationFrame(tick)
    }
    tick()
  }

  /** Ends the hold and throws at the speed the meter is showing (the last drawn frame, not the instant of release, so what you see is what you throw). */
  private finishCharge(): void {
    if (!this.charging) return
    const speed = this.shownSpeed ?? speedFromCharge((performance.now() - this.chargeStart) / 1000)
    this.charging = null
    this.shownSpeed = null
    cancelAnimationFrame(this.chargeFrame)
    this.handlers.power(null)
    if (!this.enabled) return
    this.handlers.release({ aimX: this.aimX, aimY: this.aimY, speed, yaw: 0, wobble: gesture.holdWobble, meter: true })
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (!this.enabled || this.pointerId !== null || this.charging || (event.pointerType === 'mouse' && event.button !== 0)) return
    if ((event.target as HTMLElement | null)?.closest?.('button, input, select, a, [data-ui]')) return
    event.preventDefault()
    this.pointerId = event.pointerId
    this.pointerType = event.pointerType
    try { this.element.setPointerCapture(event.pointerId) } catch { /* not capturable */ }
    this.aimFrom(event)
    this.startCharge('pointer')
  }

  private readonly onMove = (event: PointerEvent): void => {
    if (!this.enabled) return
    if (this.pointerId === null) {
      if (event.pointerType === 'mouse') this.aimFrom(event)
      return
    }
    if (event.pointerId === this.pointerId) this.aimFrom(event)
  }

  private readonly onUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return
    this.releasePointer()
    if (this.charging === 'pointer') this.finishCharge()
  }

  /** A second button (or a cancelled touch) drops the throw without releasing. */
  private readonly onCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.interrupt()
  }

  private readonly onContext = (event: Event): void => {
    if (this.charging === 'pointer') {
      event.preventDefault()
      this.interrupt()
    }
  }

  private releasePointer(): void {
    if (this.pointerId !== null) {
      try { this.element.releasePointerCapture(this.pointerId) } catch { /* released */ }
    }
    this.pointerId = null
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || (event.target as HTMLElement | null)?.closest?.('input, select, textarea')) return
    if (event.code === 'Escape' && this.charging) {
      this.interrupt()
      return
    }
    const step = event.shiftKey ? gesture.keyboardFineM : gesture.keyboardStepM
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const move = moves[event.code]
    if (move) {
      event.preventDefault()
      this.setAim(this.aimX + move[0], this.aimY + move[1])
      return
    }
    if (event.code === 'Space' && !event.repeat && !this.charging && !(event.target as HTMLElement | null)?.closest?.('button')) {
      event.preventDefault()
      this.startCharge('key')
    }
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || this.charging !== 'key') return
    event.preventDefault()
    this.finishCharge()
  }

  /** Drops a hold without throwing (the turn moved on, Escape, or a cancelled touch). */
  interrupt(): void {
    this.charging = null
    this.shownSpeed = null
    cancelAnimationFrame(this.chargeFrame)
    this.releasePointer()
    this.handlers.power(null)
  }

  get holding(): boolean {
    return this.charging !== null
  }

  get pointerKind(): string {
    return this.pointerType
  }

  dispose(): void {
    this.interrupt()
    this.element.removeEventListener('pointerdown', this.onDown)
    this.element.removeEventListener('pointermove', this.onMove)
    this.element.removeEventListener('pointerup', this.onUp)
    this.element.removeEventListener('pointercancel', this.onCancel)
    this.element.removeEventListener('contextmenu', this.onContext)
    removeEventListener('keydown', this.onKeyDown)
    removeEventListener('keyup', this.onKeyUp)
  }
}
