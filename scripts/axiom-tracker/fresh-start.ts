import { createConnection } from 'node:net'
import { closeTrackerDatabase, openTrackerDatabase, trackerDatabasePath } from './db.js'
import { freshStart, usedBytes } from './coin-archive.js'
import { trackerConfig } from './runtime.js'

/**
 * Starts tracking from fresh coins without losing history: `pnpm axiom:fresh-start` (stop the tracker first).
 * Keeps a dated copy of the database, summarizes every coin into the archive (the best 50 in full), ranks the 20 tiers,
 * empties every working table, then compacts the file.
 */
function trackerAnswers(port: number) {
  return new Promise<boolean>(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(1_500)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
  })
}

if (await trackerAnswers(trackerConfig.extensionPort)) {
  console.error(`The tracker is still running on port ${trackerConfig.extensionPort}. Stop it first (pm2 stop axiom-worker), then run this again.`)
  process.exit(1)
}

const database = openTrackerDatabase()
const backupPath = `${trackerDatabasePath}.before-fresh-start-${new Date().toISOString().replace(/[:.]/g, '-')}`
await database.backup(backupPath)
const before = usedBytes(database)
const result = freshStart(database)
database.exec('VACUUM')
const after = usedBytes(database)
closeTrackerDatabase()
console.log(JSON.stringify({ backupPath, ...result, megabytesBefore: Math.round(before / 1048576), megabytesAfter: Math.round(after / 1048576) }, null, 1))
