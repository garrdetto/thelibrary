import type { TrackerDatabase } from './db.js'

export type RankedWallet = { wallet: string; runnerHits: number; updatedAt: number }

export const holderWalletRankingSql = `
  SELECT h.wallet, COUNT(*) AS runnerHits, MAX(h.updated_at) AS updatedAt FROM good_coins g
  CROSS JOIN holders h ON h.mint = g.mint GROUP BY h.wallet HAVING COUNT(*) >= ?
  ORDER BY runnerHits DESC, updatedAt DESC LIMIT 40
`

/**
 * The 40 wallets holding the most good coins, with at least `minRunnerHits` of them.
 * CROSS JOIN makes SQLite start from the good coins and look up their holders; left to choose, it walks every row of `holders` instead.
 */
export function rankHolderWallets(database: TrackerDatabase, minRunnerHits: number) {
  return database.prepare(holderWalletRankingSql).all(minRunnerHits) as RankedWallet[]
}
