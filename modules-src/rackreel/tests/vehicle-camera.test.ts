import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LOOK_HOLD, RETURN_SECONDS, VehicleCamera, wrapAngle } from '../systems/VehicleCamera'

const dt = 1 / 60

test('the camera turns with the vehicle while nobody looks around', () => {
  const cam = new VehicleCamera()
  cam.reset(0.3)
  let yaw = 0.3
  let heading = 0.3
  for (let i = 0; i < 120; i++) {
    heading += 0.02
    yaw = cam.follow(yaw, heading, dt)
    assert.ok(Math.abs(wrapAngle(yaw - heading)) < 1e-9, 'always straight behind')
  }
})

test('looking around holds, then the view pans slowly back to the heading', () => {
  const cam = new VehicleCamera()
  cam.reset(0)
  let yaw = cam.follow(0, 0, dt)
  yaw = cam.follow(yaw + 1.2, 0, dt)
  assert.ok(Math.abs(cam.offset - 1.2) < 1e-9, 'the look is kept')
  for (let t = 0; t < LOOK_HOLD - 0.1; t += dt) yaw = cam.follow(yaw, 0, dt)
  assert.ok(Math.abs(cam.offset - 1.2) < 1e-9, 'held while the player may still be looking')
  const before = cam.offset
  for (let t = 0; t < 0.3; t += dt) yaw = cam.follow(yaw, 0, dt)
  assert.ok(cam.offset < before && cam.offset > 0.6, 'easing back, not snapping')
  for (let t = 0; t < RETURN_SECONDS * 6; t += dt) yaw = cam.follow(yaw, 0, dt)
  assert.ok(Math.abs(cam.offset) < 0.01, 'back behind the vehicle')
})

test('a look-around offset is carried through the vehicle\'s turns and across the ±π seam', () => {
  const cam = new VehicleCamera()
  cam.reset(3.1)
  let yaw = cam.follow(3.1, 3.1, dt)
  yaw = cam.follow(yaw - 0.5, 3.1, dt)
  let heading = 3.1
  for (let i = 0; i < 20; i++) {
    heading = wrapAngle(heading + 0.01)
    yaw = cam.follow(yaw, heading, dt)
  }
  assert.ok(Math.abs(cam.offset + 0.5) < 1e-9, 'the offset stays while the vehicle turns past π')
  assert.ok(Math.abs(wrapAngle(yaw - heading + 0.5)) < 1e-9)
})

test('the camera yaw never jumps by a whole turn', () => {
  const cam = new VehicleCamera()
  cam.reset(0)
  let yaw = 0
  let heading = 0
  for (let i = 0; i < 2000; i++) {
    heading += 0.01
    const next = cam.follow(yaw, heading, dt)
    assert.ok(Math.abs(next - yaw) < 0.05)
    yaw = next
  }
})
