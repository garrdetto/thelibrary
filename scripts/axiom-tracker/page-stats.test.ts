import assert from 'node:assert/strict'
import { test } from 'node:test'
import { holderLimitBreaks, moverCaps, scoreMover, type MoverInput } from './mover-score.js'
import { pageStatsAt, pageStatsFreshMs, pageStatsKeptMs, pageStatsLiveMs, parsePageStats } from './page-stats.js'

const now = 1_800_000_000_000

test('reads the holder figures by their abbreviated labels', () => {
  const stats = parsePageStats({ 'Top 10 H.': 58.04, 'Dev H.': 40.23, 'Snipers H.': 40.23, Insiders: 3.1, Bundlers: 12, 'Fresh W.': 22.5, 'LP Burned': 100 }, now)
  assert.deepEqual(stats && { top10: stats.top10, dev: stats.dev, snipers: stats.snipers, insiders: stats.insiders, bundlers: stats.bundlers, fresh: stats.fresh }, { top10: 58.04, dev: 40.23, snipers: 40.23, insiders: 3.1, bundlers: 12, fresh: 22.5 })
  assert.ok(!stats?.labels.includes('LP Burned'))
})

test('a page without holder figures is not a reading', () => {
  assert.equal(parsePageStats({ 'Bonding': 44, 'Buy tax': 0 }, now), null)
  assert.equal(parsePageStats({ 'Top 10 H.': 20 }, now), null)
})

test('fresh wallets stay empty when Axiom does not show them', () => {
  assert.equal(parsePageStats({ 'Top 10 H.': 12, 'Dev H.': 0, 'Snipers H.': 1 }, now)?.fresh, null)
})

test('a reading stands alone for two minutes, counts for eight and is kept for thirty', () => {
  const stats = parsePageStats({ 'Top 10 H.': 12, 'Dev H.': 0 }, now)
  assert.ok(stats)
  assert.ok(pageStatsAt(stats, now + pageStatsLiveMs - 1).live)
  assert.equal(pageStatsAt(stats, now + pageStatsLiveMs + 1).live, null)
  assert.ok(pageStatsAt(stats, now + pageStatsFreshMs - 1).recent)
  assert.equal(pageStatsAt(stats, now + pageStatsFreshMs + 1).recent, null)
  assert.ok(pageStatsAt(stats, now + pageStatsFreshMs + 1).kept)
  assert.equal(pageStatsAt(stats, now + pageStatsKeptMs + 1).kept, null)
})

test('fresh wallets over 10% score low', () => {
  const input: MoverInput = {
    now, ageMinutes: 12, marketCap: 180_000, priceChange: { s30: 2, m1: 6, m5: 20 }, buys5m: 300, sells5m: 180, volume5m: 42_000,
    viewers: 100, viewersPerMin: 20, viewersDelta5m: 55, holders: 500, holdersPerMin: 25, holderChange5mPct: null, smartHolders: 1,
    traits: { top10: 14, dev: 0, snipers: 3, insiders: 2, bundlers: 4, linked: 1, fresh: 10.5 }, rugged: false, traders5m: 320, netBuyers5m: 150, flow: [],
  }
  const result = scoreMover(input)
  assert.ok(result.score <= moverCaps.holderLimit, `score ${result.score}`)
  assert.ok(result.holderRisk.reasons.some(reason => reason.startsWith('Fresh wallets hold')))
  assert.deepEqual(holderLimitBreaks({ top10: 14, dev: 0, snipers: 3, insiders: 2, bundlers: 4, linked: 1, fresh: 9.9 }), [])
})
