import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RadarToken } from '../../src/lib/axiom-radar-types.js'
import { goneAfterMs, planWatchlist, watchScore, type WatchRow } from './watchlist.js'

const now = 1_800_000_000_000
const settings = { enabled: true, score: 'dex' as const, addAt: 60, removeAt: 40, maxCoins: 2 }

function coin(mint: string, dex: number | null, changes: Partial<RadarToken> = {}) {
  return { mint, pairAddress: `pair${mint}`, symbol: mint.toUpperCase(), score: 50, dex: dex === null ? null : { score: dex, moves: { s5: null, s30: null, m1: null, m5: null }, signal: null, checks: [], cuts: [] }, holderRisk: null, botClimb: false, ...changes } as unknown as RadarToken
}

function row(mint: string, changes: Partial<WatchRow> = {}): WatchRow {
  return { mint, pair_address: `pair${mint}`, symbol: mint.toUpperCase(), state: 'on', reason: null, attempts: 0, added_at: now - 60_000, updated_at: now - 1_000, ...changes }
}

test('adds the best clean coins at the add level, up to the free slots', () => {
  const plan = planWatchlist([coin('a', 61), coin('b', 90), coin('c', 75), coin('d', 59), coin('e', 95, { botClimb: true })], [], settings, now)
  assert.deepEqual(plan.add.map(item => item.mint), ['b', 'c'])
  assert.equal(plan.remove.length, 0)
})

test('keeps a watched coin until it falls under the remove level, and never re-adds it', () => {
  const plan = planWatchlist([coin('a', 45), coin('b', 39), coin('c', 80)], [row('a'), row('b')], settings, now)
  assert.deepEqual(plan.remove.map(item => item.row.mint), ['b'])
  assert.match(plan.remove[0].reason, /fell to 39, under 40/)
  assert.deepEqual(plan.add.map(item => item.mint), ['c'])
})

test('removes coins that break a holder limit, left the Radar a while ago, or when the watchlist is turned off', () => {
  const blocked = coin('a', 90, { holderRisk: { blocked: true, multiplier: 0, reasons: ['Top 10 hold 45%'] } })
  const plan = planWatchlist([blocked], [row('a'), row('gone', { updated_at: now - goneAfterMs - 1 }), row('brief')], settings, now)
  assert.deepEqual(plan.remove.map(item => item.row.mint), ['a', 'gone'])
  const off = planWatchlist([coin('x', 90)], [row('x')], { ...settings, enabled: false }, now)
  assert.equal(off.remove.length, 1)
  assert.equal(off.add.length, 0)
})

test('the blend falls back to the runner score until the DexScreener score arrives', () => {
  assert.equal(watchScore(coin('a', null, { score: 70 }), 'blend'), 70)
  assert.equal(watchScore(coin('a', 50, { score: 70 }), 'blend'), 60)
  assert.equal(watchScore(coin('a', null), 'dex'), null)
})
