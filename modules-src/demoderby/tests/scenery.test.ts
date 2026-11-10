/** The Thrill Park around the derby: the saved park builds headlessly through Thrill Park's own renderer, nothing pokes up through the arena's lot, the rides around it animate, and trees stay within reach. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { config } from '../config'
import data from '../data/park.json'
import { assembleParkScenery } from '../models/ParkScenery'
import { buildParkScenery, parkToArena, type ParkSceneryData } from '../models/parkSceneryBuild'

const park = data as ParkSceneryData

test('the derby lot sits on the arena origin, level, with the arena inside it', () => {
  const lot = park.lot
  const m = parkToArena(lot)
  const [cx, cy] = lot.centre
  const x = m[0] * cx + m[4] * cy + m[8] * lot.height + m[12]
  const y = m[1] * cx + m[5] * cy + m[9] * lot.height + m[13]
  const z = m[2] * cx + m[6] * cy + m[10] * lot.height + m[14]
  assert.ok(Math.abs(x - (lot.module.x0 + lot.module.x1) / 2) < 1e-6)
  assert.ok(Math.abs(y + 0.05) < 1e-6, 'the lot floor sits just under the arena floor')
  assert.ok(Math.abs(z - (lot.module.z0 + lot.module.z1) / 2) < 1e-6)
  assert.ok(lot.module.x0 <= -config.arena.length / 2 - 3 && lot.module.x1 >= config.arena.length / 2 + 3, 'barriers and light towers fit along the lot')
  assert.ok(lot.module.z0 <= -config.arena.width / 2 - 3 && lot.module.z1 >= config.arena.width / 2 + 4.5 + config.arena.grandstandRows * 0.9, 'the grandstand fits across the lot')
})

test('the saved park builds around the arena without anything inside the lot', () => {
  const payload = buildParkScenery(park, 240)
  assert.equal(payload.name, park.name)
  assert.ok(payload.cells.length > 4, 'terrain, paths and track cells')
  assert.ok(payload.rides.length > 5, 'flat rides to animate')
  assert.ok(payload.instanced.some((item) => item.count > 50), 'trees')
  const { x0, x1, z0, z1 } = park.lot.module
  for (const cell of payload.cells) {
    const p = cell.geometry.position
    for (let i = 0; i < p.length; i += 3) {
      const inside = p[i] > x0 + 0.5 && p[i] < x1 - 0.5 && p[i + 2] > z0 + 0.5 && p[i + 2] < z1 - 0.5
      if (inside) assert.ok(p[i + 1] < 0.05, `something stands in the lot at ${p[i].toFixed(1)}, ${p[i + 1].toFixed(2)}, ${p[i + 2].toFixed(1)}`)
    }
  }
  for (const item of payload.instanced) {
    for (let i = 0; i < item.count; i++) {
      const tx = item.matrices[i * 16 + 12]
      const tz = item.matrices[i * 16 + 14]
      assert.ok(Math.hypot(tx, tz) <= 240.5, 'trees and props stay within reach')
      assert.ok(!(tx > x0 && tx < x1 && tz > z0 && tz < z1), 'no tree in the lot')
    }
  }
  const scenery = assembleParkScenery(payload)
  const moving = scenery.root.children.filter((child) => !child.matrixAutoUpdate)
  assert.ok(moving.length > 10, 'ride parts move')
  const before = moving.map((child) => child.matrix.elements.slice())
  for (let i = 0; i < 120; i++) scenery.update(1 / 30)
  assert.ok(moving.some((child, i) => child.matrix.elements.some((value, k) => Math.abs(value - before[i][k]) > 1e-3)), 'rides animate')
  scenery.dispose()
})
