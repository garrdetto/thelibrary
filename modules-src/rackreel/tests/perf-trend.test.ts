import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GROWTH_STREAK, ResourceTrend, SETTLE_SECONDS, perfModeFromSearch } from '../core/PerfTrend'

test('the overlay is off unless the address asks for it', () => {
  assert.equal(perfModeFromSearch(''), 'off')
  assert.equal(perfModeFromSearch('?hour=20'), 'off')
  assert.equal(perfModeFromSearch('?perf=0'), 'off')
  assert.equal(perfModeFromSearch('?perf'), 'overlay')
  assert.equal(perfModeFromSearch('?perf=1'), 'overlay')
  assert.equal(perfModeFromSearch('?hour=6&perf=log'), 'log')
})

test('counts that stream in and out are not flagged, a steady climb is', () => {
  const trend = new ResourceTrend()
  const base = { textures: 100, meshes: 900, materials: 80, geometries: 400 }
  trend.sample(base, 1)
  assert.equal(trend.baseline, null, 'no baseline while the world settles')
  trend.sample(base, SETTLE_SECONDS)
  assert.deepEqual(trend.baseline, base)
  for (let i = 1; i <= GROWTH_STREAK * 2; i++) {
    trend.sample({ ...base, meshes: base.meshes + (i % 2 ? 12 : 0), textures: base.textures + i }, SETTLE_SECONDS + i * 2)
  }
  assert.deepEqual(trend.growing(), ['textures'])
  assert.equal(trend.delta({ ...base, textures: 124 }).textures, 24)
  trend.sample({ ...base, textures: 50 }, 200)
  assert.deepEqual(trend.growing(), [])
})
