/**
 * Truck Simulator's lot builder looking through Life Sim's camera: Rack & Reel's camera is held (`setCameraShot`) on an orbit over
 * the lot, worked out in the town frame and mirrored into the scene. Middle-drag turns it, right-drag pans, the wheel zooms, and a
 * pick is a ray from that camera meeting level ground, turned back into the town frame for `BuildMode`.
 */
import '@babylonjs/core/Culling/ray'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { GameHost } from '../../rackreel/game/Game'
import type { BuildView } from '../../trucksim/game/BuildMode'
import { sceneToTown, townToScene } from '../region'

const MIN_RADIUS = 25
const MAX_RADIUS = 300
const MIN_PITCH = 0.35
const MAX_PITCH = 1.45

export class TownBuildView implements BuildView {
  private yaw = 0
  private pitch = 0.95
  private radius = 120
  private readonly target = { x: 0, y: 0, z: 0 }
  private readonly shot = { eye: new Vector3(), target: new Vector3() }
  private drag: { button: number; x: number; y: number } | null = null
  private readonly cleanup: (() => void)[] = []
  private readonly point = { x: 0, y: 0, z: 0 }

  constructor(private readonly host: GameHost, private readonly canvas: HTMLCanvasElement, private readonly heightAt: (x: number, z: number) => number) {
    const down = (e: PointerEvent) => {
      if (e.button !== 1 && e.button !== 2) return
      e.preventDefault()
      this.drag = { button: e.button, x: e.clientX, y: e.clientY }
    }
    const move = (e: PointerEvent) => {
      const drag = this.drag
      if (!drag) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      drag.x = e.clientX
      drag.y = e.clientY
      if (drag.button === 1) {
        this.yaw -= dx * 0.006
        this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch + dy * 0.004))
      } else {
        const k = this.radius / 600
        const c = Math.cos(this.yaw), s = Math.sin(this.yaw)
        this.target.x += (-dx * c + dy * s) * k
        this.target.z += (dx * s + dy * c) * k
        this.target.y = this.heightAt(this.target.x, this.target.z)
      }
      this.apply()
    }
    const up = () => {
      this.drag = null
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      this.radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, this.radius * Math.exp(e.deltaY * 0.0012)))
      this.apply()
    }
    canvas.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    this.cleanup.push(() => {
      canvas.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      canvas.removeEventListener('wheel', wheel)
    })
    if (document.pointerLockElement === canvas) document.exitPointerLock()
  }

  focus(x: number, z: number, extent: number): void {
    this.target.x = x
    this.target.z = z
    this.target.y = this.heightAt(x, z)
    this.radius = Math.min(MAX_RADIUS, Math.max(60, extent * 1.1))
    this.apply()
  }

  pick(clientX: number, clientY: number, groundY: number): { x: number; z: number } | null {
    const scene = this.host.ctx.scene
    const camera = this.host.ctx.camera
    const rect = this.canvas.getBoundingClientRect()
    const ray = scene.createPickingRay(clientX - rect.left, clientY - rect.top, Matrix.Identity(), camera, false)
    const planeY = townToScene(0, groundY, 0, this.point).y
    if (Math.abs(ray.direction.y) < 1e-4) return null
    const t = (planeY - ray.origin.y) / ray.direction.y
    if (t <= 0) return null
    const hit = sceneToTown(ray.origin.x + ray.direction.x * t, planeY, ray.origin.z + ray.direction.z * t, this.point)
    return { x: hit.x, z: hit.z }
  }

  spin(radians: number): void {
    this.yaw += radians
    this.apply()
  }

  release(): void {
    for (const fn of this.cleanup.splice(0)) fn()
    this.host.setCameraShot(null)
  }

  private apply(): void {
    const t = this.target
    const flat = Math.cos(this.pitch) * this.radius
    const ex = t.x + Math.sin(this.yaw) * flat
    const ey = t.y + Math.sin(this.pitch) * this.radius
    const ez = t.z - Math.cos(this.yaw) * flat
    const eye = townToScene(ex, ey, ez, this.point)
    this.shot.eye.set(eye.x, eye.y, eye.z)
    const target = townToScene(t.x, t.y, t.z, this.point)
    this.shot.target.set(target.x, target.y, target.z)
    this.host.setCameraShot(this.shot)
  }
}
