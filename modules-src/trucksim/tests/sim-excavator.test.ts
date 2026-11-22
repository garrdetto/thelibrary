import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRUCK_BY_ID, trailerForKind } from '../shared/Catalog'
import { BOOM_LIMITS, EXCAVATOR_MASS_KG, ExcavatorRig, TRAVEL_SPEED } from '../sim/ExcavatorRig'
import { FlatWorld } from '../sim/SimWorld'
import { TruckRig } from '../sim/TruckRig'
import { TrailerRig } from '../sim/TrailerRig'
import { attachNeck, checkNeck, couple, detachNeck, worldToLocal } from '../sim/Coupling'
import { emptyInput, emptyMachineInput, headingOf } from '../sim/types'

test('the excavator tracks forward at travel speed, pivots on the spot and moves its arm within limits', async () => {
  const world = await FlatWorld.create()
  const machine = new ExcavatorRig(world, { x: 0, z: 0, heading: 0 })
  const input = emptyMachineInput()
  const run = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) world.tick((h) => machine.update(h, input))
  }
  run(2)
  const rest = machine.pose()
  assert.ok(Math.abs(rest.position.y) < 0.05, `stands on its rollers at ${rest.position.y.toFixed(3)} m`)
  assert.ok(Math.hypot(rest.position.x, rest.position.z) < 0.02, 'stays put')
  input.drive = 1
  run(6)
  const moving = machine.pose()
  console.log(`  excavator travel ${machine.speed.toFixed(2)} m/s, ${moving.position.z.toFixed(1)} m in 6 s`)
  assert.ok(Math.abs(machine.speed - TRAVEL_SPEED) < 0.1, `travels at ${machine.speed.toFixed(2)} m/s`)
  assert.ok(Math.abs(moving.position.x) < 0.1 && moving.position.z > 6, 'straight ahead')
  assert.ok(machine.trackL > 6 && machine.trackR > 6, 'treads scroll')
  input.drive = 0
  run(3)
  const stopped = machine.pose().position
  input.turn = 1
  const before = headingOf(machine.pose().rotation)
  run(4)
  const after = machine.pose()
  assert.ok(headingOf(after.rotation) - before > 1.2, `pivoted ${(headingOf(after.rotation) - before).toFixed(2)} rad`)
  assert.ok(Math.hypot(after.position.x - stopped.x, after.position.z - stopped.z) < 0.3, 'counter-rotates on the spot')
  assert.ok(machine.trackL < machine.trackR, 'left track runs back in a left pivot')
  input.turn = 0
  input.boom = 1
  input.swing = 1
  run(8)
  assert.equal(machine.boom, BOOM_LIMITS[1])
  assert.ok(machine.swing > 7)
  machine.dispose()
  world.dispose()
})

test('the excavator climbs onto a detached RGN deck, is chained down and rides as payload', async () => {
  const world = await FlatWorld.create()
  const tractor = TRUCK_BY_ID['pinnacle-lh-day']
  const model = trailerForKind('lowboy')
  const rgn = model.rgn!
  const trailer = new TrailerRig(world, model, { x: 0, z: 0, heading: 0 })
  const truck = new TruckRig(world, tractor, { x: 0, z: 0.1 - tractor.fifthWheelZ!, heading: 0 })
  const machine = new ExcavatorRig(world, { x: 0, z: 0.6, heading: Math.PI })
  const drive = emptyInput()
  const control = emptyMachineInput()
  drive.parkingBrake = true
  const run = (seconds: number, done?: () => boolean): number => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      world.tick((h) => {
        truck.update(h, drive)
        trailer.update(h)
        machine.update(h, control)
        drive.shiftUp = false
        drive.shiftDown = false
      })
      if (done?.()) return (i + 1) / 60
    }
    return seconds
  }
  machine.teleport(0, 30, Math.PI)
  run(1)
  assert.equal(couple(truck, trailer).ok, true, 'coupled')
  trailer.lines = true
  trailer.gearTarget = 0
  run(3.5)
  assert.equal(detachNeck(truck, trailer).ok, true, 'detaching')
  run(4, () => trailer.neckState === 'detached')
  drive.parkingBrake = false
  drive.throttle = 0.25
  run(30, () => truck.body.translation().z > 18)
  drive.throttle = 0
  drive.brake = 1
  run(3)
  drive.parkingBrake = true
  const lip = trailer.localToWorld({ x: 0, y: 0, z: rgn.neckRearZ })
  machine.teleport(lip.x, lip.z + 3.2, Math.PI)
  run(1)
  const local = { x: 0, y: 0, z: 0 }
  const onDeck = (): { x: number; y: number; z: number } => worldToLocal(trailer.readState(), machine.pose().position, local)
  control.drive = 0.6
  const climb = run(40, () => onDeck().z < (rgn.wellFrontZ + rgn.wellRearZ) / 2 + 0.3)
  control.drive = 0
  run(3)
  const where = onDeck()
  console.log(`  excavator climbed the ramp in ${climb.toFixed(1)} s and stopped at deck z ${where.z.toFixed(2)}, ${where.y.toFixed(2)} m above the deck frame`)
  assert.ok(climb < 40, 'reached the well')
  assert.ok(Math.abs(where.y - rgn.wellHeight) < 0.2, 'standing on the well deck')
  const secured = machine.secureTo(trailer)
  assert.equal(secured.ok, true, `secure: ${secured.reason}`)
  assert.equal(trailer.payloadKg, EXCAVATOR_MASS_KG)
  assert.equal(machine.secureTo(trailer).ok, false, 'already chained')

  drive.parkingBrake = false
  drive.brake = 0
  drive.shiftDown = true
  run(0.1)
  const creep = (done: () => boolean): void => {
    run(60, () => {
      const v = Math.abs(truck.speed)
      drive.throttle = Math.max(0, Math.min(0.3, (0.6 - v) * 0.4))
      return done()
    })
    drive.throttle = 0
    drive.brake = 1
    run(1.5)
    drive.brake = 0
    drive.parkingBrake = true
  }
  creep(() => checkNeck(truck, trailer).distance < 0.12)
  const line = attachNeck(truck, trailer)
  assert.equal(line.ok, true, `attach: ${line.reason} ${line.distance.toFixed(2)} m ${line.angleDeg.toFixed(1)}°`)
  run(2.5)
  assert.equal(trailer.neckAttached, true, 'neck pinned')
  const plate = trailer.kingpinWorld().y - truck.fifthWheelWorld().y
  assert.ok(Math.abs(plate) < 0.04, `deck raised with 20.5 t aboard (${plate.toFixed(3)})`)

  drive.parkingBrake = false
  drive.brake = 0
  drive.shiftUp = true
  drive.throttle = 0.5
  run(15)
  const ride = machine.pose()
  const expected = trailer.localToWorld({ x: where.x, y: where.y, z: where.z })
  const slip = Math.hypot(ride.position.x - expected.x, ride.position.y - expected.y, ride.position.z - expected.z)
  console.log(`  hauled at ${truck.speedKph.toFixed(0)} km/h with the excavator chained down (moved ${slip.toFixed(3)} m on the deck)`)
  assert.ok(truck.speedKph > 25, 'the rig pulls the load away')
  assert.ok(slip < 0.25, 'machine rides with the deck')

  drive.throttle = 0
  drive.brake = 1
  run(10, () => truck.speedKph < 0.2)
  machine.release({ x: 20, z: -10, heading: 0 })
  assert.equal(machine.secured, null)
  assert.equal(trailer.payloadKg, 0)
  control.drive = 0
  run(2)
  assert.ok(Math.abs(machine.pose().position.y) < 0.06, 'released onto the ground')
  machine.dispose()
  trailer.dispose()
  truck.dispose()
  assert.equal(world.counts().bodies, 0)
  world.dispose()
})

test('a chained-down excavator drops back to a free machine when its trailer is disposed', async () => {
  const world = await FlatWorld.create()
  const model = trailerForKind('lowboy')
  const trailer = new TrailerRig(world, model, { x: 0, z: 0, heading: 0 })
  const machine = new ExcavatorRig(world, { x: 0, z: 0, heading: 0 })
  const control = emptyMachineInput()
  const deck = trailer.localToWorld({ x: 0, y: 0, z: -7.3 })
  machine.teleport(deck.x, deck.z, Math.PI, model.rgn!.wellHeight + 0.05)
  for (let i = 0; i < 90; i++) world.tick((h) => {
    trailer.update(h)
    machine.update(h, control)
  })
  assert.equal(machine.secureTo(trailer).ok, true)
  trailer.dispose()
  const riding = machine.pose().position.y
  assert.equal(machine.secured, null)
  assert.ok(riding > 0.4, `was riding on the deck at ${riding.toFixed(2)} m`)
  for (let i = 0; i < 120; i++) world.tick((h) => machine.update(h, control))
  assert.ok(machine.pose().position.y < riding - 0.4, 'falls to the ground once the deck is gone')
  assert.ok(Math.abs(machine.pose().position.y) < 0.08, 'lands on its rollers')
  machine.dispose()
  assert.deepEqual(world.counts(), { bodies: 0, colliders: 1, joints: 0 })
  world.dispose()
})
