import assert from 'node:assert/strict'
import { test } from 'node:test'
import { holderLimitBreaks } from './holder-limits.js'
import { scoreRunner, type RunnerInput } from './runner-score.js'
import { pageStatsAt, pageStatsFreshMs, pageStatsKeptMs, pageStatsLiveMs, parsePageStats } from './page-stats.js'

const now = 1_800_000_000_000

test('reads the holder figures by their abbreviated labels', () => {
  const stats = parsePageStats({ 'Top 10 H.': 58.04, 'Dev H.': 40.23, 'Snipers H.': 40.23, Insiders: 3.1, Bundlers: 12, 'Fresh W.': 22.5, 'LP Burned': 100 }, now)
  assert.deepEqual(stats && { top10: stats.top10, dev: stats.dev, snipers: stats.snipers, insiders: stats.insiders, bundlers: stats.bundlers, fresh: stats.fresh }, { top10: 58.04, dev: 40.23, snipers: 40.23, insiders: 3.1, bundlers: 12, fresh: 22.5 })
  assert.ok(!stats?.labels.includes('LP Burned'))
})

test('reads the Token Info box as Axiom shows it on a new coin', () => {
  const stats = parsePageStats({ 'AGn7ek...fan2': 2.577, 'Dev wallet': 5, 'Top 10 H.': 82.91, 'Dev H.': 0, 'Snipers H.': 0.05, Insiders: 78.16, Bundlers: 0, 'Fresh Wallets': 0.14, 'Pro Traders Holding': 83.2 }, now)
  assert.deepEqual(stats && { top10: stats.top10, dev: stats.dev, snipers: stats.snipers, insiders: stats.insiders, bundlers: stats.bundlers, fresh: stats.fresh }, { top10: 82.91, dev: 0, snipers: 0.05, insiders: 78.16, bundlers: 0, fresh: 0.14 })
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

test('fresh wallets over 10% score 0', () => {
  const input: RunnerInput = {
    now, marketCap: 30_000, liquidity: 14_000, priceChange: { m1: 3, m5: 20 }, ticks: [], top10: 14, dev: 0, devSold: true, snipers: 3, insiders: 2,
    bundlers: 4, linked: 1, fresh: 10.5, holders: 500, mintAuthority: false, freezeAuthority: false, rugged: false, devCreated: null, devMigrated: null,
    recycled: null, buys5m: 300, volume5m: 42_000, buyers5m: 120, buyVolume5m: 20_000, sellVolume5m: 12_000, feesSol: 2, graduated: false, dexPaid: true,
    links: { twitter: null, telegram: null, website: null }, reusedLinks: [], smartHolders: 1, viewers: 100, viewersPerMin: 20, botReason: null,
    selling: [], devSelling: false, learned: [],
  }
  const result = scoreRunner(input)
  assert.equal(result.score, 0)
  assert.ok(result.holderRisk.reasons.some((reason: string) => reason.startsWith('Fresh wallets hold')))
  assert.deepEqual(holderLimitBreaks({ top10: 14, dev: 0, snipers: 3, insiders: 2, bundlers: 4, linked: 1, fresh: 9.9 }), [])
})
