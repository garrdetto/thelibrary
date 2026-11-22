import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { initializeTrackerSchema, type TrackerDatabase } from './db.js'
import { buyersOf, climberMisses, findClimb, liveClimb, loadClimbers, recordClimbers, type ClimbPoint } from './steady-climbers.js'

const minute = 60_000
const start = Date.UTC(2026, 10, 22, 12)

const lifecycleTable = `CREATE TABLE coin_lifecycles (mint TEXT PRIMARY KEY, symbol TEXT NOT NULL, launched_at INTEGER NOT NULL, first_seen_at INTEGER NOT NULL, first_price REAL NOT NULL, features_json TEXT,
  peak_price REAL NOT NULL, peak_at INTEGER NOT NULL, max_liquidity REAL, last_price REAL NOT NULL, last_at INTEGER NOT NULL, rugged_at INTEGER, rug_kind TEXT, outcome TEXT NOT NULL DEFAULT 'open',
  closed_at INTEGER, first_mcap REAL, peak_mcap REAL, peak_mcap_at INTEGER, last_mcap REAL, traits_json TEXT, holders_peak INTEGER)`
const tradesTable = 'CREATE TABLE coin_trades (tx TEXT, mint TEXT, wallet TEXT, kind TEXT, usd REAL, tokens REAL, price_usd REAL, at INTEGER, source TEXT)'

/** A chart sampled every minute from `from` to `to` market cap over `minutes`, wobbling a little on the way. */
function chart(from: number, to: number, minutes: number, at = start, wobble = 0.03): ClimbPoint[] {
  return Array.from({ length: minutes + 1 }, (_, index) => {
    const base = from * (to / from) ** (index / minutes)
    const mcap = index === minutes ? to : base * (1 + (index % 7 === 3 ? -wobble : wobble / 3))
    return { t: at + index * minute, mcap, liquidity: 40_000 + mcap * 0.05, volume5m: 12_000, buys5m: 60, sells5m: 40, viewers: 80 }
  })
}

test('a steady two-hour rise to $400K is a steady climber', () => {
  const climb = findClimb(chart(60_000, 400_000, 120))
  assert.ok(climb)
  assert.ok(climb.minutes >= 110)
  assert.ok(climb.gain > 5)
  assert.ok(climb.upShare > 0.8)
  assert.deepEqual(climberMisses(climb), [])
})

test('a ten-minute pump to $400K is not a steady climber', () => {
  const climb = findClimb(chart(60_000, 400_000, 10))
  assert.ok(climb)
  assert.ok(climberMisses(climb).includes('rose for under an hour'))
})

test('a long climb that stays small, or trades thin, is not a steady climber', () => {
  const small = findClimb(chart(20_000, 120_000, 90))
  assert.ok(small && climberMisses(small).includes('peak under $200K'))
  const thin = findClimb(chart(60_000, 400_000, 120).map(point => ({ ...point, volume5m: 500, liquidity: 8_000 })))
  assert.ok(thin)
  assert.ok(climberMisses(thin).includes('low volume'))
  assert.ok(climberMisses(thin).includes('low liquidity'))
})

test('the climb starts after the last deep fall before the peak', () => {
  const crash = [...chart(100_000, 300_000, 30), ...chart(90_000, 500_000, 90, start + 35 * minute)]
  const climb = findClimb(crash)
  assert.ok(climb)
  assert.ok(climb.startAt >= start + 30 * minute)
  assert.ok(Math.abs(climb.startMcap - 90_000) / 90_000 < 0.1)
})

test('buyers are counted only up to the peak, biggest first', () => {
  const buyers = buyersOf([
    { wallet: 'A', kind: 'buy', usd: 300, at: start },
    { wallet: 'B', kind: 'buy', usd: 900, at: start + minute },
    { wallet: 'A', kind: 'sell', usd: 500, at: start + 5 * minute },
    { wallet: 'C', kind: 'buy', usd: 2_000, at: start + 99 * minute },
  ], start + 10 * minute)
  assert.deepEqual(buyers.map(entry => entry.wallet), ['B', 'A'])
  assert.equal(buyers[1].soldUsd, 500)
})

function seed() {
  const database: TrackerDatabase = new Database(':memory:')
  initializeTrackerSchema(database)
  database.exec(lifecycleTable)
  database.exec(tradesTable)
  const token = database.prepare('INSERT INTO tokens (mint, pair_address, symbol, name, pair_created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
  const snapshot = database.prepare('INSERT INTO snapshots (mint, viewers, price_usd, market_cap, liquidity_usd, volume_5m, buys_5m, sells_5m, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const lifecycle = database.prepare(`INSERT INTO coin_lifecycles (mint, symbol, launched_at, first_seen_at, first_price, features_json, peak_price, peak_at, max_liquidity, last_price, last_at, outcome, first_mcap, peak_mcap, peak_mcap_at, last_mcap)
    VALUES (?, ?, ?, ?, 1, '{}', 1, ?, ?, 1, ?, 'open', ?, ?, ?, ?)`)
  const add = (mint: string, points: ClimbPoint[]) => {
    const peak = points.reduce((best, point) => point.mcap > best.mcap ? point : best)
    token.run(mint, `pair-${mint}`, mint.toUpperCase(), mint, start, points[points.length - 1].t)
    for (const point of points) snapshot.run(mint, point.viewers, point.mcap / 1e9, point.mcap, point.liquidity, point.volume5m, point.buys5m, point.sells5m, point.t)
    lifecycle.run(mint, mint.toUpperCase(), start, start, peak.t, 80_000, points[points.length - 1].t, points[0].mcap, peak.mcap, peak.t, points[points.length - 1].mcap)
  }
  add('steady', chart(60_000, 450_000, 150))
  add('pump', [...chart(60_000, 450_000, 8), ...chart(400_000, 100_000, 60, start + 9 * minute)])
  database.prepare('INSERT INTO coin_trades (tx, mint, wallet, kind, usd, tokens, price_usd, at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('t1', 'steady', 'W1', 'buy', 750, 1, 1, start + 20 * minute, 'axiom-trades')
  return database
}

test('the scan saves steady climbers with their milestones, curve and early buyers, and skips pumps', () => {
  const database = seed()
  assert.equal(recordClimbers(database, start + 200 * minute), 1)
  const [climber, ...rest] = loadClimbers(database)
  assert.equal(rest.length, 0)
  assert.equal(climber.mint, 'steady')
  assert.equal(climber.wallets, 1)
  assert.deepEqual(climber.milestones.map(mark => mark.label), ['start', '15m', '30m', '60m', '120m', 'peak'])
  assert.equal(climber.shape.length, 24)
  assert.ok((climber.milestones[2].volume5m ?? 0) > 0)
  assert.equal(recordClimbers(database, start + 201 * minute), 0, 'nothing changed, nothing rescanned')
})

test('a live coin still making highs reads as rising', () => {
  const database = seed()
  const climb = liveClimb(database, 'steady', start + 152 * minute)
  assert.ok(climb)
  assert.equal(climb.rising, true)
  assert.ok(climb.minutes >= 60)
})
