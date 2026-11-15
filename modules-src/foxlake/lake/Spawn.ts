import type { TelloLand } from '../../tello/region'

export interface StreetSpot {
  x: number
  z: number
  /** Which way the street runs there, 0 = north, clockwise (map frame). */
  heading: number
}

const DOWNTOWN = { x: 110, z: -98 }
const MAIN_STREET = 'Main Street'

/**
 * Where a player with no home starts: the kerb of Main Street by the dealership downtown, facing along the street, on
 * ground clear of pavement edges, walls and water (map coordinates).
 */
export function findMainStreet(land: TelloLand): StreetSpot {
  let best: StreetSpot | null = null
  let bestDistance = Infinity
  const consider = (onlyMain: boolean) => {
    for (const road of land.doc.roads) {
      if (road.k > 1 || (onlyMain && road.n !== MAIN_STREET)) continue
      const p = road.p
      for (let k = 0; k + 3 < p.length; k += 2) {
        const mx = (p[k] + p[k + 2]) / 2
        const mz = (p[k + 1] + p[k + 3]) / 2
        const dx = p[k + 2] - p[k]
        const dz = p[k + 3] - p[k + 1]
        const len = Math.hypot(dx, dz)
        const d = Math.hypot(mx - DOWNTOWN.x, mz - DOWNTOWN.z)
        if (d >= bestDistance || len < 6) continue
        const side = road.w / 2 + 1.6
        const x = mx + (dz / len) * side
        const z = mz - (dx / len) * side
        if (land.clearAt(x, z) < 0.6 || land.depthAt(x, z) > 0 || !land.playable(x, z, 20)) continue
        bestDistance = d
        best = { x, z, heading: Math.atan2(dx, dz) }
      }
    }
  }
  consider(true)
  if (!best) consider(false)
  if (!best) throw new Error('Montello has no street to start on')
  return best
}
