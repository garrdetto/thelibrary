import assert from 'node:assert/strict'
import test from 'node:test'
import { notePollStats, pollNote, walletSightings } from './axiom-capture.js'

const pair = '7nzPonveUgJKzUFBi6jCgtEX5FhnCLqS4b8H3xpkb7aP'
const mint = 'c8ptadDszEWiv6CBS5MqTrDsaV3pqwtKxAXn5Nipump'
const walletA = '742iDpQvEVbW3wRRBGxPPnERzSxdLPSFGUB3pUKXE7Xm'
const walletB = 'BD9fqvNBL4J9Zb5hx8u2hkGbTj7UnR2Jt8Wb3FQDf7qB'

test('wallets are found in holder lists and trade feeds with the numbers beside them', () => {
  const answer = { pairAddress: pair, holders: [{ walletAddress: walletA, tokenAddress: mint, percent: 2.5, usdInvested: 120 }], trades: [{ maker: walletB, type: 'buy', usd: 40, signature: 'x'.repeat(88) }] }
  const found = walletSightings(answer, new Set([pair]))
  assert.deepEqual(found.map(sighting => [sighting.wallet, sighting.key]), [[walletA, 'walletAddress'], [walletB, 'maker']])
  assert.equal(found[0].fields.percent, 2.5)
  assert.equal(found[1].fields.type, 'buy')
})

test('token, pair and pool addresses are never taken for wallets', () => {
  const found = walletSightings({ tokenAddress: mint, pairAddress: pair, poolAddress: walletA, devAddress: walletB }, new Set())
  assert.deepEqual(found.map(sighting => sighting.wallet), [walletB])
})

test('only public market answers are kept, never the signed-in person\'s own data', async () => {
  const { isMarketPath } = await import('./axiom-capture.js')
  for (const path of ['/transactions-feed', '/token-info-v2', '/holder-data-v3', '/top-traders-v3']) assert.equal(isMarketPath(path), true, path)
  for (const path of ['/bundle-key-and-wallets-v2', '/get-settings', '/wo/token-balances-v1', '/batched-transactions-from-user', '/user-data', '/tracked-wallets']) assert.equal(isMarketPath(path), false, path)
})

test('trades feeds the Pulse tab polls are read into trades but not kept as captured answers', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { trackerSchema } = await import('./db.js')
  const { storeCapture } = await import('./axiom-capture.js')
  const database = new Database(':memory:')
  database.exec(trackerSchema)
  const tokenAddress = 'c8ptadDszEWiv6CBS5MqTrDsaV3pqwtKxAXn5Nipump'
  const feed = [{ signature: 'poll-sig-1', createdAt: '2026-11-17T01:17:33.528Z', type: 'buy', tokenAddress, walletAddress: 'BHMUS8GTWwr5teaJHzD3dwQA3qUCjvam6zAzV9zWfJqM', transactionPriceUsd: 0.001, amountToken: 1000 }]
  storeCapture(database, { pairAddress: null, api: [{ url: `https://sol-api1.axiom.trade/transactions-feed?tokenAddress=${tokenAddress}&sortDirection=desc`, status: 200, body: JSON.stringify(feed), poll: true }] })
  assert.equal((database.prepare('SELECT COUNT(*) AS n FROM coin_trades').get() as { n: number }).n, 1)
  assert.equal((database.prepare('SELECT COUNT(*) AS n FROM axiom_capture').get() as { n: number }).n, 0)
})

test('the poll note says how the Pulse tab feed reads went, or that the tab is silent', () => {
  assert.match(pollNote(1_000_000), /no word from the tab/)
  notePollStats({ sent: 40, ok: 38, failed: 2, status: 200, mints: 55, hidden: true }, 1_000_000)
  assert.equal(pollNote(1_010_000), 'Pulse tab trade polling: 38 of 40 feed reads ok, 2 failed (last HTTP 200), 55 coins, tab in background')
  assert.match(pollNote(1_200_000), /no word from the tab/)
})
