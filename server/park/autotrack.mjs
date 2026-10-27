import { COASTER_STYLES } from './catalog.mjs'
import { trackPoses, nextPose, pieceCells, pieceLengthTiles, validatePieceAt } from './track.mjs'

const MAX_EXPANSIONS = 6000

class Heap {
  constructor() { this.items = [] }
  get size() { return this.items.length }
  push(node) {
    const a = this.items
    a.push(node)
    let i = a.length - 1
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f < a[i].f || (a[p].f === a[i].f && a[p].seq <= a[i].seq)) break; [a[p], a[i]] = [a[i], a[p]]; i = p }
  }
  pop() {
    const a = this.items, top = a[0], last = a.pop()
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1, r = l + 1
        let m = i
        const less = (x, y) => a[x].f < a[y].f || (a[x].f === a[y].f && a[x].seq < a[y].seq)
        if (l < a.length && less(l, m)) m = l
        if (r < a.length && less(r, m)) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]; i = m
      }
    }
    return top
  }
}

function candidates(slope, style) {
  const list = []
  for (const s of [slope - 1, slope, slope + 1]) {
    if (s < -1 || s > 1) continue
    const chain = s > 0 || (s === 0 && slope > 0)
    list.push({ c: 0, s, ...(chain ? { sp: 'chain' } : {}) })
  }
  if (Math.abs(slope) <= 1) for (const c of [1, -1, 2, -2]) list.push({ c, s: slope, ...(slope > 0 ? { sp: 'chain' } : {}) })
  void style
  return list
}

const keyOf = p => `${Math.round(p.x * 2)},${Math.round(p.y * 2)},${p.h},${p.dir},${p.slope}`

export function autoComplete(state, ride) {
  if (ride.complete) return { error: 'The circuit is already complete.' }
  const style = COASTER_STYLES[ride.style]
  const poses = trackPoses(ride)
  const start = poses[0], from = poses[poses.length - 1]
  const inverted = ride.style === 'inverted'
  const heuristic = p => Math.abs(p.x - start.x) + Math.abs(p.y - start.y) + Math.abs(p.h - start.h) / 2 + (p.dir === start.dir ? 0 : 1.5) + Math.abs(p.slope) * 0.5
  const heap = new Heap()
  let seq = 0
  heap.push({ pose: from, piece: null, parent: null, g: 0, f: heuristic(from), depth: 0, cells: [], seq: seq++ })
  const seen = new Map([[keyOf(from), 0]])
  let expansions = 0
  while (heap.size && expansions < MAX_EXPANSIONS) {
    const node = heap.pop()
    expansions++
    const index = ride.pieces.length + node.depth
    if (index >= 220) continue
    const ancestors = []
    for (let n = node; n && n.piece; n = n.parent) for (const cell of n.cells) ancestors.push(cell)
    const fullPieces = ride.pieces.slice()
    const chain = []
    for (let n = node; n && n.piece; n = n.parent) chain.unshift(n.piece)
    fullPieces.push(...chain)
    for (const piece of candidates(node.pose.slope, style)) {
      const result = validatePieceAt(state, ride, node.pose, index, start, piece, ancestors, fullPieces)
      if (!result.ok) continue
      const g = node.g + pieceLengthTiles(piece) + (piece.s !== node.pose.slope ? 0.3 : 0) + (piece.c ? 0.2 : 0)
      const cells = pieceCells(node.pose, piece, inverted).map(cell => ({ ...cell, piece: index }))
      if (result.closes) {
        const pieces = [...chain, piece]
        return { pieces, expansions }
      }
      const next = nextPose(node.pose, piece)
      const key = keyOf(next)
      if (seen.has(key) && seen.get(key) <= g) continue
      seen.set(key, g)
      heap.push({ pose: next, piece, parent: node, g, f: g + heuristic(next) * 1.15, depth: node.depth + 1, cells, seq: seq++ })
    }
  }
  return { error: 'No clear route back to the station was found. Remove a few pieces, clear some space, or steer the track closer to the station first.' }
}
