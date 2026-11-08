import { D, LotGrid, W, inLot, tileIndex } from './Lot'

export interface PathRules {
  /** May this Sim open doors and stand on inside tiles? */
  inside: boolean
  /** Extra tiles to treat as blocked (another Sim using a spot, for example). */
  blocked?: ReadonlySet<number>
}

const STEPS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
]

export function walkable(grid: LotGrid, x: number, z: number, rules: PathRules): boolean {
  if (!inLot(x, z)) return false
  const index = tileIndex(x, z)
  if (grid.occupied[index] !== -1) return false
  if (!rules.inside && grid.inside[index]) return false
  if (rules.blocked?.has(index)) return false
  return true
}

function canMove(grid: LotGrid, x: number, z: number, dx: number, dz: number, rules: PathRules): boolean {
  const nx = x + dx, nz = z + dz
  if (!walkable(grid, nx, nz, rules)) return false
  if (dx === 0 || dz === 0) return grid.canStep(x, z, nx, nz, rules.inside)
  if (!walkable(grid, x + dx, z, rules) || !walkable(grid, x, z + dz, rules)) return false
  return grid.canStep(x, z, x + dx, z, false) && grid.canStep(x, z, x, z + dz, false)
    && grid.canStep(x + dx, z, nx, nz, false) && grid.canStep(x, z + dz, nx, nz, false)
}

/** A* over the lot's tiles. Returns the tiles after the start, ending on the first goal reached, or null. */
export function findPath(grid: LotGrid, from: [number, number], goals: [number, number][], rules: PathRules): [number, number][] | null {
  const goalSet = new Set(goals.filter(([x, z]) => walkable(grid, x, z, rules)).map(([x, z]) => tileIndex(x, z)))
  if (!goalSet.size) return null
  const start = tileIndex(from[0], from[1])
  if (goalSet.has(start)) return []
  const gScore = new Float32Array(W * D).fill(Infinity)
  const came = new Int32Array(W * D).fill(-1)
  const closed = new Uint8Array(W * D)
  const goalList = [...goalSet].map(i => [i % W, Math.floor(i / W)] as const)
  const h = (i: number) => {
    const x = i % W, z = Math.floor(i / W)
    let best = Infinity
    for (const [gx, gz] of goalList) {
      const dx = Math.abs(gx - x), dz = Math.abs(gz - z)
      best = Math.min(best, Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz))
    }
    return best
  }
  const open: number[] = [start]
  const fScore = new Float32Array(W * D).fill(Infinity)
  gScore[start] = 0
  fScore[start] = h(start)
  while (open.length) {
    let bestAt = 0
    for (let i = 1; i < open.length; i++) if (fScore[open[i]] < fScore[open[bestAt]]) bestAt = i
    const current = open[bestAt]
    open[bestAt] = open[open.length - 1]
    open.pop()
    if (goalSet.has(current)) {
      const path: [number, number][] = []
      for (let at = current; at !== start; at = came[at]) path.push([at % W, Math.floor(at / W)])
      return path.reverse()
    }
    if (closed[current]) continue
    closed[current] = 1
    const x = current % W, z = Math.floor(current / W)
    for (const [dx, dz, cost] of STEPS) {
      if (!canMove(grid, x, z, dx, dz, rules)) continue
      const next = tileIndex(x + dx, z + dz)
      if (closed[next]) continue
      const tentative = gScore[current] + cost
      if (tentative >= gScore[next]) continue
      came[next] = current
      gScore[next] = tentative
      fScore[next] = tentative + h(next)
      open.push(next)
    }
  }
  return null
}

/** The nearest walkable tile to a point, for Sims left standing where a wall or object now is. */
export function nearestWalkable(grid: LotGrid, x: number, z: number, rules: PathRules): [number, number] | null {
  const cx = Math.round(x), cz = Math.round(z)
  for (let radius = 0; radius < Math.max(W, D); radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue
        if (walkable(grid, cx + dx, cz + dz, rules)) return [cx + dx, cz + dz]
      }
    }
  }
  return null
}
