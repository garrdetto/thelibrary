/**
 * The 42 ft grain hopper: an open-top box with corrugated walls over two sloped hoppers, each with a discharge outlet and a
 * sliding gate, tarp bows, a ladder and a front catwalk. A roll tarp covers the top and rolls forward as `doors` goes 0 to 1,
 * which also slides both gates open. A grain surface rises inside as the load grows (seen once the tarp is rolled back).
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { KindParts, TrailerContext } from './Chassis'
import { at, boxAt, cylinder, sweep, tube } from '../truck/Geometry'
import type { P2, P3 } from '../truck/Geometry'
import { addLandingGear, addNose, addRunningGear, addTailLamps } from './Chassis'
import { MergeBatch, clamp, doubleSided, frustum } from './Merge'

export function buildGrain(ctx: TrailerContext): KindParts {
  const { model, batch, palette } = ctx
  const body = ctx.color.toLowerCase() === model.defaultColor.toLowerCase() ? 'aluminum' : `paint:${ctx.color}`
  const zA = model.rearZ + 0.25
  const zB = model.frontZ - 0.1
  const half = model.width / 2
  const yBottom = 0.85
  const ySplit = 2.1
  const yTop = model.height - 0.1
  const length = zB - zA
  const hopperLength = length / 2
  addRunningGear(ctx, { railY0: model.deckHeight - 0.35, railY1: model.deckHeight - 0.05, railHalfGap: 0.55, zFront: model.frontZ - 0.1, zRear: model.rearZ + 0.05 })
  addNose(ctx, model.deckHeight - 0.05)
  const updateGear = addLandingGear(ctx, model.deckHeight - 0.35)
  const updateTail = addTailLamps(ctx, 0.64, model.rearZ)
  const gates: Mesh[] = []
  const gateBatch = new MergeBatch()
  const addGateParts = () => {
    gateBatch.add('steel', boxAt(-0.34, 0.34, -0.02, 0.02, -0.3, 0.3))
    gateBatch.add('darkSteel', boxAt(0.3, 0.42, -0.03, 0.03, -0.05, 0.05))
  }
  for (let h = 0; h < 2; h++) {
    const cz = zA + hopperLength * (h + 0.5)
    batch.add(body, doubleSided(frustum(0, cz, half * 2 - 0.02, hopperLength, 0.55, 2.6, yBottom, ySplit, false)))
    batch.add('darkSteel', boxAt(-0.3, 0.3, yBottom - 0.16, yBottom, cz - 0.3, cz + 0.3))
    batch.add('darkSteel', boxAt(-0.34, 0.34, yBottom - 0.2, yBottom - 0.16, cz - 0.34, cz - 0.3))
    batch.add('darkSteel', boxAt(-0.34, 0.34, yBottom - 0.2, yBottom - 0.16, cz + 0.3, cz + 0.34))
    batch.add('steel', at(cylinder(0.36, 0.3, 0.2, 12), 0.5, yBottom - 0.1, cz))
    addGateParts()
    const gate = gateBatch.build(ctx.scene, `trailer-gate-${h}`, ctx.root, palette, ctx.meshes)
    for (const mesh of gate) {
      mesh.position.set(0, yBottom - 0.2, cz)
      gates.push(mesh)
    }
  }
  batch.add(body, boxAt(-half, -half + 0.04, ySplit, yTop, zA, zB))
  batch.add(body, boxAt(half - 0.04, half, ySplit, yTop, zA, zB))
  batch.add(body, boxAt(-half, half, ySplit, yTop, zA, zA + 0.04))
  batch.add(body, boxAt(-half, half, ySplit, yTop, zB - 0.04, zB))
  for (const side of [-1, 1]) {
    for (let z = zA + 0.3; z < zB - 0.2; z += 0.4) batch.add(body, boxAt(side * half - 0.01 + (side > 0 ? 0 : 0), side * (half + 0.025), ySplit, yTop - 0.05, z - 0.04, z + 0.04))
    batch.add('steel', boxAt(side * (half - 0.06), side * (half + 0.04), yTop - 0.06, yTop, zA, zB))
  }
  batch.add('steel', boxAt(-half, half, yTop - 0.06, yTop, zB - 0.06, zB))
  batch.add('steel', boxAt(-half, half, yTop - 0.06, yTop, zA, zA + 0.06))
  const arch: P3[] = []
  for (let i = 0; i <= 10; i++) {
    const x = -half + (half * 2 * i) / 10
    arch.push([x, yTop + 0.16 * (1 - (x / half) ** 2) - 0.02, 0])
  }
  for (let z = zA + 0.8; z < zB - 0.4; z += 1.6) batch.add('darkSteel', tube(arch.map((p) => [p[0], p[1], z] as P3), 0.022, 6))
  const ladderZ = zB - 0.35
  for (const dz of [0, 0.32]) batch.add('steel', boxAt(half + 0.03, half + 0.07, 1.3, yTop + 0.35, ladderZ - dz - 0.015, ladderZ - dz + 0.015))
  for (let y = 1.45; y < yTop + 0.3; y += 0.3) batch.add('steel', boxAt(half + 0.03, half + 0.07, y - 0.015, y + 0.015, ladderZ - 0.32, ladderZ))
  batch.add('darkSteel', boxAt(-1.0, half, yTop, yTop + 0.03, zB - 0.7, zB - 0.1))
  for (const x of [-1.0, half - 0.05]) batch.add('steel', boxAt(x - 0.015, x + 0.015, yTop + 0.03, yTop + 0.5, zB - 0.4, zB - 0.37))
  batch.add('steel', boxAt(-1.0, half, yTop + 0.47, yTop + 0.5, zB - 0.4, zB - 0.37))
  const tarpBatch = new MergeBatch()
  const outer: P2[] = []
  const inner: P2[] = []
  for (let i = 0; i <= 12; i++) {
    const x = -half + (half * 2 * i) / 12
    const y = yTop + 0.16 * (1 - (x / half) ** 2)
    outer.push([x, y + 0.012])
    inner.push([x, y - 0.012])
  }
  const profile: P2[] = outer.concat(inner.reverse())
  tarpBatch.add('tarp', sweep([[0, 0, -length + 0.1], [0, 0, 0]], profile, { side: [1, 0, 0] }))
  const tarp = tarpBatch.build(ctx.scene, 'trailer-tarp', ctx.root, palette, ctx.meshes)[0]
  tarp.position.z = zB - 0.05
  const rollBatch = new MergeBatch()
  rollBatch.add('tarp', cylinder(0.12, 0.12, half * 2 - 0.1, 12, 'x'))
  const roll = rollBatch.build(ctx.scene, 'trailer-tarp-roll', ctx.root, palette, ctx.meshes)[0]
  roll.position.set(0, yTop + 0.1, zB - 0.12)
  roll.isVisible = false
  const grainBatch = new MergeBatch()
  grainBatch.add('grain', boxAt(-0.5, 0.5, -0.02, 0.02, -0.5, 0.5))
  const grain = grainBatch.build(ctx.scene, 'trailer-grain', ctx.root, palette, ctx.meshes)[0]
  grain.isVisible = false
  let level = 0
  let lastDoors = -1
  const placeGrain = () => {
    const h = 1.0 + level * (yTop - 0.15 - 1.0)
    const t = clamp((h - yBottom) / (ySplit - yBottom), 0, 1)
    grain.position.y = h
    grain.position.z = (zA + zB) / 2
    grain.scaling.x = 0.55 + (half * 2 - 0.1 - 0.55) * t
    grain.scaling.z = 2.6 + (length - 0.1 - 2.6) * t
  }
  return {
    layout: null,
    update(pose) {
      updateGear(pose)
      updateTail(pose)
      if (pose.doors === lastDoors) return
      lastDoors = pose.doors
      const open = clamp(pose.doors, 0, 1)
      tarp.scaling.z = 1 - 0.95 * open
      tarp.isVisible = open < 0.995
      roll.isVisible = open > 0.02
      const rollScale = 0.6 + 2.2 * open
      roll.scaling.y = rollScale
      roll.scaling.z = rollScale
      for (let i = 0; i < gates.length; i++) gates[i].position.x = open * 0.34
    },
    setFluidMaterial(color) {
      if (color) grain.material = palette.get(`matte:${color.toLowerCase()}`)
    },
    fluid(color, fill) {
      if (color) grain.material = palette.get(`matte:${color.toLowerCase()}`)
      level = clamp(fill, 0, 1)
      grain.isVisible = level > 0.001
      placeGrain()
    },
  }
}
