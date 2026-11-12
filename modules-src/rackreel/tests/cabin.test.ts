import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CABIN, Cabin, FOX_OUTFITTERS } from '../world/Cabin'
import { Terrain } from '../world/Terrain'

test('the standalone cabin keeps its original walls, furniture and stations', () => {
  assert.equal(CABIN.model, 'cabin')
  assert.equal(CABIN.garage, null)
  assert.deepEqual(CABIN.walls.slice(0, 5), [
    { ax: -4.35, az: -3, bx: 4.35, bz: -3 },
    { ax: -4, az: -3.35, bx: -4, bz: 3.35 },
    { ax: 4, az: -3.35, bx: 4, bz: 3.35 },
    { ax: -4.35, az: 3, bx: -0.55, bz: 3 },
    { ax: 0.55, az: 3, bx: 4.35, bz: 3 },
  ])
  assert.deepEqual(CABIN.walls.slice(5), [
    { ax: -4.05, az: 3.2, bx: -4.05, bz: 5.05 },
    { ax: 4.05, az: 3.2, bx: 4.05, bz: 5.05 },
    { ax: -4.05, az: 5.05, bx: -0.85, bz: 5.05 },
    { ax: 0.85, az: 5.05, bx: 4.05, bz: 5.05 },
  ])
  assert.deepEqual(CABIN.furniture.map((b) => [b.x, b.z]), [[-3.25, -0.8], [2.6, -1.95], [0.4, 0.3], [-2.6, -2.58], [3.6, 1.2], [-4.55, -0.8], [4.8, -1.9], [5, 0.6]])
  assert.deepEqual([CABIN.spots.wardrobe.x, CABIN.spots.wardrobe.z, CABIN.spots.rack.x, CABIN.spots.rack.z, CABIN.spots.desk.x, CABIN.spots.desk.z], [-2.6, -1.85, 1.1, -2.25, 2.85, 1.2])
  assert.equal(CABIN.clearRadius, 6.4)
})

test('Fox Outfitters is bigger, names its counter and parks the side-by-side in the garage on its concrete', () => {
  assert.equal(FOX_OUTFITTERS.model, 'outfitters')
  assert.ok(FOX_OUTFITTERS.halfW > CABIN.halfW && FOX_OUTFITTERS.halfD > CABIN.halfD)
  assert.equal(FOX_OUTFITTERS.sign, 'FOX OUTFITTERS')
  assert.match(FOX_OUTFITTERS.spots.desk.label, /Fox Outfitters/)
  const terrain = new Terrain()
  const cabin = new Cabin(terrain, new Vector3(150, 0, -120), 0.4, FOX_OUTFITTERS)
  const spot = cabin.garageSpot()
  assert.ok(spot)
  const floor = cabin.garageFloorAt(spot.position.x, spot.position.z)
  assert.ok(floor !== null && Math.abs(floor - (cabin.root.y + 0.2)) < 1e-9)
  assert.equal(cabin.garageFloorAt(cabin.root.x - 30, cabin.root.z), null)
  const local = cabin.toLocal(spot.position)
  const g = FOX_OUTFITTERS.garage!
  assert.ok(local.x > g.x0 && local.x < g.x1 && local.z > g.z0 && local.z < g.z1)
  assert.equal(new Cabin(terrain, new Vector3(150, 0, -120), 0.4).garageSpot(), null)
})
