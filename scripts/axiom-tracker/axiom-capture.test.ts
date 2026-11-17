import assert from 'node:assert/strict'
import test from 'node:test'
import { walletSightings } from './axiom-capture.js'

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
