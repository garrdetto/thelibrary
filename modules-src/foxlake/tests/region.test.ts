import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error plain ES module script
import { LAKE_LEVEL as SCRIPT_LAKE_LEVEL, MONTELLO_AT as SCRIPT_MONTELLO_AT, TOWN_OFFSET as SCRIPT_OFFSET } from '../../../scripts/montello-places.mjs'
import { LAKE_LEVEL } from '../lake/Rebase'
import { MONTELLO_AT, TOWN_OFFSET, headingToTownYaw, sceneToTown, townToScene, townYawToHeading } from '../region'
import { land, site } from './montello-land'

test('the town frame is Montello\'s map with z turned, and the script that writes the place tables agrees', () => {
  assert.deepEqual(SCRIPT_OFFSET, TOWN_OFFSET)
  assert.deepEqual(SCRIPT_MONTELLO_AT, MONTELLO_AT)
  assert.equal(SCRIPT_LAKE_LEVEL, LAKE_LEVEL)
  assert.equal(land.offset.x, TOWN_OFFSET.x)
  assert.equal(land.offset.z, TOWN_OFFSET.z)
  assert.equal(TOWN_OFFSET.y, 0)
  const p = townToScene(120, 3, -250)
  assert.deepEqual([p.x, p.y, p.z], [land.toSceneX(120), 3, land.toSceneZ(250)], 'town (x, y, z) is map (x, y, -z)')
  const back = sceneToTown(p.x, p.y, p.z)
  assert.deepEqual([back.x, back.y, back.z], [120, 3, -250])
})

test('headings and town yaws are each other\'s inverse', () => {
  for (const h of [-3, -1, 0, 0.7, 2.5]) assert.ok(Math.abs(Math.sin(headingToTownYaw(townYawToHeading(h)) - h)) < 1e-9)
})

test('Montello\'s land lies well clear of Rack & Reel\'s sealed lake square at the origin', () => {
  let nearest = Infinity
  for (let z = land.z0; z < land.z0 + land.size; z += 16) {
    for (let x = land.x0; x < land.x0 + land.size; x += 16) {
      if (!land.seen(x, z)) continue
      nearest = Math.min(nearest, Math.max(Math.abs(land.toSceneX(x)), Math.abs(land.toSceneZ(z))) - 512)
    }
  }
  assert.ok(nearest > 600, `the land Montello draws is ${nearest.toFixed(0)} m from the square`)
})

test('the map is three miles round the city and the heights are Lake Montello\'s: its surface is y = 0', () => {
  assert.ok(land.doc.limits.pad > 4800 && land.doc.limits.pad < 4850, 'the playable ring is three miles wide')
  const water = land.waterAt(land.toMapX(site.dock.end.x), land.toMapZ(site.dock.end.z))
  assert.ok(water !== null && Math.abs(water - 0.01) < 1e-9, `Lake Montello's surface is ${water}`)
  assert.ok(land.groundAt(0, 0) < 12 && land.groundAt(0, 0) > -12, 'downtown is a few metres above the lake')
  assert.ok(Math.abs(land.doc.frame.base - 238.7) < 0.01)
})
