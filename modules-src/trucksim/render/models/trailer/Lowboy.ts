/**
 * The 55 ton RGN lowboy: a wood-planked drop well deck between the neck and a raised axle-free rear deck (a short ramp joins
 * them, with flip-up loading ramps at the tail), outrigger brackets along the well, tri-axle running gear and tail lamps. The
 * removable gooseneck is a separate node parented to the visual's parent, not the trailer root, and is placed in world space
 * from `pose.gooseneck` every update (it rides on the tractor when detached); it carries the coupler plate, arched neck beams,
 * cross members and the two hydraulic rams. The lowboy has no landing gear on its deck.
 */

import type { TransformNode as TransformNodeType } from '@babylonjs/core/Meshes/transformNode'
import type { KindParts, TrailerContext } from './Chassis'
import { Quaternion } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { at, box, boxAt, cylinder, rectProfile, sweep, tube } from '../truck/Geometry'
import type { P3 } from '../truck/Geometry'
import { addRunningGear, addSideTape, addTailLamps } from './Chassis'
import { MergeBatch } from './Merge'

const REAR_DECK_TOP = 1.15
const RAMP_RUN = 0.45

function lerpPath(path: P3[], t: number): P3 {
  const scaled = t * (path.length - 1)
  const i = Math.min(path.length - 2, Math.floor(scaled))
  const f = scaled - i
  const a = path[i]
  const b = path[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

function planks(batch: MergeBatch, x0: number, x1: number, y0: number, y1: number, zA: number, zB: number, seed: number): void {
  const width = 0.17
  const count = Math.floor((x1 - x0) / width)
  const span = zB - zA
  for (let i = 0; i < count; i++) {
    const xa = x0 + i * width + (x1 - x0 - count * width) / 2
    const shift = ((i + seed) % 3) * 0.7
    const edges = [zA, zA + span / 3 + shift - 0.7, zA + (span * 2) / 3 + shift - 0.7, zB]
    for (let s = 0; s < 3; s++) batch.add((i + seed) % 4 === 0 ? 'woodDark' : 'wood', boxAt(xa + 0.004, xa + width - 0.004, y0 + (i % 2) * 0.003, y1 + (i % 2) * 0.003, edges[s], edges[s + 1] - 0.004))
  }
}

export function buildLowboy(ctx: TrailerContext): KindParts {
  const { model, batch, palette } = ctx
  const rgn = model.rgn
  if (!rgn) throw new Error('Lowboy model without rgn spec')
  const paint = `paint:${ctx.color}`
  const half = model.width / 2
  const wellTop = rgn.wellHeight
  const wellFront = rgn.wellFrontZ
  const wellRear = rgn.wellRearZ
  const rear = model.rearZ
  addRunningGear(ctx, { railY0: 0.95, railY1: REAR_DECK_TOP - 0.05, railHalfGap: 0.7, zFront: wellRear, zRear: rear + 0.05, fenders: false, tape: false })
  const updateTail = addTailLamps(ctx, 0.64, rear)
  addSideTape(ctx, wellFront - 0.3, wellRear + 0.3, 0.42, half + 0.002)
  for (const side of [-1, 1]) {
    batch.add(paint, boxAt(side * 0.7 - 0.09, side * 0.7 + 0.09, wellTop - 0.34, wellTop - 0.05, wellRear, wellFront))
    batch.add('steel', boxAt(side * 0.7 - 0.12, side * 0.7 + 0.12, wellTop - 0.07, wellTop - 0.05, wellRear + 0.02, wellFront - 0.02))
    batch.add(paint, boxAt(side * half - 0.05, side * half + 0.05, wellTop - 0.2, wellTop + 0.04, wellRear, wellFront))
    for (let z = wellFront - 0.6; z > wellRear + 0.3; z -= 1.0) {
      batch.add('darkSteel', boxAt(side * half, side * (half + 0.22), wellTop - 0.2, wellTop - 0.14, z - 0.06, z + 0.06))
      batch.add('darkSteel', boxAt(side * (half + 0.2), side * (half + 0.24), wellTop - 0.3, wellTop - 0.14, z - 0.05, z + 0.05))
      batch.add('steel', boxAt(side * (half + 0.12) - 0.03, side * (half + 0.12) + 0.03, wellTop - 0.14, wellTop - 0.1, z - 0.04, z + 0.04))
    }
    batch.add(paint, boxAt(side * half - 0.05, side * half + 0.05, REAR_DECK_TOP - 0.18, REAR_DECK_TOP + 0.03, rear, wellRear - RAMP_RUN))
  }
  for (let z = wellFront - 0.4; z > wellRear + 0.2; z -= 0.8) batch.add('darkSteel', boxAt(-half, half, wellTop - 0.2, wellTop - 0.07, z - 0.06, z + 0.06))
  planks(batch, -half + 0.02, half - 0.02, wellTop - 0.05, wellTop, wellRear + 0.02, wellFront - 0.12, 0)
  batch.add('darkSteel', boxAt(-half, half, wellTop - 0.34, wellTop, wellFront - 0.15, wellFront))
  for (const side of [-1, 1]) {
    batch.add('steel', boxAt(side * 0.95 - 0.06, side * 0.95 + 0.06, wellTop - 0.05, wellTop + 0.1, wellFront - 0.15, wellFront - 0.03))
    batch.add('chrome', at(cylinder(0.05, 0.05, 0.3, 8), side * 0.95, wellTop + 0.1, wellFront - 0.09))
  }
  const rampLength = Math.hypot(RAMP_RUN, REAR_DECK_TOP - wellTop)
  const rampAngle = Math.atan2(REAR_DECK_TOP - wellTop, RAMP_RUN)
  const ramp = box(model.width - 0.04, 0.05, rampLength)
  at(ramp, 0, (REAR_DECK_TOP + wellTop) / 2 - 0.025, wellRear - RAMP_RUN / 2, rampAngle)
  batch.add(paint, ramp)
  batch.add('darkSteel', boxAt(-half, half, wellTop - 0.34, wellTop, wellRear - 0.04, wellRear + 0.04))
  planks(batch, -half + 0.02, half - 0.02, REAR_DECK_TOP - 0.05, REAR_DECK_TOP, rear + 0.05, wellRear - RAMP_RUN, 1)
  for (const z of [rear + 0.4, (rear + wellRear) / 2, wellRear - 0.6]) batch.add('darkSteel', boxAt(-half, half, REAR_DECK_TOP - 0.18, REAR_DECK_TOP - 0.05, z - 0.07, z + 0.07))
  for (const side of [-1, 1]) {
    const flip = box(1.1, 0.05, 1.0)
    at(flip, side * 0.65, REAR_DECK_TOP + 0.45, rear + 0.1, -1.05)
    batch.add(paint, flip)
    batch.add('steel', at(cylinder(0.05, 0.05, 1.1, 8, 'x'), side * 0.65, REAR_DECK_TOP + 0.04, rear + 0.05))
  }
  const neckBatch = new MergeBatch()
  const kh = model.kingpinHeight
  neckBatch.add('steel', boxAt(-0.85, 0.85, kh - 0.04, kh + 0.02, -0.85, 0.85))
  neckBatch.add('steel', at(cylinder(0.06, 0.06, 0.12, 10), 0, kh - 0.1, 0))
  const spine: P3[] = [[0, 1.3, model.frontZ], [0, 1.44, -1.2], [0, 1.2, -2.0], [0, wellTop - 0.05, rgn.neckRearZ]]
  for (const side of [-1, 1]) {
    const path = spine.map((p) => [side * 0.58, p[1], p[2]] as P3)
    neckBatch.add(paint, sweep(path, rectProfile(0.18, 0.3, 0.03), { side: [1, 0, 0] }))
    neckBatch.add('steel', sweep(path.map((p) => [p[0], p[1] + 0.155, p[2]] as P3), rectProfile(0.26, 0.02, 0.005), { side: [1, 0, 0] }))
  }
  for (const t of [0.12, 0.3, 0.5, 0.7, 0.9]) {
    const p = lerpPath(spine, t)
    neckBatch.add('darkSteel', boxAt(-0.58, 0.58, p[1] - 0.1, p[1] + 0.1, p[2] - 0.05, p[2] + 0.05))
  }
  neckBatch.add(paint, boxAt(-0.85, 0.85, 1.4, 1.46, -1.5, model.frontZ - 0.05))
  neckBatch.add('darkSteel', boxAt(-1.0, 1.0, wellTop - 0.34, wellTop, rgn.neckRearZ, rgn.neckRearZ + 0.2))
  for (const side of [-1, 1]) {
    const top: P3 = [side * 0.42, 1.58, -0.9]
    const bottom: P3 = [side * 0.42, wellTop + 0.12, rgn.neckRearZ - 0.05]
    const mid: P3 = [(top[0] + bottom[0]) / 2, (top[1] + bottom[1]) / 2, (top[2] + bottom[2]) / 2]
    neckBatch.add('steel', tube([top, mid], 0.07, 10))
    neckBatch.add('chrome', tube([mid, bottom], 0.04, 8))
    neckBatch.add('darkSteel', boxAt(side * 0.42 - 0.08, side * 0.42 + 0.08, 1.5, 1.66, -1.0, -0.8))
    neckBatch.add('darkSteel', boxAt(side * 0.42 - 0.08, side * 0.42 + 0.08, wellTop + 0.05, wellTop + 0.2, rgn.neckRearZ - 0.1, rgn.neckRearZ + 0.05))
  }
  neckBatch.add('lampAmber', boxAt(-0.2, 0.2, 1.12, 1.2, model.frontZ - 0.02, model.frontZ + 0.01))
  const neck = new TransformNode('trailer-gooseneck', ctx.scene)
  neck.parent = ctx.root.parent
  neck.rotationQuaternion = new Quaternion()
  ctx.nodes.push(neck)
  neckBatch.build(ctx.scene, 'trailer-neck', neck, palette, ctx.meshes)
  const placeNeck = (node: TransformNodeType, px: number, py: number, pz: number, q: { x: number; y: number; z: number; w: number }) => {
    node.position.x = px
    node.position.y = py
    node.position.z = pz
    const r = node.rotationQuaternion as Quaternion
    r.x = q.x
    r.y = q.y
    r.z = q.z
    r.w = q.w
  }
  return {
    layout: { zRear: wellRear + 0.4, zFront: wellFront - 0.4, width: model.width - 0.2, baseY: wellTop, clearHeight: 3.2, interior: false },
    chains: true,
    update(pose) {
      updateTail(pose)
      const source = pose.gooseneck ?? pose
      placeNeck(neck, source.position.x, source.position.y, source.position.z, source.rotation)
    },
  }
}
