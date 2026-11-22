/**
 * A drawable truck: `buildTruckVisual` turns a catalog model and a look into a node tree under the given parent (never the
 * scene root). The static body is one mesh per material; the moving parts keep their own nodes: wheel knuckles and hubs
 * (drawn as thin instances), lift axle beams, the dump bed on its hinge, the tailgate on its top hinge, the hoist barrel and
 * rod, and the load heap. `update(pose)` places the root at the pose, follows every wheel, raises the bed, swings the tailgate,
 * extends the hoist and switches the brake, reverse and head lamps, all without allocating. `setLook` swaps paints in place and
 * rebuilds only the static body when parts change; `setLoad` sizes and colours the heap. `dispose` frees every mesh, node and
 * per-truck material and gives back its paint references.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { Material } from '@babylonjs/core/Materials/material'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { TruckLook, TruckModel } from '../../shared/Catalog'
import type { TruckPose } from '../../sim/types'
import type { MaterialLibrary } from '../Materials'
import type { BuiltMesh, PartKey } from './truck/Batch'
import type { HoistRig } from './truck/DumpBody'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Quaternion } from '@babylonjs/core/Maths/math.vector'
import { LAMP_LEVEL } from '../Materials'
import { PartBatch } from './truck/Batch'
import { buildWheels, type WheelSet } from './Wheels'
import {
  buildBed, buildHeap, buildHoistBarrel, buildHoistRod, buildLiftAxle, buildStaticParts, buildTailgate, hoistPose, hoistRig,
  layoutOf, tailgatePivot, type TruckLayout,
} from './TruckParts'

/** How far the tailgate swings open at `tailgate = 1` (rad). */
export const TAILGATE_OPEN = 1.15

/** A built truck. */
export interface TruckVisual {
  readonly root: TransformNode
  /** Every mesh of the truck (for shadow casters); its contents change when `setLook` rebuilds the body. */
  readonly meshes: Mesh[]
  readonly wheels: WheelSet
  /** Dump bed pivot node (rotation.x = -angle), or null. */
  readonly bed: TransformNode | null
  readonly tailgate: TransformNode | null
  readonly heap: Mesh | null
  readonly layout: TruckLayout
  /** Called after `setLook` rebuilt the body with the new mesh list. */
  onMeshesChanged: ((meshes: readonly Mesh[]) => void) | null
  update(pose: TruckPose): void
  setLook(look: TruckLook): void
  setLoad(fill: number, color: string | null): void
  dispose(): void
}

type PaintSlot = 'primary' | 'secondary' | 'accent'

function geometryKey(look: TruckLook): string {
  return [look.paint.stripe, look.stacks, look.visor, look.bumper, look.lights, look.mudflaps, look.horn].join('|')
}

function cloneLook(look: TruckLook): TruckLook {
  return { ...look, paint: { ...look.paint } }
}

class Truck implements TruckVisual {
  readonly root: TransformNode
  readonly meshes: Mesh[] = []
  readonly wheels: WheelSet
  readonly bed: TransformNode | null = null
  readonly tailgate: TransformNode | null = null
  readonly heap: Mesh | null = null
  readonly layout: TruckLayout
  onMeshesChanged: ((meshes: readonly Mesh[]) => void) | null = null

  private look: TruckLook
  private readonly name: string
  private readonly paints: Record<PaintSlot, PBRMaterial>
  private readonly head: PBRMaterial
  private readonly tail: PBRMaterial
  private readonly reverse: PBRMaterial
  private staticMeshes: BuiltMesh[] = []
  private readonly movingMeshes: BuiltMesh[] = []
  private readonly liftAxles: Array<{ node: TransformNode; slots: number[]; restY: number }> = []
  private hoistBarrel: TransformNode | null = null
  private hoistRod: TransformNode | null = null
  private rig: HoistRig | null = null
  private readonly hoistOut = { pitch: 0, length: 0 }
  private cargo: PBRMaterial | null = null
  private cargoColor: string | null = null
  private lamps = { brake: -1, reverse: -1, head: -1 }
  private disposed = false

  constructor(private readonly scene: Scene, parent: TransformNode, readonly model: TruckModel, look: TruckLook, private readonly mats: MaterialLibrary) {
    this.layout = layoutOf(model)
    this.look = cloneLook(look)
    this.name = `truck-${model.id}`
    this.root = new TransformNode(this.name, scene)
    this.root.parent = parent
    this.root.rotationQuaternion = Quaternion.Identity()
    const paint = this.look.paint
    this.paints = {
      primary: mats.paint(paint.primary, paint.finish),
      secondary: mats.paint(paint.secondary, paint.finish),
      accent: mats.paint(paint.accent, paint.finish),
    }
    this.head = mats.lampInstance('white', `${this.name}-head`)
    this.tail = mats.lampInstance('red', `${this.name}-tail`)
    this.reverse = mats.lampInstance('white', `${this.name}-reverse`)
    this.buildStatic()
    this.wheels = buildWheels(scene, this.root, model, this.look.wheels, mats, this.name)
    this.buildLiftAxles()
    const bed = this.layout.bed
    if (bed) {
      const bedNode = new TransformNode(`${this.name}-bed`, scene)
      bedNode.parent = this.root
      bedNode.position.set(0, bed.hingeY, bed.hingeZ)
      this.bed = bedNode
      this.buildMoving(bedNode, 'bed', (b) => buildBed(b, this.layout, bed))
      const pivot = tailgatePivot(bed)
      const gate = new TransformNode(`${this.name}-tailgate`, scene)
      gate.parent = bedNode
      gate.position.set(0, pivot.y, pivot.z)
      this.tailgate = gate
      this.buildMoving(gate, 'tailgate', (b) => buildTailgate(b, bed))
      const heap = new Mesh(`${this.name}-heap`, scene)
      heap.parent = bedNode
      buildHeap(bed).applyToMesh(heap, false)
      heap.position.set(0, bed.floorY - bed.hingeY, 0)
      heap.isPickable = false
      heap.receiveShadows = true
      heap.material = mats.get('darkSteel')
      heap.setEnabled(false)
      this.heap = heap
      const rig = hoistRig(this.layout, bed)
      this.rig = rig
      const barrel = new TransformNode(`${this.name}-hoist`, scene)
      barrel.parent = this.root
      barrel.position.set(0, rig.baseY, rig.baseZ)
      this.hoistBarrel = barrel
      this.buildMoving(barrel, 'hoist-barrel', (b) => buildHoistBarrel(b, rig))
      const rod = new TransformNode(`${this.name}-hoist-rod`, scene)
      rod.parent = barrel
      rod.position.set(0, rig.barrelLength - rig.overlap, 0)
      this.hoistRod = rod
      this.buildMoving(rod, 'hoist-rod', (b) => buildHoistRod(b, rig))
      this.poseHoist(0)
    }
    this.collectMeshes()
    this.applyLamps(false, false, false)
  }

  private material(key: PartKey): Material {
    switch (key) {
      case 'primary':
      case 'secondary':
      case 'accent':
        return this.paints[key]
      case 'head':
        return this.head
      case 'tail':
        return this.tail
      case 'reverse':
        return this.reverse
      case 'wheel':
      case 'hub':
        return this.mats.get('steel')
      case 'cargo':
        return this.cargo ?? this.mats.get('darkSteel')
      default:
        return this.mats.get(key)
    }
  }

  private buildStatic(): void {
    const batch = new PartBatch()
    buildStaticParts(batch, this.layout, this.look)
    this.staticMeshes = batch.build(this.scene, `${this.name}-body`, this.root, (key) => this.material(key))
  }

  private buildMoving(node: TransformNode, part: string, write: (batch: PartBatch) => void): void {
    const batch = new PartBatch()
    write(batch)
    for (const built of batch.build(this.scene, `${this.name}-${part}`, node, (key) => this.material(key))) this.movingMeshes.push(built)
  }

  private buildLiftAxles(): void {
    this.model.axles.forEach((axle, index) => {
      if (!axle.lift) return
      const node = new TransformNode(`${this.name}-lift-${index}`, this.scene)
      node.parent = this.root
      node.position.set(0, this.model.wheelRadius, axle.z)
      const slots: number[] = []
      this.wheels.slots.forEach((slot, i) => {
        if (slot.axle === index) slots.push(i)
      })
      this.liftAxles.push({ node, slots, restY: this.model.wheelRadius })
      this.buildMoving(node, `lift-${index}`, (b) => buildLiftAxle(b, this.layout))
    })
  }

  private collectMeshes(): void {
    this.meshes.length = 0
    for (const built of this.staticMeshes) this.meshes.push(built.mesh)
    for (const mesh of this.wheels.meshes) this.meshes.push(mesh)
    for (const built of this.movingMeshes) this.meshes.push(built.mesh)
    if (this.heap) this.meshes.push(this.heap)
  }

  private poseHoist(angle: number): void {
    const bed = this.layout.bed
    if (!bed || !this.rig || !this.hoistBarrel || !this.hoistRod) return
    hoistPose(this.rig, bed, angle, this.hoistOut)
    this.hoistBarrel.rotation.x = this.hoistOut.pitch
    this.hoistRod.scaling.y = Math.max(0.02, this.hoistOut.length - (this.rig.barrelLength - this.rig.overlap))
  }

  private applyLamps(brake: boolean, reversing: boolean, headlights: boolean): void {
    const b = brake ? 1 : 0
    const r = reversing ? 1 : 0
    const h = headlights ? 1 : 0
    if (b !== this.lamps.brake || h !== this.lamps.head) this.tail.emissiveIntensity = brake ? LAMP_LEVEL.on : headlights ? LAMP_LEVEL.running : LAMP_LEVEL.off
    if (r !== this.lamps.reverse) this.reverse.emissiveIntensity = reversing ? LAMP_LEVEL.on : LAMP_LEVEL.off
    if (h !== this.lamps.head) this.head.emissiveIntensity = headlights ? LAMP_LEVEL.on : LAMP_LEVEL.off
    this.lamps.brake = b
    this.lamps.reverse = r
    this.lamps.head = h
  }

  update(pose: TruckPose): void {
    if (this.disposed) return
    this.root.position.set(pose.position.x, pose.position.y, pose.position.z)
    const q = pose.rotation
    this.root.rotationQuaternion!.set(q.x, q.y, q.z, q.w)
    this.wheels.update(pose.wheels)
    const slots = this.wheels.slots
    for (let i = 0; i < this.liftAxles.length; i++) {
      const lift = this.liftAxles[i]
      let sum = 0
      for (let k = 0; k < lift.slots.length; k++) sum += slots[lift.slots[k]].current.y
      lift.node.position.y = lift.slots.length > 0 ? sum / lift.slots.length : lift.restY
    }
    const bed = this.layout.bed
    if (bed && this.bed) {
      const angle = Math.min(bed.maxAngle, Math.max(0, pose.dumpAngle))
      this.bed.rotation.x = -angle
      if (this.tailgate) this.tailgate.rotation.x = Math.min(1, Math.max(0, pose.tailgate)) * TAILGATE_OPEN
      this.poseHoist(angle)
    }
    this.applyLamps(pose.brakeLights, pose.reversing, pose.headlights)
  }

  setLook(look: TruckLook): void {
    if (this.disposed) return
    const next = cloneLook(look)
    for (const slot of ['primary', 'secondary', 'accent'] as const) {
      const before = this.look.paint
      if (before[slot] === next.paint[slot] && before.finish === next.paint.finish) continue
      const fresh = this.mats.paint(next.paint[slot], next.paint.finish)
      const old = this.paints[slot]
      this.paints[slot] = fresh
      for (const built of this.staticMeshes) if (built.key === slot) built.mesh.material = fresh
      for (const built of this.movingMeshes) if (built.key === slot) built.mesh.material = fresh
      this.mats.release(old)
    }
    if (next.wheels !== this.look.wheels) this.wheels.setFinish(next.wheels)
    const rebuild = geometryKey(next) !== geometryKey(this.look)
    this.look = next
    if (rebuild) {
      for (const built of this.staticMeshes) built.mesh.dispose(false, false)
      this.buildStatic()
      this.collectMeshes()
      this.onMeshesChanged?.(this.meshes)
    }
  }

  setLoad(fill: number, color: string | null): void {
    if (this.disposed || !this.heap || !this.layout.bed) return
    const amount = Math.min(1, Math.max(0, fill))
    const visible = amount > 0.004 && color !== null
    this.heap.setEnabled(visible)
    this.heap.scaling.y = Math.max(0.02, amount) * (this.layout.bed.sideHeight + 0.12)
    if (color !== null && color !== this.cargoColor) {
      const fresh = this.mats.cargo(color)
      this.mats.release(this.cargo)
      this.cargo = fresh
      this.cargoColor = color
      this.heap.material = fresh
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.wheels.dispose()
    this.root.dispose(false, false)
    this.head.dispose(true, true)
    this.tail.dispose(true, true)
    this.reverse.dispose(true, true)
    for (const slot of ['primary', 'secondary', 'accent'] as const) this.mats.release(this.paints[slot])
    this.mats.release(this.cargo)
    this.cargo = null
    this.meshes.length = 0
    this.staticMeshes = []
    this.movingMeshes.length = 0
    this.onMeshesChanged = null
  }
}

/**
 * Builds a truck visual under `parent` in the vehicle frame (origin on the ground under the front axle, +Z forward, +X the
 * driver's left). Place it each frame with `update(pose)`.
 */
export function buildTruckVisual(scene: Scene, parent: TransformNode, model: TruckModel, look: TruckLook, mats: MaterialLibrary): TruckVisual {
  return new Truck(scene, parent, model, look, mats)
}
