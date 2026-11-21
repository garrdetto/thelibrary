import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BeanstalkEngine, evaluateWays, type Grid } from '../engine/engine'
import { simulate } from '../engine/simulate'
import { BET_LEVELS_CENTS, BET_UNITS, DEFAULT_BET_CENTS, FREE_SPINS_AWARD, REELS, ROWS, Sym, WAY_PAYS, isWild } from '../engine/paytable'

const fill = (sym: Sym): Grid => Array.from({ length: REELS }, () => Array.from({ length: ROWS }, () => ({ sym, mult: 1 })))

test('ways count every symbol-or-wild cell and multiply through seed multipliers', () => {
  const grid = fill(Sym.Ten)
  for (let reel = 0; reel < REELS; reel++) for (let row = 0; row < ROWS; row++) grid[reel][row] = { sym: (Sym.Jack + ((reel + row) % 3)) as Sym, mult: 1 }
  grid[0][0] = { sym: Sym.Giant, mult: 1 }
  grid[1][2] = { sym: Sym.Seed, mult: 3 }
  grid[2][1] = { sym: Sym.Giant, mult: 1 }
  grid[2][3] = { sym: Sym.Giant, mult: 1 }
  const giant = evaluateWays(grid, BET_UNITS * 10).find((win) => win.symbol === Sym.Giant)
  assert.ok(giant)
  assert.equal(giant.count, 3)
  assert.equal(giant.ways, 1 * 3 * 2)
  assert.equal(giant.win, (WAY_PAYS[Sym.Giant] as readonly number[])[0] * 6 * 10)
})

test('ways made only of wilds pay as the Cloud Giant and nothing else', () => {
  const grid = fill(Sym.Vine)
  const wins = evaluateWays(grid, BET_UNITS)
  assert.equal(wins.length, 1)
  assert.equal(wins[0].symbol, Sym.Giant)
  assert.equal(wins[0].ways, 4 ** 5)
})

test('a forced sprout climbs its reel and spreads', () => {
  const engine = new BeanstalkEngine({ seed: 7 })
  const result = engine.spin(100, 'grow')
  assert.ok(result.growth.length >= ROWS - 1)
  for (let row = 0; row < ROWS; row++) assert.ok(isWild(result.grid[2][row].sym) || result.grid[2][row].sym === Sym.Castle)
  for (const step of result.growth) assert.ok(isWild(result.grid[step.to[0]][step.to[1]].sym))
})

test('three castles start five free spins whose wilds stay put', () => {
  const engine = new BeanstalkEngine({ seed: 11 })
  const trigger = engine.spin(100, 'free')
  assert.equal(trigger.trigger, 'free')
  assert.equal(trigger.freeSpinsAwarded, FREE_SPINS_AWARD)
  let spins = 0
  let previous: boolean[][] | null = null
  while (engine.inFeature) {
    const result = engine.spin(100, spins === 0 ? 'grow' : null)
    spins++
    assert.equal(result.mode, 'free')
    if (previous) for (let reel = 0; reel < REELS; reel++) for (let row = 0; row < ROWS; row++) if (previous[reel][row]) {
      assert.ok(result.held?.[reel][row])
      assert.ok(isWild(result.grid[reel][row].sym))
    }
    previous = result.state.sticky
    if (!engine.inFeature) assert.ok(result.featureEnd)
  }
  assert.equal(spins, FREE_SPINS_AWARD)
})

test('haywire always reports what it changed', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const engine = new BeanstalkEngine({ seed })
    const result = engine.spin(100, 'haywire')
    assert.ok(result.haywire)
    if (result.haywire.kind === 'double') assert.ok(result.haywire.multiplier >= 2)
    else assert.ok(result.haywire.planted.length > 0)
    if (result.haywire.kind === 'stalk') {
      const reel = result.haywire.planted[0].cell[0]
      for (let row = 0; row < ROWS; row++) assert.ok(isWild(result.grid[reel][row].sym) || result.grid[reel][row].sym === Sym.Castle)
    }
  }
})

test('state survives a save and reload mid-feature', () => {
  const engine = new BeanstalkEngine({ seed: 3 })
  engine.spin(100, 'free')
  engine.spin(100, 'grow')
  const copy = BeanstalkEngine.fromState(JSON.parse(JSON.stringify(engine.toState())))
  assert.deepEqual(copy.spin(100), engine.spin(100))
})

test('bets run from 25 cents to a $5 top level that pays in proportion', () => {
  assert.equal(BET_LEVELS_CENTS[0], 25)
  assert.equal(BET_LEVELS_CENTS[BET_LEVELS_CENTS.length - 1], 500)
  assert.ok(BET_LEVELS_CENTS.includes(DEFAULT_BET_CENTS))
  assert.ok(BET_LEVELS_CENTS.every((bet, index) => Number.isInteger(bet) && bet > 0 && (index === 0 || bet > BET_LEVELS_CENTS[index - 1])))
  const top = BET_LEVELS_CENTS[BET_LEVELS_CENTS.length - 1]
  const grid = fill(Sym.Ten)
  for (let reel = 0; reel < 3; reel++) grid[reel][0] = { sym: Sym.Giant, mult: 1 }
  const giant = evaluateWays(grid, top).find((win) => win.symbol === Sym.Giant)
  assert.ok(giant)
  assert.equal(giant.win, Math.round((WAY_PAYS[Sym.Giant] as readonly number[])[0] * top / BET_UNITS))
  const engine = new BeanstalkEngine({ seed: 21 })
  const free = engine.spin(top, 'free')
  assert.equal(free.bet, top)
  assert.equal(free.scatter.win, 2 * top)
  while (engine.inFeature) assert.equal(engine.spin(top).bet, top)
  const big = new BeanstalkEngine({ seed: 22 }).spin(top, 'bigwin')
  assert.ok(big.stepWin >= top * 15)
})

test('a real win at the smallest bet never rounds down to zero cents', () => {
  const engine = new BeanstalkEngine({ seed: 9, balance: 10_000_000 })
  let wins = 0
  for (let spin = 0; spin < 20_000; spin++) {
    const result = engine.spin(BET_LEVELS_CENTS[0])
    for (const way of result.ways) {
      wins++
      assert.ok(way.win >= 1, `way of ${way.ways} paid ${way.win}`)
    }
  }
  assert.ok(wins > 1000)
})

test('a Sky Garden opened at an old, bigger bet resumes at its own bet', () => {
  const engine = new BeanstalkEngine({ seed: 5, balance: 1_000_000 })
  engine.spin(10_000, 'free')
  const saved = BeanstalkEngine.fromState(JSON.parse(JSON.stringify(engine.toState())))
  const result = saved.spin(BET_LEVELS_CENTS[0])
  assert.equal(result.mode, 'free')
  assert.equal(result.bet, 10_000)
  assert.equal(result.state.balance, engine.snapshot().balance + result.stepWin)
})

test('long-run return stays between 90% and 100%', () => {
  const report = simulate(400_000, 2024)
  assert.ok(report.rtp > 0.9 && report.rtp < 1, `return ${report.rtp}`)
  assert.ok(report.haywireRate > 0.008 && report.haywireRate < 0.02)
})
