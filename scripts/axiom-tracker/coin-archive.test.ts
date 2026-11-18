import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { initializeTrackerSchema, type TrackerDatabase } from './db.js'
import { archiveCoins, archiveState, enforceSizeCap, freshStart, fullCoins, rankTiers, readFullRecord, shapeOf, upShareOf } from './coin-archive.js'

const minute = 60_000
const start = Date.UTC(2026, 10, 17, 12)

const lifecycleTable = `CREATE TABLE coin_lifecycles (mint TEXT PRIMARY KEY, symbol TEXT NOT NULL, launched_at INTEGER NOT NULL, first_seen_at INTEGER NOT NULL, first_price REAL NOT NULL, features_json TEXT,
  peak_price REAL NOT NULL, peak_at INTEGER NOT NULL, max_liquidity REAL, last_price REAL NOT NULL, last_at INTEGER NOT NULL, rugged_at INTEGER, rug_kind TEXT, outcome TEXT NOT NULL DEFAULT 'open',
  closed_at INTEGER, first_mcap REAL, peak_mcap REAL, peak_mcap_at INTEGER, last_mcap REAL, traits_json TEXT, holders_peak INTEGER)`
const tradesTable = 'CREATE TABLE coin_trades (tx TEXT, mint TEXT, wallet TEXT, kind TEXT, usd REAL, tokens REAL, price_usd REAL, at INTEGER, source TEXT)'

type Kind = 'runner' | 'faded' | 'rug' | 'junk'
const kinds: Kind[] = ['runner', 'faded', 'rug', 'junk']

function seed(coins = 260, openCoins = 0) {
  const database: TrackerDatabase = new Database(':memory:')
  initializeTrackerSchema(database)
  database.exec(lifecycleTable)
  database.exec(tradesTable)
  const token = database.prepare('INSERT INTO tokens (mint, pair_address, symbol, name, pair_created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
  const snapshot = database.prepare('INSERT INTO snapshots (mint, viewers, price_usd, market_cap, liquidity_usd, volume_5m, buys_5m, sells_5m, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const lifecycle = database.prepare(`INSERT INTO coin_lifecycles (mint, symbol, launched_at, first_seen_at, first_price, features_json, peak_price, peak_at, max_liquidity, last_price, last_at, rugged_at, rug_kind, outcome, closed_at, first_mcap, peak_mcap, peak_mcap_at, last_mcap)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const holder = database.prepare('INSERT INTO holders (mint, wallet, pct, updated_at) VALUES (?, ?, ?, ?)')
  const trade = database.prepare('INSERT INTO coin_trades (tx, mint, wallet, kind, usd, tokens, price_usd, at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  database.transaction(() => {
    for (let index = 0; index < coins + openCoins; index++) {
      const mint = `mint-${index}`
      const kind = kinds[index % kinds.length]
      const open = index >= coins
      const seenAt = start + index * minute
      const top = kind === 'runner' ? 4 + (index % 7) : kind === 'faded' ? 1.6 : kind === 'rug' ? 2.5 : 1.1
      const liquidity = kind === 'junk' ? 2_500 : 25_000
      token.run(mint, `pair-${index}`, `C${index}`, `Coin ${index}`, seenAt - 2 * minute, seenAt + 40 * minute)
      let peak = 0
      let last = 0
      for (let step = 0; step < 30; step++) {
        const climb = step <= 20 ? 1 + (top - 1) * step / 20 : kind === 'rug' ? 0.05 * top : top * (1 - (step - 20) * 0.03)
        const mcap = 10_000 * climb
        peak = Math.max(peak, mcap)
        last = mcap
        snapshot.run(mint, kind === 'runner' ? 300 : 40, mcap / 1e9, mcap, liquidity, kind === 'junk' ? 400 : 6_000 + step * 200, 30, 12, seenAt + step * minute)
      }
      const features = JSON.stringify({ viewers: kind === 'runner' ? 300 : 40, buyRatio: kind === 'runner' ? 0.72 : 0.5, bundlers: kind === 'rug' ? 20 : 4, top10: kind === 'rug' ? 30 : 14, quality: kind === 'runner' ? 85 : 50, liquidity, marketCap: 10_000 })
      const rugged = kind === 'rug' ? seenAt + 21 * minute : null
      lifecycle.run(mint, `C${index}`, seenAt - 2 * minute, seenAt, 1e-5, features, peak / 1e9, seenAt + 20 * minute, liquidity, last / 1e9, seenAt + 29 * minute, rugged, rugged ? 'price crash' : null,
        open ? 'open' : kind === 'rug' ? 'rug' : kind === 'runner' ? 'survived' : 'faded', open ? null : seenAt + 40 * minute, 10_000, peak, seenAt + 20 * minute, last)
      holder.run(mint, `holder-${index % 9}`, 1.5, seenAt)
      holder.run(mint, `dust-${index}`, 0.05, seenAt)
      if (kind === 'runner') holder.run(mint, 'whale', 2.5, seenAt)
      trade.run(`tx-${index}`, mint, `buyer-${index % 5}`, 'buy', 400, 1, 1e-5, seenAt + minute, 'test')
    }
  })()
  return database
}

const count = (database: TrackerDatabase, table: string) => (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count

test('up share spots a staircase and the shape keeps 24 points', () => {
  assert.equal(upShareOf([1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6]), 1)
  assert.equal(upShareOf([1, 1.1, 1]), null, 'too few moves to say')
  const shape = shapeOf(Array.from({ length: 100 }, (_, index) => ({ viewers: index, price_usd: index, market_cap: index, liquidity_usd: index, volume_5m: index, buys_5m: 1, sells_5m: 1, timestamp: start + index * 1_000 })))
  assert.ok(shape && shape.price.length === 24 && shape.price[23] === 99)
})

test('finished coins are summarized once, with the best kept in full and junk never in full', () => {
  const database = seed()
  const first = archiveCoins(database, start + 10 * 60 * minute)
  assert.equal(first.added, 260)
  assert.equal(archiveCoins(database, start + 11 * 60 * minute).added, 0, 'no coin is archived twice')
  const classes = Object.fromEntries((database.prepare('SELECT class, COUNT(*) AS count FROM coin_archive GROUP BY class').all() as Array<{ class: string; count: number }>).map(row => [row.class, row.count]))
  assert.equal(classes.garbage, 65)
  assert.ok(classes.runner > 0 && classes.rug > 0)
  assert.equal(count(database, 'coin_archive_full'), fullCoins)
  const kept = database.prepare('SELECT f.data, a.class FROM coin_archive_full f JOIN coin_archive a ON a.mint = f.mint').all() as Array<{ data: Buffer; class: string }>
  assert.ok(kept.every(row => row.class !== 'garbage' && row.class !== 'steady_rug'))
  const record = readFullRecord(kept[0].data) as { snapshots: unknown[]; holders: unknown[]; trades: unknown[] }
  assert.equal(record.snapshots.length, 30)
  assert.ok(record.holders.length >= 2 && record.trades.length === 1)
  const row = database.prepare("SELECT data_weight, data_points, shape_json, features_json FROM coin_archive WHERE mint = 'mint-0'").get() as { data_weight: number; data_points: number; shape_json: string; features_json: string }
  assert.equal(row.data_points, 50, '30 snapshots plus the lifecycle row')
  assert.ok(row.data_weight > 0.4 && row.data_weight < 1)
  assert.equal(JSON.parse(row.shape_json).mcap.length, 24)
  assert.equal(JSON.parse(row.features_json).viewers, 300)
})

test('the 20 tiers put runners at the top and junk at the bottom', () => {
  const database = seed()
  archiveCoins(database, start + 10 * 60 * minute)
  const ladder = rankTiers(database, start + 10 * 60 * minute)
  assert.equal(ladder.profiles.length, 20)
  assert.equal(count(database, 'coin_tiers'), 20)
  const top = database.prepare('SELECT DISTINCT class FROM coin_archive WHERE tier = 1').all() as Array<{ class: string }>
  assert.deepEqual(top.map(row => row.class), ['runner'])
  const bottom = database.prepare('SELECT DISTINCT class FROM coin_archive WHERE tier = 20').all() as Array<{ class: string }>
  assert.deepEqual(bottom.map(row => row.class), ['garbage'])
  assert.equal(archiveState.coins, 260)
})

test('wallet stakes are archived per coin without dust holders', () => {
  const database = seed()
  archiveCoins(database, start + 10 * 60 * minute)
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM wallet_archive WHERE wallet LIKE 'dust-%'").get() as { count: number }).count, 0)
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM wallet_archive WHERE wallet = 'whale'").get() as { count: number }).count, 65)
  assert.ok((database.prepare("SELECT COUNT(*) AS count FROM wallet_archive WHERE wallet LIKE 'buyer-%'").get() as { count: number }).count > 0, '$400 buys count as stakes')
})

test('the size cap drops raw rows of archived coins only, oldest first, and keeps the summaries', () => {
  const database = seed(260, 4)
  archiveCoins(database, start + 10 * 60 * minute)
  const dropped = enforceSizeCap(database, 1)
  assert.equal(dropped, 260)
  assert.equal(count(database, 'coin_archive'), 260)
  assert.equal(count(database, 'snapshots'), 4 * 30, 'coins still open keep their chart')
  assert.equal(count(database, 'coin_trades'), 4)
})

test('a fresh start archives every coin, open ones too, then empties the working tables', () => {
  const database = seed(260, 6)
  const result = freshStart(database, start + 10 * 60 * minute)
  assert.equal(result.coins, 266)
  assert.equal(result.tiers, 20)
  for (const table of ['tokens', 'snapshots', 'holders', 'coin_lifecycles', 'coin_trades', 'paper_trades']) assert.equal(count(database, table), 0, table)
  assert.equal(count(database, 'coin_archive'), 266)
  assert.ok(count(database, 'wallet_archive') > 0)
  assert.equal(count(database, 'model_weights'), 1, 'learned weights go back to the defaults')
  assert.ok(count(database, 'coin_archive_full') > 0)
  assert.equal((database.prepare("SELECT value FROM research_meta WHERE key = 'reset_at'").get() as { value: string }).value, String(start + 10 * 60 * minute))
})
