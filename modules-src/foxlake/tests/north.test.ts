import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { test } from 'node:test'
import { isGzip, parseGrids, type MapDoc } from '../../tello/data/MapData'
import { TelloLand } from '../../tello/region'
import { FoxLakeTerrain, LINK_WALK, MontelloLink } from '../montello/Link'
import { NORTH_ROAD, TOWN_OFFSET, TOWN_SQUARE, TOWN_Y, northRoadPath, outsideHeight, townToScene } from '../region'

const dir = 'public/modules/tello/'
const doc = JSON.parse(readFileSync(`${dir}montello.json`, 'utf8')) as MapDoc
const packed = new Uint8Array(readFileSync(`${dir}montello.bin`))
const land = new TelloLand(doc, parseGrids(isGzip(packed) ? new Uint8Array(gunzipSync(packed)) : packed))
const link = new MontelloLink(land)
const terrain = new FoxLakeTerrain(link)

test('County Road F meets the real County Highway F where the baked map starts it', () => {
  const road = doc.roads.find((r) => r.n === 'County Highway F' && Math.min(...r.p.filter((_v, i) => i % 2 === 1)) < land.z0 + 10)
  assert.ok(road, 'County Highway F reaches the map edge')
  assert.ok(Math.abs(land.toSceneX(road.p[0]) - NORTH_ROAD.join.x) < 0.2 && Math.abs(land.toSceneZ(road.p[1]) - NORTH_ROAD.join.z) < 0.2, 'join point')
  const dx = road.p[2] - road.p[0]
  const dz = road.p[3] - road.p[1]
  const len = Math.hypot(dx, dz)
  assert.ok(Math.abs(dx / len - NORTH_ROAD.joinDir.x) < 0.01 && Math.abs(dz / len - NORTH_ROAD.joinDir.z) < 0.01, 'join direction')
  const start = townToScene(87, 0, -267)
  assert.deepEqual([NORTH_ROAD.start.x, NORTH_ROAD.start.z], [start.x, start.z], 'starts at East Ave and North St')
})

test('Montello sits a whole map width north of the origin, clear of Fox Plains', () => {
  assert.equal(land.offset.x + land.x0 + land.size / 2, 0)
  assert.equal(land.offset.z + land.z0 + land.size / 2, land.size)
  assert.ok(land.toSceneZ(land.z0) > TOWN_SQUARE.z1 + 100, 'a stretch of woods between the town and Montello')
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
  for (const z of [2060, 2100, 2160]) {
    const x = NORTH_ROAD.join.x + ((z - NORTH_ROAD.join.z) * NORTH_ROAD.joinDir.x) / NORTH_ROAD.joinDir.z
    assert.ok(terrain.inBounds(x, z, 1), `on into Montello at z ${z}`)
  }
  assert.ok(terrain.inBounds(land.toSceneX(0), land.toSceneZ(0), 1), 'downtown Montello')
})

test('no step in the ground where the corridor meets Fox Plains and Montello', () => {
  for (let x = TOWN_SQUARE.x0 + 600; x < TOWN_SQUARE.x1; x += 37) {
    const a = terrain.heightAt(x, TOWN_SQUARE.z1 - 0.5)
    const b = terrain.heightAt(x, TOWN_SQUARE.z1 + 0.5)
    assert.ok(Math.abs(a - b) < 0.4, `x ${x.toFixed(0)}: ${a.toFixed(2)} / ${b.toFixed(2)}`)
    assert.equal(a, outsideHeight(x, TOWN_SQUARE.z1 - 0.5))
  }
  const edge = land.toSceneZ(land.z0)
  for (let x = link.box.x0 + 20; x < link.box.x1 - 20; x += 41) {
    const a = terrain.heightAt(x, edge - 0.3)
    const b = terrain.heightAt(x, edge + 0.3)
    assert.ok(Math.abs(a - b) < 0.6, `x ${x.toFixed(0)}: ${a.toFixed(2)} / ${b.toFixed(2)}`)
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
  assert.ok(!terrain.inBounds(0, TOWN_SQUARE.z1 + 120), 'north of town away from the road')
  let outside = 0
  for (let i = 0; i < 400; i++) {
    const mx = land.x0 + 40 + ((i * 97) % 40) * 100
    const mz = land.z0 + 40 + Math.floor(i / 40) * 400
    if (land.playAt(mx, mz) < -5) {
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
  assert.ok(northRoadPath(4).length > 100)
})
