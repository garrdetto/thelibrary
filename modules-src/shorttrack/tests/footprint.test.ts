import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STOCK_CAR, STOCK_LENGTH, carCountsForRecords, carFootprint, carSize } from '../shared/CustomCars'
import { TRACKS } from '../next/sim/config'
import { createCar } from '../next/sim/car'
import { rng } from '../next/sim/math'
import { collidePair, place } from '../next/sim/physics'
import { createWorld } from '../next/sim/race'
import { runRace } from './physicsRun'

const axles = STOCK_CAR.axles

test('custom car footprint follows the body and its race size', () => {
  const stock = carFootprint({ axles }, { min: [STOCK_CAR.rear, 0, -STOCK_CAR.width / 2], max: [STOCK_CAR.front, 1, STOCK_CAR.width / 2] })
  assert.ok(Math.abs(stock.length - 1) < 0.01 && Math.abs(stock.width - 1) < 0.05)
  const half = carFootprint({ axles, size: 0.5 }, { min: [STOCK_CAR.rear, 0, -STOCK_CAR.width / 2], max: [STOCK_CAR.front, 1, STOCK_CAR.width / 2] })
  assert.ok(Math.abs(half.length - 0.5) < 0.01)
  assert.equal(carSize({}), 1)
  assert.equal(carSize({ size: 0.01 }), 0.3)
  assert.equal(carCountsForRecords({}), true)
  assert.equal(carCountsForRecords({ records: false }), false)
  assert.ok(STOCK_LENGTH > 5)
})

test('small footprints run nose to tail 2.2 m apart without touching; full-size cars collide at 5 m', () => {
  const gap = (fl: number, fw: number, d: number) => {
    const w = createWorld(TRACKS.prison, rng(1), () => 0, 'next')
    const a = createCar('a', { local: true, fl, fw }), b = createCar('b', { local: true, fl, fw })
    place(w, a, 40, -2)
    place(w, b, 40 + d, -2)
    const before = Math.hypot(a.x - b.x, a.z - b.z)
    collidePair(w, a, b)
    return Math.hypot(a.x - b.x, a.z - b.z) - before
  }
  assert.equal(gap(0.35, 0.5, 2.2), 0)
  assert.ok(gap(1, 1, 5) > 0.2)
  assert.ok(gap(1, 1, 2.2 + 3) > 0)
})

test('a field of half-size bodies finishes a race with no NaN or stuck car', () => {
  const r = runRace('prison', 'hard', 5, 'next', 20261115, 0, { length: 0.35, width: 0.55 })
  assert.equal(r.done, true)
  assert.equal(r.nan, 0)
  assert.deepEqual(r.stuck, [])
})
