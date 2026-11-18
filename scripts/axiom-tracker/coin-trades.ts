import type { TrackerDatabase } from './db.js'

/**
 * Swaps and per-wallet totals from every source that sees them (GeckoTerminal pool trades, Axiom pages through the bridge).
 * Readers write here; `flip-traders.ts` turns them into each wallet's record of quick flips.
 */
export const coinTradesSchema = `
CREATE TABLE IF NOT EXISTS coin_trades (
  tx TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  kind TEXT NOT NULL,
  usd REAL NOT NULL,
  tokens REAL,
  price_usd REAL,
  at INTEGER NOT NULL,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS coin_trades_mint_at ON coin_trades (mint, at);
CREATE INDEX IF NOT EXISTS coin_trades_wallet ON coin_trades (wallet);
CREATE INDEX IF NOT EXISTS coin_trades_wallet_mint_at ON coin_trades (wallet, mint, at);
CREATE INDEX IF NOT EXISTS coin_trades_at ON coin_trades (at);

CREATE TABLE IF NOT EXISTS wallet_coin_stats (
  wallet TEXT NOT NULL,
  mint TEXT NOT NULL,
  source TEXT NOT NULL,
  bought_usd REAL,
  sold_usd REAL,
  profit_usd REAL,
  holding_pct REAL,
  first_at INTEGER,
  at INTEGER NOT NULL,
  PRIMARY KEY (wallet, mint, source)
);
CREATE INDEX IF NOT EXISTS wallet_coin_stats_wallet ON wallet_coin_stats (wallet);
`

/** Trades and totals older than this are dropped; a week of flips is plenty to judge a wallet by. */
export const coinTradesKeepMs = 7 * 24 * 60 * 60_000

export type CoinTrade = { tx: string; mint: string; wallet: string; kind: 'buy' | 'sell'; usd: number; tokens: number | null; priceUsd: number | null; at: number; source: string }
export type WalletCoinStat = { wallet: string; mint: string; source: string; boughtUsd: number | null; soldUsd: number | null; profitUsd: number | null; holdingPct: number | null; firstAt: number | null; at: number }

export function ensureCoinTrades(database: TrackerDatabase) {
  database.exec(coinTradesSchema)
}

/** Saves swaps, skipping any already saved (by transaction). Returns how many were new. */
export function recordTrades(database: TrackerDatabase, trades: CoinTrade[]) {
  ensureCoinTrades(database)
  const insert = database.prepare('INSERT OR IGNORE INTO coin_trades (tx, mint, wallet, kind, usd, tokens, price_usd, at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  let added = 0
  database.transaction(() => {
    for (const trade of trades) added += insert.run(trade.tx, trade.mint, trade.wallet, trade.kind, trade.usd, trade.tokens, trade.priceUsd, trade.at, trade.source).changes
  })()
  return added
}

/** Saves a source's own totals for wallets in a coin, replacing that source's earlier reading. */
export function recordWalletStats(database: TrackerDatabase, stats: WalletCoinStat[]) {
  ensureCoinTrades(database)
  const upsert = database.prepare('INSERT OR REPLACE INTO wallet_coin_stats (wallet, mint, source, bought_usd, sold_usd, profit_usd, holding_pct, first_at, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  database.transaction(() => {
    for (const stat of stats) upsert.run(stat.wallet, stat.mint, stat.source, stat.boughtUsd, stat.soldUsd, stat.profitUsd, stat.holdingPct, stat.firstAt, stat.at)
  })()
}

export function pruneCoinTrades(database: TrackerDatabase, now = Date.now()) {
  ensureCoinTrades(database)
  database.prepare('DELETE FROM coin_trades WHERE at < ?').run(now - coinTradesKeepMs)
  database.prepare('DELETE FROM wallet_coin_stats WHERE at < ?').run(now - coinTradesKeepMs)
}
