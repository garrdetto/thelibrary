/**
 * The articulated wheel loader (about 20 t) in yellow and dark grey: a rear body with hood, counterweight and glazed cab, a
 * front frame that yaws about the centre hinge with `steer`, four lugged wheels that spin with `spin`, a pair of lift arms that
 * raise with `arm` (0 lowest) carried by two rams, and a wide bucket held at `bucket` tilt relative to the ground (0 flat,
 * + curls the lip up). Origin on the ground under the hinge, +Z forward.
 */

import type { TransformNode as TransformNodeType } from '@babylonjs/core/Meshes/transformNode'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { LoaderPose } from '../../../sim/types'
import type { MaterialLibrary } from '../../Materials'
import { Quaternion } from '@babylonjs/core/Maths/math.vector'
import { at, box, boxAt, cylinder, prism, rectProfile, slab, sweep } from '../truck/Geometry'
import type { P2, P3 } from '../truck/Geometry'
import { MergeBatch, extrudeYZ } from '../trailer/Merge'
import { MachineRig, Ram, rotateX } from './Hydraulics'
import { addWheel, buildWheelSources } from './MachineWheels'

/** One wheel loader in the scene. */
export interface LoaderVisual {
  root: TransformNodeType
  readonly meshes: readonly AbstractMesh[]
  update(pose: LoaderPose): void
  dispose(): void
}

const WHEEL_R = 0.85
const AXLE_Z = 1.65
const ARM_PIVOT: P3 = [0, 1.9, 0.6]
const BUCKET_PIVOT: P3 = [0, -1.25, 3.0]
const scratch = { x: 0, y: 0, z: 0 }

function buildRear(rig: MachineRig): void {
  const b = new MergeBatch()
  b.add('machineGrey', slab(-0.8, 0.8, 0.7, 1.3, -2.9, 0.05, 0.05, 0.03, 0.05))
  b.add('yellow', slab(-0.95, 0.95, 1.3, 2.15, -2.85, -0.9, 0.2, 0.06, 0.15))
  b.add('grille', boxAt(-0.5, 0.5, 1.4, 2.0, -2.88, -2.85))
  b.add('machineGrey', slab(-1.0, 1.0, 0.8, 2.0, -3.25, -2.75, 0.15, 0.06, 0.1))
  b.add('lampRed', boxAt(-0.8, -0.55, 1.2, 1.3, -3.27, -3.24))
  b.add('lampRed', boxAt(0.55, 0.8, 1.2, 1.3, -3.27, -3.24))
  for (const side of [-1, 1]) {
    b.add('yellow', slab(side * 1.1 - 0.4, side * 1.1 + 0.4, 1.75, 1.85, -AXLE_Z - 0.85, -AXLE_Z + 0.85, 0.05, 0.02, 0.1))
    b.add('darkSteel', boxAt(side * 1.1 - 0.05, side * 1.1 + 0.05, 0.85 - 0.06, 0.85 + 0.06, -AXLE_Z - 0.06, -AXLE_Z + 0.06))
  }
  b.add('darkSteel', boxAt(-1.1, 1.1, 0.79, 0.91, -AXLE_Z - 0.1, -AXLE_Z + 0.1))
  for (const post of [[-0.75, -0.9], [0.75, -0.9], [-0.75, 0.55], [0.75, 0.55]]) b.add('yellow', boxAt(post[0] - 0.04, post[0] + 0.04, 1.3, 3.3, post[1] - 0.04, post[1] + 0.04))
  b.add('yellow', slab(-0.9, 0.9, 3.28, 3.4, -1.05, 0.7, 0.04, 0.02, 0.05))
  b.add('machineGrey', boxAt(-0.78, 0.78, 1.3, 1.45, -0.92, 0.57))
  b.add('glass', boxAt(-0.72, 0.72, 1.7, 3.25, 0.545, 0.555))
  b.add('glass', boxAt(-0.72, 0.72, 1.7, 3.25, -0.905, -0.895))
  b.add('glass', boxAt(0.745, 0.755, 1.7, 3.25, -0.85, 0.5))
  b.add('glass', boxAt(-0.755, -0.745, 1.7, 3.25, -0.85, 0.5))
  b.add('satinBlack', boxAt(-0.25, 0.25, 1.45, 1.85, -0.5, -0.1))
  b.add('satinBlack', boxAt(-0.25, 0.25, 1.85, 2.45, -0.55, -0.45))
  b.add('lampWhite', boxAt(-0.6, -0.4, 3.4, 3.46, 0.3, 0.55))
  b.add('lampWhite', boxAt(0.4, 0.6, 3.4, 3.46, 0.3, 0.55))
  b.add('steel', at(cylinder(0.14, 0.14, 0.7, 10), 0.6, 2.5, -2.3))
  b.add('steel', at(cylinder(0.3, 0.3, 0.1, 18), 0, 0.98, 0))
  rig.batchOn(rig.root, 'loader-rear', b)
}

function buildFront(rig: MachineRig, front: TransformNodeType): void {
  const b = new MergeBatch()
  b.add('machineGrey', slab(-0.8, 0.8, 0.7, 1.3, -0.05, 2.35, 0.05, 0.03, 0.05))
  b.add('darkSteel', boxAt(-1.1, 1.1, 0.79, 0.91, AXLE_Z - 0.1, AXLE_Z + 0.1))
  for (const side of [-1, 1]) {
    b.add('yellow', slab(side * 1.1 - 0.4, side * 1.1 + 0.4, 1.75, 1.85, AXLE_Z - 0.85, AXLE_Z + 0.85, 0.05, 0.02, 0.1))
    b.add('yellow', boxAt(side * 0.85 - 0.06, side * 0.85 + 0.06, 1.3, 2.4, 0.35, 0.95))
    b.add('chrome', at(cylinder(0.14, 0.14, 0.2, 10, 'x'), side * 0.85, ARM_PIVOT[1], ARM_PIVOT[2]))
    b.add('steel', boxAt(side * 0.75 - 0.05, side * 0.75 + 0.05, 0.85, 1.05, 0.65, 0.85))
  }
  b.add('yellow', boxAt(-0.85, 0.85, 2.3, 2.4, 0.35, 0.95))
  b.add('lampWhite', boxAt(-0.5, -0.3, 2.42, 2.48, 0.5, 0.7))
  b.add('lampWhite', boxAt(0.3, 0.5, 2.42, 2.48, 0.5, 0.7))
  rig.batchOn(front, 'loader-front', b)
}

function buildArm(rig: MachineRig, arm: TransformNodeType): void {
  const b = new MergeBatch()
  const path: P3[] = [[0, 0, 0], [0, -0.45, 1.5], [BUCKET_PIVOT[0], BUCKET_PIVOT[1], BUCKET_PIVOT[2]]]
  for (const side of [-1, 1]) {
    b.add('yellow', sweep(path.map((p) => [side * 0.85, p[1], p[2]] as P3), rectProfile(0.18, 0.34, 0.04), { side: [1, 0, 0] }))
    b.add('chrome', at(cylinder(0.12, 0.12, 0.24, 10, 'x'), side * 0.85, BUCKET_PIVOT[1], BUCKET_PIVOT[2]))
  }
  b.add('yellow', at(cylinder(0.24, 0.24, 1.7, 10, 'x'), 0, -0.4, 1.4))
  b.add('machineGrey', boxAt(-0.15, 0.15, -0.9, -0.3, 1.2, 1.5))
  rig.batchOn(arm, 'loader-arm', b)
}

function buildBucket(rig: MachineRig, bucket: TransformNodeType): void {
  const b = new MergeBatch()
  const width = 2.9
  b.add('darkSteel', boxAt(-width / 2, width / 2, -0.64, -0.58, -0.1, 1.3))
  b.add('darkSteel', boxAt(-width / 2, width / 2, -0.6, 0.5, -0.25, -0.17))
  const lip = box(width, 0.04, 0.34)
  at(lip, 0, -0.45, 1.36, -1.25)
  b.add('darkSteel', lip)
  b.add('steel', boxAt(-width / 2, width / 2, -0.67, -0.6, 1.25, 1.42))
  const outline: P2[] = [[-0.1, -0.6], [1.3, -0.6], [1.4, -0.3], [0.9, 0.1], [-0.2, 0.5], [-0.3, 0.0]]
  for (const side of [-1, 1]) b.add('machineGrey', extrudeYZ(outline, side * width * 0.5 - 0.04, side * width * 0.5 + 0.04, prism))
  b.add('machineGrey', boxAt(-0.2, 0.2, -0.3, 0.3, -0.3, -0.2))
  b.add('chrome', at(cylinder(0.12, 0.12, width - 0.2, 10, 'x'), 0, 0, 0))
  rig.batchOn(bucket, 'loader-bucket', b)
}

/** Builds a wheel loader under `parent`. */
export function buildWheelLoaderModel(scene: Scene, parent: TransformNodeType, mats: MaterialLibrary): LoaderVisual {
  const rig = new MachineRig(scene, parent, mats, 'wheel-loader')
  const root = rig.root
  root.rotationQuaternion = new Quaternion()
  buildRear(rig)
  const front = rig.node('loader-front', root)
  buildFront(rig, front)
  const arm = rig.node('loader-arm', front)
  arm.position.set(ARM_PIVOT[0], ARM_PIVOT[1], ARM_PIVOT[2])
  buildArm(rig, arm)
  const bucket = rig.node('loader-bucket', arm)
  bucket.position.set(BUCKET_PIVOT[0], BUCKET_PIVOT[1], BUCKET_PIVOT[2])
  buildBucket(rig, bucket)
  const rams = [new Ram(rig, front, 'loader-ram-l', 0.9, 0.9, 0.08), new Ram(rig, front, 'loader-ram-r', 0.9, 0.9, 0.08)]
  const sources = buildWheelSources(rig, WHEEL_R, 0.65, 22, 'loader')
  const wheels: TransformNodeType[] = []
  for (const side of [-1, 1]) {
    wheels.push(addWheel(rig, sources, root, `loader-wheel-r${side}`, side * 1.1, WHEEL_R, -AXLE_Z))
    wheels.push(addWheel(rig, sources, front, `loader-wheel-f${side}`, side * 1.1, WHEEL_R, AXLE_Z))
  }
  const place = (armAngle: number, bucketAngle: number) => {
    arm.rotation.x = -armAngle
    bucket.rotation.x = armAngle - bucketAngle
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? 0.85 : -0.85
      rotateX(scratch, x, -0.45, 1.2, -armAngle, 0, ARM_PIVOT[1], ARM_PIVOT[2])
      rams[i].set(x * 0.9, 0.95, 0.7, scratch.x, scratch.y, scratch.z)
    }
  }
  place(0.1, 0)
  return {
    root,
    meshes: rig.meshes,
    update(pose) {
      const p = pose.position
      root.position.x = p.x
      root.position.y = p.y
      root.position.z = p.z
      const q = root.rotationQuaternion as Quaternion
      q.x = pose.rotation.x
      q.y = pose.rotation.y
      q.z = pose.rotation.z
      q.w = pose.rotation.w
      front.rotation.y = pose.steer
      for (let i = 0; i < wheels.length; i++) wheels[i].rotation.x = pose.spin
      place(pose.arm, pose.bucket)
    },
    dispose() {
      rig.dispose()
    },
  }
}
