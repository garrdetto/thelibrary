import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CASINO, FOOTPRINT, LOCAL_ORIGIN, MACHINE_SPOTS, ROOMS, SITE, insideCasino, localToTown, townToLocal } from '../casino/CasinoLayout'
import { MONTELLO_SHOPS } from '../../maplestreet/shared/MontelloPlaces'
import { registerMapPlaces } from '../places/MapPlaces'
import { REPLACED_BUILDINGS } from '../../tello/world/Businesses'
import { doc } from './montello-land'

const foxtails = MONTELLO_SHOPS.find((s) => s.name === "Foxtails Gentlemen's Club")!

test("the casino is Foxtails' own building on 16th Road, on its real footprint, with the doorway at the club's door", () => {
  assert.equal(SITE.name, 'Foxtails Lounge & Casino')
  const club = doc.buildings[SITE.building]
  assert.equal(club.k, 'store')
  assert.equal(club.n, "Foxtails Gentlemen's Club")
  assert.equal(foxtails.street, '16th Road')
  const door = localToTown(CASINO.door.x, CASINO.door.z)
  assert.ok(Math.hypot(door.x - foxtails.x, door.z - foxtails.z) < 3, `the doorway is at the club's door (${door.x}, ${door.z})`)
  for (let k = 0; k < club.p.length; k += 2) {
    const l = townToLocal(club.p[k], -club.p[k + 1])
    const near = Math.min(...FOOTPRINT.map((p) => Math.hypot(p.x - l.x, p.z - l.z)))
    assert.ok(near < 0.15, `footprint corner ${k / 2} is ${near.toFixed(2)} m off the survey`)
  }
  const area = ROOMS.reduce((a, r) => a + (r.x1 - r.x0) * (r.z1 - r.z0), 0)
  assert.ok(Math.abs(area - 465) < 15, `floor area ${area.toFixed(0)} m2`)
})

test("the casino frame and the town frame are each other's inverse, and every machine lands inside the footprint", () => {
  for (const [x, z] of [[100, 66], [116, 105], [108, 78], [104.3, 85.2]]) {
    const t = localToTown(x, z)
    const back = townToLocal(t.x, t.z)
    assert.ok(Math.hypot(back.x - x, back.z - z) < 1e-9)
  }
  const origin = localToTown(LOCAL_ORIGIN.x, LOCAL_ORIGIN.z)
  assert.ok(Math.hypot(origin.x - SITE.x, origin.z - SITE.z) < 1e-9)
  for (const spot of MACHINE_SPOTS) assert.ok(insideCasino(spot.x, spot.z) && insideCasino(spot.seat.x, spot.seat.z))
})

test('no street runs through the club and no other building stands inside it', () => {
  for (const road of doc.roads) {
    if (road.k > 2) continue
    for (let k = 0; k + 3 < road.p.length; k += 2) {
      const steps = Math.max(1, Math.ceil(Math.hypot(road.p[k + 2] - road.p[k], road.p[k + 3] - road.p[k + 1]) / 2))
      for (let s = 0; s <= steps; s++) {
        const x = road.p[k] + ((road.p[k + 2] - road.p[k]) * s) / steps
        const z = -(road.p[k + 1] + ((road.p[k + 3] - road.p[k + 1]) * s) / steps)
        const l = townToLocal(x, z)
        assert.ok(!insideCasino(l.x, l.z, road.w / 2), `${road.n} runs through the casino`)
      }
    }
  }
  doc.buildings.forEach((b, i) => {
    if (i === SITE.building) return
    for (let k = 0; k < b.p.length; k += 2) {
      const l = townToLocal(b.p[k], -b.p[k + 1])
      assert.ok(!insideCasino(l.x, l.z), `building ${i} is inside the casino`)
    }
  })
})

test("the map lists the casino, the body shop and Maple Threads, and Tello leaves the club's own shell out", () => {
  const copy = { ...doc, pois: [...doc.pois] }
  registerMapPlaces(copy)
  for (const name of ['Foxtails Lounge & Casino', 'Montello Body & Wheel', 'Maple Threads', 'Fox Outfitters']) assert.ok(copy.pois.some((p) => p.n === name), name)
  assert.ok(REPLACED_BUILDINGS.has("Foxtails Gentlemen's Club"))
})

test('Napralla Tire is back in its own building on the highway, with a dirt drive and no paved lot', () => {
  const poi = doc.pois.find((p) => p.n === 'Napralla Tire')
  assert.ok(poi && poi.i !== undefined && poi.d, 'Napralla Tire is on the map')
  const shop = doc.buildings[poi.i]
  assert.equal(shop.n, 'Napralla Tire')
  assert.equal(shop.k, 'store')
  assert.notEqual(poi.i, SITE.building)
  assert.ok(!doc.lots.some((l) => l.n === 'Foxtails lot'))
  const drive = doc.roads.find((r) => r.n === 'Napralla Tire driveway')
  assert.ok(drive, 'the driveway is drawn')
  assert.equal(drive.k, 5, 'dirt')
  assert.ok(Math.hypot(drive.p[0] - poi.d[0], drive.p[1] - poi.d[1]) < 4, 'it starts at the door')
})
