// Builds modules-src/shorttrack/data/park.json, the Thrill Park 2 park around Thrill Park Speedway, from a saved park.
// Usage: node modules-src/shorttrack/tools/park-scenery.mjs [park.json | view.json | save.json] [Park name] [Owner]
// With no input it reads the Demo Derby's park (modules-src/demoderby/data/park.json, the same "Land of Speed" park).
// It clears the lot south of the rides (rows LOT_TILES), levels it with a blended skirt, eases the map's border toward the
// lot height so the flat ground outside the park meets it, builds extra coasters (park presets) and flat rides on the free land
// within RING tiles of the lot so rides stand close around the track (first TALL_COASTERS, extra-tall out-and-back coasters laid along the
// back stretch), drops guests, staff, news and litter, and writes the trimmed save.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { applyCommand, deserializePark, serializePark, tileIndex, FLAT_RIDES, COASTER_PRESETS } from '../../../server/park/index.mjs'

const TILE = 4
const here = dirname(new URL(import.meta.url).pathname)
/** The speedway's footprint in module metres: the oval, the grandstands that wrap it and the light towers, with a margin. */
const LOT = { x0: -136, x1: 136, z0: -52, z1: 68 }
/** The lot in park tiles (may run past the map edge, where the module's own flat ground continues). */
const LOT_TILES = { x0: 30, y0: 99, x1: 97, y1: 128 }
/** Quarter turn 2: the front stretch (module +z) faces away from the rides, so the park rises behind the back stretch. */
const TURN = 2
const BORDER = 6
const SKIRT = 4
/** Rides placed on the free land right around the lot (within RING tiles of it), nearest spot first, so coasters and rides stand close to the track. */
const RING = 14
const flat = n => Array.from({ length: n }, () => ({ c: 0, s: 0 }))
const lift = (n, sp = 'chain') => [{ c: 0, s: 1, sp }, ...Array.from({ length: n }, () => ({ c: 0, s: 2, sp })), { c: 0, s: 1, sp }, { c: 0, s: 0, sp }]
const drop = n => [{ c: 0, s: -1 }, ...Array.from({ length: n }, () => ({ c: 0, s: -2 })), { c: 0, s: -1 }, { c: 0, s: 0 }]
const hill = n => [{ c: 0, s: 1 }, ...Array.from({ length: n }, () => ({ c: 0, s: 2 })), { c: 0, s: 1 }, { c: 0, s: 0 }, { c: 0, s: -1 }, ...Array.from({ length: n }, () => ({ c: 0, s: -2 })), { c: 0, s: -1 }, { c: 0, s: 0 }]
/** Extra-tall out-and-back coasters built only for the speedway, laid along the back stretch (closest spot first) before the ring rides. */
const TALL_COASTERS = {
  speedwaySkyline: { name: 'Skyline Tempest', style: 'extreme', station: 3, pieces: [...flat(1), ...lift(11), ...drop(11), ...hill(3), { c: 0, s: 0, sp: 'loop' }, ...flat(1), { c: 0, s: 0, sp: 'corkscrew' }, ...flat(1), { c: 1, s: 0 }] },
  speedwayBolt: { name: 'Sky Bolt', style: 'launch', station: 3, pieces: [...flat(1), { c: 0, s: 0, sp: 'booster' }, { c: 0, s: 0, sp: 'booster' }, ...lift(10), ...drop(10), ...hill(4), ...hill(2), { c: -1, s: 0 }] },
  speedwayTitan: { name: 'Thunder Titan', style: 'steel', station: 3, pieces: [...flat(1), ...lift(9), ...drop(9), { c: 0, s: 0, sp: 'loop' }, ...flat(1), ...hill(3), ...hill(2), { c: 1, s: 0 }] },
  speedwayTimber: { name: 'Timber Giant', style: 'wooden', station: 3, pieces: [...flat(1), ...lift(6), ...drop(6), ...hill(3), ...hill(2), ...hill(1), { c: -1, s: 0 }] },
}
Object.assign(COASTER_PRESETS, TALL_COASTERS)
const TALL_ROWS = 10
const RING_RIDES = [
  { preset: 'ridge' }, { flat: 'ferris' }, { preset: 'comet' }, { flat: 'dropTower' }, { preset: 'rattler' }, { flat: 'zipper' },
  { preset: 'coilSpring' }, { flat: 'topSpin' }, { preset: 'nightHeron' }, { flat: 'gravitron' }, { preset: 'tempestKnot' }, { flat: 'ship' },
  { preset: 'slingshot' }, { flat: 'swings' }, { preset: 'knotHollow' }, { flat: 'trapdoor' }, { preset: 'gristmill' }, { flat: 'carousel' },
  { preset: 'mapleTwister' }, { flat: 'dropTower' }, { preset: 'zephyr' }, { flat: 'ferris' },
]

const [input = resolve(here, '../../demoderby/data/park.json'), parkName = 'Land of Speed', owner = 'stoegbauer'] = process.argv.slice(2)
const raw = JSON.parse(readFileSync(input, 'utf8'))
const data = typeof raw.data === 'string' ? JSON.parse(gunzipSync(Buffer.from(raw.data, 'base64')).toString('utf8')) : raw.save ?? raw
const state = deserializePark(data)
const map = state.map
const W = map.w, H = map.h, CW = W + 1
const r = LOT_TILES
if ((r.x1 - r.x0 + 1) * TILE !== LOT.x1 - LOT.x0 || (r.y1 - r.y0 + 1) * TILE !== LOT.z1 - LOT.z0) throw new Error('LOT and LOT_TILES differ in size.')

const inLot = (x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
for (let y = r.y0; y <= Math.min(r.y1, H - 1); y++) for (let x = r.x0; x <= r.x1; x++) {
  const i = tileIndex(map, x, y), e = state.entities[map.obj[i]]
  if (e && e.type === 'ride') throw new Error(`Ride ${e.ride} stands in the lot at ${x},${y}.`)
  if (state.trackCells?.has?.(i)) throw new Error(`Ride track runs through the lot at ${x},${y}.`)
}

const heights = []
for (let y = r.y0; y <= Math.min(r.y1 + 1, H); y++) for (let x = r.x0; x <= r.x1 + 1; x++) heights.push(map.corners[y * CW + x])
heights.sort((a, b) => a - b)
const height = heights[Math.floor(heights.length / 2)]

for (let y = r.y0; y <= Math.min(r.y1, H - 1); y++) for (let x = r.x0; x <= r.x1; x++) {
  const i = tileIndex(map, x, y), e = state.entities[map.obj[i]]
  if (e) delete state.entities[e.id]
  map.obj[i] = 0
  map.surface[i] = 0
  if (map.path[i]) { map.path[i] = 0; map.pathElevation[i] = 0; map.pathOrder[i] = 0 }
}
for (const e of Object.values(state.entities)) {
  if (e.type !== 'scenery') continue
  if (e.x >= r.x0 - 1 && e.x <= r.x1 + 1 && e.y >= r.y0 - 1 && e.y <= r.y1 + 1) {
    map.obj[tileIndex(map, e.x, e.y)] = 0
    delete state.entities[e.id]
  }
}
for (let y = r.y0; y <= Math.min(r.y1 + 1, H); y++) for (let x = r.x0; x <= r.x1 + 1; x++) map.corners[y * CW + x] = height

const original = Float32Array.from(map.corners)
const freeCorner = (cx, cy) => {
  for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
    const i = tileIndex(map, tx, ty), e = state.entities[map.obj[i]]
    if (map.path[i] || map.water[i] >= 0 || state.trackCells?.has?.(i) || (e && e.type !== 'scenery')) return false
  }
  return true
}
const half = v => Math.round(v * 2) / 2
for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) {
  if (x >= r.x0 && x <= r.x1 + 1 && y >= r.y0 && y <= r.y1 + 1) continue
  if (!freeCorner(x, y)) continue
  const d = Math.max(r.x0 - x, x - (r.x1 + 1), r.y0 - y, y - (r.y1 + 1), 0)
  const edge = Math.min(x, y, W - x, H - y)
  let v = original[y * CW + x]
  if (d <= SKIRT) { const k = d / (SKIRT + 1); v = height * (1 - k) + v * k }
  if (edge < BORDER) { const k = edge / BORDER; v = height * (1 - k) + v * k }
  map.corners[y * CW + x] = half(v)
}

const lotDistance = (x, y) => Math.max(r.x0 - x, x - r.x1, r.y0 - y, y - r.y1, 0)
const band = (x, y) => { const d = lotDistance(x, y); return d >= 1 && d <= RING }
const parked = []
for (const e of Object.values(state.entities)) {
  if (e.type !== 'scenery' || !band(e.x, e.y)) continue
  map.obj[tileIndex(map, e.x, e.y)] = 0
  delete state.entities[e.id]
  parked.push(e)
}
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) map.owner[tileIndex(map, x, y)] = band(x, y) ? 0 : 255
const p0 = state.parks[0]
p0.cash = 1e12
p0.named = true
state.ended = false
const spots = []
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (band(x, y)) spots.push([x, y, lotDistance(x, y)])
spots.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0])
const towardLot = (x, y) => (y < r.y0 ? 2 : x < r.x0 ? 1 : 3)
const added = []
for (let y = r.y0 - TALL_ROWS; y < r.y0; y++) for (let x = 0; x < W; x++) {
  const i = tileIndex(map, x, y)
  if (map.path[i] && !state.entities[map.obj[i]]) { map.path[i] = 0; map.pathElevation[i] = 0; map.pathOrder[i] = 0 }
}
const mirror = design => ({ ...design, pieces: design.pieces.map(piece => ({ ...piece, c: -piece.c })) })
for (const key of Object.keys(TALL_COASTERS)) COASTER_PRESETS[`${key}Mirror`] = mirror(TALL_COASTERS[key])
for (const key of Object.keys(TALL_COASTERS)) {
  let made = null
  for (const [x, y] of spots) {
    if (y >= r.y0 || r.y0 - y > TALL_ROWS || x < r.x0 - 4 || x > r.x1 + 4) continue
    for (const [dir, preset] of [[0, key], [2, key], [0, `${key}Mirror`], [2, `${key}Mirror`]]) {
      const result = applyCommand(state, { t: 'preset', preset, x, y, dir }, 0)
      if (result.ok && state.entities[result.id]?.complete) { made = { x, y }; break }
      if (result.ok) applyCommand(state, { t: 'demolish', id: result.id }, 0)
    }
    if (made) break
  }
  if (made) added.push(`${key}@${made.x},${made.y}`)
  else console.log(`${key} did not fit behind the back stretch`)
}
for (const pick of RING_RIDES) {
  let made = null
  for (const [x, y] of spots) {
    for (const turn of [0, 1, 3, 2]) {
      const rot = (towardLot(x, y) + turn) % 4
      const result = pick.preset ? applyCommand(state, { t: 'preset', preset: pick.preset, x, y, dir: rot }, 0) : applyCommand(state, { t: 'flat', ride: pick.flat, x, y, rot }, 0)
      if (result.ok && (!pick.preset || state.entities[result.id]?.complete)) { made = { id: result.id, x, y }; break }
      if (result.ok) applyCommand(state, { t: 'demolish', id: result.id }, 0)
    }
    if (made) break
  }
  if (made) added.push(`${pick.preset ?? pick.flat}@${made.x},${made.y}`)
}
for (const e of parked) {
  const i = tileIndex(map, e.x, e.y)
  if (map.obj[i] || map.path[i] || state.trackCells?.has?.(i)) continue
  state.entities[e.id] = e
  map.obj[i] = e.id
}
console.log(`added ${added.length} rides: ${added.join(' ')}`)

map.owner.fill(0)
map.litter.fill(0)
for (const e of Object.values(state.entities)) {
  if (e.type !== 'ride') continue
  e.queue = []; e.riders = []; e.queueLength = 0
  if (e.trains) e.trains = e.trains.map(t => ({ ...t, riders: [] }))
  if (e.kind === 'flat' && FLAT_RIDES[e.ride]) { e.status = 'open'; e.cycle = { phase: 'running', timer: 0 } }
  if (e.kind === 'coaster' && e.complete) e.status = 'open'
}
state.time.dayFraction = 0.58
state.weather = { kind: 'sunny', temp: 24, timer: 0, next: 'sunny' }
const save = serializePark(state, false)
save.staff = []
save.news = []
save.parks = save.parks.map(p => ({ id: p.id, parkId: p.parkId, name: p.name, named: true, color: p.color, schemes: p.schemes, cash: 0, loan: 0, maxLoan: 0 }))

const centre = [(r.x0 + r.x1 + 1) / 2 * TILE, (r.y0 + r.y1 + 1) / 2 * TILE]
const out = { name: parkName, owner, scenario: state.scenario, lot: { ...r, turn: TURN, height, centre, module: LOT, mapSize: [W * TILE, H * TILE] }, save }
const target = resolve(here, '../data/park.json')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, JSON.stringify(out))
console.log(`lot ${r.x0},${r.y0}–${r.x1},${r.y1} turn ${TURN} height ${height} → ${target} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`)
