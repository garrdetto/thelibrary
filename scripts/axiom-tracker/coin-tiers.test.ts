import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assignTiers, buildLadder, classifyCoin, dataWeight, matchTier, minimumArchive, outcomeScore, tierCount, type FeatureValues } from './coin-tiers.js'

test('data weight grows with readings and minutes watched, from nothing to 1', () => {
  assert.equal(dataWeight(0, 10), 0)
  assert.ok(dataWeight(5, 1) < 0.1)
  assert.ok(dataWeight(40, 10) < dataWeight(120, 30))
  assert.ok(dataWeight(400, 120) > 0.99 && dataWeight(400, 120) <= 1)
})

test('coins are classed as garbage, steady-rise rugs, rugs, runners or normal', () => {
  const base = { points: 50, hasLifecycle: true, maxLiquidity: 20_000, peakVolume5m: 8_000, outcome: 'faded', multiple: 1.5, upShare: 0.5, volumeToMcap: 0.2 }
  assert.equal(classifyCoin({ ...base, maxLiquidity: 4_000 }), 'garbage')
  assert.equal(classifyCoin({ ...base, peakVolume5m: 500 }), 'garbage')
  assert.equal(classifyCoin({ ...base, points: 3, hasLifecycle: false }), 'garbage')
  assert.equal(classifyCoin({ ...base, points: 3, peakVolume5m: null, outcome: 'survived', multiple: 5 }), 'runner', 'a coin whose chart was pruned is judged by its lifecycle')
  assert.equal(classifyCoin({ ...base, outcome: 'rug', upShare: 0.85, volumeToMcap: 0.02 }), 'steady_rug')
  assert.equal(classifyCoin({ ...base, outcome: 'rug', upShare: 0.85, volumeToMcap: 0.3 }), 'rug', 'real volume behind the climb is an ordinary rug')
  assert.equal(classifyCoin({ ...base, outcome: 'survived', multiple: 4 }), 'runner')
  assert.equal(classifyCoin(base), 'normal')
})

test('the outcome score ranks big held runs first and junk last', () => {
  const coin = (multiple: number, kept: number, cls: Parameters<typeof outcomeScore>[0]['cls'], lifeMinutes = 90) => outcomeScore({ firstMcap: 10_000, peakMcap: 10_000 * multiple, lastMcap: 10_000 * multiple * kept, maxLiquidity: 30_000, peakVolume5m: 15_000, lifeMinutes, cls })
  const twentyHeld = coin(20, 0.9, 'runner')
  const fiveHeld = coin(5, 0.9, 'runner')
  const tenRugged = coin(10, 0.05, 'rug', 30)
  const doubleFaded = coin(2, 0.3, 'normal', 30)
  const flat = coin(1, 1, 'normal', 240)
  const staircase = coin(3, 0.05, 'steady_rug', 40)
  const junk = coin(1.2, 0.5, 'garbage', 5)
  assert.ok(twentyHeld > fiveHeld && fiveHeld > tenRugged && tenRugged > doubleFaded && doubleFaded > flat, JSON.stringify({ twentyHeld, fiveHeld, tenRugged, doubleFaded, flat }))
  assert.ok(staircase < doubleFaded && junk < flat)
  assert.ok(twentyHeld <= 100 && junk >= 0)
  assert.equal(coin(25_000, 0.01, 'rug', 10), coin(1, 1, 'rug', 10), 'an impossible spike scores as no rise')
})

test('tiers split the ranking into 20 groups of equal size, best first', () => {
  const rows = Array.from({ length: 400 }, (_, index) => ({ mint: `coin-${index}`, score: index }))
  const tiers = assignTiers(rows)
  assert.equal(tiers.get('coin-399'), 1)
  assert.equal(tiers.get('coin-0'), tierCount)
  for (let tier = 1; tier <= tierCount; tier++) assert.equal([...tiers.values()].filter(value => value === tier).length, 20)
})

test('tiers hold equal shares of data weight, so thin coins crowd into the bottom tier', () => {
  const rows = [
    ...Array.from({ length: 100 }, (_, index) => ({ mint: `solid-${index}`, score: 50 + index, weight: 1 })),
    ...Array.from({ length: 300 }, (_, index) => ({ mint: `thin-${index}`, score: index / 1_000, weight: 0.001 })),
  ]
  const tiers = assignTiers(rows)
  for (let tier = 1; tier <= tierCount; tier++) assert.ok([...tiers.entries()].some(([mint, value]) => value === tier && mint.startsWith('solid')), `tier ${tier} has well-documented coins`)
  assert.ok([...tiers.entries()].filter(([mint]) => mint.startsWith('thin')).every(([, value]) => value === tierCount))
})

function ladderRows(count: number) {
  const rows: Array<{ tier: number; score: number; weight: number; features: FeatureValues }> = []
  for (let index = 0; index < count; index++) {
    const tier = (index % tierCount) + 1
    const wobble = ((index * 7) % 5) - 2
    rows.push({ tier, score: 100 - tier * 5, weight: 1, features: { viewers: 400 / tier + wobble, buyRatio: 0.8 - tier * 0.02 + wobble * 0.002, bundlers: tier * 2 + wobble * 0.1, top10: 10 + tier + wobble * 0.1, quality: 90 - tier * 3 + wobble } })
  }
  return rows
}

test('a live coin is matched to the tier it looks like, with risk from the bottom five', () => {
  const ladder = buildLadder(ladderRows(400))
  const good = matchTier({ viewers: 400 / 3, buyRatio: 0.74, bundlers: 6, top10: 13, quality: 81 }, ladder)
  assert.ok(good, 'a match')
  assert.equal(good.tier, 3)
  assert.ok(good.risk < 0.05, JSON.stringify(good))
  assert.ok(good.score > 80)
  const bad = matchTier({ viewers: 400 / 19, buyRatio: 0.42, bundlers: 38, top10: 29, quality: 33 }, ladder)
  assert.ok(bad && bad.tier >= 18 && bad.risk > 0.8, JSON.stringify(bad))
  assert.equal(good.coins, 400)
})

test('no match before the archive is big enough or when a coin has too few readings', () => {
  assert.equal(matchTier({ viewers: 100, buyRatio: 0.7, bundlers: 5, top10: 12 }, buildLadder(ladderRows(minimumArchive - 20))), null)
  assert.equal(matchTier({ viewers: 100, buyRatio: 0.7 }, buildLadder(ladderRows(400))), null)
  assert.equal(matchTier({ viewers: 100 }, null), null)
})

test('a coin with more data pulls its tier profile harder', () => {
  const rows = ladderRows(400).map(row => ({ ...row, weight: 0.05 }))
  rows.push({ tier: 1, score: 99, weight: 50, features: { viewers: 5_000, buyRatio: 0.9, bundlers: 1, top10: 8, quality: 95 } })
  const ladder = buildLadder(rows)
  const tier1 = ladder.profiles.find(profile => profile.tier === 1)
  assert.ok(tier1 && tier1.stats.viewers.mean > Math.log1p(2_000), 'the heavy coin dominates tier 1')
})
