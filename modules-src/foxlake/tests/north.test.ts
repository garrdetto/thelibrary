import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { test } from 'node:test'
import { isGzip, parseGrids, type MapDoc } from '../../tello/data/MapData'
import { TelloLand } from '../../tello/region'
import { FoxLakeTerrain, LINK_NAME, LINK_WALK, MontelloLink } from '../montello/Link'
import { MAIN_WEST_X } from '../../maplestreet/shared/WorldLayout'
import { LINK_ROAD, MONTELLO_AT, TOWN_OFFSET, TOWN_SQUARE, TOWN_Y, linkRoadPath, outsideHeight, townToScene } from '../region'

const dir = 'public/modules/tello/'
const doc = JSON.parse(readFileSync(`${dir}montello.json`, 'utf8')) as MapDoc
const packed = new Uint8Array(readFileSync(`${dir}montello.bin`))
const land = new TelloLand(doc, parseGrids(isGzip(packed) ? new Uint8Array(gunzipSync(packed)) : packed), MONTELLO_AT)
const link = new MontelloLink(land)
const terrain = new FoxLakeTerrain(link)

test('Highway 23 meets the real State Highway 23 where the baked map ends it', () => {
  let joined = false
  for (const road of doc.roads) {
    if (road.n !== LINK_NAME) continue
    const n = road.p.length
    const x = land.toSceneX(road.p[n - 2])
    const z = land.toSceneZ(road.p[n - 1])
    if (Math.abs(x - LINK_ROAD.join.x) > 0.2 || Math.abs(z - LINK_ROAD.join.z) > 0.2) continue
    joined = true
    const dx = road.p[n - 2] - road.p[n - 4]
    const dz = road.p[n - 1] - road.p[n - 3]
    const len = Math.hypot(dx, dz)
    assert.ok(Math.abs(dx / len - LINK_ROAD.joinDir.x) < 0.01 && Math.abs(dz / len - LINK_ROAD.joinDir.z) < 0.01, 'join direction')
  }
  assert.ok(joined, 'the baked highway ends at the join point')
  const start = townToScene(MAIN_WEST_X, 0, 0)
  assert.deepEqual([LINK_ROAD.start.x, LINK_ROAD.start.z], [start.x, start.z], 'starts at Main Street and Hollow Bend')
  assert.ok(link.inward.length > 3, 'the corridor follows the baked highway into Montello')
  const into = link.inward[link.inward.length - 1]
  assert.ok(land.playable(land.toMapX(into.x), land.toMapZ(into.z)), 'and on inside the city limits')
})

test('Montello sits a whole map width west of the origin, south-west of Fox Plains', () => {
  assert.equal(land.offset.x + land.x0 + land.size / 2, -land.size)
  assert.equal(land.offset.z + land.z0 + land.size / 2, 0)
  assert.ok(land.toSceneX(land.x0 + land.size) < TOWN_SQUARE.x0 - 600, 'a stretch of woods between the town and Montello')
  assert.ok(land.toSceneZ(0) < (TOWN_SQUARE.z0 + TOWN_SQUARE.z1) / 2, 'downtown Montello lies south of Fox Plains')
  // Tello's town frame is Fox Plains' moved, never turned: the physics shift is a translation.
  const a = townToScene(land.offset.x - TOWN_OFFSET.x + 10, 0, TOWN_OFFSET.z - land.offset.z - 20)
  assert.ok(Math.abs(a.x - land.toSceneX(10)) < 1e-9 && Math.abs(a.z - land.toSceneZ(20)) < 1e-9)
})

test('the road climbs steadily from the town to Montello and you can walk all of it', () => {
  let prev = link.road[0]
  let steepest = 0
  for (const p of link.road) {
    assert.ok(terrain.inBounds(p.x, p.z, 1), `walkable at ${p.x.toFixed(0)}, ${p.z.toFixed(0)}`)
    if (p !== prev) steepest = Math.max(steepest, Math.abs(terrain.heightAt(p.x, p.z) - terrain.heightAt(prev.x, prev.z)) / Math.max(0.5, p.s - prev.s))
    prev = p
  }
  assert.ok(steepest < 0.09, `steepest grade ${(steepest * 100).toFixed(1)} %`)
  assert.equal(terrain.heightAt(link.road[0].x, link.road[0].z), TOWN_Y)
  const end = link.road[link.road.length - 1]
  assert.ok(Math.abs(terrain.heightAt(end.x, end.z) - link.joinY) < 0.5, 'arrives at Montello\'s level')
  for (const p of link.inward) assert.ok(terrain.inBounds(p.x, p.z, 1), `on into Montello at ${p.x.toFixed(0)}, ${p.z.toFixed(0)}`)
  assert.ok(terrain.inBounds(land.toSceneX(0), land.toSceneZ(0), 1), 'downtown Montello')
})

test('no step in the ground where the corridor meets Fox Plains and Montello', () => {
  for (let z = TOWN_SQUARE.z0 + 20; z < TOWN_SQUARE.z1 - 20; z += 37) {
    const a = terrain.heightAt(TOWN_SQUARE.x0 + 0.5, z)
    const b = terrain.heightAt(TOWN_SQUARE.x0 - 0.5, z)
    assert.ok(Math.abs(a - b) < 0.4, `z ${z.toFixed(0)}: ${a.toFixed(2)} / ${b.toFixed(2)}`)
    assert.equal(a, outsideHeight(TOWN_SQUARE.x0 + 0.5, z))
  }
  const edge = land.toSceneX(land.x0 + land.size)
  for (let z = link.box.z0 + 20; z < link.box.z1 - 20; z += 41) {
    const a = terrain.heightAt(edge - 0.3, z)
    const b = terrain.heightAt(edge + 0.3, z)
    assert.ok(Math.abs(a - b) < 0.6, `z ${z.toFixed(0)}: ${a.toFixed(2)} / ${b.toFixed(2)}`)
  }
})

test('the woods off the road and the land outside Montello\'s city limits are out of bounds', () => {
  const k = Math.floor(link.road.length * 0.7)
  const mid = link.road[k]
  const next = link.road[k + 1]
  const len = Math.hypot(next.x - mid.x, next.z - mid.z)
  const side = { x: (next.z - mid.z) / len, z: -(next.x - mid.x) / len }
  assert.ok(terrain.inBounds(mid.x + side.x * (LINK_WALK - 3), mid.z + side.z * (LINK_WALK - 3)), 'the verge beside the road')
  assert.ok(!terrain.inBounds(mid.x + side.x * (LINK_WALK + 25), mid.z + side.z * (LINK_WALK + 25)), 'deep in the woods beside the road')
  assert.ok(!terrain.inBounds(TOWN_SQUARE.x0 - 120, TOWN_SQUARE.z1 - 80), 'west of town away from the road')
  let outside = 0
  for (let i = 0; i < 400; i++) {
    const mx = land.x0 + 40 + ((i * 97) % 40) * 100
    const mz = land.z0 + 40 + Math.floor(i / 40) * 400
    if (land.playAt(mx, mz) < -5 && !link.inCorridor(land.toSceneX(mx), land.toSceneZ(mz), -8)) {
      outside++
      assert.ok(!terrain.inBounds(land.toSceneX(mx), land.toSceneZ(mz)), `outside the limits at ${mx}, ${mz}`)
    }
  }
  assert.ok(outside > 50, 'most of the square is outside the city')
})

test('Montello\'s water answers for Fox Lake\'s terrain', () => {
  const lake = doc.pois.find((p) => p.n === 'Lake Montello')!
  let found = false
  for (let r = 0; r < 300 && !found; r += 20) {
    for (let a = 0; a < 6.28 && !found; a += 0.5) {
      const mx = lake.x + Math.cos(a) * r
      const mz = lake.z + Math.sin(a) * r
      if (land.depthAt(mx, mz) > 0.5) {
        found = true
        assert.equal(terrain.depthAt(land.toSceneX(mx), land.toSceneZ(mz)), land.depthAt(mx, mz))
        assert.equal(terrain.groundAt(land.toSceneX(mx), land.toSceneZ(mz)), 'water')
      }
    }
  }
  assert.ok(found, 'open water near Lake Montello')
  assert.ok(linkRoadPath(4).length > 100)
})
