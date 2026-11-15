import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dexHolderCap, dexMovement, scoreDex, type DexScoreInput } from './dex-score.js'

function mover(overrides: Partial<DexScoreInput> = {}): DexScoreInput {
  return {
    moves: { s5: 1.5, s30: 5, m1: 9, m5: 35 },
    liquidity: 60_000,
    marketCap: 400_000,
    volume5m: 40_000,
    buys5m: 220,
    sells5m: 80,
    botClimb: false,
    authorityOn: false,
    holderBlocked: null,
    severeSelling: false,
    ...overrides,
  }
}

test('a coin rising in every window with deep liquidity and volume scores high', () => {
  const result = scoreDex(mover())
  assert.ok(result.score >= 80, `scored ${result.score}`)
  assert.equal(result.cuts.length, 0)
})

test('the same move on a thin pool with little volume earns far less', () => {
  const deep = scoreDex(mover()).score
  const thin = scoreDex(mover({ liquidity: 3_000, volume5m: 900, buys5m: 12, sells5m: 8 })).score
  assert.ok(thin < deep / 2, `deep ${deep}, thin ${thin}`)
})

test('the 5-minute move weighs more than the 5-second move', () => {
  const longMove = dexMovement({ s5: 0, s30: null, m1: null, m5: 30 })
  const shortMove = dexMovement({ s5: 2, s30: null, m1: null, m5: 0 })
  assert.ok(longMove && shortMove && longMove.signal > shortMove.signal)
})

test('one spike cannot carry the score: each window is held to a strong move', () => {
  const flat = scoreDex(mover({ moves: { s5: 0, s30: 0, m1: 0, m5: 0 } })).score
  const spike = scoreDex(mover({ moves: { s5: 400, s30: 0, m1: 0, m5: 0 } })).score
  assert.ok(spike - flat <= 10, `flat ${flat}, spike ${spike}`)
})

test('a coin falling across the windows loses points', () => {
  const falling = scoreDex(mover({ moves: { s5: -2, s30: -6, m1: -10, m5: -30 } }))
  assert.ok(falling.score < 30, `scored ${falling.score}`)
  assert.ok(falling.cuts.some(cut => cut.startsWith('Falling')))
})

test('bot climbs, live authorities and hard sell-offs score 0; holder limits hold it low', () => {
  assert.equal(scoreDex(mover({ botClimb: true })).score, 0)
  assert.equal(scoreDex(mover({ authorityOn: true })).score, 0)
  assert.equal(scoreDex(mover({ severeSelling: true })).score, 0)
  assert.equal(scoreDex(mover({ holderBlocked: 'Top 10 hold 45% (limit 30%)' })).score, dexHolderCap)
})

test('with no price readings the movement earns nothing but liquidity and volume still count', () => {
  const result = scoreDex(mover({ moves: { s5: null, s30: null, m1: null, m5: null } }))
  assert.equal(result.signal, null)
  assert.equal(result.checks[0].points, 0)
  assert.ok(result.score > 0 && result.score <= 15, `scored ${result.score}`)
})
