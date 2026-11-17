import assert from 'node:assert/strict'
import { test } from 'node:test'
import { associatedTokenAccount, decodeBase58, encodeBase58, token2022Program } from './solana-address.js'
import { readTrade, summarize, type ParsedTransaction, type Trade } from './wallet-pnl.js'
import { buildWalletBook, profitLift, scoreWallets, type CoinResult } from './wallet-score.js'

const wallet = 'CWJSBe7SemKoPLuJQkJnvfhzoq3LHCRbxmB1c6i3gEyC'
const mint = '7RyCoc1K6jhfqf6hkB1xjdff4wcekXtcF8HYxgQcpump'

test('token accounts are derived the way the chain does', () => {
  assert.equal(associatedTokenAccount(wallet, mint, token2022Program), 'ygvqGFZ5vsUeDuMMBcC6dQYxQwSqJaD4N5i8xcsRmZz')
  assert.equal(encodeBase58(decodeBase58(mint)), mint)
})

function transaction(lamports: number, tokensBefore: number, tokensAfter: number, signer = wallet): ParsedTransaction {
  return {
    blockTime: 1_000,
    meta: {
      err: null,
      preBalances: [5e9, 1e9],
      postBalances: signer === wallet ? [5e9 + lamports, 1e9] : [5e9, 1e9],
      preTokenBalances: [{ owner: wallet, mint, uiTokenAmount: { uiAmount: tokensBefore } }],
      postTokenBalances: [{ owner: wallet, mint, uiTokenAmount: { uiAmount: tokensAfter } }],
    },
    transaction: { message: { accountKeys: [{ pubkey: signer }, { pubkey: 'other' }] } },
  }
}

test('a buy, a sell and a transfer are read from the wallet side', () => {
  assert.equal(readTrade(transaction(-1.5e9, 0, 1_000_000), wallet, mint)?.kind, 'buy')
  assert.equal(readTrade(transaction(2e9, 1_000_000, 0), wallet, mint)?.kind, 'sell')
  assert.equal(readTrade(transaction(0, 0, 1_000_000, 'someone-else'), wallet, mint)?.kind, 'moved-in')
  assert.equal(readTrade({ ...transaction(-1e9, 0, 5), meta: { err: 'failed' } }, wallet, mint), null)
})

const trade = (kind: Trade['kind'], sol: number, tokens: number): Trade => ({ at: 1, kind, sol, tokens })

test('buy-in, proceeds and profit add up, and leftover tokens are valued', () => {
  const result = summarize([trade('buy', -2, 100), trade('buy', -1, 50), trade('sell', 4.5, -120)], 0.01)
  assert.equal(result.status, 'priced')
  assert.equal(result.buySol, 3)
  assert.equal(result.sellSol, 4.5)
  assert.equal(result.leftTokens, 30)
  assert.ok(Math.abs((result.profitSol ?? 0) - 1.8) < 1e-9)
})

test('coins mostly moved by transfer are not priced', () => {
  assert.equal(summarize([trade('moved-in', 0, 1_000), trade('sell', 3, -1_000)], 0).status, 'moved')
  assert.equal(summarize([], 0).status, 'empty')
})

test('profitable traders lift the Wallet Score and losing traders lower it', () => {
  assert.ok(profitLift([{ mint: 'a', buySol: 5, profitSol: 20 }, { mint: 'b', buySol: 5, profitSol: 10 }]) > 0.5)
  assert.ok(profitLift([{ mint: 'a', buySol: 5, profitSol: -4.5 }, { mint: 'b', buySol: 5, profitSol: -4 }]) < -0.4)
  const results: CoinResult[] = Array.from({ length: 60 }, (_, index) => ({ mint: `coin-${index}`, win: index < 4, closed: true, peakAt: 10, knownAt: 10 }))
  const sightings = ['earner', 'loser'].flatMap(holder => [0, 10, 20].map(index => ({ wallet: holder, mint: `coin-${index}`, pct: 1, at: 1 })))
  const profits = new Map([
    ['earner', { checked: 3, coins: [{ mint: 'coin-10', buySol: 4, profitSol: 30 }, { mint: 'coin-20', buySol: 6, profitSol: 12 }] }],
    ['loser', { checked: 3, coins: [{ mint: 'coin-10', buySol: 4, profitSol: -3.8 }, { mint: 'coin-20', buySol: 6, profitSol: -5 }] }],
  ])
  const book = buildWalletBook(sightings, results, 100, profits)
  const earner = scoreWallets([{ wallet: 'earner', pct: 2 }], 200_000, book, 'new-coin', 0)
  const loser = scoreWallets([{ wallet: 'loser', pct: 2 }], 200_000, book, 'new-coin', 0)
  assert.ok(earner.score > loser.score + 20, `${earner.score} vs ${loser.score}`)
  assert.equal(earner.top[0].profitSol, 42)
  assert.equal(earner.top[0].buyInSol, 10)
  assert.match(earner.summary, /best trader made 42\.0 SOL on 2 earlier coins \(put in 10\.0 SOL\)/)
})
