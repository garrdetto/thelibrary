import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BASE_STRIPS, BASE_STRIP_COUNTS, CELLS, FREE_STRIPS, JACKPOT_MULTIPLIERS, JACKPOT_TIERS, LINE_PAYS, PAYLINES, REELS, ROWS, Sym, ZONE_MULTIPLIERS, ZONE_RECTS, expansionRect, type CoinPrize } from '../engine/paytable'
import { createRng } from '../engine/rng'
import { SlotEngine, SpinError, anticipationFor, evaluateLines, evaluateScatter, type Cell, type Grid, type SpinResult } from '../engine/slotEngine'
import { simulate } from '../engine/simulate'
import { dailyStatus, previousDay, vaultDay } from '../engine/daily'

const cell = (sym: Sym, prize: CoinPrize | null = null, value = 0): Cell => ({ sym, prize, value })
const gridOf = (rows: Sym[][]): Grid => Array.from({ length: REELS }, (_, reel) => Array.from({ length: ROWS }, (_, row) => cell(rows[row][reel])))

const finishRound = (engine: SlotEngine, first: SpinResult, bet: number): SpinResult[] => {
  const steps = [first]
  let last = first
  let guard = 0
  while (last.state.mode !== 'base') {
    last = engine.spin(bet)
    steps.push(last)
    if (++guard > 500) throw new Error('Feature never ended')
  }
  return steps
}

test('rng is deterministic and uniform enough', () => {
  const a = createRng(42)
  const b = createRng(42)
  for (let index = 0; index < 100; index++) assert.equal(a.int(1000), b.int(1000))
  const counts = new Array(6).fill(0)
  const rng = createRng(7)
  for (let index = 0; index < 60000; index++) counts[rng.int(6)]++
  for (const count of counts) assert.ok(Math.abs(count - 10000) < 400, `bucket ${count}`)
  const resumed = createRng(a.state())
  assert.equal(resumed.int(1 << 30), a.int(1 << 30))
})

test('paylines are 25 distinct patterns inside the grid', () => {
  assert.equal(PAYLINES.length, 25)
  assert.equal(new Set(PAYLINES.map((line) => line.join(''))).size, 25)
  for (const line of PAYLINES) for (const row of line) assert.ok(row >= 0 && row < ROWS)
})

test('reel strips hold every counted symbol and keep specials apart', () => {
  BASE_STRIPS.forEach((strip, reel) => {
    const total = Object.values(BASE_STRIP_COUNTS[reel]).reduce((sum, count) => sum + count, 0)
    assert.equal(strip.length, total)
    for (let index = 0; index < strip.length; index++) {
      const special = (sym: Sym) => sym === Sym.Scatter || sym === Sym.Sphinx
      if (special(strip[index])) {
        assert.ok(!special(strip[(index + 1) % strip.length]), `reel ${reel} stacks specials at ${index}`)
        assert.ok(!special(strip[(index + 2) % strip.length]), `reel ${reel} shows two specials at ${index}`)
      }
    }
  })
  assert.ok(!BASE_STRIPS[0].includes(Sym.Wild) && !BASE_STRIPS[4].includes(Sym.Wild))
  assert.ok(BASE_STRIPS.slice(0, 4).every((strip) => !strip.includes(Sym.Sphinx)))
  assert.ok(FREE_STRIPS[2].includes(Sym.Sphinx))
})

test('line evaluation pays left to right with wilds substituting', () => {
  const grid = gridOf([
    [Sym.Ace, Sym.Wild, Sym.Ace, Sym.Ace, Sym.King],
    [Sym.Ten, Sym.Jack, Sym.Queen, Sym.King, Sym.Ten],
    [Sym.Jack, Sym.Queen, Sym.Ten, Sym.Jack, Sym.Queen],
  ])
  const wins = evaluateLines(grid, 2500)
  const top = wins.find((win) => win.line === 1)
  assert.ok(top)
  assert.equal(top.symbol, Sym.Ace)
  assert.equal(top.count, 4)
  assert.equal(top.win, Math.round((LINE_PAYS[Sym.Ace]?.[1] ?? 0) * (2500 / 25)))
  assert.deepEqual(top.cells, [[0, 0], [1, 0], [2, 0], [3, 0]])
})

test('wild-led lines take the first paying symbol and stop at specials', () => {
  const grid = gridOf([
    [Sym.Explorer, Sym.Wild, Sym.Wild, Sym.Coin, Sym.Explorer],
    [Sym.Ten, Sym.Jack, Sym.Queen, Sym.King, Sym.Ace],
    [Sym.Jack, Sym.Queen, Sym.Ten, Sym.Jack, Sym.Queen],
  ])
  const top = evaluateLines(grid, 2500).find((win) => win.line === 1)
  assert.ok(top)
  assert.equal(top.count, 3)
  assert.equal(top.symbol, Sym.Explorer)
})

test('scatters pay on total bet and anticipation needs two scatters or five coins on reels 1-4', () => {
  const grid = gridOf([
    [Sym.Scatter, Sym.Ten, Sym.Scatter, Sym.Ten, Sym.Scatter],
    [Sym.Ten, Sym.Jack, Sym.Queen, Sym.King, Sym.Ace],
    [Sym.Jack, Sym.Queen, Sym.Ten, Sym.Jack, Sym.Queen],
  ])
  assert.equal(evaluateScatter(grid, 100).win, 200)
  assert.deepEqual(anticipationFor(grid), { reel: 4, reason: 'scatter' })
  const coins = gridOf([
    [Sym.Coin, Sym.Coin, Sym.Ten, Sym.Ten, Sym.Ten],
    [Sym.Coin, Sym.Ten, Sym.Coin, Sym.Ten, Sym.Ten],
    [Sym.Ten, Sym.Ten, Sym.Ten, Sym.Coin, Sym.Ten],
  ])
  assert.deepEqual(anticipationFor(coins), { reel: 4, reason: 'coin' })
})

test('spins debit the bet, refuse bad bets and keep the books balanced', () => {
  const engine = new SlotEngine({ seed: 3, balance: 10000 })
  assert.throws(() => engine.spin(0), SpinError)
  assert.throws(() => engine.spin(20000), SpinError)
  let credited = 0
  let wagered = 0
  for (let round = 0; round < 200; round++) {
    const first = engine.spin(100)
    wagered += 100
    for (const step of finishRound(engine, first, 100)) credited += step.stepWin
  }
  assert.equal(engine.snapshot().balance, 10000 - wagered + credited)
  assert.equal(engine.snapshot().stats.wagered, wagered)
  assert.equal(engine.snapshot().stats.won, credited)
})

test('a forced collect pays every visible coin to the collector', () => {
  const engine = new SlotEngine({ seed: 11, balance: 100000 })
  const result = engine.spin(500, 'collect')
  assert.equal(result.collects.length, 1)
  const event = result.collects[0]
  const coinSum = event.sources.reduce((sum, [reel, row]) => sum + result.grid[reel][row].value, 0)
  assert.equal(event.base, coinSum)
  assert.equal(event.multiplier, ZONE_MULTIPLIERS[event.size - 1])
  assert.equal(event.amount, coinSum * event.multiplier)
  assert.equal(event.rect.width, event.size)
  assert.ok(event.collector[0] >= event.rect.reel && event.collector[0] < event.rect.reel + event.size)
  assert.ok(event.collector[1] >= event.rect.row && event.collector[1] < event.rect.row + event.size)
  assert.equal(result.grid[event.collector[0]][event.collector[1]].sym, Sym.Sphinx)
  const lines = result.lineWins.reduce((sum, win) => sum + win.win, 0)
  assert.equal(result.stepWin, lines + result.scatter.win + event.amount)
})

test('a forced vault respin locks coins, resets on new coins and settles the total', () => {
  const engine = new SlotEngine({ seed: 21, balance: 100000 })
  const trigger = engine.spin(1000, 'respin')
  assert.equal(trigger.trigger, 'respin')
  assert.equal(trigger.state.mode, 'respin')
  assert.equal(trigger.state.respinsLeft, 3)
  assert.equal(trigger.collects.length, 0)
  let last = trigger
  let previousHeld = trigger.respin?.filled ?? 0
  while (last.state.mode === 'respin') {
    last = engine.spin(1000)
    const respin = last.respin
    assert.ok(respin)
    assert.ok(respin.filled >= previousHeld)
    if (respin.newCells.length > 0 && !last.featureEnd) assert.equal(respin.respinsLeft, 3)
    for (const [reel, row] of respin.newCells) assert.ok(last.grid[reel][row].sym === Sym.Coin || last.grid[reel][row].sym === Sym.Sphinx)
    previousHeld = respin.filled
  }
  assert.ok(last.featureEnd)
  let expected = 0
  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) {
      const here = last.grid[reel][row]
      if (here.sym === Sym.Coin || here.sym === Sym.Sphinx) expected += here.value
    }
  }
  if (last.featureEnd.grand) expected += JACKPOT_MULTIPLIERS.grand * 1000
  assert.equal(last.stepWin, expected)
})

test('filling all fifteen positions awards the Grand', () => {
  const engine = new SlotEngine({ seed: 5, balance: 100000 })
  engine.spin(100, 'grand')
  const steps: SpinResult[] = []
  let last: SpinResult | null = null
  while (engine.snapshot().mode === 'respin') {
    last = engine.spin(100)
    steps.push(last)
  }
  assert.ok(last?.featureEnd?.grand)
  assert.equal(last.respin?.filled, CELLS)
  assert.ok(last.jackpots.some((award) => award.tier === 'grand' && award.amount === 200000))
})

test('free spins award six, grow the sphinx zone on collects and return to base', () => {
  const engine = new SlotEngine({ seed: 9, balance: 100000 })
  const trigger = engine.spin(200, 'free')
  assert.equal(trigger.trigger, 'free')
  assert.equal(trigger.state.mode, 'free')
  assert.equal(trigger.state.freeSpinsLeft, 6)
  const collect = engine.spin(200, 'collect')
  assert.equal(collect.mode, 'free')
  assert.equal(collect.collects[0].inZone, true)
  assert.ok(collect.collects[0].size >= 1)
  assert.equal(collect.zoneAfter, 1)
  const again = engine.spin(200, 'collect')
  assert.ok(again.collects[0].size >= 2)
  assert.equal(again.collects[0].multiplier, ZONE_MULTIPLIERS[again.collects[0].size - 1])
  assert.equal(again.zoneAfter, 2)
  const rest = finishRound(engine, again, 200)
  const end = rest[rest.length - 1]
  assert.equal(end.state.mode, 'base')
  assert.equal(end.state.zoneLevel, 0)
})

test('expansion rectangles stay on the grid and cover the collector', () => {
  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) {
      for (const size of [1, 2, 3]) {
        const rect = expansionRect(reel, row, size)
        assert.ok(rect.reel >= 0 && rect.reel + size <= REELS)
        assert.ok(rect.row >= 0 && rect.row + size <= ROWS)
        assert.ok(reel >= rect.reel && reel < rect.reel + size && row >= rect.row && row < rect.row + size)
      }
    }
  }
  assert.deepEqual(ZONE_RECTS[2], { reel: 2, row: 0, width: 3, height: 3 })
})

test('the jackpot pick reveals three of the winning tier last and never three of another', () => {
  const engine = new SlotEngine({ seed: 31, balance: 100000 })
  const seen = new Set<string>()
  for (let round = 0; round < 300; round++) {
    const result = engine.spin(100, 'pick')
    finishRound(engine, result, 100)
    const pick = result.pick
    assert.ok(pick)
    seen.add(pick.tier)
    assert.equal(pick.order.length, 9)
    for (const tier of JACKPOT_TIERS) assert.equal(pick.order.filter((item) => item === tier).length, tier === pick.tier ? 3 : 2)
    const revealed = pick.order.slice(0, pick.picks)
    assert.equal(revealed[revealed.length - 1], pick.tier)
    assert.equal(revealed.filter((item) => item === pick.tier).length, 3)
    for (const tier of JACKPOT_TIERS) if (tier !== pick.tier) assert.ok(revealed.filter((item) => item === tier).length < 3)
    assert.equal(pick.amount, JACKPOT_MULTIPLIERS[pick.tier] * 100)
    assert.ok(result.jackpots.some((award) => award.tier === pick.tier && award.cell === null))
  }
  assert.ok(seen.has('mini') && seen.has('minor'))
})

test('long-run return sits near 95%', () => {
  const report = simulate(400000, 77)
  assert.ok(report.rtp > 0.9 && report.rtp < 1.0, `rtp ${report.rtp}`)
  assert.ok(report.hitRate > 0.2 && report.hitRate < 0.4, `hit rate ${report.hitRate}`)
  assert.ok(report.respinEvery > 60 && report.respinEvery < 250, `respin every ${report.respinEvery}`)
  assert.ok(report.freeEvery > 80 && report.freeEvery < 300, `free every ${report.freeEvery}`)
})

test('an engine restored from its saved state continues identically', () => {
  const a = new SlotEngine({ seed: 404, balance: 50000 })
  for (let k = 0; k < 40; k++) finishRound(a, a.spin(100), 100)
  a.spin(100, 'respin')
  const saved = JSON.parse(JSON.stringify(a.toState()))
  const b = SlotEngine.fromState(saved)
  for (let k = 0; k < 60; k++) {
    const left = a.spin(100)
    const right = b.spin(100)
    assert.deepEqual(right.grid, left.grid)
    assert.equal(right.stepWin, left.stepWin)
    assert.deepEqual(right.state, left.state)
  }
})

test('daily collect pays $500 plus $50 for every consecutive day before today', () => {
  const noon = (day: string) => Date.parse(`${day}T18:00:00Z`)
  assert.equal(vaultDay(Date.parse('2026-11-16T05:30:00Z')), '2026-11-15')
  assert.equal(previousDay('2026-03-01'), '2026-02-28')
  const first = dailyStatus(null, 0, noon('2026-11-10'))
  assert.equal(first.canCollect, true)
  assert.equal(first.amount, 50000)
  let streak = 0
  let last: string | null = null
  const paid: number[] = []
  for (const day of ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']) {
    const status = dailyStatus(last, streak, noon(day))
    assert.equal(status.canCollect, true)
    paid.push(status.amount)
    streak = status.nextStreak
    last = status.today
  }
  assert.deepEqual(paid, [50000, 55000, 60000, 65000, 70000, 75000])
  const again = dailyStatus(last, streak, noon('2026-11-15'))
  assert.equal(again.canCollect, false)
  const broken = dailyStatus(last, streak, noon('2026-11-17'))
  assert.equal(broken.streak, 0)
  assert.equal(broken.amount, 50000)
})
