import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { isGzip, parseGrids, type MapDoc } from '../../tello/data/MapData'
import { emptyEdits } from '../../tello/edits/WorldEdits'
import { foxLakeLand } from '../lake/Land'
import { TRUCK_EDIT_PREFIX, clearTruckGround, truckEdits } from '../trucks/TruckEdits'
import { HAULERS_LANE, MONTELLO_LOTS, MONTELLO_SITES } from '../../trucksim/shared/montello/MontelloWorld'

const dir = 'public/modules/tello/'
const doc = JSON.parse(readFileSync(`${dir}montello.json`, 'utf8')) as MapDoc
const packed = new Uint8Array(readFileSync(`${dir}montello.bin`))
const freshGrids = () => parseGrids(isGzip(packed) ? new Uint8Array(gunzipSync(packed)) : packed)
const grids = freshGrids()
const ops = truckEdits(doc, grids)
const edits = { ...emptyEdits(), ops }
const land = foxLakeLand(doc, grids, edits)

test('the truck edits all apply, with stable ids', () => {
  assert.ok(ops.length > 40)
  assert.ok(ops.every((op) => op.id.startsWith(TRUCK_EDIT_PREFIX)))
  assert.equal(new Set(ops.map((op) => op.id)).size, ops.length, 'ids are unique')
  assert.deepEqual(land.edits?.skipped ?? [], [], 'no edit skipped')
  assert.deepEqual(truckEdits(JSON.parse(readFileSync(`${dir}montello.json`, 'utf8')) as MapDoc, freshGrids()), ops, 'the same edits every load (from the map before any edit)')
})

test('Haulers Lane runs north off State Highway 23 as a street', () => {
  const lane = land.doc.roads.find((r) => r.n === 'Haulers Lane')
  assert.ok(lane, 'the lane is on the map')
  const zs = lane.p.filter((_v, k) => k % 2 === 1)
  assert.ok(Math.min(...zs) <= -HAULERS_LANE.z0 + 5 && Math.max(...zs) >= -HAULERS_LANE.z1 - 5, `runs ${Math.min(...zs).toFixed(0)}..${Math.max(...zs).toFixed(0)}`)
  assert.ok(land.doc.roads.filter((r) => r.n === 'Driveway').length >= 10, 'sites have driveways')
})

test('every truck lot and outskirts site is level enough to build and drive on', () => {
  for (const lot of MONTELLO_LOTS) {
    let lo = Infinity, hi = -Infinity
    for (let x = lot.x + 5; x <= lot.x + lot.w - 5; x += 10) {
      for (let z = lot.z + 5; z <= lot.z + lot.d - 5; z += 10) {
        const h = land.heightAt(x, -z)
        lo = Math.min(lo, h)
        hi = Math.max(hi, h)
      }
    }
    assert.ok(hi - lo < 0.35, `lot ${lot.index} varies ${(hi - lo).toFixed(2)} m`)
  }
  for (const site of MONTELLO_SITES) {
    if (site.w <= 60 || site.kind === 'lotDistrict') continue
    let lo = Infinity, hi = -Infinity
    for (let x = site.x - site.w / 2 + 8; x <= site.x + site.w / 2 - 8; x += 16) {
      for (let z = site.z - site.d / 2 + 8; z <= site.z + site.d / 2 - 8; z += 16) {
        const h = land.heightAt(x, -z)
        lo = Math.min(lo, h)
        hi = Math.max(hi, h)
      }
    }
    assert.ok(hi - lo < 0.5, `${site.name} varies ${(hi - lo).toFixed(2)} m`)
  }
})

test('no meadow grass grows on the truck lots or the outskirts sites', () => {
  const bareLand = foxLakeLand(doc, freshGrids(), edits)
  clearTruckGround(bareLand)
  for (const lot of MONTELLO_LOTS) {
    for (const [x, z] of [[lot.x + 2, lot.z + 2], [lot.x + lot.w / 2, lot.z + lot.d / 2], [lot.x + lot.w - 2, lot.z + lot.d - 2]]) {
      assert.equal(bareLand.grassAt(x, -z), false, `lot ${lot.index} at (${x}, ${z})`)
    }
  }
  for (const site of MONTELLO_SITES) {
    if (site.w <= 60 || site.kind === 'lotDistrict') continue
    assert.equal(bareLand.grassAt(site.x, -site.z), false, site.id)
  }
})
