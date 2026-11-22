/**
 * Assembles the static body of a truck from the part builders in `truck/`: chassis and running gear, cab and sleeper, front
 * end, and the frame-side hoist mount on dump trucks. Everything lands in one `PartBatch` keyed by material, so `TruckVisual`
 * turns the whole static truck into one mesh per material. The moving parts (wheels, lift axles, dump bed, tailgate, hoist,
 * heap) are built by `TruckVisual` from the same layout.
 */

import type { TruckLook, TruckModel } from '../../shared/Catalog'
import type { PartBatch } from './truck/Batch'
import type { BedLayout, TruckLayout } from './truck/Layout'
import { truckLayout } from './truck/Layout'
import { buildChassis } from './truck/Chassis'
import { buildCab } from './truck/Cab'
import { buildFrontEnd } from './truck/FrontEnd'
import { hoistRig } from './truck/DumpBody'
import { at, boxAt, cylinder, slab } from './truck/Geometry'

export { truckLayout }
export type { TruckLayout, BedLayout }
export { buildLiftAxle } from './truck/Chassis'
export { buildBed, buildTailgate, buildHeap, buildHoistBarrel, buildHoistRod, hoistRig, hoistPose, tailgatePivot } from './truck/DumpBody'

function hoistMount(b: PartBatch, L: TruckLayout, bed: BedLayout): void {
  const rig = hoistRig(L, bed)
  const rx = L.railX
  b.add('darkSteel', boxAt(-(rx - 0.006), rx - 0.006, L.frameTop - 0.2, L.frameTop - 0.04, rig.baseZ - 0.08, rig.baseZ + 0.08))
  for (const s of [1, -1]) b.add('darkSteel', slab(s * 0.14 - 0.02, s * 0.14 + 0.02, Math.min(rig.baseY - 0.1, L.frameTop - 0.1), rig.baseY + 0.08, rig.baseZ - 0.09, rig.baseZ + 0.09, 0.01))
  b.add('steel', at(cylinder(0.07, 0.07, 0.34, 12, 'x'), 0, rig.baseY, rig.baseZ))
  for (const s of [1, -1]) b.add('darkSteel', boxAt(s * rx - 0.05, s * rx + 0.05, L.frameTop - 0.04, L.frameTop + 0.06, bed.hingeZ - 0.12, bed.hingeZ + 0.12))
}

/** Writes every static part of a truck into the batch. */
export function buildStaticParts(b: PartBatch, L: TruckLayout, look: TruckLook): void {
  buildChassis(b, L, look)
  buildCab(b, L, look)
  buildFrontEnd(b, L, look)
  if (L.bed) hoistMount(b, L, L.bed)
}

const layouts = new WeakMap<TruckModel, TruckLayout>()

/** The layout of a catalog model (cached per model object). */
export function layoutOf(model: TruckModel): TruckLayout {
  let layout = layouts.get(model)
  if (!layout) {
    layout = truckLayout(model)
    layouts.set(model, layout)
  }
  return layout
}
