import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AIRPORTS, airportById, pavementAt } from '../shared/Airports'
import { TERRAIN } from '../shared/Terrain'
import { airportTraffic, trafficNear } from '../shared/Traffic'
import type { TrafficPose } from '../shared/Traffic'

const WINDS: [number, number][] = [[0, 0], [90, 6], [200, 8], [315, 5]]

test('traffic moves smoothly, stays clear of the terrain and lands and departs on the runway', () => {
  for (const airport of AIRPORTS) {
    for (const [from, speed] of WINDS) {
      const previous = new Map<string, TrafficPose>()
      const poses: TrafficPose[] = []
      for (let t = 36000; t < 36000 + 3600; t += 1) {
        const count = airportTraffic(airport, t, from, speed, poses, 0)
        for (let i = 0; i < count; i++) {
          const p = poses[i]
          const label = `${airport.id} ${p.key} wind ${from} at t=${t}`
          const before = previous.get(p.key)
          if (before) {
            const moved = Math.hypot(p.x - before.x, p.y - before.y, p.z - before.z)
            assert.ok(moved < Math.max(p.speed, before.speed) * 1.2 + 1, `${label} jumped ${moved.toFixed(0)} m`)
          }
          previous.set(p.key, { ...p })
          if (p.onGround) {
            assert.equal(pavementAt(p.x, p.z), 'runway', `${label} on the runway`)
            assert.equal(p.y, airport.elevation)
          } else if (pavementAt(p.x, p.z) !== 'runway') {
            const ground = TERRAIN.heightAt(p.x, p.z)
            assert.ok(p.y - ground > (p.kind === 'circuit' ? 150 : 5), `${label} ${(p.y - ground).toFixed(0)} m above ground`)
          }
        }
      }
    }
  }
})

test('an airport’s runway is never used by two movements at once', () => {
  const poses: TrafficPose[] = []
  for (const airport of AIRPORTS) {
    for (let t = 0; t < 86400; t += 2) {
      const count = airportTraffic(airport, t, 270, 5, poses, 0)
      let onRunway = 0
      for (let i = 0; i < count; i++) if (poses[i].onGround) onRunway++
      assert.ok(onRunway <= 1, `${airport.id} at ${t}: ${onRunway} on the runway`)
    }
  }
})

test('traffic is the same for everyone at the same time and busiest at the hub', () => {
  const a: TrafficPose[] = []
  const b: TrafficPose[] = []
  const hub = airportById('halvard')!
  const na = trafficNear(hub.x, hub.z, 5000, 50000, 120, 4, a)
  const nb = trafficNear(hub.x, hub.z, 5000, 50000, 120, 4, b)
  assert.deepEqual(a.slice(0, na), b.slice(0, nb))
  const count = (id: string) => {
    let total = 0
    const out: TrafficPose[] = []
    for (let t = 0; t < 7200; t += 60) total += airportTraffic(airportById(id)!, t, 0, 0, out, 0)
    return total
  }
  assert.ok(count('halvard') > count('ashby'))
  assert.equal(count('cragnotch'), 0)
})
