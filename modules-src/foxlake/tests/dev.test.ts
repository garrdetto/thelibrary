import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BUILTIN_TUNING, rideHeight } from '../../maplestreet/shared/Vehicles'
import { formatLeft, restingPose, spotsAround, yawFromHeading, yawFromTownYaw } from '../dev/Placement'
import { townYawToHeading } from '../region'

/** The rotation of a chassis axis by a pose's quaternion. */
function turned(q: { qx: number; qy: number; qz: number; qw: number }, v: [number, number, number]): [number, number, number] {
  const [x, y, z] = v
  const { qx, qy, qz, qw } = q
  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx]
}

test('a spawned vehicle is put a few metres ahead of the administrator, or beside another player', () => {
  const sedan = BUILTIN_TUNING.sedan
  const [ahead, right, left, behind] = spotsAround(10, 20, 0, sedan, 'ahead')
  assert.ok(ahead.x > 10 + sedan.chassis.hx + 3 && Math.abs(ahead.z - 20) < 1e-9, 'ahead is along the chassis +x at yaw 0')
  assert.ok(right.z > 20 && left.z < 20 && behind.x < 10)
  assert.deepEqual(spotsAround(10, 20, 0, sedan, 'beside')[0], right, 'beside a player comes first for them')
  for (const spot of spotsAround(0, 0, 1.1, BUILTIN_TUNING.hdtruck, 'beside')) {
    const d = Math.hypot(spot.x, spot.z)
    assert.ok(d > BUILTIN_TUNING.hdtruck.chassis.hz + 2 && d < 12, 'clear of the player and within reach')
  }
})

test('headings and town yaws turn into the chassis yaw the physics uses', () => {
  for (const yaw of [-2.4, -0.3, 0, 1, 2.9]) {
    const chassis = yawFromTownYaw(yaw)
    assert.ok(Math.abs(Math.cos(chassis) - Math.sin(yaw)) < 1e-9 && Math.abs(-Math.sin(chassis) - Math.cos(yaw)) < 1e-9, 'chassis forward (cos, -sin) is the town forward (sin, cos)')
    const again = yawFromHeading(townYawToHeading(yaw))
    assert.ok(Math.abs(Math.sin(again - chassis)) < 1e-9 && Math.cos(again - chassis) > 0.999, 'the same through a Rack & Reel heading')
  }
})

test('a spawned vehicle rests on the ground: level on the flat, nose up on a climb, leaning on a side slope', () => {
  const sedan = BUILTIN_TUNING.sedan
  for (const yaw of [0, 0.8, -2.2, Math.PI]) {
    const flat = restingPose(() => 1.5, 40, -12, yaw, sedan)
    assert.ok(Math.abs(flat.y - (1.5 + rideHeight(sedan))) < 0.05, 'its centre is a ride height above the ground')
    assert.ok(Math.abs(flat.qx) < 1e-9 && Math.abs(flat.qz) < 1e-9, 'a yaw-only rotation')
    const fwd = turned(flat, [1, 0, 0])
    assert.ok(Math.abs(fwd[0] - Math.cos(yaw)) < 1e-9 && Math.abs(fwd[2] + Math.sin(yaw)) < 1e-9, 'facing the yaw it was given')
    assert.ok(Math.abs(Math.hypot(flat.qx, flat.qy, flat.qz, flat.qw) - 1) < 1e-9)
  }
  const climb = restingPose((x) => x * 0.2, 0, 0, 0, sedan)
  const nose = turned(climb, [1, 0, 0])
  const roof = turned(climb, [0, 1, 0])
  assert.ok(Math.abs(nose[1] / nose[0] - 0.2) < 1e-6, 'the nose follows the slope')
  assert.ok(roof[1] > 0.9 && roof[0] < 0, 'the roof leans back with it')
  const bank = restingPose((_x, z) => z * 0.15, 0, 0, 0, sedan)
  const side = turned(bank, [0, 0, 1])
  assert.ok(Math.abs(side[1] / side[2] - 0.15) < 1e-6 && Math.abs(turned(bank, [1, 0, 0])[1]) < 1e-9, 'the right side follows a side slope')
  const downhill = restingPose((x) => x * 0.2, 0, 0, Math.PI, sedan)
  assert.ok(turned(downhill, [1, 0, 0])[1] < -0.15, 'turned around, the nose points down the same slope')
})

test('the time left reads as minutes and seconds', () => {
  assert.equal(formatLeft(5 * 60 * 1000), '5:00')
  assert.equal(formatLeft(61_001), '1:02')
  assert.equal(formatLeft(900), '0:01')
  assert.equal(formatLeft(-5), '0:00')
})
