import assert from 'node:assert/strict'
import { test } from 'node:test'
import { seededRng } from '../../foxlake/casino/math/rng'
import { BET_LEVELS_CENTS, DEFAULT_BET_INDEX, DollazGame, METER_FULL, MAX_BET_CENTS, SpinError, cents, featureKinds, jackpotCents } from '../engine/game'
import { simulate } from '../engine/simulate'

test('bets run from $0.25 to $5 and the default is $1', () => {
  assert.equal(Math.max(...BET_LEVELS_CENTS), 500)
  assert.equal(MAX_BET_CENTS, 500)
  assert.equal(BET_LEVELS_CENTS[DEFAULT_BET_INDEX], 100)
  assert.deepEqual([...BET_LEVELS_CENTS].sort((a, b) => a - b), [...BET_LEVELS_CENTS])
})

test('a spin takes the bet and pays the whole round, in cents', () => {
  const rng = seededRng(21)
  const game = new DollazGame({ balance: 100000 })
  for (let spin = 0; spin < 2000; spin++) {
    const before = game.snapshot().balance
    const round = game.spin(BET_LEVELS_CENTS[spin % BET_LEVELS_CENTS.length], null, rng)
    assert.equal(round.win, cents(round.result.totalWin))
    assert.equal(round.state.balance, before - round.bet + round.win)
    assert.ok(Number.isInteger(round.state.balance))
  }
})

test('bets above $5, odd bets and bets the balance cannot cover are refused', () => {
  const game = new DollazGame({ balance: 300 })
  assert.throws(() => game.spin(1000), SpinError)
  assert.throws(() => game.spin(12.5), SpinError)
  assert.throws(() => game.spin(400), SpinError)
  assert.equal(game.snapshot().balance, 300)
})

test('meters carry over between spins, stay within their limits and survive a save', () => {
  const rng = seededRng(4)
  const game = new DollazGame({ balance: 10_000_000 })
  for (let spin = 0; spin < 3000; spin++) {
    const round = game.spin(100, null, rng)
    for (const key of ['green', 'pink', 'blue'] as const) assert.ok(round.state.meters[key] >= 0 && round.state.meters[key] <= METER_FULL[key])
  }
  const copy = DollazGame.fromState(JSON.parse(JSON.stringify(game.toState())))
  assert.deepEqual(copy.snapshot(), game.snapshot())
})

test('forced outcomes deliver the feature asked for', () => {
  const rng = seededRng(9)
  const game = new DollazGame({ balance: 1_000_000 })
  assert.ok(featureKinds(game.spin(100, 'collect', rng).result.feature).includes('cashcollect'))
  assert.ok(featureKinds(game.spin(100, 'free', rng).result.feature).includes('freegames'))
  assert.ok(featureKinds(game.spin(100, 'pick', rng).result.feature).includes('jackpotpick'))
  assert.ok(game.spin(100, 'bigwin', rng).win >= 2000)
})

test('jackpots are fixed multiples of the bet', () => {
  assert.equal(jackpotCents('GRAND', 500), Math.round(2000 * 1.035 * 500))
  assert.ok(jackpotCents('MINI', 100) < jackpotCents('MINOR', 100))
})

test('the long-run return is about 95.5%', () => {
  const report = simulate(250000, 77)
  assert.ok(report.rtp > 0.9 && report.rtp < 1.01, `return ${report.rtp}`)
  assert.ok(report.collectRate > 1 / 200 && report.collectRate < 1 / 60, `cash collect ${report.collectRate}`)
  assert.ok(report.freeRate > 1 / 400 && report.freeRate < 1 / 90, `free games ${report.freeRate}`)
})
