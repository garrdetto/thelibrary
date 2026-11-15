import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectBotClimb, holderLimitBreaks, type MoverFlowPoint } from './holder-limits.js'

const now = 1_800_000_000_000
const cleanTraits = { top10: 14, dev: 0, snipers: 3, insiders: 2, bundlers: 4, linked: 1 }

function realFlow(): MoverFlowPoint[] {
  const prices = [1, 1.04, 0.99, 1.07, 1.02, 1.11, 1.06, 1.15, 1.1, 1.2]
  return prices.map((price, index) => ({ t: now - (prices.length - 1 - index) * 20_000, price, volume5m: 30_000 + index * 4_000 * (index % 2 ? 1 : -0.5), buys5m: 260 + index * 9, sells5m: 170 + (index % 3) * 25 }))
}

function staircaseFlow(): MoverFlowPoint[] {
  return Array.from({ length: 10 }, (_, index) => ({ t: now - (9 - index) * 20_000, price: 0.00002 * (1 + index * 0.012), volume5m: 13_400 + index * 90, buys5m: 520 + index * 3, sells5m: 100 + (index % 2) }))
}

test('the holder limits follow the rubric: top 10 30%, dev 5%, bundlers 35%, fresh wallets 10%, pro traders 75%', () => {
  assert.deepEqual(holderLimitBreaks(cleanTraits), [])
  assert.ok(holderLimitBreaks({ ...cleanTraits, top10: 30.5 }).some(line => line.startsWith('Top 10')))
  assert.deepEqual(holderLimitBreaks({ ...cleanTraits, top10: 30 }), [])
  assert.ok(holderLimitBreaks({ ...cleanTraits, dev: 5.2 }).some(line => line.startsWith('Dev')))
  assert.deepEqual(holderLimitBreaks({ ...cleanTraits, dev: 4 }), [])
  assert.deepEqual(holderLimitBreaks({ ...cleanTraits, bundlers: 35 }), [])
  assert.ok(holderLimitBreaks({ ...cleanTraits, bundlers: 36 }).some(line => line.startsWith('Bundlers')))
  assert.deepEqual(holderLimitBreaks({ ...cleanTraits, proTraders: 75 }), [])
  assert.ok(holderLimitBreaks({ ...cleanTraits, proTraders: 76 }).some(line => line.startsWith('Pro traders')))
  assert.ok(holderLimitBreaks({ ...cleanTraits, fresh: 11 }).some(line => line.startsWith('Fresh')))
  assert.ok(holderLimitBreaks({ ...cleanTraits, snipers: 31 }).some(line => line.startsWith('Snipers')))
})

test('a steady climb on identical small buys is a bot climb', () => {
  assert.ok(detectBotClimb({ now, ageMinutes: 12, buys5m: 545, sells5m: 104, volume5m: 17_300, traders5m: null, netBuyers5m: null, flow: staircaseFlow() }))
})

test('wallets that only ever buy are a bot climb', () => {
  assert.ok(detectBotClimb({ now, ageMinutes: 15, buys5m: 538, sells5m: 112, volume5m: 19_000, traders5m: 485, netBuyers5m: 435, flow: [] }))
  assert.ok(detectBotClimb({ now, ageMinutes: 17, buys5m: 501, sells5m: 75, volume5m: 15_000, traders5m: 493, netBuyers5m: 493, flow: [] }))
})

test('a busy launch where people buy and sell is not a bot climb', () => {
  assert.equal(detectBotClimb({ now, ageMinutes: 3, buys5m: 1262, sells5m: 1125, volume5m: 210_000, traders5m: 1029, netBuyers5m: 601, flow: realFlow() }), null)
  assert.equal(detectBotClimb({ now, ageMinutes: 8, buys5m: 1544, sells5m: 1242, volume5m: 310_000, traders5m: 901, netBuyers5m: 564, flow: realFlow() }), null)
})

test('a young launch with a crowd watching on Axiom is not flagged for wallets only buying', () => {
  assert.equal(detectBotClimb({ now, ageMinutes: 4, buys5m: 538, sells5m: 112, volume5m: 19_000, traders5m: 485, netBuyers5m: 435, flow: [], viewers: 60 }), null)
  assert.ok(detectBotClimb({ now, ageMinutes: 4, buys5m: 538, sells5m: 112, volume5m: 19_000, traders5m: 485, netBuyers5m: 435, flow: [], viewers: 12 }))
  assert.ok(detectBotClimb({ now, ageMinutes: 15, buys5m: 538, sells5m: 112, volume5m: 19_000, traders5m: 485, netBuyers5m: 435, flow: [], viewers: 60 }))
})
