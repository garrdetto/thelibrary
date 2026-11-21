import assert from 'node:assert/strict'
import { test } from 'node:test'
import { axiomMeasures, axiomScore, noteAxiomRow, resetAxiomScoreForTests, scaleMeasure } from './axiom-score.js'
import type { PulseRow } from './pulse-feed.js'

const row = (over: Partial<PulseRow>): PulseRow => ({
  column: 'newPairs', pairAddress: 'So11111111111111111111111111111111111111112', tokenAddress: 'So11111111111111111111111111111111111111112',
  marketCap: 100, volume: 50, buyVolume: 30, numHolders: 100, numTxns: 200, numBuys: 120, numSells: 80, userCount: 40,
  top10HoldersPercent: 20, devHoldsPercent: 2, snipersHoldPercent: 3, insidersHoldPercent: 1, bundlersHoldPercent: 5, freshWalletsHoldPercent: 4,
  proTradersHoldPercent: 10, kolCount: 1, devCreationCount: 1, devMigrationCount: 0, twitter: 'x', ...over,
} as PulseRow)

test('measures come only from the Pulse rows: changes, per-minute rates and shares', () => {
  resetAxiomScoreForTests()
  const mint = 'Mint1111111111111111111111111111111111111111'
  const t0 = 1_000_000
  noteAxiomRow(mint, row({ marketCap: 100, numHolders: 100, numTxns: 200, numBuys: 120, numSells: 80, userCount: 40 }), 70, t0)
  noteAxiomRow(mint, row({ marketCap: 105, numHolders: 110, numTxns: 230, numBuys: 145, numSells: 85, userCount: 50 }), 70, t0 + 30_000)
  noteAxiomRow(mint, row({ marketCap: 120, numHolders: 130, numTxns: 280, numBuys: 180, numSells: 100, userCount: 60 }), 70, t0 + 60_000)
  const measures = axiomMeasures(mint, t0 + 60_000)
  assert.equal(Math.round(measures.mcapChange1m!), 20)
  assert.equal(Math.round(measures.mcapChange30s!), 14)
  assert.equal(Math.round(measures.holdersPerMin!), 30)
  assert.equal(Math.round(measures.buyShare1m!), 75)
  assert.equal(measures.viewersChange1m, 50)
  assert.equal(measures.buyVolumeShare, 60)
  const score = axiomScore(mint, t0 + 60_000)
  assert.ok(score && score.score >= 0 && score.score <= 100)
  assert.ok(score!.parts.every(part => part.scaled >= 0 && part.scaled <= 100))
})

test('chasing a spike scores low on calm, and lower-is-better shares are flipped', () => {
  resetAxiomScoreForTests()
  const mint = 'Mint2222222222222222222222222222222222222222'
  noteAxiomRow(mint, row({ marketCap: 100 }), 70, 0)
  noteAxiomRow(mint, row({ marketCap: 140 }), 70, 30_000)
  assert.equal(axiomMeasures(mint, 30_000).calm, 0)
  assert.equal(scaleMeasure('bundlers', 30, 0), 70)
  assert.equal(scaleMeasure('buyShare1m', 80, 0), 80)
})

test('with enough coins seen, a measure is its rank among them', () => {
  resetAxiomScoreForTests()
  for (let index = 0; index < 100; index += 1) {
    const mint = `Coin-${index}`
    noteAxiomRow(mint, row({ userCount: index }), 70, 0)
  }
  assert.equal(scaleMeasure('viewers', 75, 1), 75.5)
  assert.equal(scaleMeasure('viewers', 0, 1), 0.5)
})

test('a tiny holder share ranks with the exact zeros, not above them', () => {
  resetAxiomScoreForTests()
  for (let index = 0; index < 100; index += 1) noteAxiomRow(`Zero-${index}`, row({ snipersHoldPercent: index < 80 ? 0 : 5 + index }), 70, 1_000_000)
  const tiny = scaleMeasure('snipers', 0.00004, 1_000_001)
  const zero = scaleMeasure('snipers', 0, 1_000_001)
  assert.equal(tiny, zero)
  assert.ok(tiny >= 50)
})

test('one pool per coin: the followed pool stays unless another is over twice as deep', async () => {
  const { deeperPool } = await import('./pulse-feed.js')
  const pool = (pairAddress: string, liquidityNative: number) => row({ pairAddress, liquidityNative } as Partial<PulseRow>)
  assert.equal(deeperPool(pool('B', 150), pool('A', 100), 'A'), false)
  assert.equal(deeperPool(pool('B', 250), pool('A', 100), 'A'), true)
  assert.equal(deeperPool(pool('B', 150), pool('A', 100), null), true)
})
