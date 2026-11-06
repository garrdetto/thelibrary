import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCommand, createPark, validatePiece, buildTrackPath, stepTrain, makeTrain, KART_HAIRPIN_SPEED, trackPoses, rebuildTrackCells, serializePark, deserializePark, kartCount, kartLane } from './index.mjs'
import { planPiece, startEnd, edgeHeight } from '../../src/lib/park/pathBuilder.ts'

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

test('a chosen turn is never swapped for a straight piece while the track is sloped', () => {
  const state = parkFixture()
  const ride = { id: 100, type: 'ride', kind: 'coaster', style: 'steel', park: 0, start: { x: 20, y: 20, dir: 0, h: 20 }, pieces: [{ c: 0, s: 1 }], complete: false }
  state.entities[ride.id] = ride
  for (const c of [-2, -1, 1, 2]) {
    const result = validatePiece(state, ride, { c, s: 0 })
    assert.equal(result.ok, true, result.error)
    assert.equal(result.piece.c, c)
    assert.equal(result.piece.s, 1)
  }
  ride.pieces = [{ c: 0, s: 1 }, { c: 0, s: 2 }]
  assert.ok(validatePiece(state, ride, { c: 1, s: 0 }).error)
  ride.pieces = []
  for (const c of [-2, -1, 1, 2]) assert.equal(validatePiece(state, ride, { c, s: 1 }).piece.c, c)
})

test('go-kart tracks have a hairpin turn that fits inside one tile; other styles do not', () => {
  const state = parkFixture()
  const kart = { id: 100, type: 'ride', kind: 'coaster', style: 'kart', park: 0, start: { x: 20, y: 20, dir: 0, h: 13 }, pieces: [], complete: false }
  const steel = { ...kart, id: 101, style: 'steel', start: { ...kart.start, h: 20 } }
  for (const c of [-3, 3]) {
    const result = validatePiece(state, kart, { c, s: 0 })
    assert.equal(result.ok, true, result.error)
    assert.equal(result.piece.c, c)
    assert.equal(result.cells.length, 1)
    assert.equal(result.next.dir, c > 0 ? 3 : 1)
    assert.ok(validatePiece(state, steel, { c, s: 0 }).error)
  }
})

test('karts slow down for a hairpin', () => {
  const state = parkFixture()
  const ride = { id: 100, type: 'ride', kind: 'coaster', style: 'kart', park: 0, start: { x: 20, y: 20, dir: 0, h: 13 }, pieces: [], complete: false }
  state.entities[ride.id] = ride
  for (const piece of [{ c: 0, s: 0, sp: 'station' }, { c: 0, s: 0 }, { c: 0, s: 0 }, { c: 3, s: 0 }, { c: 3, s: 0 }, { c: 0, s: 0 }]) {
    assert.equal(applyCommand(state, { t: 'piece', ride: ride.id, ...piece }).ok, true)
  }
  const path = buildTrackPath(ride)
  const train = makeTrain()
  train.phase = 'running'
  train.s = 4
  train.v = 15
  let slowest = Infinity
  for (let step = 0; step < 600 && train.s < path.length - 1; step++) {
    stepTrain(path, train, 1, 1 / 60, { style: { drive: 8, maxSpeed: 15 } })
    if (path.hairpins[path.piece[Math.min(path.count - 1, Math.round(train.s / path.ds))]]) slowest = Math.min(slowest, train.v)
  }
  assert.ok(slowest <= KART_HAIRPIN_SPEED + 0.5, `slowest ${slowest}`)
})

test('stairs, flat, flat keeps building on level and bumpy ground', () => {
  for (const scenario of ['meadowbrook', 'pineRidge']) {
    for (let sx = 24; sx < 100; sx += 5) for (let sy = 24; sy < 100; sy += 9) {
      const state = createPark(scenario)
      state.parks[0].named = true
      state.parks[0].cash = 1e9
      state.map.owner.fill(0)
      state.map.obj.fill(0)
      state.map.path.fill(0)
      state.map.pathElevation.fill(0)
      state.entities = {}
      state.trackCells = new Map()
      let from = startEnd(state.map, sx, sy)
      for (const segment of ['stairs-up', 'level', 'level', 'level']) {
        const plan = planPiece(state.map, 0, from, segment, 0, 1)
        if (!plan.ok) {
          assert.doesNotMatch(plan.error, /does not line up/, `${scenario} ${sx},${sy} ${segment}`)
          break
        }
        if (!plan.anchor) {
          const res = applyCommand(state, { t: 'path', kind: plan.kind, elevation: plan.elevation, x0: plan.x, y0: plan.y, x1: plan.x, y1: plan.y })
          assert.equal(res.ok, true, res.error)
        }
        from = plan.end
      }
    }
  }
})

test('stairs, flat, flat, turn, flat continues on level ground', () => {
  const state = parkFixture()
  let from = startEnd(state.map, 30, 30)
  const steps = [['stairs-up', 0], ['stairs-up', 0], ['level', 0], ['level', 0], ['level', 1], ['level', 0], ['level', -1], ['stairs-down', 0]]
  for (const [segment, turn] of steps) {
    const plan = planPiece(state.map, 0, from, segment, turn, 1)
    assert.equal(plan.ok, true, `${segment} ${turn}: ${plan.error}`)
    const res = applyCommand(state, { t: 'path', kind: plan.kind, elevation: plan.elevation, x0: plan.x, y0: plan.y, x1: plan.x, y1: plan.y })
    assert.equal(res.ok, true, res.error)
    from = plan.end
  }
})

function buildRun(state, start, steps, kind) {
  let from = start
  const built = []
  for (const [segment, turn = 0] of steps) {
    const plan = planPiece(state.map, 0, from, segment, turn, kind)
    assert.equal(plan.ok, true, `${segment} at step ${built.length}: ${plan.error}`)
    const result = applyCommand(state, { t: 'path', kind: plan.kind, elevation: plan.elevation, x0: plan.x, y0: plan.y, x1: plan.x, y1: plan.y })
    assert.equal(result.ok, true, `server refused a planned piece at ${plan.x},${plan.y}: ${result.error}`)
    if (plan.end.slope === 0) assert.ok(Math.abs(edgeHeight(state.map, plan.x, plan.y, plan.end.dir) - plan.end.exit) < 0.05, `builder lost track of the deck height at ${plan.x},${plan.y}`)
    built.push(plan)
    from = plan.end
  }
  return built
}

test('a level boardwalk crosses a pond at one height and steps back onto the far bank', () => {
  const state = parkFixture()
  for (let y = 18; y <= 22; y++) for (let x = 24; x <= 30; x++) state.map.water[y * state.map.w + x] = 6.4
  for (let y = 18; y <= 23; y++) for (let x = 24; x <= 31; x++) state.map.corners[y * (state.map.w + 1) + x] = 5
  const built = buildRun(state, { ...startEnd(state.map, 20, 20), dir: 0 }, Array.from({ length: 14 }, () => ['level']), 4)
  const overWater = built.filter(p => p.x >= 24 && p.x <= 30)
  assert.ok(overWater.length >= 6)
  const decks = new Set(overWater.map(p => p.end.exit.toFixed(2)))
  assert.equal(decks.size, 1, `deck changed height over the water: ${[...decks]}`)
  assert.ok(overWater[0].end.exit > 6.4)
})

test('a level boardwalk climbs onto rising ground and holds its height where the ground falls away', () => {
  const state = parkFixture()
  const W = state.map.w + 1
  for (let y = 0; y <= state.map.h; y++) for (let x = 0; x <= state.map.w; x++) state.map.corners[y * W + x] = 6 + Math.max(0, Math.min(2, (x - 24) * 0.5)) - Math.max(0, Math.min(2, (x - 34) * 0.5))
  buildRun(state, { ...startEnd(state.map, 20, 20), dir: 0 }, Array.from({ length: 18 }, () => ['level']), 4)
})

test('the path builder refuses, on the ghost, a piece the server would refuse for a tall step to a side path', () => {
  const state = parkFixture()
  assert.equal(applyCommand(state, { t: 'path', kind: 1, x0: 24, y0: 21, x1: 24, y1: 21 }).ok, true)
  let from = { ...startEnd(state.map, 20, 20), dir: 0 }
  for (const segment of ['level', 'up', 'up', 'up']) {
    const plan = planPiece(state.map, 0, from, segment, 0, 4)
    if (!plan.ok) { assert.match(plan.error, /different height|stairs/); return }
    const result = applyCommand(state, { t: 'path', kind: plan.kind, elevation: plan.elevation, x0: plan.x, y0: plan.y, x1: plan.x, y1: plan.y })
    assert.equal(result.ok, true, `planned piece refused by the server: ${result.error}`)
    from = plan.end
  }
})

test('new slope pieces are steeper while saved track keeps its shape', () => {
  const state = parkFixture()
  const coaster = { id: 100, type: 'ride', kind: 'coaster', style: 'steel', park: 0, start: { x: 20, y: 20, dir: 0, h: 20 }, pieces: [{ c: 0, s: 1, g: 1 }], complete: false }
  const steep = validatePiece(state, coaster, { c: 0, s: 2 })
  assert.equal(steep.piece.g, 1)
  assert.equal(steep.next.h - trackPoses(coaster)[1].h, 8)
  const legacy = { ...coaster, id: 101, pieces: [{ c: 0, s: 1 }, { c: 0, s: 2 }] }
  assert.equal(trackPoses(legacy)[2].h - trackPoses(legacy)[1].h, 5)
  const kart = { id: 102, type: 'ride', kind: 'coaster', style: 'kart', park: 0, start: { x: 20, y: 30, dir: 0, h: 13 }, pieces: [], complete: false }
  const up = validatePiece(state, kart, { c: 0, s: 1 })
  assert.equal(up.piece.g, 2)
  assert.equal(up.next.h - 13, 2)
})

test('a raised path can bridge a go-kart track and a kart track can pass under a raised path', () => {
  const state = parkFixture()
  const kart = { id: 100, type: 'ride', kind: 'coaster', style: 'kart', park: 0, start: { x: 20, y: 25, dir: 0, h: 13 }, pieces: Array.from({ length: 10 }, () => ({ c: 0, s: 0 })), complete: false }
  state.entities[kart.id] = kart
  rebuildTrackCells(state)
  assert.equal(applyCommand(state, { t: 'path', kind: 1, elevation: 2, x0: 25, y0: 25, x1: 25, y1: 25 }).ok, false)
  assert.equal(applyCommand(state, { t: 'path', kind: 1, elevation: 8, x0: 25, y0: 25, x1: 25, y1: 25 }).ok, true)
  const under = { id: 101, type: 'ride', kind: 'coaster', style: 'kart', park: 0, start: { x: 26, y: 20, dir: 1, h: 13 }, pieces: Array.from({ length: 3 }, () => ({ c: 0, s: 0 })), complete: false }
  assert.equal(applyCommand(state, { t: 'path', kind: 1, elevation: 9, x0: 26, y0: 23, x1: 26, y1: 23 }).ok, true)
  assert.equal(validatePiece(state, under, { c: 0, s: 0 }).ok, true)
})

test('track frames never flip where turns meet', () => {
  const ride = { style: 'kart', start: { x: 20, y: 20, dir: 2, h: 13 }, pieces: [1, 1, 1, 1, -1, -1, -1, -1].map(c => ({ c, s: 0 })), complete: false }
  const path = buildTrackPath(ride)
  for (let i = 1; i < path.count; i++) {
    const d = path.up[i * 3] * path.up[i * 3 - 3] + path.up[i * 3 + 1] * path.up[i * 3 - 2] + path.up[i * 3 + 2] * path.up[i * 3 - 1]
    assert.ok(d > 0.99)
  }
})

test('saved hairpins and slope grades survive a reload', () => {
  const state = parkFixture()
  assert.equal(applyCommand(state, { t: 'coaster', style: 'kart', x: 20, y: 20, dir: 0, length: 2 }).ok, true)
  const ride = Object.values(state.entities).find(e => e.style === 'kart')
  ride.pieces.push({ c: 3, s: 0 }, { c: 0, s: 1, g: 2 })
  const loaded = deserializePark(JSON.parse(JSON.stringify(serializePark(state))))
  assert.deepEqual(loaded.entities[ride.id].pieces.map(p => [p.c, p.s, p.g ?? 0]), [[0, 0, 0], [0, 0, 0], [3, 0, 0], [0, 1, 2]])
})

test('the Grand Prix kart track covers two squares and races four abreast', () => {
  const state = parkFixture()
  assert.equal(applyCommand(state, { t: 'coaster', style: 'kartWide', x: 20, y: 20, dir: 0, length: 3 }).ok, true)
  const ride = Object.values(state.entities).find(e => e.style === 'kartWide')
  const map = state.map
  for (let k = 0; k < 3; k++) for (const y of [20, 21]) assert.equal(map.obj[(20 + k) + y * map.w], ride.id)
  assert.ok(validatePiece(state, ride, { c: 3, s: 0 }).error)
  assert.equal(kartCount(3, 'kartWide'), 24)
  assert.deepEqual([0, 1, 2, 3].map(i => Math.round(kartLane(i, 4) * 100) / 100), [-1.65, -0.55, 0.55, 1.65])
  for (const c of [1, 2, -1, -2]) assert.equal(validatePiece(state, ride, { c, s: 0 }).ok, true, `turn ${c}`)
})
