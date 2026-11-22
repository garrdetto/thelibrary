import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRUCKS, TRUCK_BY_ID } from '../shared/Catalog'
import { MASK } from '../sim/PhysicsHost'
import { FlatWorld } from '../sim/SimWorld'
import { MAX_STEER, TruckRig, steerLock } from '../sim/TruckRig'
import { emptyInput, headingOf, toWorld } from '../sim/types'
import type { DriveInput } from '../sim/types'

const DUMP = TRUCK_BY_ID['ridgeline-rd10']

function drive(world: FlatWorld, truck: TruckRig, input: DriveInput, seconds: number, each?: (t: number) => boolean | void): number {
  const steps = Math.round(seconds * 60)
  for (let i = 0; i < steps; i++) {
    let stop = false
    world.tick((h) => {
      truck.update(h, input)
      input.shiftUp = false
      input.shiftDown = false
    })
    if (each && each((i + 1) / 60) === true) stop = true
    if (stop) return (i + 1) / 60
  }
  return seconds
}

function settle(world: FlatWorld, truck: TruckRig, seconds = 2): void {
  const input = emptyInput()
  input.parkingBrake = true
  drive(world, truck, input, seconds)
}

test('every truck rests on its wheels: one wheel per axle side, hubs at tyre radius, chassis level', async () => {
  const world = await FlatWorld.create()
  for (const model of TRUCKS) {
    const truck = new TruckRig(world, model, { x: 0, z: 0, heading: 0.4 })
    settle(world, truck, 2.5)
    const pose = truck.pose()
    assert.equal(pose.wheels.length, model.axles.length * 2, model.id)
    for (const wheel of pose.wheels) {
      if (wheel.lifted) {
        assert.ok(toWorld(pose, wheel).y - wheel.radius > 0.1, `${model.id} lifted wheel clears the road`)
        continue
      }
      const bottom = toWorld(pose, wheel).y - wheel.radius
      assert.ok(Math.abs(bottom) < 0.06, `${model.id} wheel bottom at ${bottom.toFixed(3)}`)
    }
    assert.ok(Math.abs(pose.position.y) < 0.12, `${model.id} origin height ${pose.position.y.toFixed(3)}`)
    const up = 1 - 2 * (pose.rotation.x ** 2 + pose.rotation.z ** 2)
    assert.ok(up > 0.998, `${model.id} sits level (${up})`)
    assert.ok(Math.abs(headingOf(pose.rotation) - 0.4) < 0.01, `${model.id} keeps its heading`)
    truck.dispose()
  }
  assert.equal(world.counts().bodies, 0)
  world.dispose()
})

test('the starter dump truck reaches 60 km/h in under 40 s, shifting up, and stops from it in under 60 m', async () => {
  const world = await FlatWorld.create()
  const truck = new TruckRig(world, DUMP, { x: 0, z: 0, heading: 0 })
  settle(world, truck)
  const fuel = truck.fuelL
  const input = emptyInput()
  input.throttle = 1
  const startGear = truck.gear
  let topGear = startGear
  const time = drive(world, truck, input, 60, () => {
    topGear = Math.max(topGear, truck.gear)
    return truck.speedKph >= 60
  })
  console.log(`  RD-10 empty 0-60 km/h ${time.toFixed(1)} s, gear ${startGear} -> ${truck.gear}, rpm ${truck.rpm.toFixed(0)}`)
  assert.ok(time < 40, `0-60 in ${time.toFixed(1)} s`)
  assert.ok(time > 8, `0-60 in ${time.toFixed(1)} s is believable for a 12.5 t truck`)
  assert.ok(topGear >= startGear + 3, `shifted up from ${startGear} to ${topGear}`)
  assert.ok(truck.fuelL < fuel, 'burned fuel')
  const start = truck.body.translation()
  input.throttle = 0
  input.brake = 1
  const stopTime = drive(world, truck, input, 20, () => Math.abs(truck.speed) < 0.05)
  const end = truck.body.translation()
  const distance = Math.hypot(end.x - start.x, end.z - start.z)
  console.log(`  RD-10 empty 60-0 km/h in ${distance.toFixed(1)} m, ${stopTime.toFixed(1)} s`)
  assert.ok(distance < 60, `stopped in ${distance.toFixed(1)} m`)
  assert.ok(distance > 15, `stopped in ${distance.toFixed(1)} m, not instantly`)
  truck.dispose()
  world.dispose()
})

test('a loaded dump truck pulls, brakes in a realistic distance and sits lower without bottoming out', async () => {
  const world = await FlatWorld.create()
  const model = TRUCK_BY_ID['bedrock-quad']
  const truck = new TruckRig(world, model, { x: 0, z: 0, heading: 0 })
  settle(world, truck)
  const bedHeight = (): number => toWorld(truck.pose(), { x: 0, y: 0, z: -6 }).y
  const emptyHeight = bedHeight()
  assert.equal(truck.liftAxlesDown, false, 'lift axles raised while empty')
  truck.setPayload(model.dump!.capacityKg)
  settle(world, truck, 2.5)
  assert.ok(Math.abs(truck.body.mass() - (model.massKg + model.dump!.capacityKg)) < 1, `mass ${truck.body.mass()}`)
  assert.equal(truck.liftAxlesDown, true, 'lift axles down under load')
  const loaded = bedHeight()
  const front = truck.pose().position.y
  console.log(`  quad frame over the drives: empty ${emptyHeight.toFixed(3)} m, loaded ${loaded.toFixed(3)} m; front ${front.toFixed(3)} m`)
  assert.ok(loaded < emptyHeight - 0.03, 'sits lower loaded')
  assert.ok(loaded > -0.08 && front > -0.08, 'not bottomed out')
  for (let i = 0; i < truck.wheels.count; i++) assert.ok(truck.wheels.normal[i] > 0, `wheel ${i} carries load`)
  const input = emptyInput()
  input.throttle = 1
  const time = drive(world, truck, input, 90, () => truck.speedKph >= 80)
  const start = truck.body.translation()
  input.throttle = 0
  input.brake = 1
  drive(world, truck, input, 25, () => Math.abs(truck.speed) < 0.05)
  const end = truck.body.translation()
  const distance = Math.hypot(end.x - start.x, end.z - start.z)
  console.log(`  quad loaded (39.5 t) 0-80 km/h ${time.toFixed(1)} s, 80-0 km/h in ${distance.toFixed(1)} m`)
  assert.ok(time < 80, `0-80 loaded in ${time.toFixed(1)} s`)
  assert.ok(distance > 35 && distance < 75, `loaded stop from 80 km/h in ${distance.toFixed(1)} m`)
  truck.dispose()
  world.dispose()
})

test('steering turns left for + input and its lock falls off with speed', async () => {
  assert.ok(Math.abs(steerLock(0) - MAX_STEER) < 1e-9)
  assert.ok(steerLock(25) < MAX_STEER * 0.15)
  const world = await FlatWorld.create()
  const truck = new TruckRig(world, TRUCK_BY_ID['kestrel-cx-day'], { x: 0, z: 0, heading: 0 })
  settle(world, truck)
  const input = emptyInput()
  input.throttle = 0.4
  drive(world, truck, input, 4)
  input.steer = 1
  input.throttle = 0.25
  const before = headingOf(truck.pose().rotation)
  drive(world, truck, input, 3)
  const after = headingOf(truck.pose().rotation)
  assert.ok(after - before > 0.4, `heading ${before.toFixed(2)} -> ${after.toFixed(2)}`)
  const wheels = truck.pose().wheels
  assert.ok(wheels[0].steer > wheels[1].steer && wheels[1].steer > 0, 'Ackermann: inner (left) wheel steers more')
  truck.dispose()
  world.dispose()
})

test('reverse, the jake brake and the parking brake on a 10 % grade', async () => {
  const world = await FlatWorld.create()
  const truck = new TruckRig(world, DUMP, { x: 0, z: 0, heading: 0 })
  settle(world, truck)
  const input = emptyInput()
  input.shiftDown = true
  drive(world, truck, input, 0.1)
  assert.equal(truck.gear, -1, 'shift down at a stop selects reverse')
  input.throttle = 0.6
  drive(world, truck, input, 4)
  assert.ok(truck.speed < -0.5, `reversing at ${truck.speed.toFixed(2)} m/s`)
  assert.ok(truck.pose().reversing)
  input.throttle = 0
  input.brake = 1
  drive(world, truck, input, 3)
  input.brake = 0
  input.shiftUp = true
  drive(world, truck, input, 0.1)
  assert.ok(truck.gear >= 1, 'shift up at a stop selects drive')

  const coast = (jake: boolean): number => {
    truck.teleport(0, 0, 0)
    settle(world, truck, 0.5)
    const run = emptyInput()
    run.throttle = 1
    drive(world, truck, run, 60, () => truck.speedKph >= 70)
    run.throttle = 0
    run.engineBrake = jake
    const from = truck.speedKph
    drive(world, truck, run, 6)
    return from - truck.speedKph
  }
  const plain = coast(false)
  const jake = coast(true)
  console.log(`  coasting 6 s from 70 km/h loses ${plain.toFixed(1)} km/h, with the jake ${jake.toFixed(1)} km/h`)
  assert.ok(jake > plain * 1.5, 'the jake brake slows the truck harder than coasting')
  truck.dispose()

  const grade = Math.atan(0.1)
  const slope = world.world.createCollider(
    world.rapier.ColliderDesc.cuboid(60, 1, 60).setTranslation(500, 5, 0).setRotation({ x: Math.sin(grade / 2), y: 0, z: 0, w: Math.cos(grade / 2) }).setCollisionGroups(MASK.ground),
  )
  world.tick()
  const parked = new TruckRig(world, DUMP, { x: 500, z: 0, heading: 0, y: 7 })
  parked.setPayload(14000)
  settle(world, parked, 3)
  const a = parked.body.translation()
  settle(world, parked, 10)
  const b = parked.body.translation()
  const creep = Math.hypot(b.x - a.x, b.z - a.z)
  console.log(`  loaded on a 10 % grade, parking brake: crept ${(creep * 100).toFixed(1)} cm in 10 s`)
  assert.ok(creep < 0.05, `held on the grade (crept ${creep.toFixed(3)} m)`)
  parked.dispose()
  world.world.removeCollider(slope, false)
  world.dispose()
})

test('a crash into a wall reports an impact; teleport is quiet', async () => {
  const world = await FlatWorld.create()
  const truck = new TruckRig(world, TRUCK_BY_ID['kestrel-cx-day'], { x: 0, z: 0, heading: 0 })
  const impacts: number[] = []
  truck.onImpact = (dv) => impacts.push(dv)
  settle(world, truck)
  truck.teleport(0, 5, 0)
  settle(world, truck, 1)
  assert.equal(impacts.length, 0, 'no impact from a teleport or settling')
  world.addStaticBox({ x: 0, y: 2, z: 60, hx: 5, hy: 2, hz: 0.5 })
  const input = emptyInput()
  input.throttle = 1
  drive(world, truck, input, 20, () => impacts.length > 0)
  assert.ok(impacts.length > 0 && impacts[0] > 3, `impact ${impacts[0]?.toFixed(1)} m/s`)
  truck.dispose()
  world.dispose()
})
