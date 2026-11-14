import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error plain ES module script
import { TOWN_OFFSET as SCRIPT_OFFSET } from '../../../scripts/montello-places.mjs'
import { TOWN_OFFSET } from '../region'
import { PUMPS } from '../places/Fuel'
import { PLACES } from '../places/Places'
import { SHOP_ITEMS } from '../../maplestreet/shared/Economy'
import { GAS_STATION } from '../../maplestreet/shared/WorldLayout'
import { MONTELLO_PUMPS } from '../../maplestreet/shared/MontelloPlaces'

test('the Montello table is written in the same town frame Fox Lake places the town in', () => {
  assert.deepEqual(SCRIPT_OFFSET, TOWN_OFFSET)
})

test('every pump in Fox Lake belongs to a station, with a side to park on', () => {
  assert.equal(PUMPS.length, GAS_STATION.pumps.length + MONTELLO_PUMPS.length)
  const stations = new Set(PUMPS.map((p) => p.station))
  for (const name of [GAS_STATION.name, 'Kwik Trip', 'BP']) assert.ok(stations.has(name), name)
  for (const p of PUMPS) assert.ok(p.side === 1 || p.side === -1)
})

test('the counters: every shop has a menu, Kwik Trip and the depot hire drivers, the fire station takes volunteers', () => {
  for (const p of PLACES) {
    if (p.kind === 'bank' || p.kind === 'depot' || p.kind === 'fire' || p.kind === 'clothing' || p.kind === 'dealer') continue
    assert.ok((SHOP_ITEMS[p.kind] ?? []).length > 0, `${p.name} sells something`)
  }
  assert.equal(PLACES.find((p) => p.name === 'Kwik Trip')?.work, 'montello')
  assert.equal(PLACES.find((p) => p.kind === 'depot')?.work, 'delivery')
  assert.equal(PLACES.find((p) => p.kind === 'fire')?.work, 'fire')
  assert.equal(PLACES.filter((p) => p.area === 'montello' && p.kind === 'bar').length, 4)
  assert.equal(new Set(PLACES.map((p) => p.id)).size, PLACES.length, 'ids are unique')
})
