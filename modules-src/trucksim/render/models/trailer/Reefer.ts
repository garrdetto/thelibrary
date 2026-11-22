/**
 * The 53 ft reefer: an insulated box with a T-floor, interior liner, rear frame with two swing doors hinged at the rear corners
 * (`doors` 0 to 1 swings them to 98 degrees), side skirts, a fuel tank, and the front-mounted cooling unit with a fan grille,
 * louvres and an exhaust stack. Cargo pallets stand inside on the floor and show through the open doors.
 */

import type { TransformNode as TransformNodeType } from '@babylonjs/core/Meshes/transformNode'
import type { KindParts, TrailerContext } from './Chassis'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { at, boxAt, cylinder } from '../truck/Geometry'
import { addLandingGear, addNose, addRunningGear, addTailLamps } from './Chassis'
import { MergeBatch, clamp } from './Merge'

const MAX_OPEN = 1.7

function leaf(side: 1 | -1, batch: MergeBatch, paint: string, height: number): void {
  const w = 1.3
  const x0 = side > 0 ? -w : 0
  const x1 = side > 0 ? 0 : w
  batch.add(paint, boxAt(x0, x1, 0, height, -0.1, 0))
  batch.add('aluminum', boxAt(x0, x1, 0, 0.06, -0.105, 0.005))
  batch.add('aluminum', boxAt(x0, x1, height - 0.06, height, -0.105, 0.005))
  batch.add('aluminum', boxAt(Math.min(x0, x1), Math.min(x0, x1) + 0.05, 0, height, -0.105, 0.005))
  batch.add('aluminum', boxAt(Math.max(x0, x1) - 0.05, Math.max(x0, x1), 0, height, -0.105, 0.005))
  batch.add('rubber', boxAt(x0 + 0.02, x1 - 0.02, 0.07, height - 0.07, 0, 0.012))
  for (const f of [0.25, 0.75]) {
    const x = side * -w * f
    batch.add('chrome', boxAt(x - 0.015, x + 0.015, 0.1, height - 0.1, -0.135, -0.105))
    batch.add('steel', boxAt(x - 0.05, x + 0.05, height * 0.5 - 0.06, height * 0.5 + 0.06, -0.14, -0.1))
  }
  for (let i = 0; i < 6; i++) {
    const xa = x0 + 0.08 + i * ((w - 0.16) / 6)
    batch.add(i % 2 === 0 ? 'tapeRed' : 'tapeWhite', boxAt(xa, xa + (w - 0.16) / 6, 0.1, 0.2, -0.108, -0.1))
  }
}

export function buildReefer(ctx: TrailerContext): KindParts {
  const { model, batch, palette } = ctx
  const paint = `paint:${ctx.color}`
  const rear = model.rearZ
  const front = model.frontZ
  const floorY = model.deckHeight
  const top = model.height
  addRunningGear(ctx, { railY0: floorY - 0.35, railY1: floorY - 0.05, railHalfGap: 0.55, zFront: front - 0.1, zRear: rear + 0.05, tape: true })
  addNose(ctx, floorY - 0.05)
  const updateGear = addLandingGear(ctx, floorY - 0.35)
  const updateTail = addTailLamps(ctx, 0.64, rear)
  const half = model.width / 2
  batch.add('aluminum', boxAt(-half + 0.02, half - 0.02, floorY - 0.05, floorY, rear + 0.02, front))
  for (const side of [-1, 1]) {
    batch.add(paint, boxAt(side * half, side * (half - 0.08), floorY, top - 0.1, rear, front))
    batch.add('wrap', boxAt(side * (half - 0.082), side * (half - 0.09), floorY, top - 0.12, rear + 0.1, front - 0.09))
    batch.add('aluminum', boxAt(side * (half + 0.006), side * (half - 0.07), floorY + 0.28, floorY + 0.34, rear + 0.1, front - 0.05))
    batch.add('aluminum', boxAt(side * (half + 0.006), side * (half - 0.07), top - 0.28, top - 0.22, rear + 0.1, front - 0.05))
    for (let z = front - 0.6; z > rear + 0.4; z -= 1.2) batch.add('aluminum', boxAt(side * (half + 0.012), side * (half - 0.04), floorY + 0.06, top - 0.12, z - 0.025, z + 0.025))
    batch.add('aluminum', boxAt(side * (half + 0.01), side * (half - 0.14), floorY - 0.04, top - 0.06, rear - 0.01, rear + 0.1))
  }
  batch.add(paint, boxAt(-half, half, top - 0.1, top, rear, front))
  batch.add('wrap', boxAt(-half + 0.1, half - 0.1, top - 0.112, top - 0.1, rear + 0.1, front - 0.09))
  batch.add('aluminum', boxAt(-half, half, top - 0.08, top + 0.02, rear - 0.01, rear + 0.1))
  batch.add(paint, boxAt(-half, half, floorY, top - 0.1, front - 0.08, front))
  batch.add('wrap', boxAt(-half + 0.1, half - 0.1, floorY, top - 0.12, front - 0.09, front - 0.082))
  batch.add('aluminum', boxAt(-half, half, floorY - 0.05, floorY + 0.02, rear - 0.01, rear + 0.1))
  const unitZ0 = front
  const unitZ1 = front + 0.55
  batch.add('aluminum', boxAt(-0.95, 0.95, 2.2, 3.95, unitZ0, unitZ1))
  batch.add('grille', boxAt(-0.8, 0.8, 2.35, 3.0, unitZ1, unitZ1 + 0.015))
  for (let y = 2.4; y < 3.0; y += 0.07) batch.add('steel', boxAt(-0.8, 0.8, y, y + 0.02, unitZ1 + 0.01, unitZ1 + 0.03))
  batch.add('grille', at(cylinder(0.62, 0.62, 0.03, 20, 'z'), 0, 3.5, unitZ1 + 0.01))
  batch.add('steel', at(cylinder(0.6, 0.6, 0.02, 20, 'z'), 0, 3.5, unitZ1 + 0.03))
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI * k) / 8
    batch.add('steel', boxAt(-0.3, 0.3, -0.008, 0.008, unitZ1 + 0.035, unitZ1 + 0.045).transform(spin(a, 0, 3.5)))
  }
  batch.add('darkSteel', boxAt(-0.9, 0.9, 3.95, 4.0, unitZ0 + 0.05, unitZ1 - 0.05))
  batch.add('chrome', at(cylinder(0.08, 0.08, 0.4, 10), 0.75, 4.15, unitZ0 + 0.2))
  batch.add('lampAmber', boxAt(-0.9, -0.8, 3.7, 3.8, unitZ1, unitZ1 + 0.02))
  batch.add('lampAmber', boxAt(0.8, 0.9, 3.7, 3.8, unitZ1, unitZ1 + 0.02))
  batch.add('steel', at(cylinder(0.52, 0.52, 1.4, 14, 'z'), -0.95, 0.88, -5.0))
  batch.add('darkSteel', boxAt(-1.05, -0.85, 0.62, 0.66, -5.8, -4.2))
  for (const side of [-1, 1]) batch.add(paint, boxAt(side * (half - 0.005), side * (half + 0.02), 0.62, floorY - 0.1, -10.8, -3.2))
  const doorTop = top - 0.1 - floorY
  const nodes: TransformNodeType[] = []
  const leftBatch = new MergeBatch()
  const rightBatch = new MergeBatch()
  leaf(1, leftBatch, paint, doorTop)
  leaf(-1, rightBatch, paint, doorTop)
  const left = new TransformNode('trailer-door-left', ctx.scene)
  const right = new TransformNode('trailer-door-right', ctx.scene)
  left.parent = ctx.root
  right.parent = ctx.root
  left.position.set(half + 0.02, floorY, rear)
  right.position.set(-half - 0.02, floorY, rear)
  nodes.push(left, right)
  leftBatch.build(ctx.scene, 'trailer-door-l', left, palette, ctx.meshes)
  rightBatch.build(ctx.scene, 'trailer-door-r', right, palette, ctx.meshes)
  for (const node of nodes) ctx.nodes.push(node)
  let lastDoors = -1
  return {
    layout: { zRear: rear + 0.25, zFront: front - 0.2, width: model.width - 0.34, baseY: floorY, clearHeight: top - floorY - 0.2, interior: true },
    update(pose) {
      updateGear(pose)
      updateTail(pose)
      if (pose.doors === lastDoors) return
      lastDoors = pose.doors
      const angle = clamp(pose.doors, 0, 1) * MAX_OPEN
      left.rotation.y = angle
      right.rotation.y = -angle
    },
  }
}

import { Matrix } from '@babylonjs/core/Maths/math.vector'

function spin(angle: number, x: number, y: number): Matrix {
  return Matrix.RotationZ(angle).multiply(Matrix.Translation(x, y, 0))
}
