import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HARROW_FIELD, pavementAt, runwayFrame } from '../shared/Airports'
import { shadeMap } from '../render/MapShade'
import { TERRAIN, createGroundSample, terrainHeight } from '../shared/Terrain'

test('the airfield is flat at its elevation across the runway and apron', () => {
  const runway = HARROW_FIELD.runways[0]
  const frame = runwayFrame(runway)
  for (let a = -20; a <= runway.length + 20; a += 25) {
    for (const c of [-20, 0, 20]) {
      const x = frame.x0 + frame.dx * a - frame.dz * c
      const z = frame.z0 + frame.dz * a + frame.dx * c
      assert.equal(terrainHeight(x, z), HARROW_FIELD.elevation)
    }
  }
  for (const apron of HARROW_FIELD.aprons) assert.equal(terrainHeight((apron.x0 + apron.x1) / 2, (apron.z0 + apron.z1) / 2), HARROW_FIELD.elevation)
})

test('surfaces are found where they are laid out', () => {
  assert.equal(pavementAt(0, 0), 'runway')
  assert.equal(pavementAt(300, -95), 'taxiway')
  assert.equal(pavementAt(-150, -150), 'apron')
  assert.equal(pavementAt(0, 60), null)
  const sample = TERRAIN.sample(0, 400, createGroundSample())
  assert.ok(sample.surface === 'grass' || sample.surface === 'water')
})

test('terrain is the same function everywhere and stays in range', () => {
  for (let i = 0; i < 400; i++) {
    const x = ((i * 7919) % 180000) - 90000
    const z = ((i * 104729) % 180000) - 90000
    const h = terrainHeight(x, z)
    assert.equal(h, terrainHeight(x, z))
    assert.ok(h > -200 && h < 2200, `height ${h} at ${x},${z}`)
  }
})

test('the map shading covers the region with opaque land and water colours', () => {
  const size = 48
  const pixels = shadeMap(size)
  assert.equal(pixels.length, size * size * 4)
  let water = 0
  for (let i = 0; i < size * size; i++) {
    assert.equal(pixels[i * 4 + 3], 255)
    if (pixels[i * 4 + 2] > pixels[i * 4 + 1]) water++
  }
  assert.ok(water > 0 && water < size * size * 0.5, `water cells ${water}`)
})
