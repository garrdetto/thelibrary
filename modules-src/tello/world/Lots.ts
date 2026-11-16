/**
 * Marks every parking lot in town: white stall stripes in rows, a concrete curb round the edge that opens at
 * driveways, and light poles down the aisles of the big lots (Blender `lot-light`, the lamps glow at night). The lots
 * themselves are the slabs Roads.ts lays; the aerial-photo lots (schools, Freitag's, the club) are in the JSON `lots`
 * with a name. Planning is in LotPlan.ts. A lot the World Editor marked "no stalls" (`ns`) gets no stripes, and no light
 * goes up inside one of its light cuts.
 */
import { isBlocked } from './Clearance'
import { place } from './Kit'
import { hexRGB } from '../../foxlake/fp/core/Geo'
import type { LotData } from '../data/MapData'
import { FORECOURT } from '../data/Forecourts'
import type { TelloLand } from '../region'
import { Decals } from './Decals'
import { lightCut } from './EditedFeatures'
import { planLot, type LotPlan, type Obstacles } from './LotPlan'
import type { PlaceLayer } from './PlaceLayer'
import type { StaticSink } from './Sink'

export interface LotsBuilt { lots: number; stalls: number; lights: number; plans: Map<number, LotPlan> }

const POLE = hexRGB(0x3d4146)
const UNSTRIPED = /bus lot|paved court|south-west|service yard/

export function buildLots(decals: Decals, layer: PlaceLayer, sink: StaticSink, land: TelloLand): LotsBuilt {
  const obstacles: Obstacles = { roads: land.doc.roads, blocks: land.doc.buildings.filter((b) => b.k !== 'canopy' && !isBlocked(land, b)).map((b) => b.p) }
  const out: LotsBuilt = { lots: 0, stalls: 0, lights: 0, plans: new Map() }
  land.doc.lots.forEach((lot: LotData, index) => {
    if (FORECOURT.test(lot.n ?? '')) return
    const plan = planLot(lot.p, obstacles, { stripes: !lot.ns && !UNSTRIPED.test(lot.n ?? '') })
    out.plans.set(index, plan)
    out.lots++
    out.stalls += plan.stalls
    for (const [x0, z0, x1, z1] of plan.stripes) decals.line('white', x0, z0, x1, z1, 0.1, 0.09, 4)
    for (const run of plan.curbs) decals.curb(run)
    for (const [x, z] of plan.lights) {
      if (lightCut(land, x, z)) continue
      const y = land.heightAt(x, z)
      layer.lay('lot-light', x, -z, place(x, y, -z, 1, 1, 1, 0), { metal: POLE })
      sink.addStaticCylinder(x, y + 4, -z, 4, 0.25)
      out.lights++
    }
  })
  return out
}
