// Builds modules-src/demoderby/data/park.json, the Thrill Park around the derby, from a saved park.
// Usage: node modules-src/demoderby/tools/park-scenery.mjs <view.json | save.json> [Park name] [Owner]
// <view.json> is the public `/api/park?view=<scenario>&park=<id>` response (gzip+base64 `data`); a plain save JSON also works.
// It drops guests, staff, news and litter, finds the clear, nearly level lot with the most rides and track around it,
// levels it with a blended skirt, lays dirt, clears its trees, lays a footpath to the park and writes the trimmed save with the lot's placement.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { deserializePark, serializePark, tileIndex, FLAT_RIDES } from '../../../server/park/index.mjs'

const TILE = 4
/** The derby's footprint in module metres (x along the pad, z toward the grandstand): barriers, light towers and the bleachers with a margin. */
const LOT = { x0: -26, x1: 26, z0: -18, z1: 30 }

const [input, parkName = 'Land of Speed', owner = 'stoegbauer'] = process.argv.slice(2)
if (!input) throw new Error('Pass the saved park (view JSON or save JSON).')
const raw = JSON.parse(readFileSync(input, 'utf8'))
const data = typeof raw.data === 'string' ? JSON.parse(gunzipSync(Buffer.from(raw.data, 'base64')).toString('utf8')) : raw
const state = deserializePark(data)
const map = state.map
const W = map.w, H = map.h, CW = W + 1

const lotW = (LOT.x1 - LOT.x0) / TILE, lotH = (LOT.z1 - LOT.z0) / TILE
const busy = new Uint8Array(W * H)
for (let i = 0; i < W * H; i++) {
  const e = state.entities[map.obj[i]]
  if ((e && e.type === 'ride') || state.trackCells?.has?.(i)) busy[i] = 1
}
const blocked = i => {
  const e = state.entities[map.obj[i]]
  return map.path[i] || map.water[i] >= 0 || busy[i] || (e && e.type !== 'scenery')
}

/** Rides and track in a band of tiles, counted for how much of the park surrounds the lot on that side. */
function band(x0, y0, x1, y1) {
  let n = 0
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
    const i = tileIndex(map, x, y)
    n += busy[i] ? 1 : map.path[i] ? 0.3 : 0
  }
  return n
}

/** A clear, nearly level lot of a w × h tiles with the most rides and track around it; null when it does not fit. */
function lotScore(x, y, w, h) {
  if (x < 3 || y < 3 || x + w > W - 3 || y + h > H - 3) return null
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (blocked(tileIndex(map, xx, yy))) return null
  let lo = Infinity, hi = -Infinity
  for (let yy = y; yy <= y + h; yy++) for (let xx = x; xx <= x + w; xx++) {
    const v = map.corners[yy * CW + xx]
    lo = Math.min(lo, v); hi = Math.max(hi, v)
  }
  if (hi - lo > 3) return null
  const R = 10
  const sides = { west: band(x - R, y, x - 1, y + h - 1), east: band(x + w, y, x + w + R - 1, y + h - 1), north: band(x, y - R, x + w - 1, y - 1), south: band(x, y + h, x + w - 1, y + h + R - 1) }
  const values = Object.values(sides)
  return { score: Math.min(...values) * 2 + values.reduce((a, b) => a + b, 0) * 0.3 - (hi - lo) * 2, sides }
}

let best = null
for (const parity of [0, 1]) {
  const w = parity ? lotH : lotW, h = parity ? lotW : lotH
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const found = lotScore(x, y, w, h)
    if (!found || (best && found.score <= best.score)) continue
    const turn = parity ? (found.sides.east <= found.sides.west ? 1 : 3) : (found.sides.north <= found.sides.south ? 0 : 2)
    best = { score: found.score, r: { x0: x, y0: y, x1: x + w - 1, y1: y + h - 1 }, turn, sides: found.sides }
  }
}
if (!best) throw new Error('No level, clear lot fits the derby.')
const { r, turn } = best
console.log('sides', best.sides)

let heights = []
for (let y = r.y0; y <= r.y1 + 1; y++) for (let x = r.x0; x <= r.x1 + 1; x++) heights.push(map.corners[y * CW + x])
heights.sort((a, b) => a - b)
const height = heights[Math.floor(heights.length / 2)]
for (let y = r.y0; y <= r.y1 + 1; y++) for (let x = r.x0; x <= r.x1 + 1; x++) map.corners[y * CW + x] = height
for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
  const i = tileIndex(map, x, y)
  const e = state.entities[map.obj[i]]
  if (e) delete state.entities[e.id]
  map.obj[i] = 0
  map.surface[i] = 2
}
for (const e of Object.values(state.entities)) {
  if (e.type !== 'scenery') continue
  if (e.x >= r.x0 - 1 && e.x <= r.x1 + 1 && e.y >= r.y0 - 1 && e.y <= r.y1 + 1) {
    map.obj[tileIndex(map, e.x, e.y)] = 0
    delete state.entities[e.id]
  }
}
const original = Float32Array.from(map.corners)
const freeCorner = (cx, cy) => {
  for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
    const i = tileIndex(map, tx, ty), e = state.entities[map.obj[i]]
    if (map.path[i] || map.water[i] >= 0 || busy[i] || (e && e.type !== 'scenery')) return false
  }
  return true
}
const SKIRT = 4
for (let y = r.y0 - SKIRT; y <= r.y1 + 1 + SKIRT; y++) for (let x = r.x0 - SKIRT; x <= r.x1 + 1 + SKIRT; x++) {
  if (x < 0 || y < 0 || x > W || y > H) continue
  const d = Math.max(r.x0 - x, x - (r.x1 + 1), r.y0 - y, y - (r.y1 + 1), 0)
  if (d === 0 || !freeCorner(x, y)) continue
  const k = d / (SKIRT + 1)
  map.corners[y * CW + x] = Math.round((height * (1 - k) + original[y * CW + x] * k) * 2) / 2
}

const prev = new Int32Array(W * H).fill(-2)
const queue = []
for (let y = r.y0 - 1; y <= r.y1 + 1; y++) for (let x = r.x0 - 1; x <= r.x1 + 1; x++) {
  if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) continue
  if (x < 0 || y < 0 || x >= W || y >= H || (x !== r.x0 - 1 && x !== r.x1 + 1 && y !== r.y0 - 1 && y !== r.y1 + 1)) continue
  const i = tileIndex(map, x, y)
  if (blocked(i)) continue
  prev[i] = -1
  queue.push(i)
}
let reached = -1
for (let head = 0; head < queue.length && reached < 0; head++) {
  const i = queue[head], x = i % W, y = Math.floor(i / W)
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || (nx >= r.x0 && nx <= r.x1 && ny >= r.y0 && ny <= r.y1)) continue
    const j = tileIndex(map, nx, ny)
    if (prev[j] !== -2) continue
    if (map.path[j] === 1 && map.water[j] < 0) { prev[j] = i; reached = j; break }
    if (blocked(j)) continue
    prev[j] = i
    queue.push(j)
  }
}
let laid = 0
if (reached >= 0) {
  let order = Math.max(0, ...map.pathOrder) + 1
  for (let i = prev[reached]; i >= 0; i = prev[i]) {
    const e = state.entities[map.obj[i]]
    if (e) { delete state.entities[e.id]; map.obj[i] = 0 }
    map.path[i] = 1
    map.pathElevation[i] = 0
    map.pathOrder[i] = order++
    laid++
  }
}
console.log(`footpath of ${laid} tiles to the park`)

map.owner.fill(0)
map.litter.fill(0)
for (const e of Object.values(state.entities)) {
  if (e.type !== 'ride') continue
  e.queue = []; e.riders = []; e.queueLength = 0
  if (e.trains) e.trains = e.trains.map(t => ({ ...t, riders: [] }))
  if (e.kind === 'flat' && FLAT_RIDES[e.ride]) { e.status = 'open'; e.cycle = { phase: 'running', timer: 0 } }
}
state.time.dayFraction = 0.58
state.weather = { kind: 'sunny', temp: 24, timer: 0, next: 'sunny' }
const save = serializePark(state, false)
save.staff = []
save.news = []
save.parks = save.parks.map(p => ({ id: p.id, parkId: p.parkId, name: p.name, named: true, color: p.color, schemes: p.schemes, cash: 0, loan: 0, maxLoan: 0 }))

const centre = [(r.x0 + r.x1 + 1) / 2 * TILE, (r.y0 + r.y1 + 1) / 2 * TILE]
const out = { name: parkName, owner, scenario: state.scenario, lot: { ...r, turn, height, centre, module: LOT }, save }
const target = resolve(dirname(new URL(import.meta.url).pathname), '../data/park.json')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, JSON.stringify(out))
console.log(`lot ${r.x0},${r.y0}–${r.x1},${r.y1} turn ${turn} height ${height} score ${best.score.toFixed(1)} → ${target} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`)
