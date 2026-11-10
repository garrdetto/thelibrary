import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Autopilot, ROUTE, SPEED, STUNT, buildLoops, clearanceDistance, dockLine, findLaunch, nearestIndex, planHomeStunt } from '../systems/BowRoutes'
import type { RouteName } from '../systems/BowRoutes'
import { HIGHWAY, ISLAND, Terrain, highwayCoord } from '../world/Terrain'

const terrain = new Terrain()
const dock = dockLine(terrain)
const launch = findLaunch(terrain, dock.start, dock.end)
const clear = { points: [launch.boat], segments: [[dock.start, dock.end]] as [typeof dock.start, typeof dock.end][] }
const loops = buildLoops(terrain, clear)

test('Wild Man\'s launch is dry ground on the shore 30–55 m from the dock', () => {
  const d = Math.hypot(launch.shore.x - dock.start.x, launch.shore.z - dock.start.z)
  assert.ok(d >= 30 && d <= 55, `launch ${d} m from the dock`)
  assert.ok(terrain.heightAt(launch.camp.x, launch.camp.z) > 0.4, 'he sits on dry ground')
  assert.ok(terrain.depthAt(launch.boat.x, launch.boat.z) > 0.5, 'his boat floats')
})

test('every loop stays in boat water and clear of the dock and the parked boat', () => {
  for (const [name, loop] of Object.entries(loops)) {
    assert.ok(loop.length > 30, `${name} has points`)
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i]
      const q = loop[(i + 1) % loop.length]
      assert.ok(terrain.depthAt(p.x, p.z) >= ROUTE.minDepth - 0.05, `${name} point ${i} depth ${terrain.depthAt(p.x, p.z)}`)
      assert.ok(clearanceDistance(p, clear) >= ROUTE.clear, `${name} point ${i} too close to the dock`)
      assert.ok(Math.hypot(q.x - p.x, q.z - p.z) < ROUTE.spacing * 1.6, `${name} is resampled every 2 m`)
    }
  }
  const ring = loops.island.map((p) => Math.hypot(p.x - ISLAND.x, p.z - ISLAND.z))
  assert.ok(Math.min(...ring) > ISLAND.r * 0.5 && Math.max(...ring) < ISLAND.r * 3, 'the island loop circles the island')
})

function drive(ap: Autopilot, seconds: number, until?: (e: ReturnType<Autopilot['update']>) => boolean) {
  const out = { fastShallow: Infinity, top: 0, arrived: null as null | string, arriveSpeed: 0, crossedBridge: false, grounded: 0 }
  let lastSide = Math.sign(highwayCoord(ap.x, ap.z).across)
  let lastSigned = (ap.x - HIGHWAY.x) * HIGHWAY.dz - (ap.z - HIGHWAY.z) * HIGHWAY.dx
  for (let i = 0; i < seconds * 30; i++) {
    const e = ap.update(1 / 30, false)
    const depth = terrain.depthAt(ap.x, ap.z)
    if (ap.speed > SPEED.push + 1) out.fastShallow = Math.min(out.fastShallow, depth)
    if (depth < 0.25) out.grounded++
    out.top = Math.max(out.top, ap.speed)
    const signed = (ap.x - HIGHWAY.x) * HIGHWAY.dz - (ap.z - HIGHWAY.z) * HIGHWAY.dx
    if (Math.sign(signed) !== Math.sign(lastSigned) && Math.abs(highwayCoord(ap.x, ap.z).t) < HIGHWAY.span / 2) out.crossedBridge = true
    lastSigned = signed
    void lastSide
    if (e.arrived) {
      out.arrived = e.arrived
      out.arriveSpeed = ap.speed
      if (!until || until(e)) break
    }
  }
  return out
}

test('the autopilot cruises the flats at 3 mph and pushes at 6 mph', () => {
  const ap = new Autopilot(terrain, loops, launch)
  ap.depart()
  const out = drive(ap, 240)
  assert.equal(out.arrived, 'loop')
  assert.equal(out.grounded, 0)
  drive(ap, 25, () => false)
  assert.ok(Math.abs(ap.speed - SPEED.cruise) < 0.12, `cruise ${ap.speed}`)
  ap.setting = 2
  drive(ap, 20, () => false)
  assert.ok(Math.abs(ap.speed - SPEED.push) < 0.2, `push ${ap.speed}`)
  ap.hold = true
  drive(ap, 6, () => false)
  assert.ok(ap.speed < 0.05, 'holds up on request')
})

test('runs on plane at 30 mph to the island, only through deep water, and comes off plane before joining', () => {
  const ap = new Autopilot(terrain, loops, launch)
  const far = loops.shore[nearestIndex(loops.shore, { x: -150, z: 120 })]
  ap.x = far.x
  ap.z = far.z
  ap.mode = 'loop'
  ap.route = 'shore'
  assert.equal(ap.switchRoute(), 'island')
  const out = drive(ap, 300)
  assert.ok(out.top > SPEED.run - 0.3, `top speed ${out.top}`)
  assert.ok(out.fastShallow >= ROUTE.runDepth, `on plane in ${out.fastShallow} m of water`)
  assert.equal(out.arrived, 'loop')
  assert.ok(out.arriveSpeed < SPEED.push, `joins the loop at ${out.arriveSpeed}`)
  assert.equal(out.grounded, 0)
})

test('the back bay is reached under the highway bridge, and the run home comes off plane before docking', () => {
  const ap = new Autopilot(terrain, loops, launch)
  const start = loops.shore[nearestIndex(loops.shore, { x: 150, z: 20 })]
  ap.x = start.x
  ap.z = start.z
  ap.mode = 'loop'
  ap.route = 'island'
  assert.equal(ap.switchRoute() as RouteName, 'bay')
  const out = drive(ap, 400)
  assert.equal(out.arrived, 'loop')
  assert.ok(out.crossedBridge, 'went under the bridge')
  assert.ok(out.fastShallow >= ROUTE.runDepth, `bay run depth ${out.fastShallow}`)
  assert.equal(out.grounded, 0)
  ap.headHome()
  const home = drive(ap, 500)
  assert.equal(home.arrived, 'docked')
  assert.ok(home.crossedBridge, 'came back under the bridge')
  assert.ok(home.fastShallow >= ROUTE.runDepth, `home run depth ${home.fastShallow}`)
  assert.ok(home.arriveSpeed <= SPEED.cruise, `docks at ${home.arriveSpeed}`)
  assert.ok(Math.hypot(ap.x - launch.boat.x, ap.z - launch.boat.z) < 2, 'back at the launch')
})

test('the way home sends it over the island at full speed and beaches beside the camp', () => {
  const stunt = planHomeStunt(terrain, launch)
  assert.ok(stunt, 'a line over the island fits')
  assert.ok(stunt.peak > 2 && stunt.touchdown - stunt.takeoff < STUNT.maxSpan, `arc ${stunt.peak} m high over ${stunt.touchdown - stunt.takeoff} m`)
  assert.ok(Math.hypot(stunt.beach.x - launch.camp.x, stunt.beach.z - launch.camp.z) > 6, 'beaches clear of the cooler')
  for (const start of [{ x: -150, z: 120 }, { x: 150, z: 20 }, { x: 40, z: 60 }]) {
    const ap = new Autopilot(terrain, loops, launch)
    const p = loops.shore[nearestIndex(loops.shore, start)]
    ap.x = p.x
    ap.z = p.z
    ap.mode = 'loop'
    ap.sendItHome()
    let airborne = 0
    let airSpeed = 0
    let beached = false
    let maxLift = 0
    let clipped = 0
    for (let i = 0; i < 600 * 30; i++) {
      const e = ap.update(1 / 30, false)
      if (e.airborne) {
        airborne++
        airSpeed = ap.speed
      }
      maxLift = Math.max(maxLift, ap.lift)
      if (ap.lift < terrain.heightAt(ap.x, ap.z)) clipped++
      if (e.beached) {
        beached = true
        break
      }
    }
    assert.equal(airborne, 1, `takes off once from ${start.x},${start.z}`)
    assert.ok(airSpeed > SPEED.run - 0.5, `full speed at takeoff (${airSpeed})`)
    assert.ok(maxLift > stunt.peak - 0.5, `clears the island (${maxLift})`)
    assert.equal(clipped, 0, 'never below the ground')
    assert.ok(beached, 'beached it')
    assert.equal(ap.mode, 'docked')
    assert.ok(terrain.heightAt(ap.x, ap.z) > -0.6, 'up on the bank')
    assert.ok(Math.hypot(ap.x - stunt.beach.x, ap.z - stunt.beach.z) < 3, 'stops where he aimed')
    ap.depart()
    assert.equal(ap.beached, false)
    assert.ok(Math.hypot(ap.x - launch.boat.x, ap.z - launch.boat.z) < 0.1, 'shoved back off for the next trip')
  }
})
