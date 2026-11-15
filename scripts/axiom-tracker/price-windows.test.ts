import assert from 'node:assert/strict'
import { test } from 'node:test'
import { priceWindowChanges, type PricedTick } from './price-windows.js'

const now = 1_800_000_000_000
const everySecond = (seconds: number, price: (age: number) => number): PricedTick[] =>
  Array.from({ length: seconds + 1 }, (_, index) => ({ t: now - (seconds - index) * 1_000, price: price(seconds - index) }))

test('a coin followed for 11 minutes has every window from live readings', () => {
  const ticks = everySecond(660, age => 1 + age / 1_000)
  const { changes, sources } = priceWindowChanges({ ticks, price: 1, now, launchedAt: now - 3_600_000, dexM5: 50 })
  for (const value of Object.values(changes)) assert.ok(value !== null && value < 0)
  assert.equal(Math.round(changes.m5 as number), -23)
  assert.deepEqual(sources, {})
})

test('a coin younger than a window shows its change since launch', () => {
  const ticks = everySecond(180, age => 2 - age / 180)
  const { changes, sources } = priceWindowChanges({ ticks, price: 2, now, launchedAt: now - 181_000, dexM5: 7 })
  assert.equal(changes.m5, 100)
  assert.equal(sources.m5, 'since-launch')
  assert.equal(changes.m10, 100)
  assert.equal(sources.m1, undefined)
})

test('an older coin the tracker just started following uses DexScreener for 5m and its first reading otherwise', () => {
  const ticks = everySecond(40, () => 1)
  const { changes, sources } = priceWindowChanges({ ticks, price: 1.1, now, launchedAt: now - 3_600_000, dexM5: 12.5 })
  assert.equal(changes.s30, 10)
  assert.equal(sources.s30, undefined)
  assert.equal(changes.m1, 10)
  assert.equal(sources.m1, 'since-tracked')
  assert.equal(changes.m5, 12.5)
  assert.equal(sources.m5, 'dexscreener')
  assert.equal(sources.m10, 'since-tracked')
})

test('a gap at the start of a window is bridged from the readings on either side', () => {
  const ticks: PricedTick[] = [{ t: now - 120_000, price: 1 }, ...everySecond(20, () => 2)]
  const { changes, sources } = priceWindowChanges({ ticks, price: 2, now, launchedAt: now - 3_600_000, dexM5: null })
  assert.equal(sources.s30, 'between-readings')
  assert.equal(sources.m1, 'between-readings')
  assert.ok((changes.m1 as number) > (changes.s30 as number) && (changes.s30 as number) > 0)
  assert.equal(changes.s5, 0)
  assert.equal(sources.s5, undefined)
})

test('no price means no windows', () => {
  const { changes } = priceWindowChanges({ ticks: [], price: null, now, launchedAt: null, dexM5: 5 })
  assert.deepEqual(changes, { s5: null, s30: null, m1: null, m5: null, m10: null })
})
