import { tileIndex, inMap } from './terrain.mjs'

export const LAND_SQUARE_COST = 500
export const LAND_AREA_MAX = 32

export function markLandChanged(state) {
  state.landVersion = (state.landVersion ?? 0) + 1
}

export function ownedTileCount(state, park) {
  const version = state.landVersion ?? 0
  const cache = state.landCounts
  if (!cache || cache.version !== version || cache.map !== state.map.owner) {
    const counts = new Array(Math.max(1, state.parks.length)).fill(0)
    const owner = state.map.owner
    for (let i = 0; i < owner.length; i++) if (owner[i] < counts.length) counts[owner[i]]++
    state.landCounts = { version, map: state.map.owner, counts }
  }
  return state.landCounts.counts[park] ?? 0
}

function landSquareBlocked(state, i) {
  const entity = state.entities[state.map.obj[i]]
  return Boolean(entity && entity.type !== 'scenery')
}

export function landAreaPlan(state, park, area) {
  const map = state.map, land = state.parks[park]?.land
  if (!land) return { error: 'Land purchases are unavailable in this park.', tiles: [], cost: 0 }
  const x0 = Math.max(Math.min(area.x0, area.x1), land.limit.x0), x1 = Math.min(Math.max(area.x0, area.x1), land.limit.x1)
  const y0 = Math.max(Math.min(area.y0, area.y1), land.limit.y0), y1 = Math.min(Math.max(area.y0, area.y1), land.limit.y1)
  if (x1 < x0 || y1 < y0) return { error: 'That area is outside the expansion area.', tiles: [], cost: 0 }
  const candidate = (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1 || !inMap(map, x, y)) return false
    const i = tileIndex(map, x, y)
    return map.owner[i] === 255 && !landSquareBlocked(state, i)
  }
  const ownedBy = (x, y) => inMap(map, x, y) && map.owner[tileIndex(map, x, y)] === park
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  const picked = new Set(), queue = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!candidate(x, y) || !steps.some(([dx, dy]) => ownedBy(x + dx, y + dy))) continue
    const i = tileIndex(map, x, y)
    picked.add(i); queue.push([x, y])
  }
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head]
    for (const [dx, dy] of steps) {
      const nx = x + dx, ny = y + dy
      if (!candidate(nx, ny)) continue
      const i = tileIndex(map, nx, ny)
      if (picked.has(i)) continue
      picked.add(i); queue.push([nx, ny])
    }
  }
  const tiles = [...picked].sort((a, b) => a - b)
  if (!tiles.length) return { error: 'No purchasable land here. Drag over red squares that connect to your park.', tiles, cost: 0 }
  return { tiles, cost: tiles.length * LAND_SQUARE_COST }
}
