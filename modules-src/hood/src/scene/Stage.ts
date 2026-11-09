/** Everything both scenes share: the renderer, camera rig, daylight, pointer gestures and the label layer. */
import * as THREE from 'three/webgpu'
import type { App, LightingRig } from '../../../../engine'
import { CameraRig } from './CameraRig'

export interface PointerTarget {
  click?(ndc: THREE.Vector2, event: PointerEvent): void
  hover?(ndc: THREE.Vector2): void
  dragStart?(ndc: THREE.Vector2, event: PointerEvent): boolean
  dragMove?(ndc: THREE.Vector2): void
  dragEnd?(ndc: THREE.Vector2): void
  contextMenu?(ndc: THREE.Vector2, event: PointerEvent): void
}

const DAY_SKY = new THREE.Color('#9cc8ec')
const DUSK_SKY = new THREE.Color('#f0a46b')
const NIGHT_SKY = new THREE.Color('#0d1530')
const DEFAULT_SUN_OFFSET = new THREE.Vector3(30, 50, 20)

export interface ScreenPoint {
  x: number
  y: number
}

export class Stage {
  readonly rig: CameraRig
  readonly raycaster = new THREE.Raycaster()
  readonly labels: HTMLDivElement
  target: PointerTarget | null = null
  night = 0
  private down: { x: number; y: number; button: number; dragging: boolean; custom: boolean } | null = null
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly fog: THREE.Fog
  private readonly sky = new THREE.Color()
  private readonly ndcScratch = new THREE.Vector2()
  private readonly groundScratch = new THREE.Vector3()
  private readonly projectScratch = new THREE.Vector3()
  private readonly screenScratch: ScreenPoint = { x: 0, y: 0 }
  private canvasRect: DOMRect | null = null
  private viewWidth = 0
  private viewHeight = 0
  private readonly sizeObserver: ResizeObserver | null

  constructor(readonly app: App, readonly lighting: LightingRig, readonly ui: HTMLElement) {
    this.rig = new CameraRig(app.camera, app.container)
    this.labels = document.createElement('div')
    this.labels.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden'
    ui.prepend(this.labels)
    this.fog = new THREE.Fog(DAY_SKY.clone(), 90, 260)
    app.scene.fog = this.fog
    app.scene.background = DAY_SKY.clone()
    lighting.sun.shadow.camera.left = -36
    lighting.sun.shadow.camera.right = 36
    lighting.sun.shadow.camera.top = 36
    lighting.sun.shadow.camera.bottom = -36
    lighting.sun.shadow.camera.far = 160
    lighting.sun.shadow.bias = -0.0006
    lighting.sun.shadow.camera.updateProjectionMatrix()
    const canvas = app.renderer.domElement
    this.measure()
    this.sizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(this.onResize) : null
    this.sizeObserver?.observe(app.container)
    this.sizeObserver?.observe(canvas)
    addEventListener('resize', this.onResize)
    addEventListener('scroll', this.onResize, { capture: true, passive: true })
    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointercancel', () => { this.down = null })
    canvas.addEventListener('contextmenu', event => event.preventDefault())
  }

  private readonly onResize = (): void => {
    this.canvasRect = null
    this.measure()
  }

  private measure(): void {
    this.viewWidth = this.app.container.clientWidth
    this.viewHeight = this.app.container.clientHeight
  }

  /** Normalised device coordinates of a pointer; the vector is reused, so read it before the next call. */
  ndc(event: { clientX: number; clientY: number }): THREE.Vector2 {
    const rect = (this.canvasRect ??= this.app.renderer.domElement.getBoundingClientRect())
    return this.ndcScratch.set(((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1, -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1)
  }

  /** Where a pointer ray meets the ground plane; the vector is reused, so read or clone it before the next call. */
  groundPoint(ndc: THREE.Vector2): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc, this.app.camera)
    return this.raycaster.ray.intersectPlane(this.ground, this.groundScratch)
  }

  pick(ndc: THREE.Vector2, roots: THREE.Object3D[]): THREE.Intersection | null {
    this.raycaster.setFromCamera(ndc, this.app.camera)
    return this.raycaster.intersectObjects(roots, true)[0] ?? null
  }

  /**
   * Screen position of a world point, or null when it is behind the camera.
   * Labels call this every frame, so it reads the cached view size instead of
   * measuring the layout (which forced a reflow per label between style writes)
   * and returns one reused point: read it before the next call.
   */
  project(point: THREE.Vector3): ScreenPoint | null {
    return this.projectXYZ(point.x, point.y, point.z)
  }

  projectXYZ(x: number, y: number, z: number): ScreenPoint | null {
    const v = this.projectScratch.set(x, y, z).project(this.app.camera)
    if (v.z > 1) return null
    if (!this.viewWidth) this.measure()
    this.screenScratch.x = (v.x * 0.5 + 0.5) * this.viewWidth
    this.screenScratch.y = (-v.y * 0.5 + 0.5) * this.viewHeight
    return this.screenScratch
  }

  private readonly onDown = (event: PointerEvent) => {
    this.canvasRect = null
    this.app.renderer.domElement.setPointerCapture(event.pointerId)
    this.down = { x: event.clientX, y: event.clientY, button: event.button, dragging: false, custom: false }
  }

  private readonly onMove = (event: PointerEvent) => {
    const down = this.down
    if (!down) {
      this.target?.hover?.(this.ndc(event))
      return
    }
    const dx = event.clientX - down.x, dy = event.clientY - down.y
    if (!down.dragging && Math.hypot(dx, dy) > 5) {
      down.dragging = true
      if (down.button === 0) down.custom = this.target?.dragStart?.(this.ndc({ clientX: down.x, clientY: down.y }), event) ?? false
    }
    if (!down.dragging) return
    if (down.custom) {
      this.target?.dragMove?.(this.ndc(event))
      this.target?.hover?.(this.ndc(event))
    } else if (down.button === 2 || event.shiftKey) this.rig.rotate(event.movementX, event.movementY)
    else this.rig.pan(event.movementX, event.movementY)
  }

  private readonly onUp = (event: PointerEvent) => {
    const down = this.down
    this.down = null
    if (!down) return
    if (down.dragging) {
      if (down.custom) this.target?.dragEnd?.(this.ndc(event))
      return
    }
    if (down.button === 0) this.target?.click?.(this.ndc(event), event)
    else if (down.button === 2) this.target?.contextMenu?.(this.ndc(event), event)
  }

  /** Sun, sky and lamps for an hour of the day (0–24). */
  setDaylight(hour: number): void {
    const sunUp = Math.sin(((hour - 6) / 12) * Math.PI)
    const day = THREE.MathUtils.clamp(sunUp * 1.6, 0, 1)
    const dusk = THREE.MathUtils.clamp(1 - Math.abs(sunUp) * 4, 0, 1) * (hour > 4 && hour < 21 ? 1 : 0)
    this.night = 1 - day
    const sky = this.sky.copy(NIGHT_SKY).lerp(DAY_SKY, day).lerp(DUSK_SKY, dusk * 0.5)
    ;(this.app.scene.background as THREE.Color).copy(sky)
    this.fog.color.copy(sky)
    const sun = this.lighting.sun
    sun.intensity = 0.15 + day * 2.4
    sun.color.set(dusk > 0.3 ? '#ffc58f' : day > 0.1 ? '#fff4e0' : '#9fb4ff')
    this.lighting.hemisphere.intensity = 0.35 + day * 0.65
    const angle = ((hour - 6) / 12) * Math.PI
    const offset = (sun.userData.offset as THREE.Vector3 | undefined) ?? new THREE.Vector3()
    offset.set(Math.cos(angle) * 40, Math.max(12, Math.sin(angle) * 55), 22)
    sun.userData.offset = offset
  }

  follow(target: THREE.Vector3): void {
    const sun = this.lighting.sun
    const offset = (sun.userData.offset as THREE.Vector3 | undefined) ?? DEFAULT_SUN_OFFSET
    sun.target.position.copy(target)
    sun.position.copy(target).add(offset)
    sun.target.updateMatrixWorld()
  }

  dispose(): void {
    this.sizeObserver?.disconnect()
    removeEventListener('resize', this.onResize)
    removeEventListener('scroll', this.onResize, { capture: true })
    this.rig.dispose()
    this.labels.remove()
  }
}
