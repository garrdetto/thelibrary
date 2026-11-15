import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { trackerSchema } from './db.js'
import { holderWalletRankingSql, rankHolderWallets } from './wallet-ranking.js'

function tracker() {
  const database = new Database(':memory:')
  database.exec(trackerSchema)
  const good = database.prepare("INSERT INTO good_coins (mint, symbol, reason, marked_at) VALUES (?, ?, 'test', 0)")
  const hold = database.prepare('INSERT INTO holders (mint, wallet, pct, updated_at) VALUES (?, ?, 1, ?)')
  for (const mint of ['good-1', 'good-2', 'good-3', 'good-4']) good.run(mint, mint)
  const holdings: Array<[string, string, number]> = [
    ['good-1', 'three-hits', 10], ['good-2', 'three-hits', 20], ['good-3', 'three-hits', 30],
    ['good-1', 'two-hits-older', 40], ['good-2', 'two-hits-older', 50],
    ['good-3', 'two-hits-newer', 60], ['good-4', 'two-hits-newer', 70],
    ['good-1', 'one-hit', 80],
  ]
  for (const [mint, wallet, at] of holdings) hold.run(mint, wallet, at)
  for (let coin = 0; coin < 300; coin++) for (const wallet of ['one-hit', 'three-hits', `crowd-${coin % 40}`]) hold.run(`other-${coin}`, wallet, 100 + coin)
  return database
}

test('wallets are ranked by how many good coins they hold, newest first on a tie', () => {
  assert.deepEqual(rankHolderWallets(tracker(), 2), [
    { wallet: 'three-hits', runnerHits: 3, updatedAt: 30 },
    { wallet: 'two-hits-newer', runnerHits: 2, updatedAt: 70 },
    { wallet: 'two-hits-older', runnerHits: 2, updatedAt: 50 },
  ])
  assert.deepEqual(rankHolderWallets(tracker(), 3).map(wallet => wallet.wallet), ['three-hits'])
})

test('the ranking reads only the holders of good coins, not the whole holders table', () => {
  const steps = (tracker().prepare(`EXPLAIN QUERY PLAN ${holderWalletRankingSql}`).all(2) as Array<{ detail: string }>).map(step => step.detail)
  assert.ok(steps.some(step => /^SEARCH h USING .*\(mint=\?\)/.test(step)), steps.join(' | '))
  assert.ok(!steps.some(step => step.startsWith('SCAN h')), steps.join(' | '))
})
