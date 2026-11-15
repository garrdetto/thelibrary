import { closeTrackerDatabase, openTrackerDatabase, trackerDatabasePath } from './db.js'
import { markResearchReset } from './research-meta.js'

/**
 * Clears everything the tracker has learned from studied coins so it starts again from live data only:
 * `pnpm axiom:reset-research`. Stop the tracker first. A dated copy of the database is kept beside it.
 */
const database = openTrackerDatabase()
const backupPath = `${trackerDatabasePath}.before-reset-${new Date().toISOString().replace(/[:.]/g, '-')}`
await database.backup(backupPath)
const tables = ['coin_lifecycles', 'radar_bursts', 'radar_burst_wallets', 'winner_wallets', 'good_coins']
const cleared: Record<string, number> = {}
database.transaction(() => {
  for (const table of tables) {
    if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) continue
    cleared[table] = database.prepare(`DELETE FROM ${table}`).run().changes
  }
  markResearchReset(database)
})()
closeTrackerDatabase()
console.log(JSON.stringify({ backupPath, cleared }, null, 1))
