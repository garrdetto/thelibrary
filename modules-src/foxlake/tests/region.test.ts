import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HALF, PLAY_LIMIT, STANDALONE_SHAPE, Terrain, rawHeight } from '../../rackreel/world/Terrain'
import { CONNECTOR, FOX_LAKE_SHAPE, TOWN_SQUARE, TOWN_Y, connectorPath, headingToTownYaw, sceneToTown, townToScene, townYawToHeading, zoneAt } from '../region'
import { WORLD_HALF } from '../../maplestreet/shared/WorldLayout'

const standalone = new Terrain()
const foxLake = new Terrain(FOX_LAKE_SHAPE)

test('town and scene coordinates convert both ways, and the town sits north of the lake country', () => {
  for (const [x, y, z] of [[0, 0, 0], [87, 1.2, 267], [-392, 0, -313], [571, 3, 313]]) {
    const s = townToScene(x, y, z)
    const t = sceneToTown(s.x, s.y, s.z)
    assert.ok(Math.abs(t.x - x) + Math.abs(t.y - y) + Math.abs(t.z - z) < 1e-9)
    assert.ok(s.z > HALF, 'every town point is north of the square')
  }
  assert.equal(townToScene(0, 0, WORLD_HALF).z, HALF, 'the town square meets the lake country at its north edge')
  assert.equal(zoneAt(HALF + 1), 'town')
  assert.equal(zoneAt(0), 'country')
})

test('headings and town yaws are inverse, and a town forward vector maps to the scene forward', () => {
  for (const yaw of [-2.5, -1, 0, 0.7, 2, 3]) {
    const h = townYawToHeading(yaw)
    const back = headingToTownYaw(h)
    assert.ok(Math.abs(Math.atan2(Math.sin(back - yaw), Math.cos(back - yaw))) < 1e-9)
    const town = { x: Math.sin(yaw), z: Math.cos(yaw) }
    const scene = { x: town.x, z: -town.z }
    assert.ok(Math.abs(Math.sin(h) - scene.x) < 1e-9 && Math.abs(Math.cos(h) - scene.z) < 1e-9)
  }
})

test('standalone Rack & Reel keeps its exact terrain, with the rim on every side', () => {
  for (let x = -HALF; x <= HALF; x += 61) {
    for (let z = -HALF; z <= HALF; z += 53) assert.equal(rawHeight(x, z), rawHeight(x, z, STANDALONE_SHAPE))
  }
  assert.ok(standalone.heightAt(0, HALF - 2) > 30, 'north rim stands')
  assert.equal(standalone.inBounds(0, HALF + 50), false)
})

test('Fox Lake opens the north edge down to the town ground, with no wall or step', () => {
  for (let x = -400; x <= 400; x += 50) {
    const edge = foxLake.heightAt(x, HALF - 0.5)
    assert.ok(Math.abs(edge - TOWN_Y) < 1.6, `edge at x=${x} is ${edge}`)
    assert.equal(foxLake.heightAt(x, HALF + 20), TOWN_Y)
  }
  assert.ok(foxLake.heightAt(0, -HALF + 2) > 30, 'the south rim still stands')
  assert.ok(foxLake.heightAt(10, 30) < -6, 'the lake is still there')
})

test('the player can walk from the lake country into town, but not off the map', () => {
  assert.ok(foxLake.inBounds(0, HALF - 10))
  assert.ok(foxLake.inBounds(0, HALF + 1))
  assert.ok(foxLake.inBounds(-269, TOWN_SQUARE.z0 + 300), 'East Ave')
  assert.equal(foxLake.inBounds(HALF + 100, 0), false, 'east of the square is off the map')
  assert.equal(foxLake.inBounds(0, TOWN_SQUARE.z1 + 10), false, 'north of town is off the map')
  const p = { x: PLAY_LIMIT + 5, z: 0 }
  foxLake.confine(p, PLAY_LIMIT - 1, 0)
  assert.ok(foxLake.inBounds(p.x, p.z))
})

test('the county road runs from the interstate to East Ave without gaps', () => {
  const path = connectorPath(4)
  assert.ok(Math.hypot(path[0].x - CONNECTOR.start.x, path[0].z - CONNECTOR.start.z) < 1e-6)
  const end = path[path.length - 1]
  assert.ok(Math.abs(end.x - townToScene(87, 0, 0).x) < 1e-6, 'it ends on East Ave')
  assert.ok(Math.abs(end.z - townToScene(0, 0, 267).z) < 4.1)
  for (let i = 1; i < path.length; i++) assert.ok(Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z) < 9, `gap at ${i}`)
})
