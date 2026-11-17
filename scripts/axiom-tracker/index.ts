import { startAdvice } from './advice.js'
import { startAxiomCollector } from './axiom-collector.js'
import { startExplosions } from './bursts.js'
import { startChartHistory } from './chart-history.js'
import { startCoinArchive } from './coin-archive.js'
import { startDexPaid } from './dex-paid.js'
import { closeTrackerDatabase, openTrackerDatabase, pruneSnapshots, recordHeartbeat, trackerDatabasePath } from './db.js'
import { startDiscovery } from './discovery.js'
import { startEarlyLog } from './early-log.js'
import { startExtensionIntake } from './extension-intake.js'
import { startFollowUp } from './follow-up.js'
import { startFreshWallets } from './fresh-wallets.js'
import { startHolderRefresh } from './holder-refresh.js'
import { startJupiter } from './jupiter.js'
import { startLearner } from './learner.js'
import { startLiveMarket } from './live-market.js'
import { startRunnerAlerts } from './runner-learning.js'
import { createLogger, errorMessage, runLoop } from './runtime.js'
import { startScoring } from './scoring.js'
import { startSelfCheck } from './self-check.js'
import { startSitePublisher } from './site-publisher.js'
import { startWalletTracker } from './wallet-tracker.js'
import { startWalletScores, walletBook } from './wallet-score.js'
import { startWalletPnl } from './wallet-pnl.js'
import { startFlipTraders } from './flip-traders.js'

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
  startLiveMarket(database, controller.signal),
  startAxiomCollector(database, controller.signal),
  startWalletTracker(database, controller.signal),
  startWalletScores(database, controller.signal),
  startWalletPnl(database, controller.signal, walletBook),
  startFlipTraders(database, controller.signal),
  startScoring(database, controller.signal),
  startSitePublisher(database, controller.signal),
  startExtensionIntake(database, controller.signal),
  startLearner(database, controller.signal),
  startCoinArchive(database, controller.signal),
  startExplosions(database, controller.signal),
  startFollowUp(database, controller.signal),
  startHolderRefresh(database, controller.signal),
  startJupiter(database, controller.signal),
  startFreshWallets(database, controller.signal),
  startDexPaid(database, controller.signal),
  startChartHistory(database, controller.signal),
  startRunnerAlerts(database, controller.signal),
  startEarlyLog(database, controller.signal),
  startAdvice(database, controller.signal),
  startSelfCheck(database, controller.signal),
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
