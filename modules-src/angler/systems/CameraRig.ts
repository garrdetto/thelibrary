/** Orbit camera around the boat: drag to look around, wheel or pinch to zoom, and it eases back behind the boat while driving. */
import * as pc from 'playcanvas'
import { heightAt } from '../shared/Lakes'
import type { LakeDef } from '../shared/Lakes'
import { clamp } from '../shared/Random'

export class CameraRig {
  readonly entity: pc.Entity
  yaw = 0
  pitch = 14
  distance = 11
  private targetDistance = 11
  private lastInteraction = -10
  private time = 0
  private dragging = false
  private lastX = 0
  private lastY = 0
  private pinch = 0
  private readonly cleanup: (() => void)[] = []
  private focus = new pc.Vec3()

  constructor(app: pc.AppBase, element: HTMLElement, private lake: LakeDef) {
    this.entity = new pc.Entity('camera')
    this.entity.addComponent('camera', { clearColor: new pc.Color(0.5, 0.6, 0.7), farClip: 9000, nearClip: 0.1, fov: 55 })
    const cam = this.entity.camera!
    cam.toneMapping = pc.TONEMAP_ACES
    cam.gammaCorrection = pc.GAMMA_SRGB
    app.root.addChild(this.entity)
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      element.addEventListener(type, fn as EventListener, opts)
      this.cleanup.push(() => element.removeEventListener(type, fn as EventListener))
    }
    on('pointerdown', e => {
      if ((e.target as HTMLElement).closest('[data-ui]')) return
      this.dragging = true
      this.lastX = e.clientX
      this.lastY = e.clientY
      element.setPointerCapture?.(e.pointerId)
    })
    on('pointermove', e => {
      if (!this.dragging || (e.pointerType === 'touch' && this.pinch)) return
      this.yaw -= (e.clientX - this.lastX) * 0.3
      this.pitch = clamp(this.pitch + (e.clientY - this.lastY) * 0.22, -4, 75)
      this.lastX = e.clientX
      this.lastY = e.clientY
      this.lastInteraction = this.time
    })
    on('pointerup', () => { this.dragging = false })
    on('pointercancel', () => { this.dragging = false })
    on('wheel', e => {
      if ((e.target as HTMLElement).closest('[data-ui]')) return
      e.preventDefault()
      this.targetDistance = clamp(this.targetDistance * (1 + Math.sign(e.deltaY) * 0.12), 3.2, 80)
    }, { passive: false })
    on('touchmove', e => {
      if (e.touches.length !== 2) return
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
      if (this.pinch) this.targetDistance = clamp(this.targetDistance * (this.pinch / d), 3.2, 80)
      this.pinch = d
    }, { passive: true })
    on('touchend', () => { this.pinch = 0 })
  }

  zoom(factor: number): void {
    this.targetDistance = clamp(this.targetDistance * factor, 3.2, 80)
  }

  update(dt: number, target: pc.Vec3, heading: number, speed: number, follow: boolean): void {
    this.time += dt
    this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-dt * 6))
    const behind = (heading * 180) / Math.PI
    if (follow && Math.abs(speed) > 2.5 && this.time - this.lastInteraction > 2.5) {
      let d = behind - this.yaw
      d = ((d + 540) % 360) - 180
      this.yaw += d * (1 - Math.exp(-dt * 1.4))
    }
    this.focus.lerp(this.focus, target, 1 - Math.exp(-dt * 10))
    if (this.focus.distance(target) > 40) this.focus.copy(target)
    const yaw = (this.yaw * Math.PI) / 180, pitch = (this.pitch * Math.PI) / 180
    const x = this.focus.x + Math.sin(yaw) * Math.cos(pitch) * this.distance
    const z = this.focus.z + Math.cos(yaw) * Math.cos(pitch) * this.distance
    let y = this.focus.y + Math.sin(pitch) * this.distance
    const ground = Math.max(heightAt(this.lake, x, z), 0)
    y = Math.max(y, ground + 0.6)
    this.entity.setPosition(x, y, z)
    this.entity.lookAt(this.focus)
  }

  snapBehind(heading: number): void {
    this.yaw = (heading * 180) / Math.PI
  }

  destroy(): void {
    for (const fn of this.cleanup) fn()
    this.entity.destroy()
  }
}
