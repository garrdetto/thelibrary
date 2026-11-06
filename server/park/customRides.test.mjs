import assert from 'node:assert/strict'
import test from 'node:test'
import { createPark, applyCommand, serializePark, deserializePark, stepPark, registerCustomRides, customRideDef, sanitizeMotion, sanitizePlatform, buildableRide, FLAT_RIDES, CUSTOM_RIDE_LIMITS } from './index.mjs'

const ride = (overrides = {}) => ({
  id: 'cr_0123456789', name: 'Comet Spinner', category: 'thrill', size: [4, 4], cost: 4200, upkeep: 80, capacity: 20, rideTime: 30, loadTime: 8, price: 2,
  stats: { e: 4.2, i: 4.8, n: 3.1 }, height: 12, description: 'Eight tubs whirl around a towering hub.',
  motion: { type: 'spin', speed: 1.2, amount: 0.5, axis: 'x', split: 1.5, pivot: [0, 0, 1.5] }, meshVersion: 2, thumb: true, active: true, ...overrides,
})

function fixture() {
  const state = createPark('meadowbrook')
  state.parks[0].named = true
  state.parks[0].cash = 1_000_000
  state.map.corners.fill(6)
  state.map.owner.fill(0)
  state.map.water.fill(-1)
  state.map.obj.fill(0)
  state.map.path.fill(0)
  return state
}

test('custom ride records are validated and clamped', () => {
  assert.equal(customRideDef({ ...ride(), id: 'carousel' }), null)
  assert.equal(customRideDef({ ...ride(), name: 'x' }), null)
  const def = customRideDef(ride({ size: [40, 0], cost: 5, stats: { e: 99, i: -1, n: 'x' }, motion: { type: 'teleport', speed: 9 } }))
  assert.deepEqual(def.size, [CUSTOM_RIDE_LIMITS.sizeMax, CUSTOM_RIDE_LIMITS.sizeMin])
  assert.equal(def.cost, CUSTOM_RIDE_LIMITS.costMin)
  assert.equal(def.stats.e, CUSTOM_RIDE_LIMITS.statMax)
  assert.equal(def.stats.i, 0)
  assert.equal(def.custom.motion.type, 'none')
  assert.equal(def.custom.motion.speed, CUSTOM_RIDE_LIMITS.speedMax)
  assert.deepEqual(sanitizeMotion(null).pivot, [0, 0, 0])
})

test('registered custom rides build, run, save and reload like built-ins', () => {
  assert.deepEqual(registerCustomRides([ride(), { id: 'nope' }]), ['cr_0123456789'])
  assert.equal(FLAT_RIDES.cr_0123456789.name, 'Comet Spinner')
  const state = fixture()
  const made = applyCommand(state, { t: 'flat', ride: 'cr_0123456789', x: 40, y: 40, rot: 1 })
  assert.equal(made.ok, true)
  assert.equal(made.cost, 4200)
  const built = state.entities[made.id]
  assert.equal(built.stats.e, 4.2)
  for (let i = 0; i < 200; i++) stepPark(state)
  const reloaded = deserializePark(JSON.parse(JSON.stringify(serializePark(state))))
  assert.equal(reloaded.entities[made.id].ride, 'cr_0123456789')
  assert.equal(reloaded.entities[made.id].rot, 1)
})

test('built-in rides cannot be overwritten by a custom record', () => {
  const before = FLAT_RIDES.carousel.name
  registerCustomRides([{ ...ride(), id: 'carousel' }])
  assert.equal(FLAT_RIDES.carousel.name, before)
})

test('retired rides stay registered but cannot be built', () => {
  registerCustomRides([ride({ id: 'cr_aaaaaaaaaa', name: 'Old Twirler', active: true })])
  const state = fixture()
  const made = applyCommand(state, { t: 'flat', ride: 'cr_aaaaaaaaaa', x: 20, y: 20, rot: 0 })
  assert.equal(made.ok, true)
  registerCustomRides([ride({ id: 'cr_aaaaaaaaaa', name: 'Old Twirler', active: false })])
  assert.equal(buildableRide(FLAT_RIDES.cr_aaaaaaaaaa), false)
  assert.equal(applyCommand(state, { t: 'flat', ride: 'cr_aaaaaaaaaa', x: 30, y: 30, rot: 0 }).ok, false)
  const reloaded = deserializePark(JSON.parse(JSON.stringify(serializePark(state))))
  assert.equal(reloaded.entities[made.id].ride, 'cr_aaaaaaaaaa')
})

test('updating a ride keeps the same definition object', () => {
  registerCustomRides([ride({ id: 'cr_bbbbbbbbbb', name: 'First Name' })])
  const def = FLAT_RIDES.cr_bbbbbbbbbb
  registerCustomRides([ride({ id: 'cr_bbbbbbbbbb', name: 'Second Name', meshVersion: 3 })])
  assert.equal(FLAT_RIDES.cr_bbbbbbbbbb, def)
  assert.equal(def.name, 'Second Name')
  assert.equal(def.custom.meshVersion, 3)
})

test('extra moving pieces are validated, clamped and only ride on earlier pieces', () => {
  const motion = sanitizeMotion({
    type: 'spin', pivot: [0, 0, 2], split: 1,
    pieces: [
      { type: 'flip', from: 4, to: 2, inner: 9, outer: 3, count: 99, on: 3, hang: 'sideways', axis: 'diagonal', stagger: 4, alternate: 'yes' },
      { type: 'swing', on: 0, speed: 50, amount: -1 },
      { type: 'teleport', on: 5 },
    ],
  })
  assert.equal(motion.pieces.length, 3)
  const [flip, swing, unknown] = motion.pieces
  assert.equal(flip.on, -1)
  assert.equal(flip.to, flip.from)
  assert.equal(flip.outer, flip.inner)
  assert.equal(flip.count, CUSTOM_RIDE_LIMITS.pieceCountMax)
  assert.equal(flip.hang, 'top')
  assert.equal(flip.axis, 'radial')
  assert.equal(flip.stagger, 1)
  assert.equal(flip.alternate, false)
  assert.equal(swing.on, 0)
  assert.equal(swing.speed, CUSTOM_RIDE_LIMITS.speedMax)
  assert.equal(swing.amount, 0)
  assert.equal(unknown.type, 'spin')
  assert.equal(unknown.on, 1)
  assert.equal(sanitizeMotion({ pieces: Array.from({ length: 20 }, () => ({})) }).pieces.length, CUSTOM_RIDE_LIMITS.piecesMax)
  assert.deepEqual(sanitizeMotion({ type: 'spin' }).pieces, [])
  const def = customRideDef(ride({ motion: { ...ride().motion, pieces: [{ type: 'swing' }] } }))
  assert.equal(def.custom.motion.pieces[0].type, 'swing')
})

test('the generated base and rise are validated and reach the park definition', () => {
  const off = sanitizePlatform(null)
  assert.equal(off.enabled, false)
  assert.equal(off.column, 'none')
  const p = sanitizePlatform({ enabled: true, shape: 'blob', fill: 4, height: 99, tiers: 9, top: 'red', side: '#ABCDEF', steps: 'up', column: 'telescoping', columnRadius: 0, columnSections: 12, fenceHeight: 7 })
  assert.equal(p.shape, 'round')
  assert.equal(p.fill, 1)
  assert.equal(p.height, CUSTOM_RIDE_LIMITS.platformHeightMax)
  assert.equal(p.tiers, CUSTOM_RIDE_LIMITS.platformTiersMax)
  assert.equal(p.top, '#b8b2a6')
  assert.equal(p.side, '#abcdef')
  assert.equal(p.steps, 'front')
  assert.equal(p.columnRadius, 0.1)
  assert.equal(p.columnSections, CUSTOM_RIDE_LIMITS.columnSectionsMax)
  assert.equal(p.fenceHeight, 2)
  assert.equal(sanitizeMotion({ type: 'drop', rise: 500 }).rise, CUSTOM_RIDE_LIMITS.riseMax)
  assert.equal(sanitizeMotion({ type: 'spin' }).rise, 0)
  const def = customRideDef(ride({ platform: { enabled: true, column: 'fixed' }, motion: { ...ride().motion, rise: 6 } }))
  assert.equal(def.custom.platform.enabled, true)
  assert.equal(def.custom.platform.column, 'fixed')
  assert.equal(def.custom.motion.rise, 6)
  assert.equal(customRideDef(ride()).custom.platform.enabled, false)
})
