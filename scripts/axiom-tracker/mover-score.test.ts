import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectBotClimb, holderLimitBreaks, moverCaps, scoreMover, type MoverFlowPoint, type MoverInput } from './mover-score.js'

const now = 1_800_000_000_000
const cleanTraits = { top10: 14, dev: 0, snipers: 3, insiders: 2, bundlers: 4, linked: 1 }

function realFlow(): MoverFlowPoint[] {
  const prices = [1, 1.04, 0.99, 1.07, 1.02, 1.11, 1.06, 1.15, 1.1, 1.2]
  return prices.map((price, index) => ({ t: now - (prices.length - 1 - index) * 20_000, price, volume5m: 30_000 + index * 4_000 * (index % 2 ? 1 : -0.5), buys5m: 260 + index * 9, sells5m: 170 + (index % 3) * 25 }))
}

function staircaseFlow(): MoverFlowPoint[] {
  return Array.from({ length: 10 }, (_, index) => ({ t: now - (9 - index) * 20_000, price: 0.00002 * (1 + index * 0.012), volume5m: 13_400 + index * 90, buys5m: 520 + index * 3, sells5m: 100 + (index % 2) }))
}

function mover(overrides: Partial<MoverInput> = {}): MoverInput {
  return {
    now,
    ageMinutes: 12,
    marketCap: 180_000,
    priceChange: { s30: 2, m1: 6, m5: 20 },
    buys5m: 300,
    sells5m: 180,
    volume5m: 42_000,
    viewers: 100,
    viewersPerMin: 20,
    viewersDelta5m: 55,
    holders: 500,
    holdersPerMin: 25,
    holderChange5mPct: null,
    smartHolders: 1,
    traits: cleanTraits,
    rugged: false,
    traders5m: 320,
    netBuyers5m: 150,
    flow: realFlow(),
    ...overrides,
  }
}

test('a coin with viewers and holders both rising on real buying scores high', () => {
  const result = scoreMover(mover())
  assert.ok(result.score >= 70, `score ${result.score}`)
  assert.equal(result.botClimb, false)
  assert.ok(result.parts.some(part => part.key === 'together'))
  assert.deepEqual(result.cuts, [])
})

test('viewers and holders together beat either one alone', () => {
  const both = scoreMover(mover()).score
  const viewersOnly = scoreMover(mover({ holdersPerMin: 0 })).score
  const holdersOnly = scoreMover(mover({ viewersPerMin: 0, viewersDelta5m: 0 })).score
  assert.ok(both > viewersOnly && both > holdersOnly, `${both} vs ${viewersOnly} and ${holdersOnly}`)
})

test('top 10 holders over 30% scores low', () => {
  const result = scoreMover(mover({ traits: { ...cleanTraits, top10: 58.04 } }))
  assert.ok(result.score <= moverCaps.holderLimit, `score ${result.score}`)
  assert.equal(result.holderRisk.blocked, true)
  assert.equal(scoreMover(mover({ traits: { ...cleanTraits, top10: 29.9 } })).holderRisk.blocked, false)
})

test('any dev holding scores low', () => {
  assert.ok(scoreMover(mover({ traits: { ...cleanTraits, dev: 0.4 } })).score <= moverCaps.holderLimit)
  assert.ok(scoreMover(mover({ traits: { ...cleanTraits, dev: 40.23 } })).score <= moverCaps.holderLimit)
  assert.deepEqual(holderLimitBreaks({ ...cleanTraits, dev: 0 }), [])
})

test('snipers, insiders, bundlers or linked wallets over 10% score low', () => {
  for (const key of ['snipers', 'insiders', 'bundlers', 'linked'] as const) {
    const result = scoreMover(mover({ traits: { ...cleanTraits, [key]: 10.5 } }))
    assert.ok(result.score <= moverCaps.holderLimit, `${key} score ${result.score}`)
  }
})

test('a steady climb on identical small buys is a bot climb', () => {
  const input = mover({ buys5m: 545, sells5m: 104, volume5m: 17_300, viewers: null, viewersPerMin: null, viewersDelta5m: null, traders5m: null, netBuyers5m: null, flow: staircaseFlow() })
  const result = scoreMover(input)
  assert.equal(result.botClimb, true)
  assert.ok(result.score <= moverCaps.botClimb, `score ${result.score}`)
})

test('wallets that only ever buy are a bot climb', () => {
  assert.ok(detectBotClimb({ now, ageMinutes: 15, buys5m: 538, sells5m: 112, volume5m: 19_000, traders5m: 485, netBuyers5m: 435, flow: [] }))
  assert.ok(detectBotClimb({ now, ageMinutes: 17, buys5m: 501, sells5m: 75, volume5m: 15_000, traders5m: 493, netBuyers5m: 493, flow: [] }))
})

test('a busy launch where people buy and sell is not a bot climb', () => {
  assert.equal(detectBotClimb({ now, ageMinutes: 3, buys5m: 1262, sells5m: 1125, volume5m: 210_000, traders5m: 1029, netBuyers5m: 601, flow: realFlow() }), null)
  assert.equal(detectBotClimb({ now, ageMinutes: 8, buys5m: 1544, sells5m: 1242, volume5m: 310_000, traders5m: 901, netBuyers5m: 564, flow: realFlow() }), null)
})

test('a coin that is not rising is capped', () => {
  const result = scoreMover(mover({ priceChange: { s30: 0, m1: -1, m5: -3 } }))
  assert.ok(result.score <= 45, `score ${result.score}`)
  assert.ok(result.cuts.includes('Not rising'))
})

test('unknown holder numbers cannot top the list', () => {
  const result = scoreMover(mover({ traits: null }))
  assert.ok(result.score <= moverCaps.unverified, `score ${result.score}`)
})

test('missing viewers do not drag a moving coin to the floor', () => {
  const result = scoreMover(mover({ viewers: null, viewersPerMin: null, viewersDelta5m: null }))
  assert.ok(result.score >= 50, `score ${result.score}`)
})

test('a missing viewer count never beats a measured one', () => {
  const measured = scoreMover(mover()).score
  const missing = scoreMover(mover({ viewers: null, viewersPerMin: null, viewersDelta5m: null })).score
  assert.ok(missing < measured, `${missing} vs ${measured}`)
})
