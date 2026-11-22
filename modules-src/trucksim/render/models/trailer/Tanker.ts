/**
 * The fuel tanker: a polished aluminium barrel with domed end caps and compartment bands, four domed manholes through a catwalk
 * with handrails, bottom-loading valves with API couplers, coiled hoses, rear ICC bumper and tape, and four level gauges on the
 * right side whose bars rise with the load (the barrel itself never shows the liquid).
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { Matrix } from '@babylonjs/core/Maths/math.vector'
import type { KindParts, TrailerContext } from './Chassis'
import { at, boxAt, cylinder, slab, sphere, tube } from '../truck/Geometry'
import type { P3 } from '../truck/Geometry'
import { addLandingGear, addNose, addRunningGear, addTailLamps } from './Chassis'
import { MergeBatch } from './Merge'

const COMPARTMENTS = 4

function coil(x0: number, z: number, y: number, radius: number, turns: number): P3[] {
  const points: P3[] = []
  const steps = turns * 14
  for (let i = 0; i <= steps; i++) {
    const a = (Math.PI * 2 * i) / 14
    points.push([x0 + (i / steps) * 0.2, y + Math.cos(a) * radius, z + Math.sin(a) * radius])
  }
  return points
}

export function buildTanker(ctx: TrailerContext): KindParts {
  const { model, batch, palette } = ctx
  const rear = model.rearZ
  const front = model.frontZ
  const y0 = 0.98
  const y1 = model.height - 0.42
  const barrel = ctx.color.toLowerCase() === model.defaultColor.toLowerCase() ? 'aluminum' : `paint:${ctx.color}`
  addRunningGear(ctx, { railY0: model.deckHeight - 0.35, railY1: model.deckHeight - 0.05, railHalfGap: 0.55, zFront: front - 0.1, zRear: rear + 0.1 })
  addNose(ctx, y0)
  const updateGear = addLandingGear(ctx, model.deckHeight - 0.35)
  const updateTail = addTailLamps(ctx, 0.64, rear)
  const zA = rear + 0.05
  const zB = front - 0.05
  batch.add(barrel, slab(-1.22, 1.22, y0, y1, zA, zB, 1.0, 1.0, 0.45, { endSeg: 6, seg: 6, steps: 2 }))
  const length = zB - zA
  for (let k = 1; k < COMPARTMENTS; k++) {
    const z = zA + (length * k) / COMPARTMENTS
    batch.add('steel', slab(-1.235, 1.235, y0 - 0.015, y1 + 0.015, z - 0.05, z + 0.05, 1.015, 1.015, 0.01, { ends: 'none' }))
  }
  for (const z of [zA + 0.55, zB - 0.55]) batch.add('steel', slab(-1.232, 1.232, y0 - 0.012, y1 + 0.012, z - 0.04, z + 0.04, 1.012, 1.012, 0.01, { ends: 'none' }))
  batch.add('darkSteel', boxAt(-0.42, 0.42, y1 + 0.005, y1 + 0.03, zA + 0.6, zB - 0.6))
  for (let k = 0; k < COMPARTMENTS; k++) {
    const z = zA + (length * (k + 0.5)) / COMPARTMENTS
    batch.add('steel', at(cylinder(0.66, 0.72, 0.1, 18), 0, y1 + 0.04, z))
    batch.add('aluminum', at(sphere(0.62, 10, 1, 0.42, 1), 0, y1 + 0.1, z))
    batch.add('darkSteel', boxAt(-0.07, 0.07, y1 + 0.04, y1 + 0.1, z + 0.31, z + 0.38))
    for (const a of [0.8, 2.4, 3.9, 5.5]) batch.add('steel', boxAt(-0.02, 0.02, y1 + 0.08, y1 + 0.2, 0.31, 0.35).transform(rotationY(a, 0, z)))
    batch.add('steel', at(cylinder(0.07, 0.07, 0.16, 8), 0.2, y1 + 0.2, z - 0.1))
  }
  for (const side of [-1, 1]) {
    const x = side * 0.45
    for (let z = zA + 0.8; z < zB - 0.7; z += 1.5) batch.add('steel', boxAt(x - 0.015, x + 0.015, y1 + 0.03, y1 + 0.4, z - 0.015, z + 0.015))
    batch.add('steel', boxAt(x - 0.015, x + 0.015, y1 + 0.37, y1 + 0.4, zA + 0.7, zB - 0.7))
    batch.add('steel', boxAt(x - 0.012, x + 0.012, y1 + 0.2, y1 + 0.222, zA + 0.7, zB - 0.7))
  }
  const manifoldZ0 = -8.8
  batch.add('aluminum', at(cylinder(0.1, 0.1, 2.0, 12, 'z'), -0.8, 0.78, manifoldZ0 + 1.0))
  for (let k = 0; k < 4; k++) {
    const z = manifoldZ0 + 0.25 + k * 0.5
    batch.add('aluminum', at(cylinder(0.07, 0.07, 0.5, 10, 'x'), -1.05, 0.78, z))
    batch.add('steel', at(cylinder(0.16, 0.16, 0.1, 12, 'x'), -1.3, 0.78, z))
    batch.add(k % 2 === 0 ? 'hoseRed' : 'hoseBlue', at(cylinder(0.12, 0.12, 0.05, 12, 'x'), -1.37, 0.78, z))
    batch.add('aluminum', at(cylinder(0.05, 0.05, 0.28, 8), -0.8, 0.95, z))
  }
  batch.add('darkSteel', boxAt(-1.12, -0.5, 0.68, 0.7, manifoldZ0 - 0.1, manifoldZ0 + 2.1))
  const hoseA = tube(coil(-1.2, -4.9, 0.86, 0.3, 3), 0.045, 8)
  const hoseB = tube(coil(-1.2, -4.2, 0.86, 0.3, 3), 0.045, 8)
  batch.add('hoseRed', hoseA)
  batch.add('hoseBlue', hoseB)
  batch.add('darkSteel', boxAt(-1.3, -0.7, 0.5, 0.54, -5.3, -3.8))
  batch.add('darkSteel', boxAt(-1.3, -1.26, 0.5, 1.2, -5.3, -5.26))
  batch.add('darkSteel', boxAt(-1.3, -1.26, 0.5, 1.2, -3.84, -3.8))
  const gaugeBoards = new MergeBatch()
  for (let k = 0; k < COMPARTMENTS; k++) {
    const z = zA + (length * (k + 0.5)) / COMPARTMENTS
    batch.add('satinBlack', boxAt(-1.27, -1.22, 1.74, 2.26, z - 0.07, z + 0.07))
    gaugeBoards.add('matte:#d9c25a', boxAt(-0.012, 0.012, 0, 0.5, -0.025, 0.025).transform(translation(-1.285, 0, z)))
  }
  const bars = gaugeBoards.build(ctx.scene, 'trailer-gauge', ctx.root, palette, ctx.meshes)[0] as Mesh
  bars.scaling.y = 0.001
  bars.position.y = 1.76
  bars.isVisible = false
  let fluidSlot = 'matte:#d9c25a'
  return {
    layout: null,
    update(pose) {
      updateGear(pose)
      updateTail(pose)
    },
    setFluidMaterial(color) {
      if (!color) return
      fluidSlot = `matte:${color.toLowerCase()}`
      bars.material = palette.get(fluidSlot)
    },
    fluid(color, fill) {
      if (color && `matte:${color.toLowerCase()}` !== fluidSlot) {
        fluidSlot = `matte:${color.toLowerCase()}`
        bars.material = palette.get(fluidSlot)
      }
      bars.isVisible = fill > 0.001
      bars.scaling.y = Math.max(0.001, fill)
    },
  }
}

function rotationY(angle: number, x: number, z: number): Matrix {
  return Matrix.RotationY(angle).multiply(Matrix.Translation(x, 0, z))
}

function translation(x: number, y: number, z: number): Matrix {
  return Matrix.Translation(x, y, z)
}
