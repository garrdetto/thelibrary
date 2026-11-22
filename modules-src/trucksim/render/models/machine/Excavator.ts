/**
 * The 20 t class tracked excavator in an original yellow and dark grey livery. Undercarriage: track frames with idlers, rollers,
 * a rotating sprocket and a belt whose tread links scroll by moving a repeated tread mesh modulo the link pitch (`trackL` and
 * `trackR` are travel in metres). Upper house on the swing ring: counterweight, engine hood, tanks, handrails and a glazed cab.
 * Boom, stick and bucket pivot on their pins with hydraulic rams that stretch between their mounts. Angles are joint angles:
 * `boom` raises (+) from the horizontal, `stick` and `bucket` curl in (+) relative to the part before them, 0 being straight.
 */

import type { TransformNode as TransformNodeType } from '@babylonjs/core/Meshes/transformNode'
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { ExcavatorPose } from '../../../sim/types'
import type { MaterialLibrary } from '../../Materials'
import type { Scene } from '@babylonjs/core/scene'
import { Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { at, boxAt, cylinder, prism, rectProfile, slab, sweep } from '../truck/Geometry'
import type { P2, P3 } from '../truck/Geometry'
import { MergeBatch, extrudeYZ } from '../trailer/Merge'
import { MachineRig, Ram, rotateX } from './Hydraulics'

/** One excavator in the scene. */
export interface ExcavatorVisual {
  root: TransformNodeType
  readonly meshes: readonly AbstractMesh[]
  update(pose: ExcavatorPose): void
  dispose(): void
}

const PITCH = 0.23
const TRACK_X = 1.15
const SPROCKET_Z = -1.75
const IDLER_Z = 1.75
const WHEEL_Y = 0.4
const BELT_R = 0.38
const HOUSE_Y = 0.95
const BOOM_PIVOT: P3 = [0, 0.55, 1.3]
const STICK_PIVOT: P3 = [0, 0.55, 5.6]
const BUCKET_PIVOT: P3 = [0, 0, 2.9]

const scratch = { x: 0, y: 0, z: 0 }

function beltPath(): P3[] {
  const out: P3[] = []
  for (let i = 0; i <= 8; i++) out.push([0, WHEEL_Y - BELT_R, SPROCKET_Z + ((IDLER_Z - SPROCKET_Z) * i) / 8])
  for (let i = 1; i < 10; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 10
    out.push([0, WHEEL_Y + BELT_R * Math.sin(a), IDLER_Z + BELT_R * Math.cos(a)])
  }
  for (let i = 0; i <= 8; i++) out.push([0, WHEEL_Y + BELT_R, IDLER_Z - ((IDLER_Z - SPROCKET_Z) * i) / 8])
  for (let i = 1; i < 10; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / 10
    out.push([0, WHEEL_Y + BELT_R * Math.sin(a), SPROCKET_Z + BELT_R * Math.cos(a)])
  }
  return out
}

function treadBatch(): MergeBatch {
  const batch = new MergeBatch()
  const start = SPROCKET_Z - PITCH
  for (let z = start; z < IDLER_Z; z += PITCH) {
    batch.add('darkSteel', boxAt(-0.29, 0.29, 0, 0.05, z, z + PITCH - 0.014))
    batch.add('steel', boxAt(-0.04, 0.04, 0.05, 0.075, z + 0.05, z + PITCH - 0.06))
  }
  return batch
}

function buildUndercarriage(rig: MachineRig): { sprockets: TransformNodeType[]; bottoms: TransformNodeType[]; tops: TransformNodeType[] } {
  const sprockets: TransformNodeType[] = []
  const bottoms: TransformNodeType[] = []
  const tops: TransformNodeType[] = []
  const frame = new MergeBatch()
  frame.add('machineGrey', boxAt(-0.95, 0.95, 0.32, 0.78, -1.3, 1.3))
  frame.add('darkSteel', at(cylinder(1.9, 1.9, 0.14, 24), 0, 0.82, 0))
  frame.add('steel', at(cylinder(1.7, 1.7, 0.06, 24), 0, 0.9, 0))
  const belt = beltPath()
  for (const side of [-1, 1]) {
    const x = side * TRACK_X
    frame.add('machineGrey', boxAt(x - 0.2, x + 0.2, 0.45, 0.72, -1.7, 1.7))
    frame.add('machineGrey', boxAt(x - 0.28, x - 0.22, 0.25, 0.7, -1.78, 1.78))
    frame.add('machineGrey', boxAt(x + 0.22, x + 0.28, 0.25, 0.7, -1.78, 1.78))
    frame.add('machineGrey', boxAt(side * 0.65 - 0.2, side * 0.65 + 0.2, 0.4, 0.7, -1.0, 1.0))
    frame.add('darkSteel', at(cylinder(0.76, 0.76, 0.34, 18, 'x'), x, WHEEL_Y, IDLER_Z))
    frame.add('steel', at(cylinder(0.3, 0.3, 0.36, 12, 'x'), x, WHEEL_Y, IDLER_Z))
    frame.add('steel', at(cylinder(0.26, 0.26, 0.36, 12, 'x'), x, WHEEL_Y, SPROCKET_Z))
    for (let k = 0; k < 5; k++) {
      const z = -1.2 + k * 0.6
      frame.add('steel', at(cylinder(0.26, 0.26, 0.3, 12, 'x'), x, 0.17, z))
    }
    frame.add('steel', at(cylinder(0.2, 0.2, 0.26, 10, 'x'), x, 0.8, 0.2))
    frame.add('darkSteel', at(sweep(belt, rectProfile(0.58, 0.05, 0.008), { closed: true, side: [1, 0, 0] }), x, 0, 0))
    frame.add('yellow', boxAt(x - 0.22, x + 0.22, 0.72, 0.76, -1.7, 1.7))
  }
  rig.batchOn(rig.root, 'exc-under', frame)
  const sprocket = new MergeBatch()
  sprocket.add('steel', cylinder(0.64, 0.64, 0.3, 18, 'x'))
  for (let k = 0; k < 10; k++) {
    const a = (Math.PI * 2 * k) / 10
    sprocket.add('steel', boxAt(-0.15, 0.15, -0.04, 0.04, 0.3, 0.42).transform(rotX(a)))
  }
  let firstSprocket: Mesh | null = null
  const bottomSource = treadBatch()
  let bottomFirst: Mesh[] = []
  for (const side of [-1, 1]) {
    const x = side * TRACK_X
    const sNode = rig.node(`exc-sprocket-${side}`, rig.root)
    sNode.position.set(x, WHEEL_Y, SPROCKET_Z)
    sprockets.push(sNode)
    if (!firstSprocket) {
      const built = sprocket.build(rig.scene, 'exc-sprocket', sNode, rig.palette, rig.meshes)
      firstSprocket = built[0]
    } else {
      const twin = firstSprocket.createInstance('exc-sprocket-twin')
      twin.parent = sNode
      twin.isPickable = false
      rig.meshes.push(twin)
    }
    for (const kind of ['bottom', 'top'] as const) {
      const node = rig.node(`exc-tread-${kind}-${side}`, rig.root)
      node.position.set(x, kind === 'top' ? 0.8 : 0, 0)
      if (kind === 'bottom') {
        bottoms.push(node)
        if (bottomFirst.length === 0) bottomFirst = bottomSource.build(rig.scene, 'exc-tread', node, rig.palette, rig.meshes)
        else bottomFirst.forEach((mesh) => addInstance(rig, mesh, node))
      } else {
        tops.push(node)
        bottomFirst.forEach((mesh) => addInstance(rig, mesh, node))
      }
    }
  }
  return { sprockets, bottoms, tops }
}

function addInstance(rig: MachineRig, source: Mesh, parent: TransformNodeType): InstancedMesh {
  const instance = source.createInstance(`${source.name}-i`)
  instance.parent = parent
  instance.isPickable = false
  rig.meshes.push(instance)
  return instance
}

function rotX(angle: number): Matrix {
  return Matrix.RotationX(angle)
}

function buildHouse(rig: MachineRig, house: TransformNodeType): void {
  const b = new MergeBatch()
  b.add('machineGrey', slab(-1.4, 1.4, 0, 0.2, -2.1, 1.7, 0.03, 0.03, 0.05))
  b.add('yellow', slab(-1.25, 1.25, 0.2, 1.4, -2.0, -0.45, 0.16, 0.04, 0.12))
  b.add('machineGrey', slab(-1.3, 1.3, 0.15, 1.3, -2.55, -1.95, 0.2, 0.08, 0.16))
  b.add('lampRed', boxAt(-0.7, -0.45, 0.7, 0.8, -2.57, -2.54))
  b.add('lampRed', boxAt(0.45, 0.7, 0.7, 0.8, -2.57, -2.54))
  b.add('grille', boxAt(1.24, 1.27, 0.4, 1.2, -1.8, -0.7))
  b.add('grille', boxAt(-1.27, -1.24, 0.4, 1.2, -1.8, -0.7))
  for (let y = 0.45; y < 1.2; y += 0.1) b.add('steel', boxAt(1.255, 1.275, y, y + 0.03, -1.8, -0.7))
  b.add('yellow', slab(-1.25, -0.35, 0.2, 0.95, -0.4, 1.35, 0.1, 0.03, 0.08))
  b.add('machineGrey', slab(-1.2, -0.4, 0.2, 0.55, 1.4, 1.7, 0.05, 0.02, 0.04))
  b.add('steel', at(cylinder(0.16, 0.16, 0.6, 10), -0.9, 1.65, -1.55))
  b.add('satinBlack', at(cylinder(0.2, 0.2, 0.06, 10), -0.9, 1.97, -1.55))
  b.add('yellow', boxAt(0.45, 1.3, 0.2, 0.55, -0.4, 0.7))
  for (const post of [[0.4, -0.1], [1.25, -0.1], [0.4, 1.45], [1.25, 1.45]]) b.add('yellow', boxAt(post[0] - 0.035, post[0] + 0.035, 0.2, 2.15, post[1] - 0.035, post[1] + 0.035))
  b.add('yellow', slab(0.3, 1.35, 2.12, 2.22, -0.2, 1.6, 0.03, 0.02, 0.04))
  b.add('glass', boxAt(0.43, 1.22, 0.75, 2.1, 1.455, 1.465))
  b.add('glass', boxAt(1.255, 1.265, 0.75, 2.1, -0.05, 1.42))
  b.add('glass', boxAt(0.405, 0.415, 0.75, 2.1, -0.05, 1.42))
  b.add('glass', boxAt(0.43, 1.22, 0.75, 2.1, -0.115, -0.105))
  b.add('glassTint', boxAt(0.43, 1.22, 2.1, 2.12, 0.0, 1.4))
  b.add('satinBlack', boxAt(0.65, 1.05, 0.5, 0.9, 0.1, 0.5))
  b.add('satinBlack', boxAt(0.65, 1.05, 0.9, 1.5, 0.0, 0.14))
  b.add('plastic', boxAt(0.55, 0.62, 0.55, 0.85, 0.4, 0.8))
  b.add('plastic', boxAt(1.1, 1.17, 0.55, 0.85, 0.4, 0.8))
  b.add('lampWhite', boxAt(0.5, 0.7, 2.22, 2.28, 1.35, 1.5))
  b.add('lampWhite', boxAt(1.0, 1.2, 2.22, 2.28, 1.35, 1.5))
  for (const side of [-1, 1]) {
    for (const z of [-1.9, -0.5, 1.5]) b.add('steel', boxAt(side * 1.3 - 0.015, side * 1.3 + 0.015, 0.2, 0.8, z - 0.015, z + 0.015))
    b.add('steel', boxAt(side * 1.3 - 0.015, side * 1.3 + 0.015, 0.78, 0.81, -1.9, 1.5))
  }
  b.add('machineGrey', boxAt(-0.34, 0.34, 0.2, 0.75, 0.9, 1.5))
  b.add('darkSteel', boxAt(-0.3, -0.24, 0.3, 0.9, 1.15, 1.5))
  b.add('darkSteel', boxAt(0.24, 0.3, 0.3, 0.9, 1.15, 1.5))
  b.add('chrome', at(cylinder(0.12, 0.12, 0.56, 10, 'x'), 0, BOOM_PIVOT[1], BOOM_PIVOT[2]))
  for (const side of [-1, 1]) b.add('steel', boxAt(side * 0.22 - 0.05, side * 0.22 + 0.05, 0.25, 0.4, 0.5, 0.8))
  rig.batchOn(house, 'exc-house', b)
}

function buildBoom(rig: MachineRig, boom: TransformNodeType): void {
  const b = new MergeBatch()
  const path: P3[] = [[0, 0, 0], [0, 0.5, 1.2], [0, 1.25, 2.6], [0, 1.2, 4.0], [STICK_PIVOT[0], STICK_PIVOT[1], STICK_PIVOT[2]]]
  b.add('yellow', sweep(path, rectProfile(0.46, 0.5, 0.06), { side: [1, 0, 0] }))
  b.add('machineGrey', boxAt(-0.26, 0.26, 1.3, 1.5, 2.2, 2.8))
  for (const side of [-1, 1]) {
    b.add('steel', boxAt(side * 0.22 - 0.04, side * 0.22 + 0.04, 0.85, 1.05, 1.5, 1.8))
    b.add('steel', boxAt(side * 0.15 - 0.03, side * 0.15 + 0.03, 1.5, 1.7, 3.3, 3.5))
  }
  b.add('chrome', at(cylinder(0.13, 0.13, 0.6, 10, 'x'), 0, STICK_PIVOT[1], STICK_PIVOT[2]))
  rig.batchOn(boom, 'exc-boom', b)
}

function buildStick(rig: MachineRig, stick: TransformNodeType): void {
  const b = new MergeBatch()
  const path: P3[] = [[0, 0, 0], [0, 0.12, 1.5], [0, 0, BUCKET_PIVOT[2]]]
  b.add('yellow', sweep(path, rectProfile(0.34, 0.42, 0.05), { side: [1, 0, 0] }))
  b.add('yellow', boxAt(-0.17, 0.17, 0.2, 0.6, -0.4, 0.3))
  b.add('steel', boxAt(-0.04, 0.04, 0.55, 0.65, -0.36, -0.28))
  for (const side of [-1, 1]) b.add('steel', boxAt(side * 0.15 - 0.03, side * 0.15 + 0.03, 0.4, 0.55, 0.5, 0.7))
  b.add('chrome', at(cylinder(0.11, 0.11, 0.5, 10, 'x'), 0, 0, BUCKET_PIVOT[2]))
  rig.batchOn(stick, 'exc-stick', b)
}

function buildBucket(rig: MachineRig, bucket: TransformNodeType): void {
  const b = new MergeBatch()
  const width = 1.15
  const arc: P3[] = []
  for (let i = 0; i <= 12; i++) {
    const a = ((-20 - (180 * i) / 12) * Math.PI) / 180
    arc.push([0, -0.15 + 0.62 * Math.sin(a), 0.45 + 0.62 * Math.cos(a)])
  }
  b.add('darkSteel', sweep(arc, rectProfile(width, 0.04, 0.005), { side: [1, 0, 0] }))
  const outline: P2[] = []
  for (let i = 0; i <= 12; i++) {
    const a = ((-20 - (180 * i) / 12) * Math.PI) / 180
    outline.push([0.45 + 0.62 * Math.cos(a), -0.15 + 0.62 * Math.sin(a)])
  }
  for (const side of [-1, 1]) b.add('machineGrey', extrudeYZ(outline, side * width * 0.5 - 0.02, side * width * 0.5 + 0.02, prism))
  for (let k = 0; k < 5; k++) {
    const x = -0.46 + k * 0.23
    b.add('steel', boxAt(x - 0.04, x + 0.04, -0.42, -0.3, 0.98, 1.2).transform(rotX(0.3)))
  }
  b.add('machineGrey', boxAt(-0.1, 0.1, 0.0, 0.5, -0.38, -0.05))
  b.add('chrome', at(cylinder(0.1, 0.1, 0.4, 10, 'x'), 0, 0, 0))
  rig.batchOn(bucket, 'exc-bucket', b)
}

/** Builds an excavator under `parent` with its own yellow paint (defaults to the livery yellow). */
export function buildExcavatorModel(scene: Scene, parent: TransformNodeType, mats: MaterialLibrary): ExcavatorVisual {
  const rig = new MachineRig(scene, parent, mats, 'excavator')
  const root = rig.root
  root.rotationQuaternion = new Quaternion()
  const { sprockets, bottoms, tops } = buildUndercarriage(rig)
  const house = rig.node('exc-house', root)
  house.position.y = HOUSE_Y
  buildHouse(rig, house)
  const boom = rig.node('exc-boom', house)
  boom.position.set(BOOM_PIVOT[0], BOOM_PIVOT[1], BOOM_PIVOT[2])
  buildBoom(rig, boom)
  const stick = rig.node('exc-stick', boom)
  stick.position.set(STICK_PIVOT[0], STICK_PIVOT[1], STICK_PIVOT[2])
  buildStick(rig, stick)
  const bucket = rig.node('exc-bucket', stick)
  bucket.position.set(BUCKET_PIVOT[0], BUCKET_PIVOT[1], BUCKET_PIVOT[2])
  buildBucket(rig, bucket)
  const boomRams = [new Ram(rig, house, 'exc-ram-boom-l', 1.3, 1.3, 0.07), new Ram(rig, house, 'exc-ram-boom-r', 1.3, 1.3, 0.07)]
  const stickRam = new Ram(rig, boom, 'exc-ram-stick', 1.5, 1.5, 0.08)
  const bucketRam = new Ram(rig, stick, 'exc-ram-bucket', 1.4, 1.4, 0.07)
  const place = (boomAngle: number, stickAngle: number, bucketAngle: number) => {
    boom.rotation.x = -boomAngle
    stick.rotation.x = stickAngle
    bucket.rotation.x = bucketAngle
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? 0.22 : -0.22
      rotateX(scratch, x, 0.95, 1.7, -boomAngle, 0, BOOM_PIVOT[1], BOOM_PIVOT[2])
      boomRams[i].set(x, 0.25, 0.7, scratch.x, scratch.y, scratch.z)
    }
    rotateX(scratch, 0, 0.45, -0.35, stickAngle, STICK_PIVOT[0], STICK_PIVOT[1], STICK_PIVOT[2])
    stickRam.set(0, 1.62, 3.4, scratch.x, scratch.y, scratch.z)
    rotateX(scratch, 0, 0.45, -0.3, bucketAngle, BUCKET_PIVOT[0], BUCKET_PIVOT[1], BUCKET_PIVOT[2])
    bucketRam.set(0, 0.45, 0.6, scratch.x, scratch.y, scratch.z)
  }
  place(0.3, 1.0, 0.4)
  const scroll = (travelL: number, travelR: number) => {
    const trackTravel = [travelL, travelR]
    for (let i = 0; i < 2; i++) {
      const travel = trackTravel[i]
      const m = ((travel % PITCH) + PITCH) % PITCH
      sprockets[i].rotation.x = travel / 0.32
      bottoms[i].position.z = (PITCH - m) % PITCH
      tops[i].position.z = m
    }
  }
  scroll(0, 0)
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
      house.rotation.y = pose.swing
      place(pose.boom, pose.stick, pose.bucket)
      scroll(pose.trackL, pose.trackR)
    },
    dispose() {
      rig.dispose()
    },
  }
}
