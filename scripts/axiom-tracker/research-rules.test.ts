import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freshShare, freshWindowMs, walletFreshness, type WalletStart } from './fresh-wallets.js'
import { holderLimitBreaks } from './holder-limits.js'
import { analyzeShape, quickDump, type PricePoint } from './price-shape.js'
import { judgeResearch, type VerdictInput } from './research-verdict.js'
import { stepRise, type RiseState } from './rise-traits.js'

const clean = { top10: 18, fresh: 4, dev: 0, bundlers: 6, insiders: 3, snipers: 2, linked: 1, holders: 420, traders: 140, devCreated: 3, devMigrated: 1 }
const verdict = (overrides: Partial<VerdictInput> = {}) => judgeResearch({ rise: clean, freshFallback: null, mintAuthority: false, freezeAuthority: false, riskyRugCheck: false, shape: null, earlyHolders: 150, ...overrides })

test('a coin with clean holder numbers before its peak is positive', () => {
  assert.deepEqual(verdict().negatives, [])
})

test('top 10, dev or bundlers over 30% before the peak is negative', () => {
  for (const [key, value] of [['top10', 36], ['dev', 31], ['bundlers', 31]] as const) {
    const result = verdict({ rise: { ...clean, [key]: value } })
    assert.ok(result.negatives.length > 0, key)
  }
  assert.ok(verdict({ rise: { ...clean, top10: 35.5 } }).kinds.includes('Concentrated holders'))
  assert.deepEqual(verdict({ rise: { ...clean, top10: 35 } }).negatives, [])
})

test('fresh wallets over 10% is never positive', () => {
  assert.ok(verdict({ rise: { ...clean, fresh: 10.2 } }).kinds.includes('Fresh wallets'))
  assert.deepEqual(verdict({ rise: { ...clean, fresh: 10 } }).negatives, [])
  assert.ok(verdict({ rise: { ...clean, fresh: undefined }, freshFallback: 22 }).kinds.includes('Fresh wallets'))
})

test('a coin whose top 10 or fresh wallets were never checked before its peak is not positive', () => {
  assert.ok(verdict({ rise: { ...clean, top10: undefined } }).negatives.length > 0)
  assert.ok(verdict({ rise: { ...clean, fresh: undefined }, freshFallback: null }).negatives.length > 0)
})

test('readings taken after the peak never count toward the coin', () => {
  let state: RiseState = { rise: {}, pending: {} }
  state = stepRise(state, { top10: 20, fresh: 3 }, false)
  state = stepRise(state, { top10: 22, fresh: 4 }, true)
  assert.deepEqual(state.rise, { top10: 22, fresh: 4 })
  state = stepRise(state, { top10: 65, fresh: 40 }, false)
  state = stepRise(state, { top10: 80 }, false)
  assert.deepEqual(state.rise, { top10: 22, fresh: 4 })
  assert.deepEqual(verdict({ rise: { ...clean, ...state.rise } }).negatives, [])
})

test('readings before a later new high do count', () => {
  let state: RiseState = { rise: { top10: 15 }, pending: {} }
  state = stepRise(state, { top10: 34 }, false)
  state = stepRise(state, null, true)
  assert.equal(state.rise.top10, 34)
})

test('a wallet first used within a day of launch is fresh', () => {
  const launch = 1_800_000_000_000
  const fresh: WalletStart = { oldestAt: launch - 2 * 60 * 60_000, complete: true }
  const old: WalletStart = { oldestAt: launch - freshWindowMs - 60_000, complete: false }
  const busy: WalletStart = { oldestAt: launch - 60_000, complete: false }
  assert.equal(walletFreshness(fresh, launch), true)
  assert.equal(walletFreshness(old, launch), false)
  assert.equal(walletFreshness(busy, launch), false)
  assert.equal(walletFreshness(undefined, launch), null)
})

test('fresh share adds up the fresh wallets and needs five checked holders', () => {
  const launch = 1_800_000_000_000
  const starts = new Map<string, WalletStart>([
    ['a', { oldestAt: launch - 60_000, complete: true }],
    ['b', { oldestAt: launch + 60_000, complete: true }],
    ['c', { oldestAt: launch - 30 * 86_400_000, complete: false }],
    ['d', { oldestAt: launch - 30 * 86_400_000, complete: true }],
    ['e', { oldestAt: launch - 40 * 86_400_000, complete: true }],
  ])
  const holders = [{ wallet: 'a', pct: 4.5 }, { wallet: 'b', pct: 3 }, { wallet: 'c', pct: 2 }, { wallet: 'd', pct: 1 }, { wallet: 'e', pct: 1 }]
  assert.equal(freshShare(holders, starts, launch), 7.5)
  assert.equal(freshShare(holders.slice(0, 4), starts, launch), null)
})

test('live coins with fresh wallets over 10% break a holder limit', () => {
  const traits = { top10: 14, dev: 0, snipers: 3, insiders: 2, bundlers: 4, linked: 1 }
  assert.equal(holderLimitBreaks({ ...traits, fresh: 9.9 }).length, 0)
  assert.ok(holderLimitBreaks({ ...traits, fresh: 12 }).some(line => line.startsWith('Fresh wallets')))
})

const start = 1_800_000_000_000
const series = (prices: number[], stepMs = 30_000): PricePoint[] => prices.map((price, index) => ({ t: start + index * stepMs, price }))

test('a coin that runs and falls half below its peak within 15 minutes of its breakout is a pump and dump', () => {
  const prices = [1, 1.4, 2.1, 3, 4.2, 5.5, 6.1, 5.2, 3.8, 2.6, 2.4, 2.2]
  const shape = analyzeShape(series(prices, 60_000))
  assert.ok(shape && quickDump(shape))
  assert.ok(verdict({ shape }).kinds.includes('Pump and dump'))
})

test('a run that holds for a while before dumping is not a pump and dump', () => {
  const prices = [1, 1.6, 2.4, 3.3, 4, 4.6, 5.2, 5.8, 6, ...Array.from({ length: 30 }, (_, index) => 5.4 + Math.sin(index) * 0.5), 3.5, 2.5]
  const shape = analyzeShape(series(prices, 60_000))
  assert.ok(shape)
  assert.equal(quickDump(shape), false)
  assert.ok(!verdict({ shape }).kinds.includes('Pump and dump'))
})

test('a steady even climb followed by a steady even slide is the rug pattern', () => {
  const rise = Array.from({ length: 20 }, (_, index) => 1.15 ** index)
  const top = rise[rise.length - 1]
  const fall = Array.from({ length: 20 }, (_, index) => top * 0.93 ** (index + 1))
  const shape = analyzeShape(series([...rise, ...fall], 60_000))
  assert.ok(shape?.steadyRise && shape.steadyFall)
  assert.ok(verdict({ shape }).kinds.includes('Rug pull pattern'))
})

test('a choppy organic run and fall is not the rug pattern', () => {
  const prices = [1, 1.5, 1.2, 2, 1.6, 2.8, 2.2, 3.5, 2.9, 4.4, 3.6, 5, 4.1, 3.2, 4, 2.9, 3.3, 2.2, 2.7, 1.9, 2.1, 1.5]
  const shape = analyzeShape(series(prices, 60_000))
  assert.ok(shape)
  assert.equal(shape.steadyRise && shape.steadyFall, false)
})

test('a dev over 5% before the peak is negative', () => {
  assert.ok(verdict({ rise: { ...clean, dev: 5.5 } }).kinds.includes('Dev heavy'))
  assert.deepEqual(verdict({ rise: { ...clean, dev: 4.9 } }).negatives, [])
})

test('a coin from a serial launcher dev is negative', () => {
  assert.ok(verdict({ rise: { ...clean, devCreated: 1430, devMigrated: 60 } }).kinds.includes('Serial launcher dev'))
  assert.deepEqual(verdict({ rise: { ...clean, devCreated: 40, devMigrated: 9 } }).negatives, [])
  assert.deepEqual(verdict({ rise: { ...clean, devCreated: 12, devMigrated: 0 } }).negatives, [])
})

test('a run without growing holders or many traders has no organic demand', () => {
  assert.ok(verdict({ rise: { ...clean, holders: 180 }, earlyHolders: 160 }).kinds.includes('No organic demand'))
  assert.ok(verdict({ rise: { ...clean, traders: 30 } }).kinds.includes('No organic demand'))
  assert.ok(verdict({ rise: { ...clean, holders: 80 }, earlyHolders: null }).kinds.includes('No organic demand'))
  assert.deepEqual(verdict({ rise: { ...clean, holders: 240 }, earlyHolders: 160 }).negatives, [])
})
