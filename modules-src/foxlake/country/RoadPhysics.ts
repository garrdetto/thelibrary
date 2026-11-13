/**
 * The interstate as the town's cars feel it (Rapier, town coordinates): every
 * jersey wall, guardrail and the road-closed barricade is a solid box, the
 * bridge has a deck to drive across instead of a drop into the channel, and
 * the lake country's heightfield is lifted to the road surfaces (the
 * interstate and the Lake Road) so wheels ride on the asphalt, not under it.
 * Rack & Reel's own vehicles (the side-by-side and the quad) test the same
 * barrier pieces through `hitsBarrier`.
 */
import { HIGHWAY, highwayCoord, highwayGrade, rawHeight, type Terrain, type TerrainShape } from '../../rackreel/world/Terrain'
import type { Physics } from '../fp/physics/Physics'
import { TOWN_Y, sceneToTown } from '../region'
import { barrierSegments, lakeRoadHeight, type BarrierSegment } from './Roads'

/** The road surface under (x, z) where a road covers the lake country, or null. */
export function roadSurface(shape: TerrainShape, terrain: Terrain, x: number, z: number): number | null {
  const { t, across } = highwayCoord(x, z)
  if (across < HIGHWAY.halfWidth + 0.6 && Math.abs(t) < HIGHWAY.reach && Math.abs(t) > HIGHWAY.span / 2 + 1) return Math.max(highwayGrade(t, shape), terrain.heightAt(x, z)) + 0.05
  if ((shape.roadClear?.(x, z) ?? 1) < 0.3 && x > 100 && z < 60) return lakeRoadHeight(x, z, (a, b) => rawHeight(a, b, shape)) + 0.06
  return null
}

/** Adds the barriers and the bridge deck to `physics`; returns the barrier pieces for Rack & Reel's vehicles. */
export function addRoadColliders(physics: Physics, terrain: Terrain, shape: TerrainShape): BarrierSegment[] {
  const surface = (x: number, z: number) => Math.max(terrain.heightAt(x, z), highwayGrade(highwayCoord(x, z).t, shape))
  const segs = barrierSegments(shape, surface)
  for (const s of segs) {
    const a = sceneToTown(s.ax, 0, s.az)
    const b = sceneToTown(s.bx, 0, s.bz)
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    physics.addStaticBox({
      cx: (a.x + b.x) / 2,
      cy: (s.y0 + s.y1) / 2 - TOWN_Y,
      cz: (a.z + b.z) / 2,
      hx: s.half,
      hy: (s.y1 - s.y0) / 2,
      hz: len / 2 + 0.05,
      rotY: Math.atan2(b.x - a.x, b.z - a.z),
    })
  }
  const c = sceneToTown(HIGHWAY.x, 0, HIGHWAY.z)
  const dir = { x: HIGHWAY.dx, z: -HIGHWAY.dz }
  const deck = HIGHWAY.deck - TOWN_Y
  physics.addStaticBox({ cx: c.x, cy: deck - 0.35, cz: c.z, hx: HIGHWAY.halfWidth + 0.5, hy: 0.35, hz: HIGHWAY.span / 2 + 1.5, rotY: Math.atan2(dir.x, dir.z) })
  return segs
}
