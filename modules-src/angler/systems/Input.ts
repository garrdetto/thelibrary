/** Keyboard and touch-stick driving input with smoothed throttle and steering. */
import { clamp } from '../shared/Random'

export class DriveInput {
  throttle = 0
  steer = 0
  private keys = new Set<string>()
  private stick = { x: 0, y: 0, active: false }
  private readonly cleanup: (() => void)[] = []
  onKey: ((code: string) => void) | null = null

  constructor(stickElement: HTMLElement | null) {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
      if (!this.keys.has(e.code)) this.onKey?.(e.code)
      this.keys.add(e.code)
    }
    const up = (e: KeyboardEvent) => this.keys.delete(e.code)
    const blur = () => this.keys.clear()
    addEventListener('keydown', down)
    addEventListener('keyup', up)
    addEventListener('blur', blur)
    this.cleanup.push(() => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur) })
    if (stickElement) {
      const knob = stickElement.querySelector<HTMLElement>('[data-knob]')
      const move = (e: PointerEvent) => {
        const r = stickElement.getBoundingClientRect()
        const x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1)
        const y = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1)
        this.stick = { x, y: -y, active: true }
        if (knob) knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`
      }
      const end = () => {
        this.stick = { x: 0, y: 0, active: false }
        if (knob) knob.style.transform = ''
      }
      stickElement.addEventListener('pointerdown', e => { stickElement.setPointerCapture(e.pointerId); move(e) })
      stickElement.addEventListener('pointermove', e => { if (this.stick.active) move(e) })
      stickElement.addEventListener('pointerup', end)
      stickElement.addEventListener('pointercancel', end)
    }
  }

  held(...codes: string[]): boolean {
    return codes.some(c => this.keys.has(c))
  }

  update(dt: number): void {
    let t = 0, s = 0
    if (this.held('KeyW', 'ArrowUp')) t += 1
    if (this.held('KeyS', 'ArrowDown')) t -= 1
    if (this.held('KeyA', 'ArrowLeft')) s -= 1
    if (this.held('KeyD', 'ArrowRight')) s += 1
    if (this.held('ShiftLeft', 'ShiftRight')) t *= 0.45
    if (this.stick.active) { t = this.stick.y; s = this.stick.x }
    this.throttle += (t - this.throttle) * (1 - Math.exp(-dt * (Math.abs(t) > Math.abs(this.throttle) ? 2.2 : 4)))
    this.steer += (s - this.steer) * (1 - Math.exp(-dt * 6))
  }

  get active(): boolean {
    return Math.abs(this.throttle) > 0.05 || this.stick.active || this.held('KeyW', 'ArrowUp', 'KeyS', 'ArrowDown')
  }

  destroy(): void {
    for (const fn of this.cleanup) fn()
  }
}
