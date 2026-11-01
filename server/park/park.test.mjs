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
  STAFF_WAGE_PER_DAY,
  ELECTRICITY_COST_PER_TILE_PER_DAY,
  dailyOperatingCosts,
  queueLine,
  stepPark,
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
