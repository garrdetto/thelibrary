/**
 * Original procedural passenger vehicles for background traffic: a sedan, a pickup, an SUV and a van, each a lower body, a
 * cabin with tinted glass, bumpers, lamps and four wheels on their own nodes (spin and front steer). Brake lamps and turn
 * signals are separate small meshes switched by `setEnabled` (no light or material changes, so nothing recompiles). Body frame:
 * +Z forward, +X left, origin on the ground at the centre of the wheelbase. Ground, tyres and trim follow the gloss rule through
 * the shared `MaterialLibrary`; only the paint is glossy (gloss finish, kept low by the library).
 */
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { Quaternion } from '@babylonjs/core/Maths/math.vector'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { MaterialLibrary } from '../Materials'
import { MachineRig } from './machine/Hydraulics'
import { MergeBatch } from './trailer/Merge'
import { at, boxAt, cylinder } from './truck/Geometry'

export type CarStyle = 'sedan' | 'pickup' | 'suv' | 'van'

interface Shape {
  length: number
  width: number
  wheelbase: number
  wheelR: number
  /** Lower body top, cabin top, cabin front and rear (z), and whether the back is an open bed. */
  beltY: number
  roofY: number
  cabFront: number
  cabRear: number
  bed: boolean
}

const SHAPES: Record<CarStyle, Shape> = {
  sedan: { length: 4.7, width: 1.82, wheelbase: 2.8, wheelR: 0.33, beltY: 0.92, roofY: 1.44, cabFront: 0.85, cabRear: -1.25, bed: false },
  pickup: { length: 5.6, width: 2.0, wheelbase: 3.5, wheelR: 0.39, beltY: 1.12, roofY: 1.86, cabFront: 1.05, cabRear: -0.45, bed: true },
  suv: { length: 4.9, width: 1.92, wheelbase: 2.9, wheelR: 0.37, beltY: 1.04, roofY: 1.78, cabFront: 0.95, cabRear: -2.15, bed: false },
  van: { length: 5.4, width: 2.0, wheelbase: 3.4, wheelR: 0.36, beltY: 1.05, roofY: 2.05, cabFront: 1.65, cabRear: -2.55, bed: false },
}

export interface CarPose {
  x: number
  y: number
  z: number
  heading: number
  pitch: number
  roll: number
  steer: number
  spin: number
  braking: boolean
  /** −1 right, 0 off, 1 left; blinks while set. */
  signal: number
  blinkOn: boolean
}

export interface CarVisual {
  readonly root: TransformNode
  readonly meshes: readonly AbstractMesh[]
  readonly style: CarStyle
  update(pose: CarPose): void
  dispose(): void
}

/** Builds one car of `style` painted `color` under `parent`. */
export function buildCar(scene: Scene, parent: TransformNode, mats: MaterialLibrary, style: CarStyle, color: string, name: string): CarVisual {
  const s = SHAPES[style]
  const rig = new MachineRig(scene, parent, mats, name)
  const root = rig.root
  root.rotationQuaternion = new Quaternion()
  const body = rig.node(`${name}-body`, root)
  const paint = `paint:${color}`
  const hw = s.width / 2
  const front = s.length / 2
  const rear = -s.length / 2
  const sill = s.wheelR * 0.75
  const b = new MergeBatch()
  b.add(paint, boxAt(-hw, hw, sill, s.beltY, rear + 0.25, front - 0.35))
  b.add(paint, boxAt(-hw + 0.06, hw - 0.06, s.beltY - 0.25, s.beltY - 0.02, front - 0.35, front - 0.05))
  if (s.bed) {
    b.add(paint, boxAt(-hw, hw, sill, s.beltY, rear, s.cabRear - 0.1))
    b.add('darkSteel', boxAt(-hw + 0.08, hw - 0.08, s.beltY - 0.35, s.beltY - 0.3, rear + 0.08, s.cabRear - 0.15))
    for (const x of [-hw + 0.04, hw - 0.04]) b.add(paint, boxAt(x - 0.04, x + 0.04, s.beltY, s.beltY + 0.06, rear, s.cabRear - 0.1))
  } else b.add(paint, boxAt(-hw, hw, sill, s.beltY, rear, rear + 0.3))
  const slope = 0.35
  b.add(paint, boxAt(-hw + 0.1, hw - 0.1, s.roofY - 0.07, s.roofY, s.cabRear + 0.15, s.cabFront - slope))
  b.add('glassTint', boxAt(-hw + 0.12, hw - 0.12, s.beltY, s.roofY - 0.07, s.cabRear + 0.08, s.cabFront - 0.05))
  for (const x of [-hw + 0.1, hw - 0.1]) {
    b.add(paint, boxAt(x - 0.04, x + 0.04, s.beltY, s.roofY - 0.05, s.cabFront - 0.25, s.cabFront - 0.1))
    b.add(paint, boxAt(x - 0.04, x + 0.04, s.beltY, s.roofY - 0.05, s.cabRear + 0.08, s.cabRear + 0.22))
  }
  b.add('plastic', boxAt(-hw - 0.02, hw + 0.02, sill - 0.05, sill + 0.28, front - 0.12, front + 0.02))
  b.add('plastic', boxAt(-hw - 0.02, hw + 0.02, sill - 0.05, sill + 0.28, rear - 0.02, rear + 0.12))
  b.add('grille', boxAt(-hw + 0.35, hw - 0.35, sill + 0.3, s.beltY - 0.12, front - 0.06, front - 0.02))
  for (const x of [-hw + 0.22, hw - 0.22]) {
    b.add('lampWhite', boxAt(x - 0.16, x + 0.16, s.beltY - 0.2, s.beltY - 0.06, front - 0.07, front - 0.02))
    b.add('lampRed', boxAt(x - 0.14, x + 0.14, s.beltY - 0.24, s.beltY - 0.1, rear - 0.01, rear + 0.03))
  }
  for (const z of [s.wheelbase / 2, -s.wheelbase / 2]) for (const x of [-hw, hw]) b.add('rubber', at(cylinder(s.wheelR + 0.08, s.wheelR + 0.08, 0.06, 12, 'x'), x, s.wheelR + 0.05, z))
  rig.batchOn(body, `${name}-shell`, b)

  const lamp = (key: string, label: string, boxes: [number, number, number, number, number, number][]): TransformNode => {
    const node = rig.node(`${name}-${label}`, body)
    const batch = new MergeBatch()
    for (const box of boxes) batch.add(key, boxAt(...box))
    rig.batchOn(node, `${name}-${label}-m`, batch)
    node.setEnabled(false)
    return node
  }
  const brake = lamp('lampRed', 'brake', [-1, 1].map((sx) => [sx * (hw - 0.22) - 0.15, sx * (hw - 0.22) + 0.15, s.beltY - 0.25, s.beltY - 0.09, rear - 0.04, rear] as [number, number, number, number, number, number]))
  const signals = [1, -1].map((side) => lamp('lampAmber', side > 0 ? 'signal-l' : 'signal-r', [
    [side * (hw - 0.05) - 0.05, side * (hw - 0.05) + 0.05, s.beltY - 0.2, s.beltY - 0.1, front - 0.1, front - 0.01],
    [side * (hw - 0.05) - 0.05, side * (hw - 0.05) + 0.05, s.beltY - 0.28, s.beltY - 0.18, rear, rear + 0.08],
  ]))

  const wheels: { node: TransformNode; steer: boolean }[] = []
  for (const z of [s.wheelbase / 2, -s.wheelbase / 2]) {
    for (const x of [-hw + 0.12, hw - 0.12]) {
      const hub = rig.node(`${name}-hub`, root)
      hub.position.set(x, s.wheelR, z)
      const wheel = rig.node(`${name}-wheel`, hub)
      const w = new MergeBatch()
      w.add('rubber', at(cylinder(s.wheelR, s.wheelR, 0.24, 14, 'x'), 0, 0, 0))
      w.add('steel', at(cylinder(s.wheelR * 0.62, s.wheelR * 0.62, 0.25, 10, 'x'), 0, 0, 0))
      w.add('darkSteel', boxAt(-0.13, 0.13, -0.04, 0.04, -s.wheelR * 0.55, s.wheelR * 0.55))
      rig.batchOn(wheel, `${name}-wheel-m`, w)
      wheels.push({ node: hub, steer: z > 0 })
      hub.metadata = wheel
    }
  }

  return {
    root,
    meshes: rig.meshes,
    style,
    update(pose) {
      root.position.set(pose.x, pose.y, pose.z)
      Quaternion.RotationYawPitchRollToRef(pose.heading, pose.pitch, pose.roll, root.rotationQuaternion as Quaternion)
      for (const w of wheels) {
        w.node.rotation.y = w.steer ? pose.steer : 0
        ;(w.node.metadata as TransformNode).rotation.x = pose.spin
      }
      brake.setEnabled(pose.braking)
      signals[0].setEnabled(pose.signal > 0 && pose.blinkOn)
      signals[1].setEnabled(pose.signal < 0 && pose.blinkOn)
    },
    dispose() {
      rig.dispose()
    },
  }
}

export const CAR_STYLES: readonly CarStyle[] = ['sedan', 'pickup', 'suv', 'van']
