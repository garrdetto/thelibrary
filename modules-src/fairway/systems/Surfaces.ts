/** Surface classification (which polygon a point lies in) and the lie and contact properties each surface gives the ball. */
import { tuning, type LieKind, type LieSpec, type Polygon, type SurfaceContact, type SurfaceKind } from '../tuning'
import { randomBetween, type RandomSource } from './Random'

export interface PreparedPolygon {
  points: Polygon
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

export interface SurfaceRegions {
  teeBox: PreparedPolygon
  fairway: readonly PreparedPolygon[]
  green: PreparedPolygon
  bunkers: readonly PreparedPolygon[]
  water: readonly PreparedPolygon[]
  paths: readonly PreparedPolygon[]
}

export function preparePolygon(points: Polygon): PreparedPolygon {
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const [x, z] of points) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  return { points, minX, minZ, maxX, maxZ }
}

/** Even-odd ray cast: a horizontal ray from (x, z) crosses the polygon boundary an odd number of times when the point is inside. */
export function insidePolygon(polygon: PreparedPolygon, x: number, z: number): boolean {
  if (x < polygon.minX || x > polygon.maxX || z < polygon.minZ || z > polygon.maxZ) return false
  const points = polygon.points
  let hit = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i]
    const [xj, zj] = points[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
  }
  return hit
}

/** Shortest distance from (x, z) to any edge of the polygon (point-to-segment projection clamped to each edge). */
export function distanceToEdge(polygon: PreparedPolygon, x: number, z: number): number {
  const points = polygon.points
  let best = Infinity
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, az] = points[j]
    const [bx, bz] = points[i]
    const ex = bx - ax
    const ez = bz - az
    const lengthSquared = ex * ex + ez * ez || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / lengthSquared))
    best = Math.min(best, Math.hypot(x - (ax + ex * t), z - (az + ez * t)))
  }
  return best
}

/** Surface at a point. Priority runs water, bunker, green, tee box, cart path, fairway, so hazards cut into the grass they sit in; anything else is rough. */
export function classifySurface(regions: SurfaceRegions, x: number, z: number): SurfaceKind {
  if (regions.water.some((polygon) => insidePolygon(polygon, x, z))) return 'water'
  if (regions.bunkers.some((polygon) => insidePolygon(polygon, x, z))) return 'bunker'
  if (insidePolygon(regions.green, x, z)) return 'green'
  if (insidePolygon(regions.teeBox, x, z)) return 'tee'
  if (regions.paths.some((polygon) => insidePolygon(polygon, x, z))) return 'path'
  if (regions.fairway.some((polygon) => insidePolygon(polygon, x, z))) return 'fairway'
  return 'rough'
}

/** The lie a resting ball has on a surface. Water never holds a ball, so it maps to the rough it is dropped into. */
export function lieForSurface(surface: SurfaceKind): LieKind {
  return surface === 'water' ? 'rough' : surface
}

export function contactFor(surface: SurfaceKind): SurfaceContact {
  return tuning.contact[surface]
}

export function lieSpec(lie: LieKind): LieSpec {
  return tuning.lies[lie]
}

/**
 * Launch-speed multiplier for a lie. Tee shots always use the fairway factor (1.0); the rough rolls a seeded value
 * in its range (0.6–0.8) so the same shot seed always produces the same lie penalty; the bunker is fixed at 0.45.
 */
export function liePowerFactor(lie: LieKind, isTeeShot: boolean, random: RandomSource): number {
  const spec = lieSpec(isTeeShot ? 'fairway' : lie)
  const [min, max] = spec.powerRange
  return min === max ? min : randomBetween(random, min, max)
}

export function lieSpinFactor(lie: LieKind, isTeeShot: boolean): number {
  return lieSpec(isTeeShot ? 'fairway' : lie).spinFactor
}
