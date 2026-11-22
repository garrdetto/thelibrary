import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRAILERS, TRUCK_BY_ID, trailerForKind } from '../shared/Catalog'
import type { TrailerModel, TruckModel } from '../shared/Catalog'
import { FlatWorld } from '../sim/SimWorld'
import { TruckRig } from '../sim/TruckRig'
import { TrailerRig } from '../sim/TrailerRig'
import { attachNeck, checkCouple, checkNeck, couple, detachNeck, evaluateCouple, uncouple } from '../sim/Coupling'
import { emptyInput, headingOf, toWorld } from '../sim/types'
import type { DriveInput, Vec3 } from '../sim/types'

const TRACTOR = TRUCK_BY_ID['pinnacle-lh-day']
const LOADS: Record<string, number> = { tanker: 26000, flatbed: 21000, grain: 23500, reefer: 19500, lowboy: 20500 }

interface Rig {
  world: FlatWorld
  truck: TruckRig
  trailer: TrailerRig
  input: DriveInput
}

function step(rig: Rig, seconds: number, each?: () => boolean | void): number {
  const steps = Math.round(seconds * 60)
  for (let i = 0; i < steps; i++) {
    rig.world.tick((h) => {
      rig.truck.update(h, rig.input)
      rig.trailer.update(h)
      rig.input.shiftUp = false
      rig.input.shiftDown = false
    })
    if (each?.() === true) return (i + 1) / 60
  }
  return seconds
}

function upright(q: { x: number; z: number }): number {
  return 1 - 2 * (q.x * q.x + q.z * q.z)
}

async function spawnRig(trailerModel: TrailerModel, tractor: TruckModel = TRACTOR, gap = 2.5): Promise<Rig> {
  const world = await FlatWorld.create()
  const trailer = new TrailerRig(world, trailerModel, { x: 0, z: 0, heading: 0 })
  const truck = new TruckRig(world, tractor, { x: 0, z: gap - (tractor.fifthWheelZ ?? 0), heading: 0 })
  const input = emptyInput()
  input.parkingBrake = true
  const rig = { world, truck, trailer, input }
  step(rig, 2)
  return rig
}

function backUnder(rig: Rig): void {
  rig.input.parkingBrake = false
  rig.input.shiftDown = true
  step(rig, 0.1)
  assert.equal(rig.truck.gear, -1, 'reverse selected')
  creep(rig, () => checkCouple(rig.truck, rig.trailer).distance < 0.12)
}

function creep(rig: Rig, done: () => boolean, speed = 0.6): void {
  step(rig, 60, () => {
    const v = Math.abs(rig.truck.speed)
    rig.input.throttle = Math.max(0, Math.min(0.3, (speed - v) * 0.4))
    rig.input.brake = v > speed * 1.5 ? 0.3 : 0
    return done()
  })
  rig.input.throttle = 0
  rig.input.brake = 1
  step(rig, 1.5)
  rig.input.brake = 0
  rig.input.parkingBrake = true
}

test('uncoupled trailers stand level on their landing gear with the kingpin plate at its height', async () => {
  const world = await FlatWorld.create()
  for (const model of TRAILERS) {
    const trailer = new TrailerRig(world, model, { x: 0, z: 0, heading: 1 })
    for (let i = 0; i < 300; i++) world.tick((h) => trailer.update(h))
    const kingpin = trailer.kingpinWorld()
    const pose = trailer.pose()
    console.log(`  ${model.id}: kingpin plate at ${kingpin.y.toFixed(3)} m`)
    assert.ok(Math.abs(kingpin.y - model.kingpinHeight) < 0.06, `${model.id} plate at ${kingpin.y.toFixed(3)}`)
    assert.ok(upright(pose.rotation) > 0.998, `${model.id} level`)
    assert.ok(Math.hypot(pose.position.x, pose.position.z) < 0.05, `${model.id} stays put`)
    assert.equal(pose.landingGear, 1)
    assert.equal(pose.wheels.length, model.axles.length * 2)
    for (const wheel of pose.wheels) assert.ok(Math.abs(toWorld(pose, wheel).y - wheel.radius) < 0.06, `${model.id} wheel on the ground`)
    trailer.gearTarget = 0
    for (let i = 0; i < 240; i++) world.tick((h) => trailer.update(h))
    assert.ok(trailer.kingpinWorld().y < model.kingpinHeight - 0.2, `${model.id} nose drops with the gear up`)
    trailer.dispose()
  }
  world.dispose()
})

test('coupling checks name what is wrong', async () => {
  const fifth: Vec3 = { x: 0, y: 1.2, z: 0 }
  const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
  assert.equal(evaluateCouple(fifth, 0, at(0.1, 1.22, 0.1), 0, 0).ok, true)
  assert.equal(evaluateCouple(fifth, 0, at(0, 1.22, 0.5), 0, 0).reason, 'too-far')
  assert.equal(evaluateCouple(fifth, 0, at(0, 1.35, 0), 0, 0).reason, 'too-high')
  assert.equal(evaluateCouple(fifth, 0, at(0, 1.12, 0), 0, 0).reason, 'too-low')
  assert.equal(evaluateCouple(fifth, 0, at(0, 1.2, 0), 0.5, 0).reason, 'angle')
  assert.equal(evaluateCouple(fifth, 0, at(0, 1.2, 0), 0, 1.5).reason, 'moving')
  assert.equal(evaluateCouple(fifth, 0, at(0, 1.2, 0), 2 * Math.PI - 0.1, 0).ok, true, 'headings wrap')

  const rig = await spawnRig(trailerForKind('flatbed'))
  assert.equal(checkCouple(rig.truck, rig.trailer).reason, 'too-far')
  assert.equal(couple(rig.truck, rig.trailer).ok, false)
  rig.trailer.gearTarget = 0.6
  step(rig, 2)
  backUnder(rig)
  const low = checkCouple(rig.truck, rig.trailer)
  assert.equal(low.reason, 'too-low', `plate ${low.heightError.toFixed(3)} m below the fifth wheel`)
  rig.trailer.gearTarget = 1
  step(rig, 3)
  assert.equal(checkCouple(rig.truck, rig.trailer).ok, true, 'gear back down: ready')
  rig.input.parkingBrake = false
  rig.input.shiftUp = true
  rig.input.throttle = 0.3
  step(rig, 6)
  rig.input.throttle = 0
  rig.input.brake = 1
  step(rig, 3)
  rig.input.brake = 0
  rig.input.shiftDown = true
  step(rig, 0.1)
  let fast: string | undefined
  creep(rig, () => {
    const check = checkCouple(rig.truck, rig.trailer)
    if (check.distance < 0.3) fast = check.reason
    return check.distance < 0.3
  }, 1.6)
  assert.equal(fast, 'moving', 'backing in too fast is refused')
  const dump = new TruckRig(rig.world, TRUCK_BY_ID['ridgeline-rd10'], { x: 30, z: 0, heading: 0 })
  assert.equal(checkCouple(dump, rig.trailer).reason, 'no-fifth-wheel')
  dump.dispose()
  rig.world.dispose()
})

for (const model of TRAILERS) {
  test(`a semi backs under, couples to the ${model.kind}, raises the gear and pulls it loaded through a 90° turn`, async () => {
    const rig = await spawnRig(model)
    const { truck, trailer } = rig
    trailer.setPayload(LOADS[model.kind])
    step(rig, 1)
    backUnder(rig)
    const check = couple(truck, trailer)
    assert.equal(check.ok, true, `couple: ${check.reason} d=${check.distance.toFixed(2)} h=${check.heightError.toFixed(3)}`)
    assert.equal(truck.trailer, trailer)
    trailer.lines = true
    trailer.gearTarget = 0
    step(rig, 3.5)
    assert.equal(trailer.coupling, 'locked')
    const plate = trailer.kingpinWorld().y - truck.fifthWheelWorld().y
    assert.ok(Math.abs(plate) < 0.03, `kingpin sits on the fifth wheel (${plate.toFixed(3)})`)
    assert.equal(uncouple(truck, trailer).reason, 'gear-up', 'uncoupling refused with the gear up')

    rig.input.parkingBrake = false
    rig.input.shiftUp = true
    rig.input.throttle = 0.5
    step(rig, 30, () => truck.speedKph > 15)
    rig.input.throttle = 0.2
    let worst = 1
    const start = headingOf(truck.pose().rotation)
    rig.input.steer = 1
    step(rig, 30, () => {
      worst = Math.min(worst, upright(trailer.pose().rotation), upright(truck.pose().rotation))
      return headingOf(truck.pose().rotation) - start > Math.PI / 2
    })
    rig.input.steer = 0
    step(rig, 12, () => {
      worst = Math.min(worst, upright(trailer.pose().rotation), upright(truck.pose().rotation))
    })
    const truckHeading = headingOf(truck.pose().rotation)
    const trailerHeading = headingOf(trailer.pose().rotation)
    console.log(`  ${model.kind} ${(LOADS[model.kind] / 1000).toFixed(1)} t: turned ${((truckHeading - start) * 57.3).toFixed(0)}°, trailer within ${(Math.abs(truckHeading - trailerHeading) * 57.3).toFixed(1)}°, least upright ${worst.toFixed(3)}`)
    assert.ok(worst > 0.95, `nothing rolled over (${worst.toFixed(3)})`)
    assert.ok(truckHeading - start > Math.PI / 2 - 0.1, 'the rig turned')
    assert.ok(Math.abs(truckHeading - trailerHeading) < 0.2, 'the trailer followed into line')
    const gap = Math.hypot(trailer.kingpinWorld().x - truck.fifthWheelWorld().x, trailer.kingpinWorld().z - truck.fifthWheelWorld().z)
    assert.ok(gap < 0.05, `joint holds (${gap.toFixed(3)} m)`)

    rig.input.throttle = 0
    rig.input.brake = 1
    step(rig, 20, () => truck.speedKph < 0.2)
    rig.input.brake = 0
    rig.input.parkingBrake = true
    trailer.gearTarget = 1
    step(rig, 3.5)
    assert.equal(uncouple(truck, trailer).ok, true)
    assert.equal(truck.trailer, null)
    rig.input.parkingBrake = false
    rig.input.throttle = 0.4
    step(rig, 4)
    const kingpin = trailer.kingpinWorld().y
    assert.ok(Math.abs(kingpin - model.kingpinHeight) < 0.08, `dropped trailer stands on its gear (${kingpin.toFixed(3)})`)
    truck.dispose()
    trailer.dispose()
    assert.deepEqual(rig.world.counts(), { bodies: 0, colliders: 1, joints: 0 })
    rig.world.dispose()
  })
}

test('a loaded 40 t rig stops from 80 km/h in a realistic distance with trailer brakes on the air lines', async () => {
  const rig = await spawnRig(trailerForKind('tanker'))
  const { truck, trailer } = rig
  trailer.setPayload(26000)
  step(rig, 1)
  backUnder(rig)
  assert.equal(couple(truck, trailer).ok, true)
  trailer.lines = true
  trailer.gearTarget = 0
  step(rig, 3.5)
  rig.input.parkingBrake = false
  rig.input.shiftUp = true
  rig.input.throttle = 1
  const time = step(rig, 120, () => truck.speedKph >= 80)
  const start = truck.body.translation()
  rig.input.throttle = 0
  rig.input.brake = 1
  let lights = false
  step(rig, 30, () => {
    lights ||= trailer.pose().brakeLights
    return truck.speedKph < 0.2
  })
  const end = truck.body.translation()
  const distance = Math.hypot(end.x - start.x, end.z - start.z)
  console.log(`  ${((truck.massKg + trailer.massKg) / 1000).toFixed(1)} t rig: 0-80 km/h ${time.toFixed(1)} s, 80-0 km/h in ${distance.toFixed(1)} m`)
  assert.ok(lights, 'trailer brake lights came on')
  assert.ok(time < 100, `0-80 in ${time.toFixed(1)} s`)
  assert.ok(distance > 40 && distance < 75, `stopped in ${distance.toFixed(1)} m`)
  truck.dispose()
  trailer.dispose()
  rig.world.dispose()
})

test('the RGN gooseneck detaches into a ramp, rides on the tractor and reattaches when backed into line', async () => {
  const model = trailerForKind('lowboy')
  const rig = await spawnRig(model)
  const { truck, trailer } = rig
  backUnder(rig)
  assert.equal(couple(truck, trailer).ok, true)
  trailer.lines = true
  trailer.gearTarget = 0
  step(rig, 3.5)
  assert.equal(detachNeck(rig.truck, rig.trailer).ok, true)
  assert.equal(trailer.neckState, 'lowering')
  step(rig, 4, () => trailer.neckState === 'detached')
  assert.equal(trailer.neckAttached, false)
  step(rig, 1)
  const lip = trailer.lipClearance()
  console.log(`  RGN deck lip ${lip.toFixed(3)} m off the ground after detaching`)
  assert.ok(lip < 0.05, 'deck front rests on the ground')
  const deckTop = trailer.localToWorld({ x: 0, y: model.rgn!.wellHeight, z: model.rgn!.wellFrontZ }).y
  assert.ok(deckTop < 0.15, `ramp lip top at ${deckTop.toFixed(3)} m`)
  assert.equal(uncouple(truck, trailer).ok, false, 'cannot drop a trailer whose neck is off')
  assert.equal(trailer.lines, false, 'air lines go with the neck')

  rig.input.parkingBrake = false
  rig.input.shiftUp = true
  rig.input.throttle = 0.2
  step(rig, 3)
  rig.input.throttle = 0
  rig.input.brake = 1
  step(rig, 2)
  const neck = trailer.pose().gooseneck!
  assert.equal(neck.attached, false)
  const fifth = truck.fifthWheelWorld()
  assert.ok(Math.hypot(neck.position.x - fifth.x, neck.position.z - fifth.z) < 0.01, 'neck rides on the fifth wheel')
  assert.ok(Math.hypot(trailer.pose().position.x, trailer.pose().position.z) < 0.3, 'deck stayed where it was set down')
  assert.equal(checkNeck(truck, trailer).reason, 'too-far')
  assert.equal(attachNeck(truck, trailer).ok, false)

  rig.input.brake = 0
  rig.input.shiftDown = true
  step(rig, 0.1)
  creep(rig, () => checkNeck(truck, trailer).distance < 0.12)
  const line = checkNeck(truck, trailer)
  assert.equal(line.ok, true, `neck lined up: ${line.reason} ${line.distance.toFixed(2)} m ${line.angleDeg.toFixed(1)}°`)
  assert.equal(attachNeck(truck, trailer).ok, true)
  assert.equal(trailer.neckState, 'raising')
  step(rig, 1.2)
  assert.equal(trailer.neckAttached, false, 'still lifting after 1.2 s')
  step(rig, 0.5)
  assert.equal(trailer.neckAttached, true, 'pinned after 1.5 s')
  step(rig, 1)
  const plate = trailer.kingpinWorld().y - truck.fifthWheelWorld().y
  assert.ok(Math.abs(plate) < 0.03, `deck back at riding height (${plate.toFixed(3)})`)
  assert.ok(trailer.lipClearance() > 0.3, 'deck lip lifted clear of the ground')
  assert.equal(trailer.lines, true, 'air lines restored')
  truck.dispose()
  trailer.dispose()
  rig.world.dispose()
})

test('coupling at the edge of the window snaps the kingpin in gently', async () => {
  const world = await FlatWorld.create()
  const model = trailerForKind('reefer')
  const trailer = new TrailerRig(world, model, { x: 0, z: 0, heading: 0 })
  trailer.setPayload(19500)
  const angle = 0.38
  const fz = TRACTOR.fifthWheelZ!
  const truck = new TruckRig(world, TRACTOR, { x: 0.25 - Math.sin(angle) * fz, z: 0.2 - Math.cos(angle) * fz, heading: angle })
  const rig: Rig = { world, truck, trailer, input: emptyInput() }
  rig.input.parkingBrake = true
  step(rig, 2)
  const impacts: number[] = []
  truck.onImpact = (dv) => impacts.push(dv)
  trailer.onImpact = (dv) => impacts.push(dv)
  const check = couple(truck, trailer)
  assert.equal(check.ok, true, `couple at ${check.distance.toFixed(2)} m, ${check.angleDeg.toFixed(1)}°: ${check.reason}`)
  let fastest = 0
  step(rig, 3, () => {
    const a = trailer.body.angvel()
    const v = trailer.body.linvel()
    fastest = Math.max(fastest, Math.hypot(v.x, v.y, v.z), Math.hypot(a.x, a.y, a.z))
  })
  console.log(`  coupled from ${check.distance.toFixed(2)} m and ${check.angleDeg.toFixed(0)}°: fastest trailer motion ${fastest.toFixed(2)} (m/s or rad/s)`)
  assert.equal(trailer.coupling, 'locked')
  assert.ok(fastest < 0.8, 'no jolt')
  assert.equal(impacts.length, 0, 'no impact reported')
  const gap = Math.hypot(trailer.kingpinWorld().x - truck.fifthWheelWorld().x, trailer.kingpinWorld().z - truck.fifthWheelWorld().z)
  assert.ok(gap < 0.02, `kingpin in the jaws (${gap.toFixed(3)} m)`)
  truck.dispose()
  trailer.dispose()
  world.dispose()
})

test('a loaded tanker rig cruises at 90 km/h and changes lanes without swaying or rolling', async () => {
  const rig = await spawnRig(trailerForKind('tanker'), TRUCK_BY_ID['northstar-aero-sleeper'])
  const { truck, trailer } = rig
  trailer.setPayload(26000)
  step(rig, 1)
  backUnder(rig)
  assert.equal(couple(truck, trailer).ok, true)
  trailer.lines = true
  trailer.gearTarget = 0
  step(rig, 3.5)
  rig.input.parkingBrake = false
  rig.input.shiftUp = true
  rig.input.throttle = 1
  step(rig, 150, () => truck.speedKph >= 90)
  rig.input.throttle = 0.45
  let worst = 1
  let sway = 0
  const watch = (): void => {
    worst = Math.min(worst, upright(trailer.pose().rotation), upright(truck.pose().rotation))
    sway = Math.max(sway, Math.abs(trailer.body.angvel().y))
  }
  rig.input.steer = 0.35
  step(rig, 1.2, watch)
  rig.input.steer = -0.35
  step(rig, 1.2, watch)
  rig.input.steer = 0
  step(rig, 8, watch)
  const settled = Math.abs(trailer.body.angvel().y)
  const lateral = truck.pose().position.x
  console.log(`  lane change at ${truck.speedKph.toFixed(0)} km/h: moved ${lateral.toFixed(2)} m across, least upright ${worst.toFixed(4)}, peak trailer yaw rate ${sway.toFixed(3)} rad/s, after 8 s ${settled.toFixed(4)}`)
  assert.ok(worst > 0.99, 'no roll-over')
  assert.ok(Math.abs(lateral) > 1.5, 'the rig moved over a lane')
  assert.ok(settled < 0.01, 'trailer sway dies out')
  assert.ok(truck.speedKph > 80, 'kept its speed')
  truck.dispose()
  trailer.dispose()
  rig.world.dispose()
})

test('disposing a coupled tractor frees its trailer, which stays usable', async () => {
  const world = await FlatWorld.create()
  const trailer = new TrailerRig(world, trailerForKind('flatbed'), { x: 0, z: 0, heading: 0 })
  const truck = new TruckRig(world, TRACTOR, { x: 0, z: 0.1 - TRACTOR.fifthWheelZ!, heading: 0 })
  const rig: Rig = { world, truck, trailer, input: emptyInput() }
  rig.input.parkingBrake = true
  step(rig, 1)
  assert.equal(couple(truck, trailer).ok, true)
  step(rig, 1)
  truck.dispose()
  assert.equal(trailer.tractor, null)
  assert.equal(trailer.joint, null)
  assert.equal(world.counts().joints, 0)
  for (let i = 0; i < 120; i++) world.tick((h) => trailer.update(h))
  assert.ok(Math.abs(trailer.kingpinWorld().y - trailer.model.kingpinHeight) < 0.06, 'stands on its gear')
  trailer.pose()
  trailer.dispose()
  assert.deepEqual(world.counts(), { bodies: 0, colliders: 1, joints: 0 })
  world.dispose()
})
