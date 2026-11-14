import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { test } from 'node:test'
import { HALF, PLAY_LIMIT } from '../../rackreel/world/Terrain'
import { COVER, ROOF, isGzip, parseGrids, type MapDoc } from '../data/MapData'
import { EDGE_MARGIN, TelloLand, TelloTerrain, lonLatToUtm, utmToLonLat } from '../region'
import { pointInRing, polylineLength, resample, signedArea, triangulate } from '../world/Poly'
import { bridgeSolids, junctions } from '../world/Roads'
import { depthBytes } from '../world/Water'
import { RoadGraph, roadIndex, roadNameAt } from '../town/Routes'

const dir = 'public/modules/tello/'
const doc = JSON.parse(readFileSync(`${dir}montello.json`, 'utf8')) as MapDoc
const packed = new Uint8Array(readFileSync(`${dir}montello.bin`))
const grids = parseGrids(isGzip(packed) ? new Uint8Array(gunzipSync(packed)) : packed)
const land = new TelloLand(doc, grids)
const terrain = new TelloTerrain(land)

test('the map files are whole: grids match the frame and every layer is present', () => {
  const f = doc.frame
  assert.equal(grids.side, f.size / f.cell + 1)
  assert.equal(grids.fineSide, f.size / f.fine + 1)
  for (const layer of [grids.ground, grids.water, grids.cover, grids.tone, grids.canopy]) assert.equal(layer.length, grids.side * grids.side)
  assert.equal(grids.clear.length, grids.fineSide * grids.fineSide)
  assert.equal(grids.treeX.length, grids.treeZ.length)
  assert.equal(grids.treeX.length, grids.treeS.length)
  assert.ok(grids.treeX.length > 20000, 'Montello is a wooded town')
  assert.ok(doc.sources.some((s) => /OpenStreetMap/.test(s)), 'OpenStreetMap is credited')
})

test('the frame is Montello: the origin is by City Hall and map points convert to longitude and latitude and back', () => {
  const f = doc.frame
  const origin = land.lonLat(0, 0)
  assert.ok(Math.abs(origin.lon - f.lon) < 2e-5 && Math.abs(origin.lat - f.lat) < 2e-5, `origin ${origin.lon}, ${origin.lat}`)
  assert.ok(Math.abs(origin.lon + 89.3288) < 1e-3 && Math.abs(origin.lat - 43.7919) < 1e-3)
  for (const [x, z] of [[-2000, -1200], [0, 0], [1400, 2300], [650.5, -980.25]]) {
    const ll = land.lonLat(x, z)
    const back = lonLatToUtm(ll.lon, ll.lat, f.utmZone)
    assert.ok(Math.abs(back.e - (f.utmE + x)) < 0.01 && Math.abs(back.n - (f.utmN + z)) < 0.01, 'projection round trip within a centimetre')
  }
  const cityHall = lonLatToUtm(-89.3304306, 43.7918714, 16)
  assert.ok(Math.hypot(cityHall.e - f.utmE, cityHall.n - f.utmN) < 200, 'City Hall is within 200 m of the origin')
  const sample = utmToLonLat(f.utmE, f.utmN + 1000, 16)
  assert.ok(Math.abs((sample.lat - origin.lat) * 111132 - 1000) < 2, 'a kilometre north is a kilometre of latitude: the scale is 1:1')
})

test('Tello sits a whole map width north of the lake country, out of its reach', () => {
  assert.equal(land.offset.x + land.x0 + land.size / 2, 0)
  assert.equal((land.offset.z + land.z0 + land.size / 2) % land.size, 0)
  assert.ok(land.toSceneZ(land.z0) > HALF + 1000, 'more than a kilometre of nothing between them')
  assert.equal(terrain.inBounds(0, HALF + 200), false, 'nobody can walk between the two')
  assert.equal(terrain.inBounds(0, PLAY_LIMIT + 20), false, 'the lake country keeps its rim')
  assert.equal(terrain.inBounds(land.toSceneX(0), land.toSceneZ(0)), true)
  assert.equal(terrain.inBounds(land.toSceneX(land.x0 + EDGE_MARGIN - 2), land.toSceneZ(0)), false, 'the map has an edge')
  const x = land.toSceneX(40)
  const z = land.toSceneZ(-25)
  assert.ok(Math.abs(terrain.heightAt(x, z) - land.heightAt(40, -25)) < 1e-9, 'the game stands on Montello ground')
})

test('water: Buffalo Lake, Lake Montello and the Fox River lie at their own levels, in the right order', () => {
  const at = (name: string) => doc.pois.find((p) => p.k === 'water' && p.n === name)
  const buffalo = at('Buffalo Lake')
  const montello = at('Lake Montello')
  assert.ok(buffalo && montello, 'both lakes are named on the map')
  const lb = land.waterAt(buffalo.x, buffalo.z)
  const lm = land.waterAt(montello.x, montello.z)
  assert.ok(lb !== null && lm !== null)
  const base = doc.frame.base
  assert.ok(Math.abs(lb + base - 234.81) < 0.05, `Buffalo Lake at ${lb + base} m`)
  assert.ok(Math.abs(lm + base - 238.71) < 0.05, `Lake Montello at ${lm + base} m`)
  assert.ok(land.depthAt(buffalo.x, buffalo.z) > 1, 'the middle of the lake is deep')
  assert.ok(terrain.depthAt(land.toSceneX(buffalo.x), land.toSceneZ(buffalo.z)) > 1, 'the game knows it is water')
  const hall = doc.pois.find((p) => p.n === 'Montello City Hall')!
  assert.equal(land.depthAt(hall.x, hall.z), 0, 'City Hall is on dry land')
  let wet = 0
  for (let k = 0; k < grids.ground.length; k++) if (grids.water[k] > grids.ground[k]) wet++
  const share = wet / grids.ground.length
  assert.ok(share > 0.12 && share < 0.3, `water covers ${(share * 100).toFixed(1)} % of the map`)
  const bytes = depthBytes(land)
  let texels = 0
  for (let k = 0; k < bytes.length; k += 4) if (bytes[k]) texels++
  assert.ok(Math.abs(texels / (bytes.length / 4) - share) < 0.02, 'the shader depth map covers the same water')
  for (let k = 0; k < grids.ground.length; k++) if (grids.cover[k] === COVER.water) assert.ok(grids.water[k] > grids.ground[k], 'cover says water only where there is depth')
})

test('roads: the named streets are there, level across, clear of the lakes, and the field marks them as pavement', () => {
  const names = new Set(doc.roads.map((r) => r.n))
  for (const name of ['Main Street', 'West Montello Street', 'East Montello Street', 'Church Street', 'Lake Avenue', 'Underwood Avenue', 'West Park Street']) assert.ok(names.has(name), `${name} is on the map`)
  const km = doc.roads.reduce((sum, r) => sum + polylineLength(r.p), 0) / 1000
  assert.ok(km > 60 && km < 110, `${km.toFixed(1)} km of roads and paths`)
  let checked = 0
  let worst = 0
  for (const road of doc.roads) {
    if (road.k > 1) continue
    const pts = resample(road.p, 8)
    for (let k = 2; k + 3 < pts.length; k += 2) {
      const x = pts[k], z = pts[k + 1]
      if (!land.inside(x, z, 20)) continue
      const dx = pts[k + 2] - pts[k - 2], dz = pts[k + 3] - pts[k - 1]
      const len = Math.hypot(dx, dz) || 1
      const sx = -dz / len, sz = dx / len
      const half = road.w / 2 - 0.3
      assert.ok(land.clearAt(x, z) < 0.5, `pavement field is negative on ${road.n || 'a street'} at ${x}, ${z}`)
      if (land.deckAt(x, z) !== null) continue
      assert.equal(land.depthAt(x, z), 0, `${road.n || 'a street'} is dry at ${x}, ${z}`)
      const cross = Math.abs(land.heightAt(x + sx * half, z + sz * half) - land.heightAt(x - sx * half, z - sz * half))
      worst = Math.max(worst, cross)
      checked++
    }
  }
  assert.ok(checked > 3000)
  assert.ok(worst < 0.9, `the steepest cross fall on a street is ${worst.toFixed(2)} m`)
})

test('bridges carry their roads over water on level decks', () => {
  assert.ok(doc.bridges.length >= 5)
  const main = doc.bridges.filter((b) => doc.roads[b.r].n === 'Main Street')
  assert.ok(main.length >= 2, 'Main Street crosses the river on bridges')
  for (const b of doc.bridges) {
    const mid = Math.floor(b.p.length / 4) * 2
    const x = b.p[mid], z = b.p[mid + 1]
    assert.equal(land.deckAt(x, z), b.y)
    assert.ok(land.heightAt(x, z) >= b.y, 'you stand on the deck')
    assert.equal(land.depthAt(x, z), 0, 'and it is dry up there')
    const level = land.waterAt(x, z)
    if (level !== null) assert.ok(b.y > level + 0.5, 'the deck clears the water')
  }
  const solids = bridgeSolids(land)
  assert.ok(solids.filter((s) => s.part === 'deck').length >= doc.bridges.length)
  assert.ok(solids.filter((s) => s.part === 'rail').length >= doc.bridges.length * 2)
})

test('buildings: one for every footprint, on dry ground, with roofs and colliders inside their walls', () => {
  assert.ok(doc.buildings.length > 1200, `${doc.buildings.length} buildings`)
  const kinds = new Set(doc.buildings.map((b) => b.k))
  for (const k of ['house', 'garage', 'store', 'industrial']) assert.ok(kinds.has(k as never))
  let wetOnes = 0
  for (const b of doc.buildings) {
    assert.ok(b.p.length >= 6 && b.r.length >= 1 && b.h >= 1.6)
    assert.ok(Math.abs(signedArea(b.p)) >= 8, 'a real footprint')
    const [cx, cz, hx, hz] = b.r[0]
    assert.ok(hx > 0.9 && hz > 0.9)
    assert.ok(pointInRing(b.p, cx, cz), 'the main block is inside the footprint')
    assert.ok(land.inside(cx, cz, EDGE_MARGIN - 14))
    if (land.depthAt(cx, cz) > 0.3) wetOnes++
    assert.ok(b.f >= land.groundAt(cx, cz) - 1.5 && b.f <= land.groundAt(cx, cz) + 3, 'the floor is at the ground')
    assert.ok(land.clearAt(cx, cz) < 0, 'grass and trees keep out of it')
  }
  assert.ok(wetOnes <= doc.buildings.length * 0.01, `${wetOnes} buildings stand in water`)
  const named = doc.buildings.filter((b) => b.n).map((b) => b.n)
  assert.ok(named.includes('Montello Theatre'))
})

test('roofs come from the lidar: almost every building is measured, with a sane eave and ridge on each block', () => {
  const measured = doc.buildings.filter((b) => b.m)
  assert.ok(measured.length > doc.buildings.length * 0.92, `${measured.length} of ${doc.buildings.length} roofs measured`)
  const types = new Map<number, number>()
  for (const b of doc.buildings) {
    for (const r of b.r) {
      assert.equal(r.length, 8, 'each block carries its roof type, eave and ridge')
      const [, , , , , type, eave, ridge] = r
      assert.ok(type >= ROOF.unmeasured && type <= ROOF.shedMinusFirst)
      if (type === ROOF.unmeasured) continue
      assert.ok(eave >= 1.6 && eave < 30, `eave ${eave}`)
      assert.ok(ridge >= eave && ridge < 40, `ridge ${ridge} over eave ${eave}`)
      if (type === ROOF.flat) assert.equal(ridge, eave)
      else assert.ok(ridge - eave >= 0.25, 'a pitched roof rises')
    }
    types.set(b.r[0][5], (types.get(b.r[0][5]) ?? 0) + 1)
    if (b.m) assert.equal(b.h, b.r[0][6], 'the wall height is the main block\'s measured eave')
  }
  const gables = (types.get(ROOF.gableFirst) ?? 0) + (types.get(ROOF.gableSecond) ?? 0)
  assert.ok(gables > doc.buildings.length * 0.5, 'most of Montello is gabled')
  assert.ok((types.get(ROOF.flat) ?? 0) > 60 && (types.get(ROOF.hip) ?? 0) > 10, 'and it has flat and hip roofs too')
  const houses = measured.filter((b) => b.k === 'house').map((b) => b.h).sort((a, c) => a - c)
  const median = houses[Math.floor(houses.length / 2)]
  assert.ok(median > 2.4 && median < 4.2, `the median house eave is ${median} m`)
  const theatre = doc.buildings.find((b) => b.n === 'Montello Theatre')!
  assert.ok(theatre.m && theatre.h > 4, `the theatre stands ${theatre.h} m to its roof`)
  assert.ok(doc.bridges.filter((b) => b.m).length >= 5, 'bridge decks are measured too')
})

test('every tree is a crown in the lidar with its own height, on dry land off the pavement; meadow grass keeps off roads, lawns and water', () => {
  assert.equal(grids.treeH.length, grids.treeX.length)
  const heights = Array.from(grids.treeH, (h) => h / 4).sort((a, c) => a - c)
  assert.ok(heights[0] >= 3 && heights[heights.length - 1] <= 45, `trees stand ${heights[0]} to ${heights[heights.length - 1]} m`)
  const mid = heights[Math.floor(heights.length / 2)]
  assert.ok(mid > 9 && mid < 22, `the median tree is ${mid} m`)
  let pines = 0
  for (let i = 0; i < grids.treeS.length; i++) if (grids.treeS[i] >> 6 === 0) pines++
  assert.ok(pines > grids.treeS.length * 0.08 && pines < grids.treeS.length * 0.6, `${pines} conifers`)
  for (const b of doc.buildings.slice(0, 400)) {
    const [cx, cz] = b.r[0]
    for (let i = 0; i < grids.treeX.length; i += 11) {
      const dx = land.x0 + grids.treeX[i] / 10 - cx
      const dz = land.z0 + grids.treeZ[i] / 10 - cz
      if (Math.abs(dx) < 1 && Math.abs(dz) < 1) assert.fail('a tree stands inside a building')
    }
  }

  let bad = 0
  for (let i = 0; i < grids.treeX.length; i += 7) {
    const x = land.x0 + grids.treeX[i] / 10
    const z = land.z0 + grids.treeZ[i] / 10
    if (land.depthAt(x, z) > 0.05 || land.clearAt(x, z) < 1) bad++
    assert.ok(grids.treeS[i] >> 6 <= 2)
  }
  assert.ok(bad < grids.treeX.length / 7 / 200, `${bad} sampled trees in water or on pavement`)
  const road = doc.roads.find((r) => r.n === 'Main Street')!
  assert.equal(land.grassAt(road.p[0], road.p[1]), false)
  const lake = doc.pois.find((p) => p.n === 'Buffalo Lake')!
  assert.equal(land.grassAt(lake.x, lake.z), false)
  let meadow = 0
  for (let k = 0; k < grids.cover.length; k += 97) if (grids.cover[k] === COVER.meadow || grids.cover[k] === COVER.field) meadow++
  assert.ok(meadow > 200)
})

test('polygons triangulate to their own area', () => {
  const l = [0, 0, 6, 0, 6, 2, 2, 2, 2, 5, 0, 5]
  const tris = triangulate(l)
  let area = 0
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]]
    area += Math.abs((l[b * 2] - l[a * 2]) * (l[c * 2 + 1] - l[a * 2 + 1]) - (l[b * 2 + 1] - l[a * 2 + 1]) * (l[c * 2] - l[a * 2])) / 2
  }
  assert.equal(tris.length, 12)
  assert.ok(Math.abs(area - Math.abs(signedArea(l))) < 1e-9)
  for (const b of doc.buildings.slice(0, 300)) {
    const t = triangulate(b.p)
    let sum = 0
    for (let k = 0; k < t.length; k += 3) sum += Math.abs((b.p[t[k + 1] * 2] - b.p[t[k] * 2]) * (b.p[t[k + 2] * 2 + 1] - b.p[t[k] * 2 + 1]) - (b.p[t[k + 1] * 2 + 1] - b.p[t[k] * 2 + 1]) * (b.p[t[k + 2] * 2] - b.p[t[k] * 2])) / 2
    assert.ok(Math.abs(sum - Math.abs(signedArea(b.p))) < 0.02 * Math.abs(signedArea(b.p)) + 0.05, 'roof caps cover the footprint')
  }
})

test('directions follow the road network, and streets answer to their names', () => {
  const graph = new RoadGraph(doc.roads)
  const school = doc.pois.find((p) => p.k === 'school')!
  const route = graph.route(0, 0, school.x, school.z)
  assert.ok(route, 'there is a way from City Hall to the school')
  const crow = Math.hypot(school.x, school.z)
  assert.ok(route.length >= crow * 0.9 && route.length < crow * 2.5, `${Math.round(route.length)} m by road, ${Math.round(crow)} m as the crow flies`)
  for (let k = 0; k < route.pts.length; k += 2) assert.ok(land.clearAt(route.pts[k], route.pts[k + 1]) < 1.5, 'every turn is on a road')
  const across = graph.route(-1800, -400, 1200, 1900)
  assert.ok(across && across.length > 3000, 'the network is joined from one side of town to the other')
  const index = roadIndex(doc.roads, 64)
  const main = doc.roads.find((r) => r.n === 'Main Street')!
  const mid = Math.floor(main.p.length / 4) * 2
  assert.equal(roadNameAt(doc.roads, index, 64, main.p[mid], main.p[mid + 1]), 'Main Street')
  assert.ok(junctions(land).length > 100)
})

test('only the City of Montello is built: buildings inside the limits, the edge walled, roads closed where they leave', () => {
  const limits = doc.limits
  assert.ok(limits.city.length >= 60 && limits.play.length >= 60, 'the limits are real outlines')
  const city = limits.city
  for (const b of doc.buildings) {
    const at = pointInRing(city, b.r[0][0], b.r[0][1])
    if (!at) assert.ok(land.playAt(b.r[0][0], b.r[0][1]) > -12, `building ${b.n ?? b.k} at ${b.r[0][0]}, ${b.r[0][1]} hugs the limits`)
  }
  assert.ok(doc.buildings.length > 1000 && doc.buildings.length < 1500, `${doc.buildings.length} buildings in town`)
  assert.ok(doc.buildings.filter((b) => b.rc).length > doc.buildings.length * 0.85, 'roof colours from the aerial photo')
  assert.ok(limits.exits.length >= 8, 'roads leaving town are closed')
  for (const e of limits.exits) assert.ok(Math.abs(land.playAt(e.x, e.z)) < 6, 'each closure sits on the edge')
  // The play grid agrees with the outline.
  let checked = 0
  for (let i = 0; i < 2000; i++) {
    const x = land.x0 + 20 + ((i * 7919) % 4056)
    const z = land.z0 + 20 + ((i * 104729) % 4056)
    const d = land.playAt(x, z)
    if (Math.abs(d) < 12) continue
    assert.equal(d > 0, pointInRing(limits.play, x, z), `play grid at ${x}, ${z}`)
    checked++
  }
  assert.ok(checked > 1500)
  assert.ok(!terrain.inBounds(land.toSceneX(-2300), land.toSceneZ(2400)), 'Kilby Lake country is outside the city')
  assert.ok(terrain.inBounds(land.toSceneX(0), land.toSceneZ(0), 2), 'downtown is in town')
})
