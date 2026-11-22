/**
 * Wheels for the wheel loader and forklift: a lugged or plain tyre and a steel rim built once as two hidden source meshes, with
 * `addWheel` giving every wheel position its own spinning node that owns two instances of them.
 */

import type { TransformNode as TransformNodeType } from '@babylonjs/core/Meshes/transformNode'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { Matrix } from '@babylonjs/core/Maths/math.vector'
import { boxAt, cylinder, latheX } from '../truck/Geometry'
import type { P2 } from '../truck/Geometry'
import { MergeBatch } from '../trailer/Merge'
import type { MachineRig } from './Hydraulics'

/** Shared tyre and rim sources for one size of wheel. */
export interface WheelSources {
  tyre: Mesh
  rims: Mesh[]
}

/** Builds hidden tyre and rim sources of the given outer radius and width under a holder node. */
export function buildWheelSources(rig: MachineRig, radius: number, width: number, lugs: number, name: string): WheelSources {
  const hw = width / 2
  const rim = radius * 0.55
  const profile: P2[] = [[rim, -hw * 0.8], [rim + 0.06, -hw], [radius - 0.12, -hw], [radius - 0.04, -hw * 0.9], [radius, -hw * 0.6], [radius, hw * 0.6], [radius - 0.04, hw * 0.9], [radius - 0.12, hw], [rim + 0.06, hw], [rim, hw * 0.8]]
  const rubber = new MergeBatch().add('rubber', latheX(profile, 28, { closed: true }))
  for (let k = 0; k < lugs; k++) {
    const a = (Math.PI * 2 * k) / lugs
    rubber.add('rubber', boxAt(-hw * 0.9, hw * 0.9, radius - 0.03, radius + 0.035, -0.06, 0.06).transform(Matrix.RotationX(a)))
  }
  const steel = new MergeBatch().add('machineGrey', latheX([[0.05, 0], [rim, 0], [rim, hw * 0.7], [rim * 0.9, hw * 0.85]], 20, { capStart: true }))
  steel.add('steel', cylinder(rim * 0.5, rim * 0.5, width * 0.9, 12, 'x'))
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI * 2 * k) / 8
    steel.add('chrome', boxAt(hw * 0.7, hw * 0.9, rim * 0.34, rim * 0.34 + 0.05, -0.025, 0.025).transform(Matrix.RotationX(a)))
  }
  const holder = rig.node(`${name}-wheel-sources`, rig.root)
  const tyreMesh = rubber.build(rig.scene, `${name}-tyre`, holder, rig.palette, rig.meshes)[0]
  const rimMesh = steel.build(rig.scene, `${name}-rim`, holder, rig.palette, rig.meshes)
  tyreMesh.isVisible = false
  for (const mesh of rimMesh) mesh.isVisible = false
  return { tyre: tyreMesh, rims: rimMesh }
}

/** A spinning wheel node at a position with instances of the sources (one per rim part). */
export function addWheel(rig: MachineRig, sources: WheelSources, parent: TransformNodeType, name: string, x: number, y: number, z: number): TransformNodeType {
  const node = rig.node(name, parent)
  node.position.set(x, y, z)
  const tyre = sources.tyre.createInstance(`${name}-tyre`)
  tyre.parent = node
  tyre.isPickable = false
  rig.meshes.push(tyre)
  sources.rims.forEach((source, index) => {
    const rim = source.createInstance(`${name}-rim${index}`)
    rim.parent = node
    rim.isPickable = false
    rig.meshes.push(rim)
  })
  return node
}
