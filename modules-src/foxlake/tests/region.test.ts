import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HALF, PLAY_LIMIT, STANDALONE_SHAPE, Terrain, rawHeight } from '../../rackreel/world/Terrain'
import { HIGHWAY, highwayCoord } from '../../rackreel/world/Terrain'
import { CONNECTOR, FOX_LAKE_SHAPE, TOWN_SQUARE, TOWN_Y, connectorDistance, connectorPath, headingToTownYaw, roadClear, sceneToTown, townToScene, townYawToHeading, zoneAt } from '../region'
import { MAP_BOUNDS, WORLD_HALF } from '../../maplestreet/shared/WorldLayout'
import { HIGHWAY_END_T, HIGHWAY_GAPS, LAKE_JUNCTION_T, LAKE_ROAD_APRON, barrierSegments, highwayAt, hitsBarrier, lakeRoadPath } from '../country/Roads'
import { ROADSIDE, ROAD_HALF, ROAD_X, doorSpot, lotRect, roadsideAt } from '../roadside/RoadsideLayout'
import { glassTexel } from '../fp/physics/ScanGlass'

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

test('Fox Lake opens the north edge onto the land around town, with no wall or step', () => {
  for (let x = -400; x <= 400; x += 25) {
    const inside = foxLake.heightAt(x, HALF - 0.5)
    const outside = foxLake.heightAt(x, HALF + 0.5)
    assert.ok(Math.abs(inside - outside) < 1.6, `step at x=${x}: ${inside} in the square, ${outside} beyond`)
    assert.ok(outside >= TOWN_Y && outside < TOWN_Y + 9, `the land beyond rolls gently at x=${x} (${outside})`)
  }
  for (const p of connectorPath(8)) if (p.z > HALF + 75) assert.equal(foxLake.heightAt(p.x, p.z), TOWN_Y, 'the county road is level beyond the seam')
  assert.equal(foxLake.heightAt(townToScene(0, 0, 0).x, townToScene(0, 0, 0).z), TOWN_Y, 'the town is level')
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

test('the Lake Road joins the interstate through an opening in its rail and ends at Fox Outfitters', () => {
  const path = lakeRoadPath(4)
  const start = highwayCoord(path[0].x, path[0].z)
  assert.ok(start.across < HIGHWAY.halfWidth, 'it starts on the interstate')
  assert.ok(HIGHWAY_GAPS.some((g) => g.side === -1 && start.t > g.t0 && start.t < g.t1), 'through the south-west rail')
  const end = path[path.length - 1]
  assert.ok(Math.hypot(end.x - LAKE_ROAD_APRON.x, end.z - LAKE_ROAD_APRON.z) < LAKE_ROAD_APRON.r, 'it ends on the apron')
  for (let i = 1; i < path.length; i++) assert.ok(Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z) < 9, `gap at ${i}`)
  for (const p of path) {
    assert.ok(foxLake.heightAt(p.x, p.z) > 0.5, `dry at ${Math.round(p.x)}, ${Math.round(p.z)}`)
    assert.ok(roadClear(p.x, p.z) < 0, 'trees and grass keep off it')
  }
})

test('the interstate barriers are solid everywhere except the Lake Road junction, and the dead end is closed', () => {
  const segs = barrierSegments(FOX_LAKE_SHAPE, (x, z) => foxLake.heightAt(x, z))
  assert.ok(segs.length > 100)
  const rail = highwayAt(LAKE_JUNCTION_T + 40, -(HIGHWAY.halfWidth + 0.4))
  assert.ok(hitsBarrier(segs, rail.x, rail.z, 0.5, foxLake.heightAt(rail.x, rail.z)), 'the rail away from the junction blocks')
  const gap = highwayAt(LAKE_JUNCTION_T, -(HIGHWAY.halfWidth + 0.4))
  assert.equal(hitsBarrier(segs, gap.x, gap.z, 0.5, foxLake.heightAt(gap.x, gap.z)), false, 'the junction is open')
  const median = highwayAt(LAKE_JUNCTION_T + 60, 0)
  assert.ok(hitsBarrier(segs, median.x, median.z, 0.5, foxLake.heightAt(median.x, median.z)), 'the median wall blocks')
  const closed = highwayAt(HIGHWAY_END_T, 3)
  assert.ok(hitsBarrier(segs, closed.x, closed.z, 0.5, foxLake.heightAt(closed.x, closed.z)), 'the barricade blocks')
})

test('the roadside places sit on their own lots beside the county road, clear of town and of each other', () => {
  const kinds = new Set(ROADSIDE.map((p) => p.kind))
  for (const k of ['cabin', 'gas', 'motel', 'bar'] as const) assert.ok(kinds.has(k), k)
  assert.ok(ROADSIDE.filter((p) => p.kind === 'cabin').length >= 2, 'several cabins')
  const rects = ROADSIDE.map((p) => ({ p, r: lotRect(p) }))
  for (const { p, r } of rects) {
    assert.ok(r.cz - r.sz / 2 > MAP_BOUNDS.z1, `${p.name} is out of town`)
    assert.ok(Math.abs(r.cx - ROAD_X) - r.sx / 2 >= ROAD_HALF - 1e-6, `${p.name} keeps off the road`)
    const s = townToScene(r.cx, 0, r.cz)
    assert.ok(connectorDistance(s.x, s.z) < r.sx / 2 + 12, `${p.name} fronts the county road`)
    assert.equal(foxLake.heightAt(s.x, s.z), TOWN_Y, `${p.name} is on level ground`)
    const d = doorSpot(p)
    assert.equal(roadsideAt(d.x, d.z, 2), p)
  }
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i].r
    const b = rects[j].r
    const apart = Math.abs(a.cx - b.cx) >= (a.sx + b.sx) / 2 || Math.abs(a.cz - b.cz) >= (a.sz + b.sz) / 2
    assert.ok(apart, `${rects[i].p.name} and ${rects[j].p.name} overlap`)
  }
})

test('painted-on windows are found by colour: dark grey and grey-blue glass, not body paint or chrome', () => {
  assert.ok(glassTexel(0.08, 0.09, 0.1), 'dark tinted glass')
  assert.ok(glassTexel(0.28, 0.33, 0.4), 'sky reflection')
  assert.equal(glassTexel(0.7, 0.04, 0.16), false, 'red paint')
  assert.equal(glassTexel(0.85, 0.85, 0.82), false, 'white paint or chrome')
  assert.equal(glassTexel(0.35, 0.3, 0.2), false, 'brown trim')
})
