import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AIRPORTS } from '../shared/Airports'
import { WATER_LEVEL, terrainHeight } from '../shared/Terrain'
import { PLACES, allPlaces, buildPlace, heightLimit, obstacleTop } from '../shared/Towns'
import { makeSim } from './helpers'

test('every place is built, the same every time, with a city skyline and an industrial district', () => {
  const places = allPlaces()
  assert.equal(places.length, PLACES.length)
  for (const place of places) assert.ok(place.buildings.length > 20, `${place.spec.id} has ${place.buildings.length} buildings`)
  assert.deepEqual(buildPlace(PLACES[0]).buildings.slice(0, 5), buildPlace(PLACES[0]).buildings.slice(0, 5))
  const city = places.find((p) => p.spec.kind === 'city')!
  assert.ok(city.buildings.some((b) => b.kind === 'tower' && b.height > 100), 'the city has towers over 100 m')
  assert.ok(places.find((p) => p.spec.kind === 'industrial')!.buildings.every((b) => b.kind === 'warehouse'))
})

test('no building stands on an airport, in water or through an approach surface', () => {
  for (const place of allPlaces()) {
    for (const b of place.buildings) {
      for (const a of AIRPORTS) assert.ok(Math.abs(b.x - a.x) > a.halfX + 100 || Math.abs(b.z - a.z) > a.halfZ + 100, `${place.spec.id} building on ${a.id}`)
      assert.ok(terrainHeight(b.x, b.z) > WATER_LEVEL, `${place.spec.id} building in water`)
      assert.ok(b.base + b.height <= heightLimit(b.x, b.z) + 1e-6, `${place.spec.id} ${b.kind} pierces an approach surface`)
    }
  }
})

test('the obstacle check finds buildings and a flight into a tower crashes', () => {
  const city = allPlaces().find((p) => p.spec.kind === 'city')!
  const tower = city.buildings.filter((b) => b.kind === 'tower').sort((a, b) => b.height - a.height)[0]
  assert.equal(obstacleTop(tower.x, tower.z), tower.base + tower.height)
  assert.equal(obstacleTop(tower.x + 500, tower.z + 500) <= tower.base + tower.height, true)
  const sim = makeSim()
  const a = sim.aircraft
  const heading = 90
  a.place(tower.x - 400, tower.base + tower.height * 0.5, tower.z, heading, 0, 0, 55)
  sim.settle()
  for (let i = 0; i < 120 * 12 && !a.crashed; i++) {
    sim.pilot.throttle = 0.8
    sim.pilot.pitch = Math.max(-1, Math.min(1, -a.vy * 0.05 - a.wz * 2))
    sim.stepPilot()
  }
  assert.equal(a.crashed, 'impact')
})
