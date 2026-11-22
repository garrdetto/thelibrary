/**
 * Keyboard state for Truck Simulator, recorded as `KeyboardEvent.code` values, the same codes Life Sim's `GameHost.keys` holds, so
 * the core can later read the host's key set unchanged. Events aimed at text fields are ignored, the default action of the bound
 * driving keys is blocked only while the canvas has focus or the pointer, and everything is released when the window loses focus
 * or the page is hidden so a key never sticks. `BINDINGS` lists every action with its codes and a label for the pause menu.
 */

export type KeyAction =
  | 'throttle' | 'brake' | 'steerLeft' | 'steerRight' | 'parkingBrake' | 'engineBrake' | 'shiftUp' | 'shiftDown'
  | 'interact' | 'coupler' | 'landingGear' | 'dumpRaise' | 'dumpLower' | 'liftAxles' | 'headlights' | 'horn'
  | 'camera' | 'jobBoard' | 'map' | 'fleet' | 'buildMode' | 'pause'

export type KeyGroup = 'drive' | 'rig' | 'menu'

export interface KeyBinding {
  action: KeyAction
  codes: readonly string[]
  label: string
  group: KeyGroup
}

export const BINDINGS: readonly KeyBinding[] = [
  { action: 'throttle', codes: ['KeyW', 'ArrowUp'], label: 'Accelerate', group: 'drive' },
  { action: 'brake', codes: ['KeyS', 'ArrowDown'], label: 'Brake / reverse', group: 'drive' },
  { action: 'steerLeft', codes: ['KeyA', 'ArrowLeft'], label: 'Steer left', group: 'drive' },
  { action: 'steerRight', codes: ['KeyD', 'ArrowRight'], label: 'Steer right', group: 'drive' },
  { action: 'parkingBrake', codes: ['Space'], label: 'Parking brake', group: 'drive' },
  { action: 'engineBrake', codes: ['KeyB'], label: 'Engine brake', group: 'drive' },
  { action: 'shiftUp', codes: ['ShiftLeft', 'PageUp'], label: 'Shift up', group: 'drive' },
  { action: 'shiftDown', codes: ['ControlLeft', 'PageDown'], label: 'Shift down', group: 'drive' },
  { action: 'horn', codes: ['KeyH'], label: 'Horn', group: 'drive' },
  { action: 'headlights', codes: ['KeyL'], label: 'Headlights', group: 'drive' },
  { action: 'camera', codes: ['KeyC'], label: 'Change camera', group: 'drive' },
  { action: 'interact', codes: ['KeyE'], label: 'Interact / get in or out', group: 'rig' },
  { action: 'coupler', codes: ['KeyT'], label: 'Couple or uncouple trailer', group: 'rig' },
  { action: 'landingGear', codes: ['KeyG'], label: 'Landing gear', group: 'rig' },
  { action: 'dumpRaise', codes: ['KeyR'], label: 'Raise dump bed', group: 'rig' },
  { action: 'dumpLower', codes: ['KeyF'], label: 'Lower dump bed', group: 'rig' },
  { action: 'liftAxles', codes: ['KeyX'], label: 'Lift or lower spare axles', group: 'rig' },
  { action: 'jobBoard', codes: ['KeyJ'], label: 'Job board', group: 'menu' },
  { action: 'map', codes: ['KeyM'], label: 'Map', group: 'menu' },
  { action: 'fleet', codes: ['KeyO'], label: 'Fleet and garage', group: 'menu' },
  { action: 'buildMode', codes: ['KeyY'], label: 'Build mode', group: 'menu' },
  { action: 'pause', codes: ['Escape'], label: 'Pause menu', group: 'menu' },
]

const BINDING_BY_ACTION = new Map<KeyAction, KeyBinding>(BINDINGS.map((binding) => [binding.action, binding]))
const PREVENT_DEFAULT_CODES = new Set<string>(BINDINGS.filter((binding) => binding.group !== 'menu').flatMap((binding) => binding.codes))

export interface KeysOptions {
  canvas?: HTMLElement
}

interface TextTargetLike {
  tagName?: string
  isContentEditable?: boolean
}

function isTextTarget(target: EventTarget | null): boolean {
  const element = target as TextTargetLike | null
  if (!element) return false
  const tag = element.tagName?.toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true
}

/** Tracks held keys with per-frame press and release edges. Call `endFrame()` once per frame after reading. */
export class Keys {
  private readonly held = new Set<string>()
  private readonly pressedEdges = new Set<string>()
  private readonly releasedEdges = new Set<string>()
  private readonly target: EventTarget
  private readonly canvas: HTMLElement | null
  private canvasActive = false

  constructor(target: EventTarget, options: KeysOptions = {}) {
    this.target = target
    this.canvas = options.canvas ?? null
    target.addEventListener('keydown', this.onKeyDown as EventListener)
    target.addEventListener('keyup', this.onKeyUp as EventListener)
    if (typeof window !== 'undefined') window.addEventListener('blur', this.releaseAll)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility)
    if (this.canvas) {
      this.canvas.addEventListener('pointerenter', this.onCanvasEnter)
      this.canvas.addEventListener('pointerleave', this.onCanvasLeave)
      this.canvas.addEventListener('focus', this.onCanvasEnter)
      this.canvas.addEventListener('blur', this.onCanvasLeave)
    }
  }

  /** The held codes, the same shape as Life Sim's `GameHost.keys`. */
  get codes(): ReadonlySet<string> {
    return this.held
  }

  down(code: string): boolean {
    return this.held.has(code)
  }

  pressed(code: string): boolean {
    return this.pressedEdges.has(code)
  }

  released(code: string): boolean {
    return this.releasedEdges.has(code)
  }

  actionDown(action: KeyAction): boolean {
    return this.anyIn(action, this.held)
  }

  actionPressed(action: KeyAction): boolean {
    return this.anyIn(action, this.pressedEdges)
  }

  actionReleased(action: KeyAction): boolean {
    return this.anyIn(action, this.releasedEdges)
  }

  endFrame(): void {
    this.pressedEdges.clear()
    this.releasedEdges.clear()
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown as EventListener)
    this.target.removeEventListener('keyup', this.onKeyUp as EventListener)
    if (typeof window !== 'undefined') window.removeEventListener('blur', this.releaseAll)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility)
    if (this.canvas) {
      this.canvas.removeEventListener('pointerenter', this.onCanvasEnter)
      this.canvas.removeEventListener('pointerleave', this.onCanvasLeave)
      this.canvas.removeEventListener('focus', this.onCanvasEnter)
      this.canvas.removeEventListener('blur', this.onCanvasLeave)
    }
    this.held.clear()
    this.pressedEdges.clear()
    this.releasedEdges.clear()
  }

  private anyIn(action: KeyAction, set: ReadonlySet<string>): boolean {
    const binding = BINDING_BY_ACTION.get(action)
    if (!binding) return false
    for (const code of binding.codes) if (set.has(code)) return true
    return false
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTextTarget(event.target)) return
    if (PREVENT_DEFAULT_CODES.has(event.code) && (this.canvas === null || this.canvasActive)) event.preventDefault()
    if (this.held.has(event.code)) return
    this.held.add(event.code)
    this.pressedEdges.add(event.code)
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (isTextTarget(event.target)) return
    if (!this.held.delete(event.code)) return
    this.releasedEdges.add(event.code)
  }

  private readonly releaseAll = (): void => {
    for (const code of this.held) this.releasedEdges.add(code)
    this.held.clear()
  }

  private readonly onVisibility = (): void => {
    if (typeof document !== 'undefined' && document.hidden) this.releaseAll()
  }

  private readonly onCanvasEnter = (): void => {
    this.canvasActive = true
  }

  private readonly onCanvasLeave = (): void => {
    this.canvasActive = false
  }
}
