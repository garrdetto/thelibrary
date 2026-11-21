/** The throw. Aiming: tap or click the board to put the target there, or drag it (a press within `grabRadiusPx` of the target picks it up where it is and moves it by the drag; anywhere else the target jumps under the press and then follows); arrow keys nudge it (Shift for fine steps). The stage only aims: it never starts or stops a meter. Throwing: hold the Throw button (or Space, or Enter on the focused button) and a power meter swings from soft to hard and back; let go to throw at the speed it shows. The meter fades green → yellow → red: the exact middle of the green lands on the aim point, anywhere in the green within seven holes of it, and the further out you let go the further it can miss (`meterReach` in shared/Physics); in the red it also drops (early) or rises (late). With `cross` on (the cross meter, the default; the administrator can also offer or require the classic meter, `meter.classic` in shared/Settings) letting go only locks the height: a side meter then sweeps left and right, and the next press of Throw or Space stops it and throws, missing left or right by where it stopped (`crossMiss`). A right-click, Escape, a cancelled touch on the button or the window losing focus drops the throw. */
import * as THREE from 'three/webgpu'
import { config } from '../config'
import { BULL_HEIGHT } from '../shared/Board'
import type { ThrowIntent } from '../shared/interfaces'
import { IDEAL_SPEED, MAX_AIM, MAX_SPEED, METER, MIN_SPEED } from '../shared/Physics'
import { dragAim, grabsTarget, startAimDrag, throwButtonText, throwStep, type AimDrag, type BoardPoint, type ThrowPhase } from './ThrowControl'

export interface ThrowInputHandlers {
  aim(x: number, y: number): void
  /** Live launch speed while the power meter is charging, null when idle. */
  power(speed: number | null): void
  /** Live side reading while the cross meter's side sweep runs, null when it isn't. */
  side(side: number | null): void
  release(intent: ThrowIntent): void
}

type Source = 'button' | 'key'

const gesture = config.gesture
const OTHER_CONTROLS = 'button, a, summary, [data-ui], [role="button"]'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** The power meter's position after holding for `seconds`: 0 → 1 → 0 every `chargeSeconds` (the admin's swing time, put into `config.gesture` at boot). */
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

/** The cross meter's side reading after sweeping for `seconds`: from the far left to the far right and back every `chargeSeconds`. */
export function sideFromSweep(seconds: number): number {
  return METER.sideRange * (chargeLevel(seconds) * 2 - 1)
}

export class ThrowInput {
  /** Whether the session takes a throw from this screen right now: the button, Space and the stage only work while it is on (`setTurn`). */
  enabled = false
  /** The cross meter: a height lock, then a side sweep. Off is the classic one-stage meter. */
  cross = true
  aimX = 0
  aimY = 0.103
  private charging: Source | null = null
  private chargeStart = 0
  private chargeFrame = 0
  /** The speed the meter is showing right now, so a release throws exactly what the player saw rather than the speed a moment later. */
  private shownSpeed: number | null = null
  /** The cross meter's second stage: the locked speed and the side sweep. */
  private sweep: { speed: number; start: number; frame: number; side: number } | null = null
  /** The pointer holding the Throw button, and the key (Space, or Enter on the button) held for a throw. */
  private buttonPointer: number | null = null
  private heldKey: string | null = null
  /** The pointer moving the target on the stage and its drag. */
  private aimPointer: number | null = null
  private drag: AimDrag | null = null
  private readonly raycaster = new THREE.Raycaster()
  private readonly ndc = new THREE.Vector2()
  private readonly hit = new THREE.Vector3()
  private readonly projected = new THREE.Vector3()
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
  /** The latest pointer position waiting to move the target; pointer moves are folded into one aim update per frame, because high-rate mice send several per frame and each aim re-solves the flight. */
  private pendingAim: BoardPoint | null = null
  private aimFrame = 0
  private buttonShown: boolean | null = null
  private buttonReady: boolean | null = null
  private buttonText = ''
  private readonly buttonLabel: HTMLElement | null
  private readonly buttonSub: HTMLElement | null

  constructor(
    private readonly element: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly handlers: ThrowInputHandlers,
    private readonly button: HTMLButtonElement | null = null,
  ) {
    element.addEventListener('pointerdown', this.onStageDown)
    element.addEventListener('pointermove', this.onStageMove)
    element.addEventListener('pointerup', this.onStageUp)
    element.addEventListener('pointercancel', this.onStageCancel)
    element.addEventListener('lostpointercapture', this.onStageCancel)
    element.addEventListener('contextmenu', this.onStageContext)
    this.buttonLabel = button?.querySelector<HTMLElement>('[data-throw-label]') ?? null
    this.buttonSub = button?.querySelector<HTMLElement>('[data-throw-sub]') ?? null
    if (button) {
      button.addEventListener('pointerdown', this.onButtonDown)
      button.addEventListener('pointerup', this.onButtonUp)
      button.addEventListener('pointercancel', this.onButtonCancel)
      button.addEventListener('lostpointercapture', this.onButtonCancel)
      button.addEventListener('contextmenu', this.onButtonContext)
    }
    addEventListener('keydown', this.onKeyDown)
    addEventListener('keyup', this.onKeyUp)
    addEventListener('blur', this.onBlur)
    this.refreshButton()
  }

  setAim(x: number, y: number): void {
    this.aimX = clamp(x, -MAX_AIM, MAX_AIM)
    this.aimY = clamp(y, -MAX_AIM, MAX_AIM)
    this.handlers.aim(this.aimX, this.aimY)
  }

  /** Called every frame: `shown` is whether it is a person's turn at this screen (the Throw button shows), `enabled` whether the session takes a throw right now (the button works; it stays on screen, dimmed, while a dart is in the air). */
  setTurn(shown: boolean, enabled: boolean): void {
    this.enabled = enabled
    const button = this.button
    if (button && shown !== this.buttonShown) {
      this.buttonShown = shown
      button.classList.toggle('is-away', !shown)
    }
    if (button && enabled !== this.buttonReady) {
      this.buttonReady = enabled
      button.setAttribute('aria-disabled', String(!enabled))
    }
    this.refreshButton()
  }

  get phase(): ThrowPhase {
    return this.charging ? 'charging' : this.sweep ? 'sweeping' : 'idle'
  }

  get holding(): boolean {
    return this.charging !== null || this.sweep !== null
  }

  private boardPoint(clientX: number, clientY: number): BoardPoint | null {
    const rect = this.element.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null
    return { x: this.hit.x, y: this.hit.y - BULL_HEIGHT }
  }

  /** The target's position on screen in client pixels. */
  private targetOnScreen(): BoardPoint | null {
    const rect = this.element.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    this.projected.set(this.aimX, this.aimY + BULL_HEIGHT, 0).project(this.camera)
    return { x: rect.left + ((this.projected.x + 1) / 2) * rect.width, y: rect.top + ((1 - this.projected.y) / 2) * rect.height }
  }

  private readonly flushAim = (): void => {
    if (this.aimFrame) cancelAnimationFrame(this.aimFrame)
    this.aimFrame = 0
    const pending = this.pendingAim
    this.pendingAim = null
    if (!pending || !this.drag || !this.enabled || this.sweep) return
    const point = this.boardPoint(pending.x, pending.y)
    if (!point) return
    const aim = dragAim(this.drag, point)
    this.setAim(aim.x, aim.y)
  }

  private endAimDrag(): void {
    const pointer = this.aimPointer
    this.aimPointer = null
    this.drag = null
    if (pointer === null) return
    try {
      if (this.element.hasPointerCapture(pointer)) this.element.releasePointerCapture(pointer)
    } catch {
      /* released */
    }
  }

  private readonly onStageDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      if (event.button === 2 && this.holding) this.interrupt()
      return
    }
    if (!this.enabled || this.sweep || this.aimPointer !== null) return
    if ((event.target as HTMLElement | null)?.closest?.(OTHER_CONTROLS)) return
    const point = this.boardPoint(event.clientX, event.clientY)
    if (!point) return
    event.preventDefault()
    const grab = grabsTarget(this.targetOnScreen(), { x: event.clientX, y: event.clientY }, gesture.grabRadiusPx)
    this.aimPointer = event.pointerId
    this.drag = startAimDrag({ x: this.aimX, y: this.aimY }, point, grab)
    try {
      this.element.setPointerCapture(event.pointerId)
    } catch {
      /* not capturable */
    }
    if (!grab) this.setAim(point.x, point.y)
  }

  private readonly onStageMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.aimPointer) return
    this.pendingAim = { x: event.clientX, y: event.clientY }
    if (!this.aimFrame) this.aimFrame = requestAnimationFrame(this.flushAim)
  }

  private readonly onStageUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.aimPointer) return
    this.pendingAim = { x: event.clientX, y: event.clientY }
    this.flushAim()
    this.endAimDrag()
  }

  /** A cancelled touch on the board only ends the drag: the target stays where it was last put. */
  private readonly onStageCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.aimPointer) return
    this.pendingAim = null
    this.endAimDrag()
  }

  /** No context menu over the board on a person's turn. A long press on a touch screen can raise one, which must not drop a throw held on the button, so a right-click drops it in `onStageDown` instead. */
  private readonly onStageContext = (event: Event): void => {
    if (this.enabled || this.holding || this.aimPointer !== null) event.preventDefault()
  }

  private readonly onButtonDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      if (event.button === 2 && this.holding) this.interrupt()
      return
    }
    event.preventDefault()
    if (this.buttonPointer !== null || !this.enabled) return
    this.buttonPointer = event.pointerId
    try {
      this.button?.setPointerCapture(event.pointerId)
    } catch {
      /* not capturable */
    }
    this.act('press', 'button')
  }

  private readonly onButtonUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.buttonPointer) return
    this.buttonPointer = null
    this.act('release', 'button')
  }

  /** The finger was taken by the browser (or the button vanished under it) before it let go: the throw is dropped, never thrown. */
  private readonly onButtonCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.buttonPointer) return
    this.buttonPointer = null
    if (this.charging === 'button') this.interrupt()
    else this.refreshButton()
  }

  private readonly onButtonContext = (event: Event): void => {
    event.preventDefault()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null
    if (target?.closest?.('input, select, textarea')) return
    const onButton = !!this.button && !!target && this.button.contains(target)
    const onOther = !onButton && !!target?.closest?.(OTHER_CONTROLS)
    const throwKey = event.code === 'Space' || (onButton && (event.code === 'Enter' || event.code === 'NumpadEnter'))
    if (throwKey) {
      if (onOther || (!this.enabled && !this.heldKey)) return
      event.preventDefault()
      if (event.repeat || this.heldKey) return
      this.heldKey = event.code
      this.act('press', 'key')
      return
    }
    if (!this.enabled) return
    if (event.code === 'Escape' && this.holding) {
      this.interrupt()
      return
    }
    const step = event.shiftKey ? gesture.keyboardFineM : gesture.keyboardStepM
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const move = moves[event.code]
    if (move && !this.sweep) {
      event.preventDefault()
      this.setAim(this.aimX + move[0], this.aimY + move[1])
    }
  }

  /** Letting go of the throw key; its default is stopped too, so Space or Enter on the focused Throw button never fires the button's own click as a second press. */
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== this.heldKey) return
    event.preventDefault()
    this.heldKey = null
    this.act('release', 'key')
  }

  private readonly onBlur = (): void => {
    this.heldKey = null
    this.buttonPointer = null
    if (this.holding) this.interrupt()
    this.pendingAim = null
    this.endAimDrag()
    this.refreshButton()
  }

  /** Runs one press or release of Throw through `throwStep`. */
  private act(action: 'press' | 'release', source: Source): void {
    const phase = this.phase
    const step = throwStep(phase, action, this.cross, this.charging === source)
    if (step === 'charge' && this.enabled) this.startCharge(source)
    else if (step === 'lock' || (step === 'throw' && phase === 'charging')) this.finishCharge()
    else if (step === 'throw') this.finishSweep()
    this.refreshButton()
  }

  /** Starts the power meter: it swings 0 → full → 0 every `chargeSeconds` until the hold ends. */
  private startCharge(source: Source): void {
    this.charging = source
    this.chargeStart = performance.now()
    const tick = () => {
      if (!this.charging) return
      this.shownSpeed = speedFromCharge((performance.now() - this.chargeStart) / 1000)
      this.handlers.power(this.shownSpeed)
      this.chargeFrame = requestAnimationFrame(tick)
    }
    tick()
  }

  /** Ends the hold at the speed the meter is showing (the last drawn frame, not the instant of release, so what you see is what you throw): the cross meter locks it and starts the side sweep, the classic meter throws. */
  private finishCharge(): void {
    if (!this.charging) return
    const speed = this.shownSpeed ?? speedFromCharge((performance.now() - this.chargeStart) / 1000)
    this.charging = null
    this.shownSpeed = null
    cancelAnimationFrame(this.chargeFrame)
    if (this.cross && this.enabled) {
      this.handlers.power(speed)
      this.startSweep(speed)
      return
    }
    this.handlers.power(null)
    if (!this.enabled) return
    this.handlers.release({ aimX: this.aimX, aimY: this.aimY, speed, yaw: 0, wobble: gesture.holdWobble })
  }

  private startSweep(speed: number): void {
    const sweep = { speed, start: performance.now(), frame: 0, side: -METER.sideRange }
    this.sweep = sweep
    const tick = () => {
      if (this.sweep !== sweep) return
      sweep.side = sideFromSweep((performance.now() - sweep.start) / 1000)
      this.handlers.side(sweep.side)
      sweep.frame = requestAnimationFrame(tick)
    }
    tick()
  }

  /** Stops the side sweep where it shows and throws. */
  private finishSweep(): void {
    const sweep = this.sweep
    if (!sweep) return
    this.stopSweep()
    if (!this.enabled) return
    this.handlers.release({ aimX: this.aimX, aimY: this.aimY, speed: sweep.speed, yaw: 0, wobble: gesture.holdWobble, cross: sweep.side })
  }

  private stopSweep(): void {
    if (!this.sweep) return
    cancelAnimationFrame(this.sweep.frame)
    this.sweep = null
    this.handlers.side(null)
    this.handlers.power(null)
  }

  /** Keeps the Throw button's words and pressed look in step with the meters; writes only when something changed. */
  private refreshButton(): void {
    const button = this.button
    if (!button) return
    const phase = this.phase
    const held = this.buttonPointer !== null || this.heldKey !== null
    const key = `${phase}:${this.cross}:${held}`
    if (key === this.buttonText) return
    this.buttonText = key
    const text = throwButtonText(phase, this.cross)
    if (this.buttonLabel) this.buttonLabel.textContent = text.label
    if (this.buttonSub) this.buttonSub.textContent = text.sub
    button.setAttribute('aria-label', text.aria)
    button.classList.toggle('is-held', held)
    button.classList.toggle('is-charging', phase === 'charging')
    button.classList.toggle('is-sweep', phase === 'sweeping')
  }

  /** Drops a hold without throwing (the turn moved on, the pause menu opened, Escape, a right-click or a cancelled touch on the button). */
  interrupt(): void {
    this.stopSweep()
    this.charging = null
    this.shownSpeed = null
    cancelAnimationFrame(this.chargeFrame)
    this.handlers.power(null)
    this.pendingAim = null
    this.endAimDrag()
    this.refreshButton()
  }

  dispose(): void {
    this.interrupt()
    if (this.aimFrame) cancelAnimationFrame(this.aimFrame)
    this.aimFrame = 0
    this.element.removeEventListener('pointerdown', this.onStageDown)
    this.element.removeEventListener('pointermove', this.onStageMove)
    this.element.removeEventListener('pointerup', this.onStageUp)
    this.element.removeEventListener('pointercancel', this.onStageCancel)
    this.element.removeEventListener('lostpointercapture', this.onStageCancel)
    this.element.removeEventListener('contextmenu', this.onStageContext)
    const button = this.button
    if (button) {
      button.removeEventListener('pointerdown', this.onButtonDown)
      button.removeEventListener('pointerup', this.onButtonUp)
      button.removeEventListener('pointercancel', this.onButtonCancel)
      button.removeEventListener('lostpointercapture', this.onButtonCancel)
      button.removeEventListener('contextmenu', this.onButtonContext)
    }
    removeEventListener('keydown', this.onKeyDown)
    removeEventListener('keyup', this.onKeyUp)
    removeEventListener('blur', this.onBlur)
  }
}
