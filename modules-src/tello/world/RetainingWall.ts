/**
 * Main Street's concrete retaining wall beside the river (`RiverWall.ts`): a poured wall from the river bed up to a
 * curb's height over the street, its top running from the street's edge out to the face, with the guardrail on it.
 * Each 2 m piece is solid, and the street's river half has a level solid under it so cars ride the level the wall holds.
 */
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { ChunkedBuilders } from '../../foxlake/fp/core/Geo'
import type { Mats } from '../../foxlake/fp/core/Tex'
import { riverWalls, WALL_CURB, WALL_OFFSET } from '../data/RiverWall'
import type { TelloLand } from '../region'
import type { StaticSink } from './Sink'

/** The wall runs this far below the bed so no ground shows under its foot. */
const FOOTING = 0.4

export function buildRetainingWalls(root: TransformNode, mats: Mats, sink: StaticSink, land: TelloLand): number {
  const runs = riverWalls(land.doc).runs
  if (!runs.length) return 0
  const chunks = new ChunkedBuilders(256)
  const concrete = mats.textured('tello-retaining-wall', 'concrete', { color: 0xa9a59c, tile: 1.5 })
  let pieces = 0
  for (const run of runs) {
    const face = run.half + WALL_OFFSET
    const mid = (run.half + face) / 2
    const thick = (face - run.half) / 2
    const level = (k: number) => land.heightAt(run.pts[k * 2] + run.nx[k] * mid, run.pts[k * 2 + 1] + run.nz[k] * mid)
    for (let k = 0; k + 1 < run.y.length; k++) {
      const ax = run.pts[k * 2] + run.nx[k] * mid, az = run.pts[k * 2 + 1] + run.nz[k] * mid
      const bx = run.pts[k * 2 + 2] + run.nx[k + 1] * mid, bz = run.pts[k * 2 + 3] + run.nz[k + 1] * mid
      const len = Math.hypot(bx - ax, bz - az)
      if (len < 0.2) continue
      const cx = (ax + bx) / 2, cz = (az + bz) / 2
      const yaw = Math.atan2(bz - az, bx - ax)
      const road = (level(k) + level(k + 1)) / 2
      const top = road + WALL_CURB
      const foot = road - Math.max(run.depth[k], run.depth[k + 1]) - FOOTING
      const hy = (top - foot) / 2
      chunks.get(cx, -cz, concrete).orientedBox(cx, foot + hy, -cz, len / 2 + 0.03, hy, thick, yaw)
      sink.addStaticBox({ cx, cy: foot + hy, cz: -cz, hx: len / 2 + 0.05, hy, hz: thick, rotY: yaw })
      const rx = (run.pts[k * 2] + run.pts[k * 2 + 2]) / 2 + ((run.nx[k] + run.nx[k + 1]) / 2) * (run.half / 2)
      const rz = (run.pts[k * 2 + 1] + run.pts[k * 2 + 3]) / 2 + ((run.nz[k] + run.nz[k + 1]) / 2) * (run.half / 2)
      sink.addStaticBox({ cx: rx, cy: road - 0.5, cz: -rz, hx: len / 2 + 0.05, hy: 0.5, hz: run.half / 2, rotY: yaw })
      pieces++
    }
  }
  chunks.flush(root, 'tello-retaining-walls')
  return pieces
}
