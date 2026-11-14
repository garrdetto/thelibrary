import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { test } from 'node:test'
import { isGzip, parseGrids, type MapDoc } from '../data/MapData'
import { ALL_FRONTS, defaultFront } from '../data/Downtown'
import { LEG_WIDTH, MAIN_SPLIT, mainIsland, PARKING_MIN_HALF, signalPhase, STREET_HALF, townProfiles } from '../data/Streets'
import { pointInRing } from '../world/Poly'
import { TelloLand } from '../region'
import { planFronts } from '../world/Storefronts'
import { lampSpots } from '../world/StreetDressing'

const dir = 'public/modules/tello/'
const doc = JSON.parse(readFileSync(`${dir}montello.json`, 'utf8')) as MapDoc
const packed = new Uint8Array(readFileSync(`${dir}montello.bin`))
const land = new TelloLand(doc, parseGrids(isGzip(packed) ? new Uint8Array(gunzipSync(packed)) : packed))
const plan = planFronts(land)

test('every photographed front matches a store building on its downtown street', () => {
  for (const k of ALL_FRONTS) {
    const front = plan.find((p) => p.style === k.style)
    // A building set back from every street (the white one beside the theatre) keeps its plain walls.
    if (!front && !k.street) continue
    assert.ok(front, k.note)
    assert.ok(Math.hypot(front.b.r[0][0] - k.at[0], front.b.r[0][1] - k.at[1]) < 3, k.note)
    if (k.street) assert.equal(front.street, k.street, k.note)
  }
  const corner = plan.filter((p) => Math.hypot(p.b.r[0][0] - 92, p.b.r[0][1] - 2.4) < 3)
  assert.equal(corner.length, 2, 'the corner building has a front on each street')
  const main = corner.find((p) => p.street === 'Main Street')!
  assert.ok(main.turret, 'the turret goes on the Main Street front')
  const end = main.turret === 'left' ? { x: main.ax, z: -main.az } : { x: main.ax + main.dx * main.len, z: -(main.az + main.dz * main.len) }
  assert.ok(end.z > 5, 'at the West Montello Street corner (the north end)')
  for (const name of ['Tambears', 'Yahooz Sports Bar & Grill']) assert.ok(plan.some((p) => p.b.n === name), name)
})

test('the downtown block is lined with fronts, each facing the street', () => {
  assert.ok(plan.length >= 15, `${plan.length} fronts`)
  const street = doc.roads.filter((r) => r.n === 'West Montello Street' || r.n === 'East Montello Street' || r.n === 'Main Street').flatMap((r) => {
    const pts: [number, number][] = []
    for (let i = 0; i < r.p.length; i += 2) pts.push([r.p[i], -r.p[i + 1]])
    return pts
  })
  for (const p of plan) {
    const mx = p.ax + p.dx * p.len / 2, mz = p.az + p.dz * p.len / 2
    const out = { x: -p.dz, z: p.dx }
    const near = street.reduce((a, b) => (Math.hypot(b[0] - mx, b[1] - mz) < Math.hypot(a[0] - mx, a[1] - mz) ? b : a))
    const toward = (near[0] - mx) * out.x + (near[1] - mz) * out.z
    assert.ok(toward > 0, `${p.b.n || 'a store'} faces the street`)
    assert.ok(p.len >= 3 && p.height >= 4.5 && p.height <= 12)
  }
})

test('fronts nobody photographed are picked from the seed and carry the business name', () => {
  assert.deepEqual(defaultFront(42, 'Weezie\'s Town Pump'), defaultFront(42, 'Weezie\'s Town Pump'))
  assert.equal(defaultFront(42, 'Oyster Crackers').sign?.text, 'Oyster Crackers')
  assert.equal(defaultFront(7).sign, undefined)
})

test('lamp posts line the downtown street and keep clear of the corners', () => {
  const spots = lampSpots(land)
  assert.ok(spots.length >= 8, `${spots.length} posts`)
  const cross = doc.roads.filter((r) => r.k <= 2 && !['West Montello Street', 'East Montello Street', 'Main Street'].includes(r.n))
  for (const s of spots) {
    for (const r of cross) for (let i = 0; i < r.p.length; i += 2) assert.ok(Math.hypot(r.p[i] - s.x, r.p[i + 1] + s.z) > 7, 'a post stands in a crossing')
    assert.ok(Math.abs(Math.hypot(s.out.x, s.out.z) - 1) < 1e-6)
  }
})

test('the water tower is on the map, where the tower stands', () => {
  const tower = doc.pois.find((p) => p.k === 'landmark' && /water tower/i.test(p.n))
  assert.ok(tower)
  assert.ok(Math.hypot(tower.x - 304.3, tower.z - 92.2) < 5)
})

test('downtown streets are one lane each way with a parking lane along both curbs', () => {
  const profiles = townProfiles(doc)
  for (const name of ['West Montello Street', 'East Montello Street', 'Main Street']) {
    let parked = 0, core = 0
    for (const [road, prof] of profiles) {
      if (road.n !== name) continue
      for (let i = 0; i < prof.half.length; i++) {
        const x = prof.pts[i * 2], z = prof.pts[i * 2 + 1]
        assert.ok(prof.half[i] <= STREET_HALF + 1e-6 && prof.half[i] >= road.w / 2 - 1e-6)
        if (x < -30 || x > 230 || z < -100 || z > 40) continue
        core++
        if (prof.half[i] >= PARKING_MIN_HALF) parked++
        assert.ok(land.clearAt(x + 0.01, z) < 0, `${name} is pavement at ${x}, ${z}`)
      }
    }
    assert.ok(core > 20 && parked / core > 0.7, `${name}: parking along ${parked} of ${core} stations`)
  }
})

test('Main Street is one street up to the island, then one lane each side of it to the light', () => {
  const legs = doc.roads.filter((r) => r.n === 'Main Street' && r.w === LEG_WIDTH)
  assert.equal(legs.length, 2)
  const [a, b] = legs
  for (const leg of legs) assert.ok(leg.p.some((_v, k) => k % 2 === 0 && Math.hypot(leg.p[k] - MAIN_SPLIT.x, leg.p[k + 1] - MAIN_SPLIT.z) < 0.01), 'both legs leave the shared street at the split')
  // North of the island's nose the two lanes never overlap.
  for (let k = 0; k < a.p.length; k += 2) {
    if (a.p[k + 1] < MAIN_SPLIT.z + 10) continue
    let d = Infinity
    for (let j = 0; j + 3 < b.p.length; j += 2) {
      const ax = b.p[j], az = b.p[j + 1], dx = b.p[j + 2] - ax, dz = b.p[j + 3] - az
      const t = Math.max(0, Math.min(1, ((a.p[k] - ax) * dx + (a.p[k + 1] - az) * dz) / (dx * dx + dz * dz)))
      d = Math.min(d, Math.hypot(a.p[k] - ax - dx * t, a.p[k + 1] - az - dz * t))
    }
    assert.ok(d >= LEG_WIDTH, `the legs are ${d.toFixed(1)} m apart at z ${a.p[k + 1]}`)
  }
  const island = mainIsland()
  assert.ok(pointInRing(island, 114, 5), 'the island lies between the legs')
  assert.ok(!pointInRing(island, 108, 2.5) && !pointInRing(island, 119.3, 0.7), 'and off both lanes')
  const main = doc.roads.filter((r) => r.n === 'Main Street' && r.w !== LEG_WIDTH && r.p.some((v, k) => k % 2 === 1 && v > -45 && v < 22))
  assert.equal(main.length, 1, 'one shared Main Street south of the split')
})

test('the West Montello Street bridge carries the street level over the river', () => {
  const at = (x: number) => land.heightAt(x, 13.6 + (x - 73.1) * ((15.9 - 13.6) / (82.3 - 73.1)))
  let lo = Infinity, hi = -Infinity
  for (let x = 60; x <= 96; x += 1) {
    lo = Math.min(lo, at(x))
    hi = Math.max(hi, at(x))
  }
  assert.ok(hi - lo < 0.7, `the street rises and falls ${(hi - lo).toFixed(2)} m over the bridge`)
  const deck = land.deckAt(77.7, 14.8)
  assert.ok(deck !== null && deck > 8.2)
  assert.equal(land.depthAt(77.7, 14.8), 0, 'dry on the deck')
  for (const z of [7.5, 22]) {
    const x = 77.7 - (z - 14.8) * 0.37
    const level = land.waterAt(x, z)
    assert.ok(level !== null && land.groundAt(x, z) < level - 0.4, `the river runs under the bridge at z ${z}`)
    assert.ok(deck > level + 2, 'the deck clears the water')
  }
})

test('the light runs a full cycle: the highway and Main Street never both have green', () => {
  const seen = new Set<string>()
  for (let t = 0; t < 120; t += 0.5) {
    const p = signalPhase(t)
    assert.ok(!(p.ew !== 'red' && p.n !== 'red'), `both directions moving at ${t} s`)
    seen.add(`${p.ew}/${p.n}`)
  }
  for (const s of ['green/red', 'amber/red', 'red/red', 'red/green', 'red/amber']) assert.ok(seen.has(s), s)
})
