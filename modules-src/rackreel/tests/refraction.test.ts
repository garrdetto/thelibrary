import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FEET, INCH, WATER_INDEX, aimLow, apparentDepth, apparentPoint, surfaceCrossing } from '../systems/Refraction'

test('the sight line obeys Snell\'s law at the surface', () => {
  for (const [h, d, D] of [[2.4, 0.3, 3], [2.4, 1.2, 8], [1.8, 0.6, 12], [3, 2, 5]]) {
    const x = surfaceCrossing(h, d, D)
    const sinAir = x / Math.hypot(x, h)
    const sinWater = (D - x) / Math.hypot(D - x, d)
    assert.ok(Math.abs(sinAir - WATER_INDEX * sinWater) < 1e-9, `snell at ${h}/${d}/${D}`)
    assert.ok(x > 0 && x < D)
  }
})

test('fish always look shallower than they are, and straight down by 1/1.333', () => {
  for (const d of [0.2, 0.6, 1.5]) {
    for (const D of [0, 1, 4, 12]) {
      const a = apparentDepth(2.4, d, D)
      assert.ok(a < d && a > 0, `${d} m at ${D} m looks ${a}`)
    }
  }
  assert.ok(Math.abs(apparentDepth(2.4, 1.333, 0) - 1) < 1e-9)
})

test('the aim-low offset grows with distance and with depth', () => {
  assert.ok(aimLow(2.4, 0.3, 6) > aimLow(2.4, 0.3, 3))
  assert.ok(aimLow(2.4, 0.6, 6) > aimLow(2.4, 0.3, 6))
})

test('matches the 10-4 rule with an eye 2.4 m above the water', () => {
  const inches = (D: number, d: number) => aimLow(2.4, d * FEET, D * FEET) / INCH
  assert.ok(Math.abs(inches(10, 1) - 4.9) < 0.1, `10 ft / 1 ft: ${inches(10, 1)}`)
  assert.ok(Math.abs(inches(20, 1) - 7.2) < 0.1, `20 ft / 1 ft: ${inches(20, 1)}`)
  assert.ok(Math.abs(inches(20, 2) - 14.1) < 0.1, `20 ft / 2 ft: ${inches(20, 2)}`)
})

test('points above the water are drawn where they are', () => {
  assert.deepEqual(apparentPoint(0, 2.4, 0, 3, 0.5, 1), [3, 0.5, 1])
  const p = apparentPoint(0, 2.4, 0, 3, -0.5, 0)
  assert.equal(p[0], 3)
  assert.ok(p[1] > -0.5 && p[1] < 0)
})
