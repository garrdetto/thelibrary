import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CASINO, MACHINE_SPOTS, SITE, localToTown, townToLocal } from '../casino/CasinoLayout'
import { MONTELLO_SHOPS } from '../../maplestreet/shared/MontelloPlaces'
import { registerMapPlaces } from '../places/MapPlaces'
import { REPLACED_BUILDINGS } from '../../tello/world/Businesses'
import { doc } from './montello-land'

const foxtails = MONTELLO_SHOPS.find((s) => s.name === "Foxtails Gentlemen's Club")!

test('the casino stands on the Foxtails lot, turned toward the highway, its floor the size of the old Northwoods Lodge', () => {
  assert.equal(SITE.name, 'Foxtails Lounge & Casino')
  assert.equal(doc.buildings[SITE.building].k, 'store')
  assert.ok(Math.hypot(SITE.x - foxtails.x, SITE.z - foxtails.z) < 30, 'within a lot of the club\'s own door')
  const door = localToTown(CASINO.door.x, CASINO.z0)
  assert.ok(Math.hypot(door.x - foxtails.x, door.z - foxtails.z) < 10, `the doorway is by the club's door (${door.x}, ${door.z})`)
  assert.ok(Math.abs(Math.abs(SITE.yaw) - Math.PI) < 1e-9 || SITE.yaw === 0)
})

test('the casino frame and the town frame are each other\'s inverse, and every machine lands inside the floor', () => {
  for (const [x, z] of [[100, 66], [132, 90], [116, 78], [104.3, 85.2]]) {
    const t = localToTown(x, z)
    const back = townToLocal(t.x, t.z)
    assert.ok(Math.hypot(back.x - x, back.z - z) < 1e-9)
  }
  const middle = localToTown((CASINO.x0 + CASINO.x1) / 2, (CASINO.z0 + CASINO.z1) / 2)
  assert.ok(Math.hypot(middle.x - SITE.x, middle.z - SITE.z) < 1e-9)
  for (const spot of MACHINE_SPOTS) {
    const t = localToTown(spot.x, spot.z)
    assert.ok(Math.abs(t.x - SITE.x) < 16 && Math.abs(t.z - SITE.z) < 12)
  }
})

test('the casino floor clears every street and every other building', () => {
  const x0 = SITE.x - (CASINO.x1 - CASINO.x0) / 2
  const x1 = SITE.x + (CASINO.x1 - CASINO.x0) / 2
  const z0 = SITE.z - (CASINO.z1 - CASINO.z0) / 2
  const z1 = SITE.z + (CASINO.z1 - CASINO.z0) / 2
  for (const road of doc.roads) {
    if (road.k > 2) continue
    for (let k = 0; k + 3 < road.p.length; k += 2) {
      const steps = Math.max(1, Math.ceil(Math.hypot(road.p[k + 2] - road.p[k], road.p[k + 3] - road.p[k + 1]) / 2))
      for (let s = 0; s <= steps; s++) {
        const x = road.p[k] + ((road.p[k + 2] - road.p[k]) * s) / steps
        const z = -(road.p[k + 1] + ((road.p[k + 3] - road.p[k + 1]) * s) / steps)
        assert.ok(!(x > x0 - road.w / 2 && x < x1 + road.w / 2 && z > z0 - road.w / 2 && z < z1 + road.w / 2), `${road.n} runs through the casino`)
      }
    }
  }
  doc.buildings.forEach((b, i) => {
    if (i === SITE.building) return
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity
    for (let k = 0; k < b.p.length; k += 2) {
      bx0 = Math.min(bx0, b.p[k]); bx1 = Math.max(bx1, b.p[k])
      bz0 = Math.min(bz0, -b.p[k + 1]); bz1 = Math.max(bz1, -b.p[k + 1])
    }
    assert.ok(!(bx0 < x1 && bx1 > x0 && bz0 < z1 && bz1 > z0), `building ${i} is inside the casino`)
  })
})

test('the map lists the casino, the body shop and Maple Threads, and Tello leaves the club\'s own shell out', () => {
  const copy = { ...doc, pois: [...doc.pois] }
  registerMapPlaces(copy)
  for (const name of ['Foxtails Lounge & Casino', 'Montello Body & Wheel', 'Maple Threads', 'Fox Outfitters']) assert.ok(copy.pois.some((p) => p.n === name), name)
  assert.ok(REPLACED_BUILDINGS.has("Foxtails Gentlemen's Club"))
})
