import assert from 'node:assert/strict'
import test from 'node:test'
import { holderStatsFrom, holdersFrom, tradersFrom, tradesFrom } from './axiom-readers.js'

const mint = 'c8ptadDszEWiv6CBS5MqTrDsaV3pqwtKxAXn5Nipump'
const wallet = 'BHMUS8GTWwr5teaJHzD3dwQA3qUCjvam6zAzV9zWfJqM'
const swap = (type: string, signature: string) => ({ signature, createdAt: '2026-11-17T01:17:33.528Z', type, pairAddress: 'x', tokenAddress: mint, walletAddress: wallet, transactionPriceUsd: 0.0008729696935282549, amountToken: 2121.054161, amountNative: 0.026 })

test('the trades feed becomes buys and sells with tokens, price and dollar size; liquidity moves are left out', () => {
  const trades = tradesFrom('/transactions-feed', [swap('buy', 'sig1'), swap('sell', 'sig2'), swap('add', 'sig3'), swap('remove', 'sig4')])
  assert.deepEqual(trades.map(trade => [trade.tx, trade.kind]), [['sig1', 'buy'], ['sig2', 'sell']])
  assert.equal(trades[0].mint, mint)
  assert.equal(trades[0].wallet, wallet)
  assert.equal(trades[0].tokens, 2121.054161)
  assert.equal(trades[0].usd, 1.85)
  assert.equal(trades[0].at, Date.parse('2026-11-17T01:17:33.528Z'))
  assert.equal(trades[0].source, 'axiom-trades')
})

test('sniper answers give both their instant and early lists; other paths give no trades', () => {
  assert.equal(tradesFrom('/sniper-transactions', { instant: [swap('buy', 'a')], early: [swap('buy', 'b'), swap('sell', 'c')] }).length, 3)
  assert.equal(tradesFrom('/token-info-v2', [swap('buy', 'a')]).length, 0)
})

test('token info gives the exact holder shares', () => {
  const stats = holderStatsFrom({ holderStats: { top10HoldersPercent: 15.6, devHoldsPercent: 0.03, snipersHoldPercent: 0.03, insidersHoldPercent: 5.8, bundlersHoldPercent: 6.2, freshWalletsHoldPercent: 3.3, proTradersHoldPercent: 51.9, numHolders: 5871 } }, 1)
  assert.equal(stats?.top10, 15.6)
  assert.equal(stats?.fresh, 3.3)
  assert.equal(stats?.proTraders, 51.9)
  assert.equal(holderStatsFrom({ holderStats: null }, 1), null)
})

const wallets = ['BHMUS8GTWwr5teaJHzD3dwQA3qUCjvam6zAzV9zWfJqM', '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM']

test('a holders answer gives each wallet and its share in percent, wherever the list sits', () => {
  const rows = holdersFrom({ data: { holders: wallets.map((walletAddress, index) => ({ walletAddress, tokenAddress: mint, holdingPercent: 3 - index, amount: 100 })) } })
  assert.deepEqual(rows.map(row => [row.wallet, row.pct]), wallets.map((wallet, index) => [wallet, 3 - index]))
  const fractions = holdersFrom(wallets.map((owner, index) => ({ owner, percentage: 0.03 - index / 100 })))
  assert.equal(fractions[0].pct, 3)
  assert.equal(holdersFrom([{ walletAddress: wallets[0], percent: 2 }]).length, 0)
})

test('a top traders answer gives dollars in, out and profit per wallet', () => {
  const stats = tradersFrom(wallets.map((walletAddress, index) => ({ walletAddress, usdBought: 100 * (index + 1), usdSold: 150 * (index + 1), boughtSol: 1, firstBuyAt: '2026-11-17T01:00:00.000Z' })), mint, 5)
  assert.equal(stats.length, 3)
  assert.equal(stats[1].boughtUsd, 200)
  assert.equal(stats[1].soldUsd, 300)
  assert.equal(stats[1].profitUsd, 100)
  assert.equal(stats[0].firstAt, Date.parse('2026-11-17T01:00:00.000Z'))
  assert.equal(stats[0].source, 'axiom-top-traders')
  assert.equal(tradersFrom(wallets.map(walletAddress => ({ walletAddress, boughtSol: 1 })), mint, 5).length, 0)
})
