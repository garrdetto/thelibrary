/** Keyboard, mouse, touch and gamepad input read through a rebindable action map supplied by the module config. */
import type { ActionBindings, InputBinding, InputConfig } from '../config'

export interface PointerState {
  x: number
  y: number
  dx: number
  dy: number
  wheel: number
  down: boolean
  locked: boolean
}

interface TouchPoint {
  x: number
  y: number
}

export class Input<A extends string> {
  readonly pointer: PointerState = { x: 0, y: 0, dx: 0, dy: 0, wheel: 0, down: false, locked: false }
  private bindingsMap: Record<A, readonly InputBinding[]>
  private readonly keys = new Set<string>()
  private readonly keyTaps = new Set<string>()
  private readonly mouseButtons = new Set<number>()
  private readonly mouseTaps = new Set<number>()
  private readonly touches = new Map<number, TouchPoint>()
  private readonly touchTaps: TouchPoint[] = []
  private readonly boundKeys = new Set<string>()
  private previous = new Map<A, number>()
  private current = new Map<A, number>()
  private pendingDx = 0
  private pendingDy = 0
  private pendingWheel = 0

  constructor(
    private readonly target: HTMLElement,
    bindings: ActionBindings<A>,
    private readonly config: InputConfig,
  ) {
    this.bindingsMap = { ...bindings } as Record<A, readonly InputBinding[]>
    this.indexKeys()
    addEventListener('keydown', this.onKeyDown)
    addEventListener('keyup', this.onKeyUp)
    addEventListener('blur', this.onBlur)
    target.addEventListener('pointerdown', this.onPointerDown)
    addEventListener('pointerup', this.onPointerUp)
    addEventListener('pointercancel', this.onPointerUp)
    target.addEventListener('pointermove', this.onPointerMove)
    target.addEventListener('wheel', this.onWheel, { passive: true })
    target.addEventListener('contextmenu', this.onContextMenu)
    document.addEventListener('pointerlockchange', this.onLockChange)
  }

  get actions(): A[] {
    return Object.keys(this.bindingsMap) as A[]
  }

  bindings(action: A): readonly InputBinding[] {
    return this.bindingsMap[action] ?? []
  }

  rebind(action: A, bindings: readonly InputBinding[]): void {
    this.bindingsMap[action] = bindings
    this.indexKeys()
  }

  update(): void {
    this.previous = this.current
    this.current = new Map()
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    for (const action of this.actions) {
      let value = 0
      for (const binding of this.bindingsMap[action]) value = Math.max(value, this.read(binding, pads))
      this.current.set(action, value)
    }
    this.keyTaps.clear()
    this.mouseTaps.clear()
    this.touchTaps.length = 0
    this.pointer.dx = this.pendingDx
    this.pointer.dy = this.pendingDy
    this.pointer.wheel = this.pendingWheel
    this.pendingDx = 0
    this.pendingDy = 0
    this.pendingWheel = 0
  }

  value(action: A): number {
    return this.current.get(action) ?? 0
  }

  isDown(action: A): boolean {
    return this.value(action) > 0
  }

  pressed(action: A): boolean {
    return this.value(action) > 0 && (this.previous.get(action) ?? 0) === 0
  }

  released(action: A): boolean {
    return this.value(action) === 0 && (this.previous.get(action) ?? 0) > 0
  }

  axis(negative: A, positive: A): number {
    return this.value(positive) - this.value(negative)
  }

  lockPointer(): void {
    void this.target.requestPointerLock?.()
  }

  private read(binding: InputBinding, pads: readonly (Gamepad | null)[]): number {
    switch (binding.kind) {
      case 'key':
        return this.keys.has(binding.code) || this.keyTaps.has(binding.code) ? 1 : 0
      case 'mouse':
        return this.mouseButtons.has(binding.button) || this.mouseTaps.has(binding.button) ? 1 : 0
      case 'pad': {
        let value = 0
        for (const pad of pads) if (pad?.buttons[binding.button]) value = Math.max(value, pad.buttons[binding.button].value)
        return value
      }
      case 'axis': {
        let value = 0
        for (const pad of pads) {
          const raw = (pad?.axes[binding.axis] ?? 0) * binding.direction
          if (raw > this.config.padDeadzone) value = Math.max(value, (raw - this.config.padDeadzone) / (1 - this.config.padDeadzone))
        }
        return value
      }
      case 'touch': {
        const [x0, y0, x1, y1] = binding.region
        const inside = (point: TouchPoint) => point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1
        for (const point of this.touches.values()) if (inside(point)) return 1
        return this.touchTaps.some(inside) ? 1 : 0
      }
    }
  }

  private indexKeys(): void {
    this.boundKeys.clear()
    for (const action of this.actions) for (const binding of this.bindingsMap[action]) if (binding.kind === 'key') this.boundKeys.add(binding.code)
  }

  private normalized(event: PointerEvent): TouchPoint {
    const rect = this.target.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / Math.max(rect.width, 1), y: (event.clientY - rect.top) / Math.max(rect.height, 1) }
  }

  private isTyping(event: KeyboardEvent): boolean {
    const element = event.target as HTMLElement | null
    return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.isTyping(event)) return
    if (this.config.preventDefaultKeys && this.boundKeys.has(event.code)) event.preventDefault()
    this.keys.add(event.code)
    this.keyTaps.add(event.code)
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code)
  }

  private readonly onBlur = (): void => {
    this.keys.clear()
    this.mouseButtons.clear()
    this.touches.clear()
    this.pointer.down = false
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const point = this.normalized(event)
    this.pointer.x = point.x
    this.pointer.y = point.y
    this.pointer.down = true
    if (event.pointerType === 'touch') {
      this.touches.set(event.pointerId, point)
      this.touchTaps.push(point)
    } else {
      this.mouseButtons.add(event.button)
      this.mouseTaps.add(event.button)
    }
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') this.touches.delete(event.pointerId)
    else this.mouseButtons.delete(event.button)
    this.pointer.down = this.touches.size > 0 || this.mouseButtons.size > 0
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const point = this.normalized(event)
    this.pointer.x = point.x
    this.pointer.y = point.y
    this.pendingDx += event.movementX
    this.pendingDy += event.movementY
    if (event.pointerType === 'touch' && this.touches.has(event.pointerId)) this.touches.set(event.pointerId, point)
  }

  private readonly onWheel = (event: WheelEvent): void => {
    this.pendingWheel += Math.sign(event.deltaY)
  }

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault()
  }

  private readonly onLockChange = (): void => {
    this.pointer.locked = document.pointerLockElement === this.target
  }

  dispose(): void {
    removeEventListener('keydown', this.onKeyDown)
    removeEventListener('keyup', this.onKeyUp)
    removeEventListener('blur', this.onBlur)
    this.target.removeEventListener('pointerdown', this.onPointerDown)
    removeEventListener('pointerup', this.onPointerUp)
    removeEventListener('pointercancel', this.onPointerUp)
    this.target.removeEventListener('pointermove', this.onPointerMove)
    this.target.removeEventListener('wheel', this.onWheel)
    this.target.removeEventListener('contextmenu', this.onContextMenu)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    if (document.pointerLockElement === this.target) document.exitPointerLock()
  }
}
