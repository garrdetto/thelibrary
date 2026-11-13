import type { Scene } from '@babylonjs/core/scene'
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup'
import type { WeaponId } from '../../shared/weapons.mjs'
import type { ArenaAction } from '../../shared/protocol.mjs'
import { fitModel, loadModel, type LoadedModel } from '../assets/ModelLoader'
import { VIEW_LAYER } from './Effects'

export interface ViewModelSpec {
  url: string
  length: number
  rotation: Vector3
  offset: Vector3
  muzzleHeight: number
  kick: number
}

interface Slot {
  spec: ViewModelSpec
  pivot: TransformNode
  muzzle: TransformNode
  model: LoadedModel | null
  idle?: AnimationGroup
  fire?: AnimationGroup
  reload?: AnimationGroup
}

const SWITCH_TIME = 0.42
const KICK_RETURN = 18

export class ViewModel {
  readonly holder: TransformNode
  private readonly slots = new Map<WeaponId, Slot>()
  private current: WeaponId
  private pending: WeaponId | null = null
  private switchClock = 0
  private clock = 0
  private walkPhase = 0
  private kickBack = 0
  private kickPitch = 0
  private kickRoll = 0
  private reloadProgress = 1
  private firingFor = 0
  state: ArenaAction = 'idle'

  constructor(private readonly scene: Scene, camera: Camera, specs: Record<WeaponId, ViewModelSpec>, initial: WeaponId) {
    this.holder = new TransformNode('viewmodel', scene)
    this.holder.parent = camera
    this.current = initial
    for (const [id, spec] of Object.entries(specs) as [WeaponId, ViewModelSpec][]) {
      const pivot = new TransformNode(`viewmodel-${id}`, scene)
      pivot.parent = this.holder
      pivot.position.copyFrom(spec.offset)
      pivot.setEnabled(id === initial)
      const muzzle = new TransformNode(`viewmodel-${id}-muzzle`, scene)
      muzzle.parent = pivot
      muzzle.position.set(0, 0.25, spec.length / 2)
      this.slots.set(id, { spec, pivot, muzzle, model: null })
    }
  }

  async load(): Promise<void> {
    await Promise.all([...this.slots.values()].map(slot => this.loadSlot(slot)))
  }

  private async loadSlot(slot: Slot): Promise<void> {
    try {
      const model = await loadModel(this.scene, slot.spec.url, slot.pivot.name)
      const bounds = fitModel(model, { length: slot.spec.length, rotation: slot.spec.rotation })
      model.root.parent = slot.pivot
      slot.muzzle.position.set(
        (bounds.min.x + bounds.max.x) / 2,
        bounds.min.y + (bounds.max.y - bounds.min.y) * slot.spec.muzzleHeight,
        bounds.max.z,
      )
      for (const mesh of model.meshes) {
        mesh.renderingGroupId = VIEW_LAYER
        mesh.isPickable = false
        mesh.receiveShadows = false
        mesh.alwaysSelectAsActiveMesh = true
        if (mesh.material) mesh.material.fogEnabled = false
      }
      slot.model = model
      slot.idle = model.animations.get('idle')
      slot.fire = model.animations.get('fire') ?? model.animations.get('shoot')
      slot.reload = model.animations.get('reload')
      slot.idle?.start(true)
    } catch (error) {
      console.warn(`Vector Arena: could not load ${slot.spec.url}`, error)
    }
  }

  get weapon(): WeaponId {
    return this.pending ?? this.current
  }

  get switching(): boolean {
    return this.switchClock > 0
  }

  get ready(): boolean {
    return this.switchClock <= 0
  }

  switchTo(id: WeaponId): boolean {
    if (id === this.weapon || !this.slots.has(id)) return false
    this.pending = id
    this.switchClock = SWITCH_TIME
    return true
  }

  fired(rounds: number): void {
    const slot = this.slots.get(this.current)
    if (!slot) return
    const strength = slot.spec.kick * rounds
    this.kickBack = Math.min(0.12, this.kickBack + strength)
    this.kickPitch = Math.min(0.22, this.kickPitch + strength * 1.6)
    this.kickRoll += (Math.random() - 0.5) * strength * 0.8
    this.firingFor = 0.15
    if (slot.fire) slot.fire.start(false, 1, slot.fire.from, slot.fire.to)
  }

  setReload(progress: number): void {
    if (progress < 1 && this.reloadProgress >= 1) this.slots.get(this.current)?.reload?.start(false)
    this.reloadProgress = progress
  }

  muzzlePosition(): Vector3 {
    const slot = this.slots.get(this.current)
    if (!slot) return this.holder.getAbsolutePosition().clone()
    slot.muzzle.computeWorldMatrix(true)
    return slot.muzzle.getAbsolutePosition().clone()
  }

  update(dt: number, moving: number, grounded: boolean): void {
    this.clock += dt
    this.firingFor = Math.max(0, this.firingFor - dt)

    let lower = 0
    if (this.switchClock > 0) {
      this.switchClock = Math.max(0, this.switchClock - dt)
      const half = SWITCH_TIME / 2
      if (this.pending && this.switchClock <= half) {
        this.slots.get(this.current)?.pivot.setEnabled(false)
        this.current = this.pending
        this.pending = null
        this.slots.get(this.current)?.pivot.setEnabled(true)
      }
      const t = this.switchClock > half ? (SWITCH_TIME - this.switchClock) / half : this.switchClock / half
      lower = t * t * (3 - 2 * t)
    }

    const reloadCurve = this.reloadProgress < 1 ? Math.sin(Math.PI * Math.min(1, this.reloadProgress * 1.05)) : 0
    const decay = Math.exp(-KICK_RETURN * dt)
    this.kickBack *= decay
    this.kickPitch *= decay
    this.kickRoll *= decay

    if (grounded && moving > 0.05) this.walkPhase += dt * (6 + moving * 4)
    const bob = grounded ? Math.min(1.4, moving) : 0
    const sway = Math.sin(this.clock * 1.4) * 0.003
    const breathe = Math.sin(this.clock * 0.9) * 0.004

    this.holder.position.set(
      Math.sin(this.walkPhase) * 0.012 * bob + sway,
      -Math.abs(Math.cos(this.walkPhase)) * 0.01 * bob + breathe - lower * 0.32 - reloadCurve * 0.1 + (grounded ? 0 : 0.012),
      -this.kickBack,
    )
    this.holder.rotation.set(-this.kickPitch + lower * 0.7 + reloadCurve * 0.25, 0, this.kickRoll + reloadCurve * 0.55)

    this.state = this.switching ? 'switching' : this.reloadProgress < 1 ? 'reloading' : this.firingFor > 0 ? 'firing' : 'idle'
  }
}
