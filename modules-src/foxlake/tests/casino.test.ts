import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateWays, buildStrip, windowAt } from '../casino/math/reels'
import { evaluateLines, LINES_25 } from '../casino/math/lines'
import { seededRng, type Rng } from '../casino/math/rng'
import { MACHINES, MACHINE_BY_ID, MO_DOLLAZ_ID, dollazCollect, playSpin, type Feature, type MachineState, type SpinResult } from '../casino/math/machines'
import { act, deal, newShoe, publicView, total } from '../casino/math/blackjack'
import { BAR, BLACKJACK, MACHINE_SPOTS, insideCasino, nearestSeat } from '../casino/CasinoLayout'

test('every machine returns between 80% and 110% of what is bet over a long run, with its features firing', () => {
  for (const def of MACHINES) {
    const rng = seededRng(7)
    let paid = 0
    let features = 0
    let state: MachineState = {}
    const N = 120000
    for (let i = 0; i < N; i++) {
      const r = playSpin(def, 1, rng, state)
      state = r.state
      paid += r.totalWin
      if (r.feature) features++
    }
    const rtp = paid / N
    assert.ok(rtp > 0.8 && rtp < 1.1, `${def.id} returned ${rtp.toFixed(3)}`)
    assert.ok(features > N / 600, `${def.id} features ${features}`)
  }
})

test('1,024 ways: a symbol pays on consecutive reels from the left, ways multiply, wild multipliers multiply on a way', () => {
  const grid = [['A', 'A', 'K', 'Q'], ['A', 'W', 'K', 'Q'], ['A', 'J', 'J', 'Q'], ['K', 'K', 'K', 'K'], ['A', 'A', 'A', 'A']]
  const wins = evaluateWays(grid, 1, { wild: 'W', nonPaying: new Set(), paytable: { A: [1, 2, 5] }, minCount: 3 })
  assert.equal(wins.length, 1)
  assert.equal(wins[0].count, 3)
  assert.equal(wins[0].ways, 2 * 2 * 1)
  assert.equal(wins[0].pay, 4)
  const x = evaluateWays(grid, 1, { wild: 'W', nonPaying: new Set(), paytable: { A: [1, 2, 5] }, minCount: 3, wildMultiplier: () => 3 })
  assert.equal(x[0].pay, (2 * (1 + 3) * 1) * 1)
})

test('lines pay left to right on the 25 shapes, wilds substitute', () => {
  const grid = [['K', 'A', 'Q'], ['J', 'W', 'Q'], ['J', 'A', 'Q'], ['A', 'K', 'J'], ['Q', 'Q', 'Q']]
  const wins = evaluateLines(grid, LINES_25, 1, { A: [5, 10, 50] }, 'W', new Set())
  const middle = wins.find((w) => w.line === 0)
  assert.ok(middle)
  assert.equal(middle!.count, 3)
  assert.equal(middle!.pay, 5)
})

test('reel strips are the same everywhere (same seed) and windows wrap', () => {
  const a = buildStrip({ A: 3, K: 3, Q: 2 }, 5)
  assert.deepEqual(a, buildStrip({ A: 3, K: 3, Q: 2 }, 5))
  assert.equal(a.length, 8)
  assert.deepEqual(windowAt(a, 7, 3), [a[7], a[0], a[1]])
  for (const def of MACHINES) for (const strip of def.strips) assert.ok(strip.length >= 40, def.id)
})

function findFeature(id: string, kind: string, rng: Rng, limit = 200000): SpinResult {
  const def = MACHINE_BY_ID[id]
  let state: MachineState = {}
  for (let i = 0; i < limit; i++) {
    const r = playSpin(def, 1, rng, state)
    state = r.state
    if (r.feature?.kind === kind) return r
  }
  throw new Error(`no ${kind} on ${id}`)
}

test('Hold & Spin: six or more orbs start it, every new orb resets the respins to 3, it ends at 0 or a full board (GRAND)', () => {
  const rng = seededRng(3)
  for (let n = 0; n < 20; n++) {
    const r = findFeature('northern-lights-link', 'holdspin', rng)
    const f = r.feature!
    assert.equal(f.kind, 'holdspin')
    if (f.kind !== 'holdspin') return
    assert.ok(Object.keys(f.start).length >= 6)
    let left = 3
    let locked = Object.keys(f.start).length
    for (const step of f.steps) {
      locked += step.landed.length
      left = step.landed.length ? 3 : left - 1
      assert.equal(step.left, left)
    }
    assert.ok(left === 0 || locked === 15)
    assert.equal(f.grand, locked === 15)
  }
})

test('gold free games: wilds carry 2x or 3x, the head meter converts animals at 4, 7, 13 and 15, retriggers add games', () => {
  const rng = seededRng(11)
  for (let n = 0; n < 15; n++) {
    const r = findFeature('moose-gold', 'freegames', rng)
    const f = r.feature!
    if (f.kind !== 'freegames') return
    for (const s of f.spins) {
      for (const m of Object.values(s.wildX ?? {})) assert.ok(m === 2 || m === 3)
      const meter = s.meter ?? 0
      const expect = ([[4, 'h2'], [7, 'h3'], [13, 'h4'], [15, 'h5']] as const).filter(([at]) => meter >= at).map(([, sym]) => sym)
      assert.deepEqual([...(s.converted ?? [])].sort(), [...expect].sort())
    }
    assert.ok(f.awarded >= 8 && f.awarded <= 180)
  }
})

test('the Revolution wheel spins at most five times and the fifth is always Start Free Games', () => {
  const rng = seededRng(13)
  for (let n = 0; n < 15; n++) {
    const r = findFeature('moose-gold-revolution', 'freegames', rng)
    const f = r.feature!
    if (f.kind !== 'freegames') return
    assert.ok(f.wheel && f.wheel.length >= 1 && f.wheel.length <= 5)
    const last = f.wheel![f.wheel!.length - 1]
    assert.equal(last.wedges[last.landed].kind, 'start')
    if (f.wheel!.length === 5) assert.ok(last.wedges.every((w) => w.kind === 'start'))
  }
})

test('houses: frames only grow straw to stick to brick, and every frame is blown down for a prize', () => {
  const rng = seededRng(17)
  for (let n = 0; n < 10; n++) {
    const r = findFeature('lodge-builders', 'houses', rng)
    const f = r.feature!
    if (f.kind !== 'houses') return
    let prev: Record<string, number> = {}
    for (const s of f.spins) {
      for (const [c, tier] of Object.entries(s.frames ?? {})) {
        assert.ok(tier >= 1 && tier <= 3)
        assert.ok(tier >= (prev[c] ?? 0))
      }
      prev = s.frames ?? {}
    }
    assert.equal(f.reveals.length, Object.keys(prev).length)
    const tiers = f.reveals.map((x) => x.tier)
    assert.deepEqual(tiers, [...tiers].sort())
  }
})

test('Cash Collect: the zone grows 2x2 -> 3x3 -> 4x4 -> 5x5 with gems and the spins run out', () => {
  const rng = seededRng(19)
  for (let n = 0; n < 10; n++) {
    const r = findFeature('bigfoot-bucks', 'cashcollect', rng)
    const f = r.feature!
    if (f.kind !== 'cashcollect') return
    let size = 2
    for (const s of f.steps) {
      assert.ok(s.zone.size >= size && s.zone.size <= 5)
      size = s.zone.size
      assert.ok(s.zone.reel + s.zone.size <= 5 && s.zone.row + s.zone.size <= 5)
    }
    assert.equal(f.steps[f.steps.length - 1].left, 0)
  }
})

test('the jackpot pick ends on the first jackpot revealed three times', () => {
  const rng = seededRng(23)
  for (let n = 0; n < 10; n++) {
    const r = findFeature('lake-monster-loot', 'jackpotpick', rng)
    const f = r.feature!
    if (f.kind !== 'jackpotpick') return
    const counts: Record<string, number> = {}
    f.tiles.forEach((t, i) => {
      counts[t] = (counts[t] ?? 0) + 1
      if (i < f.tiles.length - 1) assert.ok(counts[t] < 3)
    })
    assert.equal(counts[f.won], 3)
  }
})

test('blackjack: totals, the dealer hides the hole card, stands on 17, and settles', () => {
  assert.deepEqual(total(['AS', 'KD']), { value: 21, soft: true })
  assert.equal(total(['AS', 'AD', '9C']).value, 21)
  assert.equal(total(['KS', 'QD', '5C']).value, 25)
  const rng = seededRng(29)
  assert.equal(newShoe(rng).length, 312)
  for (let n = 0; n < 200; n++) {
    const t = deal(10, rng, null)
    if (t.phase === 'player') assert.equal(publicView(t).dealer[1], '??')
    let guard = 0
    while (t.phase === 'player' && guard++ < 20) act(t, total(t.hands[t.active].cards).value < 15 ? 'hit' : 'stand', rng)
    assert.equal(t.phase, 'settled')
    const d = total(t.dealer).value
    if (t.hands.some((h) => total(h.cards).value <= 21) && t.dealer.length > 2) assert.ok(d >= 17)
    assert.ok(t.payout >= 0 && t.payout <= t.hands.reduce((a, h) => a + h.bet, 0) * 2.5)
  }
})

test('the club holds every seat: ten machines, five stools, five blackjack spots, all inside its walls and apart', () => {
  for (const m of MACHINE_SPOTS) assert.ok(insideCasino(m.seat.x, m.seat.z))
  for (const s of [...BAR.stools, ...BLACKJACK.seats]) assert.ok(insideCasino(s.x, s.z))
  assert.equal(MACHINE_SPOTS.length, MACHINES.length)
  assert.equal(BAR.stools.length, 5)
  assert.equal(nearestSeat(BAR.stools[2].x, BAR.stools[2].z + 0.3, 1)?.kind, 'stool')
  const all = [...MACHINE_SPOTS.map((m) => m.seat), ...BAR.stools, ...BLACKJACK.seats]
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z) > 0.8, `seats ${i} and ${j} overlap`)
})

const DOLLAZ = MACHINE_BY_ID[MO_DOLLAZ_ID]
const inside = (zone: { reel: number; row: number; size: number }, cell: string) => {
  const [r, row] = cell.split(',').map(Number)
  return r >= zone.reel && r < zone.reel + zone.size && row >= zone.row && row < zone.row + zone.size
}
const kindsOf = (f: Feature | null): string[] => (!f ? [] : f.kind === 'chain' ? f.parts.map((p) => p.kind) : [f.kind])

test("Mo' Dollaz: the money bag is on reel 1 only, cash bills on reels 2-5 only, and a bag with any bill always starts Cash Collect", () => {
  DOLLAZ.strips.forEach((strip, reel) => {
    assert.equal(strip.includes('M'), reel === 0)
    assert.equal(strip.includes('N'), reel > 0)
  })
  const rng = seededRng(5)
  let checked = 0
  for (let i = 0; i < 200000 && checked < 25; i++) {
    const r = playSpin(DOLLAZ, 1, rng, {})
    if (r.base.grid[0].includes('M') && Object.keys(r.base.orbs ?? {}).length) {
      checked++
      assert.ok(kindsOf(r.feature).includes('cashcollect'))
    }
    if (r.feature?.kind === 'chain') assert.equal(r.feature.win, Math.round(r.feature.parts.reduce((a, p) => a + p.win, 0) * 100) / 100)
  }
  assert.ok(checked >= 10)
})

test("Mo' Dollaz Cash Collect: trigger bills are paid, the zone hops to every new bill, never lands one under itself, and grows at 5, 9 and 12 bills", () => {
  const rng = seededRng(11)
  for (let n = 0; n < 400; n++) {
    const f = dollazCollect(DOLLAZ, 1, rng, { '1,1': { credits: 2 }, '3,0': { credits: 5 } })
    assert.deepEqual(f.start?.map((c) => c.cell), ['1,3', '3,2'])
    let zone = f.zone!
    let bills = 2
    let spins = 5
    for (const step of f.steps) {
      assert.equal(step.path?.length, step.gems.length)
      if (zone.size === 5) assert.equal(step.gems.length, 0)
      for (const gem of step.gems) assert.ok(!inside(zone, gem.cell), 'a bill landed under the zone')
      step.gems.forEach((gem, i) => assert.ok(inside(step.path![i], gem.cell), 'the zone did not reach the bill'))
      for (const coin of step.coins) assert.equal(coin.collected, inside(zone, coin.cell))
      const before = bills
      bills += step.gems.length
      for (const [need, add] of [[5, 3], [9, 2], [12, 1]]) if (before < need && bills >= need) spins += add
      assert.equal(step.zone.size, bills >= 12 ? 5 : bills >= 9 ? 4 : bills >= 5 ? 3 : 2)
      zone = step.zone
    }
    assert.equal(f.steps.length, spins)
    assert.equal(f.steps[f.steps.length - 1].left, 0)
    assert.equal(f.win, f.steps[f.steps.length - 1].collected)
  }
})

test("Mo' Dollaz meters stay within their limits and a full meter guarantees its feature", () => {
  const rng = seededRng(3)
  let state: MachineState = { meters: { green: 0, pink: DOLLAZ.meterFull!.pink - 1, blue: 0 } }
  for (let i = 0; i < 5000; i++) {
    const before = state.meters!.pink
    const r = playSpin(DOLLAZ, 1, rng, state)
    const scatters = r.base.grid.flat().filter((s) => s === 'S').length
    if (before + scatters >= DOLLAZ.meterFull!.pink) {
      assert.ok(kindsOf(r.feature).includes('freegames'))
      break
    }
    for (const k of ['green', 'pink', 'blue'] as const) assert.ok(r.state.meters![k] <= DOLLAZ.meterFull![k])
    state = r.state
  }
})
