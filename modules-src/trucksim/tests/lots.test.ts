import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_ITEMS, hasService, itemCost, itemFootprint, itemRefund, normalizeBuildItem, validateItem } from '../shared/Lots'
import type { BuildItem } from '../shared/Lots'
import { applyAction } from '../shared/Actions'
import { defaultProfile } from '../shared/Economy'
import { COUNTY } from '../shared/RoadGraph'
import { DEMOLISH_REFUND } from '../shared/Catalog'

const LOT = { w: 120, d: 90 }

function item(def: string, id: string, x: number, z: number, w: number, d: number, rot: 0 | 1 | 2 | 3 = 0): BuildItem {
  return { id, def, x, z, w, d, rot, color: '#8a847a' }
}

const ctx = { now: 0, world: COUNTY }
const owner = () => ({ ...defaultProfile(), cash: 500_000, lot: 3 })

test('footprints follow the rotation of a line item', () => {
  assert.deepEqual(itemFootprint(item('shop-steel', 'a', 4, 5, 16, 24)), { x: 4, z: 5, w: 16, d: 24 })
  const fence = (rot: 0 | 1 | 2 | 3) => itemFootprint(item('fence-chain', 'f', 50, 40, 20, 0.2, rot))
  assert.deepEqual(fence(0), { x: 49.9, z: 40, w: 0.2, d: 20 })
  assert.deepEqual(fence(1), { x: 50, z: 39.9, w: 20, d: 0.2 })
  assert.deepEqual(fence(2), { x: 49.9, z: 20, w: 0.2, d: 20 })
  assert.deepEqual(fence(3), { x: 30, z: 39.9, w: 20, d: 0.2 })
})

test('itemCost charges per square metre, per metre or flat', () => {
  assert.equal(itemCost(item('pave-gravel', 'a', 0, 0, 10, 10)), 300)
  assert.equal(itemCost(item('pave-concrete', 'a', 0, 0, 20, 5)), 1800)
  assert.equal(itemCost(item('fence-chain', 'a', 0, 0, 30, 0.15, 1)), 750)
  assert.equal(itemCost(item('fuel-island', 'a', 0, 0, 6, 10)), 18000)
  assert.equal(itemCost(item('nope', 'a', 0, 0, 1, 1)), 0)
  assert.equal(itemRefund(item('fuel-island', 'a', 0, 0, 6, 10)), 18000 * DEMOLISH_REFUND)
})

test('validateItem accepts good items and rejects bad ones', () => {
  assert.equal(validateItem(item('pave-gravel', 'a', 0, 0, 10, 10), [], LOT), null)
  assert.equal(validateItem(item('shop-steel', 'a', 104, 66, 16, 24), [], LOT), null)
  assert.ok(validateItem(item('shop-steel', 'a', 105, 66, 16, 24), [], LOT))
  assert.ok(validateItem(item('shop-steel', 'a', -1, 0, 16, 24), [], LOT))
  assert.ok(validateItem(item('nope', 'a', 0, 0, 5, 5), [], LOT))
  assert.ok(validateItem(item('shop-steel', 'a', 0, 0, 5, 5), [], LOT))
  assert.ok(validateItem(item('shop-steel', 'a', 0, 0, 80, 24), [], LOT))
  assert.ok(validateItem(item('pave-gravel', 'a', 0, 0, 1, 10), [], LOT))
  assert.ok(validateItem(item('pave-gravel', 'a', 0, 0, 121, 10), [], { w: 200, d: 90 }))
  assert.ok(validateItem(item('pave-gravel', 'a', 0, 0, NaN, 10), [], LOT))
  assert.ok(validateItem({ ...item('pave-gravel', 'a', 0, 0, 10, 10), rot: 4 as 0 }, [], LOT))
  assert.ok(validateItem({ ...item('pave-gravel', '', 0, 0, 10, 10) }, [], LOT))
  assert.ok(validateItem({ ...item('pave-gravel', 'a', 0, 0, 10, 10), color: 'red' }, [], LOT))
})

test('placed add-ons keep the catalog size in either orientation', () => {
  assert.equal(validateItem(item('office-trailer', 'a', 0, 0, 4, 12), [], LOT), null)
  assert.equal(validateItem(item('office-trailer', 'a', 0, 0, 12, 4, 1), [], LOT), null)
  assert.ok(validateItem(item('office-trailer', 'a', 0, 0, 5, 5), [], LOT))
})

test('line items need the catalog thickness and a length inside the lot', () => {
  assert.equal(validateItem(item('fence-chain', 'a', 10, 10, 30, 0.15, 1), [], LOT), null)
  assert.ok(validateItem(item('fence-chain', 'a', 10, 10, 30, 1, 1), [], LOT))
  assert.ok(validateItem(item('fence-chain', 'a', 100, 10, 30, 0.15, 1), [], LOT))
  assert.ok(validateItem(item('fence-chain', 'a', 100, 10, 30, 0.15, 3), [], LOT) === null)
})

test('solids may not overlap but paving may sit under anything', () => {
  const shop = item('shop-steel', 'shop', 10, 10, 16, 24)
  assert.ok(validateItem(item('shop-steel', 'b', 20, 20, 16, 24), [shop], LOT))
  assert.equal(validateItem(item('shop-steel', 'b', 26, 10, 16, 24), [shop], LOT), null)
  assert.ok(validateItem(item('fuel-island', 'b', 12, 12, 6, 10), [shop], LOT))
  const paving = item('pave-asphalt', 'p', 0, 0, 60, 60)
  assert.equal(validateItem(shop, [paving], LOT), null)
  assert.equal(validateItem(item('pave-gravel', 'q', 5, 5, 20, 20), [paving, shop], LOT), null)
  assert.ok(validateItem(item('pave-gravel', 'shop', 70, 70, 10, 10), [shop], LOT))
  assert.ok(validateItem(item('fence-wood', 'f', 5, 20, 30, 0.15, 1), [shop], LOT))
})

test('a lot holds at most MAX_ITEMS pieces', () => {
  assert.equal(MAX_ITEMS, 160)
  const existing = Array.from({ length: MAX_ITEMS }, (_, i) => item('pave-gravel', `p${i}`, 0, 0, 10, 10))
  assert.ok(validateItem(item('pave-gravel', 'extra', 0, 0, 10, 10), existing, LOT))
  assert.equal(validateItem(item('pave-gravel', 'extra', 0, 0, 10, 10), existing.slice(1), LOT), null)
})

test('hasService finds the shop or fuel island', () => {
  assert.equal(hasService([]), false)
  assert.equal(hasService([item('pave-gravel', 'a', 0, 0, 10, 10)]), false)
  assert.equal(hasService([item('shop-steel', 'a', 0, 0, 16, 24)]), true)
  assert.equal(hasService([item('fuel-island', 'a', 0, 0, 6, 10)]), true)
})

test('normalizeBuildItem drops garbage', () => {
  assert.equal(normalizeBuildItem(null), null)
  assert.equal(normalizeBuildItem('x'), null)
  assert.equal(normalizeBuildItem({ id: 'a', def: 'nope', x: 0, z: 0, w: 1, d: 1, rot: 0, color: '#ffffff' }), null)
  const kept = normalizeBuildItem({ id: 'a', def: 'pave-gravel', x: 1, z: 2, w: 10, d: 10, rot: 9, color: 'bad' })
  assert.ok(kept)
  assert.equal(kept.rot, 0)
  assert.match(kept.color, /^#[0-9a-f]{6}$/i)
})

test('build charges the total, validates every item and refuses over a full lot', () => {
  const profile = owner()
  const result = applyAction(profile, { action: 'build', items: [item('pave-gravel', 'a', 0, 0, 10, 10), item('shop-steel', 'b', 20, 0, 16, 24)] }, ctx)
  assert.equal(result.ok, true)
  assert.equal(result.delta, -(300 + 165 * 16 * 24))
  assert.equal(result.profile.cash, profile.cash + result.delta)
  assert.equal(result.profile.build.length, 2)
  assert.equal(profile.build.length, 0)

  const bad = applyAction(profile, { action: 'build', items: [item('pave-gravel', 'a', 0, 0, 10, 10), item('shop-steel', 'b', 110, 0, 16, 24)] }, ctx)
  assert.equal(bad.ok, false)
  assert.equal(bad.delta, 0)
  assert.deepEqual(bad.profile, profile)

  const duplicate = applyAction(result.profile, { action: 'build', items: [item('pave-gravel', 'a', 50, 50, 10, 10)] }, ctx)
  assert.equal(duplicate.ok, false)

  const broke = applyAction({ ...profile, cash: 100 }, { action: 'build', items: [item('pave-gravel', 'a', 0, 0, 10, 10)] }, ctx)
  assert.equal(broke.ok, false)
  assert.equal(broke.profile.cash, 100)

  const lotless = applyAction({ ...profile, lot: null }, { action: 'build', items: [item('pave-gravel', 'a', 0, 0, 10, 10)] }, ctx)
  assert.equal(lotless.ok, false)

  const tooMany = applyAction(profile, { action: 'build', items: Array.from({ length: MAX_ITEMS + 1 }, (_, i) => item('pave-gravel', `n${i}`, 0, 0, 10, 10)) }, ctx)
  assert.equal(tooMany.ok, false)
  const empty = applyAction(profile, { action: 'build', items: [] }, ctx)
  assert.equal(empty.ok, false)
})

test('demolish removes items and refunds half the cost', () => {
  const built = applyAction(owner(), { action: 'build', items: [item('fuel-island', 'a', 0, 0, 6, 10), item('pave-gravel', 'b', 20, 0, 10, 10)] }, ctx).profile
  const result = applyAction(built, { action: 'demolish', ids: ['a', 'ghost'] }, ctx)
  assert.equal(result.ok, true)
  assert.equal(result.delta, 18000 * DEMOLISH_REFUND)
  assert.deepEqual(result.profile.build.map((entry) => entry.id), ['b'])
  assert.equal(result.profile.cash, built.cash + result.delta)
  const nothing = applyAction(built, { action: 'demolish', ids: ['ghost'] }, ctx)
  assert.equal(nothing.ok, false)
  assert.equal(nothing.delta, 0)
})

test('claim-lot respects the lot list and the build', () => {
  const fresh = { ...defaultProfile(), lot: null }
  const taken = applyAction(fresh, { action: 'claim-lot', index: 4 }, { ...ctx, lotFree: () => false })
  assert.equal(taken.ok, false)
  const claimed = applyAction(fresh, { action: 'claim-lot', index: 4 }, { ...ctx, lotFree: (index) => index === 4 })
  assert.equal(claimed.ok, true)
  assert.equal(claimed.profile.lot, 4)
  assert.equal(applyAction(fresh, { action: 'claim-lot', index: 99 }, ctx).ok, false)
  const built = applyAction({ ...owner(), lot: 3 }, { action: 'build', items: [item('pave-gravel', 'a', 0, 0, 10, 10)] }, ctx).profile
  assert.equal(applyAction(built, { action: 'claim-lot', index: 5 }, ctx).ok, false)
})
