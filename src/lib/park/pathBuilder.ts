import { DIRS, SLOPE_RISE, STAIR_RISE, groundHeightAt, inMap, pathHeightAt, tileIndex, tileMax, tileMin, tileSlope } from '../../../server/park/index.mjs'
import type { ParkMap } from '../../../server/park/index.mjs'

export type PathSegment = 'level' | 'up' | 'down' | 'stairs-up' | 'stairs-down'
export type PathKind = 1 | 2 | 4
export type PathEnd = { x: number; y: number; dir: number; exit: number; slope: -1 | 0 | 1; placed: boolean }
export type PathBuild = PathEnd & { trail: PathEnd[] }
export type GhostPiece = { x: number; y: number; dir: number; kind: number; z0: number; z1: number; ground: boolean }
export type PathPlan =
  | { ok: true; anchor: true; x: number; y: number; dir: number; end: PathEnd }
  | { ok: true; anchor: false; x: number; y: number; dir: number; kind: 1 | 2 | 3 | 4; elevation: number; end: PathEnd; ghost: GhostPiece; cost: number }
  | { ok: false; x: number; y: number; dir: number; error: string; ghost?: GhostPiece }

const TILE = 4
const PIECE_COST: Record<number, number> = { 1: 12, 2: 14, 3: 18, 4: 24 }

export const segmentRise = (segment: PathSegment) =>
  segment === 'up' ? SLOPE_RISE : segment === 'down' ? -SLOPE_RISE : segment === 'stairs-up' ? STAIR_RISE : segment === 'stairs-down' ? -STAIR_RISE : 0

export function nextDir(dir: number, turn: number) {
  return (dir - turn + 4) % 4
}

export function edgeHeight(map: ParkMap, x: number, y: number, dir: number, inset = 0.02) {
  return pathHeightAt(map, (x + 0.5 + DIRS[dir][0] * (0.5 - inset)) * TILE, (y + 0.5 + DIRS[dir][1] * (0.5 - inset)) * TILE, TILE)
}

function groundEdge(map: ParkMap, x: number, y: number, dir: number) {
  return groundHeightAt(map, (x + 0.5 + DIRS[dir][0] * 0.49) * TILE, (y + 0.5 + DIRS[dir][1] * 0.49) * TILE, TILE)
}

export function pathHeading(map: ParkMap, x: number, y: number) {
  for (let d = 0; d < 4; d++) {
    const bx = x - DIRS[d][0], by = y - DIRS[d][1]
    if (inMap(map, bx, by) && map.path[tileIndex(map, bx, by)]) {
      const ax = x + DIRS[d][0], ay = y + DIRS[d][1]
      if (!inMap(map, ax, ay) || !map.path[tileIndex(map, ax, ay)]) return d
    }
  }
  return 0
}

// Where a new run starts when the player clicks an empty tile: level with an
// adjoining path, or on the ground.
export function startEnd(map: ParkMap, x: number, y: number): PathEnd {
  const dir = pathHeading(map, x, y)
  const bx = x - DIRS[dir][0], by = y - DIRS[dir][1]
  const joined = inMap(map, bx, by) && map.path[tileIndex(map, bx, by)]
  const exit = joined ? edgeHeight(map, bx, by, dir) : groundEdge(map, x, y, (dir + 2) % 4)
  return { x: bx, y: by, dir, exit, slope: 0, placed: false }
}

export function anchorEnd(map: ParkMap, x: number, y: number, dir: number): PathEnd {
  return { x, y, dir, exit: edgeHeight(map, x, y, dir), slope: 0, placed: false }
}

// Plans the next piece coaster-style: one tile on from the current end, turned
// left/right or straight, then flat, sloped or stairs. A sloped piece stores
// its high end and ramps down to its lower neighbour, so slopes always run
// straight and a climb never starts right after a descent.
export function planPiece(map: ParkMap, park: number, from: PathEnd, segment: PathSegment, turn: number, pathKind: PathKind): PathPlan {
  const dir = nextDir(from.dir, turn)
  const x = from.x + DIRS[dir][0], y = from.y + DIRS[dir][1]
  const rise = segmentRise(segment)
  const sign = Math.sign(rise) as -1 | 0 | 1
  const fail = (error: string, ghost?: GhostPiece): PathPlan => ({ ok: false, x, y, dir, error, ...(ghost ? { ghost } : {}) })
  if (!inMap(map, x, y)) return fail('The path has reached the edge of the map.')
  const stairs = segment.startsWith('stairs')
  const kind = stairs ? 3 : pathKind
  const z0 = from.exit, z1 = from.exit + rise
  const ghost: GhostPiece = { x, y, dir, kind, z0, z1, ground: false }
  if (from.slope !== 0 && turn !== 0) return fail('Slopes and stairs run straight. Add a flat piece before turning.', ghost)
  if (from.slope < 0 && sign > 0) return fail('Add a flat piece between going down and going up.', ghost)
  const i = tileIndex(map, x, y)
  if (map.path[i]) {
    if (map.owner[i] !== park) return fail('That path belongs to another park.')
    if (sign !== 0) return fail('Choose Flat to join the path ahead.')
    const back = (dir + 2) % 4
    if (Math.abs(edgeHeight(map, x, y, back) - from.exit) > 0.3) return fail('The path ahead is at a different height. Use slopes or stairs to meet it.')
    return { ok: true, anchor: true, x, y, dir, end: anchorEnd(map, x, y, dir) }
  }
  if (map.owner[i] !== park) return fail('You can only build on land your park owns.', ghost)
  if (map.obj[i]) return fail('Something is in the way. Clear it or build around it.', ghost)
  const water = map.water[i] >= 0 && map.water[i] > tileMin(map, x, y)
  const base = Math.max(tileMax(map, x, y), map.water[i] >= 0 ? map.water[i] + 0.1 : -Infinity)
  const stored = sign > 0 ? z1 : z0
  if (sign === 0 && stored <= base + 0.25 && !(water && pathKind !== 4)) {
    const entry = groundEdge(map, x, y, (dir + 2) % 4)
    const flatGhost: GhostPiece = { ...ghost, z0: entry, z1: groundEdge(map, x, y, dir), ground: true }
    if (Math.abs(entry - from.exit) > 0.3) return fail('The ground here is at a different height. Use a slope or stairs.', flatGhost)
    if (pathKind !== 4 && tileSlope(map, x, y).dir === -2) return fail('The land is too steep for a path. Use stairs or smooth it first.', flatGhost)
    return { ok: true, anchor: false, x, y, dir, kind: pathKind, elevation: 0, ghost: flatGhost, cost: PIECE_COST[pathKind], end: { x, y, dir, exit: flatGhost.z1, slope: 0, placed: true } }
  }
  const elevation = Math.round((stored - base) / 0.5)
  if (elevation < 0 || stored < base - 0.05) return fail('The ground is too high here. Go up or turn.', ghost)
  if (Math.abs(base + elevation * 0.5 - stored) > 0.06) return fail('The ground here does not line up. Level the land or try another piece.', ghost)
  if (sign !== 0 && elevation < 1) return fail('The ground is too high here. Go up or turn.', ghost)
  if (sign < 0 && z1 < base - 0.05) return fail('Too close to the ground to go down here.', ghost)
  if (elevation > 24) return fail('The path cannot go any higher.', ghost)
  if (water && elevation === 0 && pathKind !== 4) return fail('Raise the path or use a boardwalk over water.', ghost)
  return { ok: true, anchor: false, x, y, dir, kind, elevation, ghost, cost: PIECE_COST[kind], end: { x, y, dir, exit: z1, slope: sign, placed: true } }
}

export function ghostCorners(map: ParkMap, g: GhostPiece): [number, number, number, number] {
  const at = (u: number, v: number) => {
    if (g.ground) return groundHeightAt(map, (g.x + u) * TILE, (g.y + v) * TILE, TILE)
    const t = g.dir === 0 ? u : g.dir === 2 ? 1 - u : g.dir === 1 ? v : 1 - v
    return g.z0 + (g.z1 - g.z0) * t
  }
  return [at(0, 0), at(1, 0), at(1, 1), at(0, 1)]
}
