/**
 * The interactive truck wash. The truck stands in a wash lane (the travel center's, your own wash bay, or within hose reach of
 * your own pressure washer) and the builder's orbit camera circles it; holding the left mouse button sprays a jet of water from
 * the wand (`WashGear`, with a hose back to your washer) to wherever the pointer points, and the `DirtLayer` loses mud around the hit. The toolbar shows how clean the truck is; Done, E or Escape (or getting it all off)
 * finishes, and `onFinish` gets the share of the grime removed for the `wash` action. Nothing here touches money.
 */
import type { ArcRotateCameraPointersInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput'
import '@babylonjs/core/Culling/ray'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { CameraMode } from './Cameras'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { Scene } from '@babylonjs/core/scene'
import type { DirtLayer } from '../render/models/DirtLayer'
import type { MaterialLibrary } from '../render/Materials'
import { WashGear } from '../render/models/WashGear'
import type { Point3 } from '../render/models/WashGear'
import type { TruckAudio } from '../systems/Audio'
import { WashHud } from '../ui/WashHud'
import type { CameraRig } from './Cameras'

export interface WashModeOptions {
  scene: Scene
  canvas: HTMLCanvasElement
  cameras: CameraRig
  uiRoot: HTMLElement
  layer: DirtLayer
  audio: TruckAudio | null
  center: { x: number; y: number; z: number }
  place: string
  cost: number
  seeThrough?: readonly AbstractMesh[]
  mats: MaterialLibrary
  /** Your pressure washer's hose reel in world space; the wash draws a hose from it to the wand. Null at a wash bay or the public lane. */
  hoseFrom?: Point3 | null
  onFinish(cleaned: number): void
}

const DONE_LEFT = 0.03
const UP = new Vector3(0, 1, 0)

export class WashMode {
  private readonly hud: WashHud
  private readonly cleanup: (() => void)[] = []
  private readonly jet: Mesh
  private readonly jetMaterial: PBRMaterial
  private readonly gear: WashGear
  private spraying = false
  private pointer: { x: number; y: number } | null = null
  private finished = false
  private readonly limits: [number | null, number | null, number | null]
  private readonly returnMode: CameraMode
  private readonly faded: [AbstractMesh, number][] = []

  constructor(private readonly options: WashModeOptions) {
    const { cameras, canvas, scene, center } = options
    options.layer.resetMud()
    const build = cameras.build
    this.returnMode = cameras.mode === 'build' ? 'chase' : cameras.mode
    for (const mesh of options.seeThrough ?? []) {
      this.faded.push([mesh, mesh.visibility])
      mesh.visibility = 0.18
    }
    this.limits = [build.lowerRadiusLimit, build.upperRadiusLimit, build.upperBetaLimit]
    cameras.setMode('build')
    build.lowerRadiusLimit = 5
    build.upperRadiusLimit = 16
    build.upperBetaLimit = 1.5
    build.target.set(center.x, center.y + 1.5, center.z)
    build.radius = 9
    build.beta = 1.3
    build.panningDistanceLimit = 4
    build.panningOriginTarget.copyFrom(build.target)
    const pointers = cameras.build.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined
    if (pointers) pointers.buttons = [1, 2]
    this.jetMaterial = new PBRMaterial('trucksim-wash-jet', scene)
    this.jetMaterial.albedoColor = new Color3(0.85, 0.93, 1)
    this.jetMaterial.emissiveColor = new Color3(0.25, 0.3, 0.35)
    this.jetMaterial.metallic = 0
    this.jetMaterial.roughness = 0.2
    this.jetMaterial.alpha = 0.55
    this.jet = CreateCylinder('trucksim-wash-jet', { height: 1, diameterTop: 0.03, diameterBottom: 0.12, tessellation: 8 }, scene)
    this.jet.material = this.jetMaterial
    this.jet.isPickable = false
    this.jet.rotationQuaternion = new Quaternion()
    this.jet.setEnabled(false)
    this.gear = new WashGear(scene, options.mats, options.hoseFrom ?? null)
    this.hud = new WashHud(options.uiRoot, { place: options.place, cost: options.cost, onDone: () => this.finish() })
    this.hud.setClean(0)
    canvas.style.cursor = 'crosshair'
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      this.spraying = true
      this.pointer = this.local(e)
      options.audio?.setSpray(true)
    }
    const move = (e: PointerEvent) => {
      this.pointer = this.local(e)
    }
    const stop = () => {
      this.spraying = false
      options.audio?.setSpray(false)
    }
    const up = (e: PointerEvent) => {
      if (e.button === 0) stop()
    }
    const key = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'KeyE' || e.code === 'Escape') this.finish()
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', stop)
    canvas.addEventListener('pointercancel', stop)
    this.cleanup.push(() => {
      window.removeEventListener('blur', stop)
      canvas.removeEventListener('pointercancel', stop)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key)
    })
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const rect = this.options.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  /** Sprays for one frame while the trigger is held. */
  update(dt: number): void {
    if (this.finished) return
    const { scene, cameras, layer, center } = this.options
    const camera = cameras.build
    const ray = this.pointer
      ? scene.createPickingRay(this.pointer.x, this.pointer.y, Matrix.Identity(), camera, false)
      : { origin: camera.globalPosition, direction: new Vector3(center.x, center.y + 1.2, center.z).subtract(camera.globalPosition).normalize() }
    const right = Vector3.Cross(ray.direction, UP).normalize()
    const nozzle = camera.globalPosition.add(ray.direction.scale(1.2)).add(right.scale(0.35)).add(UP.scale(-0.45))
    if (!this.spraying || !this.pointer) {
      this.jet.setEnabled(false)
      this.gear.aim(nozzle, ray.direction)
      return
    }
    const hit = layer.scrub(ray.origin, ray.direction, dt)
    const end = hit ? hit.point : ray.origin.add(ray.direction.scale(14))
    const span = end.subtract(nozzle)
    const length = span.length()
    if (length > 0.05) {
      this.jet.setEnabled(true)
      this.jet.position.copyFrom(nozzle.add(span.scale(0.5)))
      this.jet.scaling.set(1, length, 1)
      const axis = span.scale(1 / length)
      Quaternion.FromUnitVectorsToRef(UP, axis, this.jet.rotationQuaternion!)
      this.gear.aim(nozzle, axis)
    }
    const clean = 1 - layer.remaining
    this.hud.setClean(clean)
    if (layer.remaining <= DONE_LEFT) this.finish()
  }

  private finish(): void {
    if (this.finished) return
    const cleaned = Math.max(0, Math.min(1, 1 - this.options.layer.remaining))
    this.dispose()
    this.options.onFinish(cleaned)
  }

  dispose(): void {
    if (this.finished) return
    this.finished = true
    for (const fn of this.cleanup) fn()
    this.options.audio?.setSpray(false)
    this.options.canvas.style.cursor = ''
    this.jet.dispose(false, false)
    this.jetMaterial.dispose(false, false)
    this.gear.dispose()
    this.hud.dispose()
    const pointers = this.options.cameras.build.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined
    if (pointers) pointers.buttons = [0, 1, 2]
    const build = this.options.cameras.build
    build.lowerRadiusLimit = this.limits[0]
    build.upperRadiusLimit = this.limits[1]
    build.upperBetaLimit = this.limits[2] ?? 1.35
    build.panningDistanceLimit = null
    for (const [mesh, visibility] of this.faded) if (!mesh.isDisposed()) mesh.visibility = visibility
    this.faded.length = 0
    this.options.cameras.setMode(this.returnMode)
  }
}
