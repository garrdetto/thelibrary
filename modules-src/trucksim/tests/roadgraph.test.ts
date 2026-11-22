import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COUNTY, route } from '../shared/RoadGraph'
import { ALL_ZONES, ROADS, ZONE_BY_ID } from '../shared/WorldLayout'
import { generateJobs } from '../shared/Jobs'

function distanceToRoads(x: number, z: number): number {
  let best = Infinity
  for (const road of ROADS) {
    const points = road.loop ? [...road.points, road.points[0]] : road.points
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, az] = points[i]
      const [bx, bz] = points[i + 1]
      const dx = bx - ax
      const dz = bz - az
      const lengthSquared = dx * dx + dz * dz
      const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared))
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)))
    }
  }
  return best
}

test('the county world exposes every site and zone', () => {
  assert.equal(COUNTY.id, 'county')
  assert.equal(COUNTY.zones.length, ALL_ZONES.length)
  assert.equal(COUNTY.zone('quarry:bay1')?.kind, 'dumpLoad')
  assert.equal(COUNTY.site('dealer')?.name, 'Big Rig Motors')
  assert.equal(COUNTY.zone('nope'), undefined)
  assert.ok(COUNTY.zonesOfKind('reeferDock').length >= 6)
})

test('every pair of zones has a finite route distance', () => {
  for (const from of ALL_ZONES) {
    for (const to of ALL_ZONES) {
      const distance = COUNTY.routeDistance(from, to)
      assert.ok(Number.isFinite(distance), `${from.id} to ${to.id}`)
      if (from.id === to.id) assert.ok(distance < 1e-6)
    }
  }
})

test('every pair of zones used by generated jobs has a finite route distance', () => {
  for (let slot = 0; slot < 12; slot++) {
    for (const job of generateJobs(COUNTY, slot, 32)) {
      const from = COUNTY.zone(job.from)
      const to = COUNTY.zone(job.to)
      assert.ok(from && to, job.id)
      const distance = COUNTY.routeDistance(from, to)
      assert.ok(Number.isFinite(distance) && distance > 0, job.id)
    }
  }
})

test('the dealership to quarry route follows roads and is longer than the straight line', () => {
  const dealer = ZONE_BY_ID['dealer:desk']
  const quarry = ZONE_BY_ID['quarry:bay1']
  const result = route(dealer.x, dealer.z, quarry.x, quarry.z)
  const straight = Math.hypot(quarry.x - dealer.x, quarry.z - dealer.z)
  assert.ok(Number.isFinite(result.length))
  assert.ok(result.length > straight * 1.1, `${result.length} vs ${straight}`)
  assert.ok(result.points.length >= 4)
  assert.deepEqual(result.points[0], [dealer.x, dealer.z])
  assert.deepEqual(result.points[result.points.length - 1], [quarry.x, quarry.z])
  for (const [x, z] of result.points.slice(1, -1)) assert.ok(distanceToRoads(x, z) < 0.6, `off road at ${x},${z}`)
  let walked = 0
  for (let i = 1; i < result.points.length; i++) walked += Math.hypot(result.points[i][0] - result.points[i - 1][0], result.points[i][1] - result.points[i - 1][1])
  assert.ok(Math.abs(walked - result.length) < 1e-6)
})

test('routes are symmetric and respect the triangle inequality', () => {
  const a = ZONE_BY_ID['dealer:desk']
  const b = ZONE_BY_ID['refinery:rack1']
  const c = ZONE_BY_ID['cold:dock1']
  const ab = COUNTY.routeDistance(a, b)
  assert.ok(Math.abs(ab - COUNTY.routeDistance(b, a)) < 1e-6)
  assert.ok(COUNTY.routeDistance(a, c) <= ab + COUNTY.routeDistance(b, c) + 1e-6)
})

test('streets that cross mid-block are connected', () => {
  const west = route(-120, -190, -190, 120)
  assert.ok(Number.isFinite(west.length))
  assert.ok(west.length < 600)
})

test('a start point on a road returns a short direct route', () => {
  const result = route(-300, 0, -200, 0)
  assert.ok(Math.abs(result.length - 100) < 1)
})
