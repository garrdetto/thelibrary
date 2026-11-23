/**
 * Draws the AI traffic (`shared/Traffic.ts`) near the camera with each family's LOD1 model under the world root, so floating
 * origin moves it with the terrain. Models are pooled per family and acquired on first need; a pose keeps its model while its
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

const RANGE = 26000
const DEG = Math.PI / 180

interface Slot {
  family: string
  node: TransformNode
  instance: ModelInstance | null
  gear: Node[]
  key: string
  used: boolean
}

const clearance = new Map<string, number>()
for (const spec of FLEET) {
  let lowest = 0
  for (const contact of spec.contacts) if (contact.kind === 'wheel') lowest = Math.min(lowest, contact.position[1])
  clearance.set(spec.family, -lowest)
}

const modelOf = new Map(FLEET.map((spec) => [spec.family, spec.model]))

export class TrafficView {
  private readonly poses: TrafficPose[] = []
  private readonly slots: Slot[] = []
  private disposed = false
  private count = 0
  enabled = true

  constructor(private readonly scene: Scene, private readonly assets: AssetManager, private readonly parent: TransformNode) {}

  /** Poses drawn last frame (for the radio's traffic calls). */
  get current(): readonly TrafficPose[] {
    return this.poses.slice(0, this.count)
  }

  update(eyeX: number, eyeZ: number, seconds: number, windFrom: number, windSpeed: number): void {
    if (this.disposed) return
    this.count = this.enabled ? trafficNear(eyeX, eyeZ, RANGE, seconds, windFrom, windSpeed, this.poses) : 0
    for (const slot of this.slots) slot.used = false
    for (let i = 0; i < this.count; i++) {
      const pose = this.poses[i]
      const slot = this.slots.find((s) => !s.used && s.key === pose.key)
      if (slot) {
        slot.used = true
        this.place(slot, pose)
      }
    }
    for (let i = 0; i < this.count; i++) {
      const pose = this.poses[i]
      if (this.slots.some((s) => s.used && s.key === pose.key)) continue
      const dx = pose.x - eyeX
      const dz = pose.z - eyeZ
      if (dx * dx + dz * dz > RANGE * RANGE) continue
      const slot = this.slots.find((s) => !s.used && s.family === pose.family) ?? this.create(pose.family)
      if (!slot) continue
      slot.used = true
      slot.key = pose.key
      this.place(slot, pose)
    }
    for (const slot of this.slots) {
      if (!slot.used) {
        slot.key = ''
        slot.node.setEnabled(false)
      }
    }
  }

  private create(family: string): Slot | null {
    const model = modelOf.get(family)
    if (!model) return null
    const node = new TransformNode(`traffic-${family}-${this.slots.length}`, this.scene)
    node.parent = this.parent
    node.rotationQuaternion = new Quaternion()
    node.setEnabled(false)
    const slot: Slot = { family, node, instance: null, gear: [], key: '', used: false }
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
    node.setEnabled(slot.instance !== null)
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
    for (const part of slot.gear) part.setEnabled(pose.gearDown)
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
