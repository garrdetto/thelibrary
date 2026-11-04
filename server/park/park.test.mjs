import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCommand,
  applyDynamic,
  createPark,
  deserializePark,
  decodeRle,
  encodeDynamic,
  encodeRle,
  pathHeightAt,
  pathsConnect,
  samplePiece,
  validatePiece,
  rideCapacity,
  serializePark,
  stallPlacementRotation,
  tileIndex,
  COASTER_STYLES,
  STAFF,
  rideColors,
  rideSlots,
  colorsFromRoles,
  PRESETS,
  DEFAULT_SCHEMES,
  STAFF_WAGE_PER_DAY,
  ELECTRICITY_COST_PER_TILE_PER_DAY,
  dailyOperatingCosts,
  queueLine,
  exitLine,
  tileMax,
  stepPark,
  spawnRate,
  ownedTileCount,
  landAreaPlan,
  MAX_GUESTS,
  GUESTS_PER_OWNED_TILE,
  flatSpec,
  footprintTiles,
  WAVE_SETTINGS,
  FLAT_RIDES,
  COASTER_PRESETS,
  guestProfile,
  intensityLimit,
  warmUp,
  THRILL_SEEKER_SHARE,
  WARM_UP_MAX,
  COMMENT_POOLS,
  recordComment,
  rideCommentsDetail,
  HOTELS,
  hotelSpec,
  hotelResizeCost,
  hotelRefurbishCost,
  hotelOccupancy,
  hotelNight,
  updateHotels,
  spawnGuest,
  parkValue,
  HOTEL_GUESTS_PER_ROOM,
} from './index.mjs'

function parkFixture() {
  const state = createPark('meadowbrook')
  state.parks[0].named = true
  state.parks[0].cash = 1_000_000
  state.map.corners.fill(6)
  state.map.owner.fill(0)
  state.map.water.fill(-1)
  state.map.obj.fill(0)
  state.map.path.fill(0)
  state.map.pathElevation.fill(0)
  state.entities = {}
  state.trackCells = new Map()
  return state
}

function buildPath(state, kind, x, y, elevation = 0) {
  return applyCommand(state, { t: 'path', kind, elevation, x0: x, y0: y, x1: x, y1: y })
}

test('parks start with the same land and can buy contiguous expansion squares', () => {
  const state = createPark('meadowbrook')
  const land = state.parks[0].land
  assert.equal(state.map.w, 128)
  assert.equal(state.map.h, 128)
  assert.deepEqual(land.initial, { x0: 36, y0: 36, x1: 91, y1: 91 })
  assert.deepEqual(land.limit, { x0: 8, y0: 8, x1: 119, y1: 91 })
  const initialArea = (land.initial.x1 - land.initial.x0 + 1) * (land.initial.y1 - land.initial.y0 + 1)
  const limitArea = (land.limit.x1 - land.limit.x0 + 1) * (land.limit.y1 - land.limit.y0 + 1)
  assert.equal(limitArea, initialArea * 3)
  assert.equal(state.map.owner.filter(owner => owner === 0).length, initialArea)

  state.parks[0].named = true
  const tile = { x: land.initial.x0 - 1, y: land.initial.y0 }
  const index = tileIndex(state.map, tile.x, tile.y)
  const before = state.parks[0].cash
  const result = applyCommand(state, { t: 'buyLand', ...tile })
  assert.deepEqual(result, { ok: true, cost: 100 })
  assert.equal(state.map.owner[index], 0)
  assert.equal(state.parks[0].cash, before - 100)
  assert.equal(state.parks[0].month.landscaping, -100)

  assert.equal(applyCommand(state, { t: 'buyLand', ...tile }).ok, false)
  assert.equal(applyCommand(state, { t: 'buyLand', x: land.limit.x0, y: land.limit.y0 }).ok, false)
  assert.equal(applyCommand(state, { t: 'buyLand', x: land.initial.x0, y: land.initial.y1 + 1 }).ok, false)
  state.parks[0].cash = 99
  assert.equal(applyCommand(state, { t: 'buyLand', x: tile.x - 1, y: tile.y }).ok, false)
  assert.equal(state.map.owner[tileIndex(state.map, tile.x - 1, tile.y)], 255)
})

test('older 64-square saved parks expand into the purchase map without moving their starting park', () => {
  const state = createPark('meadowbrook')
  const saved = serializePark(state)
  const offset = 32
  const fields = ['corners', 'surface', 'water', 'path', 'pathElevation', 'pathColor', 'pathAdd', 'obj', 'owner', 'litter']
  for (const key of fields) {
    const corners = key === 'corners'
    const sourceWidth = corners ? state.map.w + 1 : state.map.w
    const targetWidth = corners ? 65 : 64
    const source = decodeRle(saved.map[key], sourceWidth * (corners ? state.map.h + 1 : state.map.h))
    const crop = []
    for (let y = 0; y < targetWidth; y++) for (let x = 0; x < targetWidth; x++) crop.push(source[(y + offset) * sourceWidth + x + offset])
    saved.map[key] = encodeRle(crop)
  }
  saved.map.w = 64
  saved.map.h = 64
  saved.entities = Object.fromEntries(Object.entries(saved.entities)
    .filter(([, entity]) => entity.x >= offset && entity.x < offset + 64 && entity.y >= offset && entity.y < offset + 64)
    .map(([id, entity]) => [id, {
      ...entity,
      x: entity.x - offset,
      y: entity.y - offset,
      ...(entity.start ? { start: { ...entity.start, x: entity.start.x - offset, y: entity.start.y - offset } } : {}),
    }]))
  delete saved.parks[0].land
  const loaded = deserializePark(saved)
  assert.equal(loaded.map.w, 128)
  assert.equal(loaded.map.h, 128)
  assert.deepEqual(loaded.parks[0].land.initial, { x0: 36, y0: 36, x1: 91, y1: 91 })
  assert.deepEqual(loaded.parks[0].land.limit, { x0: 8, y0: 8, x1: 119, y1: 91 })
  const originalEntrance = Object.values(state.entities).find(entity => entity.type === 'parkEntrance')
  const loadedEntrance = Object.values(loaded.entities).find(entity => entity.type === 'parkEntrance')
  assert.deepEqual([loadedEntrance.x, loadedEntrance.y], [originalEntrance.x, originalEntrance.y])
})

test('raised paths and stair ramps connect and survive old and new saves', () => {
  const state = parkFixture()
  assert.equal(buildPath(state, 1, 5, 5).ok, true)
  assert.equal(buildPath(state, 1, 7, 5, 4).ok, true)
  assert.equal(pathsConnect(state.map, 5, 5, 7, 5), false)
  assert.equal(buildPath(state, 3, 6, 5, 4).ok, true)
  assert.equal(pathsConnect(state.map, 5, 5, 6, 5), true)
  assert.equal(pathsConnect(state.map, 6, 5, 7, 5), true)
  assert.equal(pathHeightAt(state.map, 26, 22), 7)
  state.map.corners[(state.map.w + 1) * 15 + 15] = 8
  assert.equal(buildPath(state, 1, 15, 15, 4).ok, true)
  assert.equal(pathHeightAt(state.map, 62, 62), 10)
  state.map.water[tileIndex(state.map, 3, 3)] = 7.5
  assert.equal(buildPath(state, 1, 3, 3).ok, false)
  assert.equal(buildPath(state, 1, 3, 3, 4).ok, true)

  const saved = serializePark(state)
  assert.equal(deserializePark(saved).map.pathElevation[tileIndex(state.map, 7, 5)], 4)
  const legacy = structuredClone(saved)
  delete legacy.map.pathElevation
  assert.equal(deserializePark(legacy).map.pathElevation.every(value => value === 0), true)
})

test('shops rotate toward the nearest footpath when the chosen footprint fits', () => {
  const state = parkFixture()
  state.map.path[tileIndex(state.map, 12, 10)] = 1
  const shop = { type: 'stall', kind: 'burger', x: 10, y: 10, size: [1, 1] }
  assert.equal(stallPlacementRotation(state, 0, shop, 2), 0)
  const result = applyCommand(state, { t: 'stall', kind: 'burger', x: 10, y: 10, rot: 2 })
  assert.equal(result.ok, true)
  assert.equal(state.entities[result.id].rot, 0)
})

test('queue lines require connected path heights and follow stairs', () => {
  const state = parkFixture()
  state.map.path[tileIndex(state.map, 5, 5)] = 2
  state.map.path[tileIndex(state.map, 6, 5)] = 1
  state.map.pathElevation[tileIndex(state.map, 6, 5)] = 4
  const ride = { id: 100, entrance: 101 }
  state.entities = {
    100: ride,
    101: { id: 101, type: 'gate', x: 4, y: 5, dir: 0 },
  }
  assert.equal(queueLine(state, ride).entry, null)

  state.map.path[tileIndex(state.map, 6, 5)] = 3
  state.queueCache.clear()
  assert.deepEqual(queueLine(state, ride).entry, [5, 5])
})

test('custom kart rides run an independent two-seat fleet and sync each vehicle', () => {
  const state = parkFixture()
  const result = applyCommand(state, { t: 'coaster', style: 'kart', x: 10, y: 10, dir: 0, length: 13 })
  assert.equal(result.ok, true)
  assert.equal(state.entities[result.id].pieces.length, 13)
  assert.equal(applyCommand(state, { t: 'finish', ride: result.id }).ok, true)

  const ride = state.entities[result.id]
  assert.equal(ride.cars, 14)
  assert.equal(ride.trains.length, 14)
  assert.equal(rideCapacity(ride), 28)
  assert.equal(COASTER_STYLES.kart.seats, 2)

  ride.status = 'open'
  state.guests = Array.from({ length: 28 }, (_, index) => ({
    id: index + 1, park: 0, x: 0, y: 0, tx: 0, ty: 0, state: 'queue', hidden: false,
    happy: 150, items: [], kid: false, shirt: 0, thoughts: [], queueTime: 0, patience: 1000,
    cash: 100, spent: 0, ride: ride.id, ridden: [], nausea: 0, energy: 200, minI: 1,
    maxI: 10, tolerance: 10, rides: 0, inPark: 0,
  }))
  state.guestIndex = new Map(state.guests.map(guest => [guest.id, guest]))
  ride.queue = state.guests.map(guest => guest.id)
  for (let index = 0; index < 250; index++) stepPark(state, 0.05)

  assert.ok(ride.trains.some(kart => kart.riders.length > 0))
  assert.ok(ride.trains.every(kart => kart.riders.length <= 2))
  assert.ok(new Set(ride.trains.map(kart => kart.v)).size > 1)

  const replica = deserializePark(serializePark(state))
  applyDynamic(replica, encodeDynamic(state))
  assert.equal(encodeDynamic(state).rides[result.id].t.length, 14)
  assert.equal(replica.entities[result.id].trains.length, 14)
})

test('coaster slopes soften automatically and bank gradually through turns', () => {
  const state = parkFixture()
  const ride = { id: 100, type: 'ride', kind: 'coaster', style: 'steel', park: 0, start: { x: 20, y: 20, dir: 0, h: 20 }, pieces: [], complete: false }
  const adjusted = validatePiece(state, ride, { c: 0, s: 2 })
  assert.equal(adjusted.ok, true)
  assert.deepEqual(adjusted.piece, { c: 0, s: 1 })
  assert.equal(adjusted.adjusted, true)
  state.entities[ride.id] = ride
  assert.equal(applyCommand(state, { t: 'piece', ride: ride.id, c: 0, s: 2 }).ok, true)
  assert.equal(ride.pieces[0].c, 0)
  assert.equal(ride.pieces[0].s, 1)

  const extremeRide = { ...ride, id: 101, style: 'extreme', pieces: [], complete: false }
  const corkscrew = validatePiece(parkFixture(), extremeRide, { c: 0, s: 0, sp: 'corkscrew' })
  assert.equal(corkscrew.ok, true)
  assert.equal(corkscrew.piece.sp, 'corkscrew')

  const curve = samplePiece({ x: 0, y: 0, h: 20, dir: 0, slope: 0 }, { c: 1, s: 0 }, 20)
  assert.ok(Math.max(...curve.map(point => Math.abs(point.bank))) <= 0.2)
  assert.ok(Math.abs(curve[2].bank) < Math.abs(curve[10].bank))
  assert.ok(Math.abs(curve[18].bank) < Math.abs(curve[10].bank))
})

test('roller coasters provide two trains, custom car counts, and independent paint colors', () => {
  const state = parkFixture()
  state.map.corners.fill(20)
  const result = applyCommand(state, { t: 'preset', preset: 'zephyr', x: 60, y: 60, dir: 0 })
  assert.equal(result.ok, true)
  const ride = state.entities[result.id]
  assert.equal(ride.trains.length, 2)
  assert.equal(ride.trains[1].phase, 'waiting')
  assert.equal(rideCapacity(ride), ride.cars * COASTER_STYLES[ride.style].seats * 2)

  assert.equal(applyCommand(state, { t: 'rideSet', id: ride.id, cars: 10 }).ok, true)
  assert.equal(ride.cars, 10)
  assert.equal(rideCapacity(ride), 10 * COASTER_STYLES[ride.style].seats * 2)
  assert.equal(applyCommand(state, { t: 'rideSet', id: ride.id, cars: 11 }).ok, false)
  assert.equal(applyCommand(state, { t: 'rideSet', id: ride.id, trackColor: '#112233', supportColor: '#445566', trainColor: '#778899' }).ok, true)

  const saved = serializePark(state)
  const loaded = deserializePark(saved)
  const restored = loaded.entities[ride.id]
  assert.equal(restored.trains.length, 2)
  assert.equal(restored.cars, 10)
  assert.equal(restored.trackColor, '#112233')
  assert.equal(restored.supportColor, '#445566')
  assert.equal(restored.trainColor, '#778899')
})

test('rides resolve colors per slot from custom paint, park schemes, legacy fields and defaults', () => {
  const state = parkFixture()
  const park = state.parks[0]
  assert.equal(park.schemes.length, 3)
  const made = applyCommand(state, { t: 'flat', ride: 'gravitron', x: 40, y: 40, rot: 0 })
  assert.equal(made.ok, true)
  const ride = state.entities[made.id]
  const slots = rideSlots(ride)
  assert.equal(slots[1].key, 'lights')
  assert.equal(slots[2].key, 'glow')
  assert.deepEqual(rideColors(ride, park), slots.map(s => s.def))

  assert.equal(applyCommand(state, { t: 'rideSet', id: ride.id, color: '#123456' }).ok, true)
  assert.equal(rideColors(ride, park)[0], '#123456')
  assert.equal(applyCommand(state, { t: 'rideSet', id: ride.id, colors: { arch: '#ABCDEF' } }).ok, true)
  assert.equal(rideColors(ride, park)[slots.findIndex(s => s.key === 'arch')], '#abcdef')
  assert.equal(applyCommand(state, { t: 'rideSet', id: ride.id, colors: { nope: '#abcdef' } }).ok, false)
  assert.equal(applyCommand(state, { t: 'rideSet', id: ride.id, colors: { arch: 'red' } }).ok, false)

  assert.equal(applyCommand(state, { t: 'rideSet', id: ride.id, scheme: 1, colors: null }).ok, true)
  assert.equal(ride.colors, null)
  assert.deepEqual(rideColors(ride, park), slots.map(s => DEFAULT_SCHEMES[1].colors[s.role]))
  assert.equal(applyCommand(state, { t: 'park', scheme: { index: 1, name: 'Electric', colors: { primary: '#101010' } } }).ok, true)
  assert.equal(park.schemes[1].name, 'Electric')
  assert.equal(rideColors(ride, park)[0], '#101010')
  assert.equal(applyCommand(state, { t: 'park', scheme: { index: 3 } }).ok, false)
  assert.equal(applyCommand(state, { t: 'park', scheme: { index: 0, colors: { primary: 'blue' } } }).ok, false)

  assert.equal(applyCommand(state, { t: 'rideSet', id: ride.id, colors: { band: '#ffffff' } }).ok, true)
  assert.equal(ride.scheme, null)
  assert.equal(rideColors(ride, park)[0], '#101010')
  assert.equal(rideColors(ride, park)[slots.findIndex(s => s.key === 'band')], '#ffffff')

  const preset = colorsFromRoles(ride, PRESETS[0].colors)
  assert.equal(applyCommand(state, { t: 'rideSet', id: ride.id, colors: preset, scheme: null }).ok, true)
  assert.deepEqual(rideColors(ride, park), slots.map(s => PRESETS[0].colors[s.role]))

  const loaded = deserializePark(serializePark(state))
  assert.deepEqual(rideColors(loaded.entities[ride.id], loaded.parks[0]), slots.map(s => PRESETS[0].colors[s.role]))
  assert.equal(loaded.parks[0].schemes[1].name, 'Electric')
  const online = createPark('meadowbrook')
  online.entities = { [ride.id]: { ...ride, colors: null, scheme: null } }
  applyDynamic(online, JSON.parse(JSON.stringify(encodeDynamic(state))))
  assert.deepEqual(online.entities[ride.id].colors, preset)
  assert.equal(online.parks[0].schemes[1].name, 'Electric')
})

test('coaster paint slots keep the legacy track, support and train fields in step', () => {
  const state = parkFixture()
  state.map.corners.fill(20)
  const result = applyCommand(state, { t: 'preset', preset: 'zephyr', x: 60, y: 60, dir: 0 })
  const ride = state.entities[result.id]
  assert.equal(applyCommand(state, { t: 'rideSet', id: ride.id, colors: { track: '#112233', main: '#445566' } }).ok, true)
  assert.equal(ride.trackColor, '#112233')
  assert.equal(ride.trainColor, '#445566')
  assert.equal(applyCommand(state, { t: 'rideSet', id: ride.id, scheme: 2 }).ok, true)
  assert.equal(ride.trackColor, DEFAULT_SCHEMES[2].colors.secondary)
  assert.equal(ride.supportColor, DEFAULT_SCHEMES[2].colors.accent)
  assert.equal(applyCommand(state, { t: 'park', scheme: { index: 2, colors: { secondary: '#0a0b0c' } } }).ok, true)
  assert.equal(ride.trackColor, '#0a0b0c')
  assert.equal(applyCommand(state, { t: 'rideSet', id: ride.id, supportColor: '#778899' }).ok, true)
  assert.equal(ride.scheme, null)
  assert.equal(rideColors(ride, state.parks[0])[rideSlots(ride).findIndex(s => s.key === 'support')], '#778899')
})

test('coaster building prices are doubled and electricity is one dollar per tile daily', () => {
  assert.equal(COASTER_STYLES.steel.cost, 4400)
  assert.equal(COASTER_STYLES.steel.pieceCost, 180)
  assert.equal(COASTER_STYLES.wooden.cost, 4000)
  assert.equal(COASTER_STYLES.junior.cost, 2400)
  assert.equal(COASTER_STYLES.inverted.cost, 5600)
  assert.equal(COASTER_STYLES.extreme.corkscrews, true)
  assert.equal(ELECTRICITY_COST_PER_TILE_PER_DAY, 1)
  assert.equal(STAFF_WAGE_PER_DAY, 50)
  assert.ok(Object.values(STAFF).every(member => member.wage === 50))

  const state = parkFixture()
  state.entities = {
    10: { id: 10, type: 'ride', kind: 'flat', ride: 'carousel', x: 10, y: 10, rot: 0, park: 0 },
    11: { id: 11, type: 'stall', kind: 'burger', x: 13, y: 10, size: [1, 1], rot: 0, park: 0 },
    12: { id: 12, type: 'stall', kind: 'burger', x: 20, y: 20, size: [1, 1], rot: 0, park: 1 },
  }
  state.staff = [{ id: 1, park: 0, role: 'security' }]
  assert.deepEqual(dailyOperatingCosts(state, 0), { wages: 50, electricity: 10, poweredTiles: 10 })
})

function openRideFixture(state, count) {
  for (let k = 0; k < count; k++) {
    const made = applyCommand(state, { t: 'flat', ride: 'dropTower', x: 40 + (k % 8) * 4, y: 40 + Math.floor(k / 8) * 4, rot: 0 })
    assert.equal(made.ok, true, made.error)
    state.entities[made.id].status = 'open'
  }
}

test('area land purchases buy only connected, eligible squares and charge for each one', () => {
  const state = createPark('meadowbrook')
  state.parks[0].named = true
  state.parks[0].cash = 100_000
  const land = state.parks[0].land
  const ownedBefore = ownedTileCount(state, 0)
  const y0 = land.initial.y0, y1 = land.initial.y0 + 9
  const x1 = land.initial.x0 - 1, x0 = x1 - 9
  for (let y = y0; y <= y1; y++) state.map.owner[tileIndex(state.map, x1 - 5, y)] = 1
  const plan = landAreaPlan(state, 0, { x0, y0, x1, y1 })
  assert.equal(plan.tiles.length, 5 * 10)
  const before = state.parks[0].cash
  const result = applyCommand(state, { t: 'buyLandArea', x0, y0, x1, y1 })
  assert.deepEqual(result, { ok: true, cost: 5000, count: 50 })
  assert.equal(state.parks[0].cash, before - 5000)
  assert.equal(ownedTileCount(state, 0), ownedBefore + 50)
  assert.equal(state.map.owner[tileIndex(state.map, x0, y0)], 255)
  assert.equal(state.map.owner[tileIndex(state.map, x1, y1)], 0)
  assert.equal(applyCommand(state, { t: 'buyLandArea', x0: land.limit.x0, y0: land.initial.y1 + 2, x1: land.limit.x0 + 3, y1: land.initial.y1 + 4 }).ok, false)
  assert.equal(applyCommand(state, { t: 'buyLandArea', x0: 0, y0: 0, x1: 40, y1: 3 }).ok, false)
  state.parks[0].cash = 50
  assert.equal(applyCommand(state, { t: 'buyLandArea', x0: x1 - 4, y0: y1 + 1, x1, y1: y1 + 2 }).ok, false)
})

test('the guest cap grows with rides and shops and with owned land', () => {
  const state = parkFixture()
  state.map.owner.fill(255)
  for (let y = 36; y < 76; y++) for (let x = 36; x < 76; x++) state.map.owner[tileIndex(state.map, x, y)] = 0
  state.landVersion = (state.landVersion ?? 0) + 1
  const empty = spawnRate(state, state.parks[0])
  openRideFixture(state, 3)
  const few = spawnRate(state, state.parks[0])
  assert.ok(few.buildCap > empty.buildCap)
  assert.ok(few.cap > empty.cap)
  for (let k = 3; k < 40; k++) {
    const made = applyCommand(state, { t: 'flat', ride: 'dropTower', x: 40 + (k % 8) * 4, y: 40 + Math.floor(k / 8) * 4, rot: 0 })
    if (made.ok) state.entities[made.id].status = 'open'
  }
  const crowded = spawnRate(state, state.parks[0])
  assert.equal(crowded.limit, 'land')
  assert.equal(crowded.landCap, Math.round(40 * 40 * GUESTS_PER_OWNED_TILE))
  for (let y = 76; y < 116; y++) for (let x = 36; x < 76; x++) state.map.owner[tileIndex(state.map, x, y)] = 0
  state.landVersion++
  const bigger = spawnRate(state, state.parks[0])
  assert.ok(bigger.landCap > crowded.landCap)
  assert.ok(bigger.cap > crowded.cap)
  assert.ok(bigger.cap <= MAX_GUESTS)
})

test('wave pools are sized by dragging and priced by area', () => {
  const state = parkFixture()
  const small = flatSpec('wavePool', [4, 4], 'rolling')
  const big = flatSpec('wavePool', [16, 20], 'rolling')
  assert.equal(small.cost, 2500 + 260 * 16)
  assert.equal(big.cost, 2500 + 260 * 320)
  assert.equal(big.capacity, Math.round(1.2 * 320))
  assert.ok(big.upkeep > small.upkeep)
  assert.ok(big.stats.e > small.stats.e)
  assert.equal(applyCommand(state, { t: 'flat', ride: 'wavePool', x: 40, y: 40, rot: 0, w: 3, h: 8 }).ok, false)
  assert.equal(applyCommand(state, { t: 'flat', ride: 'wavePool', x: 40, y: 40, rot: 0, w: 17, h: 8 }).ok, false)
  assert.equal(applyCommand(state, { t: 'flat', ride: 'carousel', x: 40, y: 40, rot: 0, w: 5, h: 5 }).ok, false)
  const before = state.parks[0].cash
  const made = applyCommand(state, { t: 'flat', ride: 'wavePool', x: 40, y: 40, rot: 0, w: 10, h: 12 })
  assert.equal(made.ok, true, made.error)
  const pool = state.entities[made.id]
  assert.deepEqual(pool.size, [10, 12])
  assert.equal(footprintTiles(pool).length, 120)
  assert.equal(before - state.parks[0].cash, flatSpec('wavePool', [10, 12], 'rolling').cost)
  assert.equal(rideCapacity(pool), 144)
  assert.equal(state.map.obj[tileIndex(state.map, 49, 51)], pool.id)

  const calm = { ...pool.stats }
  assert.equal(applyCommand(state, { t: 'rideSet', id: pool.id, wave: 'storm' }).ok, true)
  assert.equal(pool.wave, 'storm')
  assert.ok(pool.stats.i > calm.i + WAVE_SETTINGS.storm.i - 0.01)
  assert.equal(applyCommand(state, { t: 'rideSet', id: pool.id, wave: 'tsunami' }).ok, false)

  const copy = deserializePark(serializePark(state))
  assert.deepEqual(copy.entities[pool.id].size, [10, 12])
  assert.equal(copy.entities[pool.id].wave, 'storm')
})

test('swimming pools resize too, and older pools keep their original footprint', () => {
  const state = parkFixture()
  const made = applyCommand(state, { t: 'flat', ride: 'pool', x: 40, y: 40, rot: 0 })
  assert.equal(made.ok, true, made.error)
  assert.deepEqual(state.entities[made.id].size, [5, 4])
  assert.equal(flatSpec('pool', [5, 4]).cost, 3400)
  const sized = applyCommand(state, { t: 'flat', ride: 'pool', x: 50, y: 40, rot: 0, w: 8, h: 6 })
  assert.equal(sized.ok, true, sized.error)
  assert.equal(footprintTiles(state.entities[sized.id]).length, 48)
  const saved = serializePark(state)
  delete saved.entities[made.id].size
  const copy = deserializePark(saved)
  assert.deepEqual(copy.entities[made.id].size, [5, 4])
})

test('every water ride builds with balanced stats and room for riders', () => {
  const water = Object.entries(FLAT_RIDES).filter(([, def]) => def.category === 'water')
  assert.ok(water.length >= 15)
  for (const [id, def] of water) {
    const state = parkFixture()
    const made = applyCommand(state, { t: 'flat', ride: id, x: 40, y: 40, rot: 0 })
    assert.equal(made.ok, true, `${id}: ${made.error}`)
    const ride = state.entities[made.id]
    assert.ok(rideCapacity(ride) >= 4, id)
    if (def.resize) continue
    assert.ok(def.cost >= 1000 && def.cost <= 15000, id)
    assert.ok(def.stats.e > 1 && def.stats.e < 7, id)
    if (def.stats.i >= 4) assert.ok(def.cost >= 5600, `${id} is a thrill ride priced below the Waterslide`)
    if (def.stats.i < 1) assert.ok(def.cost <= 3000, `${id} is a gentle ride priced like a thrill ride`)
  }
})

test('compact ready-made coasters close their own circuit inside their stated footprint', () => {
  const compact = Object.entries(COASTER_PRESETS).filter(([, design]) => design.footprint)
  assert.ok(compact.length >= 10)
  const styles = new Set(compact.map(([, design]) => design.style))
  for (const style of ['junior', 'wooden', 'steel', 'inverted', 'launch', 'extreme', 'kart', 'waterSlide']) assert.ok(styles.has(style), style)
  for (const [id, design] of compact) {
    const state = parkFixture()
    const made = applyCommand(state, { t: 'preset', preset: id, x: 60, y: 60, dir: 0 })
    assert.equal(made.ok, true, `${id}: ${made.error}`)
    const ride = state.entities[made.id]
    assert.equal(ride.complete, true, id)
    assert.equal(ride.pieces.length, design.station + design.pieces.length, `${id} needed auto-complete`)
    assert.equal(ride.stats?.valid, true, `${id} failed its test run`)
    assert.equal(made.cost, design.cost, `${id} price changed`)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [index, cells] of state.trackCells) if (cells.some(cell => cell.ride === ride.id)) {
      const x = index % state.map.w, y = Math.floor(index / state.map.w)
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
    assert.ok(x1 - x0 + 1 <= design.footprint[0] && y1 - y0 + 1 <= design.footprint[1], `${id} spills past ${design.footprint.join('x')}`)
    assert.ok(Math.max(...design.footprint) <= 18, id)
  }
})

test('suspended coasters raise their station so riders clear the ground', () => {
  const state = parkFixture()
  const made = applyCommand(state, { t: 'coaster', style: 'inverted', x: 60, y: 60, dir: 0, length: 3 })
  assert.equal(made.ok, true, made.error)
})

test('about a quarter of adult guests are thrill seekers with a higher intensity limit', () => {
  let seed = 12345
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const adults = Array.from({ length: 4000 }, () => guestProfile(rnd, false))
  const kids = Array.from({ length: 1000 }, () => guestProfile(rnd, true))
  const share = adults.filter(g => g.type === 'thrill').length / adults.length
  assert.ok(Math.abs(share - THRILL_SEEKER_SHARE) < 0.03, `thrill share ${share}`)
  for (const g of adults) assert.ok(g.type === 'thrill' ? g.maxI >= 8 && g.maxI <= 13 && g.tolerance >= 7 : g.maxI >= 6 && g.maxI <= 11.5)
  assert.ok(kids.every(g => g.type === 'kid' && g.maxI <= 6.5))
})

test('guests warm up and follow friends onto intense rides, but kids stay capped', () => {
  const state = { thrillCrowds: new Map([[7, [10, 10, 11, 10]]]) }
  const ride = { id: 7, stats: { valid: true, e: 6, i: 9, n: 4 } }
  const guest = { type: 'casual', minI: 2, maxI: 8, warm: 0, x: 10.5, y: 10.5 }
  assert.equal(intensityLimit(state, guest, ride), 8 + 1.5)
  const alone = { ...guest, x: 40, y: 40 }
  assert.equal(intensityLimit(state, alone, ride), 8)
  for (let k = 0; k < 20; k++) warmUp(alone, ride, true)
  assert.equal(alone.warm, WARM_UP_MAX)
  assert.equal(intensityLimit(state, alone, ride), 8 + WARM_UP_MAX)
  const kid = { type: 'kid', kid: true, minI: 0, maxI: 5, warm: 0, x: 10.5, y: 10.5 }
  warmUp(kid, ride, true)
  assert.equal(kid.warm, 0)
  assert.equal(intensityLimit(state, kid, ride), 5)
})

test('a park whose only ride is very intense still gets riders', () => {
  const state = createPark('sandbox')
  state.parks[0].named = true
  state.parks[0].cash = 1_000_000
  for (const e of Object.values(state.entities)) if (e.type === 'scenery') { state.map.obj[tileIndex(state.map, e.x, e.y)] = 0; delete state.entities[e.id] }
  const entrance = Object.values(state.entities).find(e => e.type === 'parkEntrance')
  const x = entrance.x, y = entrance.y
  assert.equal(applyCommand(state, { t: 'path', kind: 1, elevation: 0, x0: x, y0: y - 13, x1: x, y1: y - 1 }).ok, true)
  const made = applyCommand(state, { t: 'flat', ride: 'dropTower', x: x + 2, y: y - 11, rot: 0 })
  assert.equal(made.ok, true, made.error)
  assert.equal(applyCommand(state, { t: 'gate', ride: made.id, role: 'entrance', x: x + 1, y: y - 11 }).ok, true)
  assert.equal(applyCommand(state, { t: 'gate', ride: made.id, role: 'exit', x: x + 1, y: y - 9 }).ok, true)
  const ride = state.entities[made.id]
  ride.status = 'open'; ride.price = 0
  ride.stats = { ...ride.stats, e: 6, i: 9.2 }
  for (let k = 0; k < 4000; k++) stepPark(state)
  assert.ok(ride.totalRiders > 0, 'nobody rode')
  assert.ok(state.guests.some(g => g.type === 'thrill'))
})

function intenseRidePark() {
  const state = createPark('sandbox')
  state.parks[0].named = true
  state.parks[0].cash = 1_000_000
  for (const e of Object.values(state.entities)) if (e.type === 'scenery') { state.map.obj[tileIndex(state.map, e.x, e.y)] = 0; delete state.entities[e.id] }
  const entrance = Object.values(state.entities).find(e => e.type === 'parkEntrance')
  const x = entrance.x, y = entrance.y
  applyCommand(state, { t: 'path', kind: 1, elevation: 0, x0: x, y0: y - 13, x1: x, y1: y - 1 })
  const made = applyCommand(state, { t: 'flat', ride: 'dropTower', x: x + 2, y: y - 11, rot: 0 })
  applyCommand(state, { t: 'gate', ride: made.id, role: 'entrance', x: x + 1, y: y - 11 })
  applyCommand(state, { t: 'gate', ride: made.id, role: 'exit', x: x + 1, y: y - 9 })
  const ride = state.entities[made.id]
  ride.status = 'open'
  return { state, ride }
}

test('guests leave varied, repeatable comments on the rides they use', () => {
  const lines = Object.values(COMMENT_POOLS).reduce((total, [, list]) => total + list.length, 0)
  assert.ok(lines >= 40, `${lines} comment lines`)
  const runs = [intenseRidePark(), intenseRidePark()]
  for (const { state } of runs) for (let k = 0; k < 4000; k++) stepPark(state)
  const [a, b] = runs
  assert.ok(a.ride.comments.length > 0, 'no comments recorded')
  assert.ok(a.ride.comments.length <= 12)
  assert.deepEqual(a.ride.comments, b.ride.comments)
  const counts = a.ride.commentCounts
  assert.ok(counts.pos + counts.mix + counts.neg >= a.ride.comments.length)
  const detail = rideCommentsDetail(a.state, a.ride.id)
  assert.equal(detail.comments[0].t, a.ride.comments[a.ride.comments.length - 1].t)
  const copy = deserializePark(serializePark(a.state))
  assert.deepEqual(copy.entities[a.ride.id].comments, a.ride.comments)
  const saved = serializePark(a.state)
  delete saved.entities[a.ride.id].comments
  delete saved.entities[a.ride.id].commentCounts
  assert.deepEqual(deserializePark(saved).entities[a.ride.id].comments, [])
})

test('comment lines name the ride and the kind of guest', () => {
  const { state, ride } = intenseRidePark()
  ride.name = 'Sky Drop'
  for (let k = 0; k < 20; k++) recordComment(state, ride, { id: k + 1, type: k % 2 ? 'kid' : 'thrill' }, 'stuck')
  assert.equal(ride.comments.length, 12)
  assert.equal(ride.commentCounts.neg, 20)
  assert.ok(ride.comments.every(c => c.text.includes('Sky Drop')))
  assert.ok(ride.comments.some(c => c.who === 'a kid') && ride.comments.some(c => c.who === 'a thrill seeker'))
})

function hotelFixture() {
  const state = parkFixture()
  buildPath(state, 1, 40, 39)
  for (let x = 40; x < 72; x++) buildPath(state, 1, x, 39)
  return state
}

test('hotels need a footpath, respect their size and floor limits, and cost by size', () => {
  const state = hotelFixture()
  assert.equal(applyCommand(state, { t: 'hotel', kind: 'motorInn', x: 40, y: 50, w: 4, h: 3, floors: 1 }).ok, false)
  assert.equal(applyCommand(state, { t: 'hotel', kind: 'motorInn', x: 40, y: 40, w: 26, h: 3, floors: 1 }).ok, false)
  assert.equal(applyCommand(state, { t: 'hotel', kind: 'motorInn', x: 40, y: 40, w: 20, h: 12, floors: 1 }).ok, false)
  assert.equal(applyCommand(state, { t: 'hotel', kind: 'motorInn', x: 40, y: 40, w: 4, h: 3, floors: 4 }).ok, false)
  assert.equal(hotelSpec('motorInn', [3, 3], 1).cost, 40300)
  assert.ok(hotelSpec('skylineTower', [12, 12], 24).cost > 1_500_000)
  const before = state.parks[0].cash
  const made = applyCommand(state, { t: 'hotel', kind: 'motorInn', x: 40, y: 40, w: 8, h: 4, floors: 2 })
  assert.equal(made.ok, true, made.error)
  const hotel = state.entities[made.id]
  assert.equal(before - state.parks[0].cash, hotelSpec('motorInn', [8, 4], 2).cost)
  assert.deepEqual(hotel.entrance.y, 39)
  assert.equal(state.map.obj[tileIndex(state.map, 47, 43)], hotel.id)
  assert.equal(applyCommand(state, { t: 'flat', ride: 'carousel', x: 44, y: 41, rot: 0 }).ok, false)
  assert.ok(parkValue(state, 0) >= hotelSpec('motorInn', [8, 4], 2).cost)
})

test('hotels raise the guest cap, earn nightly income and send guests out of their doors', () => {
  const state = hotelFixture()
  const empty = spawnRate(state, state.parks[0])
  const made = applyCommand(state, { t: 'hotel', kind: 'skylineTower', x: 44, y: 40, w: 8, h: 8, floors: 12 })
  assert.equal(made.ok, true, made.error)
  const spec = hotelSpec('skylineTower', [8, 8], 12)
  const after = spawnRate(state, state.parks[0])
  assert.equal(after.buildCap - empty.buildCap, Math.round(spec.rooms * HOTEL_GUESTS_PER_ROOM))
  const cash = state.parks[0].cash
  updateHotels(state)
  const hotel = state.entities[made.id]
  assert.ok(hotel.occupancy > 0 && hotel.occupancy < 1)
  assert.ok(state.parks[0].month.hotels > 0)
  const m = state.parks[0].month
  assert.equal(m.hotelStaff, -spec.upkeep)
  assert.equal(hotel.night.profit, hotel.night.income - hotel.night.costs)
  assert.equal(state.parks[0].cash - cash, m.hotels + m.hotelAmenities + m.hotelStaff + m.hotelUpkeep)
  assert.equal(hotel.profit, hotel.night.profit)
  assert.deepEqual(hotel.nights, [hotel.night.profit])
  const guest = spawnGuest(state, 0, hotel)
  assert.equal(Math.floor(guest.x), hotel.entrance.x)
  assert.equal(Math.floor(guest.y), hotel.entrance.y)
  assert.equal(guest.paid, true)
})

test('hotels come in custom sizes, and price scales with squares, floors and height', () => {
  const state = hotelFixture()
  const small = hotelSpec('timberLodge', [3, 3], 1), big = hotelSpec('timberLodge', [16, 12], 6)
  assert.ok(big.cost > small.cost * 10 && big.rooms > small.rooms * 50)
  // Towers past HIGH_RISE_FLOORS pay a structural premium per floor.
  const per = f => (hotelSpec('skylineTower', [6, 6], f).building - HOTELS.skylineTower.base) / f
  assert.ok(per(30) > per(8))
  const made = applyCommand(state, { t: 'hotel', kind: 'palmCove', x: 40, y: 40, w: 20, h: 18, floors: 1 })
  assert.equal(made.ok, true, made.error)
  assert.deepEqual(state.entities[made.id].size, [20, 18])
})

test('hotels can be resized in place and pay or refund the difference', () => {
  const state = hotelFixture()
  const made = applyCommand(state, { t: 'hotel', kind: 'neonNights', x: 40, y: 40, w: 4, h: 4, floors: 2 })
  assert.equal(made.ok, true, made.error)
  const hotel = state.entities[made.id]
  const quote = hotelResizeCost(hotel, [8, 6], 5)
  const cash = state.parks[0].cash
  const grow = applyCommand(state, { t: 'hotelResize', id: made.id, w: 8, h: 6, floors: 5 })
  assert.equal(grow.ok, true, grow.error)
  assert.equal(cash - state.parks[0].cash, quote)
  assert.ok(quote > hotelSpec('neonNights', [8, 6], 5).building - hotelSpec('neonNights', [4, 4], 2).building)
  assert.equal(state.map.obj[tileIndex(state.map, 47, 45)], hotel.id)
  const shrink = applyCommand(state, { t: 'hotelResize', id: made.id, w: 3, h: 3, floors: 2 })
  assert.equal(shrink.ok, true, shrink.error)
  assert.ok(shrink.refund > 0)
  assert.equal(state.map.obj[tileIndex(state.map, 47, 45)], 0)
  assert.equal(applyCommand(state, { t: 'hotelResize', id: made.id, w: 30, h: 3, floors: 2 }).ok, false)
})

test('room rates, service levels, amenities and refurbishing change hotel books', () => {
  const state = hotelFixture()
  const made = applyCommand(state, { t: 'hotel', kind: 'skylineTower', x: 44, y: 40, w: 8, h: 8, floors: 12 })
  const hotel = state.entities[made.id]
  const base = hotelOccupancy(state, hotel, false)
  assert.equal(applyCommand(state, { t: 'hotelSet', id: made.id, rate: 20 }).ok, true)
  assert.ok(hotelOccupancy(state, hotel, false) < base)
  assert.equal(applyCommand(state, { t: 'hotelSet', id: made.id, rate: 1000 }).ok, false)
  assert.equal(applyCommand(state, { t: 'hotelSet', id: made.id, rate: 10, service: 'premium' }).ok, true)
  assert.ok(hotelOccupancy(state, hotel, false) > base)
  assert.ok(hotelNight(hotel, 0.5).staff > hotelSpec('skylineTower', [8, 8], 12).upkeep)
  const plain = hotelNight(hotel, 0.6)
  assert.equal(applyCommand(state, { t: 'hotelSet', id: made.id, addon: 'restaurant', on: true }).ok, true)
  const fed = hotelNight(hotel, 0.6)
  assert.ok(fed.amenities > plain.amenities && fed.amenityCosts > plain.amenityCosts)
  hotel.condition = 40
  assert.ok(hotelOccupancy(state, hotel, false) < base + 0.07)
  const cost = hotelRefurbishCost(hotel)
  const cash = state.parks[0].cash
  assert.equal(applyCommand(state, { t: 'hotelSet', id: made.id, refurbish: true }).ok, true)
  assert.equal(cash - state.parks[0].cash, cost)
  assert.equal(hotel.condition, 100)
  updateHotels(state)
  assert.ok(hotel.condition < 100)
  const copy = deserializePark(serializePark(state)).entities[made.id]
  assert.equal(copy.service, 'premium')
  assert.equal(copy.rate, 10)
  assert.equal(copy.nights.length, 1)
})

test('two hotels near a pool form a resort district', () => {
  const state = hotelFixture()
  const a = applyCommand(state, { t: 'hotel', kind: 'palmCove', x: 40, y: 40, w: 4, h: 4, floors: 1 })
  const b = applyCommand(state, { t: 'hotel', kind: 'timberLodge', x: 46, y: 40, w: 4, h: 3, floors: 2 })
  assert.equal(a.ok && b.ok, true)
  updateHotels(state)
  assert.equal(state.parks[0].resortHotels, 0)
  assert.equal(applyCommand(state, { t: 'flat', ride: 'pool', x: 40, y: 45, rot: 0 }).ok, true)
  updateHotels(state)
  assert.equal(state.parks[0].resortHotels, 2)
  assert.equal(state.entities[a.id].district, true)
})

test('hotel colors, roofs and add-ons are saved, and add-ons cost money', () => {
  const state = hotelFixture()
  const made = applyCommand(state, { t: 'hotel', kind: 'castleKeep', x: 40, y: 40, w: 6, h: 6, floors: 3 })
  assert.equal(made.ok, true, made.error)
  assert.equal(applyCommand(state, { t: 'hotelSet', id: made.id, primary: 0x112233, trim: 0xabcdef, roof: 'cone' }).ok, true)
  assert.equal(applyCommand(state, { t: 'hotelSet', id: made.id, roof: 'spire' }).ok, false)
  assert.equal(applyCommand(state, { t: 'hotelSet', id: made.id, primary: 0x1000000 }).ok, false)
  const cash = state.parks[0].cash
  assert.equal(applyCommand(state, { t: 'hotelSet', id: made.id, addon: 'pool', on: true }).ok, true)
  assert.equal(cash - state.parks[0].cash, 30000)
  const copy = deserializePark(serializePark(state)).entities[made.id]
  assert.equal(copy.colors.primary, 0x112233)
  assert.equal(copy.roof, 'cone')
  assert.equal(copy.addons.pool, true)
  assert.deepEqual(copy.size, [6, 6])
  const refund = applyCommand(state, { t: 'demolish', id: made.id })
  assert.equal(refund.ok, true)
  assert.equal(state.map.obj[tileIndex(state.map, 42, 42)], 0)
  assert.ok(Object.keys(HOTELS).length >= 8)
})

test('level land matches the corner the drag started from', () => {
  const state = parkFixture()
  const w = state.map.w + 1
  for (let y = 0; y <= state.map.h; y++) for (let x = 12; x <= 16; x++) state.map.corners[y * w + x] = 9
  // Starting low and dragging across the hill cuts the hill down to the start height.
  assert.equal(applyCommand(state, { t: 'terrain', op: 'level', x0: 8, y0: 5, x1: 18, y1: 7, sx: 8, sy: 5 }).ok, true)
  for (let x = 8; x <= 18; x++) assert.equal(tileMax(state.map, x, 6), 6)
  // Starting on top of the hill raises the low ground up to the hill instead.
  for (let y = 0; y <= state.map.h; y++) for (let x = 30; x <= 34; x++) state.map.corners[y * w + x] = 9
  assert.equal(applyCommand(state, { t: 'terrain', op: 'level', x0: 32, y0: 20, x1: 26, y1: 22, sx: 32, sy: 20 }).ok, true)
  for (let x = 26; x <= 32; x++) assert.equal(tileMax(state.map, x, 21), 9)
})

test('the path builder auto-finishes a raised walkway down to the ground', () => {
  const state = parkFixture()
  assert.equal(buildPath(state, 1, 30, 30).ok, true)
  assert.equal(buildPath(state, 3, 31, 30, 2).ok, true)
  assert.equal(buildPath(state, 3, 32, 30, 4).ok, true)
  assert.equal(buildPath(state, 1, 33, 30, 5).ok, true)
  const res = applyCommand(state, { t: 'pathFinish', x: 33, y: 30, dir: 0, kind: 1 })
  assert.equal(res.ok, true, res.error)
  assert.ok(res.pieces >= 2)
  let x = 33
  while (state.map.path[tileIndex(state.map, x + 1, 30)]) {
    assert.equal(pathsConnect(state.map, x, 30, x + 1, 30), true)
    x++
  }
  assert.equal(state.map.pathElevation[tileIndex(state.map, x, 30)], 0)
  // Blocked on every side: nothing is built and the park is not charged.
  const blocked = parkFixture()
  assert.equal(buildPath(blocked, 1, 5, 5, 6).ok, true)
  blocked.map.owner[tileIndex(blocked.map, 6, 5)] = 1
  blocked.map.owner[tileIndex(blocked.map, 5, 4)] = 1
  blocked.map.owner[tileIndex(blocked.map, 5, 6)] = 1
  const cash = blocked.parks[0].cash, version = blocked.structVersion
  assert.equal(applyCommand(blocked, { t: 'pathFinish', x: 5, y: 5, dir: 0, kind: 1 }).ok, false)
  assert.equal(blocked.parks[0].cash, cash)
  assert.equal(blocked.structVersion, version)
})

test('queue lines double as exit lines and guests walk out along them', () => {
  const state = createPark('sandbox')
  state.parks[0].named = true
  state.parks[0].cash = 1_000_000
  for (const e of Object.values(state.entities)) if (e.type === 'scenery') { state.map.obj[tileIndex(state.map, e.x, e.y)] = 0; delete state.entities[e.id] }
  const entrance = Object.values(state.entities).find(e => e.type === 'parkEntrance')
  const x = entrance.x, y = entrance.y
  assert.equal(applyCommand(state, { t: 'path', kind: 1, elevation: 0, x0: x, y0: y - 14, x1: x, y1: y - 1 }).ok, true)
  const made = applyCommand(state, { t: 'flat', ride: 'dropTower', x: x + 2, y: y - 11, rot: 0 })
  assert.equal(made.ok, true, made.error)
  assert.equal(applyCommand(state, { t: 'gate', ride: made.id, role: 'entrance', x: x + 1, y: y - 11 }).ok, true)
  assert.equal(applyCommand(state, { t: 'gate', ride: made.id, role: 'exit', x: x + 2, y: y - 12 }).ok, true)
  assert.equal(applyCommand(state, { t: 'path', kind: 2, elevation: 0, x0: x + 2, y0: y - 14, x1: x + 2, y1: y - 13 }).ok, true)
  assert.equal(applyCommand(state, { t: 'path', kind: 2, elevation: 0, x0: x + 1, y0: y - 14, x1: x + 1, y1: y - 14 }).ok, true)
  const ride = state.entities[made.id]
  const line = exitLine(state, ride)
  assert.equal(line.tiles.length, 3)
  assert.deepEqual(line.join, [x, y - 14])
  ride.status = 'open'; ride.price = 0
  const onLine = new Set(line.tiles.map(([a, b]) => `${a},${b}`)), used = new Set()
  for (let k = 0; k < 5000; k++) {
    stepPark(state)
    for (const g of state.guests) if (onLine.has(`${g.tx},${g.ty}`)) { used.add(g.id); assert.notEqual(g.state, 'queue') }
  }
  assert.ok(ride.totalRiders > 0, 'nobody rode')
  assert.ok(used.size > 0, 'nobody used the exit line')
  assert.equal(state.guests.filter(g => onLine.has(`${g.tx},${g.ty}`) && !g.exitRide).length, 0)
})

test('an entrance queue never routes through a neighbouring exit line', () => {
  const state = parkFixture()
  const ride = { id: 100, type: 'ride', entrance: 101, exit: 102 }
  state.entities = {
    100: ride,
    101: { id: 101, type: 'gate', role: 'entrance', ride: 100, x: 5, y: 5, dir: 3 },
    102: { id: 102, type: 'gate', role: 'exit', ride: 100, x: 6, y: 5, dir: 3 },
  }
  // Two side-by-side lines running north to a footpath.
  for (const y of [4, 3, 2]) { state.map.path[tileIndex(state.map, 5, y)] = 2; state.map.path[tileIndex(state.map, 6, y)] = 2 }
  state.map.path[tileIndex(state.map, 5, 1)] = 1
  state.map.path[tileIndex(state.map, 6, 1)] = 1
  state.pathVersion++
  const exitTiles = new Set(exitLine(state, ride).tiles.map(([a, b]) => `${a},${b}`))
  assert.deepEqual([...exitTiles], ['6,4', '6,3', '6,2'])
  const queue = queueLine(state, ride)
  assert.deepEqual(queue.tiles, [[5, 4], [5, 3], [5, 2]])
  assert.deepEqual(queue.join, [5, 1])
})

test('path slopes ramp half as high as stairs and stairs keep climbing', () => {
  const state = parkFixture()
  const at = (x, u) => pathHeightAt(state.map, (x + u) * 4, 10.5 * 4)
  assert.equal(buildPath(state, 1, 10, 10).ok, true)
  // Two gentle slopes from the ground climb as high as one flight of stairs.
  assert.equal(buildPath(state, 1, 11, 10, 1).ok, true)
  assert.equal(buildPath(state, 1, 12, 10, 2).ok, true)
  assert.equal(buildPath(state, 3, 13, 10, 4).ok, true)
  assert.equal(buildPath(state, 3, 14, 10, 6).ok, true)
  assert.equal(buildPath(state, 3, 15, 10, 8).ok, true)
  assert.equal(buildPath(state, 1, 16, 10, 8).ok, true)
  const ground = 6
  assert.ok(Math.abs(at(11, 0.001) - ground) < 0.01)
  assert.ok(Math.abs(at(11, 0.999) - (ground + 0.5)) < 0.01)
  assert.ok(Math.abs(at(12, 0.999) - (ground + 1)) < 0.01)
  for (let x = 13; x <= 15; x++) {
    assert.ok(Math.abs(at(x, 0.001) - (ground + 1 + (x - 13))) < 0.01, `stairs ${x} start`)
    assert.ok(Math.abs(at(x, 0.999) - (ground + 2 + (x - 13))) < 0.01, `stairs ${x} top`)
  }
  assert.ok(Math.abs(at(16, 0.5) - (ground + 4)) < 0.01)
  for (let x = 10; x < 16; x++) assert.equal(pathsConnect(state.map, x, 10, x + 1, 10), true)
  // Descending pieces keep their high end and ramp down to the piece after.
  assert.equal(buildPath(state, 3, 17, 10, 8).ok, true)
  assert.equal(buildPath(state, 1, 18, 10, 6).ok, true)
  assert.ok(Math.abs(at(17, 0.001) - (ground + 4)) < 0.01)
  assert.ok(Math.abs(at(17, 0.999) - (ground + 3)) < 0.01)
  const res = applyCommand(state, { t: 'pathFinish', x: 18, y: 10, dir: 0, kind: 1, exit: ground + 3, sloped: false })
  assert.equal(res.ok, true, res.error)
  let x = 18
  while (state.map.path[tileIndex(state.map, x + 1, 10)]) {
    assert.ok(Math.abs(at(x, 0.999) - at(x + 1, 0.001)) < 0.05, `finish seam ${x}`)
    x++
  }
  assert.equal(state.map.pathElevation[tileIndex(state.map, x, 10)], 0)
})
