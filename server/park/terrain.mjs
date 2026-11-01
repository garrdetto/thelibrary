import { clamp, makeRng, DIRS, UNIT } from './util.mjs'

export const MAX_LAND = 40
export const PATH_STEP_LIMIT = 1.25
export const STAIR_STEP_LIMIT = 2.25

export const cornerIndex = (map, x, y) => y * (map.w + 1) + x
export const tileIndex = (map, x, y) => y * map.w + x
export const inMap = (map, x, y) => x >= 0 && y >= 0 && x < map.w && y < map.h
export const isWalkPath = kind => kind === 1 || kind === 3 || kind === 4

export function tileCorners(map, x, y) {
  const c = map.corners, w = map.w + 1
  return [c[y * w + x], c[y * w + x + 1], c[(y + 1) * w + x + 1], c[(y + 1) * w + x]]
}

export function tileMin(map, x, y) { return Math.min(...tileCorners(map, x, y)) }
export function tileMax(map, x, y) { return Math.max(...tileCorners(map, x, y)) }

export function tileSlope(map, x, y) {
  const [a, b, c, d] = tileCorners(map, x, y)
  const min = Math.min(a, b, c, d)
  if (a === b && b === c && c === d) return { flat: true, base: a, dir: -1 }
  if (Math.max(a, b, c, d) - min !== 1) return { flat: false, base: min, dir: -2 }
  if (a === d && b === c && b === a + 1) return { flat: false, base: min, dir: 0 }
  if (a === b && c === d && d === a + 1) return { flat: false, base: min, dir: 1 }
  if (a === d && b === c && a === b + 1) return { flat: false, base: min, dir: 2 }
  if (a === b && c === d && a === d + 1) return { flat: false, base: min, dir: 3 }
  return { flat: false, base: min, dir: -2 }
}

export function groundHeightAt(map, wx, wy, tile = 4) {
  const fx = clamp(wx / tile, 0, map.w - 0.0001), fy = clamp(wy / tile, 0, map.h - 0.0001)
  const x = Math.floor(fx), y = Math.floor(fy), u = fx - x, v = fy - y
  const [a, b, c, d] = tileCorners(map, x, y)
  return (a * (1 - u) * (1 - v) + b * u * (1 - v) + c * u * v + d * (1 - u) * v)
}

function pathDeckAtTile(map, x, y) {
  const i = tileIndex(map, x, y)
  const ground = tileMax(map, x, y)
  const base = map.path[i] === 4 || (map.pathElevation?.[i] ?? 0) > 0
    ? Math.max(ground, map.water[i] >= 0 ? map.water[i] + 0.1 : -Infinity)
    : ground
  return base + (map.pathElevation?.[i] ?? 0) * UNIT
}

export function pathHeightAt(map, wx, wy, tile = 4) {
  const ground = groundHeightAt(map, wx, wy, tile)
  const x = Math.floor(wx / tile), y = Math.floor(wy / tile)
  if (!inMap(map, x, y)) return ground
  const i = tileIndex(map, x, y)
  const kind = map.path[i]
  if (!kind) return ground
  if (kind === 3 && (map.pathElevation?.[i] ?? 0) > 0) {
    let low = null
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy
      if (!inMap(map, nx, ny)) continue
      const ni = tileIndex(map, nx, ny)
      if (!map.path[ni]) continue
      const height = pathDeckAtTile(map, nx, ny)
      if (height < pathDeckAtTile(map, x, y) - 0.01 && (!low || height < low.height)) low = { dx, dy, height }
    }
    if (low) {
      const u = wx / tile - x, v = wy / tile - y
      const progress = low.dx ? (low.dx > 0 ? 1 - u : u) : low.dy > 0 ? 1 - v : v
      return low.height + (pathDeckAtTile(map, x, y) - low.height) * clamp(progress, 0, 1)
    }
  }
  const elevation = (map.pathElevation?.[i] ?? 0) * UNIT
  if (kind === 4 || elevation > 0) return pathDeckAtTile(map, x, y)
  return ground
}

export function pathsConnect(map, ax, ay, bx, by, tile = 4) {
  const ai = tileIndex(map, ax, ay), bi = tileIndex(map, bx, by)
  const ah = pathHeightAt(map, (ax + 0.5) * tile, (ay + 0.5) * tile, tile)
  const bh = pathHeightAt(map, (bx + 0.5) * tile, (by + 0.5) * tile, tile)
  const riseLimit = map.path[ai] === 3 || map.path[bi] === 3 ? STAIR_STEP_LIMIT : PATH_STEP_LIMIT
  return Math.abs(ah - bh) <= riseLimit
}

function valueNoise(seed) {
  const rng = makeRng(seed)
  const size = 256, table = Array.from({ length: size * size }, () => rng.next())
  const at = (x, y) => table[((y & 255) * size) + (x & 255)]
  const smooth = t => t * t * (3 - 2 * t)
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = smooth(x - x0), ty = smooth(y - y0)
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1)
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty
  }
}

function fbm(noise, x, y, octaves = 4) {
  let total = 0, amp = 1, freq = 1, norm = 0
  for (let i = 0; i < octaves; i++) { total += noise(x * freq, y * freq) * amp; norm += amp; amp *= 0.5; freq *= 2 }
  return total / norm
}

export function enforceSmooth(map) {
  const w = map.w + 1, h = map.h + 1, c = map.corners
  for (let pass = 0; pass < 60; pass++) {
    let changed = false
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (c[j] < c[i] - 1) { c[j] = c[i] - 1; changed = true }
      }
    }
    if (!changed) break
  }
}

function blankMap(w, h, base) {
  return {
    w, h,
    corners: new Array((w + 1) * (h + 1)).fill(base),
    surface: new Array(w * h).fill(0),
    water: new Array(w * h).fill(-1),
    path: new Array(w * h).fill(0),
    pathElevation: new Array(w * h).fill(0),
    pathColor: new Array(w * h).fill(-1),
    pathAdd: new Array(w * h).fill(0),
    obj: new Array(w * h).fill(0),
    owner: new Array(w * h).fill(255),
    litter: new Array(w * h).fill(0),
  }
}

function flattenRect(map, x0, y0, x1, y1, height) {
  for (let y = y0; y <= y1 + 1; y++) for (let x = x0; x <= x1 + 1; x++) if (x >= 0 && y >= 0 && x <= map.w && y <= map.h) map.corners[cornerIndex(map, x, y)] = height
}

function sculpt(map, kind, seed, ox = 0, oy = 0, pw = map.w, ph = map.h) {
  const noise = valueNoise(seed), detail = valueNoise(seed + 77)
  for (let y = 0; y <= ph; y++) for (let x = 0; x <= pw; x++) {
    const nx = x / pw, ny = y / ph
    const n = fbm(noise, x / 14, y / 14, 4), d = fbm(detail, x / 5, y / 5, 2)
    let height = 6
    if (kind === 'meadow' || kind === 'versus') {
      height = 6 + Math.round((n - 0.5) * 7 + (d - 0.5) * 1.5)
      const stream = Math.abs(ny - (0.32 + Math.sin(nx * 6.2 + seed) * 0.08))
      if (stream < 0.03) height = 3
      else if (stream < 0.06) height = Math.min(height, 5)
    } else if (kind === 'forest') {
      const edge = Math.min(nx, 1 - nx)
      height = 5 + Math.round((n - 0.4) * 9 + Math.max(0, 0.3 - edge) * 30)
    } else if (kind === 'coast') {
      const shore = 0.38 + (n - 0.5) * 0.25 - ny * 0.08
      height = nx < shore ? 1 + Math.round(d * 2) : 6 + Math.round((n - 0.5) * 5)
    } else if (kind === 'canyon') {
      const mesa = n > 0.52 ? 14 : n > 0.44 ? 9 : 5
      height = mesa + Math.round((d - 0.5) * 2)
    } else if (kind === 'alpine') {
      height = 10 + Math.round((n - 0.5) * 14 + Math.max(0, ny - 0.75) * 30)
      const lake = Math.hypot(nx - 0.32, ny - 0.38)
      if (lake < 0.1) height = 7
    } else height = 6
    const cx = ox + x, cy = oy + y
    if (cx <= map.w && cy <= map.h) map.corners[cornerIndex(map, cx, cy)] = clamp(height, 1, MAX_LAND - 4)
  }
}

function paintSurfaces(map, kind, seed) {
  const noise = valueNoise(seed + 5)
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const i = tileIndex(map, x, y), min = tileMin(map, x, y), max = tileMax(map, x, y), n = noise(x / 6, y / 6)
    let surface = 0
    if (kind === 'coast' && min <= 4) surface = 1
    if (kind === 'canyon') surface = max - min > 0 && n > 0.45 ? 3 : n > 0.6 ? 1 : 2
    if (kind === 'alpine') surface = min > 15 || n > 0.55 ? 4 : n < 0.25 ? 3 : 0
    if ((kind === 'meadow' || kind === 'versus' || kind === 'forest') && n > 0.82) surface = 2
    map.surface[i] = surface
  }
}

function addWater(map, level, region = null) {
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (region && !region(x, y)) continue
    if (tileMin(map, x, y) < level) map.water[tileIndex(map, x, y)] = level
  }
}

function scatter(map, rng, kind, ox, oy, pw, ph, list) {
  const density = { meadow: 0.05, versus: 0.05, forest: 0.24, coast: 0.035, canyon: 0.015, alpine: 0.1, flat: 0.01 }[kind] ?? 0.04
  const trees = { meadow: ['oak', 'birch', 'bush', 'oak'], versus: ['oak', 'birch', 'bush', 'pine'], forest: ['pine', 'pine', 'oak', 'birch', 'bush'], coast: ['palm', 'palm', 'bush', 'rock'], canyon: ['rock', 'rock', 'bush'], alpine: ['pine', 'pine', 'rock'], flat: ['oak', 'bush'] }[kind] ?? ['oak']
  for (let y = oy; y < oy + ph; y++) for (let x = ox; x < ox + pw; x++) {
    const i = tileIndex(map, x, y)
    if (map.water[i] >= 0 || map.path[i] || map.obj[i]) continue
    const edge = map.owner[i] === 255 ? 2.2 : 1
    if (rng.next() < density * edge) list.push({ kind: trees[Math.floor(rng.next() * trees.length)], x, y })
  }
}

export function generateMap(scenario, players = 1) {
  const kind = scenario.terrain
  const rng = makeRng(scenario.seed)
  if (kind === 'versus') return generateVersus(scenario, Math.max(2, players), rng)
  const startSize = scenario.size
  const size = startSize * 2
  const offset = Math.floor((size - startSize) / 2)
  const map = blankMap(size, size, 6)
  sculpt(map, kind, scenario.seed)
  enforceSmooth(map)
  const margin = 4
  const initial = { x0: offset + margin, y0: offset + margin, x1: offset + startSize - margin - 1, y1: offset + startSize - margin - 1 }
  const width = initial.x1 - initial.x0 + 1
  const limitX0 = initial.x0 - Math.ceil(width / 2)
  const limitY0 = initial.y0 - Math.ceil(width / 2)
  const landBounds = { initial, limit: { x0: limitX0, y0: limitY0, x1: limitX0 + width * 2 - 1, y1: initial.y1 } }
  for (let y = initial.y0; y <= initial.y1; y++) for (let x = initial.x0; x <= initial.x1; x++) map.owner[tileIndex(map, x, y)] = 0
  const ex = offset + Math.floor(startSize / 2), ey = offset + startSize - margin - 1
  const base = Math.max(4, tileMax(map, ex, ey))
  flattenRect(map, ex - 2, ey - 6, ex + 2, offset + startSize - 1, base)
  enforceSmooth(map)
  if (kind === 'meadow') addWater(map, 4)
  if (kind === 'coast') addWater(map, 4)
  if (kind === 'alpine') addWater(map, 8, (x, y) => Math.hypot(x / size - 0.32, y / size - 0.38) < 0.14)
  paintSurfaces(map, kind, scenario.seed)
  for (let y = ey + 1; y < offset + startSize; y++) { map.path[tileIndex(map, ex, y)] = 1; map.water[tileIndex(map, ex, y)] = -1 }
  for (let k = 1; k <= 4; k++) { const i = tileIndex(map, ex, ey - k); map.path[i] = 1; map.water[i] = -1 }
  map.water[tileIndex(map, ex, ey)] = -1
  const scenery = []
  scatter(map, rng, kind, 0, 0, size, size, scenery)
  const clear = scenery.filter(item => !(Math.abs(item.x - ex) <= 2 && item.y >= ey - 6))
  return { map, scenery: clear, entrances: [{ park: 0, x: ex, y: ey, dir: 3 }], landBounds }
}

function generateVersus(scenario, players, rng) {
  const size = scenario.size
  const map = blankMap(size, size, 6)
  const half = size / 2
  const plotSize = half
  const template = blankMap(plotSize, plotSize, 6)
  sculpt(template, 'versus', scenario.seed)
  enforceSmooth(template)
  const offsets = [[0, 0], [half, 0], [0, half], [half, half]]
  const entrances = []
  const plots = players <= 2 ? [[0, 0, half, size], [half, 0, half, size]] : offsets.slice(0, 4).map(([x, y]) => [x, y, half, half])
  for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) {
    const tx = x % plotSize, ty = (players <= 2 ? y % plotSize : y % plotSize)
    map.corners[cornerIndex(map, x, y)] = template.corners[cornerIndex(template, Math.min(tx, plotSize), Math.min(ty, plotSize))]
  }
  for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) {
    const nearSeam = Math.abs(x - half) <= 1 || (players > 2 && Math.abs(y - half) <= 1) || x <= 1 || y <= 1 || x >= size - 1 || y >= size - 1
    if (nearSeam) map.corners[cornerIndex(map, x, y)] = 4
  }
  enforceSmooth(map)
  const count = players <= 2 ? 2 : 4
  for (let p = 0; p < count; p++) {
    const [px, py, pw, ph] = plots[p]
    for (let y = py + 3; y < py + ph - 3; y++) for (let x = px + 3; x < px + pw - 3; x++) map.owner[tileIndex(map, x, y)] = p
    const ex = px + Math.floor(pw / 2), ey = py + ph - 4
    const base = Math.max(4, tileMax(map, ex, ey))
    flattenRect(map, ex - 2, ey - 6, ex + 2, Math.min(size - 1, py + ph - 1), base)
    entrances.push({ park: p, x: ex, y: ey, dir: 3 })
  }
  enforceSmooth(map)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const seam = Math.abs(x + 0.5 - half) < 1.2 || (players > 2 && Math.abs(y + 0.5 - half) < 1.2)
    if (seam && tileMin(map, x, y) < 5) map.water[tileIndex(map, x, y)] = 5
  }
  addWater(map, 4)
  paintSurfaces(map, 'versus', scenario.seed)
  for (const { x: ex, y: ey } of entrances) {
    for (let y = ey + 1; y < Math.min(size, ey + 4); y++) { map.path[tileIndex(map, ex, y)] = 1; map.water[tileIndex(map, ex, y)] = -1 }
    for (let k = 1; k <= 4; k++) { const i = tileIndex(map, ex, ey - k); map.path[i] = 1; map.water[i] = -1 }
    map.water[tileIndex(map, ex, ey)] = -1
  }
  const scenery = []
  scatter(map, rng, 'versus', 0, 0, size, size, scenery)
  const clear = scenery.filter(item => !entrances.some(e => Math.abs(item.x - e.x) <= 2 && item.y >= e.y - 6 && item.y <= e.y + 4))
  return { map, scenery: clear, entrances }
}

export function terrainEdit(map, x0, y0, x1, y1, op) {
  const changes = new Map()
  const w = map.w + 1
  const get = (x, y) => changes.has(y * w + x) ? changes.get(y * w + x) : map.corners[y * w + x]
  const set = (x, y, value) => changes.set(y * w + x, value)
  const xs = [Math.max(0, Math.min(x0, x1)), Math.min(map.w, Math.max(x0, x1) + 1)]
  const ys = [Math.max(0, Math.min(y0, y1)), Math.min(map.h, Math.max(y0, y1) + 1)]
  let min = Infinity, max = -Infinity
  for (let y = ys[0]; y <= ys[1]; y++) for (let x = xs[0]; x <= xs[1]; x++) { const v = get(x, y); min = Math.min(min, v); max = Math.max(max, v) }
  const target = op === 'raise' ? (min === max ? max + 1 : max) : op === 'lower' ? (min === max ? min - 1 : min) : Math.round((min + max) / 2)
  if (target < 0 || target > MAX_LAND) return null
  const queue = []
  for (let y = ys[0]; y <= ys[1]; y++) for (let x = xs[0]; x <= xs[1]; x++) { if (get(x, y) !== target) { set(x, y, target); queue.push([x, y]) } }
  while (queue.length) {
    const [x, y] = queue.pop()
    const v = get(x, y)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx > map.w || ny > map.h) continue
      const n = get(nx, ny)
      if (n < v - 1) { set(nx, ny, v - 1); queue.push([nx, ny]) }
      else if (n > v + 1) { set(nx, ny, v + 1); queue.push([nx, ny]) }
    }
  }
  return changes
}

export function tilesTouchingCorners(map, cornerIds) {
  const tiles = new Set(), w = map.w + 1
  for (const id of cornerIds) {
    const x = id % w, y = Math.floor(id / w)
    for (const [tx, ty] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]]) if (inMap(map, tx, ty)) tiles.add(ty * map.w + tx)
  }
  return tiles
}
