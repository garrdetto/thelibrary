import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWalletBook, coinResult, scoreWallets, type CoinResult, type WalletSighting } from './wallet-score.js'

const hour = 3_600_000
const win = (mint: string, peakAt: number): CoinResult => ({ mint, win: true, closed: true, peakAt, knownAt: peakAt })
const dud = (mint: string, closedAt: number): CoinResult => ({ mint, win: false, closed: true, peakAt: closedAt - 1, knownAt: closedAt })

function history() {
  const results: CoinResult[] = []
  const sightings: WalletSighting[] = []
  for (let index = 0; index < 60; index++) results.push(dud(`filler-${index}`, hour))
  for (let index = 0; index < 4; index++) {
    results.push(win(`winner-${index}`, 2 * hour))
    sightings.push({ wallet: 'sharp', mint: `winner-${index}`, pct: 2, at: hour })
    sightings.push({ wallet: 'late', mint: `winner-${index}`, pct: 2, at: 3 * hour })
    sightings.push({ wallet: 'tiny', mint: `winner-${index}`, pct: 0.05, at: hour })
    results.push(dud(`rug-${index}`, 2 * hour))
    sightings.push({ wallet: 'rugger', mint: `rug-${index}`, pct: 3, at: hour })
  }
  return buildWalletBook(sightings, results, 5 * hour)
}

test('a lifecycle counts as a win only when it grew 3x to at least $50k', () => {
  assert.equal(coinResult({ mint: 'a', first_mcap: 10_000, peak_mcap: 60_000, peak_mcap_at: 5, outcome: 'open', closed_at: null })?.win, true)
  assert.equal(coinResult({ mint: 'b', first_mcap: 10_000, peak_mcap: 25_000, peak_mcap_at: 5, outcome: 'rug', closed_at: 9 })?.win, false)
  assert.equal(coinResult({ mint: 'c', first_mcap: 10_000, peak_mcap: 25_000, peak_mcap_at: 5, outcome: 'open', closed_at: null }), null)
})

test('wallets that held winners before the peak lift the score; late buyers and tiny holders do not', () => {
  const book = history()
  assert.equal(book.pasts.get('sharp')?.length, 4)
  assert.equal(book.pasts.has('late'), false)
  assert.equal(book.pasts.has('tiny'), false)
  const sharp = scoreWallets([{ wallet: 'sharp', pct: 3 }], 100_000, book, 'new-coin', 0)
  assert.ok(sharp.score >= 75, `score ${sharp.score}`)
  assert.equal(sharp.goodWhales, 1)
  assert.equal(sharp.whales, 1)
  assert.equal(sharp.smartUsd, 3_000)
  const late = scoreWallets([{ wallet: 'late', pct: 3 }], 100_000, book, 'new-coin', 0)
  assert.equal(late.score, 50)
})

test('holders tied to coins that died pull the score down', () => {
  const book = history()
  const result = scoreWallets([{ wallet: 'rugger', pct: 4 }], 100_000, book, 'new-coin', 0)
  assert.ok(result.score < 35, `score ${result.score}`)
  assert.equal(result.badWhales, 1)
})

test('tiny holders are ignored by share of supply and by dollars, and pools are skipped', () => {
  const book = history()
  const result = scoreWallets([
    { wallet: 'sharp', pct: 0.2 },
    { wallet: 'rugger', pct: 1 },
    { wallet: 'pool', pct: 40 },
  ], 5_000, book, 'new-coin', 0)
  assert.equal(result.holders, 0)
  assert.equal(result.ignored, 2)
  assert.equal(result.score, 50)
})

test('a coin never counts toward its own holders', () => {
  const book = history()
  const own = scoreWallets([{ wallet: 'sharp', pct: 3 }], 100_000, book, 'winner-0', 0)
  const other = scoreWallets([{ wallet: 'sharp', pct: 3 }], 100_000, book, 'new-coin', 0)
  assert.ok(own.score < other.score)
})
