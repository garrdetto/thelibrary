import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PUMPS } from '../places/Fuel'
import { PLACES } from '../places/Places'
import { SHOP_ITEMS } from '../../maplestreet/shared/Economy'
import { MONTELLO_PUMPS } from '../../maplestreet/shared/MontelloPlaces'

test('every pump in Fox Lake is Montello\'s and belongs to a station, with a side to park on', () => {
  assert.equal(PUMPS.length, MONTELLO_PUMPS.length)
  const stations = new Set(PUMPS.map((p) => p.station))
  for (const name of ['Kwik Trip', 'BP', 'Mobil']) assert.ok(stations.has(name), name)
  for (const p of PUMPS) assert.ok(p.side === 1 || p.side === -1)
})

test('the counters are Montello\'s alone: every shop has a menu, the freight depot hires drivers, the fire station takes volunteers', () => {
  for (const p of PLACES) {
    assert.equal(p.area, 'montello')
    if (['bank', 'depot', 'fire', 'dealer', 'bodyshop', 'outfitter', 'police'].includes(p.kind)) continue
    assert.ok((SHOP_ITEMS[p.kind] ?? []).length > 0, `${p.name} sells something`)
  }
  assert.equal(PLACES.find((p) => p.kind === 'depot')?.work, 'montello')
  assert.ok(PLACES.find((p) => p.kind === 'depot')?.name.includes("Freitag"))
  assert.equal(PLACES.find((p) => p.kind === 'fire')?.work, 'fire')
  for (const name of ['Yahooz Sports Bar & Grill', "Weezie's Town Pump", "Drew's Lakeside Bar & Grill"]) assert.equal(PLACES.find((p) => p.name === name)?.kind, 'bar', name)
  assert.equal(new Set(PLACES.map((p) => p.id)).size, PLACES.length, 'ids are unique')
})

test('every Fox Plains and Fox Outfitters place has a Montello counter, and each kind opens a window', () => {
  const kinds = new Set(PLACES.map((p) => p.kind))
  for (const kind of ['gas', 'grocery', 'bar', 'dealer', 'clothing', 'bodyshop', 'bank', 'outfitter', 'police', 'hardware', 'depot', 'fire']) assert.ok(kinds.has(kind as never), `a ${kind} counter`)
  assert.equal(PLACES.find((p) => p.kind === 'police')?.name, 'Marquette County Sheriff Department')
  assert.equal(PLACES.find((p) => p.kind === 'dealer')?.name, 'H A Freitag & Son')
  assert.equal(PLACES.find((p) => p.kind === 'outfitter')?.name, 'Rendezvous Paddle & Sports')
  assert.equal(PLACES.filter((p) => p.kind === 'gas').length, 3)
  const sheriff = PLACES.find((p) => p.kind === 'police')!
  assert.ok(Math.hypot(sheriff.x + 44.8, sheriff.z + 172.9) < 2, 'the sheriff is on West Park Street')
})
