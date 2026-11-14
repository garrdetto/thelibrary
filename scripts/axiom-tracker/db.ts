import './runtime.js'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type TrackerDatabase = Database.Database

export const trackerDatabasePath = resolve(process.env.AXIOM_DB_PATH ?? 'data/axiom-tracker.db')

export const trackerSchema = `
CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY,
  pair_address TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  image_url TEXT,
  pair_created_at INTEGER NOT NULL,
  socials_json TEXT NOT NULL DEFAULT '{}',
  rug_score REAL,
  mint_auth INTEGER,
  freeze_auth INTEGER,
  top10_pct REAL,
  is_boosted INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_last_seen ON tokens (last_seen_at);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  viewers INTEGER,
  price_usd REAL,
  market_cap REAL,
  liquidity_usd REAL,
  volume_5m REAL,
  buys_5m INTEGER,
  sells_5m INTEGER,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshots_mint_time ON snapshots (mint, timestamp);
CREATE INDEX IF NOT EXISTS snapshots_time ON snapshots (timestamp);

CREATE TABLE IF NOT EXISTS smart_wallets (
  wallet TEXT PRIMARY KEY,
  runner_hits INTEGER NOT NULL DEFAULT 0,
  last_hit_mint TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_entries (
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  entry_mcap REAL,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (mint, wallet)
);
CREATE INDEX IF NOT EXISTS wallet_entries_time ON wallet_entries (timestamp);

CREATE TABLE IF NOT EXISTS paper_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  entry_price REAL NOT NULL,
  entry_mcap REAL,
  setup_score REAL NOT NULL,
  reasons_json TEXT NOT NULL,
  price_5m REAL,
  price_15m REAL,
  price_30m REAL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS paper_trades_status ON paper_trades (status);

CREATE TABLE IF NOT EXISTS model_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  w_viewer_velocity REAL NOT NULL,
  w_active_viewers REAL NOT NULL,
  w_runner_wallets REAL NOT NULL,
  w_buy_pressure REAL NOT NULL,
  w_safety REAL NOT NULL,
  win_rate REAL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runner_scans (
  mint TEXT PRIMARY KEY,
  buyers_found INTEGER NOT NULL,
  scanned_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS holders (
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  pct REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (mint, wallet)
);
CREATE INDEX IF NOT EXISTS holders_wallet ON holders (wallet);

CREATE TABLE IF NOT EXISTS good_coins (
  mint TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  reason TEXT NOT NULL,
  marked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_heartbeat (
  component TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  detail TEXT,
  updated_at INTEGER NOT NULL
);
`

let connection: TrackerDatabase | null = null

export function initializeTrackerSchema(database: TrackerDatabase) {
  database.exec(trackerSchema)
  const weights = database.prepare('SELECT COUNT(*) AS count FROM model_weights').get() as { count: number }
  if (weights.count === 0) {
    database.prepare('INSERT INTO model_weights (w_viewer_velocity, w_active_viewers, w_runner_wallets, w_buy_pressure, w_safety, win_rate, sample_count, updated_at) VALUES (1, 1, 1, 1, 1, NULL, 0, ?)').run(Date.now())
  }
}

export function openTrackerDatabase(): TrackerDatabase {
  if (connection) return connection
  mkdirSync(dirname(trackerDatabasePath), { recursive: true })
  const database = new Database(trackerDatabasePath)
  database.pragma('journal_mode = WAL')
  database.pragma('synchronous = NORMAL')
  database.pragma('busy_timeout = 5000')
  initializeTrackerSchema(database)
  connection = database
  return database
}

export function closeTrackerDatabase() {
  connection?.close()
  connection = null
}

export function recordHeartbeat(database: TrackerDatabase, component: string, status: string, detail: string | null = null) {
  database.prepare('INSERT INTO worker_heartbeat (component, status, detail, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (component) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = excluded.updated_at').run(component, status, detail, Date.now())
}

export function pruneSnapshots(database: TrackerDatabase, olderThanMs = 24 * 60 * 60 * 1000) {
  database.prepare('DELETE FROM holders WHERE updated_at < ?').run(Date.now() - 7 * 24 * 60 * 60 * 1000)
  return database.prepare('DELETE FROM snapshots WHERE timestamp < ?').run(Date.now() - olderThanMs).changes
}
