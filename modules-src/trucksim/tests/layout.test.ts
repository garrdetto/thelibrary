import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ALL_ZONES, LOTS, ROADS, SITES, WORLD_HALF, inRect, lotSpawn } from '../shared/WorldLayout'
import { Terrain } from '../shared/Terrain'
import { headingOf, toWorld } from '../sim/types'
import { BUILDINGS, CARGOS, TRAILERS, TRUCKS, defaultLook, lookCost } from '../shared/Catalog'

const terrain = new Terrain()

function overlaps(a: { x: number; z: number; w: number; d: number }, b: { x: number; z: number; w: number; d: number }): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2
}

const lotRect = (lot: (typeof LOTS)[number]) => ({ x: lot.x + lot.w / 2, z: lot.z + lot.d / 2, w: lot.w, d: lot.d })

test('every zone sits inside its site', () => {
  for (const zone of ALL_ZONES) {
    const site = SITES.find((s) => s.id === zone.site)
    assert.ok(site, zone.id)
    assert.ok(inRect(site, zone.x - zone.w / 2, zone.z - zone.d / 2) && inRect(site, zone.x + zone.w / 2, zone.z + zone.d / 2), `${zone.id} outside ${site.id}`)
  }
})

test('work sites do not overlap each other and stay inside the world', () => {
  const work = SITES.filter((s) => s.kind !== 'town' && s.kind !== 'lotDistrict')
  for (const site of SITES) {
    assert.ok(Math.abs(site.x) + site.w / 2 < WORLD_HALF - 40 && Math.abs(site.z) + site.d / 2 < WORLD_HALF - 40, site.id)
  }
  for (let i = 0; i < work.length; i++) {
    for (let j = i + 1; j < work.length; j++) assert.ok(!overlaps(work[i], work[j]), `${work[i].id} overlaps ${work[j].id}`)
  }
})

test('every site is reached by a road', () => {
  for (const site of SITES) {
    const reached = ROADS.some((road) => road.points.some(([x, z]) => inRect(site, x, z, 40)))
    assert.ok(reached, `${site.id} has no road`)
  }
})

test('lots are separate, clear of Haulers Row and of the work sites', () => {
  const work = SITES.filter((s) => s.kind !== 'lotDistrict')
  for (let i = 0; i < LOTS.length; i++) {
    const a = lotRect(LOTS[i])
    assert.ok(Math.abs(a.x - -900) - a.w / 2 >= 6, `lot ${i} on the road`)
    for (let j = i + 1; j < LOTS.length; j++) assert.ok(!overlaps(a, lotRect(LOTS[j])), `lots ${i} and ${j}`)
    for (const site of work) assert.ok(!overlaps(a, site), `lot ${i} overlaps ${site.id}`)
    const spawn = lotSpawn(LOTS[i])
    assert.ok(inRect(a, spawn.x, spawn.z), `lot ${i} spawn outside`)
  }
})

test('roads stay drivable: grades under 8 % and heights finite', () => {
  for (const road of ROADS) {
    const pts = road.points
    const count = road.loop ? pts.length : pts.length - 1
    for (let i = 0; i < count; i++) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[(i + 1) % pts.length]
      const length = Math.hypot(bx - ax, bz - az)
      for (let s = 0; s + 10 <= length; s += 5) {
        const t0 = s / length
        const t1 = (s + 10) / length
        const h0 = terrain.heightAt(ax + (bx - ax) * t0, az + (bz - az) * t0)
        const h1 = terrain.heightAt(ax + (bx - ax) * t1, az + (bz - az) * t1)
        assert.ok(Number.isFinite(h0))
        assert.ok(Math.abs(h1 - h0) / 10 < 0.08, `${road.id} grade ${(Math.abs(h1 - h0) * 10).toFixed(1)}% at ${s}`)
      }
    }
  }
})

test('site pads are flat', () => {
  for (const site of SITES.filter((s) => s.kind !== 'town')) {
    const h0 = terrain.heightAt(site.x, site.z)
    for (const [fx, fz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
      const h = terrain.heightAt(site.x + fx * site.w, site.z + fz * site.d)
      assert.ok(Math.abs(h - h0) < 0.05, `${site.id} pad not flat (${(h - h0).toFixed(3)})`)
    }
  }
})

test('surface reads asphalt on Main Street and gravel on Quarry Road', () => {
  assert.equal(terrain.surfaceAt(300, 0), 'asphalt')
  assert.equal(terrain.surfaceAt(100, 1160), 'gravel')
})

test('pose helpers agree on heading', () => {
  for (const h of [0, 0.7, -2.1, Math.PI / 2]) {
    const q = { x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) }
    assert.ok(Math.abs(headingOf(q) - h) < 1e-9)
    const p = toWorld({ position: { x: 1, y: 2, z: 3 }, rotation: q }, { x: 0, y: 0, z: 1 })
    assert.ok(Math.abs(p.x - (1 + Math.sin(h))) < 1e-9 && Math.abs(p.z - (3 + Math.cos(h))) < 1e-9)
  }
})

test('catalog is consistent', () => {
  const ids = new Set<string>()
  for (const t of TRUCKS) {
    assert.ok(!ids.has(t.id)); ids.add(t.id)
    assert.ok(t.axles[0].z === 0 && t.axles[0].steer)
    assert.ok(t.axles.slice(1).every((a, i) => a.z < t.axles[i].z), `${t.id} axles out of order`)
    assert.ok((t.dump !== undefined) !== (t.fifthWheelZ !== undefined), `${t.id} must be a dump or a tractor`)
    assert.equal(lookCost(defaultLook(t), defaultLook(t)), 0)
  }
  assert.equal(new Set(TRUCKS.filter((t) => t.style === 'dump').map((t) => t.brand)).size, 3)
  assert.deepEqual([...new Set(TRAILERS.map((t) => t.kind))].sort(), ['flatbed', 'grain', 'lowboy', 'reefer', 'tanker'])
  for (const c of CARGOS) assert.ok(c.minKg <= c.maxKg)
  assert.ok(BUILDINGS.some((b) => b.service))
})
