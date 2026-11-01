import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCommand,
  applyDynamic,
  createPark,
  deserializePark,
  encodeDynamic,
  pathHeightAt,
  pathsConnect,
  rideCapacity,
  serializePark,
  stallPlacementRotation,
  tileIndex,
  COASTER_STYLES,
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

test('coaster building prices are doubled and electricity is five dollars per tile daily', () => {
  assert.equal(COASTER_STYLES.steel.cost, 4400)
  assert.equal(COASTER_STYLES.steel.pieceCost, 180)
  assert.equal(COASTER_STYLES.wooden.cost, 4000)
  assert.equal(COASTER_STYLES.junior.cost, 2400)
  assert.equal(COASTER_STYLES.inverted.cost, 5600)
  assert.equal(ELECTRICITY_COST_PER_TILE_PER_DAY, 5)

  const state = parkFixture()
  state.entities = {
    10: { id: 10, type: 'ride', kind: 'flat', ride: 'carousel', x: 10, y: 10, rot: 0, park: 0 },
    11: { id: 11, type: 'stall', kind: 'burger', x: 13, y: 10, size: [1, 1], rot: 0, park: 0 },
    12: { id: 12, type: 'stall', kind: 'burger', x: 20, y: 20, size: [1, 1], rot: 0, park: 1 },
  }
  state.staff = [{ id: 1, park: 0, role: 'security' }]
  assert.deepEqual(dailyOperatingCosts(state, 0), { wages: 100, electricity: 50, poweredTiles: 10 })
})
