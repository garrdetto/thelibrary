import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { isGzip, parseGrids } from '../../tello/data/MapData'
import type { MapDoc } from '../../tello/data/MapData'
import { TelloLand } from '../../tello/region'
import { HAULERS_LANE, MONTELLO, MONTELLO_LOTS, MONTELLO_SITES, MONTELLO_SPAWN, montelloRoute } from '../shared/montello/MontelloWorld'
import { COUNTY } from '../shared/RoadGraph'
import { MONTELLO_DISTANCES, MONTELLO_DISTANCE_ZONES } from '../shared/montello/MontelloDistances'
import { generateJobs, jobSlot } from '../shared/Jobs'
import { applyAction } from '../shared/Actions'
import { defaultProfile, normalizeProfile } from '../shared/Economy'
import { MONTELLO_LOT_BASE, lotSpawn } from '../shared/WorldLayout'

const doc = JSON.parse(readFileSync('public/modules/tello/montello.json', 'utf8')) as MapDoc & { limits: { city: number[] } }
const packed = new Uint8Array(readFileSync('public/modules/tello/montello.bin'))
const land = new TelloLand(doc, parseGrids(isGzip(packed) ? new Uint8Array(gunzipSync(packed)) : packed))
const city = doc.limits.city
/** Town frame (x, z) → map (x, −z). */
const map = (x: number, z: number) => ({ x, z: -z })

function inCity(x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = city.length - 2; i < city.length; j = i, i += 2) {
    const xi = city[i], zi = city[i + 1], xj = city[j], zj = city[j + 1]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

const buildings = doc.buildings.filter((b) => !b.x).map((b) => {
  const xs = b.p.filter((_v, k) => k % 2 === 0), zs = b.p.filter((_v, k) => k % 2 === 1)
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs), n: b.n ?? b.k }
})

/** Buildings overlapping a town-frame rectangle (centre, width along x, depth along z). */
function buildingsIn(cx: number, cz: number, w: number, d: number): string[] {
  const c = map(cx, cz)
  return buildings.filter((b) => b.x1 > c.x - w / 2 && b.x0 < c.x + w / 2 && b.z1 > c.z - d / 2 && b.z0 < c.z + d / 2).map((b) => String(b.n))
}

const NEW_SITES = MONTELLO_SITES.filter((s) => s.w > 60 && s.kind !== 'lotDistrict')

test('new Montello sites stand outside the city limits, on dry land, clear of every building', () => {
  assert.ok(NEW_SITES.length >= 10)
  for (const site of NEW_SITES) {
    const c = map(site.x, site.z)
    assert.equal(inCity(c.x, c.z), false, `${site.name} is outside the city`)
    assert.deepEqual(buildingsIn(site.x, site.z, site.w, site.d), [], `${site.name} is clear of buildings`)
    for (let dx = -site.w / 2; dx <= site.w / 2; dx += 20) for (let dz = -site.d / 2; dz <= site.d / 2; dz += 20) {
      const p = map(site.x + dx, site.z + dz)
      assert.equal(land.waterAt(p.x, p.z), null, `${site.name} is dry at ${dx},${dz}`)
    }
  }
})

test('every zone is dry, clear of buildings and reachable by road from Haulers Lane', () => {
  const start = { x: HAULERS_LANE.x, z: (HAULERS_LANE.z0 + HAULERS_LANE.z1) / 2 }
  for (const zone of MONTELLO.zones) {
    const p = map(zone.x, zone.z)
    assert.equal(land.waterAt(p.x, p.z), null, `${zone.id} is dry`)
    assert.deepEqual(buildingsIn(zone.x, zone.z, zone.w, zone.d), [], `${zone.id} is clear of buildings`)
    const path = montelloRoute(start.x, start.z, zone.x, zone.z)
    assert.ok(Number.isFinite(path.length) && path.length < 25000, `${zone.id} is ${Math.round(path.length)} m away by road`)
    const last = path.points[path.points.length - 2]
    assert.ok(Math.hypot(last[0] - zone.x, last[1] - zone.z) < 70, `${zone.id} lies within 70 m of a road or its site's driveway`)
  }
})

test('Haulers Lane lots sit east of Foxtails, out of town, clear of buildings and of each other', () => {
  assert.equal(MONTELLO_LOTS.length, 16)
  for (const lot of MONTELLO_LOTS) {
    const cx = lot.x + lot.w / 2, cz = lot.z + lot.d / 2
    const c = map(cx, cz)
    assert.ok(c.x > 1750, `lot ${lot.index} is east of Foxtails`)
    assert.equal(inCity(c.x, c.z), false, `lot ${lot.index} is outside the city`)
    assert.deepEqual(buildingsIn(cx, cz, lot.w, lot.d), [], `lot ${lot.index} is clear`)
    for (const other of MONTELLO_LOTS) {
      if (other === lot) continue
      const overlap = lot.x < other.x + other.w && other.x < lot.x + lot.w && lot.z < other.z + other.d && other.z < lot.z + lot.d
      assert.equal(overlap, false, `lots ${lot.index} and ${other.index} overlap`)
    }
    for (const site of NEW_SITES) {
      const overlap = Math.abs(cx - site.x) < (lot.w + site.w) / 2 && Math.abs(cz - site.z) < (lot.d + site.d) / 2
      assert.equal(overlap, false, `lot ${lot.index} overlaps ${site.name}`)
    }
    const spawn = lotSpawn(lot)
    assert.ok(spawn.x > lot.x && spawn.x < lot.x + lot.w && spawn.z > lot.z && spawn.z < lot.z + lot.d)
  }
  const lane = montelloRoute(MONTELLO_SPAWN.x, MONTELLO_SPAWN.z, MONTELLO_LOTS[15].gate.x, MONTELLO_LOTS[15].gate.z)
  assert.ok(lane.length < 1200, `the far lot is ${Math.round(lane.length)} m up the lane`)
})

test('Montello deals jobs for every haul and its lots are its own', () => {
  const jobs = Array.from({ length: 48 }, (_v, k) => generateJobs(MONTELLO, jobSlot(Date.UTC(2026, 10, 22) + k * 30 * 60000))).flat()
  const kinds = new Set(jobs.map((job) => job.haul))
  for (const kind of ['dump', 'tanker', 'flatbed', 'grain', 'reefer', 'lowboy']) assert.ok(kinds.has(kind as never), `a ${kind} job`)
  for (const job of jobs) assert.ok(job.id.startsWith('montello-'), job.id)
  const ctx = { now: 0, world: MONTELLO }
  const fresh = { ...defaultProfile(), cash: 100000 }
  const claimed = applyAction(fresh, { action: 'claim-lot', index: MONTELLO_LOT_BASE + 3 }, ctx)
  assert.equal(claimed.ok, true, claimed.message)
  assert.equal(claimed.profile.lot, MONTELLO_LOT_BASE + 3)
  assert.equal(applyAction(fresh, { action: 'claim-lot', index: 3 }, ctx).ok, false, 'a Haulers Row lot is not a Montello lot')
  assert.equal(applyAction(fresh, { action: 'claim-lot', index: MONTELLO_LOT_BASE }, { now: 0, world: COUNTY }).ok, false)
  assert.equal(normalizeProfile({ ...fresh, lot: MONTELLO_LOT_BASE + 15 }).lot, MONTELLO_LOT_BASE + 15)
  assert.equal(normalizeProfile({ ...fresh, lot: 50 }).lot, null)
})

test('the baked distance table is current (rerun tools/bake-montello-distances.mts when it is not)', () => {
  const zones = MONTELLO_SITES.flatMap((site) => site.zones)
  assert.deepEqual([...MONTELLO_DISTANCE_ZONES], zones.map((z) => z.id), 'the table lists exactly the current zones')
  for (let i = 0; i < zones.length; i += 5) {
    for (let j = 1; j < zones.length; j += 7) {
      if (i === j) continue
      const measured = Math.round(montelloRoute(zones[i].x, zones[i].z, zones[j].x, zones[j].z).length)
      assert.equal(MONTELLO_DISTANCES[i][j], measured, `${zones[i].id} → ${zones[j].id}`)
      assert.equal(MONTELLO.routeDistance(zones[i], zones[j]), measured)
    }
  }
})
