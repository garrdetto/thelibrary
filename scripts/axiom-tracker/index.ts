import { startAxiomCollector } from './axiom-collector.js'
import { closeTrackerDatabase, openTrackerDatabase, pruneSnapshots, recordHeartbeat, trackerDatabasePath } from './db.js'
import { startDiscovery } from './discovery.js'
import { startExtensionIntake } from './extension-intake.js'
import { createLogger, errorMessage, runLoop } from './runtime.js'
import { startScoring } from './scoring.js'
import { startSitePublisher } from './site-publisher.js'
import { startWalletTracker } from './wallet-tracker.js'

const logger = createLogger('orchestrator')
const controller = new AbortController()
const database = openTrackerDatabase()

let stopping = false
function shutdown(reason: string) {
  if (stopping) return
  stopping = true
  logger.info('Shutting down Axiom tracker', { reason })
  controller.abort()
  setTimeout(() => process.exit(0), 8_000).unref()
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', error => logger.error('Unhandled rejection', { error: errorMessage(error) }))
process.on('uncaughtException', error => logger.error('Uncaught exception', { error: errorMessage(error) }))

logger.info('Starting Axiom tracker', { database: trackerDatabasePath, pid: process.pid })
recordHeartbeat(database, 'orchestrator', 'ok', `pid ${process.pid}`)

const tasks = [
  startDiscovery(database, controller.signal),
  startAxiomCollector(database, controller.signal),
  startWalletTracker(database, controller.signal),
  startScoring(database, controller.signal),
  startSitePublisher(database, controller.signal),
  startExtensionIntake(database, controller.signal),
  runLoop('maintenance', 60 * 60_000, async () => {
    const removed = pruneSnapshots(database)
    database.pragma('wal_checkpoint(PASSIVE)')
    if (removed) logger.info('Pruned old snapshots', { removed })
  }, logger, controller.signal),
  runLoop('heartbeat', 15_000, async () => { recordHeartbeat(database, 'orchestrator', 'ok', `pid ${process.pid}`) }, logger, controller.signal),
]

Promise.allSettled(tasks).then(results => {
  for (const result of results) if (result.status === 'rejected') logger.error('Task ended with an error', { error: errorMessage(result.reason) })
  closeTrackerDatabase()
  logger.info('Axiom tracker stopped')
  process.exit(0)
})
