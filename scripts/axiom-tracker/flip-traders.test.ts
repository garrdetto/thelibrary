import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { recordTrades, recordWalletStats, type CoinTrade } from './coin-trades.js'
import { flipLift, flipOf, loadFlipBook, readGeckoTrades, recentBuyers } from './flip-traders.js'
import { buildWalletBook, scoreWallets } from './wallet-score.js'

const mint = '4La95NEVJdYK9kr375SfKPXnLA8ef8GtsjfVfW27pump'
const sol = 'So11111111111111111111111111111111111111112'
const minute = 60_000

test('GeckoTerminal trades are read as swaps of the coin, without dust or anomalies', () => {
  const buy = { attributes: { tx_hash: 'tx1', tx_from_address: 'walletA', kind: 'buy', block_timestamp: '2026-11-17T00:22:34Z', from_token_address: sol, to_token_address: mint, from_token_amount: '0.5', to_token_amount: '58000', price_to_in_usd: '0.000613', volume_in_usd: '35.6', is_anomalous: false } }
  const sell = { attributes: { ...buy.attributes, tx_hash: 'tx2', kind: 'sell', from_token_address: mint, to_token_address: sol, from_token_amount: '20000', to_token_amount: '0.2', price_from_in_usd: '0.0007', volume_in_usd: '40' } }
  const dust = { attributes: { ...buy.attributes, tx_hash: 'tx3', volume_in_usd: '0.7' } }
  const odd = { attributes: { ...buy.attributes, tx_hash: 'tx4', is_anomalous: true } }
  const trades = readGeckoTrades([buy, sell, dust, odd], mint)
  assert.deepEqual(trades.map(trade => [trade.tx, trade.kind, trade.tokens]), [['tx1', 'buy', 58000], ['tx2', 'sell', 20000]])
  assert.equal(trades[0].at, Date.parse('2026-11-17T00:22:34Z'))
})

test('a round trip is priced at the average buy price and quick flips are marked', () => {
  const flip = flipOf(mint, { buyUsd: 100, buyTokens: 100, sellUsd: 160, sellTokens: 80, firstBuyAt: 0, lastSellAt: 12 * minute })
  assert.ok(flip)
  assert.equal(flip.buyUsd, 80)
  assert.equal(flip.profitUsd, 80)
  assert.equal(flip.quick, true)
  assert.equal(flipOf(mint, { buyUsd: 100, buyTokens: 100, sellUsd: 30, sellTokens: 30, firstBuyAt: 0, lastSellAt: minute }), null)
  assert.equal(flipOf(mint, { buyUsd: 100, buyTokens: 100, sellUsd: 300, sellTokens: 100, firstBuyAt: 0, lastSellAt: 90 * minute })?.quick, false)
})

const trade = (tx: string, wallet: string, coin: string, kind: 'buy' | 'sell', usd: number, tokens: number, at: number): CoinTrade => ({ tx, mint: coin, wallet, kind, usd, tokens, priceUsd: usd / tokens, at, source: 'gecko' })

function trades() {
  const database = new Database(':memory:')
  const now = Date.now()
  const rows: CoinTrade[] = []
  for (let coin = 0; coin < 4; coin++) {
    const at = now - (5 - coin) * 60 * minute
    rows.push(trade(`f${coin}b`, 'flipper', `coin-${coin}`, 'buy', 400, 1000, at), trade(`f${coin}s`, 'flipper', `coin-${coin}`, 'sell', 900, 1000, at + 8 * minute))
    rows.push(trade(`l${coin}b`, 'bagholder', `coin-${coin}`, 'buy', 400, 1000, at + 9 * minute), trade(`l${coin}s`, 'bagholder', `coin-${coin}`, 'sell', 120, 1000, at + 40 * minute))
  }
  rows.push(trade('early-sell', 'flipper', 'coin-9', 'sell', 500, 1000, now - 50 * minute))
  rows.push(trade('now-f', 'flipper', 'live', 'buy', 600, 1000, now - 2 * minute), trade('now-l', 'bagholder', 'live', 'buy', 500, 1000, now - minute))
  assert.equal(recordTrades(database, rows), rows.length)
  assert.equal(recordTrades(database, rows), 0)
  return { database, now }
}

test('each wallet gets a flip record from its round trips; sells without a seen buy are left out', () => {
  const { database, now } = trades()
  const book = loadFlipBook(database, now)
  const flipper = book.get('flipper')
  assert.equal(flipper?.flips.length, 4)
  assert.equal(flipper?.wins, 4)
  assert.equal(flipper?.quick, 4)
  assert.equal(flipper?.profitUsd, 2000)
  assert.equal(book.get('bagholder')?.wins, 0)
  assert.ok(flipLift(flipper) > 0.5)
  assert.ok(flipLift(book.get('bagholder')) < -0.5)
})

test('a source\'s own totals replace the trade estimate for that coin', () => {
  const { database, now } = trades()
  recordWalletStats(database, [{ wallet: 'bagholder', mint: 'coin-0', source: 'axiom-top-traders', boughtUsd: 400, soldUsd: 2400, profitUsd: 2000, holdingPct: 0, firstAt: null, at: now }])
  const record = loadFlipBook(database, now).get('bagholder')
  assert.equal(record?.wins, 1)
  assert.equal(record?.flips.find(flip => flip.mint === 'coin-0')?.source, 'stats')
})

test('proven flippers buying now lift the Wallet Score; losing traders buying do not', () => {
  const { database, now } = trades()
  const book = buildWalletBook([], [], now, new Map(), loadFlipBook(database, now))
  const buyers = recentBuyers(database, 'live', now)
  assert.equal(buyers.length, 2)
  const both = scoreWallets([], 100_000, book, 'live', now, buyers)
  assert.equal(both.flippersBuying, 1)
  assert.equal(both.flippers?.[0].wallet, 'flipper')
  assert.equal(both.flippers?.[0].profitUsd, 2000)
  assert.match(both.summary, /1 proven flipper bought \$600 in the last 10 minutes \(they made \$2\.0k on 4 flips, 4 won\)/)
  assert.match(both.summary, /1 losing trader buying/)
  const flipperOnly = scoreWallets([], 100_000, book, 'live', now, buyers.filter(buyer => buyer.wallet === 'flipper'))
  const loserOnly = scoreWallets([], 100_000, book, 'live', now, buyers.filter(buyer => buyer.wallet === 'bagholder'))
  assert.ok(flipperOnly.score > 60, `flipper ${flipperOnly.score}`)
  assert.ok(loserOnly.score < 45, `loser ${loserOnly.score}`)
})
