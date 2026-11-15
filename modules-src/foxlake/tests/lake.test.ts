import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { test } from 'node:test'
import { isGzip, parseGrids } from '../../tello/data/MapData'
import { TelloLand, TelloTerrain } from '../../tello/region'
import { Autopilot, ROUTE, buildLoops, clearanceDistance, findLaunch, planHomeStunt, setLakeShape, shoreDistance } from '../../rackreel/systems/BowRoutes'
import { MONTELLO_AT, TOWN_OFFSET } from '../region'
import { LAKE_LEVEL } from '../lake/Rebase'
import { findMainStreet } from '../lake/Spawn'
import { doc, land, site } from './montello-land'

const terrain = new TelloTerrain(land)
const dockStart = site.dock.start
const dockEnd = site.dock.end

test('the heights are the survey\'s less Lake Montello\'s level, and the bridges and floors went with them', () => {
  const packed = new Uint8Array(readFileSync('public/modules/tello/montello.bin'))
  const raw = new TelloLand(JSON.parse(readFileSync('public/modules/tello/montello.json', 'utf8')), parseGrids(isGzip(packed) ? new Uint8Array(gunzipSync(packed)) : packed), MONTELLO_AT)
  for (const [x, z] of [[0, 0], [250, -80], [-300, 520], [1200, 900]]) {
    assert.ok(Math.abs(raw.groundAt(x, z) - LAKE_LEVEL - land.groundAt(x, z)) < 0.011, `ground at ${x}, ${z}`)
    assert.ok(Math.abs(raw.depthAt(x, z) - land.depthAt(x, z)) < 1e-9, 'the water\'s depth is the same')
  }
  for (let i = 0; i < raw.doc.buildings.length; i += 97) assert.ok(Math.abs(raw.doc.buildings[i].f - LAKE_LEVEL - land.doc.buildings[i].f) < 0.006)
  for (let i = 0; i < raw.doc.bridges.length; i++) assert.ok(Math.abs(raw.doc.bridges[i].y - LAKE_LEVEL - doc.bridges[i].y) < 0.006, 'bridge deck')
  const b = raw.doc.bridges[0]
  const mx = b.p[0], mz = b.p[1]
  assert.ok(Math.abs((raw.deckAt(mx, mz) ?? NaN) - LAKE_LEVEL - (land.deckAt(mx, mz) ?? NaN)) < 0.011, 'deckAt follows')
  assert.equal(TOWN_OFFSET.y, 0)
})

test('the dock runs out from level, open shore into water deep enough for the boat, with room for the UTV behind', () => {
  const at = (p: { x: number; z: number }) => ({ x: land.toMapX(p.x), z: land.toMapZ(p.z) })
  const start = at(dockStart)
  const end = at(dockEnd)
  assert.ok(land.depthAt(start.x, start.z) <= 0 && land.heightAt(start.x, start.z) > 0.6, 'the dock\'s land end is on the bank')
  assert.ok(land.depthAt(end.x, end.z) >= 1, 'its far end is over deep water')
  assert.ok(Math.abs(Math.hypot(dockEnd.x - dockStart.x, dockEnd.z - dockStart.z) - 18) < 0.1, 'eighteen metres of dock, as at Bear Paw Lake')
  const boat = at(site.boat)
  assert.ok(land.depthAt(boat.x, boat.z) >= 1, 'the boat floats')
  for (const p of [site.spawn, site.utv]) {
    const m = at(p)
    assert.ok(land.depthAt(m.x, m.z) <= 0 && land.clearAt(m.x, m.z) > 4, 'dry and off the pavement')
  }
  assert.ok(Math.hypot(site.utv.x - dockStart.x, site.utv.z - dockStart.z) < 40)
  const w = land.waterAt(end.x, end.z)
  assert.ok(w !== null && Math.abs(w - 0.01) < 1e-9, 'Lake Montello is the water the rod, the dock and the boat see at y = 0')
  assert.ok(Math.hypot(site.launch.x - dockStart.x, site.launch.z - dockStart.z) < 300, 'beside the park\'s launch ramp')
})

test('the hunting stands are in the woods, well apart, and the wild land is woods away from pavement and houses', () => {
  assert.equal(site.stands.filter((s) => s.kind === 'ladder').length, 3)
  assert.equal(site.stands.filter((s) => s.kind === 'blind').length, 1)
  for (const s of site.stands) {
    assert.ok(site.wild(s.x, s.z), `${s.kind} at ${s.x.toFixed(0)}, ${s.z.toFixed(0)} is wild land`)
    for (const o of site.stands) if (o !== s) assert.ok(Math.hypot(o.x - s.x, o.z - s.z) > 200, 'stands are well apart')
  }
  assert.ok(!site.wild(land.toSceneX(0), land.toSceneZ(0)), 'City Hall is not wild land')
  assert.ok(!site.wild(dockStart.x, dockStart.z), 'nor is the dock')
  let wild = 0
  let total = 0
  for (let z = land.z0; z < land.z0 + land.size; z += 128) {
    for (let x = land.x0; x < land.x0 + land.size; x += 128) {
      if (!land.playable(x, z)) continue
      total++
      if (site.wild(land.toSceneX(x), land.toSceneZ(z))) wild++
    }
  }
  assert.ok(wild / total > 0.1, `${wild} of ${total} sampled spots are wild land: the ring has woods to hunt in`)
})

test('Wild Man\'s loops on Lake Montello stay in boat water, clear of the dock, and he launches from its shore', () => {
  setLakeShape({ center: site.lake.center, radius: site.lake.radius })
  try {
    const launch = findLaunch(terrain, dockStart, dockEnd)
    const d = Math.hypot(launch.shore.x - dockStart.x, launch.shore.z - dockStart.z)
    assert.ok(d >= 20 && d <= 70, `the launch is ${d.toFixed(0)} m from the dock`)
    assert.ok(terrain.depthAt(launch.camp.x, launch.camp.z) <= 0 && terrain.heightAt(launch.camp.x, launch.camp.z) > 0.4, 'he sits on dry ground')
    assert.ok(terrain.depthAt(launch.boat.x, launch.boat.z) > 0.5, 'his boat floats')
    const clear = { points: [{ x: site.boat.x, z: site.boat.z }, launch.boat], segments: [[dockStart, dockEnd]] as [typeof dockStart, typeof dockEnd][] }
    const loops = buildLoops(terrain, clear)
    assert.deepEqual(loops.island, loops.shore, 'there is no island to circle')
    assert.deepEqual(loops.bay, loops.shore, 'and no bay')
    assert.ok(loops.shore.length > 60, 'the shore loop has points')
    for (let i = 0; i < loops.shore.length; i++) {
      const p = loops.shore[i]
      assert.ok(terrain.depthAt(p.x, p.z) >= ROUTE.minDepth - 0.05, `point ${i} depth ${terrain.depthAt(p.x, p.z).toFixed(2)}`)
      assert.ok(clearanceDistance(p, clear) >= ROUTE.clear, `point ${i} is too close to the dock`)
      assert.ok(shoreDistance(terrain, p, 40) >= ROUTE.shoreGapMin, `point ${i} is too close to the bank`)
    }
    assert.equal(planHomeStunt(terrain, launch), null, 'the home stunt is the island\'s')
    const pilot = new Autopilot(terrain, loops, launch)
    pilot.depart()
    for (let i = 0; i < 30 * 120; i++) pilot.update(1 / 30, false)
    assert.ok(terrain.depthAt(pilot.x, pilot.z) > 0.3, 'the autopilot keeps his boat on the water')
  } finally {
    setLakeShape(null)
  }
})

test('a player with no home starts on Main Street, on a clear kerb', () => {
  const s = findMainStreet(land)
  const main = land.doc.roads.filter((r) => r.n === 'Main Street')
  assert.ok(main.length > 0)
  let near = Infinity
  for (const r of main) for (let k = 0; k < r.p.length; k += 2) near = Math.min(near, Math.hypot(r.p[k] - s.x, r.p[k + 1] - s.z))
  assert.ok(near < 30, `${near.toFixed(0)} m from Main Street's line`)
  assert.ok(land.clearAt(s.x, s.z) > 0.6 && land.depthAt(s.x, s.z) === 0)
  assert.ok(Math.hypot(s.x - 110, s.z + 98) < 200, 'downtown, by the dealership')
})
