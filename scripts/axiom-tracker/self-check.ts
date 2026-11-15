import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { recordHeartbeat, type TrackerDatabase } from './db.js'
import { createLogger, runLoop } from './runtime.js'
import { guardStatus, stalledLoops, type GuardState, type HeartbeatRow } from './self-check-rules.js'

const logger = createLogger('self-check')
const checkEveryMs = 30_000

function readGuardState(): GuardState | null {
  const path = resolve('data/watchdog.json')
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) as GuardState } catch { return null }
}

/**
 * Every 30 seconds: reports on the Windows guard, and exits the tracker when a core loop has gone quiet so PM2 starts it
 * afresh. A loop can hang on a request that never answers; a restart is the cure. Set AXIOM_SELF_RESTART=0 to only report.
 */
export function startSelfCheck(database: TrackerDatabase, signal: AbortSignal) {
  const startedAt = Date.now()
  const restarts = process.env.AXIOM_SELF_RESTART !== '0'
  const read = database.prepare('SELECT component, updated_at FROM worker_heartbeat')
  return runLoop('self-check', checkEveryMs, async () => {
    const now = Date.now()
    const guard = guardStatus(readGuardState(), now)
    recordHeartbeat(database, 'watchdog', guard.status, guard.detail)
    const stalled = stalledLoops(read.all() as HeartbeatRow[], now, startedAt)
    if (!stalled.length) {
      recordHeartbeat(database, 'self-check', 'ok', 'Every core loop is reporting')
      return
    }
    recordHeartbeat(database, 'self-check', 'restarting', `${stalled.join(', ')} stopped reporting${restarts ? '; restarting the tracker' : ''}`)
    logger.error('Core loops stopped reporting', { stalled, restarting: restarts })
    if (restarts) setTimeout(() => process.exit(1), 500)
  }, logger, signal)
}
