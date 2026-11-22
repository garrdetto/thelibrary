/**
 * The counterbalance forklift (3 t class) in yellow with a dark grey mast: chassis, counterweight, overhead guard with seat and
 * steering wheel, four wheels that turn as the machine travels, a two-stage mast that tilts and an inner stage and carriage that
 * rise. `update(pose, mast, forks)` takes `mast` as the tilt in radians (+ leans forward) and `forks` as the fork height in
 * metres. Origin on the ground under the front axle, +Z forward.
 */

import type { TransformNode as TransformNodeType } from '@babylonjs/core/Meshes/transformNode'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { BodyPose } from '../../../sim/types'
import type { MaterialLibrary } from '../../Materials'
import { Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { at, boxAt, cylinder, slab } from '../truck/Geometry'
import { MergeBatch } from '../trailer/Merge'
import { MachineRig } from './Hydraulics'
import { addWheel, buildWheelSources } from './MachineWheels'

/** One forklift in the scene. */
export interface ForkliftVisual {
  root: TransformNodeType
  readonly meshes: readonly AbstractMesh[]
  update(pose: BodyPose, mast: number, forks: number): void
  dispose(): void
}

const MAST_Z = 0.62
const FRONT_R = 0.3
const REAR_R = 0.25
const MAX_LIFT = 3.2

function buildBody(rig: MachineRig): void {
  const b = new MergeBatch()
  b.add('yellow', slab(-0.6, 0.6, 0.28, 0.82, -1.0, 0.5, 0.06, 0.03, 0.08))
  b.add('machineGrey', slab(-0.58, 0.58, 0.28, 1.1, -1.95, -1.0, 0.18, 0.05, 0.14))
  b.add('lampRed', boxAt(-0.4, -0.2, 0.7, 0.78, -1.96, -1.94))
  b.add('lampRed', boxAt(0.2, 0.4, 0.7, 0.78, -1.96, -1.94))
  b.add('yellow', slab(-0.5, 0.5, 0.82, 1.0, -0.25, 0.45, 0.04, 0.02, 0.05))
  b.add('satinBlack', boxAt(-0.25, 0.25, 0.82, 0.96, -0.9, -0.3))
  b.add('satinBlack', boxAt(-0.25, 0.25, 0.96, 1.5, -0.95, -0.85))
  b.add('plastic', at(cylinder(0.34, 0.34, 0.03, 14), 0, 1.35, 0.1).transform(tiltMatrix()))
  b.add('plastic', at(cylinder(0.04, 0.04, 0.5, 6), 0, 1.15, 0.08))
  for (const x of [-0.48, 0.48]) {
    b.add('machineGrey', boxAt(x - 0.03, x + 0.03, 1.0, 2.1, 0.38, 0.44))
    b.add('machineGrey', boxAt(x - 0.03, x + 0.03, 1.0, 2.1, -0.9, -0.84))
  }
  b.add('machineGrey', boxAt(-0.52, 0.52, 2.08, 2.14, -0.9, 0.44))
  for (let k = 0; k < 6; k++) b.add('machineGrey', boxAt(-0.5, 0.5, 2.1, 2.14, -0.85 + k * 0.2, -0.82 + k * 0.2))
  b.add('lampAmber', boxAt(-0.08, 0.08, 2.14, 2.2, -0.2, -0.1))
  b.add('lampWhite', boxAt(-0.5, -0.38, 1.2, 1.28, 0.44, 0.47))
  b.add('lampWhite', boxAt(0.38, 0.5, 1.2, 1.28, 0.44, 0.47))
  b.add('darkSteel', boxAt(-0.45, 0.45, FRONT_R - 0.04, FRONT_R + 0.04, -0.05, 0.05))
  b.add('darkSteel', boxAt(-0.35, 0.35, REAR_R - 0.04, REAR_R + 0.04, -1.45, -1.35))
  rig.batchOn(rig.root, 'forklift-body', b)
}

function tiltMatrix(): Matrix {
  return Matrix.RotationX(-0.7)
}

function buildMast(rig: MachineRig, mast: TransformNodeType, inner: TransformNodeType, carriage: TransformNodeType): void {
  const outer = new MergeBatch()
  const stage = new MergeBatch()
  const fork = new MergeBatch()
  for (const x of [-0.34, 0.34]) {
    outer.add('machineGrey', boxAt(x - 0.06, x + 0.06, 0, 2.0, -0.07, 0.07))
    outer.add('steel', boxAt(x - 0.065, x + 0.065, 0, 2.0, 0.07, 0.09))
    stage.add('darkSteel', boxAt(x - 0.045, x + 0.045, 0.1, 2.05, -0.05, 0.05))
  }
  outer.add('machineGrey', boxAt(-0.34, 0.34, 0.4, 0.46, -0.05, 0.05))
  outer.add('machineGrey', boxAt(-0.34, 0.34, 1.94, 2.0, -0.05, 0.05))
  stage.add('darkSteel', boxAt(-0.34, 0.34, 1.98, 2.04, -0.04, 0.04))
  fork.add('machineGrey', boxAt(-0.5, 0.5, 0.1, 0.2, 0.08, 0.14))
  fork.add('machineGrey', boxAt(-0.5, 0.5, 0.65, 0.72, 0.08, 0.14))
  for (const x of [-0.45, -0.15, 0.15, 0.45]) fork.add('machineGrey', boxAt(x - 0.02, x + 0.02, 0.1, 0.9, 0.08, 0.12))
  for (const x of [-0.3, 0.3]) {
    fork.add('steel', boxAt(x - 0.06, x + 0.06, 0.04, 0.1, 0.08, 1.2))
    fork.add('steel', boxAt(x - 0.06, x + 0.06, 0.04, 0.55, 0.1, 0.2))
  }
  rig.batchOn(mast, 'forklift-mast', outer)
  rig.batchOn(inner, 'forklift-stage', stage)
  rig.batchOn(carriage, 'forklift-forks', fork)
}

/** Builds a forklift under `parent`. */
export function buildForkliftModel(scene: Scene, parent: TransformNodeType, mats: MaterialLibrary): ForkliftVisual {
  const rig = new MachineRig(scene, parent, mats, 'forklift')
  const root = rig.root
  root.rotationQuaternion = new Quaternion()
  buildBody(rig)
  const mast = rig.node('forklift-mast', root)
  mast.position.set(0, 0.08, MAST_Z)
  const inner = rig.node('forklift-stage', mast)
  const carriage = rig.node('forklift-carriage', inner)
  buildMast(rig, mast, inner, carriage)
  const front = buildWheelSources(rig, FRONT_R, 0.24, 16, 'forklift-front')
  const rear = buildWheelSources(rig, REAR_R, 0.2, 12, 'forklift-rear')
  const wheels: TransformNodeType[] = []
  const radii: number[] = []
  for (const side of [-1, 1]) {
    wheels.push(addWheel(rig, front, root, `forklift-wheel-f${side}`, side * 0.45, FRONT_R, 0))
    radii.push(FRONT_R)
    wheels.push(addWheel(rig, rear, root, `forklift-wheel-r${side}`, side * 0.35, REAR_R, -1.4))
    radii.push(REAR_R)
  }
  let lastX = Number.NaN
  let lastZ = 0
  let travel = 0
  return {
    root,
    meshes: rig.meshes,
    update(pose, tilt, height) {
      const p = pose.position
      const r = pose.rotation
      if (!Number.isNaN(lastX)) {
        const dx = p.x - lastX
        const dz = p.z - lastZ
        const fx = 2 * (r.x * r.z + r.w * r.y)
        const fz = 1 - 2 * (r.x * r.x + r.y * r.y)
        travel += dx * fx + dz * fz
      }
      lastX = p.x
      lastZ = p.z
      root.position.x = p.x
      root.position.y = p.y
      root.position.z = p.z
      const q = root.rotationQuaternion as Quaternion
      q.x = r.x
      q.y = r.y
      q.z = r.z
      q.w = r.w
      for (let i = 0; i < wheels.length; i++) wheels[i].rotation.x = travel / radii[i]
      mast.rotation.x = tilt
      const lift = Math.min(MAX_LIFT, Math.max(0, height))
      inner.position.y = Math.max(0, lift - 1.0) * 0.5
      carriage.position.y = lift
    },
    dispose() {
      rig.dispose()
    },
  }
}
