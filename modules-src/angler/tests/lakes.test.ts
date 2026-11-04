import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAKES, bottomAt, depthFeetAt, heightAt, lakeIds, landingOf, spotsOf, waterTempF } from '../shared/Lakes'
import { weatherAt } from '../shared/Weather'
import { moonPhase, sunPosition } from '../shared/Astro'
import { BOATS } from '../shared/Boats'
import { DEFAULT_LOOK, normalizeLook } from '../shared/Wardrobe'

test('every lake has a landing in navigable water and spots in fishable water', () => {
  for (const id of lakeIds) {
    const lake = LAKES[id]
    const landing = landingOf(lake)
    assert.ok(depthFeetAt(lake, landing.x, landing.z) >= 5, `${id} landing too shallow`)
    assert.ok(heightAt(lake, landing.shoreX * 1.02, landing.shoreZ * 1.02) > -0.5, `${id} ramp is not on the shore`)
    for (const spot of spotsOf(lake)) assert.ok(depthFeetAt(lake, spot.x, spot.z) >= 4, `${id}/${spot.id} too shallow`)
  }
})

test('bathymetry is deterministic and within the lake limits', () => {
  for (const id of lakeIds) {
    const lake = LAKES[id]
    let deepest = 0
    for (let i = 0; i < 4000; i++) {
      const x = Math.sin(i * 12.9898) * lake.radius * 1.3, z = Math.cos(i * 78.233) * lake.radius
      const d = depthFeetAt(lake, x, z)
      assert.equal(d, depthFeetAt(lake, x, z))
      assert.ok(d <= lake.maxDepth + 1e-6)
      deepest = Math.max(deepest, d)
      bottomAt(lake, x, z)
    }
    assert.ok(deepest > lake.maxDepth * 0.5, `${id} is never deep (${deepest.toFixed(1)} ft)`)
  }
})

test('weather and sky follow the clock deterministically', () => {
  const date = new Date('2026-11-04T21:00:00Z')
  assert.deepEqual(weatherAt(LAKES['silver-birch'], date), weatherAt(LAKES['silver-birch'], date))
  const noon = sunPosition(new Date('2026-06-21T17:45:00Z'))
  assert.ok(noon.altitude > 60 && noon.altitude < 72, `summer noon sun at ${noon.altitude}`)
  const night = sunPosition(new Date('2026-06-21T06:00:00Z'))
  assert.ok(night.altitude < -10)
  const full = moonPhase(new Date('2026-10-26T04:12:00Z'))
  assert.ok(Math.abs(full - 0.5) < 0.05, `full moon phase ${full}`)
  assert.ok(waterTempF(LAKES['silver-birch'], new Date('2026-07-20T18:00:00Z'), 40) < waterTempF(LAKES['silver-birch'], new Date('2026-07-20T18:00:00Z'), 2))
})

test('boats and looks validate input', () => {
  for (const spec of Object.values(BOATS)) assert.equal(spec.seats.length, 4)
  assert.deepEqual(normalizeLook({ top: 'tuxedo', skin: 99 }), { ...DEFAULT_LOOK })
  assert.equal(normalizeLook({ top: 'tank', bottom: 'jeans' }).top, 'tank')
})
