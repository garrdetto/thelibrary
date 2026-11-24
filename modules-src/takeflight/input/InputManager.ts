/**
 * Turns keyboard, mouse and Gamepad API devices (gamepads, yokes, HOTAS, pedals) into the pilot's `ControlInput` each frame.
 * Held keys move the stick and rudder at the binding's key rate and centre them when released; bound axes are shaped by their
 * deadzone and curve and added on top; the throttle is a lever that keys and buttons move and a throttle axis sets outright once
 * it moves. One-shot actions (flaps, gear, view, pause...) are reported through `onAction`. Listeners are removed on `dispose`.
 */
import type { ControlInput } from '../sim/Controls'
import type { AxisAction, Bindings, KeyAction } from './Bindings'
import { AXIS_ACTIONS, loadBindings, saveBindings, shapeAxis } from './Bindings'

export type PilotAction = 'flapsDown' | 'flapsUp' | 'gear' | 'parkingBrake' | 'view' | 'lights' | 'pause' | 'hud' | 'atis' | 'devOverlay' | 'map' | 'tips'

const ONE_SHOT: PilotAction[] = ['flapsDown', 'flapsUp', 'gear', 'parkingBrake', 'view', 'lights', 'pause', 'hud', 'atis', 'devOverlay', 'map', 'tips']
const THROTTLE_RATE = 0.55

export interface AxisCapture {
  device: string
  axis: number
  /** Raw value when captured, to tell one-way levers from centred axes. */
  value: number
}

export class InputManager {
  bindings: Bindings
  /** Camera look offsets from mouse drag, radians. */
  lookYaw = 0
  lookPitch = 0
  /** Accumulated mouse wheel since last read (positive = zoom out). */
  wheel = 0
  readonly held = new Set<string>()
  private readonly heldButtons = new Set<string>()
  private actionListeners: ((action: PilotAction) => void)[] = []
  private keyboardPitch = 0
  private keyboardRoll = 0
  private keyboardYaw = 0
  private throttle = 0
  private lastThrottleRaw = Number.NaN
  private dragging = false
  private lastMouse = { x: 0, y: 0 }
  private mouseStick = { x: 0, y: 0 }
  private readonly teardown: (() => void)[] = []
  private captureAxis: ((capture: AxisCapture) => void) | null = null
  private captureButton: ((device: string, button: number) => void) | null = null
  private captureKey: ((code: string) => void) | null = null
  private baseline = new Map<string, number[]>()
  enabled = true

  constructor(target: HTMLElement) {
    this.bindings = loadBindings()
    const listen = <K extends keyof WindowEventMap>(on: Window | HTMLElement, type: K, handler: (event: WindowEventMap[K]) => void, options?: AddEventListenerOptions) => {
      on.addEventListener(type, handler as EventListener, options)
      this.teardown.push(() => on.removeEventListener(type, handler as EventListener, options))
    }
    listen(window, 'keydown', (event) => this.keyDown(event))
    listen(window, 'keyup', (event) => {
      this.held.delete(event.code)
    })
    listen(window, 'blur', () => this.held.clear())
    listen(target, 'pointerdown', (event) => {
      if (event.button !== 0 && event.button !== 2) return
      this.dragging = true
      this.lastMouse.x = event.clientX
      this.lastMouse.y = event.clientY
      target.setPointerCapture?.(event.pointerId)
    })
    listen(target, 'pointermove', (event) => {
      if (this.bindings.mouseYoke) {
        const rect = target.getBoundingClientRect()
        this.mouseStick.x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2.4))
        this.mouseStick.y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2.4))
      }
      if (!this.dragging) return
      const dx = event.clientX - this.lastMouse.x
      const dy = event.clientY - this.lastMouse.y
      this.lastMouse.x = event.clientX
      this.lastMouse.y = event.clientY
      this.lookYaw -= dx * 0.005
      this.lookPitch = Math.max(-1.3, Math.min(1.3, this.lookPitch - dy * 0.004))
    })
    listen(target, 'pointerup', () => {
      this.dragging = false
    })
    listen(target, 'contextmenu', (event) => event.preventDefault())
    listen(target, 'wheel', (event) => {
      this.wheel += Math.sign(event.deltaY)
      event.preventDefault()
    }, { passive: false })
  }

  onAction(listener: (action: PilotAction) => void): () => void {
    this.actionListeners.push(listener)
    return () => {
      this.actionListeners = this.actionListeners.filter((l) => l !== listener)
    }
  }

  private emit(action: PilotAction): void {
    for (const listener of this.actionListeners) listener(action)
  }

  private keyDown(event: KeyboardEvent): void {
    if (this.captureKey) {
      event.preventDefault()
      const capture = this.captureKey
      this.captureKey = null
      capture(event.code)
      return
    }
    const element = event.target as HTMLElement | null
    if (element && (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA')) return
    const first = !this.held.has(event.code)
    this.held.add(event.code)
    if (event.code.startsWith('Arrow') || event.code === 'Space' || event.code === 'PageUp' || event.code === 'PageDown' || event.code === 'F1' || event.code === 'F4' || event.code === 'F7' || event.code === 'F8') event.preventDefault()
    if (!first || !this.enabled && event.code !== 'Escape') return
    for (const action of ONE_SHOT) {
      if (this.bindings.keys[action]?.includes(event.code)) {
        if (action === 'pause' || this.enabled) this.emit(action)
      }
    }
  }

  private keyHeld(action: KeyAction): boolean {
    const codes = this.bindings.keys[action]
    if (!codes) return false
    for (const code of codes) if (this.held.has(code)) return true
    return false
  }

  private buttonHeld(action: string): boolean {
    return this.heldButtons.has(action)
  }

  /** Gamepads currently connected. */
  pads(): Gamepad[] {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return []
    return navigator.getGamepads().filter((pad): pad is Gamepad => pad !== null && pad.connected)
  }

  private axisValue(action: AxisAction, pads: Gamepad[]): number | null {
    const list = this.bindings.axes[action] ?? []
    let total: number | null = null
    for (const binding of list) {
      for (const pad of pads) {
        if (binding.device && !pad.id.includes(binding.device)) continue
        const raw = pad.axes[binding.axis]
        if (raw === undefined) continue
        const value = shapeAxis(raw, binding)
        total = (total ?? 0) + value
        break
      }
    }
    return total
  }

  /** Starts listening for the next moved axis (any device); resolves through `done`. */
  captureNextAxis(done: (capture: AxisCapture) => void): void {
    this.baseline.clear()
    for (const pad of this.pads()) this.baseline.set(pad.id, [...pad.axes])
    this.captureAxis = done
  }

  captureNextButton(done: (device: string, button: number) => void): void {
    this.captureButton = done
    this.baseline.clear()
    for (const pad of this.pads()) this.baseline.set(`${pad.id}#buttons`, pad.buttons.map((b) => b.value))
  }

  captureNextKey(done: (code: string) => void): void {
    this.captureKey = done
  }

  cancelCapture(): void {
    this.captureAxis = null
    this.captureButton = null
    this.captureKey = null
  }

  save(): void {
    saveBindings(this.bindings)
  }

  /** Sets the throttle lever (used when a flight starts). */
  setThrottle(value: number): void {
    this.throttle = Math.max(0, Math.min(1, value))
  }

  /** Reads every device and writes the pilot's input. `flapDetents` is the aircraft's detent count. */
  update(dt: number, out: ControlInput, flapDetents: number): void {
    const pads = this.pads()
    this.pollCaptures(pads)
    this.pollButtons(pads)
    if (!this.enabled) return
    const rate = this.bindings.keyRate * dt
    const centre = rate * 1.6
    const drive = (current: number, positive: boolean, negative: boolean) => {
      if (positive && !negative) return Math.min(1, current + rate)
      if (negative && !positive) return Math.max(-1, current - rate)
      if (current > 0) return Math.max(0, current - centre)
      return Math.min(0, current + centre)
    }
    this.keyboardPitch = drive(this.keyboardPitch, this.keyHeld('pitchUp'), this.keyHeld('pitchDown'))
    this.keyboardRoll = drive(this.keyboardRoll, this.keyHeld('rollRight'), this.keyHeld('rollLeft'))
    this.keyboardYaw = drive(this.keyboardYaw, this.keyHeld('yawRight'), this.keyHeld('yawLeft'))
    let pitch = this.keyboardPitch + (this.axisValue('pitch', pads) ?? 0)
    let roll = this.keyboardRoll + (this.axisValue('roll', pads) ?? 0)
    const yaw = this.keyboardYaw + (this.axisValue('yaw', pads) ?? 0)
    if (this.bindings.mouseYoke) {
      pitch += this.mouseStick.y
      roll += this.mouseStick.x
    }
    out.pitch = Math.max(-1, Math.min(1, pitch))
    out.roll = Math.max(-1, Math.min(1, roll))
    out.yaw = Math.max(-1, Math.min(1, yaw))
    if (this.keyHeld('throttleUp') || this.buttonHeld('throttleUp')) this.throttle = Math.min(1, this.throttle + THROTTLE_RATE * dt)
    if (this.keyHeld('throttleDown') || this.buttonHeld('throttleDown')) this.throttle = Math.max(0, this.throttle - THROTTLE_RATE * dt)
    if (this.keyHeld('throttleIdle')) this.throttle = 0
    if (this.keyHeld('throttleFull')) this.throttle = 1
    const throttleAxis = this.axisValue('throttle', pads)
    if (throttleAxis !== null) {
      if (Number.isNaN(this.lastThrottleRaw) || Math.abs(throttleAxis - this.lastThrottleRaw) > 0.015) {
        this.throttle = Math.max(0, Math.min(1, throttleAxis))
        this.lastThrottleRaw = throttleAxis
      }
    }
    out.throttle = this.throttle
    const brakes = this.keyHeld('brakes') || this.buttonHeld('brakes') ? 1 : 0
    out.brakeLeft = Math.max(brakes, Math.min(1, this.axisValue('brakeLeft', pads) ?? 0))
    out.brakeRight = Math.max(brakes, Math.min(1, this.axisValue('brakeRight', pads) ?? 0))
    out.trim = this.keyHeld('trimUp') || this.buttonHeld('trimUp') ? 1 : this.keyHeld('trimDown') || this.buttonHeld('trimDown') ? -1 : 0
    out.spoilers = this.keyHeld('spoilers') || this.buttonHeld('spoilers') ? 1 : 0
    out.reverse = this.keyHeld('reverse') || this.buttonHeld('reverse') ? 1 : 0
    out.flaps = Math.max(0, Math.min(flapDetents - 1, out.flaps))
  }

  private pollButtons(pads: Gamepad[]): void {
    const now = new Set<string>()
    for (const [action, list] of Object.entries(this.bindings.buttons)) {
      for (const binding of list) {
        for (const pad of pads) {
          if (binding.device && !pad.id.includes(binding.device)) continue
          const button = pad.buttons[binding.button]
          if (button && (button.pressed || button.value > 0.5)) now.add(action)
        }
      }
    }
    for (const action of now) {
      if (!this.heldButtons.has(action) && (ONE_SHOT as string[]).includes(action)) {
        if (action === 'pause' || this.enabled) this.emit(action as PilotAction)
      }
    }
    this.heldButtons.clear()
    for (const action of now) this.heldButtons.add(action)
  }

  private pollCaptures(pads: Gamepad[]): void {
    if (this.captureAxis) {
      for (const pad of pads) {
        const base = this.baseline.get(pad.id) ?? pad.axes.map(() => 0)
        for (let axis = 0; axis < pad.axes.length; axis++) {
          if (Math.abs(pad.axes[axis] - (base[axis] ?? 0)) > 0.5) {
            const done = this.captureAxis
            this.captureAxis = null
            done({ device: pad.id, axis, value: pad.axes[axis] })
            return
          }
        }
      }
    }
    if (this.captureButton) {
      for (const pad of pads) {
        const base = this.baseline.get(`${pad.id}#buttons`) ?? []
        for (let button = 0; button < pad.buttons.length; button++) {
          if (pad.buttons[button].value > 0.6 && (base[button] ?? 0) < 0.3) {
            const done = this.captureButton
            this.captureButton = null
            done(pad.id, button)
            return
          }
        }
      }
    }
  }

  /** True while the look-around key is held. */
  get lookHeld(): boolean {
    return this.keyHeld('lookBack')
  }

  dispose(): void {
    for (const off of this.teardown) off()
    this.teardown.length = 0
    this.actionListeners = []
  }
}

export { AXIS_ACTIONS }
