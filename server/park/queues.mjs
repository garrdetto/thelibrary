import { DIRS } from './util.mjs'
import { tileIndex, inMap, isWalkPath, pathsConnect } from './terrain.mjs'

// Queue lines follow the order their tiles were laid. `map.pathOrder` holds a
// running placement number per path tile, so a line that weaves back and forth
// with its rows touching still reads as one line: each tile links to the tile
// laid just before it and the tile laid just after it, not to whichever queue
// tile happens to sit beside it.

export const QUEUE = 2

export function nextPathOrder(map) {
  let max = 0
  const orders = map.pathOrder ?? []
  for (let i = 0; i < orders.length; i++) if (orders[i] > max) max = orders[i]
  return max + 1
}

export function pathOrderAt(map, i) {
  return map.pathOrder?.[i] ?? 0
}

function queueNeighbours(map, x, y) {
  const out = []
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS[d][0], ny = y + DIRS[d][1]
    if (!inMap(map, nx, ny)) continue
    const ni = tileIndex(map, nx, ny)
    if (map.path[ni] !== QUEUE || !pathsConnect(map, x, y, nx, ny)) continue
    out.push({ d, order: pathOrderAt(map, ni) })
  }
  return out
}

// The directions to the tile laid before this one (`prev`) and after it
// (`next`), or -1. Tiles without a recorded order (older saves) fall back to
// running straight through when two neighbours line up.
export function queueLinks(map, x, y) {
  const mine = pathOrderAt(map, tileIndex(map, x, y))
  const around = queueNeighbours(map, x, y)
  let prev = -1, next = -1, prevOrder = -Infinity, nextOrder = Infinity
  const loose = []
  for (const n of around) {
    if (mine > 0 && n.order > 0 && n.order < mine) { if (n.order > prevOrder) { prevOrder = n.order; prev = n.d } }
    else if (mine > 0 && n.order > mine) { if (n.order < nextOrder) { nextOrder = n.order; next = n.d } }
    else loose.push(n.d)
  }
  if (prev < 0 && next < 0 && loose.length) {
    const straight = loose.find(d => loose.includes((d + 2) % 4))
    prev = straight >= 0 ? straight : loose[0]
    next = loose.find(d => d === (prev + 2) % 4) ?? loose.find(d => d !== prev) ?? -1
  } else if (prev < 0 && loose.length) prev = loose.find(d => d !== next) ?? -1
  else if (next < 0 && loose.length) next = loose.find(d => d !== prev) ?? -1
  return { prev, next }
}

// Which neighbour continues the line from `cur` when walking it in the
// direction the builder laid it: forward along increasing order when `forward`
// is true, otherwise back toward the start. The nearest tile in that direction
// comes first, then the nearest the other way, then tiles with no order, in
// `heading` order. `avoid` and `seen` are tile indices the line may not step
// onto.
export function queueStep(map, cur, forward, seen, avoid, heading = 0) {
  const mine = pathOrderAt(map, tileIndex(map, cur[0], cur[1]))
  const around = queueNeighbours(map, cur[0], cur[1]).filter(n => {
    const i = tileIndex(map, cur[0] + DIRS[n.d][0], cur[1] + DIRS[n.d][1])
    return !seen.has(i) && !avoid?.has(i)
  })
  const later = around.filter(n => n.order > mine).sort((a, b) => a.order - b.order)
  const earlier = around.filter(n => n.order > 0 && n.order < mine).sort((a, b) => b.order - a.order)
  const turn = d => (d - heading + 4) % 4
  const rank = { 0: 0, 1: 1, 3: 2, 2: 3 }
  const loose = around.filter(n => n.order === 0 || n.order === mine).sort((a, b) => rank[turn(a.d)] - rank[turn(b.d)])
  const pick = [...(forward ? later : earlier), ...(forward ? earlier : later), ...loose][0]
  if (!pick) return null
  return { x: cur[0] + DIRS[pick.d][0], y: cur[1] + DIRS[pick.d][1], d: pick.d }
}

// Sides of one queue tile: which carry a railing, which stay open, and the
// two sides the line runs through. `openings` adds sides that must stay open
// (where the line meets the footpath or a ride gate), and `links` can name
// the sides the line arrives from and leaves by when they are already known
// from walking the line.
export function queueLayout(map, x, y, openings = [], links = null) {
  const found = queueLinks(map, x, y)
  const prev = links?.prev ?? found.prev, next = links?.next ?? found.next
  const open = new Set(openings.filter(d => d >= 0))
  const through = [prev, next].filter(d => d >= 0)
  for (const d of through) open.add(d)
  const i = tileIndex(map, x, y)
  const walkSide = () => {
    const sides = []
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1]
      if (inMap(map, nx, ny) && isWalkPath(map.path[tileIndex(map, nx, ny)]) && pathsConnect(map, x, y, nx, ny)) sides.push(d)
    }
    return sides
  }
  if (!openings.length) {
    const ahead = prev >= 0 ? (prev + 2) % 4 : next >= 0 ? (next + 2) % 4 : -1
    if (next < 0) {
      const sides = walkSide()
      const pick = sides.includes(ahead) ? ahead : sides[0] ?? ahead
      if (pick >= 0) open.add(pick)
    }
    if (prev < 0 && next >= 0) {
      const sides = walkSide().filter(d => d !== next)
      if (sides.length) open.add(sides.includes(ahead) ? ahead : sides[0])
    }
  }
  const rails = [0, 1, 2, 3].map(d => !open.has(d))
  const bend = prev >= 0 && next >= 0 && prev !== (next + 2) % 4
  const axis = prev >= 0 ? prev : next >= 0 ? next : (open.has(0) || open.has(2)) ? 0 : 1
  return { prev, next, rails, bend, axis: axis % 2, order: pathOrderAt(map, i) }
}
