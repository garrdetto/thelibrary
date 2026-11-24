// Builds modules-src/shorttrack/data/park.json, the Thrill Park 2 park around Thrill Park Speedway, from a saved park.
// Usage: node modules-src/shorttrack/tools/park-scenery.mjs [park.json | view.json | save.json] [Park name] [Owner]
// With no input it reads the Demo Derby's park (modules-src/demoderby/data/park.json, the same "Land of Speed" park).
// It clears the lot south of the rides (rows LOT_TILES), levels it with a blended skirt, eases the map's border toward the
// lot height so the flat ground outside the park meets it, drops guests, staff, news and litter, and writes the trimmed save.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { deserializePark, serializePark, tileIndex, FLAT_RIDES } from '../../../server/park/index.mjs'

const TILE = 4
const here = dirname(new URL(import.meta.url).pathname)
/** The speedway's footprint in module metres: the oval, the grandstands that wrap it and the light towers, with a margin. */
const LOT = { x0: -152, x1: 152, z0: -68, z1: 68 }
/** The lot in park tiles (may run past the map edge, where the module's own flat ground continues). */
const LOT_TILES = { x0: 26, y0: 95, x1: 101, y1: 128 }
/** Quarter turn 2: the front stretch (module +z) faces away from the rides, so the park rises behind the back stretch. */
const TURN = 2
const BORDER = 6
const SKIRT = 4

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
const out = { name: parkName, owner, scenario: state.scenario, lot: { ...r, turn: TURN, height, centre, module: LOT, mapSize: [W * TILE, H * TILE] }, save }
const target = resolve(here, '../data/park.json')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, JSON.stringify(out))
console.log(`lot ${r.x0},${r.y0}–${r.x1},${r.y1} turn ${TURN} height ${height} → ${target} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`)
