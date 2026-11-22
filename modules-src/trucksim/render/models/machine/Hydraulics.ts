/**
 * Shared pieces of the work machines: a `MachineRig` that tracks meshes, nodes and materials for disposal, and `Ram`, a hydraulic
 * cylinder drawn as a fixed-length body from its base mount and a chrome rod from its rod mount, so the two always meet and
 * overlap by however much the mounts have closed up. `Ram.set` aims both nodes with scalar math only.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { TransformNode as TransformNodeType } from '@babylonjs/core/Meshes/transformNode'
import type { MaterialLibrary } from '../../Materials'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { at, cylinder } from '../truck/Geometry'
import { MergeBatch, Palette, disposeAll } from '../trailer/Merge'

/** Everything a machine builder creates, so `dispose` can release it in one go. */
export class MachineRig {
  readonly palette: Palette
  readonly meshes: AbstractMesh[] = []
  readonly nodes: TransformNodeType[] = []
  readonly root: TransformNodeType

  constructor(readonly scene: Scene, parent: TransformNodeType, mats: MaterialLibrary, name: string) {
    this.palette = new Palette(mats)
    this.root = new TransformNode(name, scene)
    this.root.parent = parent
    this.nodes.push(this.root)
  }

  node(name: string, parent: TransformNodeType): TransformNodeType {
    const node = new TransformNode(name, this.scene)
    node.parent = parent
    this.nodes.push(node)
    return node
  }

  batchOn(parent: TransformNodeType, name: string, batch: MergeBatch): void {
    batch.build(this.scene, name, parent, this.palette, this.meshes)
  }

  dispose(): void {
    disposeAll(this.meshes)
    this.meshes.length = 0
    disposeAll(this.nodes)
    this.nodes.length = 0
    this.palette.dispose()
  }
}

/** Points a node's +Z along `(dx, dy, dz)`. */
export function aim(node: TransformNodeType, dx: number, dy: number, dz: number): void {
  node.rotation.y = Math.atan2(dx, dz)
  node.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz))
}

/** A hydraulic cylinder between two mounts. */
export class Ram {
  private readonly body: TransformNodeType
  private readonly rod: TransformNodeType

  constructor(rig: MachineRig, parent: TransformNodeType, name: string, bodyLength: number, rodLength: number, radius: number, bodySlot = 'darkSteel') {
    this.body = rig.node(`${name}-body`, parent)
    this.rod = rig.node(`${name}-rod`, parent)
    const bodyBatch = new MergeBatch()
    bodyBatch.add(bodySlot, at(cylinder(radius * 2, radius * 2, bodyLength, 10, 'z'), 0, 0, bodyLength / 2))
    bodyBatch.add('steel', at(cylinder(radius * 2.3, radius * 2.3, 0.06, 10, 'z'), 0, 0, 0.03))
    rig.batchOn(this.body, `${name}-b`, bodyBatch)
    const rodBatch = new MergeBatch()
    rodBatch.add('chrome', at(cylinder(radius * 1.1, radius * 1.1, rodLength, 8, 'z'), 0, 0, rodLength / 2))
    rig.batchOn(this.rod, `${name}-r`, rodBatch)
  }

  /** Base mount `a` and rod mount `b`, both in the parent's frame. */
  set(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    this.body.position.x = ax
    this.body.position.y = ay
    this.body.position.z = az
    aim(this.body, bx - ax, by - ay, bz - az)
    this.rod.position.x = bx
    this.rod.position.y = by
    this.rod.position.z = bz
    aim(this.rod, ax - bx, ay - by, az - bz)
  }
}

/** A point rotated about X by `angle` and then offset, written into `out` (frame hops without allocating). */
export function rotateX(out: { x: number; y: number; z: number }, px: number, py: number, pz: number, angle: number, ox: number, oy: number, oz: number): void {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  out.x = ox + px
  out.y = oy + py * c - pz * s
  out.z = oz + py * s + pz * c
}
