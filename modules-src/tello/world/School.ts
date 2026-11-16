/**
 * Montello's schools. The aerial-photo parking lots (the high school's west, north, north-east, south-west and bus
 * lots, St John's lot) get their stripes, curbs and lights from Lots.ts; here the bus lot gets its row of yellow
 * school buses (Blender `school-bus`) parked nose-in the way the photo shows them, and the high school its entrance:
 * a lit canopy over the doors, a lettered board, flagpoles and wall lights. Town frame under the town root.
 */
import { hexRGB } from '../../foxlake/fp/core/Geo'
import type { Poi } from '../data/MapData'
import type { TelloLand } from '../region'
import { at, entryCanopy, wallNear, wallPacks } from './Businesses'
import { alongYaw } from './FieldPlan'
import { place } from './Kit'
import type { LotsBuilt } from './Lots'
import type { PlaceLayer } from './PlaceLayer'
import { pointInRing } from './Poly'
import type { StaticSink } from './Sink'
import { SIGN_INK, type Signs } from './Signs'

export interface SchoolBuilt { buses: number; entrances: number }

const BUS_LOT = 'Montello school bus lot'
const HIGH_SCHOOL = 'Montello Junior-Senior High School'
const BUS_LENGTH = 10.6
const BUS_WIDTH = 2.4
const BUS_STEP = 3.3

export function buildSchool(layer: PlaceLayer, signs: Signs, sink: StaticSink, land: TelloLand, lots: LotsBuilt): SchoolBuilt {
  const out: SchoolBuilt = { buses: 0, entrances: 0 }
  const lotIndex = land.doc.lots.findIndex((l) => (l as { n?: string }).n === BUS_LOT)
  const plan = lots.plans.get(lotIndex)
  if (plan) {
    const ring = land.doc.lots[lotIndex].p
    const cs = Math.cos(plan.angle)
    const sn = Math.sin(plan.angle)
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity
    for (let k = 0; k < ring.length; k += 2) {
      const u = ring[k] * cs + ring[k + 1] * sn
      const v = -ring[k] * sn + ring[k + 1] * cs
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v)
    }
    const vc = v0 + 9
    for (let u = u0 + 6; u < u1 - 4 && out.buses < 14; u += BUS_STEP) {
      const spot = (du: number, dv: number): [number, number] => [(u + du) * cs - (vc + dv) * sn, (u + du) * sn + (vc + dv) * cs]
      const probes = [spot(0, -BUS_LENGTH / 2), spot(0, BUS_LENGTH / 2), spot(-BUS_WIDTH / 2, 0), spot(BUS_WIDTH / 2, 0)]
      if (!probes.every(([x, z]) => pointInRing(ring, x, z))) continue
      const [x, z] = spot(0, 0)
      const y = land.heightAt(x, z)
      const yaw = alongYaw(-sn, cs)
      layer.lay('school-bus', x, -z, place(x, y, -z, 1, 1, 1, yaw), {})
      sink.addStaticBox({ cx: x, cy: y + 1.5, cz: -z, hx: BUS_LENGTH / 2, hy: 1.5, hz: BUS_WIDTH / 2, rotY: yaw })
      out.buses++
    }
  }
  const poi = (land.doc.pois as (Poi & { i?: number })[]).find((p) => p.n === HIGH_SCHOOL)
  const b = poi?.i === undefined ? null : land.doc.buildings[poi.i]
  if (poi && b && !b.x && poi.d) {
    const wall = wallNear(b, poi.d)
    if (wall) {
      const { e } = wall
      entryCanopy(layer, wall, 2.4)
      wallPacks(layer, wall, 4, 3.4)
      const [sx, sz] = at(wall, wall.t)
      signs.add({ text: 'MONTELLO JUNIOR-SENIOR HIGH SCHOOL', x: sx, z: sz, y: wall.floor + 3.9, w: 11, h: 0.9, n: [e.nx, e.nz], board: 0x4a2f22, ink: SIGN_INK, out: 0.35 })
      for (const side of [-1, 1]) {
        const [fx, fz] = at(wall, wall.t + side * 9, 3.2)
        const y = land.heightAt(fx, -fz)
        layer.builder(fx, fz, layer.M.paint).cylinder(fx, y - 0.1, fz, 0.07, 0.05, 9, 8, true, hexRGB(0xd7d9db))
      }
      out.entrances++
    }
  }
  return out
}
