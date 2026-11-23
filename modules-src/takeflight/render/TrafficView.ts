/**
 * Draws the AI traffic (`shared/Traffic.ts`) near the camera with each family's LOD1 model under the world root, so floating
 * origin moves it with the terrain. Models are pooled per family, acquired on first need and released after 30 s unused; a pose keeps its model while its
 * movement lasts. Gear nodes hide when the pose's gear is up, and props spin as discs. Purely visual.
 */
import { Quaternion } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Node } from '@babylonjs/core/node'
import type { Scene } from '@babylonjs/core/scene'
import { trafficNear } from '../shared/Traffic'
import type { TrafficPose } from '../shared/Traffic'
import { FLEET } from '../shared/Fleet'
import type { AssetManager, ModelInstance } from '../world/AssetManager'

const DEG = Math.PI / 180
const IDLE_RELEASE = 30

interface Slot {
  family: string
  node: TransformNode
  instance: ModelInstance | null
  gear: Node[]
  key: string
  used: boolean
  gearDown: boolean
  idle: number
}

const clearance = new Map<string, number>()
for (const spec of FLEET) {
  let lowest = 0
  for (const contact of spec.contacts) if (contact.kind === 'wheel') lowest = Math.min(lowest, contact.position[1])
  clearance.set(spec.family, -lowest)
}

const modelOf = new Map(FLEET.map((spec) => [spec.family, spec.model]))

export class TrafficView {
  private readonly list: TrafficPose[] = []
  private readonly slots: Slot[] = []
  private disposed = false
  private written = 0
  enabled = true
  /** Traffic drawn within this distance, metres (the quality tier's `trafficRange`). */
  range = 26000

  constructor(private readonly scene: Scene, private readonly assets: AssetManager, private readonly parent: TransformNode) {}

  /** Poses written last frame; the first `count` are current. */
  get poses(): readonly TrafficPose[] {
    return this.list
  }

  get count(): number {
    return this.written
  }

  update(eyeX: number, eyeZ: number, seconds: number, windFrom: number, windSpeed: number, dt = 0): void {
    if (this.disposed) return
    this.written = this.enabled ? trafficNear(eyeX, eyeZ, this.range, seconds, windFrom, windSpeed, this.list) : 0
    const slots = this.slots
    for (let s = 0; s < slots.length; s++) slots[s].used = false
    for (let i = 0; i < this.written; i++) {
      const pose = this.list[i]
      for (let s = 0; s < slots.length; s++) {
        const slot = slots[s]
        if (!slot.used && slot.key === pose.key) {
          slot.used = true
          this.place(slot, pose)
          break
        }
      }
    }
    for (let i = 0; i < this.written; i++) {
      const pose = this.list[i]
      if (this.placed(pose.key)) continue
      const dx = pose.x - eyeX
      const dz = pose.z - eyeZ
      if (dx * dx + dz * dz > this.range * this.range) continue
      let slot: Slot | null = null
      for (let s = 0; s < slots.length; s++) {
        if (!slots[s].used && slots[s].family === pose.family) {
          slot = slots[s]
          break
        }
      }
      slot ??= this.create(pose.family)
      if (!slot) continue
      slot.used = true
      slot.key = pose.key
      this.place(slot, pose)
    }
    for (let s = slots.length - 1; s >= 0; s--) {
      const slot = slots[s]
      if (slot.used) {
        slot.idle = 0
        continue
      }
      slot.key = ''
      if (slot.node.isEnabled(false)) slot.node.setEnabled(false)
      slot.idle += dt
      if (slot.idle > IDLE_RELEASE && slot.instance) {
        this.assets.release(slot.instance)
        slot.node.dispose()
        slots.splice(s, 1)
      }
    }
  }

  private placed(key: string): boolean {
    for (let s = 0; s < this.slots.length; s++) if (this.slots[s].used && this.slots[s].key === key) return true
    return false
  }

  private create(family: string): Slot | null {
    const model = modelOf.get(family)
    if (!model) return null
    const node = new TransformNode(`traffic-${family}-${this.slots.length}`, this.scene)
    node.parent = this.parent
    node.rotationQuaternion = new Quaternion()
    node.setEnabled(false)
    const slot: Slot = { family, node, instance: null, gear: [], key: '', used: false, gearDown: true, idle: 0 }
    this.slots.push(slot)
    void this.assets.acquire(`/models/takeflight/${model}_lod1.glb`).then((instance) => {
      if (this.disposed) {
        this.assets.release(instance)
        return
      }
      instance.root.parent = node
      slot.instance = instance
      for (const [name, part] of instance.nodes) if (/^gear_(nose|main_[LR]|door_\w+)$/.test(name)) slot.gear.push(part)
      for (const mesh of instance.meshes as AbstractMesh[]) {
        mesh.isPickable = false
        if (/^prop_\d+_disc$/.test(mesh.name.replace(/#\d+$/, ''))) mesh.isVisible = false
      }
    }).catch(() => undefined)
    return slot
  }

  private place(slot: Slot, pose: TrafficPose): void {
    const node = slot.node
    const ready = slot.instance !== null
    if (node.isEnabled(false) !== ready) node.setEnabled(ready)
    node.position.set(pose.x, pose.y + (clearance.get(pose.family) ?? 1.5), pose.z)
    const yaw = (90 - pose.heading) * DEG * 0.5
    const pitch = pose.pitch * DEG * 0.5
    const roll = pose.bank * DEG * 0.5
    const ay = Math.sin(yaw)
    const aw = Math.cos(yaw)
    const bz = Math.sin(pitch)
    const bw = Math.cos(pitch)
    const cx = Math.sin(roll)
    const cw = Math.cos(roll)
    const iy = ay * bw
    const iz = aw * bz
    const iw = aw * bw
    const ix = ay * bz
    ;(node.rotationQuaternion as Quaternion).set(iw * cx + ix * cw, iy * cw + iz * cx, iz * cw - iy * cx, iw * cw - ix * cx)
    if (slot.gearDown !== pose.gearDown) {
      slot.gearDown = pose.gearDown
      for (const part of slot.gear) part.setEnabled(pose.gearDown)
    }
  }

  dispose(): void {
    this.disposed = true
    for (const slot of this.slots) {
      if (slot.instance) this.assets.release(slot.instance)
      slot.node.dispose()
    }
    this.slots.length = 0
  }
}
