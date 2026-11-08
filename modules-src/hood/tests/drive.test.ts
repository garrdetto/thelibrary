import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RIGS, alongPath, route } from '../shared/Drive'
import { stopSpot, type Stop } from '../shared/Town'
import { townAt, type TownRequest } from '../shared/TownSim'

const T0 = Date.UTC(2026, 10, 8, 18, 0, 0)

test('vehicles move smoothly: no jumps, no heading snaps, speeds and corner forces within reason', () => {
  const requests: TownRequest[] = [{ lot: 2, kind: 'food', at: T0 + 20_000 }, { lot: 9, kind: 'mow', at: T0 + 60_000 }, { lot: 4, kind: 'fire', at: T0 + 90_000 }]
  const last = new Map<string, { x: number; z: number; yaw: number }>()
  let reversed = false
  for (let i = 0; i < 9000; i++) {
    const s = townAt(2, T0 + i * 100, requests)
    for (const v of s.vehicles) {
      const p = last.get(v.id)
      if (p) {
        const d = Math.hypot(v.x - p.x, v.z - p.z)
        const dy = Math.abs(Math.atan2(Math.sin(v.yaw - p.yaw), Math.cos(v.yaw - p.yaw)))
        assert.ok(d < 2.2, `${v.id} jumped ${d.toFixed(2)} m (${v.act})`)
        assert.ok(dy < 0.35, `${v.id} snapped ${dy.toFixed(2)} rad (${v.act})`)
      }
      assert.ok(Math.abs(v.speed) <= 15.5, `${v.id} at ${v.speed} m/s`)
      assert.ok(Math.abs(v.lat) <= RIGS[v.kind].grip * 1.45, `${v.id} pulls ${v.lat.toFixed(2)} m/s² sideways`)
      assert.ok(Math.abs(v.steer) < 0.8, `${v.id} steers ${v.steer}`)
      if (v.speed < -0.1) reversed = true
      last.set(v.id, { x: v.x, z: v.z, yaw: v.yaw })
    }
    for (const id of [...last.keys()]) if (!s.vehicles.some(v => v.id === id)) last.delete(id)
  }
  assert.ok(reversed, 'somebody backs into a bay')
})

test('a drive starts and ends at rest, accelerates gradually and backs into a bay facing the road', () => {
  const from: Stop = { kind: 'curb', lot: 3 }
  const bay: Stop = { kind: 'bay', place: 'fire', bay: 'e1' }
  const path = route(from, bay, false, 'engine', stopSpot(from))
  assert.equal(alongPath(path, 0).speed, 0)
  const end = alongPath(path, path.duration + 1)
  const spot = stopSpot(bay)
  assert.ok(Math.hypot(end.x - spot.x, end.z - spot.z) < 0.05)
  assert.ok(Math.abs(Math.atan2(Math.sin(end.yaw - spot.yaw), Math.cos(end.yaw - spot.yaw))) < 0.02)
  const early = alongPath(path, 1)
  assert.ok(early.speed > 0 && early.speed < 2, `one second in: ${early.speed}`)
  let backing = false
  for (let t = 0; t < path.duration; t += 0.2) if (alongPath(path, t).speed < -0.1) backing = true
  assert.ok(backing)
})

test('a vehicle parked facing the wrong way turns around in the street', () => {
  const from: Stop = { kind: 'curb', lot: 1 }
  const pose = { ...stopSpot(from), yaw: -Math.PI / 2 }
  const path = route(from, { kind: 'bay', place: 'police', bay: 'p1' }, false, 'cruiser', pose)
  let reverse = 0
  let maxZ = 0
  for (let t = 0; t < path.duration; t += 0.1) {
    const s = alongPath(path, t)
    if (s.speed < -0.05) reverse++
    if (Math.abs(s.x - pose.x) < 25) maxZ = Math.max(maxZ, Math.abs(s.z))
  }
  assert.ok(reverse > 0, 'a three-point turn backs up')
  assert.ok(maxZ < 6.2, `stays on the street (${maxZ.toFixed(2)})`)
})
