/**
 * Where the two halves of Fox Lake sit. The scene uses Rack & Reel's own
 * coordinates (its lake country is the 1024 m square around the origin, +x
 * east, +z north, left-handed like every Babylon scene). The Fox Plains town
 * keeps its shared-world coordinates, which are right-handed: the town hangs
 * under a node that moves it north of the country and mirrors z, so it reads
 * exactly as classic Fox Plains players see it and the numbers the shared
 * world sends never change.
 *
 *   scene.x = town.x + TOWN_OFFSET.x
 *   scene.y = town.y + TOWN_OFFSET.y
 *   scene.z = TOWN_OFFSET.z - town.z
 *
 * East Ave (town x = 87) runs south out of town into the lake country's
 * interstate, which leaves the square's open north edge at about x = -261.
 */
import { HALF, HIGHWAY, PLAY_LIMIT } from '../rackreel/world/Terrain'
import type { OutsideLand, TerrainShape } from '../rackreel/world/Terrain'
import { WORLD_HALF } from '../maplestreet/shared/WorldLayout'

/** Ground level of the town in the scene (above the lake, level with the interstate's north end). */
export const TOWN_Y = 2
export const TOWN_OFFSET = { x: -356, y: TOWN_Y, z: HALF + WORLD_HALF } as const

export interface XYZ {
  x: number
  y: number
  z: number
}

export function townToScene(x: number, y: number, z: number, out: XYZ = { x: 0, y: 0, z: 0 }): XYZ {
  out.x = x + TOWN_OFFSET.x
  out.y = y + TOWN_OFFSET.y
  out.z = TOWN_OFFSET.z - z
  return out
}

export function sceneToTown(x: number, y: number, z: number, out: XYZ = { x: 0, y: 0, z: 0 }): XYZ {
  out.x = x - TOWN_OFFSET.x
  out.y = y - TOWN_OFFSET.y
  out.z = TOWN_OFFSET.z - z
  return out
}

/** A heading (Rack & Reel: forward is (sin h, cos h) in the scene) from a town yaw (forward is (sin y, cos y) in the town), and back. */
export function townYawToHeading(yaw: number): number {
  return wrapAngle(Math.PI - yaw)
}

export function headingToTownYaw(heading: number): number {
  return wrapAngle(Math.PI - heading)
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/** The town's square in scene coordinates. */
export const TOWN_SQUARE = {
  x0: -WORLD_HALF + TOWN_OFFSET.x,
  x1: WORLD_HALF + TOWN_OFFSET.x,
  z0: TOWN_OFFSET.z - WORLD_HALF,
  z1: TOWN_OFFSET.z + WORLD_HALF,
} as const

/** How far in from the town square's outer edges the player may go (the forest ring stops them there). */
export const TOWN_MARGIN = 24

export function inTownSquare(x: number, z: number, margin = 0): boolean {
  const zNear = TOWN_SQUARE.z0 - (margin > 0 ? 0 : 1)
  return x >= TOWN_SQUARE.x0 + TOWN_MARGIN + margin && x <= TOWN_SQUARE.x1 - TOWN_MARGIN - margin && z >= zNear && z <= TOWN_SQUARE.z1 - TOWN_MARGIN - margin
}

/** The country road's centreline, from the interstate's north end to East Ave: a curve, then straight north. */
export const CONNECTOR = (() => {
  const t0 = (HALF - 8 - HIGHWAY.z) / HIGHWAY.dz
  const start = { x: HIGHWAY.x + HIGHWAY.dx * t0, z: HIGHWAY.z + HIGHWAY.dz * t0 }
  const eastAve = townToScene(87, 0, 0).x
  const bend = { x: eastAve, z: HALF + 70 }
  const end = { x: eastAve, z: townToScene(0, 0, 267).z }
  return { t0, start, bend, end, dir: { x: HIGHWAY.dx, z: HIGHWAY.dz }, width: 10, startWidth: HIGHWAY.halfWidth * 2 }
})()

/** Points along the connector, every `step` metres, with the road's width there. */
export function connectorPath(step = 4): { x: number; z: number; w: number }[] {
  const { start, bend, end, dir, width, startWidth } = CONNECTOR
  const out: { x: number; z: number; w: number }[] = []
  const reach = Math.hypot(bend.x - start.x, bend.z - start.z) * 0.5
  const c1 = { x: start.x + dir.x * reach, z: start.z + dir.z * reach }
  const c2 = { x: bend.x, z: bend.z - reach }
  const curveLen = reach * 2.4
  const n = Math.max(4, Math.ceil(curveLen / step))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    const x = u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * bend.x
    const z = u * u * u * start.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * bend.z
    out.push({ x, z, w: startWidth + (width - startWidth) * smooth(t) })
  }
  for (let z = bend.z + step; z <= end.z; z += step) out.push({ x: end.x, z, w: width })
  return out
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Distance from (x, z) to the connector's centreline (sampled; fine for placement and bounds). */
export function connectorDistance(x: number, z: number): number {
  let best = Infinity
  for (const p of connectorSamples()) best = Math.min(best, Math.hypot(p.x - x, p.z - z) - p.w / 2)
  return best
}

let samples: { x: number; z: number; w: number }[] | null = null
function connectorSamples(): { x: number; z: number; w: number }[] {
  return (samples ??= connectorPath(3))
}

/** The town and its forest ring, as land beyond the lake country's square. */
export const TOWN_LAND: OutsideLand = {
  contains(x, z, margin) {
    if (inTownSquare(x, z, margin)) return true
    return z > HALF - 2 && z < TOWN_SQUARE.z0 + 2 && Math.abs(x) < PLAY_LIMIT - margin
  },
  heightAt() {
    return TOWN_Y
  },
}


/** Rack & Reel's map with its north edge open onto the town. */
export const FOX_LAKE_SHAPE: TerrainShape = {
  rim: { north: false, south: true, east: true, west: true },
  outsideHeight: TOWN_Y,
  outside: TOWN_LAND,
}

/** Which part of Fox Lake a scene point is in. */
export function zoneAt(z: number): 'town' | 'country' {
  return z > HALF ? 'town' : 'country'
}
