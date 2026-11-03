/** One hole as queryable geometry: terrain height and slope, surfaces, bounds, trees, tee, pin and drop zones. Used by the flight integrator and to sample the terrain mesh. */
import { tuning, type HoleData, type TerrainShapeSpec, type TreeData, type Vec2 } from '../tuning'
import { classifySurface, distanceToEdge, insidePolygon, preparePolygon, type PreparedPolygon, type SurfaceRegions } from './Surfaces'
import type { RoundMode, SurfaceKind } from '../tuning'
import type { Vec3 } from './Vector'

export interface Course {
  readonly hole: HoleData
  readonly index: number
  readonly regions: SurfaceRegions
  readonly trees: readonly TreeData[]
  readonly greenCenter: Vec2
  heightAt(x: number, z: number): number
  gradientAt(x: number, z: number): Vec2
  normalAt(x: number, z: number): Vec3
  surfaceAt(x: number, z: number): SurfaceKind
  inBounds(x: number, z: number): boolean
  teePosition(): Vec3
  /** Teeing spot for a mode: the real tee, or for closest-to-the-pin a spot on the route a fixed distance short of the green. */
  teeFor(mode: RoundMode): Vec3
  pinPosition(): Vec3
  dropPosition(waterIndex: number): Vec3
  waterIndexAt(x: number, z: number): number
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function centroid(points: readonly Vec2[]): Vec2 {
  let x = 0
  let z = 0
  for (const point of points) {
    x += point[0]
    z += point[1]
  }
  return [x / points.length, z / points.length]
}

/**
 * Builds the course for one hole. Height is a sum of smooth terms so the slope is continuous everywhere:
 *   h(x, z) = Σ hᵢ·exp(−dᵢ²/rᵢ²)                       (rolling hills, Gaussian bumps)
 *           + (g · (p − c))·exp(−|p − c|²/R²)          (green tilt g, faded out around the green centre c)
 *           − D_w·smoothstep(0, s, edgeDistance)       (water basins, inside each pond)
 *           − D_b·smoothstep(0, l, edgeDistance)       (bunker floors, inside each bunker)
 * The gradient ∇h is taken by central differences with step ε, so physics and rendering read the same field.
 */
export function createCourse(index: number, terrain: TerrainShapeSpec = tuning.terrain, hole: HoleData = tuning.holes[index]): Course {
  if (!hole) throw new Error(`No hole at index ${index}`)
  const regions: SurfaceRegions = {
    teeBox: preparePolygon(hole.teeBox),
    fairway: hole.fairway.map(preparePolygon),
    green: preparePolygon(hole.green),
    bunkers: hole.bunkers.map(preparePolygon),
    water: hole.water.map(preparePolygon),
    paths: hole.paths.map(preparePolygon),
  }
  const greenCenter = centroid(hole.green)
  const epsilon = tuning.flight.gradientEpsilon
  const [minX, minZ, maxX, maxZ] = hole.bounds

  const carve = (polygons: readonly PreparedPolygon[], depth: number, width: number, x: number, z: number): number => {
    let total = 0
    for (const polygon of polygons) if (insidePolygon(polygon, x, z)) total += depth * smoothstep(0, width, distanceToEdge(polygon, x, z))
    return total
  }

  const heightAt = (x: number, z: number): number => {
    let height = 0
    for (const hill of hole.hills) {
      const dx = x - hill.x
      const dz = z - hill.z
      height += hill.height * Math.exp(-(dx * dx + dz * dz) / (hill.radius * hill.radius))
    }
    const gx = x - greenCenter[0]
    const gz = z - greenCenter[1]
    height += (hole.greenSlope[0] * gx + hole.greenSlope[1] * gz) * Math.exp(-(gx * gx + gz * gz) / (terrain.greenTiltRadius * terrain.greenTiltRadius))
    height -= carve(regions.water, terrain.basinDepth, terrain.basinShoreWidth, x, z)
    height -= carve(regions.bunkers, terrain.bunkerDepth, terrain.bunkerLipWidth, x, z)
    return height
  }

  const gradientAt = (x: number, z: number): Vec2 => [
    (heightAt(x + epsilon, z) - heightAt(x - epsilon, z)) / (2 * epsilon),
    (heightAt(x, z + epsilon) - heightAt(x, z - epsilon)) / (2 * epsilon),
  ]

  const normalAt = (x: number, z: number): Vec3 => {
    const [dx, dz] = gradientAt(x, z)
    const length = Math.hypot(dx, 1, dz)
    return [-dx / length, 1 / length, -dz / length]
  }

  const onGround = (x: number, z: number): Vec3 => [x, heightAt(x, z) + tuning.ball.radiusM, z]

  return {
    hole,
    index,
    regions,
    trees: hole.trees,
    greenCenter,
    heightAt,
    gradientAt,
    normalAt,
    surfaceAt: (x, z) => classifySurface(regions, x, z),
    inBounds: (x, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ,
    teePosition: () => onGround(hole.tee[0], hole.tee[1]),
    teeFor: (mode) => {
      if (mode !== 'pin' || hole.par === 3) return onGround(hole.tee[0], hole.tee[1])
      const spot = pointBackFromGreen(hole.route, tuning.match.pinTeeDistance)
      return onGround(spot[0], spot[1])
    },
    pinPosition: () => onGround(hole.pin[0], hole.pin[1]),
    dropPosition: (waterIndex) => {
      const drop = hole.drops[waterIndex] ?? hole.drops[0] ?? hole.tee
      return onGround(drop[0], drop[1])
    },
    waterIndexAt: (x, z) => regions.water.findIndex((polygon) => insidePolygon(polygon, x, z)),
  }
}

/** Walks the route backwards from the green by a distance and returns that point (the start if the route is shorter). */
function pointBackFromGreen(route: readonly Vec2[], distance: number): Vec2 {
  let left = distance
  for (let index = route.length - 1; index > 0; index--) {
    const [bx, bz] = route[index]
    const [ax, az] = route[index - 1]
    const length = Math.hypot(bx - ax, bz - az)
    if (left <= length) {
      const t = left / length
      return [bx + (ax - bx) * t, bz + (az - bz) * t]
    }
    left -= length
  }
  return route[0]
}

const cache = new Map<number, Course>()

/** Courses are pure functions of the hole data, so one instance per hole index is shared. */
export function courseFor(index: number): Course {
  let course = cache.get(index)
  if (!course) {
    course = createCourse(index)
    cache.set(index, course)
  }
  return course
}
