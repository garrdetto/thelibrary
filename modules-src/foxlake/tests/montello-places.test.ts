import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { test } from 'node:test'
import { isGzip, parseGrids, type MapDoc } from '../../tello/data/MapData'
import { TelloLand } from '../../tello/region'
import { FoxLakeTerrain, MontelloLink } from '../montello/Link'
import { MONTELLO_AT } from '../region'
import { FOX_LAKE_PLACES, montelloPlaces } from '../dev/Places'

const dir = 'public/modules/tello/'
const doc = JSON.parse(readFileSync(`${dir}montello.json`, 'utf8')) as MapDoc
const packed = new Uint8Array(readFileSync(`${dir}montello.bin`))
const land = new TelloLand(doc, parseGrids(isGzip(packed) ? new Uint8Array(gunzipSync(packed)) : packed), MONTELLO_AT)
const link = new MontelloLink(land)
const terrain = new FoxLakeTerrain(link)
const places = montelloPlaces(land, link.inward[link.inward.length - 1])

/** What the panel's safe-spot search finds: dry ground inside the world within 16 m. */
function dryNear(x: number, z: number): boolean {
  const ok = (px: number, pz: number) => terrain.inBounds(px, pz, 3) && terrain.heightAt(px, pz) > 0.25
  if (ok(x, z)) return true
  for (let r = 2; r <= 16; r += 2) for (let a = 0; a < 12; a++) if (ok(x + Math.cos((a / 12) * Math.PI * 2) * r, z + Math.sin((a / 12) * Math.PI * 2) * r)) return true
  return false
}

test('Montello has its own teleports, each with safe ground to land on', () => {
  assert.ok(places.length >= 20, `${places.length} Montello places`)
  const ids = new Set([...FOX_LAKE_PLACES, ...places].map((p) => p.id))
  assert.equal(ids.size, FOX_LAKE_PLACES.length + places.length, 'ids are unique across the whole list')
  for (const id of ['mt-highway-23', 'mt-city-hall', 'mt-kwik-trip', 'mt-granite-park', 'mt-water-tower', 'mt-weezies', 'mt-lots']) {
    assert.ok(places.some((p) => p.id === id), `the list has ${id}`)
  }
  for (const p of places) {
    assert.equal(p.area, 'Montello')
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z))
    assert.ok(link.owns(p.x, p.z), `${p.label} is on Montello's land`)
    assert.ok(dryNear(p.x, p.z), `${p.label} has dry ground to stand on`)
  }
})

test('every Fox Plains and lake-country place says which part of Fox Lake it is in', () => {
  for (const p of FOX_LAKE_PLACES) assert.ok(p.area === 'Fox Plains' || p.area === 'Lake country', p.label)
  assert.ok(FOX_LAKE_PLACES.some((p) => p.id === 'dock' && p.area === 'Lake country'))
  assert.ok(FOX_LAKE_PLACES.some((p) => p.id === 'casino' && p.area === 'Fox Plains'))
})
