import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TelloTerrain } from '../../tello/region'
import { lakePlaces, montelloPlaces, PLACE_AREAS } from '../dev/Places'
import { land, site } from './montello-land'

const terrain = new TelloTerrain(land)
const places = montelloPlaces(land)
const lake = lakePlaces(site)

/** What the panel's safe-spot search finds: dry ground inside the world within 16 m. */
function dryNear(x: number, z: number): boolean {
  const ok = (px: number, pz: number) => terrain.inBounds(px, pz, 3) && terrain.depthAt(px, pz) < 0.05
  if (ok(x, z)) return true
  for (let r = 2; r <= 16; r += 2) for (let a = 0; a < 12; a++) if (ok(x + Math.cos((a / 12) * Math.PI * 2) * r, z + Math.sin((a / 12) * Math.PI * 2) * r)) return true
  return false
}

test('Montello has its own teleports, each with safe ground to land on', () => {
  assert.ok(places.length >= 24, `${places.length} Montello places`)
  const ids = new Set([...places, ...lake].map((p) => p.id))
  assert.equal(ids.size, places.length + lake.length, 'ids are unique across the whole list')
  for (const id of ['mt-city-hall', 'mt-kwik-trip', 'mt-bp', 'mt-mobil', 'mt-freitags', 'mt-foxtails', 'mt-lakeside', 'mt-yahooz', 'mt-weezies', 'mt-granite-park', 'mt-water-tower', 'mt-lots']) {
    assert.ok(places.some((p) => p.id === id), `the list has ${id}`)
  }
  for (const p of places) {
    assert.equal(p.area, 'Montello')
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z))
    assert.ok(land.holdsScene(p.x, p.z), `${p.label} is on Montello's map`)
    assert.ok(dryNear(p.x, p.z), `${p.label} has dry ground to stand on`)
  }
})

test('the lake places are on Lake Montello: the dock, the boat in the water, the UTV and the stands on dry ground', () => {
  assert.ok(lake.length >= 5)
  for (const p of lake) {
    assert.equal(p.area, 'Lake Montello')
    assert.ok(terrain.inBounds(p.x, p.z, 3), `${p.label} is inside the world`)
  }
  for (const id of ['dock', 'utv']) assert.ok(dryNear(lake.find((p) => p.id === id)!.x, lake.find((p) => p.id === id)!.z), id)
  const boat = lake.find((p) => p.id === 'boat')!
  assert.ok(terrain.depthAt(boat.x, boat.z) > 0.8, 'the boat is afloat')
  for (const area of PLACE_AREAS) assert.ok([...places, ...lake].some((p) => p.area === area), `${area} has places`)
})
