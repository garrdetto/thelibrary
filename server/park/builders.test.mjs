import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCommand, createPark, validatePiece, buildTrackPath, stepTrain, makeTrain, KART_HAIRPIN_SPEED } from './index.mjs'
import { planPiece, startEnd } from '../../src/lib/park/pathBuilder.ts'

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
